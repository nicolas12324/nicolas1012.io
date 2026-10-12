/* ==========================================================================
   CONFIGURACIÓN CENTRAL
   Todo lo que probablemente quiera cambiar está en este archivo.
   ========================================================================== */
window.APP_CONFIG = {
  storeName: "Vis-Eco",
  tagline: "Grado 1101 · viste con economía",

  /* ---- Zona de cuadre --------------------------------------------------
     La página se abre sin contraseña (escanear e inventario son libres).
     Estas credenciales solo desbloquean la pestaña «Cuadre», donde se
     editan precios y stock y se compara el conteo físico.
     OJO: la validación ocurre en el navegador; sirve para evitar toques
     accidentales, no es seguridad real.                                   */
  users: [
    { user: "MACA", pass: "100629" }
  ],

  /* ---- Fuente del inventario ------------------------------------------
     url: archivo .xlsx / .csv junto a la página, o un enlace de Google Sheets
          publicado como CSV.
     pollSeconds: cada cuántos segundos se revisa si el archivo cambió.   */
  inventory: {
    url: "data/inventario.xlsx",
    pollSeconds: 5,
    sheetName: "Inventario",
    lowStockThreshold: 3
  },

  /* ---- Columnas del Excel (se aceptan estos nombres de encabezado) ---- */
  columns: {
    barcode: ["codigo_barras", "codigo de barras", "codigo", "barcode", "ean", "sku"],
    name:    ["nombre", "prenda", "descripcion", "producto", "articulo"],
    size:    ["talla", "talle", "size"],
    color:   ["color", "colour"],
    price:   ["precio", "valor", "price", "pvp"],
    stock:   ["stock", "existencias", "cantidad", "inventario", "unidades"]
  },

  currency: { locale: "es-CO", code: "COP", decimals: 0 },

  scanner: {
    repeatDelayMs: 2000,   // un código en cuadro solo cuenta una vez; para volver a contarlo debe salir de cuadro este tiempo (ms)
    maxHistory: 20,
    beep: true
  }
};
