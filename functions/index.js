const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

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

async function isValidAdminHash(keyHash) {
  const hash = String(keyHash || "").trim();
  if (!hash || hash.length < 16) return false;
  const [admSnap, saSnap] = await Promise.all([
    db.doc(`admin_keys/${hash}`).get(),
    db.doc(`superadmin_keys/${hash}`).get()
  ]);
  return (admSnap.exists && admSnap.data()?.active === true) || (saSnap.exists && saSnap.data()?.active === true);
}

async function sendGpsPingPush(slug, driverName, token) {
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
  await db.doc(`driver_push_tokens/${slug}`).set(
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
    const { driverName, driverId, adminKeyHash } = req.body || {};
    if (!(await isValidAdminHash(adminKeyHash))) {
      res.status(403).json({ ok: false, error: "No autorizado" });
      return;
    }

    const slug = driverId || driverSlug(driverName);
    if (!slug) {
      res.status(400).json({ ok: false, error: "Chofer requerido" });
      return;
    }

    const tokenSnap = await db.doc(`driver_push_tokens/${slug}`).get();
    if (!tokenSnap.exists || !tokenSnap.data()?.token) {
      res.status(404).json({ ok: false, reason: "no_token", error: "El chofer aún no activa los avisos en su celular." });
      return;
    }

    const data = tokenSnap.data();
    const cooldownMs = 30 * 1000;
    const elapsed = Date.now() - (Number(data.lastPingAtMs) || 0);
    if (elapsed < cooldownMs) {
      const waitSec = Math.ceil((cooldownMs - elapsed) / 1000);
      res.status(429).json({ ok: false, reason: "cooldown", waitSec, error: `Espera ${waitSec}s antes de volver a pedir GPS.` });
      return;
    }

    await sendGpsPingPush(slug, data.driverName || driverName, data.token);
    res.json({ ok: true, driverName: data.driverName || driverName });
  } catch (err) {
    console.error("pingDriverGps error:", err);
    res.status(500).json({ ok: false, error: err.message || "Error interno" });
  }
});

exports.scheduledGpsPing = onSchedule(
  { schedule: "every 15 minutes", timeZone: "America/Monterrey", region: "us-central1" },
  async () => {
    const storeSnap = await db.doc("settings/store").get();
    const store = storeSnap.exists ? storeSnap.data() : {};
    if (!store.gpsPingEnabled) return;

    const intervalMin = Math.max(10, Number(store.gpsPingIntervalMin) || 15);
    const startHour = Number.isFinite(Number(store.gpsPingStartHour)) ? Number(store.gpsPingStartHour) : 8;
    const endHour = Number.isFinite(Number(store.gpsPingEndHour)) ? Number(store.gpsPingEndHour) : 19;

    const { dateStr, hour } = getMonterreyNowParts();
    if (hour < startHour || hour >= endHour) return;

    const whSnap = await db.doc(`warehouse_days/${dateStr}`).get();
    const trips = whSnap.exists && Array.isArray(whSnap.data()?.trips) ? whSnap.data().trips : [];
    const activeDriverNames = [...new Set(trips.map((t) => String(t.driver || "").trim()).filter(Boolean))];
    if (activeDriverNames.length === 0) return;

    const nowMs = Date.now();
    const staleMs = intervalMin * 60 * 1000;

    for (const dName of activeDriverNames) {
      const slug = driverSlug(dName);
      if (!slug) continue;
      const [tokenSnap, locSnap] = await Promise.all([
        db.doc(`driver_push_tokens/${slug}`).get(),
        db.doc(`driver_locations/${slug}`).get()
      ]);
      if (!tokenSnap.exists || !tokenSnap.data()?.token) continue;
      const tData = tokenSnap.data();
      if (nowMs - (Number(tData.lastPingAtMs) || 0) < staleMs) continue;

      const locIso = locSnap.exists ? locSnap.data()?.updatedAtIso : null;
      const locMs = locIso ? Date.parse(locIso) : 0;
      if (locMs && nowMs - locMs < staleMs) continue;

      try {
        await sendGpsPingPush(slug, dName, tData.token);
      } catch (err) {
        console.warn(`Error enviando Push a ${dName}:`, err.message);
      }
    }
  }
);
