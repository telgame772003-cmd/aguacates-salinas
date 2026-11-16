/* global firebase */
importScripts("https://www.gstatic.com/firebasejs/11.1.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBGKOHbw7MB4TyhD8gP5Elfz9SjIouPflE",
  authDomain: "aguacates-salinas.firebaseapp.com",
  projectId: "aguacates-salinas",
  storageBucket: "aguacates-salinas.firebasestorage.app",
  messagingSenderId: "129226187583",
  appId: "1:129226187583:web:ebfea64c53670df42298a"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(async (payload) => {
  const data = payload?.data || {};
  const title = data.title || payload?.notification?.title || "📍 Reportar ubicación";
  const body = data.body || payload?.notification?.body || "Toca para enviar tu ubicación GPS a oficina.";
  try {
    const existing = await self.registration.getNotifications({ tag: "salinas-gps-ping" });
    existing.forEach((n) => n.close());
  } catch (_) {}
  return self.registration.showNotification(title, {
    body,
    icon: "/assets/logo-salinas.png",
    badge: "/assets/logo-salinas.png",
    tag: "salinas-gps-ping",
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: { url: "/chofer.html?ping=gps" }
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/chofer.html?ping=gps";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("chofer.html") && "focus" in client) {
          client.postMessage({ type: "SALINAS_GPS_PING" });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return null;
    })
  );
});
