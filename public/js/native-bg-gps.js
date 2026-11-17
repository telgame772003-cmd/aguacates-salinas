/**
 * ============================================================================
 * SALINAS REPARTO — MOTOR NATIVO DE GEOLOCALIZACIÓN EN SEGUNDO PLANO 24/7
 * Archivo: public/js/native-bg-gps.js
 * Bundle ID: com.salinas.reparto (Android APK + iOS TestFlight)
 *
 * Garantiza que la ubicación del chofer en `driver_locations/{driverSlug}`
 * permanezca siempre activa en `admin.html` incluso con la pantalla apagada
 * o bloqueada mientras descarga cajas, deteniéndose al instante cuando el
 * chofer pausa su GPS o cierra sesión.
 * ============================================================================
 */

let activeWatcherId = null;
let lastNativeFix = null;
let keepAliveIntervalId = null;

export function isNativeCapacitorApp() {
  try {
    return Boolean(
      typeof window !== "undefined" &&
      window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === "function" &&
      window.Capacitor.isNativePlatform()
    );
  } catch (_) {
    return false;
  }
}

export function getNativePlatformName() {
  try {
    if (!isNativeCapacitorApp()) return "web";
    return typeof window.Capacitor.getPlatform === "function"
      ? window.Capacitor.getPlatform()
      : "native";
  } catch (_) {
    return "web";
  }
}

function getBackgroundGeoPlugin() {
  if (!isNativeCapacitorApp()) return null;
  const cap = window.Capacitor;
  if (cap.Plugins && cap.Plugins.BackgroundGeolocation) {
    return cap.Plugins.BackgroundGeolocation;
  }
  if (typeof cap.registerPlugin === "function") {
    return cap.registerPlugin("BackgroundGeolocation");
  }
  return null;
}

function getCapacitorHttpPlugin() {
  if (!isNativeCapacitorApp()) return null;
  const cap = window.Capacitor;
  if (cap.Plugins && cap.Plugins.CapacitorHttp) {
    return cap.Plugins.CapacitorHttp;
  }
  if (typeof cap.registerPlugin === "function") {
    return cap.registerPlugin("CapacitorHttp");
  }
  return null;
}

export async function startNativeBackgroundGps({ onLocation, onPermissionDenied }) {
  const bgGeo = getBackgroundGeoPlugin();
  if (!bgGeo) return false;

  if (activeWatcherId) {
    return true;
  }

  try {
    activeWatcherId = await bgGeo.addWatcher(
      {
        backgroundTitle: "🥑 Ruta Salinas en Curso",
        backgroundMessage: "Ubicación GPS activa para Despacho • Toca para abrir",
        requestPermissions: true,
        stale: false,
        distanceFilter: 8
      },
      (location, error) => {
        if (error) {
          if (error.code === "NOT_AUTHORIZED") {
            if (typeof onPermissionDenied === "function") {
              onPermissionDenied(() => {
                try {
                  bgGeo.openSettings();
                } catch (_) {}
              });
            }
          } else {
            console.warn("[SalinasBgGPS] Aviso sensor nativo:", error);
          }
          return;
        }

        if (!location || typeof location.latitude !== "number" || typeof location.longitude !== "number") {
          return;
        }

        const fix = {
          lat: Number(location.latitude.toFixed(6)),
          lng: Number(location.longitude.toFixed(6)),
          accuracy: typeof location.accuracy === "number" ? location.accuracy : 0,
          speedKmh: typeof location.speed === "number" && location.speed > 0 ? location.speed * 3.6 : 0,
          heading: typeof location.bearing === "number" && location.bearing >= 0 ? location.bearing : null,
          timestamp: location.time || Date.now()
        };

        lastNativeFix = fix;
        if (typeof onLocation === "function") {
          onLocation(fix, false);
        }
      }
    );

    // Latido estacionario cada 2 min para evitar que el chofer desaparezca de admin.html (umbral 20 min)
    // mientras descarga cajas con el vehículo estacionado y la pantalla bloqueada.
    if (keepAliveIntervalId) clearInterval(keepAliveIntervalId);
    keepAliveIntervalId = setInterval(() => {
      if (activeWatcherId && lastNativeFix && typeof onLocation === "function") {
        window.salinasLog?.("SalinasBgGPS", `Heartbeat 2m -> ${lastNativeFix.lat},${lastNativeFix.lng}`);
        onLocation({ ...lastNativeFix, speedKmh: 0, timestamp: Date.now() }, true);
      }
    }, 2 * 60 * 1000);

    window.salinasLog?.("SalinasBgGPS", `Watcher nativo iniciado id=${activeWatcherId}`);
    return true;
  } catch (err) {
    console.error("[SalinasBgGPS] Error iniciando BackgroundGeolocation:", err);
    activeWatcherId = null;
    return false;
  }
}

export async function stopNativeBackgroundGps() {
  if (keepAliveIntervalId) {
    clearInterval(keepAliveIntervalId);
    keepAliveIntervalId = null;
  }
  const watcherToStop = activeWatcherId;
  activeWatcherId = null;
  lastNativeFix = null;

  if (!watcherToStop) return;
  const bgGeo = getBackgroundGeoPlugin();
  if (!bgGeo) return;

  try {
    await bgGeo.removeWatcher({ id: watcherToStop });
  } catch (err) {
    console.warn("[SalinasBgGPS] Aviso al detener watcher nativo:", err);
  }
}

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === "string") return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

/**
 * Envía un lote atómico `driver_proofs` + documento destino (`driver_locations` o `place_visits`)
 * mediante el motor HTTP nativo de Capacitor o fetch keepalive,
 * evitando el estrangulamiento de red del WebView tras 5+ minutos con pantalla apagada.
 */
export async function commitDriverDocNativeRest({
  apiKey,
  projectId,
  driverKeyHash,
  collectionName,
  docId,
  payloadData,
  timestampField = "updatedAt"
}) {
  const proofId = `dprf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const dbRoot = `projects/${projectId}/databases/(default)/documents`;
  const proofDocName = `${dbRoot}/driver_proofs/${proofId}`;
  const targetDocName = `${dbRoot}/${collectionName}/${docId}`;

  const docFields = {};
  for (const [k, v] of Object.entries({ ...payloadData, proofId })) {
    if (v !== undefined) {
      docFields[k] = toFirestoreValue(v);
    }
  }

  const commitBody = {
    writes: [
      {
        update: {
          name: proofDocName,
          fields: {
            keyHash: { stringValue: driverKeyHash }
          }
        },
        currentDocument: { exists: false },
        updateTransforms: [
          { fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }
        ]
      },
      {
        update: {
          name: targetDocName,
          fields: docFields
        },
        updateTransforms: [
          { fieldPath: timestampField, setToServerValue: "REQUEST_TIME" }
        ]
      }
    ]
  };

  const endpoint = `https://firestore.googleapis.com/v1/${dbRoot}:commit?key=${encodeURIComponent(apiKey)}`;
  const capHttp = getCapacitorHttpPlugin();

  if (capHttp && typeof capHttp.post === "function") {
    const res = await capHttp.post({
      url: endpoint,
      headers: { "Content-Type": "application/json" },
      data: commitBody
    });
    if (!res || res.status < 200 || res.status >= 300) {
      window.salinasLog?.("SalinasBgGPS-ERR", `CapacitorHttp (${collectionName}) status=${res?.status}`);
      throw new Error(`Native HTTP Firestore commit status ${res?.status}`);
    }
    window.salinasLog?.("SalinasBgGPS-REST", `Commit nativo ${collectionName} OK`);
    return true;
  }

  const fetchRes = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(commitBody),
    keepalive: true
  });
  if (!fetchRes.ok) {
    window.salinasLog?.("SalinasBgGPS-ERR", `Fetch keepalive (${collectionName}) status=${fetchRes.status}`);
    throw new Error(`Keepalive REST commit HTTP ${fetchRes.status}`);
  }
  window.salinasLog?.("SalinasBgGPS-REST", `Commit keepalive ${collectionName} OK`);
  return true;
}

export async function commitDriverLocationNativeRest({
  apiKey,
  projectId,
  driverKeyHash,
  driverDocId,
  payloadData
}) {
  return commitDriverDocNativeRest({
    apiKey,
    projectId,
    driverKeyHash,
    collectionName: "driver_locations",
    docId: driverDocId,
    payloadData,
    timestampField: "updatedAt"
  });
}
