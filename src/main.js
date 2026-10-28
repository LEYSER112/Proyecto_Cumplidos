import { jsPDF } from 'jspdf';
import { APPS_SCRIPT_KEY, APPS_SCRIPT_URL } from './config.js';
import './style.css';

const $ = (s) => document.querySelector(s);
const form = $('#report-form');
const photoInput = $('#photo-input');
const photoGrid = $('#photo-grid');
const MAX_PHOTOS = 10;
let photos = [];
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

function renderPhotos() {
  photoGrid.innerHTML = photos.map((photo, index) => `<div class="photo-thumb"><img src="${photo.url}" alt="Foto ${index + 1}" /><span class="photo-index">${String(index + 1).padStart(2, '0')}</span><button type="button" data-remove="${index}" aria-label="Quitar foto ${index + 1}">×</button></div>`).join('');
  $('#photo-count').textContent = `${photos.length} de ${MAX_PHOTOS} fotos`;
  $('#add-photos').classList.toggle('hidden', photos.length >= MAX_PHOTOS);
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
$('#add-photos').addEventListener('click', () => photoInput.click());

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
async function sendToAppsScript({ blob, filename, note, date }) {
  const { scriptUrl, scriptKey } = getBackendConfig();
  if (!scriptUrl || !scriptKey) throw new Error('Configura la URL de Apps Script y su clave en Configuración.');
  if (blob.size > 8 * 1024 * 1024) throw new Error('El PDF supera el límite de 8 MB. Reduce el número o tamaño de las fotos.');
  const requestId = crypto.randomUUID();
  const payload = JSON.stringify({ requestId, key: scriptKey, filename, note, date, pdfBase64: await blobToBase64(blob) });
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
    document.body.append(frame, form); form.submit();
  });
}

function renderHistory() {
  const records = readRecords(); $('#history-count').textContent = records.length;
  const list = $('#history-list');
  if (!records.length) { list.innerHTML = '<div class="empty-state"><span>▧</span><p>Aún no hay reportes guardados.</p><small>Cuando crees uno, aparecerá aquí.</small></div>'; return; }
  list.innerHTML = records.slice(0, 8).map((record) => `<article class="history-item"><div class="file-icon">PDF</div><div class="history-info"><strong>${escapeHtml(record.filename)}</strong><span>${prettyDate(record.date)}${record.synced ? ' · Guardado en Drive y Sheets' : ' · Descargado en este dispositivo'}</span>${record.note ? `<small>${escapeHtml(record.note)}</small>` : ''}</div>${record.link ? `<a class="open-link" href="${escapeAttr(record.link)}" target="_blank" rel="noreferrer" aria-label="Abrir PDF en Drive">↗</a>` : '<span class="local-tag">LOCAL</span>'}</article>`).join('');
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function escapeAttr(text) { return escapeHtml(text); }

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!photos.length) return toast('Agrega al menos una foto para crear el reporte.', true);
  const button = $('#save-button'); button.disabled = true; button.querySelector('span:first-child').textContent = 'Preparando PDF…';
  const rawName = $('#report-name').value; const filename = `${slug(rawName)}.pdf`; const note = $('#report-note').value.trim(); const date = new Date().toISOString();
  try {
    const pdf = buildPdf(); const blob = pdf.output('blob'); let link = '', synced = false, sendError = null;
    const configured = Boolean(getBackendConfig().scriptUrl && getBackendConfig().scriptKey);
    if (configured) {
      button.querySelector('span:first-child').textContent = 'Enviando a Drive y Sheets…';
      try { const result = await sendToAppsScript({ blob, filename, note, date }); link = result.fileUrl || ''; synced = true; }
      catch (error) { pdf.save(filename); sendError = error; console.error('No se confirmó el envío a Apps Script:', error); }
    } else { pdf.save(filename); }
    const records = readRecords(); records.unshift({ id: crypto.randomUUID(), filename, date, note, link, synced });
    try { localStorage.setItem('cumplidos-records', JSON.stringify(records.slice(0, 30))); } catch { toast('Reporte guardado, pero el historial local está lleno.', true); }
    renderHistory(); form.reset(); photos.forEach((photo) => URL.revokeObjectURL(photo.url)); photos = []; renderPhotos();
    if (sendError) toast(`${sendError.message} Descargamos el PDF. Antes de reintentar, verifica si ya aparece en Drive y Sheets.`, true);
    else toast(synced ? 'PDF guardado en Drive y registro añadido a Sheets.' : 'PDF descargado y reporte añadido al historial local.');
  } catch (error) { toast(`No se pudo guardar el reporte: ${error.message}`, true); }
  finally { button.disabled = false; button.querySelector('span:first-child').textContent = 'Crear y guardar reporte'; }
});

$('#settings-open').addEventListener('click', () => { const s = readSettings(); $('#script-url').value = s.scriptUrl || ''; $('#script-key').value = s.scriptKey || ''; $('#settings-dialog').showModal(); });
$('#save-settings').addEventListener('click', () => { saveSettingsFromDialog(); $('#settings-dialog').close(); toast('Configuración guardada en este dispositivo.'); });
$('#settings-dialog').addEventListener('close', saveSettingsFromDialog);

updateConnectStatus(); renderHistory();
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
