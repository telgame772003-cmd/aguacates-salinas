import {
  db,
  doc,
  getDoc,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  DEFAULT_STORE_SETTINGS,
  sha256Hex,
  executeAdminBatch,
  formatCurrency,
  cleanPhoneForWhatsApp
} from "./firebase-config.js";

const SESSION_HASH_KEY = "salinas_admin_hash_v1";

let currentKeyHash = null;
let isSystemInitialized = true;
let storeSettings = structuredClone(DEFAULT_STORE_SETTINGS);
let allOrders = [];
let statusFilter = "todos";
let dateFilter = "all";
let searchQuery = "";
let ordersUnsub = null;
let settingsUnsub = null;

// DOM
const loginView = document.getElementById("loginView");
const dashboardView = document.getElementById("dashboardView");
const loginForm = document.getElementById("loginForm");
const loginSubtitle = document.getElementById("loginSubtitle");
const adminPasswordInput = document.getElementById("adminPasswordInput");
const btnLoginSubmit = document.getElementById("btnLoginSubmit");
const btnLogout = document.getElementById("btnLogout");
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

// Check initial security state & saved session
async function checkInitialAuth() {
  try {
    const initSnap = await getDoc(doc(db, "settings", "security_init"));
    isSystemInitialized = initSnap.exists();
    if (!isSystemInitialized) {
      loginSubtitle.textContent = "Configuración inicial: define tu Clave Maestra de Administración para activar el panel.";
      btnLoginSubmit.textContent = "Crear Clave y Activar Panel";
    }

    const savedHash = localStorage.getItem(SESSION_HASH_KEY) || sessionStorage.getItem(SESSION_HASH_KEY);
    if (savedHash && isSystemInitialized) {
      const keySnap = await getDoc(doc(db, "admin_keys", savedHash));
      if (keySnap.exists() && keySnap.data().active === true) {
        currentKeyHash = savedHash;
        enterDashboard();
      } else {
        localStorage.removeItem(SESSION_HASH_KEY);
        sessionStorage.removeItem(SESSION_HASH_KEY);
      }
    }
  } catch (err) {
    console.error("Error verificando acceso:", err);
  }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pass = adminPasswordInput.value;
  if (!pass || pass.length < 4) {
    showToast("Ingresa una clave válida.");
    return;
  }

  btnLoginSubmit.disabled = true;
  const prevText = btnLoginSubmit.textContent;
  btnLoginSubmit.textContent = "Verificando...";

  try {
    const hash = await sha256Hex(pass);

    if (!isSystemInitialized) {
      await executeAdminBatch(hash, (batch, proofId) => {
        batch.set(doc(db, "admin_keys", hash), {
          active: true,
          proofId,
          createdAt: serverTimestamp()
        });
        batch.set(doc(db, "settings", "security_init"), {
          initialized: true,
          createdAt: serverTimestamp()
        });
        batch.set(doc(db, "settings", "store"), {
          ...DEFAULT_STORE_SETTINGS,
          proofId,
          updatedAt: serverTimestamp()
        });
      });
      isSystemInitialized = true;
      currentKeyHash = hash;
      persistHash(hash);
      adminPasswordInput.value = "";
      enterDashboard();
      showToast("Panel activado y catálogo inicial publicado.");
      return;
    }

    const keySnap = await getDoc(doc(db, "admin_keys", hash));
    if (!keySnap.exists() || keySnap.data().active !== true) {
      showToast("Clave incorrecta. Verifica e intenta nuevamente.");
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.textContent = prevText;
      return;
    }

    currentKeyHash = hash;
    persistHash(hash);
    adminPasswordInput.value = "";
    enterDashboard();
    showToast("Bienvenido al Panel de Administración.");
  } catch (err) {
    console.error("Error en login:", err);
    showToast("Error al autenticar. Intenta nuevamente.");
  } finally {
    btnLoginSubmit.disabled = false;
    btnLoginSubmit.textContent = prevText;
  }
});

function persistHash(hash) {
  if (document.getElementById("rememberAdminSession").checked) {
    localStorage.setItem(SESSION_HASH_KEY, hash);
  } else {
    sessionStorage.setItem(SESSION_HASH_KEY, hash);
  }
}

btnLogout.addEventListener("click", () => {
  currentKeyHash = null;
  localStorage.removeItem(SESSION_HASH_KEY);
  sessionStorage.removeItem(SESSION_HASH_KEY);
  if (ordersUnsub) ordersUnsub();
  if (settingsUnsub) settingsUnsub();
  dashboardView.style.display = "none";
  btnLogout.style.display = "none";
  loginView.style.display = "flex";
});

function enterDashboard() {
  loginView.style.display = "none";
  dashboardView.style.display = "block";
  btnLogout.style.display = "inline-flex";
  startRealtimeListeners();
}

// Tabs switching
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const targetId = btn.dataset.tab;
    document.querySelectorAll(".admin-tab-pane").forEach((pane) => {
      pane.style.display = pane.id === targetId ? "block" : "none";
    });
  });
});

function startRealtimeListeners() {
  if (settingsUnsub) settingsUnsub();
  if (ordersUnsub) ordersUnsub();

  settingsUnsub = onSnapshot(doc(db, "settings", "store"), (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      storeSettings = {
        ...DEFAULT_STORE_SETTINGS,
        ...data,
        calibers: {
          ...DEFAULT_STORE_SETTINGS.calibers,
          ...(data.calibers || {})
        },
        drivers: Array.isArray(data.drivers) ? data.drivers : DEFAULT_STORE_SETTINGS.drivers
      };
    }
    populateCatalogForm();
    renderDriversEditor();
    renderOrdersList();
  });

  const q = query(collection(db, "orders"), orderBy("createdAtIso", "desc"), limit(200));
  ordersUnsub = onSnapshot(q, (snap) => {
    allOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    updateKPIs();
    renderOrdersList();
  });
}

function isSameLocalDay(isoStr) {
  if (!isoStr) return false;
  const d = new Date(isoStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function updateKPIs() {
  let newCount = 0;
  let activeCount = 0;
  let deliveredToday = 0;
  let boxesToday = 0;
  let revToday = 0;
  const calToday = { M: 0, P: 0, E: 0, S: 0 };

  for (const ord of allOrders) {
    if (ord.status === "nuevo") newCount++;
    if (ord.status === "confirmado" || ord.status === "en_ruta") activeCount++;

    if (isSameLocalDay(ord.createdAtIso) && ord.status !== "cancelado") {
      if (ord.status === "entregado") deliveredToday++;
      boxesToday += Number(ord.totalBoxes) || 0;
      revToday += Number(ord.totalAmount) || 0;
      const b = ord.boxesByCaliber || {};
      calToday.M += Number(b.M) || 0;
      calToday.P += Number(b.P) || 0;
      calToday.E += Number(b.E) || 0;
      calToday.S += Number(b.S) || 0;
    }
  }

  document.getElementById("kpiNewCount").textContent = String(newCount);
  document.getElementById("kpiActiveCount").textContent = String(activeCount);
  document.getElementById("kpiDeliveredSub").textContent = `${deliveredToday} entregado${deliveredToday === 1 ? "" : "s"} hoy`;
  document.getElementById("kpiBoxesToday").textContent = String(boxesToday);
  document.getElementById("kpiCalibersSub").textContent = `M:${calToday.M} • P:${calToday.P} • E:${calToday.E} • S:${calToday.S}`;
  document.getElementById("kpiRevenueToday").textContent = formatCurrency(revToday);
}

// Filters
document.getElementById("statusFilterBar").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-status]");
  if (!btn) return;
  statusFilter = btn.dataset.status;
  document.querySelectorAll("#statusFilterBar button").forEach((b) => {
    b.className = b === btn ? "btn btn-sm btn-primary" : "btn btn-sm btn-outline";
  });
  renderOrdersList();
});

document.getElementById("dateRangeFilter").addEventListener("change", (e) => {
  dateFilter = e.target.value;
  renderOrdersList();
});

document.getElementById("searchOrdersInput").addEventListener("input", (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderOrdersList();
});

const STATUS_LABELS = {
  nuevo: "Nuevo",
  confirmado: "Confirmado",
  en_ruta: "En Ruta",
  entregado: "Entregado",
  cancelado: "Cancelado"
};

function buildClientWhatsAppUrl(ord) {
  const phone = cleanPhoneForWhatsApp(ord.phone);
  const itemsTxt = (ord.items || []).map((i) => `${i.qty} ${i.name}`).join(", ");
  let msg = "";

  if (ord.status === "en_ruta") {
    const driverPart = ord.assignedDriver ? ` con nuestro repartidor *${ord.assignedDriver}*` : "";
    msg =
      `Hola *${ord.customerName}*, te saludamos de *Comercializadora Salinas* 🥑.\n` +
      `Tu pedido *${ord.folio}* (${itemsTxt} • Total: ${formatCurrency(ord.totalAmount)}) *ya va en camino*${driverPart} hacia *${ord.address}*.`;
  } else if (ord.status === "entregado") {
    msg =
      `Hola *${ord.customerName}*, gracias por tu compra en *Comercializadora Salinas* 🥑 (Pedido *${ord.folio}*). ¡Gracias por tu lealtad!`;
  } else {
    msg =
      `Hola *${ord.customerName}*, confirmamos de recibido tu pedido *${ord.folio}* en *Comercializadora Salinas* 🥑:\n` +
      `• Cajas: ${itemsTxt} (${ord.totalBoxes} cajas)\n` +
      `• Madurez: ${ord.ripeness || "Surtido"}\n` +
      `• Total: ${formatCurrency(ord.totalAmount)} (${ord.paymentMethod || "Efectivo"})\n` +
      `• Entrega en: ${ord.address}`;
  }
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

function buildDriverWhatsAppUrl(ord) {
  const driverObj = (storeSettings.drivers || []).find((d) => d.name === ord.assignedDriver);
  const driverPhone = driverObj && driverObj.phone ? cleanPhoneForWhatsApp(driverObj.phone) : "";
  const itemsLines = (ord.items || []).map((i) => `  - ${i.qty} caja(s) ${i.name} [${i.code}]`).join("\n");

  const msg =
    `📦 *ORDEN DE ENTREGA — SALINAS*\n` +
    `*Folio:* ${ord.folio}\n` +
    `*Cliente:* ${ord.customerName}\n` +
    `*Tel. Cliente:* ${ord.phone}\n` +
    `*Dirección:* ${ord.address}\n` +
    `*Horario:* ${ord.deliveryWindow || "Lo antes posible"}\n` +
    `*Madurez:* ${ord.ripeness || "Surtido"}\n` +
    (ord.notes ? `*Notas:* ${ord.notes}\n` : "") +
    `*Cajas (${ord.totalBoxes} total):*\n${itemsLines}\n` +
    `*Cobrar:* ${formatCurrency(ord.totalAmount)} (${ord.paymentMethod || "Efectivo"})`;

  return driverPhone
    ? `https://wa.me/${driverPhone}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

function renderOrdersList() {
  const container = document.getElementById("ordersAdminContainer");

  const filtered = allOrders.filter((ord) => {
    if (statusFilter !== "todos" && ord.status !== statusFilter) return false;
    if (dateFilter === "today" && !isSameLocalDay(ord.createdAtIso)) return false;
    if (searchQuery) {
      const hay = `${ord.folio || ""} ${ord.customerName || ""} ${ord.phone || ""} ${ord.address || ""} ${ord.assignedDriver || ""}`.toLowerCase();
      if (!hay.includes(searchQuery)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="cart-empty">No hay pedidos que coincidan con el filtro seleccionado.</div>`;
    return;
  }

  const drivers = storeSettings.drivers || [];

  container.innerHTML = filtered
    .map((ord) => {
      const dateStr = ord.createdAtIso
        ? new Date(ord.createdAtIso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })
        : "";
      const stLabel = STATUS_LABELS[ord.status] || "Nuevo";

      const chipsHtml = (ord.items || [])
        .map(
          (i) =>
            `<span class="cal-chip">${i.qty} × ${escapeHtml(i.name)} (${escapeHtml(i.code)}) — ${formatCurrency(i.subtotal)}</span>`
        )
        .join("");

      const driverOptions = [
        `<option value="">— Sin asignar —</option>`,
        ...drivers.map(
          (d) =>
            `<option value="${escapeHtml(d.name)}" ${ord.assignedDriver === d.name ? "selected" : ""}>${escapeHtml(d.name)}</option>`
        )
      ].join("");

      const statusOptions = Object.entries(STATUS_LABELS)
        .map(
          ([val, lbl]) =>
            `<option value="${val}" ${ord.status === val ? "selected" : ""}>${lbl}</option>`
        )
        .join("");

      return `
        <article class="order-admin-card ${ord.status === "nuevo" ? "is-new" : ""}" data-id="${ord.id}">
          <div class="order-admin-header">
            <div>
              <span style="font-weight:800;font-size:1.08rem;color:var(--green-950);">${escapeHtml(ord.folio || ord.id.slice(0, 6))}</span>
              <span style="font-size:0.82rem;color:var(--slate-500);margin-left:8px;">🕒 ${escapeHtml(dateStr)}</span>
              <span class="status-pill status-${escapeHtml(ord.status)}" style="margin-left:8px;">${escapeHtml(stLabel)}</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <strong style="font-size:1.25rem;color:var(--green-900);">${formatCurrency(ord.totalAmount)}</strong>
              <button type="button" class="btn btn-outline btn-sm" data-action="edit-total" data-id="${ord.id}" title="Ajustar precio especial para este cliente">
                Ajustar $
              </button>
              <button type="button" class="btn btn-outline btn-sm" data-action="print-order" data-id="${ord.id}">
                🖨️ Imprimir Nota
              </button>
            </div>
          </div>

          <div class="order-admin-grid">
            <!-- Customer Details -->
            <div>
              <div style="font-weight:800;font-size:1.02rem;color:var(--slate-900);">${escapeHtml(ord.customerName)}</div>
              <div style="font-size:0.86rem;color:var(--slate-700);margin-top:3px;">📍 ${escapeHtml(ord.address)}</div>
              <div style="font-size:0.85rem;color:var(--slate-700);margin-top:3px;">
                📞 <a href="tel:${escapeHtml(ord.phone)}" style="text-decoration:underline;font-weight:700;">${escapeHtml(ord.phone)}</a>
                &nbsp;•&nbsp; 💳 <strong>${escapeHtml(ord.paymentMethod || "Efectivo")}</strong>
              </div>
              <div style="font-size:0.82rem;color:var(--slate-500);margin-top:4px;">
                🥑 Madurez: <strong>${escapeHtml(ord.ripeness || "Surtido")}</strong>
                &nbsp;|&nbsp; Horario: <strong>${escapeHtml(ord.deliveryWindow || "Lo antes posible")}</strong>
              </div>
              ${ord.notes ? `<div style="margin-top:6px;background:var(--gold-100);color:#6e470b;padding:6px 10px;border-radius:8px;font-size:0.8rem;">📝 ${escapeHtml(ord.notes)}</div>` : ""}
            </div>

            <!-- Boxes Breakdown -->
            <div>
              <div style="font-size:0.8rem;font-weight:800;color:var(--slate-500);text-transform:uppercase;">
                Desglose (${ord.totalBoxes} caja${ord.totalBoxes === 1 ? "" : "s"})
              </div>
              <div class="caliber-breakdown-chips">
                ${chipsHtml}
              </div>
            </div>

            <!-- Controls & WhatsApp -->
            <div style="display:flex;flex-direction:column;gap:8px;">
              <div class="form-row-2">
                <div>
                  <label class="form-label">Estatus</label>
                  <select class="form-control order-status-select" data-id="${ord.id}" style="padding:7px 10px;font-size:0.84rem;font-weight:700;">
                    ${statusOptions}
                  </select>
                </div>
                <div>
                  <label class="form-label">Chofer / Vendedor</label>
                  <select class="form-control order-driver-select" data-id="${ord.id}" style="padding:7px 10px;font-size:0.84rem;font-weight:700;">
                    ${driverOptions}
                  </select>
                </div>
              </div>

              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:2px;">
                <a href="${buildClientWhatsAppUrl(ord)}" target="_blank" rel="noopener" class="btn btn-whatsapp btn-sm" style="flex:1;">
                  WhatsApp Cliente
                </a>
                <a href="${buildDriverWhatsAppUrl(ord)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="flex:1;">
                  Enviar a Chofer
                </a>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

// Order Events Delegation
document.getElementById("ordersAdminContainer").addEventListener("change", async (e) => {
  const statusSel = e.target.closest(".order-status-select");
  if (statusSel) {
    const orderId = statusSel.dataset.id;
    const newStatus = statusSel.value;
    try {
      await executeAdminBatch(currentKeyHash, (batch, proofId) => {
        batch.update(doc(db, "orders", orderId), {
          status: newStatus,
          proofId,
          updatedAt: serverTimestamp()
        });
      });
      showToast(`Estatus actualizado a ${STATUS_LABELS[newStatus]}.`);
    } catch (err) {
      console.error(err);
      showToast("No se pudo actualizar el estatus.");
    }
    return;
  }

  const driverSel = e.target.closest(".order-driver-select");
  if (driverSel) {
    const orderId = driverSel.dataset.id;
    const driverName = driverSel.value;
    const ord = allOrders.find((o) => o.id === orderId);
    const nextStatus = ord && ord.status === "nuevo" && driverName ? "confirmado" : (ord ? ord.status : "nuevo");

    try {
      await executeAdminBatch(currentKeyHash, (batch, proofId) => {
        batch.update(doc(db, "orders", orderId), {
          assignedDriver: driverName,
          status: nextStatus,
          proofId,
          updatedAt: serverTimestamp()
        });
      });
      showToast(driverName ? `Pedido asignado a ${driverName}.` : "Chofer desasignado.");
    } catch (err) {
      console.error(err);
      showToast("Error al asignar chofer.");
    }
  }
});

document.getElementById("ordersAdminContainer").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("button[data-action='edit-total']");
  if (editBtn) {
    const orderId = editBtn.dataset.id;
    const ord = allOrders.find((o) => o.id === orderId);
    if (!ord) return;
    const input = prompt(`Ajustar importe total (MXN) para ${ord.customerName}:`, String(ord.totalAmount));
    if (input === null) return;
    const newTotal = Math.max(0, Math.round(Number(input)));
    if (Number.isNaN(newTotal)) {
      showToast("Ingresa un número válido.");
      return;
    }
    try {
      await executeAdminBatch(currentKeyHash, (batch, proofId) => {
        batch.update(doc(db, "orders", orderId), {
          totalAmount: newTotal,
          proofId,
          updatedAt: serverTimestamp()
        });
      });
      showToast(`Total ajustado a ${formatCurrency(newTotal)}.`);
    } catch (err) {
      console.error(err);
      showToast("Error al ajustar el total.");
    }
    return;
  }

  const printBtn = e.target.closest("button[data-action='print-order']");
  if (printBtn) {
    const orderId = printBtn.dataset.id;
    const ord = allOrders.find((o) => o.id === orderId);
    if (ord) printOrderReceipt(ord);
  }
});

// Print Receipt styled after Comercializadora Salinas physical notes
function printOrderReceipt(ord) {
  const area = document.getElementById("printReceiptArea");
  const dateStr = ord.createdAtIso
    ? new Date(ord.createdAtIso).toLocaleDateString("es-MX")
    : new Date().toLocaleDateString("es-MX");

  const rowsHtml = (ord.items || [])
    .map(
      (i) => `
      <tr>
        <td style="border:1px solid #264428;padding:6px;text-align:center;font-weight:700;">${i.qty}</td>
        <td style="border:1px solid #264428;padding:6px;">${escapeHtml(i.name)} (${escapeHtml(i.code)})</td>
        <td style="border:1px solid #264428;padding:6px;text-align:right;">${formatCurrency(i.unitPrice)}</td>
        <td style="border:1px solid #264428;padding:6px;text-align:right;font-weight:700;">${formatCurrency(i.subtotal)}</td>
      </tr>
    `
    )
    .join("");

  area.innerHTML = `
    <div style="max-width:140mm;margin:0 auto;border:1.5px solid #264428;padding:6mm;">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid #264428;padding-bottom:4mm;margin-bottom:4mm;">
        <img src="assets/logo-salinas.png" style="height:18mm;object-fit:contain;" alt="Salinas">
        <div style="text-align:right;">
          <div style="color:#c62828;font-weight:900;font-size:13pt;">${escapeHtml(ord.folio)}</div>
          <div style="font-size:8.5pt;font-weight:700;margin-top:2px;">FECHA: ${escapeHtml(dateStr)}</div>
          <div style="font-size:8pt;color:#333;">Tel: ${escapeHtml(storeSettings.phoneDisplayPrimary)}</div>
        </div>
      </div>

      <div style="font-size:9.5pt;line-height:1.55;margin-bottom:4mm;">
        <div><strong>NOMBRE:</strong> ${escapeHtml(ord.customerName)}</div>
        <div><strong>TEL / CEL:</strong> ${escapeHtml(ord.phone)}</div>
        <div><strong>DIRECCIÓN:</strong> ${escapeHtml(ord.address)}</div>
        <div><strong>OBSERVACIONES:</strong> ${escapeHtml(ord.paymentMethod || "Efectivo")} • Madurez: ${escapeHtml(ord.ripeness || "Surtido")} ${ord.notes ? " • " + escapeHtml(ord.notes) : ""}</div>
        <div><strong>VENDEDOR / CHOFER:</strong> ${escapeHtml(ord.assignedDriver || "________________")}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:9.5pt;margin-bottom:4mm;">
        <thead>
          <tr style="background:#264428;color:#fff;">
            <th style="padding:6px;width:16%;">CANT.</th>
            <th style="padding:6px;text-align:left;">DESCRIPCIÓN</th>
            <th style="padding:6px;text-align:right;width:22%;">P/UNITARIO</th>
            <th style="padding:6px;text-align:right;width:22%;">IMPORTE</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:3mm;border-top:1.5px solid #264428;">
        <div style="font-size:8.5pt;font-style:italic;max-width:75mm;color:#264428;">
          “La lealtad es escasa en estos tiempos y nosotros la valoramos. Gracias por tu lealtad.”
        </div>
        <div style="text-align:right;font-size:12pt;font-weight:900;color:#132615;">
          TOTAL: ${formatCurrency(ord.totalAmount)}
        </div>
      </div>
    </div>
  `;

  document.body.classList.add("printing-receipt");
  window.print();
  setTimeout(() => {
    document.body.classList.remove("printing-receipt");
  }, 500);
}

// ================= TAB 2: CATALOG EDITOR =================
function populateCatalogForm() {
  document.getElementById("cfgStoreOpen").value = String(storeSettings.storeOpen !== false);
  document.getElementById("cfgSchedule").value = storeSettings.scheduleText || "";
  document.getElementById("cfgBanner").value = storeSettings.bannerMessage || "";
  document.getElementById("cfgPhone1").value = storeSettings.phoneDisplayPrimary || "";
  document.getElementById("cfgPhone2").value = storeSettings.phoneDisplaySecondary || "";

  const calibers = Object.values(storeSettings.calibers || DEFAULT_STORE_SETTINGS.calibers).sort(
    (a, b) => (a.order || 99) - (b.order || 99)
  );

  document.getElementById("adminCalibersEditor").innerHTML = calibers
    .map(
      (cal) => `
      <div class="order-admin-card" style="margin-bottom:0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="caliber-letter">${escapeHtml(cal.code)}</div>
            <div>
              <strong style="font-size:1.1rem;color:var(--green-950);">${escapeHtml(cal.name)}</strong>
              <div style="font-size:0.78rem;color:var(--slate-500);">${escapeHtml(cal.subtitle || "")}</div>
            </div>
          </div>
          <select class="form-control cal-avail-input" data-code="${cal.code}" style="width:auto;font-weight:700;padding:6px 10px;">
            <option value="true" ${cal.available !== false ? "selected" : ""}>🟢 Disponible</option>
            <option value="false" ${cal.available === false ? "selected" : ""}>🔴 Agotado hoy</option>
          </select>
        </div>

        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label">Precio por Caja ($ MXN)</label>
            <input type="number" min="1" max="9999" class="form-control cal-price-input" data-code="${cal.code}" value="${Number(cal.price) || 0}" style="font-weight:800;font-size:1.05rem;">
          </div>
          <div class="form-group">
            <label class="form-label">Etiqueta Destacada</label>
            <input type="text" class="form-control cal-badge-input" data-code="${cal.code}" value="${escapeHtml(cal.badge || "")}" maxlength="28">
          </div>
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Descripción comercial</label>
          <textarea class="form-control cal-desc-input" data-code="${cal.code}" maxlength="200">${escapeHtml(cal.description || "")}</textarea>
        </div>
      </div>
    `
    )
    .join("");
}

document.getElementById("catalogForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("btnSaveCatalog");
  btn.disabled = true;
  btn.textContent = "Guardando cambios...";

  try {
    const updatedCalibers = structuredClone(storeSettings.calibers || DEFAULT_STORE_SETTINGS.calibers);

    document.querySelectorAll(".cal-price-input").forEach((inp) => {
      const code = inp.dataset.code;
      if (updatedCalibers[code]) {
        updatedCalibers[code].price = Math.max(1, Math.round(Number(inp.value) || 0));
      }
    });
    document.querySelectorAll(".cal-avail-input").forEach((sel) => {
      const code = sel.dataset.code;
      if (updatedCalibers[code]) {
        updatedCalibers[code].available = sel.value === "true";
      }
    });
    document.querySelectorAll(".cal-badge-input").forEach((inp) => {
      const code = inp.dataset.code;
      if (updatedCalibers[code]) {
        updatedCalibers[code].badge = inp.value.trim();
      }
    });
    document.querySelectorAll(".cal-desc-input").forEach((inp) => {
      const code = inp.dataset.code;
      if (updatedCalibers[code]) {
        updatedCalibers[code].description = inp.value.trim();
      }
    });

    const phone1Display = document.getElementById("cfgPhone1").value.trim() || DEFAULT_STORE_SETTINGS.phoneDisplayPrimary;
    const phone2Display = document.getElementById("cfgPhone2").value.trim() || DEFAULT_STORE_SETTINGS.phoneDisplaySecondary;

    const newSettings = {
      storeOpen: document.getElementById("cfgStoreOpen").value === "true",
      scheduleText: document.getElementById("cfgSchedule").value.trim(),
      bannerMessage: document.getElementById("cfgBanner").value.trim(),
      phoneDisplayPrimary: phone1Display,
      phoneDisplaySecondary: phone2Display,
      whatsappPrimary: cleanPhoneForWhatsApp(phone1Display),
      whatsappSecondary: cleanPhoneForWhatsApp(phone2Display),
      drivers: storeSettings.drivers || DEFAULT_STORE_SETTINGS.drivers,
      calibers: updatedCalibers
    };

    await executeAdminBatch(currentKeyHash, (batch, proofId) => {
      batch.set(doc(db, "settings", "store"), {
        ...newSettings,
        proofId,
        updatedAt: serverTimestamp()
      });
    });

    showToast("¡Precios y disponibilidad actualizados en tiempo real!");
  } catch (err) {
    console.error(err);
    showToast("Error al guardar catálogo.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar y Actualizar Precios en Vivo";
  }
});

// ================= TAB 3: DRIVERS & SECURITY =================
function renderDriversEditor() {
  const listEl = document.getElementById("driversListEditor");
  const drivers = storeSettings.drivers || [];

  if (drivers.length === 0) {
    listEl.innerHTML = `<div class="cart-empty">No hay choferes registrados.</div>`;
    return;
  }

  listEl.innerHTML = drivers
    .map(
      (drv, idx) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--green-50);border-radius:10px;border:1px solid var(--slate-200);">
        <div>
          <strong style="color:var(--green-950);">🚗 ${escapeHtml(drv.name)}</strong>
          <span style="font-size:0.82rem;color:var(--slate-500);margin-left:8px;">
            ${drv.phone ? "📱 " + escapeHtml(drv.phone) : "Sin celular guardado"}
          </span>
        </div>
        <button type="button" class="btn btn-outline btn-sm" data-remove-driver="${idx}" style="color:var(--red-600);border-color:#eccaca;">
          Quitar
        </button>
      </div>
    `
    )
    .join("");
}

document.getElementById("btnAddDriver").addEventListener("click", async () => {
  const nameInp = document.getElementById("newDriverName");
  const phoneInp = document.getElementById("newDriverPhone");
  const name = nameInp.value.trim();
  const phone = phoneInp.value.trim();

  if (!name) {
    showToast("Escribe el nombre del chofer.");
    return;
  }

  const updatedDrivers = [...(storeSettings.drivers || [])];
  updatedDrivers.push({
    id: name.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now().toString(36),
    name,
    phone
  });

  try {
    await executeAdminBatch(currentKeyHash, (batch, proofId) => {
      batch.set(
        doc(db, "settings", "store"),
        {
          ...storeSettings,
          drivers: updatedDrivers,
          proofId,
          updatedAt: serverTimestamp()
        }
      );
    });
    nameInp.value = "";
    phoneInp.value = "";
    showToast(`Chofer ${name} agregado.`);
  } catch (err) {
    console.error(err);
    showToast("No se pudo agregar el chofer.");
  }
});

document.getElementById("driversListEditor").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-remove-driver]");
  if (!btn) return;
  const idx = Number(btn.dataset.removeDriver);
  const updatedDrivers = (storeSettings.drivers || []).filter((_, i) => i !== idx);

  try {
    await executeAdminBatch(currentKeyHash, (batch, proofId) => {
      batch.set(doc(db, "settings", "store"), {
        ...storeSettings,
        drivers: updatedDrivers,
        proofId,
        updatedAt: serverTimestamp()
      });
    });
    showToast("Chofer eliminado de la lista.");
  } catch (err) {
    console.error(err);
    showToast("Error al eliminar chofer.");
  }
});

document.getElementById("changePassForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p1 = document.getElementById("newAdminPass1").value;
  const p2 = document.getElementById("newAdminPass2").value;

  if (p1.length < 6) {
    showToast("La clave debe tener al menos 6 caracteres.");
    return;
  }
  if (p1 !== p2) {
    showToast("Las claves no coinciden.");
    return;
  }

  try {
    const newHash = await sha256Hex(p1);
    if (newHash === currentKeyHash) {
      showToast("La nueva clave es igual a la actual.");
      return;
    }

    const oldHash = currentKeyHash;
    await executeAdminBatch(oldHash, (batch, proofId) => {
      batch.set(doc(db, "admin_keys", newHash), {
        active: true,
        proofId,
        createdAt: serverTimestamp()
      });
      batch.update(doc(db, "admin_keys", oldHash), {
        active: false,
        proofId,
        revokedAt: serverTimestamp()
      });
    });

    currentKeyHash = newHash;
    if (localStorage.getItem(SESSION_HASH_KEY)) {
      localStorage.setItem(SESSION_HASH_KEY, newHash);
    } else {
      sessionStorage.setItem(SESSION_HASH_KEY, newHash);
    }

    document.getElementById("newAdminPass1").value = "";
    document.getElementById("newAdminPass2").value = "";
    showToast("¡Clave de administración actualizada correctamente!");
  } catch (err) {
    console.error(err);
    showToast("Error al actualizar la clave.");
  }
});

checkInitialAuth();
