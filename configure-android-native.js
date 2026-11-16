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

// 3. Solicitar permiso POST_NOTIFICATIONS en Android 13+ al abrir la app para garantizar el ForegroundService
if (fs.existsSync(MAIN_ACTIVITY_PATH)) {
  const mainJava = `package com.salinas.reparto;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int REQ_POST_NOTIFICATIONS = 1042;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        ensureNotificationPermissionForForegroundGps();
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
  console.log("[configure-android] MainActivity.java configurado (POST_NOTIFICATIONS Android 13+ y KeepScreenOn).");
}
