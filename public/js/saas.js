import {
  FUNCTIONS_BASE_URL,
  sha256Hex,
  parseCoordsFromInput,
  matchesSmartSearch
} from "./firebase-config.js?v=rpd_4";
import { INDUSTRY_TEMPLATES } from "./tenant-config.js?v=rpd_4";

const SAAS_MASTER_KEY_STORAGE = "rpd_saas_master_hash_v1";
const SAAS_REPORT_CURRENCY_KEY = "rpd_saas_report_currency_v1";
const SAAS_FX_RATES_KEY = "rpd_saas_fx_rates_v1";

const COUNTRY_CATALOG = [
  { code: "MX", flag: "🇲🇽", name: "México", dialCode: "52", currency: "MXN", timezone: "America/Monterrey" },
  { code: "US", flag: "🇺🇸", name: "Estados Unidos", dialCode: "1", currency: "USD", timezone: "America/Chicago" },
  { code: "CO", flag: "🇨🇴", name: "Colombia", dialCode: "57", currency: "COP", timezone: "America/Bogota" },
  { code: "PE", flag: "🇵🇪", name: "Perú", dialCode: "51", currency: "PEN", timezone: "America/Lima" },
  { code: "CL", flag: "🇨🇱", name: "Chile", dialCode: "56", currency: "CLP", timezone: "America/Santiago" },
  { code: "AR", flag: "🇦🇷", name: "Argentina", dialCode: "54", currency: "ARS", timezone: "America/Argentina/Buenos_Aires" },
  { code: "GT", flag: "🇬🇹", name: "Guatemala", dialCode: "502", currency: "GTQ", timezone: "America/Guatemala" },
  { code: "ES", flag: "🇪🇸", name: "España", dialCode: "34", currency: "EUR", timezone: "Europe/Madrid" },
  { code: "BR", flag: "🇧🇷", name: "Brasil", dialCode: "55", currency: "BRL", timezone: "America/Sao_Paulo" },
  { code: "OT", flag: "🌎", name: "Otro País", dialCode: "1", currency: "USD", timezone: "UTC" }
];

// Unidades por cada 1 USD (referencia editable por el Superadmin)
const DEFAULT_FX_PER_USD = {
  USD: 1,
  MXN: 20.0,
  EUR: 0.92,
  COP: 4200,
  PEN: 3.75,
  CLP: 960,
  ARS: 1050,
  GTQ: 7.75,
  BRL: 5.75
};

let fxPerUsd = loadFxRates();
let reportCurrency = localStorage.getItem(SAAS_REPORT_CURRENCY_KEY) || "MXN";

let currentSaasHash = "";
let isPlatformInitialized = true;
let allTenants = [];

// Table state
let activeInboxFilter = "all";
let sortCol = "due";
let sortDir = "asc";
let currentPage = 1;
let pageSize = 50;
let currentDrawerSlug = "";
let currentDrawerTab = "overview";

const loginView = document.getElementById("saasLoginView");
const dashView = document.getElementById("saasDashboardView");
const headerActions = document.getElementById("saasHeaderActions");
const toastBox = document.getElementById("toastBox");

function loadFxRates() {
  try {
    const raw = localStorage.getItem(SAAS_FX_RATES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_FX_PER_USD, ...parsed, USD: 1 };
    }
  } catch (_) {}
  return { ...DEFAULT_FX_PER_USD };
}

function showToast(msg) {
  if (!toastBox) return;
  toastBox.textContent = msg;
  toastBox.classList.add("show");
  setTimeout(() => toastBox.classList.remove("show"), 3600);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getCountryMeta(code) {
  const clean = String(code || "MX").toUpperCase();
  return COUNTRY_CATALOG.find((c) => c.code === clean) || COUNTRY_CATALOG[0];
}

function getTenantRegion(t) {
  const code = String(t.countryCode || t.plan?.countryCode || "MX").toUpperCase();
  const meta = getCountryMeta(code);
  const currency = String(t.currency || t.plan?.currency || meta.currency || "MXN").toUpperCase();
  const dialCode = String(t.dialCode || t.plan?.dialCode || meta.dialCode || "52").replace(/\D/g, "");
  const timezone = String(t.timezone || t.plan?.timezone || meta.timezone || "America/Monterrey");
  const contactPhone = String(t.contactPhone || t.plan?.contactPhone || "").replace(/\D/g, "");
  return { countryCode: meta.code, flag: meta.flag, countryName: meta.name, currency, dialCode, timezone, contactPhone };
}

function formatMoney(amount, currency = "MXN", compact = false) {
  const val = Number(amount) || 0;
  const cur = String(currency || "MXN").toUpperCase();
  try {
    const zeroDecimals = cur === "COP" || cur === "CLP" || cur === "ARS" || Math.abs(val) >= 100;
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: cur,
      notation: compact && Math.abs(val) >= 100000 ? "compact" : "standard",
      maximumFractionDigits: zeroDecimals ? 0 : 2
    }).format(val);
  } catch (_) {
    return `${cur} $${val.toLocaleString("es-MX")}`;
  }
}

function convertCurrency(amount, fromCur, toCur) {
  const val = Number(amount) || 0;
  if (!val || fromCur === toCur) return val;
  const fromRate = Number(fxPerUsd[fromCur]) || 1;
  const toRate = Number(fxPerUsd[toCur]) || 1;
  const inUsd = val / fromRate;
  return inUsd * toRate;
}

function getTodayIsoLocal() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function addMonthsIso(baseIso, months) {
  const start = baseIso ? new Date(baseIso + "T12:00:00") : new Date();
  start.setMonth(start.getMonth() + months);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
}

function computeDueStatus(dateStr, cycleDays = 30) {
  if (!dateStr) {
    return {
      state: "unset",
      diffDays: 99999,
      label: "⚪ Sin fecha",
      detail: "Sin corte asignado",
      progressPct: 0,
      barColor: "#475569",
      color: "#94a3b8",
      bg: "rgba(148,163,184,0.14)"
    };
  }
  const todayIso = getTodayIsoLocal();
  const diffDays = Math.round((new Date(dateStr + "T00:00:00") - new Date(todayIso + "T00:00:00")) / 86400000);
  if (diffDays < 0) {
    return {
      state: "overdue",
      diffDays,
      label: `🔴 -${Math.abs(diffDays)}d`,
      detail: `Vencido hace ${Math.abs(diffDays)}d (${dateStr})`,
      progressPct: 100,
      barColor: "#ef4444",
      color: "#fca5a5",
      bg: "rgba(239,68,68,0.22)"
    };
  }
  if (diffDays <= 5) {
    const pct = Math.min(98, Math.max(78, Math.round(((cycleDays - diffDays) / cycleDays) * 100)));
    return {
      state: "soon",
      diffDays,
      label: diffDays === 0 ? "🟠 HOY" : `🟡 En ${diffDays}d`,
      detail: diffDays === 0 ? `Vence HOY (${dateStr})` : `Vence en ${diffDays}d (${dateStr})`,
      progressPct: pct,
      barColor: diffDays === 0 ? "#f97316" : "#f59e0b",
      color: "#fde68a",
      bg: "rgba(245,158,11,0.2)"
    };
  }
  const pct = Math.min(82, Math.max(8, Math.round(((cycleDays - Math.min(cycleDays, diffDays)) / cycleDays) * 100)));
  return {
    state: "ok",
    diffDays,
    label: `🟢 +${diffDays}d`,
    detail: `Al corriente (${dateStr})`,
    progressPct: pct,
    barColor: "#10b981",
    color: "#6ee7b7",
    bg: "rgba(16,185,129,0.16)"
  };
}

function computePunctuality(plan = {}) {
  const hist = Array.isArray(plan?.paymentHistory) ? plan.paymentHistory : [];
  if (hist.length === 0) {
    return { score: 1, label: "Sin historial", color: "#94a3b8", bg: "rgba(148,163,184,0.12)", lateCount: 0, total: 0 };
  }
  const lateCount = hist.filter((h) => Number(h.daysLate) > 1).length;
  if (lateCount === 0) {
    return { score: 3, label: `⭐ Puntual (${hist.length})`, color: "#6ee7b7", bg: "rgba(16,185,129,0.16)", lateCount, total: hist.length };
  }
  const ratio = lateCount / hist.length;
  if (ratio <= 0.35) {
    return { score: 2, label: `🟡 Atraso (${lateCount}/${hist.length})`, color: "#fde68a", bg: "rgba(245,158,11,0.18)", lateCount, total: hist.length };
  }
  return { score: 0, label: `🔴 Moroso (${lateCount}/${hist.length})`, color: "#fca5a5", bg: "rgba(239,68,68,0.22)", lateCount, total: hist.length };
}

function enrichTenantComputed(t) {
  const reg = getTenantRegion(t);
  const tel = t.telemetry || {};
  const drvCount = Math.max(0, Number(tel.driversConfigured ?? t.driversConfigured ?? 1));
  const maxDrv = Math.max(1, Number(t.plan?.maxDrivers) || 25);
  const baseM = Math.max(0, Number(t.plan?.monthlyFeeMxn) || 0);
  const perDrv = Math.max(0, Number(t.plan?.perDriverFeeMxn) || 0);
  const annualLocal = Math.max(0, Number(t.plan?.annualFeeMxn) || 0);
  const mrrLocal = baseM + perDrv * drvCount;
  const mrrReport = convertCurrency(mrrLocal, reg.currency, reportCurrency);
  const annualReport = convertCurrency(annualLocal, reg.currency, reportCurrency);

  const mDue = computeDueStatus(t.plan?.nextMonthlyDue, 30);
  const aDue = computeDueStatus(t.plan?.nextAnnualDue, 365);

  let overallState = "unset";
  if (mDue.state === "overdue" || aDue.state === "overdue") overallState = "overdue";
  else if (mDue.state === "soon" || aDue.state === "soon") overallState = "soon";
  else if (mDue.state === "ok" || aDue.state === "ok") overallState = "ok";

  const nearestDiffDays = Math.min(mDue.diffDays, aDue.diffDays);
  const primaryDue = mDue.diffDays <= aDue.diffDays ? mDue : aDue;
  const punct = computePunctuality(t.plan);

  return {
    raw: t,
    slug: t.tenantSlug,
    brandName: t.brandName || t.tenantSlug,
    pinEmoji: t.pinEmoji || "🏢",
    industry: t.industry || "avocado",
    isSuspended: t.tenantStatus === "suspended",
    reg,
    drvCount,
    maxDrv,
    onlineTrucks: Number(tel.onlineTrucks) || 0,
    placesCount: Number(tel.placesCount ?? t.placesCount) || 0,
    gmvToday: Number(tel.gmvToday) || 0,
    liveLoaded: tel.liveLoaded !== false,
    baseM,
    perDrv,
    mrrLocal,
    annualLocal,
    mrrReport,
    annualReport,
    mDue,
    aDue,
    primaryDue,
    overallState,
    nearestDiffDays,
    punct
  };
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

// ================= POPULATE COUNTRY SELECTS =================
function initStaticControls() {
  const countryOptsHtml = COUNTRY_CATALOG.map(
    (c) => `<option value="${c.code}">${c.flag} ${escapeHtml(c.name)} (+${c.dialCode} • ${c.currency})</option>`
  ).join("");
  const ntCountry = document.getElementById("ntCountry");
  const drwCountry = document.getElementById("drwCountry");
  if (ntCountry) ntCountry.innerHTML = countryOptsHtml;
  if (drwCountry) drwCountry.innerHTML = countryOptsHtml;

  const repSel = document.getElementById("saasReportCurrencySelect");
  if (repSel) {
    repSel.value = reportCurrency;
    repSel.addEventListener("change", () => {
      reportCurrency = repSel.value;
      localStorage.setItem(SAAS_REPORT_CURRENCY_KEY, reportCurrency);
      renderAll();
    });
  }

  ntCountry?.addEventListener("change", () => {
    const meta = getCountryMeta(ntCountry.value);
    document.getElementById("ntCurrency").value = meta.currency;
    document.getElementById("ntTimezone").value = meta.timezone;
    document.getElementById("ntDialCode").value = meta.dialCode;
    document.getElementById("ntDialPreview").textContent = meta.dialCode;
  });

  drwCountry?.addEventListener("change", () => {
    const meta = getCountryMeta(drwCountry.value);
    document.getElementById("drwDialCode").value = meta.dialCode;
    document.getElementById("drwTimezone").value = meta.timezone;
  });
}

// ================= AUTH & BOOTSTRAP =================
async function checkBootstrapStatus() {
  initStaticControls();
  try {
    const res = await callSaasApi("saasBootstrapAndAuth", { action: "status" });
    isPlatformInitialized = Boolean(res.initialized);
    if (!isPlatformInitialized) {
      document.getElementById("saasAuthTitle").textContent = "Activar Consola Maestra SaaS";
      document.getElementById("saasAuthDesc").innerHTML =
        "Primera vez: define tu <strong>Clave Maestra de Ruta Pro Technologies</strong>. Salinas quedará registrado como el Tenant #1.";
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
    showToast(action === "init" ? "✅ Plataforma SaaS activada." : "Bienvenido a Ruta Pro Distribution.");
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
  closeDrawer();
  dashView.style.display = "none";
  headerActions.style.display = "none";
  loginView.style.display = "block";
});

function enterSaasDashboard() {
  loginView.style.display = "none";
  dashView.style.display = "block";
  headerActions.style.display = "flex";
  loadTenantsPortfolio();
}

// ================= DATA LOADING & SCALABLE TELEMETRY =================
async function loadTenantsPortfolio() {
  const tbody = document.getElementById("saasTenantsTableBody");
  if (tbody && !allTenants.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#94a3b8;">⏳ Consultando cartera global de tenants...</td></tr>`;
  }
  try {
    const res = await callSaasApi("saasListTenants", {
      saasKeyHash: currentSaasHash,
      mode: "summary"
    });
    allTenants = res.tenants || [];
    syncDynamicFilterDropdowns();
    renderAll();
    if (currentDrawerSlug) {
      const updated = allTenants.find((x) => x.tenantSlug === currentDrawerSlug);
      if (updated) populateDrawer(updated);
    }
    if (res.summaryOnly) {
      refreshCurrentPageTelemetry(true);
    }
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#fca5a5;">${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

async function refreshSlugsLiveTelemetry(slugs, silent = false) {
  if (!slugs.length) return;
  try {
    const res = await callSaasApi("saasGetTenantTelemetry", {
      saasKeyHash: currentSaasHash,
      tenantSlugs: slugs
    });
    const map = res.telemetryBySlug || {};
    allTenants = allTenants.map((t) =>
      map[t.tenantSlug] ? { ...t, telemetry: map[t.tenantSlug] } : t
    );
    renderAll();
    if (currentDrawerSlug && map[currentDrawerSlug]) {
      const updated = allTenants.find((x) => x.tenantSlug === currentDrawerSlug);
      if (updated) populateDrawer(updated);
    }
    if (!silent) showToast(`⚡ Telemetría en vivo actualizada (${Object.keys(map).length} empresas).`);
  } catch (_) {
    if (!silent) {
      // Fallback si la Cloud Function nueva aún no se despliega: recargar lista normal
      await loadTenantsPortfolio();
      showToast("🔄 Datos sincronizados.");
    }
  }
}

function syncDynamicFilterDropdowns() {
  const countrySel = document.getElementById("saasFilterCountry");
  const curSel = document.getElementById("saasFilterCurrency");
  if (countrySel) {
    const prev = countrySel.value;
    const codes = Array.from(new Set(allTenants.map((t) => getTenantRegion(t).countryCode))).sort();
    countrySel.innerHTML =
      `<option value="all">🌍 Todos los países (${codes.length})</option>` +
      codes
        .map((c) => {
          const m = getCountryMeta(c);
          return `<option value="${c}">${m.flag} ${escapeHtml(m.name)}</option>`;
        })
        .join("");
    if ([...countrySel.options].some((o) => o.value === prev)) countrySel.value = prev;
  }
  if (curSel) {
    const prev = curSel.value;
    const curs = Array.from(new Set(allTenants.map((t) => getTenantRegion(t).currency))).sort();
    curSel.innerHTML =
      `<option value="all">💱 Todas las monedas (${curs.length})</option>` +
      curs.map((c) => `<option value="${c}">${escapeHtml(c)}</option>`).join("");
    if ([...curSel.options].some((o) => o.value === prev)) curSel.value = prev;
  }
}

// ================= FILTER, SORT & RENDER ENGINE =================
function getFilteredAndSortedItems() {
  const enriched = allTenants.map(enrichTenantComputed);

  // Contadores de Bandeja de Acción (sobre toda la cartera)
  const counts = { all: enriched.length, overdue: 0, soon: 0, ok: 0, unset: 0, suspended: 0 };
  for (const item of enriched) {
    if (item.isSuspended) counts.suspended++;
    counts[item.overallState] = (counts[item.overallState] || 0) + 1;
  }
  document.getElementById("cntInboxAll").textContent = String(counts.all);
  document.getElementById("cntInboxOverdue").textContent = String(counts.overdue);
  document.getElementById("cntInboxSoon").textContent = String(counts.soon);
  document.getElementById("cntInboxOk").textContent = String(counts.ok);
  document.getElementById("cntInboxUnset").textContent = String(counts.unset);
  document.getElementById("cntInboxSuspended").textContent = String(counts.suspended);

  const q = document.getElementById("saasSearchInput")?.value.trim() || "";
  const fCountry = document.getElementById("saasFilterCountry")?.value || "all";
  const fCur = document.getElementById("saasFilterCurrency")?.value || "all";
  const fInd = document.getElementById("saasFilterIndustry")?.value || "all";

  const filtered = enriched.filter((it) => {
    if (activeInboxFilter === "suspended" && !it.isSuspended) return false;
    if (activeInboxFilter !== "all" && activeInboxFilter !== "suspended" && it.overallState !== activeInboxFilter) return false;
    if (fCountry !== "all" && it.reg.countryCode !== fCountry) return false;
    if (fCur !== "all" && it.reg.currency !== fCur) return false;
    if (fInd !== "all" && it.industry !== fInd) return false;
    if (q) {
      const hay = `${it.brandName} ${it.slug} ${it.reg.countryName} ${it.reg.currency} ${it.industry} ${it.raw.billingNotes || ""}`;
      if (!matchesSmartSearch(hay, q)) return false;
    }
    return true;
  });

  const dir = sortDir === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    switch (sortCol) {
      case "brand":
        return a.brandName.localeCompare(b.brandName) * dir;
      case "country":
        return `${a.reg.countryCode}_${a.reg.currency}`.localeCompare(`${b.reg.countryCode}_${b.reg.currency}`) * dir;
      case "fleet":
        return (a.drvCount - b.drvCount) * dir;
      case "mrr":
        return (a.mrrReport - b.mrrReport) * dir;
      case "punctuality":
        return (a.punct.score - b.punct.score) * dir;
      case "due":
      default:
        return (a.nearestDiffDays - b.nearestDiffDays) * dir;
    }
  });

  return { enriched, filtered, counts };
}

function renderAll() {
  const { enriched, filtered, counts } = getFilteredAndSortedItems();

  // 1. Render KPIs Consolidados
  const activeItems = enriched.filter((x) => !x.isSuspended);
  const countriesSet = new Set(enriched.map((x) => x.reg.countryCode));
  let mrrConsolidated = 0;
  let annualOnlyConsolidated = 0;
  const mrrByNativeCur = {};
  let totalDrv = 0;
  let totalGps = 0;
  let totalPlaces = 0;

  for (const it of enriched) {
    totalDrv += it.drvCount;
    totalGps += it.onlineTrucks;
    totalPlaces += it.placesCount;
    if (!it.isSuspended) {
      mrrConsolidated += it.mrrReport;
      annualOnlyConsolidated += it.annualReport;
      if (it.mrrLocal > 0) {
        mrrByNativeCur[it.reg.currency] = (mrrByNativeCur[it.reg.currency] || 0) + it.mrrLocal;
      }
    }
  }

  const arrConsolidated = mrrConsolidated * 12 + annualOnlyConsolidated;
  const nativeBreakdown = Object.entries(mrrByNativeCur)
    .map(([cur, val]) => formatMoney(val, cur, true))
    .join(" • ");

  document.getElementById("kpiSaasTenants").textContent = enriched.length.toLocaleString("es-MX");
  document.getElementById("kpiSaasTenantsSub").textContent = `${activeItems.length} activas • ${countriesSet.size} país${countriesSet.size === 1 ? "" : "es"}`;
  document.getElementById("kpiSaasMrr").textContent = `${formatMoney(mrrConsolidated, reportCurrency)}/m`;
  document.getElementById("kpiSaasMrrBreakdown").textContent = nativeBreakdown || "Configura rentas en Cobranza";
  document.getElementById("kpiSaasArr").textContent = `${formatMoney(arrConsolidated, reportCurrency, true)}/a`;
  document.getElementById("kpiSaasArrSub").textContent = `Anualidades directas: ${formatMoney(annualOnlyConsolidated, reportCurrency, true)}`;
  const urgentTotal = counts.overdue + counts.soon;
  document.getElementById("kpiSaasAlerts").textContent = `${urgentTotal} por atender`;
  document.getElementById("kpiSaasAlerts").style.color = counts.overdue > 0 ? "#f87171" : counts.soon > 0 ? "#fbbf24" : "#34d399";
  document.getElementById("kpiSaasAlertsSub").textContent = `${counts.overdue} vencidos • ${counts.soon} vencen en ≤5d`;
  document.getElementById("kpiSaasFleet").textContent = `${totalDrv.toLocaleString("es-MX")} chof.`;
  document.getElementById("kpiSaasFleetSub").textContent = `${totalGps} GPS en vivo • ${totalPlaces.toLocaleString("es-MX")} negocios`;

  // Sort header indicators
  ["brand", "country", "fleet", "mrr", "due", "punctuality"].forEach((col) => {
    const el = document.getElementById(`sortIcon_${col}`);
    if (el) el.textContent = sortCol === col ? (sortDir === "asc" ? "▲" : "▼") : "";
  });

  // 2. Paginación
  const totalRows = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const startIdx = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(startIdx, startIdx + pageSize);

  document.getElementById("saasPageSummaryText").textContent = totalRows
    ? `Mostrando ${startIdx + 1}–${Math.min(startIdx + pageSize, totalRows)} de ${totalRows.toLocaleString("es-MX")} empresas`
    : "0 empresas con los filtros actuales";
  document.getElementById("saasPageIndicator").textContent = `Página ${currentPage} / ${totalPages}`;
  document.getElementById("btnSaasPrevPage").disabled = currentPage <= 1;
  document.getElementById("btnSaasNextPage").disabled = currentPage >= totalPages;

  // 3. Render Table Rows
  const tbody = document.getElementById("saasTenantsTableBody");
  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#94a3b8;">No hay empresas en esta vista.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageItems
    .map((it) => {
      const showConv = it.reg.currency !== reportCurrency && (it.mrrLocal > 0 || it.annualLocal > 0);
      const subFeeLine =
        it.annualLocal > 0
          ? `+ ${formatMoney(it.annualLocal, it.reg.currency, true)}/año`
          : it.perDrv > 0
          ? `${formatMoney(it.perDrv, it.reg.currency)} × ${it.drvCount} chof.`
          : "Sin anualidad";

      return `
        <tr class="is-row-${it.overallState}" data-row-slug="${escapeHtml(it.slug)}">
          <td>
            <div style="display:flex;align-items:center;gap:9px;">
              <span style="font-size:1.2rem;">${escapeHtml(it.pinEmoji)}</span>
              <div>
                <strong style="color:#f8fafc;font-size:0.86rem;display:block;line-height:1.2;">${escapeHtml(it.brandName)}</strong>
                <code style="color:#38bdf8;font-size:0.72rem;">${escapeHtml(it.slug)}</code>
                ${it.raw.billingNotes ? `<span style="color:#64748b;font-size:0.7rem;margin-left:6px;">• ${escapeHtml(String(it.raw.billingNotes).slice(0, 26))}</span>` : ""}
              </div>
            </div>
          </td>
          <td>
            <div style="font-weight:800;color:#e2e8f0;">${it.reg.flag} ${escapeHtml(it.reg.countryCode)} • <span style="color:#38bdf8;">${escapeHtml(it.reg.currency)}</span></div>
            <div style="font-size:0.69rem;color:#64748b;">${escapeHtml(it.reg.timezone.replace(/^.*\//, ""))}</div>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span class="saas-pill ${it.isSuspended ? "suspended" : "active"}">${it.isSuspended ? "⏸️ Pausa" : "🟢 Activo"}</span>
              <span style="font-weight:700;color:#cbd5e1;font-size:0.76rem;">${it.drvCount}/${it.maxDrv} chof.</span>
            </div>
            <div style="font-size:0.7rem;color:${it.onlineTrucks > 0 ? "#34d399" : "#64748b"};margin-top:2px;">
              ${it.liveLoaded ? `${it.onlineTrucks} GPS • Hoy ${formatMoney(it.gmvToday, it.reg.currency, true)}` : `${it.placesCount} tiendas (caché)`}
            </div>
          </td>
          <td>
            <strong style="color:#f8fafc;font-size:0.85rem;">${it.mrrLocal > 0 ? `${formatMoney(it.mrrLocal, it.reg.currency)}/m` : "Interno / $0"}</strong>
            <div style="font-size:0.7rem;color:#94a3b8;">${escapeHtml(subFeeLine)}${showConv ? ` • ≈${formatMoney(it.mrrReport, reportCurrency, true)}` : ""}</div>
          </td>
          <td>
            <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.71rem;font-weight:800;color:${it.primaryDue.color};background:${it.primaryDue.bg};">
              ${it.primaryDue.label}
            </span>
            <div class="saas-mini-bar"><div style="width:${it.primaryDue.progressPct}%;background:${it.primaryDue.barColor};"></div></div>
            <div style="font-size:0.68rem;color:#64748b;margin-top:2px;">${escapeHtml(it.raw.plan?.nextMonthlyDue || it.raw.plan?.nextAnnualDue || "Sin fecha")}</div>
          </td>
          <td>
            <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.7rem;font-weight:800;color:${it.punct.color};background:${it.punct.bg};">
              ${it.punct.label}
            </span>
          </td>
          <td style="text-align:right;white-space:nowrap;">
            <button type="button" class="btn btn-outline btn-sm" data-quick-pay="${escapeHtml(it.slug)}" title="Registrar pago recibido (+1 mes, pide confirmación)" style="padding:4px 8px;font-size:0.72rem;">✅ +1m</button>
            <button type="button" class="btn btn-outline btn-sm" data-open-billing="${escapeHtml(it.slug)}" title="Editar fechas de corte, tarifas o revertir pagos" style="padding:4px 9px;font-size:0.72rem;border-color:#10b981 !important;color:#34d399 !important;">💳 Fechas / Cobro</button>
            <button type="button" class="btn btn-outline btn-sm" data-open-drawer="${escapeHtml(it.slug)}" title="Editar límite de choferes, país, módulos y accesos" style="padding:4px 9px;font-size:0.72rem;border-color:#38bdf8 !important;color:#38bdf8 !important;">⚙️ Editar ›</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function getCurrentPageSlugs() {
  const { filtered } = getFilteredAndSortedItems();
  const startIdx = (currentPage - 1) * pageSize;
  return filtered.slice(startIdx, startIdx + pageSize).map((x) => x.slug);
}

async function refreshCurrentPageTelemetry(silent = false) {
  const slugs = getCurrentPageSlugs();
  await refreshSlugsLiveTelemetry(slugs, silent);
}

// ================= SLIDE-OVER DRAWER LOGIC =================
function switchDrawerTab(tabId) {
  currentDrawerTab = tabId;
  document.querySelectorAll("#drawerTabsNav .saas-drawer-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.drawerTab === tabId);
  });
  ["overview", "billing", "history", "settings"].forEach((id) => {
    const pane = document.getElementById(`drwPane_${id}`);
    if (pane) pane.style.display = id === tabId ? "block" : "none";
  });
}

function openDrawerForSlug(slug, initialTab = "overview") {
  const t = allTenants.find((x) => x.tenantSlug === slug);
  if (!t) return;
  currentDrawerSlug = slug;
  populateDrawer(t);
  switchDrawerTab(initialTab);
  document.getElementById("tenantDrawerBackdrop").classList.add("open");
  if (t.telemetry?.liveLoaded === false) {
    refreshSlugsLiveTelemetry([slug], true);
  }
}

function closeDrawer() {
  currentDrawerSlug = "";
  document.getElementById("tenantDrawerBackdrop")?.classList.remove("open");
}

function updateDrawerMrrPreview() {
  const t = allTenants.find((x) => x.tenantSlug === currentDrawerSlug);
  const drvCount = Math.max(0, Number(t?.telemetry?.driversConfigured ?? t?.driversConfigured ?? 1));
  const cur = document.getElementById("drwCurrency").value || "MXN";
  const baseM = Math.max(0, Number(document.getElementById("drwMonthlyFee").value) || 0);
  const perDrv = Math.max(0, Number(document.getElementById("drwPerDriverFee").value) || 0);
  const ann = Math.max(0, Number(document.getElementById("drwAnnualFee").value) || 0);
  const totalM = baseM + perDrv * drvCount;
  const hint = document.getElementById("drwCalculatedMrrHint");
  if (hint) {
    hint.textContent = `Total Mensual Actual (${drvCount} choferes): ${formatMoney(totalM, cur)}/mes  •  Anualidad: ${formatMoney(ann, cur)}/año`;
  }
}

function populateDrawer(rawTenant) {
  const it = enrichTenantComputed(rawTenant);
  const t = rawTenant;
  document.getElementById("drwSlug").value = it.slug;
  document.getElementById("drwTitle").textContent = `${it.reg.flag} ${it.pinEmoji} ${it.brandName}`;
  const pill = document.getElementById("drwStatusPill");
  pill.className = `saas-pill ${it.isSuspended ? "suspended" : "active"}`;
  pill.textContent = it.isSuspended ? "⏸️ Suspendido" : "🟢 Activo";
  document.getElementById("drwSubMeta").innerHTML =
    `Código: <code style="color:#38bdf8;">${escapeHtml(it.slug)}</code> • ${escapeHtml(it.reg.countryName)} (${escapeHtml(it.reg.currency)}) • TZ: ${escapeHtml(it.reg.timezone)}`;

  // Overview tab
  document.getElementById("drwTelDrivers").textContent = `${it.drvCount} / ${it.maxDrv} contratados`;
  document.getElementById("drwTelGps").textContent = `${it.onlineTrucks} unidad(es) con GPS activo`;
  document.getElementById("drwTelGmv").textContent = formatMoney(it.gmvToday, it.reg.currency);
  document.getElementById("drwTelPlaces").textContent = `${it.placesCount.toLocaleString("es-MX")} negocios en mapa`;

  const origin = window.location.origin;
  const qParam = it.slug === "salinas" ? "" : `?t=${encodeURIComponent(it.slug)}`;
  document.getElementById("drwDirectLinks").innerHTML = `
    <a href="${origin}/${qParam}" target="_blank" rel="noopener" class="saas-link-chip">🛒 Tienda</a>
    <a href="${origin}/admin.html${qParam}" target="_blank" rel="noopener" class="saas-link-chip">💼 Panel Admin</a>
    <a href="${origin}/almacen.html${qParam}" target="_blank" rel="noopener" class="saas-link-chip">❄️ App Almacén</a>
    <a href="${origin}/chofer.html${qParam}" target="_blank" rel="noopener" class="saas-link-chip">🚗 App Chofer</a>
  `;
  document.getElementById("drwShareText").textContent =
    `Empresa: ${it.brandName} (${it.slug})\n` +
    `• Tienda Clientes: ${origin}/${qParam}\n` +
    `• Panel Admin: ${origin}/admin.html${qParam}\n` +
    `• Escáner Almacén: ${origin}/almacen.html${qParam}\n` +
    `• App Choferes: ${origin}/chofer.html${qParam}`;

  const salBox = document.getElementById("drwSalinasToolsBox");
  if (salBox) salBox.style.display = it.slug === "salinas" ? "block" : "none";

  // Billing tab
  const banner = document.getElementById("drwBillingStatusBanner");
  banner.style.background = it.primaryDue.bg;
  banner.style.color = it.primaryDue.color;
  banner.style.border = `1px solid ${it.primaryDue.barColor}`;
  banner.textContent = `Estado actual: ${it.primaryDue.detail} • Mensualidad: ${formatMoney(it.mrrLocal, it.reg.currency)}`;

  document.getElementById("drwCurrency").value = it.reg.currency;
  document.getElementById("drwMonthlyFee").value = String(it.baseM);
  document.getElementById("drwPerDriverFee").value = String(it.perDrv);
  document.getElementById("drwAnnualFee").value = String(it.annualLocal);
  document.getElementById("drwNextMonthlyDue").value = t.plan?.nextMonthlyDue || "";
  document.getElementById("drwNextAnnualDue").value = t.plan?.nextAnnualDue || "";
  document.getElementById("drwBillingNotes").value = t.billingNotes || "";
  updateDrawerMrrPreview();

  // History tab
  const hist = Array.isArray(t.plan?.paymentHistory) ? t.plan.paymentHistory : [];
  document.getElementById("drwPunctualitySummary").innerHTML =
    `<strong style="color:${it.punct.color};">${it.punct.label}</strong> — ${hist.length} pago(s) registrado(s) en bitácora.`;
  document.getElementById("drwHistoryList").innerHTML = hist.length
    ? hist
        .map((h) => {
          const late = Number(h.daysLate) || 0;
          const hCur = h.currency || it.reg.currency;
          const badge =
            late <= 1
              ? `<span style="color:#6ee7b7;background:rgba(16,185,129,0.16);padding:2px 8px;border-radius:999px;font-size:0.7rem;font-weight:800;">✅ A tiempo</span>`
              : `<span style="color:#fca5a5;background:rgba(239,68,68,0.22);padding:2px 8px;border-radius:999px;font-size:0.7rem;font-weight:800;">⏰ +${late}d tarde</span>`;
          return `
            <div style="background:#111827;border:1px solid #1f2937;border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <div>
                <strong style="color:#fff;font-size:0.84rem;">${h.type === "anual" ? "📅 Anualidad" : "💳 Mensualidad"} • ${formatMoney(h.amount || 0, hCur)}</strong>
                <div style="font-size:0.72rem;color:#94a3b8;">Pagado: ${String(h.paidAtIso || "").slice(0, 10)} • Corte previo: ${h.hadPrevDue === false ? "Sin fecha" : h.dueDate || "-"}</div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                ${badge}
                <button type="button" class="btn btn-outline btn-sm" data-revert-pay="${escapeHtml(h.id)}" title="Eliminar este pago y revertir fecha de corte" style="padding:3px 7px;font-size:0.7rem;color:#fca5a5 !important;border-color:#991b1b !important;">↩️ Revertir</button>
              </div>
            </div>
          `;
        })
        .join("")
    : `<div style="text-align:center;padding:24px;color:#64748b;font-size:0.8rem;">Aún no hay pagos registrados para esta cuenta.</div>`;

  // Settings tab
  document.getElementById("drwCountry").value = it.reg.countryCode;
  document.getElementById("drwDialCode").value = it.reg.dialCode;
  document.getElementById("drwTimezone").value = it.reg.timezone;
  document.getElementById("drwPhone").value = it.reg.contactPhone;
  document.getElementById("drwMaxDrivers").value = String(it.maxDrv);
  document.getElementById("drwResetAdminPass").value = "";
  const m = t.modules || {};
  document.getElementById("drwModOnline").checked = m.onlineStore !== false;
  document.getElementById("drwModCold").checked = m.coldRooms !== false;
  document.getElementById("drwModRipeness").checked = m.ripeness !== false;
  document.getElementById("drwModFrac").checked = m.fractionalSales !== false;
  document.getElementById("drwModNav3d").checked = m.nav3d !== false;

  const suspBtn = document.getElementById("btnDrwToggleSuspend");
  suspBtn.textContent = it.isSuspended ? "▶️ Reactivar Servicio de este Tenant" : "⏸️ Suspender Servicio por Falta de Pago";
  suspBtn.style.color = it.isSuspended ? "#34d399" : "#fca5a5";
  suspBtn.style.borderColor = it.isSuspended ? "#059669" : "#991b1b";
}

// ================= PAYMENT & WHATSAPP ACTIONS =================
async function recordTenantPayment(slug, periodType) {
  const t = allTenants.find((x) => x.tenantSlug === slug);
  if (!t) return;
  const it = enrichTenantComputed(t);
  const isAnnual = periodType === "anual";
  const prevDue = isAnnual ? t.plan?.nextAnnualDue || "" : t.plan?.nextMonthlyDue || "";
  const hadPrevDue = Boolean(prevDue);
  const todayIso = getTodayIsoLocal();
  const daysLate = prevDue ? Math.round((new Date(todayIso + "T00:00:00") - new Date(prevDue + "T00:00:00")) / 86400000) : 0;
  const amount = isAnnual ? it.annualLocal : it.mrrLocal;
  const nextDate = addMonthsIso(prevDue, isAnnual ? 12 : 1);

  const ok = window.confirm(
    `¿Confirmas registrar pago de ${isAnnual ? "ANUALIDAD" : "MENSUALIDAD"} para "${it.brandName}"?\n\n` +
      `• Monto: ${formatMoney(amount, it.reg.currency)}\n` +
      `• Corte anterior: ${prevDue || "Sin fecha"}\n` +
      `• Nuevo próximo corte: ${nextDate}`
  );
  if (!ok) return;

  const prevHist = Array.isArray(t.plan?.paymentHistory) ? t.plan.paymentHistory : [];

  const nextPlan = {
    ...(t.plan || {}),
    currency: it.reg.currency,
    countryCode: it.reg.countryCode,
    dialCode: it.reg.dialCode,
    timezone: it.reg.timezone,
    ...(isAnnual
      ? { nextAnnualDue: nextDate, lastAnnualPaymentAtIso: new Date().toISOString() }
      : { nextMonthlyDue: nextDate, lastPaymentAtIso: new Date().toISOString() }),
    paymentHistory: [
      {
        id: "pay_" + Date.now().toString(36),
        type: isAnnual ? "anual" : "mensual",
        amount,
        currency: it.reg.currency,
        dueDate: prevDue || todayIso,
        hadPrevDue,
        paidAtIso: new Date().toISOString(),
        daysLate
      },
      ...prevHist
    ].slice(0, 36)
  };

  await callSaasApi("saasUpdateTenant", {
    saasKeyHash: currentSaasHash,
    tenantSlug: slug,
    updates: { plan: nextPlan }
  });
  showToast(`✅ ${isAnnual ? "Anualidad" : "Mensualidad"} (${formatMoney(amount, it.reg.currency)}) registrada para ${it.brandName} → ${nextDate}`);
  await loadTenantsPortfolio();
}

async function revertTenantPayment(slug, payId) {
  const t = allTenants.find((x) => x.tenantSlug === slug);
  if (!t) return;
  const hist = Array.isArray(t.plan?.paymentHistory) ? t.plan.paymentHistory : [];
  const entry = hist.find((h) => h.id === payId);
  if (!entry) return;

  const isAnnual = entry.type === "anual";
  // Si el pago accidental se hizo cuando la fecha estaba vacía (o coincidía con el mismo día del pago), ofrecer dejarla vacía o restaurarla
  const paidDay = String(entry.paidAtIso || "").slice(0, 10);
  const restoredDate = entry.hadPrevDue === false || entry.dueDate === paidDay ? "" : entry.dueDate || "";

  const ok = window.confirm(
    `¿Revertir y eliminar este pago de ${isAnnual ? "Anualidad" : "Mensualidad"} (${formatMoney(entry.amount || 0, entry.currency || "MXN")})?\n\n` +
      `• La fecha de corte regresará a: ${restoredDate || "Sin fecha (puedes poner la que gustes en Cobranza)"}`
  );
  if (!ok) return;

  const nextHist = hist.filter((h) => h.id !== payId);
  const nextPlan = {
    ...(t.plan || {}),
    paymentHistory: nextHist,
    ...(isAnnual ? { nextAnnualDue: restoredDate } : { nextMonthlyDue: restoredDate })
  };

  await callSaasApi("saasUpdateTenant", {
    saasKeyHash: currentSaasHash,
    tenantSlug: slug,
    updates: { plan: nextPlan }
  });
  showToast(`↩️ Pago revertido y eliminado del historial de ${t.brandName}.`);
  await loadTenantsPortfolio();
}

async function sendTenantWhatsAppReminder(slug) {
  const t = allTenants.find((x) => x.tenantSlug === slug);
  if (!t) return;
  const it = enrichTenantComputed(t);
  const msg =
    `Hola *${it.brandName}*, te saludamos de *Ruta Pro Distribution*.\n` +
    `Te compartimos el recordatorio de tu suscripción:\n` +
    (t.plan?.nextMonthlyDue ? `• *Mensualidad:* ${formatMoney(it.mrrLocal, it.reg.currency)} (corte: ${t.plan.nextMonthlyDue})\n` : "") +
    (t.plan?.nextAnnualDue && it.annualLocal > 0 ? `• *Anualidad:* ${formatMoney(it.annualLocal, it.reg.currency)} (vence: ${t.plan.nextAnnualDue})\n` : "") +
    `Quedamos atentos a tu confirmación para mantener tu operación activa sin interrupciones. ¡Gracias!`;

  const localDigits = it.reg.contactPhone.replace(/\D/g, "");
  if (localDigits.length >= 7) {
    const fullPhone = localDigits.startsWith(it.reg.dialCode) && localDigits.length > 10 ? localDigits : `${it.reg.dialCode}${localDigits}`;
    window.open(`https://api.whatsapp.com/send?phone=${fullPhone}&text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  } else {
    await navigator.clipboard?.writeText?.(msg);
    showToast("📋 Mensaje copiado (agrega su teléfono en Ajustes del Drawer para abrir WhatsApp directo).");
  }
}

// ================= EVENT BINDINGS =================
document.getElementById("saasInboxBar")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-inbox]");
  if (!btn) return;
  activeInboxFilter = btn.dataset.inbox || "all";
  currentPage = 1;
  document.querySelectorAll("#saasInboxBar .saas-inbox-pill").forEach((b) => b.classList.toggle("active", b === btn));
  renderAll();
});

["saasSearchInput", "saasFilterCountry", "saasFilterCurrency", "saasFilterIndustry"].forEach((id) => {
  const el = document.getElementById(id);
  el?.addEventListener(id === "saasSearchInput" ? "input" : "change", () => {
    currentPage = 1;
    renderAll();
  });
});

document.getElementById("saasPageSizeSelect")?.addEventListener("change", (e) => {
  pageSize = Number(e.target.value) || 50;
  currentPage = 1;
  renderAll();
});

document.getElementById("btnSaasPrevPage")?.addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage--;
    renderAll();
  }
});

document.getElementById("btnSaasNextPage")?.addEventListener("click", () => {
  currentPage++;
  renderAll();
});

document.querySelector(".saas-table thead")?.addEventListener("click", (e) => {
  const th = e.target.closest("th[data-sort-col]");
  if (!th) return;
  const col = th.dataset.sortCol;
  if (sortCol === col) {
    sortDir = sortDir === "asc" ? "desc" : "asc";
  } else {
    sortCol = col;
    sortDir = col === "mrr" || col === "fleet" ? "desc" : "asc";
  }
  renderAll();
});

document.getElementById("saasTenantsTableBody")?.addEventListener("click", async (e) => {
  const payBtn = e.target.closest("button[data-quick-pay]");
  if (payBtn) {
    e.stopPropagation();
    payBtn.disabled = true;
    try {
      await recordTenantPayment(payBtn.dataset.quickPay, "mensual");
    } catch (err) {
      showToast(err.message);
    } finally {
      payBtn.disabled = false;
    }
    return;
  }

  const waBtn = e.target.closest("button[data-quick-wa]");
  if (waBtn) {
    e.stopPropagation();
    await sendTenantWhatsAppReminder(waBtn.dataset.quickWa);
    return;
  }

  const openBillingBtn = e.target.closest("button[data-open-billing]");
  if (openBillingBtn) {
    e.stopPropagation();
    openDrawerForSlug(openBillingBtn.dataset.openBilling, "billing");
    return;
  }

  const openBtn = e.target.closest("button[data-open-drawer]");
  if (openBtn) {
    e.stopPropagation();
    openDrawerForSlug(openBtn.dataset.openDrawer, "settings");
    return;
  }

  const row = e.target.closest("tr[data-row-slug]");
  if (row) {
    openDrawerForSlug(row.dataset.rowSlug, "overview");
  }
});

document.getElementById("btnSaasRefresh")?.addEventListener("click", loadTenantsPortfolio);
document.getElementById("btnRefreshPageTelemetry")?.addEventListener("click", () => refreshCurrentPageTelemetry(false));

// Drawer events
document.getElementById("drwHistoryList")?.addEventListener("click", async (e) => {
  const revBtn = e.target.closest("button[data-revert-pay]");
  if (!revBtn || !currentDrawerSlug) return;
  revBtn.disabled = true;
  try {
    await revertTenantPayment(currentDrawerSlug, revBtn.dataset.revertPay);
  } catch (err) {
    showToast(err.message);
  } finally {
    revBtn.disabled = false;
  }
});

document.getElementById("btnCloseDrawer")?.addEventListener("click", closeDrawer);
document.getElementById("tenantDrawerBackdrop")?.addEventListener("click", (e) => {
  if (e.target.id === "tenantDrawerBackdrop") closeDrawer();
});
document.getElementById("drawerTabsNav")?.addEventListener("click", (e) => {
  const tab = e.target.closest("button[data-drawer-tab]");
  if (tab) switchDrawerTab(tab.dataset.drawerTab);
});

["drwCurrency", "drwMonthlyFee", "drwPerDriverFee", "drwAnnualFee"].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", updateDrawerMrrPreview);
  document.getElementById(id)?.addEventListener("change", updateDrawerMrrPreview);
});

document.getElementById("btnDrwRefreshLive")?.addEventListener("click", () => {
  if (currentDrawerSlug) refreshSlugsLiveTelemetry([currentDrawerSlug], false);
});

document.getElementById("btnDrwCopyLinks")?.addEventListener("click", async () => {
  const txt = document.getElementById("drwShareText").textContent;
  await navigator.clipboard.writeText(txt);
  showToast("📋 Enlaces copiados al portapapeles.");
});

document.getElementById("btnDrwPayMonth")?.addEventListener("click", () => {
  if (currentDrawerSlug) recordTenantPayment(currentDrawerSlug, "mensual").catch((err) => showToast(err.message));
});
document.getElementById("btnDrwPayYear")?.addEventListener("click", () => {
  if (currentDrawerSlug) recordTenantPayment(currentDrawerSlug, "anual").catch((err) => showToast(err.message));
});
document.getElementById("btnDrwWhatsAppRemind")?.addEventListener("click", () => {
  if (currentDrawerSlug) sendTenantWhatsAppReminder(currentDrawerSlug);
});

document.getElementById("btnDrwSaveBilling")?.addEventListener("click", async () => {
  const t = allTenants.find((x) => x.tenantSlug === currentDrawerSlug);
  if (!t) return;
  const reg = getTenantRegion(t);
  const btn = document.getElementById("btnDrwSaveBilling");
  btn.disabled = true;
  try {
    const nextPlan = {
      ...(t.plan || {}),
      countryCode: reg.countryCode,
      dialCode: reg.dialCode,
      timezone: reg.timezone,
      currency: document.getElementById("drwCurrency").value,
      monthlyFeeMxn: Math.max(0, Number(document.getElementById("drwMonthlyFee").value) || 0),
      perDriverFeeMxn: Math.max(0, Number(document.getElementById("drwPerDriverFee").value) || 0),
      annualFeeMxn: Math.max(0, Number(document.getElementById("drwAnnualFee").value) || 0),
      nextMonthlyDue: document.getElementById("drwNextMonthlyDue").value || "",
      nextAnnualDue: document.getElementById("drwNextAnnualDue").value || ""
    };
    await callSaasApi("saasUpdateTenant", {
      saasKeyHash: currentSaasHash,
      tenantSlug: currentDrawerSlug,
      updates: {
        plan: nextPlan,
        billingNotes: document.getElementById("drwBillingNotes").value.trim()
      }
    });
    showToast("✅ Esquema de cobro actualizado.");
    await loadTenantsPortfolio();
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btnDrwSaveSettings")?.addEventListener("click", async () => {
  const t = allTenants.find((x) => x.tenantSlug === currentDrawerSlug);
  if (!t) return;
  const btn = document.getElementById("btnDrwSaveSettings");
  btn.disabled = true;
  try {
    const contactPhone = document.getElementById("drwPhone").value.replace(/\D/g, "");
    const updates = {
      contactPhone,
      plan: {
        ...(t.plan || {}),
        countryCode: document.getElementById("drwCountry").value,
        dialCode: document.getElementById("drwDialCode").value.replace(/\D/g, ""),
        timezone: document.getElementById("drwTimezone").value.trim() || "America/Monterrey",
        contactPhone,
        maxDrivers: Math.max(1, Number(document.getElementById("drwMaxDrivers").value) || 10)
      },
      modules: {
        onlineStore: document.getElementById("drwModOnline").checked,
        coldRooms: document.getElementById("drwModCold").checked,
        ripeness: document.getElementById("drwModRipeness").checked,
        fractionalSales: document.getElementById("drwModFrac").checked,
        nav3d: document.getElementById("drwModNav3d").checked
      }
    };
    const newPass = document.getElementById("drwResetAdminPass").value.trim();
    if (newPass) updates.newAdminPassword = newPass;

    await callSaasApi("saasUpdateTenant", {
      saasKeyHash: currentSaasHash,
      tenantSlug: currentDrawerSlug,
      updates
    });
    showToast("✅ Región, módulos y accesos guardados.");
    await loadTenantsPortfolio();
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btnDrwToggleSuspend")?.addEventListener("click", async () => {
  const t = allTenants.find((x) => x.tenantSlug === currentDrawerSlug);
  if (!t) return;
  const nextStatus = t.tenantStatus === "suspended" ? "active" : "suspended";
  const ok = window.confirm(
    nextStatus === "suspended"
      ? `¿Suspender temporalmente a "${t.brandName}"? Se bloqueará la escritura en su bóveda hasta reactivarlo.`
      : `¿Reactivar el servicio de "${t.brandName}"?`
  );
  if (!ok) return;
  try {
    await callSaasApi("saasUpdateTenant", {
      saasKeyHash: currentSaasHash,
      tenantSlug: currentDrawerSlug,
      updates: { tenantStatus: nextStatus }
    });
    showToast(nextStatus === "suspended" ? `⏸️ ${t.brandName} suspendido.` : `🟢 ${t.brandName} reactivado.`);
    await loadTenantsPortfolio();
  } catch (err) {
    showToast(err.message);
  }
});

document.getElementById("btnSaasResyncSalinas")?.addEventListener("click", async () => {
  const btn = document.getElementById("btnSaasResyncSalinas");
  btn.disabled = true;
  try {
    const res = await callSaasApi("saasBootstrapAndAuth", {
      action: "resync_salinas",
      saasKeyHash: currentSaasHash
    });
    showToast(`✅ Salinas sincronizado (${res.migrationReport?.counts?.places || 0} tiendas).`);
    await loadTenantsPortfolio();
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
  }
});

// ================= NEW TENANT WIZARD =================
const newTenantModal = document.getElementById("newTenantModal");
const ntIndustrySel = document.getElementById("ntIndustry");

function syncWizardTemplateDefaults() {
  const tpl = INDUSTRY_TEMPLATES[ntIndustrySel.value] || INDUSTRY_TEMPLATES.avocado;
  document.getElementById("ntPrimaryColor").value = tpl.theme.primary;
  document.getElementById("ntModOnline").checked = tpl.modules.onlineStore !== false;
  document.getElementById("ntModCold").checked = tpl.modules.coldRooms !== false;
  document.getElementById("ntModRipeness").checked = tpl.modules.ripeness !== false;
  document.getElementById("ntModFrac").checked = tpl.modules.fractionalSales !== false;
  document.getElementById("ntModNav3d").checked = tpl.modules.nav3d !== false;
}

ntIndustrySel?.addEventListener("change", syncWizardTemplateDefaults);

document.getElementById("btnOpenNewTenantModal")?.addEventListener("click", () => {
  document.getElementById("newTenantForm").reset();
  document.getElementById("ntWelcomeKitBox").style.display = "none";
  document.getElementById("ntCountry").value = "MX";
  document.getElementById("ntCurrency").value = "MXN";
  document.getElementById("ntTimezone").value = "America/Monterrey";
  document.getElementById("ntDialCode").value = "52";
  document.getElementById("ntDialPreview").textContent = "52";
  document.getElementById("ntNextMonthlyDue").value = addMonthsIso(getTodayIsoLocal(), 1);
  document.getElementById("ntNextAnnualDue").value = addMonthsIso(getTodayIsoLocal(), 12);
  syncWizardTemplateDefaults();
  newTenantModal.classList.add("open");
});

document.getElementById("btnCloseNewTenantModal")?.addEventListener("click", () => {
  newTenantModal.classList.remove("open");
});

document.getElementById("newTenantForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const tpl = INDUSTRY_TEMPLATES[ntIndustrySel.value] || INDUSTRY_TEMPLATES.avocado;
  const slug = document.getElementById("ntSlug").value.trim().toLowerCase();
  const brandName = document.getElementById("ntBrandName").value.trim();
  const tagline = document.getElementById("ntTagline").value.trim() || tpl.label.replace(/^[^\s]+\s/, "");
  const countryCode = document.getElementById("ntCountry").value;
  const currency = document.getElementById("ntCurrency").value;
  const timezone = document.getElementById("ntTimezone").value.trim() || "America/Monterrey";
  const dialCode = document.getElementById("ntDialCode").value;
  const phone = document.getElementById("ntPhone").value.trim();
  const primaryColor = document.getElementById("ntPrimaryColor").value;
  const maxDrivers = Number(document.getElementById("ntMaxDrivers").value) || 10;
  const monthlyFeeMxn = Number(document.getElementById("ntMonthlyFee").value) || 0;
  const perDriverFeeMxn = Number(document.getElementById("ntPerDriverFee").value) || 0;
  const annualFeeMxn = Number(document.getElementById("ntAnnualFee").value) || 0;
  const nextMonthlyDue = document.getElementById("ntNextMonthlyDue").value || "";
  const nextAnnualDue = document.getElementById("ntNextAnnualDue").value || "";
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
  btn.textContent = "⏳ Creando bóveda aislada...";

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
      perDriverFeeMxn,
      annualFeeMxn,
      nextMonthlyDue,
      nextAnnualDue,
      countryCode,
      dialCode,
      currency,
      timezone,
      adminPassword,
      ownerPassword
    });

    const tSlug = res.tenantSlug;
    // Garantizar persistencia regional/cobranza incluso si Cloud Functions está en versión previa
    await callSaasApi("saasUpdateTenant", {
      saasKeyHash: currentSaasHash,
      tenantSlug: tSlug,
      updates: {
        contactPhone: phone.replace(/\D/g, ""),
        plan: {
          tier: "pro",
          maxDrivers,
          monthlyFeeMxn,
          perDriverFeeMxn,
          annualFeeMxn,
          nextMonthlyDue,
          nextAnnualDue,
          countryCode,
          dialCode,
          currency,
          timezone,
          contactPhone: phone.replace(/\D/g, ""),
          paymentHistory: []
        }
      }
    });

    const origin = window.location.origin;
    const kit =
      `🚀 *BIENVENIDO A RUTA PRO DISTRIBUTION*\n` +
      `Empresa: *${brandName}* (Código: *${tSlug}* • ${countryCode}/${currency})\n\n` +
      `🔗 *1. Portal de Pedidos:*\n${origin}/?t=${tSlug}\n\n` +
      `💼 *2. Panel Administración:*\n${origin}/admin.html?t=${tSlug}\n` +
      `   • Clave Admin Oficina: *${adminPassword}*\n` +
      `   • Clave Dirección / Finanzas: *${ownerPassword}*\n\n` +
      `❄️ *3. Escáner Almacén:*\n${origin}/almacen.html?t=${tSlug}\n` +
      `   • Usuario: *Almacenista 1* | PIN: *1234*\n\n` +
      `🚗 *4. App Choferes:*\n${origin}/chofer.html?t=${tSlug}\n` +
      `   • Usuario: *Vendedor 1* | PIN: *1234*`;

    document.getElementById("ntWelcomeKitText").textContent = kit;
    document.getElementById("ntWelcomeKitBox").style.display = "block";
    showToast(`🎉 Empresa "${brandName}" creada con éxito.`);
    await loadTenantsPortfolio();
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ Crear Empresa y Generar Accesos";
  }
});

document.getElementById("btnCopyWelcomeKit")?.addEventListener("click", async () => {
  const txt = document.getElementById("ntWelcomeKitText").textContent;
  await navigator.clipboard.writeText(txt);
  showToast("📋 Kit de bienvenida copiado.");
});

// ================= FX RATES MODAL =================
const fxModal = document.getElementById("fxRatesModal");
document.getElementById("btnOpenFxModal")?.addEventListener("click", () => {
  const grid = document.getElementById("fxRatesInputsGrid");
  grid.innerHTML = Object.keys(DEFAULT_FX_PER_USD)
    .filter((c) => c !== "USD")
    .map(
      (cur) => `
      <div>
        <label class="form-label" style="margin-bottom:3px;">1 USD en <strong>${cur}</strong></label>
        <input type="number" step="any" min="0.0001" class="form-control fx-rate-inp" data-cur="${cur}" value="${Number(fxPerUsd[cur] || DEFAULT_FX_PER_USD[cur])}">
      </div>
    `
    )
    .join("");
  fxModal.classList.add("open");
});

document.getElementById("btnCloseFxModal")?.addEventListener("click", () => fxModal.classList.remove("open"));
document.getElementById("btnSaveFxRates")?.addEventListener("click", () => {
  document.querySelectorAll(".fx-rate-inp").forEach((inp) => {
    const c = inp.dataset.cur;
    const v = Number(inp.value);
    if (c && Number.isFinite(v) && v > 0) fxPerUsd[c] = v;
  });
  fxPerUsd.USD = 1;
  localStorage.setItem(SAAS_FX_RATES_KEY, JSON.stringify(fxPerUsd));
  fxModal.classList.remove("open");
  renderAll();
  showToast("💱 Tipos de cambio actualizados.");
});

// ================= EXCEL (.XLSX) PORTFOLIO EXPORT =================
document.getElementById("btnExportTenantsXlsx")?.addEventListener("click", () => {
  const { filtered } = getFilteredAndSortedItems();
  if (!filtered.length) {
    showToast("No hay empresas para exportar con el filtro actual.");
    return;
  }
  const rows = filtered.map((it) => ({
    Codigo_Slug: it.slug,
    Empresa: it.brandName,
    Pais: it.reg.countryCode,
    Moneda: it.reg.currency,
    Zona_Horaria: it.reg.timezone,
    Giro: it.industry,
    Estatus: it.isSuspended ? "Suspendido" : "Activo",
    Choferes_Activos: it.drvCount,
    Choferes_Max: it.maxDrv,
    Renta_Base_Local: it.baseM,
    Tarifa_Por_Chofer_Local: it.perDrv,
    MRR_Mensual_Local: it.mrrLocal,
    Anualidad_Local: it.annualLocal,
    [`MRR_Consolidado_${reportCurrency}`]: Number(it.mrrReport.toFixed(2)),
    Proximo_Corte_Mensual: it.raw.plan?.nextMonthlyDue || "",
    Vence_Anualidad: it.raw.plan?.nextAnnualDue || "",
    Estado_Cobro: it.overallState,
    Puntualidad: it.punct.label,
    WhatsApp: it.reg.contactPhone ? `+${it.reg.dialCode}${it.reg.contactPhone}` : "",
    Notas_Facturacion: it.raw.billingNotes || ""
  }));

  if (typeof window.XLSX === "undefined") {
    showToast("Cargando librería Excel...");
    return;
  }
  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Cartera_SaaS");
  window.XLSX.writeFile(wb, `Cartera_RutaPro_${getTodayIsoLocal()}.xlsx`);
  showToast(`📊 Cartera exportada (${rows.length} empresas).`);
});

checkBootstrapStatus();
