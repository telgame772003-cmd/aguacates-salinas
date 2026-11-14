import {
  db,
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
  haversineMeters,
  computeDriverPinHash,
  executeDriverBatch,
  getLocalDateStr,
  formatCurrency,
  cleanPhoneForWhatsApp
} from "./firebase-config.js";
import { STAFF_MANUALS } from "./manuals-data.js";

const DRIVER_SESSION_KEY = "salinas_driver_session_v1";
const RECENT_CLIENTS_KEY = "salinas_driver_clients_v1";

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
let gpsActive = false;
let lastGpsSentAt = 0;
let lastGpsCoords = null;
let myTrailToday = [];
let wakeLockSentinel = null;

// Temporary GPS coords for New Place Modal
let pendingNewPlaceCoords = null;

// DOM Elements
const driverLoginView = document.getElementById("driverLoginView");
const driverAppMain = document.getElementById("driverAppMain");
const driverBottomNav = document.getElementById("driverBottomNav");
const driverTopActions = document.getElementById("driverTopActions");
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
  await stopGpsSharing(true);
  if (whUnsub) whUnsub();
  if (ordersUnsub) ordersUnsub();
  if (salesUnsub) salesUnsub();
  if (placesUnsub) placesUnsub();
  if (visitsUnsub) visitsUnsub();

  currentDriverName = null;
  currentDriverKeyHash = null;
  localStorage.removeItem(DRIVER_SESSION_KEY);
  sessionStorage.removeItem(DRIVER_SESSION_KEY);

  driverAppMain.style.display = "none";
  driverBottomNav.style.display = "none";
  driverTopActions.style.display = "none";
  topDriverName.textContent = "Modo Chofer";
  driverLoginView.style.display = "flex";
});

async function enterDriverApp() {
  driverLoginView.style.display = "none";
  driverAppMain.style.display = "block";
  driverBottomNav.style.display = "grid";
  driverTopActions.style.display = "flex";
  topDriverName.textContent = `🚗 ${currentDriverName}`;

  loadRecentClientsDatalist();
  syncDefaultSalePrices();
  renderStreetSaleCalibers();
  startDriverListeners();

  // Preload today's existing trail if any so we append instead of resetting
  try {
    const locSnap = await getDoc(doc(db, "driver_locations", driverSlug(currentDriverName)));
    if (locSnap.exists()) {
      const ld = locSnap.data();
      if (ld.trailDate === getLocalDateStr() && Array.isArray(ld.trail)) {
        myTrailToday = ld.trail;
      }
    }
  } catch (_) {}

  if (!gpsActive && localStorage.getItem("salinas_gps_manual_pause") !== "1") {
    startGpsSharing();
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

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && gpsActive) {
    requestRouteWakeLock();
  }
});

btnToggleGps.addEventListener("click", () => {
  if (gpsActive) {
    localStorage.setItem("salinas_gps_manual_pause", "1");
    stopGpsSharing(true);
  } else {
    localStorage.removeItem("salinas_gps_manual_pause");
    startGpsSharing();
  }
});

function startGpsSharing() {
  if (!("geolocation" in navigator)) {
    showToast("Tu navegador no soporta GPS.");
    return;
  }

  gpsActive = true;
  btnToggleGps.classList.add("active");
  gpsDot.textContent = "🟢";
  gpsLabel.textContent = "GPS En Vivo";
  requestRouteWakeLock();
  showToast("GPS activo: Administración supervisa tu recorrido en tiempo real.");

  gpsWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const now = Date.now();
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      const { accuracy, speed } = pos.coords;

      const prevCoords = lastGpsCoords;
      lastGpsCoords = { lat, lng };
      renderPlacesList();

      // Throttle Firestore writes to ~15s unless moved >= 35m
      if (lastGpsSentAt && now - lastGpsSentAt < 15000 && prevCoords) {
        const movedM = haversineMeters(prevCoords.lat, prevCoords.lng, lat, lng) || 0;
        if (movedM < 35) return;
      }

      lastGpsSentAt = now;
      if (!currentDriverKeyHash || !currentDriverName) return;

      const currDate = getLocalDateStr();
      if (currDate !== todayStr) {
        myTrailToday = [];
      }

      // Append to daily route trail if moved >= 35m from last trail point
      const lastTrailPt = myTrailToday[myTrailToday.length - 1];
      const distFromLastTrail = lastTrailPt
        ? haversineMeters(lastTrailPt.lat, lastTrailPt.lng, lat, lng)
        : 9999;

      if (!lastTrailPt || (distFromLastTrail !== null && distFromLastTrail >= 35)) {
        const hhmm = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
        myTrailToday.push({ lat, lng, t: hhmm });
        if (myTrailToday.length > 120) {
          myTrailToday = myTrailToday.slice(-120);
        }
      }

      const trunk = computeMyTrunkAndCorte();

      try {
        await executeDriverBatch(currentDriverKeyHash, (batch, proofId) => {
          batch.set(doc(db, "driver_locations", driverSlug(currentDriverName)), {
            driverName: currentDriverName,
            lat,
            lng,
            accuracy: Math.round(accuracy || 0),
            speedKmh: speed && speed > 0 ? Math.round(speed * 3.6) : 0,
            active: true,
            trailDate: currDate,
            trail: myTrailToday,
            boxesInCar: trunk.totalAvailable,
            boxesBreakdown: trunk.avail,
            ripeness: trunk.lastRipeness || "Surtido",
            updatedAtIso: new Date().toISOString(),
            updatedAt: serverTimestamp(),
            proofId
          });
        });
      } catch (err) {
        console.warn("Error enviando pulso GPS:", err);
      }
    },
    (err) => {
      console.warn("Aviso GPS:", err);
      showToast("Permite el acceso a tu ubicación en el navegador para activar GPS.");
      stopGpsSharing(false);
    },
    { enableHighAccuracy: true, maximumAge: 8000, timeout: 20000 }
  );
}

async function stopGpsSharing(notifyServer = true) {
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
  gpsLabel.textContent = "Activar GPS";

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
  if (whUnsub) whUnsub();
  if (ordersUnsub) ordersUnsub();
  if (salesUnsub) salesUnsub();
  if (placesUnsub) placesUnsub();
  if (visitsUnsub) visitsUnsub();

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
  const ordQ = query(collection(db, "orders"), orderBy("createdAtIso", "desc"), limit(120));
  ordersUnsub = onSnapshot(ordQ, (snap) => {
    assignedOrders = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(
        (o) =>
          String(o.assignedDriver || "").toLowerCase() === String(currentDriverName || "").toLowerCase() &&
          (o.status === "confirmado" || o.status === "en_ruta")
      );
    renderAssignedOrders();
  });

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
  });

  // 5. Today's GPS-verified No-Sale Visits
  const visitsQ = query(collection(db, "place_visits"), where("date", "==", todayStr));
  visitsUnsub = onSnapshot(visitsQ, (snap) => {
    visitsToday = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPlacesList();
  });
}

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
      const hay = `${p.name || ""} ${p.address || ""} ${p.phone || ""} ${p.category || ""}`.toLowerCase();
      return hay.includes(placeSearchQuery);
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

          <div style="display:grid;grid-template-columns:1.2fr 1.2fr auto;gap:6px;margin-top:10px;">
            <button type="button" class="btn btn-primary btn-sm" data-sell-place="${escapeHtml(p.id)}" style="padding:8px 6px;font-size:0.76rem;">
              ➕ Venderle
            </button>
            <button type="button" class="btn btn-outline btn-sm" data-visit-place="${escapeHtml(p.id)}" style="padding:8px 6px;font-size:0.76rem;">
              📍 Pasé (Sin venta)
            </button>
            <a href="${navUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="padding:8px 10px;font-size:0.76rem;" title="Ir con Google Maps">
              🗺️
            </a>
          </div>
        </article>
      `;
    })
    .join("");
}

// Place card actions (Venderle / Registrar Visita)
const visitNoSaleModal = document.getElementById("visitNoSaleModal");

document.getElementById("driverPlacesList").addEventListener("click", (e) => {
  const sellBtn = e.target.closest("button[data-sell-place]");
  if (sellBtn) {
    const place = allPlaces.find((p) => p.id === sellBtn.dataset.sellPlace);
    if (!place) return;
    document.getElementById("saleSelectedPlaceId").value = place.id;
    document.getElementById("saleClientName").value = place.name || "";
    document.getElementById("saleClientPhone").value = place.phone || "";
    const badge = document.getElementById("saleLinkedPlaceBadge");
    badge.style.display = "block";
    badge.textContent = `✓ Vinculado en el mapa: ${place.name}`;
    switchToDriverPane("drvPaneSell");
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

// ================= VIEW 1: ASSIGNED ONLINE ORDERS =================
function renderAssignedOrders() {
  const listEl = document.getElementById("driverAssignedOrdersList");
  document.getElementById("assignedCountBadge").textContent = String(assignedOrders.length);

  if (assignedOrders.length === 0) {
    listEl.innerHTML = `
      <div class="cart-empty" style="background:var(--white);">
        No tienes pedidos pendientes asignados por oficina en este momento.<br>
        <span style="font-size:0.8rem;">Toca <strong>🏪 Clientes</strong> para ver tus tiendas o <strong>➕ Vender</strong> abajo.</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = assignedOrders
    .map((ord) => {
      const mapsUrl = typeof ord.lat === "number" && typeof ord.lng === "number"
        ? `https://www.google.com/maps/dir/?api=1&destination=${ord.lat},${ord.lng}`
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

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
            <a href="${mapsUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">📍 Abrir Mapa</a>
            <a href="tel:${escapeHtml(ord.phone)}" class="btn btn-outline btn-sm">📞 Llamar</a>
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

restoreDriverSession();
