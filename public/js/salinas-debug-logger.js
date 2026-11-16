/**
 * ============================================================================
 * SALINAS REPARTO — DEBUGGER SECRETO FORENSE (GPS, RED Y SEGUNDO PLANO)
 * Activación oculta: 5 toques rápidos en el logo/título "RUTA SALINAS"
 * (o añadiendo ?debug=1 en la URL).
 * ============================================================================
 */
(function () {
  if (window.__SalinasDebugLoggerLoaded) return;
  window.__SalinasDebugLoggerLoaded = true;

  const MAX_LOGS = 900;
  const MAX_PERSISTED = 600;
  const STORAGE_KEY = "salinas_debug_logs_v1";
  const MODE_KEY = "salinas_debug_mode_v1";
  const TTL_MS = 48 * 60 * 60 * 1000; // 48 horas
  const entries = [];
  let persistTimer = null;
  let activeTab = "gps";

  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console)
  };

  const GPS_REGEX = /(SalinasBgGPS|GPS|REST|CapacitorHttp|visibility|WakeLock|offline|online|pause|Error|error|location|heartbeat|Watchdog|nav3d)/i;

  function nowTimeStr() {
    const d = new Date();
    return d.toTimeString().split(" ")[0] + "." + String(d.getMilliseconds()).padStart(3, "0");
  }

  function safeStr(arg) {
    if (arg === null) return "null";
    if (arg === undefined) return "undefined";
    if (typeof arg === "string") return arg;
    if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try {
      return JSON.stringify(arg);
    } catch (_) {
      return String(arg);
    }
  }

  function flushToStorage() {
    try {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          driver: window.__SalinasActiveDriverName || "",
          entries: entries.slice(-MAX_PERSISTED)
        })
      );
    } catch (_) {}
  }

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      flushToStorage();
    }, 1000);
  }

  function restoreLogs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.entries)) return;
      if (parsed.savedAt && Date.now() - parsed.savedAt > TTL_MS) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      parsed.entries.forEach((it) => {
        if (it && typeof it.msg === "string") entries.push(it);
      });
      if (entries.length > 0) {
        entries.push({
          t: nowTimeStr(),
          lvl: "info",
          gps: true,
          msg: `[SESION-RESTAURADA] ${entries.length} eventos previos recuperados (${new Date().toLocaleTimeString("es-MX")})`
        });
      }
    } catch (_) {}
  }

  restoreLogs();

  function pushEntry(lvl, args) {
    try {
      const msg = Array.from(args).map(safeStr).join(" ");
      const isGps = GPS_REGEX.test(msg);
      entries.push({
        t: nowTimeStr(),
        lvl,
        gps: isGps,
        msg: msg.length > 750 ? msg.slice(0, 750) + "...[trunc]" : msg
      });
      if (entries.length > MAX_LOGS) entries.shift();
      schedulePersist();
      updateFabCount();
      if (document.getElementById("salinas-debug-modal")?.style.display === "flex") {
        renderLines();
      }
    } catch (_) {}
  }

  console.log = (...a) => { pushEntry("log", a); orig.log(...a); };
  console.warn = (...a) => { pushEntry("warn", a); orig.warn(...a); };
  console.error = (...a) => { pushEntry("error", a); orig.error(...a); };
  console.info = (...a) => { pushEntry("info", a); orig.info(...a); };

  window.salinasLog = function (tag, detail) {
    const txt = detail !== undefined ? `[${tag}] ${safeStr(detail)}` : `[${tag}]`;
    pushEntry("info", [txt]);
  };

  // Eventos forenses automáticos del teléfono (pantalla, red, errores)
  window.addEventListener("visibilitychange", () => {
    window.salinasLog("SYS-VISIBILITY", `state=${document.visibilityState} online=${navigator.onLine}`);
    if (document.visibilityState === "hidden") flushToStorage();
  });
  window.addEventListener("pagehide", () => {
    window.salinasLog("SYS-PAGEHIDE", "La app pasó a suspensión/cierre");
    flushToStorage();
  });
  window.addEventListener("online", () => window.salinasLog("SYS-NET", "Señal de internet RECUPERADA"));
  window.addEventListener("offline", () => window.salinasLog("SYS-NET", "SIN INTERNET (offline)"));
  window.addEventListener("error", (ev) => {
    window.salinasLog("SYS-ERROR", `${ev.message || "Error"} @ ${ev.filename || ""}:${ev.lineno || 0}`);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    window.salinasLog("SYS-PROMISE-ERR", safeStr(ev.reason));
  });

  function isDebugOn() {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("debug") === "1") {
        localStorage.setItem(MODE_KEY, "1");
        return true;
      }
      if (q.get("debug") === "0") {
        localStorage.removeItem(MODE_KEY);
        return false;
      }
      return localStorage.getItem(MODE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function setDebugMode(enable) {
    try {
      if (enable) {
        localStorage.setItem(MODE_KEY, "1");
        ensureFab();
        openModal();
      } else {
        localStorage.removeItem(MODE_KEY);
        document.getElementById("salinas-debug-fab")?.remove();
        const m = document.getElementById("salinas-debug-modal");
        if (m) m.style.display = "none";
      }
    } catch (_) {}
  }

  function updateFabCount() {
    const badge = document.getElementById("salinas-debug-count");
    if (badge) {
      badge.textContent = String(entries.filter((e) => e.gps).length);
    }
  }

  function ensureFab() {
    let fab = document.getElementById("salinas-debug-fab");
    if (!fab) {
      fab = document.createElement("button");
      fab.id = "salinas-debug-fab";
      fab.type = "button";
      fab.innerHTML = `<span>🐞</span><span style="font-weight:900;font-size:11px;">LOGS</span><span id="salinas-debug-count" style="background:#fff;color:#0f172a;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:900;">0</span>`;
      fab.style.cssText = "position:fixed!important;bottom:86px!important;right:12px!important;z-index:2147483644!important;background:linear-gradient(135deg,#0284c7,#0369a1)!important;color:#fff!important;border:2px solid #7dd3fc!important;border-radius:999px!important;padding:8px 13px!important;display:inline-flex!important;align-items:center!important;gap:5px!important;box-shadow:0 4px 18px rgba(0,0,0,0.45)!important;cursor:pointer!important;font-family:system-ui,sans-serif!important;";
      fab.onclick = () => openModal();
      document.body.appendChild(fab);
    }
    fab.style.display = "inline-flex";
    updateFabCount();
  }

  function buildExportText(onlyGps) {
    const list = (onlyGps ? entries.filter((e) => e.gps) : entries).slice(-180);
    const plat = window.Capacitor?.isNativePlatform?.()
      ? `Capacitor-${window.Capacitor.getPlatform?.() || "native"}`
      : "Web/PWA";
    const drv = window.__SalinasActiveDriverName || "Sin sesión";
    const header =
      `=== LOGS FORENSES SALINAS (${onlyGps ? "GPS/RED" : "TODOS"} - ${list.length} líneas) ===\n` +
      `Chofer: ${drv} | Plataforma: ${plat} | Online: ${navigator.onLine}\n` +
      `Fecha: ${new Date().toISOString()}\n` +
      `UA: ${navigator.userAgent}\n` +
      `----------------------------------------\n`;
    return header + list.map((e) => `${e.t} [${e.lvl.toUpperCase()}] ${e.msg}`).join("\n");
  }

  function renderLines() {
    const box = document.getElementById("salinas-debug-lines");
    const qEl = document.getElementById("salinas-debug-search");
    const cGps = document.getElementById("salinas-tab-gps-count");
    const cAll = document.getElementById("salinas-tab-all-count");
    if (!box) return;

    const gpsList = entries.filter((e) => e.gps);
    if (cGps) cGps.textContent = String(gpsList.length);
    if (cAll) cAll.textContent = String(entries.length);

    const filterTxt = (qEl?.value || "").trim().toLowerCase();
    let list = activeTab === "gps" ? gpsList : entries;
    if (filterTxt) {
      list = list.filter((e) => e.msg.toLowerCase().includes(filterTxt));
    }

    const recent = list.slice(-200);
    box.innerHTML = recent.length
      ? recent
          .map((e) => {
            const col = e.lvl === "error" ? "#f87171" : e.lvl === "warn" ? "#fbbf24" : e.gps ? "#7dd3fc" : "#cbd5e1";
            return `<div style="border-bottom:1px solid #1e293b;padding:4px 0;color:${col};word-break:break-word;"><span style="color:#64748b;">${e.t}</span> ${e.msg.replace(/</g, "&lt;")}</div>`;
          })
          .join("")
      : '<div style="color:#94a3b8;padding:20px;text-align:center;">Sin eventos registrados aún.</div>';
    box.scrollTop = box.scrollHeight;
  }

  function openModal() {
    let modal = document.getElementById("salinas-debug-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "salinas-debug-modal";
      modal.style.cssText = "position:fixed!important;inset:0!important;z-index:2147483646!important;background:rgba(9,13,22,0.97)!important;display:flex!important;flex-direction:column!important;font-family:system-ui,-apple-system,sans-serif!important;padding-top:env(safe-area-inset-top,0px)!important;padding-bottom:env(safe-area-inset-bottom,0px)!important;";
      modal.innerHTML = `
        <div style="background:#0f172a;border-bottom:1px solid #334155;padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="color:#fff;font-weight:800;font-size:0.95rem;">🐞 Diagnóstico GPS & Red — Salinas</div>
            <button id="salinas-debug-close" type="button" style="background:#1e293b;border:1px solid #475569;color:#fff;width:32px;height:32px;border-radius:8px;font-weight:900;cursor:pointer;">✕</button>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button id="salinas-btn-copy" type="button" style="flex:1.4;min-width:120px;background:#10b981;color:#022c22;border:none;border-radius:8px;padding:9px;font-weight:900;font-size:0.78rem;cursor:pointer;">📋 Copiar Logs GPS</button>
            <button id="salinas-btn-share" type="button" style="flex:1;min-width:95px;background:#0ea5e9;color:#fff;border:none;border-radius:8px;padding:9px;font-weight:900;font-size:0.78rem;cursor:pointer;">📲 WhatsApp</button>
            <button id="salinas-btn-clear" type="button" style="background:#1e293b;color:#f87171;border:1px solid #ef4444;border-radius:8px;padding:9px 10px;font-weight:800;font-size:0.74rem;cursor:pointer;">Limpiar</button>
            <button id="salinas-btn-hide" type="button" style="background:#1e293b;color:#94a3b8;border:1px solid #475569;border-radius:8px;padding:9px 10px;font-weight:800;font-size:0.74rem;cursor:pointer;">🔒 Ocultar</button>
          </div>
          <textarea id="salinas-debug-export" readonly style="width:100%;height:64px;background:#020617;border:1px solid #334155;border-radius:6px;color:#f8fafc;font-family:monospace;font-size:0.68rem;padding:6px;box-sizing:border-box;" placeholder="Toca Copiar Logs GPS para preparar el texto aquí..."></textarea>
          <div style="display:flex;gap:6px;">
            <button id="salinas-tab-gps" type="button" style="flex:1;padding:6px;border-radius:6px;border:none;background:#0284c7;color:#fff;font-weight:800;font-size:0.74rem;cursor:pointer;">📡 GPS/Red (<span id="salinas-tab-gps-count">0</span>)</button>
            <button id="salinas-tab-all" type="button" style="flex:1;padding:6px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#94a3b8;font-weight:800;font-size:0.74rem;cursor:pointer;">📋 Todos (<span id="salinas-tab-all-count">0</span>)</button>
          </div>
          <input id="salinas-debug-search" type="text" placeholder="Filtrar palabra..." style="background:#1e293b;border:1px solid #334155;border-radius:6px;padding:6px 10px;color:#fff;font-size:0.75rem;outline:none;">
        </div>
        <div id="salinas-debug-lines" style="flex:1;overflow-y:auto;padding:10px 12px;font-family:ui-monospace,monospace;font-size:0.71rem;line-height:1.4;background:#020617;"></div>
      `;
      document.body.appendChild(modal);

      document.getElementById("salinas-debug-close").onclick = () => { modal.style.display = "none"; };
      document.getElementById("salinas-btn-hide").onclick = () => setDebugMode(false);
      document.getElementById("salinas-btn-clear").onclick = () => {
        entries.length = 0;
        localStorage.removeItem(STORAGE_KEY);
        updateFabCount();
        renderLines();
      };
      document.getElementById("salinas-tab-gps").onclick = () => {
        activeTab = "gps";
        document.getElementById("salinas-tab-gps").style.background = "#0284c7";
        document.getElementById("salinas-tab-gps").style.color = "#fff";
        document.getElementById("salinas-tab-all").style.background = "#1e293b";
        document.getElementById("salinas-tab-all").style.color = "#94a3b8";
        renderLines();
      };
      document.getElementById("salinas-tab-all").onclick = () => {
        activeTab = "all";
        document.getElementById("salinas-tab-all").style.background = "#0284c7";
        document.getElementById("salinas-tab-all").style.color = "#fff";
        document.getElementById("salinas-tab-gps").style.background = "#1e293b";
        document.getElementById("salinas-tab-gps").style.color = "#94a3b8";
        renderLines();
      };
      document.getElementById("salinas-debug-search").oninput = renderLines;

      document.getElementById("salinas-btn-copy").onclick = async () => {
        const txt = buildExportText(activeTab === "gps");
        const exp = document.getElementById("salinas-debug-export");
        exp.value = txt;
        exp.focus();
        exp.select();
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(txt);
          else document.execCommand("copy");
          document.getElementById("salinas-btn-copy").textContent = "✅ ¡Copiado!";
          setTimeout(() => { document.getElementById("salinas-btn-copy").textContent = "📋 Copiar Logs GPS"; }, 2200);
        } catch (_) {}
      };

      document.getElementById("salinas-btn-share").onclick = async () => {
        const txt = buildExportText(activeTab === "gps");
        if (navigator.share) {
          try { await navigator.share({ title: "Logs Salinas GPS", text: txt }); return; } catch (_) {}
        }
        document.getElementById("salinas-btn-copy").click();
      };
    }

    modal.style.display = "flex";
    const exp = document.getElementById("salinas-debug-export");
    if (exp) exp.value = buildExportText(activeTab === "gps");
    renderLines();
  }

  function setupFiveTapTrigger() {
    let taps = 0;
    let lastAt = 0;
    let lastTouchAt = 0;

    function onTap(e) {
      const target = e.target?.closest?.(".driver-topbar-identity, .driver-topbar-logo, .driver-topbar-brand");
      if (!target) return;
      const now = Date.now();
      if (e.type === "click" && now - lastTouchAt < 500) return;
      if (e.type === "touchend") lastTouchAt = now;

      taps = now - lastAt < 800 ? taps + 1 : 1;
      lastAt = now;

      if (taps >= 5) {
        taps = 0;
        try { navigator.vibrate?.(50); } catch (_) {}
        setDebugMode(true);
      }
    }

    document.addEventListener("click", onTap, true);
    document.addEventListener("touchend", onTap, { capture: true, passive: true });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupFiveTapTrigger();
    if (isDebugOn()) ensureFab();
  });
})();
