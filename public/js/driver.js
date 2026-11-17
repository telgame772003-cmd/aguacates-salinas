import {
  app,
  db,
  firebaseConfig,
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  DEFAULT_STORE_SETTINGS,
  PLACE_CATEGORIES,
  FCM_VAPID_KEY,
  haversineMeters,
  parseCoordsFromInput,
  computeDriverPinHash,
  executeDriverBatch,
  getLocalDateStr,
  matchesSmartSearch,
  formatCurrency,
  cleanPhoneForWhatsApp
} from "./firebase-config.js?v=nav3d_9";
import {
  isNativeCapacitorApp,
  startNativeBackgroundGps,
  stopNativeBackgroundGps,
  commitDriverDocNativeRest,
  commitDriverLocationNativeRest
} from "./native-bg-gps.js?v=nav3d_9";
import {
  optimizeStopsWithOsrm,
  computeOrderedRouteMetrics,
  attachTouchDragSort,
  formatRouteKm,
  formatRouteMin
} from "./route-optimizer.js?v=nav3d_9";
import { STAFF_MANUALS } from "./manuals-data.js";

const DRIVER_SESSION_KEY = "salinas_driver_session_v1";
const RECENT_CLIENTS_KEY = "salinas_driver_clients_v1";

// Integración SaaS B2B: Ruta Pro Nav Embed 3D (alojado 100% en Hosting de Ruta Pro)
const RP_NAV_EMBED_ORIGIN = "https://ruta-pro-companion.web.app";
const RP_NAV_EMBED_LICENSE_KEY = "rp_live_salinas_2026_9f4a8c2e";
const RP_NAV_EMBED_URL = `${RP_NAV_EMBED_ORIGIN}/nav-embed.html?key=${encodeURIComponent(RP_NAV_EMBED_LICENSE_KEY)}&v=1.1.0`;

// Perfil White-Label exclusivo de Comercializadora Aguacates Salinas (no afecta a Ruta Pro ni a otros clientes)
const SALINAS_NAV3D_UI_CONFIG = {
  branding: {
    badgeText: "Ruta Salinas 3D",
    showBrandBadge: true,
    accentColor: "#10b981",
    accentDarkColor: "#047857",
    routeLineColor: "#10b981",
    puckColor: "#10b981"
  },
  labels: {
    primaryAction: "✅ Entregar / Cobrar",
    arrivalAction: "✅ Cobrar Aquí",
    arrivalTitle: "📍 ¡Ya llegaste con el cliente!",
    arrivalSubtitle: "Listo para entregar aguacate",
    closeBtn: "✕ Salir",
    defaultPinEmoji: "🥑",
    speedUnit: "km/h"
  },
  cockpit: {
    showSpeedOnPuck: true,
    showBottomSpeedometer: true,
    showPrimaryActionBtn: true,
    showVoiceBtn: true,
    showThemeBtn: true,
    showCameraModeBtn: true,
    arrivalRadiusMeters: 45
  }
};

let storeSettings = structuredClone(DEFAULT_STORE_SETTINGS);
let currentDriverName = null;
let currentDriverKeyHash = null;

// Live operational state
let todayStr = getLocalDateStr();
let whTripsToday = [];
let assignedOrders = [];
let allSalesToday = [];
let mySalesToday = [];
let allPlaces = [];
let visitsToday = [];
let placeSearchQuery = "";

// Street sale form state
let saleQtys = { S: 0, E: 0, P: 0, M: 0 };
let salePrices = { S: 400, E: 360, P: 320, M: 250 };
let salePayMethod = "Efectivo";

// Listeners & GPS state
let whUnsub = null;
let ordersUnsub = null;
let salesUnsub = null;
let placesUnsub = null;
let visitsUnsub = null;
let gpsWatchId = null;
let gpsWatchdogIntervalId = null;
let gpsActive = false;
let lastGpsSentAt = 0;
let lastGpsCoords = null;
let myTrailToday = [];
let wakeLockSentinel = null;

// Temporary GPS coords for New Place Modal
let pendingNewPlaceCoords = null;

// Ruta Pro Nav Embed 3D state
let isNav3DOpen = false;
let pendingNav3DPayload = null;
const geocodedOrderCoordsCache = new Map();

// Geocerca automática por tienda (entrada <= 55m, salida > 75m, permanencia mínima 60s)
const GEOFENCE_ENTER_METERS = 55;
const GEOFENCE_EXIT_METERS = 75;
const GEOFENCE_MIN_DWELL_MS = 60 * 1000;
const activeGeofenceDwells = new Map();

// DOM Elements
const driverLoginView = document.getElementById("driverLoginView");
const driverAppMain = document.getElementById("driverAppMain");
const driverBottomNav = document.getElementById("driverBottomNav");
const topDriverName = document.getElementById("topDriverName");
const loginDriverSelect = document.getElementById("loginDriverSelect");
const loginDriverPin = document.getElementById("loginDriverPin");
const btnDriverLogin = document.getElementById("btnDriverLogin");
const btnToggleGps = document.getElementById("btnToggleGps");
const gpsDot = document.getElementById("gpsDot");
const gpsLabel = document.getElementById("gpsLabel");
const toastBox = document.getElementById("toastBox");

function showToast(msg) {
  toastBox.textContent = msg;
  toastBox.classList.add("show");
  setTimeout(() => toastBox.classList.remove("show"), 3200);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function driverSlug(name) {
  return String(name || "chofer")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "chofer";
}

function normalizePhone10(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function mergeCalibers(remoteCalibers = {}) {
  const out = {};
  for (const code of ["S", "E", "P", "M"]) {
    out[code] = {
      ...DEFAULT_STORE_SETTINGS.calibers[code],
      ...(remoteCalibers[code] || {})
    };
    if (!out[code].minPrice) {
      out[code].minPrice = DEFAULT_STORE_SETTINGS.calibers[code].minPrice;
    }
  }
  return out;
}

function switchToDriverPane(paneId) {
  document.querySelectorAll(".drv-nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.pane === paneId);
  });
  document.querySelectorAll(".drv-pane").forEach((p) => {
    p.style.display = p.id === paneId ? "block" : "none";
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ================= STORE SETTINGS & LOGIN SELECT =================
onSnapshot(
  doc(db, "settings", "store"),
  (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      storeSettings = {
        ...DEFAULT_STORE_SETTINGS,
        ...data,
        calibers: mergeCalibers(data.calibers || {}),
        drivers: Array.isArray(data.drivers) && data.drivers.length > 0
          ? data.drivers
          : DEFAULT_STORE_SETTINGS.drivers
      };
    } else {
      storeSettings.calibers = mergeCalibers({});
    }
    populateLoginDrivers();
    syncDefaultSalePrices();
    renderStreetSaleCalibers();
  },
  (err) => {
    console.warn("Aviso cargando configuración:", err);
    populateLoginDrivers();
    syncDefaultSalePrices();
    renderStreetSaleCalibers();
  }
);

function populateLoginDrivers() {
  const drivers = storeSettings.drivers || [];
  const prev = loginDriverSelect.value;
  loginDriverSelect.innerHTML = drivers
    .map((d) => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`)
    .join("");

  const urlDriver = new URLSearchParams(window.location.search).get("chofer");
  if (urlDriver && drivers.some((d) => d.name.toLowerCase() === urlDriver.toLowerCase())) {
    const match = drivers.find((d) => d.name.toLowerCase() === urlDriver.toLowerCase());
    loginDriverSelect.value = match.name;
  } else if (prev && drivers.some((d) => d.name === prev)) {
    loginDriverSelect.value = prev;
  }
}

function syncDefaultSalePrices() {
  for (const code of ["S", "E", "P", "M"]) {
    const cal = storeSettings.calibers[code];
    if (cal && saleQtys[code] === 0) {
      salePrices[code] = Number(cal.price) || DEFAULT_STORE_SETTINGS.calibers[code].price;
    }
  }
}

// ================= SESSION RESTORE & AUTH =================
async function restoreDriverSession() {
  try {
    const raw = localStorage.getItem(DRIVER_SESSION_KEY) || sessionStorage.getItem(DRIVER_SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed?.driverName || !parsed?.keyHash) return;

    const keySnap = await getDoc(doc(db, "driver_keys", parsed.keyHash));
    if (keySnap.exists() && keySnap.data().active === true) {
      currentDriverName = parsed.driverName;
      currentDriverKeyHash = parsed.keyHash;
      enterDriverApp();
    } else {
      localStorage.removeItem(DRIVER_SESSION_KEY);
      sessionStorage.removeItem(DRIVER_SESSION_KEY);
    }
  } catch (err) {
    console.warn("No se pudo restaurar sesión de chofer:", err);
  }
}

document.getElementById("driverLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const selectedName = loginDriverSelect.value;
  const pin = loginDriverPin.value.trim();

  if (!selectedName) {
    showToast("Selecciona tu nombre.");
    return;
  }
  if (!pin || pin.length < 4) {
    showToast("Ingresa tu PIN de al menos 4 dígitos.");
    return;
  }

  btnDriverLogin.disabled = true;
  btnDriverLogin.textContent = "Verificando PIN...";

  try {
    const hash = await computeDriverPinHash(selectedName, pin);
    const keySnap = await getDoc(doc(db, "driver_keys", hash));

    if (!keySnap.exists() || keySnap.data().active !== true) {
      showToast("PIN incorrecto o no activado. Pide tu PIN en oficina.");
      return;
    }

    currentDriverName = selectedName;
    currentDriverKeyHash = hash;

    const payload = JSON.stringify({ driverName: selectedName, keyHash: hash });
    if (document.getElementById("rememberDriverSession").checked) {
      localStorage.setItem(DRIVER_SESSION_KEY, payload);
    } else {
      sessionStorage.setItem(DRIVER_SESSION_KEY, payload);
    }

    loginDriverPin.value = "";
    localStorage.removeItem("salinas_gps_manual_pause");
    enterDriverApp();
    showToast(`¡Buen viaje, ${selectedName}!`);
  } catch (err) {
    console.error("Error autenticando chofer:", err);
    showToast("Error de conexión al verificar PIN.");
  } finally {
    btnDriverLogin.disabled = false;
    btnDriverLogin.textContent = "Entrar a Mi Ruta";
  }
});

document.getElementById("btnDriverLogout").addEventListener("click", async () => {
  closeNav3DModal();
  await stopGpsSharing(true);
  if (whUnsub) whUnsub();
  if (ordersUnsub) ordersUnsub();
  if (salesUnsub) salesUnsub();
  if (placesUnsub) placesUnsub();
  if (visitsUnsub) visitsUnsub();
  if (routeDocUnsub) routeDocUnsub();

  currentDriverName = null;
  currentDriverKeyHash = null;
  localStorage.removeItem(DRIVER_SESSION_KEY);
  sessionStorage.removeItem(DRIVER_SESSION_KEY);

  driverAppMain.style.display = "none";
  driverBottomNav.style.display = "none";
  const utilEl = document.getElementById("driverTopUtility");
  if (utilEl) utilEl.style.display = "none";
  topDriverName.textContent = "Modo Chofer";
  driverLoginView.style.display = "flex";
});

async function enterDriverApp() {
  window.__SalinasActiveDriverName = currentDriverName || "";
  window.salinasLog?.("GPS-SESSION", `Sesión activa para ${currentDriverName} (native=${isNativeCapacitorApp()})`);
  driverLoginView.style.display = "none";
  driverAppMain.style.display = "block";
  driverBottomNav.style.display = "grid";
  const utilEl = document.getElementById("driverTopUtility");
  if (utilEl) utilEl.style.display = "flex";
  topDriverName.textContent = `🚗 ${currentDriverName}`;

  loadRecentClientsDatalist();
  syncDefaultSalePrices();
  renderStreetSaleCalibers();
  renderAssignedOrders();
  startDriverListeners();

  // Preload today's existing trail if any so we append instead of resetting
  try {
    const locSnap = await getDoc(doc(db, "driver_locations", driverSlug(currentDriverName)));
    if (locSnap.exists()) {
      const ld = locSnap.data();
      if (ld.trailDate === getLocalDateStr() && Array.isArray(ld.trail)) {
        myTrailToday = ld.trail;
      }
      if (
        ld.active === true &&
        ld.updatedAtIso &&
        Date.now() - new Date(ld.updatedAtIso).getTime() < 30 * 60 * 1000
      ) {
        localStorage.removeItem("salinas_gps_manual_pause");
      }
    }
  } catch (_) {}

  if (!gpsActive && localStorage.getItem("salinas_gps_manual_pause") !== "1") {
    startGpsSharing();
  }
  if (new URLSearchParams(window.location.search).get("ping") === "gps") {
    sendImmediateGpsPing("push");
  }
}

// ================= BOTTOM NAVIGATION =================
document.querySelectorAll(".drv-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchToDriverPane(btn.dataset.pane));
});

// ================= SCREEN WAKE LOCK & LIVE GPS TRACKING =================
async function requestRouteWakeLock() {
  try {
    if ("wakeLock" in navigator && !wakeLockSentinel) {
      wakeLockSentinel = await navigator.wakeLock.request("screen");
      wakeLockSentinel.addEventListener("release", () => {
        wakeLockSentinel = null;
      });
    }
  } catch (_) {}
}

async function releaseRouteWakeLock() {
  try {
    if (wakeLockSentinel) {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
    }
  } catch (_) {}
}

function sendImmediateGpsPing(reason = "ping") {
  if (!("geolocation" in navigator) || !currentDriverKeyHash || !currentDriverName) return;
  if (reason === "push") {
    localStorage.removeItem("salinas_gps_manual_pause");
  }
  if (!gpsActive && (reason === "push" || localStorage.getItem("salinas_gps_manual_pause") !== "1")) {
    startGpsSharing();
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      gpsActive = true;
      btnToggleGps.classList.add("active");
      gpsDot.textContent = "🟢";
      gpsLabel.textContent = "GPS";
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      const { accuracy, speed, heading } = pos.coords;
      const speedKmh = speed && speed > 0 ? speed * 3.6 : 0;
      postGpsToNav3DEmbed({ lat, lng, speedKmh, accuracy, heading });
      await publishDriverLocationUpdate({
        lat,
        lng,
        accuracy,
        speedKmh,
        heading,
        force: true
      });
      if (reason === "push") {
        showToast("📍 Ubicación GPS enviada a oficina.");
      }
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
  );
}

// Las notificaciones Web Push para GPS fueron reemplazadas por el motor nativo 24/7 (APK / TestFlight)

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "SALINAS_GPS_PING") {
      sendImmediateGpsPing("push");
    }
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && gpsActive) {
    requestRouteWakeLock();
    sendImmediateGpsPing("visible");
  }
});

btnToggleGps.addEventListener("click", () => {
  if (gpsActive) {
    window.salinasLog?.("GPS-MANUAL-PAUSE", "El chofer tocó el botón superior para PAUSAR GPS");
    localStorage.setItem("salinas_gps_manual_pause", "1");
    stopGpsSharing(true);
  } else {
    window.salinasLog?.("GPS-MANUAL-RESUME", "El chofer tocó el botón superior para ACTIVAR GPS");
    localStorage.removeItem("salinas_gps_manual_pause");
    startGpsSharing();
  }
});

function postGpsToNav3DEmbed({ lat, lng, speedKmh, accuracy, heading }) {
  if (!isNav3DOpen) return;
  const frame = document.getElementById("rpNavEmbedFrame");
  if (!frame || !frame.contentWindow) return;
  try {
    frame.contentWindow.postMessage(
      {
        type: "RP_NAV_HOST_GPS",
        lat,
        lng,
        speedKmh: Number.isFinite(speedKmh) ? speedKmh : 0,
        accuracy: Number.isFinite(accuracy) ? accuracy : 0,
        heading: Number.isFinite(heading) ? heading : null,
        timestamp: Date.now()
      },
      RP_NAV_EMBED_ORIGIN
    );
  } catch (_) {}
}

async function persistAutoGeofenceVisit(place, distMeters, arrivedAtMs, dwellSeconds) {
  if (!currentDriverKeyHash || !currentDriverName || !place?.id) return;
  const dateStr = getLocalDateStr();
  const visitDocId = `${dateStr}_${place.id}_${driverSlug(currentDriverName)}`;
  const visitPayload = {
    date: dateStr,
    placeId: place.id,
    placeName: place.name || "Tienda",
    driver: currentDriverName,
    autoGeofence: true,
    reason: `Visita automática por geocerca (${Math.max(1, Math.round(dwellSeconds / 60))} min)`,
    driverLat: lastGpsCoords?.lat ?? null,
    driverLng: lastGpsCoords?.lng ?? null,
    distanceMeters: Math.round(distMeters),
    dwellSeconds: Math.round(dwellSeconds),
    arrivedAtIso: new Date(arrivedAtMs).toISOString(),
    createdAtIso: new Date().toISOString()
  };

  const useBgRest = isNativeCapacitorApp() || document.visibilityState === "hidden";
  if (useBgRest) {
    try {
      await commitDriverDocNativeRest({
        apiKey: firebaseConfig.apiKey,
        projectId: firebaseConfig.projectId,
        driverKeyHash: currentDriverKeyHash,
        collectionName: "place_visits",
        docId: visitDocId,
        payloadData: visitPayload,
        timestampField: "createdAt"
      });
      return;
    } catch (err) {
      window.salinasLog?.("GEOFENCE-REST-ERR", err?.message || err);
    }
  }

  try {
    await executeDriverBatch(currentDriverKeyHash, (batch, proofId) => {
      batch.set(
        doc(db, "place_visits", visitDocId),
        { ...visitPayload, createdAt: serverTimestamp(), proofId },
        { merge: true }
      );
    });
  } catch (err) {
    window.salinasLog?.("GEOFENCE-SDK-ERR", err?.message || err);
  }
}

function evaluatePlaceGeofences({ lat, lng, speedKmh = 0 }) {
  if (!currentDriverKeyHash || !currentDriverName || !Array.isArray(allPlaces) || allPlaces.length === 0) {
    return;
  }
  const now = Date.now();
  const today = getLocalDateStr();

  for (const place of allPlaces) {
    if (!place?.id || typeof place.lat !== "number" || typeof place.lng !== "number") continue;
    const dist = haversineMeters(lat, lng, place.lat, place.lng);
    if (dist === null) continue;

    const dwell = activeGeofenceDwells.get(place.id);

    if (dist <= GEOFENCE_ENTER_METERS) {
      if (!dwell) {
        activeGeofenceDwells.set(place.id, {
          enteredAt: now,
          confirmed: false,
          lastSyncAt: 0
        });
        window.salinasLog?.("GEOFENCE-ENTER", `${place.name} (dist=${Math.round(dist)}m, spd=${Math.round(speedKmh)}km/h)`);
        continue;
      }

      const dwellMs = now - dwell.enteredAt;
      if (dwellMs >= GEOFENCE_MIN_DWELL_MS) {
        const alreadyManualOrConfirmedToday = visitsToday.some(
          (v) =>
            v.placeId === place.id &&
            v.date === today &&
            String(v.driver || "").toLowerCase() === String(currentDriverName || "").toLowerCase() &&
            !v.autoGeofence
        );
        if (alreadyManualOrConfirmedToday) {
          dwell.confirmed = true;
          continue;
        }

        const shouldSync = !dwell.confirmed || now - dwell.lastSyncAt >= 60000;
        if (shouldSync) {
          dwell.confirmed = true;
          dwell.lastSyncAt = now;
          const dwellSec = Math.round(dwellMs / 1000);
          window.salinasLog?.("GEOFENCE-VISIT-OK", `${place.name} confirmada (${dwellSec}s, dist=${Math.round(dist)}m)`);
          persistAutoGeofenceVisit(place, dist, dwell.enteredAt, dwellSec);
        }
      }
    } else if (dwell && dist > GEOFENCE_EXIT_METERS) {
      if (!dwell.confirmed) {
        window.salinasLog?.("GEOFENCE-SKIP", `${place.name} descartada (salió en ${Math.round((now - dwell.enteredAt) / 1000)}s < 60s)`);
      }
      activeGeofenceDwells.delete(place.id);
    }
  }
}

async function publishDriverLocationUpdate({
  lat,
  lng,
  accuracy = 0,
  speedKmh = 0,
  heading = null,
  force = false
}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const cleanLat = Number(lat.toFixed(6));
  const cleanLng = Number(lng.toFixed(6));
  const now = Date.now();

  const prevCoords = lastGpsCoords;
  lastGpsCoords = {
    lat: cleanLat,
    lng: cleanLng,
    speedKmh: Math.max(0, Math.round(speedKmh || 0)),
    accuracy: Math.round(accuracy || 0),
    heading: Number.isFinite(heading) ? Math.round(heading) : null
  };

  evaluatePlaceGeofences({ lat: cleanLat, lng: cleanLng, speedKmh });

  if (!isNav3DOpen) {
    renderPlacesList();
  }

  // Throttle Firestore writes to ~14s unless moved >= 35m or forced
  const minIntervalMs = isNav3DOpen ? 12000 : 15000;
  if (!force && lastGpsSentAt && now - lastGpsSentAt < minIntervalMs && prevCoords) {
    const movedM = haversineMeters(prevCoords.lat, prevCoords.lng, cleanLat, cleanLng) || 0;
    if (movedM < 35) return;
  }

  lastGpsSentAt = now;
  if (!currentDriverKeyHash || !currentDriverName) return;

  const currDate = getLocalDateStr();
  if (currDate !== todayStr) {
    todayStr = currDate;
    myTrailToday = [];
  }

  const lastTrailPt = myTrailToday[myTrailToday.length - 1];
  const distFromLastTrail = lastTrailPt
    ? haversineMeters(lastTrailPt.lat, lastTrailPt.lng, cleanLat, cleanLng)
    : 9999;

  if (!lastTrailPt || (distFromLastTrail !== null && distFromLastTrail >= 35)) {
    const hhmm = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
    myTrailToday.push({ lat: cleanLat, lng: cleanLng, t: hhmm });
    if (myTrailToday.length > 120) {
      myTrailToday = myTrailToday.slice(-120);
    }
  }

  const trunk = computeMyTrunkAndCorte();
  const docId = driverSlug(currentDriverName);
  const baseLocationRecord = {
    driverName: currentDriverName,
    lat: cleanLat,
    lng: cleanLng,
    accuracy: Math.round(accuracy || 0),
    speedKmh: Math.max(0, Math.round(speedKmh || 0)),
    ...(Number.isFinite(heading) ? { heading: Math.round(heading) } : {}),
    navigating3d: isNav3DOpen,
    active: true,
    trailDate: currDate,
    trail: myTrailToday,
    boxesInCar: trunk.totalAvailable,
    boxesBreakdown: trunk.avail,
    ripeness: trunk.lastRipeness || "Surtido",
    updatedAtIso: new Date().toISOString()
  };

  const useNativeOrBackgroundRest =
    isNativeCapacitorApp() || document.visibilityState === "hidden";

  if (useNativeOrBackgroundRest) {
    try {
      await commitDriverLocationNativeRest({
        apiKey: firebaseConfig.apiKey,
        projectId: firebaseConfig.projectId,
        driverKeyHash: currentDriverKeyHash,
        driverDocId: docId,
        payloadData: baseLocationRecord
      });
      return;
    } catch (restErr) {
      console.warn("Fallback a SDK batch tras aviso HTTP nativo:", restErr);
    }
  }

  try {
    await executeDriverBatch(currentDriverKeyHash, (batch, proofId) => {
      batch.set(doc(db, "driver_locations", docId), {
        ...baseLocationRecord,
        updatedAt: serverTimestamp(),
        proofId
      });
    });
  } catch (err) {
    console.warn("Aviso SDK GPS, reintentando por REST keepalive:", err);
    try {
      await commitDriverLocationNativeRest({
        apiKey: firebaseConfig.apiKey,
        projectId: firebaseConfig.projectId,
        driverKeyHash: currentDriverKeyHash,
        driverDocId: docId,
        payloadData: baseLocationRecord
      });
    } catch (_) {}
  }
}

function startGpsWatchdog() {
  if (gpsWatchdogIntervalId) clearInterval(gpsWatchdogIntervalId);
  gpsWatchdogIntervalId = setInterval(() => {
    if (!gpsActive || !currentDriverKeyHash || !currentDriverName) return;
    const elapsedMs = lastGpsSentAt ? Date.now() - lastGpsSentAt : 999999;
    if (elapsedMs >= 150000) {
      window.salinasLog?.("GPS-WATCHDOG", `Sin envío hace ${Math.round(elapsedMs / 1000)}s; ejecutando rescate`);
      if (document.visibilityState === "visible" && "geolocation" in navigator) {
        sendImmediateGpsPing("watchdog");
      } else if (lastGpsCoords) {
        publishDriverLocationUpdate({ ...lastGpsCoords, force: true });
      }
    }
  }, 60000);
}

function stopGpsWatchdog() {
  if (gpsWatchdogIntervalId) {
    clearInterval(gpsWatchdogIntervalId);
    gpsWatchdogIntervalId = null;
  }
}

async function startGpsSharing() {
  if (gpsActive && (gpsWatchId !== null || isNativeCapacitorApp())) return;
  window.salinasLog?.("GPS-START", `Iniciando GPS (native=${isNativeCapacitorApp()})`);
  startGpsWatchdog();

  // Modo Nativo 24/7 (Android ForegroundService + iOS Background Location con pantalla bloqueada)
  if (isNativeCapacitorApp()) {
    gpsActive = true;
    btnToggleGps.classList.add("active");
    gpsDot.textContent = "🟢";
    gpsLabel.textContent = "GPS 24/7";
    requestRouteWakeLock();

    const started = await startNativeBackgroundGps({
      onLocation: async (fix, isKeepAlive) => {
        postGpsToNav3DEmbed(fix);
        await publishDriverLocationUpdate({
          lat: fix.lat,
          lng: fix.lng,
          accuracy: fix.accuracy,
          speedKmh: fix.speedKmh,
          heading: fix.heading,
          force: Boolean(isKeepAlive)
        });
      },
      onPermissionDenied: (openSettingsFn) => {
        window.salinasLog?.("GPS-PERM-DENIED", "Permiso de ubicación Always denegado por sistema/usuario");
        showToast("Activa la ubicación 'Permitir siempre' para no desaparecer del mapa al bloquear pantalla.");
        stopGpsSharing(false);
        if (typeof openSettingsFn === "function") {
          setTimeout(() => {
            if (window.confirm("Para que Despacho vea tu carro con la pantalla apagada, selecciona Ubicación → 'Permitir todo el tiempo' / 'Siempre'. ¿Abrir Ajustes?")) {
              openSettingsFn();
            }
          }, 250);
        }
      }
    });

    if (started) {
      showToast("🟢 GPS 24/7 activo (funciona aun con pantalla bloqueada).");
      return;
    }
    window.salinasLog?.("GPS-FALLBACK", "Plugin nativo no inició; usando navigator.geolocation");
    // Si por alguna razón el plugin nativo no inició, caer limpiamente a geolocalización estándar
  }

  if (!("geolocation" in navigator)) {
    window.salinasLog?.("GPS-ERR", "Navegador sin soporte de geolocalización");
    showToast("Tu navegador no soporta GPS.");
    return;
  }
  if (gpsWatchId !== null) return;

  gpsActive = true;
  btnToggleGps.classList.add("active");
  gpsDot.textContent = "🟢";
  gpsLabel.textContent = "GPS";
  requestRouteWakeLock();
  showToast("GPS activo: Administración supervisa tu recorrido en tiempo real.");

  gpsWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      const { accuracy, speed, heading } = pos.coords;
      const speedKmh = speed && speed > 0 ? speed * 3.6 : 0;

      // Alimentar cabina 3D en tiempo real (1 Hz) sin doble popup de permisos en móvil
      postGpsToNav3DEmbed({ lat, lng, speedKmh, accuracy, heading });

      await publishDriverLocationUpdate({
        lat,
        lng,
        accuracy,
        speedKmh,
        heading,
        force: false
      });
    },
    (err) => {
      window.salinasLog?.("GPS-WEB-ERR", `code=${err?.code} msg=${err?.message || err}`);
      console.warn("Aviso GPS:", err);
      if (err && err.code === 1) {
        showToast("Permite el acceso a tu ubicación en el navegador para activar GPS.");
        stopGpsSharing(false);
      }
    },
    { enableHighAccuracy: true, maximumAge: 2500, timeout: 25000 }
  );
}

async function stopGpsSharing(notifyServer = true) {
  stopGpsWatchdog();
  window.salinasLog?.("GPS-STOP", `Deteniendo GPS (notifyServer=${notifyServer})`);
  await stopNativeBackgroundGps();
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  await releaseRouteWakeLock();
  const wasActive = gpsActive;
  gpsActive = false;
  lastGpsSentAt = 0;
  btnToggleGps.classList.remove("active");
  gpsDot.textContent = "⚪";
  gpsLabel.textContent = "GPS";

  if (wasActive && notifyServer && currentDriverKeyHash && currentDriverName) {
    try {
      await executeDriverBatch(currentDriverKeyHash, (batch, proofId) => {
        batch.set(
          doc(db, "driver_locations", driverSlug(currentDriverName)),
          {
            driverName: currentDriverName,
            ...(lastGpsCoords || {}),
            active: false,
            updatedAtIso: new Date().toISOString(),
            updatedAt: serverTimestamp(),
            proofId
          },
          { merge: true }
        );
      });
      showToast("GPS pausado.");
    } catch (err) {
      console.warn("Aviso al pausar GPS:", err);
    }
  }
}

function getOneShotGpsPosition() {
  return new Promise((resolve) => {
    if (lastGpsCoords) {
      resolve(lastGpsCoords);
    }
    if (!("geolocation" in navigator)) {
      resolve(lastGpsCoords);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6))
        };
        lastGpsCoords = coords;
        resolve(coords);
      },
      () => resolve(lastGpsCoords),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  });
}

// ================= REALTIME OPERATIONAL LISTENERS =================
function startDriverListeners() {
  todayStr = getLocalDateStr();
  subscribeDriverRouteListener();
  if (whUnsub) whUnsub();
  if (ordersUnsub) ordersUnsub();
  if (salesUnsub) salesUnsub();
  if (placesUnsub) placesUnsub();
  if (visitsUnsub) visitsUnsub();
  if (routeDocUnsub) routeDocUnsub();

  // 1. Today's warehouse car trips for this driver
  whUnsub = onSnapshot(doc(db, "warehouse_days", todayStr), (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      whTripsToday = (data.trips || []).filter(
        (t) => String(t.driver || "").toLowerCase() === String(currentDriverName || "").toLowerCase()
      );
    } else {
      whTripsToday = [];
    }
    refreshAllViews();
  });

  // 2. Assigned online orders
  let knownAssignedIds = new Set();
  let initialAssignedLoaded = false;
  const ordQ = query(collection(db, "orders"), orderBy("createdAtIso", "desc"), limit(120));
  ordersUnsub = onSnapshot(
    ordQ,
    (snap) => {
      const incoming = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter(
          (o) =>
            String(o.assignedDriver || "").toLowerCase() === String(currentDriverName || "").toLowerCase() &&
            (o.status === "confirmado" || o.status === "en_ruta")
        );
      if (initialAssignedLoaded) {
        const brandNew = incoming.filter((o) => !knownAssignedIds.has(o.id));
        if (brandNew.length > 0) {
          showToast(`📦 ¡Nuevo pedido asignado: ${brandNew[0].customerName || brandNew[0].folio}!`);
          try {
            navigator.vibrate?.([160, 80, 160]);
          } catch (_) {}
        }
      }
      knownAssignedIds = new Set(incoming.map((o) => o.id));
      initialAssignedLoaded = true;
      assignedOrders = incoming;
      renderAssignedOrders();
    },
    (err) => {
      console.warn("Error escuchando pedidos asignados:", err);
    }
  );

  // 3. Today's route sales (all drivers for store visit status + my own for Mi Corte)
  const salesQ = query(collection(db, "route_sales"), where("date", "==", todayStr));
  salesUnsub = onSnapshot(salesQ, (snap) => {
    allSalesToday = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    mySalesToday = allSalesToday
      .filter((s) => String(s.driver || "").toLowerCase() === String(currentDriverName || "").toLowerCase())
      .sort((a, b) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || "")));
    refreshAllViews();
    renderPlacesList();
  });

  // 4. Registered Points of Purchase (Tiendas, Carnicerías, Restaurantes, Fruterías)
  placesUnsub = onSnapshot(collection(db, "places"), (snap) => {
    allPlaces = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.active !== false);
    loadRecentClientsDatalist();
    renderPlacesList();
    renderAssignedOrders();
  });

  // 5. Today's GPS-verified No-Sale Visits
  const visitsQ = query(collection(db, "place_visits"), where("date", "==", todayStr));
  visitsUnsub = onSnapshot(visitsQ, (snap) => {
    visitsToday = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPlacesList();
  });
}

let lastHiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    lastHiddenAt = Date.now();
    return;
  }
  if (currentDriverName && lastHiddenAt && Date.now() - lastHiddenAt > 15000) {
    startDriverListeners();
  }
});
window.addEventListener("online", () => {
  if (currentDriverName) startDriverListeners();
});

function normalizePlaceKey(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stripParensKey(str) {
  return normalizePlaceKey(String(str || "").replace(/\(.*?\)/g, ""));
}

function namesMatchPlace(a, b) {
  const na = normalizePlaceKey(a);
  const nb = normalizePlaceKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const sa = stripParensKey(a);
  const sb = stripParensKey(b);
  return Boolean(sa && sb && sa === sb);
}

function findMatchingPlace(name, phone) {
  const normPhone = normalizePhone10(phone);
  for (const p of allPlaces) {
    if (namesMatchPlace(name, p.name)) return p;
    if (normPhone && normPhone.length === 10 && normalizePhone10(p.phone) === normPhone) return p;
  }
  return null;
}

function getPlaceStatusToday(place) {
  const pNormPhone = normalizePhone10(place.phone);

  const saleMatch = allSalesToday.find(
    (s) =>
      s.placeId === place.id ||
      namesMatchPlace(place.name, s.customerName) ||
      (pNormPhone && pNormPhone.length === 10 && normalizePhone10(s.phone) === pNormPhone)
  );
  if (saleMatch) {
    return {
      code: "sold",
      badge: `🟢 Vendido hoy (${saleMatch.totalBoxes} cj)`,
      style: "background:var(--green-100);color:var(--green-800);"
    };
  }

  const visitMatch = visitsToday.find((v) => v.placeId === place.id);
  if (visitMatch) {
    return {
      code: "visited",
      badge: `🟡 Visitado (${visitMatch.driver})`,
      style: "background:var(--gold-100);color:#7a4f08;"
    };
  }

  return {
    code: "pending",
    badge: "⚪ Pendiente hoy",
    style: "background:var(--slate-100);color:var(--slate-700);"
  };
}

// ================= VIEW 1B: PUNTOS DE COMPRA / CLIENTES =================
document.getElementById("driverPlaceSearch").addEventListener("input", (e) => {
  placeSearchQuery = e.target.value.trim().toLowerCase();
  renderPlacesList();
});

function renderPlacesList() {
  const badgeEl = document.getElementById("placesCountBadge");
  const listEl = document.getElementById("driverPlacesList");
  if (!badgeEl || !listEl) return;

  badgeEl.textContent = `${allPlaces.length} punto${allPlaces.length === 1 ? "" : "s"}`;

  const enriched = allPlaces
    .filter((p) => {
      if (!placeSearchQuery) return true;
      const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.tienda;
      const hay = `${p.name || ""} ${p.address || ""} ${p.phone || ""} ${p.category || ""} ${cat.label || ""}`;
      return matchesSmartSearch(hay, placeSearchQuery);
    })
    .map((p) => {
      const dist = lastGpsCoords ? haversineMeters(lastGpsCoords.lat, lastGpsCoords.lng, p.lat, p.lng) : null;
      return { ...p, dist };
    })
    .sort((a, b) => {
      if (a.dist !== null && b.dist !== null) return a.dist - b.dist;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

  if (enriched.length === 0) {
    listEl.innerHTML = `
      <div class="cart-empty" style="background:var(--white);">
        ${allPlaces.length === 0
          ? "Aún no hay negocios guardados en el mapa. Toca el botón verde arriba cuando estés afuera de un cliente nuevo."
          : "Ningún punto coincide con tu búsqueda."}
      </div>
    `;
    return;
  }

  listEl.innerHTML = enriched
    .map((p) => {
      const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.tienda;
      const st = getPlaceStatusToday(p);
      const distTxt = p.dist !== null
        ? (p.dist < 1000 ? `📍 a ${p.dist} m` : `📍 a ${(p.dist / 1000).toFixed(1)} km`)
        : "";
      const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;

      return `
        <article class="corte-summary-box" style="padding:13px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div>
              <strong style="font-size:0.98rem;color:var(--green-950);">${cat.emoji} ${escapeHtml(p.name)}</strong>
              <div style="font-size:0.75rem;color:var(--slate-500);">
                ${escapeHtml(cat.label)} ${distTxt ? `• <strong>${distTxt}</strong>` : ""}
              </div>
            </div>
            <span class="ripeness-badge" style="${st.style}">${escapeHtml(st.badge)}</span>
          </div>

          ${p.address ? `<div style="font-size:0.8rem;color:var(--slate-700);margin-top:4px;">${escapeHtml(p.address)}</div>` : ""}

          <div style="display:grid;grid-template-columns:1.25fr 1fr 1fr auto;gap:6px;margin-top:10px;">
            <button type="button" class="btn btn-nav-3d btn-sm" data-nav3d-place="${escapeHtml(p.id)}" style="padding:8px 8px;font-size:0.75rem;">
              🧭 Navegar 3D
            </button>
            <button type="button" class="btn btn-primary btn-sm" data-sell-place="${escapeHtml(p.id)}" style="padding:8px 6px;font-size:0.75rem;">
              ➕ Venderle
            </button>
            <button type="button" class="btn btn-outline btn-sm" data-visit-place="${escapeHtml(p.id)}" style="padding:8px 6px;font-size:0.74rem;">
              📍 Pasé
            </button>
            <a href="${navUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="padding:8px 9px;font-size:0.75rem;" title="Abrir en Google Maps">
              🗺️
            </a>
          </div>
        </article>
      `;
    })
    .join("");
}

function openSellPaneForPlace(place) {
  if (!place) return;
  document.getElementById("saleSelectedPlaceId").value = place.id;
  document.getElementById("saleClientName").value = place.name || "";
  document.getElementById("saleClientPhone").value = place.phone || "";
  const badge = document.getElementById("saleLinkedPlaceBadge");
  badge.style.display = "block";
  badge.textContent = `✓ Vinculado en el mapa: ${place.name}`;
  switchToDriverPane("drvPaneSell");
}

// Place card actions (Navegar 3D / Venderle / Registrar Visita)
const visitNoSaleModal = document.getElementById("visitNoSaleModal");

document.getElementById("driverPlacesList").addEventListener("click", (e) => {
  const nav3dBtn = e.target.closest("button[data-nav3d-place]");
  if (nav3dBtn) {
    const place = allPlaces.find((p) => p.id === nav3dBtn.dataset.nav3dPlace);
    if (!place || typeof place.lat !== "number" || typeof place.lng !== "number") {
      showToast("Este punto aún no tiene coordenadas GPS.");
      return;
    }
    const cat = PLACE_CATEGORIES[place.category] || PLACE_CATEGORIES.tienda;
    openNav3DModal([
      {
        id: place.id,
        kind: "place",
        name: `${cat.emoji} ${place.name}`,
        address: place.address || "",
        subtitle: `${cat.label}${place.address ? ` • ${place.address}` : ""}`,
        lat: place.lat,
        lng: place.lng,
        pinEmoji: "🥑",
        actionLabel: "➕ Vender / Cobrar",
        arrivalActionLabel: "➕ Vender Aquí"
      }
    ]);
    return;
  }

  const sellBtn = e.target.closest("button[data-sell-place]");
  if (sellBtn) {
    const place = allPlaces.find((p) => p.id === sellBtn.dataset.sellPlace);
    if (!place) return;
    openSellPaneForPlace(place);
    return;
  }

  const visitBtn = e.target.closest("button[data-visit-place]");
  if (visitBtn) {
    const place = allPlaces.find((p) => p.id === visitBtn.dataset.visitPlace);
    if (!place) return;
    document.getElementById("visitPlaceId").value = place.id;
    document.getElementById("visitModalSubtitle").textContent =
      `Confirmar visita presencial a ${place.name}. Se validará tu distancia GPS.`;
    visitNoSaleModal.classList.add("open");
  }
});

document.getElementById("btnCloseVisitModal").addEventListener("click", () => {
  visitNoSaleModal.classList.remove("open");
});

document.getElementById("visitNoSaleForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const placeId = document.getElementById("visitPlaceId").value;
  const place = allPlaces.find((p) => p.id === placeId);
  if (!place) {
    visitNoSaleModal.classList.remove("open");
    return;
  }

  const btn = document.getElementById("btnSubmitVisit");
  btn.disabled = true;
  btn.textContent = "Verificando GPS...";

  try {
    const coords = await getOneShotGpsPosition();
    const dist = coords ? haversineMeters(coords.lat, coords.lng, place.lat, place.lng) : null;
    const reason = document.getElementById("visitReasonSelect").value;
    const visitDocId = `${getLocalDateStr()}_${place.id}_${driverSlug(currentDriverName)}`;

    await executeDriverBatch(currentDriverKeyHash, (batch, proofId) => {
      batch.set(doc(db, "place_visits", visitDocId), {
        date: getLocalDateStr(),
        placeId: place.id,
        placeName: place.name,
        driver: currentDriverName,
        reason,
        driverLat: coords ? coords.lat : null,
        driverLng: coords ? coords.lng : null,
        distanceMeters: dist,
        createdAtIso: new Date().toISOString(),
        createdAt: serverTimestamp(),
        proofId
      });
    });

    visitNoSaleModal.classList.remove("open");
    showToast(
      dist !== null
        ? `Visita registrada en ${place.name} (GPS a ${dist} m).`
        : `Visita registrada en ${place.name}.`
    );
  } catch (err) {
    console.error(err);
    showToast("Error al guardar la visita.");
  } finally {
    btn.disabled = false;
    btn.textContent = "✅ Confirmar que pasé aquí (GPS)";
  }
});

// New Place Modal (Alta de tienda con GPS del chofer)
const newPlaceModal = document.getElementById("newPlaceModal");
const newPlaceGpsStatus = document.getElementById("newPlaceGpsStatus");

document.getElementById("btnOpenNewPlaceModal").addEventListener("click", async () => {
  pendingNewPlaceCoords = null;
  newPlaceGpsStatus.textContent = "📡 Leyendo coordenadas GPS de donde estás parado...";
  newPlaceGpsStatus.style.color = "var(--gold-600)";
  newPlaceModal.classList.add("open");

  const coords = await getOneShotGpsPosition();
  if (coords) {
    pendingNewPlaceCoords = coords;
    newPlaceGpsStatus.textContent = `✓ Ubicación GPS lista (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`;
    newPlaceGpsStatus.style.color = "var(--green-800)";
  } else {
    newPlaceGpsStatus.textContent = "⚠️ Activa el permiso de ubicación en tu celular para guardar el punto.";
    newPlaceGpsStatus.style.color = "var(--red-600)";
  }
});

document.getElementById("btnCloseNewPlaceModal").addEventListener("click", () => {
  newPlaceModal.classList.remove("open");
});

document.getElementById("newPlaceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!pendingNewPlaceCoords) {
    const retry = await getOneShotGpsPosition();
    if (!retry) {
      showToast("Necesitas permitir el GPS del teléfono para guardar la ubicación del negocio.");
      return;
    }
    pendingNewPlaceCoords = retry;
  }

  const category = document.getElementById("placeCategoryInput").value;
  const name = document.getElementById("placeNameInput").value.trim();
  const phone = document.getElementById("placePhoneInput").value.trim();
  const address = document.getElementById("placeAddressInput").value.trim();

  if (!name) {
    showToast("Escribe el nombre del negocio.");
    return;
  }

  const btn = document.getElementById("btnSubmitNewPlace");
  btn.disabled = true;
  btn.textContent = "Guardando en mapa...";

  try {
    const newRef = doc(collection(db, "places"));
    await executeDriverBatch(currentDriverKeyHash, (batch, proofId) => {
      batch.set(newRef, {
        name,
        category,
        phone,
        address,
        lat: pendingNewPlaceCoords.lat,
        lng: pendingNewPlaceCoords.lng,
        active: true,
        createdBy: currentDriverName,
        createdAtIso: new Date().toISOString(),
        createdAt: serverTimestamp(),
        proofId
      });
    });

    document.getElementById("placeNameInput").value = "";
    document.getElementById("placePhoneInput").value = "";
    document.getElementById("placeAddressInput").value = "";
    newPlaceModal.classList.remove("open");
    showToast(`¡${name} guardado en el mapa de Salinas!`);
  } catch (err) {
    console.error(err);
    showToast("Error al guardar el punto de compra.");
  } finally {
    btn.disabled = false;
    btn.textContent = "💾 Guardar Punto en Mapa";
  }
});

// ================= TRUNK & CORTE CALCULATIONS =================
function computeMyTrunkAndCorte() {
  const cals = ["M", "P", "E", "S"];
  const out = { M: 0, P: 0, E: 0, S: 0 };
  const ret = { M: 0, P: 0, E: 0, S: 0 };
  const sold = { M: 0, P: 0, E: 0, S: 0 };
  const avail = { M: 0, P: 0, E: 0, S: 0 };

  let lastRipeness = "";
  let vueltas = 0;

  for (const t of whTripsToday) {
    vueltas++;
    lastRipeness = t.ripeness || lastRipeness;
    for (const c of cals) {
      out[c] += Number(t.out?.[c]) || 0;
      ret[c] += Number(t.ret?.[c]) || 0;
    }
  }

  let grossMoney = 0;
  let cashMoney = 0;
  let transfMoney = 0;
  let creditMoney = 0;

  for (const s of mySalesToday) {
    for (const c of cals) {
      sold[c] += Number(s.boxesByCaliber?.[c]) || 0;
    }
    grossMoney += Number(s.totalAmount) || 0;
    cashMoney += Number(s.cashCollected) || 0;
    transfMoney += Number(s.transferCollected) || 0;
    creditMoney += Number(s.creditBalance) || 0;
  }

  let totalOut = 0;
  let totalRet = 0;
  let totalSold = 0;
  let totalAvailable = 0;

  for (const c of cals) {
    avail[c] = out[c] - ret[c] - sold[c];
    totalOut += out[c];
    totalRet += ret[c];
    totalSold += sold[c];
    totalAvailable += avail[c];
  }

  return {
    out,
    ret,
    sold,
    avail,
    totalOut,
    totalRet,
    totalSold,
    totalAvailable,
    vueltas,
    lastRipeness,
    grossMoney,
    cashMoney,
    transfMoney,
    creditMoney
  };
}

function refreshAllViews() {
  const stats = computeMyTrunkAndCorte();

  document.getElementById("trunkTotalAvailable").textContent = `${stats.totalAvailable} caja${stats.totalAvailable === 1 ? "" : "s"}`;
  document.getElementById("trunkRipenessTag").textContent = stats.vueltas > 0
    ? `${stats.vueltas} vuelta${stats.vueltas === 1 ? "" : "s"} • ${stats.lastRipeness || "Surtido"}`
    : "Sin salida registrada hoy";

  document.getElementById("trunkM").textContent = String(stats.avail.M);
  document.getElementById("trunkP").textContent = String(stats.avail.P);
  document.getElementById("trunkE").textContent = String(stats.avail.E);
  document.getElementById("trunkS").textContent = String(stats.avail.S);

  document.querySelectorAll("[data-avail-badge]").forEach((el) => {
    const code = el.dataset.availBadge;
    el.textContent = `En carro: ${stats.avail[code] ?? 0}`;
  });

  document.getElementById("corteBoxesOut").textContent = `${stats.totalOut} cajas`;
  document.getElementById("corteBoxesSold").textContent = `${stats.totalSold} cajas`;
  document.getElementById("corteBoxesRet").textContent = `${stats.totalRet} cajas`;
  document.getElementById("corteBoxesPending").textContent = `${stats.totalAvailable} cajas`;
  document.getElementById("corteBoxesPendingSub").textContent =
    `M:${stats.avail.M} • P:${stats.avail.P} • E:${stats.avail.E} • S:${stats.avail.S}`;

  document.getElementById("corteMoneyGross").textContent = formatCurrency(stats.grossMoney);
  document.getElementById("corteMoneyTransf").textContent = formatCurrency(stats.transfMoney);
  document.getElementById("corteMoneyCredit").textContent = formatCurrency(stats.creditMoney);
  document.getElementById("corteMoneyCash").textContent = formatCurrency(stats.cashMoney);

  renderTodaySalesList();
}

// ================= VIEW 1: ASSIGNED ONLINE ORDERS & NAV 3D BRIDGE =================
function resolveOrderCoordsSync(ord) {
  if (!ord) return null;
  if (typeof ord.lat === "number" && typeof ord.lng === "number") {
    return { lat: ord.lat, lng: ord.lng, source: "gps_pedido" };
  }
  if (geocodedOrderCoordsCache.has(ord.id)) {
    return geocodedOrderCoordsCache.get(ord.id);
  }
  const ordPhone10 = normalizePhone10(ord.phone);
  for (const p of allPlaces) {
    if (typeof p.lat !== "number" || typeof p.lng !== "number") continue;
    const pPhone10 = normalizePhone10(p.phone);
    if ((ordPhone10 && pPhone10 && ordPhone10 === pPhone10) || namesMatchPlace(ord.customerName, p.name)) {
      return { lat: p.lat, lng: p.lng, source: "punto_guardado", placeId: p.id };
    }
  }
  const parsed = parseCoordsFromInput(ord.address);
  if (parsed) {
    return { lat: parsed.lat, lng: parsed.lng, source: "coords_direccion" };
  }
  return null;
}

async function geocodeOrderAddressFallback(ord) {
  const rawAddr = String(ord?.address || "").trim();
  if (!rawAddr || rawAddr.length < 4) return null;
  try {
    const q = encodeURIComponent(`${rawAddr}, México`);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=mx&q=${q}`, {
      headers: { "Accept-Language": "es" }
    });
    if (!res.ok) return null;
    const arr = await res.json();
    if (Array.isArray(arr) && arr[0]) {
      const lat = parseFloat(arr[0].lat);
      const lng = parseFloat(arr[0].lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const resolved = { lat, lng, source: "geocodificado" };
        geocodedOrderCoordsCache.set(ord.id, resolved);
        return resolved;
      }
    }
  } catch (_) {}
  return null;
}

function buildOrderNavStop(ord, coords) {
  return {
    id: ord.id,
    kind: "order",
    name: `📦 ${ord.customerName || ord.folio || "Pedido"}`,
    address: ord.address || "",
    subtitle: `${ord.folio || "PEDIDO"} • ${ord.totalBoxes || 0} cajas • Cobrar ${formatCurrency(ord.totalAmount)}`,
    lat: coords.lat,
    lng: coords.lng,
    pinEmoji: "📦",
    actionLabel: "✅ Entregar / Cobrar",
    arrivalActionLabel: "✅ Entregar Pedido"
  };
}

function openDeliverOrderModalForOrder(ord) {
  if (!ord) return;
  document.getElementById("deliverOrderId").value = ord.id;
  document.getElementById("deliverOrderSubtitle").textContent =
    `${ord.customerName} • ${ord.totalBoxes} cajas • Total: ${formatCurrency(ord.totalAmount)}`;

  const prefPay = (ord.paymentMethod || "").toLowerCase().includes("transf")
    ? "Transferencia"
    : "Efectivo";
  deliverPayMethod.value = prefPay;
  deliverCreditWrap.style.display = "none";
  deliverAdvanceInput.value = "0";
  deliverOrderModal.classList.add("open");
}

function sendInitToNav3DEmbed() {
  if (!isNav3DOpen || !pendingNav3DPayload) return;
  const frame = document.getElementById("rpNavEmbedFrame");
  if (!frame || !frame.contentWindow) return;
  try {
    frame.contentWindow.postMessage(
      {
        type: "RP_NAV_INIT",
        licenseKey: RP_NAV_EMBED_LICENSE_KEY,
        driverName: currentDriverName || "Chofer Salinas",
        uiConfig: SALINAS_NAV3D_UI_CONFIG,
        stops: pendingNav3DPayload.stops,
        destination: pendingNav3DPayload.stops[pendingNav3DPayload.activeStopIndex || 0] || null,
        activeStopIndex: pendingNav3DPayload.activeStopIndex || 0,
        initialGps: lastGpsCoords || null,
        gpsMode: "auto"
      },
      RP_NAV_EMBED_ORIGIN
    );
  } catch (_) {}
}

function openNav3DModal(stops, activeStopIndex = 0) {
  if (!Array.isArray(stops) || stops.length === 0) return;

  // Asegurar que el GPS de ruta esté encendido para que Administración supervise en todo momento
  if (!gpsActive) {
    localStorage.removeItem("salinas_gps_manual_pause");
    startGpsSharing();
  } else {
    requestRouteWakeLock();
  }

  pendingNav3DPayload = { stops, activeStopIndex };
  isNav3DOpen = true;

  const overlay = document.getElementById("rpNavEmbedOverlay");
  const frame = document.getElementById("rpNavEmbedFrame");
  const fallbackClose = document.getElementById("btnFallbackCloseNav3D");
  if (!overlay || !frame) return;

  if (fallbackClose) fallbackClose.style.display = "inline-flex";
  document.body.style.overflow = "hidden";
  overlay.classList.add("open");

  if (!frame.src || frame.src === "about:blank" || !frame.src.startsWith(RP_NAV_EMBED_ORIGIN)) {
    frame.src = RP_NAV_EMBED_URL;
  } else {
    sendInitToNav3DEmbed();
  }
}

function closeNav3DModal() {
  isNav3DOpen = false;
  pendingNav3DPayload = null;
  document.body.style.overflow = "";

  const overlay = document.getElementById("rpNavEmbedOverlay");
  const frame = document.getElementById("rpNavEmbedFrame");
  if (overlay) overlay.classList.remove("open");
  if (frame && frame.src !== "about:blank") {
    frame.src = "about:blank";
  }
  renderPlacesList();
}

document.getElementById("btnFallbackCloseNav3D")?.addEventListener("click", () => {
  closeNav3DModal();
});

// Receptor seguro postMessage desde Ruta Pro Nav Embed (validación estricta de origen)
window.addEventListener("message", async (event) => {
  if (event.origin !== RP_NAV_EMBED_ORIGIN) return;
  const msg = event.data;
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

  if (msg.type === "RP_NAV_READY") {
    const fallbackClose = document.getElementById("btnFallbackCloseNav3D");
    if (fallbackClose) fallbackClose.style.display = "none";
    sendInitToNav3DEmbed();
    return;
  }

  if (msg.type === "RP_NAV_GPS") {
    if (typeof msg.lat === "number" && typeof msg.lng === "number") {
      await publishDriverLocationUpdate({
        lat: msg.lat,
        lng: msg.lng,
        accuracy: msg.accuracy || 0,
        speedKmh: msg.speedKmh || 0,
        heading: typeof msg.heading === "number" ? msg.heading : null,
        force: false
      });
    }
    return;
  }

  if (msg.type === "RP_NAV_ARRIVED") {
    try {
      navigator.vibrate?.([180, 90, 180]);
    } catch (_) {}
    showToast(`📍 Llegaste a ${msg.stop?.name || "el punto de entrega"}.`);
    return;
  }

  if (msg.type === "RP_NAV_LICENSE_BLOCKED") {
    const fallbackClose = document.getElementById("btnFallbackCloseNav3D");
    if (fallbackClose) fallbackClose.style.display = "inline-flex";
    showToast("⚠️ Visor 3D no disponible temporalmente.");
    return;
  }

  if (msg.type === "RP_NAV_CLOSE") {
    const targetStop = msg.stop || null;
    const reason = msg.reason || "user_close";
    closeNav3DModal();

    if (reason === "deliver_action" && targetStop) {
      if (targetStop.kind === "order") {
        const ord = assignedOrders.find((o) => o.id === targetStop.id);
        if (ord) {
          switchToDriverPane("drvPaneRoute");
          openDeliverOrderModalForOrder(ord);
        }
      } else if (targetStop.kind === "place") {
        const place = allPlaces.find((p) => p.id === targetStop.id);
        if (place) {
          openSellPaneForPlace(place);
        }
      }
    }
  }
});

function buildNearestPlacesStops(maxStops = 15) {
  const valid = allPlaces.filter((p) => typeof p.lat === "number" && typeof p.lng === "number");
  if (valid.length === 0) return [];

  // Priorizar clientes aún pendientes de visita hoy; si todos fueron visitados, usar catálogo completo
  const pendingToday = valid.filter((p) => getPlaceStatusToday(p).code === "pending");
  const pool = pendingToday.length > 0 ? pendingToday : valid;

  const sorted = [...pool].sort((a, b) => {
    if (lastGpsCoords) {
      const da = haversineMeters(lastGpsCoords.lat, lastGpsCoords.lng, a.lat, a.lng) ?? 999999;
      const dbDist = haversineMeters(lastGpsCoords.lat, lastGpsCoords.lng, b.lat, b.lng) ?? 999999;
      return da - dbDist;
    }
    return String(a.name || "").localeCompare(String(b.name || ""), "es");
  });

  return sorted.slice(0, maxStops).map((p) => {
    const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.tienda;
    return {
      id: p.id,
      kind: "place",
      name: `${cat.emoji} ${p.name}`,
      address: p.address || "",
      subtitle: `${cat.label}${placeSubtitleSuffix(p)}`,
      lat: p.lat,
      lng: p.lng,
      pinEmoji: "🥑",
      actionLabel: "➕ Vender / Cobrar",
      arrivalActionLabel: "➕ Vender Aquí"
    };
  });
}

function placeSubtitleSuffix(p) {
  return p && p.address ? ` • ${p.address}` : "";
}

function launchSmartNav3D() {
  // 1. Si tiene pedidos asignados con coordenadas, abrir ruta 3D hacia sus pedidos
  const orderStops = [];
  for (const ord of assignedOrders) {
    const c = resolveOrderCoordsSync(ord);
    if (c) orderStops.push(buildOrderNavStop(ord, c));
  }
  if (orderStops.length > 0) {
    if (lastGpsCoords && orderStops.length > 1) {
      orderStops.sort(
        (a, b) =>
          (haversineMeters(lastGpsCoords.lat, lastGpsCoords.lng, a.lat, a.lng) || 999999) -
          (haversineMeters(lastGpsCoords.lat, lastGpsCoords.lng, b.lat, b.lng) || 999999)
      );
    }
    openNav3DModal(orderStops, 0);
    return;
  }

  // 2. Si no tiene pedidos asignados en este momento, abrir ruta 3D por los clientes/tiendas más cercanos
  const placeStops = buildNearestPlacesStops(15);
  if (placeStops.length > 0) {
    openNav3DModal(placeStops, 0);
    return;
  }

  showToast("Primero guarda al menos un cliente con GPS en la pestaña 🏪 Clientes.");
  switchToDriverPane("drvPanePlaces");
}

document.getElementById("btnTopOpenNav3D")?.addEventListener("click", () => {
  launchSmartNav3D();
});

document.getElementById("btnNavigateAllOrders3D")?.addEventListener("click", () => {
  launchSmartNav3D();
});

function renderAssignedOrders() {
  const listEl = document.getElementById("driverAssignedOrdersList");
  const multiBtn = document.getElementById("btnNavigateAllOrders3D");
  document.getElementById("assignedCountBadge").textContent = String(assignedOrders.length);

  const routableCount = assignedOrders.filter((o) => resolveOrderCoordsSync(o) !== null).length;
  if (multiBtn) {
    multiBtn.style.display = routableCount >= 1 ? "inline-flex" : "none";
    if (routableCount >= 2) {
      multiBtn.textContent = `🧭 Ruta 3D (${routableCount})`;
    } else if (routableCount === 1) {
      multiBtn.textContent = `🧭 Navegar 3D`;
    }
  }

  if (assignedOrders.length === 0) {
    listEl.innerHTML = `
      <div class="cart-empty" style="background:var(--white);padding:18px 14px;">
        <div style="margin-bottom:12px;">
          No tienes pedidos pendientes asignados por oficina en este momento.
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:8px;max-width:340px;margin:0 auto;">
          <button type="button" class="btn btn-nav-3d btn-sm" data-launch-nearest-nav3d="1" style="padding:11px 14px;font-size:0.86rem;">
            🧭 Navegar 3D a Clientes Cercanos
          </button>
          <button type="button" class="btn btn-outline btn-sm" data-goto-places-pane="1" style="padding:9px 14px;font-size:0.82rem;">
            🏪 Ver Lista de Clientes (${allPlaces.length})
          </button>
        </div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = assignedOrders
    .map((ord) => {
      const resolvedCoords = resolveOrderCoordsSync(ord);
      const mapsUrl = resolvedCoords
        ? `https://www.google.com/maps/dir/?api=1&destination=${resolvedCoords.lat},${resolvedCoords.lng}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ord.address || "")}`;
      const itemsHtml = (ord.items || [])
        .map((i) => `<span class="cal-chip">${i.qty} × ${escapeHtml(i.name)} (${escapeHtml(i.code)})</span>`)
        .join("");
      const isEnRuta = ord.status === "en_ruta";

      return `
        <article class="order-admin-card" style="border-left:5px solid ${isEnRuta ? "#0284c7" : "var(--green-700)"};">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
            <strong style="color:var(--green-950);font-size:1rem;">${escapeHtml(ord.folio || "PEDIDO")}</strong>
            <span class="status-pill status-${escapeHtml(ord.status)}">${isEnRuta ? "En Camino" : "Por Entregar"}</span>
          </div>

          <div style="font-weight:800;font-size:1.05rem;color:var(--slate-900);">${escapeHtml(ord.customerName)}</div>
          <div style="font-size:0.88rem;color:var(--slate-700);margin-top:3px;">📍 ${escapeHtml(ord.address)}</div>
          <div style="font-size:0.82rem;color:var(--slate-500);margin-top:4px;">
            🥑 Madurez pedida: <strong>${escapeHtml(ord.ripeness || "Surtido")}</strong>
            &nbsp;•&nbsp; 🕒 ${escapeHtml(ord.deliveryWindow || "Hoy")}
          </div>
          ${ord.notes ? `<div style="margin-top:6px;background:var(--gold-100);color:#6e470b;padding:6px 10px;border-radius:8px;font-size:0.8rem;">📝 ${escapeHtml(ord.notes)}</div>` : ""}

          <div class="caliber-breakdown-chips" style="margin:10px 0;">${itemsHtml}</div>

          <div style="display:flex;justify-content:space-between;align-items:center;background:var(--green-50);padding:8px 12px;border-radius:10px;margin-bottom:10px;">
            <span style="font-size:0.8rem;font-weight:700;color:var(--slate-700);">COBRAR (${escapeHtml(ord.paymentMethod || "Efectivo")}):</span>
            <strong style="font-size:1.2rem;color:var(--green-950);">${formatCurrency(ord.totalAmount)}</strong>
          </div>

          <div style="display:grid;grid-template-columns:1.4fr 1fr auto;gap:8px;margin-bottom:8px;">
            <button type="button" class="btn btn-nav-3d btn-sm" data-nav3d-order="${escapeHtml(ord.id)}">
              🧭 Navegar 3D
            </button>
            <a href="tel:${escapeHtml(ord.phone)}" class="btn btn-outline btn-sm">📞 Llamar</a>
            <a href="${mapsUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="padding:7px 10px;" title="Abrir en Google Maps">🗺️</a>
          </div>

          <div style="display:grid;grid-template-columns:${isEnRuta ? "1fr" : "1fr 1fr"};gap:8px;">
            ${
              !isEnRuta
                ? `<button type="button" class="btn btn-outline btn-sm" data-start-route="${ord.id}" style="border-color:#0284c7;color:#0284c7;">🚗 Voy en Camino</button>`
                : ""
            }
            <button type="button" class="btn btn-primary btn-sm" data-deliver-order="${ord.id}" style="padding:10px;">
              ✅ Entregar y Cobrar
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

const deliverOrderModal = document.getElementById("deliverOrderModal");
const deliverPayMethod = document.getElementById("deliverPayMethod");
const deliverCreditWrap = document.getElementById("deliverCreditWrap");
const deliverAdvanceInput = document.getElementById("deliverAdvanceInput");

deliverPayMethod.addEventListener("change", () => {
  deliverCreditWrap.style.display = deliverPayMethod.value === "Credito" ? "block" : "none";
});

document.getElementById("btnCloseDeliverModal").addEventListener("click", () => {
  deliverOrderModal.classList.remove("open");
});

document.getElementById("driverAssignedOrdersList").addEventListener("click", async (e) => {
  if (e.target.closest("button[data-launch-nearest-nav3d]")) {
    launchSmartNav3D();
    return;
  }
  if (e.target.closest("button[data-goto-places-pane]")) {
    switchToDriverPane("drvPanePlaces");
    return;
  }

  const nav3dBtn = e.target.closest("button[data-nav3d-order]");
  if (nav3dBtn) {
    const orderId = nav3dBtn.dataset.nav3dOrder;
    const ord = assignedOrders.find((o) => o.id === orderId);
    if (!ord) return;

    let coords = resolveOrderCoordsSync(ord);
    if (!coords) {
      nav3dBtn.disabled = true;
      const prevLabel = nav3dBtn.textContent;
      nav3dBtn.textContent = "🧭 Ubicando...";
      coords = await geocodeOrderAddressFallback(ord);
      nav3dBtn.disabled = false;
      nav3dBtn.textContent = prevLabel;
    }

    if (!coords) {
      showToast("No se encontraron coordenadas exactas; abriendo búsqueda de dirección.");
      window.open(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ord.address || "")}`,
        "_blank",
        "noopener"
      );
      return;
    }

    // Marcar automáticamente "En Camino" si seguía en "confirmado"
    if (ord.status === "confirmado" && currentDriverKeyHash) {
      executeDriverBatch(currentDriverKeyHash, (batch, proofId) => {
        batch.update(doc(db, "orders", ord.id), {
          status: "en_ruta",
          proofId,
          updatedAt: serverTimestamp()
        });
      }).catch(() => {});
    }

    openNav3DModal([buildOrderNavStop(ord, coords)], 0);
    return;
  }

  const startBtn = e.target.closest("button[data-start-route]");
  if (startBtn) {
    const orderId = startBtn.dataset.startRoute;
    try {
      await executeDriverBatch(currentDriverKeyHash, (batch, proofId) => {
        batch.update(doc(db, "orders", orderId), {
          status: "en_ruta",
          proofId,
          updatedAt: serverTimestamp()
        });
      });
      showToast("Marcado como En Camino.");
    } catch (err) {
      console.error(err);
      showToast("Error al actualizar estatus.");
    }
    return;
  }

  const deliverBtn = e.target.closest("button[data-deliver-order]");
  if (deliverBtn) {
    const orderId = deliverBtn.dataset.deliverOrder;
    const ord = assignedOrders.find((o) => o.id === orderId);
    if (!ord) return;
    openDeliverOrderModalForOrder(ord);
  }
});

document.getElementById("deliverOrderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const orderId = document.getElementById("deliverOrderId").value;
  const ord = assignedOrders.find((o) => o.id === orderId);
  if (!ord) {
    deliverOrderModal.classList.remove("open");
    return;
  }

  const payMethod = deliverPayMethod.value;
  const totalAmount = Number(ord.totalAmount) || 0;
  let cashCollected = 0;
  let transferCollected = 0;
  let creditBalance = 0;

  if (payMethod === "Efectivo") {
    cashCollected = totalAmount;
  } else if (payMethod === "Transferencia") {
    transferCollected = totalAmount;
  } else {
    const adv = Math.max(0, Math.min(totalAmount, Math.round(Number(deliverAdvanceInput.value) || 0)));
    cashCollected = adv;
    creditBalance = Math.max(0, totalAmount - adv);
  }

  const boxesByCaliber = { M: 0, P: 0, E: 0, S: 0 };
  for (const item of ord.items || []) {
    if (boxesByCaliber[item.code] !== undefined) {
      boxesByCaliber[item.code] += Number(item.qty) || 0;
    }
  }

  const matchedPlace = findMatchingPlace(ord.customerName, ord.phone);

  const saleRecord = {
    folio: ord.folio || "WEB-" + ord.id.slice(0, 5).toUpperCase(),
    sourceOrderId: ord.id,
    saleType: "pedido_web",
    date: getLocalDateStr(),
    driver: currentDriverName,
    customerName: ord.customerName,
    phone: ord.phone || "",
    ...(matchedPlace ? { placeId: matchedPlace.id } : {}),
    items: ord.items || [],
    boxesByCaliber,
    totalBoxes: Number(ord.totalBoxes) || 0,
    totalAmount,
    paymentMethod: payMethod,
    cashCollected,
    transferCollected,
    creditBalance,
    notes: ord.notes || "Pedido en línea entregado",
    createdAtIso: new Date().toISOString(),
    createdAt: serverTimestamp()
  };

  try {
    await executeDriverBatch(currentDriverKeyHash, (batch, proofId) => {
      batch.update(doc(db, "orders", ord.id), {
        status: "entregado",
        deliveredAtIso: new Date().toISOString(),
        paymentMethodFinal: payMethod,
        proofId,
        updatedAt: serverTimestamp()
      });
      batch.set(doc(db, "route_sales", `ord_${ord.id}`), {
        ...saleRecord,
        proofId
      });
    });

    deliverOrderModal.classList.remove("open");
    markStopDoneInActiveRoute(ord.id);
    openSaleSuccessModal(saleRecord, "¡Pedido Entregado!");
  } catch (err) {
    console.error(err);
    showToast("Error al registrar entrega.");
  }
});

// ================= VIEW 2: STREET SALE FORM =================
function renderStreetSaleCalibers() {
  const container = document.getElementById("streetSaleCalibersContainer");
  if (!container) return;

  const stats = computeMyTrunkAndCorte();
  const orderedCodes = ["S", "E", "P", "M"];

  container.innerHTML = orderedCodes
    .map((code) => {
      const cal = storeSettings.calibers[code] || DEFAULT_STORE_SETTINGS.calibers[code];
      const qty = saleQtys[code] || 0;
      const unitPrice = salePrices[code] || cal.price;
      const minPrice = Number(cal.minPrice) || 1;

      return `
        <div class="driver-sale-cal-row ${qty > 0 ? "active-row" : ""}" data-cal-row="${code}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
            <div>
              <strong style="font-size:0.98rem;color:var(--green-950);">${escapeHtml(code)} · ${escapeHtml(cal.name)}</strong>
              <span style="display:block;font-size:0.73rem;color:var(--slate-500);">
                Lista: ${formatCurrency(cal.price)} • Mín: ${formatCurrency(minPrice)}
              </span>
            </div>
            <span class="ripeness-badge" data-avail-badge="${code}">En carro: ${stats.avail[code] ?? 0}</span>
          </div>

          <div class="driver-cal-controls">
            <div class="stepper">
              <button type="button" data-step-code="${code}" data-delta="-1">−</button>
              <input type="number" min="0" max="500" inputmode="numeric" data-qty-code="${code}" value="${qty}">
              <button type="button" data-step-code="${code}" data-delta="1">+</button>
            </div>

            <div class="driver-price-box">
              <span class="lbl">$/caja</span>
              <input type="number" min="${minPrice}" max="9999" inputmode="numeric" class="form-control" data-price-code="${code}" value="${unitPrice}">
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  recalcStreetSaleTotals();
}

document.getElementById("streetSaleCalibersContainer").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-step-code]");
  if (!btn) return;
  const code = btn.dataset.stepCode;
  const delta = Number(btn.dataset.delta) || 0;
  saleQtys[code] = Math.max(0, (saleQtys[code] || 0) + delta);

  const qtyInput = document.querySelector(`input[data-qty-code="${code}"]`);
  if (qtyInput) qtyInput.value = String(saleQtys[code]);

  const row = document.querySelector(`[data-cal-row="${code}"]`);
  if (row) row.classList.toggle("active-row", saleQtys[code] > 0);

  recalcStreetSaleTotals();
});

document.getElementById("streetSaleCalibersContainer").addEventListener("input", (e) => {
  const qtyInp = e.target.closest("input[data-qty-code]");
  if (qtyInp) {
    const code = qtyInp.dataset.qtyCode;
    saleQtys[code] = Math.max(0, Math.floor(Number(qtyInp.value) || 0));
    const row = document.querySelector(`[data-cal-row="${code}"]`);
    if (row) row.classList.toggle("active-row", saleQtys[code] > 0);
    recalcStreetSaleTotals();
    return;
  }

  const priceInp = e.target.closest("input[data-price-code]");
  if (priceInp) {
    const code = priceInp.dataset.priceCode;
    salePrices[code] = Math.max(0, Math.round(Number(priceInp.value) || 0));
    recalcStreetSaleTotals();
  }
});

document.getElementById("salePayMethodGroup").addEventListener("click", (e) => {
  const btn = e.target.closest(".pay-pill-btn");
  if (!btn) return;
  document.querySelectorAll(".pay-pill-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
  salePayMethod = btn.dataset.pay;

  const isCredit = salePayMethod === "Credito";
  document.getElementById("creditFieldsWrap").style.display = isCredit ? "block" : "none";
  const phoneInput = document.getElementById("saleClientPhone");
  const phoneReqLabel = document.getElementById("phoneReqLabel");

  phoneInput.required = isCredit;
  phoneReqLabel.textContent = isCredit ? "(obligatorio para crédito)" : "(opcional para nota digital)";
  phoneReqLabel.style.color = isCredit ? "var(--red-600)" : "var(--slate-500)";

  recalcStreetSaleTotals();
});

document.getElementById("saleAdvanceInput").addEventListener("input", () => {
  recalcStreetSaleTotals();
});

function recalcStreetSaleTotals() {
  let totalBoxes = 0;
  let totalAmount = 0;

  for (const code of ["S", "E", "P", "M"]) {
    const q = saleQtys[code] || 0;
    const p = salePrices[code] || 0;
    totalBoxes += q;
    totalAmount += q * p;
  }

  document.getElementById("saleBoxesSummary").textContent = `${totalBoxes} caja${totalBoxes === 1 ? "" : "s"}`;
  document.getElementById("saleTotalSummary").textContent = formatCurrency(totalAmount);

  if (salePayMethod === "Credito") {
    const adv = Math.max(0, Math.min(totalAmount, Math.round(Number(document.getElementById("saleAdvanceInput").value) || 0)));
    document.getElementById("saleBalancePreview").textContent = formatCurrency(Math.max(0, totalAmount - adv));
  }

  const submitBtn = document.getElementById("btnSubmitStreetSale");
  if (totalBoxes > 0) {
    submitBtn.disabled = false;
    submitBtn.textContent = `Registrar Venta (${formatCurrency(totalAmount)})`;
  } else {
    submitBtn.disabled = true;
    submitBtn.textContent = "Selecciona al menos 1 caja";
  }
}

function generateRouteFolio() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(100 + Math.random() * 900);
  return `RUT-${mm}${dd}-${rand}`;
}

function loadRecentClientsDatalist() {
  try {
    const localList = JSON.parse(localStorage.getItem(RECENT_CLIENTS_KEY) || "[]");
    const seen = new Set();
    const merged = [];

    for (const p of allPlaces) {
      const k = String(p.name || "").toLowerCase();
      if (k && !seen.has(k)) {
        seen.add(k);
        merged.push({ name: p.name, phone: p.phone || "" });
      }
    }
    for (const c of localList) {
      const k = String(c.name || "").toLowerCase();
      if (k && !seen.has(k)) {
        seen.add(k);
        merged.push({ name: c.name, phone: c.phone || "" });
      }
    }

    const dl = document.getElementById("recentClientsDatalist");
    if (dl) {
      dl.innerHTML = merged
        .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.phone || "")}</option>`)
        .join("");
    }
  } catch (_) {}
}

function rememberClient(name, phone) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_CLIENTS_KEY) || "[]");
    const filtered = list.filter((c) => c.name.toLowerCase() !== name.toLowerCase());
    filtered.unshift({ name, phone });
    localStorage.setItem(RECENT_CLIENTS_KEY, JSON.stringify(filtered.slice(0, 80)));
    loadRecentClientsDatalist();
  } catch (_) {}
}

document.getElementById("saleClientName").addEventListener("input", (e) => {
  const val = e.target.value.trim();
  const matchedPlace = findMatchingPlace(val, "");
  const badge = document.getElementById("saleLinkedPlaceBadge");
  const placeInp = document.getElementById("saleSelectedPlaceId");
  const phoneEl = document.getElementById("saleClientPhone");

  if (matchedPlace) {
    placeInp.value = matchedPlace.id;
    badge.style.display = "block";
    badge.textContent = `✓ Vinculado en el mapa: ${matchedPlace.name}`;
    if (matchedPlace.phone && !phoneEl.value) {
      phoneEl.value = matchedPlace.phone;
    }
  } else {
    placeInp.value = "";
    badge.style.display = "none";
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_CLIENTS_KEY) || "[]");
      const found = list.find((c) => c.name.toLowerCase() === val.toLowerCase());
      if (found && found.phone && !phoneEl.value) phoneEl.value = found.phone;
    } catch (_) {}
  }
});

document.getElementById("streetSaleForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const customerName = document.getElementById("saleClientName").value.trim();
  const phone = document.getElementById("saleClientPhone").value.trim();
  const notes = document.getElementById("saleNotes").value.trim();
  const explicitPlaceId = document.getElementById("saleSelectedPlaceId").value;

  if (!customerName) {
    showToast("Escribe el nombre del cliente o negocio.");
    return;
  }

  if (salePayMethod === "Credito" && phone.replace(/\D/g, "").length < 8) {
    showToast("Para ventas a crédito es obligatorio anotar el teléfono del cliente.");
    return;
  }

  const items = [];
  const boxesByCaliber = { M: 0, P: 0, E: 0, S: 0 };
  let totalBoxes = 0;
  let totalAmount = 0;

  for (const code of ["S", "E", "P", "M"]) {
    const qty = saleQtys[code] || 0;
    if (qty <= 0) continue;

    const cal = storeSettings.calibers[code] || DEFAULT_STORE_SETTINGS.calibers[code];
    const minPrice = Number(cal.minPrice) || 1;
    const unitPrice = salePrices[code] || 0;

    if (unitPrice < minPrice) {
      showToast(`El precio mínimo autorizado para ${cal.name} es ${formatCurrency(minPrice)}.`);
      return;
    }

    const subtotal = qty * unitPrice;
    items.push({ code, name: cal.name, qty, unitPrice, subtotal });
    boxesByCaliber[code] = qty;
    totalBoxes += qty;
    totalAmount += subtotal;
  }

  if (totalBoxes <= 0) {
    showToast("Agrega al menos 1 caja.");
    return;
  }

  let cashCollected = 0;
  let transferCollected = 0;
  let creditBalance = 0;

  if (salePayMethod === "Efectivo") {
    cashCollected = totalAmount;
  } else if (salePayMethod === "Transferencia") {
    transferCollected = totalAmount;
  } else {
    const adv = Math.max(0, Math.min(totalAmount, Math.round(Number(document.getElementById("saleAdvanceInput").value) || 0)));
    cashCollected = adv;
    creditBalance = Math.max(0, totalAmount - adv);
  }

  const matchedPlace = explicitPlaceId
    ? allPlaces.find((p) => p.id === explicitPlaceId)
    : findMatchingPlace(customerName, phone);

  const folio = generateRouteFolio();
  const saleRecord = {
    folio,
    saleType: "calle",
    date: getLocalDateStr(),
    driver: currentDriverName,
    customerName,
    phone,
    ...(matchedPlace ? { placeId: matchedPlace.id } : {}),
    ...(lastGpsCoords ? { saleLat: lastGpsCoords.lat, saleLng: lastGpsCoords.lng } : {}),
    items,
    boxesByCaliber,
    totalBoxes,
    totalAmount,
    paymentMethod: salePayMethod,
    cashCollected,
    transferCollected,
    creditBalance,
    notes,
    createdAtIso: new Date().toISOString(),
    createdAt: serverTimestamp()
  };

  const submitBtn = document.getElementById("btnSubmitStreetSale");
  submitBtn.disabled = true;
  submitBtn.textContent = "Guardando venta...";

  try {
    const newSaleRef = doc(collection(db, "route_sales"));
    await executeDriverBatch(currentDriverKeyHash, (batch, proofId) => {
      batch.set(newSaleRef, { ...saleRecord, proofId });
    });

    rememberClient(customerName, phone);

    saleQtys = { S: 0, E: 0, P: 0, M: 0 };
    syncDefaultSalePrices();
    document.getElementById("saleSelectedPlaceId").value = "";
    document.getElementById("saleLinkedPlaceBadge").style.display = "none";
    document.getElementById("saleClientName").value = "";
    document.getElementById("saleClientPhone").value = "";
    document.getElementById("saleNotes").value = "";
    document.getElementById("saleAdvanceInput").value = "0";
    renderStreetSaleCalibers();
    if (matchedPlace?.id) markStopDoneInActiveRoute(matchedPlace.id);
    openSaleSuccessModal(saleRecord, "¡Venta Registrada!");
  } catch (err) {
    console.error("Error guardando venta en ruta:", err);
    showToast("Error al guardar la venta. Verifica tu conexión.");
    recalcStreetSaleTotals();
  }
});

// ================= DIGITAL WHATSAPP RECEIPT & MI CORTE LIST =================
function buildDigitalReceiptWhatsAppUrl(sale) {
  const cleanPhone = cleanPhoneForWhatsApp(sale.phone);
  const itemsLines = (sale.items || [])
    .map((i) => `• ${i.qty} × ${i.name} (${formatCurrency(i.unitPrice)}) = ${formatCurrency(i.subtotal)}`)
    .join("\n");

  let payLine = `*Pagado (${sale.paymentMethod}):* ${formatCurrency(sale.totalAmount)}`;
  if (sale.creditBalance > 0) {
    payLine =
      `*Total Nota:* ${formatCurrency(sale.totalAmount)}\n` +
      `*Anticipo recibido:* ${formatCurrency(sale.cashCollected)}\n` +
      `*Saldo pendiente (Crédito):* ${formatCurrency(sale.creditBalance)}`;
  }

  const msg =
    `🥑 *NOTA DE VENTA — COMERCIALIZADORA SALINAS*\n` +
    `*Folio:* ${sale.folio}\n` +
    `*Cliente:* ${sale.customerName}\n` +
    `*Atendió:* ${sale.driver}\n\n` +
    `${itemsLines}\n\n` +
    `${payLine}\n\n` +
    `_“La lealtad es escasa en estos tiempos y nosotros la valoramos. Gracias por tu lealtad.”_`;

  return cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

const saleSuccessModal = document.getElementById("saleSuccessModal");

function openSaleSuccessModal(sale, titleText) {
  document.getElementById("saleModalTitle").textContent = titleText;
  document.getElementById("saleModalDesc").textContent =
    `${sale.folio} • ${sale.customerName} (${sale.totalBoxes} cajas • ${formatCurrency(sale.totalAmount)})`;
  document.getElementById("saleModalWhatsappBtn").href = buildDigitalReceiptWhatsAppUrl(sale);
  saleSuccessModal.classList.add("open");
}

document.getElementById("btnCloseSaleModal").addEventListener("click", () => {
  saleSuccessModal.classList.remove("open");
});
document.getElementById("btnDoneSaleModal").addEventListener("click", () => {
  saleSuccessModal.classList.remove("open");
});

function renderTodaySalesList() {
  const container = document.getElementById("driverTodaySalesList");
  if (!container) return;

  if (mySalesToday.length === 0) {
    container.innerHTML = `<div class="cart-empty" style="background:var(--white);">Aún no has registrado ventas hoy.</div>`;
    return;
  }

  container.innerHTML = mySalesToday
    .map((s) => {
      const timeStr = s.createdAtIso
        ? new Date(s.createdAtIso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
        : "";
      const summaryItems = (s.items || []).map((i) => `${i.qty}${i.code}`).join(" + ");

      return `
        <div class="corte-summary-box" style="padding:13px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div>
              <strong style="color:var(--green-950);font-size:0.96rem;">${escapeHtml(s.customerName)}</strong>
              <div style="font-size:0.76rem;color:var(--slate-500);">${escapeHtml(s.folio)} • ${escapeHtml(timeStr)} • ${escapeHtml(s.paymentMethod)}</div>
            </div>
            <strong style="font-size:1.05rem;color:var(--green-900);">${formatCurrency(s.totalAmount)}</strong>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;padding-top:8px;border-top:1px dashed var(--slate-200);flex-wrap:wrap;">
            <div style="font-size:0.8rem;color:var(--slate-700);">
              📦 <strong>${s.totalBoxes} cajas</strong> (${escapeHtml(summaryItems)})
              ${s.creditBalance > 0 ? `<span style="display:block;color:var(--red-600);font-weight:800;">Resta crédito: ${formatCurrency(s.creditBalance)}</span>` : ""}
            </div>
            <a href="${buildDigitalReceiptWhatsAppUrl(s)}" target="_blank" rel="noopener" class="btn btn-whatsapp btn-sm" style="padding:6px 10px;font-size:0.76rem;">
              📲 Nota WhatsApp
            </a>
          </div>
        </div>
      `;
    })
    .join("");
}

const driverHelpModal = document.getElementById("driverHelpModal");
document.getElementById("btnOpenDriverHelp")?.addEventListener("click", () => {
  if (!currentDriverKeyHash) return;
  const container = document.getElementById("driverHelpStepsContainer");
  const m = STAFF_MANUALS.ventas;
  if (container && m) {
    container.innerHTML = m.steps
      .map(
        (st) => `
        <div class="manual-step-card" style="padding:12px;margin-bottom:10px;">
          <div style="font-weight:800;color:var(--green-950);font-size:0.94rem;margin-bottom:4px;">
            ${st.icon} ${escapeHtml(st.heading)}
          </div>
          <div style="font-size:0.82rem;color:var(--slate-700);line-height:1.55;">
            ${st.bodyHtml}
          </div>
          ${st.example ? `<div class="manual-example-box" style="margin-top:8px;">💡 ${escapeHtml(st.example)}</div>` : ""}
        </div>
      `
      )
      .join("");
  }
  if (driverHelpModal) driverHelpModal.classList.add("open");
});

document.getElementById("btnCloseDriverHelp")?.addEventListener("click", () => {
  if (driverHelpModal) driverHelpModal.classList.remove("open");
});

let activeRouteDoc = null;
let activeRouteStops = [];
let routeDocUnsub = null;
let lastSeenRouteUpdatedIso = "";
let drvRbSelectedIds = new Set();
let drvRbFilterMode = "pending";

restoreDriverSession();

// ================= RUTA ACTIVA DEL DÍA & CONSTRUCTOR DEL CHOFER =================
function getDriverBaseLocation() {
  const b = storeSettings?.baseLocation || DEFAULT_STORE_SETTINGS.baseLocation;
  if (b && Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng))) {
    return {
      id: "__base__",
      kind: "base",
      name: `🏭 ${b.name || "Base / Bodega Salinas"}`,
      address: b.address || "",
      subtitle: "Regreso a Base / Bodega",
      lat: Number(b.lat),
      lng: Number(b.lng),
      pinEmoji: "🏭",
      actionLabel: "🏭 Llegué a Base",
      arrivalActionLabel: "🏭 Fin en Base"
    };
  }
  return {
    id: "__base__",
    kind: "base",
    name: "🏭 Base / Bodega Salinas",
    address: "",
    subtitle: "Regreso a Base / Bodega",
    lat: 25.407054,
    lng: -100.954645,
    pinEmoji: "🏭",
    actionLabel: "🏭 Llegué a Base",
    arrivalActionLabel: "🏭 Fin en Base"
  };
}

function buildNavStopsFromActiveRoute() {
  const pending = activeRouteStops.filter((s) => s.status !== "done");
  const list = [...pending];
  if (activeRouteDoc?.includeReturnToBase !== false && list.length > 0) {
    list.push(getDriverBaseLocation());
  }
  return list;
}

function subscribeDriverRouteListener() {
  if (routeDocUnsub) {
    routeDocUnsub();
    routeDocUnsub = null;
  }
  if (!currentDriverName) return;
  const docId = `${getLocalDateStr()}_${driverSlug(currentDriverName)}`;
  routeDocUnsub = onSnapshot(doc(db, "driver_routes", docId), (snap) => {
    if (!snap.exists()) {
      activeRouteDoc = null;
      activeRouteStops = [];
      renderDriverActiveRouteCard();
      return;
    }
    const data = snap.data();
    const prevCount = activeRouteStops.length;
    activeRouteDoc = data;
    activeRouteStops = Array.isArray(data.stops) ? data.stops : [];
    renderDriverActiveRouteCard();

    const updatedIso = data.updatedAtIso || "";
    const isAdminUpdate = data.createdBy === "admin" && updatedIso && updatedIso !== lastSeenRouteUpdatedIso;
    if (lastSeenRouteUpdatedIso && isAdminUpdate && activeRouteStops.length >= prevCount) {
      const banner = document.getElementById("driverLastMinuteBanner");
      const txt = document.getElementById("driverLastMinuteText");
      if (banner && txt) {
        txt.textContent = data.lastMinuteAddedAtIso
          ? `⚡ ¡Parada de último minuto agregada por Admin! (${activeRouteStops.filter((s) => s.status !== "done").length} pendientes)`
          : `🗺️ Admin actualizó tu ruta (${activeRouteStops.filter((s) => s.status !== "done").length} paradas).`;
        banner.style.display = "block";
      }
      try { navigator.vibrate?.([160, 80, 160]); } catch (_) {}
      showToast("🗺️ Tu ruta fue actualizada por Admin.");

      // Si el navegador 3D ya está abierto, actualizar las paradas en caliente sin cerrar el mapa
      if (isNav3DOpen) {
        const frame = document.getElementById("rpNavEmbedFrame");
        const navStops = buildNavStopsFromActiveRoute();
        if (frame?.contentWindow && navStops.length > 0) {
          pendingNav3DPayload = { stops: navStops, activeStopIndex: 0 };
          frame.contentWindow.postMessage(
            {
              type: "RP_NAV_UPDATE_STOPS",
              stops: navStops,
              destination: navStops[0],
              activeStopIndex: 0
            },
            RP_NAV_EMBED_ORIGIN
          );
        }
      }
    }
    lastSeenRouteUpdatedIso = updatedIso;
  });
}

function renderDriverActiveRouteCard() {
  const metaEl = document.getElementById("drvRouteMetaText");
  const listEl = document.getElementById("driverActiveRouteList");
  const footerEl = document.getElementById("driverActiveRouteFooter");
  if (!metaEl || !listEl || !footerEl) return;

  if (activeRouteStops.length === 0) {
    metaEl.textContent = "Sin ruta armada aún • Toca 'Armar / Editar' o pide a Admin";
    listEl.innerHTML = "";
    footerEl.style.display = "none";
    return;
  }

  const pending = activeRouteStops.filter((s) => s.status !== "done");
  const distStr = activeRouteDoc?.totalDistanceMeters ? ` • ${formatRouteKm(activeRouteDoc.totalDistanceMeters)}` : "";
  const durStr = activeRouteDoc?.totalDurationSec ? ` • ~${formatRouteMin(activeRouteDoc.totalDurationSec)}` : "";
  const baseStr = activeRouteDoc?.includeReturnToBase !== false ? " • 🏠 +Base" : "";
  metaEl.textContent = `${pending.length} pendiente${pending.length === 1 ? "" : "s"} de ${activeRouteStops.length}${distStr}${durStr}${baseStr}`;

  listEl.innerHTML = activeRouteStops
    .map((st, idx) => {
      const isDone = st.status === "done";
      return `
        <div class="route-stop-row ${isDone ? "is-done" : ""}" data-stop-idx="${idx}">
          <span class="route-drag-handle" title="Arrastrar">⋮⋮</span>
          <span class="route-stop-num">${isDone ? "✓" : idx + 1}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.85rem;font-weight:800;color:var(--green-950);line-height:1.25;word-break:break-word;">
              ${escapeHtml(st.name || "Parada")}
            </div>
            <div style="font-size:0.72rem;color:var(--slate-500);line-height:1.25;margin-top:2px;word-break:break-word;">
              ${escapeHtml(st.subtitle || st.address || "")}
            </div>
          </div>
          <div style="display:flex;gap:3px;flex-shrink:0;">
            <button type="button" class="route-mini-btn" data-drv-rt-move="-1" data-drv-rt-idx="${idx}">▲</button>
            <button type="button" class="route-mini-btn" data-drv-rt-move="1" data-drv-rt-idx="${idx}">▼</button>
            <button type="button" class="route-mini-btn" data-drv-rt-toggle="${idx}" title="Marcar listo / pendiente">${isDone ? "↩️" : "✓"}</button>
          </div>
        </div>
      `;
    })
    .join("");

  footerEl.style.display = pending.length > 0 ? "flex" : "none";

  attachTouchDragSort(listEl, ".route-stop-row", ".route-drag-handle", async (newOrder) => {
    activeRouteStops = newOrder.map((i) => activeRouteStops[i]).filter(Boolean);
    renderDriverActiveRouteCard();
    await persistDriverActiveRoute("driver");
  });
}

async function persistDriverActiveRoute(createdBy = "driver", includeReturnOverride = null) {
  if (!currentDriverKeyHash || !currentDriverName) return;
  const incBase =
    includeReturnOverride !== null
      ? includeReturnOverride
      : activeRouteDoc?.includeReturnToBase !== false;
  const startCoord = lastGpsCoords || getDriverBaseLocation();
  const endCoord = incBase ? getDriverBaseLocation() : null;
  const metrics = await computeOrderedRouteMetrics({
    startCoord,
    stops: activeRouteStops.filter((s) => s.status !== "done"),
    endCoord
  });

  const docId = `${getLocalDateStr()}_${driverSlug(currentDriverName)}`;
  const payload = {
    driverName: currentDriverName,
    driverSlug: driverSlug(currentDriverName),
    date: getLocalDateStr(),
    includeReturnToBase: incBase,
    baseLocation: getDriverBaseLocation(),
    stops: activeRouteStops,
    totalDistanceMeters: metrics.distanceMeters,
    totalDurationSec: metrics.durationSec,
    createdBy,
    updatedAtIso: new Date().toISOString()
  };

  await executeDriverBatch(currentDriverKeyHash, (batch, proofId) => {
    batch.set(doc(db, "driver_routes", docId), { ...payload, proofId, updatedAt: serverTimestamp() }, { merge: true });
  });
}

async function markStopDoneInActiveRoute(targetId) {
  if (!targetId || activeRouteStops.length === 0) return;
  let changed = false;
  activeRouteStops = activeRouteStops.map((s) => {
    if (s.id === targetId && s.status !== "done") {
      changed = true;
      return { ...s, status: "done", doneAtIso: new Date().toISOString() };
    }
    return s;
  });
  if (changed) {
    renderDriverActiveRouteCard();
    await persistDriverActiveRoute("driver").catch(() => {});
  }
}

document.getElementById("btnDismissLastMinute")?.addEventListener("click", () => {
  const b = document.getElementById("driverLastMinuteBanner");
  if (b) b.style.display = "none";
});

document.getElementById("driverActiveRouteList")?.addEventListener("click", async (e) => {
  const mv = e.target.closest("button[data-drv-rt-move]");
  if (mv) {
    const idx = Number(mv.dataset.drvRtIdx);
    const next = idx + Number(mv.dataset.drvRtMove);
    if (next < 0 || next >= activeRouteStops.length) return;
    const tmp = activeRouteStops[idx];
    activeRouteStops[idx] = activeRouteStops[next];
    activeRouteStops[next] = tmp;
    renderDriverActiveRouteCard();
    await persistDriverActiveRoute("driver");
    return;
  }
  const tog = e.target.closest("button[data-drv-rt-toggle]");
  if (tog) {
    const idx = Number(tog.dataset.drvRtToggle);
    if (!activeRouteStops[idx]) return;
    activeRouteStops[idx].status = activeRouteStops[idx].status === "done" ? "pending" : "done";
    renderDriverActiveRouteCard();
    await persistDriverActiveRoute("driver");
  }
});

document.getElementById("btnStartActiveRoute3D")?.addEventListener("click", () => {
  const navStops = buildNavStopsFromActiveRoute();
  if (navStops.length === 0) {
    showToast("No quedan paradas pendientes en tu ruta.");
    return;
  }
  openNav3DModal(navStops, 0);
});

document.getElementById("btnReoptimizeActiveRoute")?.addEventListener("click", async () => {
  const done = activeRouteStops.filter((s) => s.status === "done");
  const pending = activeRouteStops.filter((s) => s.status !== "done");
  if (pending.length < 2) {
    showToast("Se necesitan al menos 2 paradas pendientes para reordenar.");
    return;
  }
  const btn = document.getElementById("btnReoptimizeActiveRoute");
  btn.disabled = true;
  btn.textContent = "⏳...";
  try {
    const startCoord = lastGpsCoords || getDriverBaseLocation();
    const incBase = activeRouteDoc?.includeReturnToBase !== false;
    const endCoord = incBase ? getDriverBaseLocation() : null;
    const res = await optimizeStopsWithOsrm({ startCoord, stops: pending, endCoord });
    activeRouteStops = [...done, ...res.orderedStops];
    renderDriverActiveRouteCard();
    await persistDriverActiveRoute("driver");
    showToast(`⚡ Ruta reordenada (${formatRouteKm(res.distanceMeters)} • ${formatRouteMin(res.durationSec)}).`);
  } finally {
    btn.disabled = false;
    btn.textContent = "⚡ Reordenar";
  }
});

// Modal Constructor del Chofer
const drvRbModal = document.getElementById("driverRouteBuilderModal");

function renderDriverRouteBuilderChecklist() {
  const box = document.getElementById("drvRbPlacesChecklist");
  const metricsEl = document.getElementById("drvRbSelectedMetrics");
  if (!box) return;
  const q = document.getElementById("drvRbSearch")?.value.trim() || "";

  const valid = allPlaces
    .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
    .filter((p) => {
      if (drvRbFilterMode === "pending" && getPlaceStatusToday(p).code !== "pending") return false;
      const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.tienda;
      return matchesSmartSearch(`${p.name || ""} ${p.address || ""} ${p.phone || ""} ${cat.label || ""}`, q);
    })
    .map((p) => ({
      ...p,
      dist: lastGpsCoords ? haversineMeters(lastGpsCoords.lat, lastGpsCoords.lng, p.lat, p.lng) : null
    }))
    .sort((a, b) => (a.dist ?? 999999) - (b.dist ?? 999999));

  if (metricsEl) {
    metricsEl.textContent = `${drvRbSelectedIds.size} seleccionada${drvRbSelectedIds.size === 1 ? "" : "s"}`;
  }

  box.innerHTML = valid.length
    ? valid
        .map((p) => {
          const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.tienda;
          const checked = drvRbSelectedIds.has(p.id) ? "checked" : "";
          const dTxt = p.dist !== null ? (p.dist < 1000 ? `${p.dist} m` : `${(p.dist / 1000).toFixed(1)} km`) : "";
          return `
            <label class="route-pick-result-item" style="cursor:pointer;padding:10px 8px;">
              <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
                <input type="checkbox" data-drv-rb-chk="${escapeHtml(p.id)}" ${checked} style="width:19px;height:19px;accent-color:#15803d;flex-shrink:0;margin:0;">
                <div style="min-width:0;flex:1;">
                  <strong style="display:block;font-size:0.86rem;color:var(--green-950);line-height:1.25;word-break:break-word;">${cat.emoji} ${escapeHtml(p.name)}</strong>
                  <span style="font-size:0.74rem;color:var(--slate-500);display:block;margin-top:2px;">${escapeHtml(cat.label)}${dTxt ? ` • ${dTxt}` : ""}</span>
                </div>
              </div>
            </label>
          `;
        })
        .join("")
    : `<div style="padding:14px;text-align:center;font-size:0.82rem;color:var(--slate-500);">Sin tiendas para mostrar con ese filtro.</div>`;
}

document.getElementById("btnOpenDriverRouteBuilder")?.addEventListener("click", () => {
  drvRbSelectedIds = new Set(activeRouteStops.filter((s) => s.kind === "place" && s.status !== "done").map((s) => s.id));
  renderDriverRouteBuilderChecklist();
  if (drvRbModal) drvRbModal.classList.add("open");
});

document.getElementById("btnCloseDriverRouteBuilder")?.addEventListener("click", () => {
  if (drvRbModal) drvRbModal.classList.remove("open");
});

document.getElementById("drvRbSearch")?.addEventListener("input", renderDriverRouteBuilderChecklist);

document.getElementById("drvRbFilterPending")?.addEventListener("click", () => {
  drvRbFilterMode = "pending";
  document.getElementById("drvRbFilterPending").className = "btn btn-primary btn-sm";
  document.getElementById("drvRbFilterAll").className = "btn btn-outline btn-sm";
  renderDriverRouteBuilderChecklist();
});

document.getElementById("drvRbFilterAll")?.addEventListener("click", () => {
  drvRbFilterMode = "all";
  document.getElementById("drvRbFilterAll").className = "btn btn-primary btn-sm";
  document.getElementById("drvRbFilterPending").className = "btn btn-outline btn-sm";
  renderDriverRouteBuilderChecklist();
});

document.getElementById("drvRbPlacesChecklist")?.addEventListener("change", (e) => {
  const chk = e.target.closest("input[data-drv-rb-chk]");
  if (!chk) return;
  const id = chk.dataset.drvRbChk;
  if (chk.checked) drvRbSelectedIds.add(id);
  else drvRbSelectedIds.delete(id);
  const metricsEl = document.getElementById("drvRbSelectedMetrics");
  if (metricsEl) metricsEl.textContent = `${drvRbSelectedIds.size} seleccionada${drvRbSelectedIds.size === 1 ? "" : "s"}`;
});

async function buildAndSaveDriverCustomRoute(openNavAfter = false) {
  if (drvRbSelectedIds.size === 0) {
    showToast("Palomea al menos 1 tienda primero.");
    return;
  }
  const chosenPlaces = allPlaces.filter((p) => drvRbSelectedIds.has(p.id) && typeof p.lat === "number" && typeof p.lng === "number");
  const rawStops = chosenPlaces.map((p) => {
    const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.tienda;
    return {
      id: p.id,
      kind: "place",
      name: `${cat.emoji} ${p.name}`,
      address: p.address || "",
      subtitle: `${cat.label}${p.address ? ` • ${p.address}` : ""}`,
      lat: p.lat,
      lng: p.lng,
      status: "pending",
      pinEmoji: "🥑",
      actionLabel: "➕ Vender / Cobrar",
      arrivalActionLabel: "➕ Vender Aquí"
    };
  });

  const startCoord = lastGpsCoords || getDriverBaseLocation();
  const incBase = document.getElementById("drvRbReturnBaseChk")?.checked !== false;
  const endCoord = incBase ? getDriverBaseLocation() : null;
  const res = await optimizeStopsWithOsrm({ startCoord, stops: rawStops, endCoord });

  const donePrev = activeRouteStops.filter((s) => s.status === "done");
  activeRouteStops = [...donePrev, ...res.orderedStops];
  renderDriverActiveRouteCard();
  await persistDriverActiveRoute("driver", incBase);

  const metricsEl = document.getElementById("drvRbSelectedMetrics");
  if (metricsEl) metricsEl.textContent = `${res.orderedStops.length} • ${formatRouteKm(res.distanceMeters)} • ${formatRouteMin(res.durationSec)}`;
  showToast(`⚡ Ruta optimizada (${formatRouteKm(res.distanceMeters)} • ${formatRouteMin(res.durationSec)}).`);

  if (openNavAfter) {
    if (drvRbModal) drvRbModal.classList.remove("open");
    const navStops = buildNavStopsFromActiveRoute();
    if (navStops.length > 0) openNav3DModal(navStops, 0);
  }
}

document.getElementById("btnDrvRbOptimize")?.addEventListener("click", () => buildAndSaveDriverCustomRoute(false));
document.getElementById("btnDrvRbSaveAndNav")?.addEventListener("click", () => buildAndSaveDriverCustomRoute(true));
