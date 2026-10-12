# Vis-Eco · Escáner de inventario (Grado 1101)

HTML + CSS + JavaScript, sin instalar nada. Las librerías (lectura de Excel y de códigos de barras) y
las fuentes ya vienen dentro de la carpeta, así que **funciona sin internet**.

## 1. Cómo abrirla (importante para la cámara)

Los navegadores solo permiten la cámara en `https://` o en `http://localhost`.
**No haga doble clic en `index.html`**; sírvala desde esta carpeta:

```bash
python -m http.server 8000      # en Windows también: py -m http.server 8000
```

Luego abra **http://localhost:8000** en Chrome o Edge.

## 2. Qué tiene la página

| Pestaña | Para qué sirve | ¿Pide clave? |
|---|---|---|
| **Escanear** | Cámara en vivo, subir fotos o lector USB. Muestra prenda, precio y stock. | No |
| **Inventario** | Tabla con búsqueda y filtro de stock bajo. Conectar/actualizar el Excel. | No |
| **Cuadre** | Corregir datos, agregar prendas, conteo físico y descargar el Excel actualizado. | **Sí** |

Credenciales de la pestaña Cuadre: usuario `MACA`, contraseña `100629` (se cambian en `js/config.js`).

## 3. Sus códigos

`data/inventario.xlsx` ya trae los **99 códigos** de su PDF (10001–10020, 20001–20020, 30001–30020,
40001–40020 y 50001–50020). Tienen los campos vacíos: llénelos en el Excel o desde la pestaña Cuadre.

> En el PDF **falta el 50015** (pasa de 50014 a 50016). Si existe, agréguelo (pestaña Cuadre → «Agregar una prenda nueva»).

Mientras una prenda no tenga nombre y precio, al escanearla la página dice «Código registrado, sin datos».
En `data/codigos-prueba/` hay 3 imágenes Code 39 para probar «Subir fotos».

## 4. Descuento automático al escanear

Cada vez que se escanea una prenda (cámara, foto, lector USB o código manual) se **descuenta 1 unidad** del stock
y el resultado dice cuántas quedan. Detalles:

- Si el stock ya está en 0 (o aún no se ha cargado), no se descuenta y la página lo avisa.
- El botón **«Deshacer descuento»** devuelve la unidad si se escaneó por error.
- Con la cámara, un código que sigue en cuadro cuenta una sola vez; para descontar otra unidad hay que retirarlo
  y volver a mostrarlo (o escanear la siguiente prenda).
- El interruptor «Descontar 1 unidad del stock en cada escaneo» (pestaña Escanear) permite apagarlo para solo consultar.
- Con el conteo físico activo (pestaña Cuadre) no se descuenta: ese escaneo solo cuenta.
- Hacer clic en un escaneo reciente solo vuelve a mostrarlo; no descuenta.
- Los descuentos se guardan en este navegador (aparecen como cambios en Cuadre). Descargue el Excel actualizado
  para dejarlos en el archivo.

## 5. Cuadre

- **Datos de las prendas:** escriba directamente en la tabla (nombre, talla, color, precio, stock).
  El filtro «Solo los que faltan por llenar» ayuda a avanzar.
- **Conteo físico:** pulse «Iniciar conteo» y escanee en la pestaña Escanear (o escriba códigos en el cuadro del conteo).
  Cada lectura suma una unidad. La tabla muestra sistema vs. contado y la diferencia, con botón para ajustar el stock.
  Con la cámara, el mismo código no se cuenta dos veces seguidas en menos de 2,5 s.
- **Descargar Excel actualizado:** los cambios se guardan en este navegador, no dentro del archivo. Para dejarlos
  en el Excel, descargue el archivo, reemplace `data/inventario.xlsx` y pulse «Descartar cambios».

## 6. Sincronización con el Excel

1. **Archivo junto a la página (por defecto):** se relee cada 5 s; guarde el Excel con Ctrl+S y la página se actualiza.
2. **Vincular archivo Excel** (pestaña Inventario, solo Chrome/Edge): vigila un Excel de cualquier carpeta.
3. **Google Sheets:** publique la hoja como CSV y pegue el enlace en `inventory.url` de `js/config.js`.

Los cambios hechos en Cuadre se aplican por encima de lo que diga el Excel hasta que se descarten.

## 7. Estructura

```
index.html            Pantallas
css/styles.css        Estilos (basados en DESIGN.md)
img/                  Logo Vis-Eco sin fondo
fonts/                Fuentes locales
js/config.js          ★ Credenciales, archivo Excel, columnas, moneda
js/auth.js            Desbloqueo de la pestaña Cuadre
js/inventory.js       Excel, sincronización, edición y exportación
js/scanner.js         Lectura: fotos y cámara (ZXing)
js/app.js             Conecta todo con la interfaz
js/vendor/            SheetJS y ZXing
data/                 inventario.xlsx, PDF original, imágenes de prueba
```

## 8. Límites

- La página **no puede escribir dentro del Excel** por sí sola; por eso existe el botón de descargar.
  Para que varias personas compartan un inventario en vivo, use Google Sheets o un pequeño servidor.
- La clave de Cuadre se valida en el navegador: evita toques accidentales, no es seguridad real.
- En una tablet por red local la cámara necesita HTTPS; allí funciona «Subir fotos».
