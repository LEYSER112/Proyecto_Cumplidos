# Cumplidos

Aplicación web instalable (PWA) para documentar pedidos entregados con fotos, una novedad y un PDF. Está preparada para publicarse en GitHub Pages.

## Qué incluye

- Interfaz móvil con acceso a cámara y galería; hasta 10 imágenes por reporte.
- Optimización local de fotos: máximo 1800 px por lado y JPEG calidad 82 %, antes de insertarlas en un PDF A4 comprimido. Se aceptan imágenes compatibles con el navegador; HEIC depende del dispositivo.
- PDF sencillo: una foto por página, sin títulos, comentarios, fecha ni numeración impresos.
- Nombre de archivo normalizado: espacios a `_` y caracteres inválidos a `-`.
- Descarga del PDF y un historial reciente local, incluso sin conexión a Google.
- Backend opcional de Google Apps Script para guardar en Drive y registrar en una hoja de cálculo.
- PWA con caché básica para abrir el sitio publicado cuando se pierde la conexión. La creación de PDF y los envíos a Google requieren conexión y una sesión activa.
