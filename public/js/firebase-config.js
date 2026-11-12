import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  writeBatch,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBGKOHbw7MB4TyhD8gP5Elfz9SjIouPflE",
  authDomain: "aguacates-salinas.firebaseapp.com",
  projectId: "aguacates-salinas",
  storageBucket: "aguacates-salinas.firebasestorage.app",
  messagingSenderId: "129226187583",
  appId: "1:129226187583:web:ebfea64c53670df642298a"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export {
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  writeBatch,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp
};

export const DEFAULT_STORE_SETTINGS = {
  storeOpen: true,
  bannerMessage: "Entregas el mismo día para pedidos realizados por la mañana.",
  whatsappPrimary: "524521715074",
  whatsappSecondary: "528446775276",
  phoneDisplayPrimary: "452 171 50 74",
  phoneDisplaySecondary: "844 677 52 76",
  scheduleText: "Lunes a Sábado • 7:00 AM a 5:00 PM",
  drivers: [
    { id: "carlos", name: "Carlos", phone: "", hasPin: true },
    { id: "tello", name: "Tello", phone: "", hasPin: true },
    { id: "alejandro", name: "Alejandro", phone: "", hasPin: true },
    { id: "liz", name: "Liz", phone: "", hasPin: true }
  ],
  calibers: {
    S: {
      code: "S",
      name: "Super",
      subtitle: "Calibre Grande Selecto",
      description: "Piezas grandes de excelente presentación y pulpa cremosa. Ideal para carnicerías, fruterías selectas y exhibición.",
      badge: "Calidad Premium",
      price: 400,
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

export async function executeAdminBatch(keyHash, buildBatchFn) {
  const batch = writeBatch(db);
  const proofId = generateProofId("prf");
  batch.set(doc(db, "admin_proofs", proofId), {
    keyHash,
    createdAt: serverTimestamp()
  });
  buildBatchFn(batch, proofId);
  await batch.commit();
}

export async function executeDriverBatch(driverKeyHash, buildBatchFn) {
  const batch = writeBatch(db);
  const proofId = generateProofId("dprf");
  batch.set(doc(db, "driver_proofs", proofId), {
    keyHash: driverKeyHash,
    createdAt: serverTimestamp()
  });
  buildBatchFn(batch, proofId);
  await batch.commit();
}

export function getLocalDateStr(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

  // Match !3dLAT!4dLNG in Google Maps URLs
  const m3d = txt.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m3d) {
    return { lat: parseFloat(m3d[1]), lng: parseFloat(m3d[2]) };
  }

  // Match ?q=LAT,LNG or @LAT,LNG or ll=LAT,LNG or plain "LAT, LNG"
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
