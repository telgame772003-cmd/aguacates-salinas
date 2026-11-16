/**
 * Compilador automatizado de APK instalable para Salinas Reparto (com.salinas.reparto)
 * Detecta automáticamente OpenJDK 21 de Android Studio y el Android SDK local en Windows.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ANDROID_DIR = path.join(__dirname, "android");
const JBR_PATH = "C:\\Program Files\\Android\\Android Studio\\jbr";
const SDK_PATH = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk");

if (!fs.existsSync(ANDROID_DIR)) {
  console.error("[build-apk] No existe la carpeta android/. Ejecuta primero npx cap add android.");
  process.exit(1);
}

// Escribir local.properties con ruta del SDK escapada para Gradle en Windows
if (fs.existsSync(SDK_PATH)) {
  const escapedSdk = SDK_PATH.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  fs.writeFileSync(path.join(ANDROID_DIR, "local.properties"), `sdk.dir=${escapedSdk}\n`, "utf8");
}

const env = { ...process.env };
if (fs.existsSync(JBR_PATH)) {
  env.JAVA_HOME = JBR_PATH;
  env.PATH = `${path.join(JBR_PATH, "bin")};${env.PATH || ""}`;
}
if (fs.existsSync(SDK_PATH)) {
  env.ANDROID_HOME = SDK_PATH;
  env.ANDROID_SDK_ROOT = SDK_PATH;
}

console.log("[build-apk] Compilando APK instalable con Gradle (assembleDebug)...");
execSync("gradlew.bat assembleDebug --no-daemon --max-workers=1", {
  cwd: ANDROID_DIR,
  env,
  stdio: "inherit"
});

const builtApk = path.join(ANDROID_DIR, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
if (!fs.existsSync(builtApk)) {
  console.error("[build-apk] No se encontró app-debug.apk tras la compilación.");
  process.exit(1);
}

const outRootApk = path.join(__dirname, "salinas-reparto.apk");
fs.copyFileSync(builtApk, outRootApk);
const sizeMb = (fs.statSync(outRootApk).size / (1024 * 1024)).toFixed(2);
console.log(`[build-apk] ✅ APK lista: ${outRootApk} (${sizeMb} MB)`);
