import {
  db,
  doc,
  getDoc,
  setDoc,
  collection,
  onSnapshot,
  serverTimestamp,
  DEFAULT_STORE_SETTINGS,
  COLD_ROOMS,
  normalizeColdRoom,
  LOT_GRADES,
  LOT_QUALITIES,
  LOT_RIPENESS,
  computeWarehousePinHash,
  executeWarehouseBatch,
  getLocalDateStr,
  formatCurrency
} from "./firebase-config.js";

const WH_SESSION_KEY = "salinas_warehouse_session_v1";

let storeSettings = { ...DEFAULT_STORE_SETTINGS, warehouseStaff: [{ id: "alm_1", name: "Almacenista 1" }] };
let currentStaffName = null;
let currentWhKeyHash = null;
let allLots = [];
let allThermos = [];
let selectedLotId = null;
let roomFilter = "all";
let qrScanner = null;
let qrScanning = false;

const whLoginView = document.getElementById("whLoginView");
const whAppMain = document.getElementById("whAppMain");
const whBottomNav = document.getElementById("whBottomNav");
const whTopActions = document.getElementById("whTopActions");
const topWarehouseName = document.getElementById("topWarehouseName");
const loginWhSelect = document.getElementById("loginWhSelect");
const loginWhPin = document.getElementById("loginWhPin");
const toastBox = document.getElementById("toastBox");

let toastTimer = null;
function showToast(msg) {
  toastBox.textContent = msg;
  toastBox.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastBox.classList.remove("show"), 3200);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function daysBetween(isoDate) {
  if (!isoDate) return 0;
  const start = new Date(`${isoDate}T00:00:00`);
  const now = new Date();
  return Math.max(0, Math.floor((now - start) / (1000 * 60 * 60 * 24)));
}

function renderChips(containerId, items, activeVal, onSelect) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items
    .map((item) => {
      const val = typeof item === "string" ? item : item.value;
      const lbl = typeof item === "string" ? item : item.label;
      return `<button type="button" class="alm-choice-btn ${val === activeVal ? "active" : ""}" data-val="${escapeHtml(val)}">${escapeHtml(lbl)}</button>`;
    })
    .join("");
  el.onclick = (e) => {
    const btn = e.target.closest("button[data-val]");
    if (!btn) return;
    const chosen = btn.dataset.val;
    el.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.val === chosen));
    if (onSelect) onSelect(chosen);
  };
}

function getSelectedChip(containerId, fallback) {
  const active = document.querySelector(`#${containerId} button.active`);
  return active ? active.dataset.val : fallback;
}

// ================= SETTINGS & AUTH =================
onSnapshot(doc(db, "settings", "store"), (snap) => {
  if (snap.exists()) {
    const d = snap.data();
    storeSettings = {
      ...DEFAULT_STORE_SETTINGS,
      ...d,
      drivers: Array.isArray(d.drivers) && d.drivers.length ? d.drivers : DEFAULT_STORE_SETTINGS.drivers,
      warehouseStaff: Array.isArray(d.warehouseStaff) && d.warehouseStaff.length
        ? d.warehouseStaff
        : [{ id: "alm_1", name: "Almacenista 1" }]
    };
  }
  populateWhStaffSelect();
  populateLoadDrivers();
});

function populateWhStaffSelect() {
  const list = storeSettings.warehouseStaff || [{ name: "Almacenista 1" }];
  const prev = loginWhSelect.value;
  loginWhSelect.innerHTML = list
    .map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`)
    .join("");
  if (prev && list.some((s) => s.name === prev)) loginWhSelect.value = prev;
}

function populateLoadDrivers() {
  const sel = document.getElementById("loadDriverSelect");
  if (!sel) return;
  const drivers = storeSettings.drivers || [];
  sel.innerHTML = drivers
    .map((d) => `<option value="${escapeHtml(d.name)}">🚗 ${escapeHtml(d.name)}</option>`)
    .join("");
}

document.getElementById("whLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const staffName = loginWhSelect.value;
  const pin = loginWhPin.value.trim();
  if (!staffName || pin.length < 4) {
    showToast("Selecciona tu nombre e ingresa tu PIN (mínimo 4 dígitos).");
    return;
  }
  const btn = document.getElementById("btnWhLogin");
  btn.disabled = true;
  btn.textContent = "Verificando PIN...";
  try {
    const hash = await computeWarehousePinHash(staffName, pin);
    const snap = await getDoc(doc(db, "warehouse_keys", hash));
    if (!snap.exists() || snap.data().active !== true) {
      showToast("PIN incorrecto o no activado. Pídelo en Administración.");
      return;
    }
    currentStaffName = staffName;
    currentWhKeyHash = hash;
    const payload = JSON.stringify({ staffName, keyHash: hash });
    if (document.getElementById("rememberWhSession").checked) {
      localStorage.setItem(WH_SESSION_KEY, payload);
    } else {
      sessionStorage.setItem(WH_SESSION_KEY, payload);
    }
    loginWhPin.value = "";
    enterWarehouseApp();
    showToast(`Bienvenido a Almacén, ${staffName}`);
  } catch (err) {
    console.error(err);
    showToast("Error verificando PIN.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Entrar al Almacén";
  }
});

async function restoreWhSession() {
  try {
    const raw = localStorage.getItem(WH_SESSION_KEY) || sessionStorage.getItem(WH_SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed?.staffName || !parsed?.keyHash) return;
    const snap = await getDoc(doc(db, "warehouse_keys", parsed.keyHash));
    if (snap.exists() && snap.data().active === true) {
      currentStaffName = parsed.staffName;
      currentWhKeyHash = parsed.keyHash;
      enterWarehouseApp();
    } else {
      localStorage.removeItem(WH_SESSION_KEY);
      sessionStorage.removeItem(WH_SESSION_KEY);
    }
  } catch (_) {}
}

async function goWarehouseHome() {
  if (!currentStaffName) return;
  await stopQrCamera();
  selectedLotId = null;
  const card = document.getElementById("scannedLotCard");
  if (card) card.style.display = "none";
  const sel = document.getElementById("manualLotSelect");
  if (sel) sel.value = "";
  switchPane("paneScan");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.getElementById("btnWhHome")?.addEventListener("click", goWarehouseHome);
document.getElementById("btnWhHomeLogo")?.addEventListener("click", (e) => {
  e.preventDefault();
  goWarehouseHome();
});

document.getElementById("btnWhLogout").addEventListener("click", async () => {
  await stopQrCamera();
  currentStaffName = null;
  currentWhKeyHash = null;
  localStorage.removeItem(WH_SESSION_KEY);
  sessionStorage.removeItem(WH_SESSION_KEY);
  whAppMain.style.display = "none";
  whBottomNav.style.display = "none";
  whTopActions.style.display = "none";
  topWarehouseName.textContent = "❄️ Almacén";
  whLoginView.style.display = "flex";
});

function enterWarehouseApp() {
  whLoginView.style.display = "none";
  whAppMain.style.display = "block";
  whBottomNav.style.display = "grid";
  whTopActions.style.display = "flex";
  topWarehouseName.textContent = `❄️ ${currentStaffName}`;
  startLotsListener();
}

// ================= NAVIGATION =================
function switchPane(paneId) {
  document.querySelectorAll("#whBottomNav .drv-nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.pane === paneId);
  });
  document.querySelectorAll(".wh-pane").forEach((p) => {
    p.style.display = p.id === paneId ? "block" : "none";
  });
}

document.querySelectorAll("#whBottomNav .drv-nav-btn").forEach((b) => {
  b.addEventListener("click", () => switchPane(b.dataset.pane));
});

document.querySelectorAll(".alm-action-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".alm-action-tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".wh-act-pane").forEach((p) => {
      p.style.display = p.id === btn.dataset.whAct ? "block" : "none";
    });
  });
});

// ================= FIRESTORE LISTENERS =================
let lotsUnsub = null;
let thermosUnsub = null;
let whDayUnsub = null;
let todayWhTrips = [];
function startLotsListener() {
  if (lotsUnsub) lotsUnsub();
  if (thermosUnsub) thermosUnsub();
  if (whDayUnsub) whDayUnsub();

  whDayUnsub = onSnapshot(doc(db, "warehouse_days", getLocalDateStr()), (snap) => {
    todayWhTrips = snap.exists() && Array.isArray(snap.data().trips) ? snap.data().trips : [];
    renderLoadsTodayPane();
  });

  thermosUnsub = onSnapshot(collection(db, "thermos"), (snap) => {
    allThermos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  });

  lotsUnsub = onSnapshot(collection(db, "pallet_lots"), (snap) => {
    allLots = snap.docs
      .map((d) => {
        const data = d.data();
        return { id: d.id, ...data, coldRoom: normalizeColdRoom(data.coldRoom) };
      })
      .sort((a, b) => String(a.lotCode || a.id).localeCompare(String(b.lotCode || b.id)));
    renderQuickKpiStrip();
    populateManualLotSelect();
    renderColdRoomsPane();
    renderLoadsTodayPane();
    if (selectedLotId) {
      const fresh = allLots.find((l) => l.id === selectedLotId);
      if (fresh) openLotCard(fresh);
    }
  });
}

function renderQuickKpiStrip() {
  const strip = document.getElementById("whQuickKpiStrip");
  if (!strip) return;
  const active = allLots.filter((l) => (Number(l.remainingBoxes) || 0) > 0);
  let coldBoxes = 0;
  let empBoxes = 0;
  let pisoBoxes = 0;
  for (const l of active) {
    const q = Number(l.remainingBoxes) || 0;
    if (l.coldRoom === "Emplayado / Quiebre") empBoxes += q;
    else if (l.coldRoom === "Piso") pisoBoxes += q;
    else coldBoxes += q;
  }
  strip.innerHTML = `
    <div class="alm-kpi-tile" data-jump-room="all">
      <span class="k-lbl">❄️ Cuartos Fríos</span>
      <span class="k-val">${coldBoxes} cjs</span>
    </div>
    <div class="alm-kpi-tile" data-jump-room="Emplayado / Quiebre">
      <span class="k-lbl">⏳ Emplayado</span>
      <span class="k-val">${empBoxes} cjs</span>
    </div>
    <div class="alm-kpi-tile" data-jump-room="Piso">
      <span class="k-lbl">✅ En Piso</span>
      <span class="k-val">${pisoBoxes} cjs</span>
    </div>
  `;
  strip.querySelectorAll("[data-jump-room]").forEach((tile) => {
    tile.addEventListener("click", () => {
      roomFilter = tile.dataset.jumpRoom || "all";
      renderColdRoomsPane();
      switchPane("paneRooms");
    });
  });
}

function populateManualLotSelect() {
  const sel = document.getElementById("manualLotSelect");
  if (!sel) return;
  const active = allLots.filter((l) => l.state !== "agotado");
  const exhausted = allLots.filter((l) => l.state === "agotado");
  sel.innerHTML = [
    `<option value="">— Elige tarima (${active.length} activas) —</option>`,
    ...active.map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.lotCode)} • ${escapeHtml(LOT_GRADES[l.grade]?.short || l.grade)} (${l.remainingBoxes ?? 0} cjs) • ${escapeHtml(l.coldRoom || "Sin ubicar")}</option>`),
    ...exhausted.slice(0, 15).map((l) => `<option value="${escapeHtml(l.id)}">[Agotado] ${escapeHtml(l.lotCode)}</option>`)
  ].join("");
  if (selectedLotId) sel.value = selectedLotId;
}

document.getElementById("manualLotSelect")?.addEventListener("change", (e) => {
  const id = e.target.value;
  if (!id) return;
  const lot = allLots.find((l) => l.id === id);
  if (lot) openLotCard(lot);
});

document.getElementById("btnCloseLotCard")?.addEventListener("click", () => {
  selectedLotId = null;
  document.getElementById("scannedLotCard").style.display = "none";
  const sel = document.getElementById("manualLotSelect");
  if (sel) sel.value = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ================= CAMERA QR SCANNER =================
document.getElementById("btnStartQrScan").addEventListener("click", startQrCamera);
document.getElementById("btnStopQrScan").addEventListener("click", stopQrCamera);

async function startQrCamera() {
  const box = document.getElementById("qrReaderBox");
  if (typeof window.Html5Qrcode === "undefined") {
    showToast("No cargó el lector QR. Revisa tu conexión.");
    return;
  }
  box.style.display = "block";
  document.getElementById("btnStartQrScan").style.display = "none";
  document.getElementById("btnStopQrScan").style.display = "inline-block";

  try {
    qrScanner = new window.Html5Qrcode("qrReaderBox");
    qrScanning = true;
    await qrScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      async (decodedText) => {
        const clean = String(decodedText || "").trim();
        let lotId = clean;
        if (clean.startsWith("SALINAS_LOT:")) lotId = clean.slice("SALINAS_LOT:".length).trim();
        const found = allLots.find((l) => l.id === lotId || l.lotCode === lotId);
        await stopQrCamera();
        if (found) {
          openLotCard(found);
          showToast(`✅ Tarima ${found.lotCode} escaneada`);
        } else {
          showToast(`QR "${lotId}" no encontrado en lotes activos.`);
        }
      },
      () => {}
    );
  } catch (err) {
    console.error("Camera error:", err);
    showToast("Permite el acceso a la cámara del celular/tablet para escanear.");
    await stopQrCamera();
  }
}

async function stopQrCamera() {
  try {
    if (qrScanner && qrScanning) {
      await qrScanner.stop();
      await qrScanner.clear();
    }
  } catch (_) {}
  qrScanning = false;
  qrScanner = null;
  document.getElementById("qrReaderBox").style.display = "none";
  document.getElementById("btnStartQrScan").style.display = "inline-block";
  document.getElementById("btnStopQrScan").style.display = "none";
}

// ================= OPEN SCANNED LOT CARD =================
function openLotCard(lot) {
  selectedLotId = lot.id;
  const card = document.getElementById("scannedLotCard");
  card.style.display = "block";

  const isPro = lot.grade === "PRO" || lot.kind === "proceso";
  const badge = document.getElementById("scLotBadge");
  badge.className = `alm-badge ${isPro ? "pro" : "cls"}`;
  badge.textContent = isPro ? "PROCESO (TRANSICIÓN)" : `${LOT_GRADES[lot.grade]?.short || lot.grade} • ${lot.quality || "Limpio"}`;

  document.getElementById("scLotCode").textContent = lot.lotCode || lot.id;
  const days = daysBetween(lot.arrivalDate);
  const rem = Number(lot.remainingBoxes) || 0;
  document.getElementById("scLotBoxes").textContent = `${rem} cajas`;
  document.getElementById("scLotKg").textContent = `${(rem * 10).toLocaleString("es-MX")} kg`;
  document.getElementById("scLotMeta").innerHTML = `
    ❄️ <strong>${escapeHtml(lot.coldRoom || "Sin ubicar")}</strong> •
    Madurez: <strong>${escapeHtml(lot.ripeness || "Verde")}</strong> •
    Antigüedad: <strong>${days} día(s)</strong> (Llegó ${escapeHtml(lot.arrivalDate || "-")})
  `;

  // Populate action 1: Receive/Locate
  renderChips("rcvRoomChips", COLD_ROOMS, lot.coldRoom || "Cuarto 1");
  document.getElementById("rcvBoxesInput").value = rem || lot.initialBoxes || 100;
  renderChips(
    "rcvGradeChips",
    Object.values(LOT_GRADES).map((g) => ({ value: g.code, label: g.short })),
    lot.grade || "PRO"
  );
  renderChips("rcvQualityChips", LOT_QUALITIES, lot.quality || (isPro ? "Proceso" : "Limpio"));
  renderChips("rcvRipenessChips", LOT_RIPENESS, lot.ripeness || "Verde");

  // Populate action 2: Convert Proceso
  document.querySelectorAll(".conv-qty").forEach((inp) => (inp.value = 0));
  document.getElementById("convMermaQty").value = 0;
  renderChips("convQualityChips", ["Limpio", "Semilimpio"], "Limpio");
  renderChips("convRipenessChips", LOT_RIPENESS, lot.ripeness || "Verde");
  renderChips("convRoomChips", COLD_ROOMS, "Cuarto 1");
  updateConvertBalance(rem);

  // Populate action 3: Load driver
  document.getElementById("loadBoxesInput").value = Math.min(rem || 10, 40);

  // Populate action 4: Direct Sale
  const gradeToCaliber = { S: "40s", E: "48s", P: "60s", M: "70s", C: "84s" };
  const calKey = gradeToCaliber[lot.grade] || "60s";
  const defaultUnitPrice = Number(storeSettings.calibers?.[calKey]?.price) || 400;
  const dsBoxesEl = document.getElementById("dsBoxesInput");
  const dsPriceEl = document.getElementById("dsPriceInput");
  if (dsBoxesEl) {
    dsBoxesEl.max = Math.max(1, rem);
    dsBoxesEl.value = Math.min(rem || 1, 5);
  }
  if (dsPriceEl) dsPriceEl.value = defaultUnitPrice;
  updateDirectSalePreview();

  // Populate action 5: Adjust / Move / Split
  renderChips("adjRoomChips", COLD_ROOMS, lot.coldRoom || "Cuarto 1");
  renderChips("adjRipenessChips", LOT_RIPENESS, lot.ripeness || "Verde");
  const adjMoveEl = document.getElementById("adjMoveBoxesInput");
  if (adjMoveEl) {
    adjMoveEl.max = Math.max(1, rem);
    adjMoveEl.value = rem;
  }
  document.getElementById("adjMermaInput").value = 0;

  // Hide "Convertir Proceso" tab if pallet is NOT Proceso
  const convTabBtn = document.querySelector('.alm-action-tab[data-wh-act="actConvert"]');
  if (convTabBtn) convTabBtn.style.display = isPro ? "" : "none";

  // Auto-select best tab: if Proceso -> Convert, else Receive/Move
  const defaultTab = isPro && lot.coldRoom && rem > 0 ? "actConvert" : rem > 0 ? "actReceive" : "actAdjust";
  document.querySelectorAll(".alm-action-tab").forEach((b) => b.classList.toggle("active", b.dataset.whAct === defaultTab));
  document.querySelectorAll(".wh-act-pane").forEach((p) => (p.style.display = p.id === defaultTab ? "block" : "none"));

  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function updateConvertBalance(targetBoxes) {
  let sum = 0;
  document.querySelectorAll(".conv-qty").forEach((i) => (sum += Math.max(0, Number(i.value) || 0)));
  const merma = Math.max(0, Number(document.getElementById("convMermaQty").value) || 0);
  const total = sum + merma;
  const bar = document.getElementById("convBalanceBar");
  if (total === targetBoxes && total > 0) {
    bar.className = "alm-balance-bar ok";
    bar.textContent = `${total} / ${targetBoxes} cajas ✅ Cuadra exacto`;
  } else if (total > targetBoxes) {
    bar.className = "alm-balance-bar over";
    bar.textContent = `${total} / ${targetBoxes} cajas ⚠️ Te pasaste por ${total - targetBoxes}`;
  } else {
    bar.className = "alm-balance-bar partial";
    bar.textContent = `${total} / ${targetBoxes} cajas (quedarían ${targetBoxes - total} en tarima)`;
  }
}

document.querySelectorAll(".conv-qty, #convMermaQty").forEach((inp) => {
  inp.addEventListener("input", () => {
    const lot = allLots.find((l) => l.id === selectedLotId);
    updateConvertBalance(Number(lot?.remainingBoxes) || 0);
  });
});

// ================= SAVE ACTIONS =================
document.getElementById("btnSaveReceive").addEventListener("click", async () => {
  const lot = allLots.find((l) => l.id === selectedLotId);
  if (!lot) return;
  const coldRoom = getSelectedChip("rcvRoomChips", "Cuarto 1");
  const boxes = Math.max(0, Number(document.getElementById("rcvBoxesInput").value) || 0);
  const grade = getSelectedChip("rcvGradeChips", lot.grade || "PRO");
  const quality = getSelectedChip("rcvQualityChips", "Proceso");
  const ripeness = getSelectedChip("rcvRipenessChips", "Verde");

  const events = Array.isArray(lot.events) ? [...lot.events] : [];
  events.push({
    type: "ubicacion",
    by: currentStaffName,
    atIso: new Date().toISOString(),
    note: `${coldRoom} • ${boxes} cjs • ${LOT_GRADES[grade]?.short || grade} (${quality}, ${ripeness})`
  });

  try {
    await executeWarehouseBatch(currentWhKeyHash, (batch, proofId) => {
      batch.set(
        doc(db, "pallet_lots", lot.id),
        {
          coldRoom,
          grade,
          kind: grade === "PRO" ? "proceso" : "clasificado",
          quality,
          ripeness,
          initialBoxes: lot.initialBoxes || boxes,
          remainingBoxes: boxes,
          state: boxes > 0 ? "disponible" : "agotado",
          events: events.slice(-25),
          updatedAtIso: new Date().toISOString(),
          proofId
        },
        { merge: true }
      );
    });
    showToast(`✅ ${lot.lotCode} guardado en ${coldRoom}`);
  } catch (err) {
    console.error(err);
    showToast("Error guardando en Firestore.");
  }
});

document.getElementById("btnConfirmConvert").addEventListener("click", async () => {
  const lot = allLots.find((l) => l.id === selectedLotId);
  if (!lot) return;
  const avail = Number(lot.remainingBoxes) || 0;
  const outputs = {};
  let sumGood = 0;
  document.querySelectorAll(".conv-qty").forEach((i) => {
    const qty = Math.max(0, Number(i.value) || 0);
    if (qty > 0) {
      outputs[i.dataset.grade] = qty;
      sumGood += qty;
    }
  });
  const merma = Math.max(0, Number(document.getElementById("convMermaQty").value) || 0);
  const totalUsed = sumGood + merma;
  if (totalUsed <= 0) return showToast("Captura al menos 1 caja clasificada o merma.");
  if (totalUsed > avail) return showToast(`No puedes convertir ${totalUsed} cajas: solo quedan ${avail}.`);

  const quality = getSelectedChip("convQualityChips", "Limpio");
  const ripeness = getSelectedChip("convRipenessChips", "Verde");
  const coldRoom = getSelectedChip("convRoomChips", "Cuarto 1");
  const newRem = avail - totalUsed;

  const events = Array.isArray(lot.events) ? [...lot.events] : [];
  events.push({
    type: "conversion",
    by: currentStaffName,
    atIso: new Date().toISOString(),
    note: `Convertidas ${sumGood} cjs + ${merma} merma (${quality}, ${ripeness})`
  });

  try {
    await executeWarehouseBatch(currentWhKeyHash, (batch, proofId) => {
      batch.set(
        doc(db, "pallet_lots", lot.id),
        {
          remainingBoxes: newRem,
          mermaBoxes: (Number(lot.mermaBoxes) || 0) + merma,
          state: newRem > 0 ? "disponible" : "agotado",
          events: events.slice(-25),
          updatedAtIso: new Date().toISOString(),
          proofId
        },
        { merge: true }
      );

      const stamp = Date.now().toString(36).slice(-4);
      for (const [gCode, qty] of Object.entries(outputs)) {
        const subId = `${lot.id}_${gCode}_${stamp}`;
        const subCode = `${lot.lotCode}-${gCode}`;
        batch.set(doc(db, "pallet_lots", subId), {
          lotCode: subCode,
          thermoId: lot.thermoId || "",
          thermoCode: lot.thermoCode || "",
          parentLotId: lot.id,
          arrivalDate: lot.arrivalDate || getLocalDateStr(),
          coldRoom,
          grade: gCode,
          kind: "clasificado",
          quality,
          ripeness,
          initialBoxes: qty,
          remainingBoxes: qty,
          mermaBoxes: 0,
          state: "disponible",
          events: [
            {
              type: "creacion_proceso",
              by: currentStaffName,
              atIso: new Date().toISOString(),
              note: `Nacido de ${lot.lotCode} (${qty} cjs ${LOT_GRADES[gCode]?.short || gCode} ${quality})`
            }
          ],
          createdAtIso: new Date().toISOString(),
          updatedAtIso: new Date().toISOString(),
          proofId
        });
      }
    });
    showToast(`🔄 ¡Conversión guardada! Se crearon ${Object.keys(outputs).length} sub-lotes.`);
  } catch (err) {
    console.error(err);
    showToast("Error al guardar conversión.");
  }
});

document.getElementById("btnConfirmLoad").addEventListener("click", async () => {
  const lot = allLots.find((l) => l.id === selectedLotId);
  if (!lot) return;
  const driverName = document.getElementById("loadDriverSelect").value;
  const qty = Math.max(1, Number(document.getElementById("loadBoxesInput").value) || 0);
  const avail = Number(lot.remainingBoxes) || 0;
  if (!driverName) return showToast("Elige un chofer.");
  if (qty > avail) return showToast(`Solo quedan ${avail} cajas en ${lot.lotCode}.`);

  const newRem = avail - qty;
  const events = Array.isArray(lot.events) ? [...lot.events] : [];
  events.push({
    type: "carga_chofer",
    by: currentStaffName,
    driverName,
    boxes: qty,
    date: getLocalDateStr(),
    atIso: new Date().toISOString(),
    note: `Cargadas ${qty} cjs a ${driverName}`
  });

  try {
    await executeWarehouseBatch(currentWhKeyHash, (batch, proofId) => {
      batch.set(
        doc(db, "pallet_lots", lot.id),
        {
          remainingBoxes: newRem,
          state: newRem > 0 ? "disponible" : "agotado",
          events: events.slice(-30),
          updatedAtIso: new Date().toISOString(),
          proofId
        },
        { merge: true }
      );
    });
    showToast(`🚛 Cargadas ${qty} cajas de ${lot.lotCode} a ${driverName}`);
  } catch (err) {
    console.error(err);
    showToast("Error registrando carga.");
  }
});

function updateDirectSalePreview() {
  const qty = Math.max(0, Number(document.getElementById("dsBoxesInput")?.value) || 0);
  const price = Math.max(0, Number(document.getElementById("dsPriceInput")?.value) || 0);
  const el = document.getElementById("dsTotalAmount");
  if (el) el.textContent = formatCurrency(qty * price);
}

document.getElementById("dsBoxesInput")?.addEventListener("input", updateDirectSalePreview);
document.getElementById("dsPriceInput")?.addEventListener("input", updateDirectSalePreview);

document.getElementById("btnConfirmDirectSale")?.addEventListener("click", async () => {
  const lot = allLots.find((l) => l.id === selectedLotId);
  if (!lot) return;
  const clientName = document.getElementById("dsClientInput")?.value.trim() || "Cliente Mostrador";
  const qty = Math.max(0, Number(document.getElementById("dsBoxesInput")?.value) || 0);
  const unitPrice = Math.max(0, Number(document.getElementById("dsPriceInput")?.value) || 0);
  const payMethod = document.getElementById("dsPaySelect")?.value || "Contado";
  const avail = Number(lot.remainingBoxes) || 0;

  if (qty <= 0) return showToast("Indica cuántas cajas se venden.");
  if (qty > avail) return showToast(`Solo quedan ${avail} cajas en ${lot.lotCode}.`);

  const newRem = avail - qty;
  const totalAmount = qty * unitPrice;
  const today = getLocalDateStr();
  const nowIso = new Date().toISOString();
  const events = Array.isArray(lot.events) ? [...lot.events] : [];
  events.push({
    type: "venta_directa",
    by: currentStaffName,
    clientName,
    boxes: qty,
    totalAmount,
    payMethod,
    date: today,
    atIso: nowIso,
    note: `Venta directa ${qty} cjs a ${clientName} (${formatCurrency(totalAmount)})`
  });

  const gradeToCal = { S: "40s", E: "48s", P: "60s", M: "70s", C: "84s", PRO: "Proceso" };
  const calCode = gradeToCal[lot.grade] || lot.grade;
  const saleId = `wh_sale_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  try {
    await executeWarehouseBatch(currentWhKeyHash, (batch, proofId) => {
      batch.set(
        doc(db, "pallet_lots", lot.id),
        {
          remainingBoxes: newRem,
          state: newRem > 0 ? "disponible" : "agotado",
          events: events.slice(-30),
          updatedAtIso: nowIso,
          proofId
        },
        { merge: true }
      );
      batch.set(doc(db, "route_sales", saleId), {
        date: today,
        driver: `Almacén (${currentStaffName})`,
        channel: "almacen_directa",
        clientName,
        payMethod,
        totalBoxes: qty,
        totalAmount,
        paidAmount: payMethod === "Credito" ? 0 : totalAmount,
        balanceDue: payMethod === "Credito" ? totalAmount : 0,
        lotId: lot.id,
        lotCode: lot.lotCode,
        items: [{ code: calCode, name: `${LOT_GRADES[lot.grade]?.short || lot.grade}`, qty, unitPrice, subtotal: totalAmount }],
        notes: `Venta directa en almacén (${lot.coldRoom || "Bodega"}) • Tarima ${lot.lotCode}`,
        createdAtIso: nowIso,
        createdAt: serverTimestamp(),
        proofId
      });
    });
    showToast(`💵 Venta directa registrada: ${qty} cajas (${formatCurrency(totalAmount)})`);
  } catch (err) {
    console.error(err);
    showToast("Error registrando venta directa.");
  }
});

document.getElementById("btnConfirmAdjust").addEventListener("click", async () => {
  const lot = allLots.find((l) => l.id === selectedLotId);
  if (!lot) return;
  const coldRoom = getSelectedChip("adjRoomChips", lot.coldRoom || "Cuarto 1");
  const ripeness = getSelectedChip("adjRipenessChips", lot.ripeness || "Verde");
  const extraMerma = Math.max(0, Number(document.getElementById("adjMermaInput").value) || 0);
  const avail = Number(lot.remainingBoxes) || 0;
  const moveRaw = Number(document.getElementById("adjMoveBoxesInput")?.value);
  const moveBoxes = Number.isFinite(moveRaw) && moveRaw > 0 ? Math.min(moveRaw, avail) : avail;

  if (extraMerma > avail) return showToast("La merma excede las cajas disponibles.");
  if (moveBoxes + extraMerma > avail && moveBoxes < avail) {
    return showToast("Las cajas a mover + merma exceden las disponibles.");
  }

  const nowIso = new Date().toISOString();
  const isPartialSplit = moveBoxes > 0 && moveBoxes < avail && coldRoom !== lot.coldRoom;

  try {
    await executeWarehouseBatch(currentWhKeyHash, (batch, proofId) => {
      if (isPartialSplit) {
        const parentRem = avail - moveBoxes - extraMerma;
        const suffix = Date.now().toString(36).slice(-4);
        const childId = `${lot.id}_H_${suffix}`;
        const childCode = `${lot.lotCode || lot.id}-H${suffix.toUpperCase()}`;
        const parentEvents = Array.isArray(lot.events) ? [...lot.events] : [];
        parentEvents.push({
          type: "fraccion",
          by: currentStaffName,
          atIso: nowIso,
          note: `Movidas ${moveBoxes} cjs a ${coldRoom} (${childCode})${extraMerma > 0 ? ` • Merma: ${extraMerma}` : ""}`
        });

        batch.set(
          doc(db, "pallet_lots", lot.id),
          {
            remainingBoxes: parentRem,
            mermaBoxes: (Number(lot.mermaBoxes) || 0) + extraMerma,
            state: parentRem > 0 ? "disponible" : "agotado",
            events: parentEvents.slice(-30),
            updatedAtIso: nowIso,
            proofId
          },
          { merge: true }
        );

        batch.set(doc(db, "pallet_lots", childId), {
          lotCode: childCode,
          thermoId: lot.thermoId || "",
          thermoCode: lot.thermoCode || "",
          parentLotId: lot.id,
          arrivalDate: lot.arrivalDate || getLocalDateStr(),
          coldRoom,
          grade: lot.grade,
          kind: lot.kind || "clasificado",
          quality: lot.quality || "Limpio",
          ripeness,
          initialBoxes: moveBoxes,
          remainingBoxes: moveBoxes,
          mermaBoxes: 0,
          state: "disponible",
          events: [
            {
              type: "creacion_hijo",
              by: currentStaffName,
              atIso: nowIso,
              note: `Sub-lote de ${lot.lotCode} (${moveBoxes} cjs → ${coldRoom})`
            }
          ],
          createdAtIso: nowIso,
          updatedAtIso: nowIso,
          proofId
        });
      } else {
        const newRem = avail - extraMerma;
        const events = Array.isArray(lot.events) ? [...lot.events] : [];
        events.push({
          type: "ajuste",
          by: currentStaffName,
          atIso: nowIso,
          note: `Movido a ${coldRoom} (${ripeness})${extraMerma > 0 ? ` • Merma: ${extraMerma} cjs` : ""}`
        });
        batch.set(
          doc(db, "pallet_lots", lot.id),
          {
            coldRoom,
            ripeness,
            remainingBoxes: newRem,
            mermaBoxes: (Number(lot.mermaBoxes) || 0) + extraMerma,
            state: newRem > 0 ? "disponible" : "agotado",
            events: events.slice(-25),
            updatedAtIso: nowIso,
            proofId
          },
          { merge: true }
        );
      }
    });
    showToast(isPartialSplit ? `📦 Sub-tarima creada en ${coldRoom} (${moveBoxes} cjs)` : `✅ Actualizado ${lot.lotCode}`);
  } catch (err) {
    console.error(err);
    showToast("Error guardando movimiento.");
  }
});

// ================= COLD ROOMS & LOADS LISTS =================
function renderColdRoomsPane() {
  const active = allLots.filter((l) => (Number(l.remainingBoxes) || 0) > 0);
  let totalAllBoxes = 0;
  let totalProBoxes = 0;
  let totalClsBoxes = 0;
  for (const l of active) {
    const q = Number(l.remainingBoxes) || 0;
    totalAllBoxes += q;
    if (l.grade === "PRO" || l.kind === "proceso") totalProBoxes += q;
    else totalClsBoxes += q;
  }

  const sumEl = document.getElementById("roomSummaryStats");
  if (sumEl) {
    sumEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px;">
        <div>
          <strong style="font-size:1.35rem;color:#14532d;">${totalAllBoxes.toLocaleString("es-MX")} cajas</strong>
          <span style="display:block;font-size:0.78rem;color:#475569;font-weight:700;">${active.length} tarimas activas en bodega</span>
        </div>
        <strong style="font-size:0.95rem;color:#15803d;">${(totalAllBoxes * 10).toLocaleString("es-MX")} kg</strong>
      </div>
    `;
  }

  const filterItems = [
    { value: "all", label: `Todos (${totalAllBoxes})` },
    { value: "CLS", label: `✅ Listo Venta (${totalClsBoxes})` },
    { value: "PRO", label: `⏳ Proceso (${totalProBoxes})` }
  ];
  const activeStateFilter = roomFilter === "CLS" || roomFilter === "PRO" ? roomFilter : "all";
  renderChips("roomFilterChips", filterItems, activeStateFilter, (val) => {
    roomFilter = val;
    renderColdRoomsPane();
  });

  const filtered = active.filter((l) => {
    const isPro = l.grade === "PRO" || l.kind === "proceso";
    if (activeStateFilter === "PRO") return isPro;
    if (activeStateFilter === "CLS") return !isPro;
    return true;
  });

  const listEl = document.getElementById("roomsLotsList");
  if (!listEl) return;

  // Build ordered map starting with all COLD_ROOMS so every room is always visible
  const byRoom = new Map();
  for (const r of COLD_ROOMS) byRoom.set(r, { lots: [], boxes: 0, byGrade: {} });
  for (const l of filtered) {
    const rName = l.coldRoom || "Sin ubicar";
    if (!byRoom.has(rName)) byRoom.set(rName, { lots: [], boxes: 0, byGrade: {} });
    const entry = byRoom.get(rName);
    const rem = Number(l.remainingBoxes) || 0;
    entry.lots.push(l);
    entry.boxes += rem;
    const gLabel = LOT_GRADES[l.grade]?.short || l.grade || "Otro";
    entry.byGrade[gLabel] = (entry.byGrade[gLabel] || 0) + rem;
  }

  const roomIcon = (name) => {
    if (name === "Emplayado / Quiebre") return "📦";
    if (name === "Piso") return "🏪";
    if (name === "Área Selección") return "🔍";
    return "❄️";
  };

  listEl.innerHTML = Array.from(byRoom.entries())
    .map(([rName, info]) => {
      if (info.lots.length === 0) {
        return `
          <div class="alm-card" style="margin-bottom:8px;padding:10px 14px;opacity:0.62;display:flex;justify-content:space-between;align-items:center;">
            <strong style="font-size:0.92rem;color:#475569;">${roomIcon(rName)} ${escapeHtml(rName)}</strong>
            <span style="font-size:0.9rem;font-weight:800;color:#64748b;">0 cjs</span>
          </div>
        `;
      }

      const breakdown = Object.entries(info.byGrade)
        .map(([g, q]) => `${escapeHtml(g)}: <strong>${q}</strong>`)
        .join(" · ");
      const rowsHtml = info.lots
        .map((l) => {
          const days = daysBetween(l.arrivalDate);
          const semClass = days >= 7 ? "alm-sem-red" : days >= 4 ? "alm-sem-yellow" : "alm-sem-green";
          const isPro = l.grade === "PRO" || l.kind === "proceso";
          return `
            <div class="alm-lot-row" data-open-lot="${escapeHtml(l.id)}">
              <div>
                <span class="alm-badge ${isPro ? "pro" : "cls"}">${escapeHtml(LOT_GRADES[l.grade]?.short || l.grade)} • ${escapeHtml(l.quality || "-")}</span>
                <strong style="display:block;font-size:0.96rem;color:#0f172a;margin-top:3px;">${escapeHtml(l.lotCode)}</strong>
                <span style="font-size:0.78rem;color:#64748b;">${escapeHtml(l.ripeness || "Verde")} • <span class="${semClass}">${days}d</span></span>
              </div>
              <div style="text-align:right;">
                <strong style="font-size:1.05rem;color:#14532d;">${l.remainingBoxes} cjs</strong>
                <span style="display:block;font-size:0.74rem;color:#64748b;">${(Number(l.remainingBoxes) * 10).toLocaleString("es-MX")} kg</span>
              </div>
            </div>
          `;
        })
        .join("");

      return `
        <details class="alm-card" style="margin-bottom:8px;padding:12px 14px;">
          <summary style="cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <div>
              <strong style="font-size:0.98rem;color:#14532d;">${roomIcon(rName)} ${escapeHtml(rName)}</strong>
              <span style="font-size:0.76rem;color:#64748b;display:block;margin-top:2px;">${info.lots.length} tarima${info.lots.length === 1 ? "" : "s"} • Tocar para desglose ▾</span>
            </div>
            <div style="text-align:right;">
              <strong style="font-size:1.08rem;color:#14532d;">${info.boxes.toLocaleString("es-MX")} cjs</strong>
              <span style="display:block;font-size:0.74rem;color:#64748b;">${(info.boxes * 10).toLocaleString("es-MX")} kg</span>
            </div>
          </summary>
          <div style="margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;">
            <div style="font-size:0.8rem;color:#475569;margin-bottom:10px;">${breakdown}</div>
            ${rowsHtml}
          </div>
        </details>
      `;
    })
    .join("");

  listEl.onclick = (e) => {
    const row = e.target.closest("[data-open-lot]");
    if (!row) return;
    const found = allLots.find((l) => l.id === row.dataset.openLot);
    if (found) {
      switchPane("paneScan");
      openLotCard(found);
    }
  };
}

function renderLoadsTodayPane() {
  const el = document.getElementById("whLoadsTodayList");
  if (!el) return;
  const today = getLocalDateStr();
  const loads = [];
  const directSales = [];
  for (const l of allLots) {
    for (const ev of l.events || []) {
      if (ev.type === "carga_chofer" && ev.date === today) {
        loads.push({ lotCode: l.lotCode, grade: LOT_GRADES[l.grade]?.short || l.grade, ...ev });
      } else if (ev.type === "venta_directa" && ev.date === today) {
        directSales.push({ lotCode: l.lotCode, grade: LOT_GRADES[l.grade]?.short || l.grade, ...ev });
      }
    }
  }
  loads.sort((a, b) => String(b.atIso || "").localeCompare(String(a.atIso || "")));
  directSales.sort((a, b) => String(b.atIso || "").localeCompare(String(a.atIso || "")));

  const tripsHtml = todayWhTrips.length
    ? todayWhTrips
        .map((t, idx) => {
          const out = t.out || {};
          const ret = t.ret || {};
          const totalOut = (Number(out.M) || 0) + (Number(out.P) || 0) + (Number(out.E) || 0) + (Number(out.S) || 0);
          const totalRet = (Number(ret.M) || 0) + (Number(ret.P) || 0) + (Number(ret.E) || 0) + (Number(ret.S) || 0);
          const parts = ["M", "P", "E", "S"].filter((k) => Number(out[k]) > 0).map((k) => `${k}:${out[k]}`);
          return `
            <div style="padding:10px 0;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <div>
                <strong>🚗 ${escapeHtml(t.driver || "Chofer")}</strong>
                <span style="font-size:0.74rem;color:#64748b;margin-left:4px;">Vuelta #${idx + 1} • ${escapeHtml(t.ripeness || "Surtido")}</span>
                <div style="font-size:0.78rem;color:#475569;margin-top:2px;">${parts.join(" · ") || "Sin detalle"}${totalRet > 0 ? ` • Retorno: ${totalRet}` : ""}</div>
              </div>
              <strong style="color:#15803d;white-space:nowrap;">${totalOut} cajas</strong>
            </div>
          `;
        })
        .join("")
    : `<p style="color:#64748b;font-size:0.84rem;margin:6px 0 12px;">Sin salidas de carro registradas hoy en Control de Almacén.</p>`;

  const qrLoadsHtml = loads.length
    ? loads
        .map(
          (ld) => `
          <div style="padding:8px 0;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <strong>🚗 ${escapeHtml(ld.driverName)}</strong>
              <div style="font-size:0.78rem;color:#64748b;">Tarima: <strong>${escapeHtml(ld.lotCode)}</strong> (${escapeHtml(ld.grade)}) • Por ${escapeHtml(ld.by || "-")}</div>
            </div>
            <strong style="color:#15803d;">${ld.boxes} cajas</strong>
          </div>
        `
        )
        .join("")
    : `<p style="color:#64748b;font-size:0.84rem;margin:6px 0 12px;">Aún no hay cargas registradas hoy desde tarimas QR.</p>`;

  const directSalesHtml = directSales.length
    ? directSales
        .map(
          (ds) => `
          <div style="padding:8px 0;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <strong>💵 ${escapeHtml(ds.clientName || "Mostrador")}</strong>
              <div style="font-size:0.78rem;color:#64748b;">Tarima: <strong>${escapeHtml(ds.lotCode)}</strong> (${escapeHtml(ds.grade)}) • ${escapeHtml(ds.payMethod || "Contado")} • Por ${escapeHtml(ds.by || "-")}</div>
            </div>
            <div style="text-align:right;">
              <strong style="color:#15803d;">${ds.boxes} cjs</strong>
              <div style="font-size:0.76rem;color:#475569;">${formatCurrency(ds.totalAmount || 0)}</div>
            </div>
          </div>
        `
        )
        .join("")
    : `<p style="color:#64748b;font-size:0.84rem;margin:6px 0 0;">Sin ventas directas en mostrador hoy.</p>`;

  el.innerHTML = `
    <div style="margin-bottom:14px;">
      <div style="font-size:0.76rem;font-weight:800;color:#14532d;text-transform:uppercase;margin-bottom:4px;">Salidas de Carro Hoy (Oficina / Control Diario)</div>
      ${tripsHtml}
    </div>
    <div style="margin-bottom:14px;">
      <div style="font-size:0.76rem;font-weight:800;color:#14532d;text-transform:uppercase;margin-bottom:4px;">Cargas desde Tarimas QR Hoy (con Tarima Exacta)</div>
      ${qrLoadsHtml}
    </div>
    <div>
      <div style="font-size:0.76rem;font-weight:800;color:#14532d;text-transform:uppercase;margin-bottom:4px;">Ventas Directas en Bodega Hoy</div>
      ${directSalesHtml}
    </div>
  `;
}

// ================= ALTA INDIVIDUAL DE TARIMA =================
function initNewLotForm() {
  const card = document.getElementById("newLotCard");
  const btnToggle = document.getElementById("btnToggleNewLot");
  const btnCancel = document.getElementById("btnCancelNewLot");
  const btnSave = document.getElementById("btnCreateSingleLot");
  const gradeSel = document.getElementById("newLotGradeSelect");
  const roomSel = document.getElementById("newLotRoomSelect");
  const qualSel = document.getElementById("newLotQualitySelect");
  const ripeSel = document.getElementById("newLotRipenessSelect");
  if (!card || !btnToggle || !btnSave || !gradeSel || !roomSel || !qualSel || !ripeSel) return;

  const gradeOrder = ["P", "E", "S", "M", "C", "PRO"];
  gradeSel.innerHTML = gradeOrder
    .filter((k) => LOT_GRADES[k])
    .map((k) => `<option value="${k}">${escapeHtml(LOT_GRADES[k].name)}</option>`)
    .join("");
  roomSel.innerHTML = COLD_ROOMS.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("");
  qualSel.innerHTML = LOT_QUALITIES.map((q) => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`).join("");
  ripeSel.innerHTML = LOT_RIPENESS.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("");

  gradeSel.addEventListener("change", () => {
    qualSel.value = gradeSel.value === "PRO" ? "Proceso" : "Limpio";
  });

  btnToggle.addEventListener("click", () => {
    const isHidden = card.style.display === "none" || !card.style.display;
    card.style.display = isHidden ? "block" : "none";
    if (isHidden) {
      document.getElementById("scannedLotCard").style.display = "none";
      selectedLotId = null;
      qualSel.value = gradeSel.value === "PRO" ? "Proceso" : "Limpio";
    }
  });

  btnCancel?.addEventListener("click", () => {
    card.style.display = "none";
  });

  btnSave.addEventListener("click", async () => {
    const thermoCode = (document.getElementById("newLotThermoInput")?.value || "T01").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "") || "T01";
    const boxes = Math.max(1, parseInt(document.getElementById("newLotBoxesInput")?.value || "0", 10) || 0);
    const grade = gradeSel.value || "P";
    const coldRoom = roomSel.value || "Cuarto 1";
    const quality = qualSel.value || (grade === "PRO" ? "Proceso" : "Limpio");
    const ripeness = ripeSel.value || "Verde";
    const arrivalDate = getLocalDateStr();
    const thermoId = `${thermoCode}_${arrivalDate}`;

    const prefixMap = { PRI: "PRI", P: "PRI", E: "EXT", S: "SUP", M: "SEG", C: "COM", PRO: "PRO" };
    const prefix = prefixMap[grade] || grade;
    const usedNums = new Set(
      allLots
        .filter((l) => String(l.lotCode || "").startsWith(`${thermoCode}-${prefix}-`))
        .map((l) => parseInt(String(l.lotCode).split("-").pop(), 10))
        .filter((n) => !Number.isNaN(n))
    );
    let seq = 1;
    while (usedNums.has(seq)) seq++;
    const numStr = String(seq).padStart(2, "0");
    const lotCode = `${thermoCode}-${prefix}-${numStr}`;
    const docId = `${thermoId}_${prefix}_${numStr}`;
    const nowIso = new Date().toISOString();

    btnSave.disabled = true;
    try {
      await executeWarehouseBatch(currentWhKeyHash, (batch, proofId) => {
        batch.set(
          doc(db, "thermos", thermoId),
          {
            code: thermoCode,
            arrivalDate,
            status: "activo",
            updatedAtIso: nowIso,
            proofId
          },
          { merge: true }
        );
        batch.set(doc(db, "pallet_lots", docId), {
          lotCode,
          thermoId,
          thermoCode,
          parentLotId: null,
          arrivalDate,
          coldRoom,
          grade,
          kind: grade === "PRO" ? "proceso" : "clasificado",
          quality,
          ripeness,
          initialBoxes: boxes,
          remainingBoxes: boxes,
          mermaBoxes: 0,
          state: "disponible",
          events: [
            {
              type: "creacion",
              by: currentStaffName || "Almacén",
              atIso: nowIso,
              note: `Alta individual en ${coldRoom} (${boxes} cajas)`
            }
          ],
          createdAtIso: nowIso,
          updatedAtIso: nowIso,
          proofId
        });
      });

      card.style.display = "none";
      selectedLotId = docId;
      showToast(`✅ Tarima ${lotCode} registrada (${boxes} cjs en ${coldRoom})`);
    } catch (err) {
      console.error(err);
      showToast("Error al registrar tarima.");
    } finally {
      btnSave.disabled = false;
    }
  });
}

initNewLotForm();
restoreWhSession();
