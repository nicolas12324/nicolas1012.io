/* ==========================================================================
   ESCÁNER (ZXing)
   Método A: decodificar imágenes subidas.
   Método B: cámara en vivo con validaciones de entorno seguro.
   ========================================================================== */
window.Scanner = (function () {
  let reader = null;
  let activeStream = null;
  let running = false;

  function buildReader() {
    const Z = window.ZXing;
    if (!Z) throw new Error("No se cargó la librería de lectura (ZXing). Revise su conexión a internet.");
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
      Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8,
      Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E,
      Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39,
      Z.BarcodeFormat.ITF, Z.BarcodeFormat.CODABAR,
      Z.BarcodeFormat.QR_CODE
    ]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    return new Z.BrowserMultiFormatReader(hints, 250);
  }

  /* ---------- Validación del entorno de cámara ---------- */
  function checkCameraSupport() {
    if (!window.isSecureContext) {
      return {
        ok: false,
        message: "El navegador bloquea la cámara en páginas no seguras. Abra la aplicación desde " +
                 "http://localhost:8000 o desde una dirección https://. Abrir el archivo con doble clic (file://) " +
                 "no siempre funciona."
      };
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, message: "Este navegador no permite acceder a la cámara. Pruebe con Chrome, Edge, Firefox o Safari actualizados." };
    }
    return { ok: true };
  }

  function explainCameraError(err) {
    const name = err && err.name;
    switch (name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Permiso de cámara denegado. Haga clic en el icono de candado junto a la dirección, permita la cámara y vuelva a intentarlo.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No se encontró ninguna cámara conectada a este equipo.";
      case "NotReadableError":
      case "TrackStartError":
        return "La cámara está siendo usada por otra aplicación o pestaña. Ciérrela e intente de nuevo.";
      case "OverconstrainedError":
        return "La cámara seleccionada no admite la configuración pedida. Elija otra cámara de la lista.";
      case "AbortError":
        return "La cámara se detuvo inesperadamente. Intente de nuevo.";
      default:
        return "No se pudo iniciar la cámara" + (err && err.message ? " (" + err.message + ")" : "") + ".";
    }
  }

  /* Pide permiso una vez y devuelve la lista de cámaras (con etiquetas). */
  async function listCameras() {
    const support = checkCameraSupport();
    if (!support.ok) throw new Error(support.message);
    let tmp;
    try {
      tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (e) {
      throw new Error(explainCameraError(e));
    }
    tmp.getTracks().forEach((t) => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  }

  /* Prefiere la cámara trasera en tablets y celulares. */
  function pickDefaultCamera(cameras) {
    const rear = cameras.find((c) => /back|rear|trasera|environment/i.test(c.label));
    return (rear || cameras[0] || {}).deviceId;
  }

  /* ---------- Método B: cámara en vivo ---------- */
  async function startCamera(videoEl, deviceId, onCode) {
    const support = checkCameraSupport();
    if (!support.ok) throw new Error(support.message);
    stopCamera();
    reader = buildReader();
    running = true;
    try {
      await reader.decodeFromVideoDevice(deviceId || undefined, videoEl, (result, err) => {
        if (result && running) onCode(result.getText(), result.getBarcodeFormat && result.getBarcodeFormat());
        // los errores NotFoundException son normales mientras no hay código en cuadro
      });
      activeStream = videoEl.srcObject || null;
    } catch (e) {
      running = false;
      throw new Error(explainCameraError(e));
    }
  }

  function stopCamera() {
    running = false;
    try { if (reader) reader.reset(); } catch (e) {}
    reader = null;
    if (activeStream) { activeStream.getTracks().forEach((t) => t.stop()); activeStream = null; }
  }

  const isCameraRunning = () => running;

  /* ---------- Método A: imágenes ----------
     NO se usa decodeFromImageElement de ZXing: con ciertas fotos reintenta sin parar
     (errores de formato/checksum) y la pantalla se queda en «Procesando…».
     Aquí se decodifica a mano, con varios tamaños, giros y binarizadores, y siempre termina. */
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No se pudo abrir la imagen (¿formato no compatible?)."));
      img.src = url;
    });
  }

  function drawScaled(img, maxSide, rotate) {
    const r = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * r)), h = Math.max(1, Math.round(img.naturalHeight * r));
    const c = document.createElement("canvas");
    c.width = rotate ? h : w; c.height = rotate ? w : h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    if (rotate) { ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); }
    ctx.drawImage(img, 0, 0, w, h);
    return c;
  }

  function decodeCanvas(canvas, hintsReader) {
    const Z = window.ZXing;
    const w = canvas.width, h = canvas.height;
    const px = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const lum = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (px[j] * 299 + px[j + 1] * 587 + px[j + 2] * 114) / 1000;
    const source = new Z.RGBLuminanceSource(lum, w, h);
    for (const Binarizer of [Z.HybridBinarizer, Z.GlobalHistogramBinarizer]) {
      try { return hintsReader.decode(new Z.BinaryBitmap(new Binarizer(source))); } catch (e) { /* siguiente intento */ }
    }
    return null;
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  async function decodeImageFile(file) {
    if (!file.type.startsWith("image/")) throw new Error("«" + file.name + "» no es una imagen.");
    const Z = window.ZXing;
    if (!Z) throw new Error("No se cargó la librería de lectura (ZXing).");
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const hints = new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
        Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8,
        Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.ITF, Z.BarcodeFormat.CODABAR, Z.BarcodeFormat.QR_CODE
      ]);
      hints.set(Z.DecodeHintType.TRY_HARDER, true);
      const reader = new Z.MultiFormatReader();
      reader.setHints(hints);

      const deadline = Date.now() + 15000;           // tope de seguridad: nunca se queda colgado
      for (const side of [1600, 1000, 2400, 700]) {
        for (const rotate of [false, true]) {
          if (Date.now() > deadline) break;
          await tick();                              // deja respirar a la pantalla
          const res = decodeCanvas(drawScaled(img, side, rotate), reader);
          if (res) return { text: res.getText(), format: res.getBarcodeFormat && res.getBarcodeFormat() };
        }
      }
      // Foto con varios códigos (p. ej. una hoja impresa): se revisa por franjas
      const base = drawScaled(img, 2000, false);
      const found = new Set();
      const bh = Math.max(40, Math.round(base.height / 8)), step = Math.max(20, Math.round(bh / 2));
      for (let y = 0; y + 10 < base.height && Date.now() < deadline + 5000; y += step) {
        await tick();
        const band = document.createElement("canvas");
        band.width = base.width; band.height = Math.min(bh, base.height - y);
        band.getContext("2d", { willReadFrequently: true }).drawImage(base, 0, y, base.width, band.height, 0, 0, band.width, band.height);
        const res = decodeCanvas(band, reader);
        if (res) found.add(res.getText());
        if (found.size > 1) break;
      }
      if (found.size === 1) { const t = [...found][0]; return { text: t, format: null }; }
      if (found.size > 1) throw new Error("En «" + file.name + "» se ven varios códigos a la vez. Tome la foto de un solo código.");
      throw new Error("No se detectó un código de barras en «" + file.name + "». Pruebe con una foto más nítida, bien iluminada y con el código recto y completo.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return { checkCameraSupport, listCameras, pickDefaultCamera, startCamera, stopCamera, isCameraRunning, decodeImageFile };
})();
