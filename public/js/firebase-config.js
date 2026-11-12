import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  writeBatch,
  collection,
  query,
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
  setDoc,
  addDoc,
  updateDoc,
  writeBatch,
  collection,
  query,
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
    { id: "carlos", name: "Carlos", phone: "" },
    { id: "tello", name: "Tello", phone: "" }
  ],
  calibers: {
    S: {
      code: "S",
      name: "Super",
      subtitle: "Calibre Grande Selecto",
      description: "Piezas grandes de excelente presentación y pulpa cremosa. Ideal para carnicerías, fruterías selectas y exhibición.",
      badge: "Calidad Premium",
      price: 400,
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

export function generateProofId() {
  return "prf_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

/**
 * Ejecuta una escritura administrativa atómica firmada con prueba criptográfica efímera.
 */
export async function executeAdminBatch(keyHash, buildBatchFn) {
  const batch = writeBatch(db);
  const proofId = generateProofId();
  batch.set(doc(db, "admin_proofs", proofId), {
    keyHash,
    createdAt: serverTimestamp()
  });
  buildBatchFn(batch, proofId);
  await batch.commit();
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
