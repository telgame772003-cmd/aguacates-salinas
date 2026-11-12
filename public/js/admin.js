import {
  db,
  doc,
  getDoc,
  getDocs,
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

function getLocalDateStr(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

let currentKeyHash = null;
let isSystemInitialized = true;
let storeSettings = structuredClone(DEFAULT_STORE_SETTINGS);
let allOrders = [];
let statusFilter = "todos";
let dateFilter = "all";
let searchQuery = "";

// Warehouse state
let selectedWhDate = getLocalDateStr();
let currentWhDoc = createEmptyWhDoc(selectedWhDate);

let ordersUnsub = null;
let settingsUnsub = null;
let whUnsub = null;

function createEmptyWhDoc(dateStr) {
  return {
    date: dateStr,
    openingStock: { M: 0, P: 0, E: 0, S: 0 },
    extraEntries: { M: 0, P: 0, E: 0, S: 0 },
    observations: "",
    trips: []
  };
}

// DOM
const loginView = document.getElementById("loginView");
const dashboardView = document.getElementById("dashboardView");
const loginForm = document.getElementById("loginForm");
const loginSubtitle = document.getElementById("loginSubtitle");
const adminPasswordInput = document.getElementById("adminPasswordInput");
const btnLoginSubmit = document.getElementById("btnLoginSubmit");
const btnLogout = document.getElementById("btnLogout");
const btnDownloadBackup = document.getElementById("btnDownloadBackup");
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

// ================= AUTHENTICATION =================
async function checkInitialAuth() {
  try {
    const initSnap = await getDoc(doc(db, "settings", "security_init"));
    isSystemInitialized = initSnap.exists();
    if (!isSystemInitialized) {
      loginSubtitle.textContent = "Configuración inicial: define tu Clave Maestra de Administración.";
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
        batch.set(doc(db, "admin_keys", hash), { active: true, proofId, createdAt: serverTimestamp() });
        batch.set(doc(db, "settings", "security_init"), { initialized: true, createdAt: serverTimestamp() });
        batch.set(doc(db, "settings", "store"), { ...DEFAULT_STORE_SETTINGS, proofId, updatedAt: serverTimestamp() });
      });
      isSystemInitialized = true;
      currentKeyHash = hash;
      persistHash(hash);
      adminPasswordInput.value = "";
      enterDashboard();
      showToast("Sistema activado correctamente.");
      return;
    }

    const keySnap = await getDoc(doc(db, "admin_keys", hash));
    if (!keySnap.exists() || keySnap.data().active !== true) {
      showToast("Clave incorrecta. Verifica e intenta nuevamente.");
      return;
    }

    currentKeyHash = hash;
    persistHash(hash);
    adminPasswordInput.value = "";
    enterDashboard();
    showToast("Sesión iniciada.");
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
  if (whUnsub) whUnsub();
  dashboardView.style.display = "none";
  btnLogout.style.display = "none";
  btnDownloadBackup.style.display = "none";
  loginView.style.display = "flex";
});

function enterDashboard() {
  loginView.style.display = "none";
  dashboardView.style.display = "block";
  btnLogout.style.display = "inline-flex";
  btnDownloadBackup.style.display = "inline-flex";
  document.getElementById("whDatePicker").value = selectedWhDate;
  startRealtimeListeners();
  subscribeWarehouseDay(selectedWhDate);
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

// ================= BACKUP JSON DOWNLOAD =================
btnDownloadBackup.addEventListener("click", async () => {
  btnDownloadBackup.disabled = true;
  btnDownloadBackup.textContent = "Generando...";
  try {
    const [ordersSnap, whSnap] = await Promise.all([
      getDocs(query(collection(db, "orders"), orderBy("createdAtIso", "desc"), limit(500))),
      getDocs(collection(db, "warehouse_days"))
    ]);

    const backupPayload = {
      exportedAt: new Date().toISOString(),
      project: "Aguacates Salinas",
      storeSettings,
      warehouseDays: whSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      orders: ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    };

    const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Respaldo_Aguacates_Salinas_${getLocalDateStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Respaldo completo descargado en tu equipo.");
  } catch (err) {
    console.error(err);
    showToast("Error al generar el respaldo.");
  } finally {
    btnDownloadBackup.disabled = false;
    btnDownloadBackup.innerHTML = '💾 <span class="hide-mobile">Respaldar</span>';
  }
});

// ================= REALTIME LISTENERS =================
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
    updateBroadcastPreview();
    renderDriversEditor();
    populateTripDriverSelect();
    renderOrdersList();
  });

  const q = query(collection(db, "orders"), orderBy("createdAtIso", "desc"), limit(200));
  ordersUnsub = onSnapshot(q, (snap) => {
    allOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    updateKPIs();
    renderOrdersList();
  });
}

function subscribeWarehouseDay(dateStr) {
  if (whUnsub) whUnsub();
  selectedWhDate = dateStr;

  whUnsub = onSnapshot(doc(db, "warehouse_days", dateStr), (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      currentWhDoc = {
        date: dateStr,
        openingStock: { M: 0, P: 0, E: 0, S: 0, ...(d.openingStock || {}) },
        extraEntries: { M: 0, P: 0, E: 0, S: 0, ...(d.extraEntries || {}) },
        observations: d.observations || "",
        trips: Array.isArray(d.trips) ? d.trips : []
      };
    } else {
      currentWhDoc = createEmptyWhDoc(dateStr);
    }
    renderWarehouseModule();
    updateKPIs();
  });
}

// ================= WAREHOUSE MODULE LOGIC =================
function computeWarehouseTotals(whDoc) {
  const cals = ["M", "P", "E", "S"];
  const init = {};
  const extra = {};
  const out = { M: 0, P: 0, E: 0, S: 0 };
  const ret = { M: 0, P: 0, E: 0, S: 0 };
  const sold = {};
  const finalStock = {};

  for (const c of cals) {
    init[c] = Number(whDoc.openingStock?.[c]) || 0;
    extra[c] = Number(whDoc.extraEntries?.[c]) || 0;
  }

  for (const t of whDoc.trips || []) {
    for (const c of cals) {
      out[c] += Number(t.out?.[c]) || 0;
      ret[c] += Number(t.ret?.[c]) || 0;
    }
  }

  let totalInit = 0;
  let totalExtra = 0;
  let totalOut = 0;
  let totalRet = 0;
  let totalSold = 0;
  let totalFinal = 0;

  for (const c of cals) {
    sold[c] = out[c] - ret[c];
    finalStock[c] = init[c] + extra[c] - sold[c];
    totalInit += init[c];
    totalExtra += extra[c];
    totalOut += out[c];
    totalRet += ret[c];
    totalSold += sold[c];
    totalFinal += finalStock[c];
  }

  return {
    init, extra, out, ret, sold, finalStock,
    totalInit, totalExtra, totalOut, totalRet, totalSold, totalFinal
  };
}

function populateTripDriverSelect() {
  const sel = document.getElementById("tripDriver");
  const drivers = storeSettings.drivers || [];
  if (drivers.length === 0) {
    sel.innerHTML = `<option value="Sin nombre">Agrega un chofer en pestaña Choferes</option>`;
    return;
  }
  const prev = sel.value;
  sel.innerHTML = drivers
    .map((d) => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`)
    .join("");
  if (prev && drivers.some((d) => d.name === prev)) {
    sel.value = prev;
  }
}

function renderWarehouseModule() {
  const totals = computeWarehouseTotals(currentWhDoc);

  // Fill Opening Form inputs (only if user isn't actively typing in them)
  const activeEl = document.activeElement;
  const setValIfIdle = (id, val) => {
    const el = document.getElementById(id);
    if (el && activeEl !== el) el.value = val;
  };
  setValIfIdle("whInitM", totals.init.M);
  setValIfIdle("whInitP", totals.init.P);
  setValIfIdle("whInitE", totals.init.E);
  setValIfIdle("whInitS", totals.init.S);
  setValIfIdle("whExtraM", totals.extra.M);
  setValIfIdle("whExtraP", totals.extra.P);
  setValIfIdle("whExtraE", totals.extra.E);
  setValIfIdle("whExtraS", totals.extra.S);
  setValIfIdle("whObservations", currentWhDoc.observations || "");

  // 1. Live Stock Cards
  const calLabels = {
    M: "M • Media / Seg.",
    P: "P • Primera",
    E: "E • Extra",
    S: "S • Super"
  };

  const cardsHtml = ["M", "P", "E", "S"]
    .map((c) => {
      const availBase = totals.init[c] + totals.extra[c];
      return `
        <div class="wh-stock-card">
          <div class="wh-stock-title">${calLabels[c]}</div>
          <div class="wh-stock-current">${totals.finalStock[c]} <span style="font-size:0.85rem;font-weight:600;">cajas</span></div>
          <div class="wh-stock-meta">
            Base: <strong>${availBase}</strong> &nbsp;•&nbsp; Vendido: <strong>${totals.sold[c]}</strong>
          </div>
        </div>
      `;
    })
    .join("");

  const totalBase = totals.totalInit + totals.totalExtra;
  document.getElementById("whStockCards").innerHTML =
    cardsHtml +
    `
      <div class="wh-stock-card wh-total-card">
        <div class="wh-stock-title">Total en Piso (T. INV.)</div>
        <div class="wh-stock-current">${totals.totalFinal} <span style="font-size:0.85rem;font-weight:600;">cajas</span></div>
        <div class="wh-stock-meta">
          Base: <strong>${totalBase}</strong> &nbsp;•&nbsp; Total V.: <strong>${totals.totalSold}</strong>
        </div>
      </div>
    `;

  // 2. Driver Summary Cards (Concentrado por Chofer)
  const byDriver = new Map();
  for (const t of currentWhDoc.trips || []) {
    const name = t.driver || "Chofer";
    if (!byDriver.has(name)) {
      byDriver.set(name, {
        name,
        vueltas: 0,
        lastRipeness: "",
        lastTime: "",
        out: { M: 0, P: 0, E: 0, S: 0 },
        ret: { M: 0, P: 0, E: 0, S: 0 },
        totalOut: 0,
        totalRet: 0
      });
    }
    const g = byDriver.get(name);
    g.vueltas++;
    g.lastRipeness = t.ripeness || "Surtido";
    g.lastTime = t.time || "";
    for (const c of ["M", "P", "E", "S"]) {
      const o = Number(t.out?.[c]) || 0;
      const r = Number(t.ret?.[c]) || 0;
      g.out[c] += o;
      g.ret[c] += r;
      g.totalOut += o;
      g.totalRet += r;
    }
  }

  const drvCardsEl = document.getElementById("whDriverSummaryCards");
  if (byDriver.size === 0) {
    drvCardsEl.innerHTML = `<div class="cart-empty" style="grid-column:1/-1;margin-bottom:0;">Aún no se han registrado salidas de carros en esta fecha.</div>`;
  } else {
    drvCardsEl.innerHTML = Array.from(byDriver.values())
      .map((g) => {
        const net = g.totalOut - g.totalRet;
        const netByCal = ["M", "P", "E", "S"]
          .map((c) => `${c}:${g.out[c] - g.ret[c]}`)
          .join(" • ");
        return `
          <div class="driver-route-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <strong style="font-size:1.02rem;color:var(--green-950);">🚗 ${escapeHtml(g.name)}</strong>
              <span class="ripeness-badge">${g.vueltas} vuelta${g.vueltas === 1 ? "" : "s"}</span>
            </div>
            <div style="font-size:0.8rem;color:var(--slate-700);margin-bottom:6px;">
              Última carga (${escapeHtml(g.lastTime)}): <strong>${escapeHtml(g.lastRipeness)}</strong>
            </div>
            <div style="font-size:0.82rem;color:var(--slate-700);background:var(--green-50);padding:6px 8px;border-radius:8px;">
              Salida: <strong>${g.totalOut}</strong> &nbsp;|&nbsp; Dev.: <strong>${g.totalRet}</strong> &nbsp;→&nbsp;
              <strong style="color:var(--green-900);">Neto Vendido: ${net}</strong>
              <div style="font-size:0.74rem;color:var(--slate-500);margin-top:2px;">Neto por calibre: ${netByCal}</div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  // 3. Trips Table (Desktop) + Native Cards (Mobile)
  const tbody = document.getElementById("whTripsTableBody");
  const tfoot = document.getElementById("whTripsTableFoot");
  const mobileList = document.getElementById("whMobileTripsList");
  const trips = currentWhDoc.trips || [];

  if (trips.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" style="padding:20px;color:var(--slate-500);">Sin vueltas registradas en esta fecha. Usa el formulario de arriba cada vez que salga un carro.</td></tr>`;
    mobileList.innerHTML = `
      <div class="cart-empty" style="margin-bottom:0;">
        Sin vueltas registradas en esta fecha. Usa el formulario de arriba cada vez que salga un carro.
      </div>
    `;
  } else {
    tbody.innerHTML = trips
      .map((t, idx) => {
        const oM = Number(t.out?.M) || 0;
        const oP = Number(t.out?.P) || 0;
        const oE = Number(t.out?.E) || 0;
        const oS = Number(t.out?.S) || 0;
        const rM = Number(t.ret?.M) || 0;
        const rP = Number(t.ret?.P) || 0;
        const rE = Number(t.ret?.E) || 0;
        const rS = Number(t.ret?.S) || 0;
        const net = (oM + oP + oE + oS) - (rM + rP + rE + rS);

        return `
          <tr>
            <td style="font-weight:800;color:var(--slate-500);">${idx + 1}</td>
            <td style="font-weight:700;">${escapeHtml(t.time || "")}</td>
            <td style="text-align:left;font-weight:800;color:var(--green-950);">${escapeHtml(t.driver)}</td>
            <td>
              <span class="ripeness-badge">${escapeHtml(t.ripeness || "Surtido")}</span>
              ${t.note ? `<div style="font-size:0.72rem;color:var(--slate-500);margin-top:2px;">${escapeHtml(t.note)}</div>` : ""}
            </td>
            <td>${oM || "—"}</td>
            <td>${oP || "—"}</td>
            <td>${oE || "—"}</td>
            <td style="border-right:2px solid var(--green-800);">${oS || "—"}</td>
            <td>${rM || "0"}</td>
            <td>${rP || "0"}</td>
            <td>${rE || "0"}</td>
            <td style="border-right:2px solid var(--green-800);">${rS || "0"}</td>
            <td style="font-weight:900;font-size:0.95rem;color:var(--green-900);background:var(--green-50);">${net}</td>
            <td>
              <button type="button" class="btn btn-outline btn-sm" data-edit-trip="${escapeHtml(t.id)}">
                Devolución / Editar
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    const mobileCardsHtml = trips
      .map((t, idx) => {
        const oM = Number(t.out?.M) || 0;
        const oP = Number(t.out?.P) || 0;
        const oE = Number(t.out?.E) || 0;
        const oS = Number(t.out?.S) || 0;
        const rM = Number(t.ret?.M) || 0;
        const rP = Number(t.ret?.P) || 0;
        const rE = Number(t.ret?.E) || 0;
        const rS = Number(t.ret?.S) || 0;
        const totO = oM + oP + oE + oS;
        const totR = rM + rP + rE + rS;
        const net = totO - totR;

        return `
          <div class="wh-trip-mcard">
            <div class="wh-trip-mcard-head">
              <div>
                <span style="font-weight:800;color:var(--slate-500);font-size:0.8rem;">#${idx + 1} • ${escapeHtml(t.time || "")}</span>
                <strong style="display:block;font-size:1.02rem;color:var(--green-950);">🚗 ${escapeHtml(t.driver)}</strong>
              </div>
              <span class="ripeness-badge">${escapeHtml(t.ripeness || "Surtido")}</span>
            </div>

            ${t.note ? `<div style="font-size:0.8rem;color:var(--slate-700);margin-bottom:8px;">📝 ${escapeHtml(t.note)}</div>` : ""}

            <div class="wh-trip-mcard-boxes">
              <div class="wh-mini-box-group">
                <div class="wh-mini-box-label">Salida (${totO} cajas)</div>
                <div class="wh-mini-box-vals">
                  <span>M:${oM}</span><span>P:${oP}</span><span>E:${oE}</span><span>S:${oS}</span>
                </div>
              </div>
              <div class="wh-mini-box-group is-ret">
                <div class="wh-mini-box-label">Devolución (${totR} cajas)</div>
                <div class="wh-mini-box-vals">
                  <span>M:${rM}</span><span>P:${rP}</span><span>E:${rE}</span><span>S:${rS}</span>
                </div>
              </div>
            </div>

            <div class="wh-trip-mcard-foot">
              <div>
                <span style="font-size:0.76rem;color:var(--slate-500);font-weight:700;">VENDIDO NETO:</span>
                <strong style="font-size:1.05rem;color:var(--green-900);margin-left:4px;">${net} cajas</strong>
              </div>
              <button type="button" class="btn btn-outline btn-sm" data-edit-trip="${escapeHtml(t.id)}">
                Devolución / Editar
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    const mobileSummaryCard = `
      <div class="wh-trip-mcard" style="background:var(--green-100);border-color:var(--green-700);">
        <div style="font-weight:800;color:var(--green-950);font-size:0.88rem;margin-bottom:6px;">SUMAS DEL DÍA</div>
        <div style="font-size:0.82rem;color:var(--slate-900);display:flex;flex-direction:column;gap:4px;">
          <div><strong>Salidas (${totals.totalOut}):</strong> M:${totals.out.M} • P:${totals.out.P} • E:${totals.out.E} • S:${totals.out.S}</div>
          <div><strong>Devoluciones (${totals.totalRet}):</strong> M:${totals.ret.M} • P:${totals.ret.P} • E:${totals.ret.E} • S:${totals.ret.S}</div>
          <div style="font-size:0.95rem;color:var(--green-950);padding-top:4px;border-top:1px solid var(--slate-300);">
            <strong>Total Vendido Neto (Total V.): ${totals.totalSold} cajas</strong>
          </div>
        </div>
      </div>
    `;

    mobileList.innerHTML = mobileCardsHtml + mobileSummaryCard;
  }

  tfoot.innerHTML = `
    <tr>
      <td colspan="4" style="text-align:right;padding-right:12px;">SUMAS DEL DÍA:</td>
      <td>${totals.out.M}</td>
      <td>${totals.out.P}</td>
      <td>${totals.out.E}</td>
      <td style="border-right:2px solid var(--green-800);">${totals.out.S}</td>
      <td>${totals.ret.M}</td>
      <td>${totals.ret.P}</td>
      <td>${totals.ret.E}</td>
      <td style="border-right:2px solid var(--green-800);">${totals.ret.S}</td>
      <td style="font-size:1rem;background:#dce8d8;">${totals.totalSold}</td>
      <td></td>
    </tr>
  `;
}

async function saveWarehouseDoc(updatedDoc, toastMessage) {
  await executeAdminBatch(currentKeyHash, (batch, proofId) => {
    batch.set(doc(db, "warehouse_days", selectedWhDate), {
      ...updatedDoc,
      date: selectedWhDate,
      proofId,
      updatedAt: serverTimestamp()
    });
  });
  if (toastMessage) showToast(toastMessage);
}

// Date controls
document.getElementById("whDatePicker").addEventListener("change", (e) => {
  if (e.target.value) subscribeWarehouseDay(e.target.value);
});

document.getElementById("btnWhToday").addEventListener("click", () => {
  const today = getLocalDateStr();
  document.getElementById("whDatePicker").value = today;
  subscribeWarehouseDay(today);
});

document.getElementById("btnCopyPrevStock").addEventListener("click", async () => {
  try {
    const parts = selectedWhDate.split("-").map(Number);
    const prevDateObj = new Date(parts[0], parts[1] - 1, parts[2] - 1);
    const prevDateStr = getLocalDateStr(prevDateObj);
    const prevSnap = await getDoc(doc(db, "warehouse_days", prevDateStr));

    if (!prevSnap.exists()) {
      showToast(`No hay registro guardado del día anterior (${prevDateStr}).`);
      return;
    }

    const prevTotals = computeWarehouseTotals(prevSnap.data());
    const nextDoc = {
      ...currentWhDoc,
      openingStock: {
        M: Math.max(0, prevTotals.finalStock.M),
        P: Math.max(0, prevTotals.finalStock.P),
        E: Math.max(0, prevTotals.finalStock.E),
        S: Math.max(0, prevTotals.finalStock.S)
      }
    };
    await saveWarehouseDoc(nextDoc, `Inventario final del ${prevDateStr} cargado como inicial.`);
  } catch (err) {
    console.error(err);
    showToast("Error al consultar el cierre anterior.");
  }
});

// Save Opening Stock & Extra Entries
document.getElementById("whOpeningForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nextDoc = {
    ...currentWhDoc,
    openingStock: {
      M: Math.max(0, Math.floor(Number(document.getElementById("whInitM").value) || 0)),
      P: Math.max(0, Math.floor(Number(document.getElementById("whInitP").value) || 0)),
      E: Math.max(0, Math.floor(Number(document.getElementById("whInitE").value) || 0)),
      S: Math.max(0, Math.floor(Number(document.getElementById("whInitS").value) || 0))
    },
    extraEntries: {
      M: Math.max(0, Math.floor(Number(document.getElementById("whExtraM").value) || 0)),
      P: Math.max(0, Math.floor(Number(document.getElementById("whExtraP").value) || 0)),
      E: Math.max(0, Math.floor(Number(document.getElementById("whExtraE").value) || 0)),
      S: Math.max(0, Math.floor(Number(document.getElementById("whExtraS").value) || 0))
    },
    observations: document.getElementById("whObservations").value.trim()
  };

  try {
    await saveWarehouseDoc(nextDoc, "Inventario base actualizado.");
  } catch (err) {
    console.error(err);
    showToast("No se pudo guardar el inventario base.");
  }
});

// Add New Car Trip
document.getElementById("whNewTripForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const driver = document.getElementById("tripDriver").value;
  const ripeness = document.getElementById("tripRipeness").value;
  const out = {
    M: Math.max(0, Math.floor(Number(document.getElementById("tripOutM").value) || 0)),
    P: Math.max(0, Math.floor(Number(document.getElementById("tripOutP").value) || 0)),
    E: Math.max(0, Math.floor(Number(document.getElementById("tripOutE").value) || 0)),
    S: Math.max(0, Math.floor(Number(document.getElementById("tripOutS").value) || 0))
  };
  const note = document.getElementById("tripNote").value.trim();

  if (out.M + out.P + out.E + out.S <= 0) {
    showToast("Ingresa al menos 1 caja de salida (M, P, E o S).");
    return;
  }

  const now = new Date();
  const timeStr = now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });

  const newTrip = {
    id: "trp_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
    time: timeStr,
    driver,
    ripeness,
    out,
    ret: { M: 0, P: 0, E: 0, S: 0 },
    note
  };

  const nextDoc = {
    ...currentWhDoc,
    trips: [...(currentWhDoc.trips || []), newTrip]
  };

  try {
    await saveWarehouseDoc(nextDoc, `Salida registrada para ${driver} (${ripeness}).`);
    document.getElementById("tripOutM").value = "0";
    document.getElementById("tripOutP").value = "0";
    document.getElementById("tripOutE").value = "0";
    document.getElementById("tripOutS").value = "0";
    document.getElementById("tripNote").value = "";
  } catch (err) {
    console.error(err);
    showToast("Error al registrar salida.");
  }
});

// Edit / Return Modal for Trips (handles both Desktop table and Mobile cards)
const returnModal = document.getElementById("returnModal");

document.getElementById("tabWarehouse").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-edit-trip]");
  if (!btn) return;
  const tripId = btn.dataset.editTrip;
  const trip = (currentWhDoc.trips || []).find((t) => t.id === tripId);
  if (!trip) return;

  document.getElementById("editTripId").value = trip.id;
  document.getElementById("returnModalTitle").textContent = `Vuelta de ${trip.driver} (${trip.time})`;
  document.getElementById("returnModalSubtitle").textContent = "Captura las cajas devueltas sin vender o corrige la salida.";
  document.getElementById("editTripRipeness").value = trip.ripeness || "Surtido";
  document.getElementById("editOutM").value = Number(trip.out?.M) || 0;
  document.getElementById("editOutP").value = Number(trip.out?.P) || 0;
  document.getElementById("editOutE").value = Number(trip.out?.E) || 0;
  document.getElementById("editOutS").value = Number(trip.out?.S) || 0;
  document.getElementById("editRetM").value = Number(trip.ret?.M) || 0;
  document.getElementById("editRetP").value = Number(trip.ret?.P) || 0;
  document.getElementById("editRetE").value = Number(trip.ret?.E) || 0;
  document.getElementById("editRetS").value = Number(trip.ret?.S) || 0;
  document.getElementById("editTripNote").value = trip.note || "";

  returnModal.classList.add("open");
});

document.getElementById("btnCloseReturnModal").addEventListener("click", () => {
  returnModal.classList.remove("open");
});

document.getElementById("returnTripForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tripId = document.getElementById("editTripId").value;
  const updatedTrips = (currentWhDoc.trips || []).map((t) => {
    if (t.id !== tripId) return t;
    return {
      ...t,
      ripeness: document.getElementById("editTripRipeness").value,
      out: {
        M: Math.max(0, Math.floor(Number(document.getElementById("editOutM").value) || 0)),
        P: Math.max(0, Math.floor(Number(document.getElementById("editOutP").value) || 0)),
        E: Math.max(0, Math.floor(Number(document.getElementById("editOutE").value) || 0)),
        S: Math.max(0, Math.floor(Number(document.getElementById("editOutS").value) || 0))
      },
      ret: {
        M: Math.max(0, Math.floor(Number(document.getElementById("editRetM").value) || 0)),
        P: Math.max(0, Math.floor(Number(document.getElementById("editRetP").value) || 0)),
        E: Math.max(0, Math.floor(Number(document.getElementById("editRetE").value) || 0)),
        S: Math.max(0, Math.floor(Number(document.getElementById("editRetS").value) || 0))
      },
      note: document.getElementById("editTripNote").value.trim()
    };
  });

  try {
    await saveWarehouseDoc({ ...currentWhDoc, trips: updatedTrips }, "Devolución actualizada.");
    returnModal.classList.remove("open");
  } catch (err) {
    console.error(err);
    showToast("Error al guardar devolución.");
  }
});

document.getElementById("btnDeleteTrip").addEventListener("click", async () => {
  const tripId = document.getElementById("editTripId").value;
  if (!confirm("¿Eliminar este registro de vuelta del almacén?")) return;
  const updatedTrips = (currentWhDoc.trips || []).filter((t) => t.id !== tripId);
  try {
    await saveWarehouseDoc({ ...currentWhDoc, trips: updatedTrips }, "Vuelta eliminada.");
    returnModal.classList.remove("open");
  } catch (err) {
    console.error(err);
    showToast("No se pudo eliminar la vuelta.");
  }
});

// Print Daily Warehouse Sheet
document.getElementById("btnPrintWarehouse").addEventListener("click", () => {
  const totals = computeWarehouseTotals(currentWhDoc);
  const area = document.getElementById("printReceiptArea");

  const rowsHtml = (currentWhDoc.trips || [])
    .map((t, i) => {
      const oM = Number(t.out?.M) || 0;
      const oP = Number(t.out?.P) || 0;
      const oE = Number(t.out?.E) || 0;
      const oS = Number(t.out?.S) || 0;
      const rM = Number(t.ret?.M) || 0;
      const rP = Number(t.ret?.P) || 0;
      const rE = Number(t.ret?.E) || 0;
      const rS = Number(t.ret?.S) || 0;
      const net = (oM + oP + oE + oS) - (rM + rP + rE + rS);
      return `
        <tr>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${i + 1}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${escapeHtml(t.time)}</td>
          <td style="border:1px solid #264428;padding:4px;font-weight:700;">${escapeHtml(t.driver)}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${escapeHtml(t.ripeness || "")}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${oM}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${oP}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${oE}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${oS}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${rM}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${rP}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${rE}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;">${rS}</td>
          <td style="border:1px solid #264428;padding:4px;text-align:center;font-weight:800;">${net}</td>
        </tr>
      `;
    })
    .join("");

  area.innerHTML = `
    <div style="font-size:9pt;color:#111;">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #264428;padding-bottom:8px;margin-bottom:10px;">
        <img src="assets/logo-salinas.png" style="height:16mm;object-fit:contain;" alt="Salinas">
        <div style="text-align:right;">
          <strong style="font-size:12pt;color:#264428;">REPORTE DIARIO DE ALMACÉN</strong>
          <div>Fecha: <strong>${escapeHtml(selectedWhDate)}</strong></div>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
        <thead>
          <tr style="background:#264428;color:#fff;">
            <th style="padding:5px;border:1px solid #264428;">#</th>
            <th style="padding:5px;border:1px solid #264428;">HORA</th>
            <th style="padding:5px;border:1px solid #264428;text-align:left;">CHOFER</th>
            <th style="padding:5px;border:1px solid #264428;">MADUREZ</th>
            <th style="padding:5px;border:1px solid #264428;">SAL M</th>
            <th style="padding:5px;border:1px solid #264428;">SAL P</th>
            <th style="padding:5px;border:1px solid #264428;">SAL E</th>
            <th style="padding:5px;border:1px solid #264428;">SAL S</th>
            <th style="padding:5px;border:1px solid #264428;">DEV M</th>
            <th style="padding:5px;border:1px solid #264428;">DEV P</th>
            <th style="padding:5px;border:1px solid #264428;">DEV E</th>
            <th style="padding:5px;border:1px solid #264428;">DEV S</th>
            <th style="padding:5px;border:1px solid #264428;">VENDIDO</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <table style="width:65%;border-collapse:collapse;margin-bottom:16px;">
        <thead>
          <tr style="background:#eef4ec;color:#264428;">
            <th style="border:1px solid #264428;padding:5px;text-align:left;">CORTE DE ALMACÉN</th>
            <th style="border:1px solid #264428;padding:5px;">M</th>
            <th style="border:1px solid #264428;padding:5px;">P</th>
            <th style="border:1px solid #264428;padding:5px;">E</th>
            <th style="border:1px solid #264428;padding:5px;">S</th>
            <th style="border:1px solid #264428;padding:5px;">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #264428;padding:5px;">Inventario Inicial + Cámara</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.init.M + totals.extra.M}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.init.P + totals.extra.P}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.init.E + totals.extra.E}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.init.S + totals.extra.S}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;font-weight:700;">${totals.totalInit + totals.totalExtra}</td>
          </tr>
          <tr>
            <td style="border:1px solid #264428;padding:5px;">(−) Total Vendido Neto (Total V.)</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.sold.M}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.sold.P}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.sold.E}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.sold.S}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;font-weight:700;">${totals.totalSold}</td>
          </tr>
          <tr style="font-weight:900;background:#f4f8f3;">
            <td style="border:1px solid #264428;padding:5px;">(=) INVENTARIO FINAL (T. INV.)</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.finalStock.M}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.finalStock.P}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.finalStock.E}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.finalStock.S}</td>
            <td style="border:1px solid #264428;padding:5px;text-align:center;">${totals.totalFinal}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  document.body.classList.add("printing-receipt");
  window.print();
  setTimeout(() => document.body.classList.remove("printing-receipt"), 500);
});

// ================= KPI UPDATES =================
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

  for (const ord of allOrders) {
    if (ord.status === "nuevo") newCount++;
    if (ord.status === "confirmado" || ord.status === "en_ruta") activeCount++;

    if (isSameLocalDay(ord.createdAtIso) && ord.status !== "cancelado") {
      if (ord.status === "entregado") deliveredToday++;
      boxesToday += Number(ord.totalBoxes) || 0;
      revToday += Number(ord.totalAmount) || 0;
    }
  }

  const whTotals = computeWarehouseTotals(currentWhDoc);

  document.getElementById("kpiNewCount").textContent = String(newCount);
  document.getElementById("kpiActiveCount").textContent = String(activeCount);
  document.getElementById("kpiDeliveredSub").textContent = `${deliveredToday} entregado${deliveredToday === 1 ? "" : "s"} hoy`;
  document.getElementById("kpiWarehouseStock").textContent = String(whTotals.totalFinal);
  document.getElementById("kpiWarehouseSub").textContent = `M:${whTotals.finalStock.M} • P:${whTotals.finalStock.P} • E:${whTotals.finalStock.E} • S:${whTotals.finalStock.S}`;
  document.getElementById("kpiRevenueToday").textContent = formatCurrency(revToday);
  document.getElementById("kpiCalibersSub").textContent = `Pedidos Web hoy: ${boxesToday} caja${boxesToday === 1 ? "" : "s"}`;
}

// ================= TAB 2: ORDERS =================
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
        .map(([val, lbl]) => `<option value="${val}" ${ord.status === val ? "selected" : ""}>${lbl}</option>`)
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
              <button type="button" class="btn btn-outline btn-sm" data-action="edit-total" data-id="${ord.id}">Ajustar $</button>
              <button type="button" class="btn btn-outline btn-sm" data-action="print-order" data-id="${ord.id}">🖨️ Imprimir Nota</button>
            </div>
          </div>

          <div class="order-admin-grid">
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

            <div>
              <div style="font-size:0.8rem;font-weight:800;color:var(--slate-500);text-transform:uppercase;">
                Desglose (${ord.totalBoxes} caja${ord.totalBoxes === 1 ? "" : "s"})
              </div>
              <div class="caliber-breakdown-chips">${chipsHtml}</div>
            </div>

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

document.getElementById("ordersAdminContainer").addEventListener("change", async (e) => {
  const statusSel = e.target.closest(".order-status-select");
  if (statusSel) {
    const orderId = statusSel.dataset.id;
    const newStatus = statusSel.value;
    try {
      await executeAdminBatch(currentKeyHash, (batch, proofId) => {
        batch.update(doc(db, "orders", orderId), { status: newStatus, proofId, updatedAt: serverTimestamp() });
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
        batch.update(doc(db, "orders", orderId), { totalAmount: newTotal, proofId, updatedAt: serverTimestamp() });
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
        <tbody>${rowsHtml}</tbody>
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
  setTimeout(() => document.body.classList.remove("printing-receipt"), 500);
}

// ================= TAB 3: CATALOG & BROADCAST GENERATOR =================
function buildMorningBroadcastText() {
  const cals = Object.values(storeSettings.calibers || DEFAULT_STORE_SETTINGS.calibers)
    .filter((c) => c.available !== false)
    .sort((a, b) => (a.order || 99) - (b.order || 99));

  const lines = cals.map((c) => `🥑 *${c.name}:* ${formatCurrency(c.price)} / caja`).join("\n");
  const siteUrl = window.location.origin;

  return (
    `¡Buenos días! ☀️ En *Comercializadora Salinas* ya tenemos aguacate fresco seleccionado para tu negocio.\n\n` +
    `*Precios por caja de hoy:*\n${lines}\n\n` +
    `👉 *Haz tu pedido rápido en 20 segundos eligiendo calibre y madurez aquí:*\n${siteUrl}\n\n` +
    `¡Gracias por tu preferencia!`
  );
}

function updateBroadcastPreview() {
  const el = document.getElementById("broadcastPreviewBox");
  if (el) el.textContent = buildMorningBroadcastText();
}

document.getElementById("btnCopyBroadcastMsg").addEventListener("click", async () => {
  const txt = buildMorningBroadcastText();
  try {
    await navigator.clipboard.writeText(txt);
    showToast("¡Mensaje copiado! Ya puedes pegarlo en tus Listas de Difusión de WhatsApp.");
  } catch (_) {
    showToast("Selecciona el texto del recuadro y cópialo.");
  }
});

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
      if (updatedCalibers[code]) updatedCalibers[code].price = Math.max(1, Math.round(Number(inp.value) || 0));
    });
    document.querySelectorAll(".cal-avail-input").forEach((sel) => {
      const code = sel.dataset.code;
      if (updatedCalibers[code]) updatedCalibers[code].available = sel.value === "true";
    });
    document.querySelectorAll(".cal-badge-input").forEach((inp) => {
      const code = inp.dataset.code;
      if (updatedCalibers[code]) updatedCalibers[code].badge = inp.value.trim();
    });
    document.querySelectorAll(".cal-desc-input").forEach((inp) => {
      const code = inp.dataset.code;
      if (updatedCalibers[code]) updatedCalibers[code].description = inp.value.trim();
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
      batch.set(doc(db, "settings", "store"), { ...newSettings, proofId, updatedAt: serverTimestamp() });
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

// ================= TAB 4: EDITABLE DRIVERS & SECURITY =================
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
      <div class="driver-edit-row">
        <input type="text" class="form-control drv-edit-name" data-idx="${idx}" value="${escapeHtml(drv.name)}" placeholder="Nombre" style="font-weight:700;">
        <input type="tel" class="form-control drv-edit-phone" data-idx="${idx}" value="${escapeHtml(drv.phone || "")}" placeholder="WhatsApp (10 dígitos)">
        <button type="button" class="btn btn-primary btn-sm" data-save-driver="${idx}">Guardar</button>
        <button type="button" class="btn btn-outline btn-sm" data-remove-driver="${idx}" style="color:var(--red-600);border-color:#eccaca;">Quitar</button>
      </div>
    `
    )
    .join("");
}

document.getElementById("driversListEditor").addEventListener("click", async (e) => {
  const saveBtn = e.target.closest("button[data-save-driver]");
  if (saveBtn) {
    const idx = Number(saveBtn.dataset.saveDriver);
    const nameInput = document.querySelector(`.drv-edit-name[data-idx='${idx}']`);
    const phoneInput = document.querySelector(`.drv-edit-phone[data-idx='${idx}']`);
    const newName = nameInput ? nameInput.value.trim() : "";
    const newPhone = phoneInput ? phoneInput.value.trim() : "";

    if (!newName) {
      showToast("El nombre del chofer no puede quedar vacío.");
      return;
    }

    const updatedDrivers = [...(storeSettings.drivers || [])];
    if (updatedDrivers[idx]) {
      updatedDrivers[idx] = { ...updatedDrivers[idx], name: newName, phone: newPhone };
    }

    try {
      await executeAdminBatch(currentKeyHash, (batch, proofId) => {
        batch.set(doc(db, "settings", "store"), {
          ...storeSettings,
          drivers: updatedDrivers,
          proofId,
          updatedAt: serverTimestamp()
        });
      });
      showToast(`Datos de ${newName} guardados.`);
    } catch (err) {
      console.error(err);
      showToast("No se pudieron guardar los cambios del chofer.");
    }
    return;
  }

  const removeBtn = e.target.closest("button[data-remove-driver]");
  if (removeBtn) {
    const idx = Number(removeBtn.dataset.removeDriver);
    const drv = (storeSettings.drivers || [])[idx];
    if (!confirm(`¿Quitar a ${drv?.name || "este chofer"} de la lista?`)) return;
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
  }
});

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
      batch.set(doc(db, "settings", "store"), {
        ...storeSettings,
        drivers: updatedDrivers,
        proofId,
        updatedAt: serverTimestamp()
      });
    });
    nameInp.value = "";
    phoneInp.value = "";
    showToast(`Chofer ${name} agregado.`);
  } catch (err) {
    console.error(err);
    showToast("No se pudo agregar el chofer.");
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
      batch.set(doc(db, "admin_keys", newHash), { active: true, proofId, createdAt: serverTimestamp() });
      batch.update(doc(db, "admin_keys", oldHash), { active: false, proofId, revokedAt: serverTimestamp() });
    });

    currentKeyHash = newHash;
    if (localStorage.getItem(SESSION_HASH_KEY)) {
      localStorage.setItem(SESSION_HASH_KEY, newHash);
    } else {
      sessionStorage.setItem(SESSION_HASH_KEY, newHash);
    }

    document.getElementById("newAdminPass1").value = "";
    document.getElementById("newAdminPass2").value = "";
    showToast("¡Clave de administración actualizada!");
  } catch (err) {
    console.error(err);
    showToast("Error al actualizar la clave.");
  }
});

checkInitialAuth();
