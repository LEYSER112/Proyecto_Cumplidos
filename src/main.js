import { jsPDF } from 'jspdf';
import { APPS_SCRIPT_KEY, APPS_SCRIPT_URL } from './config.js';
import './style.css';
import './experience.css';

const $ = (s) => document.querySelector(s);
const form = $('#report-form');
const photoInput = $('#photo-input');
const photoGrid = $('#photo-grid');
const MAX_PHOTOS = 10;
let photos = [];
let cameraPhotos = [];
let cameraStream = null;
let sending = false;
let toastTimer;

const readSettings = () => JSON.parse(localStorage.getItem('cumplidos-settings') || '{}');
const saveSettings = (settings) => localStorage.setItem('cumplidos-settings', JSON.stringify(settings));
const getBackendConfig = () => { const saved = readSettings(); return { scriptUrl: APPS_SCRIPT_URL || saved.scriptUrl || '', scriptKey: APPS_SCRIPT_KEY || saved.scriptKey || '' }; };
const readRecords = () => JSON.parse(localStorage.getItem('cumplidos-records') || '[]');
const slug = (value) => value.trim().replace(/\s+/g, '_').replace(/[\\/:*?"<>|]/g, '-').replace(/_+/g, '_').replace(/^[_-]+|[_-]+$/g, '') || 'reporte';
const prettyDate = (value) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

function toast(message, error = false) {
  const node = $('#toast'); node.textContent = message; node.classList.toggle('error', error); node.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 3500);
}

async function optimizeImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('No se pudo procesar una de las fotos.');
  return { blob, bytes: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, originalSize: file.size };
}

async function photoFromCanvas(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('No se pudo procesar la foto tomada.');
  return { blob, bytes: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, originalSize: blob.size };
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
    try { photos.push(await optimizeImage(file)); } catch (error) { toast(error.message, true); }
  }
  photoInput.value = ''; renderPhotos();
});
$('#gallery-photos').addEventListener('click', () => photoInput.click());

function stopCamera() {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null; $('#camera-video').srcObject = null;
}
function renderCameraCaptures() {
  const area = $('#camera-captures');
  area.innerHTML = cameraPhotos.map((photo, index) => `<div class="camera-capture-thumb"><img src="${photo.url}" alt="Foto capturada ${index + 1}"><button type="button" data-camera-remove="${index}" aria-label="Quitar foto ${index + 1}">×</button></div>`).join('');
  const total = photos.length + cameraPhotos.length;
  $('#camera-count').textContent = `${cameraPhotos.length} ${cameraPhotos.length === 1 ? 'foto tomada' : 'fotos tomadas'} · ${MAX_PHOTOS - total} disponibles`;
  $('#capture-photo').disabled = total >= MAX_PHOTOS;
  $('#camera-accept').disabled = cameraPhotos.length === 0;
  area.querySelectorAll('[data-camera-remove]').forEach((button) => button.addEventListener('click', () => { const [removed] = cameraPhotos.splice(Number(button.dataset.cameraRemove), 1); URL.revokeObjectURL(removed.url); renderCameraCaptures(); }));
}
async function openCamera() {
  if (photos.length >= MAX_PHOTOS) return toast(`Ya agregaste el máximo de ${MAX_PHOTOS} fotos.`, true);
  const dialog = $('#camera-dialog'); const placeholder = $('#camera-placeholder');
  cameraPhotos.forEach((photo) => URL.revokeObjectURL(photo.url)); cameraPhotos = []; renderCameraCaptures();
  placeholder.textContent = 'Solicitando acceso a la cámara…'; placeholder.classList.remove('hidden'); dialog.showModal();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite abrir la cámara desde la app.');
    cameraStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
    const video = $('#camera-video'); video.srcObject = cameraStream; await video.play(); placeholder.classList.add('hidden');
  } catch (error) {
    stopCamera(); dialog.close(); toast('No se pudo abrir la cámara. Puedes elegir varias fotos desde la galería.', true); photoInput.click();
  }
}
$('#add-photos').addEventListener('click', openCamera);
$('#capture-photo').addEventListener('click', async () => {
  const video = $('#camera-video');
  if (!video.videoWidth) return toast('La cámara aún está iniciando.', true);
  const maxSide = 1800, scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0, canvas.width, canvas.height);
  try { cameraPhotos.push(await photoFromCanvas(canvas)); renderCameraCaptures(); }
  catch (error) { toast(error.message, true); }
});
$('#camera-accept').addEventListener('click', () => {
  photos.push(...cameraPhotos); cameraPhotos = []; stopCamera(); $('#camera-dialog').close(); renderPhotos(); toast(`${photos.length} ${photos.length === 1 ? 'foto agregada' : 'fotos agregadas'} al reporte.`);
});
$('#camera-cancel').addEventListener('click', () => $('#camera-dialog').close());
$('#camera-close').addEventListener('click', () => $('#camera-dialog').close());
$('#camera-dialog').addEventListener('close', () => { stopCamera(); cameraPhotos.forEach((photo) => URL.revokeObjectURL(photo.url)); cameraPhotos = []; renderCameraCaptures(); });

function buildPdf() {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageW = 210, pageH = 297, margin = 5;
  photos.forEach((photo, index) => {
    if (index > 0) pdf.addPage();
    const scale = Math.min((pageW - margin * 2) / photo.width, (pageH - margin * 2) / photo.height);
    const width = photo.width * scale, height = photo.height * scale;
    pdf.addImage(photo.bytes, 'JPEG', (pageW - width) / 2, (pageH - height) / 2, width, height, undefined, 'FAST');
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
  if (blob.size > 8 * 1024 * 1024) throw new Error('El PDF supera el límite de 8 MB. Reduce el número o tamaño de las fotos.');
  const requestId = crypto.randomUUID();
  onStatus('Preparando el archivo para el envío…', 'Optimizando el paquete de fotos.');
  const pdfBase64 = await blobToBase64(blob);
  const payload = JSON.stringify({ requestId, key: scriptKey, filename, note, date, pdfBase64 });
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe'); const frameName = `cumplidos_${requestId.replace(/-/g, '')}`;
    frame.name = frameName; frame.title = 'Envío seguro del reporte'; frame.hidden = true;
    const form = document.createElement('form'); form.method = 'POST'; form.action = scriptUrl; form.target = frameName; form.hidden = true;
    const input = document.createElement('input'); input.type = 'hidden'; input.name = 'payload'; input.value = payload; form.append(input);
    let timeout;
    const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', onMessage); form.remove(); frame.remove(); };
    const onMessage = (event) => {
      if (event.data?.requestId !== requestId || event.data?.type !== 'cumplidos-result') return;
      cleanup();
      if (event.data.ok) resolve(event.data); else reject(new Error(event.data.error || 'Apps Script no pudo guardar el reporte.'));
    };
    window.addEventListener('message', onMessage);
    timeout = setTimeout(() => { cleanup(); reject(new Error('Apps Script no confirmó el envío. Revisa la conexión y el historial de Google antes de volver a intentarlo.')); }, 90000);
    onStatus('Enviando a Drive y Sheets…', 'La confirmación aparecerá al terminar. Mantén esta página abierta.');
    document.body.append(frame, form); form.submit();
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

function renderHistory() {
  const records = readRecords(); $('#history-count').textContent = records.length;
  const list = $('#history-list');
  if (!records.length) { list.innerHTML = '<div class="empty-state"><span>▧</span><p>Aún no hay reportes guardados.</p><small>Cuando crees uno, aparecerá aquí.</small></div>'; return; }
  list.innerHTML = records.slice(0, 8).map((record) => `<article class="history-item"><div class="file-icon">PDF</div><div class="history-info"><strong>${escapeHtml(record.filename)}</strong><span>${prettyDate(record.date)}${record.synced ? ' · Guardado en Drive y Sheets' : ' · Descargado en este dispositivo'}</span>${record.note ? `<small>${escapeHtml(record.note)}</small>` : ''}</div>${record.link ? `<a class="open-link" href="${escapeAttr(record.link)}" target="_blank" rel="noreferrer" aria-label="Abrir PDF en Drive">↗</a>` : '<span class="local-tag">LOCAL</span>'}</article>`).join('');
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function escapeAttr(text) { return escapeHtml(text); }

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
  try {
    showProgress('Creando el PDF…', `${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}, una por página.`);
    const pdf = buildPdf(); const blob = pdf.output('blob'); let link = '', synced = false, sendError = null;
    const configured = Boolean(getBackendConfig().scriptUrl && getBackendConfig().scriptKey);
    if (configured) {
      try { const result = await sendToAppsScript({ blob, filename, note, date, onStatus: showProgress }); link = result.fileUrl || ''; synced = true; }
      catch (error) { pdf.save(filename); sendError = error; console.error('No se confirmó el envío a Apps Script:', error); }
    } else { showProgress('Descargando el reporte…', 'Configura Apps Script para guardar automáticamente en Drive y Sheets.'); pdf.save(filename); }
    const records = readRecords(); records.unshift({ id: crypto.randomUUID(), filename, date, note, link, synced });
    try { localStorage.setItem('cumplidos-records', JSON.stringify(records.slice(0, 30))); } catch { toast('Reporte guardado, pero el historial local está lleno.', true); }
    renderHistory(); form.reset(); photos.forEach((photo) => URL.revokeObjectURL(photo.url)); photos = []; renderPhotos();
    const panel = $('#progress-panel'); panel.classList.add('done');
    if (sendError) { $('#progress-message').textContent = 'No llegó la confirmación'; $('#progress-detail').textContent = 'Se descargó el PDF. Verifica Drive y Sheets antes de intentar de nuevo.'; toast(`${sendError.message} Descargamos el PDF. Verifica Drive y Sheets antes de reintentar.`, true); }
    else { $('#progress-message').textContent = synced ? 'Reporte guardado correctamente' : 'PDF descargado'; $('#progress-detail').textContent = synced ? 'El PDF está en Drive y el registro quedó en Sheets.' : 'El registro quedó en el historial de este dispositivo.'; toast(synced ? 'PDF guardado en Drive y registro añadido a Sheets.' : 'PDF descargado y reporte añadido al historial local.'); }
    setTimeout(() => { panel.hidden = true; }, 5000);
  } catch (error) { $('#progress-panel').hidden = true; toast(`No se pudo guardar el reporte: ${error.message}`, true); }
  finally { sending = false; button.disabled = false; button.querySelector('span:first-child').textContent = 'Crear y guardar reporte'; }
}

$('#settings-open').addEventListener('click', () => { const s = readSettings(); $('#script-url').value = s.scriptUrl || ''; $('#script-key').value = s.scriptKey || ''; $('#settings-dialog').showModal(); });
$('#save-settings').addEventListener('click', () => { saveSettingsFromDialog(); $('#settings-dialog').close(); toast('Configuración guardada en este dispositivo.'); });
$('#settings-dialog').addEventListener('close', saveSettingsFromDialog);

updateConnectStatus(); renderHistory();
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
