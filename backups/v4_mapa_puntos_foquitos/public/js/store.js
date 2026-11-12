import {
  db,
  doc,
  addDoc,
  collection,
  onSnapshot,
  serverTimestamp,
  DEFAULT_STORE_SETTINGS,
  formatCurrency,
  cleanPhoneForWhatsApp
} from "./firebase-config.js";

const STORAGE_CUSTOMER_KEY = "salinas_customer_profile_v1";
const STORAGE_ORDERS_KEY = "salinas_my_order_ids_v1";

let storeSettings = structuredClone(DEFAULT_STORE_SETTINGS);
let cart = { S: 0, E: 0, P: 0, M: 0 };
let customerCoords = null;
let activeOrderUnsubs = [];

// DOM References
const caliberGrid = document.getElementById("caliberGrid");
const cartEmptyState = document.getElementById("cartEmptyState");
const cartItemsContainer = document.getElementById("cartItemsContainer");
const cartSummaryList = document.getElementById("cartSummaryList");
const cartTotalBoxesLabel = document.getElementById("cartTotalBoxesLabel");
const cartGrandTotal = document.getElementById("cartGrandTotal");
const btnClearCart = document.getElementById("btnClearCart");
const btnSubmitOrder = document.getElementById("btnSubmitOrder");
const orderForm = document.getElementById("orderForm");

const mobileCartBar = document.getElementById("mobileCartBar");
const mobileBoxesText = document.getElementById("mobileBoxesText");
const mobileTotalText = document.getElementById("mobileTotalText");

const topBannerText = document.getElementById("topBannerText");
const storeStatusDot = document.getElementById("storeStatusDot");
const heroSchedule = document.getElementById("heroSchedule");
const heroPhone1 = document.getElementById("heroPhone1");
const heroPhone2 = document.getElementById("heroPhone2");
const navWhatsappBtn = document.getElementById("navWhatsappBtn");

const ordersModal = document.getElementById("ordersModal");
const btnOpenMyOrders = document.getElementById("btnOpenMyOrders");
const btnCloseModal = document.getElementById("btnCloseModal");
const myOrdersBadge = document.getElementById("myOrdersBadge");
const myOrdersListContainer = document.getElementById("myOrdersListContainer");
const modalHeaderBanner = document.getElementById("modalHeaderBanner");
const toastBox = document.getElementById("toastBox");

function showToast(msg) {
  toastBox.textContent = msg;
  toastBox.classList.add("show");
  setTimeout(() => toastBox.classList.remove("show"), 3200);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getOrderedCalibers() {
  const calObj = storeSettings.calibers || DEFAULT_STORE_SETTINGS.calibers;
  return Object.values(calObj).sort((a, b) => (a.order || 99) - (b.order || 99));
}

function updateHeaderUI() {
  const isOpen = storeSettings.storeOpen !== false;
  storeStatusDot.classList.toggle("closed", !isOpen);
  topBannerText.textContent = isOpen
    ? (storeSettings.bannerMessage || DEFAULT_STORE_SETTINGS.bannerMessage)
    : "Recepción de pedidos temporalmente cerrada • Consulta disponibilidad por WhatsApp";

  heroSchedule.textContent = storeSettings.scheduleText || DEFAULT_STORE_SETTINGS.scheduleText;
  heroPhone1.textContent = "📞 " + (storeSettings.phoneDisplayPrimary || DEFAULT_STORE_SETTINGS.phoneDisplayPrimary);
  heroPhone2.textContent = "📞 " + (storeSettings.phoneDisplaySecondary || DEFAULT_STORE_SETTINGS.phoneDisplaySecondary);

  const waNum = cleanPhoneForWhatsApp(storeSettings.whatsappPrimary || DEFAULT_STORE_SETTINGS.whatsappPrimary);
  navWhatsappBtn.href = `https://wa.me/${waNum}?text=${encodeURIComponent("Hola Comercializadora Salinas, me gustaría pedir informes sobre aguacate.")}`;
}

function renderCatalog() {
  const calibers = getOrderedCalibers();
  const isStoreOpen = storeSettings.storeOpen !== false;

  caliberGrid.innerHTML = calibers
    .map((cal) => {
      const code = cal.code;
      const qty = cart[code] || 0;
      const available = cal.available !== false && isStoreOpen;
      const lineTotal = qty * (Number(cal.price) || 0);

      return `
        <article class="caliber-card ${qty > 0 ? "in-cart" : ""} ${!available ? "sold-out" : ""}" data-code="${code}">
          <div>
            <div class="caliber-top">
              <div class="caliber-badge-wrap">
                <div class="caliber-letter">${escapeHtml(code)}</div>
                <div>
                  <h3 class="caliber-name">${escapeHtml(cal.name)}</h3>
                  <div class="caliber-sub">${escapeHtml(cal.subtitle || "")}</div>
                </div>
              </div>
              <span class="caliber-tag ${!available ? "sold-out-tag" : ""}">
                ${!available ? (isStoreOpen ? "Agotado hoy" : "Cerrado") : escapeHtml(cal.badge || "Disponible")}
              </span>
            </div>
            <p class="caliber-desc">${escapeHtml(cal.description || "")}</p>
          </div>

          <div>
            <div class="caliber-price-row">
              <div>
                <span class="price-amount">${formatCurrency(cal.price)}</span>
                <span class="price-unit">/ caja</span>
              </div>
              <div class="line-subtotal">
                ${qty > 0 ? `${qty} caja${qty === 1 ? "" : "s"} = ${formatCurrency(lineTotal)}` : ""}
              </div>
            </div>

            <div class="qty-controls">
              <div class="stepper">
                <button type="button" data-action="dec" data-code="${code}" ${!available || qty <= 0 ? "disabled" : ""} aria-label="Restar caja">−</button>
                <input type="number" min="0" max="999" value="${qty}" data-code="${code}" class="qty-input" ${!available ? "disabled" : ""} aria-label="Cantidad de cajas ${escapeHtml(cal.name)}">
                <button type="button" data-action="inc" data-code="${code}" ${!available ? "disabled" : ""} aria-label="Sumar caja">+</button>
              </div>
              <div class="quick-pills">
                <button type="button" class="quick-pill" data-action="add" data-amount="1" data-code="${code}" ${!available ? "disabled" : ""}>+1 caja</button>
                <button type="button" class="quick-pill" data-action="add" data-amount="5" data-code="${code}" ${!available ? "disabled" : ""}>+5 cajas</button>
                <button type="button" class="quick-pill" data-action="add" data-amount="10" data-code="${code}" ${!available ? "disabled" : ""}>+10 cajas</button>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  updateCartSummary();
}

function updateCartSummary() {
  const calibers = getOrderedCalibers();
  let totalBoxes = 0;
  let totalAmount = 0;
  const activeLines = [];

  for (const cal of calibers) {
    const code = cal.code;
    if (cal.available === false || storeSettings.storeOpen === false) {
      cart[code] = 0;
    }
    const qty = Math.max(0, Math.floor(Number(cart[code]) || 0));
    cart[code] = qty;
    if (qty > 0) {
      const price = Number(cal.price) || 0;
      const sub = qty * price;
      totalBoxes += qty;
      totalAmount += sub;
      activeLines.push({ code, name: cal.name, qty, price, sub });
    }
  }

  if (totalBoxes === 0) {
    cartEmptyState.style.display = "block";
    cartItemsContainer.style.display = "none";
    btnClearCart.style.display = "none";
    btnSubmitOrder.disabled = true;
    btnSubmitOrder.textContent = storeSettings.storeOpen === false
      ? "Tienda cerrada temporalmente"
      : "Selecciona al menos 1 caja";
    mobileCartBar.classList.remove("has-items");
  } else {
    cartEmptyState.style.display = "none";
    cartItemsContainer.style.display = "block";
    btnClearCart.style.display = "inline-flex";
    btnSubmitOrder.disabled = false;
    btnSubmitOrder.textContent = `Confirmar Pedido (${totalBoxes} caja${totalBoxes === 1 ? "" : "s"} • ${formatCurrency(totalAmount)})`;

    cartSummaryList.innerHTML = activeLines
      .map(
        (line) => `
        <div class="cart-line">
          <div class="cart-line-left">
            <span class="cart-code-pill">${escapeHtml(line.code)}</span>
            <span>${line.qty} × ${escapeHtml(line.name)}</span>
          </div>
          <strong>${formatCurrency(line.sub)}</strong>
        </div>
      `
      )
      .join("");

    cartTotalBoxesLabel.textContent = `${totalBoxes} caja${totalBoxes === 1 ? "" : "s"} seleccionada${totalBoxes === 1 ? "" : "s"}`;
    cartGrandTotal.textContent = formatCurrency(totalAmount);

    mobileBoxesText.textContent = `${totalBoxes} caja${totalBoxes === 1 ? "" : "s"} en tu pedido`;
    mobileTotalText.textContent = formatCurrency(totalAmount);
    mobileCartBar.classList.add("has-items");
  }
}

// Event delegation on caliberGrid
caliberGrid.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || btn.disabled) return;
  const code = btn.dataset.code;
  const action = btn.dataset.action;

  if (action === "inc") {
    cart[code] = Math.min(999, (cart[code] || 0) + 1);
  } else if (action === "dec") {
    cart[code] = Math.max(0, (cart[code] || 0) - 1);
  } else if (action === "add") {
    const amt = Number(btn.dataset.amount) || 1;
    cart[code] = Math.min(999, (cart[code] || 0) + amt);
  }
  renderCatalog();
});

caliberGrid.addEventListener("change", (e) => {
  if (!e.target.classList.contains("qty-input")) return;
  const code = e.target.dataset.code;
  const val = Math.max(0, Math.min(999, Math.floor(Number(e.target.value) || 0)));
  cart[code] = val;
  renderCatalog();
});

btnClearCart.addEventListener("click", () => {
  cart = { S: 0, E: 0, P: 0, M: 0 };
  renderCatalog();
});

// Load saved customer profile
function loadSavedCustomer() {
  try {
    const raw = localStorage.getItem(STORAGE_CUSTOMER_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.customerName) document.getElementById("customerName").value = data.customerName;
    if (data.phone) document.getElementById("customerPhone").value = data.phone;
    if (data.address) document.getElementById("customerAddress").value = data.address;
    if (data.paymentMethod) document.getElementById("paymentMethod").value = data.paymentMethod;
    if (data.ripeness) document.getElementById("ripenessPref").value = data.ripeness;
    if (typeof data.lat === "number" && typeof data.lng === "number") {
      customerCoords = { lat: data.lat, lng: data.lng };
      const st = document.getElementById("orderGpsStatus");
      if (st) st.textContent = "✓ Ubicación guardada lista";
    }
  } catch (_) {}
}

const btnAttachOrderGps = document.getElementById("btnAttachOrderGps");
if (btnAttachOrderGps) {
  btnAttachOrderGps.addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      showToast("Tu navegador no soporta GPS.");
      return;
    }
    const st = document.getElementById("orderGpsStatus");
    if (st) st.textContent = "Obteniendo punto...";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        customerCoords = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6))
        };
        if (st) st.textContent = "✓ Ubicación exacta adjunta";
        showToast("Ubicación GPS adjuntada a tu pedido.");
      },
      () => {
        if (st) st.textContent = "";
        showToast("No se pudo leer el GPS (puedes enviar tu pedido normal con la dirección escrita).");
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });
}

function saveCustomerProfile(profile) {
  try {
    if (document.getElementById("rememberCustomer").checked) {
      localStorage.setItem(STORAGE_CUSTOMER_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(STORAGE_CUSTOMER_KEY);
    }
  } catch (_) {}
}

function getSavedOrderIds() {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_ORDERS_KEY) || "[]");
    return Array.isArray(arr) ? arr.slice(0, 10) : [];
  } catch (_) {
    return [];
  }
}

function saveOrderIdLocally(id) {
  const existing = getSavedOrderIds().filter((x) => x !== id);
  existing.unshift(id);
  try {
    localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(existing.slice(0, 10)));
  } catch (_) {}
  refreshOrdersBadge();
}

function refreshOrdersBadge() {
  const ids = getSavedOrderIds();
  if (ids.length > 0) {
    myOrdersBadge.style.display = "inline-block";
    myOrdersBadge.textContent = String(ids.length);
  } else {
    myOrdersBadge.style.display = "none";
  }
}

function generateOrderFolio() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(100 + Math.random() * 900);
  return `SAL-${mm}${dd}-${rand}`;
}

// Submit Order to Firestore
orderForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const customerName = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("customerPhone").value.trim();
  const address = document.getElementById("customerAddress").value.trim();
  const paymentMethod = document.getElementById("paymentMethod").value;
  const ripeness = document.getElementById("ripenessPref").value;
  const deliveryWindow = document.getElementById("deliveryWindow").value;
  const notes = document.getElementById("orderNotes").value.trim();

  if (customerName.length < 2) {
    showToast("Ingresa el nombre de tu negocio o cliente.");
    return;
  }
  if (phone.replace(/\D/g, "").length < 8) {
    showToast("Ingresa un número de teléfono o WhatsApp válido.");
    return;
  }
  if (address.length < 4) {
    showToast("Ingresa la dirección de entrega.");
    return;
  }

  const calibers = getOrderedCalibers();
  const items = [];
  const boxesByCaliber = { M: 0, P: 0, E: 0, S: 0 };
  let totalBoxes = 0;
  let totalAmount = 0;

  for (const cal of calibers) {
    const qty = cart[cal.code] || 0;
    if (qty > 0 && cal.available !== false) {
      const unitPrice = Number(cal.price) || 0;
      const subtotal = qty * unitPrice;
      boxesByCaliber[cal.code] = qty;
      totalBoxes += qty;
      totalAmount += subtotal;
      items.push({
        code: cal.code,
        name: cal.name,
        qty,
        unitPrice,
        subtotal
      });
    }
  }

  if (totalBoxes <= 0) {
    showToast("Selecciona al menos 1 caja para enviar tu pedido.");
    return;
  }

  btnSubmitOrder.disabled = true;
  btnSubmitOrder.textContent = "Enviando pedido...";

  try {
    const folio = generateOrderFolio();
    const orderPayload = {
      folio,
      customerName,
      phone,
      address,
      paymentMethod,
      ripeness,
      deliveryWindow,
      notes,
      items,
      boxesByCaliber,
      totalBoxes,
      totalAmount,
      ...(customerCoords ? { lat: customerCoords.lat, lng: customerCoords.lng } : {}),
      status: "nuevo",
      assignedDriver: "",
      createdAt: serverTimestamp(),
      createdAtIso: new Date().toISOString()
    };

    const docRef = await addDoc(collection(db, "orders"), orderPayload);
    saveCustomerProfile({
      customerName,
      phone,
      address,
      paymentMethod,
      ripeness,
      ...(customerCoords ? { lat: customerCoords.lat, lng: customerCoords.lng } : {})
    });
    saveOrderIdLocally(docRef.id);

    // Clear cart & notes
    cart = { S: 0, E: 0, P: 0, M: 0 };
    document.getElementById("orderNotes").value = "";
    renderCatalog();

    openOrdersModal(folio);
    showToast(`¡Pedido ${folio} registrado con éxito!`);
  } catch (err) {
    console.error("Error guardando pedido:", err);
    showToast("Hubo un problema al enviar tu pedido. Intenta de nuevo.");
    updateCartSummary();
  }
});

// Status Helpers
const STATUS_INFO = {
  nuevo: { label: "Recibido", step: 1 },
  confirmado: { label: "Confirmado", step: 2 },
  en_ruta: { label: "En Ruta", step: 3 },
  entregado: { label: "Entregado", step: 4 },
  cancelado: { label: "Cancelado", step: 0 }
};

function buildWhatsAppConfirmationUrl(order) {
  const waNum = cleanPhoneForWhatsApp(storeSettings.whatsappPrimary || DEFAULT_STORE_SETTINGS.whatsappPrimary);
  const lines = (order.items || []).map((i) => `• ${i.qty} caja(s) ${i.name} (${formatCurrency(i.subtotal)})`).join("\n");
  const msg =
    `Hola *Comercializadora Salinas*, acabo de registrar mi pedido en línea:\n\n` +
    `*Folio:* ${order.folio}\n` +
    `*Cliente:* ${order.customerName}\n` +
    `*Pedido:*\n${lines}\n` +
    `*Total:* ${formatCurrency(order.totalAmount)} (${order.totalBoxes} cajas)\n` +
    `*Madurez:* ${order.ripeness || "Surtido"}\n` +
    `*Dirección:* ${order.address}\n` +
    `*Pago:* ${order.paymentMethod || "Efectivo"}`;
  return `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;
}

function openOrdersModal(justCreatedFolio = null) {
  ordersModal.classList.add("open");

  if (justCreatedFolio) {
    modalHeaderBanner.innerHTML = `
      <div style="background:var(--green-100);border:1px solid var(--green-600);padding:14px 16px;border-radius:12px;margin-bottom:14px;">
        <div style="font-weight:800;color:var(--green-900);font-size:1.05rem;">✓ ¡Pedido ${escapeHtml(justCreatedFolio)} recibido!</div>
        <div style="font-size:0.84rem;color:var(--slate-700);margin-top:3px;">
          Nuestro equipo ya lo tiene en pantalla. Aquí puedes ver en vivo cuando salga a ruta o enviarnos copia por WhatsApp.
        </div>
      </div>
      <h3 class="serif-title" style="font-size:1.35rem;color:var(--green-950);">Mis Pedidos Recientes</h3>
    `;
  } else {
    modalHeaderBanner.innerHTML = `
      <h3 class="serif-title" style="font-size:1.45rem;color:var(--green-950);">Seguimiento de Mis Pedidos</h3>
      <p style="font-size:0.85rem;color:var(--slate-500);">Estatus actualizado en tiempo real desde almacén.</p>
    `;
  }

  subscribeToMyOrders();
}

function closeOrdersModal() {
  ordersModal.classList.remove("open");
  activeOrderUnsubs.forEach((u) => u());
  activeOrderUnsubs = [];
}

function subscribeToMyOrders() {
  activeOrderUnsubs.forEach((u) => u());
  activeOrderUnsubs = [];

  const ids = getSavedOrderIds();
  if (ids.length === 0) {
    myOrdersListContainer.innerHTML = `
      <div class="cart-empty" style="margin-top:12px;">
        Aún no tienes pedidos guardados en este dispositivo.
      </div>
    `;
    return;
  }

  const ordersMap = new Map();
  myOrdersListContainer.innerHTML = `<div style="padding:16px;text-align:center;color:var(--slate-500);">Consultando estatus en tiempo real...</div>`;

  const renderTrackerList = () => {
    const list = ids.map((id) => ordersMap.get(id)).filter(Boolean);
    if (list.length === 0) {
      myOrdersListContainer.innerHTML = `<div class="cart-empty">No se encontraron pedidos recientes.</div>`;
      return;
    }

    myOrdersListContainer.innerHTML = list
      .map((ord) => {
        const st = STATUS_INFO[ord.status] || STATUS_INFO.nuevo;
        const itemsSummary = (ord.items || [])
          .map((i) => `${i.qty} ${escapeHtml(i.name)}`)
          .join(" • ");
        const dateStr = ord.createdAtIso
          ? new Date(ord.createdAtIso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })
          : "";

        const driverInfo =
          ord.assignedDriver && ord.status !== "cancelado"
            ? `<div style="margin-top:8px;font-size:0.82rem;font-weight:700;color:var(--green-800);">🚗 Repartidor asignado: ${escapeHtml(ord.assignedDriver)}</div>`
            : "";

        const progressHtml =
          ord.status === "cancelado"
            ? ""
            : `
            <div class="progress-steps">
              <div class="step-item ${st.step >= 1 ? "done" : ""}"><div class="step-bar"></div>Recibido</div>
              <div class="step-item ${st.step >= 2 ? "done" : ""}"><div class="step-bar"></div>Confirmado</div>
              <div class="step-item ${st.step >= 3 ? "done" : ""}"><div class="step-bar"></div>En Ruta</div>
              <div class="step-item ${st.step >= 4 ? "done" : ""}"><div class="step-bar"></div>Entregado</div>
            </div>
          `;

        return `
          <div class="tracker-card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
              <div>
                <strong style="font-size:1rem;color:var(--green-950);">${escapeHtml(ord.folio || "Pedido")}</strong>
                <span style="font-size:0.76rem;color:var(--slate-500);margin-left:6px;">${escapeHtml(dateStr)}</span>
              </div>
              <span class="status-pill status-${escapeHtml(ord.status)}">${escapeHtml(st.label)}</span>
            </div>

            <div style="margin-top:8px;font-size:0.88rem;color:var(--slate-700);">
              <strong>${ord.totalBoxes} caja${ord.totalBoxes === 1 ? "" : "s"}:</strong> ${itemsSummary}
            </div>
            <div style="font-size:0.92rem;font-weight:800;color:var(--green-900);margin-top:3px;">
              Total: ${formatCurrency(ord.totalAmount)} <span style="font-weight:500;font-size:0.78rem;color:var(--slate-500);">(${escapeHtml(ord.paymentMethod || "Efectivo")})</span>
            </div>

            ${driverInfo}
            ${progressHtml}

            <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
              <a href="${buildWhatsAppConfirmationUrl(ord)}" target="_blank" rel="noopener" class="btn btn-whatsapp btn-sm">
                Enviar por WhatsApp
              </a>
              <button type="button" class="btn btn-outline btn-sm btn-reorder" data-id="${ord.id}">
                Repetir pedido
              </button>
            </div>
          </div>
        `;
      })
      .join("");
  };

  ids.forEach((orderId) => {
    const unsub = onSnapshot(
      doc(db, "orders", orderId),
      (snap) => {
        if (snap.exists()) {
          ordersMap.set(orderId, { id: snap.id, ...snap.data() });
        }
        renderTrackerList();
      },
      () => renderTrackerList()
    );
    activeOrderUnsubs.push(unsub);
  });
}

myOrdersListContainer.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-reorder");
  if (!btn) return;
  const orderId = btn.dataset.id;
  onSnapshot(doc(db, "orders", orderId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    const boxes = data.boxesByCaliber || {};
    cart = {
      S: Number(boxes.S) || 0,
      E: Number(boxes.E) || 0,
      P: Number(boxes.P) || 0,
      M: Number(boxes.M) || 0
    };
    renderCatalog();
    closeOrdersModal();
    document.getElementById("mi-pedido").scrollIntoView({ behavior: "smooth" });
    showToast("Cajas cargadas en tu pedido actual.");
  })();
});

btnOpenMyOrders.addEventListener("click", () => openOrdersModal(null));
btnCloseModal.addEventListener("click", closeOrdersModal);
ordersModal.addEventListener("click", (e) => {
  if (e.target === ordersModal) closeOrdersModal();
});

// Subscribe to live store settings from Firestore
onSnapshot(
  doc(db, "settings", "store"),
  (snap) => {
    if (snap.exists()) {
      const remote = snap.data();
      storeSettings = {
        ...DEFAULT_STORE_SETTINGS,
        ...remote,
        calibers: {
          ...DEFAULT_STORE_SETTINGS.calibers,
          ...(remote.calibers || {})
        }
      };
    }
    updateHeaderUI();
    renderCatalog();
  },
  (err) => {
    console.warn("Usando catálogo base:", err);
    updateHeaderUI();
    renderCatalog();
  }
);

// Initialize UI immediately
loadSavedCustomer();
refreshOrdersBadge();
updateHeaderUI();
renderCatalog();
