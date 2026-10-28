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

## Desarrollo local

Requiere Node.js 20 o posterior.

```sh
npm install
npm run dev
```

## Publicación en GitHub Pages

1. Sube el repositorio a GitHub y confirma la rama `main`.
2. En **Settings → Pages**, elige **GitHub Actions** como fuente.
3. El workflow `.github/workflows/deploy.yml` construye y publica el sitio en cada push a `main`.
4. Si el repositorio no se llama `Proyecto_Cumplidos`, cambia `base` en `vite.config.js` por `/<nombre-del-repositorio>/` antes de publicar. Para un dominio propio usa `/`.

## Configurar Apps Script, Drive y Sheets

El backend está en `apps-script/Code.gs`. Ya apunta al ID de la hoja que compartiste y escribe en una pestaña llamada `Registros`. Si esa pestaña no existe, la crea sin modificar las demás pestañas.

1. Abre la hoja compartida, entra a **Extensiones → Apps Script** y copia el contenido de `apps-script/Code.gs` en el editor.
2. Cambia `API_KEY` por una cadena aleatoria. La app comprueba que coincida con la que se enviará desde el sitio.
3. Si quieres guardar los PDF dentro de una carpeta concreta, pega su ID en `FOLDER_ID`. Si se deja vacío, se guardan en la raíz de Mi unidad.
4. Guarda el script y selecciona **Implementar → Nueva implementación → Aplicación web**. Configura **Ejecutar como: yo** y restringe el acceso según quién deba usar la app. Para un equipo de Google Workspace, restringirlo al dominio es preferible.
5. Copia la URL terminada en `/exec`. Abre `src/config.js`, pega allí la URL y el mismo valor de `API_KEY`, y publica ese cambio en GitHub. Así los transportadores solo abren el enlace de Pages; no necesitan configurar nada en sus teléfonos.
6. Si modificas `Code.gs` después de crear el despliegue, entra a **Implementar → Gestionar implementaciones → Editar**, selecciona **Nueva versión** y pulsa **Implementar**. La URL `/exec` se conserva.

El script guarda el PDF en Drive y agrega Fecha, Nombre del archivo, Novedad y Enlace del PDF en `Registros`. El enlace respeta los permisos actuales de Drive; comparte la carpeta o el archivo desde Google si el equipo también debe abrir las evidencias.

**Nota sobre la clave:** al incluirla en una app web pública, queda visible para cualquiera que inspeccione el sitio. Sirve como barrera básica contra envíos casuales, pero no como secreto ni como autenticación fuerte. Si necesitas limitar la app a un equipo, restringe el acceso de Apps Script a la organización de Google Workspace o añade inicio de sesión/verificación de identidad antes de usarla con datos sensibles.

### Tamaño del PDF

La app limita el PDF a 8 MB antes de enviarlo. Las fotos se reducen a un máximo de 1800 px por lado y se convierten a JPEG calidad 82 %, lo que normalmente deja un reporte de pocas páginas bastante por debajo de ese límite. La cuota oficial de **50 MB por llamada** en Apps Script corresponde a `URL Fetch POST`, es decir, a solicitudes salientes que hace el script; Google no publica ese mismo número como límite universal para el cuerpo entrante de una aplicación web. Por eso el proyecto usa un tope conservador de 8 MB para el PDF (aprox. 10.7 MB tras convertirlo a Base64) y 12 MB para la petición completa.

La app envía el formulario a un iframe oculto y Apps Script devuelve la confirmación mediante `postMessage`; así el navegador no depende de leer una respuesta entre dominios. Si no llega una confirmación en 90 segundos, se descarga el PDF y se pide verificar Drive/Sheets antes de reintentar.

## Decisiones y siguientes mejoras

- Para preservar la legibilidad, las fotos se redimensionan y recomprimen antes de insertarlas. El límite de 8 MB evita enviar reportes desproporcionados; si se excede, reduce la cantidad o el tamaño de las fotos.
- El historial local sirve como referencia en ese dispositivo, pero puede borrarse al limpiar los datos del navegador. Drive/Sheets es el registro compartido persistente.
- Mejoras recomendadas para una siguiente iteración: identificador consecutivo o número de pedido, nombre/identificación de quien recibe, ubicación GPS opcional con consentimiento, estado de sincronización con reintento y búsqueda/exportación de reportes.
