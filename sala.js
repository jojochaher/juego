// juego — salas compartidas
// Un museo compartido por contraseña, sobre Firebase Realtime Database (REST + EventSource, sin librerías).
// La contraseña se convierte en SHA-256 y eso es la dirección de la sala: sin la contraseña no se puede
// encontrar, leer ni escribir (ver reglas en firebase-rules.json). La contraseña nunca sale del celu.
// Se carga ANTES que game.js: acá solo se definen funciones; usan cosas de game.js recién cuando se llaman.

const SALA_DB = new URLSearchParams(location.search).get('db') || 'https://juego-dd2eb-default-rtdb.firebaseio.com';
const SALA_IMG_MAX = 768;          // las fotos compartidas se suben a 768px (~100KB)

const sala = {
  active: false, hash: null,
  esObras: null, esGente: null,
  cargando: new Map(),             // id -> última pose recibida mientras baja la imagen
  borradas: new Set(),
  gente: new Map(),                // id -> persona
  timer: null, ultimoEnvio: 0, ultimoEstado: '',
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
  await salaEntrar(await salaHash(pass));
}

async function salaEntrar(hash) {
  if (sala.active) salaCerrarConexiones();
  if (held) releaseHold();
  clearWorks();
  sala.active = true; sala.hash = hash;
  sala.borradas.clear(); sala.gente.clear(); sala.cargando.clear();
  try { localStorage.setItem('sala', hash); } catch (e) {}
  salaAbrirConexiones();
  showHint('entraste a la sala · lo que hagas acá lo ven todos los que tengan la contraseña');
  ui(); salaPintar();
}

function salaSalir() {
  if (!sala.active) return;
  salaCerrarConexiones();
  salaApi('gente/' + salaYo, 'DELETE', undefined, { keepalive: true }).catch(() => {});
  if (held) releaseHold();
  sala.active = false; sala.hash = null; sala.gente.clear();
  try { localStorage.removeItem('sala'); } catch (e) {}
  clearWorks();
  loadWorks().catch(() => {});
  showHint('volviste a tu museo');
  ui(); salaPintar();
}

function salaAbrirConexiones() {
  sala.esObras = new EventSource(salaUrl('poses'));
  const onObras = e => { try { const m = JSON.parse(e.data); salaCambioObras(m.path, m.data, e.type); } catch (err) {} };
  sala.esObras.addEventListener('put', onObras);
  sala.esObras.addEventListener('patch', onObras);
  sala.esObras.addEventListener('cancel', () => showHint('la sala no acepta la conexión'));

  sala.esGente = new EventSource(salaUrl('gente'));
  const onGente = e => { try { const m = JSON.parse(e.data); salaCambioGente(m.path, m.data, e.type); } catch (err) {} };
  sala.esGente.addEventListener('put', onGente);
  sala.esGente.addEventListener('patch', onGente);

  sala.timer = setInterval(salaEnviarPresencia, 200);
}

function salaCerrarConexiones() {
  if (sala.esObras) sala.esObras.close();
  if (sala.esGente) sala.esGente.close();
  sala.esObras = sala.esGente = null;
  clearInterval(sala.timer);
}

// ---------- obras compartidas ----------
const POSE_KEYS = ['c', 'r', 'u', 'w', 'h', 'uv'];
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
    if (held && held.work === w) return;                // la estoy editando yo: gana lo mío al soltar
    Object.assign(w, soloPose(pose));
    if (!w.uv) w.uv = FULL.slice();
    setBuf(w);
    return;
  }
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
function salaShoot(o, canvas) {
  const k = Math.min(1, SALA_IMG_MAX / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  const src = c.toDataURL('image/jpeg', 0.8);
  // primero la imagen, después la pose: así el que recibe la pose ya encuentra la imagen
  salaApi('imgs/' + o.id, 'PUT', src)
    .then(() => salaApi('poses/' + o.id, 'PUT', soloPose(o)))
    .catch(() => showHint('no se pudo subir la foto a la sala'));
}
function salaSavePose(w) { salaApi('poses/' + w.id, 'PUT', soloPose(w)).catch(() => showHint('no se pudo guardar en la sala')); }
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
    cam: camOn && camReady ? 1 : 0,
  };
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
  p.t = d.t || Date.now();
  p.visto = Date.now();
}

// al cerrar o mandar la app al fondo, avisar que me fui
function salaChau() { if (sala.active) salaApi('gente/' + salaYo, 'DELETE', undefined, { keepalive: true }).catch(() => {}); sala.ultimoEstado = ''; }
window.addEventListener('pagehide', salaChau);
document.addEventListener('visibilitychange', () => { if (document.hidden) salaChau(); });

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
function salaBola(c, r, col, b) { drawQuad(scratch, quadData(c, b.r, b.u, 2 * r, 2 * r), salaDisco(), col); }

const lerpAng = (a, b, k) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; };
const dirYaw = y => [-Math.sin(y), 0, -Math.cos(y)];

function salaDraw(b, dt) {
  if (!sala.active || !sala.gente.size) return;
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

    const col = p.col, dark = col.map(v => v * 0.35);
    const up = [0, 1, 0], down = [0, -1, 0];
    const fwd = dirYaw(p.body), right = [Math.cos(p.body), 0, -Math.sin(p.body)];
    const look = [-Math.sin(p.disp.yaw) * Math.cos(p.disp.pitch), Math.sin(p.disp.pitch), -Math.cos(p.disp.yaw) * Math.cos(p.disp.pitch)];
    const lookRight = [Math.cos(p.disp.yaw), 0, -Math.sin(p.disp.yaw)];
    const w = p.walk;
    const bob = Math.sin(tt * 1.8 + id.length) * 0.008 + Math.abs(Math.sin(p.phase)) * 0.035 * w;
    const E = [p.disp.p[0], p.disp.p[1] + bob - 0.03 * w, p.disp.p[2]];
    const neck = add(E, [0, -0.17, 0]);
    const pelvis = add(E, [0, -0.7, 0]);
    const swing = (a) => norm(add(mul(down, Math.cos(a)), mul(fwd, Math.sin(a))));

    // piernas: dos tramos, la rodilla se dobla al levantar el pie
    for (const s of [1, -1]) {
      const a = Math.sin(p.phase) * 0.55 * w * s;
      const hip = add(pelvis, mul(right, 0.09 * s));
      const knee = add(hip, mul(swing(a), 0.45));
      const bend = Math.max(0, Math.sin(p.phase + (s > 0 ? 0 : Math.PI))) * 0.7 * w;
      const foot = add(knee, mul(swing(a - bend), 0.45));
      salaPalo(hip, knee, col); salaPalo(knee, foot, col);
      salaJunta(hip, col); salaJunta(knee, col); salaJunta(foot, col);
    }
    salaPalo(add(pelvis, mul(right, -0.09)), add(pelvis, mul(right, 0.09)), col);  // cadera
    salaPalo(neck, pelvis, col);                                            // torso
    salaJunta(neck, col); salaJunta(pelvis, col);
    salaPalo(add(neck, mul(right, -0.17)), add(neck, mul(right, 0.17)), col); // hombros
    // brazos: se balancean al caminar; con la cámara equipada, el derecho la sostiene adelante
    for (const s of [1, -1]) {
      const sh = add(neck, mul(right, 0.17 * s));
      const a = -Math.sin(p.phase) * 0.45 * w * s + Math.sin(tt * 1.3 + s) * 0.04;
      let elbow = add(add(sh, mul(swing(a), 0.3)), mul(right, 0.03 * s));
      let hand = add(elbow, mul(swing(a + 0.25 * (1 - w)), 0.28));
      if (s > 0 && p.raise > 0.01) {
        const hold = add(add(E, mul(look, 0.42)), mul(lookRight, 0.08));
        const holdElbow = add(add(sh, mul(look, 0.2)), [0, -0.12, 0]);
        elbow = add(mul(elbow, 1 - p.raise), mul(holdElbow, p.raise));
        hand = add(mul(hand, 1 - p.raise), mul(hold, p.raise));
      }
      salaPalo(sh, elbow, col); salaPalo(elbow, hand, col);
      salaJunta(sh, col); salaJunta(elbow, col); salaJunta(hand, col);
      if (s > 0 && p.raise > 0.5) drawQuad(scratch, quadData(add(hand, mul(look, 0.02)), lookRight, norm(cross(lookRight, look)), 0.13, 0.09), white, dark);
    }
    // cabeza, y ojos que miran hacia donde mira (solo se ven si te está mirando)
    salaBola(E, 0.13, col, b);
    if (dot(look, sub(pos, E)) > 0) {
      const eyeUp = norm(cross(lookRight, look));
      for (const s of [1, -1]) salaBola(add(add(add(E, mul(look, 0.1)), mul(lookRight, 0.045 * s)), mul(eyeUp, 0.02)), 0.022, dark, b);
    }
  }
}

// ---------- panel de la sala ----------
const salaBtn = document.getElementById('salaBtn'), salaPanel = document.getElementById('salaPanel');
const salaPass = document.getElementById('salaPass');
function salaPintar() {
  const n = sala.gente.size;
  salaBtn.textContent = sala.active ? (n ? `sala · ${n + 1}` : 'sala ·') : 'sala';
  salaBtn.classList.toggle('on', sala.active);
  document.getElementById('salaFuera').style.display = sala.active ? 'none' : '';
  document.getElementById('salaDentro').style.display = sala.active ? '' : 'none';
  document.getElementById('salaGente').textContent = n === 0 ? 'por ahora estás solo' : n === 1 ? 'hay 1 persona más' : `hay ${n} personas más`;
}
salaBtn.addEventListener('click', () => {
  const open = salaPanel.style.display === 'none';
  salaPanel.style.display = open ? '' : 'none';
  if (open && !sala.active) setTimeout(() => salaPass.focus(), 50);
});
document.getElementById('salaEntrar').addEventListener('click', async () => {
  await salaEntrarConPass(salaPass.value);
  if (sala.active) { salaPass.value = ''; salaPass.blur(); salaPanel.style.display = 'none'; }
});
salaPass.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('salaEntrar').click(); });
document.getElementById('salaSalir').addEventListener('click', () => { salaSalir(); salaPanel.style.display = 'none'; });
salaPintar();
