import { jsPDF } from 'jspdf';
import { APPS_SCRIPT_KEY, APPS_SCRIPT_URL } from './config.js';
import './style.css';
import './experience.css';

const $ = (s) => document.querySelector(s);
const form = $('#report-form');
const photoInput = $('#photo-input');
const photoGrid = $('#photo-grid');
const MAX_PHOTOS = 10;

// ── Calidad de imagen ───────────────────────────────────────────────
// Cada foto se guarda primero en una versión "maestra" de alta calidad.
// Al crear el PDF se elige el nivel de compresión más alto posible que
// cumpla el presupuesto de peso: con pocas fotos van casi sin pérdida,
// con muchas se comprimen un poco más para no pasar del límite.
const MASTER_MAX_SIDE = 2560;            // ≈ 220 ppp en una hoja A4: se puede hacer zoom y leer
const MASTER_QUALITY = 0.86;
const PDF_LIMIT_BYTES = 8 * 1024 * 1024; // límite del Apps Script
const PDF_TARGET_BYTES = 6.5 * 1024 * 1024;
const PER_PHOTO_TARGET_BYTES = 750 * 1024; // con pocas fotos, el PDF tampoco se infla
const QUALITY_LADDER = [
  { side: 2560, quality: 0.86 },
  { side: 2560, quality: 0.8 },
  { side: 2240, quality: 0.8 },
  { side: 2048, quality: 0.76 },
  { side: 1800, quality: 0.72 },
  { side: 1600, quality: 0.68 },
];

let photos = [];
let cameraPhotos = [];
let cameraStream = null;
let imageCapture = null;
let torchMode = null; // 'torch' (luz continua) | 'flash' (destello al disparar) | null
let torchOn = false;
let capturing = false;
let sending = false;
let toastTimer;

const readSettings = () => { try { return JSON.parse(localStorage.getItem('cumplidos-settings') || '{}'); } catch { return {}; } };
const saveSettings = (settings) => { try { localStorage.setItem('cumplidos-settings', JSON.stringify(settings)); } catch {} };
const getBackendConfig = () => { const saved = readSettings(); return { scriptUrl: APPS_SCRIPT_URL || saved.scriptUrl || '', scriptKey: APPS_SCRIPT_KEY || saved.scriptKey || '' }; };
const slug = (value) => value.trim().replace(/\s+/g, '_').replace(/[\\/:*?"<>|]/g, '-').replace(/_+/g, '_').replace(/^[_-]+|[_-]+$/g, '') || 'reporte';
const formatMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
try { localStorage.removeItem('cumplidos-records'); } catch {} // el historial local ya no se usa

function toast(message, error = false) {
  const node = $('#toast'); node.textContent = message; node.classList.toggle('error', error); node.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 3500);
}

// ── Procesamiento de imágenes ──────────────────────────────────────
// Reduce en pasos de 50 % con suavizado alto. Un solo salto (p. ej. 4000 → 1800 px)
// produce bordes dentados y texto borroso; por pasos conserva la nitidez.
function drawScaled(source, srcW, srcH, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const targetW = Math.round(srcW * scale), targetH = Math.round(srcH * scale);
  let current = source, curW = srcW, curH = srcH;
  while (curW / 2 >= targetW && curH / 2 >= targetH) {
    const step = document.createElement('canvas'); step.width = Math.round(curW / 2); step.height = Math.round(curH / 2);
    const sctx = step.getContext('2d'); sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(current, 0, 0, step.width, step.height);
    current = step; curW = step.width; curH = step.height;
  }
  const canvas = document.createElement('canvas'); canvas.width = targetW; canvas.height = targetH;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, targetW, targetH);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, targetW, targetH);
  return canvas;
}

const canvasToJpeg = (canvas, quality) => new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo procesar una de las fotos.'))), 'image/jpeg', quality));

async function makeMaster(source, width, height) {
  const canvas = drawScaled(source, width, height, MASTER_MAX_SIDE);
  const blob = await canvasToJpeg(canvas, MASTER_QUALITY);
  return { master: blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
}

async function photoFromBlob(blob) {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try { return await makeMaster(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close?.(); }
}

async function encodeForPdf(photo, { side, quality }) {
  const bitmap = await createImageBitmap(photo.master);
  try {
    const canvas = drawScaled(bitmap, bitmap.width, bitmap.height, side);
    const blob = await canvasToJpeg(canvas, quality);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
  } finally { bitmap.close?.(); }
}

// Las fotos ya están listas en alta calidad desde que se toman. Solo si el PDF
// supera el presupuesto se recomprimen las más pesadas, paso a paso.
async function preparePdfImages(onStep = () => {}) {
  const budget = Math.min(PDF_TARGET_BYTES, PER_PHOTO_TARGET_BYTES * photos.length);
  const share = budget / photos.length;
  const images = await Promise.all(photos.map(async (photo) => ({ bytes: new Uint8Array(await photo.master.arrayBuffer()), width: photo.width, height: photo.height })));
  const total = () => images.reduce((sum, image) => sum + image.bytes.length, 0);
  for (let level = 1; level < QUALITY_LADDER.length && total() > budget; level += 1) {
    onStep(level);
    for (let i = 0; i < photos.length && total() > budget; i += 1) {
      if (images[i].bytes.length > share) images[i] = await encodeForPdf(photos[i], QUALITY_LADDER[level]);
    }
  }
  return images;
}

function renderPhotos() {
  photoGrid.innerHTML = photos.map((photo, index) => `<div class="photo-thumb"><img src="${photo.url}" alt="Foto ${index + 1}" /><span class="photo-index">${String(index + 1).padStart(2, '0')}</span><button type="button" data-remove="${index}" aria-label="Quitar foto ${index + 1}">×</button></div>`).join('');
  $('#photo-count').textContent = `${photos.length} de ${MAX_PHOTOS} fotos`;
  $('.photo-actions').classList.toggle('hidden', photos.length >= MAX_PHOTOS);
  photoGrid.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => { const [removed] = photos.splice(Number(button.dataset.remove), 1); URL.revokeObjectURL(removed.url); renderPhotos(); }));
}

photoInput.addEventListener('change', async () => {
  const picked = [...photoInput.files].slice(0, MAX_PHOTOS - photos.length);
  if (picked.length < photoInput.files.length) toast(`Puedes agregar hasta ${MAX_PHOTOS} fotos.`, true);
  for (const file of picked) {
    if (!file.type.startsWith('image/')) continue;
    try { photos.push(await photoFromBlob(file)); } catch { toast('No se pudo leer una de las fotos. Prueba con otra imagen.', true); }
  }
  photoInput.value = ''; renderPhotos();
});
$('#gallery-photos').addEventListener('click', () => photoInput.click());

// ── Cámara ─────────────────────────────────────────────────────────
function stopCamera() {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null; imageCapture = null; torchMode = null; torchOn = false;
  $('#camera-video').srcObject = null; renderTorch();
}
function renderCameraCaptures() {
  const area = $('#camera-captures');
  area.innerHTML = cameraPhotos.map((photo, index) => `<div class="camera-capture-thumb"><img src="${photo.url}" alt="Foto capturada ${index + 1}"><button type="button" data-camera-remove="${index}" aria-label="Quitar foto ${index + 1}">×</button></div>`).join('');
  area.classList.toggle('empty', cameraPhotos.length === 0);
  const total = photos.length + cameraPhotos.length;
  $('#camera-count').textContent = `${cameraPhotos.length} ${cameraPhotos.length === 1 ? 'tomada' : 'tomadas'} · ${MAX_PHOTOS - total} libres`;
  $('#capture-photo').disabled = total >= MAX_PHOTOS || capturing;
  $('#camera-accept').disabled = cameraPhotos.length === 0;
  $('#camera-accept').textContent = cameraPhotos.length ? `Agregar ${cameraPhotos.length} ${cameraPhotos.length === 1 ? 'foto' : 'fotos'}` : 'Agregar fotos';
  area.querySelectorAll('[data-camera-remove]').forEach((button) => button.addEventListener('click', () => { const [removed] = cameraPhotos.splice(Number(button.dataset.cameraRemove), 1); URL.revokeObjectURL(removed.url); renderCameraCaptures(); }));
  area.scrollLeft = area.scrollWidth;
}

function renderTorch() {
  const button = $('#torch-toggle');
  button.disabled = !torchMode;
  button.classList.toggle('on', torchOn);
  button.setAttribute('aria-pressed', String(torchOn));
  button.title = torchMode ? (torchOn ? 'Apagar flash' : 'Encender flash') : 'Flash no disponible en este dispositivo o navegador';
  button.querySelector('.torch-label').textContent = torchMode ? (torchOn ? 'Flash sí' : 'Flash no') : 'Sin flash';
}

async function detectCameraFeatures(track) {
  const caps = track.getCapabilities?.() || {};
  // Enfoque continuo cuando el dispositivo lo permite: fotos más nítidas.
  if (caps.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  if ('ImageCapture' in window) { try { imageCapture = new ImageCapture(track); } catch { imageCapture = null; } }
  if (caps.torch) torchMode = 'torch';
  else if (imageCapture) {
    try { const photoCaps = await imageCapture.getPhotoCapabilities(); if (photoCaps.fillLightMode?.includes('flash')) torchMode = 'flash'; } catch {}
  }
  renderTorch();
}

async function setTorch(on) {
  const track = cameraStream?.getVideoTracks()[0];
  if (!track || !torchMode) return;
  if (torchMode === 'torch') {
    try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch { toast('No se pudo cambiar el flash.', true); return; }
  }
  torchOn = on; renderTorch();
}
$('#torch-toggle').addEventListener('click', () => setTorch(!torchOn));

async function openCamera() {
  if (photos.length >= MAX_PHOTOS) return toast(`Ya agregaste el máximo de ${MAX_PHOTOS} fotos.`, true);
  const dialog = $('#camera-dialog'); const placeholder = $('#camera-placeholder');
  cameraPhotos.forEach((photo) => URL.revokeObjectURL(photo.url)); cameraPhotos = []; renderCameraCaptures(); renderTorch();
  placeholder.textContent = 'Solicitando acceso a la cámara…'; placeholder.classList.remove('hidden'); dialog.showModal();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite abrir la cámara desde la app.');
    // Se pide la mayor resolución posible; el navegador entrega la más cercana que soporte la cámara.
    cameraStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } } });
    const video = $('#camera-video'); video.srcObject = cameraStream; await video.play(); placeholder.classList.add('hidden');
    await detectCameraFeatures(cameraStream.getVideoTracks()[0]);
  } catch {
    stopCamera(); dialog.close(); toast('No se pudo abrir la cámara. Puedes elegir varias fotos desde la galería.', true); photoInput.click();
  }
}
$('#add-photos').addEventListener('click', openCamera);

// Foto fija con ImageCapture (Android/Chrome): usa el sensor completo, con su
// procesamiento de nitidez y ruido. Si no existe o falla, se toma el cuadro del video.
async function captureStill(video) {
  if (imageCapture) {
    try {
      const settings = torchMode === 'flash' ? { fillLightMode: torchOn ? 'flash' : 'off' } : {};
      const blob = await imageCapture.takePhoto(settings);
      const photo = await photoFromBlob(blob);
      // Algunos equipos devuelven la foto girada: si no coincide con lo que se ve, se usa el cuadro del video.
      const videoPortrait = video.videoHeight > video.videoWidth, photoPortrait = photo.height > photo.width;
      if (videoPortrait === photoPortrait || video.videoWidth === video.videoHeight) return photo;
      URL.revokeObjectURL(photo.url);
    } catch { /* se usa el cuadro del video */ }
    finally { if (torchMode === 'torch' && torchOn) setTorch(true); } // algunos equipos apagan la luz al disparar
  }
  return makeMaster(video, video.videoWidth, video.videoHeight);
}

$('#capture-photo').addEventListener('click', async () => {
  const video = $('#camera-video');
  if (!video.videoWidth) return toast('La cámara aún está iniciando.', true);
  if (capturing || photos.length + cameraPhotos.length >= MAX_PHOTOS) return;
  capturing = true; renderCameraCaptures();
  const fx = $('#camera-flash-fx'); fx.classList.remove('go'); void fx.offsetWidth; fx.classList.add('go');
  try { cameraPhotos.push(await captureStill(video)); }
  catch (error) { toast(error.message || 'No se pudo tomar la foto.', true); }
  finally { capturing = false; renderCameraCaptures(); }
});
$('#camera-accept').addEventListener('click', () => {
  const added = cameraPhotos.length;
  photos.push(...cameraPhotos); cameraPhotos = []; $('#camera-dialog').close(); renderPhotos();
  toast(`${added} ${added === 1 ? 'foto agregada' : 'fotos agregadas'} al reporte.`);
});
$('#camera-cancel').addEventListener('click', () => $('#camera-dialog').close());
$('#camera-close').addEventListener('click', () => $('#camera-dialog').close());
$('#camera-dialog').addEventListener('close', () => { stopCamera(); cameraPhotos.forEach((photo) => URL.revokeObjectURL(photo.url)); cameraPhotos = []; renderCameraCaptures(); });

// ── PDF ────────────────────────────────────────────────────────────
// Una foto por página. La hoja se gira según la foto, para que las horizontales
// ocupen toda la página en lugar de quedar pequeñas en una hoja vertical.
function buildPdf(images) {
  const orientationOf = (image) => (image.width > image.height ? 'landscape' : 'portrait');
  const pdf = new jsPDF({ orientation: orientationOf(images[0]), unit: 'mm', format: 'a4', compress: true });
  const margin = 5;
  images.forEach((image, index) => {
    if (index > 0) pdf.addPage('a4', orientationOf(image));
    const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
    const scale = Math.min((pageW - margin * 2) / image.width, (pageH - margin * 2) / image.height);
    const width = image.width * scale, height = image.height * scale;
    // La foto JPEG se inserta tal cual, sin volver a comprimirla.
    pdf.addImage(image.bytes, 'JPEG', (pageW - width) / 2, (pageH - height) / 2, width, height, `foto${index}`, 'NONE');
  });
  return pdf;
}

function updateConnectStatus() {
  const config = getBackendConfig(); const configured = Boolean(config.scriptUrl && config.scriptKey);
  const node = $('#connect-status'); node.classList.toggle('connected', configured); node.querySelector('span:last-child').textContent = configured ? 'Apps Script configurado' : 'Apps Script sin configurar';
  $('#settings-open').classList.toggle('hidden', Boolean(APPS_SCRIPT_URL && APPS_SCRIPT_KEY));
}
function saveSettingsFromDialog() {
  const scriptUrl = $('#script-url').value.trim();
  const scriptKey = $('#script-key').value.trim();
  saveSettings({ ...readSettings(), scriptUrl, scriptKey }); updateConnectStatus();
}
function blobToBase64(blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer); let binary = '';
    for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
    return btoa(binary);
  });
}
async function sendToAppsScript({ blob, filename, note, date, onStatus = () => {} }) {
  const { scriptUrl, scriptKey } = getBackendConfig();
  if (!scriptUrl || !scriptKey) throw new Error('Configura la URL de Apps Script y su clave en Configuración.');
  if (blob.size > PDF_LIMIT_BYTES) throw new Error('El PDF supera el límite de 8 MB. Reduce el número de fotos.');
  const requestId = crypto.randomUUID();
  onStatus('Preparando el archivo para el envío…', `PDF de ${formatMB(blob.size)}.`);
  const pdfBase64 = await blobToBase64(blob);
  const payload = JSON.stringify({ requestId, key: scriptKey, filename, note, date, pdfBase64 });
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe'); const frameName = `cumplidos_${requestId.replace(/-/g, '')}`;
    frame.name = frameName; frame.title = 'Envío seguro del reporte'; frame.hidden = true;
    const postForm = document.createElement('form'); postForm.method = 'POST'; postForm.action = scriptUrl; postForm.target = frameName; postForm.hidden = true;
    const input = document.createElement('input'); input.type = 'hidden'; input.name = 'payload'; input.value = payload; postForm.append(input);
    let timeout;
    const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', onMessage); postForm.remove(); frame.remove(); };
    const onMessage = (event) => {
      if (event.data?.requestId !== requestId || event.data?.type !== 'cumplidos-result') return;
      cleanup();
      if (event.data.ok) resolve(event.data); else reject(new Error(event.data.error || 'Apps Script no pudo guardar el reporte.'));
    };
    window.addEventListener('message', onMessage);
    timeout = setTimeout(() => { cleanup(); reject(new Error('Apps Script no confirmó el envío. Revisa la conexión y el historial de Google antes de volver a intentarlo.')); }, 90000);
    onStatus('Enviando a Drive y Sheets…', `PDF de ${formatMB(blob.size)}. Mantén esta página abierta.`);
    document.body.append(frame, postForm); postForm.submit();
  });
}

function showProgress(message, detail) {
  const panel = $('#progress-panel'); panel.hidden = false; panel.classList.remove('done');
  $('#progress-message').textContent = message; $('#progress-detail').textContent = detail;
}
function showConfirmation() {
  const name = $('#report-name').value.trim(); const note = $('#report-note').value.trim();
  $('#confirm-name').textContent = `${slug(name)}.pdf`;
  $('#confirm-summary').textContent = `${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'} · Se incluirá una foto por página.`;
  $('#confirm-note').textContent = note ? `Novedad: ${note}` : 'Sin novedad escrita.';
  const preview = $('#confirm-photos'); preview.replaceChildren(...photos.map((photo, index) => { const img = document.createElement('img'); img.className = 'confirm-photo'; img.src = photo.url; img.alt = `Vista previa de foto ${index + 1}`; return img; }));
  $('#confirm-dialog').showModal();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!photos.length) return toast('Agrega al menos una foto para crear el reporte.', true);
  if (!sending) showConfirmation();
});

$('#confirm-close').addEventListener('click', () => $('#confirm-dialog').close());
$('#confirm-back').addEventListener('click', () => $('#confirm-dialog').close());
$('#confirm-send').addEventListener('click', () => { $('#confirm-dialog').close(); sendReport(); });

async function sendReport() {
  if (sending) return;
  sending = true;
  const button = $('#save-button'); button.disabled = true; button.querySelector('span:first-child').textContent = 'Enviando reporte…';
  const rawName = $('#report-name').value; const filename = `${slug(rawName)}.pdf`; const note = $('#report-note').value.trim(); const date = new Date().toISOString();
  const countLabel = `${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}`;
  try {
    showProgress('Preparando las fotos…', `${countLabel} en alta calidad.`);
    const images = await preparePdfImages(() => showProgress('Ajustando el peso del PDF…', 'Comprimiendo un poco las fotos más pesadas sin perder nitidez.'));
    showProgress('Creando el PDF…', `${countLabel}, una por página.`);
    const pdf = buildPdf(images); const blob = pdf.output('blob'); let synced = false, sendError = null;
    const configured = Boolean(getBackendConfig().scriptUrl && getBackendConfig().scriptKey);
    if (configured) {
      try { await sendToAppsScript({ blob, filename, note, date, onStatus: showProgress }); synced = true; }
      catch (error) { pdf.save(filename); sendError = error; console.error('No se confirmó el envío a Apps Script:', error); }
    } else { showProgress('Descargando el reporte…', 'Configura Apps Script para guardar automáticamente en Drive y Sheets.'); pdf.save(filename); }
    form.reset(); photos.forEach((photo) => URL.revokeObjectURL(photo.url)); photos = []; renderPhotos();
    const panel = $('#progress-panel'); panel.classList.add('done');
    if (sendError) { $('#progress-message').textContent = 'No llegó la confirmación'; $('#progress-detail').textContent = 'Se descargó el PDF. Verifica Drive y Sheets antes de intentar de nuevo.'; toast(`${sendError.message} Descargamos el PDF. Verifica Drive y Sheets antes de reintentar.`, true); }
    else { $('#progress-message').textContent = synced ? 'Reporte guardado correctamente' : 'PDF descargado'; $('#progress-detail').textContent = synced ? `El PDF (${formatMB(blob.size)}) está en Drive y el registro quedó en Sheets.` : `PDF de ${formatMB(blob.size)} descargado en este dispositivo.`; toast(synced ? 'PDF guardado en Drive y registro añadido a Sheets.' : 'PDF descargado en este dispositivo.'); }
    setTimeout(() => { panel.hidden = true; }, 5000);
  } catch (error) { $('#progress-panel').hidden = true; toast(`No se pudo guardar el reporte: ${error.message}`, true); }
  finally { sending = false; button.disabled = false; button.querySelector('span:first-child').textContent = 'Crear y guardar reporte'; }
}

$('#settings-open').addEventListener('click', () => { const s = readSettings(); $('#script-url').value = s.scriptUrl || ''; $('#script-key').value = s.scriptKey || ''; $('#settings-dialog').showModal(); });
$('#save-settings').addEventListener('click', () => { saveSettingsFromDialog(); $('#settings-dialog').close(); toast('Configuración guardada en este dispositivo.'); });
$('#settings-dialog').addEventListener('close', saveSettingsFromDialog);

// ── Instalar la app ────────────────────────────────────────────────
let installPrompt = null;
let installed = false;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function renderInstall() {
  const card = $('#install-card'), button = $('#install-button'), pill = $('#install-top'), text = $('#install-text'), steps = $('#install-steps');
  if (isStandalone()) { card.classList.add('hidden'); pill.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  if (installed) {
    card.classList.add('installed'); button.classList.add('hidden'); pill.classList.add('hidden'); steps.classList.add('hidden');
    text.textContent = 'Listo. Ya puedes abrir Cumplidos desde la pantalla de inicio de tu celular.';
    return;
  }
  pill.classList.toggle('hidden', !installPrompt);
  button.textContent = installPrompt ? 'Instalar app' : 'Ver cómo instalar';
}

function showInstallSteps() {
  const steps = $('#install-steps');
  const items = isIOS()
    ? ['Abre esta página en <strong>Safari</strong>.', 'Toca el botón <strong>Compartir</strong> <span class="kbd">⬆︎</span> en la barra inferior.', 'Elige <strong>Agregar a inicio</strong> y luego <strong>Agregar</strong>.']
    : ['Abre esta página en <strong>Chrome</strong> o <strong>Edge</strong>.', 'Toca el menú <span class="kbd">⋮</span> del navegador.', 'Elige <strong>Instalar app</strong> o <strong>Agregar a la pantalla principal</strong>.'];
  steps.innerHTML = items.map((item) => `<li>${item}</li>`).join('');
  steps.classList.toggle('hidden');
}

async function installApp() {
  if (!installPrompt) { showInstallSteps(); document.getElementById('install-card').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  const promptEvent = installPrompt; installPrompt = null;
  promptEvent.prompt();
  const { outcome } = await promptEvent.userChoice.catch(() => ({ outcome: 'dismissed' }));
  if (outcome === 'accepted') installed = true;
  renderInstall();
}

window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event; renderInstall(); });
window.addEventListener('appinstalled', () => { installed = true; installPrompt = null; renderInstall(); toast('Cumplidos quedó instalada en tu dispositivo.'); });
$('#install-button').addEventListener('click', installApp);
$('#install-top').addEventListener('click', installApp);

updateConnectStatus(); renderInstall(); renderTorch();
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
