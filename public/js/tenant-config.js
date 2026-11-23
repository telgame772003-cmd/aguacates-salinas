/**
 * ============================================================================
 * RUTA PRO DISTRIBUTION — MULTI-TENANT WHITE-LABEL & INDUSTRY ENGINE
 * Powered by Ruta Pro Technologies
 * ============================================================================
 */

export const SAAS_PLATFORM_BRAND = {
  name: "Ruta Pro Distribution",
  company: "Ruta Pro Technologies",
  supportWhatsApp: "528446775276"
};

export const TENANT_STORAGE_KEY = "rpd_active_tenant_slug_v1";
export const TENANT_SESSION_TAB_KEY = "rpd_tab_tenant_slug_v1";
export const TENANT_VAULT_CACHE_PREFIX = "rpd_vault_id_v1_";

export const INDUSTRY_TEMPLATES = {
  avocado: {
    id: "avocado",
    label: "🥑 Aguacate / Empaque y Fruta",
    pinEmoji: "🥑",
    folioPrefix: "AGU",
    theme: {
      primary: "#15803d",
      dark: "#132615",
      accent: "#eab308"
    },
    unitConfig: {
      unitSingular: "caja",
      unitPlural: "cajas",
      subUnit: "kg",
      subUnitsPerUnit: 10,
      allowSubUnit: true
    },
    terminology: {
      batchSingular: "Termo",
      batchPlural: "Termos",
      storageArea: "Cuartos Fríos",
      productGroupLabel: "Calibres"
    },
    modules: {
      coldRooms: true,
      ripeness: true,
      onlineStore: true,
      fractionalSales: true,
      nav3d: true
    },
    defaultProducts: {
      S: { code: "S", name: "Super", subtitle: "Calibre Grande Selecto", description: "Piezas grandes de excelente presentación y pulpa cremosa.", badge: "Calidad Premium", price: 400, pricePerKg: 40, minPrice: 340, available: true, order: 1 },
      E: { code: "E", name: "Extra", subtitle: "Calibre Mediano-Grande", description: "Tamaño uniforme de gran rendimiento en mesa y mostrador.", badge: "Alto Rendimiento", price: 360, pricePerKg: 36, minPrice: 310, available: true, order: 2 },
      P: { code: "P", name: "Primera", subtitle: "Calibre Comercial Estándar", description: "El favorito de abarrotes, cocinas y restaurantes por su rotación diaria.", badge: "Más Pedido", price: 320, pricePerKg: 32, minPrice: 280, available: true, order: 3 },
      M: { code: "M", name: "Media / Segunda", subtitle: "Calibre Práctico y Económico", description: "Misma frescura y sabor con el mejor precio por caja.", badge: "Especial Negocios", price: 250, pricePerKg: 25, minPrice: 210, available: true, order: 4 }
    }
  },

  citrus: {
    id: "citrus",
    label: "🍋 Limón y Cítricos",
    pinEmoji: "🍋",
    folioPrefix: "LIM",
    theme: {
      primary: "#65a30d",
      dark: "#1a2e05",
      accent: "#facc15"
    },
    unitConfig: {
      unitSingular: "arpilla",
      unitPlural: "arpillas",
      subUnit: "kg",
      subUnitsPerUnit: 20,
      allowSubUnit: true
    },
    terminology: {
      batchSingular: "Embarque",
      batchPlural: "Embarques",
      storageArea: "Cámaras / Bodega",
      productGroupLabel: "Tamaños y Calidades"
    },
    modules: {
      coldRooms: true,
      ripeness: true,
      onlineStore: true,
      fractionalSales: true,
      nav3d: true
    },
    defaultProducts: {
      L1: { code: "L1", name: "Persa #1 Selecto", subtitle: "Verde oscuro exportación", description: "Limón sin semilla de primera selección y alto contenido de jugo.", badge: "Premium", price: 480, pricePerKg: 26, minPrice: 420, available: true, order: 1 },
      L2: { code: "L2", name: "Persa Comercial", subtitle: "Tamaño mediano uniforme", description: "Ideal para restaurantes, taquerías y fruterías.", badge: "Alta Rotación", price: 410, pricePerKg: 22, minPrice: 360, available: true, order: 2 },
      COL: { code: "COL", name: "Colima con Semilla", subtitle: "Aroma y acidez intensa", description: "Preferido por marisquerías, taquerías y abarrotes.", badge: "Tradicional", price: 520, pricePerKg: 28, minPrice: 460, available: true, order: 3 },
      JUG: { code: "JUG", name: "Limón Jugo / Económico", subtitle: "Especial para cocina", description: "Máximo rendimiento en jugo al mejor costo.", badge: "Económico", price: 290, pricePerKg: 16, minPrice: 250, available: true, order: 4 }
    }
  },

  tomato: {
    id: "tomato",
    label: "🍅 Tomate y Hortalizas",
    pinEmoji: "🍅",
    folioPrefix: "TOM",
    theme: {
      primary: "#dc2626",
      dark: "#450a0a",
      accent: "#f59e0b"
    },
    unitConfig: {
      unitSingular: "reja",
      unitPlural: "rejas",
      subUnit: "kg",
      subUnitsPerUnit: 15,
      allowSubUnit: true
    },
    terminology: {
      batchSingular: "Viaje",
      batchPlural: "Viajes",
      storageArea: "Bodega Fresca",
      productGroupLabel: "Variedades"
    },
    modules: {
      coldRooms: true,
      ripeness: true,
      onlineStore: true,
      fractionalSales: true,
      nav3d: true
    },
    defaultProducts: {
      SXL: { code: "SXL", name: "Saladette XL Primera", subtitle: "Firme de invernadero", description: "Tomate grande de larga vida en anaquel para exhibición.", badge: "Invernadero", price: 340, pricePerKg: 25, minPrice: 290, available: true, order: 1 },
      SM: { code: "SM", name: "Saladette Mediano", subtitle: "Comercial diario", description: "Tamaño versátil para tiendas de abarrotes y cocinas.", badge: "Más Vendido", price: 280, pricePerKg: 20, minPrice: 240, available: true, order: 2 },
      BOL: { code: "BOL", name: "Tomate Bola", subtitle: "Especial rebanada", description: "Ideal para restaurantes, hamburgueserías y comedores.", badge: "Selecto", price: 390, pricePerKg: 28, minPrice: 340, available: true, order: 3 }
    }
  },

  groceries: {
    id: "groceries",
    label: "📦 Abarrotes y Distribución Mayorista",
    pinEmoji: "📦",
    folioPrefix: "DIS",
    theme: {
      primary: "#0284c7",
      dark: "#0f172a",
      accent: "#f59e0b"
    },
    unitConfig: {
      unitSingular: "caja",
      unitPlural: "cajas",
      subUnit: "pza",
      subUnitsPerUnit: 12,
      allowSubUnit: true
    },
    terminology: {
      batchSingular: "Entrada",
      batchPlural: "Entradas",
      storageArea: "Almacén General",
      productGroupLabel: "Productos / SKUs"
    },
    modules: {
      coldRooms: false,
      ripeness: false,
      onlineStore: true,
      fractionalSales: true,
      nav3d: true
    },
    defaultProducts: {
      AC12: { code: "AC12", name: "Aceite Comestible 12×1L", subtitle: "Caja con 12 botellas", description: "Aceite vegetal de alta rotación para abarrotes y cocinas.", badge: "Básico", price: 420, pricePerKg: 37, minPrice: 395, available: true, order: 1 },
      AZ50: { code: "AZ50", name: "Azúcar Estándar Bulto", subtitle: "Presentación mayoreo", description: "Azúcar estándar limpia para reempaque o panadería.", badge: "Mayoreo", price: 1150, pricePerKg: 98, minPrice: 1080, available: true, order: 2 },
      HU360: { code: "HU360", name: "Huevo Blanco Caja", subtitle: "Caja 12 conos", description: "Huevo fresco de granja seleccionado.", badge: "Fresco", price: 890, pricePerKg: 78, minPrice: 840, available: true, order: 3 },
      RF24: { code: "RF24", name: "Refresco Surtido Paq", subtitle: "Charola 24 unidades", description: "Bebidas de alta demanda para tiendas de esquina.", badge: "Promoción", price: 310, pricePerKg: 28, minPrice: 285, available: true, order: 4 }
    }
  },

  pharmacy: {
    id: "pharmacy",
    label: "💊 Farmacia e Insumos Médicos",
    pinEmoji: "💊",
    folioPrefix: "MED",
    theme: {
      primary: "#0d9488",
      dark: "#042f2e",
      accent: "#38bdf8"
    },
    unitConfig: {
      unitSingular: "caja",
      unitPlural: "cajas",
      subUnit: "pza",
      subUnitsPerUnit: 10,
      allowSubUnit: true
    },
    terminology: {
      batchSingular: "Lote",
      batchPlural: "Lotes",
      storageArea: "Almacén Sanitario",
      productGroupLabel: "Medicamentos / Insumos"
    },
    modules: {
      coldRooms: true,
      ripeness: false,
      onlineStore: true,
      fractionalSales: true,
      nav3d: true
    },
    defaultProducts: {
      PAR500: { code: "PAR500", name: "Analgésico 500mg (Paq 10)", subtitle: "Caja colectiva 10 blísteres", description: "Alta rotación para farmacias independientes y consultorios.", badge: "Esencial", price: 380, pricePerKg: 40, minPrice: 340, available: true, order: 1 },
      SUERO: { code: "SUERO", name: "Electrolitos Orales 12×625ml", subtitle: "Charola surtida", description: "Hidratación grado médico en envase sellado.", badge: "Alta Demanda", price: 295, pricePerKg: 26, minPrice: 265, available: true, order: 2 },
      CURA: { code: "CURA", name: "Kit Material de Curación", subtitle: "Gasas, vendas y antiséptico", description: "Paquete mayorista para clínicas y botiquines.", badge: "Clínico", price: 540, pricePerKg: 56, minPrice: 490, available: true, order: 3 }
    }
  },

  hardware: {
    id: "hardware",
    label: "🛠️ Ferretería y Refacciones",
    pinEmoji: "🛠️",
    folioPrefix: "FER",
    theme: {
      primary: "#ea580c",
      dark: "#1c1917",
      accent: "#facc15"
    },
    unitConfig: {
      unitSingular: "caja",
      unitPlural: "cajas",
      subUnit: "pza",
      subUnitsPerUnit: 20,
      allowSubUnit: true
    },
    terminology: {
      batchSingular: "Embarque",
      batchPlural: "Embarques",
      storageArea: "Bodega Central",
      productGroupLabel: "Artículos / SKUs"
    },
    modules: {
      coldRooms: false,
      ripeness: false,
      onlineStore: true,
      fractionalSales: true,
      nav3d: true
    },
    defaultProducts: {
      DISC: { code: "DISC", name: "Disco Corte 4.5\" (Paq 25)", subtitle: "Acero inoxidable profesional", description: "Caja cerrada de 25 discos abrasivos.", badge: "Industrial", price: 620, pricePerKg: 27, minPrice: 560, available: true, order: 1 },
      CINT: { code: "CINT", name: "Cinta Aislar Negra (Paq 20)", subtitle: "Uso eléctrico pesado", description: "Paquete mayorista para ferreterías.", badge: "Rotación", price: 340, pricePerKg: 18, minPrice: 300, available: true, order: 2 },
      SELL: { code: "SELL", name: "Sellador Silicón (Caja 12)", subtitle: "Transparente multiusos", description: "Cartuchos de 280ml listos para exhibidor.", badge: "Construcción", price: 780, pricePerKg: 68, minPrice: 710, available: true, order: 3 }
    }
  }
};

export function sanitizeTenantSlug(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Determina el `tenantId` activo en orden de prioridad:
 * 1) Parámetro URL `?t=slug` o `?tenant=slug`
 * 2) Sesión de pestaña actual (`sessionStorage`)
 * 3) Override explícito elegido por el usuario en el dispositivo (`rpd_active_tenant_slug_v1`)
 * 4) Subdominio (`cliente.rutapro.mx`) o dominio dedicado (`aguacates-salinas.web.app` -> `salinas`)
 */
export function resolveInitialTenantSlug() {
  try {
    const params = new URLSearchParams(window.location.search);
    const qSlug = sanitizeTenantSlug(params.get("t") || params.get("tenant") || "");
    if (qSlug) {
      sessionStorage.setItem(TENANT_SESSION_TAB_KEY, qSlug);
      localStorage.setItem(TENANT_STORAGE_KEY, qSlug);
      return qSlug;
    }

    const tabSlug = sanitizeTenantSlug(sessionStorage.getItem(TENANT_SESSION_TAB_KEY) || "");
    if (tabSlug) return tabSlug;

    const savedSlug = sanitizeTenantSlug(localStorage.getItem(TENANT_STORAGE_KEY) || "");
    if (savedSlug) return savedSlug;

    const host = String(window.location.hostname || "").toLowerCase();
    if (host.includes("aguacates-salinas")) {
      return "salinas";
    }

    // Subdominio tipo <tenant>.rutapro.mx / <tenant>.rutaprodistribution.com
    const parts = host.split(".");
    if (parts.length >= 3) {
      const sub = sanitizeTenantSlug(parts[0]);
      const reserved = new Set(["www", "app", "saas", "admin", "panel", "distro", "api"]);
      if (sub && !reserved.has(sub)) {
        return sub;
      }
    }

    return "salinas";
  } catch (_) {
    return "salinas";
  }
}

export function switchActiveTenantSlug(newSlug, reloadPage = true) {
  const clean = sanitizeTenantSlug(newSlug) || "salinas";
  try {
    sessionStorage.setItem(TENANT_SESSION_TAB_KEY, clean);
    localStorage.setItem(TENANT_STORAGE_KEY, clean);
  } catch (_) {}
  if (reloadPage && typeof window !== "undefined") {
    const url = new URL(window.location.href);
    url.searchParams.set("t", clean);
    window.location.href = url.toString();
  }
  return clean;
}

export function getUnitConfig(settings = {}) {
  const u = settings?.unitConfig || {};
  return {
    unitSingular: String(u.unitSingular || "caja").trim(),
    unitPlural: String(u.unitPlural || "cajas").trim(),
    subUnit: String(u.subUnit || "kg").trim(),
    subUnitsPerUnit: Math.max(1, Number(u.subUnitsPerUnit) || 10),
    allowSubUnit: u.allowSubUnit !== false
  };
}

export function getTenantModules(settings = {}) {
  const m = settings?.modules || {};
  return {
    coldRooms: m.coldRooms !== false,
    ripeness: m.ripeness !== false,
    onlineStore: m.onlineStore !== false,
    fractionalSales: m.fractionalSales !== false,
    nav3d: m.nav3d !== false
  };
}

export function getTenantTerminology(settings = {}) {
  const t = settings?.terminology || {};
  return {
    batchSingular: String(t.batchSingular || "Termo").trim(),
    batchPlural: String(t.batchPlural || "Termos").trim(),
    storageArea: String(t.storageArea || "Cuartos Fríos").trim(),
    productGroupLabel: String(t.productGroupLabel || "Calibres").trim()
  };
}

export function getTenantBranding(settings = {}, tenantSlug = "salinas") {
  const b = settings?.branding || {};
  const isSalinas = tenantSlug === "salinas" && !b.brandName;
  return {
    brandName: b.brandName || (isSalinas ? "Comercializadora Salinas" : tenantSlug.toUpperCase()),
    shortName: b.shortName || (isSalinas ? "Salinas" : (b.brandName || tenantSlug)),
    tagline: b.tagline || (isSalinas ? "Especialistas en Aguacate" : "Distribución y Reparto en Ruta"),
    heroHeadline: b.heroHeadline || (isSalinas ? "Aguacate selecto por caja, <span>directo a tu negocio.</span>" : `${b.brandName || "Catálogo Mayorista"}, <span>directo a tu negocio.</span>`),
    heroDescription: b.heroDescription || (isSalinas
      ? "Abastecemos abarrotes, carnicerías, fruterías, taquerías y restaurantes con selección diaria. Levanta tu pedido en menos de un minuto."
      : "Levanta tu pedido en línea con precios actualizados en tiempo real y entrega directa en tu establecimiento."),
    logoUrl: b.logoUrl || (isSalinas ? "assets/logo-salinas.png" : ""),
    heroImageUrl: b.heroImageUrl || (isSalinas ? "assets/avocados-icon.png" : ""),
    faviconUrl: b.faviconUrl || "assets/favicon.png",
    pinEmoji: b.pinEmoji || (isSalinas ? "🥑" : "📦"),
    folioPrefix: String(b.folioPrefix || (isSalinas ? "SAL" : tenantSlug.slice(0, 3).toUpperCase())).toUpperCase(),
    loyaltyQuote: b.loyaltyQuote ?? "“La lealtad es escasa en estos tiempos y nosotros la valoramos. Gracias por tu lealtad.”",
    primaryColor: b.primaryColor || "#15803d",
    darkColor: b.darkColor || "#132615",
    accentColor: b.accentColor || "#eab308"
  };
}

export function getOrderedProducts(settings = {}, fallbackCalibers = {}) {
  const mapObj = settings?.calibers && Object.keys(settings.calibers).length > 0
    ? settings.calibers
    : fallbackCalibers;
  return Object.values(mapObj)
    .filter((p) => p && p.code && p.archived !== true)
    .sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99));
}

export function getProductCodes(settings = {}, fallbackCalibers = {}) {
  return getOrderedProducts(settings, fallbackCalibers).map((p) => p.code);
}

export function formatDynamicUnits(unitsVal, settings = {}) {
  const cfg = getUnitConfig(settings);
  const factor = cfg.subUnitsPerUnit;
  const rounded = Math.round((Number(unitsVal) || 0) * factor) / factor;
  const sign = rounded < 0 ? "-" : "";
  const totalSubs = Math.round(Math.abs(rounded) * factor);
  const fullUnits = Math.floor(totalSubs / factor);
  const extraSubs = totalSubs % factor;
  const uShort = cfg.unitSingular.length <= 4 ? cfg.unitSingular : cfg.unitSingular.slice(0, 3) + ".";
  if (fullUnits === 0 && extraSubs === 0) return `0 ${uShort}`;
  if (!cfg.allowSubUnit || extraSubs === 0) {
    return `${sign}${fullUnits} ${fullUnits === 1 ? cfg.unitSingular : cfg.unitPlural}`;
  }
  if (fullUnits === 0) {
    return `${sign}${extraSubs} ${cfg.subUnit}`;
  }
  return `${sign}${fullUnits} ${uShort} + ${extraSubs} ${cfg.subUnit}`;
}

function hexToSoftBg(hex, alpha = 0.08) {
  const clean = String(hex || "").replace("#", "");
  if (clean.length !== 6) return "rgba(21, 128, 61, 0.08)";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Aplica colores, logos, textos de marca blanca, ocultación de módulos deshabilitados
 * y pantalla de suspensión SaaS (kill-switch) en tiempo real.
 */
export function applyTenantWhiteLabelToDOM(settings = {}, tenantSlug = "salinas") {
  if (typeof document === "undefined") return;
  const brand = getTenantBranding(settings, tenantSlug);
  const mods = getTenantModules(settings);
  const terms = getTenantTerminology(settings);
  const units = getUnitConfig(settings);

  // 1. Kill-Switch SaaS si el tenant está suspendido
  let suspOverlay = document.getElementById("rpdSuspendedOverlay");
  if (settings?.tenantStatus === "suspended") {
    if (!suspOverlay) {
      suspOverlay = document.createElement("div");
      suspOverlay.id = "rpdSuspendedOverlay";
      suspOverlay.style.cssText =
        "position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,0.96);color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:system-ui,sans-serif;";
      suspOverlay.innerHTML = `
        <div style="max-width:420px;background:#1e293b;border:1px solid #334155;border-radius:18px;padding:28px 22px;box-shadow:0 20px 50px rgba(0,0,0,0.5);">
          <div style="font-size:2.4rem;margin-bottom:10px;">⏸️</div>
          <div style="font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;font-weight:800;margin-bottom:6px;">${SAAS_PLATFORM_BRAND.name}</div>
          <h2 style="font-size:1.3rem;margin:0 0 8px;color:#f8fafc;">Servicio Temporalmente en Pausa</h2>
          <p style="font-size:0.88rem;color:#cbd5e1;line-height:1.5;margin:0 0 18px;">
            La suscripción de <strong>${brand.brandName}</strong> requiere actualización administrativa. Contacta al equipo de <strong>${SAAS_PLATFORM_BRAND.company}</strong> para reactivar el acceso inmediato.
          </p>
          <a href="https://wa.me/${SAAS_PLATFORM_BRAND.supportWhatsApp}?text=${encodeURIComponent(`Hola Ruta Pro Technologies, solicito apoyo para reactivar el tenant: ${tenantSlug}`)}" target="_blank" rel="noopener" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;font-weight:800;padding:11px 18px;border-radius:10px;font-size:0.86rem;">
            📲 Contactar Soporte SaaS
          </a>
        </div>
      `;
      document.body.appendChild(suspOverlay);
    }
    return;
  } else if (suspOverlay) {
    suspOverlay.remove();
  }

  // 2. Variables CSS de tema por Tenant
  const root = document.documentElement;
  if (brand.primaryColor) {
    root.style.setProperty("--green-700", brand.primaryColor);
    root.style.setProperty("--green-800", brand.primaryColor);
    root.style.setProperty("--green-100", hexToSoftBg(brand.primaryColor, 0.14));
    root.style.setProperty("--green-50", hexToSoftBg(brand.primaryColor, 0.06));
  }
  if (brand.darkColor) {
    root.style.setProperty("--green-950", brand.darkColor);
    root.style.setProperty("--green-900", brand.darkColor);
  }

  // 3. Logos y Títulos dinámicos
  document.querySelectorAll(".navbar .brand-link img, .login-card > img").forEach((img) => {
    if (brand.logoUrl) {
      img.src = brand.logoUrl;
      img.alt = brand.brandName;
      img.style.display = "";
    } else if (tenantSlug !== "salinas") {
      // Si el nuevo tenant aún no sube imagen de logo, mostrar monograma limpio en vez del logo de Salinas
      img.style.display = "none";
      let fallbackTitle = img.parentElement?.querySelector(".rpd-text-logo");
      if (!fallbackTitle && img.parentElement) {
        fallbackTitle = document.createElement("strong");
        fallbackTitle.className = "rpd-text-logo serif-title";
        fallbackTitle.style.cssText = "font-size:1.2rem;color:var(--green-950);display:inline-flex;align-items:center;gap:6px;";
        img.parentElement.insertBefore(fallbackTitle, img);
      }
      if (fallbackTitle) {
        fallbackTitle.textContent = `${brand.pinEmoji} ${brand.brandName}`;
      }
    }
  });

  const driverBrandEl = document.querySelector(".driver-topbar-brand");
  if (driverBrandEl) driverBrandEl.textContent = `Ruta ${brand.shortName}`;

  // Storefront público (index.html)
  const eyebrowEl = document.querySelector(".hero .eyebrow");
  if (eyebrowEl) eyebrowEl.textContent = brand.tagline;
  const heroH1 = document.querySelector(".hero h1");
  if (heroH1 && tenantSlug !== "salinas") heroH1.innerHTML = brand.heroHeadline;
  const heroP = document.querySelector(".hero .hero-grid > div > p");
  if (heroP && tenantSlug !== "salinas") heroP.textContent = brand.heroDescription;
  const heroImg = document.querySelector(".hero-card img");
  if (heroImg) {
    if (brand.heroImageUrl) {
      heroImg.src = brand.heroImageUrl;
      heroImg.style.display = "";
    } else if (tenantSlug !== "salinas") {
      heroImg.style.display = "none";
    }
  }
  const catHeaderH2 = document.querySelector("#catalogo .section-header h2");
  if (catHeaderH2 && tenantSlug !== "salinas") {
    catHeaderH2.textContent = `Selecciona tus ${units.unitPlural} (${terms.productGroupLabel})`;
  }
  const loyaltyEl = document.querySelector(".site-footer .loyalty-quote");
  if (loyaltyEl) loyaltyEl.textContent = brand.loyaltyQuote || "";
  const copyEl = document.querySelector(".site-footer .footer-inner > div > div:last-child");
  if (copyEl) copyEl.textContent = `© ${brand.brandName} — ${brand.tagline} • Powered by ${SAAS_PLATFORM_BRAND.name}`;

  // 4. Feature Flags de Módulos por Giro
  const tabLotsBtn = document.querySelector('.tab-btn[data-tab="tabLots"]');
  if (tabLotsBtn) {
    tabLotsBtn.style.display = mods.coldRooms ? "" : "none";
    if (mods.coldRooms) {
      tabLotsBtn.textContent = `❄️ ${terms.batchPlural} y Lotes QR`;
    }
  }
  const tabOrdersBtn = document.querySelector('.tab-btn[data-tab="tabOrders"]');
  if (tabOrdersBtn) {
    tabOrdersBtn.style.display = mods.onlineStore ? "" : "none";
  }
  const ripenessGroup = document.getElementById("ripenessPref")?.closest(".form-group");
  if (ripenessGroup) {
    ripenessGroup.style.display = mods.ripeness ? "" : "none";
  }
  const btnTopNav3D = document.getElementById("btnTopOpenNav3D");
  if (btnTopNav3D) {
    btnTopNav3D.style.display = mods.nav3d ? "" : "none";
  }

  // Actualizar pastilla selectora de empresa si existe en pantallas de login
  document.querySelectorAll("[data-rpd-tenant-label]").forEach((el) => {
    el.textContent = `${brand.pinEmoji} ${brand.shortName} (${tenantSlug})`;
  });
}

/**
 * Inserta una pastilla limpia "🏢 Empresa: SALINAS [Cambiar]" en las tarjetas de Login
 * para facilitar pruebas multi-tenant o cambio de empresa en la App Universal.
 */
export function mountTenantSwitcherPill(tenantSlug) {
  if (typeof document === "undefined") return;
  const loginCards = document.querySelectorAll(".login-card");
  loginCards.forEach((card) => {
    if (card.querySelector(".rpd-tenant-pill-bar")) return;
    const bar = document.createElement("div");
    bar.className = "rpd-tenant-pill-bar";
    bar.style.cssText =
      "display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:12px;padding:6px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:999px;font-size:0.76rem;color:#334155;";
    bar.innerHTML = `
      <span>🏢 Empresa: <strong data-rpd-tenant-label style="color:#0f172a;">${tenantSlug.toUpperCase()}</strong></span>
      <button type="button" class="rpd-btn-switch-tenant" style="border:none;background:#e2e8f0;color:#0f172a;font-weight:800;font-size:0.7rem;padding:3px 8px;border-radius:999px;cursor:pointer;">Cambiar</button>
    `;
    bar.querySelector(".rpd-btn-switch-tenant")?.addEventListener("click", () => {
      openTenantSwitchPrompt(tenantSlug);
    });
    card.insertBefore(bar, card.firstChild);
  });
}

export function openTenantSwitchPrompt(currentSlug = "salinas") {
  let modal = document.getElementById("rpdTenantSwitchModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "rpdTenantSwitchModal";
    modal.className = "modal-backdrop open";
    modal.style.zIndex = "99990";
    modal.innerHTML = `
      <div class="modal-card" style="max-width:380px;text-align:left;padding:22px 20px;">
        <h3 class="serif-title" style="font-size:1.18rem;color:#0f172a;margin:0 0 6px;">🏢 Cambiar Código de Empresa</h3>
        <p style="font-size:0.8rem;color:#475569;margin:0 0 12px;">Ingresa el código asignado por <strong>${SAAS_PLATFORM_BRAND.name}</strong> (ej. <code>salinas</code>).</p>
        <input type="text" id="rpdTenantSlugInput" class="form-control" value="${currentSlug}" placeholder="ej. salinas" style="font-weight:800;text-transform:lowercase;margin-bottom:14px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button type="button" id="rpdTenantCancelBtn" class="btn btn-outline" style="padding:10px;font-weight:700;">Cancelar</button>
          <button type="button" id="rpdTenantApplyBtn" class="btn btn-primary" style="padding:10px;font-weight:800;">Conectar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector("#rpdTenantCancelBtn").addEventListener("click", () => modal.remove());
    modal.querySelector("#rpdTenantApplyBtn").addEventListener("click", () => {
      const val = sanitizeTenantSlug(modal.querySelector("#rpdTenantSlugInput").value);
      if (!val) return;
      switchActiveTenantSlug(val, true);
    });
  }
}
