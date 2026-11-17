/**
 * ============================================================================
 * SALINAS REPARTO — MOTOR COMPARTIDO DE OPTIMIZACIÓN DE RUTAS (OSRM) + DRAG TÁCTIL
 * Reutilizable 100% en Admin (Tablet/PC) y Chofer (Celular).
 * ============================================================================
 */
import { haversineMeters } from "./firebase-config.js?v=nav3d_9";

const OSRM_BASES = [
  "https://router.project-osrm.org",
  "https://routing.openstreetmap.de/routed-car"
];

export function formatRouteKm(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return "0 km";
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km >= 100 ? Math.round(km) : km.toFixed(1)} km`;
}

export function formatRouteMin(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "1 min";
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

async function fetchOsrmJson(pathAndQuery, timeoutMs = 6500) {
  for (const base of OSRM_BASES) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${pathAndQuery}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) continue;
      const json = await res.json();
      if (json && json.code === "Ok") return json;
    } catch (_) {
      clearTimeout(t);
    }
  }
  return null;
}

function greedyNearestNeighbor(startCoord, stops) {
  const remaining = [...stops];
  const ordered = [];
  let curLat = startCoord.lat;
  let curLng = startCoord.lng;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(curLat, curLng, remaining[i].lat, remaining[i].lng) ?? 999999;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    ordered.push(chosen);
    curLat = chosen.lat;
    curLng = chosen.lng;
  }
  return ordered;
}

function estimateFallbackMetrics(waypoints) {
  let distM = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    distM += haversineMeters(waypoints[i].lat, waypoints[i].lng, waypoints[i + 1].lat, waypoints[i + 1].lng) || 0;
  }
  // Factor vial aproximado 1.28x sobre línea recta, velocidad urbana ~32 km/h (8.9 m/s)
  const roadM = Math.round(distM * 1.28);
  const durS = Math.round(roadM / 8.9);
  return {
    distanceMeters: roadM,
    durationSec: durS,
    latLngs: waypoints.map((w) => [w.lat, w.lng])
  };
}

/**
 * Calcula distancia, tiempo y polilínea OSRM para una secuencia YA ordenada de paradas.
 */
export async function computeOrderedRouteMetrics({ startCoord = null, stops = [], endCoord = null }) {
  const validStops = (stops || []).filter((s) => Number.isFinite(Number(s?.lat)) && Number.isFinite(Number(s?.lng)));
  const waypoints = [];
  if (startCoord && Number.isFinite(startCoord.lat) && Number.isFinite(startCoord.lng)) {
    waypoints.push({ lat: Number(startCoord.lat), lng: Number(startCoord.lng) });
  }
  validStops.forEach((s) => waypoints.push({ lat: Number(s.lat), lng: Number(s.lng) }));
  if (endCoord && Number.isFinite(endCoord.lat) && Number.isFinite(endCoord.lng)) {
    waypoints.push({ lat: Number(endCoord.lat), lng: Number(endCoord.lng) });
  }

  if (waypoints.length < 2) {
    return { distanceMeters: 0, durationSec: 0, latLngs: waypoints.map((w) => [w.lat, w.lng]), source: "none" };
  }

  const coordStr = waypoints.map((w) => `${w.lng.toFixed(5)},${w.lat.toFixed(5)}`).join(";");
  const data = await fetchOsrmJson(`/route/v1/driving/${coordStr}?overview=full&geometries=geojson`);
  const route = data?.routes?.[0];
  if (route && Array.isArray(route.geometry?.coordinates)) {
    return {
      distanceMeters: Math.round(Number(route.distance) || 0),
      durationSec: Math.round(Number(route.duration) || 0),
      latLngs: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      source: "osrm"
    };
  }

  return { ...estimateFallbackMetrics(waypoints), source: "fallback" };
}

/**
 * Ajusta una estela GPS cruda a las calles reales usando OSRM Map Matching (/match/v1/driving/),
 * separando segmentos cuando hay saltos > 450 m y con fallback limpio a los puntos crudos.
 */
export async function matchGpsTrailWithOsrm(points = []) {
  const valid = (points || []).filter(
    (pt) => Number.isFinite(Number(pt?.lat)) && Number.isFinite(Number(pt?.lng))
  );
  if (valid.length < 2) {
    return { segments: [], source: "none" };
  }

  // Separar en segmentos cuando haya huecos > 450m
  const rawSegments = [];
  let cur = [];
  for (let i = 0; i < valid.length; i++) {
    const pt = [Number(valid[i].lat), Number(valid[i].lng)];
    if (cur.length > 0) {
      const prev = cur[cur.length - 1];
      const gap = haversineMeters(prev[0], prev[1], pt[0], pt[1]);
      if (gap !== null && gap > 450) {
        if (cur.length >= 2) rawSegments.push(cur);
        cur = [];
      }
    }
    // Evitar puntos casi duplicados (< 8m) para mejorar matching OSRM
    if (cur.length === 0 || i === valid.length - 1) {
      cur.push(pt);
    } else {
      const prev = cur[cur.length - 1];
      const d = haversineMeters(prev[0], prev[1], pt[0], pt[1]);
      if (d === null || d >= 8) cur.push(pt);
    }
  }
  if (cur.length >= 2) rawSegments.push(cur);

  if (rawSegments.length === 0) {
    return { segments: [], source: "none" };
  }

  let anyOsrm = false;
  const matchedSegments = [];
  for (const seg of rawSegments) {
    // Limitar a máximo 45 puntos por segmento para URL corta y respuesta rápida
    let sampled = seg;
    if (seg.length > 45) {
      sampled = [];
      const step = (seg.length - 1) / 44;
      for (let k = 0; k < 44; k++) sampled.push(seg[Math.round(k * step)]);
      sampled.push(seg[seg.length - 1]);
    }
    const coordStr = sampled.map(([lat, lng]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(";");
    const radiusStr = sampled.map(() => "35").join(";");
    const data = await fetchOsrmJson(
      `/match/v1/driving/${coordStr}?geometries=geojson&overview=full&tidy=true&radiuses=${radiusStr}`,
      5500
    );
    const matchings = Array.isArray(data?.matchings) ? data.matchings : [];
    const snapped = [];
    for (const m of matchings) {
      if (Array.isArray(m?.geometry?.coordinates)) {
        for (const [lng, lat] of m.geometry.coordinates) {
          snapped.push([lat, lng]);
        }
      }
    }
    if (snapped.length >= 2) {
      anyOsrm = true;
      matchedSegments.push(snapped);
    } else {
      matchedSegments.push(seg);
    }
  }

  return { segments: matchedSegments, source: anyOsrm ? "osrm" : "raw" };
}

/**
 * Optimiza el orden de las paradas desde `startCoord` hasta `endCoord` (opcional regreso a Base)
 * usando OSRM Trip API con fallback automático a Vecino Más Cercano.
 */
export async function optimizeStopsWithOsrm({ startCoord = null, stops = [], endCoord = null }) {
  const validStops = (stops || []).filter((s) => Number.isFinite(Number(s?.lat)) && Number.isFinite(Number(s?.lng)));
  if (validStops.length === 0) {
    return { orderedStops: [], distanceMeters: 0, durationSec: 0, latLngs: [], source: "none" };
  }

  if (validStops.length === 1) {
    const metrics = await computeOrderedRouteMetrics({ startCoord, stops: validStops, endCoord });
    return { orderedStops: validStops, ...metrics };
  }

  const tripPoints = [];
  let hasStart = false;
  let hasEnd = false;

  if (startCoord && Number.isFinite(startCoord.lat) && Number.isFinite(startCoord.lng)) {
    tripPoints.push({ lat: Number(startCoord.lat), lng: Number(startCoord.lng), _kind: "start" });
    hasStart = true;
  }
  validStops.forEach((s, idx) => {
    tripPoints.push({ lat: Number(s.lat), lng: Number(s.lng), _kind: "stop", _stopIdx: idx });
  });
  if (endCoord && Number.isFinite(endCoord.lat) && Number.isFinite(endCoord.lng)) {
    tripPoints.push({ lat: Number(endCoord.lat), lng: Number(endCoord.lng), _kind: "end" });
    hasEnd = true;
  }

  const coordStr = tripPoints.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  const tripQuery = `/trip/v1/driving/${coordStr}?roundtrip=false&source=${hasStart ? "first" : "any"}&destination=${hasEnd ? "last" : "any"}&overview=full&geometries=geojson`;

  const tripData = await fetchOsrmJson(tripQuery);
  const trip = tripData?.trips?.[0];
  const wps = tripData?.waypoints;

  if (trip && Array.isArray(wps) && wps.length === tripPoints.length) {
    const indexed = wps
      .map((wp, origIdx) => ({ origIdx, wpIdx: wp.waypoint_index }))
      .sort((a, b) => a.wpIdx - b.wpIdx);

    const orderedStops = [];
    for (const item of indexed) {
      const pt = tripPoints[item.origIdx];
      if (pt && pt._kind === "stop") {
        orderedStops.push(validStops[pt._stopIdx]);
      }
    }

    if (orderedStops.length === validStops.length) {
      return {
        orderedStops,
        distanceMeters: Math.round(Number(trip.distance) || 0),
        durationSec: Math.round(Number(trip.duration) || 0),
        latLngs: Array.isArray(trip.geometry?.coordinates)
          ? trip.geometry.coordinates.map(([lng, lat]) => [lat, lng])
          : [],
        source: "osrm"
      };
    }
  }

  // Fallback local Vecino Más Cercano
  const originForGreedy = hasStart ? startCoord : { lat: validStops[0].lat, lng: validStops[0].lng };
  const orderedStops = greedyNearestNeighbor(originForGreedy, validStops);
  const metrics = await computeOrderedRouteMetrics({ startCoord, stops: orderedStops, endCoord });
  return { orderedStops, ...metrics };
}

/**
 * Inserta una parada de último minuto en las paradas pendientes:
 * - mode === "next": la pone como la primera pendiente.
 * - mode === "optimal": la inserta en la posición que agregue menor desvío.
 */
export function insertPendingStopSmart({ currentCoord = null, pendingStops = [], newStop, endCoord = null, mode = "optimal" }) {
  if (!newStop) return [...pendingStops];
  const filtered = pendingStops.filter((s) => !(s.id === newStop.id && s.kind === newStop.kind));
  if (mode === "next" || filtered.length === 0) {
    return [newStop, ...filtered];
  }

  let bestPos = filtered.length;
  let bestAddedMeters = Infinity;

  for (let i = 0; i <= filtered.length; i++) {
    const prev = i === 0 ? currentCoord : filtered[i - 1];
    const next = i < filtered.length ? filtered[i] : endCoord;
    let added = 0;
    if (prev && next) {
      const oldD = haversineMeters(prev.lat, prev.lng, next.lat, next.lng) || 0;
      const newD =
        (haversineMeters(prev.lat, prev.lng, newStop.lat, newStop.lng) || 0) +
        (haversineMeters(newStop.lat, newStop.lng, next.lat, next.lng) || 0);
      added = newD - oldD;
    } else if (prev) {
      added = haversineMeters(prev.lat, prev.lng, newStop.lat, newStop.lng) || 0;
    } else if (next) {
      added = haversineMeters(newStop.lat, newStop.lng, next.lat, next.lng) || 0;
    }
    if (added < bestAddedMeters) {
      bestAddedMeters = added;
      bestPos = i;
    }
  }

  const out = [...filtered];
  out.splice(bestPos, 0, newStop);
  return out;
}

/**
 * Drag & Drop táctil + ratón usando Pointer Events exclusivamente sobre `.route-drag-handle`,
 * permitiendo scroll normal en tablet y celular cuando se desliza sobre el resto de la tarjeta.
 */
export function attachTouchDragSort(listContainerEl, itemSelector, handleSelector, onReorderIndices) {
  if (!listContainerEl || listContainerEl.__rpDragAttached) return;
  listContainerEl.__rpDragAttached = true;

  let draggingEl = null;
  let fromIdx = -1;
  let startY = 0;
  let pending = null;

  function cancelPending() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
  }

  function activateDrag(item, handle, pointerId, clientY) {
    const items = Array.from(listContainerEl.querySelectorAll(itemSelector));
    const idx = items.indexOf(item);
    if (idx < 0) return;
    fromIdx = idx;
    draggingEl = item;
    startY = clientY;
    item.classList.add("is-dragging");
    try {
      navigator.vibrate?.(25);
    } catch (_) {}
    try {
      handle.setPointerCapture(pointerId);
    } catch (_) {}
  }

  listContainerEl.addEventListener("pointerdown", (ev) => {
    const handle = ev.target.closest(handleSelector);
    if (!handle) return;
    const item = handle.closest(itemSelector);
    if (!item) return;

    cancelPending();

    if (ev.pointerType === "mouse") {
      ev.preventDefault();
      activateDrag(item, handle, ev.pointerId, ev.clientY);
      return;
    }

    // Touch / pen: require 280ms hold without scrolling (>8px) so normal page scroll is never hijacked
    const pState = {
      item,
      handle,
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      timer: setTimeout(() => {
        if (pending !== pState) return;
        pending = null;
        activateDrag(item, handle, pState.pointerId, pState.startY);
      }, 280)
    };
    pending = pState;
  });

  listContainerEl.addEventListener("pointermove", (ev) => {
    if (pending && ev.pointerId === pending.pointerId) {
      if (Math.hypot(ev.clientX - pending.startX, ev.clientY - pending.startY) > 8) {
        cancelPending();
      }
      return;
    }
    if (!draggingEl) return;
    if (ev.cancelable) ev.preventDefault();
    const dy = ev.clientY - startY;
    draggingEl.style.transform = `translateY(${dy}px)`;

    const items = Array.from(listContainerEl.querySelectorAll(itemSelector));
    const dragRect = draggingEl.getBoundingClientRect();
    const dragCenterY = dragRect.top + dragRect.height / 2;

    for (let i = 0; i < items.length; i++) {
      const candidate = items[i];
      if (candidate === draggingEl) continue;
      const r = candidate.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (i < fromIdx && dragCenterY < mid) {
        listContainerEl.insertBefore(draggingEl, candidate);
        fromIdx = i;
        startY = ev.clientY;
        draggingEl.style.transform = "";
        break;
      } else if (i > fromIdx && dragCenterY > mid) {
        listContainerEl.insertBefore(draggingEl, candidate.nextSibling);
        fromIdx = i;
        startY = ev.clientY;
        draggingEl.style.transform = "";
        break;
      }
    }
  }, { passive: false });

  function finishDrag() {
    cancelPending();
    if (!draggingEl) return;
    draggingEl.classList.remove("is-dragging");
    draggingEl.style.transform = "";
    const newOrderIds = Array.from(listContainerEl.querySelectorAll(itemSelector)).map((el) =>
      Number(el.dataset.stopIdx)
    );
    draggingEl = null;
    fromIdx = -1;
    if (typeof onReorderIndices === "function") {
      onReorderIndices(newOrderIds);
    }
  }

  listContainerEl.addEventListener("pointerup", finishDrag);
  listContainerEl.addEventListener("pointercancel", finishDrag);
}
