
(function () {
  "use strict";

  // ---------- state ----------
  var products = {}; // barcode -> {barcode,name,sector,gondolaQty,depositoQty,expiry,updatedAt}
  var activeSector = "todos";
  var SECTOR_LABEL = { comida: "Comida", bebida: "Bebida", limpieza: "Limpieza" };
  var db = null;
  var html5Qr = null;
  var scanning = false;
  var pendingBarcode = null;
  var pendingMode = "new";
  var lastScanTime = 0;
  var expiryFilter = "todos";
  var alertDays = 30;
  var logoDataUrl = null;
  var splashShownAt = Date.now();

  var LOCAL_KEY = "control-gondola:data";
  var LOGO_KEY = "control-gondola:logo";
  var DAYS_KEY = "control-gondola:alertdays";

  // ---------- helpers ----------
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._h);
    toast._h = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }
  function vibrate() { try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) {} }
  function sanitizeId(code) { return String(code).trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120); }
  function money(n) {
    n = Number(n) || 0;
    return "$" + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function saveLocal() { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(products)); } catch (e) {} }
  function loadLocal() {
    try { var raw = localStorage.getItem(LOCAL_KEY); if (raw) products = JSON.parse(raw) || {}; } catch (e) { products = {}; }
  }

  // ---------- vencimientos ----------
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var p = dateStr.split("-");
    var target = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    return Math.round((target - today) / 86400000);
  }
  function expiryState(dateStr) {
    var d = daysUntil(dateStr);
    if (d === null) return "none";
    if (d < 0) return "vencido";
    if (d <= alertDays) return "proximo";
    return "ok";
  }
  function formatDate(dateStr) { var p = dateStr.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
  function expiryBadgeHtml(p) {
    if (!p.expiry) return "";
    var state = expiryState(p.expiry), d = daysUntil(p.expiry);
    var cls = state === "vencido" ? "vencido" : (state === "proximo" ? "proximo" : "ok");
    var txt = state === "vencido" ? "Vencido hace " + Math.abs(d) + "d" :
      (state === "proximo" ? "Vence en " + d + "d" : "Vence " + formatDate(p.expiry));
    return '<span class="expiry-badge ' + cls + '">' + txt + '</span>';
  }
  function expiryLongText(p) {
    if (!p.expiry) return "Sin fecha registrada";
    var state = expiryState(p.expiry), d = daysUntil(p.expiry);
    if (state === "vencido") return formatDate(p.expiry) + " — vencido hace " + Math.abs(d) + " días";
    if (state === "proximo") return formatDate(p.expiry) + " — vence en " + d + " días";
    return formatDate(p.expiry);
  }

  function loadAlertDays() {
    try { var v = parseInt(localStorage.getItem(DAYS_KEY), 10); if (v && v > 0) alertDays = v; } catch (e) {}
    document.getElementById("alert-days").value = alertDays;
  }
  document.getElementById("alert-days").addEventListener("change", function () {
    var v = parseInt(this.value, 10); if (!v || v < 1) v = 30;
    alertDays = v;
    try { localStorage.setItem(DAYS_KEY, String(v)); } catch (e) {}
    render();
  });
  document.querySelectorAll(".expiry-chip").forEach(function (btn) {
    btn.addEventListener("click", function () { expiryFilter = btn.getAttribute("data-filter"); render(); });
  });
  document.getElementById("expiry-alert").addEventListener("click", function () {
    expiryFilter = "vencidos"; render();
    document.getElementById("product-list").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ---------- render ----------
  var SECTOR_IDS = ["todos", "comida", "bebida", "limpieza"];
  var SECTOR_MENU_LABEL = { todos: "Todos", comida: "Comida", bebida: "Bebida", limpieza: "Limpieza" };

  function renderSectorTabs() {
    // acordeón (celular)
    var body = document.getElementById("accordion-body");
    body.innerHTML = "";
    // chips (PC)
    var tabsWrap = document.getElementById("sector-tabs");
    tabsWrap.innerHTML = "";

    SECTOR_IDS.forEach(function (id) {
      var items = Object.keys(products).map(function (k) { return products[k]; })
        .filter(function (p) { return id === "todos" || p.sector === id; });
      var units = 0; items.forEach(function (p) { units += (p.gondolaQty || 0); });

      var row = document.createElement("div");
      row.className = "accordion-row " + id + (activeSector === id ? " active" : "");
      row.innerHTML = '<div class="name"><span class="dot"></span><span class="t"></span></div><div class="cnt"></div>';
      row.querySelector(".t").textContent = SECTOR_MENU_LABEL[id];
      row.querySelector(".cnt").textContent = items.length + " · " + units + "u";
      row.addEventListener("click", function () {
        activeSector = id;
        render();
        closeNavMenu();
      });
      body.appendChild(row);

      var btn = document.createElement("button");
      btn.className = "sector-tab" + (activeSector === id ? " active" : "");
      btn.setAttribute("data-sector", id);
      btn.innerHTML = '<span class="dot"></span><span class="lbl"></span><span class="count"></span>';
      btn.querySelector(".lbl").textContent = SECTOR_MENU_LABEL[id];
      btn.querySelector(".count").textContent = items.length + " · " + units + "u";
      btn.addEventListener("click", function () { activeSector = id; render(); });
      tabsWrap.appendChild(btn);
    });
  }

  // ---------- reloj ----------
  function updateClock() {
    var el = document.getElementById("nav-clock");
    if (el) el.textContent = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  }
  updateClock();
  setInterval(updateClock, 15000);

  // ---------- buscador ----------
  function toggleSearch() {
    var row = document.getElementById("nav-search-row");
    var opening = !row.classList.contains("open");
    row.classList.toggle("open");
    if (opening) setTimeout(function () { document.getElementById("search").focus(); }, 50);
  }
  document.getElementById("nav-search-btn").addEventListener("click", toggleSearch);

  // ---------- menú del nav (celular) ----------
  function closeNavMenu() {
    document.getElementById("nav-menu-panel").classList.remove("open");
    document.getElementById("accordion-body").classList.remove("open");
    document.getElementById("accordion-head").classList.remove("open");
  }
  document.getElementById("nav-menu-btn").addEventListener("click", function () {
    document.getElementById("nav-menu-panel").classList.toggle("open");
  });
  document.getElementById("accordion-head").addEventListener("click", function () {
    document.getElementById("accordion-body").classList.toggle("open");
    this.classList.toggle("open");
  });
  document.getElementById("menu-search-btn").addEventListener("click", function () { closeNavMenu(); toggleSearch(); });
  document.getElementById("menu-qr-btn").addEventListener("click", function () { closeNavMenu(); document.getElementById("btn-share").click(); });
  document.getElementById("menu-logo-btn").addEventListener("click", function () { closeNavMenu(); document.getElementById("btn-logo").click(); });
  document.getElementById("menu-print-btn").addEventListener("click", function () { closeNavMenu(); document.getElementById("btn-print").click(); });
  document.getElementById("menu-pdf-btn").addEventListener("click", function () { closeNavMenu(); document.getElementById("btn-pdf").click(); });

  function render() {
    renderSectorTabs();
    var list = document.getElementById("product-list");
    var empty = document.getElementById("empty-msg");
    var search = (document.getElementById("search").value || "").toLowerCase().trim();

    var allItems = Object.keys(products).map(function (k) { return products[k]; });

    var vencidosAll = allItems.filter(function (p) { return expiryState(p.expiry) === "vencido"; });
    var proximosAll = allItems.filter(function (p) { return expiryState(p.expiry) === "proximo"; });
    var banner = document.getElementById("expiry-alert");
    if (vencidosAll.length || proximosAll.length) {
      var parts = [];
      if (vencidosAll.length) parts.push("<b>" + vencidosAll.length + "</b> vencido" + (vencidosAll.length > 1 ? "s" : ""));
      if (proximosAll.length) parts.push("<b>" + proximosAll.length + "</b> por vencer en " + alertDays + " días");
      document.getElementById("expiry-alert-text").innerHTML = parts.join(" · ") + " — tocá para ver";
      banner.classList.add("show");
    } else banner.classList.remove("show");

    document.querySelectorAll(".expiry-chip").forEach(function (btn) {
      var f = btn.getAttribute("data-filter");
      btn.classList.toggle("active", expiryFilter === f);
      if (f === "vencidos") btn.querySelector(".n").textContent = vencidosAll.length ? "(" + vencidosAll.length + ")" : "";
      if (f === "proximos") btn.querySelector(".n").textContent = proximosAll.length ? "(" + proximosAll.length + ")" : "";
    });

    var items = allItems;
    if (activeSector !== "todos") items = items.filter(function (p) { return p.sector === activeSector; });
    if (expiryFilter === "vencidos") items = items.filter(function (p) { return expiryState(p.expiry) === "vencido"; });
    else if (expiryFilter === "proximos") items = items.filter(function (p) { return expiryState(p.expiry) === "proximo"; });

    var totalUnits = 0;
    items.forEach(function (p) { totalUnits += (p.gondolaQty || 0); });
    document.getElementById("stat-skus").textContent = items.length;
    document.getElementById("stat-units").textContent = totalUnits;

    items.sort(function (a, b) {
      var da = daysUntil(a.expiry), db = daysUntil(b.expiry);
      if (da !== null && db !== null && da !== db) return da - db;
      if (da !== null && db === null) return -1;
      if (da === null && db !== null) return 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    if (search) {
      items = items.filter(function (p) {
        return (p.name || "").toLowerCase().indexOf(search) !== -1 || (p.barcode || "").toLowerCase().indexOf(search) !== -1;
      });
    }

    list.innerHTML = "";
    empty.style.display = items.length === 0 ? "block" : "none";

    items.forEach(function (p) {
      var row = document.createElement("div");
      row.className = "product";
      var depositoTxt = (p.depositoQty === undefined || p.depositoQty === null) ? "" :
        '<span class="stock-badge">🏭 ' + p.depositoQty + ' en depósito</span>';
      var sectorLabel = SECTOR_LABEL[p.sector] || "Sin sector";
      row.innerHTML =
        '<div class="info">' +
          '<div class="name"></div>' +
          '<div class="meta">' +
            '<span class="sector-badge" data-sector="' + (p.sector || "") + '"><span class="dot"></span><span class="slabel"></span></span>' +
            '<span class="code-text"></span>' +
            '<span class="stock-badge">🛒 ' + (p.gondolaQty || 0) + ' en góndola</span>' +
            depositoTxt +
            expiryBadgeHtml(p) +
          '</div>' +
        '</div>' +
        '<button class="del-btn" aria-label="Eliminar">✕</button>';

      row.querySelector(".name").textContent = p.name || "(sin nombre)";
      row.querySelector(".slabel").textContent = sectorLabel;
      row.querySelector(".code-text").textContent = p.barcode;

      row.addEventListener("click", function (e) {
        if (e.target.closest(".del-btn")) return;
        openFicha(p.barcode);
      });
      row.querySelector(".del-btn").addEventListener("click", function (e) {
        e.stopPropagation();
        if (confirm('¿Eliminar "' + (p.name || p.barcode) + '" de la góndola?')) removeProduct(p.barcode);
      });

      list.appendChild(row);
    });
  }

  // ---------- persistence ----------
  function upsertProduct(barcode, patch) {
    var existing = products[barcode] || { barcode: barcode, name: "", sector: "", gondolaQty: 0, depositoQty: null, expiry: null };
    var next = Object.assign({}, existing, patch, { updatedAt: Date.now() });
    products[barcode] = next;
    render(); saveLocal();
    if (db) db.doc("products/" + sanitizeId(barcode)).set(next).catch(function (e) { console.error("db set failed", e); });
  }
  function removeProduct(barcode) {
    delete products[barcode];
    render(); saveLocal();
    if (db) db.doc("products/" + sanitizeId(barcode)).delete().catch(function (e) { console.error("db delete failed", e); });
  }
  function changeGondolaQty(barcode, delta) {
    var p = products[barcode]; if (!p) return;
    var q = Math.max(0, (p.gondolaQty || 0) + delta);
    upsertProduct(barcode, { gondolaQty: q });
    return q;
  }

  async function initDb() {
    try { db = await claude.use("db"); } catch (e) { db = null; }
    var tag = document.getElementById("synctag");
    if (!db) { tag.textContent = "local"; return; }
    tag.textContent = "sincronizado";
    try {
      db.collection("products").onSnapshot(function (snap) {
        var next = {};
        snap.forEach(function (doc) {
          var data = doc.data ? doc.data() : doc;
          if (data && data.barcode) next[data.barcode] = data;
        });
        products = next; render(); saveLocal();
      });
    } catch (e) { console.error("subscribe failed", e); }
  }

  // ---------- ficha de producto (ver) ----------
  function openFicha(barcode) {
    var p = products[barcode];
    if (!p) { openModal(barcode, "new"); return; }
    document.getElementById("ficha-name").textContent = p.name || "(sin nombre)";
    document.getElementById("ficha-code").textContent = p.barcode;
    document.getElementById("ficha-sector").textContent = SECTOR_LABEL[p.sector] || "Sin sector";
    document.getElementById("ficha-expiry").textContent = expiryLongText(p);
    document.getElementById("ficha-expiry").style.color =
      expiryState(p.expiry) === "vencido" ? "var(--red)" : (expiryState(p.expiry) === "proximo" ? "var(--amber-deep)" : "var(--ink)");
    document.getElementById("ficha-qty").textContent = p.gondolaQty || 0;
    document.getElementById("ficha-deposito").textContent =
      (p.depositoQty === undefined || p.depositoQty === null) ? "sin datos" : (p.depositoQty + " un.");

    document.getElementById("ficha-minus").onclick = function () {
      document.getElementById("ficha-qty").textContent = changeGondolaQty(barcode, -1);
    };
    document.getElementById("ficha-plus").onclick = function () {
      document.getElementById("ficha-qty").textContent = changeGondolaQty(barcode, 1);
    };
    document.getElementById("ficha-edit").onclick = function () {
      closeFicha(); openModal(barcode, "edit");
    };
    document.getElementById("ficha-close").onclick = closeFicha;
    document.getElementById("ficha-modal-backdrop").classList.add("active");
    vibrate();
  }
  function closeFicha() { document.getElementById("ficha-modal-backdrop").classList.remove("active"); }
  document.getElementById("ficha-modal-backdrop").addEventListener("click", function (e) { if (e.target === this) closeFicha(); });

  // ---------- alta / edición ----------
  function openModal(barcode, mode) {
    pendingBarcode = barcode;
    pendingMode = mode || "new";
    var existing = products[barcode];
    document.getElementById("modal-title").textContent = existing ? "Editar producto" : "Producto nuevo";
    document.getElementById("modal-code").textContent = barcode;
    document.getElementById("modal-name").value = existing ? existing.name || "" : "";
    document.getElementById("modal-sector").value = existing ? existing.sector || "comida" : (activeSector !== "todos" ? activeSector : "comida");
    document.getElementById("modal-qty").value = existing ? (existing.gondolaQty || 0) : 1;
    document.getElementById("modal-expiry").value = existing ? existing.expiry || "" : "";
    document.getElementById("modal-backdrop").classList.add("active");
    setTimeout(function () { document.getElementById("modal-name").focus(); }, 50);
  }
  function closeModal() { document.getElementById("modal-backdrop").classList.remove("active"); pendingBarcode = null; }
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-backdrop").addEventListener("click", function (e) { if (e.target === this) closeModal(); });
  document.getElementById("modal-save").addEventListener("click", function () {
    if (!pendingBarcode) return;
    var name = document.getElementById("modal-name").value.trim();
    var sector = document.getElementById("modal-sector").value;
    var qty = parseInt(document.getElementById("modal-qty").value, 10);
    var expiry = document.getElementById("modal-expiry").value || null;
    if (!name) { toast("Poné un nombre para el producto"); return; }
    if (isNaN(qty) || qty < 0) qty = 0;
    var existing = products[pendingBarcode];
    upsertProduct(pendingBarcode, { name: name, sector: sector, gondolaQty: qty, expiry: expiry });
    toast((existing ? "Actualizado: " : "Registrado: ") + name);
    closeModal();
  });

  function handleBarcode(code) {
    code = String(code).trim();
    if (!code) return;
    if (code.indexOf("DQ::") === 0) { toast('Ese es un código de transferencia. Usá "⇄ QR".'); return; }
    if (products[code]) openFicha(code); else openModal(code, "new");
  }

  // ---------- escaneo ----------
  function cameraErrorMessage(err) {
    var name = (err && (err.name || err.message || "")) + "";
    if (/NotAllowedError|Permission/i.test(name)) return "Le negaste el permiso de cámara al navegador. Habilitalo en el candado de la barra de direcciones.";
    if (/NotFoundError|DevicesNotFound/i.test(name)) return "No se encontró ninguna cámara en este dispositivo.";
    if (/NotReadableError|TrackStart/i.test(name)) return "La cámara está siendo usada por otra app.";
    if (/OverconstrainedError/i.test(name)) return "No se pudo usar la cámara trasera, probando con otra...";
    if (/insecure|SecurityError/i.test(name)) return "Abrí el enlace publicado directamente (no la vista previa) e intentá otra vez.";
    return "No se pudo acceder a la cámara. Usá el campo manual.";
  }

  function onScanSuccess(decodedText) {
    var now = Date.now();
    if (now - lastScanTime < 1500) return;
    lastScanTime = now;
    vibrate();
    stopScan();
    handleBarcode(decodedText);
  }

  function startScan() {
    var wrap = document.getElementById("reader-wrap");
    if (typeof Html5Qrcode === "undefined") { toast("No se pudo cargar el lector de cámara. Usá el campo manual."); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("Este navegador no permite acceso a la cámara acá. Abrí el enlace publicado directamente.");
      return;
    }
    wrap.classList.add("active"); scanning = true;
    var hint = document.getElementById("scan-hint");
    hint.textContent = "Solicitando permiso de cámara...";

    var formats = (typeof Html5QrcodeSupportedFormats !== "undefined") ? [
      Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION, Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39, Html5QrcodeSupportedFormats.CODE_93,
      Html5QrcodeSupportedFormats.CODABAR, Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.QR_CODE
    ] : undefined;
    html5Qr = new Html5Qrcode("reader", formats ? { formatsToSupport: formats, verbose: false } : { verbose: false });
    var config = { fps: 12, qrbox: { width: 280, height: 160 } };

    function tryStart(target) { return html5Qr.start(target, config, onScanSuccess, function () {}); }

    tryStart({ facingMode: "environment" }).then(function () {
      hint.textContent = "Apuntá la cámara al código de barras";
    }).catch(function (err) {
      console.error(err); toast(cameraErrorMessage(err));
      Html5Qrcode.getCameras().then(function (cams) {
        if (!cams || !cams.length) { toast("No se encontró ninguna cámara disponible."); stopScan(); return; }
        var choice = cams.find(function (c) { return /back|rear|environment/i.test(c.label); }) || cams[cams.length - 1];
        tryStart(choice.id).then(function () { hint.textContent = "Apuntá la cámara al código de barras"; })
          .catch(function (err2) { toast(cameraErrorMessage(err2)); stopScan(); });
      }).catch(function (err3) { toast(cameraErrorMessage(err3)); stopScan(); });
    });
  }

  function stopScan() {
    document.getElementById("reader-wrap").classList.remove("active");
    scanning = false;
    if (html5Qr) { html5Qr.stop().then(function () { html5Qr.clear(); html5Qr = null; }).catch(function () { html5Qr = null; }); }
  }

  document.getElementById("btn-scan").addEventListener("click", function () { if (scanning) stopScan(); else startScan(); });
  document.getElementById("btn-cancel-scan").addEventListener("click", stopScan);
  document.getElementById("btn-manual").addEventListener("click", function () {
    var v = document.getElementById("manual-code").value.trim();
    if (!v) { toast("Escribí un código"); return; }
    handleBarcode(v); document.getElementById("manual-code").value = "";
  });
  document.getElementById("manual-code").addEventListener("keydown", function (e) { if (e.key === "Enter") document.getElementById("btn-manual").click(); });
  document.getElementById("search").addEventListener("input", render);

  // ---------- logo ----------
  function saveLogoLocal() {
    try { if (logoDataUrl) localStorage.setItem(LOGO_KEY, logoDataUrl); else localStorage.removeItem(LOGO_KEY); } catch (e) {}
  }
  function loadLogoLocal() { try { return localStorage.getItem(LOGO_KEY); } catch (e) { return null; } }
  function applyLogo() {
    var img = document.getElementById("brand-logo"), preview = document.getElementById("logo-preview");
    if (logoDataUrl) {
      img.src = logoDataUrl; img.classList.add("set");
      preview.src = logoDataUrl; preview.classList.add("set");
    } else {
      img.classList.remove("set"); img.removeAttribute("src");
      preview.classList.remove("set"); preview.removeAttribute("src");
    }
  }
  function setLogo(dataUrl) {
    logoDataUrl = dataUrl; applyLogo(); saveLogoLocal();
    if (db) db.doc("settings/logo").set({ dataUrl: dataUrl, updatedAt: Date.now() }).catch(function (e) { console.error("logo db save failed", e); });
  }
  async function initLogo() {
    var local = loadLogoLocal();
    if (local) { logoDataUrl = local; applyLogo(); }
    if (db) {
      try {
        db.doc("settings/logo").onSnapshot(function (doc) {
          var data = doc && doc.data ? doc.data() : doc;
          if (data && data.dataUrl && data.dataUrl !== logoDataUrl) { logoDataUrl = data.dataUrl; applyLogo(); saveLogoLocal(); }
        });
      } catch (e) {}
    }
  }
  document.getElementById("btn-logo").addEventListener("click", function () { document.getElementById("logo-modal-backdrop").classList.add("active"); });
  document.getElementById("logo-cancel").addEventListener("click", function () { document.getElementById("logo-modal-backdrop").classList.remove("active"); });
  document.getElementById("logo-modal-backdrop").addEventListener("click", function (e) { if (e.target === this) this.classList.remove("active"); });
  document.getElementById("logo-remove").addEventListener("click", function () {
    setLogo(null); document.getElementById("logo-file").value = ""; toast("Logo quitado");
  });
  document.getElementById("logo-file").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) { toast("La imagen es muy pesada, probá con una de menos de 1.5 MB"); return; }
    var reader = new FileReader();
    reader.onload = function () { setLogo(reader.result); toast("Logo actualizado"); };
    reader.onerror = function () { toast("No se pudo leer la imagen"); };
    reader.readAsDataURL(file);
  });

  // ---------- impresión / pdf ----------
  function fechaHoy() {
    return new Date().toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function expiryCellText(p) {
    if (!p.expiry) return "—";
    var state = expiryState(p.expiry), d = daysUntil(p.expiry);
    if (state === "vencido") return formatDate(p.expiry) + " (vencido hace " + Math.abs(d) + "d)";
    if (state === "proximo") return formatDate(p.expiry) + " (en " + d + "d)";
    return formatDate(p.expiry);
  }

  function sortedProducts() {
    var items = Object.keys(products).map(function (k) { return products[k]; });
    items.sort(function (a, b) {
      var da = daysUntil(a.expiry), db = daysUntil(b.expiry);
      if (da !== null && db !== null && da !== db) return da - db;
      if (da !== null && db === null) return -1;
      if (da === null && db !== null) return 1;
      return (a.name || "").localeCompare(b.name || "", "es");
    });
    return items;
  }

  function buildAlertsSectionHtml() {
    var all = Object.keys(products).map(function (k) { return products[k]; });
    var vencidos = all.filter(function (p) { return expiryState(p.expiry) === "vencido"; });
    var proximos = all.filter(function (p) { return expiryState(p.expiry) === "proximo"; });
    if (!vencidos.length && !proximos.length) return "";
    function rowsFor(items) {
      return items.map(function (p) {
        return "<tr><td>" + escapeHtml(p.barcode) + "</td><td>" + escapeHtml(p.name || "") + "</td><td>" + expiryCellText(p) + "</td></tr>";
      }).join("");
    }
    return "<h2>⚠ Alertas de vencimiento</h2><table><thead><tr><th>Código</th><th>Producto</th><th>Vencimiento</th></tr></thead><tbody>" +
      rowsFor(vencidos) + rowsFor(proximos) + "</tbody></table>";
  }

  function buildPrintReport() {
    var items = sortedProducts();
    var totalUnits = 0;
    var rows = items.map(function (p) {
      totalUnits += (p.gondolaQty || 0);
      var dep = (p.depositoQty === undefined || p.depositoQty === null) ? "—" : p.depositoQty;
      return "<tr><td>" + escapeHtml(p.barcode) + "</td><td>" + escapeHtml(p.name || "") + "</td><td>" +
        (SECTOR_LABEL[p.sector] || "—") + "</td><td>" + (p.gondolaQty || 0) + "</td><td>" + dep + "</td><td>" + expiryCellText(p) + "</td></tr>";
    }).join("");

    var logoHtml = logoDataUrl ? '<img class="print-logo" src="' + logoDataUrl + '" alt="Logo">' : "";
    document.getElementById("print-report").innerHTML =
      '<div class="print-head">' + logoHtml + "<h1>Control de góndola</h1></div>" +
      '<div class="meta">Generado: ' + fechaHoy() + " &middot; alerta de vencimiento: " + alertDays + " días</div>" +
      buildAlertsSectionHtml() +
      "<table><thead><tr><th>Código</th><th>Producto</th><th>Sector</th><th>Góndola</th><th>Depósito</th><th>Vencimiento</th></tr></thead>" +
      "<tbody>" + (rows || '<tr><td colspan="6">Sin productos registrados.</td></tr>') + "</tbody></table>" +
      '<div class="grand-total">Total: ' + items.length + " productos &middot; " + totalUnits + " unidades en góndola</div>";
  }
  document.getElementById("btn-print").addEventListener("click", function () {
    buildPrintReport(); setTimeout(function () { window.print(); }, 50);
  });

  function imageFormat(dataUrl) { return /^data:image\/png/i.test(dataUrl) ? "PNG" : "JPEG"; }
  function loadImageSize(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = reject; img.src = dataUrl;
    });
  }

  async function downloadPdf() {
    if (typeof window.jspdf === "undefined") { toast("No se pudo cargar el generador de PDF."); return; }
    var items = sortedProducts();
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF();
    var titleX = 14, titleY = 18, cursorY = 32;

    if (logoDataUrl) {
      try {
        var size = await loadImageSize(logoDataUrl);
        var maxW = 26, maxH = 16, scale = Math.min(maxW / size.width, maxH / size.height);
        var w = size.width * scale, h = size.height * scale;
        doc.addImage(logoDataUrl, imageFormat(logoDataUrl), 14, 10, w, h);
        titleX = 14 + w + 8; titleY = 10 + h / 2 + 3; cursorY = Math.max(32, 10 + h + 10);
      } catch (e) { console.error("logo render failed", e); }
    }

    doc.setFontSize(16); doc.text("Control de góndola", titleX, titleY);
    doc.setFontSize(9); doc.setTextColor(110);
    doc.text("Generado: " + fechaHoy() + "  ·  alerta: " + alertDays + " días", titleX, titleY + 7);
    doc.setTextColor(0);

    function colorCellByStatus(data, statuses) {
      if (data.section === "body") {
        var st = statuses[data.row.index];
        if (st === "vencido") { data.cell.styles.textColor = [167, 64, 47]; data.cell.styles.fontStyle = "bold"; }
        else if (st === "proximo") { data.cell.styles.textColor = [156, 94, 20]; }
      }
    }

    var vencidos = items.filter(function (p) { return expiryState(p.expiry) === "vencido"; });
    var proximos = items.filter(function (p) { return expiryState(p.expiry) === "proximo"; });
    if (vencidos.length || proximos.length) {
      var alertItems = vencidos.concat(proximos);
      var alertStatuses = alertItems.map(function (p) { return expiryState(p.expiry); });
      var alertBody = alertItems.map(function (p) { return [p.barcode, p.name || "", expiryCellText(p)]; });
      doc.setFontSize(11); doc.setFont(undefined, "bold"); doc.setTextColor(167, 64, 47);
      doc.text("⚠ Alertas de vencimiento (" + alertItems.length + ")", 14, cursorY);
      doc.setTextColor(0); doc.setFont(undefined, "normal");
      doc.autoTable({
        startY: cursorY + 4, head: [["Código", "Producto", "Vencimiento"]], body: alertBody,
        styles: { font: "helvetica", fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [167, 64, 47], textColor: 255 },
        didParseCell: function (data) { colorCellByStatus(data, alertStatuses); },
        margin: { top: 20 }
      });
      cursorY = doc.lastAutoTable.finalY + 14;
    }

    var statuses = items.map(function (p) { return expiryState(p.expiry); });
    var totalUnits = 0;
    var body = items.map(function (p) {
      totalUnits += (p.gondolaQty || 0);
      var dep = (p.depositoQty === undefined || p.depositoQty === null) ? "—" : String(p.depositoQty);
      return [p.barcode, p.name || "", SECTOR_LABEL[p.sector] || "—", String(p.gondolaQty || 0), dep, expiryCellText(p)];
    });
    doc.autoTable({
      startY: cursorY, head: [["Código", "Producto", "Sector", "Góndola", "Depósito", "Vencimiento"]], body: body,
      styles: { font: "helvetica", fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [43, 78, 168], textColor: 255 },
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" } },
      didParseCell: function (data) { colorCellByStatus(data, statuses); },
      margin: { top: 20 }
    });
    cursorY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(10); doc.setFont(undefined, "bold");
    doc.text("Total: " + items.length + " productos, " + totalUnits + " unidades en góndola", 14, cursorY);

    var blob = doc.output("blob");
    var filename = "gondola-" + new Date().toISOString().slice(0, 10) + ".pdf";
    var downloads = null;
    try { downloads = await claude.use("downloads"); } catch (e) { downloads = null; }
    if (downloads) {
      try { await downloads.save({ filename: filename, data: blob }); toast("PDF listo para guardar"); return; }
      catch (e) { console.error("downloads.save failed", e); }
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  document.getElementById("btn-pdf").addEventListener("click", downloadPdf);

  // ---------- compartir por QR ----------
  var QR_CHUNK_SIZE = 320;
  var qrChunks = [], qrIndex = 0, qrTimer = null, qrPlaying = true;
  var recvQr = null, recvTransferId = null, recvTotal = 0, recvChunks = {}, recvLastScan = 0;

  function randomId() { return Math.random().toString(36).slice(2, 6).toUpperCase(); }

  function buildTransferPayload() {
    var items = Object.keys(products).map(function (k) {
      var p = products[k];
      return [p.barcode, p.name || "", p.sector || "", p.gondolaQty || 0, p.depositoQty === undefined ? null : p.depositoQty, p.expiry || ""];
    });
    return JSON.stringify({ t: "gondola-transfer", v: 1, ts: Date.now(), items: items });
  }
  function buildQrChunks() {
    var json = buildTransferPayload();
    var id = randomId();
    var parts = [];
    for (var i = 0; i < json.length; i += QR_CHUNK_SIZE) parts.push(json.slice(i, i + QR_CHUNK_SIZE));
    if (parts.length === 0) parts = [""];
    var total = parts.length;
    return parts.map(function (chunk, idx) { return "DQ::" + id + "::" + idx + "::" + total + "::" + chunk; });
  }
  function makeQrObject(text) {
    // probamos tamaños crecientes hasta que entren los datos (compatible con versiones viejas de la librería)
    for (var tn = 1; tn <= 40; tn++) {
      try {
        var qr = qrcode(tn, "M");
        qr.addData(text);
        qr.make();
        return qr;
      } catch (e) { /* no entra en este tamaño, probamos el siguiente */ }
    }
    return null;
  }

  function renderQrFrame() {
    var img = document.getElementById("qr-canvas");
    var text = qrChunks[qrIndex];
    var progress = document.getElementById("qr-progress");
    if (typeof qrcode === "undefined") { progress.textContent = "No se pudo cargar el generador de QR (revisá la conexión y recargá)."; return; }
    try {
      var qr = makeQrObject(text);
      if (!qr) { progress.textContent = "No se pudo generar el código: datos demasiado grandes."; return; }
      img.src = qr.createDataURL(6, 4);
      progress.textContent =
        "Mostrando código " + (qrIndex + 1) + " de " + qrChunks.length + (qrChunks.length > 1 ? "  ·  se cambia solo" : "");
    } catch (e) {
      console.error(e);
      progress.textContent = "No se pudo generar el código: " + (e.message || e);
    }
  }
  function qrAdvance() { qrIndex = (qrIndex + 1) % qrChunks.length; renderQrFrame(); }
  function startQrSlideshow() {
    qrChunks = buildQrChunks(); qrIndex = 0; qrPlaying = true; renderQrFrame();
    document.getElementById("qr-controls").style.display = qrChunks.length > 1 ? "flex" : "none";
    document.getElementById("qr-playpause").textContent = "Pausar";
    clearInterval(qrTimer);
    if (qrChunks.length > 1) qrTimer = setInterval(function () { if (qrPlaying) qrAdvance(); }, 1100);
  }
  function stopQrSlideshow() { clearInterval(qrTimer); qrTimer = null; }
  document.getElementById("qr-prev").addEventListener("click", function () { qrIndex = (qrIndex - 1 + qrChunks.length) % qrChunks.length; renderQrFrame(); });
  document.getElementById("qr-next").addEventListener("click", qrAdvance);
  document.getElementById("qr-playpause").addEventListener("click", function () {
    qrPlaying = !qrPlaying; this.textContent = qrPlaying ? "Pausar" : "Seguir";
  });

  function resetRecvState() {
    recvTransferId = null; recvTotal = 0; recvChunks = {};
    document.getElementById("recv-progress-fill").style.width = "0%";
    document.getElementById("recv-summary").style.display = "none";
    document.getElementById("recv-status").textContent = 'Tocá "Empezar a recibir" y apuntá al otro dispositivo';
  }

  function onRecvChunk(decoded) {
    var now = Date.now();
    if (now - recvLastScan < 120) return;
    recvLastScan = now;
    if (decoded.indexOf("DQ::") !== 0) return;
    var parts = decoded.split("::");
    if (parts.length < 5) return;
    var id = parts[1], idx = parseInt(parts[2], 10), total = parseInt(parts[3], 10);
    var chunk = parts.slice(4).join("::");
    if (recvTransferId && recvTransferId !== id) recvChunks = {};
    recvTransferId = id; recvTotal = total; recvChunks[idx] = chunk;
    var got = Object.keys(recvChunks).length;
    document.getElementById("recv-progress-fill").style.width = Math.round((got / total) * 100) + "%";
    document.getElementById("recv-status").textContent = "Recibidos " + got + " de " + total + " códigos...";
    vibrate();
    if (got >= total) finishReceive();
  }

  function finishReceive() {
    stopRecv();
    var ordered = [];
    for (var i = 0; i < recvTotal; i++) {
      if (recvChunks[i] === undefined) { toast("Faltó un código, probá de nuevo"); resetRecvState(); return; }
      ordered.push(recvChunks[i]);
    }
    var json = ordered.join("");
    var payload;
    try { payload = JSON.parse(json); } catch (e) { toast("No se pudo leer la información recibida"); resetRecvState(); return; }
    if (!payload || !Array.isArray(payload.items)) { toast("El código recibido no es válido"); resetRecvState(); return; }

    var isDeposito = payload.t === "deposito-transfer";
    var isGondola = payload.t === "gondola-transfer";
    if (!isDeposito && !isGondola) { toast("El código recibido no es de esta app"); resetRecvState(); return; }

    var incoming = payload.items.map(function (arr) {
      if (isDeposito) {
        // [barcode, name, sector, quantity, expiry, locSector, locAltura]
        return { barcode: arr[0], name: arr[1] || "", depositoQty: arr[3] || 0, expiry: arr[4] || null, fromDeposito: true };
      }
      // gondola: [barcode, name, sector, gondolaQty, depositoQty, expiry]
      return { barcode: arr[0], name: arr[1] || "", sector: arr[2] || "", gondolaQty: arr[3] || 0, depositoQty: (arr[4] === null || arr[4] === undefined) ? null : arr[4], expiry: arr[5] || null };
    });

    var nuevos = incoming.filter(function (p) { return !products[p.barcode]; }).length;
    var existentes = incoming.length - nuevos;

    var summary = document.getElementById("recv-summary");
    summary.style.display = "block";
    summary.innerHTML =
      "<div>Se recibió " + (isDeposito ? "stock del <b>depósito</b>" : "información de <b>góndola</b>") +
      " de <b>" + incoming.length + "</b> productos (<b>" + nuevos + "</b> nuevos, <b>" + existentes + "</b> ya existentes).</div>" +
      '<div class="recv-actions">' +
        (isDeposito
          ? '<button class="btn-primary" id="recv-apply">Actualizar cantidad en depósito</button>'
          : '<button class="btn-ghost" id="recv-merge">Fusionar</button><button class="btn-primary" id="recv-replace">Reemplazar todo</button>') +
      "</div>";

    if (isDeposito) {
      document.getElementById("recv-apply").addEventListener("click", function () { applyIncoming(incoming, "deposito"); });
    } else {
      document.getElementById("recv-merge").addEventListener("click", function () { applyIncoming(incoming, "merge"); });
      document.getElementById("recv-replace").addEventListener("click", function () {
        if (confirm("Esto va a borrar todo lo que tenés registrado acá y lo va a reemplazar por lo recibido. ¿Continuar?")) {
          applyIncoming(incoming, "replace");
        }
      });
    }
  }

  function applyIncoming(incoming, mode) {
    if (mode === "replace") products = {};
    incoming.forEach(function (p) {
      var existing = products[p.barcode] || {};
      var next;
      if (mode === "deposito") {
        // solo actualiza/crea la referencia de cantidad en depósito, sin pisar precio ni cantidad de góndola
        next = Object.assign({ barcode: p.barcode, name: existing.name || p.name, sector: existing.sector || "", gondolaQty: existing.gondolaQty || 0 },
          existing, { depositoQty: p.depositoQty, expiry: existing.expiry || p.expiry || null, updatedAt: Date.now() });
      } else {
        next = Object.assign({}, existing, p, { updatedAt: Date.now() });
      }
      products[p.barcode] = next;
      if (db) db.doc("products/" + sanitizeId(p.barcode)).set(next).catch(function (e) { console.error("db set failed (import)", e); });
    });
    saveLocal(); render();
    toast("Información recibida y aplicada");
    document.getElementById("share-modal-backdrop").classList.remove("active");
    resetRecvState();
  }

  function startRecv() {
    if (typeof Html5Qrcode === "undefined") { toast("No se pudo cargar el lector de cámara."); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("Este navegador no permite acceso a la cámara acá. Abrí el enlace publicado directamente."); return;
    }
    resetRecvState();
    document.getElementById("recv-start").style.display = "none";
    document.getElementById("recv-stop").style.display = "inline-block";
    document.getElementById("recv-status").textContent = "Solicitando permiso de cámara...";
    recvQr = new Html5Qrcode("recv-reader", { verbose: false });
    var config = { fps: 12, qrbox: { width: 260, height: 260 } };
    recvQr.start({ facingMode: "environment" }, config, onRecvChunk, function () {}).then(function () {
      document.getElementById("recv-status").textContent = "Apuntá al código que se muestra en el otro dispositivo";
    }).catch(function (err) { console.error(err); toast(cameraErrorMessage(err)); stopRecv(); });
  }
  function stopRecv() {
    document.getElementById("recv-start").style.display = "inline-block";
    document.getElementById("recv-stop").style.display = "none";
    if (recvQr) { recvQr.stop().then(function () { recvQr.clear(); recvQr = null; }).catch(function () { recvQr = null; }); }
  }
  document.getElementById("recv-start").addEventListener("click", startRecv);
  document.getElementById("recv-stop").addEventListener("click", function () { stopRecv(); resetRecvState(); });

  function switchShareTab(pane) {
    document.querySelectorAll(".share-tab").forEach(function (t) { t.classList.toggle("active", t.getAttribute("data-pane") === pane); });
    document.getElementById("pane-send").classList.toggle("active", pane === "send");
    document.getElementById("pane-recv").classList.toggle("active", pane === "recv");
    if (pane === "send") { stopRecv(); startQrSlideshow(); } else { stopQrSlideshow(); }
  }
  document.getElementById("tab-send").addEventListener("click", function () { switchShareTab("send"); });
  document.getElementById("tab-recv").addEventListener("click", function () { switchShareTab("recv"); });
  function openShareQR() {
    if (scanning) stopScan();
    document.getElementById("share-modal-backdrop").classList.add("active");
    switchShareTab("send");
  }
  document.getElementById("btn-share").addEventListener("click", openShareQR);
  document.getElementById("btn-qr-main").addEventListener("click", openShareQR);
  function closeShareModal() {
    document.getElementById("share-modal-backdrop").classList.remove("active");
    stopQrSlideshow(); stopRecv(); resetRecvState();
  }
  document.getElementById("share-close").addEventListener("click", closeShareModal);
  document.getElementById("share-modal-backdrop").addEventListener("click", function (e) { if (e.target === this) closeShareModal(); });

  // ---------- splash ----------
  function hideSplash() {
    var el = document.getElementById("splash");
    var elapsed = Date.now() - splashShownAt;
    var minDelay = Math.max(0, 650 - elapsed);
    setTimeout(function () { el.classList.add("hide"); setTimeout(function () { el.remove(); }, 450); }, minDelay);
  }

  // ---------- init ----------
  loadAlertDays();
  loadLocal();
  render();
  initDb();
  initLogo();
  if (document.readyState === "complete") hideSplash(); else window.addEventListener("load", hideSplash);
  setTimeout(hideSplash, 2500);
})();
