import {
  db,
  doc,
  getDoc,
  getDocs,
  writeBatch,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  DEFAULT_STORE_SETTINGS,
  ACTIVE_TENANT_SLUG,
  getActiveVaultId,
  clearActiveVaultId,
  tenantScopedStorageKey,
  buildSanitizedPublicStorefront,
  getUnitConfig,
  getTenantModules,
  getTenantTerminology,
  getTenantBranding,
  getOrderedProducts,
  getProductCodes,
  formatDynamicUnits,
  applyTenantWhiteLabelToDOM,
  mountTenantSwitcherPill,
  PLACE_CATEGORIES,
  LOT_GRADES,
  normalizeColdRoom,
  haversineMeters,
  parseCoordsFromInput,
  sha256Hex,
  computeDriverPinHash,
  computeWarehousePinHash,
  executeAdminBatch,
  executeSuperadminBatch,
  matchesSmartSearch,
  formatCurrency,
  cleanPhoneForWhatsApp
} from "./firebase-config.js?v=rpd_2";
import {
  optimizeStopsWithOsrm,
  computeOrderedRouteMetrics,
  matchGpsTrailWithOsrm,
  insertPendingStopSmart,
  attachTouchDragSort,
  formatRouteKm,
  formatRouteMin
} from "./route-optimizer.js?v=pz_30";
import { STAFF_MANUALS } from "./manuals-data.js?v=pz_23";

const SESSION_HASH_KEY = tenantScopedStorageKey("salinas_admin_hash_v1");

mountTenantSwitcherPill(ACTIVE_TENANT_SLUG);
onSnapshot(doc(db, "settings", "public_storefront"), (snap) => {
  if (snap.exists() && !currentKeyHash) {
    applyTenantWhiteLabelToDOM(snap.data(), ACTIVE_TENANT_SLUG);
  }
});

function isSaleCancelled(s) {
  return s?.status === "cancelada";
}

function round1(n) {
  const factor = getUnitConfig(storeSettings).subUnitsPerUnit || 10;
  return Math.round((Number(n) || 0) * factor) / factor;
}

function formatBoxesKg(boxesVal) {
  return formatDynamicUnits(boxesVal, storeSettings);
}

function getLocalDateStr(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizePhone10(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function mergeCalibers(remoteCalibers = {}) {
  const out = {};
  const keys = Object.keys(remoteCalibers);
  const srcCodes = keys.length > 0 ? keys : (ACTIVE_TENANT_SLUG === "salinas" ? ["S", "E", "P", "M"] : []);
  for (const code of srcCodes) {
    const def = DEFAULT_STORE_SETTINGS.calibers[code] || { code, name: code, price: 100, minPrice: 1, order: 99 };
    out[code] = {
      ...def,
      ...(remoteCalibers[code] || {})
    };
    if (!out[code].minPrice) {
      out[code].minPrice = def.minPrice || 1;
    }
  }
  return out;
}

let currentKeyHash = null;
let isSystemInitialized = true;
let storeSettings = structuredClone(DEFAULT_STORE_SETTINGS);
let allOrders = [];
let statusFilter = "todos";
let dateFilter = "all";
let searchQuery = "";

// Live New-Order Alert state
let soundAlertsEnabled = localStorage.getItem("salinas_sound_alerts") !== "off";
let audioCtx = null;
let knownOrderIds = new Set();
let initialOrdersLoaded = false;

// Warehouse state
let selectedWhDate = getLocalDateStr();
let currentWhDoc = createEmptyWhDoc(selectedWhDate);

// Route, GPS, Places & Cortes state
let selectedRouteDate = getLocalDateStr();
let routeWhDoc = createEmptyWhDoc(selectedRouteDate);
let routeSalesList = [];
let routeVisitsList = [];
let historicalSales30d = [];
let historicalVisits30d = [];
let historical30dLoaded = false;
let allPlaces = [];
let routeDriverFilterVal = "todos";
let allRoutesTodayUnsub = null;
let allDriverRoutesTodayMap = new Map();
let showAllDriverRoutes = false;
const allDriverRouteGeomCache = new Map();
const matchedTrailCache = new Map();
let driverLocations = [];
let leafletMap = null;
let mapLayerGroup = null;
let mapFocusMarkers = new Map();
async function initCleanAdminVectorBaseMap(targetMap) {
  const styleCandidates = [
    "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    "https://tiles.openfreemap.org/styles/liberty"
  ];
  if (window.L && typeof window.L.maplibreGL === "function") {
    for (const url of styleCandidates) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const styleObj = await res.json();
        if (Array.isArray(styleObj.layers)) {
          styleObj.layers = styleObj.layers.filter((l) => {
            const lid = String(l?.id || "").toLowerCase();
            if (l?.type === "fill-extrusion" || lid.includes("3d")) return false;
            if (
              lid.startsWith("poi") ||
              lid.includes("_poi") ||
              lid.includes("housenumber") ||
              lid.includes("shop") ||
              lid.includes("restaurant") ||
              lid.includes("hotel") ||
              lid.includes("cafe") ||
              lid.includes("bar")
            ) {
              return false;
            }
            return true;
          });
        }
        window.L.maplibreGL({ style: styleObj }).addTo(targetMap);
        return;
      } catch (_) {}
    }
  }
  // Fallback si WebGL no estuviera disponible
  window.L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri"
  }).addTo(targetMap);
  window.L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19
  }).addTo(targetMap);
}

let hasCenteredMapOnce = false;
let mapPickCallback = null;
let mapPinFilter = "all";

let ordersUnsub = null;
let settingsUnsub = null;
let whUnsub = null;
let gpsUnsub = null;
let placesUnsub = null;
let routeWhUnsub = null;
let routeSalesUnsub = null;
let routeVisitsUnsub = null;

function createEmptyWhDoc(dateStr) {
  return {
    date: dateStr,
    openingStock: { M: 0, P: 0, E: 0, S: 0 },
    extraEntries: { M: 0, P: 0, E: 0, S: 0 },
    observations: "",
    trips: []
  };
}

// DOM
const loginView = document.getElementById("loginView");
const dashboardView = document.getElementById("dashboardView");
const loginForm = document.getElementById("loginForm");
const loginSubtitle = document.getElementById("loginSubtitle");
const adminPasswordInput = document.getElementById("adminPasswordInput");
const btnLoginSubmit = document.getElementById("btnLoginSubmit");
const btnLogout = document.getElementById("btnLogout");
const btnDownloadBackup = document.getElementById("btnDownloadBackup");
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

// ================= AUTHENTICATION =================
async function checkInitialAuth() {
  try {
    const initSnap = await getDoc(doc(db, "settings", "security_init"));
    isSystemInitialized = initSnap.exists();
    if (!isSystemInitialized) {
      loginSubtitle.textContent = "Configuración inicial: define tu Clave Maestra de Administración.";
      btnLoginSubmit.textContent = "Crear Clave y Activar Panel";
    }

    const savedHash = localStorage.getItem(SESSION_HASH_KEY) || sessionStorage.getItem(SESSION_HASH_KEY);
    if (savedHash && isSystemInitialized) {
      const keySnap = await getDoc(doc(db, "admin_keys", savedHash));
      if (keySnap.exists() && keySnap.data().active === true) {
        currentKeyHash = savedHash;
        enterDashboard();
      } else {
        localStorage.removeItem(SESSION_HASH_KEY);
        sessionStorage.removeItem(SESSION_HASH_KEY);
      }
    }
  } catch (err) {
    console.error("Error verificando acceso:", err);
  }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pass = adminPasswordInput.value;
  if (!pass || pass.length < 4) {
    showToast("Ingresa una clave válida.");
    return;
  }

  btnLoginSubmit.disabled = true;
  const prevText = btnLoginSubmit.textContent;
  btnLoginSubmit.textContent = "Verificando...";

  try {
    const hash = await sha256Hex(pass);

    if (!isSystemInitialized) {
      await executeAdminBatch(hash, (batch, proofId) => {
        const vId = getActiveVaultId();
        batch.set(doc(db, "admin_keys", hash), { active: true, vaultId: vId, tenantSlug: ACTIVE_TENANT_SLUG, proofId, createdAt: serverTimestamp() });
        batch.set(doc(db, "settings", "security_init"), { initialized: true, createdAt: serverTimestamp() });
        batch.set(doc(db, "settings", "store"), { ...DEFAULT_STORE_SETTINGS, tenantSlug: ACTIVE_TENANT_SLUG, proofId, updatedAt: serverTimestamp() });
        batch.set(doc(db, "settings", "public_storefront"), { ...buildSanitizedPublicStorefront(DEFAULT_STORE_SETTINGS), proofId });
      });
      isSystemInitialized = true;
      currentKeyHash = hash;
      persistHash(hash);
      adminPasswordInput.value = "";
      enterDashboard();
      showToast("Sistema activado correctamente.");
      return;
    }

    const keySnap = await getDoc(doc(db, "admin_keys", hash));
    if (!keySnap.exists() || keySnap.data().active !== true) {
      showToast("Clave incorrecta. Verifica e intenta nuevamente.");
      return;
    }

    currentKeyHash = hash;
    persistHash(hash);
    adminPasswordInput.value = "";
    enterDashboard();
    showToast("Sesión iniciada.");
  } catch (err) {
    console.error("Error en login:", err);
    showToast("Error al autenticar. Intenta nuevamente.");
  } finally {
    btnLoginSubmit.disabled = false;
    btnLoginSubmit.textContent = prevText;
  }
});

function persistHash(hash) {
  if (document.getElementById("rememberAdminSession").checked) {
    localStorage.setItem(SESSION_HASH_KEY, hash);
  } else {
    sessionStorage.setItem(SESSION_HASH_KEY, hash);
  }
}

const btnToggleAlertSound = document.getElementById("btnToggleAlertSound");
const soundBtnLabel = document.getElementById("soundBtnLabel");
const liveNewOrdersAlertBar = document.getElementById("liveNewOrdersAlertBar");

function playOrderChime() {
  if (!soundAlertsEnabled) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();

    const now = audioCtx.currentTime;
    const notes = [
      { freq: 587.33, start: 0, dur: 0.16 },
      { freq: 880.0, start: 0.18, dur: 0.34 }
    ];
    for (const n of notes) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(n.freq, now + n.start);
      gain.gain.setValueAtTime(0.001, now + n.start);
      gain.gain.exponentialRampToValueAtTime(0.24, now + n.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.02);
    }
  } catch (err) {
    console.warn("Audio bloqueado hasta interacción:", err);
  }
}

function updateSoundButtonUI() {
  if (!btnToggleAlertSound) return;
  btnToggleAlertSound.innerHTML = soundAlertsEnabled
    ? '🔔 <span class="hide-mobile" id="soundBtnLabel">Sonido</span>'
    : '🔕 <span class="hide-mobile" id="soundBtnLabel">Silencio</span>';
}
updateSoundButtonUI();

if (btnToggleAlertSound) {
  btnToggleAlertSound.addEventListener("click", async () => {
    soundAlertsEnabled = !soundAlertsEnabled;
    localStorage.setItem("salinas_sound_alerts", soundAlertsEnabled ? "on" : "off");
    updateSoundButtonUI();
    if (soundAlertsEnabled) {
      playOrderChime();
      if ("Notification" in window && Notification.permission === "default") {
        try {
          await Notification.requestPermission();
        } catch (_) {}
      }
      showToast("🔔 Alarma sonora de pedidos nuevos activada.");
    } else {
      showToast("🔕 Alarma sonora silenciada.");
    }
  });
}

function switchAdminTab(targetId) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === targetId);
  });
  document.querySelectorAll(".admin-tab-pane").forEach((pane) => {
    pane.style.display = pane.id === targetId ? "block" : "none";
  });
  if (targetId === "tabRoutes") {
    ensureLeafletMap();
    setTimeout(() => {
      if (leafletMap) leafletMap.invalidateSize();
      renderGpsMapAndChips();
    }, 120);
  }
}

function updateLiveOrderAlertBar() {
  if (!liveNewOrdersAlertBar) return;
  const newOrders = allOrders.filter((o) => o.status === "nuevo");
  if (newOrders.length === 0) {
    liveNewOrdersAlertBar.classList.remove("active");
    return;
  }
  const latest = newOrders[0];
  const titleEl = document.getElementById("liveNewOrdersTitle");
  const subEl = document.getElementById("liveNewOrdersSub");
  if (titleEl) {
    titleEl.textContent =
      newOrders.length === 1
        ? `¡1 pedido nuevo sin asignar! (${latest.customerName || latest.folio})`
        : `¡Tienes ${newOrders.length} pedidos nuevos esperando asignación!`;
  }
  if (subEl) {
    subEl.textContent = `Último: ${latest.folio || ""} • ${latest.totalBoxes || 0} caja(s) • ${formatCurrency(latest.totalAmount || 0)}`;
  }
  liveNewOrdersAlertBar.classList.add("active");
}

document.getElementById("btnAlertJumpMap")?.addEventListener("click", () => {
  switchAdminTab("tabRoutes");
  document.getElementById("adminMapCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("btnAlertJumpOrders")?.addEventListener("click", () => {
  statusFilter = "nuevo";
  document.querySelectorAll("#statusFilterBar button").forEach((b) => {
    b.className = b.dataset.status === "nuevo" ? "btn btn-sm btn-primary" : "btn btn-sm btn-outline";
  });
  renderOrdersList();
  switchAdminTab("tabOrders");
});

btnLogout.addEventListener("click", () => {
  currentKeyHash = null;
  clearActiveVaultId();
  localStorage.removeItem(SESSION_HASH_KEY);
  sessionStorage.removeItem(SESSION_HASH_KEY);
  if (ordersUnsub) ordersUnsub();
  if (settingsUnsub) settingsUnsub();
  if (whUnsub) whUnsub();
  if (gpsUnsub) gpsUnsub();
  if (placesUnsub) placesUnsub();
  if (routeWhUnsub) routeWhUnsub();
  if (routeSalesUnsub) routeSalesUnsub();
  if (routeVisitsUnsub) routeVisitsUnsub();
  if (allRoutesTodayUnsub) allRoutesTodayUnsub();
  allDriverRoutesTodayMap.clear();
  historicalSales30d = [];
  historicalVisits30d = [];
  historical30dLoaded = false;
  initialOrdersLoaded = false;
  knownOrderIds.clear();
  dashboardView.style.display = "none";
  btnLogout.style.display = "none";
  btnDownloadBackup.style.display = "none";
  if (btnToggleAlertSound) btnToggleAlertSound.style.display = "none";
  const btnTopManual = document.getElementById("btnTopManual");
  if (btnTopManual) btnTopManual.style.display = "none";
  const manualContainer = document.getElementById("adminManualContainer");
  if (manualContainer) manualContainer.innerHTML = "";
  if (liveNewOrdersAlertBar) liveNewOrdersAlertBar.classList.remove("active");
  loginView.style.display = "flex";
});

function enterDashboard() {
  loginView.style.display = "none";
  dashboardView.style.display = "block";
  btnLogout.style.display = "inline-flex";
  btnDownloadBackup.style.display = "inline-flex";
  if (btnToggleAlertSound) btnToggleAlertSound.style.display = "inline-flex";
  const btnTopManual = document.getElementById("btnTopManual");
  if (btnTopManual) btnTopManual.style.display = "inline-flex";
  document.getElementById("whDatePicker").value = selectedWhDate;
  document.getElementById("routeDatePicker").value = selectedRouteDate;
  const mapDatePickerEl = document.getElementById("mapDatePicker");
  if (mapDatePickerEl) mapDatePickerEl.value = selectedRouteDate;
  renderAdminManualTab();
  startRealtimeListeners();
  subscribeWarehouseDay(selectedWhDate);
  subscribeRouteCorteDay(selectedRouteDate);
  load30DayPlaceHistory();
  switchAdminTab("tabRoutes");
}

(function setupNavToDriverAppButton() {
  const btn = document.getElementById("btnNavToDriverApp");
  if (!btn) return;
  const fromDriver = (() => {
    try {
      return sessionStorage.getItem("salinas_from_driver_app") === "1" || document.referrer.includes("chofer.html");
    } catch {
      return false;
    }
  })();
  const isNative = Boolean(window.Capacitor?.isNativePlatform?.() || window.SalinasNative);
  if (isNative) {
    document.querySelectorAll('a[href="index.html"], a[href="almacen.html"]').forEach((a) => {
      if (a.getAttribute("href") === "index.html") {
        a.style.display = "none";
      } else {
        a.removeAttribute("target");
      }
    });
  }
  if (fromDriver || isNative) {
    btn.innerHTML = '🚗 <span>Chofer</span>';
    btn.title = "Regresar a la App del Chofer";
    btn.style.borderColor = "#15803d";
    btn.style.color = "#14532d";
    btn.style.background = "#ecfdf5";
    btn.style.fontWeight = "800";
    btn.removeAttribute("target");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "chofer.html";
    });
  }
})();

document.getElementById("btnTopManual")?.addEventListener("click", () => {
  switchAdminTab("tabManual");
});

// Tabs switching
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchAdminTab(btn.dataset.tab));
});

// ================= BACKUP JSON DOWNLOAD =================
btnDownloadBackup.addEventListener("click", async () => {
  btnDownloadBackup.disabled = true;
  btnDownloadBackup.textContent = "Generando...";
  try {
    const [ordersSnap, whSnap, routeSalesSnap, placesSnap, visitsSnap] = await Promise.all([
      getDocs(query(collection(db, "orders"), orderBy("createdAtIso", "desc"), limit(500))),
      getDocs(collection(db, "warehouse_days")),
      getDocs(collection(db, "route_sales")),
      getDocs(collection(db, "places")),
      getDocs(collection(db, "place_visits"))
    ]);

    const backupPayload = {
      exportedAt: new Date().toISOString(),
      platform: "Ruta Pro Distribution",
      tenantSlug: ACTIVE_TENANT_SLUG,
      project: getTenantBranding(storeSettings, ACTIVE_TENANT_SLUG).brandName,
      storeSettings,
      places: placesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      placeVisits: visitsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      warehouseDays: whSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      routeSales: routeSalesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      orders: ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    };

    const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Respaldo_Aguacates_Salinas_${getLocalDateStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Respaldo completo descargado en tu equipo.");
  } catch (err) {
    console.error(err);
    showToast("Error al generar el respaldo.");
  } finally {
    btnDownloadBackup.disabled = false;
    btnDownloadBackup.innerHTML = '💾 <span class="hide-mobile">Respaldar</span>';
  }
});

// ================= REALTIME LISTENERS =================
function startRealtimeListeners() {
  if (settingsUnsub) settingsUnsub();
  if (ordersUnsub) ordersUnsub();
  if (gpsUnsub) gpsUnsub();
  if (placesUnsub) placesUnsub();

  settingsUnsub = onSnapshot(doc(db, "settings", "store"), (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      storeSettings = {
        ...DEFAULT_STORE_SETTINGS,
        ...data,
        calibers: mergeCalibers(data.calibers || {}),
        drivers: Array.isArray(data.drivers) ? data.drivers : DEFAULT_STORE_SETTINGS.drivers,
        warehouseStaff: Array.isArray(data.warehouseStaff) ? data.warehouseStaff : []
      };
    } else {
      storeSettings.calibers = mergeCalibers({});
    }
    applyTenantWhiteLabelToDOM(storeSettings, ACTIVE_TENANT_SLUG);
    populateCatalogForm();
    updateBroadcastPreview();
    renderDriversEditor();
    if (typeof renderWhStaffEditor === "function") renderWhStaffEditor();
    populateTripDriverSelect();
    populateRouteDriverFilter();
    renderOrdersList();
    renderRouteCortesAndSales();
    renderGpsMapAndChips();
    window.dispatchEvent(new CustomEvent("salinas:routes-updated"));
  });

  const q = query(collection(db, "orders"), orderBy("createdAtIso", "desc"), limit(200));
  ordersUnsub = onSnapshot(q, (snap) => {
    const incoming = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (initialOrdersLoaded) {
      const brandNew = incoming.filter((o) => !knownOrderIds.has(o.id) && o.status === "nuevo");
      if (brandNew.length > 0) {
        const newest = brandNew[0];
        playOrderChime();
        showToast(`🚨 ¡Nuevo pedido de ${newest.customerName} (${newest.totalBoxes} cajas)!`);
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification("🥑 Nuevo Pedido — Aguacates Salinas", {
              body: `${newest.customerName}: ${newest.totalBoxes} caja(s) • ${formatCurrency(newest.totalAmount)}`,
              icon: "assets/avocados-icon.png"
            });
          } catch (_) {}
        }
      }
    }
    for (const o of incoming) knownOrderIds.add(o.id);
    initialOrdersLoaded = true;

    allOrders = incoming;
    updateKPIs();
    updateLiveOrderAlertBar();
    renderOrdersList();
    renderGpsMapAndChips();
    window.dispatchEvent(new CustomEvent("salinas:routes-updated"));
  });

  gpsUnsub = onSnapshot(collection(db, "driver_locations"), (snap) => {
    driverLocations = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderGpsMapAndChips();
    window.dispatchEvent(new CustomEvent("salinas:routes-updated"));
  });

  placesUnsub = onSnapshot(collection(db, "places"), (snap) => {
    allPlaces = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.active !== false)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
    renderGpsMapAndChips();
    renderAdminPlacesDirectory();
    renderOrdersList();
    window.dispatchEvent(new CustomEvent("salinas:places-updated"));
  });

  if (typeof startThermosAndLotsListeners === "function") {
    startThermosAndLotsListeners();
  }
}

function subscribeWarehouseDay(dateStr) {
  if (whUnsub) whUnsub();
  selectedWhDate = dateStr;
  currentWhDoc = createEmptyWhDoc(dateStr);
  renderWarehouseModule();

  whUnsub = onSnapshot(
    doc(db, "warehouse_days", dateStr),
    (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        currentWhDoc = {
          date: dateStr,
          openingStock: { M: 0, P: 0, E: 0, S: 0, ...(d.openingStock || {}) },
          extraEntries: { M: 0, P: 0, E: 0, S: 0, ...(d.extraEntries || {}) },
          observations: d.observations || "",
          trips: Array.isArray(d.trips) ? d.trips : []
        };
      } else {
        currentWhDoc = createEmptyWhDoc(dateStr);
      }
      renderWarehouseModule();
      updateKPIs();
    },
    (err) => {
      console.warn("Aviso leyendo almacén:", err);
      renderWarehouseModule();
    }
  );
}

// ================= WAREHOUSE MODULE LOGIC =================
function computeWarehouseTotals(whDoc) {
  const cals = ["M", "P", "E", "S"];
  const init = {};
  const extra = {};
  const out = { M: 0, P: 0, E: 0, S: 0 };
  const ret = { M: 0, P: 0, E: 0, S: 0 };
  const sold = {};
  const finalStock = {};

  for (const c of cals) {
    init[c] = Number(whDoc.openingStock?.[c]) || 0;
    extra[c] = Number(whDoc.extraEntries?.[c]) || 0;
  }

  for (const t of whDoc.trips || []) {
    for (const c of cals) {
      out[c] += Number(t.out?.[c]) || 0;
      ret[c] += Number(t.ret?.[c]) || 0;
    }
  }

  let totalInit = 0;
  let totalExtra = 0;
  let totalOut = 0;
  let totalRet = 0;
  let totalSold = 0;
  let totalFinal = 0;

  for (const c of cals) {
    sold[c] = out[c] - ret[c];
    finalStock[c] = init[c] + extra[c] - sold[c];
    totalInit += init[c];
    totalExtra += extra[c];
    totalOut += out[c];
    totalRet += ret[c];
    totalSold += sold[c];
    totalFinal += finalStock[c];
  }

  return {
    init, extra, out, ret, sold, finalStock,
    totalInit, totalExtra, totalOut, totalRet, totalSold, totalFinal
  };
}

function populateTripDriverSelect() {
  const sel = document.getElementById("tripDriver");
  const drivers = storeSettings.drivers || [];
  if (drivers.length === 0) {
    sel.innerHTML = `<option value="Sin nombre">Agrega un chofer en pestaña Choferes</option>`;
    return;
  }
  const prev = sel.value;
  sel.innerHTML = drivers
    .map((d) => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`)
    .join("");
  if (prev && drivers.some((d) => d.name === prev)) {
    sel.value = prev;
  }
}

function renderWarehouseModule() {
  const totals = computeWarehouseTotals(currentWhDoc);

  // Fill Opening Form inputs (only if user isn't actively typing in them)
  const activeEl = document.activeElement;
  const setValIfIdle = (id, val) => {
    const el = document.getElementById(id);
    if (el && activeEl !== el) el.value = val;
  };
  setValIfIdle("whInitM", totals.init.M);
  setValIfIdle("whInitP", totals.init.P);
  setValIfIdle("whInitE", totals.init.E);
  setValIfIdle("whInitS", totals.init.S);
  setValIfIdle("whExtraM", totals.extra.M);
  setValIfIdle("whExtraP", totals.extra.P);
  setValIfIdle("whExtraE", totals.extra.E);
  setValIfIdle("whExtraS", totals.extra.S);
  setValIfIdle("whObservations", currentWhDoc.observations || "");

  // 1. Live Stock Cards
  const calLabels = {
    M: "M • Media / Seg.",
    P: "P • Primera",
    E: "E • Extra",
    S: "S • Super"
  };

  const cardsHtml = ["M", "P", "E", "S"]
    .map((c) => {
      const availBase = totals.init[c] + totals.extra[c];
      return `
        <div class="wh-stock-card">
          <div class="wh-stock-title">${calLabels[c]}</div>
          <div class="wh-stock-current">${totals.finalStock[c]} <span style="font-size:0.85rem;font-weight:600;">cajas</span></div>
          <div class="wh-stock-meta">
            Base: <strong>${availBase}</strong> &nbsp;•&nbsp; Vendido: <strong>${totals.sold[c]}</strong>
          </div>
        </div>
      `;
    })
    .join("");

  const totalBase = totals.totalInit + totals.totalExtra;
  document.getElementById("whStockCards").innerHTML =
    cardsHtml +
    `
      <div class="wh-stock-card wh-total-card">
        <div class="wh-stock-title">Total en Piso (T. INV.)</div>
        <div class="wh-stock-current">${totals.totalFinal} <span style="font-size:0.85rem;font-weight:600;">cajas</span></div>
        <div class="wh-stock-meta">
          Base: <strong>${totalBase}</strong> &nbsp;•&nbsp; Total V.: <strong>${totals.totalSold}</strong>
        </div>
      </div>
    `;

  // 2. Driver Summary Cards (Concentrado por Chofer)
  const byDriver = new Map();
  for (const t of currentWhDoc.trips || []) {
    const name = t.driver || "Chofer";
    if (!byDriver.has(name)) {
      byDriver.set(name, {
        name,
        vueltas: 0,
        lastRipeness: "",
        lastTime: "",
        out: { M: 0, P: 0, E: 0, S: 0 },
        ret: { M: 0, P: 0, E: 0, S: 0 },
        totalOut: 0,
        totalRet: 0
      });
    }
    const g = byDriver.get(name);
    g.vueltas++;
    g.lastRipeness = t.ripeness || "Surtido";
    g.lastTime = t.time || "";
    for (const c of ["M", "P", "E", "S"]) {
      const o = Number(t.out?.[c]) || 0;
      const r = Number(t.ret?.[c]) || 0;
      g.out[c] += o;
      g.ret[c] += r;
      g.totalOut += o;
      g.totalRet += r;
    }
  }

  const drvCardsEl = document.getElementById("whDriverSummaryCards");
  if (byDriver.size === 0) {
    drvCardsEl.innerHTML = `<div class="cart-empty" style="grid-column:1/-1;margin-bottom:0;">Aún no se han registrado salidas de carros en esta fecha.</div>`;
  } else {
    drvCardsEl.innerHTML = Array.from(byDriver.values())
      .map((g) => {
        const net = g.totalOut - g.totalRet;
        const netByCal = ["M", "P", "E", "S"]
          .map((c) => `${c}:${g.out[c] - g.ret[c]}`)
          .join(" • ");
        return `
          <div class="driver-route-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <strong style="font-size:1.02rem;color:var(--green-950);">🚗 ${escapeHtml(g.name)}</strong>
              <span class="ripeness-badge">${g.vueltas} vuelta${g.vueltas === 1 ? "" : "s"}</span>
            </div>
            <div style="font-size:0.8rem;color:var(--slate-700);margin-bottom:6px;">
              Última carga (${escapeHtml(g.lastTime)}): <strong>${escapeHtml(g.lastRipeness)}</strong>
            </div>
            <div style="font-size:0.82rem;color:var(--slate-700);background:var(--green-50);padding:6px 8px;border-radius:8px;">
              Salida: <strong>${g.totalOut}</strong> &nbsp;|&nbsp; Dev.: <strong>${g.totalRet}</strong> &nbsp;→&nbsp;
              <strong style="color:var(--green-900);">Neto Vendido: ${net}</strong>
              <div style="font-size:0.74rem;color:var(--slate-500);margin-top:2px;">Neto por calibre: ${netByCal}</div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  // 3. Trips Table (Desktop) + Native Cards (Mobile)
  const tbody = document.getElementById("whTripsTableBody");
  const tfoot = document.getElementById("whTripsTableFoot");
  const mobileList = document.getElementById("whMobileTripsList");
  const trips = currentWhDoc.trips || [];

  if (trips.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" style="padding:20px;color:var(--slate-500);">Sin vueltas registradas en esta fecha. Usa el formulario de arriba cada vez que salga un carro.</td></tr>`;
    mobileList.innerHTML = `
      <div class="cart-empty" style="margin-bottom:0;">
        Sin vueltas registradas en esta fecha. Usa el formulario de arriba cada vez que salga un carro.
      </div>
    `;
  } else {
    tbody.innerHTML = trips
      .map((t, idx) => {
        const oM = Number(t.out?.M) || 0;
        const oP = Number(t.out?.P) || 0;
        const oE = Number(t.out?.E) || 0;
        const oS = Number(t.out?.S) || 0;
        const rM = Number(t.ret?.M) || 0;
        const rP = Number(t.ret?.P) || 0;
        const rE = Number(t.ret?.E) || 0;
        const rS = Number(t.ret?.S) || 0;
        const net = (oM + oP + oE + oS) - (rM + rP + rE + rS);

        return `
          <tr>
            <td style="font-weight:800;color:var(--slate-500);">${idx + 1}</td>
            <td style="font-weight:700;">${escapeHtml(t.time || "")}</td>
            <td style="text-align:left;font-weight:800;color:var(--green-950);">${escapeHtml(t.driver)}</td>
            <td>
              <span class="ripeness-badge">${escapeHtml(t.ripeness || "Surtido")}</span>
              ${t.note ? `<div style="font-size:0.72rem;color:var(--slate-500);margin-top:2px;">${escapeHtml(t.note)}</div>` : ""}
            </td>
            <td>${oM || "—"}</td>
            <td>${oP || "—"}</td>
            <td>${oE || "—"}</td>
            <td style="border-right:2px solid var(--green-800);">${oS || "—"}</td>
            <td>${rM || "0"}</td>
            <td>${rP || "0"}</td>
            <td>${rE || "0"}</td>
            <td style="border-right:2px solid var(--green-800);">${rS || "0"}</td>
            <td style="font-weight:900;font-size:0.95rem;color:var(--green-900);background:var(--green-50);">${net}</td>
            <td>
              <button type="button" class="btn btn-outline btn-sm" data-edit-trip="${escapeHtml(t.id)}">
                Devolución / Editar
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    const mobileCardsHtml = trips
      .map((t, idx) => {
        const oM = Number(t.out?.M) || 0;
        const oP = Number(t.out?.P) || 0;
        const oE = Number(t.out?.E) || 0;
        const oS = Number(t.out?.S) || 0;
        const rM = Number(t.ret?.M) || 0;
        const rP = Number(t.ret?.P) || 0;
        const rE = Number(t.ret?.E) || 0;
        const rS = Number(t.ret?.S) || 0;
        const totO = oM + oP + oE + oS;
        const totR = rM + rP + rE + rS;
        const net = totO - totR;

        return `
          <div class="wh-trip-mcard">
            <div class="wh-trip-mcard-head">
              <div>
                <span style="font-weight:800;color:var(--slate-500);font-size:0.8rem;">#${idx + 1} • ${escapeHtml(t.time || "")}</span>
                <strong style="display:block;font-size:1.02rem;color:var(--green-950);">🚗 ${escapeHtml(t.driver)}</strong>
              </div>
              <span class="ripeness-badge">${escapeHtml(t.ripeness || "Surtido")}</span>
            </div>

            ${t.note ? `<div style="font-size:0.8rem;color:var(--slate-700);margin-bottom:8px;">📝 ${escapeHtml(t.note)}</div>` : ""}

            <div class="wh-trip-mcard-boxes">
              <div class="wh-mini-box-group">
                <div class="wh-mini-box-label">Salida (${totO} cajas)</div>
                <div class="wh-mini-box-vals">
                  <span>M:${oM}</span><span>P:${oP}</span><span>E:${oE}</span><span>S:${oS}</span>
                </div>
              </div>
              <div class="wh-mini-box-group is-ret">
                <div class="wh-mini-box-label">Devolución (${totR} cajas)</div>
                <div class="wh-mini-box-vals">
                  <span>M:${rM}</span><span>P:${rP}</span><span>E:${rE}</span><span>S:${rS}</span>
                </div>
              </div>
            </div>

            <div class="wh-trip-mcard-foot">
              <div>
                <span style="font-size:0.76rem;color:var(--slate-500);font-weight:700;">VENDIDO NETO:</span>
                <strong style="font-size:1.05rem;color:var(--green-900);margin-left:4px;">${net} cajas</strong>
              </div>
              <button type="button" class="btn btn-outline btn-sm" data-edit-trip="${escapeHtml(t.id)}">
                Devolución / Editar
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    const mobileSummaryCard = `
      <div class="wh-trip-mcard" style="background:var(--green-100);border-color:var(--green-700);">
        <div style="font-weight:800;color:var(--green-950);font-size:0.88rem;margin-bottom:6px;">SUMAS DEL DÍA</div>
        <div style="font-size:0.82rem;color:var(--slate-900);display:flex;flex-direction:column;gap:4px;">
          <div><strong>Salidas (${totals.totalOut}):</strong> M:${totals.out.M} • P:${totals.out.P} • E:${totals.out.E} • S:${totals.out.S}</div>
          <div><strong>Devoluciones (${totals.totalRet}):</strong> M:${totals.ret.M} • P:${totals.ret.P} • E:${totals.ret.E} • S:${totals.ret.S}</div>
          <div style="font-size:0.95rem;color:var(--green-950);padding-top:4px;border-top:1px solid var(--slate-300);">
            <strong>Total Vendido Neto (Total V.): ${totals.totalSold} cajas</strong>
          </div>
        </div>
      </div>
    `;

    mobileList.innerHTML = mobileCardsHtml + mobileSummaryCard;
  }

  tfoot.innerHTML = `
    <tr>
      <td colspan="4" style="text-align:right;padding-right:12px;">SUMAS DEL DÍA:</td>
      <td>${totals.out.M}</td>
      <td>${totals.out.P}</td>
      <td>${totals.out.E}</td>
      <td style="border-right:2px solid var(--green-800);">${totals.out.S}</td>
      <td>${totals.ret.M}</td>
      <td>${totals.ret.P}</td>
      <td>${totals.ret.E}</td>
      <td style="border-right:2px solid var(--green-800);">${totals.ret.S}</td>
      <td style="font-size:1rem;background:#dce8d8;">${totals.totalSold}</td>
      <td></td>
    </tr>
  `;
}

async function saveWarehouseDoc(updatedDoc, toastMessage) {
  await executeAdminBatch(currentKeyHash, (batch, proofId) => {
    batch.set(doc(db, "warehouse_days", selectedWhDate), {
      ...updatedDoc,
      date: selectedWhDate,
      proofId,
      updatedAt: serverTimestamp()
    });
  });
  if (toastMessage) showToast(toastMessage);
}

// Date controls
document.getElementById("whDatePicker").addEventListener("change", (e) => {
  if (e.target.value) subscribeWarehouseDay(e.target.value);
});

document.getElementById("btnWhToday").addEventListener("click", () => {
  const today = getLocalDateStr();
  document.getElementById("whDatePicker").value = today;
  subscribeWarehouseDay(today);
});

document.getElementById("btnCopyPrevStock").addEventListener("click", async () => {
  try {
    const parts = selectedWhDate.split("-").map(Number);
    const prevDateObj = new Date(parts[0], parts[1] - 1, parts[2] - 1);
    const prevDateStr = getLocalDateStr(prevDateObj);
    const prevSnap = await getDoc(doc(db, "warehouse_days", prevDateStr));

    if (!prevSnap.exists()) {
      showToast(`No hay registro guardado del día anterior (${prevDateStr}).`);
      return;
    }

    const prevTotals = computeWarehouseTotals(prevSnap.data());
    const nextDoc = {
      ...currentWhDoc,
      openingStock: {
        M: Math.max(0, prevTotals.finalStock.M),
        P: Math.max(0, prevTotals.finalStock.P),
        E: Math.max(0, prevTotals.finalStock.E),
        S: Math.max(0, prevTotals.finalStock.S)
      }
    };
    await saveWarehouseDoc(nextDoc, `Inventario final del ${prevDateStr} cargado como inicial.`);
  } catch (err) {
    console.error(err);
    showToast("Error al consultar el cierre anterior.");
  }
});

// Save Opening Stock & Extra Entries
document.getElementById("whOpeningForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nextDoc = {
    ...currentWhDoc,
    openingStock: {
      M: Math.max(0, Math.floor(Number(document.getElementById("whInitM").value) || 0)),
      P: Math.max(0, Math.floor(Number(document.getElementById("whInitP").value) || 0)),
      E: Math.max(0, Math.floor(Number(document.getElementById("whInitE").value) || 0)),
      S: Math.max(0, Math.floor(Number(document.getElementById("whInitS").value) || 0))
    },
    extraEntries: {
      M: Math.max(0, Math.floor(Number(document.getElementById("whExtraM").value) || 0)),
      P: Math.max(0, Math.floor(Number(document.getElementById("whExtraP").value) || 0)),
      E: Math.max(0, Math.floor(Number(document.getElementById("whExtraE").value) || 0)),
      S: Math.max(0, Math.floor(Number(document.getElementById("whExtraS").value) || 0))
    },
    observations: document.getElementById("whObservations").value.trim()
  };

  try {
    await saveWarehouseDoc(nextDoc, "Inventario base actualizado.");
  } catch (err) {
    console.error(err);
    showToast("No se pudo guardar el inventario base.");
  }
});

// Mix Mode (Caliber x Ripeness) for Warehouse Trip Dispatch
let whTripMixMode = false;

function readTripMixMatrix() {
  const mix = {
    M: { Verde: 0, Quebrado: 0, "Sazón": 0, Maduro: 0 },
    P: { Verde: 0, Quebrado: 0, "Sazón": 0, Maduro: 0 },
    E: { Verde: 0, Quebrado: 0, "Sazón": 0, Maduro: 0 },
    S: { Verde: 0, Quebrado: 0, "Sazón": 0, Maduro: 0 }
  };
  document.querySelectorAll(".trip-mix-input").forEach((inp) => {
    const cal = inp.dataset.cal;
    const rip = inp.dataset.rip;
    if (!mix[cal] || !(rip in mix[cal])) return;
    mix[cal][rip] = Math.max(0, Math.floor(Number(inp.value) || 0));
  });
  const totals = {
    M: mix.M.Verde + mix.M.Quebrado + mix.M["Sazón"] + mix.M.Maduro,
    P: mix.P.Verde + mix.P.Quebrado + mix.P["Sazón"] + mix.P.Maduro,
    E: mix.E.Verde + mix.E.Quebrado + mix.E["Sazón"] + mix.E.Maduro,
    S: mix.S.Verde + mix.S.Quebrado + mix.S["Sazón"] + mix.S.Maduro
  };
  const totalBoxes = totals.M + totals.P + totals.E + totals.S;
  const ripShort = { Verde: "Ver", Quebrado: "Queb", "Sazón": "Saz", Maduro: "Mad" };
  const parts = [];
  ["M", "P", "E", "S"].forEach((cal) => {
    const items = [];
    ["Verde", "Quebrado", "Sazón", "Maduro"].forEach((rip) => {
      if (mix[cal][rip] > 0) items.push(`${mix[cal][rip]} ${ripShort[rip]}`);
    });
    if (items.length > 0) parts.push(`${cal}: ${items.join(", ")}`);
  });
  return {
    mix,
    totals,
    totalBoxes,
    summaryText: parts.join(" • ") || "Surtido"
  };
}

function syncTripMixUI() {
  const { totals, totalBoxes, summaryText } = readTripMixMatrix();
  ["M", "P", "E", "S"].forEach((cal) => {
    const badge = document.getElementById(`mixTotal${cal}`);
    if (badge) badge.textContent = String(totals[cal]);
    const outInput = document.getElementById(`tripOut${cal}`);
    if (outInput && whTripMixMode) outInput.value = String(totals[cal]);
  });
  const preview = document.getElementById("tripMixSummaryPreview");
  if (preview) {
    preview.textContent =
      totalBoxes > 0
        ? `Total: ${totalBoxes} cajas (${summaryText})`
        : "Total: 0 cajas • Captura solo las celdas que apliquen";
  }
}

document.getElementById("btnToggleRipenessMix")?.addEventListener("click", () => {
  whTripMixMode = !whTripMixMode;
  const mixPanel = document.getElementById("whTripMixPanel");
  const simpleBoxes = document.getElementById("whTripSimpleBoxes");
  const quickWrap = document.getElementById("tripQuickRipenessWrap");
  const btn = document.getElementById("btnToggleRipenessMix");
  if (mixPanel) mixPanel.style.display = whTripMixMode ? "block" : "none";
  if (simpleBoxes) simpleBoxes.style.display = whTripMixMode ? "none" : "block";
  if (quickWrap) quickWrap.style.opacity = whTripMixMode ? "0.45" : "1";
  const ripSelect = document.getElementById("tripRipeness");
  if (ripSelect) ripSelect.disabled = whTripMixMode;
  if (btn) {
    btn.textContent = whTripMixMode ? "⚡ Volver a modo rápido" : "🎨 Detallar mezcla por tamaño";
  }
  if (whTripMixMode) syncTripMixUI();
});

document.getElementById("btnClearTripMix")?.addEventListener("click", () => {
  document.querySelectorAll(".trip-mix-input").forEach((inp) => {
    inp.value = "0";
  });
  syncTripMixUI();
});

document.getElementById("whTripMixPanel")?.addEventListener("input", (e) => {
  if (e.target.classList.contains("trip-mix-input")) {
    syncTripMixUI();
  }
});

// Add New Car Trip
document.getElementById("whNewTripForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const driver = document.getElementById("tripDriver").value;
  let ripeness = document.getElementById("tripRipeness").value;
  let ripenessMix = null;
  let out = {
    M: Math.max(0, Math.floor(Number(document.getElementById("tripOutM").value) || 0)),
    P: Math.max(0, Math.floor(Number(document.getElementById("tripOutP").value) || 0)),
    E: Math.max(0, Math.floor(Number(document.getElementById("tripOutE").value) || 0)),
    S: Math.max(0, Math.floor(Number(document.getElementById("tripOutS").value) || 0))
  };
  if (whTripMixMode) {
    const parsedMix = readTripMixMatrix();
    out = parsedMix.totals;
    ripeness = parsedMix.summaryText;
    ripenessMix = parsedMix.mix;
  }
  const note = document.getElementById("tripNote").value.trim();

  if (out.M + out.P + out.E + out.S <= 0) {
    showToast("Ingresa al menos 1 caja de salida (M, P, E o S).");
    return;
  }

  const now = new Date();
  const timeStr = now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });

  const newTrip = {
    id: "trp_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
    time: timeStr,
    driver,
    ripeness,
    ...(ripenessMix ? { ripenessMix } : {}),
    out,
    ret: { M: 0, P: 0, E: 0, S: 0 },
    note
  };

  const nextDoc = {
    ...currentWhDoc,
    trips: [...(currentWhDoc.trips || []), newTrip]
  };

  try {
    await saveWarehouseDoc(nextDoc, `Salida registrada para ${driver} (${ripeness}).`);
    document.getElementById("tripOutM").value = "0";
    document.getElementById("tripOutP").value = "0";
    document.getElementById("tripOutE").value = "0";
    document.getElementById("tripOutS").value = "0";
    document.querySelectorAll(".trip-mix-input").forEach((inp) => {
      inp.value = "0";
    });
    syncTripMixUI();
    document.getElementById("tripNote").value = "";
  } catch (err) {
    console.error(err);
    showToast("Error al registrar salida.");
  }
});

// Edit / Return Modal for Trips (handles both Desktop table and Mobile cards)
const returnModal = document.getElementById("returnModal");

document.getElementById("tabWarehouse").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-edit-trip]");
  if (!btn) return;
  const tripId = btn.dataset.editTrip;
  const trip = (currentWhDoc.trips || []).find((t) => t.id === tripId);
  if (!trip) return;

  document.getElementById("editTripId").value = trip.id;
  document.getElementById("returnModalTitle").textContent = `Vuelta de ${trip.driver} (${trip.time})`;
  document.getElementById("returnModalSubtitle").textContent = "Captura las cajas devueltas sin vender o corrige la salida.";
  document.getElementById("editTripRipeness").value = trip.ripeness || "Surtido";
  document.getElementById("editOutM").value = Number(trip.out?.M) || 0;
  document.getElementById("editOutP").value = Number(trip.out?.P) || 0;
  document.getElementById("editOutE").value = Number(trip.out?.E) || 0;
  document.getElementById("editOutS").value = Number(trip.out?.S) || 0;
  document.getElementById("editRetM").value = Number(trip.ret?.M) || 0;
  document.getElementById("editRetP").value = Number(trip.ret?.P) || 0;
  document.getElementById("editRetE").value = Number(trip.ret?.E) || 0;
  document.getElementById("editRetS").value = Number(trip.ret?.S) || 0;
  document.getElementById("editTripNote").value = trip.note || "";

  returnModal.classList.add("open");
});

document.getElementById("btnCloseReturnModal").addEventListener("click", () => {
  returnModal.classList.remove("open");
});

document.getElementById("returnTripForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tripId = document.getElementById("editTripId").value;
  const updatedTrips = (currentWhDoc.trips || []).map((t) => {
    if (t.id !== tripId) return t;
    return {
      ...t,
      ripeness: document.getElementById("editTripRipeness").value,
      out: {
        M: Math.max(0, Math.floor(Number(document.getElementById("editOutM").value) || 0)),
        P: Math.max(0, Math.floor(Number(document.getElementById("editOutP").value) || 0)),
        E: Math.max(0, Math.floor(Number(document.getElementById("editOutE").value) || 0)),
        S: Math.max(0, Math.floor(Number(document.getElementById("editOutS").value) || 0))
      },
      ret: {
        M: Math.max(0, Math.floor(Number(document.getElementById("editRetM").value) || 0)),
        P: Math.max(0, Math.floor(Number(document.getElementById("editRetP").value) || 0)),
        E: Math.max(0, Math.floor(Number(document.getElementById("editRetE").value) || 0)),
        S: Math.max(0, Math.floor(Number(document.getElementById("editRetS").value) || 0))
      },
      note: document.getElementById("editTripNote").value.trim()
    };
  });

  try {
    await saveWarehouseDoc({ ...currentWhDoc, trips: updatedTrips }, "Devolución actualizada.");
    returnModal.classList.remove("open");
  } catch (err) {
    console.error(err);
    showToast("Error al guardar devolución.");
  }
});

document.getElementById("btnDeleteTrip").addEventListener("click", async () => {
  const tripId = document.getElementById("editTripId").value;
  if (!confirm("¿Eliminar este registro de vuelta del almacén?")) return;
  const updatedTrips = (currentWhDoc.trips || []).filter((t) => t.id !== tripId);
  try {
    await saveWarehouseDoc({ ...currentWhDoc, trips: updatedTrips }, "Vuelta eliminada.");
    returnModal.classList.remove("open");
  } catch (err) {
    console.error(err);
    showToast("No se pudo eliminar la vuelta.");
  }
});

// Print Daily Warehouse Sheet
document.getElementById("btnPrintWarehouse").addEventListener("click", () => {
  const totals = computeWarehouseTotals(currentWhDoc);
  const area = document.getElementById("printReceiptArea");

  const rowsHtml = (currentWhDoc.trips || [])
    .map((t, i) => {
      const oM = Number(t.out?.M) || 0;
      const oP = Number(t.out?.P) || 0;
      const oE = Number(t.out?.E) || 0;
      const oS = Number(t.out?.S) || 0;
      const rM = Number(t.ret?.M) || 0;
      const rP = Number(t.ret?.P) || 0;
      const rE = Number(t.ret?.E) || 0;
      const rS = Number(t.ret?.S) || 0;
      const net = (oM + oP + oE + oS) - (rM + rP + rE + rS);
      return `
        <tr>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${i + 1}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${escapeHtml(t.time)}</td>
          <td style="border:1px solid #264428;padding:4px;font-weight:700;">${escapeHtml(t.driver)}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${escapeHtml(t.ripeness || "")}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${oM}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${oP}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${oE}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${oS}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${rM}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${rP}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${rE}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${rS}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;font-weight:800;">${net}</td>
        </tr>
      `;
    })
    .join("");

  area.innerHTML = `
    <div style="font-size:9pt;color:#111;">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #264428;padding-bottom:8px;margin-bottom:10px;">
        <img src="assets/logo-salinas.png" style="height:16mm;object-fit:contain;" alt="Salinas">
        <div style="text-align:right;">
          <strong style="font-size:12pt;color:#264428;">REPORTE DIARIO DE ALMACÉN</strong>
          <div>Fecha: <strong>${escapeHtml(selectedWhDate)}</strong></div>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
        <thead>
          <tr style="background:#264428;color:#fff;">
            <th style="padding:5px;border:1px solid #264428;">#</th>
            <th style="padding:5px;border:1px solid #264428;">HORA</th>
            <th style="padding:5px;border:1px solid #264428;text-align:left;">CHOFER</th>
            <th style="padding:5px;border:1px solid #264428;">MADUREZ</th>
            <th style="padding:5px;border:1px solid #264428;">SAL M</th>
            <th style="padding:5px;border:1px solid #264428;">SAL P</th>
            <th style="padding:5px;border:1px solid #264428;">SAL E</th>
            <th style="padding:5px;border:1px solid #264428;">SAL S</th>
            <th style="padding:5px;border:1px solid #264428;">DEV M</th>
            <th style="padding:5px;border:1px solid #264428;">DEV P</th>
            <th style="padding:5px;border:1px solid #264428;">DEV E</th>
            <th style="padding:5px;border:1px solid #264428;">DEV S</th>
            <th style="padding:5px;border:1px solid #264428;">VENDIDO</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <table style="width:65%;border-collapse:collapse;margin-bottom:16px;">
        <thead>
          <tr style="background:#eef4ec;color:#264428;">
            <th style="border:1px solid #264428;padding:5px;text-align:left;">CORTE DE ALMACÉN</th>
            <th style="border:1px solid #264428;padding:5px;">M</th>
            <th style="border:1px solid #264428;padding:5px;">P</th>
            <th style="border:1px solid #264428;padding:5px;">E</th>
            <th style="border:1px solid #264428;padding:5px;">S</th>
            <th style="border:1px solid #264428;padding:5px;">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #264428;padding:5px;">Inventario Inicial + Cámara</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.init.M + totals.extra.M}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.init.P + totals.extra.P}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.init.E + totals.extra.E}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.init.S + totals.extra.S}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;font-weight:700;">${totals.totalInit + totals.totalExtra}</td>
          </tr>
          <tr>
            <td style="border:1px solid #264428;padding:5px;">(−) Total Vendido Neto (Total V.)</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.sold.M}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.sold.P}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.sold.E}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.sold.S}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;font-weight:700;">${totals.totalSold}</td>
          </tr>
          <tr style="font-weight:900;background:#f4f8f3;">
            <td style="border:1px solid #264428;padding:5px;">(=) INVENTARIO FINAL (T. INV.)</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.finalStock.M}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.finalStock.P}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.finalStock.E}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.finalStock.S}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.totalFinal}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  document.body.classList.add("printing-receipt");
  window.print();
  setTimeout(() => document.body.classList.remove("printing-receipt"), 500);
});

// ================= TAB 1B: RUTA, MAPA GPS, PUNTOS Y CORTES (FASE 2.5) =================
function syncMapZoomTier() {
  const mapEl = document.getElementById("adminLiveMap");
  if (!mapEl || !leafletMap) return;
  const z = leafletMap.getZoom();
  const tier = z <= 12 ? "far" : z <= 14 ? "mid" : "near";
  if (mapEl.dataset.zoomTier !== tier) {
    mapEl.dataset.zoomTier = tier;
  }
}

function ensureLeafletMap() {
  if (leafletMap || typeof window.L === "undefined") return;
  const mapEl = document.getElementById("adminLiveMap");
  if (!mapEl) return;

  // Default center: Saltillo / Región comercial
  leafletMap = window.L.map("adminLiveMap", { zoomControl: false, minZoom: 5, maxZoom: 19 }).setView([25.4267, -100.9954], 12);
  leafletMap.attributionControl?.setPrefix(false);
  window.L.control.zoom({ position: "bottomright" }).addTo(leafletMap);
  initCleanAdminVectorBaseMap(leafletMap);

  mapLayerGroup = window.L.layerGroup().addTo(leafletMap);
  leafletMap.on("zoomend", syncMapZoomTier);
  syncMapZoomTier();
  setTimeout(() => window.dispatchEvent(new CustomEvent("salinas:map-ready")), 0);

  leafletMap.on("click", (ev) => {
    if (typeof mapPickCallback === "function") {
      const cb = mapPickCallback;
      mapPickCallback = null;
      const hintEl = document.getElementById("mapPickHint");
      if (hintEl) hintEl.style.display = "none";
      cb({ lat: Number(ev.latlng.lat.toFixed(6)), lng: Number(ev.latlng.lng.toFixed(6)) });
    }
  });

  leafletMap.on("popupopen", () => {
    document.getElementById("adminLiveMap")?.classList.add("has-open-popup");
    leafletMap.eachLayer((lyr) => {
      if (typeof lyr.closeTooltip === "function") lyr.closeTooltip();
    });
  });
  leafletMap.on("popupclose", () => {
    document.getElementById("adminLiveMap")?.classList.remove("has-open-popup");
  });

  syncMobileMapInteractionLock();
}

let mobileMapManualUnlocked = false;

function isTouchDeviceViewport() {
  return window.matchMedia?.("(pointer: coarse)")?.matches || window.innerWidth <= 900;
}

function syncMobileMapInteractionLock() {
  if (!leafletMap) return;
  const mapEl = document.getElementById("adminLiveMap");
  const lockBtn = document.getElementById("btnMobileMapPanLock");
  const card = document.getElementById("adminMapCard");
  const isFullscreen = Boolean(card?.classList.contains("is-fullscreen"));
  const touchMode = isTouchDeviceViewport();

  if (!touchMode) {
    leafletMap.dragging?.enable();
    leafletMap.touchZoom?.enable();
    leafletMap.doubleClickZoom?.enable();
    mapEl?.classList.remove("is-scroll-locked");
    if (lockBtn) lockBtn.style.display = "none";
    return;
  }

  const shouldLock = !isFullscreen && !mobileMapManualUnlocked;
  if (shouldLock) {
    leafletMap.dragging?.disable();
    leafletMap.touchZoom?.disable();
    leafletMap.doubleClickZoom?.disable();
    mapEl?.classList.add("is-scroll-locked");
  } else {
    leafletMap.dragging?.enable();
    leafletMap.touchZoom?.enable();
    leafletMap.doubleClickZoom?.enable();
    mapEl?.classList.remove("is-scroll-locked");
  }

  if (lockBtn) {
    lockBtn.style.display = isFullscreen ? "none" : "inline-flex";
    lockBtn.classList.toggle("is-unlocked", mobileMapManualUnlocked);
    lockBtn.textContent = mobileMapManualUnlocked
      ? "🔓 Moviendo mapa (fijar scroll)"
      : "🔒 Mapa fijo (toca para mover)";
  }
}

document.getElementById("btnMobileMapPanLock")?.addEventListener("click", (e) => {
  e.stopPropagation();
  mobileMapManualUnlocked = !mobileMapManualUnlocked;
  syncMobileMapInteractionLock();
  showToast(
    mobileMapManualUnlocked
      ? "🔓 Mapa desbloqueado: ya puedes moverlo y hacer zoom."
      : "🔒 Mapa fijado: desliza libremente para bajar/subir la página."
  );
});

window.addEventListener("resize", () => {
  syncMobileMapInteractionLock();
});

let mapUsedNativeFullscreen = false;

async function setMapFullscreen(wantFull) {
  const card = document.getElementById("adminMapCard");
  const btnHeader = document.getElementById("btnToggleMapFullscreen");
  if (!card) return;

  card.classList.toggle("is-fullscreen", wantFull);
  document.body.classList.toggle("map-fullscreen-open", wantFull);
  syncMobileMapInteractionLock();

  if (btnHeader) btnHeader.textContent = wantFull ? "✕ Salir Pantalla Completa" : "⛶ Pantalla Completa";

  if (wantFull) {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        mapUsedNativeFullscreen = true;
      }
    } catch (_) {
      mapUsedNativeFullscreen = false;
    }
  } else {
    mapUsedNativeFullscreen = false;
    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch (_) {}
    }
  }

  ensureLeafletMap();
  const refreshSize = () => {
    if (leafletMap) {
      leafletMap.invalidateSize();
      syncMapZoomTier();
    }
  };
  refreshSize();
  setTimeout(refreshSize, 90);
  setTimeout(refreshSize, 260);
}

function toggleMapFullscreen() {
  const card = document.getElementById("adminMapCard");
  if (!card) return;
  setMapFullscreen(!card.classList.contains("is-fullscreen"));
}

document.getElementById("btnToggleMapFullscreen")?.addEventListener("click", toggleMapFullscreen);
document.getElementById("btnCornerMapFullscreen")?.addEventListener("click", toggleMapFullscreen);
document.getElementById("btnFsExit")?.addEventListener("click", () => setMapFullscreen(false));
document.getElementById("btnFsFitAll")?.addEventListener("click", () => fitAllMapMarkers());
document.getElementById("btnFsAddPlace")?.addEventListener("click", () => {
  if (adminPlaceModal) adminPlaceModal.classList.add("open");
});

document.addEventListener("fullscreenchange", () => {
  const card = document.getElementById("adminMapCard");
  if (!document.fullscreenElement && mapUsedNativeFullscreen && card?.classList.contains("is-fullscreen")) {
    setMapFullscreen(false);
  } else if (leafletMap) {
    setTimeout(() => {
      leafletMap.invalidateSize();
      syncMapZoomTier();
    }, 100);
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    const modalOpen = document.querySelector(".modal-backdrop.open");
    const card = document.getElementById("adminMapCard");
    if (!modalOpen && card?.classList.contains("is-fullscreen")) {
      setMapFullscreen(false);
    }
  }
});

function placeMatchesMapFilter(place, status, stats30d, inTodayRoute = false) {
  if (mapPinFilter === "all") return true;
  if (mapPinFilter === "orders") return false;
  if (mapPinFilter === "sold") return status.state === "sold";
  if (mapPinFilter === "visited") return status.state === "visited";
  if (mapPinFilter === "route_pending") return status.state === "pending" && inTodayRoute;
  if (mapPinFilter === "pending") return status.state === "pending";
  if (mapPinFilter === "stale3d") {
    return stats30d ? (stats30d.daysSinceLastVisit === null || stats30d.daysSinceLastVisit >= 3) : false;
  }
  if (mapPinFilter === "stale7d") {
    return stats30d ? (stats30d.daysSinceLastSale === null || stats30d.daysSinceLastSale >= 7) : false;
  }
  if (mapPinFilter === "frequent") {
    return stats30d ? (stats30d.salesCount30d >= 2 || stats30d.totalTouches30d >= 3) : false;
  }
  if (mapPinFilter.startsWith("cat:")) {
    return (place.category || "tienda") === mapPinFilter.slice(4);
  }
  return true;
}

function fitAllMapMarkers() {
  if (focusedTrailDriverId) {
    focusedTrailDriverId = null;
    renderGpsMapAndChips();
  }
  ensureLeafletMap();
  if (!leafletMap) return;
  const pts = [];
  for (const p of allPlaces) {
    if (typeof p.lat !== "number" || typeof p.lng !== "number") continue;
    const st = getPlaceDailyStatus(p);
    if (placeMatchesMapFilter(p, st)) {
      pts.push([p.lat, p.lng]);
    }
  }
  if (mapPinFilter === "all") {
    for (const loc of driverLocations) {
      const isOnline =
        loc.active === true &&
        loc.updatedAtIso &&
        Date.now() - new Date(loc.updatedAtIso).getTime() < 20 * 60 * 1000;
      if (isOnline && typeof loc.lat === "number" && typeof loc.lng === "number") {
        pts.push([loc.lat, loc.lng]);
      }
    }
  }
  if (mapPinFilter === "all" || mapPinFilter === "orders") {
    for (const ord of allOrders) {
      if (ord.status === "nuevo" || ord.status === "confirmado" || ord.status === "en_ruta") {
        const c = resolveOrderCoords(ord);
        if (c) pts.push([c.lat, c.lng]);
      }
    }
  }
  if (pts.length === 0) {
    for (const p of allPlaces) {
      if (typeof p.lat === "number" && typeof p.lng === "number") pts.push([p.lat, p.lng]);
    }
  }
  if (pts.length === 1) {
    leafletMap.setView(pts[0], 14);
  } else if (pts.length > 1) {
    leafletMap.fitBounds(pts, { padding: [36, 36], maxZoom: 15 });
  }
}

document.getElementById("btnFitAllMap")?.addEventListener("click", fitAllMapMarkers);

function formatMinutesAgo(isoStr) {
  if (!isoStr) return "sin señal";
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000));
  if (diffSec < 60) return "hace instantes";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `hace ${hrs} h`;
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

function resolveOrderCoords(ord) {
  if (typeof ord.lat === "number" && typeof ord.lng === "number") {
    return { lat: ord.lat, lng: ord.lng, source: "gps_pedido" };
  }
  const ordPhone10 = normalizePhone10(ord.phone);

  for (const p of allPlaces) {
    if (typeof p.lat !== "number" || typeof p.lng !== "number") continue;
    const pPhone10 = normalizePhone10(p.phone);
    if ((ordPhone10 && pPhone10 && ordPhone10 === pPhone10) || namesMatchPlace(ord.customerName, p.name)) {
      return { lat: p.lat, lng: p.lng, source: "punto_guardado", placeName: p.name, placeCategory: p.category || "tienda" };
    }
  }
  return null;
}

function getPlaceDailyStatus(place) {
  const pPhone10 = normalizePhone10(place.phone);

  const matchingSales = routeSalesList.filter((s) => {
    if (isSaleCancelled(s)) return false;
    if (s.placeId && s.placeId === place.id) return true;
    const sPhone10 = normalizePhone10(s.phone);
    return (pPhone10 && sPhone10 && pPhone10 === sPhone10) || namesMatchPlace(place.name, s.customerName);
  });

  if (matchingSales.length > 0) {
    const boxes = round1(matchingSales.reduce((acc, s) => acc + (Number(s.totalBoxes) || 0), 0));
    const amount = matchingSales.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);
    const lastSale = matchingSales[0];
    return {
      state: "sold",
      boxes,
      amount,
      driver: lastSale.driver || "",
      timeIso: lastSale.createdAtIso || ""
    };
  }

  const matchingVisits = routeVisitsList.filter((v) => {
    if (v.placeId && v.placeId === place.id) return true;
    return namesMatchPlace(place.name, v.placeName);
  });

  if (matchingVisits.length > 0) {
    const v = matchingVisits[0];
    const autoLabel = v.autoGeofence
      ? `Visita automática GPS (${Math.max(1, Math.round((Number(v.dwellSeconds) || 60) / 60))} min)`
      : (v.reason || "Visitado sin venta");
    return {
      state: "visited",
      reason: autoLabel,
      autoGeofence: Boolean(v.autoGeofence),
      driver: v.driver || "",
      distanceMeters: typeof v.distanceMeters === "number" ? v.distanceMeters : null,
      timeIso: v.arrivedAtIso || v.createdAtIso || ""
    };
  }

  return { state: "pending" };
}

function getOffsetLocalDateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function diffDaysBetweenDateStrs(laterStr, earlierStr) {
  if (!laterStr || !earlierStr) return null;
  const t1 = Date.parse(`${laterStr}T12:00:00`);
  const t2 = Date.parse(`${earlierStr}T12:00:00`);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return Math.max(0, Math.round((t1 - t2) / 86400000));
}

function formatShortEsDate(dateStr) {
  if (!dateStr) return "";
  const parts = String(dateStr).split("-");
  if (parts.length !== 3) return dateStr;
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const mIdx = Number(parts[1]) - 1;
  return `${Number(parts[2])} ${months[mIdx] || parts[1]}`;
}

function formatRelativeDaysLabel(days, dateStr) {
  if (days === null || days === undefined) return "Sin registro (30d)";
  if (days === 0) return "Hoy";
  const datePart = dateStr ? ` (${formatShortEsDate(dateStr)})` : "";
  if (days === 1) return `Ayer${datePart}`;
  return `Hace ${days} días${datePart}`;
}

async function load30DayPlaceHistory() {
  try {
    const thirtyDaysAgoStr = getOffsetLocalDateStr(30);
    const [salesSnap, visitsSnap] = await Promise.all([
      getDocs(query(collection(db, "route_sales"), where("date", ">=", thirtyDaysAgoStr))),
      getDocs(query(collection(db, "place_visits"), where("date", ">=", thirtyDaysAgoStr)))
    ]);
    historicalSales30d = salesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    historicalVisits30d = visitsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    historical30dLoaded = true;
    if (allPlaces.length > 0) {
      renderGpsMapAndChips();
    }
  } catch (err) {
    console.warn("No se pudo cargar historial 30d de negocios:", err);
  }
}

function buildHistory30dIndex() {
  const salesMap = new Map();
  for (const s of historicalSales30d) salesMap.set(s.id, s);
  for (const s of routeSalesList) salesMap.set(s.id, s);

  const visitsMap = new Map();
  for (const v of historicalVisits30d) visitsMap.set(v.id, v);
  for (const v of routeVisitsList) visitsMap.set(v.id, v);

  const salesByPlaceId = new Map();
  const salesByPhone10 = new Map();
  const unindexedSales = [];
  for (const s of salesMap.values()) {
    if (isSaleCancelled(s)) continue;
    if (s.placeId) {
      if (!salesByPlaceId.has(s.placeId)) salesByPlaceId.set(s.placeId, []);
      salesByPlaceId.get(s.placeId).push(s);
    } else {
      const p10 = normalizePhone10(s.phone);
      if (p10) {
        if (!salesByPhone10.has(p10)) salesByPhone10.set(p10, []);
        salesByPhone10.get(p10).push(s);
      } else {
        unindexedSales.push(s);
      }
    }
  }

  const visitsByPlaceId = new Map();
  const unindexedVisits = [];
  for (const v of visitsMap.values()) {
    if (v.placeId) {
      if (!visitsByPlaceId.has(v.placeId)) visitsByPlaceId.set(v.placeId, []);
      visitsByPlaceId.get(v.placeId).push(v);
    } else {
      unindexedVisits.push(v);
    }
  }

  return { salesByPlaceId, salesByPhone10, unindexedSales, visitsByPlaceId, unindexedVisits };
}

function computePlace30dStats(place, index, todayStr) {
  const pPhone10 = normalizePhone10(place.phone);
  const matchedSales = [];
  const seenSaleIds = new Set();
  const addSale = (s) => {
    if (!seenSaleIds.has(s.id)) {
      seenSaleIds.add(s.id);
      matchedSales.push(s);
    }
  };
  for (const s of index.salesByPlaceId.get(place.id) || []) addSale(s);
  if (pPhone10) {
    for (const s of index.salesByPhone10.get(pPhone10) || []) addSale(s);
  }
  for (const s of index.unindexedSales) {
    if (namesMatchPlace(place.name, s.customerName)) addSale(s);
  }

  const matchedVisits = [];
  const seenVisitIds = new Set();
  const addVisit = (v) => {
    if (!seenVisitIds.has(v.id)) {
      seenVisitIds.add(v.id);
      matchedVisits.push(v);
    }
  };
  for (const v of index.visitsByPlaceId.get(place.id) || []) addVisit(v);
  for (const v of index.unindexedVisits) {
    if (namesMatchPlace(place.name, v.placeName)) addVisit(v);
  }

  matchedSales.sort((a, b) =>
    String(b.createdAtIso || b.date || "").localeCompare(String(a.createdAtIso || a.date || ""))
  );
  matchedVisits.sort((a, b) =>
    String(b.arrivedAtIso || b.createdAtIso || b.date || "").localeCompare(
      String(a.arrivedAtIso || a.createdAtIso || a.date || "")
    )
  );

  const salesCount30d = matchedSales.length;
  const boxes30d = matchedSales.reduce((acc, s) => acc + (Number(s.totalBoxes) || 0), 0);
  const amount30d = matchedSales.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);
  const visitsOnlyCount30d = matchedVisits.length;
  const totalTouches30d = salesCount30d + visitsOnlyCount30d;

  const latestSale = matchedSales[0] || null;
  const latestVisitOnly = matchedVisits[0] || null;

  const latestSaleKey = latestSale ? String(latestSale.createdAtIso || latestSale.date || "") : "";
  const latestVisitOnlyKey = latestVisitOnly
    ? String(latestVisitOnly.arrivedAtIso || latestVisitOnly.createdAtIso || latestVisitOnly.date || "")
    : "";

  let lastVisitDate = null;
  let lastVisitDriver = "";
  let lastVisitWasSale = false;
  if (latestSaleKey && (!latestVisitOnlyKey || latestSaleKey >= latestVisitOnlyKey)) {
    lastVisitDate = latestSale.date || (latestSale.createdAtIso ? latestSale.createdAtIso.slice(0, 10) : null);
    lastVisitDriver = latestSale.driver || "";
    lastVisitWasSale = true;
  } else if (latestVisitOnly) {
    lastVisitDate =
      latestVisitOnly.date || (latestVisitOnly.createdAtIso ? latestVisitOnly.createdAtIso.slice(0, 10) : null);
    lastVisitDriver = latestVisitOnly.driver || "";
  }

  const lastSaleDate = latestSale
    ? latestSale.date || (latestSale.createdAtIso ? latestSale.createdAtIso.slice(0, 10) : null)
    : null;

  return {
    salesCount30d,
    boxes30d,
    amount30d,
    visitsOnlyCount30d,
    totalTouches30d,
    lastSaleDate,
    lastSaleBoxes: latestSale ? Number(latestSale.totalBoxes) || 0 : 0,
    lastSaleAmount: latestSale ? Number(latestSale.totalAmount) || 0 : 0,
    lastSaleDriver: latestSale ? latestSale.driver || "" : "",
    lastVisitDate,
    lastVisitDriver,
    lastVisitWasSale,
    daysSinceLastSale: diffDaysBetweenDateStrs(todayStr, lastSaleDate),
    daysSinceLastVisit: diffDaysBetweenDateStrs(todayStr, lastVisitDate)
  };
}

function getDriverInitials(rawName) {
  const cleaned = String(rawName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim();
  if (!cleaned) return "CH";
  const skip = new Set(["de", "del", "la", "las", "el", "los", "y"]);
  const words = cleaned.split(/\s+/).filter(Boolean);
  const tokens = words.filter((w) => !skip.has(w.toLowerCase()));
  const src = tokens.length > 0 ? tokens : words;
  if (src.length >= 2) {
    return (src[0][0] + src[1][0]).toUpperCase();
  }
  return src[0].slice(0, 2).toUpperCase();
}

function drawStyledRoutePolyline(latLngs, { color = "#0284c7", kind = "planned" } = {}) {
  if (!mapLayerGroup || !window.L || !Array.isArray(latLngs) || latLngs.length < 2) return;
  if (kind === "actual") {
    // Halo blanco + cinta sólida brillante encima (estilo navegación Google Maps)
    window.L.polyline(latLngs, {
      color: "#ffffff",
      weight: 8.5,
      opacity: 0.92,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }).addTo(mapLayerGroup);
    window.L.polyline(latLngs, {
      color,
      weight: 4.5,
      opacity: 0.96,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(mapLayerGroup);
    return;
  }
  // Ruta planeada (OSRM): contorno suave + línea punteada redondeada
  window.L.polyline(latLngs, {
    color: "#0f172a",
    weight: 7.5,
    opacity: 0.18,
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  }).addTo(mapLayerGroup);
  window.L.polyline(latLngs, {
    color,
    weight: 4,
    opacity: 0.78,
    dashArray: "7 7",
    lineCap: "round",
    lineJoin: "round"
  }).addTo(mapLayerGroup);
}

function getTrailRawSegments(pts) {
  const segs = [];
  let cur = [];
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    if (cur.length > 0) {
      const prev = cur[cur.length - 1];
      const gapM = haversineMeters(prev[0], prev[1], pt.lat, pt.lng);
      if (gapM !== null && gapM > 450) {
        if (cur.length >= 2) segs.push(cur);
        cur = [];
      }
    }
    cur.push([pt.lat, pt.lng]);
  }
  if (cur.length >= 2) segs.push(cur);
  return segs;
}

function getOrFetchMatchedTrailSegments(driverKey, pts) {
  const last = pts[pts.length - 1];
  const cacheKey = `${pts.length}:${last?.lat?.toFixed?.(5) || ""},${last?.lng?.toFixed?.(5) || ""}`;
  const entry = matchedTrailCache.get(driverKey);
  if (entry && entry.key === cacheKey && Array.isArray(entry.segments)) {
    return entry.segments;
  }
  if (!entry || entry.pendingKey !== cacheKey) {
    const prevSegments = entry?.segments || getTrailRawSegments(pts);
    matchedTrailCache.set(driverKey, { key: entry?.key || "", pendingKey: cacheKey, segments: prevSegments });
    matchGpsTrailWithOsrm(pts)
      .then((res) => {
        const cur = matchedTrailCache.get(driverKey);
        if (cur && cur.pendingKey === cacheKey) {
          matchedTrailCache.set(driverKey, {
            key: cacheKey,
            pendingKey: "",
            segments: res.segments?.length ? res.segments : getTrailRawSegments(pts)
          });
          if (focusedTrailDriverId === driverKey || showAllDriverRoutes) {
            renderGpsMapAndChips();
          }
        }
      })
      .catch(() => {});
  }
  return entry?.segments || getTrailRawSegments(pts);
}

function getOrFetchPlannedRouteLatLngs(routeDoc) {
  const stops = Array.isArray(routeDoc?.stops) ? routeDoc.stops : [];
  if (stops.length === 0) return [];
  const cacheKey = `${routeDoc.updatedAtIso || ""}:${stops.map((s) => `${s.id}:${s.status}`).join("|")}`;
  const entry = allDriverRouteGeomCache.get(routeDoc.id);
  if (entry && entry.key === cacheKey && Array.isArray(entry.latLngs)) {
    return entry.latLngs;
  }
  if (!entry || entry.pendingKey !== cacheKey) {
    const fallbackPts = stops
      .filter((s) => Number.isFinite(Number(s?.lat)) && Number.isFinite(Number(s?.lng)))
      .map((s) => [Number(s.lat), Number(s.lng)]);
    allDriverRouteGeomCache.set(routeDoc.id, {
      key: entry?.key || "",
      pendingKey: cacheKey,
      latLngs: entry?.latLngs || fallbackPts
    });
    const base = routeDoc.baseLocation || getStoreBaseLocation();
    const pendingStops = stops.filter((s) => s.status !== "done");
    const targetStops = pendingStops.length > 0 ? pendingStops : stops;
    const endCoord = routeDoc.includeReturnToBase !== false ? base : null;
    computeOrderedRouteMetrics({ startCoord: base, stops: targetStops, endCoord })
      .then((res) => {
        const cur = allDriverRouteGeomCache.get(routeDoc.id);
        if (cur && cur.pendingKey === cacheKey && Array.isArray(res.latLngs) && res.latLngs.length >= 2) {
          allDriverRouteGeomCache.set(routeDoc.id, {
            key: cacheKey,
            pendingKey: "",
            latLngs: res.latLngs
          });
          if (showAllDriverRoutes) {
            renderGpsMapAndChips();
          }
        }
      })
      .catch(() => {});
  }
  return entry?.latLngs || [];
}

document.getElementById("btnToggleAllRoutes")?.addEventListener("click", () => {
  showAllDriverRoutes = !showAllDriverRoutes;
  if (!showAllDriverRoutes) {
    focusedTrailDriverId = null;
  }
  const btn = document.getElementById("btnToggleAllRoutes");
  if (btn) {
    btn.classList.toggle("btn-primary", showAllDriverRoutes);
    btn.classList.toggle("btn-outline", !showAllDriverRoutes);
  }
  renderGpsMapAndChips();
});

function renderGpsMapAndChips() {
  const chipsEl = document.getElementById("gpsDriverChips");
  const fsChipsEl = document.getElementById("fsDriverChips");
  const filterBarEl = document.getElementById("mapFilterBar");
  const badgeEl = document.getElementById("gpsOnlineBadge");
  const summaryEl = document.getElementById("placesSupervisionSummary");
  if (!chipsEl || !badgeEl) return;

  const activeDriverNamesSet = new Set(
    (storeSettings.drivers || []).map((d) => String(d.name || "").trim().toLowerCase()).filter(Boolean)
  );
  const activeDriverSlugsSet = new Set(
    (storeSettings.drivers || []).map((d) => rbDriverSlug(d.name)).filter(Boolean)
  );

  // Filtrar solo choferes vigentes del catálogo oficial (oculta registros viejos/duplicados o de prueba)
  const validLocs = driverLocations.filter((loc) => {
    if (typeof loc.lat !== "number" || typeof loc.lng !== "number") return false;
    if (activeDriverNamesSet.size === 0) return true;
    const nameKey = String(loc.driverName || "").trim().toLowerCase();
    const idKey = String(loc.id || "").trim().toLowerCase();
    return activeDriverNamesSet.has(nameKey) || activeDriverSlugsSet.has(idKey);
  });

  const isViewingToday = selectedRouteDate === getLocalDateStr();

  // Consider "online" if active === true and updated within last 20 minutes (only when viewing today)
  const onlineLocs = isViewingToday
    ? validLocs.filter((loc) => {
        if (!loc.active || !loc.updatedAtIso) return false;
        return Date.now() - new Date(loc.updatedAtIso).getTime() < 20 * 60 * 1000;
      })
    : [];

  badgeEl.textContent = isViewingToday
    ? `${onlineLocs.length} carro${onlineLocs.length === 1 ? "" : "s"} en vivo`
    : `Historial ${selectedRouteDate}`;

  const offlineLocs = isViewingToday ? validLocs.filter((loc) => !onlineLocs.some((o) => o.id === loc.id)) : [];
  const showOfflineChips = Boolean(window.__salinasShowOfflineMapChips);

  if (!isViewingToday) {
    chipsEl.innerHTML = `<span style="font-size:0.8rem;color:var(--slate-500);">📅 Viendo historial del <strong>${escapeHtml(selectedRouteDate)}</strong> (GPS en vivo oculto).</span>`;
    if (fsChipsEl) fsChipsEl.innerHTML = `<span class="fs-drv-pill paused">📅 ${escapeHtml(selectedRouteDate)}</span>`;
  } else if (validLocs.length === 0) {
    chipsEl.innerHTML = `<span style="font-size:0.82rem;color:var(--slate-500);">Aún ningún chofer ha activado su GPS hoy.</span>`;
    if (fsChipsEl) fsChipsEl.innerHTML = `<span class="fs-drv-pill paused">⚪ 0 carros</span>`;
  } else {
    const orderedForChips = showOfflineChips ? [...onlineLocs, ...offlineLocs] : onlineLocs;
    const chipHtml = orderedForChips
      .map((loc) => {
        const isOnline = onlineLocs.some((o) => o.id === loc.id);
        const dot = isOnline ? "🟢" : "⚪";
        const boxesTxt = typeof loc.boxesInCar === "number" ? ` • ${loc.boxesInCar}c` : "";
        return `
          <button type="button" class="gps-driver-chip ${isOnline ? "online" : ""}" data-focus-driver="${escapeHtml(loc.id)}" title="${isOnline ? "Enfocar en mapa" : "Ver última ubicación conocida"}">
            <span>${dot} ${escapeHtml(loc.driverName || loc.id)}</span>
            <span style="font-weight:600;color:var(--slate-500);">${formatMinutesAgo(loc.updatedAtIso).replace(/^hace\s+/, "")}${boxesTxt}</span>
          </button>
        `;
      })
      .join("");

    const offlineToggleBtn = offlineLocs.length > 0
      ? `<button type="button" id="btnToggleOfflineDriverChips" class="gps-driver-chip" style="background:#f1f5f9;border-style:dashed;">
           <span>👥 ${showOfflineChips ? "Ocultar" : "Offline"} (${offlineLocs.length}) ${showOfflineChips ? "▴" : "▾"}</span>
         </button>`
      : "";

    chipsEl.innerHTML = (chipHtml || `<span style="font-size:0.78rem;color:var(--slate-500);align-self:center;">0 en vivo ahora</span>`) + offlineToggleBtn;

    if (fsChipsEl) {
      fsChipsEl.innerHTML = validLocs
        .map((loc) => {
          const isOnline = onlineLocs.some((o) => o.id === loc.id);
          const dot = isOnline ? "🟢" : "⚪";
          const initials = getDriverInitials(loc.driverName || loc.id);
          const ago = formatMinutesAgo(loc.updatedAtIso).replace(/^hace\s+/, "");
          const boxesTxt = typeof loc.boxesInCar === "number" ? ` · ${loc.boxesInCar}c` : "";
          return `
            <button type="button" class="fs-drv-pill ${isOnline ? "" : "paused"}" data-focus-driver="${escapeHtml(loc.id)}" title="${escapeHtml(loc.driverName || loc.id)}">
              <span>${dot} ${escapeHtml(initials)}</span>
              <span style="opacity:0.85;font-weight:600;">${escapeHtml(ago)}${boxesTxt}</span>
            </button>
          `;
        })
        .join("");
    }
  }

  const trailColors = ["#15803d", "#0284c7", "#7c3aed", "#b45309"];
  const placeAssignedMap = new Map();
  let assignColorIdx = 0;
  for (const rDoc of allDriverRoutesTodayMap.values()) {
    const dName = rDoc.driverName || rDoc.id;
    const dColor = trailColors[assignColorIdx % trailColors.length];
    assignColorIdx++;
    const dInitials = getDriverInitials(dName);
    for (const st of rDoc.stops || []) {
      if (st.status === "done" || st.kind !== "place" || !st.id) continue;
      if (!placeAssignedMap.has(st.id)) placeAssignedMap.set(st.id, []);
      placeAssignedMap.get(st.id).push({ driverName: dName, color: dColor, initials: dInitials });
    }
  }
  const activeRbStopIds = isViewingToday ? new Set(rbStops.map((s) => s.id).filter(Boolean)) : new Set();

  // Compute daily place supervision counts and category counts
  let soldCount = 0;
  let visitedCount = 0;
  let routePendingCount = 0;
  let pendingCount = 0;
  let stale3dCount = 0;
  let stale7dCount = 0;
  let frequentCount = 0;
  const catCounts = { tienda: 0, restaurante: 0, carniceria: 0, fruteria: 0 };
  const todayStr = getLocalDateStr();
  const historyIndex = buildHistory30dIndex();
  const validPlaces = allPlaces.filter((p) => typeof p.lat === "number" && typeof p.lng === "number");
  const placeEvaluations = validPlaces.map((p) => {
    const st = getPlaceDailyStatus(p);
    const stats30d = computePlace30dStats(p, historyIndex, todayStr);
    const assignedDrivers = placeAssignedMap.get(p.id) || [];
    const inTodayRoute = assignedDrivers.length > 0 || activeRbStopIds.has(p.id);
    if (st.state === "sold") soldCount++;
    else if (st.state === "visited") visitedCount++;
    else {
      pendingCount++;
      if (inTodayRoute) routePendingCount++;
    }
    if (stats30d.daysSinceLastVisit === null || stats30d.daysSinceLastVisit >= 3) stale3dCount++;
    if (stats30d.daysSinceLastSale === null || stats30d.daysSinceLastSale >= 7) stale7dCount++;
    if (stats30d.salesCount30d >= 2 || stats30d.totalTouches30d >= 3) frequentCount++;
    const catKey = p.category || "tienda";
    if (catCounts[catKey] !== undefined) catCounts[catKey]++;
    return { place: p, status: st, stats30d, assignedDrivers, inTodayRoute };
  });

  // Active orders with coordinates
  const activeOrders = allOrders.filter(
    (o) => o.status === "nuevo" || o.status === "confirmado" || o.status === "en_ruta"
  );
  const pinnedOrders = [];
  let unpinnedActiveCount = 0;
  for (const ord of activeOrders) {
    const coords = resolveOrderCoords(ord);
    if (coords) pinnedOrders.push({ ord, coords });
    else unpinnedActiveCount++;
  }

  if (filterBarEl) {
    const filters = [
      { id: "all", label: "Todos", count: validPlaces.length },
      { id: "orders", label: "📦 Pedidos", count: pinnedOrders.length },
      { id: "sold", label: "🟢 Compraron", count: soldCount },
      { id: "visited", label: "🔴 No compraron", count: visitedCount },
      { id: "route_pending", label: "🟡 En ruta", count: routePendingCount },
      { id: "pending", label: "⚪ Sin visita", count: pendingCount },
      { id: "stale3d", label: "⏳ +3d s/visita", count: stale3dCount },
      { id: "stale7d", label: "🚨 +7d s/compra", count: stale7dCount },
      { id: "frequent", label: "🔥 Frecuentes", count: frequentCount },
      { id: "cat:tienda", label: "🏪 Tiendas", count: catCounts.tienda },
      { id: "cat:restaurante", label: "🍽️ Rest.", count: catCounts.restaurante },
      { id: "cat:carniceria", label: "🥩 Carnes", count: catCounts.carniceria },
      { id: "cat:fruteria", label: "🥑 Frut.", count: catCounts.fruteria }
    ];
    filterBarEl.innerHTML = filters
      .map(
        (f) => `
          <button type="button" class="map-filter-chip ${mapPinFilter === f.id ? "active" : ""}" data-map-filter="${f.id}">
            <span>${f.label}</span>
            <span class="cnt">${f.count}</span>
          </button>
        `
      )
      .join("");
  }

  if (summaryEl) {
    const unroutedPendingCount = Math.max(0, pendingCount - routePendingCount);
    summaryEl.innerHTML = `
      <span><strong>🏪 Negocios (${validPlaces.length}):</strong> 🟢 Compraron: <strong>${soldCount}</strong> • 🔴 No compraron: <strong>${visitedCount}</strong> • 🟡 Pendientes en ruta: <strong>${routePendingCount}</strong> • ⚪ Sin visita: <strong>${unroutedPendingCount}</strong></span>
      <span><strong>📦 Pedidos Activos en Mapa:</strong> <strong>${pinnedOrders.length}</strong>${unpinnedActiveCount > 0 ? ` (${unpinnedActiveCount} pendientes de ubicar)` : ""}</span>
    `;
  }

  if (!leafletMap || !mapLayerGroup) return;

  mapLayerGroup.clearLayers();
  mapFocusMarkers.clear();

  const boundsPoints = [];

  // 1. Registered Places (Tiendas, Carnicerías, Restaurantes, Fruterías)
  const placeStatusById = new Map(placeEvaluations.map((ev) => [ev.place.id, ev.status]));
  for (const { place, status, stats30d, assignedDrivers, inTodayRoute } of placeEvaluations) {
    if (!placeMatchesMapFilter(place, status, stats30d, inTodayRoute)) continue;
    boundsPoints.push([place.lat, place.lng]);
    const cat = PLACE_CATEGORIES[place.category] || PLACE_CATEGORIES.tienda;
    const stClass =
      status.state === "sold"
        ? "st-sold"
        : status.state === "visited"
          ? "st-visited"
          : inTodayRoute
            ? "st-route-pending"
            : "st-pending";
    const isGoldFrequent = stats30d.salesCount30d >= 3;
    const hasNumberedStopOnPin = activeRbStopIds.has(place.id);
    const assignedTagHtml =
      assignedDrivers.length > 0 && !hasNumberedStopOnPin
        ? `<span class="pin-assigned-tag" style="background:${assignedDrivers[0].color};">${escapeHtml(assignedDrivers[0].initials)}</span>`
        : "";
    const dayLabel = isViewingToday ? "hoy" : `el ${escapeHtml(selectedRouteDate)}`;
    const dayCapLabel = isViewingToday ? "Hoy" : escapeHtml(selectedRouteDate);
    const assignedLineHtml = assignedDrivers.length > 0
      ? `<div style="margin-top:3px;color:#0369a1;font-weight:800;font-size:0.74rem;">🧭 En ruta ${dayLabel}: ${escapeHtml(assignedDrivers.map((a) => a.driverName).join(", "))}</div>`
      : "";
    const stBadge =
      status.state === "sold"
        ? `<div style="margin-top:5px;background:#dcfce7;color:#14532d;padding:4px 7px;border-radius:6px;font-size:0.78rem;font-weight:700;">🟢 Compró ${dayLabel}: ${status.boxes} caja(s) (${formatCurrency(status.amount)}) • ${escapeHtml(status.driver)}</div>`
        : status.state === "visited"
          ? `<div style="margin-top:5px;background:#fee2e2;color:#991b1b;padding:4px 7px;border-radius:6px;font-size:0.78rem;font-weight:700;">🔴 Visitado ${dayLabel} (no compró) por ${escapeHtml(status.driver)}: ${escapeHtml(status.reason)}${status.distanceMeters !== null ? ` (GPS a ${status.distanceMeters} m)` : ""}</div>`
          : inTodayRoute
            ? `<div style="margin-top:5px;background:#fef9c3;color:#713f12;padding:4px 7px;border-radius:6px;font-size:0.78rem;font-weight:700;">🟡 Pendiente de visitar ${dayLabel} (en ruta)</div>`
            : `<div style="margin-top:5px;background:#f1f5f9;color:#475569;padding:4px 7px;border-radius:6px;font-size:0.78rem;">⚪ Aún sin visita ni ruta registrada ${dayLabel}</div>`;

    const lastSaleLine = stats30d.lastSaleDate
      ? `🛒 Últ. compra: <strong>${escapeHtml(formatRelativeDaysLabel(stats30d.daysSinceLastSale, stats30d.lastSaleDate))}</strong> • ${stats30d.lastSaleBoxes} caja(s) (${formatCurrency(stats30d.lastSaleAmount)})${stats30d.lastSaleDriver ? ` • ${escapeHtml(stats30d.lastSaleDriver)}` : ""}`
      : `🛒 Últ. compra: <span style="color:#b91c1c;font-weight:700;">Sin compras en 30 días</span>`;

    const lastVisitLine = stats30d.lastVisitDate
      ? `👋 Últ. visita: <strong>${escapeHtml(formatRelativeDaysLabel(stats30d.daysSinceLastVisit, stats30d.lastVisitDate))}</strong>${stats30d.lastVisitDriver ? ` • ${escapeHtml(stats30d.lastVisitDriver)}` : ""}`
      : `👋 Últ. visita: <span style="color:#b45309;font-weight:700;">Sin visitas en 30 días</span>`;

    const freqLine = `📊 30d: <strong>${stats30d.salesCount30d}</strong> compra(s) • <strong>${stats30d.boxes30d}</strong> cajas • <strong>${stats30d.totalTouches30d}</strong> visita(s)`;

    const showPrevSale = !(status.state === "sold" && stats30d.daysSinceLastSale === 0);
    const showPrevVisit = !(
      (status.state === "sold" || status.state === "visited") &&
      stats30d.daysSinceLastVisit === 0
    );

    const historyRows = [
      showPrevSale ? `<div>${lastSaleLine}</div>` : "",
      showPrevVisit ? `<div>${lastVisitLine}</div>` : "",
      `<div>${freqLine}</div>`
    ].filter(Boolean).join("");

    const historyBoxHtml = historical30dLoaded && historyRows
      ? `<div style="margin-top:6px;padding:5px 7px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:0.74rem;line-height:1.45;color:#334155;">
          ${historyRows}
        </div>`
      : "";

    const todayHoverBadge =
      status.state === "sold"
        ? `<div style="color:#15803d;font-weight:700;">🟢 ${dayCapLabel}: compró ${status.boxes} caja(s) (${formatCurrency(status.amount)})</div>`
        : status.state === "visited"
          ? `<div style="color:#dc2626;font-weight:700;">🔴 Visitado ${dayLabel} — no compró (${escapeHtml(status.driver || "chofer")})</div>`
          : inTodayRoute
            ? `<div style="color:#a16207;font-weight:700;">🟡 Pendiente de visitar ${dayLabel}</div>`
            : `<div style="color:#64748b;">⚪ Sin visita ${dayLabel}</div>`;

    const tooltipHtml = `
      <div class="salinas-tt-inner">
        <div class="salinas-tt-head">
          <span>${cat.emoji} ${escapeHtml(place.name)}</span>
          ${isGoldFrequent ? `<span class="salinas-tt-gold">⭐ Frecuente</span>` : ""}
        </div>
        ${todayHoverBadge}
        ${assignedLineHtml}
        ${historical30dLoaded ? `
          <div class="salinas-tt-meta">${lastSaleLine}</div>
          ${!stats30d.lastVisitWasSale || !stats30d.lastSaleDate ? `<div class="salinas-tt-meta">${lastVisitLine}</div>` : ""}
          <div class="salinas-tt-meta">${freqLine}</div>
        ` : `<div class="salinas-tt-meta" style="color:#94a3b8;">Cargando historial 30d…</div>`}
      </div>
    `;

    const icon = window.L.divIcon({
      className: "salinas-div-icon",
      html: `<div class="pin-place-dot ${stClass}${isGoldFrequent ? " is-frequent" : ""}" style="position:relative;"><span class="pin-emoji">${cat.emoji}</span>${assignedTagHtml}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -10]
    });

    const popupHtml = `
      <div style="font-family:sans-serif;max-width:100%;">
        <div style="font-size:0.7rem;font-weight:800;color:#475569;text-transform:uppercase;padding-right:10px;">${cat.emoji} ${escapeHtml(cat.label)}${isGoldFrequent ? ` • <span style="color:#d97706;">⭐ Frecuente</span>` : ""}</div>
        <strong style="font-size:0.93rem;color:#132615;display:block;line-height:1.25;">${escapeHtml(place.name)}</strong>
        ${place.address ? `<div style="font-size:0.76rem;color:#475569;margin-top:2px;">📍 ${escapeHtml(place.address)}</div>` : ""}
        ${place.phone ? `<div style="font-size:0.76rem;color:#475569;margin-top:2px;">📞 ${escapeHtml(place.phone)}</div>` : ""}
        ${assignedLineHtml}
        ${stBadge}
        ${historyBoxHtml}
        <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <a href="https://maps.google.com/?q=${place.lat},${place.lng}" target="_blank" rel="noopener" style="font-size:0.75rem;font-weight:800;color:#15803d;text-decoration:underline;">Abrir en Google Maps ↗</a>
          <button type="button" onclick="window.__salinasAddPlaceToRoute?.('${escapeHtml(place.id)}')" style="border:none;background:#065f46;color:#fff;padding:5px 9px;border-radius:8px;font-size:0.74rem;font-weight:800;cursor:pointer;">➕ Sumar a Ruta</button>
        </div>
      </div>
    `;

    const zOff = status.state === "sold" ? 300 : status.state === "visited" ? 250 : inTodayRoute ? 200 : isGoldFrequent ? 100 : 0;
    const isTouchMap = isTouchDeviceViewport();
    const m = window.L.marker([place.lat, place.lng], { icon, zIndexOffset: zOff })
      .addTo(mapLayerGroup)
      .bindPopup(popupHtml, {
        maxWidth: isTouchMap ? 245 : 295,
        autoPanPaddingTopLeft: [14, 52],
        autoPanPaddingBottomRight: [14, 18]
      });
    if (!isTouchMap) {
      m.bindTooltip(tooltipHtml, {
        direction: "auto",
        sticky: false,
        opacity: 0.98,
        className: "salinas-place-tooltip",
        offset: [0, -8]
      });
      m.on("tooltipopen", (ev) => {
        try {
          const pt = leafletMap.latLngToContainerPoint(m.getLatLng());
          const mapH = leafletMap.getSize().y || 500;
          const tt = ev.tooltip;
          if (!tt || !tt.options) return;
          const desiredDir = pt.y < Math.min(165, mapH * 0.36) ? "bottom" : "top";
          if (tt.options.direction !== desiredDir) {
            tt.options.direction = desiredDir;
            tt.options.offset = desiredDir === "bottom" ? [0, 12] : [0, -8];
            tt.update();
          }
        } catch (_) {}
      });
    }
    mapFocusMarkers.set(`place:${place.id}`, m);
  }

  // 2. Driver Daily Trajectory Trails + Live Car Markers (only when GPS is active/online)
  const allRoutesCntEl = document.getElementById("allRoutesCnt");
  if (allRoutesCntEl) allRoutesCntEl.textContent = String(allDriverRoutesTodayMap.size);

  // Si el toggle "Ver todas las rutas" está activo, dibujar rutas planeadas OSRM de todos los choferes
  if (showAllDriverRoutes && allDriverRoutesTodayMap.size > 0) {
    const selectedRbSlug = rbDriverSlug(document.getElementById("rbDriverSelect")?.value || "");
    let rIdx = 0;
    for (const routeDoc of allDriverRoutesTodayMap.values()) {
      const rSlug = String(routeDoc.driverSlug || rbDriverSlug(routeDoc.driverName || ""));
      const locIdx = onlineLocs.findIndex(
        (l) => l.id === rSlug || rbDriverSlug(l.driverName || "") === rSlug
      );
      const rColor = locIdx >= 0 ? trailColors[locIdx % trailColors.length] : trailColors[rIdx % trailColors.length];
      rIdx++;
      // Evitar duplicar si el constructor ya está dibujando exactamente la ruta de este chofer
      if (rSlug && rSlug === selectedRbSlug && rbPreviewLatLngs.length >= 2) continue;
      const plannedLatLngs = getOrFetchPlannedRouteLatLngs(routeDoc);
      if (plannedLatLngs.length >= 2) {
        drawStyledRoutePolyline(plannedLatLngs, { color: rColor, kind: "planned" });
      }
    }
  }

  // Agrupar choferes cercanos para separarlos en círculo en píxeles de pantalla (sin traslape al hacer zoom out)
  const driverClusters = [];
  onlineLocs.forEach((loc) => {
    const match = driverClusters.find(
      (cl) => Math.abs(cl.lat - loc.lat) < 0.0004 && Math.abs(cl.lng - loc.lng) < 0.0004
    );
    if (match) match.items.push(loc);
    else driverClusters.push({ lat: loc.lat, lng: loc.lng, items: [loc] });
  });
  const driverPixelOffsets = new Map();
  driverClusters.forEach((cl) => {
    const n = cl.items.length;
    if (n === 1) {
      driverPixelOffsets.set(cl.items[0].id, { dx: 0, dy: 0 });
      return;
    }
    const radiusPx = n === 2 ? 18 : n <= 4 ? 22 : 26;
    cl.items.forEach((item, k) => {
      const angle = (2 * Math.PI * k) / n - Math.PI / 2;
      driverPixelOffsets.set(item.id, {
        dx: Math.round(radiusPx * Math.cos(angle)),
        dy: Math.round(radiusPx * Math.sin(angle))
      });
    });
  });

  onlineLocs.forEach((loc, idx) => {
    boundsPoints.push([loc.lat, loc.lng]);
    let offset = driverPixelOffsets.get(loc.id) || { dx: 0, dy: 0 };
    if (offset.dx === 0 && offset.dy === 0) {
      const nearPlace = allPlaces.some(
        (p) =>
          typeof p.lat === "number" &&
          typeof p.lng === "number" &&
          Math.abs(p.lat - loc.lat) < 0.00045 &&
          Math.abs(p.lng - loc.lng) < 0.00045
      );
      const nearRbStop = rbStops.some(
        (s) =>
          typeof s.lat === "number" &&
          typeof s.lng === "number" &&
          Math.abs(s.lat - loc.lat) < 0.00045 &&
          Math.abs(s.lng - loc.lng) < 0.00045
      );
      let nearAnyRouteStop = nearRbStop;
      if (!nearAnyRouteStop && allDriverRoutesTodayMap?.size) {
        for (const rDoc of allDriverRoutesTodayMap.values()) {
          if (
            Array.isArray(rDoc?.stops) &&
            rDoc.stops.some(
              (s) =>
                typeof s.lat === "number" &&
                typeof s.lng === "number" &&
                Math.abs(s.lat - loc.lat) < 0.00045 &&
                Math.abs(s.lng - loc.lng) < 0.00045
            )
          ) {
            nearAnyRouteStop = true;
            break;
          }
        }
      }
      if (nearPlace || nearAnyRouteStop) {
        offset = { dx: 18, dy: -16 };
      }
    }
    const trailColor = trailColors[idx % trailColors.length];

    // Mostrar recorrido real highlighted (ajustado a calles con OSRM Map Matching) del chofer enfocado o de todos si toggle activo
    if ((focusedTrailDriverId === loc.id || showAllDriverRoutes) && loc.trailDate === todayStr && Array.isArray(loc.trail) && loc.trail.length >= 2) {
      const pts = loc.trail.filter((pt) => typeof pt.lat === "number" && typeof pt.lng === "number");
      if (pts.length >= 2) {
        const segs = getOrFetchMatchedTrailSegments(loc.id, pts);
        for (const seg of segs) {
          if (seg.length >= 2) {
            drawStyledRoutePolyline(seg, { color: trailColor, kind: "actual" });
          }
        }
      }
    }

    const fullDriverLabel = loc.driverName || loc.id;
    const initials = getDriverInitials(fullDriverLabel);
    const boxesBadge = typeof loc.boxesInCar === "number" ? ` • ${loc.boxesInCar} cajas` : "";
    const carIcon = window.L.divIcon({
      className: "salinas-div-icon",
      html: `<div class="pin-car-badge is-live-pulse" style="border-color:${trailColor};" title="🚗 ${escapeHtml(fullDriverLabel)}${boxesBadge}">${escapeHtml(initials)}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14 - offset.dx, 14 - offset.dy],
      popupAnchor: [offset.dx, -14 + offset.dy]
    });

    const speedTxt =
      typeof loc.speedKmh === "number" && loc.speedKmh > 1 ? ` • ${Math.round(loc.speedKmh)} km/h` : "";
    const trailPts = loc.trailDate === todayStr && Array.isArray(loc.trail) ? loc.trail.length : 0;

    const popupHtml = `
      <div style="font-family:sans-serif;min-width:185px;">
        <strong style="font-size:0.96rem;color:#132615;">🚗 ${escapeHtml(loc.driverName || loc.id)}</strong>
        <div style="font-size:0.78rem;color:#4e5c50;margin-top:3px;">
          Señal: <strong>${formatMinutesAgo(loc.updatedAtIso)}</strong> (En vivo)${speedTxt}
        </div>
        ${
          typeof loc.boxesInCar === "number"
            ? `<div style="font-size:0.8rem;margin-top:5px;background:#eff6ed;padding:5px 8px;border-radius:6px;">
                📦 En carro: <strong>${loc.boxesInCar} cajas</strong> (${escapeHtml(loc.ripeness || "Surtido")})
               </div>`
            : ""
        }
        ${trailPts >= 2 ? `<div style="font-size:0.74rem;color:#64748b;margin-top:4px;">🛣️ Recorrido hoy: ${trailPts} puntos GPS trazados</div>` : ""}
      </div>
    `;

    const m = window.L.marker([loc.lat, loc.lng], { icon: carIcon, zIndexOffset: 1500 })
      .addTo(mapLayerGroup)
      .bindPopup(popupHtml, {
        autoPanPaddingTopLeft: [14, 52],
        autoPanPaddingBottomRight: [14, 18]
      });
    m.on("click", () => {
      if (focusedTrailDriverId !== loc.id) {
        focusedTrailDriverId = loc.id;
        renderGpsMapAndChips();
        const freshMarker = mapFocusMarkers.get(`driver:${loc.id}`);
        if (freshMarker) freshMarker.openPopup();
      }
    });
    mapFocusMarkers.set(`driver:${loc.id}`, m);
  });

  // 3. Active Order Alert Indicators (New & En-Ruta Online Orders)
  const drivers = storeSettings.drivers || [];
  for (const { ord, coords } of pinnedOrders) {
    const showOrder =
      mapPinFilter === "all" ||
      mapPinFilter === "orders" ||
      (mapPinFilter.startsWith("cat:") && coords.placeCategory === mapPinFilter.slice(4));
    if (!showOrder) continue;

    boundsPoints.push([coords.lat, coords.lng]);
    const isNew = ord.status === "nuevo";
    const wrapClass = isNew ? "pin-order-alert-wrap" : "pin-order-alert-wrap is-route";
    const coreEmoji = isNew ? "🚨" : "📦";

    const orderAlertIcon = window.L.divIcon({
      className: "salinas-div-icon",
      html: `<div class="${wrapClass}"><span class="pulse-ring"></span><div class="pin-order-alert-core">${coreEmoji}</div></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14]
    });

    const itemsSummary = (ord.items || []).map((i) => `${i.qty}×${escapeHtml(i.code)}`).join(", ");
    const driverOpts = [
      `<option value="">— Asignar chofer —</option>`,
      ...drivers.map(
        (d) =>
          `<option value="${escapeHtml(d.name)}" ${ord.assignedDriver === d.name ? "selected" : ""}>${escapeHtml(d.name)}</option>`
      )
    ].join("");

    const popupHtml = `
      <div style="font-family:sans-serif;min-width:215px;">
        <div style="font-size:0.72rem;font-weight:900;color:${isNew ? "#dc2626" : "#0284c7"};text-transform:uppercase;">
          ${isNew ? "🔴 PEDIDO NUEVO EN VIVO" : `🔵 PEDIDO ${escapeHtml((STATUS_LABELS[ord.status] || ord.status).toUpperCase())}`}
        </div>
        <strong style="font-size:0.96rem;color:#132615;">${escapeHtml(ord.customerName)} (${escapeHtml(ord.folio || "")})</strong>
        <div style="font-size:0.78rem;color:#334155;margin-top:3px;">📍 ${escapeHtml(ord.address || "")}</div>
        <div style="font-size:0.8rem;margin-top:5px;background:#fef2f2;padding:5px 8px;border-radius:6px;color:#7f1d1d;">
          🥑 <strong>${ord.totalBoxes} caja(s)</strong> (${itemsSummary}) • <strong>${formatCurrency(ord.totalAmount)}</strong><br>
          Madurez: <strong>${escapeHtml(ord.ripeness || "Surtido")}</strong>
          <div style="margin-top:5px;">
            <button type="button" onclick="window.__salinasAddOrderToRoute?.('${escapeHtml(ord.id)}')" style="border:none;background:#0284c7;color:#fff;padding:4px 9px;border-radius:8px;font-size:0.74rem;font-weight:800;cursor:pointer;">➕ Sumar a Ruta</button>
          </div>
        </div>
        <div style="margin-top:7px;display:flex;gap:5px;align-items:center;">
          <select id="mapAssignSel_${escapeHtml(ord.id)}" style="flex:1;padding:5px 6px;border-radius:6px;border:1px solid #cbd5e1;font-size:0.78rem;font-weight:700;">
            ${driverOpts}
          </select>
          <button type="button" data-map-assign-btn="${escapeHtml(ord.id)}" style="background:#15803d;color:#fff;border:none;border-radius:6px;padding:6px 9px;font-size:0.76rem;font-weight:800;cursor:pointer;">
            Asignar
          </button>
        </div>
      </div>
    `;

    const m = window.L.marker([coords.lat, coords.lng], { icon: orderAlertIcon, zIndexOffset: 1000 })
      .addTo(mapLayerGroup)
      .bindPopup(popupHtml, {
        autoPanPaddingTopLeft: [14, 52],
        autoPanPaddingBottomRight: [14, 18]
      });
    mapFocusMarkers.set(`order:${ord.id}`, m);
  }

  if (isViewingToday && showAllDriverRoutes && typeof renderRoutePreviewOnAdminMap === "function") {
    renderRoutePreviewOnAdminMap(placeStatusById);
  }

  if (!hasCenteredMapOnce && boundsPoints.length > 0) {
    hasCenteredMapOnce = true;
    if (boundsPoints.length === 1) {
      leafletMap.setView(boundsPoints[0], 14);
    } else {
      leafletMap.fitBounds(boundsPoints, { padding: [36, 36], maxZoom: 15 });
    }
  }
}

async function sendDriverGpsPing(driverName, driverId = "", triggerBtn = null) {
  if (!driverName && !driverId) return;
  if (triggerBtn) triggerBtn.disabled = true;
  try {
    const resp = await fetch("https://us-central1-aguacates-salinas.cloudfunctions.net/pingDriverGps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantSlug: ACTIVE_TENANT_SLUG,
        driverId: driverId || undefined,
        driverName,
        adminKeyHash: currentKeyHash
      })
    });
    const json = await resp.json().catch(() => ({}));
    if (resp.ok && json.ok) {
      showToast(`📍 Aviso enviado a ${driverName || driverId}. En cuanto lo toque enviará su GPS.`);
    } else {
      showToast(json.error || "No se pudo enviar el aviso GPS.");
    }
  } catch (err) {
    console.error(err);
    showToast("Error de red al pedir GPS.");
  } finally {
    if (triggerBtn) triggerBtn.disabled = false;
  }
}

let focusedTrailDriverId = null;

function focusDriverOnMap(id) {
  const loc = driverLocations.find((d) => d.id === id);
  if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return;
  const isOnline =
    loc.active === true &&
    loc.updatedAtIso &&
    Date.now() - new Date(loc.updatedAtIso).getTime() < 20 * 60 * 1000;
  focusedTrailDriverId = focusedTrailDriverId === id ? null : id;
  renderGpsMapAndChips();
  ensureLeafletMap();
  if (leafletMap) {
    leafletMap.flyTo([loc.lat, loc.lng], 15, { duration: 0.7 });
    const marker = mapFocusMarkers.get(`driver:${id}`);
    if (marker) marker.openPopup();
    if (!isOnline) {
      showToast(`📍 Última ubicación de ${loc.driverName || id} (${formatMinutesAgo(loc.updatedAtIso)}).`);
    }
  }
}

document.getElementById("gpsDriverChips")?.addEventListener("click", (e) => {
  if (e.target.closest("#btnToggleOfflineDriverChips")) {
    window.__salinasShowOfflineMapChips = !window.__salinasShowOfflineMapChips;
    renderGpsMapAndChips();
    return;
  }
  const chip = e.target.closest("button[data-focus-driver]");
  if (chip) focusDriverOnMap(chip.dataset.focusDriver, chip);
});

document.getElementById("btnJumpToRouteBuilder")?.addEventListener("click", () => {
  const det = document.getElementById("adminRouteBuilderDetails");
  if (det) {
    det.open = true;
    det.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

document.getElementById("mapQuickPlaceSearch")?.addEventListener("input", (e) => {
  const q = e.target.value.trim();
  const box = document.getElementById("mapQuickPlaceResults");
  if (!box) return;
  if (!q) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  const matches = allPlaces
    .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
    .filter((p) => {
      const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.tienda;
      return matchesSmartSearch(`${p.name || ""} ${p.address || ""} ${p.phone || ""} ${cat.label || ""}`, q);
    })
    .slice(0, 12);

  box.style.display = "block";
  box.innerHTML = matches.length
    ? matches
        .map((p) => {
          const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.tienda;
          return `
            <div class="route-pick-result-item" data-map-fly-place="${escapeHtml(p.id)}" style="cursor:pointer;">
              <div style="min-width:0;flex:1;">
                <strong style="display:block;color:var(--green-950);">${cat.emoji} ${escapeHtml(p.name)}</strong>
                <span style="font-size:0.73rem;color:var(--slate-500);">${escapeHtml(p.address || cat.label)}</span>
              </div>
              <span style="font-size:0.74rem;font-weight:800;color:#15803d;">Ver pin ↗</span>
            </div>
          `;
        })
        .join("")
    : `<div style="padding:10px;font-size:0.8rem;color:var(--slate-500);">Sin tiendas con ese nombre.</div>`;
});

document.getElementById("mapQuickPlaceResults")?.addEventListener("click", (e) => {
  const row = e.target.closest("[data-map-fly-place]");
  if (!row) return;
  const pid = row.dataset.mapFlyPlace;
  const p = allPlaces.find((x) => x.id === pid);
  const box = document.getElementById("mapQuickPlaceResults");
  if (box) box.style.display = "none";
  if (!p || !leafletMap) return;
  leafletMap.flyTo([p.lat, p.lng], 16, { duration: 0.65 });
  const marker = mapFocusMarkers.get(`place:${p.id}`);
  if (marker) {
    setTimeout(() => marker.openPopup(), 350);
  }
});

document.getElementById("fsDriverChips")?.addEventListener("click", (e) => {
  const chip = e.target.closest("button[data-focus-driver]");
  if (chip) focusDriverOnMap(chip.dataset.focusDriver, chip);
});

document.getElementById("mapFilterBar")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-map-filter]");
  if (!btn) return;
  const chosen = btn.dataset.mapFilter;
  mapPinFilter = mapPinFilter === chosen && chosen !== "all" ? "all" : chosen;
  renderGpsMapAndChips();
  if (mapPinFilter !== "all") {
    fitAllMapMarkers();
  }
});

// Delegated listener for assigning driver right inside a Map Order Popup
document.getElementById("adminLiveMap")?.addEventListener("click", async (e) => {
  const assignBtn = e.target.closest("button[data-map-assign-btn]");
  if (!assignBtn) return;
  const orderId = assignBtn.dataset.mapAssignBtn;
  const sel = document.getElementById(`mapAssignSel_${orderId}`);
  if (!sel) return;
  const driverName = sel.value;
  const ord = allOrders.find((o) => o.id === orderId);
  if (!ord) return;
  const nextStatus = ord.status === "nuevo" && driverName ? "confirmado" : ord.status;

  assignBtn.disabled = true;
  assignBtn.textContent = "...";
  try {
    await executeAdminBatch(currentKeyHash, (batch, proofId) => {
      batch.update(doc(db, "orders", orderId), {
        assignedDriver: driverName,
        status: nextStatus,
        proofId,
        updatedAt: serverTimestamp()
      });
    });
    showToast(driverName ? `🚗 Pedido asignado a ${driverName} desde el mapa.` : "Chofer desasignado.");
  } catch (err) {
    console.error(err);
    showToast("Error al asignar chofer.");
  } finally {
    assignBtn.disabled = false;
    assignBtn.textContent = "Asignar";
  }
});

// ================= PLACES DIRECTORY & ADMIN MODAL =================
function renderAdminPlacesDirectory() {
  const listEl = document.getElementById("adminPlacesList");
  const pillEl = document.getElementById("placesDirCountPill");
  const titleEl = document.getElementById("placesDirTitle");
  const isTodayDir = selectedRouteDate === getLocalDateStr();
  const dirDaySuffix = isTodayDir ? "de Hoy" : `(${selectedRouteDate})`;
  const dirDayLabel = isTodayDir ? "hoy" : `el ${escapeHtml(selectedRouteDate)}`;
  if (titleEl) titleEl.textContent = `🏪 Directorio de Puntos de Compra y Visitas ${dirDaySuffix}`;
  if (pillEl) pillEl.textContent = `${allPlaces.length} registrado${allPlaces.length === 1 ? "" : "s"} ▾`;
  if (!listEl) return;

  if (allPlaces.length === 0) {
    listEl.innerHTML = `<div class="cart-empty">Aún no hay tiendas, carnicerías o restaurantes guardados. Tus choferes pueden guardarlos con 1 toque al visitarlos o tú puedes agregarlos con <strong>➕ Punto / Tienda</strong>.</div>`;
    return;
  }

  listEl.innerHTML = allPlaces
    .map((p) => {
      const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.tienda;
      const st = getPlaceDailyStatus(p);
      const badge =
        st.state === "sold"
          ? `<span style="background:#dcfce7;color:#14532d;padding:3px 8px;border-radius:999px;font-size:0.74rem;font-weight:800;">🟢 Compró (${st.boxes}c)</span>`
          : st.state === "visited"
            ? `<span style="background:#fee2e2;color:#991b1b;padding:3px 8px;border-radius:999px;font-size:0.74rem;font-weight:800;">🔴 No compró</span>`
            : `<span style="background:#f1f5f9;color:#475569;padding:3px 8px;border-radius:999px;font-size:0.74rem;font-weight:700;">⚪ Sin visita ${dirDayLabel}</span>`;

      return `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--slate-200);">
          <div style="min-width:200px;flex:1;">
            <div style="font-weight:800;color:var(--green-950);font-size:0.92rem;">
              ${cat.emoji} ${escapeHtml(p.name)} ${badge}
            </div>
            <div style="font-size:0.78rem;color:var(--slate-500);margin-top:2px;">
              ${escapeHtml(cat.label)}${p.address ? ` • 📍 ${escapeHtml(p.address)}` : ""}${p.phone ? ` • 📞 ${escapeHtml(p.phone)}` : ""}${p.createdBy ? ` • Alta: ${escapeHtml(p.createdBy)}` : ""}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn btn-outline btn-sm" data-place-focus="${escapeHtml(p.id)}">🗺️ Ver en Mapa</button>
            <button type="button" class="btn btn-outline btn-sm" data-place-remove="${escapeHtml(p.id)}" style="color:var(--red-600);border-color:#eccaca;">Quitar</button>
          </div>
        </div>
      `;
    })
    .join("");
}

document.getElementById("adminPlacesList")?.addEventListener("click", async (e) => {
  const focusBtn = e.target.closest("button[data-place-focus]");
  if (focusBtn) {
    const pid = focusBtn.dataset.placeFocus;
    const p = allPlaces.find((x) => x.id === pid);
    if (!p || typeof p.lat !== "number") return;
    ensureLeafletMap();
    if (mapPinFilter !== "all") {
      mapPinFilter = "all";
      renderGpsMapAndChips();
    }
    document.getElementById("adminMapCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (leafletMap) {
      leafletMap.flyTo([p.lat, p.lng], 16, { duration: 0.6 });
      const m = mapFocusMarkers.get(`place:${pid}`);
      if (m) m.openPopup();
    }
    return;
  }

  const remBtn = e.target.closest("button[data-place-remove]");
  if (remBtn) {
    const pid = remBtn.dataset.placeRemove;
    const p = allPlaces.find((x) => x.id === pid);
    if (!p) return;
    if (!confirm(`¿Quitar "${p.name}" del directorio activo del mapa?`)) return;
    try {
      await executeAdminBatch(currentKeyHash, (batch, proofId) => {
        batch.update(doc(db, "places", pid), {
          active: false,
          proofId,
          updatedAt: serverTimestamp()
        });
      });
      showToast("Punto retirado del mapa.");
    } catch (err) {
      console.error(err);
      showToast("No se pudo retirar el punto.");
    }
  }
});

const adminPlaceModal = document.getElementById("adminPlaceModal");
let pendingAddPlaceToRouteAfterSave = false;

document.getElementById("btnAdminOpenPlaceModal")?.addEventListener("click", () => {
  pendingAddPlaceToRouteAfterSave = false;
  document.getElementById("adminPlaceForm")?.reset();
  if (adminPlaceModal) adminPlaceModal.classList.add("open");
});

document.getElementById("btnRbAddNewPlace")?.addEventListener("click", () => {
  pendingAddPlaceToRouteAfterSave = true;
  document.getElementById("adminPlaceForm")?.reset();
  if (adminPlaceModal) adminPlaceModal.classList.add("open");
});
document.getElementById("btnCloseAdminPlaceModal")?.addEventListener("click", () => {
  if (adminPlaceModal) adminPlaceModal.classList.remove("open");
});

document.getElementById("btnPickOnMap")?.addEventListener("click", () => {
  if (adminPlaceModal) adminPlaceModal.classList.remove("open");
  switchAdminTab("tabRoutes");
  ensureLeafletMap();
  const hintEl = document.getElementById("mapPickHint");
  if (hintEl) {
    hintEl.textContent = "👆 Toca el punto exacto en el mapa donde está el negocio...";
    hintEl.style.display = "block";
  }
  document.getElementById("adminMapCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  mapPickCallback = ({ lat, lng }) => {
    const coordsInput = document.getElementById("admPlaceCoordsInput");
    if (coordsInput) coordsInput.value = `${lat}, ${lng}`;
    if (adminPlaceModal) adminPlaceModal.classList.add("open");
    showToast("📍 Coordenadas capturadas del mapa.");
  };
});

document.getElementById("adminPlaceForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const category = document.getElementById("admPlaceCategory").value || "tienda";
  const phone = document.getElementById("admPlacePhone").value.trim();
  const name = document.getElementById("admPlaceName").value.trim();
  const address = document.getElementById("admPlaceAddress").value.trim();
  const rawCoords = document.getElementById("admPlaceCoordsInput").value.trim();

  if (!name) {
    showToast("Escribe el nombre del negocio.");
    return;
  }

  const parsed = parseCoordsFromInput(rawCoords);
  if (!parsed) {
    showToast("No se detectaron coordenadas en el texto. Usa '👆 Elegir en Mapa' o pega coordenadas tipo 25.4267, -100.9954.");
    return;
  }

  const placeId = `plc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await executeAdminBatch(currentKeyHash, (batch, proofId) => {
      batch.set(doc(db, "places", placeId), {
        name,
        category,
        phone,
        address,
        lat: parsed.lat,
        lng: parsed.lng,
        active: true,
        createdBy: "Oficina",
        createdAtIso: new Date().toISOString(),
        proofId,
        updatedAt: serverTimestamp()
      });
    });
    document.getElementById("adminPlaceForm").reset();
    if (adminPlaceModal) adminPlaceModal.classList.remove("open");
    ensureLeafletMap();
    if (leafletMap) leafletMap.flyTo([parsed.lat, parsed.lng], 15, { duration: 0.6 });
    if (pendingAddPlaceToRouteAfterSave) {
      pendingAddPlaceToRouteAfterSave = false;
      const cat = PLACE_CATEGORIES[category] || PLACE_CATEGORIES.tienda;
      rbStops.push({
        id: placeId,
        kind: "place",
        name: `${cat.emoji} ${name}`,
        address,
        subtitle: `${cat.label}${address ? ` • ${address}` : ""}`,
        lat: parsed.lat,
        lng: parsed.lng,
        status: "pending",
        pinEmoji: "🥑",
        actionLabel: "➕ Vender / Cobrar",
        arrivalActionLabel: "➕ Vender Aquí"
      });
      renderRouteBuilderUI();
      recalculateAdminBuilderMetrics();
      showToast(`🏪 "${name}" guardado y sumado a la ruta.`);
    } else {
      showToast(`🏪 "${name}" guardado en el mapa.`);
    }
  } catch (err) {
    console.error(err);
    showToast("Error al guardar el negocio.");
  }
});

function populateRouteDriverFilter() {
  if (typeof populateRouteBuilderDrivers === "function") {
    populateRouteBuilderDrivers();
  }
  const sel = document.getElementById("routeDriverFilter");
  if (!sel) return;
  const prev = sel.value;
  const drivers = storeSettings.drivers || [];
  sel.innerHTML = [
    `<option value="todos">Todos los choferes</option>`,
    ...drivers.map((d) => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`)
  ].join("");
  if (prev && (prev === "todos" || drivers.some((d) => d.name === prev))) {
    sel.value = prev;
  }
}

function subscribeRouteCorteDay(dateStr) {
  if (routeWhUnsub) routeWhUnsub();
  if (routeSalesUnsub) routeSalesUnsub();
  if (routeVisitsUnsub) routeVisitsUnsub();
  if (allRoutesTodayUnsub) allRoutesTodayUnsub();

  selectedRouteDate = dateStr;
  const isTodaySelected = dateStr === getLocalDateStr();
  const routeDatePickerEl = document.getElementById("routeDatePicker");
  if (routeDatePickerEl && routeDatePickerEl.value !== dateStr) routeDatePickerEl.value = dateStr;
  const mapDatePickerEl = document.getElementById("mapDatePicker");
  if (mapDatePickerEl && mapDatePickerEl.value !== dateStr) mapDatePickerEl.value = dateStr;
  const btnRouteTodayEl = document.getElementById("btnRouteToday");
  if (btnRouteTodayEl) {
    btnRouteTodayEl.style.display = isTodaySelected ? "none" : "inline-flex";
  }
  const mapBannerEl = document.getElementById("mapHistoryBanner");
  const mapBannerTextEl = document.getElementById("mapHistoryBannerText");
  if (mapBannerEl) {
    mapBannerEl.style.display = isTodaySelected ? "none" : "flex";
  }
  if (mapBannerTextEl && !isTodaySelected) {
    mapBannerTextEl.textContent = `⚠️ Estás viendo el historial del ${dateStr} (GPS en vivo oculto).`;
  }
  allDriverRoutesTodayMap.clear();
  routeWhDoc = createEmptyWhDoc(dateStr);
  routeSalesList = [];
  routeVisitsList = [];
  renderRouteCortesAndSales();
  renderGpsMapAndChips();
  renderAdminPlacesDirectory();

  const qAllRoutesDay = query(collection(db, "driver_routes"), where("date", "==", dateStr));
  allRoutesTodayUnsub = onSnapshot(qAllRoutesDay, (snap) => {
    allDriverRoutesTodayMap.clear();
    snap.docs.forEach((d) => {
      const data = d.data();
      if (data && Array.isArray(data.stops) && data.stops.length > 0) {
        allDriverRoutesTodayMap.set(d.id, { id: d.id, ...data });
      }
    });
    renderGpsMapAndChips();
    window.dispatchEvent(new CustomEvent("salinas:routes-updated"));
  });

  routeWhUnsub = onSnapshot(doc(db, "warehouse_days", dateStr), (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      routeWhDoc = {
        date: dateStr,
        trips: Array.isArray(d.trips) ? d.trips : []
      };
    } else {
      routeWhDoc = createEmptyWhDoc(dateStr);
    }
    renderRouteCortesAndSales();
  });

  const qSales = query(collection(db, "route_sales"), where("date", "==", dateStr));
  routeSalesUnsub = onSnapshot(qSales, (snap) => {
    routeSalesList = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || "")));
    renderRouteCortesAndSales();
    renderGpsMapAndChips();
    renderAdminPlacesDirectory();
    updateKPIs();
  });

  const qVisits = query(collection(db, "place_visits"), where("date", "==", dateStr));
  routeVisitsUnsub = onSnapshot(qVisits, (snap) => {
    routeVisitsList = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || "")));
    renderGpsMapAndChips();
    renderAdminPlacesDirectory();
  });
}

document.getElementById("routeDatePicker").addEventListener("change", (e) => {
  if (e.target.value) subscribeRouteCorteDay(e.target.value);
});

document.getElementById("mapDatePicker")?.addEventListener("change", (e) => {
  if (e.target.value) subscribeRouteCorteDay(e.target.value);
});

function resetRouteDateToToday() {
  const today = getLocalDateStr();
  subscribeRouteCorteDay(today);
}

document.getElementById("btnRouteToday").addEventListener("click", resetRouteDateToToday);
document.getElementById("btnMapBannerToday")?.addEventListener("click", resetRouteDateToToday);

document.getElementById("routeDriverFilter").addEventListener("change", (e) => {
  routeDriverFilterVal = e.target.value;
  renderRouteCortesAndSales();
});

function renderRouteCortesAndSales() {
  const corteGrid = document.getElementById("routeCorteCards");
  const salesContainer = document.getElementById("routeSalesAdminList");
  const summaryBadge = document.getElementById("routeSalesSummaryBadge");
  if (!corteGrid || !salesContainer) return;

  // Build unified driver set from settings + warehouse trips + route sales
  const driverMap = new Map();
  const activeCodes = getProductCodes(storeSettings, ACTIVE_TENANT_SLUG === "salinas" ? DEFAULT_STORE_SETTINGS.calibers : {});
  const ensureDriver = (rawName) => {
    const key = String(rawName || "Chofer").trim();
    const norm = key.toLowerCase();
    if (!driverMap.has(norm)) {
      const zeroMap = {};
      for (const c of activeCodes) zeroMap[c] = 0;
      driverMap.set(norm, {
        name: key,
        vueltas: 0,
        lastRipeness: "",
        out: { ...zeroMap },
        ret: { ...zeroMap },
        sold: { ...zeroMap },
        totalOut: 0,
        totalRet: 0,
        totalSold: 0,
        notesCount: 0,
        grossMoney: 0,
        cashMoney: 0,
        transfMoney: 0,
        creditMoney: 0
      });
    }
    return driverMap.get(norm);
  };

  for (const d of storeSettings.drivers || []) {
    ensureDriver(d.name);
  }

  for (const t of routeWhDoc.trips || []) {
    const rec = ensureDriver(t.driver);
    rec.vueltas++;
    rec.lastRipeness = t.ripeness || rec.lastRipeness;
    for (const c of Object.keys(t.out || {})) {
      const o = Number(t.out?.[c]) || 0;
      rec.out[c] = (rec.out[c] || 0) + o;
      rec.totalOut += o;
      if (!activeCodes.includes(c)) activeCodes.push(c);
    }
    for (const c of Object.keys(t.ret || {})) {
      const r = Number(t.ret?.[c]) || 0;
      rec.ret[c] = (rec.ret[c] || 0) + r;
      rec.totalRet += r;
      if (!activeCodes.includes(c)) activeCodes.push(c);
    }
  }

  for (const s of routeSalesList) {
    if (isSaleCancelled(s)) continue;
    const rec = ensureDriver(s.driver);
    rec.notesCount++;
    for (const c of Object.keys(s.boxesByCaliber || {})) {
      const b = Number(s.boxesByCaliber?.[c]) || 0;
      rec.sold[c] = round1((rec.sold[c] || 0) + b);
      rec.totalSold = round1(rec.totalSold + b);
      if (!activeCodes.includes(c)) activeCodes.push(c);
    }
    rec.grossMoney += Number(s.totalAmount) || 0;
    rec.cashMoney += Number(s.cashCollected) || 0;
    rec.transfMoney += Number(s.transferCollected) || 0;
    rec.creditMoney += Number(s.creditBalance) || 0;
  }

  const allRecords = Array.from(driverMap.values()).filter((r) =>
    routeDriverFilterVal === "todos"
      ? true
      : r.name.toLowerCase() === routeDriverFilterVal.toLowerCase()
  );

  if (allRecords.length === 0) {
    corteGrid.innerHTML = `<div class="cart-empty" style="grid-column:1/-1;">Sin actividad registrada en esta fecha.</div>`;
  } else {
    corteGrid.innerHTML = allRecords
      .map((r) => {
        const pendingReturn = round1(r.totalOut - r.totalSold - r.totalRet);
        const pendingByCal = activeCodes
          .map((c) => `${c}:${formatBoxesKg((r.out[c] || 0) - (r.sold[c] || 0) - (r.ret[c] || 0))}`)
          .join(" • ");

        return `
          <div class="route-corte-card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
              <strong style="font-size:1.08rem;color:var(--green-950);">🚗 ${escapeHtml(r.name)}</strong>
              <span class="ripeness-badge">${r.vueltas} vuelta${r.vueltas === 1 ? "" : "s"} • ${r.notesCount} nota${r.notesCount === 1 ? "" : "s"}</span>
            </div>

            <div style="background:var(--green-50);border:1px solid var(--slate-200);border-radius:10px;padding:9px 11px;font-size:0.82rem;margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;"><span>Salidas Almacén:</span><strong>${formatBoxesKg(r.totalOut)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>(−) Ventas en Ruta:</span><strong>${formatBoxesKg(r.totalSold)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>(−) Ya devueltas a Almacén:</span><strong>${formatBoxesKg(r.totalRet)}</strong></div>
              <div style="display:flex;justify-content:space-between;border-top:1px dashed var(--slate-300);margin-top:5px;padding-top:5px;color:var(--green-950);font-weight:800;">
                <span>= Trae en carro / Por devolver:</span>
                <span>${formatBoxesKg(pendingReturn)}</span>
              </div>
              <div style="font-size:0.73rem;color:var(--slate-500);margin-top:2px;">Por calibre: ${pendingByCal}</div>
            </div>

            <div style="font-size:0.82rem;display:flex;flex-direction:column;gap:4px;color:var(--slate-700);">
              <div style="display:flex;justify-content:space-between;"><span>Venta total en ruta:</span><strong>${formatCurrency(r.grossMoney)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>Transferencias:</span><strong>${formatCurrency(r.transfMoney)}</strong></div>
              <div style="display:flex;justify-content:space-between;"><span>Dejado a Crédito:</span><strong style="color:var(--red-600);">${formatCurrency(r.creditMoney)}</strong></div>
            </div>

            <div class="route-corte-money-pill">
              <div>
                <div style="font-size:0.7rem;color:#b7ecc0;font-weight:800;text-transform:uppercase;">Efectivo a Recibir</div>
                <div style="font-size:0.72rem;color:#d6f5db;">Contado + anticipos</div>
              </div>
              <strong style="font-size:1.3rem;">${formatCurrency(r.cashMoney)}</strong>
            </div>
          </div>
        `;
      })
      .join("");
  }

  // Filter sales list
  const filteredSales = routeSalesList.filter((s) =>
    routeDriverFilterVal === "todos"
      ? true
      : String(s.driver || "").toLowerCase() === routeDriverFilterVal.toLowerCase()
  );

  summaryBadge.textContent = `${filteredSales.length} nota${filteredSales.length === 1 ? "" : "s"}`;

  if (filteredSales.length === 0) {
    salesContainer.innerHTML = `<div class="cart-empty">Aún no hay notas registradas en ruta para esta fecha.</div>`;
    return;
  }

  salesContainer.innerHTML = filteredSales
    .map((s) => {
      const timeStr = s.createdAtIso
        ? new Date(s.createdAtIso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
        : "";
      const cancelled = isSaleCancelled(s);
      const chipsHtml = (s.items || [])
        .map(
          (i) =>
            `<span class="cal-chip">${formatBoxesKg(i.qty)} × ${escapeHtml(i.name)} (${formatCurrency(i.unitPrice)})</span>`
        )
        .join("");

      return `
        <article class="order-admin-card" style="padding:14px 16px;${cancelled ? "opacity:0.65;background:#f8fafc;border-color:#cbd5e1;" : ""}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
            <div>
              <strong style="font-size:1rem;color:var(--green-950);${cancelled ? "text-decoration:line-through;" : ""}">${escapeHtml(s.customerName)}</strong>
              ${cancelled ? `<span style="display:inline-block;margin-left:6px;background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:999px;font-size:0.72rem;font-weight:800;">❌ CANCELADA</span>` : ""}
              <span style="font-size:0.8rem;color:var(--slate-500);margin-left:6px;">${escapeHtml(s.folio)} • 🕒 ${escapeHtml(timeStr)}</span>
              <div style="font-size:0.82rem;color:var(--slate-700);margin-top:3px;">
                🚗 Chofer: <strong>${escapeHtml(s.driver)}</strong>
                &nbsp;•&nbsp; 💳 <strong>${escapeHtml(s.paymentMethod)}</strong>
                ${s.phone ? `&nbsp;•&nbsp; 📞 <a href="tel:${escapeHtml(s.phone)}" style="text-decoration:underline;">${escapeHtml(s.phone)}</a>` : ""}
              </div>
              ${cancelled && s.cancelReason ? `<div style="margin-top:4px;color:#b91c1c;font-weight:700;font-size:0.8rem;">Motivo anulación: ${escapeHtml(s.cancelReason)}</div>` : ""}
              ${Array.isArray(s.returnsLog) && s.returnsLog.length > 0 ? `<div style="margin-top:4px;color:#b45309;font-weight:700;font-size:0.78rem;">🔄 ${s.returnsLog.map((r) => `${r.mode === "cambio" ? "Cambio" : "Devolución"} ${formatBoxesKg(r.boxes)}: ${escapeHtml(r.reason)}`).join(" • ")}</div>` : ""}
              ${!cancelled && s.creditBalance > 0 ? `<div style="margin-top:4px;color:var(--red-600);font-weight:800;font-size:0.84rem;">⚠️ Crédito pendiente: ${formatCurrency(s.creditBalance)} (Anticipo: ${formatCurrency(s.cashCollected)})</div>` : ""}
              ${s.notes ? `<div style="font-size:0.78rem;color:var(--slate-500);margin-top:3px;">📝 ${escapeHtml(s.notes)}</div>` : ""}
            </div>

            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <strong style="font-size:1.18rem;color:${cancelled ? "#94a3b8" : "var(--green-900)"};${cancelled ? "text-decoration:line-through;" : ""}">${formatCurrency(s.totalAmount)}</strong>
              <button type="button" class="btn btn-outline btn-sm" data-print-route-sale="${escapeHtml(s.id)}">🖨️ Nota</button>
              ${cancelled ? "" : `<button type="button" class="btn btn-outline btn-sm" data-return-route-sale="${escapeHtml(s.id)}" style="color:#b45309;border-color:#fcd34d;">🔄 Devolución</button>`}
              ${cancelled ? "" : `<button type="button" class="btn btn-outline btn-sm" data-cancel-route-sale="${escapeHtml(s.id)}" style="color:#dc2626;border-color:#fca5a5;">❌ Cancelar</button>`}
            </div>
          </div>
          <div class="caliber-breakdown-chips" style="margin-top:8px;">${chipsHtml}</div>
        </article>
      `;
    })
    .join("");
}

function openCancelSaleModal(sale) {
  return new Promise((resolve) => {
    const modal = document.getElementById("cancelSaleModal");
    const summaryEl = document.getElementById("cancelSaleSummary");
    const inputEl = document.getElementById("cancelSaleReasonInput");
    const okBtn = document.getElementById("btnCancelSaleConfirm");
    const abortBtn = document.getElementById("btnCancelSaleAbort");
    const closeBtn = document.getElementById("btnCloseCancelSaleModal");
    if (!modal || !okBtn || !inputEl) {
      resolve(null);
      return;
    }
    if (summaryEl) {
      summaryEl.textContent = `${sale.folio || ""} • ${sale.customerName || "Cliente"} (${formatCurrency(sale.totalAmount)} • ${sale.driver || ""})`;
    }
    inputEl.value = /prueba/i.test(sale.driver || "") ? "Prueba del sistema" : "";

    const pillHandler = (ev) => {
      const pill = ev.target.closest(".cancel-reason-pill");
      if (pill) inputEl.value = pill.dataset.cancelReason || "";
    };
    modal.addEventListener("click", pillHandler);

    const cleanup = (val) => {
      modal.classList.remove("open");
      modal.removeEventListener("click", pillHandler);
      okBtn.removeEventListener("click", onOk);
      abortBtn?.removeEventListener("click", onCancel);
      closeBtn?.removeEventListener("click", onCancel);
      resolve(val);
    };
    const onOk = () => {
      const reason = inputEl.value.trim();
      if (!reason) {
        showToast("Escribe o elige el motivo de cancelación.");
        inputEl.focus();
        return;
      }
      cleanup(reason);
    };
    const onCancel = () => cleanup(null);
    okBtn.addEventListener("click", onOk);
    abortBtn?.addEventListener("click", onCancel);
    closeBtn?.addEventListener("click", onCancel);
    modal.classList.add("open");
  });
}

function openReturnSaleModal(sale) {
  return new Promise((resolve) => {
    const modal = document.getElementById("returnSaleModal");
    const summaryEl = document.getElementById("returnSaleSummary");
    const modeEl = document.getElementById("returnSaleMode");
    const boxesEl = document.getElementById("returnSaleBoxesInput");
    const kgEl = document.getElementById("returnSaleKgInput");
    const calEl = document.getElementById("returnSaleCalSelect");
    const refundWrap = document.getElementById("returnSaleRefundWrap");
    const refundEl = document.getElementById("returnSaleRefundInput");
    const reasonEl = document.getElementById("returnSaleReasonInput");
    const okBtn = document.getElementById("btnReturnSaleConfirm");
    const cancelBtn = document.getElementById("btnReturnSaleCancel");
    const closeBtn = document.getElementById("btnCloseReturnSaleModal");
    if (!modal || !okBtn || !calEl) {
      resolve(null);
      return;
    }

    if (summaryEl) {
      summaryEl.textContent = `${sale.folio || ""} • ${sale.customerName || ""} • ${formatBoxesKg(sale.totalBoxes)} (${formatCurrency(sale.totalAmount)})`;
    }
    const items = Array.isArray(sale.items) && sale.items.length > 0
      ? sale.items
      : [{ code: "P", name: "Primera", qty: Number(sale.totalBoxes) || 1, unitPrice: 0 }];
    calEl.innerHTML = items
      .map((it) => `<option value="${escapeHtml(it.code)}">${escapeHtml(it.code)} · ${escapeHtml(it.name)} (${formatBoxesKg(it.qty)})</option>`)
      .join("");
    modeEl.value = "devolucion";
    boxesEl.value = "0";
    kgEl.value = "0";
    refundEl.value = "0";
    reasonEl.value = "";
    refundWrap.style.display = "block";

    const syncRefundEstimate = () => {
      const isCambio = modeEl.value === "cambio";
      refundWrap.style.display = isCambio ? "none" : "block";
      if (isCambio) {
        refundEl.value = "0";
        return;
      }
      const selCode = calEl.value;
      const it = items.find((i) => i.code === selCode) || items[0];
      const uPrice = Number(it?.unitPrice) || 0;
      const kPrice = Number(it?.kgPrice) || uPrice / 10;
      const b = Math.max(0, Number(boxesEl.value) || 0);
      const k = Math.max(0, Number(kgEl.value) || 0);
      refundEl.value = String(Math.min(Number(sale.totalAmount) || 0, Math.round(b * uPrice + k * kPrice)));
    };
    modeEl.addEventListener("change", syncRefundEstimate);
    calEl.addEventListener("change", syncRefundEstimate);
    boxesEl.addEventListener("input", syncRefundEstimate);
    kgEl.addEventListener("input", syncRefundEstimate);

    const cleanup = (val) => {
      modal.classList.remove("open");
      modeEl.removeEventListener("change", syncRefundEstimate);
      calEl.removeEventListener("change", syncRefundEstimate);
      boxesEl.removeEventListener("input", syncRefundEstimate);
      kgEl.removeEventListener("input", syncRefundEstimate);
      okBtn.removeEventListener("click", onOk);
      cancelBtn?.removeEventListener("click", onCancel);
      closeBtn?.removeEventListener("click", onCancel);
      resolve(val);
    };
    const onOk = () => {
      const b = Math.max(0, Math.floor(Number(boxesEl.value) || 0));
      const k = Math.max(0, Math.floor(Number(kgEl.value) || 0));
      const equivBoxes = round1(b + k / 10);
      const reason = reasonEl.value.trim();
      if (equivBoxes <= 0) {
        showToast("Indica cuántas cajas o kilos se devuelven/cambian.");
        return;
      }
      if (!reason) {
        showToast("Escribe el motivo del movimiento.");
        reasonEl.focus();
        return;
      }
      cleanup({
        mode: modeEl.value,
        code: calEl.value,
        equivBoxes,
        refundAmount: modeEl.value === "cambio" ? 0 : Math.max(0, Math.round(Number(refundEl.value) || 0)),
        reason
      });
    };
    const onCancel = () => cleanup(null);
    okBtn.addEventListener("click", onOk);
    cancelBtn?.addEventListener("click", onCancel);
    closeBtn?.addEventListener("click", onCancel);
    modal.classList.add("open");
  });
}

document.getElementById("routeSalesAdminList").addEventListener("click", async (e) => {
  const retBtn = e.target.closest("button[data-return-route-sale]");
  if (retBtn) {
    const sale = routeSalesList.find((s) => s.id === retBtn.dataset.returnRouteSale);
    if (!sale || isSaleCancelled(sale)) return;
    const res = await openReturnSaleModal(sale);
    if (!res) return;
    try {
      const nextLogs = [
        ...(Array.isArray(sale.returnsLog) ? sale.returnsLog : []),
        {
          mode: res.mode,
          code: res.code,
          boxes: res.equivBoxes,
          refundAmount: res.refundAmount,
          reason: res.reason,
          atIso: new Date().toISOString()
        }
      ];
      const updateFields = { returnsLog: nextLogs, updatedAt: serverTimestamp() };
      if (res.mode === "devolucion") {
        const curCal = Number(sale.boxesByCaliber?.[res.code]) || 0;
        const deducted = Math.min(curCal, res.equivBoxes);
        const nextBoxesByCal = { ...(sale.boxesByCaliber || {}), [res.code]: round1(curCal - deducted) };
        const nextTotalBoxes = round1(Math.max(0, (Number(sale.totalBoxes) || 0) - res.equivBoxes));
        const nextTotalAmount = Math.max(0, (Number(sale.totalAmount) || 0) - res.refundAmount);
        let remRefund = res.refundAmount;
        let nextCredit = Number(sale.creditBalance) || 0;
        let nextCash = Number(sale.cashCollected) || 0;
        let nextTransf = Number(sale.transferCollected) || 0;
        const credCut = Math.min(nextCredit, remRefund);
        nextCredit -= credCut;
        remRefund -= credCut;
        const cashCut = Math.min(nextCash, remRefund);
        nextCash -= cashCut;
        remRefund -= cashCut;
        const trCut = Math.min(nextTransf, remRefund);
        nextTransf -= trCut;
        Object.assign(updateFields, {
          boxesByCaliber: nextBoxesByCal,
          totalBoxes: nextTotalBoxes,
          totalAmount: nextTotalAmount,
          creditBalance: nextCredit,
          cashCollected: nextCash,
          transferCollected: nextTransf
        });
      }
      await executeAdminBatch(currentKeyHash, (batch, proofId) => {
        batch.update(doc(db, "route_sales", sale.id), { ...updateFields, proofId });
      });
      showToast(res.mode === "cambio" ? "🔄 Cambio físico registrado en la nota." : "📦 Devolución aplicada al corte y a la nota.");
    } catch (err) {
      console.error("Error aplicando devolución:", err);
      showToast("No se pudo registrar la devolución.");
    }
    return;
  }

  const cancelBtn = e.target.closest("button[data-cancel-route-sale]");
  if (cancelBtn) {
    const sale = routeSalesList.find((s) => s.id === cancelBtn.dataset.cancelRouteSale);
    if (!sale || isSaleCancelled(sale)) return;
    const reason = await openCancelSaleModal(sale);
    if (!reason) return;
    try {
      await executeAdminBatch(currentKeyHash, (batch, proofId) => {
        batch.update(doc(db, "route_sales", sale.id), {
          status: "cancelada",
          cancelReason: reason,
          cancelledAtIso: new Date().toISOString(),
          cancelledBy: "Admin",
          proofId,
          updatedAt: serverTimestamp()
        });
      });
      showToast(`❌ Nota ${sale.folio || ""} anulada. Pre-corte y mapa actualizados.`);
    } catch (err) {
      console.error("Error anulando nota:", err);
      showToast("No se pudo anular la nota.");
    }
    return;
  }

  const btn = e.target.closest("button[data-print-route-sale]");
  if (!btn) return;
  const sale = routeSalesList.find((s) => s.id === btn.dataset.printRouteSale);
  if (!sale) return;
  printOrderReceipt({
    folio: sale.folio,
    createdAtIso: sale.createdAtIso,
    customerName: sale.customerName,
    phone: sale.phone || "—",
    address: sale.saleType === "pedido_web" ? "Pedido en línea entregado" : "Venta directa en ruta",
    paymentMethod: sale.creditBalance > 0
      ? `Crédito (Anticipo ${formatCurrency(sale.cashCollected)} / Resta ${formatCurrency(sale.creditBalance)})`
      : sale.paymentMethod,
    ripeness: "Seleccionado en ruta",
    notes: sale.notes || "",
    assignedDriver: sale.driver,
    items: sale.items || [],
    totalAmount: sale.totalAmount
  });
});

// ================= KPI UPDATES =================
function isSameLocalDay(isoStr) {
  if (!isoStr) return false;
  const d = new Date(isoStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function updateKPIs() {
  let newCount = 0;
  let activeCount = 0;
  let deliveredToday = 0;
  let webBoxesToday = 0;
  let webRevToday = 0;

  for (const ord of allOrders) {
    if (ord.status === "nuevo") newCount++;
    if (ord.status === "confirmado" || ord.status === "en_ruta") activeCount++;

    if (isSameLocalDay(ord.createdAtIso) && ord.status !== "cancelado") {
      if (ord.status === "entregado") deliveredToday++;
      webBoxesToday += Number(ord.totalBoxes) || 0;
      webRevToday += Number(ord.totalAmount) || 0;
    }
  }

  // Add street-only sales if route date is today (avoid double-counting delivered web orders)
  let streetRevToday = 0;
  let streetBoxesToday = 0;
  if (selectedRouteDate === getLocalDateStr()) {
    for (const s of routeSalesList) {
      if (isSaleCancelled(s)) continue;
      if (s.saleType !== "pedido_web") {
        streetRevToday += Number(s.totalAmount) || 0;
        streetBoxesToday = round1(streetBoxesToday + (Number(s.totalBoxes) || 0));
      }
    }
  }

  const whTotals = computeWarehouseTotals(currentWhDoc);

  document.getElementById("kpiNewCount").textContent = String(newCount);
  document.getElementById("kpiActiveCount").textContent = String(activeCount);
  document.getElementById("kpiDeliveredSub").textContent = `${deliveredToday} entregado${deliveredToday === 1 ? "" : "s"} hoy`;
  document.getElementById("kpiWarehouseStock").textContent = String(whTotals.totalFinal);
  document.getElementById("kpiWarehouseSub").textContent = `M:${whTotals.finalStock.M} • P:${whTotals.finalStock.P} • E:${whTotals.finalStock.E} • S:${whTotals.finalStock.S}`;
  document.getElementById("kpiRevenueToday").textContent = formatCurrency(webRevToday + streetRevToday);
  document.getElementById("kpiCalibersSub").textContent =
    streetBoxesToday > 0
      ? `Web: ${webBoxesToday} • Calle: ${streetBoxesToday} cajas`
      : `Pedidos Web hoy: ${webBoxesToday} caja${webBoxesToday === 1 ? "" : "s"}`;
}

// ================= TAB 2: ORDERS =================
document.getElementById("statusFilterBar").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-status]");
  if (!btn) return;
  statusFilter = btn.dataset.status;
  document.querySelectorAll("#statusFilterBar button").forEach((b) => {
    b.className = b === btn ? "btn btn-sm btn-primary" : "btn btn-sm btn-outline";
  });
  renderOrdersList();
});

document.getElementById("dateRangeFilter").addEventListener("change", (e) => {
  dateFilter = e.target.value;
  renderOrdersList();
});

document.getElementById("searchOrdersInput").addEventListener("input", (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderOrdersList();
});

const STATUS_LABELS = {
  nuevo: "Nuevo",
  confirmado: "Confirmado",
  en_ruta: "En Ruta",
  entregado: "Entregado",
  cancelado: "Cancelado"
};

function buildClientWhatsAppUrl(ord) {
  const phone = cleanPhoneForWhatsApp(ord.phone);
  const itemsTxt = (ord.items || []).map((i) => `${i.qty} ${i.name}`).join(", ");
  let msg = "";

  if (ord.status === "en_ruta") {
    const driverPart = ord.assignedDriver ? ` con nuestro repartidor *${ord.assignedDriver}*` : "";
    msg =
      `Hola *${ord.customerName}*, te saludamos de *Comercializadora Salinas* 🥑.\n` +
      `Tu pedido *${ord.folio}* (${itemsTxt} • Total: ${formatCurrency(ord.totalAmount)}) *ya va en camino*${driverPart} hacia *${ord.address}*.`;
  } else if (ord.status === "entregado") {
    msg =
      `Hola *${ord.customerName}*, gracias por tu compra en *Comercializadora Salinas* 🥑 (Pedido *${ord.folio}*). ¡Gracias por tu lealtad!`;
  } else {
    msg =
      `Hola *${ord.customerName}*, confirmamos de recibido tu pedido *${ord.folio}* en *Comercializadora Salinas* 🥑:\n` +
      `• Cajas: ${itemsTxt} (${ord.totalBoxes} cajas)\n` +
      `• Madurez: ${ord.ripeness || "Surtido"}\n` +
      `• Total: ${formatCurrency(ord.totalAmount)} (${ord.paymentMethod || "Efectivo"})\n` +
      `• Entrega en: ${ord.address}`;
  }
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

function buildDriverWhatsAppUrl(ord) {
  const driverObj = (storeSettings.drivers || []).find((d) => d.name === ord.assignedDriver);
  const driverPhone = driverObj && driverObj.phone ? cleanPhoneForWhatsApp(driverObj.phone) : "";
  const itemsLines = (ord.items || []).map((i) => `  - ${i.qty} caja(s) ${i.name} [${i.code}]`).join("\n");
  const coords = resolveOrderCoords(ord);
  const mapLine = coords ? `*Mapa GPS:* https://maps.google.com/?q=${coords.lat},${coords.lng}\n` : "";

  const msg =
    `📦 *ORDEN DE ENTREGA — SALINAS*\n` +
    `*Folio:* ${ord.folio}\n` +
    `*Cliente:* ${ord.customerName}\n` +
    `*Tel. Cliente:* ${ord.phone}\n` +
    `*Dirección:* ${ord.address}\n` +
    mapLine +
    `*Horario:* ${ord.deliveryWindow || "Lo antes posible"}\n` +
    `*Madurez:* ${ord.ripeness || "Surtido"}\n` +
    (ord.notes ? `*Notas:* ${ord.notes}\n` : "") +
    `*Cajas (${ord.totalBoxes} total):*\n${itemsLines}\n` +
    `*Cobrar:* ${formatCurrency(ord.totalAmount)} (${ord.paymentMethod || "Efectivo"})`;

  return driverPhone
    ? `https://wa.me/${driverPhone}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

function renderOrdersList() {
  const container = document.getElementById("ordersAdminContainer");

  const filtered = allOrders.filter((ord) => {
    if (statusFilter !== "todos" && ord.status !== statusFilter) return false;
    if (dateFilter === "today" && !isSameLocalDay(ord.createdAtIso)) return false;
    if (searchQuery) {
      const hay = `${ord.folio || ""} ${ord.customerName || ""} ${ord.phone || ""} ${ord.address || ""} ${ord.assignedDriver || ""}`;
      if (!matchesSmartSearch(hay, searchQuery)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="cart-empty">No hay pedidos que coincidan con el filtro seleccionado.</div>`;
    return;
  }

  const drivers = storeSettings.drivers || [];

  container.innerHTML = filtered
    .map((ord) => {
      const dateStr = ord.createdAtIso
        ? new Date(ord.createdAtIso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })
        : "";
      const stLabel = STATUS_LABELS[ord.status] || "Nuevo";
      const coords = resolveOrderCoords(ord);
      const mapBtnHtml = coords
        ? `<button type="button" class="btn btn-outline btn-sm" data-action="focus-order-map" data-id="${ord.id}" style="border-color:#dc2626;color:#991b1b;">📍 Ver en Mapa</button>`
        : `<button type="button" class="btn btn-outline btn-sm" data-action="pin-order" data-id="${ord.id}">📍 Ubicar en Mapa</button>`;

      const chipsHtml = (ord.items || [])
        .map(
          (i) =>
            `<span class="cal-chip">${i.qty} × ${escapeHtml(i.name)} (${escapeHtml(i.code)}) — ${formatCurrency(i.subtotal)}</span>`
        )
        .join("");

      const driverOptions = [
        `<option value="">— Sin asignar —</option>`,
        ...drivers.map(
          (d) =>
            `<option value="${escapeHtml(d.name)}" ${ord.assignedDriver === d.name ? "selected" : ""}>${escapeHtml(d.name)}</option>`
        )
      ].join("");

      const statusOptions = Object.entries(STATUS_LABELS)
        .map(([val, lbl]) => `<option value="${val}" ${ord.status === val ? "selected" : ""}>${lbl}</option>`)
        .join("");

      return `
        <article class="order-admin-card ${ord.status === "nuevo" ? "is-new" : ""}" data-id="${ord.id}">
          <div class="order-admin-header">
            <div>
              <span style="font-weight:800;font-size:1.08rem;color:var(--green-950);">${escapeHtml(ord.folio || ord.id.slice(0, 6))}</span>
              <span style="font-size:0.82rem;color:var(--slate-500);margin-left:8px;">🕒 ${escapeHtml(dateStr)}</span>
              <span class="status-pill status-${escapeHtml(ord.status)}" style="margin-left:8px;">${escapeHtml(stLabel)}</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <strong style="font-size:1.25rem;color:var(--green-900);">${formatCurrency(ord.totalAmount)}</strong>
              ${mapBtnHtml}
              <button type="button" class="btn btn-outline btn-sm" data-action="edit-total" data-id="${ord.id}">Ajustar $</button>
              <button type="button" class="btn btn-outline btn-sm" data-action="print-order" data-id="${ord.id}">🖨️ Imprimir Nota</button>
            </div>
          </div>

          <div class="order-admin-grid">
            <div>
              <div style="font-weight:800;font-size:1.02rem;color:var(--slate-900);">${escapeHtml(ord.customerName)}</div>
              <div style="font-size:0.86rem;color:var(--slate-700);margin-top:3px;">📍 ${escapeHtml(ord.address)}</div>
              <div style="font-size:0.85rem;color:var(--slate-700);margin-top:3px;">
                📞 <a href="tel:${escapeHtml(ord.phone)}" style="text-decoration:underline;font-weight:700;">${escapeHtml(ord.phone)}</a>
                &nbsp;•&nbsp; 💳 <strong>${escapeHtml(ord.paymentMethod || "Efectivo")}</strong>
              </div>
              <div style="font-size:0.82rem;color:var(--slate-500);margin-top:4px;">
                🥑 Madurez: <strong>${escapeHtml(ord.ripeness || "Surtido")}</strong>
                &nbsp;|&nbsp; Horario: <strong>${escapeHtml(ord.deliveryWindow || "Lo antes posible")}</strong>
              </div>
              ${ord.notes ? `<div style="margin-top:6px;background:var(--gold-100);color:#6e470b;padding:6px 10px;border-radius:8px;font-size:0.8rem;">📝 ${escapeHtml(ord.notes)}</div>` : ""}
            </div>

            <div>
              <div style="font-size:0.8rem;font-weight:800;color:var(--slate-500);text-transform:uppercase;">
                Desglose (${ord.totalBoxes} caja${ord.totalBoxes === 1 ? "" : "s"})
              </div>
              <div class="caliber-breakdown-chips">${chipsHtml}</div>
            </div>

            <div style="display:flex;flex-direction:column;gap:8px;">
              <div class="form-row-2">
                <div>
                  <label class="form-label">Estatus</label>
                  <select class="form-control order-status-select" data-id="${ord.id}" style="padding:7px 10px;font-size:0.84rem;font-weight:700;">
                    ${statusOptions}
                  </select>
                </div>
                <div>
                  <label class="form-label">Chofer / Vendedor</label>
                  <select class="form-control order-driver-select" data-id="${ord.id}" style="padding:7px 10px;font-size:0.84rem;font-weight:700;">
                    ${driverOptions}
                  </select>
                </div>
              </div>

              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:2px;">
                <a href="${buildClientWhatsAppUrl(ord)}" target="_blank" rel="noopener" class="btn btn-whatsapp btn-sm" style="flex:1;">
                  WhatsApp Cliente
                </a>
                <a href="${buildDriverWhatsAppUrl(ord)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="flex:1;">
                  Enviar a Chofer
                </a>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

document.getElementById("ordersAdminContainer").addEventListener("change", async (e) => {
  const statusSel = e.target.closest(".order-status-select");
  if (statusSel) {
    const orderId = statusSel.dataset.id;
    const newStatus = statusSel.value;
    try {
      await executeAdminBatch(currentKeyHash, (batch, proofId) => {
        batch.update(doc(db, "orders", orderId), { status: newStatus, proofId, updatedAt: serverTimestamp() });
      });
      showToast(`Estatus actualizado a ${STATUS_LABELS[newStatus]}.`);
    } catch (err) {
      console.error(err);
      showToast("No se pudo actualizar el estatus.");
    }
    return;
  }

  const driverSel = e.target.closest(".order-driver-select");
  if (driverSel) {
    const orderId = driverSel.dataset.id;
    const driverName = driverSel.value;
    const ord = allOrders.find((o) => o.id === orderId);
    const nextStatus = ord && ord.status === "nuevo" && driverName ? "confirmado" : (ord ? ord.status : "nuevo");

    try {
      await executeAdminBatch(currentKeyHash, (batch, proofId) => {
        batch.update(doc(db, "orders", orderId), {
          assignedDriver: driverName,
          status: nextStatus,
          proofId,
          updatedAt: serverTimestamp()
        });
      });
      showToast(driverName ? `Pedido asignado a ${driverName}.` : "Chofer desasignado.");
    } catch (err) {
      console.error(err);
      showToast("Error al asignar chofer.");
    }
  }
});

document.getElementById("ordersAdminContainer").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("button[data-action='edit-total']");
  if (editBtn) {
    const orderId = editBtn.dataset.id;
    const ord = allOrders.find((o) => o.id === orderId);
    if (!ord) return;
    const input = prompt(`Ajustar importe total (MXN) para ${ord.customerName}:`, String(ord.totalAmount));
    if (input === null) return;
    const newTotal = Math.max(0, Math.round(Number(input)));
    if (Number.isNaN(newTotal)) {
      showToast("Ingresa un número válido.");
      return;
    }
    try {
      await executeAdminBatch(currentKeyHash, (batch, proofId) => {
        batch.update(doc(db, "orders", orderId), { totalAmount: newTotal, proofId, updatedAt: serverTimestamp() });
      });
      showToast(`Total ajustado a ${formatCurrency(newTotal)}.`);
    } catch (err) {
      console.error(err);
      showToast("Error al ajustar el total.");
    }
    return;
  }

  const focusMapBtn = e.target.closest("button[data-action='focus-order-map']");
  if (focusMapBtn) {
    const orderId = focusMapBtn.dataset.id;
    const ord = allOrders.find((o) => o.id === orderId);
    if (!ord) return;
    const coords = resolveOrderCoords(ord);
    if (!coords) return;
    switchAdminTab("tabRoutes");
    setTimeout(() => {
      ensureLeafletMap();
      document.getElementById("adminMapCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (leafletMap) {
        leafletMap.flyTo([coords.lat, coords.lng], 16, { duration: 0.7 });
        const m = mapFocusMarkers.get(`order:${orderId}`);
        if (m) m.openPopup();
      }
    }, 180);
    return;
  }

  const pinOrderBtn = e.target.closest("button[data-action='pin-order']");
  if (pinOrderBtn) {
    const orderId = pinOrderBtn.dataset.id;
    const ord = allOrders.find((o) => o.id === orderId);
    if (!ord) return;
    switchAdminTab("tabRoutes");
    ensureLeafletMap();
    const hintEl = document.getElementById("mapPickHint");
    if (hintEl) {
      hintEl.textContent = `👆 Toca en el mapa dónde se ubica el pedido de "${ord.customerName}" (${ord.address || ""})...`;
      hintEl.style.display = "block";
    }
    document.getElementById("adminMapCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    mapPickCallback = async ({ lat, lng }) => {
      try {
        const placeId = `plc_ord_${orderId.slice(0, 8)}`;
        await executeAdminBatch(currentKeyHash, (batch, proofId) => {
          batch.update(doc(db, "orders", orderId), {
            lat,
            lng,
            proofId,
            updatedAt: serverTimestamp()
          });
          batch.set(
            doc(db, "places", placeId),
            {
              name: ord.customerName || "Cliente Web",
              category: "tienda",
              phone: ord.phone || "",
              address: ord.address || "",
              lat,
              lng,
              active: true,
              createdBy: "Pedido Web",
              createdAtIso: new Date().toISOString(),
              proofId,
              updatedAt: serverTimestamp()
            },
            { merge: true }
          );
        });
        showToast(`📍 Ubicación del pedido registrada en el mapa para ${ord.customerName}.`);
      } catch (err) {
        console.error(err);
        showToast("No se pudo guardar la ubicación del pedido.");
      }
    };
    return;
  }

  const printBtn = e.target.closest("button[data-action='print-order']");
  if (printBtn) {
    const orderId = printBtn.dataset.id;
    const ord = allOrders.find((o) => o.id === orderId);
    if (ord) printOrderReceipt(ord);
  }
});

function printOrderReceipt(ord) {
  const area = document.getElementById("printReceiptArea");
  const dateStr = ord.createdAtIso
    ? new Date(ord.createdAtIso).toLocaleDateString("es-MX")
    : new Date().toLocaleDateString("es-MX");

  const rowsHtml = (ord.items || [])
    .map(
      (i) => `
      <tr>
        <td style="border:1px solid #264428;padding:6px;text-align:center;font-weight:700;">${i.qty}</td>
        <td style="border:1px solid #264428;padding:6px;">${escapeHtml(i.name)} (${escapeHtml(i.code)})</td>
        <td style="border:1px solid #264428;padding:6px;text-align:right;">${formatCurrency(i.unitPrice)}</td>
        <td style="border:1px solid #264428;padding:6px;text-align:right;font-weight:700;">${formatCurrency(i.subtotal)}</td>
      </tr>
    `
    )
    .join("");

  area.innerHTML = `
    <div style="max-width:140mm;margin:0 auto;border:1.5px solid #264428;padding:6mm;">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid #264428;padding-bottom:4mm;margin-bottom:4mm;">
        <img src="assets/logo-salinas.png" style="height:18mm;object-fit:contain;" alt="Salinas">
        <div style="text-align:right;">
          <div style="color:#c62828;font-weight:900;font-size:13pt;">${escapeHtml(ord.folio)}</div>
          <div style="font-size:8.5pt;font-weight:700;margin-top:2px;">FECHA: ${escapeHtml(dateStr)}</div>
          <div style="font-size:8pt;color:#333;">Tel: ${escapeHtml(storeSettings.phoneDisplayPrimary)}</div>
        </div>
      </div>

      <div style="font-size:9.5pt;line-height:1.55;margin-bottom:4mm;">
        <div><strong>NOMBRE:</strong> ${escapeHtml(ord.customerName)}</div>
        <div><strong>TEL / CEL:</strong> ${escapeHtml(ord.phone)}</div>
        <div><strong>DIRECCIÓN:</strong> ${escapeHtml(ord.address)}</div>
        <div><strong>OBSERVACIONES:</strong> ${escapeHtml(ord.paymentMethod || "Efectivo")} • Madurez: ${escapeHtml(ord.ripeness || "Surtido")} ${ord.notes ? " • " + escapeHtml(ord.notes) : ""}</div>
        <div><strong>VENDEDOR / CHOFER:</strong> ${escapeHtml(ord.assignedDriver || "________________")}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:9.5pt;margin-bottom:4mm;">
        <thead>
          <tr style="background:#264428;color:#fff;">
            <th style="padding:6px;width:16%;">CANT.</th>
            <th style="padding:6px;text-align:left;">DESCRIPCIÓN</th>
            <th style="padding:6px;text-align:right;width:22%;">P/UNITARIO</th>
            <th style="padding:6px;text-align:right;width:22%;">IMPORTE</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:3mm;border-top:1.5px solid #264428;">
        <div style="font-size:8.5pt;font-style:italic;max-width:75mm;color:#264428;">
          “La lealtad es escasa en estos tiempos y nosotros la valoramos. Gracias por tu lealtad.”
        </div>
        <div style="text-align:right;font-size:12pt;font-weight:900;color:#132615;">
          TOTAL: ${formatCurrency(ord.totalAmount)}
        </div>
      </div>
    </div>
  `;

  document.body.classList.add("printing-receipt");
  window.print();
  setTimeout(() => document.body.classList.remove("printing-receipt"), 500);
}

// ================= TAB 3: CATALOG & BROADCAST GENERATOR =================
function buildMorningBroadcastText() {
  const brand = getTenantBranding(storeSettings, ACTIVE_TENANT_SLUG);
  const units = getUnitConfig(storeSettings);
  const cals = getOrderedProducts(storeSettings, ACTIVE_TENANT_SLUG === "salinas" ? DEFAULT_STORE_SETTINGS.calibers : {})
    .filter((c) => c.available !== false);

  const lines = cals.map((c) => `${brand.pinEmoji} *${c.name}:* ${formatCurrency(c.price)} / ${units.unitSingular}`).join("\n");
  const siteUrl = ACTIVE_TENANT_SLUG === "salinas"
    ? window.location.origin
    : `${window.location.origin}/?t=${encodeURIComponent(ACTIVE_TENANT_SLUG)}`;

  return (
    `¡Buenos días! ☀️ En *${brand.brandName}* ya tenemos lista nuestra disponibilidad del día para tu negocio.\n\n` +
    `*Precios por ${units.unitSingular} de hoy:*\n${lines}\n\n` +
    `👉 *Haz tu pedido rápido en línea aquí:*\n${siteUrl}\n\n` +
    `¡Gracias por tu preferencia!`
  );
}

function updateBroadcastPreview() {
  const el = document.getElementById("broadcastPreviewBox");
  if (el) el.textContent = buildMorningBroadcastText();
}

document.getElementById("btnCopyBroadcastMsg").addEventListener("click", async () => {
  const txt = buildMorningBroadcastText();
  try {
    await navigator.clipboard.writeText(txt);
    showToast("¡Mensaje copiado! Ya puedes pegarlo en tus Listas de Difusión de WhatsApp.");
  } catch (_) {
    showToast("Selecciona el texto del recuadro y cópialo.");
  }
});

function populateCatalogForm() {
  document.getElementById("cfgStoreOpen").value = String(storeSettings.storeOpen !== false);
  document.getElementById("cfgSchedule").value = storeSettings.scheduleText || "";
  document.getElementById("cfgBanner").value = storeSettings.bannerMessage || "";
  document.getElementById("cfgPhone1").value = storeSettings.phoneDisplayPrimary || "";
  document.getElementById("cfgPhone2").value = storeSettings.phoneDisplaySecondary || "";

  const units = getUnitConfig(storeSettings);
  const uSingEl = document.getElementById("cfgUnitSingular");
  const uPlurEl = document.getElementById("cfgUnitPlural");
  const uSubEl = document.getElementById("cfgSubUnit");
  const uFacEl = document.getElementById("cfgSubUnitsPerUnit");
  const uAllowEl = document.getElementById("cfgAllowSubUnit");
  if (uSingEl) uSingEl.value = units.unitSingular;
  if (uPlurEl) uPlurEl.value = units.unitPlural;
  if (uSubEl) uSubEl.value = units.subUnit;
  if (uFacEl) uFacEl.value = String(units.subUnitsPerUnit);
  if (uAllowEl) uAllowEl.value = String(units.allowSubUnit !== false);

  const baseLoc = storeSettings.baseLocation || DEFAULT_STORE_SETTINGS.baseLocation;
  const baseNameEl = document.getElementById("cfgBaseName");
  const baseAddrEl = document.getElementById("cfgBaseAddress");
  const baseCoordsEl = document.getElementById("cfgBaseCoords");
  if (baseNameEl) baseNameEl.value = baseLoc?.name || "Base / Bodega";
  if (baseAddrEl) baseAddrEl.value = baseLoc?.address || "";
  if (baseCoordsEl && Number.isFinite(Number(baseLoc?.lat)) && Number.isFinite(Number(baseLoc?.lng))) {
    baseCoordsEl.value = `${Number(baseLoc.lat).toFixed(6)}, ${Number(baseLoc.lng).toFixed(6)}`;
  }

  const calibers = getOrderedProducts(storeSettings, ACTIVE_TENANT_SLUG === "salinas" ? DEFAULT_STORE_SETTINGS.calibers : {});

  document.getElementById("adminCalibersEditor").innerHTML = calibers
    .map(
      (cal) => `
      <div class="order-admin-card" style="margin-bottom:0;" data-prod-card="${escapeHtml(cal.code)}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:180px;">
            <div class="caliber-letter">${escapeHtml(cal.code)}</div>
            <div style="flex:1;">
              <input type="text" class="form-control cal-name-input" data-code="${escapeHtml(cal.code)}" value="${escapeHtml(cal.name)}" style="font-weight:800;font-size:0.98rem;padding:5px 8px;margin-bottom:4px;">
              <input type="text" class="form-control cal-sub-input" data-code="${escapeHtml(cal.code)}" value="${escapeHtml(cal.subtitle || "")}" placeholder="Subtítulo breve" style="font-size:0.76rem;padding:4px 8px;">
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <select class="form-control cal-avail-input" data-code="${escapeHtml(cal.code)}" style="width:auto;font-weight:700;padding:6px 10px;">
              <option value="true" ${cal.available !== false ? "selected" : ""}>🟢 Disponible</option>
              <option value="false" ${cal.available === false ? "selected" : ""}>🔴 Agotado hoy</option>
            </select>
            ${calibers.length > 1 ? `<button type="button" class="btn btn-outline btn-sm" data-archive-prod="${escapeHtml(cal.code)}" title="Archivar producto" style="color:#dc2626;border-color:#fecaca;padding:6px 8px;">🗑️</button>` : ""}
          </div>
        </div>

        <div class="form-row-2" style="gap:10px;margin-bottom:10px;">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Precio por ${escapeHtml(units.unitSingular)} ($)</label>
            <input type="number" min="1" max="99999" class="form-control cal-price-input" data-code="${escapeHtml(cal.code)}" value="${Number(cal.price) || 0}" style="font-weight:800;font-size:1.05rem;">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" title="Precio cuando el chofer vende unidades sueltas">Precio por ${escapeHtml(units.subUnit)} ($/${escapeHtml(units.subUnit)})</label>
            <input type="number" min="0.5" max="9999" step="0.5" class="form-control cal-pkg-input" data-code="${escapeHtml(cal.code)}" value="${Number(cal.pricePerKg) || Math.round(((Number(cal.price) || 0) / units.subUnitsPerUnit) * 100) / 100}" style="font-weight:800;font-size:1.05rem;">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" title="El chofer no podrá vender por debajo de este precio">Mínimo Ruta ($)</label>
            <input type="number" min="1" max="99999" class="form-control cal-minprice-input" data-code="${escapeHtml(cal.code)}" value="${Number(cal.minPrice) || 1}" style="font-weight:800;">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Etiqueta</label>
            <input type="text" class="form-control cal-badge-input" data-code="${escapeHtml(cal.code)}" value="${escapeHtml(cal.badge || "")}" maxlength="28">
          </div>
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Descripción comercial</label>
          <textarea class="form-control cal-desc-input" data-code="${escapeHtml(cal.code)}" maxlength="200">${escapeHtml(cal.description || "")}</textarea>
        </div>
      </div>
    `
    )
    .join("");
}

document.getElementById("btnAddCatalogProduct")?.addEventListener("click", () => {
  const rawCode = prompt("Código corto del nuevo producto o calibre (ej. COM, L3, AZ25):");
  if (!rawCode) return;
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 8);
  if (!code) return showToast("Código inválido.");
  if (storeSettings.calibers?.[code] && !storeSettings.calibers[code].archived) {
    return showToast(`Ya existe el producto con código "${code}".`);
  }
  const name = prompt("Nombre comercial del producto:", code) || code;
  const order = Object.keys(storeSettings.calibers || {}).length + 1;
  storeSettings.calibers = {
    ...(storeSettings.calibers || {}),
    [code]: {
      code,
      name: name.trim(),
      subtitle: "",
      description: "",
      badge: "Disponible",
      price: 100,
      pricePerKg: 10,
      minPrice: 80,
      available: true,
      archived: false,
      order
    }
  };
  populateCatalogForm();
  showToast(`Producto "${code}" agregado al formulario. Toca "Guardar" abajo para publicarlo.`);
});

document.getElementById("adminCalibersEditor")?.addEventListener("click", async (e) => {
  const archBtn = e.target.closest("button[data-archive-prod]");
  if (!archBtn) return;
  const code = archBtn.dataset.archiveProd;
  const ok = await showConfirmDialog({
    title: `¿Archivar producto "${code}"?`,
    message: "Dejará de mostrarse en el catálogo y ventas nuevas (sin afectar notas históricas). Recuerda pulsar Guardar después.",
    confirmText: "Sí, archivar"
  });
  if (!ok) return;
  if (storeSettings.calibers?.[code]) {
    storeSettings.calibers[code].archived = true;
    storeSettings.calibers[code].available = false;
    populateCatalogForm();
  }
});

document.getElementById("catalogForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("btnSaveCatalog");
  btn.disabled = true;
  btn.textContent = "Guardando cambios...";

  try {
    const updatedCalibers = structuredClone(storeSettings.calibers || DEFAULT_STORE_SETTINGS.calibers);

    document.querySelectorAll(".cal-name-input").forEach((inp) => {
      const code = inp.dataset.code;
      if (updatedCalibers[code]) updatedCalibers[code].name = inp.value.trim() || code;
    });
    document.querySelectorAll(".cal-sub-input").forEach((inp) => {
      const code = inp.dataset.code;
      if (updatedCalibers[code]) updatedCalibers[code].subtitle = inp.value.trim();
    });
    document.querySelectorAll(".cal-price-input").forEach((inp) => {
      const code = inp.dataset.code;
      if (updatedCalibers[code]) updatedCalibers[code].price = Math.max(1, Math.round(Number(inp.value) || 0));
    });
    document.querySelectorAll(".cal-pkg-input").forEach((inp) => {
      const code = inp.dataset.code;
      if (updatedCalibers[code]) updatedCalibers[code].pricePerKg = Math.max(0.5, Math.round((Number(inp.value) || 0) * 100) / 100);
    });
    document.querySelectorAll(".cal-minprice-input").forEach((inp) => {
      const code = inp.dataset.code;
      if (updatedCalibers[code]) updatedCalibers[code].minPrice = Math.max(1, Math.round(Number(inp.value) || 0));
    });
    document.querySelectorAll(".cal-avail-input").forEach((sel) => {
      const code = sel.dataset.code;
      if (updatedCalibers[code]) updatedCalibers[code].available = sel.value === "true";
    });
    document.querySelectorAll(".cal-badge-input").forEach((inp) => {
      const code = inp.dataset.code;
      if (updatedCalibers[code]) updatedCalibers[code].badge = inp.value.trim();
    });
    document.querySelectorAll(".cal-desc-input").forEach((inp) => {
      const code = inp.dataset.code;
      if (updatedCalibers[code]) updatedCalibers[code].description = inp.value.trim();
    });

    const phone1Display = document.getElementById("cfgPhone1").value.trim() || DEFAULT_STORE_SETTINGS.phoneDisplayPrimary;
    const phone2Display = document.getElementById("cfgPhone2").value.trim() || DEFAULT_STORE_SETTINGS.phoneDisplaySecondary;

    const rawBaseCoords = document.getElementById("cfgBaseCoords")?.value.trim() || "";
    const parsedBaseCoords = parseCoordsFromInput(rawBaseCoords);
    if (rawBaseCoords && !parsedBaseCoords) {
      showToast("Formato inválido en Coordenadas de la Base. Usa: lat, lng (ej. 25.407054, -100.954645).");
      return;
    }
    const prevBase = storeSettings.baseLocation || DEFAULT_STORE_SETTINGS.baseLocation;
    const baseLocation = {
      name: document.getElementById("cfgBaseName")?.value.trim() || prevBase.name || "Base / Bodega Salinas",
      address: document.getElementById("cfgBaseAddress")?.value.trim() || prevBase.address || "",
      lat: parsedBaseCoords ? parsedBaseCoords.lat : prevBase.lat,
      lng: parsedBaseCoords ? parsedBaseCoords.lng : prevBase.lng
    };

    const unitConfig = {
      unitSingular: document.getElementById("cfgUnitSingular")?.value.trim() || "caja",
      unitPlural: document.getElementById("cfgUnitPlural")?.value.trim() || "cajas",
      subUnit: document.getElementById("cfgSubUnit")?.value.trim() || "kg",
      subUnitsPerUnit: Math.max(1, Math.round(Number(document.getElementById("cfgSubUnitsPerUnit")?.value) || 10)),
      allowSubUnit: document.getElementById("cfgAllowSubUnit")?.value !== "false"
    };

    const newSettings = {
      ...storeSettings,
      tenantSlug: ACTIVE_TENANT_SLUG,
      storeOpen: document.getElementById("cfgStoreOpen").value === "true",
      scheduleText: document.getElementById("cfgSchedule").value.trim(),
      bannerMessage: document.getElementById("cfgBanner").value.trim(),
      phoneDisplayPrimary: phone1Display,
      phoneDisplaySecondary: phone2Display,
      whatsappPrimary: cleanPhoneForWhatsApp(phone1Display),
      whatsappSecondary: cleanPhoneForWhatsApp(phone2Display),
      unitConfig,
      baseLocation,
      drivers: storeSettings.drivers || DEFAULT_STORE_SETTINGS.drivers,
      warehouseStaff: Array.isArray(storeSettings.warehouseStaff) ? storeSettings.warehouseStaff : [],
      calibers: updatedCalibers
    };

    await executeAdminBatch(currentKeyHash, (batch, proofId) => {
      batch.set(
        doc(db, "settings", "store"),
        { ...newSettings, proofId, updatedAt: serverTimestamp() },
        { merge: true }
      );
      batch.set(
        doc(db, "settings", "public_storefront"),
        { ...buildSanitizedPublicStorefront(newSettings), proofId },
        { merge: true }
      );
    });

    showToast("¡Precios de lista y mínimos de ruta actualizados!");
  } catch (err) {
    console.error(err);
    showToast("Error al guardar catálogo.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar y Actualizar Precios en Vivo";
  }
});

// ================= TAB 4: EDITABLE DRIVERS, PIN & SECURITY =================
const sessionDriverPins = new Map();

function buildDriverInviteText(drv, typedPin = "") {
  const brand = getTenantBranding(storeSettings, ACTIVE_TENANT_SLUG);
  const tQuery = ACTIVE_TENANT_SLUG === "salinas" ? "" : `t=${encodeURIComponent(ACTIVE_TENANT_SLUG)}&`;
  const appUrl = `${window.location.origin}/chofer.html?${tQuery}chofer=${encodeURIComponent(drv.name)}`;
  const effectivePin = typedPin || sessionDriverPins.get(drv.name) || "";
  const pinLine = effectivePin
    ? `*Tu PIN de acceso:* ${effectivePin}\n`
    : `*Ingresa con tu PIN de 4 digitos asignado en oficina.*\n`;

  return (
    `Hola *${drv.name}*, aqui tienes el enlace de tu *App de Ruta - ${brand.brandName}*:\n` +
    `*Codigo de Empresa:* ${ACTIVE_TENANT_SLUG}\n\n` +
    `${appUrl}\n\n` +
    pinLine +
    `Ahi veras tus cajas cargadas, pedidos asignados, registro de ventas y tu corte automatico.`
  );
}

function buildDriverInviteWhatsAppUrl(drv, typedPin = "") {
  const cleanPhone = cleanPhoneForWhatsApp(drv.phone || "");
  const msg = buildDriverInviteText(drv, typedPin);
  return cleanPhone
    ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msg)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
}

function getDriverCardPayload(idx) {
  const stored = (storeSettings.drivers || [])[idx];
  if (!stored) return null;
  const nameInp = document.querySelector(`.drv-edit-name[data-idx='${idx}']`);
  const phoneInp = document.querySelector(`.drv-edit-phone[data-idx='${idx}']`);
  const pinInp = document.querySelector(`.drv-edit-pin[data-idx='${idx}']`);
  return {
    drv: {
      ...stored,
      name: (nameInp?.value || stored.name || "").trim(),
      phone: (phoneInp?.value ?? stored.phone ?? "").trim()
    },
    typedPin: pinInp ? pinInp.value.trim() : ""
  };
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

function syncGpsPingConfigForm() {
  const en = document.getElementById("gpsPingEnabled");
  const iv = document.getElementById("gpsPingIntervalMin");
  const sh = document.getElementById("gpsPingStartHour");
  const eh = document.getElementById("gpsPingEndHour");
  const ao = document.getElementById("gpsAutoOffHour");
  if (!en || !iv || !sh || !eh) return;
  en.checked = Boolean(storeSettings.gpsPingEnabled);
  iv.value = String(storeSettings.gpsPingIntervalMin || 15);
  sh.value = String(storeSettings.gpsPingStartHour ?? 8);
  eh.value = String(storeSettings.gpsPingEndHour ?? 19);
  if (ao) ao.value = String(storeSettings.gpsAutoOffHour ?? 20);
}

function isDriverAdminAllowed(drv) {
  if (typeof drv?.canAccessAdmin === "boolean") return drv.canAccessAdmin;
  const norm = String(drv?.name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return norm === "tello garcia" || norm === "alejandro salinas";
}

function renderDriversEditor() {
  syncGpsPingConfigForm();
  const listEl = document.getElementById("driversListEditor");
  const drivers = storeSettings.drivers || [];

  if (drivers.length === 0) {
    listEl.innerHTML = `<div class="cart-empty">No hay choferes registrados.</div>`;
    return;
  }

  listEl.innerHTML = drivers
    .map(
      (drv, idx) => `
      <div class="driver-card-editor">
        <div class="driver-card-inputs">
          <div>
            <label class="form-label">Nombre</label>
            <input type="text" class="form-control drv-edit-name" data-idx="${idx}" value="${escapeHtml(drv.name)}" placeholder="Nombre" style="font-weight:700;">
          </div>
          <div>
            <label class="form-label">WhatsApp (10 dígitos)</label>
            <input type="tel" class="form-control drv-edit-phone" data-idx="${idx}" value="${escapeHtml(drv.phone || "")}" placeholder="Ej. 8441234567">
          </div>
          <div>
            <label class="form-label">${drv.hasPin ? "PIN Activo (Cambiar)" : "Asignar PIN *"}</label>
            <input type="text" inputmode="numeric" maxlength="8" class="form-control drv-edit-pin" data-idx="${idx}" placeholder="${drv.hasPin ? "••••" : "Ej. 1111"}">
          </div>
        </div>
        <div class="driver-card-actions">
          <label class="form-label" style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;margin:0;padding:5px 9px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;font-size:0.78rem;" title="Permite cambiar entre App Chofer y Panel Admin">
            <input type="checkbox" class="drv-edit-admin" data-idx="${idx}" ${isDriverAdminAllowed(drv) ? "checked" : ""}>
            <span>🛡️ Rol Admin</span>
          </label>
          <button type="button" class="btn btn-whatsapp btn-sm" data-invite-driver="${idx}">📲 Mandar App</button>
          <button type="button" class="btn btn-outline btn-sm" data-copy-driver="${idx}">📋 Copiar</button>
          <button type="button" class="btn btn-outline btn-sm" data-ping-driver="${idx}" title="Enviar notificación Push para que reporte su GPS">📍 Pedir GPS</button>
          <button type="button" class="btn btn-primary btn-sm" data-save-driver="${idx}">Guardar</button>
          <button type="button" class="btn btn-outline btn-sm" data-remove-driver="${idx}" style="color:var(--red-600);border-color:#eccaca;">Quitar</button>
        </div>
      </div>
    `
    )
    .join("");
}

document.getElementById("driversListEditor").addEventListener("click", async (e) => {
  const inviteBtn = e.target.closest("button[data-invite-driver]");
  if (inviteBtn) {
    const payload = getDriverCardPayload(Number(inviteBtn.dataset.inviteDriver));
    if (!payload) return;
    window.open(buildDriverInviteWhatsAppUrl(payload.drv, payload.typedPin), "_blank", "noopener");
    return;
  }

  const copyBtn = e.target.closest("button[data-copy-driver]");
  if (copyBtn) {
    const payload = getDriverCardPayload(Number(copyBtn.dataset.copyDriver));
    if (!payload) return;
    try {
      await copyTextToClipboard(buildDriverInviteText(payload.drv, payload.typedPin));
      showToast(`📋 Mensaje de ${payload.drv.name} copiado. Pégalo en WhatsApp.`);
    } catch (err) {
      console.error(err);
      showToast("No se pudo copiar el mensaje.");
    }
    return;
  }

  const pingBtn = e.target.closest("button[data-ping-driver]");
  if (pingBtn) {
    const payload = getDriverCardPayload(Number(pingBtn.dataset.pingDriver));
    if (!payload || !payload.drv.name) return;
    await sendDriverGpsPing(payload.drv.name, "", pingBtn);
    return;
  }

  const saveBtn = e.target.closest("button[data-save-driver]");
  if (saveBtn) {
    const idx = Number(saveBtn.dataset.saveDriver);
    const nameInput = document.querySelector(`.drv-edit-name[data-idx='${idx}']`);
    const phoneInput = document.querySelector(`.drv-edit-phone[data-idx='${idx}']`);
    const pinInput = document.querySelector(`.drv-edit-pin[data-idx='${idx}']`);
    const adminCheck = document.querySelector(`.drv-edit-admin[data-idx='${idx}']`);

    const newName = nameInput ? nameInput.value.trim() : "";
    const newPhone = phoneInput ? phoneInput.value.trim() : "";
    const newPin = pinInput ? pinInput.value.trim() : "";
    const canAccessAdmin = Boolean(adminCheck?.checked);

    if (!newName) {
      showToast("El nombre del chofer no puede quedar vacío.");
      return;
    }
    if (newPin && newPin.length < 4) {
      showToast("El PIN debe tener al menos 4 dígitos.");
      return;
    }

    const updatedDrivers = [...(storeSettings.drivers || [])];
    let pinHashToSave = null;
    if (newPin) {
      pinHashToSave = await computeDriverPinHash(newName, newPin);
    }

    if (updatedDrivers[idx]) {
      updatedDrivers[idx] = {
        ...updatedDrivers[idx],
        name: newName,
        phone: newPhone,
        hasPin: Boolean(pinHashToSave || updatedDrivers[idx].hasPin),
        canAccessAdmin
      };
    }

    try {
      await executeAdminBatch(currentKeyHash, (batch, proofId) => {
        batch.set(
          doc(db, "settings", "store"),
          {
            drivers: updatedDrivers,
            proofId,
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );
        if (pinHashToSave) {
          batch.set(doc(db, "driver_keys", pinHashToSave), {
            driverName: newName,
            active: true,
            vaultId: getActiveVaultId(),
            tenantSlug: ACTIVE_TENANT_SLUG,
            proofId,
            updatedAt: serverTimestamp()
          });
        }
      });
      if (newPin) sessionDriverPins.set(newName, newPin);
      if (pinInput) pinInput.value = "";
      showToast(pinHashToSave ? `Datos y PIN de ${newName} activados.` : `Datos de ${newName} guardados.`);
    } catch (err) {
      console.error(err);
      showToast("No se pudieron guardar los cambios del chofer.");
    }
    return;
  }

  const removeBtn = e.target.closest("button[data-remove-driver]");
  if (removeBtn) {
    const idx = Number(removeBtn.dataset.removeDriver);
    const drv = (storeSettings.drivers || [])[idx];
    const driverName = drv?.name || "este chofer";
    const confirmed = await showConfirmDialog({
      title: `¿Quitar a ${driverName}?`,
      message: "Dejará de aparecer en la lista activa de choferes. Su historial de viajes y ventas anteriores se conserva.",
      confirmText: "Sí, quitar chofer"
    });
    if (!confirmed) return;
    const updatedDrivers = (storeSettings.drivers || []).filter((_, i) => i !== idx);

    try {
      await executeAdminBatch(currentKeyHash, (batch, proofId) => {
        batch.set(
          doc(db, "settings", "store"),
          {
            drivers: updatedDrivers,
            proofId,
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );
      });
      showToast(`Chofer ${driverName} eliminado de la lista.`);
    } catch (err) {
      console.error(err);
      showToast("Error al eliminar chofer.");
    }
  }
});

function showConfirmDialog({ title, message, confirmText = "Confirmar" }) {
  const modal = document.getElementById("confirmActionModal");
  const titleEl = document.getElementById("confirmModalTitle");
  const msgEl = document.getElementById("confirmModalMessage");
  const okBtn = document.getElementById("btnConfirmOk");
  const cancelBtn = document.getElementById("btnConfirmCancel");
  const closeBtn = document.getElementById("btnCloseConfirmModal");
  if (!modal || !okBtn) return Promise.resolve(window.confirm(title || message));

  titleEl.textContent = title || "¿Confirmar acción?";
  msgEl.textContent = message || "";
  okBtn.textContent = confirmText;
  modal.classList.add("open");

  return new Promise((resolve) => {
    const cleanup = (result) => {
      modal.classList.remove("open");
      okBtn.removeEventListener("click", onOk);
      cancelBtn?.removeEventListener("click", onCancel);
      closeBtn?.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (ev) => {
      if (ev.target === modal) cleanup(false);
    };
    const onKey = (ev) => {
      if (ev.key === "Escape") cleanup(false);
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn?.addEventListener("click", onCancel);
    closeBtn?.addEventListener("click", onCancel);
    modal.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

document.getElementById("btnAddDriver").addEventListener("click", async () => {
  const nameInp = document.getElementById("newDriverName");
  const phoneInp = document.getElementById("newDriverPhone");
  const pinInp = document.getElementById("newDriverPin");
  const name = nameInp.value.trim();
  const phone = phoneInp.value.trim();
  const pin = pinInp ? pinInp.value.trim() : "";

  if (!name) {
    showToast("Escribe el nombre del chofer.");
    return;
  }
  if (!pin || pin.length < 4) {
    showToast("Asigna un PIN inicial de al menos 4 dígitos (ej. 3333).");
    return;
  }

  const pinHash = await computeDriverPinHash(name, pin);

  const updatedDrivers = [...(storeSettings.drivers || [])];
  const maxDriversAllowed = Number(storeSettings.plan?.maxDrivers) || 50;
  if (updatedDrivers.length >= maxDriversAllowed) {
    showToast(`Límite de plan alcanzado (${maxDriversAllowed} choferes máx.). Contacta a Ruta Pro Technologies para ampliar tu plan.`);
    return;
  }
  updatedDrivers.push({
    id: name.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now().toString(36),
    name,
    phone,
    hasPin: true
  });

  try {
    await executeAdminBatch(currentKeyHash, (batch, proofId) => {
      batch.set(
        doc(db, "settings", "store"),
        {
          drivers: updatedDrivers,
          proofId,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      batch.set(doc(db, "driver_keys", pinHash), {
        driverName: name,
        active: true,
        vaultId: getActiveVaultId(),
        tenantSlug: ACTIVE_TENANT_SLUG,
        proofId,
        createdAt: serverTimestamp()
      });
    });
    sessionDriverPins.set(name, pin);
    nameInp.value = "";
    phoneInp.value = "";
    if (pinInp) pinInp.value = "";
    showToast(`Chofer ${name} agregado con su PIN activo.`);
  } catch (err) {
    console.error(err);
    showToast("No se pudo agregar el chofer.");
  }
});

document.getElementById("gpsPingConfigForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const gpsPingEnabled = Boolean(document.getElementById("gpsPingEnabled")?.checked);
  const gpsPingIntervalMin = Number(document.getElementById("gpsPingIntervalMin")?.value || 15);
  const gpsPingStartHour = Number(document.getElementById("gpsPingStartHour")?.value || 8);
  const gpsPingEndHour = Number(document.getElementById("gpsPingEndHour")?.value || 19);
  const rawAutoOff = document.getElementById("gpsAutoOffHour")?.value;
  const gpsAutoOffHour = rawAutoOff !== undefined && rawAutoOff !== "" ? Number(rawAutoOff) : 20;
  try {
    await executeAdminBatch(currentKeyHash, (batch, proofId) => {
      batch.set(
        doc(db, "settings", "store"),
        {
          gpsPingEnabled,
          gpsPingIntervalMin,
          gpsPingStartHour,
          gpsPingEndHour,
          gpsAutoOffHour,
          proofId,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    });
    const autoOffTxt = gpsAutoOffHour === 0 ? "sin apagado automático" : `apagado auto ${gpsAutoOffHour}:00`;
    showToast(
      gpsPingEnabled
        ? `✅ GPS guardado: Push cada ${gpsPingIntervalMin} min (${gpsPingStartHour}:00–${gpsPingEndHour}:00) y ${autoOffTxt}.`
        : `✅ GPS guardado (${autoOffTxt}).`
    );
  } catch (err) {
    console.error(err);
    showToast("No se pudo guardar la configuración GPS.");
  }
});

document.getElementById("changePassForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p1 = document.getElementById("newAdminPass1").value;
  const p2 = document.getElementById("newAdminPass2").value;

  if (p1.length < 6) {
    showToast("La clave debe tener al menos 6 caracteres.");
    return;
  }
  if (p1 !== p2) {
    showToast("Las claves no coinciden.");
    return;
  }

  try {
    const newHash = await sha256Hex(p1);
    if (newHash === currentKeyHash) {
      showToast("La nueva clave es igual a la actual.");
      return;
    }

    const oldHash = currentKeyHash;
    await executeAdminBatch(oldHash, (batch, proofId) => {
      batch.set(doc(db, "admin_keys", newHash), { active: true, proofId, createdAt: serverTimestamp() });
      batch.update(doc(db, "admin_keys", oldHash), { active: false, proofId, revokedAt: serverTimestamp() });
    });

    currentKeyHash = newHash;
    if (localStorage.getItem(SESSION_HASH_KEY)) {
      localStorage.setItem(SESSION_HASH_KEY, newHash);
    } else {
      sessionStorage.setItem(SESSION_HASH_KEY, newHash);
    }

    document.getElementById("newAdminPass1").value = "";
    document.getElementById("newAdminPass2").value = "";
    showToast("¡Clave de administración actualizada!");
  } catch (err) {
    console.error(err);
    showToast("Error al actualizar la clave.");
  }
});

// ================= TAB 5: MANUAL OPERATIVO POR PERSONAL (SOLO AUTENTICADO) =================
let selectedManualRole = "duenos";

function renderAdminManualTab() {
  if (!currentKeyHash) return;
  const pillsBar = document.getElementById("manualRoleTabsBar");
  const container = document.getElementById("adminManualContainer");
  if (!pillsBar || !container) return;

  const keys = ["duenos", "oficina", "almacen", "ventas", "clientes"];
  pillsBar.innerHTML = keys
    .map((k) => {
      const m = STAFF_MANUALS[k];
      const isAct = k === selectedManualRole;
      return `<button type="button" class="btn btn-sm ${isAct ? "btn-primary" : "btn-outline"}" data-manual-role="${k}">${escapeHtml(m.shortTab)}</button>`;
    })
    .join("");

  const activeManual = STAFF_MANUALS[selectedManualRole] || STAFF_MANUALS.duenos;
  const waShareUrl = `https://wa.me/?text=${encodeURIComponent(activeManual.whatsappText)}`;

  const stepsHtml = activeManual.steps
    .map(
      (st) => `
      <article class="manual-step-card">
        <div class="manual-step-head">
          <span class="manual-step-badge">Paso ${escapeHtml(st.num)}</span>
          <span style="font-size:1.25rem;">${st.icon}</span>
          <h4 style="font-size:1.02rem;color:var(--green-950);margin:0;">${escapeHtml(st.heading)}</h4>
        </div>
        <div class="manual-step-body">${st.bodyHtml}</div>
        ${
          st.example
            ? `<div class="manual-example-box">💡 <strong>Ejemplo práctico:</strong> ${escapeHtml(st.example)}</div>`
            : ""
        }
      </article>
    `
    )
    .join("");

  container.innerHTML = `
    <div class="order-admin-card" style="border-left:5px solid var(--green-800);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <span class="ripeness-badge" style="margin-bottom:6px;display:inline-block;">${escapeHtml(activeManual.badge)}</span>
          <h3 class="serif-title" style="font-size:1.3rem;color:var(--green-950);margin-bottom:2px;">${escapeHtml(activeManual.title)}</h3>
          <div style="font-size:0.9rem;font-weight:800;color:var(--green-800);">👥 Puesto / Área: ${escapeHtml(activeManual.people)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" id="btnCopyManualWa" class="btn btn-outline btn-sm">📋 Copiar para WhatsApp</button>
          <a href="${waShareUrl}" target="_blank" rel="noopener" class="btn btn-whatsapp btn-sm">📲 Compartir por WhatsApp</a>
          <button type="button" id="btnPrintManual" class="btn btn-primary btn-sm">🖨️ Imprimir Manual</button>
        </div>
      </div>

      <p style="font-size:0.9rem;color:var(--slate-700);line-height:1.55;margin-bottom:10px;">
        ${escapeHtml(activeManual.summary)}
      </p>
      <div style="background:var(--green-50);border:1px solid var(--green-200);padding:9px 12px;border-radius:10px;font-size:0.82rem;color:var(--green-950);">
        🔑 <strong>Dónde entra:</strong> ${escapeHtml(activeManual.accessNote)}
      </div>
    </div>

    <div class="manual-steps-list">
      ${stepsHtml}
    </div>
  `;

  document.getElementById("btnCopyManualWa")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(activeManual.whatsappText);
      showToast(`📋 Manual de "${activeManual.people}" copiado para pegar en WhatsApp.`);
    } catch (_) {
      showToast("No se pudo copiar automáticamente.");
    }
  });

  document.getElementById("btnPrintManual")?.addEventListener("click", () => {
    printStaffManual(activeManual);
  });
}

document.getElementById("manualRoleTabsBar")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-manual-role]");
  if (!btn) return;
  selectedManualRole = btn.dataset.manualRole;
  renderAdminManualTab();
});

function printStaffManual(m) {
  const area = document.getElementById("printReceiptArea");
  if (!area) return;

  const stepsPrint = m.steps
    .map(
      (st) => `
      <div style="border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;margin-bottom:9px;page-break-inside:avoid;">
        <div style="font-weight:900;font-size:10.5pt;color:#132615;margin-bottom:4px;">
          Paso ${escapeHtml(st.num)} — ${st.icon} ${escapeHtml(st.heading)}
        </div>
        <div style="font-size:9.5pt;line-height:1.5;color:#1e293b;">${st.bodyHtml}</div>
        ${
          st.example
            ? `<div style="margin-top:6px;background:#f4f8f3;padding:6px 8px;border-radius:6px;font-size:8.8pt;color:#264428;"><strong>Ejemplo práctico:</strong> ${escapeHtml(st.example)}</div>`
            : ""
        }
      </div>
    `
    )
    .join("");

  area.innerHTML = `
    <div style="max-width:190mm;margin:0 auto;font-family:Arial,sans-serif;color:#111;">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #264428;padding-bottom:8px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="assets/logo-salinas.png" style="height:15mm;object-fit:contain;" alt="Salinas">
          <div>
            <div style="font-size:13pt;font-weight:900;color:#132615;">${escapeHtml(m.title)}</div>
            <div style="font-size:9.5pt;font-weight:700;color:#2e5a31;">Puesto / Área: ${escapeHtml(m.people)}</div>
          </div>
        </div>
        <div style="text-align:right;font-size:8pt;color:#475569;">
          <div>${escapeHtml(m.badge)}</div>
          <div>Comercializadora Salinas</div>
        </div>
      </div>
      <p style="font-size:9.5pt;margin-bottom:8px;">${escapeHtml(m.summary)}</p>
      <div style="background:#eff6ed;border:1px solid #bcd8b9;padding:7px 10px;border-radius:6px;font-size:9pt;margin-bottom:12px;">
        <strong>Acceso:</strong> ${escapeHtml(m.accessNote)}
      </div>
      ${stepsPrint}
    </div>
  `;

  document.body.classList.add("printing-receipt");
  window.print();
  setTimeout(() => document.body.classList.remove("printing-receipt"), 500);
}

// ================= ALMACENISTAS Y PIN =================
function renderWhStaffEditor() {
  const container = document.getElementById("whStaffListEditor");
  if (!container) return;
  const list = Array.isArray(storeSettings.warehouseStaff) ? storeSettings.warehouseStaff : [];
  if (list.length === 0) {
    container.innerHTML = `<p style="font-size:0.82rem;color:var(--slate-500);">No hay almacenistas dados de alta. Agrega uno abajo para que entre a <code>/almacen.html</code>.</p>`;
    return;
  }
  container.innerHTML = list
    .map(
      (s, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;">
        <div>
          <strong>❄️ ${escapeHtml(s.name)}</strong>
          <span style="font-size:0.75rem;color:#64748b;margin-left:6px;">${s.hasPin ? "PIN activo" : "Sin PIN"}</span>
        </div>
        <button type="button" class="btn btn-outline btn-sm" data-reset-wh-pin="${i}">🔑 Cambiar PIN</button>
      </div>
    `
    )
    .join("");

  container.querySelectorAll("button[data-reset-wh-pin]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.resetWhPin);
      const staff = list[idx];
      if (!staff) return;
      const newPin = prompt(`Nuevo PIN (4+ dígitos) para ${staff.name}:`);
      if (!newPin || newPin.trim().length < 4) return showToast("El PIN debe tener al menos 4 dígitos.");
      try {
        const hash = await computeWarehousePinHash(staff.name, newPin.trim());
        await executeAdminBatch(currentKeyHash, (batch, proofId) => {
          batch.set(doc(db, "warehouse_keys", hash), {
            staffName: staff.name,
            active: true,
            vaultId: getActiveVaultId(),
            tenantSlug: ACTIVE_TENANT_SLUG,
            createdAtIso: new Date().toISOString(),
            proofId
          });
        });
        showToast(`✅ PIN actualizado para ${staff.name}`);
      } catch (err) {
        console.error(err);
        showToast("Error guardando PIN de almacén.");
      }
    });
  });
}

document.getElementById("btnAddWhStaff")?.addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const name = document.getElementById("newWhStaffName")?.value.trim();
  const pin = document.getElementById("newWhStaffPin")?.value.trim();
  if (!name) return showToast("Escribe el nombre del almacenista.");
  if (!pin || pin.length < 4) return showToast("El PIN debe tener al menos 4 dígitos.");

  const list = Array.isArray(storeSettings.warehouseStaff) ? [...storeSettings.warehouseStaff] : [];
  if (list.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    return showToast("Ya existe un almacenista con ese nombre.");
  }
  const newItem = { id: "alm_" + Date.now().toString(36), name, hasPin: true };
  list.push(newItem);

  btn.disabled = true;
  try {
    const hash = await computeWarehousePinHash(name, pin);
    await executeAdminBatch(currentKeyHash, (batch, proofId) => {
      batch.set(
        doc(db, "settings", "store"),
        { warehouseStaff: list, proofId, updatedAt: serverTimestamp() },
        { merge: true }
      );
      batch.set(doc(db, "warehouse_keys", hash), {
        staffName: name,
        active: true,
        vaultId: getActiveVaultId(),
        tenantSlug: ACTIVE_TENANT_SLUG,
        createdAtIso: new Date().toISOString(),
        proofId
      });
    });
    storeSettings.warehouseStaff = list;
    renderWhStaffEditor();
    document.getElementById("newWhStaffName").value = "";
    document.getElementById("newWhStaffPin").value = "";
    showToast(`✅ ${name} dado de alta para /almacen.html`);
  } catch (err) {
    console.error(err);
    showToast("Error agregando almacenista.");
  } finally {
    btn.disabled = false;
  }
});

// ================= TERMOS, CUARTOS FRÍOS Y LOTES QR =================
let allThermos = [];
let allPalletLots = [];
let thermosUnsub = null;
let lotsUnsub = null;

function startThermosAndLotsListeners() {
  if (thermosUnsub) thermosUnsub();
  if (lotsUnsub) lotsUnsub();

  const thermoDateInput = document.getElementById("thermoDateInput");
  if (thermoDateInput && !thermoDateInput.value) thermoDateInput.value = getLocalDateStr();

  thermosUnsub = onSnapshot(collection(db, "thermos"), (snap) => {
    allThermos = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.arrivalDate || "").localeCompare(String(a.arrivalDate || "")));
    populateLotsThermoSelects();
    renderLotsDashboard();
    if (superadminKeyHash) renderSuperadminDashboard();
  });

  lotsUnsub = onSnapshot(collection(db, "pallet_lots"), (snap) => {
    allPalletLots = snap.docs
      .map((d) => {
        const data = d.data();
        return { id: d.id, ...data, coldRoom: normalizeColdRoom(data.coldRoom) };
      })
      .sort((a, b) => String(a.lotCode || a.id).localeCompare(String(b.lotCode || b.id)));
    renderLotsDashboard();
  });
}

function populateLotsThermoSelects() {
  const fSel = document.getElementById("filterLotsThermo");
  const saSel = document.getElementById("saCostThermoSelect");
  const opts = allThermos.map(
    (t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.code)} (${escapeHtml(t.arrivalDate || "")})</option>`
  );
  if (fSel) {
    const prev = fSel.value;
    fSel.innerHTML = [`<option value="all">Todos los Termos</option>`, ...opts].join("");
    if (prev) fSel.value = prev;
  }
  if (saSel) {
    const prevSa = saSel.value;
    saSel.innerHTML = opts.length ? opts.join("") : `<option value="">Sin termos registrados</option>`;
    if (prevSa) saSel.value = prevSa;
  }
}

document.getElementById("createThermoForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = (document.getElementById("thermoCodeInput")?.value || "T01").trim().toUpperCase();
  const arrivalDate = document.getElementById("thermoDateInput")?.value || getLocalDateStr();
  const priCount = Math.max(0, Number(document.getElementById("thermoPriCount")?.value) || 0);
  const extCount = Math.max(0, Number(document.getElementById("thermoExtCount")?.value) || 0);
  const proCount = Math.max(0, Number(document.getElementById("thermoProCount")?.value) || 0);
  const boxesPerPallet = Math.max(1, Number(document.getElementById("thermoBoxesPerPallet")?.value) || 100);
  const totalPallets = priCount + extCount + proCount;
  if (totalPallets === 0) return showToast("Agrega al menos 1 tarima.");

  const thermoId = `${code}_${arrivalDate}`;
  const palletsToCreate = [];
  const pushPallets = (grade, count, quality, kind) => {
    for (let i = 1; i <= count; i++) {
      const num = String(i).padStart(2, "0");
      const lotCode = `${code}-${grade}-${num}`;
      palletsToCreate.push({
        id: `${thermoId}_${grade}_${num}`,
        lotCode,
        grade,
        quality,
        kind
      });
    }
  };
  pushPallets("PRI", priCount, "Limpio", "clasificado");
  pushPallets("EXT", extCount, "Limpio", "clasificado");
  pushPallets("PRO", proCount, "Proceso", "proceso");

  try {
    await executeAdminBatch(currentKeyHash, (batch, proofId) => {
      batch.set(doc(db, "thermos", thermoId), {
        code,
        arrivalDate,
        palletsCount: totalPallets,
        totalKgExpected: totalPallets * boxesPerPallet * 10,
        status: "activo",
        createdAtIso: new Date().toISOString(),
        proofId
      });
      for (const p of palletsToCreate) {
        const gCode = p.grade === "PRI" ? "P" : p.grade === "EXT" ? "E" : "PRO";
        batch.set(doc(db, "pallet_lots", p.id), {
          lotCode: p.lotCode,
          thermoId,
          thermoCode: code,
          parentLotId: null,
          arrivalDate,
          coldRoom: "Cuarto 1",
          grade: gCode,
          kind: p.kind,
          quality: p.quality,
          ripeness: "Verde",
          initialBoxes: boxesPerPallet,
          remainingBoxes: boxesPerPallet,
          mermaBoxes: 0,
          state: "disponible",
          events: [{ type: "creacion", by: "Administración", atIso: new Date().toISOString(), note: `Termo ${code} creado` }],
          createdAtIso: new Date().toISOString(),
          updatedAtIso: new Date().toISOString(),
          proofId
        });
      }
    });
    showToast(`✅ Termo ${code} creado con ${totalPallets} tarimas QR listas para imprimir.`);
  } catch (err) {
    console.error(err);
    showToast("Error creando termo.");
  }
});

["filterLotsThermo", "filterLotsRoom", "filterLotsKind"].forEach((id) => {
  document.getElementById(id)?.addEventListener("change", renderLotsDashboard);
});

function renderLotsDashboard() {
  const sumEl = document.getElementById("lotsSummaryCards");
  const tblEl = document.getElementById("lotsTableContainer");
  if (!sumEl || !tblEl) return;

  const tFilter = document.getElementById("filterLotsThermo")?.value || "all";
  const rFilter = document.getElementById("filterLotsRoom")?.value || "all";
  const kFilter = document.getElementById("filterLotsKind")?.value || "active";

  const thermoScope = allPalletLots.filter((l) => tFilter === "all" || l.thermoId === tFilter);
  let proBoxes = 0;
  let readyBoxes = 0;
  let mermaBoxes = 0;
  const byGrade = { S: 0, E: 0, P: 0, M: 0, C: 0 };

  thermoScope.forEach((l) => {
    const rem = Number(l.remainingBoxes) || 0;
    mermaBoxes += Number(l.mermaBoxes) || 0;
    if (l.grade === "PRO" || l.kind === "proceso") proBoxes += rem;
    else {
      readyBoxes += rem;
      if (byGrade[l.grade] !== undefined) byGrade[l.grade] += rem;
    }
  });

  sumEl.innerHTML = `
    <div class="kpi-card"><div class="kpi-label">Proceso (Por seleccionar)</div><div class="kpi-value" style="color:#b45309;">${proBoxes}</div><div class="kpi-sub">${(proBoxes * 10).toLocaleString("es-MX")} kg en transición</div></div>
    <div class="kpi-card"><div class="kpi-label">Clasificado Listo Venta</div><div class="kpi-value" style="color:#15803d;">${readyBoxes}</div><div class="kpi-sub">S:${byGrade.S} E:${byGrade.E} P:${byGrade.P} M:${byGrade.M} C:${byGrade.C}</div></div>
    <div class="kpi-card"><div class="kpi-label">Merma Acumulada</div><div class="kpi-value" style="color:#dc2626;">${mermaBoxes}</div><div class="kpi-sub">${(mermaBoxes * 10).toLocaleString("es-MX")} kg descartados</div></div>
    <div class="kpi-card"><div class="kpi-label">Total Tarimas / Lotes</div><div class="kpi-value">${thermoScope.filter((l) => (l.remainingBoxes || 0) > 0).length}</div><div class="kpi-sub">Con existencia &gt; 0</div></div>
  `;

  const rows = thermoScope.filter((l) => {
    if (rFilter !== "all" && l.coldRoom !== rFilter) return false;
    const rem = Number(l.remainingBoxes) || 0;
    if (kFilter === "active") return rem > 0;
    if (kFilter === "PRO") return rem > 0 && (l.grade === "PRO" || l.kind === "proceso");
    if (kFilter === "clasificado") return rem > 0 && l.grade !== "PRO" && l.kind !== "proceso";
    return true;
  });

  if (rows.length === 0) {
    tblEl.innerHTML = `<p style="color:#64748b;font-size:0.86rem;">No hay lotes para mostrar con este filtro.</p>`;
    return;
  }

  tblEl.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
      <thead>
        <tr style="background:#f1f5f9;text-align:left;color:#334155;">
          <th style="padding:8px;">Código QR</th>
          <th style="padding:8px;">Cuarto Frío</th>
          <th style="padding:8px;">Calibre / Calidad</th>
          <th style="padding:8px;">Madurez</th>
          <th style="padding:8px;">Antigüedad</th>
          <th style="padding:8px;text-align:right;">Cajas (10kg)</th>
          <th style="padding:8px;text-align:right;">Merma</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((l) => {
            const days = l.arrivalDate ? Math.max(0, Math.floor((Date.now() - new Date(`${l.arrivalDate}T00:00:00`)) / 86400000)) : 0;
            const sem = days >= 7 ? "🔴" : days >= 4 ? "🟡" : "🟢";
            const gLabel = LOT_GRADES[l.grade]?.short || l.grade;
            return `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:8px;font-weight:800;color:#14532d;">${escapeHtml(l.lotCode)}</td>
                <td style="padding:8px;">❄️ ${escapeHtml(l.coldRoom || "-")}</td>
                <td style="padding:8px;"><strong>${escapeHtml(gLabel)}</strong> · ${escapeHtml(l.quality || "-")}</td>
                <td style="padding:8px;">${escapeHtml(l.ripeness || "-")}</td>
                <td style="padding:8px;">${sem} ${days} d</td>
                <td style="padding:8px;text-align:right;font-weight:800;">${l.remainingBoxes ?? 0}</td>
                <td style="padding:8px;text-align:right;color:#dc2626;">${l.mermaBoxes ?? 0}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

document.getElementById("btnPrintThermoQrs")?.addEventListener("click", () => {
  const tFilter = document.getElementById("filterLotsThermo")?.value || "all";
  const targetLots = allPalletLots.filter((l) => !l.parentLotId && (tFilter === "all" || l.thermoId === tFilter));
  if (targetLots.length === 0) return showToast("Crea primero un Termo para imprimir sus QRs.");
  if (typeof window.QRCode === "undefined") return showToast("Librería QR aún cargando.");

  const area = document.getElementById("printReceiptArea");
  area.innerHTML = `
    <div style="font-family:Arial,sans-serif;display:grid;grid-template-columns:repeat(2,1fr);gap:8mm;">
      ${targetLots
        .map(
          (l) => `
          <div style="border:2px solid #14532d;border-radius:8px;padding:6mm;display:flex;align-items:center;gap:5mm;page-break-inside:avoid;">
            <div id="qr_print_${escapeHtml(l.id)}" style="width:30mm;height:30mm;flex-shrink:0;"></div>
            <div style="flex:1;">
              <div style="font-size:8pt;color:#475569;font-weight:700;">COMERCIALIZADORA SALINAS • 10 KG</div>
              <div style="font-size:16pt;font-weight:900;color:#14532d;margin:2px 0;">${escapeHtml(l.lotCode)}</div>
              <div style="font-size:9.5pt;font-weight:800;">Tipo: ${escapeHtml(LOT_GRADES[l.grade]?.short || l.grade)} (${escapeHtml(l.quality || "-")})</div>
              <div style="font-size:8.5pt;color:#334155;">Llegada: ${escapeHtml(l.arrivalDate || "-")} • Cajas: ${l.initialBoxes || 100}</div>
              <div style="margin-top:4px;border-top:1px dashed #94a3b8;padding-top:3px;font-size:8pt;color:#64748b;">Cuarto: __________ • Madurez: __________</div>
            </div>
          </div>
        `
        )
        .join("")}
    </div>
  `;

  targetLots.forEach((l) => {
    const el = document.getElementById(`qr_print_${l.id}`);
    if (el) {
      new window.QRCode(el, { text: `RPD_LOT:${ACTIVE_TENANT_SLUG}:${l.id}`, width: 112, height: 112, correctLevel: window.QRCode.CorrectLevel.M });
    }
  });

  setTimeout(() => {
    document.body.classList.add("printing-receipt");
    window.print();
    setTimeout(() => document.body.classList.remove("printing-receipt"), 500);
  }, 250);
});

// ================= SUPERADMIN (PRECIOS COMPRA, GASTOS Y UTILIDAD) =================
let superadminKeyHash = null;
let isSuperadminInitialized = true;
let allThermoCosts = [];
let allExpenses = [];
let costsUnsub = null;
let expensesUnsub = null;

async function checkSuperadminInit() {
  try {
    const snap = await getDoc(doc(db, "settings", "superadmin_init"));
    isSuperadminInitialized = snap.exists();
    const titleEl = document.getElementById("saLockTitle");
    const descEl = document.getElementById("saLockDesc");
    const btnEl = document.getElementById("btnSuperadminUnlock");
    if (!isSuperadminInitialized && titleEl && descEl && btnEl) {
      titleEl.textContent = "Configurar Clave Maestra Superadmin";
      descEl.textContent = "Primera vez: crea tu clave/PIN exclusivo de Superadmin para proteger precios de compra y utilidades.";
      btnEl.textContent = "Crear Clave Superadmin y Entrar";
    }
  } catch (_) {}
}

document.getElementById("superadminAuthForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pin = document.getElementById("superadminPinInput")?.value.trim();
  if (!pin || pin.length < 4) return showToast("Mínimo 4 caracteres.");
  const hash = await sha256Hex("SUPERADMIN::" + pin);

  try {
    if (!isSuperadminInitialized) {
      const batch = writeBatch(db);
      batch.set(doc(db, "settings", "superadmin_init"), { initialized: true, createdAtIso: new Date().toISOString() });
      batch.set(doc(db, "superadmin_keys", hash), { active: true, vaultId: getActiveVaultId(), tenantSlug: ACTIVE_TENANT_SLUG, label: "Dirección / Finanzas", createdAtIso: new Date().toISOString() });
      await batch.commit();
      isSuperadminInitialized = true;
      showToast("✅ Clave de Dirección / Finanzas configurada.");
    } else {
      const snap = await getDoc(doc(db, "superadmin_keys", hash));
      if (!snap.exists() || snap.data().active !== true) {
        return showToast("Clave de Dirección / Finanzas incorrecta.");
      }
    }
    superadminKeyHash = hash;
    document.getElementById("superadminPinInput").value = "";
    document.getElementById("superadminLockCard").style.display = "none";
    document.getElementById("superadminContent").style.display = "block";
    const expDate = document.getElementById("saExpDate");
    if (expDate && !expDate.value) expDate.value = getLocalDateStr();
    startSuperadminListeners();
  } catch (err) {
    console.error(err);
    showToast("Error autenticando Superadmin.");
  }
});

document.getElementById("btnLockSuperadmin")?.addEventListener("click", () => {
  superadminKeyHash = null;
  if (costsUnsub) costsUnsub();
  if (expensesUnsub) expensesUnsub();
  document.getElementById("superadminContent").style.display = "none";
  document.getElementById("superadminLockCard").style.display = "block";
});

function startSuperadminListeners() {
  if (costsUnsub) costsUnsub();
  if (expensesUnsub) expensesUnsub();
  costsUnsub = onSnapshot(collection(db, "thermo_costs"), (snap) => {
    allThermoCosts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderSuperadminDashboard();
  });
  expensesUnsub = onSnapshot(collection(db, "expenses"), (snap) => {
    allExpenses = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    renderSuperadminDashboard();
  });
}

document.getElementById("saThermoCostForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!superadminKeyHash) return;
  const thermoId = document.getElementById("saCostThermoSelect")?.value;
  if (!thermoId) return showToast("Crea primero un Termo en la pestaña Termos y Lotes QR.");
  const costPriKg = Number(document.getElementById("saCostPriKg")?.value) || 0;
  const kgPri = Number(document.getElementById("saKgPri")?.value) || 0;
  const costProKg = Number(document.getElementById("saCostProKg")?.value) || 0;
  const kgPro = Number(document.getElementById("saKgPro")?.value) || 0;
  const freightCost = Number(document.getElementById("saCostFreight")?.value) || 0;
  const totalFruitCost = costPriKg * kgPri + costProKg * kgPro;
  const totalCost = totalFruitCost + freightCost;

  try {
    await executeSuperadminBatch(superadminKeyHash, (batch, proofId) => {
      batch.set(doc(db, "thermo_costs", thermoId), {
        thermoId,
        costPriKg,
        kgPri,
        costProKg,
        kgPro,
        freightCost,
        totalFruitCost,
        totalCost,
        updatedAtIso: new Date().toISOString(),
        proofId
      });
    });
    showToast(`💾 Costo guardado para ${thermoId}`);
  } catch (err) {
    console.error(err);
    showToast("Error guardando costo.");
  }
});

document.getElementById("saExpenseForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!superadminKeyHash) return;
  const date = document.getElementById("saExpDate").value || getLocalDateStr();
  const category = document.getElementById("saExpCategory").value;
  const amount = Math.max(1, Number(document.getElementById("saExpAmount").value) || 0);
  const note = document.getElementById("saExpNote").value.trim();
  const expId = `exp_${date}_${Date.now().toString(36)}`;

  try {
    await executeSuperadminBatch(superadminKeyHash, (batch, proofId) => {
      batch.set(doc(db, "expenses", expId), {
        date,
        category,
        amount,
        note,
        createdAtIso: new Date().toISOString(),
        proofId
      });
    });
    document.getElementById("saExpAmount").value = "";
    document.getElementById("saExpNote").value = "";
    showToast("💸 Gasto registrado.");
  } catch (err) {
    console.error(err);
    showToast("Error registrando gasto.");
  }
});

function renderSuperadminDashboard() {
  const kpiEl = document.getElementById("saFinancialKpis");
  const costsEl = document.getElementById("saThermoCostsList");
  const expEl = document.getElementById("saExpensesList");
  if (!kpiEl) return;

  const ordersRev = allOrders
    .filter((o) => o.status !== "cancelado")
    .reduce((acc, o) => acc + (Number(o.totalAmount) || 0), 0);
  const routeRev = (typeof allRouteSales !== "undefined" ? allRouteSales : []).reduce(
    (acc, s) => acc + (Number(s.totalAmount) || 0),
    0
  );
  const totalRevenue = ordersRev + routeRev;
  const totalThermoPurchases = allThermoCosts.reduce((acc, c) => acc + (Number(c.totalCost) || 0), 0);
  const totalOpExpenses = allExpenses.reduce((acc, x) => acc + (Number(x.amount) || 0), 0);
  const totalOutflow = totalThermoPurchases + totalOpExpenses;
  const netProfit = totalRevenue - totalOutflow;
  const marginPct = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : "0.0";

  kpiEl.innerHTML = `
    <div class="kpi-card"><div class="kpi-label">Ingresos Totales</div><div class="kpi-value" style="color:#15803d;">${formatCurrency(totalRevenue)}</div><div class="kpi-sub">Web: ${formatCurrency(ordersRev)} • Ruta: ${formatCurrency(routeRev)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Compras de Termos</div><div class="kpi-value" style="color:#b45309;">${formatCurrency(totalThermoPurchases)}</div><div class="kpi-sub">${allThermoCosts.length} termo(s) costeado(s)</div></div>
    <div class="kpi-card"><div class="kpi-label">Gastos Operativos</div><div class="kpi-value" style="color:#dc2626;">${formatCurrency(totalOpExpenses)}</div><div class="kpi-sub">${allExpenses.length} movimiento(s)</div></div>
    <div class="kpi-card"><div class="kpi-label">Balance Neto</div><div class="kpi-value" style="color:${netProfit >= 0 ? "#15803d" : "#dc2626"};">${formatCurrency(netProfit)}</div><div class="kpi-sub">Margen s/ ingresos: ${marginPct}%</div></div>
  `;

  if (costsEl) {
    costsEl.innerHTML = allThermoCosts.length
      ? allThermoCosts
          .map(
            (c) => `<div style="padding:7px 0;border-bottom:1px solid #e2e8f0;font-size:0.82rem;display:flex;justify-content:space-between;">
              <span><strong>${escapeHtml(c.thermoId)}</strong> (Pri/Ext \$${c.costPriKg}/kg • Pro \$${c.costProKg}/kg + Flete ${formatCurrency(c.freightCost)})</span>
              <strong>${formatCurrency(c.totalCost)}</strong>
            </div>`
          )
          .join("")
      : `<p style="font-size:0.8rem;color:#64748b;">Aún no has capturado precios de compra de termos.</p>`;
  }

  if (expEl) {
    expEl.innerHTML = allExpenses.length
      ? allExpenses
          .map(
            (x) => `<div style="padding:7px 0;border-bottom:1px solid #e2e8f0;font-size:0.82rem;display:flex;justify-content:space-between;">
              <span><strong>${escapeHtml(x.category)}</strong> • ${escapeHtml(x.note)} <small style="color:#64748b;">(${escapeHtml(x.date)})</small></span>
              <strong style="color:#dc2626;">-${formatCurrency(x.amount)}</strong>
            </div>`
          )
          .join("")
      : `<p style="font-size:0.8rem;color:#64748b;">Sin gastos operativos registrados.</p>`;
  }
}

checkSuperadminInit();
checkInitialAuth();

// ================= CONSTRUCTOR INTELIGENTE DE RUTAS (ADMIN TABLET/PC) =================
let rbStops = [];
let rbActiveBuilderDriver = "";
const rbDraftByDriverMap = new Map();

function markCurrentDriverDraftDirty() {
  const drv = rbActiveBuilderDriver || document.getElementById("rbDriverSelect")?.value || "";
  if (!drv) return;
  const slug = rbDriverSlug(drv);
  rbDraftByDriverMap.set(slug, {
    driverName: drv,
    stops: structuredClone(rbStops),
    distM: rbTotalDistM,
    durSec: rbTotalDurSec,
    latLngs: Array.isArray(rbPreviewLatLngs) ? [...rbPreviewLatLngs] : [],
    dirty: true
  });
}
let rbPreviewLatLngs = [];
let rbTotalDistM = 0;
let rbTotalDurSec = 0;
let rbRouteUnsub = null;

function rbDriverSlug(name) {
  return String(name || "chofer")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "chofer";
}

function getStoreBaseLocation() {
  const b = storeSettings?.baseLocation || DEFAULT_STORE_SETTINGS.baseLocation;
  if (b && Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng))) {
    return {
      name: b.name || "Base / Bodega Salinas",
      address: b.address || "",
      lat: Number(b.lat),
      lng: Number(b.lng)
    };
  }
  return { name: "Base / Bodega Salinas", address: "", lat: 25.407054, lng: -100.954645 };
}

function getDriverCurrentOrBaseOrigin(driverName) {
  const slug = rbDriverSlug(driverName);
  const loc = driverLocations.find(
    (d) =>
      d.id === slug ||
      String(d.driverName || "").toLowerCase() === String(driverName || "").toLowerCase()
  );
  if (
    loc &&
    typeof loc.lat === "number" &&
    typeof loc.lng === "number" &&
    loc.updatedAtIso &&
    Date.now() - new Date(loc.updatedAtIso).getTime() < 45 * 60 * 1000
  ) {
    return { lat: loc.lat, lng: loc.lng, label: "GPS actual" };
  }
  const base = getStoreBaseLocation();
  return { lat: base.lat, lng: base.lng, label: "Base" };
}

function populateRouteBuilderDrivers() {
  const sel = document.getElementById("rbDriverSelect");
  if (!sel) return;
  const prev = sel.value;
  const drivers = storeSettings.drivers || [];
  sel.innerHTML = drivers
    .map((d) => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`)
    .join("");
  if (prev && drivers.some((d) => d.name === prev)) {
    sel.value = prev;
  } else {
    const firstReal = drivers.find((d) => !/^prueba$/i.test(String(d.name || "").trim())) || drivers[0];
    if (firstReal) sel.value = firstReal.name;
  }
  if (sel.value && (sel.value !== prev || !rbRouteUnsub)) {
    subscribeAdminBuilderToDriverRoute(sel.value);
  }
}

function updateRbTruckStockBadge(driverName) {
  const badge = document.getElementById("rbTruckStockBadge");
  if (!badge) return;
  const slug = rbDriverSlug(driverName);
  const loc = driverLocations.find(
    (d) => d.id === slug || String(d.driverName || "").toLowerCase() === String(driverName || "").toLowerCase()
  );
  const boxesInCar = typeof loc?.boxesInCar === "number" ? loc.boxesInCar : null;
  const orderBoxes = rbStops.reduce((acc, s) => acc + (Number(s.boxes) || 0), 0);
  badge.textContent =
    boxesInCar !== null
      ? `Carro: ${boxesInCar} cj • Pedidos ruta: ${orderBoxes} cj`
      : `Pedidos en ruta: ${orderBoxes} cj`;
}

function subscribeAdminBuilderToDriverRoute(driverName) {
  if (rbRouteUnsub) {
    rbRouteUnsub();
    rbRouteUnsub = null;
  }
  rbActiveBuilderDriver = driverName || "";
  if (!driverName) return;
  updateRbTruckStockBadge(driverName);
  const slug = rbDriverSlug(driverName);
  const docId = `${getLocalDateStr()}_${slug}`;
  rbRouteUnsub = onSnapshot(doc(db, "driver_routes", docId), (snap) => {
    const localDraft = rbDraftByDriverMap.get(slug);
    if (localDraft?.dirty) {
      rbStops = structuredClone(localDraft.stops || []);
      rbTotalDistM = Number(localDraft.distM) || 0;
      rbTotalDurSec = Number(localDraft.durSec) || 0;
      rbPreviewLatLngs = Array.isArray(localDraft.latLngs) ? [...localDraft.latLngs] : [];
      renderRouteBuilderUI();
      recalculateAdminBuilderMetrics();
      return;
    }
    if (!snap.exists()) {
      rbStops = [];
      rbPreviewLatLngs = [];
      rbTotalDistM = 0;
      rbTotalDurSec = 0;
      renderRouteBuilderUI();
      return;
    }
    const data = snap.data();
    if (Array.isArray(data.stops)) {
      rbStops = data.stops;
      rbTotalDistM = Number(data.totalDistanceMeters) || 0;
      rbTotalDurSec = Number(data.totalDurationSec) || 0;
      const retChk = document.getElementById("rbReturnToBaseChk");
      if (retChk && typeof data.includeReturnToBase === "boolean") {
        retChk.checked = data.includeReturnToBase;
      }
      renderRouteBuilderUI();
      recalculateAdminBuilderMetrics();
    }
  });
}

function renderRouteBuilderUI() {
  window.dispatchEvent(new CustomEvent("salinas:routes-updated"));
  const listEl = document.getElementById("rbStopsList");
  const badgeEl = document.getElementById("rbSummaryBadge");
  const pillEl = document.getElementById("rbMetricsPill");
  const driverSel = document.getElementById("rbDriverSelect");
  if (!listEl) return;

  if (driverSel?.value) updateRbTruckStockBadge(driverSel.value);

  const pendingCount = rbStops.filter((s) => s.status !== "done").length;
  if (badgeEl) badgeEl.textContent = `${rbStops.length} parada${rbStops.length === 1 ? "" : "s"} ▾`;
  if (pillEl) {
    pillEl.textContent = `${pendingCount} pend. / ${rbStops.length} total • ${formatRouteKm(rbTotalDistM)} • ${formatRouteMin(rbTotalDurSec)}`;
  }

  if (rbStops.length === 0) {
    listEl.innerHTML = `
      <div class="cart-empty" style="padding:14px;font-size:0.82rem;">
        Aún no hay paradas en la ruta. Busca un pedido/tienda arriba, toca <strong>📦 Cargar Pedidos del Chofer</strong> o toca <strong>➕ Sumar a Ruta</strong> directo en cualquier pin del mapa.
      </div>`;
    renderGpsMapAndChips();
    return;
  }

  listEl.innerHTML = rbStops
    .map((st, idx) => {
      const isDone = st.status === "done";
      return `
        <div class="route-stop-row ${isDone ? "is-done" : ""}" data-stop-idx="${idx}">
          <span class="route-drag-handle" title="Arrastrar para reordenar">⋮⋮</span>
          <span class="route-stop-num">${isDone ? "✓" : idx + 1}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.86rem;font-weight:800;color:var(--green-950);line-height:1.25;word-break:break-word;">
              ${escapeHtml(st.name || "Parada")}
            </div>
            <div style="font-size:0.73rem;color:var(--slate-500);line-height:1.25;margin-top:2px;word-break:break-word;">
              ${escapeHtml(st.subtitle || st.address || "")}
            </div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button type="button" class="route-mini-btn" data-rb-move="-1" data-rb-idx="${idx}" title="Subir">▲</button>
            <button type="button" class="route-mini-btn" data-rb-move="1" data-rb-idx="${idx}" title="Bajar">▼</button>
            <button type="button" class="route-mini-btn danger" data-rb-del="${idx}" title="Quitar">✕</button>
          </div>
        </div>
      `;
    })
    .join("");

  attachTouchDragSort(listEl, ".route-stop-row", ".route-drag-handle", (newOrderIndices) => {
    rbStops = newOrderIndices.map((oldIdx) => rbStops[oldIdx]).filter(Boolean);
    renderRouteBuilderUI();
    recalculateAdminBuilderMetrics();
  });

  renderGpsMapAndChips();
}

function renderRoutePreviewOnAdminMap(placeStatusById = null) {
  if (!leafletMap || !mapLayerGroup || !window.L) return;
  if (rbPreviewLatLngs.length >= 2) {
    drawStyledRoutePolyline(rbPreviewLatLngs, { color: "#0284c7", kind: "planned" });
  }

  rbStops.forEach((st, idx) => {
    if (!Number.isFinite(st.lat) || !Number.isFinite(st.lng)) return;
    const pSt = st.id ? placeStatusById?.get(st.id) : null;
    const sold = pSt?.state === "sold";
    const visitedNoSale = !sold && (pSt?.state === "visited" || st.status === "done");
    const bgColor = sold ? "#16a34a" : visitedNoSale ? "#dc2626" : "#facc15";
    const txtColor = sold || visitedNoSale ? "#ffffff" : "#422006";
    const labelTxt = sold ? `✓` : `${idx + 1}`;
    const numIcon = window.L.divIcon({
      className: "salinas-div-icon",
      html: `<div style="width:23px;height:23px;border-radius:50%;background:${bgColor};color:${txtColor};border:2px solid #ffffff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.45);">${labelTxt}</div>`,
      iconSize: [23, 23],
      iconAnchor: [11, 11]
    });
    const numMarker = window.L.marker([st.lat, st.lng], { icon: numIcon, zIndexOffset: 900 }).addTo(mapLayerGroup);
    numMarker.on("click", () => {
      const targetMarker =
        (st.id && mapFocusMarkers.get(`place:${st.id}`)) ||
        (st.id && mapFocusMarkers.get(`order:${st.id}`)) ||
        null;
      if (targetMarker && typeof targetMarker.openPopup === "function") {
        targetMarker.openPopup();
        return;
      }
      const stLabel = sold ? "🟢 Visitado (Compró)" : visitedNoSale ? "🔴 Visitado (Sin compra)" : "🟡 Pendiente de visitar";
      const fallbackHtml = `
        <div style="font-family:sans-serif;max-width:100%;">
          <div style="font-size:0.7rem;font-weight:800;color:#475569;text-transform:uppercase;">Parada #${idx + 1} • ${stLabel}</div>
          <strong style="font-size:0.92rem;color:#132615;display:block;margin-top:2px;">${escapeHtml(st.name || "Parada")}</strong>
          ${st.address ? `<div style="font-size:0.75rem;color:#475569;margin-top:2px;">📍 ${escapeHtml(st.address)}</div>` : ""}
          ${st.subtitle ? `<div style="font-size:0.74rem;color:#64748b;margin-top:2px;">${escapeHtml(st.subtitle)}</div>` : ""}
          <div style="margin-top:6px;">
            <a href="https://maps.google.com/?q=${st.lat},${st.lng}" target="_blank" rel="noopener" style="font-size:0.75rem;font-weight:800;color:#15803d;text-decoration:underline;">Abrir en Google Maps ↗</a>
          </div>
        </div>
      `;
      window.L.popup({
        maxWidth: isTouchDeviceViewport() ? 245 : 290,
        autoPanPaddingTopLeft: [14, 52],
        autoPanPaddingBottomRight: [14, 18]
      })
        .setLatLng([st.lat, st.lng])
        .setContent(fallbackHtml)
        .openOn(leafletMap);
    });
  });

  const base = getStoreBaseLocation();
  const baseIcon = window.L.divIcon({
    className: "salinas-div-icon",
    html: `<div title="${escapeHtml(base.name || "Base / Bodega")}" style="width:24px;height:24px;border-radius:50%;background:#132615;color:#fff;border:2px solid #34d399;font-size:13px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.45);">🏭</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
  window.L.marker([base.lat, base.lng], { icon: baseIcon, zIndexOffset: 850 })
    .addTo(mapLayerGroup)
    .bindPopup(`<div style="font-family:sans-serif;"><strong>🏭 ${escapeHtml(base.name || "Base / Bodega")}</strong>${base.address ? `<div style="font-size:0.78rem;color:#475569;margin-top:2px;">📍 ${escapeHtml(base.address)}</div>` : ""}</div>`);
}

async function recalculateAdminBuilderMetrics() {
  if (rbStops.length === 0) {
    rbPreviewLatLngs = [];
    rbTotalDistM = 0;
    rbTotalDurSec = 0;
    renderRouteBuilderUI();
    return;
  }
  const driverName = document.getElementById("rbDriverSelect")?.value || "";
  const startCoord = getDriverCurrentOrBaseOrigin(driverName);
  const incBase = document.getElementById("rbReturnToBaseChk")?.checked !== false;
  const endCoord = incBase ? getStoreBaseLocation() : null;
  const res = await computeOrderedRouteMetrics({ startCoord, stops: rbStops, endCoord });
  rbTotalDistM = res.distanceMeters;
  rbTotalDurSec = res.durationSec;
  rbPreviewLatLngs = res.latLngs || [];
  renderRouteBuilderUI();
}

async function addStopToAdminBuilder(stopObj, mode = "append") {
  if (!stopObj || !Number.isFinite(stopObj.lat) || !Number.isFinite(stopObj.lng)) {
    showToast("Este punto no tiene coordenadas GPS.");
    return;
  }
  const exists = rbStops.some((s) => s.id === stopObj.id && s.kind === stopObj.kind);
  if (exists) {
    showToast(`"${stopObj.name}" ya está en la ruta.`);
    return;
  }

  const currentDriverName = document.getElementById("rbDriverSelect")?.value || "";
  const currentSlug = rbDriverSlug(currentDriverName);
  if (stopObj.kind === "place" && stopObj.id) {
    let conflictDoc = null;
    for (const rDoc of allDriverRoutesTodayMap.values()) {
      const rSlug = String(rDoc.driverSlug || rbDriverSlug(rDoc.driverName || ""));
      if (!rSlug || rSlug === currentSlug) continue;
      if ((rDoc.stops || []).some((s) => s.kind === "place" && s.id === stopObj.id && s.status !== "done")) {
        conflictDoc = rDoc;
        break;
      }
    }
    if (conflictDoc) {
      const moveIt = await showConfirmDialog({
        title: "⚠️ Tienda ya asignada a otro chofer",
        message: `"${stopObj.name}" ya está en la ruta de ${conflictDoc.driverName}. ¿Quieres moverla a ${currentDriverName} y quitarla de ${conflictDoc.driverName}?`,
        confirmText: "Sí, mover aquí"
      });
      if (!moveIt) return;
      const filteredOtherStops = (conflictDoc.stops || []).filter(
        (s) => !(s.kind === "place" && s.id === stopObj.id && s.status !== "done")
      );
      try {
        await executeAdminBatch(currentKeyHash, (batch, proofId) => {
          batch.set(
            doc(db, "driver_routes", conflictDoc.id),
            {
              stops: filteredOtherStops,
              updatedAtIso: new Date().toISOString(),
              proofId,
              updatedAt: serverTimestamp()
            },
            { merge: true }
          );
        });
      } catch (err) {
        console.warn("No se pudo quitar de la ruta previa:", err);
      }
    }
  }
  if (mode === "optimal" || mode === "next") {
    const done = rbStops.filter((s) => s.status === "done");
    const pending = rbStops.filter((s) => s.status !== "done");
    const driverName = document.getElementById("rbDriverSelect")?.value || "";
    const startCoord = getDriverCurrentOrBaseOrigin(driverName);
    const incBase = document.getElementById("rbReturnToBaseChk")?.checked !== false;
    const endCoord = incBase ? getStoreBaseLocation() : null;
    const updatedPending = insertPendingStopSmart({
      currentCoord: startCoord,
      pendingStops: pending,
      newStop: stopObj,
      endCoord,
      mode
    });
    rbStops = [...done, ...updatedPending];
  } else {
    rbStops.push(stopObj);
  }
  renderRouteBuilderUI();
  recalculateAdminBuilderMetrics();
  const det = document.getElementById("adminRouteBuilderDetails");
  if (det) det.open = true;
}

window.__salinasAddPlaceToRoute = function (placeId) {
  const p = allPlaces.find((x) => x.id === placeId);
  if (!p || typeof p.lat !== "number" || typeof p.lng !== "number") {
    showToast("Esta tienda no tiene coordenadas GPS.");
    return;
  }
  const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.tienda;
  addStopToAdminBuilder({
    id: p.id,
    kind: "place",
    name: `${cat.emoji} ${p.name}`,
    address: p.address || "",
    subtitle: `${cat.label}${p.address ? ` • ${p.address}` : ""}`,
    lat: p.lat,
    lng: p.lng,
    boxes: 0,
    status: "pending",
    pinEmoji: "🥑",
    actionLabel: "➕ Vender / Cobrar",
    arrivalActionLabel: "➕ Vender Aquí"
  });
  showToast(`➕ ${p.name} sumada a la ruta.`);
};

window.__salinasAddOrderToRoute = function (orderId) {
  const ord = allOrders.find((o) => o.id === orderId);
  if (!ord) return;
  const c = resolveOrderCoordsSync(ord);
  if (!c) {
    showToast("Este pedido aún no tiene coordenadas GPS.");
    return;
  }
  addStopToAdminBuilder({
    id: ord.id,
    kind: "order",
    name: `📦 ${ord.customerName || ord.folio || "Pedido"}`,
    address: ord.address || "",
    subtitle: `${ord.folio || "PEDIDO"} • ${ord.totalBoxes || 0} cj • ${formatCurrency(ord.totalAmount)}`,
    lat: c.lat,
    lng: c.lng,
    boxes: Number(ord.totalBoxes) || 0,
    status: ord.status === "entregado" ? "done" : "pending",
    pinEmoji: "📦",
    actionLabel: "✅ Entregar / Cobrar",
    arrivalActionLabel: "✅ Entregar Pedido"
  });
  showToast(`📦 Pedido ${ord.customerName} sumado a la ruta.`);
};

document.getElementById("rbDriverSelect")?.addEventListener("change", (e) => {
  const nextDrv = e.target.value;
  const nextSlug = rbDriverSlug(nextDrv);
  const savedDraft = rbDraftByDriverMap.get(nextSlug);
  if (savedDraft?.dirty) {
    rbStops = structuredClone(savedDraft.stops || []);
    rbPreviewLatLngs = Array.isArray(savedDraft.latLngs) ? [...savedDraft.latLngs] : [];
    rbTotalDistM = Number(savedDraft.distM) || 0;
    rbTotalDurSec = Number(savedDraft.durSec) || 0;
  } else {
    rbStops = [];
    rbPreviewLatLngs = [];
    rbTotalDistM = 0;
    rbTotalDurSec = 0;
  }
  subscribeAdminBuilderToDriverRoute(nextDrv);
});

document.getElementById("rbReturnToBaseChk")?.addEventListener("change", () => {
  recalculateAdminBuilderMetrics();
});

document.getElementById("rbAddSearch")?.addEventListener("input", (e) => {
  const q = e.target.value.trim();
  const box = document.getElementById("rbSearchResults");
  if (!box) return;
  if (!q) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  const matchedOrders = allOrders
    .filter((o) => o.status !== "entregado" && o.status !== "cancelado")
    .filter((o) => matchesSmartSearch(`${o.folio || ""} ${o.customerName || ""} ${o.address || ""} ${o.phone || ""}`, q))
    .slice(0, 6)
    .map((o) => ({
      type: "order",
      id: o.id,
      title: `📦 ${o.customerName} (${o.totalBoxes} cj)`,
      sub: o.address || o.folio || ""
    }));

  const matchedPlaces = allPlaces
    .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
    .filter((p) => {
      const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.tienda;
      return matchesSmartSearch(`${p.name || ""} ${p.address || ""} ${p.phone || ""} ${cat.label || ""}`, q);
    })
    .slice(0, 10)
    .map((p) => {
      const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.tienda;
      return {
        type: "place",
        id: p.id,
        title: `${cat.emoji} ${p.name}`,
        sub: p.address || cat.label
      };
    });

  const combined = [...matchedOrders, ...matchedPlaces];
  box.style.display = "block";
  box.innerHTML = combined.length
    ? combined
        .map(
          (item) => `
          <div class="route-pick-result-item">
            <div style="min-width:0;flex:1;">
              <strong style="display:block;color:var(--green-950);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.title)}</strong>
              <span style="font-size:0.74rem;color:var(--slate-500);">${escapeHtml(item.sub)}</span>
            </div>
            <button type="button" class="btn btn-primary btn-sm" data-rb-pick-type="${item.type}" data-rb-pick-id="${escapeHtml(item.id)}" style="padding:6px 12px;font-size:0.78rem;font-weight:900;color:#ffffff;flex-shrink:0;">+ Sumar</button>
          </div>`
        )
        .join("")
    : `<div style="padding:10px;font-size:0.8rem;color:var(--slate-500);">Sin coincidencias.</div>`;
});

document.getElementById("rbSearchResults")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-rb-pick-id]");
  if (!btn) return;
  const type = btn.dataset.rbPickType;
  const id = btn.dataset.rbPickId;
  if (type === "order") window.__salinasAddOrderToRoute(id);
  else window.__salinasAddPlaceToRoute(id);
});

document.getElementById("rbBtnLoadAssigned")?.addEventListener("click", () => {
  const driverName = document.getElementById("rbDriverSelect")?.value || "";
  if (!driverName) return;
  const matching = allOrders.filter(
    (o) =>
      String(o.assignedDriver || "").toLowerCase() === driverName.toLowerCase() &&
      (o.status === "confirmado" || o.status === "en_ruta" || o.status === "nuevo")
  );
  if (matching.length === 0) {
    showToast(`${driverName} no tiene pedidos pendientes asignados.`);
    return;
  }
  let added = 0;
  for (const ord of matching) {
    const c = resolveOrderCoordsSync(ord);
    if (!c) continue;
    if (!rbStops.some((s) => s.id === ord.id && s.kind === "order")) {
      window.__salinasAddOrderToRoute(ord.id);
      added++;
    }
  }
  showToast(added > 0 ? `📦 ${added} pedido(s) cargado(s) a la ruta.` : "Los pedidos ya estaban en la ruta.");
});

document.getElementById("rbStopsList")?.addEventListener("click", (e) => {
  const moveBtn = e.target.closest("button[data-rb-move]");
  if (moveBtn) {
    const idx = Number(moveBtn.dataset.rbIdx);
    const delta = Number(moveBtn.dataset.rbMove);
    const next = idx + delta;
    if (next < 0 || next >= rbStops.length) return;
    const tmp = rbStops[idx];
    rbStops[idx] = rbStops[next];
    rbStops[next] = tmp;
    renderRouteBuilderUI();
    recalculateAdminBuilderMetrics();
    return;
  }
  const delBtn = e.target.closest("button[data-rb-del]");
  if (delBtn) {
    const idx = Number(delBtn.dataset.rbDel);
    rbStops.splice(idx, 1);
    renderRouteBuilderUI();
    recalculateAdminBuilderMetrics();
  }
});

document.getElementById("rbBtnOptimize")?.addEventListener("click", async () => {
  if (rbStops.length === 0) {
    showToast("Agrega al menos 1 parada para calcular la ruta.");
    return;
  }
  const btn = document.getElementById("rbBtnOptimize");
  btn.disabled = true;
  btn.textContent = "⏳ Calculando OSRM...";
  try {
    const driverName = document.getElementById("rbDriverSelect")?.value || "";
    const done = rbStops.filter((s) => s.status === "done");
    const pending = rbStops.filter((s) => s.status !== "done");
    const startCoord = getDriverCurrentOrBaseOrigin(driverName);
    const incBase = document.getElementById("rbReturnToBaseChk")?.checked !== false;
    const endCoord = incBase ? getStoreBaseLocation() : null;
    const res = await optimizeStopsWithOsrm({ startCoord, stops: pending, endCoord });
    rbStops = [...done, ...res.orderedStops];
    rbTotalDistM = res.distanceMeters;
    rbTotalDurSec = res.durationSec;
    rbPreviewLatLngs = res.latLngs || [];
    if (!showAllDriverRoutes) {
      showAllDriverRoutes = true;
      const allBtn = document.getElementById("btnToggleAllRoutes");
      if (allBtn) {
        allBtn.classList.add("btn-primary");
        allBtn.classList.remove("btn-outline");
      }
    }
    renderRouteBuilderUI();
    showToast(`⚡ Mejor ruta lista (${formatRouteKm(rbTotalDistM)} • ${formatRouteMin(rbTotalDurSec)}).`);
  } finally {
    btn.disabled = false;
    btn.textContent = "⚡ Calcular Mejor Ruta (OSRM)";
  }
});

async function saveAdminRouteToFirestore(isLastMinute = false, allowEmpty = false) {
  const driverName = document.getElementById("rbDriverSelect")?.value || "";
  if (!driverName) {
    showToast("Selecciona un chofer primero.");
    return;
  }
  if (rbStops.length === 0 && !allowEmpty) {
    showToast("Agrega al menos 1 parada antes de enviar.");
    return;
  }
  const docId = `${getLocalDateStr()}_${rbDriverSlug(driverName)}`;
  const incBase = document.getElementById("rbReturnToBaseChk")?.checked !== false;
  const payload = {
    driverName,
    driverSlug: rbDriverSlug(driverName),
    date: getLocalDateStr(),
    includeReturnToBase: incBase,
    baseLocation: getStoreBaseLocation(),
    stops: rbStops,
    totalDistanceMeters: rbTotalDistM,
    totalDurationSec: rbTotalDurSec,
    createdBy: "admin",
    lastMinuteAddedAtIso: isLastMinute ? new Date().toISOString() : null,
    updatedAtIso: new Date().toISOString()
  };

  await executeAdminBatch(currentKeyHash, (batch, proofId) => {
    batch.set(doc(db, "driver_routes", docId), { ...payload, proofId, updatedAt: serverTimestamp() }, { merge: true });
    // Asignar automáticamente los pedidos incluidos al chofer si aún no estaban asignados
    rbStops
      .filter((s) => s.kind === "order" && s.status !== "done")
      .forEach((s) => {
        const ord = allOrders.find((o) => o.id === s.id);
        if (ord && ord.assignedDriver !== driverName) {
          batch.update(doc(db, "orders", ord.id), {
            assignedDriver: driverName,
            status: ord.status === "nuevo" ? "confirmado" : ord.status,
            proofId,
            updatedAt: serverTimestamp()
          });
        }
      });
  });

  rbDraftByDriverMap.delete(rbDriverSlug(driverName));

  showToast(
    rbStops.length === 0
      ? `🗑️ Ruta de ${driverName} limpiada.`
      : `📤 Ruta enviada en vivo a ${driverName} (${rbStops.length} paradas).`
  );
}

document.getElementById("rbBtnSaveSend")?.addEventListener("click", () => saveAdminRouteToFirestore(false));

document.getElementById("rbBtnLastMinuteMenu")?.addEventListener("click", async () => {
  if (rbStops.length === 0) {
    showToast("Primero agrega la parada de último minuto a la lista.");
    return;
  }
  const btn = document.getElementById("rbBtnOptimize");
  btn?.click();
  setTimeout(() => saveAdminRouteToFirestore(true), 900);
});

document.getElementById("rbBtnTransferPending")?.addEventListener("click", async () => {
  const fromDriver = document.getElementById("rbDriverSelect")?.value || "";
  const pending = rbStops.filter((s) => s.status !== "done");
  if (!fromDriver || pending.length === 0) {
    showToast("No hay paradas pendientes en esta ruta para transferir.");
    return;
  }
  const drivers = (storeSettings.drivers || []).filter(
    (d) => d.name && d.name.toLowerCase() !== fromDriver.toLowerCase()
  );
  if (drivers.length === 0) {
    showToast("No hay otro chofer disponible.");
    return;
  }

  const modal = document.getElementById("transferRouteModal");
  const summaryEl = document.getElementById("transferRouteSummary");
  const targetSel = document.getElementById("transferTargetDriverSelect");
  const okBtn = document.getElementById("btnTransferRouteConfirm");
  const cancelBtn = document.getElementById("btnTransferRouteCancel");
  const closeBtn = document.getElementById("btnCloseTransferRouteModal");
  if (!modal || !targetSel || !okBtn) return;

  if (summaryEl) {
    summaryEl.textContent = `Se pasarán ${pending.length} parada${pending.length === 1 ? "" : "s"} pendiente${pending.length === 1 ? "" : "s"} de ${fromDriver} al chofer elegido (las completadas se conservan en ${fromDriver}).`;
  }
  targetSel.innerHTML = drivers.map((d) => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join("");

  const toDriver = await new Promise((resolve) => {
    const cleanup = (val) => {
      modal.classList.remove("open");
      okBtn.removeEventListener("click", onOk);
      cancelBtn?.removeEventListener("click", onCancel);
      closeBtn?.removeEventListener("click", onCancel);
      resolve(val);
    };
    const onOk = () => cleanup(targetSel.value || null);
    const onCancel = () => cleanup(null);
    okBtn.addEventListener("click", onOk);
    cancelBtn?.addEventListener("click", onCancel);
    closeBtn?.addEventListener("click", onCancel);
    modal.classList.add("open");
  });

  if (!toDriver) return;

  const today = getLocalDateStr();
  const fromDocId = `${today}_${rbDriverSlug(fromDriver)}`;
  const toDocId = `${today}_${rbDriverSlug(toDriver)}`;
  const doneFrom = rbStops.filter((s) => s.status === "done");
  const existingToDoc = allDriverRoutesTodayMap.get(toDocId);
  const existingToStops = Array.isArray(existingToDoc?.stops) ? existingToDoc.stops : [];
  const toDone = existingToStops.filter((s) => s.status === "done");
  const toPending = existingToStops.filter((s) => s.status !== "done");

  const mergedPending = [...toPending];
  for (const st of pending) {
    if (!mergedPending.some((x) => x.id === st.id && x.kind === st.kind)) {
      mergedPending.push({ ...st });
    }
  }

  const startCoord = getDriverCurrentOrBaseOrigin(toDriver);
  const incBase = existingToDoc ? existingToDoc.includeReturnToBase !== false : true;
  const endCoord = incBase ? getStoreBaseLocation() : null;
  const optRes = await optimizeStopsWithOsrm({ startCoord, stops: mergedPending, endCoord });
  const finalToStops = [...toDone, ...optRes.orderedStops];

  try {
    await executeAdminBatch(currentKeyHash, (batch, proofId) => {
      batch.set(
        doc(db, "driver_routes", fromDocId),
        {
          driverName: fromDriver,
          driverSlug: rbDriverSlug(fromDriver),
          date: today,
          stops: doneFrom,
          totalDistanceMeters: 0,
          totalDurationSec: 0,
          createdBy: "admin",
          updatedAtIso: new Date().toISOString(),
          proofId,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      batch.set(
        doc(db, "driver_routes", toDocId),
        {
          driverName: toDriver,
          driverSlug: rbDriverSlug(toDriver),
          date: today,
          includeReturnToBase: incBase,
          baseLocation: getStoreBaseLocation(),
          stops: finalToStops,
          totalDistanceMeters: optRes.distanceMeters,
          totalDurationSec: optRes.durationSec,
          createdBy: "admin",
          lastMinuteAddedAtIso: new Date().toISOString(),
          updatedAtIso: new Date().toISOString(),
          proofId,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      pending
        .filter((s) => s.kind === "order")
        .forEach((s) => {
          batch.update(doc(db, "orders", s.id), {
            assignedDriver: toDriver,
            proofId,
            updatedAt: serverTimestamp()
          });
        });
    });

    const driverSel = document.getElementById("rbDriverSelect");
    if (driverSel) {
      driverSel.value = toDriver;
      subscribeAdminBuilderToDriverRoute(toDriver);
    }
    showToast(`🔁 ${pending.length} parada(s) transferidas a ${toDriver} y optimizadas.`);
  } catch (err) {
    console.error("Error transfiriendo ruta:", err);
    showToast("No se pudo transferir la ruta.");
  }
});

document.getElementById("rbBtnClear")?.addEventListener("click", async () => {
  const driverName = document.getElementById("rbDriverSelect")?.value || "";
  if (rbStops.length > 0) {
    const ok = await showConfirmDialog({
      title: `¿Limpiar la ruta de ${driverName || "este chofer"}?`,
      message: `Se quitarán las ${rbStops.length} parada${rbStops.length === 1 ? "" : "s"} tanto de aquí como del celular del chofer.`,
      confirmText: "Sí, limpiar"
    });
    if (!ok) return;
  }
  rbStops = [];
  rbPreviewLatLngs = [];
  rbTotalDistM = 0;
  rbTotalDurSec = 0;
  if (driverName) rbDraftByDriverMap.delete(rbDriverSlug(driverName));
  renderRouteBuilderUI();
  if (driverName) {
    await saveAdminRouteToFirestore(false, true);
  }
});

// ================= BRIDGE PARA PROSPECTOS DENUE Y CUADRANTES KML =================
window.__salinasMapBridge = {
  getMap() {
    ensureLeafletMap();
    return leafletMap;
  },
  getAllPlaces() {
    return allPlaces || [];
  },
  getRouteSales() {
    return (historicalSales30d && historicalSales30d.length ? historicalSales30d : routeSalesList) || [];
  },
  getBaseLocation() {
    return getStoreBaseLocation();
  },
  getSelectedDriver() {
    return document.getElementById("rbDriverSelect")?.value || "";
  },
  getDriversList() {
    return (storeSettings.drivers || []).map((d) => d.name).filter(Boolean);
  },
  getDriversRouteSummary() {
    const activeSel = document.getElementById("rbDriverSelect")?.value || "";
    const activeSlug = rbDriverSlug(activeSel);
    return (storeSettings.drivers || [])
      .map((d) => d?.name)
      .filter(Boolean)
      .map((name) => {
        const slug = rbDriverSlug(name);
        const docId = `${getLocalDateStr()}_${slug}`;
        const sentDoc =
          allDriverRoutesTodayMap.get(docId) ||
          Array.from(allDriverRoutesTodayMap.values()).find(
            (r) => (r.driverSlug || rbDriverSlug(r.driverName || "")) === slug
          );
        const localDraft = rbDraftByDriverMap.get(slug);

        let stops = [];
        let state = "empty";
        if (slug === activeSlug && rbStops.length > 0) {
          stops = rbStops;
          state = localDraft?.dirty ? "draft" : sentDoc?.stops?.length ? "sent" : "draft";
        } else if (localDraft?.dirty && Array.isArray(localDraft.stops) && localDraft.stops.length > 0) {
          stops = localDraft.stops;
          state = "draft";
        } else if (Array.isArray(sentDoc?.stops) && sentDoc.stops.length > 0) {
          stops = sentDoc.stops;
          state = "sent";
        }
        const pendingCount = stops.filter((s) => s.status !== "done").length;
        return {
          name,
          slug,
          totalCount: stops.length,
          pendingCount,
          state
        };
      });
  },
  selectDriverForBuilder(driverName) {
    const sel = document.getElementById("rbDriverSelect");
    if (!sel || !driverName) return;
    if (sel.value !== driverName) {
      sel.value = driverName;
      subscribeAdminBuilderToDriverRoute(driverName);
    }
  },
  getDraftStops() {
    return rbStops || [];
  },
  getSentRoutesToday() {
    return Array.from(allDriverRoutesTodayMap.values());
  },
  addStopToRoute(stopObj, mode = "append") {
    const res = addStopToAdminBuilder(stopObj, mode);
    markCurrentDriverDraftDirty();
    return res;
  },
  addStopsBulkToRoute(stopObjs, replacePending = false) {
    if (!Array.isArray(stopObjs) || !stopObjs.length) return 0;
    if (replacePending) {
      rbStops = rbStops.filter((s) => s.status === "done");
    }
    const existingKeys = new Set(rbStops.map((s) => `${s.kind}:${s.id}`));
    let added = 0;
    for (const st of stopObjs) {
      if (!st || !Number.isFinite(st.lat) || !Number.isFinite(st.lng)) continue;
      const key = `${st.kind}:${st.id}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      rbStops.push(st);
      added++;
    }
    if (added > 0) {
      markCurrentDriverDraftDirty();
      renderRouteBuilderUI();
      recalculateAdminBuilderMetrics();
      const det = document.getElementById("adminRouteBuilderDetails");
      if (det) det.open = true;
    }
    return added;
  },
  async appendStopsToDriver(driverName, newStops, options = {}) {
    if (!driverName || !Array.isArray(newStops) || !newStops.length) {
      return { addedCount: 0, previousCount: 0, totalCount: 0 };
    }
    const sel = document.getElementById("rbDriverSelect");
    const currentSel = sel?.value || "";
    const targetSlug = rbDriverSlug(driverName);
    const docId = `${getLocalDateStr()}_${targetSlug}`;

    // Si estamos parados en otro chofer con cambios locales, preservarlos antes de cambiar
    if (currentSel && rbDriverSlug(currentSel) !== targetSlug && rbStops.length > 0) {
      markCurrentDriverDraftDirty();
    }

    // Obtener las paradas que ya tiene este chofer hoy (en constructor, en borrador o ya enviadas)
    let baseStops = [];
    if (rbDriverSlug(currentSel) === targetSlug && rbStops.length > 0) {
      baseStops = structuredClone(rbStops);
    } else if (rbDraftByDriverMap.get(targetSlug)?.dirty) {
      baseStops = structuredClone(rbDraftByDriverMap.get(targetSlug).stops || []);
    } else {
      const cachedSent =
        allDriverRoutesTodayMap.get(docId) ||
        Array.from(allDriverRoutesTodayMap.values()).find(
          (r) => (r.driverSlug || rbDriverSlug(r.driverName || "")) === targetSlug
        );
      if (Array.isArray(cachedSent?.stops)) {
        baseStops = structuredClone(cachedSent.stops);
      } else {
        try {
          const snap = await getDoc(doc(db, "driver_routes", docId));
          if (snap.exists() && Array.isArray(snap.data().stops)) {
            baseStops = structuredClone(snap.data().stops);
          }
        } catch (_) {}
      }
    }

    const previousCount = baseStops.length;
    const existingKeys = new Set(baseStops.map((s) => `${s.kind}:${s.id}`));
    let addedCount = 0;

    for (const st of newStops) {
      if (!st || !Number.isFinite(st.lat) || !Number.isFinite(st.lng)) continue;
      const key = `${st.kind}:${st.id}`;
      if (existingKeys.has(key)) continue;
      const nearDup = baseStops.some(
        (ex) => Number.isFinite(ex.lat) && Number.isFinite(ex.lng) && haversineMeters(ex.lat, ex.lng, st.lat, st.lng) < 20
      );
      if (nearDup) continue;
      existingKeys.add(key);
      baseStops.push(structuredClone(st));
      addedCount++;
    }

    let finalStops = baseStops;
    let distM = 0;
    let durSec = 0;
    let latLngs = [];

    const doneStops = baseStops.filter((s) => s.status === "done");
    const pendingStops = baseStops.filter((s) => s.status !== "done");
    const incBase = document.getElementById("rbReturnToBaseChk")?.checked !== false;
    const endCoord = incBase ? getStoreBaseLocation() : null;
    const startCoord = getDriverCurrentOrBaseOrigin(driverName);

    if (options.optimize !== false && pendingStops.length >= 2) {
      try {
        const res = await optimizeStopsWithOsrm({ startCoord, stops: pendingStops, endCoord });
        finalStops = [...doneStops, ...(res.orderedStops || pendingStops)];
        distM = res.distanceMeters || 0;
        durSec = res.durationSec || 0;
        latLngs = res.latLngs || [];
      } catch (_) {
        finalStops = [...doneStops, ...pendingStops];
      }
    }

    rbDraftByDriverMap.set(targetSlug, {
      driverName,
      stops: structuredClone(finalStops),
      distM,
      durSec,
      latLngs,
      dirty: true
    });

    rbStops = finalStops;
    rbTotalDistM = distM;
    rbTotalDurSec = durSec;
    rbPreviewLatLngs = latLngs;

    if (sel && sel.value !== driverName) {
      sel.value = driverName;
    }
    subscribeAdminBuilderToDriverRoute(driverName);
    renderRouteBuilderUI();
    if (!distM && finalStops.length > 0) {
      recalculateAdminBuilderMetrics();
    }
    const det = document.getElementById("adminRouteBuilderDetails");
    if (det) det.open = true;

    if (options.sendNow) {
      await saveAdminRouteToFirestore(previousCount > 0);
    }

    return {
      addedCount,
      previousCount,
      totalCount: finalStops.length,
      driverName,
      sent: Boolean(options.sendNow)
    };
  },
  async promoteProspectToPlace(item) {
    if (!currentKeyHash) {
      showToast("Inicia sesión en Administración primero.");
      return null;
    }
    const newId = `plc_denue_${item.id || Date.now()}`;
    const catMap = {
      fruteria: "fruteria",
      carniceria: "carniceria",
      restaurante: "restaurante",
      tienda: "tienda",
      comedor: "restaurante"
    };
    const category = catMap[item.c] || "tienda";
    await executeAdminBatch(currentKeyHash, (batch, proofId) => {
      batch.set(
        doc(db, "places", newId),
        {
          name: item.n,
          category,
          address: item.dir || item.col || "",
          phone: item.tel || "",
          lat: Number(item.lat),
          lng: Number(item.lng),
          source: "denue",
          denueId: item.id,
          active: true,
          createdAtIso: new Date().toISOString(),
          updatedAt: serverTimestamp(),
          proofId
        },
        { merge: true }
      );
    });
    showToast(`⭐ "${item.n}" guardado como Cliente Oficial.`);
    return newId;
  },
  async saveZonesConfig(zonesData) {
    if (!currentKeyHash) return;
    await executeAdminBatch(currentKeyHash, (batch, proofId) => {
      batch.set(
        doc(db, "settings", "zones"),
        {
          ...zonesData,
          updatedAtIso: new Date().toISOString(),
          updatedAt: serverTimestamp(),
          proofId
        },
        { merge: true }
      );
    });
  },
  async loadZonesConfig() {
    try {
      const snap = await getDoc(doc(db, "settings", "zones"));
      return snap.exists() ? snap.data() : null;
    } catch (_) {
      return null;
    }
  },
  showToast(msg) {
    showToast(msg);
  }
};
