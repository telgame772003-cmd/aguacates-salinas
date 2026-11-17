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

function renderKpisAndGrid() {
  const activeCount = allTenants.filter((t) => t.tenantStatus !== "suspended").length;
  const suspCount = allTenants.length - activeCount;
  let onlineTrucks = 0;
  let totalDrivers = 0;
  let totalPlaces = 0;
  let totalGmv = 0;
  let totalSales = 0;

  for (const t of allTenants) {
    const tel = t.telemetry || {};
    onlineTrucks += Number(tel.onlineTrucks) || 0;
    totalDrivers += Number(tel.driversConfigured) || 0;
    totalPlaces += Number(tel.placesCount) || 0;
    totalGmv += Number(tel.gmvToday) || 0;
    totalSales += Number(tel.salesTodayCount) || 0;
  }

  document.getElementById("kpiSaasTenants").textContent = String(allTenants.length);
  document.getElementById("kpiSaasTenantsSub").textContent = `${activeCount} activa${activeCount === 1 ? "" : "s"} • ${suspCount} en pausa`;
  document.getElementById("kpiSaasTrucks").textContent = String(onlineTrucks);
  document.getElementById("kpiSaasTrucksSub").textContent = `${totalDrivers} choferes dados de alta`;
  document.getElementById("kpiSaasPlaces").textContent = totalPlaces.toLocaleString("es-MX");
  document.getElementById("kpiSaasGmv").textContent = formatCurrency(totalGmv);
  document.getElementById("kpiSaasGmvSub").textContent = `${totalSales} nota${totalSales === 1 ? "" : "s"} hoy en toda la red`;

  const q = document.getElementById("saasSearchInput").value.trim();
  const filtered = allTenants.filter((t) =>
    matchesSmartSearch(`${t.brandName || ""} ${t.tenantSlug || ""} ${t.industry || ""} ${t.billingNotes || ""}`, q)
  );

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
      const maxDrv = t.plan?.maxDrivers || 25;
      const fee = t.plan?.monthlyFeeMxn ? `${formatCurrency(t.plan.monthlyFeeMxn)}/mes` : "Fundador / Interno";
      const qParam = t.tenantSlug === "salinas" ? "" : `?t=${encodeURIComponent(t.tenantSlug)}`;

      return `
        <article class="saas-tenant-card ${isSusp ? "is-suspended" : ""}">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">
              <div>
                <strong style="font-size:1.1rem;color:#fff;">${escapeHtml(t.pinEmoji || "🏢")} ${escapeHtml(t.brandName)}</strong>
                <div style="font-size:0.76rem;color:#94a3b8;margin-top:2px;">
                  Código: <code style="color:#38bdf8;">${escapeHtml(t.tenantSlug)}</code> • ${escapeHtml(fee)}
                </div>
              </div>
              <span class="saas-pill ${isSusp ? "suspended" : "active"}">${isSusp ? "⏸️ En Pausa" : "🟢 Activo"}</span>
            </div>

            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;background:#0f172a;padding:10px;border-radius:10px;text-align:center;margin:10px 0;">
              <div>
                <div style="font-size:0.68rem;color:#94a3b8;">CHOFERES</div>
                <strong style="font-size:0.92rem;color:#fff;">${tel.driversConfigured || 0}/${maxDrv}</strong>
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

            ${t.billingNotes ? `<div style="font-size:0.75rem;color:#cbd5e1;margin-bottom:8px;">📝 ${escapeHtml(t.billingNotes)}</div>` : ""}

            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
              <a href="${origin}/${qParam}" target="_blank" rel="noopener" class="saas-link-chip">🛒 Tienda</a>
              <a href="${origin}/admin.html${qParam}" target="_blank" rel="noopener" class="saas-link-chip">💼 Admin</a>
              <a href="${origin}/almacen.html${qParam}" target="_blank" rel="noopener" class="saas-link-chip">❄️ Almacén</a>
              <a href="${origin}/chofer.html${qParam}" target="_blank" rel="noopener" class="saas-link-chip">🚗 Chofer</a>
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;gap:8px;padding-top:10px;border-top:1px solid #334155;">
            <button type="button" class="btn btn-outline btn-sm" data-saas-edit="${escapeHtml(t.tenantSlug)}" style="color:#e2e8f0;border-color:#475569;flex:1;">
              ⚙️ Plan / Módulos
            </button>
            <button type="button" class="btn btn-outline btn-sm" data-saas-toggle="${escapeHtml(t.tenantSlug)}" style="color:${isSusp ? "#34d399" : "#fca5a5"};border-color:${isSusp ? "#059669" : "#7f1d1d"};">
              ${isSusp ? "▶️ Reactivar" : "⏸️ Suspender"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

document.getElementById("saasSearchInput").addEventListener("input", renderKpisAndGrid);
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

document.getElementById("btnOpenNewTenantModal").addEventListener("click", () => {
  document.getElementById("newTenantForm").reset();
  document.getElementById("ntWelcomeKitBox").style.display = "none";
  syncWizardTemplateDefaults();
  newTenantModal.classList.add("open");
});

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

  const editBtn = e.target.closest("button[data-saas-edit]");
  if (editBtn) {
    const slug = editBtn.dataset.saasEdit;
    const t = allTenants.find((x) => x.tenantSlug === slug);
    if (!t) return;
    document.getElementById("etModalTitle").textContent = `⚙️ Configurar: ${t.brandName}`;
    document.getElementById("etSlug").value = slug;
    document.getElementById("etMaxDrivers").value = String(t.plan?.maxDrivers || 25);
    document.getElementById("etMonthlyFee").value = String(t.plan?.monthlyFeeMxn || 0);
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
      monthlyFeeMxn: Math.max(0, Number(document.getElementById("etMonthlyFee").value) || 0)
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

checkBootstrapStatus();
