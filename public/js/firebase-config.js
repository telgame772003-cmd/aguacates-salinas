import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import {
  initializeFirestore,
  doc as fbDoc,
  getDoc as fbGetDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  writeBatch,
  collection as fbCollection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import {
  TENANT_VAULT_CACHE_PREFIX,
  resolveInitialTenantSlug,
  switchActiveTenantSlug,
  getUnitConfig,
  getTenantModules,
  getTenantTerminology,
  getTenantBranding,
  getOrderedProducts,
  getProductCodes,
  formatDynamicUnits,
  applyTenantWhiteLabelToDOM,
  mountTenantSwitcherPill,
  INDUSTRY_TEMPLATES,
  SAAS_PLATFORM_BRAND
} from "./tenant-config.js";

export {
  resolveInitialTenantSlug,
  switchActiveTenantSlug,
  getUnitConfig,
  getTenantModules,
  getTenantTerminology,
  getTenantBranding,
  getOrderedProducts,
  getProductCodes,
  formatDynamicUnits,
  applyTenantWhiteLabelToDOM,
  mountTenantSwitcherPill,
  INDUSTRY_TEMPLATES,
  SAAS_PLATFORM_BRAND
};

export const firebaseConfig = {
  apiKey: "AIzaSyBGKOHbw7MB4TyhD8gP5Elfz9SjIouPflE",
  authDomain: "aguacates-salinas.firebaseapp.com",
  projectId: "aguacates-salinas",
  storageBucket: "aguacates-salinas.firebasestorage.app",
  messagingSenderId: "129226187583",
  appId: "1:129226187583:web:ebfea64c53670df642298a"
};

export const FUNCTIONS_BASE_URL = "https://us-central1-aguacates-salinas.cloudfunctions.net";

export const FCM_VAPID_KEY =
  "BAg6T0bFLmMxQp7oIto7bkbmhW6kCJ2KrY2DxLEN3_40-HYebwimUo2SXSqeOL9RCdL9bV_ygRBGp26FHwtt1Ag";

export const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true
});

// ================= MULTI-TENANT VAULT ROUTING =================
export const ACTIVE_TENANT_SLUG = resolveInitialTenantSlug();

const VAULT_STORAGE_KEY = `${TENANT_VAULT_CACHE_PREFIX}${ACTIVE_TENANT_SLUG}`;
let activeVaultId = "";
try {
  activeVaultId =
    sessionStorage.getItem(VAULT_STORAGE_KEY) ||
    localStorage.getItem(VAULT_STORAGE_KEY) ||
    "";
} catch (_) {}

if (typeof window !== "undefined") {
  window.__RPD_ACTIVE_TENANT = ACTIVE_TENANT_SLUG;
  window.__RPD_ACTIVE_VAULT = activeVaultId;
}

export function getActiveTenantSlug() {
  return ACTIVE_TENANT_SLUG;
}

export function getActiveVaultId() {
  return activeVaultId;
}

export function setActiveVaultId(vaultId, persistLocal = true) {
  const clean = String(vaultId || "").trim();
  if (!clean) return;
  activeVaultId = clean;
  if (typeof window !== "undefined") {
    window.__RPD_ACTIVE_VAULT = clean;
  }
  try {
    sessionStorage.setItem(VAULT_STORAGE_KEY, clean);
    if (persistLocal) localStorage.setItem(VAULT_STORAGE_KEY, clean);
  } catch (_) {}
}

export function clearActiveVaultId() {
  activeVaultId = "";
  if (typeof window !== "undefined") {
    window.__RPD_ACTIVE_VAULT = "";
  }
  try {
    sessionStorage.removeItem(VAULT_STORAGE_KEY);
    localStorage.removeItem(VAULT_STORAGE_KEY);
  } catch (_) {}
}

export function tenantScopedStorageKey(baseKey) {
  if (ACTIVE_TENANT_SLUG === "salinas") return baseKey;
  return `${baseKey}__${ACTIVE_TENANT_SLUG}`;
}

const VAULT_COLLECTIONS = new Set([
  "places",
  "place_visits",
  "route_sales",
  "orders",
  "warehouse_days",
  "thermos",
  "pallet_lots",
  "thermo_costs",
  "expenses",
  "driver_locations",
  "driver_routes",
  "driver_push_tokens"
]);

const TENANT_KEY_COLLECTIONS = new Set([
  "admin_keys",
  "driver_keys",
  "warehouse_keys",
  "superadmin_keys",
  "admin_proofs",
  "driver_proofs",
  "warehouse_proofs",
  "superadmin_proofs",
  "public_order_tracking"
]);

function resolveMultiTenantSegments(segments) {
  if (!segments || segments.length === 0) return segments;
  const first = segments[0];

  // Raw root paths already prefixed (saas_*, tenants, vaults, tenant_domains)
  if (
    first === "tenants" ||
    first === "vaults" ||
    first === "saas_config" ||
    first === "saas_master_keys" ||
    first === "saas_proofs" ||
    first === "saas_vault" ||
    first === "tenant_domains"
  ) {
    return segments;
  }

  // Auth key & proof collections live under tenants/{tenantSlug}/{col}/...
  if (TENANT_KEY_COLLECTIONS.has(first)) {
    return ["tenants", ACTIVE_TENANT_SLUG, ...segments];
  }

  // Settings routing:
  // - security_init / superadmin_init -> tenants/{tenantSlug}/meta/{docId}
  // - settings/store -> vaults/{vaultId}/settings/store when unlocked, else tenants/{tenantSlug}/public/storefront
  if (first === "settings") {
    const second = segments[1];
    if (second === "security_init" || second === "superadmin_init") {
      return ["tenants", ACTIVE_TENANT_SLUG, "meta", second, ...segments.slice(2)];
    }
    if (second === "public_storefront") {
      return ["tenants", ACTIVE_TENANT_SLUG, "public", "storefront"];
    }
    if (second === "store") {
      if (activeVaultId) {
        return ["vaults", activeVaultId, "settings", "store", ...segments.slice(2)];
      }
      return ["tenants", ACTIVE_TENANT_SLUG, "public", "storefront"];
    }
    if (activeVaultId) {
      return ["vaults", activeVaultId, ...segments];
    }
    return ["tenants", ACTIVE_TENANT_SLUG, ...segments];
  }

  // Operational collections live inside the tenant's cryptographic vault: vaults/{vaultId}/{col}/...
  if (VAULT_COLLECTIONS.has(first)) {
    const vId = activeVaultId || `__locked_${ACTIVE_TENANT_SLUG}`;
    return ["vaults", vId, ...segments];
  }

  return segments;
}

export function rawDoc(firestoreDb, ...segments) {
  return fbDoc(firestoreDb, ...segments);
}

export function rawCollection(firestoreDb, ...segments) {
  return fbCollection(firestoreDb, ...segments);
}

export function doc(firestoreDb, ...segments) {
  if (firestoreDb && firestoreDb.type === "collection") {
    return fbDoc(firestoreDb, ...segments);
  }
  const mapped = resolveMultiTenantSegments(segments);
  return fbDoc(firestoreDb, ...mapped);
}

export function collection(firestoreDb, ...segments) {
  const mapped = resolveMultiTenantSegments(segments);
  return fbCollection(firestoreDb, ...mapped);
}

export async function getDoc(docRef) {
  const snap = await fbGetDoc(docRef);
  try {
    const path = docRef?.path || "";
    if (
      snap.exists() &&
      /^tenants\/[^/]+\/(admin_keys|driver_keys|warehouse_keys|superadmin_keys)\//.test(path)
    ) {
      const d = snap.data();
      if (d && d.active === true && d.vaultId) {
        setActiveVaultId(d.vaultId, true);
      }
    }
  } catch (_) {}
  return snap;
}

/**
 * Construye la proyección pública segura (`tenants/{slug}/public/storefront`)
 * eliminando precios mínimos confidenciales, teléfonos privados de choferes y coordenadas de bodega.
 */
export function buildSanitizedPublicStorefront(fullSettings = {}, extraPublic = {}) {
  const sanitizedCalibers = {};
  for (const [code, cal] of Object.entries(fullSettings.calibers || {})) {
    if (!cal || typeof cal !== "object") continue;
    sanitizedCalibers[code] = {
      code: cal.code || code,
      name: cal.name || code,
      subtitle: cal.subtitle || "",
      description: cal.description || "",
      badge: cal.badge || "",
      price: Number(cal.price) || 0,
      pricePerKg: Number(cal.pricePerKg) || Math.round(((Number(cal.price) || 0) / 10) * 100) / 100,
      available: cal.available !== false,
      archived: Boolean(cal.archived),
      order: Number(cal.order) || 99
    };
  }

  const sanitizedDrivers = Array.isArray(fullSettings.drivers)
    ? fullSettings.drivers.map((d) => ({
        id: d.id || "",
        name: d.name || "",
        hasPin: Boolean(d.hasPin)
      }))
    : [];

  const sanitizedWhStaff = Array.isArray(fullSettings.warehouseStaff)
    ? fullSettings.warehouseStaff.map((w) => ({
        id: w.id || "",
        name: w.name || ""
      }))
    : [];

  return {
    tenantSlug: ACTIVE_TENANT_SLUG,
    tenantStatus: fullSettings.tenantStatus || extraPublic.tenantStatus || "active",
    storeOpen: fullSettings.storeOpen !== false,
    bannerMessage: fullSettings.bannerMessage || "",
    whatsappPrimary: fullSettings.whatsappPrimary || "",
    whatsappSecondary: fullSettings.whatsappSecondary || "",
    phoneDisplayPrimary: fullSettings.phoneDisplayPrimary || "",
    phoneDisplaySecondary: fullSettings.phoneDisplaySecondary || "",
    scheduleText: fullSettings.scheduleText || "",
    branding: fullSettings.branding || extraPublic.branding || getTenantBranding(fullSettings, ACTIVE_TENANT_SLUG),
    unitConfig: fullSettings.unitConfig || extraPublic.unitConfig || getUnitConfig(fullSettings),
    terminology: fullSettings.terminology || extraPublic.terminology || getTenantTerminology(fullSettings),
    modules: fullSettings.modules || extraPublic.modules || getTenantModules(fullSettings),
    plan: fullSettings.plan || extraPublic.plan || { tier: "pro", maxDrivers: 25 },
    calibers: sanitizedCalibers,
    drivers: sanitizedDrivers,
    warehouseStaff: sanitizedWhStaff,
    updatedAt: serverTimestamp()
  };
}

export {
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp
};

export const DEFAULT_STORE_SETTINGS = {
  tenantStatus: "active",
  storeOpen: true,
  bannerMessage: "Entregas el mismo día para pedidos realizados por la mañana.",
  whatsappPrimary: "524521715074",
  whatsappSecondary: "528446775276",
  phoneDisplayPrimary: "452 171 50 74",
  phoneDisplaySecondary: "844 677 52 76",
  scheduleText: "Lunes a Sábado • 7:00 AM a 5:00 PM",
  branding: {
    brandName: "Comercializadora Salinas",
    shortName: "Salinas",
    tagline: "Especialistas en Aguacate",
    logoUrl: "assets/logo-salinas.png",
    heroImageUrl: "assets/avocados-icon.png",
    faviconUrl: "assets/favicon.png",
    pinEmoji: "🥑",
    folioPrefix: "SAL",
    loyaltyQuote: "“La lealtad es escasa en estos tiempos y nosotros la valoramos. Gracias por tu lealtad.”",
    primaryColor: "#15803d",
    darkColor: "#132615",
    accentColor: "#eab308"
  },
  unitConfig: {
    unitSingular: "caja",
    unitPlural: "cajas",
    subUnit: "kg",
    subUnitsPerUnit: 10,
    allowSubUnit: true
  },
  terminology: {
    batchSingular: "Termo",
    batchPlural: "Termos",
    storageArea: "Cuartos Fríos",
    productGroupLabel: "Calibres"
  },
  modules: {
    coldRooms: true,
    ripeness: true,
    onlineStore: true,
    fractionalSales: true,
    nav3d: true
  },
  plan: {
    tier: "enterprise",
    maxDrivers: 50
  },
  baseLocation: {
    name: "Base / Bodega Salinas",
    address: "Correo Marítimo 2661, Postal Cerritos 2da, Saltillo",
    lat: 25.407054,
    lng: -100.954645
  },
  drivers: [
    { id: "vendedor_1", name: "Vendedor 1", phone: "", hasPin: true },
    { id: "vendedor_2", name: "Vendedor 2", phone: "", hasPin: true }
  ],
  calibers: {
    S: {
      code: "S",
      name: "Super",
      subtitle: "Calibre Grande Selecto",
      description: "Piezas grandes de excelente presentación y pulpa cremosa. Ideal para carnicerías, fruterías selectas y exhibición.",
      badge: "Calidad Premium",
      price: 400,
      pricePerKg: 40,
      minPrice: 340,
      available: true,
      order: 1
    },
    E: {
      code: "E",
      name: "Extra",
      subtitle: "Calibre Mediano-Grande",
      description: "Tamaño uniforme de gran rendimiento en mesa y mostrador. Excelente balance entre presencia y costo por pieza.",
      badge: "Alto Rendimiento",
      price: 360,
      pricePerKg: 36,
      minPrice: 310,
      available: true,
      order: 2
    },
    P: {
      code: "P",
      name: "Primera",
      subtitle: "Calibre Comercial Estándar",
      description: "El favorito de abarrotes, cocinas económicas y restaurantes por su rotación diaria y tamaño versátil.",
      badge: "Más Pedido",
      price: 320,
      pricePerKg: 32,
      minPrice: 280,
      available: true,
      order: 3
    },
    M: {
      code: "M",
      name: "Media / Segunda",
      subtitle: "Calibre Práctico y Económico",
      description: "Misma frescura y sabor con el mejor precio por caja. Ideal para taquerías, guacamole, salsas y venta popular.",
      badge: "Especial Negocios",
      price: 250,
      pricePerKg: 25,
      minPrice: 210,
      available: true,
      order: 4
    }
  }
};

export async function sha256Hex(message) {
  const msgBuffer = new TextEncoder().encode(String(message));
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function computeDriverPinHash(driverName, pin) {
  const normalized = `${String(driverName || "").trim().toLowerCase()}::${String(pin || "").trim()}`;
  return sha256Hex(normalized);
}

export function generateProofId(prefix = "prf") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function generateVaultId(tenantSlug = "t") {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  const hex = Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `vlt_${tenantSlug.slice(0, 12)}_${hex}`;
}

async function ensureVaultUnlocked(roleKeyCol, keyHash, allowCreateNew = false) {
  if (activeVaultId && activeVaultId.startsWith("vlt_")) return activeVaultId;
  if (keyHash) {
    try {
      const snap = await getDoc(doc(db, roleKeyCol, keyHash));
      if (snap.exists() && snap.data()?.vaultId) {
        setActiveVaultId(snap.data().vaultId, true);
        return activeVaultId;
      }
    } catch (_) {}
  }
  if (allowCreateNew && !activeVaultId) {
    setActiveVaultId(generateVaultId(ACTIVE_TENANT_SLUG), true);
  }
  return activeVaultId;
}

function createTenantAwareBatchProxy(rawBatch) {
  return {
    set(docRef, data, options) {
      const p = docRef?.path || "";
      const enriched =
        p.startsWith("vaults/") && data && typeof data === "object" && !data.tenantSlug
          ? { ...data, tenantSlug: ACTIVE_TENANT_SLUG }
          : data;
      if (options !== undefined) {
        rawBatch.set(docRef, enriched, options);
      } else {
        rawBatch.set(docRef, enriched);
      }
      return this;
    },
    update(docRef, data, ...rest) {
      const p = docRef?.path || "";
      const enriched =
        p.startsWith("vaults/") && data && typeof data === "object" && !Array.isArray(data) && !data.tenantSlug
          ? { ...data, tenantSlug: ACTIVE_TENANT_SLUG }
          : data;
      rawBatch.update(docRef, enriched, ...rest);
      return this;
    },
    delete(docRef) {
      rawBatch.delete(docRef);
      return this;
    },
    commit() {
      return rawBatch.commit();
    }
  };
}

export async function executeAdminBatch(keyHash, buildBatchFn) {
  await ensureVaultUnlocked("admin_keys", keyHash, true);
  const rawBatch = writeBatch(db);
  const batch = createTenantAwareBatchProxy(rawBatch);
  const proofId = generateProofId("prf");
  rawBatch.set(doc(db, "admin_proofs", proofId), {
    keyHash,
    tenantSlug: ACTIVE_TENANT_SLUG,
    vaultId: activeVaultId,
    createdAt: serverTimestamp()
  });
  buildBatchFn(batch, proofId);
  await rawBatch.commit();
}

export async function executeDriverBatch(driverKeyHash, buildBatchFn) {
  await ensureVaultUnlocked("driver_keys", driverKeyHash, false);
  const rawBatch = writeBatch(db);
  const batch = createTenantAwareBatchProxy(rawBatch);
  const proofId = generateProofId("dprf");
  rawBatch.set(doc(db, "driver_proofs", proofId), {
    keyHash: driverKeyHash,
    tenantSlug: ACTIVE_TENANT_SLUG,
    vaultId: activeVaultId,
    createdAt: serverTimestamp()
  });
  buildBatchFn(batch, proofId);
  await rawBatch.commit();
}

export async function computeWarehousePinHash(staffName, pin) {
  const normalized = `${String(staffName || "").trim().toLowerCase()}::${String(pin || "").trim()}`;
  return sha256Hex(normalized);
}

export async function executeWarehouseBatch(warehouseKeyHash, buildBatchFn) {
  await ensureVaultUnlocked("warehouse_keys", warehouseKeyHash, false);
  const rawBatch = writeBatch(db);
  const batch = createTenantAwareBatchProxy(rawBatch);
  const proofId = generateProofId("wprf");
  rawBatch.set(doc(db, "warehouse_proofs", proofId), {
    keyHash: warehouseKeyHash,
    tenantSlug: ACTIVE_TENANT_SLUG,
    vaultId: activeVaultId,
    createdAt: serverTimestamp()
  });
  buildBatchFn(batch, proofId);
  await rawBatch.commit();
}

export async function executeSuperadminBatch(superadminKeyHash, buildBatchFn) {
  await ensureVaultUnlocked("superadmin_keys", superadminKeyHash, true);
  const rawBatch = writeBatch(db);
  const batch = createTenantAwareBatchProxy(rawBatch);
  const proofId = generateProofId("sprf");
  rawBatch.set(doc(db, "superadmin_proofs", proofId), {
    keyHash: superadminKeyHash,
    tenantSlug: ACTIVE_TENANT_SLUG,
    vaultId: activeVaultId,
    createdAt: serverTimestamp()
  });
  buildBatchFn(batch, proofId);
  await rawBatch.commit();
}

export const COLD_ROOMS = ["Cuarto 1", "Cuarto 2", "Cuarto 3", "Cuarto 4", "Emplayado / Quiebre", "Piso", "Área Selección"];

export function normalizeColdRoom(room) {
  const s = String(room || "").trim();
  if (!s) return "";
  return s.replace(/^C[aá]mara\s+/i, "Cuarto ");
}

export const LOT_GRADES = {
  PRO: { code: "PRO", name: "Proceso (Sin seleccionar)", short: "Proceso" },
  S: { code: "S", name: "Súper", short: "Súper" },
  E: { code: "E", name: "Extra", short: "Extra" },
  P: { code: "P", name: "Primera", short: "Primera" },
  M: { code: "M", name: "Mediano / Segunda", short: "Mediano" },
  C: { code: "C", name: "Comercial / Cuarta", short: "Comercial" }
};

export const LOT_QUALITIES = ["Limpio", "Semilimpio", "Proceso"];
export const LOT_RIPENESS = ["Verde", "Pintón", "Maduro"];

export function getLocalDateStr(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function normalizeSearchText(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesSmartSearch(haystack, rawQuery) {
  const qNorm = normalizeSearchText(rawQuery);
  if (!qNorm) return true;
  const hayNorm = normalizeSearchText(haystack);
  const tokens = qNorm.split(" ").filter(Boolean);
  return tokens.every((tok) => hayNorm.includes(tok));
}

export function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(num);
}

export function cleanPhoneForWhatsApp(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return "52" + digits;
  if (digits.length === 12 && digits.startsWith("52")) return digits;
  if (digits.length === 13 && digits.startsWith("521")) return "52" + digits.slice(3);
  return digits;
}

export const PLACE_CATEGORIES = {
  tienda: { id: "tienda", label: "Tienda / Abarrotes", emoji: "🏪" },
  carniceria: { id: "carniceria", label: "Carnicería", emoji: "🥩" },
  restaurante: { id: "restaurante", label: "Restaurante / Taquería", emoji: "🍽️" },
  fruteria: { id: "fruteria", label: "Frutería / Verdulería", emoji: "🥑" },
  otro: { id: "otro", label: "Otro Giro", emoji: "🏢" }
};

export function haversineMeters(lat1, lng1, lat2, lng2) {
  if (
    typeof lat1 !== "number" || typeof lng1 !== "number" ||
    typeof lat2 !== "number" || typeof lng2 !== "number"
  ) {
    return null;
  }
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export function parseCoordsFromInput(raw) {
  const txt = String(raw || "").trim();
  if (!txt) return null;

  const m3d = txt.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m3d) {
    return { lat: parseFloat(m3d[1]), lng: parseFloat(m3d[2]) };
  }

  const pair = txt.match(/(-?\d{1,2}\.\d{3,})\s*[,\s]\s*(-?\d{2,3}\.\d{3,})/);
  if (pair) {
    const lat = parseFloat(pair[1]);
    const lng = parseFloat(pair[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}
