/**
 * Post-sincronización exclusiva de iOS para Salinas Reparto (com.salinas.reparto)
 * Prepara el proyecto Xcode para subir limpio a Apple App Store Connect / TestFlight:
 * 1. Elimina `server.url` del `capacitor.config.json` interno de iOS (cumplimiento Apple Guideline 4.2).
 * 2. Inyecta permisos bilingües de ubicación continua y `UIBackgroundModes: ["location"]` en `Info.plist`,
 *    además de `ITSAppUsesNonExemptEncryption: false` para activación automática en TestFlight.
 * 3. Normaliza rutas POSIX (`/`) en `CapApp-SPM/Package.swift` al generar desde Windows.
 */
const fs = require("fs");
const path = require("path");

const IOS_APP_DIR = path.join(__dirname, "ios", "App", "App");
const IOS_CAP_CONFIG = path.join(IOS_APP_DIR, "capacitor.config.json");
const IOS_INFO_PLIST = path.join(IOS_APP_DIR, "Info.plist");
const SPM_PACKAGE = path.join(__dirname, "ios", "App", "CapApp-SPM", "Package.swift");

if (!fs.existsSync(IOS_CAP_CONFIG)) {
  console.error("[ios-postsync] No existe ios/App/App/capacitor.config.json. Ejecuta npx cap add ios / sync ios primero.");
  process.exit(1);
}

// 1. Limpiar server.url solo en iOS para servir assets empaquetados desde capacitor://localhost
const cfg = JSON.parse(fs.readFileSync(IOS_CAP_CONFIG, "utf8"));
if (cfg.server) {
  delete cfg.server.url;
  delete cfg.server.errorPath;
  delete cfg.server.cleartext;
}
fs.writeFileSync(IOS_CAP_CONFIG, JSON.stringify(cfg, null, "\t") + "\n", "utf8");
console.log("[ios-postsync] server.url eliminado en ios/App/App/capacitor.config.json (Guideline 4.2 OK).");

// 2. Configurar Info.plist con justificaciones claras para Apple Review / TestFlight
if (fs.existsSync(IOS_INFO_PLIST)) {
  let plist = fs.readFileSync(IOS_INFO_PLIST, "utf8");

  const ensurePlistEntry = (key, xmlValueBlock) => {
    const keyTag = `<key>${key}</key>`;
    if (plist.includes(keyTag)) return;
    plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, `\t${keyTag}\n\t${xmlValueBlock}\n</dict>\n</plist>\n`);
  };

  // Asegurar nombre visible "Salinas Reparto"
  plist = plist.replace(
    /<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
    "<key>CFBundleDisplayName</key>\n\t<string>Salinas Reparto</string>"
  );

  ensurePlistEntry("ITSAppUsesNonExemptEncryption", "<false/>");
  ensurePlistEntry(
    "NSLocationWhenInUseUsageDescription",
    "<string>Salinas Reparto utiliza tu ubicación GPS para guiarte con navegación 3D Turn-by-Turn hacia tus clientes y pedidos asignados, y calcular la distancia a cada negocio. / Salinas Reparto uses your GPS location for 3D Turn-by-Turn route navigation to assigned customers and store proximity verification.</string>"
  );
  ensurePlistEntry(
    "NSLocationAlwaysAndWhenInUseUsageDescription",
    "<string>Durante tu jornada activa de reparto, Salinas Reparto continúa actualizando la posición de tu unidad aun con la pantalla bloqueada para que el Despacho coordine entregas en tiempo real. El rastreo se detiene de inmediato al pausar el botón GPS o cerrar sesión. / During an active delivery shift, Salinas Reparto updates your delivery vehicle location while the screen is locked so Dispatch can coordinate live orders. Tracking stops immediately when pausing GPS or logging out.</string>"
  );
  ensurePlistEntry(
    "UIBackgroundModes",
    "<array>\n\t\t<string>location</string>\n\t</array>"
  );

  fs.writeFileSync(IOS_INFO_PLIST, plist, "utf8");
  console.log("[ios-postsync] Info.plist actualizado con UIBackgroundModes(location) y textos de privacidad Apple.");
}

// 3. Normalizar barras invertidas de Windows en Package.swift (SPM)
if (fs.existsSync(SPM_PACKAGE)) {
  const raw = fs.readFileSync(SPM_PACKAGE, "utf8");
  const fixed = raw.replace(/path:\s*"([^"]+)"/g, (_, p) => `path: "${p.replace(/\\/g, "/")}"`);
  if (fixed !== raw) {
    fs.writeFileSync(SPM_PACKAGE, fixed, "utf8");
    console.log("[ios-postsync] Package.swift normalizado a rutas POSIX (/).");
  }
}

console.log("[ios-postsync] Proyecto iOS (com.salinas.reparto) listo para Xcode / TestFlight.");
