// juego — cuenta de admin (José), con Firebase Auth por REST, sin SDK.
// La Web API key es configuración pública (va en cualquier app web de Firebase), no un secreto:
// lo que protege son las reglas de la base (firebase-rules.json), que solo al uid de José le dejan
// ver y borrar todas las salas y marcar un comentario como suyo.
// Se carga después de diag.js y antes de sala.js: acá al cargar no se usa nada de game.js.

const CUENTA_KEY = 'AIzaSyA_aLxLSBD7kOu5PlHAhteW55iNgoTtKrU';
// en las pruebas (?db=http://localhost...) el mock de la base también imita el login
const CUENTA_MOCK = (() => { const d = new URLSearchParams(location.search).get('db'); return d && /^http:\/\/localhost(:\d+)?$/.test(d) ? d : null; })();
const CUENTA_URL = CUENTA_MOCK ? CUENTA_MOCK + '/__auth/' : 'https://identitytoolkit.googleapis.com/v1/';
const CUENTA_REFRESH = CUENTA_MOCK ? CUENTA_MOCK + '/__auth/token' : 'https://securetoken.googleapis.com/v1/token';

let cuenta = null;   // {email, uid, token, refresh, vence}
try { cuenta = JSON.parse(localStorage.getItem('cuenta') || 'null'); } catch (e) { cuenta = null; }
if (cuenta && !(cuenta.uid && cuenta.refresh)) cuenta = null;
function cuentaGuardar() { try { if (cuenta) localStorage.setItem('cuenta', JSON.stringify(cuenta)); else localStorage.removeItem('cuenta'); } catch (e) {} }
const cuentaAdmin = () => !!cuenta;

const CUENTA_ERR = {
  EMAIL_EXISTS: 'ese email ya tiene cuenta: usá "entrar"',
  INVALID_LOGIN_CREDENTIALS: 'email o contraseña incorrectos',
  INVALID_PASSWORD: 'contraseña incorrecta', EMAIL_NOT_FOUND: 'no hay cuenta con ese email',
  INVALID_EMAIL: 'el email no es válido', WEAK_PASSWORD: 'la contraseña tiene que tener 6 letras o más',
  OPERATION_NOT_ALLOWED: 'el login no está activado en Firebase', ADMIN_ONLY_OPERATION: 'ya no se pueden crear cuentas',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'demasiados intentos, probá en un rato',
};
async function cuentaEntrar(email, pass, crear) {
  const r = await fetch(CUENTA_URL + (crear ? 'accounts:signUp' : 'accounts:signInWithPassword') + '?key=' + CUENTA_KEY, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pass, returnSecureToken: true }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.idToken) {
    const m = (d.error && d.error.message) || ('error ' + r.status);
    throw new Error(CUENTA_ERR[m.split(' ')[0]] || m);
  }
  cuenta = { email: d.email || email, uid: d.localId, token: d.idToken, refresh: d.refreshToken, vence: Date.now() + (+d.expiresIn || 3600) * 1000 };
  cuentaGuardar();
  diag('cuenta: entró ' + (crear ? '(nueva) ' : '') + cuenta.uid.slice(0, 6));
}
function cuentaSalir() { cuenta = null; cuentaGuardar(); diag('cuenta: salió'); }

// token vigente (se renueva solo); null si no hay cuenta o no se pudo
let cuentaRenovando = null;
async function cuentaToken() {
  if (!cuenta) return null;
  if (cuenta.token && Date.now() < cuenta.vence - 60000) return cuenta.token;
  if (!cuentaRenovando) cuentaRenovando = (async () => {
    try {
      const r = await fetch(CUENTA_REFRESH + '?key=' + CUENTA_KEY, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(cuenta.refresh),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id_token) {
        diag('cuenta: no pude renovar (' + ((d.error && d.error.message) || r.status) + ')');
        // el refresh no sirve más (cuenta borrada o deshabilitada): hay que volver a entrar
        if (r.status === 400 && cuenta) { cuenta = null; cuentaGuardar(); }
        return null;
      }
      if (!cuenta) return null;
      cuenta.token = d.id_token; cuenta.refresh = d.refresh_token || cuenta.refresh;
      cuenta.vence = Date.now() + (+d.expires_in || 3600) * 1000;
      cuentaGuardar();
      return cuenta.token;
    } catch (e) { return null; } finally { cuentaRenovando = null; }
  })();
  return cuentaRenovando;
}

// ---------- panel (se abre con 3 toques en el título de "mis salas") ----------
function cuentaPintar() {
  const dentro = !!cuenta;
  document.getElementById('cuentaFuera').style.display = dentro ? 'none' : '';
  document.getElementById('cuentaDentro').style.display = dentro ? '' : 'none';
  if (dentro) {
    document.getElementById('cuentaEmail').textContent = cuenta.email;
    document.getElementById('cuentaUid').textContent = cuenta.uid;
  }
  document.getElementById('cuentaError').textContent = '';
}
function cuentaAbrir() {
  for (const id of ['salasPanel', 'salaPanel', 'opciones']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
  document.getElementById('cuentaPanel').style.display = '';
  cuentaPintar();
}
document.addEventListener('DOMContentLoaded', () => {
  const $c = id => document.getElementById(id);
  let intentando = false;   // un doble toque mandaba dos pedidos y el segundo dejaba un error viejo
  const intentar = async crear => {
    if (intentando || cuenta) return;
    const email = $c('cuentaMail').value.trim(), pass = $c('cuentaPass').value;
    if (!email || !pass) { $c('cuentaError').textContent = 'falta el email o la contraseña'; return; }
    $c('cuentaError').textContent = crear ? 'creando…' : 'entrando…';
    intentando = true;
    try {
      await cuentaEntrar(email, pass, crear);
      $c('cuentaPass').value = ''; $c('cuentaPass').blur(); $c('cuentaMail').blur();
      cuentaPintar();
    } catch (e) { $c('cuentaError').textContent = e.message; } finally { intentando = false; }
  };
  $c('cuentaEntrar').addEventListener('click', () => intentar(false));
  $c('cuentaCrear').addEventListener('click', () => intentar(true));
  $c('cuentaPass').addEventListener('keydown', e => { if (e.key === 'Enter') intentar(false); });
  $c('cuentaSalir').addEventListener('click', () => { cuentaSalir(); cuentaPintar(); });
  $c('cuentaCerrar').addEventListener('click', () => { $c('cuentaPanel').style.display = 'none'; });
  $c('cuentaSalas').addEventListener('click', () => { $c('cuentaPanel').style.display = 'none'; salasAbrir(true); });
  let toques = [];
  $c('salasTit').addEventListener('pointerdown', () => {
    const now = Date.now();
    toques = toques.filter(t => now - t < 1500); toques.push(now);
    if (toques.length >= 3) { toques = []; cuentaAbrir(); }
  });
});
