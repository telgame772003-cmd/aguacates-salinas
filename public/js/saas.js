import {
  FUNCTIONS_BASE_URL,
  INDUSTRY_TEMPLATES,
  sha256Hex,
  parseCoordsFromInput,
  formatCurrency,
  matchesSmartSearch
} from "./firebase-config.js?v=rpd_1";

const SAAS_MASTER_KEY_STORAGE = "rpd_saas_master_hash_v1";

let currentSaasHash = "";
let isPlatformInitialized = true;
let allTenants = [];

const loginView = document.getElementById("saasLoginView");
const dashView = document.getElementById("saasDashboardView");
const headerActions = document.getElementById("saasHeaderActions");
const toastBox = document.getElementById("toastBox");

function showToast(msg) {
  if (!toastBox) return;
  toastBox.textContent = msg;
  toastBox.classList.add("show");
  setTimeout(() => toastBox.classList.remove("show"), 3500);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function callSaasApi(endpoint, payload) {
  const res = await fetch(`${FUNCTIONS_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `Error HTTP ${res.status}`);
  }
  return json;
}

async function checkBootstrapStatus() {
  try {
    const res = await callSaasApi("saasBootstrapAndAuth", { action: "status" });
    isPlatformInitialized = Boolean(res.initialized);
    if (!isPlatformInitialized) {
      document.getElementById("saasAuthTitle").textContent = "Activar Consola Maestra SaaS";
      document.getElementById("saasAuthDesc").innerHTML =
        "Primera vez: define tu <strong>Clave Maestra de Ruta Pro Technologies</strong>. Al activar, Salinas quedará registrado automáticamente como el Tenant #1.";
      document.getElementById("btnSaasLoginSubmit").textContent = "Crear Clave Maestra y Activar SaaS";
    }
  } catch (err) {
    console.warn("Aviso verificando estado SaaS:", err);
  }

  const saved = localStorage.getItem(SAAS_MASTER_KEY_STORAGE) || sessionStorage.getItem(SAAS_MASTER_KEY_STORAGE);
  if (saved && isPlatformInitialized) {
    try {
      await callSaasApi("saasBootstrapAndAuth", { action: "login", saasKeyHash: saved });
      currentSaasHash = saved;
      enterSaasDashboard();
    } catch (_) {
      localStorage.removeItem(SAAS_MASTER_KEY_STORAGE);
      sessionStorage.removeItem(SAAS_MASTER_KEY_STORAGE);
    }
  }
}

document.getElementById("saasLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pass = document.getElementById("saasMasterPass").value;
  if (!pass || pass.length < 6) {
    showToast("Usa al menos 6 caracteres para la Clave Maestra SaaS.");
    return;
  }
  const btn = document.getElementById("btnSaasLoginSubmit");
  btn.disabled = true;
  const prevTxt = btn.textContent;
  btn.textContent = "Verificando...";

  try {
    const hash = await sha256Hex(`RPD_SAAS_MASTER::${pass}`);
    const action = isPlatformInitialized ? "login" : "init";
    await callSaasApi("saasBootstrapAndAuth", { action, saasKeyHash: hash });
    currentSaasHash = hash;
    isPlatformInitialized = true;
    if (document.getElementById("saasRememberChk").checked) {
      localStorage.setItem(SAAS_MASTER_KEY_STORAGE, hash);
    } else {
      sessionStorage.setItem(SAAS_MASTER_KEY_STORAGE, hash);
    }
    document.getElementById("saasMasterPass").value = "";
    enterSaasDashboard();
    showToast(action === "init" ? "✅ Plataforma SaaS activada y Salinas migrado." : "Bienvenido a Ruta Pro Distribution.");
  } catch (err) {
    showToast(err.message || "Error de autenticación.");
  } finally {
    btn.disabled = false;
    btn.textContent = prevTxt;
  }
});

document.getElementById("btnSaasLogout").addEventListener("click", () => {
  currentSaasHash = "";
  localStorage.removeItem(SAAS_MASTER_KEY_STORAGE);
  sessionStorage.removeItem(SAAS_MASTER_KEY_STORAGE);
  dashView.style.display = "none";
  headerActions.style.display = "none";
  loginView.style.display = "block";
});

function enterSaasDashboard() {
  loginView.style.display = "none";
  dashView.style.display = "block";
  headerActions.style.display = "flex";
  loadTenantsAndTelemetry();
}

async function loadTenantsAndTelemetry() {
  const grid = document.getElementById("saasTenantsGrid");
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px;color:#94a3b8;">Consultando métricas en vivo de los tenants...</div>`;
  try {
    const res = await callSaasApi("saasListTenants", { saasKeyHash: currentSaasHash });
    allTenants = res.tenants || [];
    renderKpisAndGrid();
  } catch (err) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px;color:#fca5a5;">${escapeHtml(err.message)}</div>`;
  }
}

let activeBillingFilter = "all";

function getTodayIsoLocal() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function computeDueStatus(dateStr, cycleDays = 30) {
  if (!dateStr) {
    return {
      state: "unset",
      diffDays: null,
      label: "Sin fecha",
      shortHint: "Sin fecha asignada",
      progressPct: 0,
      barColor: "#475569",
      color: "#94a3b8",
      bg: "rgba(148,163,184,0.12)"
    };
  }
  const todayIso = getTodayIsoLocal();
  const diffDays = Math.round((new Date(dateStr + "T00:00:00") - new Date(todayIso + "T00:00:00")) / 86400000);
  if (diffDays < 0) {
    return {
      state: "overdue",
      diffDays,
      label: `🔴 Vencido (${Math.abs(diffDays)}d)`,
      shortHint: `Vencido hace ${Math.abs(diffDays)} día${Math.abs(diffDays) === 1 ? "" : "s"} (${dateStr})`,
      progressPct: 100,
      barColor: "#ef4444",
      color: "#fca5a5",
      bg: "rgba(239,68,68,0.2)"
    };
  }
  if (diffDays <= 5) {
    const pct = Math.min(98, Math.max(78, Math.round(((cycleDays - diffDays) / cycleDays) * 100)));
    return {
      state: "soon",
      diffDays,
      label: diffDays === 0 ? "🟠 Vence HOY" : `🟡 En ${diffDays}d`,
      shortHint: diffDays === 0 ? `Vence HOY (${dateStr})` : `Faltan ${diffDays} día${diffDays === 1 ? "" : "s"} (${dateStr})`,
      progressPct: pct,
      barColor: diffDays === 0 ? "#f97316" : "#f59e0b",
      color: "#fde68a",
      bg: "rgba(245,158,11,0.18)"
    };
  }
  const pct = Math.min(82, Math.max(8, Math.round(((cycleDays - Math.min(cycleDays, diffDays)) / cycleDays) * 100)));
  return {
    state: "ok",
    diffDays,
    label: `🟢 Faltan ${diffDays}d`,
    shortHint: `Al corriente • Corte: ${dateStr}`,
    progressPct: pct,
    barColor: "#10b981",
    color: "#6ee7b7",
    bg: "rgba(16,185,129,0.14)"
  };
}

function computePunctualityBadge(plan = {}) {
  const hist = Array.isArray(plan?.paymentHistory) ? plan.paymentHistory : [];
  if (hist.length === 0) {
    return { label: "Sin pagos aún", color: "#94a3b8", bg: "rgba(148,163,184,0.12)" };
  }
  const lateCount = hist.filter((h) => Number(h.daysLate) > 1).length;
  if (lateCount === 0) {
    return { label: `⭐ Puntual (${hist.length})`, color: "#6ee7b7", bg: "rgba(16,185,129,0.16)" };
  }
  const ratio = lateCount / hist.length;
  if (ratio <= 0.35) {
    return { label: `🟡 Atraso leve (${lateCount}/${hist.length})`, color: "#fde68a", bg: "rgba(245,158,11,0.18)" };
  }
  return { label: `🔴 Moroso (${lateCount}/${hist.length})`, color: "#fca5a5", bg: "rgba(239,68,68,0.2)" };
}

function getTenantBillingSummary(t) {
  const mDue = computeDueStatus(t.plan?.nextMonthlyDue, 30);
  const aDue = computeDueStatus(t.plan?.nextAnnualDue, 365);
  let overall = "unset";
  if (mDue.state === "overdue" || aDue.state === "overdue") overall = "overdue";
  else if (mDue.state === "soon" || aDue.state === "soon") overall = "soon";
  else if (mDue.state === "ok" || aDue.state === "ok") overall = "ok";
  return { mDue, aDue, overall };
}

function addMonthsIso(baseIso, months) {
  const start = baseIso ? new Date(baseIso + "T12:00:00") : new Date();
  start.setMonth(start.getMonth() + months);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
}

function renderKpisAndGrid() {
  const activeCount = allTenants.filter((t) => t.tenantStatus !== "suspended").length;
  const suspCount = allTenants.length - activeCount;
  let onlineTrucks = 0;
  let totalDrivers = 0;
  let totalPlaces = 0;
  let totalGmv = 0;
  let totalSales = 0;
  let totalMrr = 0;
  let totalArr = 0;
  let alertsCount = 0;

  for (const t of allTenants) {
    const tel = t.telemetry || {};
    const drvCount = Number(tel.driversConfigured) || 0;
    onlineTrucks += Number(tel.onlineTrucks) || 0;
    totalDrivers += drvCount;
    totalPlaces += Number(tel.placesCount) || 0;
    totalGmv += Number(tel.gmvToday) || 0;
    totalSales += Number(tel.salesTodayCount) || 0;

    if (t.tenantStatus !== "suspended") {
      const baseM = Number(t.plan?.monthlyFeeMxn) || 0;
      const perDrv = Number(t.plan?.perDriverFeeMxn) || 0;
      const ann = Number(t.plan?.annualFeeMxn) || 0;
      totalMrr += baseM + perDrv * drvCount;
      totalArr += ann;
    }
    const mSt = computeDueStatus(t.plan?.nextMonthlyDue);
    const aSt = computeDueStatus(t.plan?.nextAnnualDue);
    if (mSt.state === "overdue" || mSt.state === "soon" || aSt.state === "overdue" || aSt.state === "soon") {
      alertsCount++;
    }
  }

  document.getElementById("kpiSaasTenants").textContent = String(allTenants.length);
  document.getElementById("kpiSaasTenantsSub").textContent = `${activeCount} activa${activeCount === 1 ? "" : "s"} • ${suspCount} en pausa`;
  document.getElementById("kpiSaasTrucks").textContent = String(onlineTrucks);
  document.getElementById("kpiSaasTrucksSub").textContent = `${totalDrivers} choferes dados de alta`;
  document.getElementById("kpiSaasPlaces").textContent = totalPlaces.toLocaleString("es-MX");
  document.getElementById("kpiSaasGmv").textContent = formatCurrency(totalGmv);
  document.getElementById("kpiSaasGmvSub").textContent = `${totalSales} nota${totalSales === 1 ? "" : "s"} hoy en toda la red`;
  const mrrEl = document.getElementById("kpiSaasMrr");
  const billSubEl = document.getElementById("kpiSaasBillingSub");
  if (mrrEl) mrrEl.textContent = `${formatCurrency(totalMrr)}/mes`;
  if (billSubEl) {
    billSubEl.textContent = `Anualidades: ${formatCurrency(totalArr)} • ${alertsCount} por vencer/vencido`;
  }

  const q = document.getElementById("saasSearchInput").value.trim();
  const filtered = allTenants.filter((t) => {
    const textOk = matchesSmartSearch(`${t.brandName || ""} ${t.tenantSlug || ""} ${t.industry || ""} ${t.billingNotes || ""}`, q);
    if (!textOk) return false;
    if (activeBillingFilter === "all") return true;
    if (activeBillingFilter === "suspended") return t.tenantStatus === "suspended";
    const { overall } = getTenantBillingSummary(t);
    return overall === activeBillingFilter;
  });

  const grid = document.getElementById("saasTenantsGrid");
  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px;color:#94a3b8;">No hay empresas que coincidan con el filtro.</div>`;
    return;
  }

  const origin = window.location.origin;
  grid.innerHTML = filtered
    .map((t) => {
      const isSusp = t.tenantStatus === "suspended";
      const tel = t.telemetry || {};
      const drvCount = Number(tel.driversConfigured) || 0;
      const maxDrv = t.plan?.maxDrivers || 25;
      const baseMonthly = Number(t.plan?.monthlyFeeMxn) || 0;
      const perDriver = Number(t.plan?.perDriverFeeMxn) || 0;
      const annualFee = Number(t.plan?.annualFeeMxn) || 0;
      const monthlyTotal = baseMonthly + perDriver * drvCount;
      const { mDue, aDue, overall } = getTenantBillingSummary(t);
      const punct = computePunctualityBadge(t.plan);
      const lastPay = Array.isArray(t.plan?.paymentHistory) && t.plan.paymentHistory.length
        ? t.plan.paymentHistory[0]
        : null;
      const lastPayStr = lastPay
        ? `Último pago: ${String(lastPay.paidAtIso || "").slice(0, 10)} (${formatCurrency(lastPay.amount || 0)})`
        : "Sin pagos registrados aún";
      const showRemindBtn = mDue.state === "soon" || mDue.state === "overdue" || aDue.state === "soon" || aDue.state === "overdue";

      const feeParts = [];
      if (baseMonthly > 0) feeParts.push(`${formatCurrency(baseMonthly)}/mes`);
      if (perDriver > 0) feeParts.push(`${formatCurrency(perDriver)}×${drvCount} chof.`);
      if (annualFee > 0) feeParts.push(`${formatCurrency(annualFee)}/año`);
      const fee = feeParts.length ? feeParts.join(" + ") : "Fundador / Interno";
      const qParam = t.tenantSlug === "salinas" ? "" : `?t=${encodeURIComponent(t.tenantSlug)}`;

      return `
        <article class="saas-tenant-card ${isSusp ? "is-suspended" : ""} is-billing-${overall}">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">
              <div>
                <strong style="font-size:1.1rem;color:#fff;">${escapeHtml(t.pinEmoji || "🏢")} ${escapeHtml(t.brandName)}</strong>
                <div style="font-size:0.76rem;color:#94a3b8;margin-top:2px;">
                  Código: <code style="color:#38bdf8;">${escapeHtml(t.tenantSlug)}</code> • ${escapeHtml(fee)}
                </div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                <span class="saas-pill ${isSusp ? "suspended" : "active"}">${isSusp ? "⏸️ En Pausa" : "🟢 Activo"}</span>
                <button type="button" data-saas-history="${escapeHtml(t.tenantSlug)}" style="border:none;cursor:pointer;font-size:0.68rem;font-weight:800;padding:2px 8px;border-radius:999px;color:${punct.color};background:${punct.bg};" title="Ver historial de pagos">${punct.label}</button>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;background:#0f172a;padding:10px;border-radius:10px;text-align:center;margin:10px 0;">
              <div>
                <div style="font-size:0.68rem;color:#94a3b8;">CHOFERES</div>
                <strong style="font-size:0.92rem;color:#fff;">${drvCount}/${maxDrv}</strong>
                <div style="font-size:0.68rem;color:#34d399;">${tel.onlineTrucks || 0} GPS</div>
              </div>
              <div>
                <div style="font-size:0.68rem;color:#94a3b8;">NEGOCIOS</div>
                <strong style="font-size:0.92rem;color:#fff;">${tel.placesCount || 0}</strong>
              </div>
              <div>
                <div style="font-size:0.68rem;color:#94a3b8;">HOY</div>
                <strong style="font-size:0.92rem;color:#34d399;">${formatCurrency(tel.gmvToday || 0)}</strong>
              </div>
            </div>

            <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:10px;margin-bottom:10px;font-size:0.75rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                <span style="color:#cbd5e1;font-weight:700;">💳 Mensual (${formatCurrency(monthlyTotal)}):</span>
                <span style="padding:2px 8px;border-radius:999px;font-weight:800;color:${mDue.color};background:${mDue.bg};">${mDue.label}</span>
              </div>
              <div class="saas-cycle-track">
                <div class="saas-cycle-fill" style="width:${mDue.progressPct}%;background:${mDue.barColor};"></div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px;">
                <span style="color:#cbd5e1;font-weight:700;">📅 Anual (${formatCurrency(annualFee)}):</span>
                <span style="padding:2px 8px;border-radius:999px;font-weight:800;color:${aDue.color};background:${aDue.bg};">${aDue.label}</span>
              </div>
              <div style="font-size:0.7rem;color:#94a3b8;margin-bottom:7px;">${escapeHtml(lastPayStr)}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button type="button" class="btn btn-outline btn-sm" data-saas-pay-month="${escapeHtml(t.tenantSlug)}" style="flex:1;padding:4px 6px;font-size:0.71rem;">✅ Cobrar Mes (+1m)</button>
                <button type="button" class="btn btn-outline btn-sm" data-saas-pay-year="${escapeHtml(t.tenantSlug)}" style="flex:1;padding:4px 6px;font-size:0.71rem;">✅ Cobrar Año (+1a)</button>
                ${
                  showRemindBtn
                    ? `<button type="button" class="btn btn-outline btn-sm" data-saas-remind="${escapeHtml(t.tenantSlug)}" style="width:100%;padding:5px 8px;font-size:0.72rem;color:#fde68a !important;border-color:#d97706 !important;">💬 Recordar Pago por WhatsApp</button>`
                    : ""
                }
              </div>
            </div>

            ${t.billingNotes ? `<div style="font-size:0.74rem;color:#cbd5e1;margin-bottom:8px;">📝 Nota facturación: ${escapeHtml(t.billingNotes)}</div>` : ""}

            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
              <a href="${origin}/${qParam}" target="_blank" rel="noopener" class="saas-link-chip">🛒 Tienda</a>
              <a href="${origin}/admin.html${qParam}" target="_blank" rel="noopener" class="saas-link-chip">💼 Admin</a>
              <a href="${origin}/almacen.html${qParam}" target="_blank" rel="noopener" class="saas-link-chip">❄️ Almacén</a>
              <a href="${origin}/chofer.html${qParam}" target="_blank" rel="noopener" class="saas-link-chip">🚗 Chofer</a>
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;gap:8px;padding-top:10px;border-top:1px solid #334155;">
            <button type="button" class="btn btn-outline btn-sm" data-saas-edit="${escapeHtml(t.tenantSlug)}" style="flex:1;">
              ⚙️ Plan / Módulos
            </button>
            <button type="button" class="btn btn-outline btn-sm" data-saas-toggle="${escapeHtml(t.tenantSlug)}" style="color:${isSusp ? "#34d399" : "#fca5a5"} !important;border-color:${isSusp ? "#059669" : "#991b1b"} !important;">
              ${isSusp ? "▶️ Reactivar" : "⏸️ Suspender"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

document.getElementById("saasSearchInput").addEventListener("input", renderKpisAndGrid);
document.getElementById("saasBillingFilters")?.addEventListener("click", (e) => {
  const chip = e.target.closest("button[data-billing-filter]");
  if (!chip) return;
  activeBillingFilter = chip.dataset.billingFilter || "all";
  document.querySelectorAll("#saasBillingFilters .saas-filter-chip").forEach((b) => {
    b.classList.toggle("active", b === chip);
  });
  renderKpisAndGrid();
});
document.getElementById("btnSaasRefresh").addEventListener("click", loadTenantsAndTelemetry);

document.getElementById("btnSaasResyncSalinas").addEventListener("click", async () => {
  const btn = document.getElementById("btnSaasResyncSalinas");
  btn.disabled = true;
  btn.textContent = "⏳ Sincronizando...";
  try {
    const res = await callSaasApi("saasBootstrapAndAuth", {
      action: "resync_salinas",
      saasKeyHash: currentSaasHash
    });
    showToast(`✅ Salinas sincronizado (${res.migrationReport?.counts?.places || 0} tiendas).`);
    loadTenantsAndTelemetry();
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🥑 Sincronizar Salinas";
  }
});

// ================= CREATE NEW TENANT WIZARD =================
const newTenantModal = document.getElementById("newTenantModal");
const ntIndustrySel = document.getElementById("ntIndustry");

function syncWizardTemplateDefaults() {
  const tpl = INDUSTRY_TEMPLATES[ntIndustrySel.value] || INDUSTRY_TEMPLATES.avocado;
  document.getElementById("ntPrimaryColor").value = tpl.theme.primary;
  document.getElementById("ntModOnline").checked = tpl.modules.onlineStore;
  document.getElementById("ntModCold").checked = tpl.modules.coldRooms;
  document.getElementById("ntModRipeness").checked = tpl.modules.ripeness;
  document.getElementById("ntModFrac").checked = tpl.modules.fractionalSales;
  document.getElementById("ntModNav3d").checked = tpl.modules.nav3d;
}
ntIndustrySel.addEventListener("change", syncWizardTemplateDefaults);

function openNewTenantWizard() {
  document.getElementById("newTenantForm").reset();
  document.getElementById("ntWelcomeKitBox").style.display = "none";
  syncWizardTemplateDefaults();
  newTenantModal.classList.add("open");
}

document.getElementById("btnOpenNewTenantModal")?.addEventListener("click", openNewTenantWizard);
document.getElementById("btnOpenNewTenantHero")?.addEventListener("click", openNewTenantWizard);

document.getElementById("btnCloseNewTenantModal").addEventListener("click", () => {
  newTenantModal.classList.remove("open");
});

document.getElementById("newTenantForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tpl = INDUSTRY_TEMPLATES[ntIndustrySel.value] || INDUSTRY_TEMPLATES.avocado;
  const slug = document.getElementById("ntSlug").value.trim().toLowerCase();
  const brandName = document.getElementById("ntBrandName").value.trim();
  const tagline = document.getElementById("ntTagline").value.trim() || tpl.label.replace(/^[^\s]+\s/, "");
  const phone = document.getElementById("ntPhone").value.trim();
  const primaryColor = document.getElementById("ntPrimaryColor").value;
  const maxDrivers = Number(document.getElementById("ntMaxDrivers").value) || 10;
  const monthlyFeeMxn = Number(document.getElementById("ntMonthlyFee").value) || 0;
  const perDriverFeeMxn = Number(document.getElementById("ntPerDriverFee")?.value) || 0;
  const annualFeeMxn = Number(document.getElementById("ntAnnualFee")?.value) || 0;
  const nextMonthlyDue = document.getElementById("ntNextMonthlyDue")?.value || "";
  const nextAnnualDue = document.getElementById("ntNextAnnualDue")?.value || "";
  const coords = parseCoordsFromInput(document.getElementById("ntBaseCoords").value) || { lat: 25.407054, lng: -100.954645 };
  const adminPassword = document.getElementById("ntAdminPass").value.trim();
  const ownerPassword = document.getElementById("ntOwnerPass").value.trim();

  const modules = {
    onlineStore: document.getElementById("ntModOnline").checked,
    coldRooms: document.getElementById("ntModCold").checked,
    ripeness: document.getElementById("ntModRipeness").checked,
    fractionalSales: document.getElementById("ntModFrac").checked,
    nav3d: document.getElementById("ntModNav3d").checked
  };

  const btn = document.getElementById("btnCreateTenantSubmit");
  btn.disabled = true;
  btn.textContent = "⏳ Creando bóveda y accesos...";

  try {
    const res = await callSaasApi("saasProvisionTenant", {
      saasKeyHash: currentSaasHash,
      tenantSlug: slug,
      brandName,
      tagline,
      industry: tpl.id,
      pinEmoji: tpl.pinEmoji,
      folioPrefix: slug.slice(0, 3).toUpperCase(),
      primaryColor,
      darkColor: tpl.theme.dark,
      whatsappPrimary: phone,
      phoneDisplayPrimary: phone,
      baseName: `Base ${brandName}`,
      baseLat: coords.lat,
      baseLng: coords.lng,
      unitConfig: tpl.unitConfig,
      terminology: tpl.terminology,
      modules,
      defaultProducts: tpl.defaultProducts,
      planTier: "pro",
      maxDrivers,
      monthlyFeeMxn,
      adminPassword,
      ownerPassword
    });

    const origin = window.location.origin;
    const tSlug = res.tenantSlug;
    if (perDriverFeeMxn > 0 || annualFeeMxn > 0 || nextMonthlyDue || nextAnnualDue) {
      await callSaasApi("saasUpdateTenant", {
        saasKeyHash: currentSaasHash,
        tenantSlug: tSlug,
        updates: {
          plan: {
            tier: "pro",
            maxDrivers,
            monthlyFeeMxn,
            perDriverFeeMxn,
            annualFeeMxn,
            nextMonthlyDue,
            nextAnnualDue,
            paymentHistory: []
          }
        }
      });
    }
    const kit =
      `🚀 *BIENVENIDO A RUTA PRO DISTRIBUTION*\n` +
      `Empresa: *${brandName}* (Código: *${tSlug}*)\n\n` +
      `🔗 *1. Portal de Pedidos para tus Clientes:*\n${origin}/?t=${tSlug}\n\n` +
      `💼 *2. Panel de Administración y Despacho:*\n${origin}/admin.html?t=${tSlug}\n` +
      `   • Clave Admin Oficina: *${adminPassword}*\n` +
      `   • Clave Dirección / Finanzas: *${ownerPassword}*\n\n` +
      `❄️ *3. Escáner de Almacén:*\n${origin}/almacen.html?t=${tSlug}\n` +
      `   • Usuario inicial: *Almacenista 1* | PIN: *1234*\n\n` +
      `🚗 *4. App de Choferes en Ruta:*\n${origin}/chofer.html?t=${tSlug}\n` +
      `   • Usuario inicial: *Vendedor 1* | PIN: *1234*`;

    document.getElementById("ntWelcomeKitText").textContent = kit;
    document.getElementById("ntWelcomeKitBox").style.display = "block";
    showToast(`🎉 Empresa "${brandName}" creada con éxito.`);
    loadTenantsAndTelemetry();
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ Crear Empresa y Generar Accesos";
  }
});

document.getElementById("btnCopyWelcomeKit").addEventListener("click", async () => {
  const txt = document.getElementById("ntWelcomeKitText").textContent;
  await navigator.clipboard.writeText(txt);
  showToast("📋 Kit de bienvenida copiado al portapapeles.");
});

// ================= EDIT / SUSPEND TENANT =================
const editModal = document.getElementById("editTenantModal");
document.getElementById("btnCloseEditTenantModal").addEventListener("click", () => editModal.classList.remove("open"));

document.getElementById("saasTenantsGrid").addEventListener("click", async (e) => {
  const toggleBtn = e.target.closest("button[data-saas-toggle]");
  if (toggleBtn) {
    const slug = toggleBtn.dataset.saasToggle;
    const t = allTenants.find((x) => x.tenantSlug === slug);
    if (!t) return;
    const nextStatus = t.tenantStatus === "suspended" ? "active" : "suspended";
    const confirmMsg =
      nextStatus === "suspended"
        ? `¿Suspender temporalmente el servicio de "${t.brandName}"? Se bloqueará el acceso y mostrará aviso de renovación.`
        : `¿Reactivar de inmediato el servicio de "${t.brandName}"?`;
    if (!window.confirm(confirmMsg)) return;
    try {
      await callSaasApi("saasUpdateTenant", {
        saasKeyHash: currentSaasHash,
        tenantSlug: slug,
        updates: { tenantStatus: nextStatus }
      });
      showToast(nextStatus === "suspended" ? `⏸️ ${t.brandName} puesto en pausa.` : `🟢 ${t.brandName} reactivado.`);
      loadTenantsAndTelemetry();
    } catch (err) {
      showToast(err.message);
    }
    return;
  }

  const payMonthBtn = e.target.closest("button[data-saas-pay-month]");
  if (payMonthBtn) {
    const slug = payMonthBtn.dataset.saasPayMonth;
    const t = allTenants.find((x) => x.tenantSlug === slug);
    if (!t) return;
    const prevDue = t.plan?.nextMonthlyDue || "";
    const todayIso = getTodayIsoLocal();
    const daysLate = prevDue ? Math.round((new Date(todayIso + "T00:00:00") - new Date(prevDue + "T00:00:00")) / 86400000) : 0;
    const drvCount = Number(t.telemetry?.driversConfigured) || 0;
    const amount = (Number(t.plan?.monthlyFeeMxn) || 0) + (Number(t.plan?.perDriverFeeMxn) || 0) * drvCount;
    const nextDate = addMonthsIso(prevDue, 1);
    const prevHist = Array.isArray(t.plan?.paymentHistory) ? t.plan.paymentHistory : [];
    const nextHist = [
      {
        id: "pay_" + Date.now().toString(36),
        type: "mensual",
        amount,
        dueDate: prevDue || todayIso,
        paidAtIso: new Date().toISOString(),
        daysLate
      },
      ...prevHist
    ].slice(0, 24);
    try {
      await callSaasApi("saasUpdateTenant", {
        saasKeyHash: currentSaasHash,
        tenantSlug: slug,
        updates: {
          plan: {
            ...(t.plan || {}),
            nextMonthlyDue: nextDate,
            lastPaymentAtIso: new Date().toISOString(),
            paymentHistory: nextHist
          }
        }
      });
      showToast(`✅ Pago mensual (${formatCurrency(amount)}) registrado para ${t.brandName}. Próximo corte: ${nextDate}.`);
      loadTenantsAndTelemetry();
    } catch (err) {
      showToast(err.message);
    }
    return;
  }

  const payYearBtn = e.target.closest("button[data-saas-pay-year]");
  if (payYearBtn) {
    const slug = payYearBtn.dataset.saasPayYear;
    const t = allTenants.find((x) => x.tenantSlug === slug);
    if (!t) return;
    const prevDue = t.plan?.nextAnnualDue || "";
    const todayIso = getTodayIsoLocal();
    const daysLate = prevDue ? Math.round((new Date(todayIso + "T00:00:00") - new Date(prevDue + "T00:00:00")) / 86400000) : 0;
    const amount = Number(t.plan?.annualFeeMxn) || 0;
    const nextDate = addMonthsIso(prevDue, 12);
    const prevHist = Array.isArray(t.plan?.paymentHistory) ? t.plan.paymentHistory : [];
    const nextHist = [
      {
        id: "pay_" + Date.now().toString(36),
        type: "anual",
        amount,
        dueDate: prevDue || todayIso,
        paidAtIso: new Date().toISOString(),
        daysLate
      },
      ...prevHist
    ].slice(0, 24);
    try {
      await callSaasApi("saasUpdateTenant", {
        saasKeyHash: currentSaasHash,
        tenantSlug: slug,
        updates: {
          plan: {
            ...(t.plan || {}),
            nextAnnualDue: nextDate,
            lastAnnualPaymentAtIso: new Date().toISOString(),
            paymentHistory: nextHist
          }
        }
      });
      showToast(`✅ Anualidad (${formatCurrency(amount)}) registrada para ${t.brandName}. Próxima renovación: ${nextDate}.`);
      loadTenantsAndTelemetry();
    } catch (err) {
      showToast(err.message);
    }
    return;
  }

  const remindBtn = e.target.closest("button[data-saas-remind]");
  if (remindBtn) {
    const slug = remindBtn.dataset.saasRemind;
    const t = allTenants.find((x) => x.tenantSlug === slug);
    if (!t) return;
    const drvCount = Number(t.telemetry?.driversConfigured) || 0;
    const mAmt = (Number(t.plan?.monthlyFeeMxn) || 0) + (Number(t.plan?.perDriverFeeMxn) || 0) * drvCount;
    const aAmt = Number(t.plan?.annualFeeMxn) || 0;
    const msg =
      `Hola *${t.brandName}*, te saludamos de *Ruta Pro Distribution*.\n` +
      `Te compartimos tu recordatorio de renovación de servicio:\n` +
      (t.plan?.nextMonthlyDue ? `• *Mensualidad:* ${formatCurrency(mAmt)} (corte: ${t.plan.nextMonthlyDue})\n` : "") +
      (t.plan?.nextAnnualDue && aAmt > 0 ? `• *Anualidad:* ${formatCurrency(aAmt)} (vence: ${t.plan.nextAnnualDue})\n` : "") +
      `Quedamos pendientes de tu comprobante para mantener tu flotilla activa al 100%. ¡Gracias!`;
    const phoneDigits = String(t.contactPhone || "").replace(/\D/g, "").slice(-10);
    if (phoneDigits.length === 10) {
      window.open(`https://api.whatsapp.com/send?phone=52${phoneDigits}&text=${encodeURIComponent(msg)}`, "_blank", "noopener");
    } else {
      await navigator.clipboard?.writeText?.(msg);
      showToast("📋 Recordatorio de pago copiado (no hay WhatsApp de 10 dígitos guardado en este tenant).");
    }
    return;
  }

  const histBtn = e.target.closest("button[data-saas-history]");
  if (histBtn) {
    const slug = histBtn.dataset.saasHistory;
    const t = allTenants.find((x) => x.tenantSlug === slug);
    if (!t) return;
    const hist = Array.isArray(t.plan?.paymentHistory) ? t.plan.paymentHistory : [];
    const punct = computePunctualityBadge(t.plan);
    document.getElementById("phModalTitle").textContent = `📜 Pagos de ${t.brandName}`;
    document.getElementById("phModalSub").textContent = `Comportamiento: ${punct.label}`;
    const listEl = document.getElementById("phHistoryList");
    listEl.innerHTML = hist.length
      ? hist
          .map((h) => {
            const late = Number(h.daysLate) || 0;
            const badge =
              late <= 1
                ? `<span style="color:#6ee7b7;background:rgba(16,185,129,0.16);padding:2px 7px;border-radius:999px;font-size:0.7rem;font-weight:800;">✅ A tiempo</span>`
                : `<span style="color:#fca5a5;background:rgba(239,68,68,0.2);padding:2px 7px;border-radius:999px;font-size:0.7rem;font-weight:800;">⏰ +${late}d tarde</span>`;
            return `
              <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:9px 11px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                <div>
                  <strong style="color:#fff;font-size:0.86rem;">${h.type === "anual" ? "📅 Anualidad" : "💳 Mensualidad"} • ${formatCurrency(h.amount || 0)}</strong>
                  <div style="font-size:0.72rem;color:#94a3b8;">Pagó: ${String(h.paidAtIso || "").slice(0, 10)} (Corte: ${h.dueDate || "-"})</div>
                </div>
                ${badge}
              </div>
            `;
          })
          .join("")
      : `<div style="color:#94a3b8;font-size:0.82rem;text-align:center;padding:18px;">Aún no hay pagos registrados para este tenant.</div>`;
    document.getElementById("paymentHistoryModal")?.classList.add("open");
    return;
  }

  const editBtn = e.target.closest("button[data-saas-edit]");
  if (editBtn) {
    const slug = editBtn.dataset.saasEdit;
    const t = allTenants.find((x) => x.tenantSlug === slug);
    if (!t) return;
    document.getElementById("etModalTitle").textContent = `⚙️ Configurar: ${t.brandName}`;
    document.getElementById("etSlug").value = slug;
    document.getElementById("etMaxDrivers").value = String(t.plan?.maxDrivers || 25);
    document.getElementById("etMonthlyFee").value = String(t.plan?.monthlyFeeMxn || 0);
    document.getElementById("etPerDriverFee").value = String(t.plan?.perDriverFeeMxn || 0);
    document.getElementById("etAnnualFee").value = String(t.plan?.annualFeeMxn || 0);
    document.getElementById("etNextMonthlyDue").value = t.plan?.nextMonthlyDue || "";
    document.getElementById("etNextAnnualDue").value = t.plan?.nextAnnualDue || "";
    document.getElementById("etBillingNotes").value = t.billingNotes || "";
    document.getElementById("etResetAdminPass").value = "";
    const m = t.modules || {};
    document.getElementById("etModOnline").checked = m.onlineStore !== false;
    document.getElementById("etModCold").checked = m.coldRooms !== false;
    document.getElementById("etModRipeness").checked = m.ripeness !== false;
    document.getElementById("etModFrac").checked = m.fractionalSales !== false;
    document.getElementById("etModNav3d").checked = m.nav3d !== false;
    editModal.classList.add("open");
  }
});

document.getElementById("btnSaveTenantEdit").addEventListener("click", async () => {
  const slug = document.getElementById("etSlug").value;
  const t = allTenants.find((x) => x.tenantSlug === slug);
  if (!t) return;
  const updates = {
    plan: {
      ...(t.plan || {}),
      maxDrivers: Math.max(1, Number(document.getElementById("etMaxDrivers").value) || 10),
      monthlyFeeMxn: Math.max(0, Number(document.getElementById("etMonthlyFee").value) || 0),
      perDriverFeeMxn: Math.max(0, Number(document.getElementById("etPerDriverFee").value) || 0),
      annualFeeMxn: Math.max(0, Number(document.getElementById("etAnnualFee").value) || 0),
      nextMonthlyDue: document.getElementById("etNextMonthlyDue").value || "",
      nextAnnualDue: document.getElementById("etNextAnnualDue").value || ""
    },
    modules: {
      onlineStore: document.getElementById("etModOnline").checked,
      coldRooms: document.getElementById("etModCold").checked,
      ripeness: document.getElementById("etModRipeness").checked,
      fractionalSales: document.getElementById("etModFrac").checked,
      nav3d: document.getElementById("etModNav3d").checked
    },
    billingNotes: document.getElementById("etBillingNotes").value.trim()
  };
  const newPass = document.getElementById("etResetAdminPass").value.trim();
  if (newPass) updates.newAdminPassword = newPass;

  const btn = document.getElementById("btnSaveTenantEdit");
  btn.disabled = true;
  try {
    await callSaasApi("saasUpdateTenant", {
      saasKeyHash: currentSaasHash,
      tenantSlug: slug,
      updates
    });
    editModal.classList.remove("open");
    showToast("✅ Configuración del tenant actualizada.");
    loadTenantsAndTelemetry();
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btnCloseHistoryModal")?.addEventListener("click", () => {
  document.getElementById("paymentHistoryModal")?.classList.remove("open");
});

document.getElementById("paymentHistoryModal")?.addEventListener("click", (e) => {
  if (e.target.id === "paymentHistoryModal") {
    e.currentTarget.classList.remove("open");
  }
});

checkBootstrapStatus();
