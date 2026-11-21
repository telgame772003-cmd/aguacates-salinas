// prospects-zones.js
// Módulo independiente de Prospección DENUE (Saltillo + Ramos Arizpe),
// Cuadrantes Manuales / KML (Ray-Casting) y Anillos Concéntricos.

const QUADS_LS_KEY = "salinas_quadrants_v1";
const RADII_LS_KEY = "salinas_concentric_radii_v1";
const PACKS_DONE_LS_KEY = "salinas_completed_packs_v1";

const QUAD_COLORS = ["#15803d", "#0284c7", "#7c3aed", "#d97706", "#dc2626", "#0d9488", "#be185d", "#4f46e5"];

const CAT_META = {
  fruteria: { emoji: "🥑", label: "Frutería", color: "#15803d" },
  carniceria: { emoji: "🥩", label: "Carnicería", color: "#dc2626" },
  restaurante: { emoji: "🍽️", label: "Restaurante", color: "#d97706" },
  tienda: { emoji: "🏪", label: "Abarrotes / Minisúper (6+)", color: "#0284c7" },
  comedor: { emoji: "🏢", label: "Comedor Industrial", color: "#7c3aed" }
};

const PRESET_SALTILLO_QUADS = [
  {
    id: "quad_norte",
    name: "Saltillo Norte (Carranza / Campestre)",
    color: "#15803d",
    polygon: [
      [25.495, -101.015],
      [25.495, -100.945],
      [25.445, -100.945],
      [25.445, -101.015]
    ]
  },
  {
    id: "quad_centro",
    name: "Saltillo Centro",
    color: "#0284c7",
    polygon: [
      [25.445, -101.015],
      [25.445, -100.97],
      [25.408, -100.97],
      [25.408, -101.015]
    ]
  },
  {
    id: "quad_poniente",
    name: "Poniente (Saltillo 2000 / Valencia / Satélite)",
    color: "#7c3aed",
    polygon: [
      [25.455, -101.075],
      [25.455, -101.015],
      [25.39, -101.015],
      [25.39, -101.075]
    ]
  },
  {
    id: "quad_oriente",
    name: "Oriente (Mirasierra / Fundadores / Morelos)",
    color: "#d97706",
    polygon: [
      [25.455, -100.97],
      [25.455, -100.9],
      [25.395, -100.9],
      [25.395, -100.97]
    ]
  },
  {
    id: "quad_sur",
    name: "Saltillo Sur (Lourdes / Teresitas / Guayulera)",
    color: "#dc2626",
    polygon: [
      [25.408, -101.03],
      [25.408, -100.95],
      [25.345, -100.95],
      [25.345, -101.03]
    ]
  },
  {
    id: "quad_ramos",
    name: "Ramos Arizpe",
    color: "#0d9488",
    polygon: [
      [25.585, -100.995],
      [25.585, -100.905],
      [25.505, -100.905],
      [25.505, -100.995]
    ]
  },
  {
    id: "quad_arteaga",
    name: "Arteaga (Cabecera / Bella Unión)",
    color: "#be185d",
    polygon: [
      [25.475, -100.905],
      [25.475, -100.815],
      [25.405, -100.815],
      [25.405, -100.905]
    ]
  }
];

let rawProspects = [];
let activeProspects = []; // deduplicated against existing places
let showProspects = false;
let showQuadrants = false;
let showConcentric = false;

let quadrants = [];
let concentricRadiiKm = [3, 7, 12, 20];

let prospectClusterGroup = null;
let quadrantsLayerGroup = null;
let concentricLayerGroup = null;
let drawTempLayerGroup = null;
let autoPackPreviewLayer = null;

let showAutoPacks = true;
let generatedPacks = [];
let previewPackId = null;
let completedPacksMeta = {};

let drawingActive = false;
let drawingPoints = [];

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normTokens(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["las", "los", "del", "san", "don", "dona", "abarrotes", "fruteria", "carniceria", "restaurante"].includes(w));
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Ray-Casting (Point-in-Polygon)
function isPointInPolygon(lat, lng, poly) {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function getBridge() {
  return window.__salinasMapBridge || null;
}

function loadLocalZonesState() {
  try {
    const rawQ = localStorage.getItem(QUADS_LS_KEY);
    if (rawQ) {
      const parsed = JSON.parse(rawQ);
      if (Array.isArray(parsed)) quadrants = parsed;
    }
  } catch (_) {}
  try {
    const rawR = localStorage.getItem(RADII_LS_KEY);
    if (rawR) {
      const parsedR = JSON.parse(rawR);
      if (Array.isArray(parsedR) && parsedR.length) concentricRadiiKm = parsedR;
    }
  } catch (_) {}
  const inp = document.getElementById("inpConcentricRadii");
  if (inp) inp.value = concentricRadiiKm.join(", ");
  try {
    localStorage.removeItem(PACKS_DONE_LS_KEY);
  } catch (_) {}
}

async function persistZonesState() {
  try {
    localStorage.setItem(QUADS_LS_KEY, JSON.stringify(quadrants));
    localStorage.setItem(RADII_LS_KEY, JSON.stringify(concentricRadiiKm));
  } catch (_) {}
  const bridge = getBridge();
  if (bridge?.saveZonesConfig) {
    try {
      await bridge.saveZonesConfig({ quadrants, concentricRadiiKm });
    } catch (_) {}
  }
}

async function fetchProspectsJson() {
  try {
    const resp = await fetch(`data/prospectos-saltillo-ramos.json?v=${Date.now()}`);
    if (!resp.ok) return;
    rawProspects = await resp.json();
    recomputeDeduplicatedProspects();
  } catch (err) {
    console.warn("No se pudo cargar prospectos DENUE:", err);
  }
}

function recomputeDeduplicatedProspects() {
  const bridge = getBridge();
  const places = bridge ? bridge.getAllPlaces() : [];
  const placeIndex = places
    .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
    .map((p) => ({
      lat: p.lat,
      lng: p.lng,
      denueId: p.denueId || null,
      tokens: new Set(normTokens(p.name))
    }));

  let dedupedCount = 0;
  activeProspects = rawProspects.filter((pr) => {
    for (const pl of placeIndex) {
      if (pl.denueId && pl.denueId === pr.id) {
        dedupedCount++;
        return false;
      }
      if (Math.abs(pl.lat - pr.lat) > 0.001 || Math.abs(pl.lng - pr.lng) > 0.001) continue;
      const dist = haversineM(pr.lat, pr.lng, pl.lat, pl.lng);
      if (dist <= 45) {
        dedupedCount++;
        return false;
      }
      if (dist <= 90 && pl.tokens.size > 0) {
        const prTokens = normTokens(pr.n);
        if (prTokens.some((t) => pl.tokens.has(t))) {
          dedupedCount++;
          return false;
        }
      }
    }
    return true;
  });

  updateZoneFilterDropdown();
  updateSalesCorrelationBadge();
  renderProspectsCluster();
  renderQuadrantsUIAndLayer();
  renderConcentricUIAndLayer();
  buildAndRenderAutoPacks();

  const badge = document.getElementById("pzSummaryBadge");
  if (badge) {
    badge.textContent = `${activeProspects.length.toLocaleString("es-MX")} prospectos${dedupedCount ? ` (-${dedupedCount} ya clientes)` : ""} ▾`;
  }
}

function computeSalesByCategory() {
  const bridge = getBridge();
  if (!bridge) return {};
  const sales = bridge.getRouteSales() || [];
  const places = bridge.getAllPlaces() || [];
  if (!sales.length || !places.length) return {};

  const nameToCat = new Map();
  places.forEach((p) => {
    if (p.name && p.category) {
      nameToCat.set(String(p.name).trim().toLowerCase(), p.category);
    }
  });

  const stats = {};
  for (const s of sales) {
    const cname = String(s.clientName || s.customerName || "").trim().toLowerCase();
    const cat = s.placeCategory || nameToCat.get(cname);
    const amt = Number(s.totalAmount || s.total || 0);
    if (!cat || amt <= 0) continue;
    if (!stats[cat]) stats[cat] = { sum: 0, count: 0 };
    stats[cat].sum += amt;
    stats[cat].count += 1;
  }
  const avg = {};
  for (const [k, v] of Object.entries(stats)) {
    if (v.count > 0) avg[k] = { avgTicket: Math.round(v.sum / v.count), count: v.count };
  }
  return avg;
}

function updateSalesCorrelationBadge() {
  const pill = document.getElementById("pzSalesCorrelationPill");
  if (!pill) return;
  const avgByCat = computeSalesByCategory();
  const entries = Object.entries(avgByCat);
  if (entries.length === 0) {
    pill.textContent = "💡 Potencial por giro y tamaño (se calibrará en automático conforme registres ventas)";
    return;
  }
  const topTxt = entries
    .map(([c, v]) => `${CAT_META[c]?.emoji || "•"} $${v.avgTicket.toLocaleString("es-MX")}/venta`)
    .join(" · ");
  pill.textContent = `💰 Ticket real 30d: ${topTxt}`;
}

function updateZoneFilterDropdown() {
  const sel = document.getElementById("pzFilterZone");
  if (!sel) return;
  const prev = sel.value || "all";
  const quadOpts = quadrants
    .map((q) => `<option value="quad:${esc(q.id)}">📐 ${esc(q.name)}</option>`)
    .join("");
  const ringOpts = concentricRadiiKm
    .map((r, idx) => {
      const minR = idx === 0 ? 0 : concentricRadiiKm[idx - 1];
      return `<option value="ring:${idx}">⭕ Anillo ${idx + 1} (${minR}–${r} km)</option>`;
    })
    .join("");

  sel.innerHTML =
    `<option value="all">Toda la región</option>` +
    (quadOpts ? `<optgroup label="Cuadrantes KML / Manuales">${quadOpts}</optgroup>` : "") +
    `<optgroup label="Anillos Concéntricos">${ringOpts}</optgroup>`;

  if ([...sel.options].some((o) => o.value === prev)) {
    sel.value = prev;
  }
}

function is11Plus(sz) {
  const s = String(sz || "");
  return Boolean(s && !s.startsWith("0 a 5") && !s.startsWith("6 a 10"));
}

function is31Plus(sz) {
  const s = String(sz || "");
  return Boolean(is11Plus(s) && !s.startsWith("11 a 30"));
}

function cleanTenDigits(tel) {
  const d = String(tel || "").replace(/\D/g, "");
  if (d.length === 10) return d;
  if (d.length === 12 && d.startsWith("52")) return d.slice(2);
  return "";
}

function filterProspectItem(pr, { cat, mun, tier, zone }) {
  if (cat !== "all" && pr.c !== cat) return false;
  if (mun !== "all" && pr.mun !== mun) return false;
  if (tier === "alto" && pr.tier !== "alto") return false;
  if (tier === "11plus" && !is11Plus(pr.sz)) return false;
  if (tier === "31plus" && !is31Plus(pr.sz)) return false;
  if (tier === "with_tel" && !pr.tel) return false;
  if (zone && zone !== "all") {
    if (zone.startsWith("quad:")) {
      const qid = zone.slice(5);
      const q = quadrants.find((x) => x.id === qid);
      if (q && !isPointInPolygon(pr.lat, pr.lng, q.polygon)) return false;
    } else if (zone.startsWith("ring:")) {
      const rIdx = Number(zone.slice(5));
      const bridge = getBridge();
      const base = bridge?.getBaseLocation?.() || { lat: 25.4267, lng: -100.9954 };
      const distKm = haversineM(base.lat, base.lng, pr.lat, pr.lng) / 1000;
      const minR = rIdx === 0 ? 0 : concentricRadiiKm[rIdx - 1];
      const maxR = concentricRadiiKm[rIdx] || 999;
      if (distKm < minR || distKm > maxR) return false;
    }
  }
  return true;
}

function getFilteredProspects() {
  const cat = document.getElementById("pzFilterCat")?.value || "all";
  const mun = document.getElementById("pzFilterMun")?.value || "all";
  const tier = document.getElementById("pzFilterTier")?.value || "all";
  const zone = document.getElementById("pzFilterZone")?.value || "all";
  return activeProspects.filter((pr) => filterProspectItem(pr, { cat, mun, tier, zone }));
}

function ensureLayers() {
  const bridge = getBridge();
  const map = bridge?.getMap?.();
  if (!map || typeof window.L === "undefined") return null;

  if (!Number.isFinite(map.getMaxZoom())) {
    map.setMaxZoom(19);
  }

  if (!quadrantsLayerGroup) quadrantsLayerGroup = window.L.layerGroup().addTo(map);
  if (!concentricLayerGroup) concentricLayerGroup = window.L.layerGroup().addTo(map);
  if (!drawTempLayerGroup) drawTempLayerGroup = window.L.layerGroup().addTo(map);
  if (!autoPackPreviewLayer) autoPackPreviewLayer = window.L.layerGroup().addTo(map);
  if (!prospectClusterGroup) {
    prospectClusterGroup =
      typeof window.L.markerClusterGroup === "function"
        ? window.L.markerClusterGroup({
            maxClusterRadius: 46,
            disableClusteringAtZoom: 16,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false
          })
        : window.L.layerGroup();
  }
  return map;
}

function renderProspectsCluster(announce = false) {
  const btn = document.getElementById("btnToggleProspectsLayer");
  const filtered = showProspects ? getFilteredProspects() : [];

  if (btn) {
    if (showProspects) {
      btn.textContent = `🟢 Prospectos Visibles (${filtered.length.toLocaleString("es-MX")})`;
      btn.classList.remove("btn-outline");
      btn.classList.add("btn-primary");
      btn.style.color = "#fff";
    } else {
      const cnt = activeProspects.length || rawProspects.length;
      btn.textContent = `⚪ Mostrar Prospectos${cnt ? ` (${cnt.toLocaleString("es-MX")})` : " DENUE"}`;
      btn.classList.remove("btn-primary");
      btn.classList.add("btn-outline");
      btn.style.color = "#14532d";
    }
  }

  const map = ensureLayers();
  if (!map || !prospectClusterGroup) {
    if (showProspects) {
      setTimeout(() => renderProspectsCluster(announce), 400);
    }
    return;
  }

  prospectClusterGroup.clearLayers();
  if (!showProspects) {
    if (map.hasLayer(prospectClusterGroup)) map.removeLayer(prospectClusterGroup);
    return;
  }

  const avgByCat = computeSalesByCategory();

  const markers = filtered.map((pr) => {
    const meta = CAT_META[pr.c] || CAT_META.tienda;
    const isHigh = pr.tier === "alto";
    const borderCol = isHigh ? meta.color : "#64748b";
    const icon = window.L.divIcon({
      className: "salinas-div-icon",
      html: `<div style="width:26px;height:26px;border-radius:50%;background:#ffffff;border:2.2px solid ${borderCol};box-shadow:0 2px 6px rgba(0,0,0,0.22);display:flex;align-items:center;justify-content:center;font-size:13px;" title="${esc(pr.n)} (${esc(pr.sub)})">${meta.emoji}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -13]
    });

    const catKey = pr.c === "comedor" ? "restaurante" : pr.c;
    const catAvg = avgByCat[catKey];
    const ticketLine = catAvg
      ? `<div style="font-size:0.75rem;color:#15803d;font-weight:700;margin-top:4px;">💰 Ticket promedio del giro: ~$${catAvg.avgTicket.toLocaleString("es-MX")} (${catAvg.count} ventas)</div>`
      : "";

    const popupHtml = `
      <div style="font-family:sans-serif;min-width:225px;max-width:265px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;margin-bottom:3px;">
          <span style="font-size:0.68rem;font-weight:800;color:${meta.color};text-transform:uppercase;">${meta.emoji} ${esc(pr.sub)} • DENUE</span>
          <span style="font-size:0.68rem;font-weight:800;padding:2px 6px;border-radius:999px;background:${isHigh ? "#dcfce7" : "#f1f5f9"};color:${isHigh ? "#14532d" : "#475569"};">${isHigh ? "🔥 Potencial Alto" : "🟡 Medio"}</span>
        </div>
        <strong style="font-size:0.95rem;color:#0f172a;display:block;line-height:1.25;">${esc(pr.n)}</strong>
        <div style="font-size:0.76rem;color:#475569;margin-top:4px;">📍 ${esc(pr.dir || pr.col)} (${esc(pr.mun)})</div>
        <div style="font-size:0.75rem;color:#334155;margin-top:2px;">👥 Tamaño: <strong>${esc(pr.sz)} empleados</strong></div>
        ${
          pr.tel
            ? `<div style="font-size:0.76rem;margin-top:4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <a href="tel:${esc(pr.tel)}" style="color:#0284c7;font-weight:700;text-decoration:none;">📞 ${esc(pr.tel)}</a>
                ${
                  cleanTenDigits(pr.tel)
                    ? `<a href="https://api.whatsapp.com/send?phone=52${cleanTenDigits(pr.tel)}&text=${encodeURIComponent(
                        `Hola, buen dia. Le escribimos de Comercializadora Salinas (especialistas en aguacate en Saltillo y Ramos Arizpe) para ponernos a sus ordenes en ${pr.n}.`
                      )}" target="_blank" rel="noopener" style="color:#15803d;font-weight:800;text-decoration:none;background:#dcfce7;padding:2px 7px;border-radius:999px;">💬 WhatsApp</a>`
                    : ""
                }
              </div>`
            : ""
        }
        ${ticketLine}
        <div style="display:grid;grid-template-columns:1fr;gap:5px;margin-top:8px;">
          <button type="button" class="btn btn-primary btn-sm" style="padding:6px 8px;font-size:0.76rem;width:100%;" onclick="window.__pzAddProspectToRoute('${esc(pr.id)}')">
            🧭 + Sumar a Ruta del Chofer
          </button>
          <button type="button" class="btn btn-outline btn-sm" style="padding:5px 8px;font-size:0.74rem;width:100%;" onclick="window.__pzPromoteProspect('${esc(pr.id)}')">
            ⭐ Guardar como Cliente Oficial
          </button>
        </div>
      </div>
    `;

    return window.L.marker([pr.lat, pr.lng], { icon }).bindPopup(popupHtml);
  });

  if (typeof prospectClusterGroup.addLayers === "function") {
    prospectClusterGroup.addLayers(markers);
  } else {
    markers.forEach((m) => m.addTo(prospectClusterGroup));
  }
  if (!map.hasLayer(prospectClusterGroup)) map.addLayer(prospectClusterGroup);
  if (announce && filtered.length > 0) {
    getBridge()?.showToast?.(`🎯 Mostrando ${filtered.length.toLocaleString("es-MX")} prospectos en el mapa.`);
  }
}

// ================= CUADRANTES MANUALES Y KML =================
function parseKmlPolygons(kmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(kmlText, "text/xml");
  const placemarks = Array.from(xml.getElementsByTagName("Placemark"));
  const parsed = [];

  placemarks.forEach((pm, idx) => {
    const nameEl = pm.getElementsByTagName("name")[0];
    const name = (nameEl ? nameEl.textContent : `Cuadrante ${idx + 1}`).trim();
    const polys = Array.from(pm.getElementsByTagName("Polygon"));
    polys.forEach((polyEl, pIdx) => {
      const coordEl = polyEl.getElementsByTagName("coordinates")[0];
      if (!coordEl) return;
      const pts = coordEl.textContent
        .trim()
        .split(/\s+/)
        .map((tuple) => {
          const parts = tuple.split(",");
          const lng = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          return Number.isFinite(lat) && Number.isFinite(lng) ? [Number(lat.toFixed(6)), Number(lng.toFixed(6))] : null;
        })
        .filter(Boolean);
      if (pts.length >= 3) {
        parsed.push({
          id: `kml_${Date.now()}_${idx}_${pIdx}`,
          name: polys.length > 1 ? `${name} (${pIdx + 1})` : name,
          color: QUAD_COLORS[(quadrants.length + parsed.length) % QUAD_COLORS.length],
          polygon: pts
        });
      }
    });
  });
  return parsed;
}

function buildKmlFromQuadrants() {
  const placemarksXml = quadrants
    .map((q) => {
      const ring = [...q.polygon, q.polygon[0]];
      const coordsStr = ring.map((pt) => `${pt[1]},${pt[0]},0`).join(" ");
      return `    <Placemark>
      <name>${esc(q.name)}</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordsStr}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Cuadrantes Aguacates Salinas</name>
${placemarksXml}
  </Document>
</kml>`;
}

function renderQuadrantsUIAndLayer() {
  const map = ensureLayers();
  const listEl = document.getElementById("pzQuadrantsList");
  const panelEl = document.getElementById("pzQuadrantsPanel");
  const btn = document.getElementById("btnToggleQuadrantsLayer");
  if (panelEl) panelEl.style.display = showQuadrants ? "block" : "none";
  if (btn) {
    btn.classList.toggle("btn-primary", showQuadrants);
    btn.classList.toggle("btn-outline", !showQuadrants);
  }

  if (quadrantsLayerGroup) {
    quadrantsLayerGroup.clearLayers();
    if (showQuadrants && map) {
      quadrants.forEach((q) => {
        const poly = window.L.polygon(q.polygon, {
          color: q.color || "#15803d",
          weight: 2.2,
          fillColor: q.color || "#15803d",
          fillOpacity: 0.1
        }).addTo(quadrantsLayerGroup);
        poly.bindTooltip(`📐 ${esc(q.name)}`, { sticky: true });
      });
    }
  }

  if (!listEl) return;
  if (quadrants.length === 0) {
    listEl.innerHTML = `<div style="font-size:0.8rem;color:#64748b;padding:8px;">No hay cuadrantes cargados. Usa <strong>✏️ Dibujar Cuadrante</strong>, <strong>📂 Subir KML</strong> o <strong>⚡ Sectores Base</strong>.</div>`;
    return;
  }

  const bridge = getBridge();
  const places = (bridge?.getAllPlaces?.() || []).filter((p) => typeof p.lat === "number" && typeof p.lng === "number");

  listEl.innerHTML = quadrants
    .map((q) => {
      const inPlaces = places.filter((p) => isPointInPolygon(p.lat, p.lng, q.polygon));
      const inProspects = activeProspects.filter((pr) => isPointInPolygon(pr.lat, pr.lng, q.polygon));
      const highCount = inProspects.filter((pr) => pr.tier === "alto").length;
      return `
        <div style="border:1px solid #e2e8f0;border-left:4px solid ${esc(q.color || "#15803d")};border-radius:8px;padding:9px 10px;background:#f8fafc;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
            <strong style="font-size:0.85rem;color:#0f172a;">${esc(q.name)}</strong>
            <button type="button" class="btn btn-outline btn-sm" style="padding:2px 6px;font-size:0.7rem;color:#dc2626;border-color:#fecaca;" data-del-quad="${esc(q.id)}" title="Eliminar cuadrante">✕</button>
          </div>
          <div style="font-size:0.76rem;color:#475569;margin:4px 0 8px;">
            🏪 <strong>${inPlaces.length}</strong> clientes • 🎯 <strong>${inProspects.length}</strong> prospectos (${highCount} 🔥)
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;">
            <button type="button" class="btn btn-outline btn-sm" style="padding:4px 8px;font-size:0.72rem;" data-filter-quad="${esc(q.id)}">🔍 Aislar</button>
            <button type="button" class="btn btn-outline btn-sm" style="padding:4px 8px;font-size:0.72rem;" data-route-quad-places="${esc(q.id)}">🧭 +${inPlaces.length} Clientes</button>
            <button type="button" class="btn btn-primary btn-sm" style="padding:4px 8px;font-size:0.72rem;" data-route-quad-prospects="${esc(q.id)}">🧭 +Top 15 🔥</button>
          </div>
        </div>
      `;
    })
    .join("");
}

// ================= ANILLOS CONCÉNTRICOS =================
function renderConcentricUIAndLayer() {
  const map = ensureLayers();
  const panelEl = document.getElementById("pzConcentricPanel");
  const listEl = document.getElementById("pzConcentricList");
  const btn = document.getElementById("btnToggleConcentricLayer");
  if (panelEl) panelEl.style.display = showConcentric ? "block" : "none";
  if (btn) {
    btn.classList.toggle("btn-primary", showConcentric);
    btn.classList.toggle("btn-outline", !showConcentric);
  }

  const bridge = getBridge();
  const base = bridge?.getBaseLocation?.() || { lat: 25.4267, lng: -100.9954 };

  if (concentricLayerGroup) {
    concentricLayerGroup.clearLayers();
    if (showConcentric && map) {
      [...concentricRadiiKm].reverse().forEach((rKm, revIdx) => {
        const idx = concentricRadiiKm.length - 1 - revIdx;
        const col = QUAD_COLORS[idx % QUAD_COLORS.length];
        window.L.circle([base.lat, base.lng], {
          radius: rKm * 1000,
          color: col,
          weight: 1.8,
          dashArray: "6,4",
          fillColor: col,
          fillOpacity: 0.05
        })
          .bindTooltip(`⭕ Anillo ${idx + 1}: hasta ${rKm} km`, { sticky: true })
          .addTo(concentricLayerGroup);
      });
    }
  }

  if (!listEl) return;
  const places = (bridge?.getAllPlaces?.() || []).filter((p) => typeof p.lat === "number" && typeof p.lng === "number");

  listEl.innerHTML = concentricRadiiKm
    .map((rKm, idx) => {
      const minR = idx === 0 ? 0 : concentricRadiiKm[idx - 1];
      const col = QUAD_COLORS[idx % QUAD_COLORS.length];
      const pCount = places.filter((p) => {
        const d = haversineM(base.lat, base.lng, p.lat, p.lng) / 1000;
        return d >= minR && d <= rKm;
      }).length;
      const prCount = activeProspects.filter((pr) => {
        const d = haversineM(base.lat, base.lng, pr.lat, pr.lng) / 1000;
        return d >= minR && d <= rKm;
      }).length;
      return `
        <div style="border:1px solid #e2e8f0;border-left:4px solid ${col};border-radius:8px;padding:8px 10px;background:#f8fafc;">
          <strong style="font-size:0.83rem;color:#0f172a;">⭕ Anillo ${idx + 1} (${minR}–${rKm} km)</strong>
          <div style="font-size:0.75rem;color:#475569;margin:3px 0 6px;">🏪 ${pCount} clientes • 🎯 ${prCount} prospectos</div>
          <button type="button" class="btn btn-outline btn-sm" style="padding:3px 8px;font-size:0.72rem;" data-filter-ring="${idx}">🔍 Ver en mapa</button>
        </div>
      `;
    })
    .join("");
}

// ================= DIBUJO MANUAL DE CUADRANTE EN MAPA =================
function refreshDrawingTempLayer() {
  if (!drawTempLayerGroup || typeof window.L === "undefined") return;
  drawTempLayerGroup.clearLayers();
  drawingPoints.forEach((pt) => {
    window.L.circleMarker(pt, { radius: 5, color: "#0284c7", fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(
      drawTempLayerGroup
    );
  });
  if (drawingPoints.length >= 2) {
    window.L.polygon(drawingPoints, {
      color: "#0284c7",
      weight: 2.5,
      dashArray: "5,5",
      fillColor: "#0284c7",
      fillOpacity: 0.14
    }).addTo(drawTempLayerGroup);
  }
}

function stopDrawingQuadrant() {
  drawingActive = false;
  drawingPoints = [];
  if (drawTempLayerGroup) drawTempLayerGroup.clearLayers();
  document.getElementById("adminLiveMap")?.classList.remove("is-drawing-kml");
  const hint = document.getElementById("pzDrawHint");
  const bStart = document.getElementById("btnStartDrawQuad");
  const bFin = document.getElementById("btnFinishDrawQuad");
  const bCan = document.getElementById("btnCancelDrawQuad");
  if (hint) hint.style.display = "none";
  if (bStart) bStart.style.display = "inline-flex";
  if (bFin) bFin.style.display = "none";
  if (bCan) bCan.style.display = "none";
}

function bindMapClickForDrawing() {
  const map = ensureLayers();
  if (!map || map.__pzClickBound) return;
  map.__pzClickBound = true;
  map.on("click", (ev) => {
    if (!drawingActive) return;
    drawingPoints.push([Number(ev.latlng.lat.toFixed(6)), Number(ev.latlng.lng.toFixed(6))]);
    refreshDrawingTempLayer();
  });
}

// ================= GLOBAL ACTIONS FOR POPUPS =================
window.__pzAddProspectToRoute = function (prospectId) {
  const pr = activeProspects.find((x) => x.id === prospectId);
  const bridge = getBridge();
  if (!pr || !bridge?.addStopToRoute) return;
  const meta = CAT_META[pr.c] || CAT_META.tienda;
  bridge.addStopToRoute({
    id: `denue_${pr.id}`,
    kind: "place",
    name: `${meta.emoji} ${pr.n}`,
    phone: pr.tel || "",
    category: pr.c === "comedor" ? "restaurante" : pr.c,
    address: pr.dir || pr.col || "",
    subtitle: `Prospecto ${pr.sub} (${pr.sz} emp.) • ${pr.col || pr.mun}`,
    lat: pr.lat,
    lng: pr.lng,
    boxes: 0,
    status: "pending",
    pinEmoji: meta.emoji,
    actionLabel: "➕ Prospectar / Vender",
    arrivalActionLabel: "➕ Visitar Prospecto"
  });
  bridge.showToast?.(`🧭 "${pr.n}" agregado al Constructor de Rutas.`);
};

window.__pzPromoteProspect = async function (prospectId) {
  const pr = activeProspects.find((x) => x.id === prospectId);
  const bridge = getBridge();
  if (!pr || !bridge?.promoteProspectToPlace) return;
  await bridge.promoteProspectToPlace(pr);
  recomputeDeduplicatedProspects();
};

// ================= EVENT LISTENERS =================
function initProspectsZonesModule() {
  loadLocalZonesState();
  fetchProspectsJson();

  window.addEventListener("salinas:places-updated", () => recomputeDeduplicatedProspects());
  window.addEventListener("salinas:map-ready", async () => {
    bindMapClickForDrawing();
    const bridge = getBridge();
    if (quadrants.length === 0 && bridge?.loadZonesConfig) {
      const remote = await bridge.loadZonesConfig();
      if (remote && Array.isArray(remote.quadrants) && remote.quadrants.length) {
        quadrants = remote.quadrants;
        if (Array.isArray(remote.concentricRadiiKm) && remote.concentricRadiiKm.length) {
          concentricRadiiKm = remote.concentricRadiiKm;
        }
        updateZoneFilterDropdown();
      }
    }
    renderProspectsCluster();
    renderQuadrantsUIAndLayer();
    renderConcentricUIAndLayer();
  });

  document.getElementById("btnToggleProspectsLayer")?.addEventListener("click", () => {
    showProspects = !showProspects;
    renderProspectsCluster(showProspects);
  });

  document.getElementById("btnExportProspectsCsv")?.addEventListener("click", () => {
    const rows = getFilteredProspects();
    if (!rows.length) {
      getBridge()?.showToast?.("No hay prospectos con el filtro actual para exportar.");
      return;
    }
    const tierVal = document.getElementById("pzFilterTier")?.value || "todos";
    const sheetData = rows.map((r) => {
      const t10 = cleanTenDigits(r.tel);
      return {
        Nombre: r.n,
        Giro: r.sub,
        Empleados: r.sz,
        Potencial: r.tier === "alto" ? "Alto" : "Medio",
        Municipio: r.mun,
        Colonia: r.col,
        Direccion: r.dir,
        Telefono: r.tel || "",
        WhatsApp: t10 ? `https://wa.me/52${t10}` : "",
        Google_Maps: `https://www.google.com/maps?q=${r.lat},${r.lng}`
      };
    });

    if (typeof window.XLSX !== "undefined") {
      const ws = window.XLSX.utils.json_to_sheet(sheetData);
      ws["!cols"] = [
        { wch: 32 },
        { wch: 18 },
        { wch: 12 },
        { wch: 10 },
        { wch: 14 },
        { wch: 24 },
        { wch: 36 },
        { wch: 14 },
        { wch: 28 },
        { wch: 42 }
      ];
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, "Prospectos Salinas");
      window.XLSX.writeFile(wb, `prospectos-salinas-${tierVal}-${rows.length}.xlsx`);
      getBridge()?.showToast?.(`📊 Exportados ${rows.length} negocios en Excel (.xlsx).`);
      return;
    }

    const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = Object.keys(sheetData[0]).join(",");
    const lines = sheetData.map((obj) => Object.values(obj).map(csvEsc).join(","));
    const blob = new Blob([`\uFEFF${[header, ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prospectos-salinas-${tierVal}-${rows.length}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("btnToggleQuadrantsLayer")?.addEventListener("click", () => {
    showQuadrants = !showQuadrants;
    renderQuadrantsUIAndLayer();
  });

  document.getElementById("btnToggleConcentricLayer")?.addEventListener("click", () => {
    showConcentric = !showConcentric;
    renderConcentricUIAndLayer();
  });

  ["pzFilterCat", "pzFilterMun", "pzFilterTier", "pzFilterZone"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      if (!showProspects) showProspects = true;
      renderProspectsCluster();
    });
  });

  document.getElementById("btnStartDrawQuad")?.addEventListener("click", () => {
    bindMapClickForDrawing();
    const map = ensureLayers();
    map?.closePopup?.();
    document.getElementById("adminLiveMap")?.classList.add("is-drawing-kml");
    drawingActive = true;
    drawingPoints = [];
    document.getElementById("pzDrawHint").style.display = "block";
    document.getElementById("btnStartDrawQuad").style.display = "none";
    document.getElementById("btnFinishDrawQuad").style.display = "inline-flex";
    document.getElementById("btnCancelDrawQuad").style.display = "inline-flex";
    getBridge()?.showToast?.("Haz clic en el mapa para marcar las esquinas del cuadrante.");
  });

  document.getElementById("btnCancelDrawQuad")?.addEventListener("click", () => stopDrawingQuadrant());

  document.getElementById("btnFinishDrawQuad")?.addEventListener("click", async () => {
    if (drawingPoints.length < 3) {
      getBridge()?.showToast?.("Marca al menos 3 esquinas en el mapa para cerrar el cuadrante.");
      return;
    }
    const name = window.prompt("Nombre del cuadrante (ej. Saltillo 2000, Valencia, Ramos Centro):", `Cuadrante ${quadrants.length + 1}`);
    if (!name || !name.trim()) return;
    quadrants.push({
      id: `quad_${Date.now()}`,
      name: name.trim(),
      color: QUAD_COLORS[quadrants.length % QUAD_COLORS.length],
      polygon: [...drawingPoints]
    });
    stopDrawingQuadrant();
    await persistZonesState();
    updateZoneFilterDropdown();
    renderQuadrantsUIAndLayer();
    getBridge()?.showToast?.(`📐 Cuadrante "${name.trim()}" guardado.`);
  });

  document.getElementById("inpImportKml")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const imported = parseKmlPolygons(text);
    e.target.value = "";
    if (!imported.length) {
      getBridge()?.showToast?.("No se encontraron polígonos válidos en ese archivo KML.");
      return;
    }
    quadrants.push(...imported);
    showQuadrants = true;
    await persistZonesState();
    updateZoneFilterDropdown();
    renderQuadrantsUIAndLayer();
    getBridge()?.showToast?.(`📂 ${imported.length} cuadrante(s) importados desde KML.`);
  });

  document.getElementById("btnExportKml")?.addEventListener("click", () => {
    if (!quadrants.length) {
      getBridge()?.showToast?.("Primero crea o carga al menos un cuadrante.");
      return;
    }
    const kml = buildKmlFromQuadrants();
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cuadrantes-aguacates-salinas.kml";
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("btnLoadPresetQuads")?.addEventListener("click", async () => {
    const existingIds = new Set(quadrants.map((q) => q.id));
    PRESET_SALTILLO_QUADS.forEach((pq) => {
      if (!existingIds.has(pq.id)) quadrants.push(structuredClone(pq));
    });
    showQuadrants = true;
    await persistZonesState();
    updateZoneFilterDropdown();
    renderQuadrantsUIAndLayer();
    getBridge()?.showToast?.("⚡ 6 sectores base de Saltillo y Ramos Arizpe cargados.");
  });

  document.getElementById("pzQuadrantsList")?.addEventListener("click", async (e) => {
    const bridge = getBridge();
    const delBtn = e.target.closest("button[data-del-quad]");
    if (delBtn) {
      const id = delBtn.dataset.delQuad;
      quadrants = quadrants.filter((q) => q.id !== id);
      await persistZonesState();
      updateZoneFilterDropdown();
      renderQuadrantsUIAndLayer();
      return;
    }

    const filterBtn = e.target.closest("button[data-filter-quad]");
    if (filterBtn) {
      const q = quadrants.find((x) => x.id === filterBtn.dataset.filterQuad);
      if (!q) return;
      const sel = document.getElementById("pzFilterZone");
      if (sel) sel.value = `quad:${q.id}`;
      showProspects = true;
      renderProspectsCluster();
      const map = bridge?.getMap?.();
      if (map) map.fitBounds(q.polygon, { padding: [24, 24] });
      return;
    }

    const addPlacesBtn = e.target.closest("button[data-route-quad-places]");
    if (addPlacesBtn) {
      const q = quadrants.find((x) => x.id === addPlacesBtn.dataset.routeQuadPlaces);
      if (!q || !bridge) return;
      const inPlaces = bridge
        .getAllPlaces()
        .filter((p) => typeof p.lat === "number" && typeof p.lng === "number" && isPointInPolygon(p.lat, p.lng, q.polygon));
      for (const p of inPlaces.slice(0, 25)) {
        window.__salinasAddPlaceToRoute?.(p.id);
      }
      bridge.showToast?.(`🧭 ${Math.min(inPlaces.length, 25)} cliente(s) de "${q.name}" enviados al Constructor de Rutas.`);
      return;
    }

    const addProsBtn = e.target.closest("button[data-route-quad-prospects]");
    if (addProsBtn) {
      const q = quadrants.find((x) => x.id === addProsBtn.dataset.routeQuadProspects);
      if (!q || !bridge) return;
      const cat = document.getElementById("pzFilterCat")?.value || "all";
      const candidates = activeProspects
        .filter((pr) => (cat === "all" || pr.c === cat) && isPointInPolygon(pr.lat, pr.lng, q.polygon))
        .sort((a, b) => (a.tier === "alto" ? -1 : 1) - (b.tier === "alto" ? -1 : 1))
        .slice(0, 15);
      for (const pr of candidates) {
        window.__pzAddProspectToRoute(pr.id);
      }
      bridge.showToast?.(`🧭 ${candidates.length} prospecto(s) de "${q.name}" cargados al Constructor de Rutas.`);
    }
  });

  document.getElementById("btnApplyConcentricRadii")?.addEventListener("click", async () => {
    const raw = document.getElementById("inpConcentricRadii")?.value || "";
    const nums = raw
      .split(",")
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    if (!nums.length) return;
    concentricRadiiKm = nums;
    await persistZonesState();
    updateZoneFilterDropdown();
    renderConcentricUIAndLayer();
  });

  document.getElementById("pzConcentricList")?.addEventListener("click", (e) => {
    const ringBtn = e.target.closest("button[data-filter-ring]");
    if (!ringBtn) return;
    const idx = Number(ringBtn.dataset.filterRing);
    const sel = document.getElementById("pzFilterZone");
    if (sel) sel.value = `ring:${idx}`;
    showProspects = true;
    renderProspectsCluster();
  });

  document.getElementById("btnToggleAutoPacksPanel")?.addEventListener("click", () => {
    showAutoPacks = !showAutoPacks;
    const p = document.getElementById("pzAutoPacksPanel");
    const b = document.getElementById("btnToggleAutoPacksPanel");
    if (p) p.style.display = showAutoPacks ? "block" : "none";
    if (b) {
      b.classList.toggle("btn-primary", showAutoPacks);
      b.classList.toggle("btn-outline", !showAutoPacks);
    }
  });

  document.getElementById("btnGenerateAutoPacks")?.addEventListener("click", () => {
    buildAndRenderAutoPacks(true);
  });

  ["apProfileSelect", "apMunSelect", "apTargetSize"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => buildAndRenderAutoPacks(false));
  });

  document.getElementById("btnClearPackPreview")?.addEventListener("click", () => {
    clearAutoPackMapPreview();
  });

  function populateApDriversSelect() {
    const sel = document.getElementById("apDriverSelect");
    const bridge = getBridge();
    if (!sel || !bridge?.getDriversList) return;
    const prev = sel.value || "";
    const drivers = bridge.getDriversList();
    sel.innerHTML =
      `<option value="">— Elegir chofer —</option>` +
      drivers.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("");
    if (prev && drivers.includes(prev)) {
      sel.value = prev;
    }
  }

  document.getElementById("apDriverSelect")?.addEventListener("change", (e) => {
    const chosen = e.target.value;
    if (chosen) {
      getBridge()?.selectDriverForBuilder?.(chosen);
    }
  });

  window.addEventListener("salinas:routes-updated", () => {
    populateApDriversSelect();
    const draft = getBridge()?.getDraftStops?.() || [];
    if (draft.length === 0 && previewPackId) {
      clearAutoPackMapPreview();
    } else {
      renderAutoPacksCards();
    }
  });
  setTimeout(populateApDriversSelect, 600);

  document.getElementById("pzAutoPacksList")?.addEventListener("click", (e) => {
    const viewBtn = e.target.closest("button[data-preview-pack]");
    if (viewBtn) {
      previewAutoPackOnMap(viewBtn.dataset.previewPack);
      return;
    }

    const loadBtn = e.target.closest("button[data-load-pack]");
    if (loadBtn) {
      const pack = generatedPacks.find((p) => p.id === loadBtn.dataset.loadPack);
      const bridge = getBridge();
      if (!pack || !bridge) return;

      const drvSel = document.getElementById("apDriverSelect");
      const chosenDriver = drvSel?.value || "";
      if (!chosenDriver) {
        bridge.showToast?.("👆 Primero selecciona a qué chofer se lo vas a asignar en 'Chofer a asignar'.");
        drvSel?.focus();
        return;
      }

      bridge.selectDriverForBuilder?.(chosenDriver);

      setTimeout(() => {
        const stopObjs = pack.stops.map((pr, idx) => {
          const meta = CAT_META[pr.c] || CAT_META.tienda;
          return {
            id: `denue_${pr.id}`,
            kind: "place",
            name: `${meta.emoji} ${pr.n}`,
            phone: pr.tel || "",
            category: pr.c === "comedor" ? "restaurante" : pr.c,
            address: pr.dir || pr.col || "",
            subtitle: `Parada #${idx + 1} (${pack.title}) • ${pr.sub} (${pr.sz} emp.)`,
            lat: pr.lat,
            lng: pr.lng,
            boxes: 0,
            status: "pending",
            pinEmoji: meta.emoji,
            actionLabel: "➕ Prospectar / Vender",
            arrivalActionLabel: "➕ Visitar Prospecto"
          };
        });
        const added = bridge.addStopsBulkToRoute
          ? bridge.addStopsBulkToRoute(stopObjs, true)
          : stopObjs.reduce((acc, st) => {
              bridge.addStopToRoute(st);
              return acc + 1;
            }, 0);

        previewAutoPackOnMap(pack.id);
        renderAutoPacksCards();
        document.getElementById("adminRouteBuilderDetails")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        bridge.showToast?.(
          `📝 "${pack.title}" (${added} paradas) en borrador para ${chosenDriver}. Presiona "📤 Enviar Ruta al Chofer" abajo para confirmar.`
        );
      }, 180);
    }
  });
}

// ================= PROPUESTA 2: CLUSTERING AUTOMÁTICO DE PAQUETES (25-30 PARADAS) =================
function getCandidatesForAutoPacks() {
  const profile = document.getElementById("apProfileSelect")?.value || "anaquel";
  const mun = document.getElementById("apMunSelect")?.value || "all";

  if (profile === "actual") {
    return getFilteredProspects().filter((p) => mun === "all" || p.mun === mun);
  }

  return activeProspects.filter((pr) => {
    if (mun !== "all" && pr.mun !== mun) return false;
    if (profile === "anaquel") return pr.c === "fruteria" || pr.c === "carniceria" || pr.c === "tienda";
    if (profile === "cocina") return pr.c === "restaurante";
    if (profile === "ejecutiva") return pr.c === "comedor" || is31Plus(pr.sz);
    return pr.c === profile;
  });
}

function orderStopsNearestNeighbor2Opt(points, startLat, startLng) {
  if (points.length <= 2) return [...points];
  const remaining = [...points];
  const ordered = [];
  let currLat = startLat;
  let currLng = startLng;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineM(currLat, currLng, remaining[i].lat, remaining[i].lng);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    currLat = next.lat;
    currLng = next.lng;
  }

  // Ligero refinamiento 2-opt local para quitar cruces internos
  for (let pass = 0; pass < 2; pass++) {
    let improved = false;
    for (let i = 0; i < ordered.length - 2; i++) {
      for (let k = i + 2; k < ordered.length - 1; k++) {
        const a = ordered[i];
        const b = ordered[i + 1];
        const c = ordered[k];
        const d = ordered[k + 1];
        const currDist = haversineM(a.lat, a.lng, b.lat, b.lng) + haversineM(c.lat, c.lng, d.lat, d.lng);
        const swappedDist = haversineM(a.lat, a.lng, c.lat, c.lng) + haversineM(b.lat, b.lng, d.lat, d.lng);
        if (swappedDist + 15 < currDist) {
          const rev = ordered.slice(i + 1, k + 1).reverse();
          ordered.splice(i + 1, k - i, ...rev);
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return ordered;
}

function buildAndRenderAutoPacks(announce = false) {
  const candidates = getCandidatesForAutoPacks();
  const targetSize = Math.max(10, Math.min(40, parseInt(document.getElementById("apTargetSize")?.value || "28", 10) || 28));
  const profile = document.getElementById("apProfileSelect")?.value || "anaquel";
  const mun = document.getElementById("apMunSelect")?.value || "all";

  if (!candidates.length) {
    generatedPacks = [];
    renderAutoPacksCards();
    return;
  }

  const bridge = getBridge();
  const base = bridge?.getBaseLocation?.() || { lat: 25.4267, lng: -100.9954 };

  // Agrupar primero por municipio para no mezclar ciudades lejanas en un mismo paquete
  const byMun = new Map();
  for (const c of candidates) {
    if (!byMun.has(c.mun)) byMun.set(c.mun, []);
    byMun.get(c.mun).push(c);
  }

  const rawClusters = [];
  for (const [, poolOrig] of byMun.entries()) {
    const pool = [...poolOrig];
    while (pool.length > 0) {
      if (pool.length <= Math.round(targetSize * 1.22)) {
        rawClusters.push(pool.splice(0, pool.length));
        break;
      }
      // Elegir semilla periférica (más alejada del centroide restante) para formar racimos compactos sin huérfanos
      let sumLat = 0;
      let sumLng = 0;
      for (const p of pool) {
        sumLat += p.lat;
        sumLng += p.lng;
      }
      const cLat = sumLat / pool.length;
      const cLng = sumLng / pool.length;

      let seedIdx = 0;
      let maxD = -1;
      for (let i = 0; i < pool.length; i++) {
        const d = haversineM(cLat, cLng, pool[i].lat, pool[i].lng);
        if (d > maxD) {
          maxD = d;
          seedIdx = i;
        }
      }
      const seed = pool[seedIdx];
      const withDist = pool.map((item, idx) => ({
        item,
        idx,
        d: haversineM(seed.lat, seed.lng, item.lat, item.lng)
      }));
      withDist.sort((a, b) => a.d - b.d);
      const chosen = withDist.slice(0, targetSize);
      const chosenIndices = new Set(chosen.map((x) => x.idx));
      const clusterItems = chosen.map((x) => x.item);
      const nextPool = pool.filter((_, idx) => !chosenIndices.has(idx));
      pool.length = 0;
      pool.push(...nextPool);
      rawClusters.push(clusterItems);
    }
  }

  // Ordenar los paquetes por cercanía desde la bodega
  const packsWithMeta = rawClusters.map((items) => {
    const orderedStops = orderStopsNearestNeighbor2Opt(items, base.lat, base.lng);
    let internalM = 0;
    for (let i = 1; i < orderedStops.length; i++) {
      internalM += haversineM(orderedStops[i - 1].lat, orderedStops[i - 1].lng, orderedStops[i].lat, orderedStops[i].lng);
    }
    const internalKm = ((internalM * 1.28) / 1000).toFixed(1);
    const avgLat = orderedStops.reduce((s, p) => s + p.lat, 0) / orderedStops.length;
    const avgLng = orderedStops.reduce((s, p) => s + p.lng, 0) / orderedStops.length;
    const distFromBaseKm = (haversineM(base.lat, base.lng, avgLat, avgLng) / 1000).toFixed(1);

    // Top 2 colonias dominantes para bautizar el paquete de forma legible
    const colCounts = new Map();
    const catCounts = {};
    for (const p of orderedStops) {
      const col = (p.col || "").trim();
      if (col && col.toUpperCase() !== "NINGUNO") {
        colCounts.set(col, (colCounts.get(col) || 0) + 1);
      }
      catCounts[p.c] = (catCounts[p.c] || 0) + 1;
    }
    const topCols = [...colCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map((e) => e[0]);
    const zoneLabel = topCols.length ? topCols.join(" / ") : orderedStops[0]?.mun || "Sector";
    const munName = orderedStops[0]?.mun || "Región";
    const sigKey = `${profile}_${mun}_${orderedStops[0]?.id}_${orderedStops.length}`;

    return {
      sigKey,
      munName,
      zoneLabel,
      stops: orderedStops,
      internalKm,
      distFromBaseKm: Number(distFromBaseKm),
      catCounts
    };
  });

  packsWithMeta.sort((a, b) => a.distFromBaseKm - b.distFromBaseKm);

  generatedPacks = packsWithMeta.map((pk, idx) => ({
    id: pk.sigKey,
    num: idx + 1,
    color: QUAD_COLORS[idx % QUAD_COLORS.length],
    title: `Ruta #${idx + 1} • ${pk.zoneLabel}`,
    munName: pk.munName,
    stops: pk.stops,
    internalKm: pk.internalKm,
    distFromBaseKm: pk.distFromBaseKm,
    catCounts: pk.catCounts
  }));

  renderAutoPacksCards();
  if (announce) {
    getBridge()?.showToast?.(`⚡ ${generatedPacks.length} paquetes armados (${candidates.length} negocios).`);
  }
}

function getPackLiveStatus(pk) {
  const bridge = getBridge();
  if (!bridge) return { state: "idle" };
  const packStopIds = new Set(pk.stops.map((s) => `denue_${s.id}`));
  const minOverlap = Math.min(3, pk.stops.length);

  // 1. Verificar rutas realmente enviadas hoy en Firestore
  const sentRoutes = bridge.getSentRoutesToday?.() || [];
  for (const rDoc of sentRoutes) {
    const overlap = (rDoc.stops || []).filter((st) => packStopIds.has(st.id)).length;
    if (overlap >= minOverlap) {
      return { state: "sent", driver: rDoc.driverName || "Chofer" };
    }
  }

  // 2. Verificar borrador actual en el Constructor
  const draftStops = bridge.getDraftStops?.() || [];
  const draftOverlap = draftStops.filter((st) => packStopIds.has(st.id)).length;
  if (draftOverlap >= minOverlap) {
    return { state: "draft", driver: bridge.getSelectedDriver?.() || "Chofer" };
  }

  return { state: "idle" };
}

function renderAutoPacksCards() {
  const listEl = document.getElementById("pzAutoPacksList");
  const pillEl = document.getElementById("apProgressPill");
  if (!listEl) return;

  const statuses = generatedPacks.map((pk) => getPackLiveStatus(pk));
  const sentCount = statuses.filter((s) => s.state === "sent").length;
  if (pillEl) {
    pillEl.textContent = `${generatedPacks.length} paquetes • ${sentCount} enviados hoy`;
  }

  if (!generatedPacks.length) {
    listEl.innerHTML = `<div style="font-size:0.8rem;color:#64748b;padding:8px;">Cargando prospectos para armar paquetes...</div>`;
    return;
  }

  listEl.innerHTML = generatedPacks
    .map((pk, idx) => {
      const st = statuses[idx];
      const isSent = st.state === "sent";
      const isDraft = st.state === "draft";
      const isPreview = previewPackId === pk.id;
      const mixBadges = Object.entries(pk.catCounts)
        .map(([c, n]) => `${CAT_META[c]?.emoji || "•"}${n}`)
        .join("  ");

      let badgeHtml = `<span style="font-size:0.7rem;font-weight:800;background:#f1f5f9;color:#334155;padding:2px 7px;border-radius:999px;">${pk.stops.length} paradas</span>`;
      if (isSent) {
        badgeHtml = `<span style="font-size:0.7rem;font-weight:800;background:#dcfce7;color:#15803d;padding:2px 7px;border-radius:999px;">✅ Enviada: ${esc(st.driver)}</span>`;
      } else if (isDraft) {
        badgeHtml = `<span style="font-size:0.7rem;font-weight:800;background:#dbeafe;color:#1d4ed8;padding:2px 7px;border-radius:999px;">📝 Borrador: ${esc(st.driver)}</span>`;
      }

      const cardBg = isSent ? "#f0fdf4" : isDraft ? "#eff6ff" : "#ffffff";

      return `
        <div style="border:${isPreview ? `2px solid ${pk.color}` : "1px solid #e2e8f0"};border-left:5px solid ${pk.color};border-radius:9px;padding:9px 10px;background:${cardBg};display:flex;flex-direction:column;justify-content:space-between;gap:6px;">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
              <span style="font-size:0.7rem;font-weight:800;color:${pk.color};text-transform:uppercase;">${esc(pk.munName)} • a ${pk.distFromBaseKm} km</span>
              ${badgeHtml}
            </div>
            <strong style="font-size:0.86rem;color:#0f172a;display:block;margin-top:2px;line-height:1.25;">${esc(pk.title)}</strong>
            <div style="font-size:0.74rem;color:#475569;margin-top:3px;">
              ${mixBadges} &nbsp;•&nbsp; Tramo interno: <strong>~${pk.internalKm} km</strong>
            </div>
          </div>
          <div style="display:flex;gap:6px;margin-top:2px;">
            <button type="button" class="btn btn-outline btn-sm" style="padding:5px 8px;font-size:0.74rem;flex:1;" data-preview-pack="${esc(pk.id)}">
              👁️ Mapa
            </button>
            <button type="button" class="btn btn-primary btn-sm" style="padding:5px 9px;font-size:0.74rem;flex:1.6;background:#0f766e;border-color:#0f766e;" data-load-pack="${esc(pk.id)}">
              🧭 Pasar a Ruta
            </button>
          </div>
        </div>
      `;
    })
    .join("");
}

function clearAutoPackMapPreview() {
  previewPackId = null;
  if (autoPackPreviewLayer) autoPackPreviewLayer.clearLayers();
  const clearBtn = document.getElementById("btnClearPackPreview");
  if (clearBtn) clearBtn.style.display = "none";
  renderAutoPacksCards();
}

function previewAutoPackOnMap(packId) {
  const pack = generatedPacks.find((p) => p.id === packId);
  const map = ensureLayers();
  if (!pack || !map || !autoPackPreviewLayer) return;

  previewPackId = pack.id;
  autoPackPreviewLayer.clearLayers();

  const latlngs = pack.stops.map((s) => [s.lat, s.lng]);
  if (latlngs.length >= 2) {
    window.L.polyline(latlngs, {
      color: pack.color,
      weight: 3.5,
      opacity: 0.78,
      dashArray: "6,5"
    }).addTo(autoPackPreviewLayer);
  }

  pack.stops.forEach((pr, idx) => {
    const meta = CAT_META[pr.c] || CAT_META.tienda;
    const numIcon = window.L.divIcon({
      className: "salinas-div-icon",
      html: `<div style="width:24px;height:24px;border-radius:50%;background:${pack.color};color:#fff;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;">${idx + 1}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -12]
    });

    const popupHtml = `
      <div style="font-family:sans-serif;min-width:210px;">
        <div style="font-size:0.7rem;font-weight:800;color:${pack.color};">PARADA #${idx + 1} DE ${pack.stops.length} • ${esc(pack.title)}</div>
        <strong style="font-size:0.92rem;color:#0f172a;">${meta.emoji} ${esc(pr.n)}</strong>
        <div style="font-size:0.75rem;color:#475569;margin-top:3px;">📍 ${esc(pr.dir || pr.col)} (${esc(pr.mun)})</div>
        <div style="font-size:0.74rem;color:#334155;margin-top:2px;">👥 ${esc(pr.sz)} empleados</div>
      </div>
    `;
    window.L.marker([pr.lat, pr.lng], { icon: numIcon, zIndexOffset: 750 })
      .bindPopup(popupHtml)
      .addTo(autoPackPreviewLayer);
  });

  if (latlngs.length > 0) {
    map.fitBounds(latlngs, { padding: [34, 34], maxZoom: 15 });
  }

  const clearBtn = document.getElementById("btnClearPackPreview");
  if (clearBtn) clearBtn.style.display = "inline-flex";
  renderAutoPacksCards();
}

initProspectsZonesModule();
