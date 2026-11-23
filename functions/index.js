const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const crypto = require("crypto");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

function sha256HexNode(str) {
  return crypto.createHash("sha256").update(String(str)).digest("hex");
}

function sanitizeSlug(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function driverSlug(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function getMonterreyNowParts() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Monterrey",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour)
  };
}

function buildPublicStorefrontProjection(tenantSlug, fullSettings = {}, overrides = {}) {
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
    tenantSlug,
    tenantStatus: overrides.tenantStatus || fullSettings.tenantStatus || "active",
    storeOpen: fullSettings.storeOpen !== false,
    bannerMessage: fullSettings.bannerMessage || "",
    whatsappPrimary: fullSettings.whatsappPrimary || "",
    whatsappSecondary: fullSettings.whatsappSecondary || "",
    phoneDisplayPrimary: fullSettings.phoneDisplayPrimary || "",
    phoneDisplaySecondary: fullSettings.phoneDisplaySecondary || "",
    scheduleText: fullSettings.scheduleText || "",
    branding: overrides.branding || fullSettings.branding || {},
    unitConfig: overrides.unitConfig || fullSettings.unitConfig || {
      unitSingular: "caja",
      unitPlural: "cajas",
      subUnit: "kg",
      subUnitsPerUnit: 10,
      allowSubUnit: true
    },
    terminology: overrides.terminology || fullSettings.terminology || {
      batchSingular: "Termo",
      batchPlural: "Termos",
      storageArea: "Cuartos Fríos",
      productGroupLabel: "Calibres"
    },
    modules: overrides.modules || fullSettings.modules || {
      coldRooms: true,
      ripeness: true,
      onlineStore: true,
      fractionalSales: true,
      nav3d: true
    },
    plan: overrides.plan || fullSettings.plan || { tier: "pro", maxDrivers: 25 },
    calibers: sanitizedCalibers,
    drivers: sanitizedDrivers,
    warehouseStaff: sanitizedWhStaff,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

async function isValidSaasMasterHash(keyHash) {
  const hash = String(keyHash || "").trim();
  if (!hash || hash.length < 32) return false;
  const snap = await db.doc(`saas_master_keys/${hash}`).get();
  return snap.exists && snap.data()?.active === true;
}

async function isValidTenantAdminHash(tenantSlug, keyHash) {
  const hash = String(keyHash || "").trim();
  if (!hash || hash.length < 16) return false;
  const [admSnap, saSnap, rootAdm, rootSa] = await Promise.all([
    db.doc(`tenants/${tenantSlug}/admin_keys/${hash}`).get(),
    db.doc(`tenants/${tenantSlug}/superadmin_keys/${hash}`).get(),
    tenantSlug === "salinas" ? db.doc(`admin_keys/${hash}`).get() : Promise.resolve({ exists: false }),
    tenantSlug === "salinas" ? db.doc(`superadmin_keys/${hash}`).get() : Promise.resolve({ exists: false })
  ]);
  return (
    (admSnap.exists && admSnap.data()?.active === true) ||
    (saSnap.exists && saSnap.data()?.active === true) ||
    (rootAdm.exists && rootAdm.data()?.active === true) ||
    (rootSa.exists && rootSa.data()?.active === true)
  );
}

// ============================================================================
// 1. PUBLIC ONLINE STORE CHECKOUT -> WRITES TO TENANT VAULT + PUBLIC TRACKER
// ============================================================================
exports.submitPublicOrder = onRequest({ cors: true, region: "us-central1" }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const { tenantSlug: rawSlug, orderPayload } = req.body || {};
    const tenantSlug = sanitizeSlug(rawSlug || "salinas") || "salinas";
    if (!orderPayload || typeof orderPayload !== "object") {
      res.status(400).json({ ok: false, error: "Pedido inválido" });
      return;
    }

    const customerName = String(orderPayload.customerName || "").trim();
    const phone = String(orderPayload.phone || "").trim();
    const address = String(orderPayload.address || "").trim();
    const totalBoxes = Number(orderPayload.totalBoxes) || 0;
    const totalAmount = Number(orderPayload.totalAmount) || 0;

    if (customerName.length < 2 || customerName.length > 140) {
      res.status(400).json({ ok: false, error: "Nombre de negocio inválido" });
      return;
    }
    if (phone.replace(/\D/g, "").length < 8 || phone.length > 25) {
      res.status(400).json({ ok: false, error: "Teléfono inválido" });
      return;
    }
    if (totalBoxes <= 0 || totalBoxes > 5000 || totalAmount < 0) {
      res.status(400).json({ ok: false, error: "Cantidad inválida" });
      return;
    }

    const [pubSnap, privSnap] = await Promise.all([
      db.doc(`tenants/${tenantSlug}/public/storefront`).get(),
      db.doc(`tenants_private/${tenantSlug}`).get()
    ]);

    if (!pubSnap.exists || !privSnap.exists || !privSnap.data()?.vaultId) {
      res.status(404).json({ ok: false, error: "Empresa no encontrada" });
      return;
    }

    const pubData = pubSnap.data();
    if (pubData.tenantStatus === "suspended") {
      res.status(403).json({ ok: false, error: "Recepción de pedidos en pausa temporal" });
      return;
    }
    if (pubData.modules?.onlineStore === false || pubData.storeOpen === false) {
      res.status(403).json({ ok: false, error: "La tienda en línea está cerrada en este momento" });
      return;
    }

    const vaultId = privSnap.data().vaultId;
    const orderRef = db.collection(`vaults/${vaultId}/orders`).doc();
    const orderId = orderRef.id;
    const nowIso = new Date().toISOString();
    const folio = String(orderPayload.folio || `${tenantSlug.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-5)}`);

    const cleanOrder = {
      folio,
      tenantSlug,
      customerName,
      phone,
      address,
      paymentMethod: String(orderPayload.paymentMethod || "Efectivo"),
      ripeness: String(orderPayload.ripeness || ""),
      deliveryWindow: String(orderPayload.deliveryWindow || "Lo antes posible"),
      notes: String(orderPayload.notes || "").slice(0, 400),
      items: Array.isArray(orderPayload.items) ? orderPayload.items : [],
      boxesByCaliber: orderPayload.boxesByCaliber && typeof orderPayload.boxesByCaliber === "object" ? orderPayload.boxesByCaliber : {},
      totalBoxes,
      totalAmount,
      ...(typeof orderPayload.lat === "number" && typeof orderPayload.lng === "number"
        ? { lat: orderPayload.lat, lng: orderPayload.lng }
        : {}),
      status: "nuevo",
      assignedDriver: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtIso: nowIso
    };

    const trackingDoc = {
      folio,
      status: "nuevo",
      totalBoxes,
      totalAmount,
      items: cleanOrder.items,
      deliveryWindow: cleanOrder.deliveryWindow,
      createdAtIso: nowIso,
      updatedAtIso: nowIso
    };

    const batch = db.batch();
    batch.set(orderRef, cleanOrder);
    batch.set(db.doc(`tenants/${tenantSlug}/public_order_tracking/${orderId}`), trackingDoc);
    await batch.commit();

    res.json({ ok: true, orderId, folio });
  } catch (err) {
    console.error("submitPublicOrder error:", err);
    res.status(500).json({ ok: false, error: "Error registrando pedido" });
  }
});

// ============================================================================
// 2. AUTOMATIC REALTIME SYNC: VAULT ORDERS & SETTINGS -> PUBLIC PROJECTIONS
// ============================================================================
exports.syncPublicOrderTracking = onDocumentWritten(
  { document: "vaults/{vaultId}/orders/{orderId}", region: "us-central1" },
  async (event) => {
    const after = event.data?.after;
    if (!after || !after.exists) return;
    const d = after.data();
    let tenantSlug = d.tenantSlug;
    if (!tenantSlug) {
      const vMeta = await db.doc(`vaults_meta/${event.params.vaultId}`).get();
      tenantSlug = vMeta.exists ? vMeta.data()?.tenantSlug : null;
    }
    if (!tenantSlug) return;
    await db.doc(`tenants/${tenantSlug}/public_order_tracking/${event.params.orderId}`).set(
      {
        folio: d.folio || "",
        status: d.status || "nuevo",
        totalBoxes: Number(d.totalBoxes) || 0,
        totalAmount: Number(d.totalAmount) || 0,
        items: Array.isArray(d.items) ? d.items : [],
        deliveryWindow: d.deliveryWindow || "",
        createdAtIso: d.createdAtIso || "",
        updatedAtIso: new Date().toISOString()
      },
      { merge: true }
    );
  }
);

exports.syncPublicStorefrontOnSettingsWrite = onDocumentWritten(
  { document: "vaults/{vaultId}/settings/store", region: "us-central1" },
  async (event) => {
    const after = event.data?.after;
    if (!after || !after.exists) return;
    const fullSettings = after.data();
    const vMeta = await db.doc(`vaults_meta/${event.params.vaultId}`).get();
    const tenantSlug = vMeta.exists ? vMeta.data()?.tenantSlug : fullSettings.tenantSlug;
    if (!tenantSlug) return;

    const curPubSnap = await db.doc(`tenants/${tenantSlug}/public/storefront`).get();
    const curPub = curPubSnap.exists ? curPubSnap.data() : {};
    const projected = buildPublicStorefrontProjection(tenantSlug, fullSettings, {
      tenantStatus: curPub.tenantStatus || "active",
      plan: curPub.plan || fullSettings.plan || { tier: "pro", maxDrivers: 25 },
      modules: curPub.modules || fullSettings.modules
    });
    await db.doc(`tenants/${tenantSlug}/public/storefront`).set(projected, { merge: true });
  }
);

// ============================================================================
// 3. IDEMPOTENT MIGRATION OF LEGACY ROOT SALINAS -> TENANT #1 ("salinas")
// ============================================================================
async function migrateSalinasRootToTenant() {
  let privSnap = await db.doc("tenants_private/salinas").get();
  let vaultId = privSnap.exists ? privSnap.data()?.vaultId : null;
  if (!vaultId) {
    vaultId = `vlt_salinas_${crypto.randomBytes(16).toString("hex")}`;
    await db.doc("tenants_private/salinas").set({
      tenantSlug: "salinas",
      vaultId,
      createdAtIso: new Date().toISOString()
    });
    await db.doc(`vaults_meta/${vaultId}`).set({
      tenantSlug: "salinas",
      createdAtIso: new Date().toISOString()
    });
  }

  const report = { vaultId, counts: {} };

  // Helper to copy a collection in chunks of 400
  async function copyCollectionDocs(srcColPath, dstColPath, transformFn = null) {
    const snap = await db.collection(srcColPath).get();
    report.counts[srcColPath] = snap.size;
    if (snap.empty) return [];
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      for (const d of docs.slice(i, i + 400)) {
        const raw = d.data();
        const finalData = transformFn ? transformFn(d.id, raw) : raw;
        batch.set(db.doc(`${dstColPath}/${d.id}`), finalData, { merge: true });
      }
      await batch.commit();
    }
    return docs;
  }

  // 1. Copy auth keys (attaching vaultId so existing sessions seamlessly unlock the vault!)
  for (const keyCol of ["admin_keys", "driver_keys", "warehouse_keys", "superadmin_keys"]) {
    await copyCollectionDocs(keyCol, `tenants/salinas/${keyCol}`, (_id, data) => ({
      ...data,
      vaultId,
      tenantSlug: "salinas"
    }));
  }

  // 2. Copy security_init & superadmin_init
  for (const initDocId of ["security_init", "superadmin_init"]) {
    const s = await db.doc(`settings/${initDocId}`).get();
    if (s.exists) {
      await db.doc(`tenants/salinas/meta/${initDocId}`).set(s.data(), { merge: true });
    }
  }

  // 3. Copy settings/store -> vaults/{vaultId}/settings/store & tenants/salinas/public/storefront
  const rootStoreSnap = await db.doc("settings/store").get();
  const rootStore = rootStoreSnap.exists ? rootStoreSnap.data() : {};
  const enrichedSalinasSettings = {
    ...rootStore,
    tenantSlug: "salinas",
    tenantStatus: "active",
    branding: rootStore.branding || {
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
    unitConfig: rootStore.unitConfig || {
      unitSingular: "caja",
      unitPlural: "cajas",
      subUnit: "kg",
      subUnitsPerUnit: 10,
      allowSubUnit: true
    },
    terminology: rootStore.terminology || {
      batchSingular: "Termo",
      batchPlural: "Termos",
      storageArea: "Cuartos Fríos",
      productGroupLabel: "Calibres"
    },
    modules: rootStore.modules || {
      coldRooms: true,
      ripeness: true,
      onlineStore: true,
      fractionalSales: true,
      nav3d: true
    },
    plan: rootStore.plan || { tier: "founder", maxDrivers: 50 }
  };

  await db.doc(`vaults/${vaultId}/settings/store`).set(enrichedSalinasSettings, { merge: true });
  const pubProj = buildPublicStorefrontProjection("salinas", enrichedSalinasSettings);
  await db.doc("tenants/salinas/public/storefront").set(pubProj, { merge: true });

  // 4. Copy all operational collections into vaults/{vaultId}/*
  const vaultCols = [
    "places",
    "place_visits",
    "route_sales",
    "warehouse_days",
    "thermos",
    "pallet_lots",
    "thermo_costs",
    "expenses",
    "driver_locations",
    "driver_routes",
    "driver_push_tokens"
  ];
  for (const colName of vaultCols) {
    await copyCollectionDocs(colName, `vaults/${vaultId}/${colName}`);
  }

  // 5. Copy orders + public_order_tracking
  const orderDocs = await copyCollectionDocs("orders", `vaults/${vaultId}/orders`, (_id, d) => ({
    ...d,
    tenantSlug: "salinas"
  }));
  for (let i = 0; i < orderDocs.length; i += 400) {
    const batch = db.batch();
    for (const od of orderDocs.slice(i, i + 400)) {
      const d = od.data();
      batch.set(
        db.doc(`tenants/salinas/public_order_tracking/${od.id}`),
        {
          folio: d.folio || "",
          status: d.status || "nuevo",
          totalBoxes: Number(d.totalBoxes) || 0,
          totalAmount: Number(d.totalAmount) || 0,
          items: Array.isArray(d.items) ? d.items : [],
          deliveryWindow: d.deliveryWindow || "",
          createdAtIso: d.createdAtIso || ""
        },
        { merge: true }
      );
    }
    await batch.commit();
  }

  // 6. Register Salinas in SaaS Master Registry & Domain Map
  await db.doc("saas_tenants_registry/salinas").set(
    {
      tenantSlug: "salinas",
      brandName: enrichedSalinasSettings.branding.brandName,
      shortName: enrichedSalinasSettings.branding.shortName,
      industry: "avocado",
      pinEmoji: "🥑",
      tenantStatus: "active",
      plan: enrichedSalinasSettings.plan,
      modules: enrichedSalinasSettings.modules,
      customDomain: "aguacates-salinas.web.app",
      vaultId,
      createdAtIso: "2026-01-01T00:00:00.000Z",
      migratedAtIso: new Date().toISOString()
    },
    { merge: true }
  );

  await db.doc("tenant_domains/aguacates-salinas.web.app").set({ tenantSlug: "salinas" }, { merge: true });
  await db.doc("tenant_domains/aguacates-salinas.firebaseapp.com").set({ tenantSlug: "salinas" }, { merge: true });

  return report;
}

// ============================================================================
// 4. RUTA PRO DISTRIBUTION — SAAS MASTER SUPERADMIN ENDPOINTS (/saas.html)
// ============================================================================
exports.saasBootstrapAndAuth = onRequest({ cors: true, region: "us-central1" }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const { action, saasKeyHash } = req.body || {};
    const platformSnap = await db.doc("saas_config/platform").get();
    const isInitialized = platformSnap.exists && platformSnap.data()?.initialized === true;

    if (action === "status") {
      // Ensure Salinas tenant is already bootstrapped idempotently
      const salPub = await db.doc("tenants/salinas/public/storefront").get();
      if (!salPub.exists) {
        await migrateSalinasRootToTenant();
      }
      res.json({ ok: true, initialized: isInitialized });
      return;
    }

    if (action === "init") {
      if (isInitialized) {
        res.status(403).json({ ok: false, error: "La consola SaaS ya fue inicializada." });
        return;
      }
      if (!saasKeyHash || String(saasKeyHash).length < 32) {
        res.status(400).json({ ok: false, error: "Hash inválido" });
        return;
      }
      await db.doc(`saas_master_keys/${saasKeyHash}`).set({
        active: true,
        role: "saas_founder",
        createdAtIso: new Date().toISOString()
      });
      await db.doc("saas_config/platform").set({
        initialized: true,
        platformName: "Ruta Pro Distribution",
        company: "Ruta Pro Technologies",
        createdAtIso: new Date().toISOString()
      });
      const migrationReport = await migrateSalinasRootToTenant();
      res.json({ ok: true, initialized: true, migrationReport });
      return;
    }

    if (action === "login") {
      if (!(await isValidSaasMasterHash(saasKeyHash))) {
        res.status(403).json({ ok: false, error: "Clave Maestra SaaS incorrecta." });
        return;
      }
      res.json({ ok: true });
      return;
    }

    if (action === "resync_salinas") {
      if (!(await isValidSaasMasterHash(saasKeyHash))) {
        res.status(403).json({ ok: false, error: "No autorizado" });
        return;
      }
      const migrationReport = await migrateSalinasRootToTenant();
      res.json({ ok: true, migrationReport });
      return;
    }

    res.status(400).json({ ok: false, error: "Acción desconocida" });
  } catch (err) {
    console.error("saasBootstrapAndAuth error:", err);
    res.status(500).json({ ok: false, error: err.message || "Error interno" });
  }
});

function getDateStrForTimezone(tz) {
  try {
    const cleanTz = String(tz || "America/Monterrey").trim() || "America/Monterrey";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: cleanTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch (_) {}
  return getMonterreyNowParts().dateStr;
}

async function computeSingleTenantTelemetry(t) {
  const vId = t.vaultId;
  const tz = t.timezone || t.plan?.timezone || "America/Monterrey";
  const localDateStr = getDateStrForTimezone(tz);
  let placesCount = Number(t.placesCount) || 0;
  let driversConfigured = Number(t.driversConfigured) || 0;
  let onlineTrucks = 0;
  let salesTodayCount = 0;
  let gmvToday = 0;

  if (vId) {
    const placesQuery = db.collection(`vaults/${vId}/places`);
    const placesCountPromise =
      typeof placesQuery.count === "function"
        ? placesQuery.count().get().then((s) => s.data().count)
        : placesQuery.select().get().then((s) => s.size);

    const [storeSnap, pCount, locsSnap, salesSnap] = await Promise.all([
      db.doc(`vaults/${vId}/settings/store`).get(),
      placesCountPromise,
      db.collection(`vaults/${vId}/driver_locations`).get(),
      db.collection(`vaults/${vId}/route_sales`).where("date", "==", localDateStr).get()
    ]);

    placesCount = Number(pCount) || 0;
    if (storeSnap.exists) {
      driversConfigured = Array.isArray(storeSnap.data()?.drivers) ? storeSnap.data().drivers.length : 0;
    }
    const nowMs = Date.now();
    locsSnap.docs.forEach((l) => {
      const ld = l.data();
      if (ld.active && ld.updatedAtIso && nowMs - Date.parse(ld.updatedAtIso) < 20 * 60 * 1000) {
        onlineTrucks++;
      }
    });
    salesSnap.docs.forEach((s) => {
      const sd = s.data();
      if (sd.status !== "cancelada") {
        salesTodayCount++;
        gmvToday += Number(sd.totalAmount) || 0;
      }
    });

    // Mantener contadores desnormalizados en saas_tenants_registry para lecturas O(1) a escala
    if (t.tenantSlug && (t.placesCount !== placesCount || t.driversConfigured !== driversConfigured)) {
      db.doc(`saas_tenants_registry/${t.tenantSlug}`)
        .set({ placesCount, driversConfigured }, { merge: true })
        .catch(() => {});
    }
  }

  return {
    placesCount,
    driversConfigured,
    onlineTrucks,
    salesTodayCount,
    gmvToday,
    localDateStr,
    liveLoaded: true
  };
}

exports.saasListTenants = onRequest({ cors: true, region: "us-central1" }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const { saasKeyHash, mode } = req.body || {};
    if (!(await isValidSaasMasterHash(saasKeyHash))) {
      res.status(403).json({ ok: false, error: "No autorizado" });
      return;
    }

    const { dateStr } = getMonterreyNowParts();
    const regSnap = await db.collection("saas_tenants_registry").get();
    const rawDocs = regSnap.docs.map((d) => ({ tenantSlug: d.id, ...d.data() }));

    // Escalabilidad: si hay > 30 tenants y se pide modo summary, responde O(1) al instante sin consultar miles de bóvedas
    const useFastSummary = mode === "summary" && rawDocs.length > 30;
    const tenants = [];

    if (useFastSummary) {
      for (const t of rawDocs) {
        tenants.push({
          ...t,
          telemetry: {
            placesCount: Number(t.placesCount) || 0,
            driversConfigured: Number(t.driversConfigured) || 1,
            onlineTrucks: 0,
            salesTodayCount: 0,
            gmvToday: 0,
            liveLoaded: false
          }
        });
      }
    } else {
      const CHUNK = 15;
      for (let i = 0; i < rawDocs.length; i += CHUNK) {
        const slice = rawDocs.slice(i, i + CHUNK);
        const computed = await Promise.all(
          slice.map(async (t) => ({
            ...t,
            telemetry: await computeSingleTenantTelemetry(t)
          }))
        );
        tenants.push(...computed);
      }
    }

    tenants.sort((a, b) => String(a.brandName || "").localeCompare(String(b.brandName || "")));
    res.json({ ok: true, dateStr, summaryOnly: useFastSummary, tenants });
  } catch (err) {
    console.error("saasListTenants error:", err);
    res.status(500).json({ ok: false, error: err.message || "Error listando tenants" });
  }
});

exports.saasGetTenantTelemetry = onRequest({ cors: true, region: "us-central1" }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const { saasKeyHash, tenantSlugs } = req.body || {};
    if (!(await isValidSaasMasterHash(saasKeyHash))) {
      res.status(403).json({ ok: false, error: "No autorizado" });
      return;
    }
    const slugs = (Array.isArray(tenantSlugs) ? tenantSlugs : [])
      .map((s) => sanitizeSlug(s))
      .filter(Boolean)
      .slice(0, 50);

    const telemetryBySlug = {};
    const snaps = await Promise.all(slugs.map((sl) => db.doc(`saas_tenants_registry/${sl}`).get()));
    const existing = snaps.filter((s) => s.exists).map((s) => ({ tenantSlug: s.id, ...s.data() }));

    const CHUNK = 15;
    for (let i = 0; i < existing.length; i += CHUNK) {
      const slice = existing.slice(i, i + CHUNK);
      await Promise.all(
        slice.map(async (t) => {
          telemetryBySlug[t.tenantSlug] = await computeSingleTenantTelemetry(t);
        })
      );
    }

    res.json({ ok: true, telemetryBySlug });
  } catch (err) {
    console.error("saasGetTenantTelemetry error:", err);
    res.status(500).json({ ok: false, error: err.message || "Error obteniendo telemetría" });
  }
});

exports.saasProvisionTenant = onRequest({ cors: true, region: "us-central1" }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const {
      saasKeyHash,
      tenantSlug: rawSlug,
      brandName,
      shortName,
      tagline,
      industry,
      pinEmoji,
      folioPrefix,
      primaryColor,
      darkColor,
      whatsappPrimary,
      phoneDisplayPrimary,
      baseName,
      baseAddress,
      baseLat,
      baseLng,
      unitConfig,
      terminology,
      modules,
      defaultProducts,
      planTier,
      maxDrivers,
      adminPassword,
      ownerPassword,
      monthlyFeeMxn,
      perDriverFeeMxn,
      annualFeeMxn,
      nextMonthlyDue,
      nextAnnualDue,
      countryCode,
      dialCode,
      currency,
      timezone,
      billingNotes
    } = req.body || {};

    if (!(await isValidSaasMasterHash(saasKeyHash))) {
      res.status(403).json({ ok: false, error: "No autorizado" });
      return;
    }

    const tenantSlug = sanitizeSlug(rawSlug);
    if (!tenantSlug || tenantSlug.length < 2) {
      res.status(400).json({ ok: false, error: "Slug de empresa inválido (mínimo 2 caracteres)." });
      return;
    }
    const reserved = new Set(["www", "app", "saas", "admin", "api", "root"]);
    if (reserved.has(tenantSlug)) {
      res.status(400).json({ ok: false, error: "Ese código de empresa está reservado." });
      return;
    }

    const existing = await db.doc(`tenants_private/${tenantSlug}`).get();
    if (existing.exists) {
      res.status(409).json({ ok: false, error: `Ya existe un tenant con el código "${tenantSlug}".` });
      return;
    }

    if (!adminPassword || String(adminPassword).length < 4) {
      res.status(400).json({ ok: false, error: "Define una clave inicial de Admin (mínimo 4 caracteres)." });
      return;
    }

    const vaultId = `vlt_${tenantSlug.slice(0, 12)}_${crypto.randomBytes(16).toString("hex")}`;
    const adminHash = sha256HexNode(String(adminPassword));
    const ownerHash = sha256HexNode(String(ownerPassword || adminPassword));
    const driver1Pin = "1234";
    const driver1Hash = sha256HexNode(`vendedor 1::${driver1Pin}`);
    const wh1Pin = "1234";
    const wh1Hash = sha256HexNode(`almacenista 1::${wh1Pin}`);

    const cleanBrand = String(brandName || tenantSlug.toUpperCase()).trim();
    const cleanShort = String(shortName || cleanBrand.split(" ")[0]).trim();
    const nowIso = new Date().toISOString();

    const fullSettings = {
      tenantSlug,
      tenantStatus: "active",
      storeOpen: true,
      bannerMessage: "Pedidos en línea con entrega directa a tu negocio.",
      whatsappPrimary: String(whatsappPrimary || "").replace(/\D/g, ""),
      whatsappSecondary: "",
      phoneDisplayPrimary: String(phoneDisplayPrimary || whatsappPrimary || ""),
      phoneDisplaySecondary: "",
      scheduleText: "Lunes a Sábado • 7:00 AM a 5:00 PM",
      branding: {
        brandName: cleanBrand,
        shortName: cleanShort,
        tagline: String(tagline || "Distribución Mayorista"),
        logoUrl: "",
        heroImageUrl: "",
        faviconUrl: "assets/favicon.png",
        pinEmoji: String(pinEmoji || "📦"),
        folioPrefix: String(folioPrefix || tenantSlug.slice(0, 3).toUpperCase()).toUpperCase(),
        loyaltyQuote: `Gracias por confiar en ${cleanBrand}.`,
        primaryColor: String(primaryColor || "#15803d"),
        darkColor: String(darkColor || "#132615"),
        accentColor: "#eab308"
      },
      unitConfig: unitConfig || {
        unitSingular: "caja",
        unitPlural: "cajas",
        subUnit: "kg",
        subUnitsPerUnit: 10,
        allowSubUnit: true
      },
      terminology: terminology || {
        batchSingular: "Lote",
        batchPlural: "Lotes",
        storageArea: "Almacén",
        productGroupLabel: "Productos"
      },
      modules: modules || {
        coldRooms: true,
        ripeness: true,
        onlineStore: true,
        fractionalSales: true,
        nav3d: true
      },
      plan: {
        tier: String(planTier || "pro"),
        maxDrivers: Math.max(1, Number(maxDrivers) || 10),
        monthlyFeeMxn: Number(monthlyFeeMxn) || 0,
        perDriverFeeMxn: Number(perDriverFeeMxn) || 0,
        annualFeeMxn: Number(annualFeeMxn) || 0,
        nextMonthlyDue: String(nextMonthlyDue || ""),
        nextAnnualDue: String(nextAnnualDue || ""),
        countryCode: String(countryCode || "MX").toUpperCase(),
        dialCode: String(dialCode || "52").replace(/\D/g, ""),
        currency: String(currency || "MXN").toUpperCase(),
        timezone: String(timezone || "America/Monterrey"),
        paymentHistory: []
      },
      baseLocation: {
        name: String(baseName || `Base ${cleanShort}`),
        address: String(baseAddress || ""),
        lat: Number.isFinite(Number(baseLat)) ? Number(baseLat) : 25.4267,
        lng: Number.isFinite(Number(baseLng)) ? Number(baseLng) : -100.9954
      },
      drivers: [{ id: "vendedor_1", name: "Vendedor 1", phone: "", hasPin: true }],
      warehouseStaff: [{ id: "alm_1", name: "Almacenista 1" }],
      calibers: defaultProducts || {}
    };

    const pubStorefront = buildPublicStorefrontProjection(tenantSlug, fullSettings);

    const batch = db.batch();
    batch.set(db.doc(`tenants_private/${tenantSlug}`), { tenantSlug, vaultId, createdAtIso: nowIso });
    batch.set(db.doc(`vaults_meta/${vaultId}`), { tenantSlug, createdAtIso: nowIso });
    batch.set(db.doc(`tenants/${tenantSlug}/meta/security_init`), { initialized: true, createdAtIso: nowIso });
    batch.set(db.doc(`tenants/${tenantSlug}/meta/superadmin_init`), { initialized: true, createdAtIso: nowIso });
    batch.set(db.doc(`tenants/${tenantSlug}/admin_keys/${adminHash}`), { active: true, vaultId, tenantSlug, createdAtIso: nowIso });
    batch.set(db.doc(`tenants/${tenantSlug}/superadmin_keys/${ownerHash}`), { active: true, vaultId, tenantSlug, createdAtIso: nowIso });
    batch.set(db.doc(`tenants/${tenantSlug}/driver_keys/${driver1Hash}`), { active: true, driverName: "Vendedor 1", vaultId, tenantSlug, createdAtIso: nowIso });
    batch.set(db.doc(`tenants/${tenantSlug}/warehouse_keys/${wh1Hash}`), { active: true, staffName: "Almacenista 1", vaultId, tenantSlug, createdAtIso: nowIso });
    batch.set(db.doc(`vaults/${vaultId}/settings/store`), fullSettings);
    batch.set(db.doc(`tenants/${tenantSlug}/public/storefront`), pubStorefront);
    batch.set(db.doc(`saas_tenants_registry/${tenantSlug}`), {
      tenantSlug,
      brandName: cleanBrand,
      shortName: cleanShort,
      industry: String(industry || "avocado"),
      pinEmoji: fullSettings.branding.pinEmoji,
      tenantStatus: "active",
      countryCode: fullSettings.plan.countryCode,
      dialCode: fullSettings.plan.dialCode,
      currency: fullSettings.plan.currency,
      timezone: fullSettings.plan.timezone,
      contactPhone: fullSettings.whatsappPrimary,
      driversConfigured: 1,
      placesCount: 0,
      plan: fullSettings.plan,
      modules: fullSettings.modules,
      billingNotes: String(billingNotes || ""),
      vaultId,
      createdAtIso: nowIso
    });
    await batch.commit();

    res.json({
      ok: true,
      tenantSlug,
      vaultId,
      defaultDriver: { name: "Vendedor 1", pin: driver1Pin },
      defaultWarehouse: { name: "Almacenista 1", pin: wh1Pin }
    });
  } catch (err) {
    console.error("saasProvisionTenant error:", err);
    res.status(500).json({ ok: false, error: err.message || "Error creando tenant" });
  }
});

exports.saasUpdateTenant = onRequest({ cors: true, region: "us-central1" }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const { saasKeyHash, tenantSlug: rawSlug, updates } = req.body || {};
    if (!(await isValidSaasMasterHash(saasKeyHash))) {
      res.status(403).json({ ok: false, error: "No autorizado" });
      return;
    }
    const tenantSlug = sanitizeSlug(rawSlug);
    const regRef = db.doc(`saas_tenants_registry/${tenantSlug}`);
    const regSnap = await regRef.get();
    if (!regSnap.exists) {
      res.status(404).json({ ok: false, error: "Tenant no encontrado" });
      return;
    }
    const regData = regSnap.data();
    const vaultId = regData.vaultId;
    const batch = db.batch();

    const regPatch = { updatedAtIso: new Date().toISOString() };
    const pubPatch = {};
    const vaultStorePatch = {};

    if (updates.tenantStatus === "active" || updates.tenantStatus === "suspended") {
      regPatch.tenantStatus = updates.tenantStatus;
      pubPatch.tenantStatus = updates.tenantStatus;
      vaultStorePatch.tenantStatus = updates.tenantStatus;
    }
    if (updates.modules && typeof updates.modules === "object") {
      regPatch.modules = updates.modules;
      pubPatch.modules = updates.modules;
      vaultStorePatch.modules = updates.modules;
    }
    if (updates.plan && typeof updates.plan === "object") {
      regPatch.plan = updates.plan;
      pubPatch.plan = updates.plan;
      vaultStorePatch.plan = updates.plan;
      if (updates.plan.countryCode) regPatch.countryCode = String(updates.plan.countryCode).toUpperCase();
      if (updates.plan.dialCode) regPatch.dialCode = String(updates.plan.dialCode).replace(/\D/g, "");
      if (updates.plan.currency) regPatch.currency = String(updates.plan.currency).toUpperCase();
      if (updates.plan.timezone) regPatch.timezone = String(updates.plan.timezone);
    }
    if (typeof updates.contactPhone === "string") {
      regPatch.contactPhone = updates.contactPhone.replace(/\D/g, "");
    }
    if (typeof updates.billingNotes === "string") {
      regPatch.billingNotes = updates.billingNotes;
    }
    if (typeof updates.newAdminPassword === "string" && updates.newAdminPassword.trim().length >= 4) {
      const newHash = sha256HexNode(updates.newAdminPassword.trim());
      batch.set(db.doc(`tenants/${tenantSlug}/admin_keys/${newHash}`), {
        active: true,
        vaultId,
        tenantSlug,
        createdAtIso: new Date().toISOString(),
        note: "Reset por SaaS Superadmin"
      });
    }

    batch.set(regRef, regPatch, { merge: true });
    if (Object.keys(pubPatch).length > 0) {
      batch.set(db.doc(`tenants/${tenantSlug}/public/storefront`), pubPatch, { merge: true });
    }
    if (vaultId && Object.keys(vaultStorePatch).length > 0) {
      batch.set(db.doc(`vaults/${vaultId}/settings/store`), vaultStorePatch, { merge: true });
    }

    await batch.commit();
    res.json({ ok: true });
  } catch (err) {
    console.error("saasUpdateTenant error:", err);
    res.status(500).json({ ok: false, error: err.message || "Error actualizando tenant" });
  }
});

// ============================================================================
// 5. LEGACY / MULTI-TENANT PUSH GPS PINGS
// ============================================================================
async function sendGpsPingPush(vaultId, slug, driverName, token) {
  await admin.messaging().send({
    token,
    data: {
      type: "gps_ping",
      title: "📍 Reportar ubicación",
      body: `Hola ${driverName || "chofer"}, toca aquí para enviar tu GPS a oficina.`
    },
    webpush: {
      headers: {
        Urgency: "high",
        TTL: "120"
      }
    }
  });
  const tokenPath = vaultId ? `vaults/${vaultId}/driver_push_tokens/${slug}` : `driver_push_tokens/${slug}`;
  await db.doc(tokenPath).set(
    {
      lastPingAtMs: Date.now(),
      lastPingAtIso: new Date().toISOString()
    },
    { merge: true }
  );
}

exports.pingDriverGps = onRequest({ cors: true, region: "us-central1" }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const { tenantSlug: rawSlug, driverName, driverId, adminKeyHash } = req.body || {};
    const tenantSlug = sanitizeSlug(rawSlug || "salinas") || "salinas";
    if (!(await isValidTenantAdminHash(tenantSlug, adminKeyHash))) {
      res.status(403).json({ ok: false, error: "No autorizado" });
      return;
    }

    const slug = driverId || driverSlug(driverName);
    if (!slug) {
      res.status(400).json({ ok: false, error: "Chofer requerido" });
      return;
    }

    const privSnap = await db.doc(`tenants_private/${tenantSlug}`).get();
    const vaultId = privSnap.exists ? privSnap.data()?.vaultId : null;
    const tokenSnap = vaultId
      ? await db.doc(`vaults/${vaultId}/driver_push_tokens/${slug}`).get()
      : await db.doc(`driver_push_tokens/${slug}`).get();

    if (!tokenSnap.exists || !tokenSnap.data()?.token) {
      res.status(404).json({ ok: false, reason: "no_token", error: "El chofer usa GPS nativo o no tiene token web push." });
      return;
    }

    const data = tokenSnap.data();
    const cooldownMs = 30 * 1000;
    const elapsed = Date.now() - (Number(data.lastPingAtMs) || 0);
    if (elapsed < cooldownMs) {
      const waitSec = Math.ceil((cooldownMs - elapsed) / 1000);
      res.status(429).json({ ok: false, reason: "cooldown", waitSec, error: `Espera ${waitSec}s.` });
      return;
    }

    await sendGpsPingPush(vaultId, slug, data.driverName || driverName, data.token);
    res.json({ ok: true, driverName: data.driverName || driverName });
  } catch (err) {
    console.error("pingDriverGps error:", err);
    res.status(500).json({ ok: false, error: err.message || "Error interno" });
  }
});

exports.scheduledGpsPing = onSchedule(
  { schedule: "every 15 minutes", timeZone: "America/Monterrey", region: "us-central1" },
  async () => {
    const { dateStr, hour } = getMonterreyNowParts();
    const regSnap = await db.collection("saas_tenants_registry").where("tenantStatus", "==", "active").get();
    for (const rDoc of regSnap.docs) {
      const vId = rDoc.data()?.vaultId;
      if (!vId) continue;
      const storeSnap = await db.doc(`vaults/${vId}/settings/store`).get();
      const store = storeSnap.exists ? storeSnap.data() : {};
      if (!store.gpsPingEnabled) continue;

      const intervalMin = Math.max(10, Number(store.gpsPingIntervalMin) || 15);
      const startHour = Number.isFinite(Number(store.gpsPingStartHour)) ? Number(store.gpsPingStartHour) : 8;
      const endHour = Number.isFinite(Number(store.gpsPingEndHour)) ? Number(store.gpsPingEndHour) : 19;
      if (hour < startHour || hour >= endHour) continue;

      const whSnap = await db.doc(`vaults/${vId}/warehouse_days/${dateStr}`).get();
      const trips = whSnap.exists && Array.isArray(whSnap.data()?.trips) ? whSnap.data().trips : [];
      const activeDriverNames = [...new Set(trips.map((t) => String(t.driver || "").trim()).filter(Boolean))];
      const nowMs = Date.now();
      const staleMs = intervalMin * 60 * 1000;

      for (const dName of activeDriverNames) {
        const slug = driverSlug(dName);
        if (!slug) continue;
        const [tokenSnap, locSnap] = await Promise.all([
          db.doc(`vaults/${vId}/driver_push_tokens/${slug}`).get(),
          db.doc(`vaults/${vId}/driver_locations/${slug}`).get()
        ]);
        if (!tokenSnap.exists || !tokenSnap.data()?.token) continue;
        const tData = tokenSnap.data();
        if (nowMs - (Number(tData.lastPingAtMs) || 0) < staleMs) continue;
        const locIso = locSnap.exists ? locSnap.data()?.updatedAtIso : null;
        const locMs = locIso ? Date.parse(locIso) : 0;
        if (locMs && nowMs - locMs < staleMs) continue;
        try {
          await sendGpsPingPush(vId, slug, dName, tData.token);
        } catch (_) {}
      }
    }
  }
);
