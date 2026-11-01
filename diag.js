// juego — registro de lo que pasa (para encontrar bugs)
// Guarda en el celu los últimos eventos y errores (sobrevive a recargas y a que iOS mate la página).
// Para verlo: tocá 3 veces seguidas la versión (arriba a la izquierda) → "copiar" y pegarlo en el chat.
// Se carga PRIMERO: acá no se usa nada de los otros archivos.

const DIAG_MAX = 300;
let diagLog = [];
try { diagLog = JSON.parse(localStorage.getItem('diag') || '[]'); } catch (e) { diagLog = []; }
let diagTimer = null;
function diagGuardar() { clearTimeout(diagTimer); diagTimer = null; try { localStorage.setItem('diag', JSON.stringify(diagLog)); } catch (e) {} }
function diag(t) {
  const d = new Date();
  const hh = n => String(n).padStart(2, '0');
  diagLog.push(`${hh(d.getMonth() + 1)}-${hh(d.getDate())} ${hh(d.getHours())}:${hh(d.getMinutes())}:${hh(d.getSeconds())} ${t}`);
  if (diagLog.length > DIAG_MAX) diagLog.splice(0, diagLog.length - DIAG_MAX);
  if (!diagTimer) diagTimer = setTimeout(diagGuardar, 400);
}
// un mensaje que se repite (ej. un error en cada cuadro) se anota una vez cada 10 s
const diagVisto = new Map();
function diagUna(t) {
  const now = Date.now(), prev = diagVisto.get(t) || 0;
  if (now - prev < 10000) return;
  diagVisto.set(t, now); diag(t);
}

window.addEventListener('error', e => diagUna(`ERROR ${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', e => diagUna('ERROR promesa: ' + (e.reason && (e.reason.message || e.reason.name) || e.reason)));
for (const k of ['error', 'warn']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { diagUna(k + ': ' + a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 200)); orig(...a); };
}
window.addEventListener('pagehide', () => { diag('página: se cierra'); diagGuardar(); });
document.addEventListener('visibilitychange', () => { diag(document.hidden ? 'app: al fondo' : 'app: volvió'); if (document.hidden) diagGuardar(); });
diag('abrió · ' + (navigator.standalone || matchMedia('(display-mode: standalone)').matches ? 'app' : 'navegador') + ' · ' +
  (navigator.userAgent.match(/(iPhone OS [\d_]+|Android [\d.]+|Windows NT [\d.]+|Mac OS X [\d_]+|CrOS)/) || ['?'])[0] + ' · ' + innerWidth + 'x' + innerHeight);

// panel: 3 toques en la versión
let diagToques = [];
function diagAbrir() {
  const p = document.getElementById('diag');
  document.getElementById('diagTxt').value = diagLog.slice().reverse().join('\n');
  p.style.display = '';
}
document.addEventListener('DOMContentLoaded', () => {
  const ver = document.getElementById('ver');
  ver.addEventListener('pointerdown', () => {
    const now = Date.now();
    diagToques = diagToques.filter(t => now - t < 1500); diagToques.push(now);
    if (diagToques.length >= 3) { diagToques = []; diagAbrir(); }
  });
  document.getElementById('diagCopiar').addEventListener('click', async () => {
    const txt = document.getElementById('diagTxt');
    try { await navigator.clipboard.writeText(txt.value); document.getElementById('diagCopiar').textContent = 'copiado'; }
    catch (e) { txt.focus(); txt.select(); document.execCommand && document.execCommand('copy'); document.getElementById('diagCopiar').textContent = 'copiado'; }
    setTimeout(() => { document.getElementById('diagCopiar').textContent = 'copiar'; }, 1500);
  });
  document.getElementById('diagBorrar').addEventListener('click', () => { diagLog.length = 0; diagGuardar(); diagAbrir(); });
  document.getElementById('diagCerrar').addEventListener('click', () => { document.getElementById('diag').style.display = 'none'; });
});
