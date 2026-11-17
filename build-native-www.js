/**
 * Empaquetador limpio para la App Nativa Chofer (Salinas Reparto - com.salinas.reparto)
 * Genera `www-native/` exclusivamente con los módulos de Chofer (sin exponer admin ni almacén),
 * estableciendo `chofer.html` como `index.html` nativo para iOS TestFlight y respaldo offline Android.
 */
const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "public");
const OUT_DIR = path.join(__dirname, "www-native");

if (fs.existsSync(OUT_DIR)) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUT_DIR, { recursive: true });

// 1. Copiar recursos visuales y hojas de estilo
for (const folder of ["assets", "css"]) {
  const src = path.join(PUBLIC_DIR, folder);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(OUT_DIR, folder), { recursive: true });
  }
}

// 2. Copiar únicamente los módulos JS requeridos por el Chofer
const jsOut = path.join(OUT_DIR, "js");
fs.mkdirSync(jsOut, { recursive: true });
for (const jsFile of ["firebase-config.js", "manuals-data.js", "driver.js", "native-bg-gps.js", "salinas-debug-logger.js", "route-optimizer.js"]) {
  const srcJs = path.join(PUBLIC_DIR, "js", jsFile);
  if (fs.existsSync(srcJs)) {
    fs.copyFileSync(srcJs, path.join(jsOut, jsFile));
  }
}

// 3. Empaquetar chofer.html como index.html raíz de la app nativa y chofer.html
const choferHtml = path.join(PUBLIC_DIR, "chofer.html");
fs.copyFileSync(choferHtml, path.join(OUT_DIR, "index.html"));
fs.copyFileSync(choferHtml, path.join(OUT_DIR, "chofer.html"));

// 4. Pantalla ligera de reconexión sin señal para zonas rurales / carretera
const offlineHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Salinas Reparto — Sin Señal</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #132615;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 24px;
      text-align: center;
    }
    .card {
      max-width: 340px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 20px;
      padding: 26px 20px;
    }
    button {
      margin-top: 16px;
      width: 100%;
      padding: 13px;
      border-radius: 999px;
      border: none;
      background: #22c55e;
      color: #052e16;
      font-weight: 800;
      font-size: 0.95rem;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:2.4rem;margin-bottom:8px;">🥑📡</div>
    <h2 style="margin:0 0 8px;font-size:1.2rem;">Reconectando a Ruta Salinas</h2>
    <p style="margin:0;font-size:0.86rem;color:#cbd5e1;line-height:1.5;">
      Verifica tus datos móviles para sincronizar tus pedidos, inventario y navegación 3D.
    </p>
    <button type="button" onclick="window.location.href='https://aguacates-salinas.web.app/chofer.html'">
      🔄 Reintentar Conexión
    </button>
  </div>
</body>
</html>`;
fs.writeFileSync(path.join(OUT_DIR, "offline.html"), offlineHtml, "utf8");

console.log("[build-native-www] OK -> www-native listo para Capacitor Android e iOS.");
