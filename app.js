/* ==========================================================================
   APP — conecta la interfaz con Auth, Inventory y Scanner
   ========================================================================== */
(function () {
  const cfg = APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const money = new Intl.NumberFormat(cfg.currency.locale, {
    style: "currency", currency: cfg.currency.code,
    minimumFractionDigits: cfg.currency.decimals, maximumFractionDigits: cfg.currency.decimals
  });
  const timeFmt = new Intl.DateTimeFormat(cfg.currency.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function show(el, text, isError) {
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("notice--error", !!isError);
  }
  const num = (v) => {
    const n = parseFloat(String(v).replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  };

  let history = [];
  let lastCode = "", lastCodeAt = 0;
  let counting = false;
  let counts = loadCounts();

  function loadCounts() { try { return JSON.parse(localStorage.getItem("tienda.conteo") || "{}") || {}; } catch (e) { return {}; } }
  function saveCounts() { try { localStorage.setItem("tienda.conteo", JSON.stringify(counts)); } catch (e) {} }

  $("brand-name").textContent = cfg.storeName;
  document.title = cfg.storeName + " · Inventario";

  /* ================= NAVEGACIÓN ================= */
  function goTo(view) {
    document.querySelectorAll(".tab").forEach((b) => {
      const on = b.dataset.view === view; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on);
    });
    ["scan", "inventory", "cuadre"].forEach((v) => { $("view-" + v).hidden = v !== view; });
    if (view !== "scan") { Scanner.stopCamera(); setCameraUI(false); }
    if (view === "cuadre") renderCuadre();
  }
  document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => goTo(btn.dataset.view)));

  document.querySelectorAll(".seg__btn").forEach((btn) => btn.addEventListener("click", () => {
    const m = btn.dataset.method;
    document.querySelectorAll(".seg__btn").forEach((b) => {
      const on = b === btn; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on);
    });
    $("method-camera").hidden = m !== "camera";
    $("method-photo").hidden = m !== "photo";
    if (m !== "camera") { Scanner.stopCamera(); setCameraUI(false); }
  }));

  /* ================= RESULTADO ================= */
  function beep() {
    if (!cfg.scanner.beep) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880; g.gain.value = 0.08;
      o.connect(g); g.connect(ctx.destination); o.start();
      setTimeout(() => { o.stop(); ctx.close(); }, 120);
    } catch (e) {}
  }

  function resultFooter(opts) {
    if (!opts || !opts.note) return "";
    return '<p class="sale-note">' + esc(opts.note) + "</p>" +
      (opts.undo ? '<button class="btn btn--secondary btn--sm" data-undo="' + esc(opts.undo) + '" type="button">Deshacer descuento</button>' : "");
  }

  function renderResult(code, item, opts) {
    const box = $("result");
    if (!item) {
      box.innerHTML =
        '<h3 class="result__name">Código no encontrado</h3>' +
        '<p class="result__attrs">Este código no está en el inventario cargado. Revise el Excel o escanee de nuevo.</p>' +
        '<p class="result__code">Código leído: ' + esc(code) + '</p>' + resultFooter(opts);
      return;
    }
    if (!Inventory.isComplete(item)) {
      box.innerHTML =
        '<h3 class="result__name">Código registrado, sin datos</h3>' +
        '<p class="result__attrs">Este código ya está en el inventario, pero todavía no tiene nombre ni precio. ' +
        'Complételos en la pestaña «Cuadre» o en el Excel.</p>' +
        '<p class="result__code">Código: ' + esc(item.barcode) + '</p>' + resultFooter(opts);
      return;
    }
    const level = Inventory.stockLevel(item.stock);
    const label = { out: "Agotado", low: "Stock bajo", ok: "Disponible" }[level];
    const attrs = [item.size && "Talla " + item.size, item.color].filter(Boolean).join(" · ");
    box.innerHTML =
      '<h3 class="result__name">' + esc(item.name) + '</h3>' +
      '<p class="result__attrs">' + esc(attrs || "Sin talla ni color") + '</p>' +
      '<div class="stats">' +
        '<div class="stat"><div class="stat__label">Precio</div><div class="stat__value">' + esc(money.format(item.price)) + '</div></div>' +
        '<div class="stat"><div class="stat__label">Stock actual</div><div class="stat__value">' + esc(item.stock) + '</div>' +
          '<span class="badge badge--' + level + '">' + label + '</span></div>' +
      '</div>' +
      '<p class="result__code">Código: ' + esc(item.barcode) + '</p>' + resultFooter(opts);
  }

  function renderHistory() {
    const ul = $("history");
    if (!history.length) { ul.innerHTML = '<li class="history-empty">Todavía no hay escaneos.</li>'; return; }
    ul.innerHTML = history.map((h, i) =>
      '<li data-i="' + i + '"><span class="n">' +
      esc(h.item ? (h.item.name || "Sin nombre") + (h.item.size ? " · " + h.item.size : "") + " (" + h.code + ")" : "No encontrado: " + h.code) +
      '</span><span class="t">' + esc((h.tag ? h.tag.trim() + " · " : "") + timeFmt.format(h.at)) + '</span></li>').join("");
  }
  $("history").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-i]"); if (!li) return;
    const h = history[+li.dataset.i];
    renderResult(h.code, Inventory.find(h.code));
  });
  $("clear-history").addEventListener("click", () => { history = []; renderHistory(); });

  /* ---- Descuento automático de stock al escanear ---- */
  let deduct = (function () { try { return localStorage.getItem("tienda.descontar") !== "0"; } catch (e) { return true; } })();
  $("deduct-toggle").checked = deduct;
  $("deduct-toggle").addEventListener("change", (e) => {
    deduct = e.target.checked;
    try { localStorage.setItem("tienda.descontar", deduct ? "1" : "0"); } catch (err) {}
  });

  $("result").addEventListener("click", (e) => {
    const b = e.target.closest("[data-undo]"); if (!b) return;
    const it = Inventory.find(b.dataset.undo); if (!it) return;
    Inventory.update(it.barcode, { stock: it.stock + 1 });
    if (history.length && history[0].code === b.dataset.undo) history[0].note = "";
    renderResult(it.barcode, it, { note: "Se devolvió 1 unidad: hay " + it.stock + "." });
    renderHistory();
  });

  /* Punto único de entrada de un código leído (cámara, foto, manual o lector USB). */
  function handleCode(raw, opts) {
    const code = String(raw || "").trim();
    if (!code) return;
    const now = Date.now();
    // Con la cámara el código se ve muchas veces seguidas: mientras siga en cuadro
    // (o reaparezca antes de repeatDelayMs) no se cuenta de nuevo.
    if (!(opts && opts.force) && code === lastCode && now - lastCodeAt < cfg.scanner.repeatDelayMs) {
      lastCodeAt = now;
      return;
    }
    lastCode = code; lastCodeAt = now;

    const item = Inventory.find(code);
    let ropts = null, tag = "";
    if (item && counting && Auth.isUnlocked()) {
      addCount(code);                       // en modo conteo no se descuenta
    } else if (item && deduct) {
      if (item.stock > 0) {
        Inventory.update(item.barcode, { stock: item.stock - 1 });
        ropts = { note: "Se descontó 1 unidad: quedan " + item.stock + ".", undo: item.barcode };
        tag = " −1";
      } else {
        ropts = { note: Inventory.isComplete(item) ? "Sin stock: no se descontó nada." : "Todavía no tiene stock cargado, así que no se descontó nada." };
      }
    } else if (counting && Auth.isUnlocked()) {
      addCount(code);
    }

    renderResult(code, item, ropts);
    history.unshift({ code, item, at: new Date(), tag });
    history = history.slice(0, cfg.scanner.maxHistory);
    renderHistory();
    beep();

    const vf = $("viewfinder");
    vf.classList.add("is-hit"); setTimeout(() => vf.classList.remove("is-hit"), 600);
  }

  /* ================= MÉTODO B: CÁMARA ================= */
  const video = $("video");
  let camerasLoaded = false;

  function setCameraUI(on) {
    $("viewfinder").classList.toggle("is-on", on);
    $("camera-toggle").textContent = on ? "Detener cámara" : "Iniciar cámara";
  }

  async function startCamera() {
    show($("camera-notice"), "");
    const support = Scanner.checkCameraSupport();
    if (!support.ok) { show($("camera-notice"), support.message, true); return; }
    try {
      $("camera-toggle").disabled = true;
      const sel = $("camera-select");
      if (!camerasLoaded) {
        const cams = await Scanner.listCameras();
        if (!cams.length) throw new Error("No se encontró ninguna cámara conectada a este equipo.");
        sel.innerHTML = cams.map((c, i) => '<option value="' + esc(c.deviceId) + '">' + esc(c.label || "Cámara " + (i + 1)) + "</option>").join("");
        sel.value = Scanner.pickDefaultCamera(cams) || cams[0].deviceId;
        sel.hidden = cams.length < 2;
        camerasLoaded = true;
      }
      await Scanner.startCamera(video, sel.value, (text) => handleCode(text));
      setCameraUI(true);
    } catch (e) {
      setCameraUI(false);
      show($("camera-notice"), e.message, true);
    } finally {
      $("camera-toggle").disabled = false;
    }
  }

  $("camera-toggle").addEventListener("click", () => {
    if (Scanner.isCameraRunning()) { Scanner.stopCamera(); setCameraUI(false); }
    else startCamera();
  });
  $("camera-select").addEventListener("change", () => { if (Scanner.isCameraRunning()) startCamera(); });
  window.addEventListener("pagehide", () => Scanner.stopCamera());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && Scanner.isCameraRunning()) { Scanner.stopCamera(); setCameraUI(false); }
  });

  (function initialCameraNotice() {
    const s = Scanner.checkCameraSupport();
    if (!s.ok) show($("camera-notice"), s.message, true);
  })();

  /* ================= MÉTODO A: FOTOS ================= */
  const drop = $("dropzone");
  async function processFiles(fileList) {
    const files = Array.from(fileList).filter(Boolean);
    const log = $("photo-log");
    for (const file of files) {
      const li = document.createElement("li");
      li.innerHTML = '<span class="name">' + esc(file.name) + '</span><span class="st">Procesando…</span>';
      log.prepend(li);
      try {
        const r = await Scanner.decodeImageFile(file);
        li.querySelector(".st").textContent = r.text;
        handleCode(r.text, { force: true });
      } catch (e) {
        li.querySelector(".st").textContent = "Sin código";
        li.title = e.message;
        $("result").innerHTML = '<h3 class="result__name">No se pudo leer</h3><p class="result__attrs">' + esc(e.message) + "</p>";
      }
    }
  }
  $("file-input").addEventListener("change", (e) => { processFiles(e.target.files); e.target.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
  drop.addEventListener("drop", (e) => processFiles(e.dataTransfer.files));
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file-input").click(); } });

  /* ================= MANUAL / LECTOR USB ================= */
  $("manual-form").addEventListener("submit", (e) => {
    e.preventDefault();
    handleCode($("manual-input").value, { force: true });
    $("manual-input").value = ""; $("manual-input").focus();
  });

  /* ================= INVENTARIO (solo lectura) ================= */
  function renderInventory() {
    const q = $("inv-search").value.trim().toLowerCase();
    const onlyLow = $("inv-low").checked;
    const rows = Inventory.all().filter((it) => {
      if (onlyLow && (!Inventory.isComplete(it) || Inventory.stockLevel(it.stock) === "ok")) return false;
      if (!q) return true;
      return [it.barcode, it.name, it.size, it.color].join(" ").toLowerCase().includes(q);
    });
    $("inv-body").innerHTML = rows.length ? rows.map((it) => {
      const done = Inventory.isComplete(it);
      const lv = done ? Inventory.stockLevel(it.stock) : "ok";
      return '<tr class="is-' + lv + '"><td class="code">' + esc(it.barcode) + '</td><td class="name">' +
        (done ? esc(it.name) : '<span class="badge badge--empty">Sin datos</span>') +
        "</td><td>" + esc(it.size) + "</td><td>" + esc(it.color) + '</td><td class="num">' + (done ? esc(money.format(it.price)) : "—") +
        '</td><td class="num stock">' + (done ? esc(it.stock) : "—") + "</td></tr>";
    }).join("") : '<tr class="empty-row"><td colspan="6">No hay prendas que coincidan.</td></tr>';
  }
  $("inv-search").addEventListener("input", renderInventory);
  $("inv-low").addEventListener("change", renderInventory);

  /* ================= CUADRE ================= */
  function renderCuadre() {
    const open = Auth.isUnlocked();
    $("cuadre-locked").hidden = open;
    $("cuadre-open").hidden = !open;
    if (open) { renderCounts(); renderEdit(); updatePending(Inventory.pendingCount()); }
    else setTimeout(() => $("login-user").focus(), 0);
  }

  function tryUnlock() {
    if (Auth.unlock($("login-user").value, $("login-pass").value)) {
      show($("login-error"), ""); $("login-pass").value = ""; renderCuadre();
    } else {
      show($("login-error"), "Usuario o contraseña incorrectos.", true);
      $("login-pass").select();
    }
  }
  $("login-btn").addEventListener("click", tryUnlock);
  ["login-user", "login-pass"].forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); }));
  $("lock-btn").addEventListener("click", () => { Auth.lock(); setCounting(false); renderCuadre(); });

  function updatePending(n) {
    $("pending-text").textContent = n ? n + (n === 1 ? " cambio sin descargar" : " cambios sin descargar") : "Sin cambios";
  }

  /* --- edición de datos --- */
  function renderEdit() {
    const q = $("edit-search").value.trim().toLowerCase();
    const onlyEmpty = $("edit-empty").checked;
    const rows = Inventory.all().filter((it) => {
      if (onlyEmpty && Inventory.isComplete(it)) return false;
      if (!q) return true;
      return [it.barcode, it.name, it.size, it.color].join(" ").toLowerCase().includes(q);
    });
    const field = (it, f, cls, type) =>
      '<td class="' + (cls || "") + '"><input data-code="' + esc(it.barcode) + '" data-f="' + f + '" ' +
      (type === "num" ? 'inputmode="numeric" class="num" ' : "") + 'value="' + esc(it[f] === 0 && f === "price" ? "" : it[f]) + '"></td>';
    $("edit-body").innerHTML = rows.length ? rows.map((it) =>
      '<tr class="' + (Inventory.isComplete(it) ? "" : "is-empty") + '"><td class="code">' + esc(it.barcode) + "</td>" +
      field(it, "name", "name") + field(it, "size") + field(it, "color") + field(it, "price", "", "num") + field(it, "stock", "", "num") + "</tr>"
    ).join("") : '<tr class="empty-row"><td colspan="6">No hay prendas que coincidan.</td></tr>';
  }
  $("edit-body").addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-code]"); if (!inp) return;
    const f = inp.dataset.f;
    const value = (f === "price" || f === "stock") ? num(inp.value) : inp.value.trim();
    try {
      const it = Inventory.update(inp.dataset.code, { [f]: value });
      if (f === "price" || f === "stock") inp.value = it[f] || (f === "stock" ? "0" : "");
      inp.closest("tr").classList.toggle("is-empty", !Inventory.isComplete(it));
      renderCounts();
    } catch (err) { show($("add-notice"), err.message, true); }
  });
  $("edit-search").addEventListener("input", renderEdit);
  $("edit-empty").addEventListener("change", renderEdit);

  $("add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      Inventory.addItem({
        barcode: fd.get("barcode"), name: String(fd.get("name") || "").trim(), size: String(fd.get("size") || "").trim(),
        color: String(fd.get("color") || "").trim(), price: num(fd.get("price")), stock: num(fd.get("stock"))
      });
      e.target.reset(); show($("add-notice"), "Prenda agregada.", false);
      renderEdit();
    } catch (err) { show($("add-notice"), err.message, true); }
  });

  $("btn-export").addEventListener("click", () => {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    Inventory.exportXlsx("inventario_" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + ".xlsx");
  });
  $("btn-discard").addEventListener("click", async () => {
    if (!Inventory.pendingCount()) return;
    if (confirm("Se perderán los cambios hechos aquí que no estén en el Excel. ¿Descartarlos?")) {
      await Inventory.discardChanges(); renderEdit(); renderCounts();
    }
  });

  /* --- conteo físico --- */
  function setCounting(on) {
    counting = on;
    $("count-state").textContent = on ? "Activo" : "Pausado";
    $("count-toggle").textContent = on ? "Pausar conteo" : "Iniciar conteo";
  }
  function addCount(code) {
    const it = Inventory.find(code);
    const key = it ? it.barcode : String(code).trim();
    counts[key] = (counts[key] || 0) + 1;
    saveCounts(); renderCounts();
  }
  function renderCounts() {
    if (!Auth.isUnlocked()) return;
    const keys = Object.keys(counts);
    if (!keys.length) {
      $("count-body").innerHTML = '<tr class="empty-row"><td colspan="6">Todavía no se ha contado nada.</td></tr>';
      return;
    }
    $("count-body").innerHTML = keys.sort().map((k) => {
      const it = Inventory.find(k);
      const sys = it ? it.stock : null;
      const diff = it ? counts[k] - it.stock : null;
      const cls = diff === 0 ? "diff diff--zero" : "diff";
      return '<tr><td class="code">' + esc(k) + "</td><td>" + esc(it ? (it.name || "Sin nombre") : "No está en el inventario") +
        '</td><td class="num">' + (sys == null ? "—" : esc(sys)) + '</td><td class="num">' + esc(counts[k]) +
        '</td><td class="num ' + cls + '">' + (diff == null ? "—" : (diff > 0 ? "+" : "") + diff) + "</td><td>" +
        (it && diff !== 0 ? '<button class="btn btn--ghost btn--sm" data-adjust="' + esc(k) + '">Ajustar</button>' : "") + "</td></tr>";
    }).join("");
  }
  $("count-toggle").addEventListener("click", () => setCounting(!counting));
  $("count-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("count-input").value.trim();
    if (v) { addCount(v); }
    $("count-input").value = ""; $("count-input").focus();
  });
  $("count-reset").addEventListener("click", () => {
    if (!Object.keys(counts).length || confirm("¿Borrar todo el conteo?")) { counts = {}; saveCounts(); renderCounts(); }
  });
  $("count-body").addEventListener("click", (e) => {
    const b = e.target.closest("[data-adjust]"); if (!b) return;
    Inventory.update(b.dataset.adjust, { stock: counts[b.dataset.adjust] });
    renderCounts(); renderEdit();
  });
  $("count-apply-all").addEventListener("click", () => {
    const todo = Object.keys(counts).filter((k) => { const it = Inventory.find(k); return it && it.stock !== counts[k]; });
    if (!todo.length) return;
    if (confirm("Se cambiará el stock de " + todo.length + " prendas por lo contado. ¿Continuar?")) {
      todo.forEach((k) => Inventory.update(k, { stock: counts[k] }));
      renderCounts(); renderEdit();
    }
  });

  /* ================= SINCRONIZACIÓN ================= */
  Inventory.on("change", () => {
    renderInventory();
    if (Auth.isUnlocked() && !$("view-cuadre").hidden) { renderEdit(); renderCounts(); }
    show($("inv-notice"), "");
    if (history.length) renderResult(history[0].code, Inventory.find(history[0].code));
  });
  Inventory.on("pending", updatePending);
  Inventory.on("error", (e) => show($("inv-notice"), e.message, true));
  Inventory.on("status", (s) => {
    $("sync-dot").classList.toggle("is-live", !!s.live);
    if (s.count) {
      $("sync-text").textContent = s.count + " prendas · " + (s.live ? "sincronizado " : "cargado ") + timeFmt.format(s.updatedAt);
      $("inv-meta").textContent = "Fuente: " + s.source + " · " + s.count + " prendas" +
        (s.live ? " · se actualiza sola cada " + cfg.inventory.pollSeconds + " s." : ".");
    } else {
      $("sync-text").textContent = "Sin inventario";
      $("inv-meta").textContent = "Sin datos todavía.";
    }
  });

  $("btn-refresh").addEventListener("click", () => Inventory.syncNow());
  $("btn-connect").addEventListener("click", async () => {
    try { await Inventory.connectLocalFile(); }
    catch (e) { if (e.name !== "AbortError") show($("inv-notice"), e.message, true); }
  });
  $("manual-file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { await Inventory.loadFromFile(f); } catch (err) { show($("inv-notice"), err.message, true); }
    e.target.value = "";
  });

  /* ================= ARRANQUE ================= */
  renderHistory();
  setCounting(false);
  Inventory.init();
})();
