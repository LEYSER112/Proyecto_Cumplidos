# Cumplidos

Aplicación web instalable (PWA) para documentar pedidos entregados con fotos, una novedad y un PDF. Está preparada para publicarse en GitHub Pages.

## Qué incluye

- Interfaz móvil con acceso a cámara (pantalla completa, con botón de flash cuando el equipo lo permite) y galería; hasta 10 imágenes por reporte.
- Optimización local de fotos: máximo 2560 px por lado (≈ 220 ppp en A4) y JPEG calidad 86 %, reescaladas por pasos para conservar la nitidez del texto. Si el PDF supera el presupuesto (≈ 750 KB por foto, 6,5 MB en total) se recomprimen solo las fotos más pesadas. En Android/Chrome la cámara usa la foto fija del sensor (ImageCapture) en lugar de un cuadro del video. Se aceptan imágenes compatibles con el navegador; HEIC depende del dispositivo.
- PDF sencillo: una foto por página (la hoja se gira según la foto), sin títulos, comentarios, fecha ni numeración impresos.
- Nombre de archivo normalizado: espacios a `_` y caracteres inválidos a `-`.
- Descarga del PDF si no hay conexión con Google.
- Opción para instalar la app: botón nativo en Android/Chrome/Edge e instrucciones paso a paso en iPhone.
- Backend opcional de Google Apps Script para guardar en Drive y registrar en una hoja de cálculo.
- PWA con caché básica para abrir el sitio publicado cuando se pierde la conexión. La creación de PDF y los envíos a Google requieren conexión y una sesión activa.
