/**
 * Backend de Cumplidos.
 * 1) Cambia API_KEY por una clave aleatoria larga y privada.
 * 2) Revisa SPREADSHEET_ID y, si quieres, FOLDER_ID.
 * 3) Despliega como aplicación web ejecutada por ti.
 */
const API_KEY = 'CAMBIAR_POR_UNA_CLAVE_ALEATORIA_LARGA';
const SPREADSHEET_ID = '15uBy73Y9uSIHuUV3VS1DCatpHswyjOdIbjUINkApY3Q';
const SHEET_TAB_NAME = 'Registros';
const FOLDER_ID = ''; // Vacío: guarda en la raíz de Mi unidad.
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const CACHE_TTL_SECONDS = 21600;

function doPost(e) {
  let requestId = '';
  try {
    if (!e || !e.parameter || !e.parameter.payload) throw new Error('No se recibió el reporte.');
    if (Number(e.contentLength || 0) > MAX_REQUEST_BYTES) throw new Error('El envío supera el tamaño permitido. Reduce el número o tamaño de las fotos.');
    const data = JSON.parse(e.parameter.payload);
    requestId = String(data.requestId || '');
    if (!API_KEY || API_KEY.indexOf('CAMBIAR_') === 0) throw new Error('Falta configurar la clave privada en Code.gs.');
    if (data.key !== API_KEY) throw new Error('La clave de acceso no es válida.');
    if (!requestId || requestId.length > 100) throw new Error('El identificador del envío no es válido.');
    const filename = safeFilename_(data.filename);
    const note = String(data.note || '').slice(0, 1000);
    const date = new Date(data.date || Date.now());
    const encoded = String(data.pdfBase64 || '');
    const estimatedBytes = Math.floor(encoded.length * 3 / 4);
    if (!encoded || estimatedBytes > MAX_PDF_BYTES) throw new Error('El PDF supera el máximo de 8 MB. Reduce el número o tamaño de las fotos.');

    const cache = CacheService.getScriptCache();
    const cacheKey = 'report_' + requestId;
    const previous = cache.get(cacheKey);
    let state = previous ? JSON.parse(previous) : {};
    if (!state.fileId) {
      const bytes = Utilities.base64Decode(encoded);
      if (bytes.length > MAX_PDF_BYTES) throw new Error('El PDF supera el máximo de 8 MB.');
      const blob = Utilities.newBlob(bytes, 'application/pdf', filename);
      const file = FOLDER_ID ? DriveApp.getFolderById(FOLDER_ID).createFile(blob) : DriveApp.getRootFolder().createFile(blob);
      state = { fileId: file.getId(), fileUrl: file.getUrl(), filename: file.getName(), sheetDone: false };
      cache.put(cacheKey, JSON.stringify(state), CACHE_TTL_SECONDS);
    }
    if (!state.sheetDone) {
      appendRecord_(date, state.filename, note, state.fileUrl);
      state.sheetDone = true;
      cache.put(cacheKey, JSON.stringify(state), CACHE_TTL_SECONDS);
    }
    return resultPage_({ requestId: requestId, ok: true, filename: state.filename, fileUrl: state.fileUrl });
  } catch (error) {
    return resultPage_({ requestId: requestId, ok: false, error: String(error && error.message || error).slice(0, 300) });
  }
}

function appendRecord_(date, filename, note, fileUrl) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(SHEET_TAB_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_TAB_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(['Fecha', 'Nombre del archivo', 'Novedad', 'Enlace del PDF']);
  sheet.appendRow([date, filename, note, fileUrl]);
}

function safeFilename_(value) {
  let filename = String(value || 'reporte.pdf').slice(0, 180).replace(/[\\/:*?"<>|]/g, '-').trim();
  if (!/\.pdf$/i.test(filename)) filename += '.pdf';
  return filename || 'reporte.pdf';
}

function resultPage_(result) {
  const safeJson = JSON.stringify(result).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const html = '<!doctype html><meta charset="utf-8"><script>window.parent.postMessage(' + safeJson + ', "*");</script>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
