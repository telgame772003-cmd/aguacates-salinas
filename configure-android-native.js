/**
 * Configura automáticamente permisos Android 12/13/14/15 de geolocalización 24/7 en segundo plano,
 * canal de notificación ForegroundService y solicitud de POST_NOTIFICATIONS en MainActivity
 * para Salinas Reparto (com.salinas.reparto).
 */
const fs = require("fs");
const path = require("path");

const MANIFEST_PATH = path.join(__dirname, "android", "app", "src", "main", "AndroidManifest.xml");
const STRINGS_PATH = path.join(__dirname, "android", "app", "src", "main", "res", "values", "strings.xml");
const MAIN_ACTIVITY_PATH = path.join(
  __dirname,
  "android",
  "app",
  "src",
  "main",
  "java",
  "com",
  "salinas",
  "reparto",
  "MainActivity.java"
);

// 1. Inyectar permisos requeridos en AndroidManifest.xml
if (fs.existsSync(MANIFEST_PATH)) {
  let manifest = fs.readFileSync(MANIFEST_PATH, "utf8");
  const requiredPerms = [
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_LOCATION",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.WAKE_LOCK",
    "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
    "android.permission.VIBRATE"
  ];

  for (const perm of requiredPerms) {
    if (!manifest.includes(perm)) {
      manifest = manifest.replace(
        "</manifest>",
        `    <uses-permission android:name="${perm}" />\n</manifest>`
      );
    }
  }
  fs.writeFileSync(MANIFEST_PATH, manifest, "utf8");
  console.log("[configure-android] AndroidManifest.xml configurado con permisos de ForegroundService + Background Location.");
}

// 2. Personalizar strings.xml para la notificación persistente del servicio GPS
if (fs.existsSync(STRINGS_PATH)) {
  let stringsXml = fs.readFileSync(STRINGS_PATH, "utf8");
  if (!stringsXml.includes("capacitor_background_geolocation_notification_channel_name")) {
    stringsXml = stringsXml.replace(
      "</resources>",
      `    <string name="capacitor_background_geolocation_notification_channel_name">Ruta Salinas GPS Activo</string>\n` +
      `    <string name="capacitor_background_geolocation_notification_color">#16a34a</string>\n` +
      `</resources>`
    );
    fs.writeFileSync(STRINGS_PATH, stringsXml, "utf8");
    console.log("[configure-android] strings.xml configurado para canal de notificación de Ruta Salinas.");
  }
}

// 3. Solicitar permiso POST_NOTIFICATIONS en Android 13+, evitar traslape Edge-to-Edge Android 15 y exponer modo inmersivo 3D
if (fs.existsSync(MAIN_ACTIVITY_PATH)) {
  const mainJava = `package com.salinas.reparto;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int REQ_POST_NOTIFICATIONS = 1042;
    private boolean immersiveActive = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Evitar que Android 15 (SDK 35 Edge-to-Edge) dibuje los 3 botones inferiores encima de la WebView
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new SalinasUiBridge(), "SalinasNative");
        }
        ensureNotificationPermissionForForegroundGps();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && immersiveActive) {
            applyImmersiveSystemBars(true);
        }
    }

    private void applyImmersiveSystemBars(boolean hideBars) {
        immersiveActive = hideBars;
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller == null) return;
        if (hideBars) {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
            WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        }
    }

    public class SalinasUiBridge {
        @JavascriptInterface
        public void setImmersive(final boolean enable) {
            runOnUiThread(() -> applyImmersiveSystemBars(enable));
        }
    }

    private void ensureNotificationPermissionForForegroundGps() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                        this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        REQ_POST_NOTIFICATIONS
                );
            }
        }
    }
}
`;
  fs.writeFileSync(MAIN_ACTIVITY_PATH, mainJava, "utf8");
  console.log("[configure-android] MainActivity.java configurado (Immersive Mode 3D + Anti-Overlap Android 15 + POST_NOTIFICATIONS).");
}
