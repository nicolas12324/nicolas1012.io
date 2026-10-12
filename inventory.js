/* ==========================================================================
   INVENTARIO
   - Lee un .xlsx / .csv con SheetJS.
   - Tres formas de conectarlo (todas se recargan solas al detectar cambios):
       1. URL / archivo junto a la página  (por defecto, config.inventory.url)
       2. Archivo local del computador      (File System Access API: Chrome / Edge)
       3. Carga manual                      (cualquier navegador, sin recarga automática)

   PARA CAMBIAR LA FUENTE DE DATOS (p. ej. una API o base de datos):
   reemplace solo la función `fetchRemote()` / `parseBuffer()`; el resto de la
   aplicación solo usa `Inventory.find(codigo)` y `Inventory.all()`.
   ========================================================================== */
window.Inventory = (function () {
  const cfg = APP_CONFIG;
  let items = [];                 // lista completa
  let index = new Map();          // código normalizado -> prenda
  let signature = null;           // huella del último archivo leído
  let timer = null;
  let fileHandle = null;          // archivo local conectado (si aplica)
  const listeners = { change: [], error: [], status: [], pending: [] };
  const OV_KEY = "tienda.cambios";
  let overrides = loadOverrides();   // cambios hechos en la zona de cuadre (se guardan en este navegador)
  const state = { source: "Sin conectar", updatedAt: null, count: 0, live: false };

  /* ---------- utilidades ---------- */
  const norm = (s) =>
    String(s == null ? "" : s)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]/g, "");

  const codeKey = (c) => String(c == null ? "" : c).trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const stripZeros = (k) => k.replace(/^0+/, "");

  function toNumber(v) {
    if (typeof v === "number") return v;
    // admite "89.900", "89,900", "$ 89.900,50"
    let s = String(v == null ? "" : v).replace(/[^\d.,-]/g, "");
    if (!s) return 0;
    const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
    if (lastDot > -1 && lastComma > -1) {
      s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    } else if (lastComma > -1) {
      s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
    } else if (lastDot > -1 && /\.\d{3}$/.test(s)) {
      s = s.replace(/\./g, "");
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  function fingerprint(buf) {
    const u8 = new Uint8Array(buf);
    let h = 2166136261;
    for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619); }
    return u8.length + ":" + (h >>> 0);
  }

  const emit = (evt, payload) => listeners[evt].forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
  function on(evt, fn) { listeners[evt].push(fn); }

  function setStatus(patch) { Object.assign(state, patch); emit("status", { ...state }); }

  function loadOverrides() {
    try { return JSON.parse(localStorage.getItem(OV_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveOverrides() {
    try { localStorage.setItem(OV_KEY, JSON.stringify(overrides)); } catch (e) {}
    emit("pending", Object.keys(overrides).length);
  }

  /* ---------- parseo del Excel ---------- */
  function parseBuffer(buf) {
    if (!window.XLSX) throw new Error("No se cargó la librería SheetJS (¿hay conexión a internet?).");
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames.includes(cfg.inventory.sheetName) ? cfg.inventory.sheetName : wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", raw: true });
    if (!rows.length) throw new Error("La hoja «" + sheetName + "» está vacía.");

    // mapear encabezados reales -> campos
    const headers = Object.keys(rows[0]);
    const map = {};
    for (const field of Object.keys(cfg.columns)) {
      const aliases = cfg.columns[field].map(norm);
      map[field] = headers.find((h) => aliases.includes(norm(h)));
    }
    if (!map.barcode) {
      throw new Error("No encuentro la columna del código de barras. Encabezados detectados: " + headers.join(", "));
    }

    const list = [];
    for (const r of rows) {
      const code = String(r[map.barcode] == null ? "" : r[map.barcode]).trim();
      if (!code) continue;
      list.push({
        barcode: code,
        name:  map.name  ? String(r[map.name]).trim()  : "",
        size:  map.size  ? String(r[map.size]).trim()  : "",
        color: map.color ? String(r[map.color]).trim() : "",
        price: map.price ? toNumber(r[map.price]) : 0,
        stock: map.stock ? toNumber(r[map.stock]) : 0
      });
    }
    return { list, sheetName };
  }

  function reindex() {
    index = new Map();
    for (const it of items) {
      const k = codeKey(it.barcode);
      index.set(k, it);
      index.set(stripZeros(k), it);   // tolera ceros iniciales perdidos por Excel
    }
  }

  function apply(list, sourceLabel) {
    items = list;
    reindex();
    // se vuelven a aplicar los cambios locales por encima de lo que diga el Excel
    for (const ov of Object.values(overrides)) {
      const { isNew, ...fields } = ov;
      const it = index.get(codeKey(fields.barcode)) || index.get(stripZeros(codeKey(fields.barcode)));
      if (it) Object.assign(it, fields);
      else items.push({ name: "", size: "", color: "", price: 0, stock: 0, ...fields });
    }
    reindex();
    setStatus({ source: sourceLabel, updatedAt: new Date(), count: items.length });
    emit("change", items);
  }

  /* ---------- API pública de consulta ---------- */
  function find(code) {
    const k = codeKey(code);
    if (!k) return null;
    return index.get(k) || index.get(stripZeros(k)) ||
      // EAN-13 leído como UPC-A (un 0 de más/menos)
      index.get("0" + k) || null;
  }
  const all = () => items.slice();
  const isComplete = (it) => !!(it && it.name && it.price > 0);

  /* ---------- edición (zona de cuadre) ---------- */
  function update(barcode, patch) {
    const it = find(barcode);
    if (!it) throw new Error("No existe el código " + barcode);
    Object.assign(it, patch);
    const k = codeKey(it.barcode);
    overrides[k] = Object.assign({ barcode: it.barcode }, overrides[k] || {}, patch);
    saveOverrides();
    return it;
  }

  function addItem(data) {
    const code = String(data.barcode || "").trim();
    if (!code) throw new Error("Escriba el código de barras.");
    if (find(code)) throw new Error("El código " + code + " ya existe.");
    const it = { barcode: code, name: data.name || "", size: data.size || "", color: data.color || "",
                 price: Number(data.price) || 0, stock: Number(data.stock) || 0 };
    items.push(it); reindex();
    overrides[codeKey(code)] = Object.assign({ isNew: true }, it);
    saveOverrides();
    emit("change", items);
    return it;
  }

  const pendingCount = () => Object.keys(overrides).length;

  async function discardChanges() {
    overrides = {};
    saveOverrides();
    signature = null;
    await syncOnce(true);
  }

  /* Descarga el inventario actual (Excel + cambios locales) como .xlsx */
  function exportXlsx(filename) {
    const rows = [["codigo_barras", "nombre", "talla", "color", "precio", "stock"]]
      .concat(items.map((it) => [String(it.barcode), it.name, it.size, it.color, it.price, it.stock]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 16 }, { wch: 34 }, { wch: 8 }, { wch: 16 }, { wch: 12 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario");
    XLSX.writeFile(wb, filename || "inventario_actualizado.xlsx");
  }

  function stockLevel(stock) {
    if (stock <= 0) return "out";
    if (stock <= cfg.inventory.lowStockThreshold) return "low";
    return "ok";
  }

  /* ---------- fuentes de datos ---------- */
  async function fetchRemote() {
    const url = cfg.inventory.url;
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo leer «" + url + "» (HTTP " + res.status + ").");
    return res.arrayBuffer();
  }

  async function syncOnce(force) {
    try {
      let buf, label;
      if (fileHandle) {
        const file = await fileHandle.getFile();
        buf = await file.arrayBuffer();
        label = file.name;
      } else {
        buf = await fetchRemote();
        label = cfg.inventory.url.split("/").pop().split("?")[0] || "inventario";
      }
      const sig = fingerprint(buf);
      if (!force && sig === signature) { setStatus({ live: true }); return false; }
      signature = sig;
      const { list } = parseBuffer(buf);
      apply(list, label);
      setStatus({ live: true });
      return true;
    } catch (e) {
      setStatus({ live: false });
      emit("error", e);
      return false;
    }
  }

  function startPolling() {
    stopPolling();
    timer = setInterval(() => syncOnce(false), Math.max(1, cfg.inventory.pollSeconds) * 1000);
  }
  function stopPolling() { if (timer) clearInterval(timer); timer = null; }

  /* Conectar un archivo Excel del computador (recarga automática al guardar). */
  async function connectLocalFile() {
    if (!window.showOpenFilePicker) {
      throw new Error("Este navegador no permite vincular archivos. Use Chrome o Edge, o la opción «Cargar archivo».");
    }
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "Excel o CSV", accept: {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx", ".xlsm"],
        "text/csv": [".csv"] } }],
      multiple: false
    });
    fileHandle = handle;
    signature = null;
    const ok = await syncOnce(true);
    startPolling();
    return ok;
  }

  /* Carga manual (sin recarga automática). */
  async function loadFromFile(file) {
    const buf = await file.arrayBuffer();
    const { list } = parseBuffer(buf);
    fileHandle = null;
    stopPolling();
    signature = fingerprint(buf);
    apply(list, file.name + " (manual)");
    setStatus({ live: false });
  }

  async function init() {
    await syncOnce(true);
    startPolling();
  }

  return {
    init, find, all, stockLevel, isComplete, on, connectLocalFile, loadFromFile,
    update, addItem, pendingCount, discardChanges, exportXlsx,
    syncNow: () => syncOnce(true), state
  };
})();
