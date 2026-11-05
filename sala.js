// juego — salas compartidas
// Un museo compartido por contraseña, sobre Firebase Realtime Database (REST + EventSource, sin librerías).
// La contraseña se convierte en SHA-256 y eso es la dirección de la sala: sin la contraseña no se puede
// encontrar, leer ni escribir (ver reglas en firebase-rules.json). La contraseña nunca sale del celu.
// Se carga ANTES que game.js: acá solo se definen funciones; usan cosas de game.js recién cuando se llaman.

// ?db= solo para las pruebas (el mock en localhost): un link con otra base no puede llevarse fotos ni el token de admin
const SALA_DB = (d => d && /^http:\/\/localhost(:\d+)?$/.test(d) ? d : 'https://juego-dd2eb-default-rtdb.firebaseio.com')(new URLSearchParams(location.search).get('db'));
const SALA_IMG_MAX = 768;          // las fotos compartidas se suben a 768px (~100KB)

const sala = {
  active: false, hash: null,
  esObras: null, esGente: null,
  cargando: new Map(),             // id -> última pose recibida mientras baja la imagen
  borradas: new Set(),
  gente: new Map(),                // id -> persona
  timer: null, ultimoEnvio: 0, ultimoEstado: '',
  chau: Promise.resolve(),         // el último "me fui" en viaje: hay que esperarlo antes de volver a avisar que estoy
  ultimoEvento: 0,                 // cuándo llegó algo por las conexiones en vivo (para detectar si se murieron)
};

// quién soy y de qué color (se guarda en el celu)
let salaYo = null, salaColor = null;
try { salaYo = localStorage.getItem('yo'); salaColor = JSON.parse(localStorage.getItem('color') || 'null'); } catch (e) {}
if (!salaYo) { salaYo = Math.random().toString(36).slice(2, 10); try { localStorage.setItem('yo', salaYo); } catch (e) {} }
if (!salaColor) {
  const hsl = (h, s, l) => { const a = s * Math.min(l, 1 - l); const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; };
  salaColor = hsl(Math.random() * 360, 0.75, 0.62);
  try { localStorage.setItem('color', JSON.stringify(salaColor)); } catch (e) {}
}

async function salaHash(pass) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('juego:' + pass));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const salaUrl = p => `${SALA_DB}/salas/${sala.hash}/${p}.json`;
function salaApi(p, method, body, extra) {
  return fetch(salaUrl(p), { method, body: body === undefined ? undefined : JSON.stringify(body), ...extra })
    .then(r => { if (!r.ok) throw new Error('firebase ' + r.status); return r; });
}

// ---------- entrar / salir ----------
function salaGuardada() { try { return localStorage.getItem('sala'); } catch (e) { return null; } }

async function salaEntrarConPass(pass) {
  if ((pass || '').length < 6) { showHint('la contraseña tiene que tener 6 letras o más'); return; }
  const h = await salaHash(pass);
  try { localStorage.setItem('salaPass', JSON.stringify({ h, p: pass })); } catch (e) {}   // solo en este celu, para poder verla
  salaRecordar(h, pass);
  await salaEntrar(h);
}
function salaClave() {
  try { const o = JSON.parse(localStorage.getItem('salaPass') || 'null'); return o && o.h === sala.hash ? o.p : null; } catch (e) { return null; }
}

async function salaEntrar(hash) {
  if (sala.active) { salaChau(); salaCerrarConexiones(); }
  if (held) releaseHold();
  clearWorks();
  sala.active = true; sala.hash = hash;
  sala.borradas.clear(); sala.gente.clear(); sala.cargando.clear();
  sala.ultimoEstado = '';
  try { localStorage.setItem('sala', hash); } catch (e) {}
  await sala.chau;                 // si recién saliste, que el "me fui" llegue antes que el "volví"
  if (!sala.active || sala.hash !== hash) return;
  diag('sala: entro ' + hash.slice(0, 6));
  salaRecordar(hash);
  // aparecer cerca del centro pero no adentro de otro (todos arrancan en el mismo lugar)
  if (Math.hypot(pos[0], pos[2]) < 0.3) { const a = Math.random() * Math.PI * 2, r = 0.9 + Math.random() * 0.8; pos[0] = Math.cos(a) * r; pos[2] = Math.sin(a) * r; }
  salaAbrirConexiones();
  rtcStart();
  showHint('entraste a la sala · lo que hagas acá lo ven todos los que tengan la contraseña');
  ui(); salaPintar();
}

function salaSalir() {
  if (!sala.active) return;
  diag('sala: salgo');
  salaChau();
  salaCerrarConexiones();
  if (held) releaseHold();
  sala.active = false; sala.hash = null; sala.gente.clear();
  try { localStorage.removeItem('sala'); localStorage.removeItem('salaPass'); } catch (e) {}
  clearWorks();
  loadWorks().catch(() => {});
  showHint('volviste a tu museo');
  ui(); salaPintar();
}

function salaAbrirConexiones() {
  sala.ultimoEvento = Date.now();
  const vivo = () => { sala.ultimoEvento = Date.now(); };
  sala.esObras = new EventSource(salaUrl('poses'));
  sala.esObras.addEventListener('keep-alive', vivo);
  sala.esObras.addEventListener('open', vivo);
  const onObras = e => { vivo(); try { const m = JSON.parse(e.data); salaCambioObras(m.path, m.data, e.type); } catch (err) {} };
  sala.esObras.addEventListener('put', onObras);
  sala.esObras.addEventListener('patch', onObras);
  sala.esObras.addEventListener('cancel', () => showHint('la sala no acepta la conexión'));

  sala.esGente = new EventSource(salaUrl('gente'));
  sala.esGente.addEventListener('keep-alive', vivo);
  const onGente = e => { vivo(); try { const m = JSON.parse(e.data); salaCambioGente(m.path, m.data, e.type); } catch (err) {} };
  sala.esGente.addEventListener('put', onGente);
  sala.esGente.addEventListener('patch', onGente);

  sala.timer = setInterval(salaEnviarPresencia, 200);
}

function salaCerrarConexiones(dejarRtc) {
  if (!dejarRtc) rtcStop();
  if (sala.esObras) sala.esObras.close();
  if (sala.esGente) sala.esGente.close();
  sala.esObras = sala.esGente = null;
  clearInterval(sala.timer);
}

// el iPhone corta las conexiones en vivo cuando la app pasa al fondo, sin avisar.
// al volver (o si hace rato que no llega nada) se reabre todo: la sala manda el estado completo de nuevo.
async function salaReconectar() {
  if (!sala.active) return;
  diag('sala: reconecto');
  salaCerrarConexiones();
  sala.ultimoEstado = '';
  await sala.chau;
  if (!sala.active) return;
  salaAbrirConexiones();
  rtcStart();
}
setInterval(() => {
  if (sala.active && !document.hidden && sala.esGente && Date.now() - sala.ultimoEvento > 70000) salaReconectar();
}, 10000);

// ---------- obras compartidas ----------
const POSE_KEYS = ['c', 'r', 'u', 'w', 'h', 'uv', 'vacio'];
const soloPose = o => Object.fromEntries(POSE_KEYS.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

function salaCambioObras(path, data, type) {
  if (path === '/') {
    if (type === 'put') {                               // estado completo: sacar lo que ya no está
      const ids = new Set(Object.keys(data || {}));
      for (const w of [...works]) if (!ids.has(w.id)) salaQuitarLocal(w.id);
    }
    for (const id in (data || {})) data[id] ? salaUpsert(id, data[id]) : salaQuitarLocal(id);
    return;
  }
  const parts = path.split('/').filter(Boolean);
  const id = parts[0];
  if (parts.length > 1) {                               // cambió un campo suelto: pedir la pose entera
    fetch(salaUrl('poses/' + id)).then(r => r.json()).then(p => p ? salaUpsert(id, p) : salaQuitarLocal(id)).catch(() => {});
    return;
  }
  data ? salaUpsert(id, data) : salaQuitarLocal(id);
}

function salaUpsert(id, pose) {
  if (!pose || !pose.c) return;
  sala.borradas.delete(id);
  const w = works.find(x => x.id === id);
  if (w) {
    if (held && held.work === w) {                      // la estoy editando yo: gana lo mío al soltar
      if ((w.vacio || w.relleno) && !pose.vacio) w.llenadoAfuera = pose;  // pero si otro le puso foto al bloque, no se la saco al soltar
      return;
    }
    if (w.vacio && !pose.vacio) { salaLlenarDeAfuera(w, id, pose); return; }   // alguien le puso foto al bloque
    Object.assign(w, soloPose(pose));
    if (!w.uv) w.uv = FULL.slice();
    setBuf(w);
    return;
  }
  if (pose.vacio) { if (!sala.cargando.has(id)) addWork({ id, ...soloPose(pose) }, VACIO_IMG); return; }   // bloque vacío: no hay imagen
  if (sala.cargando.has(id)) { sala.cargando.set(id, pose); return; }
  sala.cargando.set(id, pose);
  const hashAlPedir = sala.hash;
  fetch(salaUrl('imgs/' + id)).then(r => r.json()).then(src => new Promise((res, rej) => {
    if (typeof src !== 'string') return rej(new Error('sin imagen'));
    const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src;
  })).then(img => {
    const ultima = sala.cargando.get(id);
    sala.cargando.delete(id);
    if (!sala.active || sala.hash !== hashAlPedir || sala.borradas.has(id) || works.some(x => x.id === id)) return;
    addWork({ id, ...soloPose(ultima) }, img);
  }).catch(() => {
    sala.cargando.delete(id);
    setTimeout(() => { if (sala.active && sala.hash === hashAlPedir && !works.some(x => x.id === id) && !sala.borradas.has(id)) salaUpsert(id, pose); }, 1500);
  });
}

// un bloque vacío que otro llenó: bajar la imagen y cambiarle la textura (la pose viene con ella)
function salaLlenarDeAfuera(w, id, pose, intento = 0) {
  if (sala.cargando.has(id)) { sala.cargando.set(id, pose); return; }
  sala.cargando.set(id, pose);
  const hashAlPedir = sala.hash;
  fetch(salaUrl('imgs/' + id)).then(r => r.json()).then(src => new Promise((res, rej) => {
    if (typeof src !== 'string') return rej(new Error('sin imagen'));
    const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src;
  })).then(img => {
    const ultima = sala.cargando.get(id);
    sala.cargando.delete(id);
    if (!sala.active || sala.hash !== hashAlPedir || !works.includes(w)) return;
    if (held && held.work === w) { if (w.vacio || w.relleno) w.llenadoAfuera = ultima; return; }   // lo tengo en la mano: se llena al soltarlo
    if (!w.vacio) return;
    gl.deleteTexture(w.tex); w.tex = texture(small(img));
    w.aspect = img.height / img.width; w.vacio = false;
    Object.assign(w, soloPose(ultima)); w.vacio = false;
    if (!w.uv) w.uv = FULL.slice();
    setBuf(w);
  }).catch(() => {
    sala.cargando.delete(id);
    // la imagen puede tardar en subir; si no aparece en ~15 s, se deja (queda vacío hasta el próximo estado completo)
    if (held && held.work === w) { w.llenadoAfuera = pose; return; }   // se reintenta al soltarlo
    if (intento < 10) setTimeout(() => {
      if (!sala.active || sala.hash !== hashAlPedir || !works.includes(w) || !w.vacio) return;
      if (held && held.work === w) { w.llenadoAfuera = pose; return; }
      salaLlenarDeAfuera(w, id, pose, intento + 1);
    }, 1500);
  });
}

function salaQuitarLocal(id) {
  sala.borradas.add(id);
  sala.cargando.delete(id);
  const w = works.find(x => x.id === id);
  if (!w) return;
  if (held && held.work === w) { releaseHold(); showHint('alguien borró la foto que tenías en la mano'); }
  works.splice(works.indexOf(w), 1);
  gl.deleteTexture(w.tex); gl.deleteBuffer(w.buf);
}

// llamadas desde game.js
// w: el bloque que se llenó (la pose se manda al terminar de subir la imagen, la que tenga en ese momento; si se borró, nada)
function salaShoot(o, canvas, w) {
  const k = Math.min(1, SALA_IMG_MAX / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  const src = c.toDataURL('image/jpeg', 0.8);
  // primero la imagen, después la pose: así el que recibe la pose ya encuentra la imagen
  const hashAlSubir = sala.hash;
  if (w) w.subiendo = true;   // mientras sube, soltarlo de nuevo no manda la pose (la manda esto al terminar, la del momento)
  salaApi('imgs/' + o.id, 'PUT', src)
    .then(() => {
      if (w) w.subiendo = false;
      if (!sala.active || sala.hash !== hashAlSubir) return;          // te fuiste de la sala mientras subía
      if (w && !works.includes(w)) return salaApi('imgs/' + o.id, 'DELETE');   // lo borraste mientras subía
      const p = soloPose(w || o); delete p.vacio;
      return salaApi('poses/' + o.id, 'PUT', p);
    })
    .catch(() => { if (w) w.subiendo = false; showHint('no se pudo subir la foto a la sala'); });
}
function salaSavePose(w) {
  if (w.subiendo) return;   // la foto del bloque todavía sube: al terminar manda la pose de ahora
  const p = soloPose(w);
  if (w.vacio && w.llenadoAfuera) { p.vacio = false; w.llenadoAfuera = { ...p }; }   // otro lo llenó mientras lo tenía: no lo vacío
  salaApi('poses/' + w.id, 'PUT', p).catch(() => showHint('no se pudo guardar en la sala'));
}
// al soltar algo (con ✓ o sin): si otro le había puesto foto mientras lo tenía, bajarla ahora
function salaSoltado(w) {
  if (!w.llenadoAfuera || !works.includes(w)) return;
  const p = w.llenadoAfuera; w.llenadoAfuera = null;
  if (w.vacio) salaLlenarDeAfuera(w, w.id, p);
}
function salaRemove(w) {
  sala.borradas.add(w.id);
  salaApi('poses/' + w.id, 'DELETE').then(() => salaApi('imgs/' + w.id, 'DELETE')).catch(() => {});
}

// ---------- gente en la sala ----------
function salaEnviarPresencia() {
  if (!sala.active || document.hidden || !started) return;
  const f = basis().f;
  const est = {
    p: pos.map(v => Math.round(v * 100) / 100),
    yaw: Math.round(heading(f) * 100) / 100,
    pitch: Math.round(Math.asin(clamp(f[1], -1, 1)) * 100) / 100,
    col: salaColor.map(v => Math.round(v * 100) / 100),
    cam: camOn ? 1 : 0,          // apenas la equipás (antes de que abra): los demás congelan tu cara a tiempo
  };
  pjPresencia(est);
  // lo que tengo en la mano (una foto agarrada, la vista previa de la cámara o el bloque vacío), para que los demás lo vean
  const L = held ? heldPose(basis()) : ((camOn && camReady) || bloqueOn ? previewPose(basis()) : null);
  if (!held && bloqueOn) est.bq = 1;
  if (L) {
    const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
    est.m = [...L.c.map(r2), ...L.r.map(r3), ...L.u.map(r3), r3(L.w), r3(L.h), ...(L.uv || FULL).map(r3)];
    if (held) est.mid = held.work.id;
  }
  const s = JSON.stringify(est);
  const now = Date.now();
  if (s === sala.ultimoEstado && now - sala.ultimoEnvio < 5000) return;   // sin cambios: latido cada 5 s
  sala.ultimoEstado = s; sala.ultimoEnvio = now;
  salaApi('gente/' + salaYo, 'PUT', { ...est, t: now }).catch(() => {});
}

function salaCambioGente(path, data, type) {
  if (path === '/') {
    if (type === 'put') sala.gente.clear();
    for (const id in (data || {})) salaPersona(id, data[id]);
  } else {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 1) salaPersona(parts[0], data);
  }
  salaPintar();
  rtcSync();
}

// fotos que otro tiene agarradas: no se dibujan en su lugar (se ven en su mano)
function salaEnManos() {
  const s = new Set();
  if (sala.active) for (const p of sala.gente.values()) if (p.mano && p.mano.mid) s.add(p.mano.mid);
  return s;
}

function salaPersona(id, d) {
  if (id === salaYo) return;
  if (!d || !d.p) { sala.gente.delete(id); return; }
  let p = sala.gente.get(id);
  if (!p) {
    p = { disp: { p: d.p.slice(), yaw: d.yaw || 0, pitch: d.pitch || 0 }, body: d.yaw || 0, phase: 0, walk: 0, raise: 0 };
    sala.gente.set(id, p);
  }
  p.target = { p: d.p, yaw: d.yaw || 0, pitch: d.pitch || 0 };
  p.col = d.col || [0.8, 0.8, 0.8];
  p.cam = !!d.cam;
  p.bq = !!d.bq;               // tiene el bloque vacío equipado (v10.6)
  pjLeer(p, d);
  const m = Array.isArray(d.m) && d.m.length >= 15 ? d.m : null;
  if (m) {
    const t = { c: m.slice(0, 3), r: m.slice(3, 6), u: m.slice(6, 9), w: m[9], h: m[10], uv: m.slice(11, 15), mid: d.mid || null };
    if (!p.mano || p.mano.mid !== t.mid) p.mano = { ...t, c: t.c.slice(), r: t.r.slice(), u: t.u.slice() };
    p.manoT = t;
  } else { p.mano = p.manoT = null; }
  p.t = d.t || Date.now();
  p.visto = Date.now();
}

// al cerrar o mandar la app al fondo, avisar que me fui
function salaChau() {
  if (sala.active && sala.hash) sala.chau = salaApi('gente/' + salaYo, 'DELETE', undefined, { keepalive: true }).catch(() => {});
  sala.ultimoEstado = '';
}
window.addEventListener('pagehide', salaChau);
window.addEventListener('pageshow', e => { if (e.persisted) salaReconectar(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) salaChau(); else salaReconectar(); });

// ---------- dibujar a los demás: personaje palito ----------
let salaDiscTex = null;
function salaDisco() {
  if (salaDiscTex) return salaDiscTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.beginPath(); x.arc(32, 32, 31, 0, Math.PI * 2); x.fill();
  salaDiscTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, salaDiscTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  return salaDiscTex;
}

const LIMB = 0.05;   // grosor de los palitos (m)
let salaOscuroTex = null;
function salaOscuro() {
  if (salaOscuroTex) return salaOscuroTex;
  salaOscuroTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, salaOscuroTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([22, 22, 26]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  return salaOscuroTex;
}
function salaPalo(a, b, col) {
  const mid = mul(add(a, b), 0.5);
  const d = sub(b, a), L = len(d);
  if (L < 1e-4) return;
  const dir = mul(d, 1 / L);
  let side = cross(dir, sub(pos, mid));
  if (len(side) < 1e-6) side = [1, 0, 0];
  drawQuad(scratch, quadData(mid, norm(side), dir, LIMB, L), white, col);
}
// articulación redonda (para que los palitos no queden cortados en rodillas y codos)
let salaB = null;
function salaJunta(c, col) { drawQuad(scratch, quadData(c, salaB.r, salaB.u, LIMB, LIMB), salaDisco(), col); }
function salaBola(c, r, col, b, tex) { drawQuad(scratch, quadData(c, b.r, b.u, 2 * r, 2 * r), tex || salaDisco(), col); }

const lerpAng = (a, b, k) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; };
const dirYaw = y => [-Math.sin(y), 0, -Math.cos(y)];

function salaDraw(b, dt) {
  if (!sala.active) return;
  rtcOido(b);
  if (!sala.gente.size) return;
  const now = Date.now(), tt = now / 1000;
  salaB = b;
  for (const [id, p] of sala.gente) {
    if (now - p.visto > 30000) { sala.gente.delete(id); salaPintar(); continue; }   // se fue sin avisar
    // suavizar lo que llega por la red
    const k = 1 - Math.exp(-dt * 6);
    const prev = p.disp.p.slice();
    for (let i = 0; i < 3; i++) p.disp.p[i] += (p.target.p[i] - p.disp.p[i]) * k;
    p.disp.yaw = lerpAng(p.disp.yaw, p.target.yaw, k);
    p.disp.pitch += (p.target.pitch - p.disp.pitch) * k;
    const speed = Math.hypot(p.disp.p[0] - prev[0], p.disp.p[2] - prev[2]) / Math.max(dt, 1e-3);
    p.walk += (clamp(speed / 1.2, 0, 1) - p.walk) * (1 - Math.exp(-dt * 8));
    p.phase += speed * dt * 4.2;
    // el cuerpo sigue a la cabeza con retraso (si camina, más rápido)
    let dy = p.disp.yaw - p.body; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    if (Math.abs(dy) > 0.5 || p.walk > 0.2) p.body = lerpAng(p.body, p.disp.yaw, 1 - Math.exp(-dt * (p.walk > 0.2 ? 6 : 3)));
    p.raise += ((p.cam ? 1 : 0) - p.raise) * (1 - Math.exp(-dt * 5));
    if (len(sub(p.disp.p, pos)) < 0.45) continue;   // pegado a mi cabeza: taparía toda la pantalla
    const E = pjDibujar(id, p, b, tt, (aspect, redonda) => rtcCaraTex(id, aspect, redonda, p.cam));
    rtcBoca(id, E);
    salaManoDe(id, p, k);
  }
}

// lo que tiene en la mano: la foto que está moviendo o lo que está encuadrando con la cámara
function salaManoDe(id, p, k) {
    if (p.mano) {
      const T = p.manoT, M = p.mano;
      for (let i = 0; i < 3; i++) { M.c[i] += (T.c[i] - M.c[i]) * k; M.r[i] += (T.r[i] - M.r[i]) * k; M.u[i] += (T.u[i] - M.u[i]) * k; }
      M.w += (T.w - M.w) * k; M.h += (T.h - M.h) * k; M.uv = T.uv;
      const pose = { c: M.c, r: norm(M.r), u: norm(M.u), w: M.w, h: M.h, uv: M.uv };
      if (M.mid) {
        const w = works.find(x => x.id === M.mid);
        if (w) drawFramed(pose, w.tex, p.col);
      } else {
        const v = p.cam && rtcVista(id);
        if (p.bq) drawFramed({ ...pose, uv: FULL }, texVacio(), p.col);
        else if (v) drawFramed({ ...pose, uv: FULL }, v, p.col);
        else drawFramed({ ...pose, uv: FULL }, salaOscuro(), p.col);
      }
    }
}

// ---------- mis salas: registro en este dispositivo + ver fotos + borrar ----------
function salaRegistro() { try { return JSON.parse(localStorage.getItem('salas') || '[]'); } catch (e) { return []; } }
function salaRegistroGuardar(l) { try { localStorage.setItem('salas', JSON.stringify(l)); } catch (e) {} }
function salaRecordar(h, p) {
  const l = salaRegistro();
  let e = l.find(x => x.h === h);
  if (!e) { if (p == null) { const c = salaClave(); if (c == null) return; p = c; } e = { h, p }; l.push(e); }
  if (p != null) e.p = p;
  e.t = Date.now();
  salaRegistroGuardar(l);
}
(() => {   // la sala de antes del registro
  try { const o = JSON.parse(localStorage.getItem('salaPass') || 'null'); if (o && o.p != null && !salaRegistro().some(x => x.h === o.h)) { const l = salaRegistro(); l.push({ h: o.h, p: o.p, t: Date.now() }); salaRegistroGuardar(l); } } catch (e) {}
})();
const salaUrlDe = (h, p) => `${SALA_DB}/salas/${h}/${p}.json`;
const salasPanel = document.getElementById('salasPanel');
function hace(t) {
  const m = (Date.now() - (t || 0)) / 60000;
  return m < 2 ? 'recién' : m < 60 ? `hace ${Math.round(m)} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
}
// salasTodas: modo admin (José con su cuenta): todas las salas que existen, no solo las de este dispositivo
let salasTodas = false;
function salasAbrir(todas) {
  document.getElementById('salaPanel').style.display = 'none';
  salasPanel.style.display = '';
  salasTodas = todas === true && cuentaAdmin();
  salasLista();
}
function salasLista() {
  document.getElementById('salasDetalle').style.display = 'none';
  const lista = document.getElementById('salasLista');
  lista.style.display = '';
  lista.innerHTML = '';
  document.getElementById('salasSub').textContent = salasTodas ? '(todas las que existen · admin)' : '(las que usaste en este dispositivo)';
  document.getElementById('salasModo').style.display = cuentaAdmin() ? '' : 'none';
  document.getElementById('salasModo').textContent = salasTodas ? 'solo las mías' : 'ver todas';
  if (salasTodas) { salasListaTodas(lista); return; }
  const l = salaRegistro().sort((a, b) => (b.t || 0) - (a.t || 0));
  if (!l.length) { lista.innerHTML = '<div class="nota">todavía no entraste a ninguna sala desde acá.</div>'; return; }
  for (const e of l) {
    const fila = document.createElement('div'); fila.className = 'salaFila';
    const nom = document.createElement('div'); nom.className = 'nom'; nom.textContent = e.p;
    const cuando = document.createElement('div'); cuando.className = 'nota'; cuando.textContent = sala.active && sala.hash === e.h ? 'estás acá' : hace(e.t);
    const ver = document.createElement('div'); ver.className = 'pill'; ver.textContent = 'ver';
    ver.addEventListener('click', () => salasDetalle(e));
    fila.append(nom, cuando, ver);
    if (!(sala.active && sala.hash === e.h)) {
      const ent = document.createElement('div'); ent.className = 'pill blanco'; ent.textContent = 'entrar';
      ent.addEventListener('click', () => salasEntrarA(e));
      fila.append(ent);
    }
    lista.append(fila);
  }
}
// todas las salas (admin): la lista sale de la base con el token de José; de las que no conozco
// la contraseña muestro el principio del hash
let salasGen = 0;
async function salasListaTodas(lista) {
  const gen = ++salasGen;
  const nota = document.createElement('div'); nota.className = 'nota'; nota.textContent = 'cargando…'; lista.append(nota);
  let hs;
  try {
    const tok = await cuentaToken();
    if (!tok) throw new Error('sin cuenta');
    const r = await fetch(`${SALA_DB}/salas.json?shallow=true&auth=${encodeURIComponent(tok)}`);
    if (!r.ok) throw new Error(r.status === 401 ? 'la base no te deja (¿falta tu id en las reglas?)' : 'error ' + r.status);
    hs = Object.keys((await r.json()) || {});
  } catch (err) { nota.textContent = 'no pude traer las salas: ' + err.message; return; }
  if (gen !== salasGen || !salasTodas || salasViendo) return;
  const conocidas = new Map(salaRegistro().map(x => [x.h, x]));
  nota.textContent = hs.length ? `${hs.length} sala${hs.length === 1 ? '' : 's'}. las que no tienen nombre son de contraseñas que no usaste acá.` : 'no hay ninguna sala.';
  const filas = [];
  for (const h of hs) {
    const k = conocidas.get(h);
    const e = { h, p: k ? k.p : null, t: k && k.t };
    const fila = document.createElement('div'); fila.className = 'salaFila';
    const nom = document.createElement('div'); nom.className = 'nom'; nom.textContent = e.p != null ? e.p : 'sin nombre · ' + h.slice(0, 8);
    if (e.p == null) nom.style.opacity = 0.6;
    const cuantas = document.createElement('div'); cuantas.className = 'nota'; cuantas.textContent = sala.active && sala.hash === h ? 'estás acá' : '…';
    const ver = document.createElement('div'); ver.className = 'pill'; ver.textContent = 'ver';
    ver.addEventListener('click', () => salasDetalle(e));
    fila.append(nom, cuantas, ver); lista.append(fila); filas.push([h, cuantas]);
  }
  if (hs.length) {
    const todas = document.createElement('div'); todas.className = 'pill rojo'; todas.textContent = 'borrar todas las salas';
    todas.addEventListener('click', async () => {
      if (!todas.dataset.seguro) {
        todas.dataset.seguro = '1'; todas.textContent = '¿seguro? borra las fotos de TODAS · tocá de nuevo';
        setTimeout(() => { todas.dataset.seguro = ''; todas.textContent = 'borrar todas las salas'; }, 4000);
        return;
      }
      todas.textContent = 'borrando…';
      try {
        const tok = await cuentaToken();
        if (!tok) throw new Error('tu cuenta no respondió, volvé a entrar');
        const r = await fetch(`${SALA_DB}/salas.json?auth=${encodeURIComponent(tok)}`, { method: 'DELETE' });
        if (!r.ok) throw new Error('firebase ' + r.status);
        diag('sala: admin borró todas (' + hs.length + ')');
        showHint('borradas todas las salas');
        if (sala.active) { sala.ultimoEstado = ''; salaEnviarPresencia(); }   // vuelvo a avisar que estoy
        salasLista();
      } catch (err) { todas.textContent = 'borrar todas las salas'; showHint('no se pudieron borrar: ' + err.message); }
    });
    lista.append(todas);
  }
  // cuántas fotos tiene cada una (de a una, para no tirar 100 pedidos juntos)
  for (const [h, el] of filas) {
    if (gen !== salasGen || !salasTodas || salasPanel.style.display === 'none' || !el.isConnected) return;
    if (sala.active && sala.hash === h) continue;
    try {
      const n = Object.keys((await (await fetch(salaUrlDe(h, 'poses') + '?shallow=true')).json()) || {}).length;
      el.textContent = n ? `${n} foto${n === 1 ? '' : 's'}` : 'vacía';
    } catch (err) { el.textContent = '?'; }
  }
}
async function salasEntrarA(e) {
  try { if (e.p != null) localStorage.setItem('salaPass', JSON.stringify({ h: e.h, p: e.p })); else localStorage.removeItem('salaPass'); } catch (err) {}
  salasPanel.style.display = 'none';
  await salaEntrar(e.h);
}
let salasViendo = null;
async function salasDetalle(e) {
  salasViendo = e;
  document.getElementById('salasLista').style.display = 'none';
  document.getElementById('salasDetalle').style.display = '';
  document.getElementById('salasNombre').textContent = e.p != null ? e.p : 'sin nombre · ' + e.h.slice(0, 8);
  document.getElementById('salasEntrar').style.display = sala.active && sala.hash === e.h ? 'none' : '';
  document.getElementById('salasOlvidar').style.display = salaRegistro().some(x => x.h === e.h) ? '' : 'none';
  const borrar = document.getElementById('salasBorrar'); borrar.textContent = 'borrar sala'; borrar.dataset.seguro = '';
  const fotos = document.getElementById('salasFotos'); fotos.innerHTML = '';
  const cuenta = document.getElementById('salasCuenta'); cuenta.textContent = ' · cargando…';
  let ids = [];
  try { ids = Object.keys((await (await fetch(salaUrlDe(e.h, 'poses') + '?shallow=true')).json()) || {}); }
  catch (err) { cuenta.textContent = ' · no pude conectarme'; return; }
  cuenta.textContent = ` · ${ids.length} foto${ids.length === 1 ? '' : 's'}`;
  for (const id of ids) {
    const m = document.createElement('div'); m.className = 'miniFoto';
    const x = document.createElement('div'); x.className = 'x'; x.textContent = '✕';
    x.addEventListener('click', async () => {
      m.style.opacity = 0.3;
      try {
        await fetch(salaUrlDe(e.h, 'poses/' + id), { method: 'DELETE' });
        await fetch(salaUrlDe(e.h, 'imgs/' + id), { method: 'DELETE' });
        m.remove(); ids = ids.filter(i => i !== id);
        cuenta.textContent = ` · ${ids.length} foto${ids.length === 1 ? '' : 's'}`;
      } catch (err) { m.style.opacity = 1; showHint('no se pudo borrar'); }
    });
    m.append(x); fotos.append(m);
  }
  // miniaturas de a una, achicadas (las fotos enteras en memoria a la vez pueden tumbar el iPhone)
  for (const m of [...fotos.children]) {
    if (salasViendo !== e || salasPanel.style.display === 'none') return;
    const id = ids[[...fotos.children].indexOf(m)];
    if (!id) continue;
    try {
      const src = await (await fetch(salaUrlDe(e.h, 'imgs/' + id))).json();
      if (typeof src !== 'string') continue;
      const img = new Image(); img.src = src; await img.decode();
      const c = document.createElement('canvas'), k = 168 / Math.min(img.width, img.height);
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const t = new Image(); t.src = c.toDataURL('image/jpeg', 0.7); m.prepend(t);
    } catch (err) {}
  }
}
document.getElementById('salasEntrar').addEventListener('click', () => salasViendo && salasEntrarA(salasViendo));
document.getElementById('salasVolver').addEventListener('click', () => { salasViendo = null; salasLista(); });
document.getElementById('salasCerrar').addEventListener('click', () => { salasViendo = null; salasPanel.style.display = 'none'; });
document.getElementById('salasOlvidar').addEventListener('click', () => {
  if (!salasViendo) return;
  salaRegistroGuardar(salaRegistro().filter(x => x.h !== salasViendo.h));
  salasViendo = null; salasLista();
});
document.getElementById('salasBorrar').addEventListener('click', async () => {
  const bt = document.getElementById('salasBorrar'), e = salasViendo;
  if (!e) return;
  if (!bt.dataset.seguro) {
    bt.dataset.seguro = '1'; bt.textContent = '¿seguro? tocá de nuevo';
    setTimeout(() => { bt.dataset.seguro = ''; bt.textContent = 'borrar sala'; }, 3000);
    return;
  }
  bt.textContent = 'borrando…';
  try {
    const tok = salasTodas && !(sala.active && sala.hash === e.h) ? await cuentaToken() : null;
    if (tok) {   // admin: la sala entera (también la gente y las señales de video que quedaron colgadas)
      const r = await fetch(`${SALA_DB}/salas/${e.h}.json?auth=${encodeURIComponent(tok)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('firebase ' + r.status);
    } else {
      await fetch(salaUrlDe(e.h, 'poses'), { method: 'DELETE' });
      await fetch(salaUrlDe(e.h, 'imgs'), { method: 'DELETE' });
    }
    diag('sala: borrada ' + e.h.slice(0, 6));
    if (!(sala.active && sala.hash === e.h)) salaRegistroGuardar(salaRegistro().filter(x => x.h !== e.h));
    showHint('sala borrada');
    salasViendo = null; salasLista();
  } catch (err) { bt.textContent = 'borrar sala'; showHint('no se pudo borrar la sala'); }
});
for (const el of document.querySelectorAll('.abrirSalas')) el.addEventListener('click', () => salasAbrir());
document.getElementById('salasModo').addEventListener('click', () => { salasTodas = !salasTodas && cuentaAdmin(); salasViendo = null; salasLista(); });

// ---------- panel de la sala ----------
const salaBtn = document.getElementById('salaBtn'), salaPanel = document.getElementById('salaPanel');
const salaPass = document.getElementById('salaPass'), salaVer2 = document.getElementById('salaVer2');
function salaPintar() {
  const n = sala.gente.size;
  salaBtn.textContent = sala.active ? (n ? `sala · ${n + 1}` : 'sala ·') : 'sala';
  salaBtn.classList.toggle('on', sala.active);
  document.getElementById('salaFuera').style.display = sala.active ? 'none' : '';
  document.getElementById('salaDentro').style.display = sala.active ? '' : 'none';
  const clave = sala.active ? salaClave() : null, verla = salaVer2.textContent === 'ocultar';
  document.getElementById('salaClave').textContent = clave == null ? 'no está guardada en este celu (volvé a entrar con ella)' : verla ? clave : '•'.repeat(clave.length);
  salaVer2.style.display = clave == null ? 'none' : '';
  document.getElementById('salaGente').textContent = n === 0 ? 'por ahora estás solo' : n === 1 ? 'hay 1 persona más' : `hay ${n} personas más`;
  // cómo van la cara y la voz con cada uno (directo, por el servidor puente o sin conectar)
  const red = typeof rtcResumen === 'function' && n ? rtcResumen() : null, partes = [];
  if (red) {
    if (red.dir) partes.push(`directo con ${red.dir}`);
    if (red.pte) partes.push(`por el puente con ${red.pte}`);
    if (red.no) partes.push(`conectando con ${red.no}`);
  }
  document.getElementById('salaRed').textContent = partes.length ? 'cara y voz: ' + partes.join(' · ') : '';
}
salaBtn.addEventListener('click', () => {
  const open = salaPanel.style.display === 'none';
  salaPanel.style.display = open ? '' : 'none';
  if (open) { salaVer2.textContent = 'ver'; salaPintar(); }
  if (open && !sala.active) setTimeout(() => salaPass.focus(), 50);
});
document.getElementById('salaEntrar').addEventListener('click', async () => {
  await salaEntrarConPass(salaPass.value);
  if (sala.active) { salaPass.value = ''; salaPass.blur(); salaPanel.style.display = 'none'; }
});
document.getElementById('salaVer').addEventListener('click', () => {
  const ver = salaPass.type === 'password';
  salaPass.type = ver ? 'text' : 'password';
  document.getElementById('salaVer').textContent = ver ? 'ocultar' : 'ver';
});
salaVer2.addEventListener('click', () => { salaVer2.textContent = salaVer2.textContent === 'ver' ? 'ocultar' : 'ver'; salaPintar(); });
salaPass.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('salaEntrar').click(); });
document.getElementById('salaSalir').addEventListener('click', () => { salaSalir(); salaPanel.style.display = 'none'; });
salaPintar();
