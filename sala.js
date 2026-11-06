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
  if (sala.active) { salaVistasGuardar(); salaChau(); salaCerrarConexiones(); }
  salaDejarDeSeguir('saliste');
  salaLlamar(false, true);
  if (held) releaseHold();
  clearWorks();
  sala.active = true; sala.hash = hash;
  sala.borradas.clear(); sala.gente.clear(); sala.cargando.clear();
  sala.ultimoEstado = '';
  salaVistasCargar(hash);
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
  salaVistasGuardar();
  salaChau();
  salaCerrarConexiones();
  if (held) releaseHold();
  salaDejarDeSeguir('saliste');
  salaLlamar(false, true);
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
// iv: cuándo se cambió la imagen (v10.7); de: quién la puso y t0: cuándo (huellas, v10.12)
const POSE_KEYS = ['c', 'r', 'u', 'w', 'h', 'uv', 'vacio', 'iv', 'de', 't0'];
const soloPose = o => Object.fromEntries(POSE_KEYS.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

function salaCambioObras(path, data, type) {
  if (path === '/') {
    if (type === 'put' && !sala.estadoVisto) salaPrimerEstado(data || {});
    if (type === 'put') {                               // estado completo: sacar lo que ya no está
      const ids = new Set(Object.keys(data || {}));
      if (sala.idsSala) sala.idsSala.clear();           // lo vuelven a llenar los upserts de abajo
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
  salaHuellaPose(pose);
  if (sala.idsSala) sala.idsSala.add(id);
  sala.borradas.delete(id);
  const w = works.find(x => x.id === id);
  if (w) {
    if (held && held.work === w) {                      // la estoy editando yo: gana la pose mía al soltar
      // pero si otro le cambió la imagen (la llenó, la cambió o la vació), se anota: al soltar se respeta (salvo que la hayas cambiado vos)
      const vacioAntes = w.relleno ? w.relleno.vacioViejo : w.vacio;
      if (!!pose.vacio !== !!vacioAntes || (!pose.vacio && pose.iv && pose.iv !== w.iv)) w.llenadoAfuera = pose;
      return;
    }
    if (w.subiendo) {                                   // estoy subiendo mi imagen nueva: de lo que llega solo vale la posición
      const iv = w.iv; Object.assign(w, soloPose(pose)); w.iv = iv; w.vacio = false; delete w.llenadoAfuera;
      if (!w.uv) w.uv = FULL.slice();
      setBuf(w); return;
    }
    if (pose.vacio && sala.cargando.has(id)) sala.cargando.set(id, pose);   // se estaba bajando una imagen que ya no va
    if (w.vacio && !pose.vacio) { salaLlenarDeAfuera(w, id, pose); return; }   // alguien le puso foto al bloque
    if (!w.vacio && !pose.vacio && pose.iv && pose.iv !== w.iv) { salaLlenarDeAfuera(w, id, pose, 0, true); return; }   // le cambiaron la imagen
    if (!w.vacio && pose.vacio) { gl.deleteTexture(w.tex); w.tex = texture(VACIO_IMG); w.vacio = true; }   // la vaciaron
    Object.assign(w, soloPose(pose));
    if (!w.uv) w.uv = FULL.slice();
    setBuf(w);
    return;
  }
  if (pose.vacio) { if (sala.cargando.has(id)) sala.cargando.set(id, pose); else salaHuella(addWork({ id, ...soloPose(pose) }, VACIO_IMG)); return; }   // bloque vacío: no hay imagen
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
    salaHuella(addWork({ id, ...soloPose(ultima) }, ultima.vacio ? VACIO_IMG : img));   // mientras bajaba la pudieron vaciar
  }).catch(() => {
    const ultima = sala.cargando.get(id) || pose;
    sala.cargando.delete(id);
    if (!sala.active || sala.hash !== hashAlPedir || works.some(x => x.id === id) || sala.borradas.has(id)) return;
    if (ultima.vacio) { salaHuella(addWork({ id, ...soloPose(ultima) }, VACIO_IMG)); return; }
    setTimeout(() => { if (sala.active && sala.hash === hashAlPedir && !works.some(x => x.id === id) && !sala.borradas.has(id)) salaUpsert(id, ultima); }, 1500);
  });
}

// un bloque vacío que otro llenó: bajar la imagen y cambiarle la textura (la pose viene con ella)
function salaLlenarDeAfuera(w, id, pose, intento = 0, cambiar = false) {
  if (sala.cargando.has(id)) { sala.cargando.set(id, pose); return; }
  sala.cargando.set(id, pose);
  const ivPedido = pose.iv;
  const nPedido = w.subidaN;    // si mientras baja le subo una imagen mía, lo que baja ya no va
  const hashAlPedir = sala.hash;
  fetch(salaUrl('imgs/' + id)).then(r => r.json()).then(src => new Promise((res, rej) => {
    if (typeof src !== 'string') return rej(new Error('sin imagen'));
    const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src;
  })).then(img => {
    const ultima = sala.cargando.get(id);
    sala.cargando.delete(id);
    if (!sala.active || sala.hash !== hashAlPedir || !works.includes(w) || w.subiendo || w.subidaN !== nPedido) return;
    if (held && held.work === w) { w.llenadoAfuera = ultima; return; }   // lo tengo en la mano: se resuelve al soltarlo
    if (ultima.vacio) return;                                            // mientras bajaba, la vaciaron (salaUpsert ya la dejó vacía)
    if (!w.vacio && !cambiar) return;
    gl.deleteTexture(w.tex); w.tex = texture(small(img));
    w.aspect = img.height / img.width; w.vacio = false;
    Object.assign(w, soloPose(ultima)); w.vacio = false;
    if (!w.uv) w.uv = FULL.slice();
    setBuf(w);
    if (ultima.iv && ultima.iv !== ivPedido) salaLlenarDeAfuera(w, id, ultima, 0, true);   // la cambiaron otra vez mientras bajaba
  }).catch(() => {
    sala.cargando.delete(id);
    // la imagen puede tardar en subir; si no aparece en ~15 s, se deja (queda vacío hasta el próximo estado completo)
    if (held && held.work === w) { w.llenadoAfuera = pose; return; }   // se reintenta al soltarlo
    if (intento < 10) setTimeout(() => {
      if (!sala.active || sala.hash !== hashAlPedir || !works.includes(w) || (!w.vacio && !cambiar) || w.subiendo || w.subidaN !== nPedido) return;
      if (held && held.work === w) { w.llenadoAfuera = pose; return; }
      if (w.iv && pose.iv && w.iv !== pose.iv && !w.vacio) return;   // mientras tanto llegó otra versión y ya se aplicó
      salaLlenarDeAfuera(w, id, pose, intento + 1, cambiar);
    }, 1500);
  });
}

function salaQuitarLocal(id) {
  sala.borradas.add(id);
  if (sala.idsSala) sala.idsSala.delete(id);
  if (sala.pendientes) sala.pendientes.delete(id);
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
  const n = w ? (w.subidaN = (w.subidaN || 0) + 1) : 0;
  const ivMio = w ? w.iv : o.iv;   // la versión de MI imagen (lo que llegue mientras sube no la pisa)
  const tarea = () => {
    if (w && w.subidaN !== n) return;                                  // otro cambio de imagen la reemplazó antes de subir
    if (!sala.active || sala.hash !== hashAlSubir) { if (w) w.subiendo = false; return; }   // te fuiste de la sala antes de que le tocara
    if (w && !works.includes(w)) { w.subiendo = false; return; }       // la borraste antes de que le tocara
    return salaApi('imgs/' + o.id, 'PUT', src).then(() => {
      if (w && w.subidaN !== n) return;                                // la cambiaste o vaciaste mientras subía: manda el último
      if (w) w.subiendo = false;
      if (!sala.active || sala.hash !== hashAlSubir) return;          // te fuiste de la sala mientras subía
      if (w && !works.includes(w)) return salaApi('imgs/' + o.id, 'DELETE');   // lo borraste mientras subía
      const p = soloPose(w || o); delete p.vacio;
      if (ivMio) p.iv = ivMio;
      return salaApi('poses/' + o.id, 'PUT', p);
    });
  };
  salaEnCola(w, tarea).catch(() => { if (w && w.subidaN === n) w.subiendo = false; showHint('no se pudo subir la foto a la sala'); });
}
// los cambios de imagen de una misma foto (subir, vaciar) van de a uno y en orden, para que no se pisen
function salaEnCola(w, tarea) {
  if (!w) return Promise.resolve().then(tarea);
  const p = (w.colaImg || Promise.resolve()).catch(() => {}).then(tarea);
  w.colaImg = p.catch(() => {});
  return p;
}
function salaSavePose(w) {
  if (w.subiendo) return;   // la foto del bloque todavía sube: al terminar manda la pose de ahora
  const p = soloPose(w);
  const a = w.llenadoAfuera;   // otro le cambió la imagen mientras la tenía (y yo no): se respeta lo suyo
  if (a) { if (a.vacio) { p.vacio = true; delete p.iv; } else { p.vacio = false; if (a.iv) p.iv = a.iv; else delete p.iv; } }
  salaApi('poses/' + w.id, 'PUT', p).catch(() => showHint('no se pudo guardar en la sala'));
}
// al soltar algo (con ✓ o sin): si otro le había puesto foto mientras lo tenía, bajarla ahora
function salaSoltado(w) {
  if (!w.llenadoAfuera || !works.includes(w)) return;
  const p = w.llenadoAfuera; w.llenadoAfuera = null;
  if (p.vacio) { if (!w.vacio) { gl.deleteTexture(w.tex); w.tex = texture(VACIO_IMG); w.vacio = true; } }
  else if (w.vacio || (p.iv && p.iv !== w.iv)) salaLlenarDeAfuera(w, w.id, p, 0, true);
}
// le sacaste la imagen (v10.7): primero la pose vacía (así nadie la vuelve a pedir), después se borra la imagen
function salaVaciar(w) {
  w.subidaN = (w.subidaN || 0) + 1; w.subiendo = false;   // si estaba subiendo una imagen, ya no va
  const n = w.subidaN, hash = sala.hash;
  salaEnCola(w, () => {
    if (w.subidaN !== n || !sala.active || sala.hash !== hash || !works.includes(w)) return;   // otro cambio, otra sala o la borraste
    const p = soloPose(w); p.vacio = true; delete p.iv;
    return salaApi('poses/' + w.id, 'PUT', p).then(() => salaApi('imgs/' + w.id, 'DELETE'));
  }).catch(() => showHint('no se pudo vaciar en la sala'));
}
function salaRemove(w) {
  sala.borradas.add(w.id);
  salaApi('poses/' + w.id, 'DELETE').then(() => salaApi('imgs/' + w.id, 'DELETE')).catch(() => {});
}

// ---------- huellas (propuesta 2, parte 1, v10.12): quién puso cada foto y lo nuevo desde tu última vez ----------
// Cada foto o bloque nuevo lleva en su pose `de` = {id, col, cu?, ca?, fa?} (quién lo puso: su color y su forma de
// personaje) y `t0` (cuándo, en su reloj). El celu recuerda qué fotos viste de cada sala (localStorage 'vistas');
// al volver, las que no viste brillan suave en el color de quien las puso hasta que las mirás un rato (o las agarrás),
// y al entrar se avisa "desde tu última vez: N fotos nuevas". La primera vez en una sala no brilla nada (no se sabe
// qué viste). Las que llegan mientras estás también brillan (las tuyas no).
// Lo que se guarda: todas las fotos que hay en la sala (sala.idsSala, lo que dice la base, aunque su imagen no baje)
// menos las que brillan sin haberlas mirado (sala.pendientes). Una que no se puede ver (rota, sin imagen) no queda
// pendiente: si no, avisaría en cada visita.
const SALA_VISTAS_MAX = 30;                            // salas que se recuerdan
const SALA_NUEVA_MIRAR = 3, SALA_NUEVA_APAGAR = 1.5;   // segundos mirándola hasta que se apaga, y cuánto tarda en apagarse
function salaDe() {
  const d = { id: salaYo, col: salaColor.map(v => Math.round(v * 100) / 100) };
  pjPresencia(d);
  return d;
}
const salaEsMia = o => !!(o && o.de && o.de.id === salaYo);
// el color de quien la puso, si es válido (llega por la red: puede venir cualquier cosa)
const salaColDe = de => de && Array.isArray(de.col) && de.col.length === 3 && de.col.every(v => Number.isFinite(v) && v >= 0 && v <= 1) ? de.col : null;
// de lo que llega por la red, solo lo que se entiende (así tampoco se reenvía basura al moverla)
function salaDeLimpio(de) {
  if (!de || typeof de !== 'object' || typeof de.id !== 'string' || de.id.length > 40) return undefined;
  const d = { id: de.id };
  const col = salaColDe(de);
  if (col) d.col = col.slice();
  if (de.cu === 1) d.cu = 1;
  if (de.ca === 1) d.ca = 1;
  if (Number.isFinite(de.fa)) d.fa = Math.min(2, Math.max(0.5, de.fa));
  return d;
}
// limpia de y t0 de una pose que llegó (si vienen rotos se sacan: lo que ya tenía la foto se queda)
function salaHuellaPose(pose) {
  if ('de' in pose) { const d = salaDeLimpio(pose.de); if (d) pose.de = d; else delete pose.de; }
  if ('t0' in pose && !Number.isFinite(pose.t0)) delete pose.t0;
}
function salaVistasLeer() {
  try { const o = JSON.parse(localStorage.getItem('vistas') || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
}
function salaVistasCargar(hash) {
  const e = salaVistasLeer()[hash];
  sala.conocidas = e && Array.isArray(e.ids) ? new Set(e.ids.filter(x => typeof x === 'string')) : null;   // null: primera vez acá
  sala.estadoVisto = false;   // hasta que llega el primer estado completo no se sabe qué hay (y no se guarda nada)
  sala.idsSala = new Set();
  sala.pendientes = new Set();
  sala.vistasTxt = '';
  sala.avisoNuevas = null;
}
function salaVistasGuardar() {
  if (!sala.active || !sala.hash || !sala.estadoVisto) return;
  const ids = [...sala.idsSala].filter(id => !sala.pendientes.has(id)).sort();
  const txt = ids.join(',');
  if (txt === sala.vistasTxt) return;
  sala.vistasTxt = txt;
  const o = salaVistasLeer();
  o[sala.hash] = { t: Date.now(), ids };
  for (const h of Object.keys(o).sort((a, b) => ((o[b] && o[b].t) || 0) - ((o[a] && o[a].t) || 0)).slice(SALA_VISTAS_MAX)) delete o[h];
  try { localStorage.setItem('vistas', JSON.stringify(o)); } catch (e) {}
}
setInterval(salaVistasGuardar, 4000);
function salaPrimerEstado(data) {
  sala.estadoVisto = true;
  const ids = Object.keys(data).filter(id => data[id] && data[id].c);
  if (!sala.conocidas) { sala.conocidas = new Set(ids); return; }   // primera vez en esta sala: lo que hay cuenta como visto
  const nuevas = ids.filter(id => !sala.conocidas.has(id) && !salaEsMia(data[id]));
  if (!nuevas.length) return;
  const cols = [];
  for (const id of nuevas) {
    const c = salaColDe(data[id].de);
    if (c && !cols.some(x => x.every((v, i) => Math.abs(v - c[i]) < 0.02))) cols.push(c);
  }
  const pts = cols.slice(0, 6).map(c => `<span style="color:${salaRgb(c)}">●</span>`).join(' ');
  const txt = `desde tu última vez: ${nuevas.length === 1 ? '1 foto nueva' : nuevas.length + ' fotos nuevas'}${pts ? ' de ' + pts : ''} · brillan hasta que las mirás`;
  diag('sala: ' + nuevas.length + ' fotos nuevas desde la última vez');
  if (!bienvenida) sala.avisoNuevas = txt;                             // antes de tocar "entrar": va con el cartel del arranque
  else if (Date.now() - bienvenida < 5000) showHint(hint.innerHTML + '<br>' + txt);   // recién arrancó: debajo del cartel
  else showHint(txt);
}
// una foto que llega a la sala: si no la habías visto (y no es tuya), brilla
function salaHuella(w) {
  if (!w || w.rota || !sala.conocidas || sala.conocidas.has(w.id) || salaEsMia(w)) return;
  w.nueva = { visto: 0, tap: false, tapT: 0 };
  sala.pendientes.add(w.id);
}
// ya la viste (la miraste un rato o la agarraste)
function salaVista(w) {
  w.nueva = null;
  if (sala.pendientes) sala.pendientes.delete(w.id);
}
// el brillo: seis marcos suaves detrás de la foto, en el color de quien la puso, que laten despacio.
// Mirarla (delante, en el cuadro, a menos de 8 m y sin nada en el medio) SALA_NUEVA_MIRAR segundos la apaga.
// Solo cuenta con el juego arrancado y sin el editor de personaje (la pantalla de "entrar" tapa todo).
function salaNuevasDibujar(b, dt) {
  if (!sala.active || !sala.pendientes || !sala.pendientes.size) return;
  const [tx, ty] = tans(), otros = salaEnManos(), tt = Date.now() / 1000;
  const cuenta = started && !pjVista;
  let ws = null;                                         // las que tapan (se calcula una vez por cuadro, si hace falta)
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  try {
    for (const w of works) {
      const nv = w.nueva;
      if (!nv || w.rota || (held && held.work === w) || otros.has(w.id)) continue;
      const v = sub(w.c, pos), d = len(v), z = dot(v, b.f);
      if (d < 0.05) continue;
      const x = Math.abs(dot(v, b.r)), y = Math.abs(dot(v, b.u)), lado = Math.max(w.w, w.h);
      if (z + lado < 0 || x > Math.max(z, 0) * tx + lado || y > Math.max(z, 0) * ty + lado) continue;   // fuera del cuadro: ni se mira ni se dibuja
      if (cuenta && z > 0.2 && d < 8 && x < z * tx * 0.9 && y < z * ty * 0.9) {
        nv.tapT -= dt;
        if (nv.tapT <= 0) {                              // si hay algo en el medio, se mira cada 1/4 s (con muchas fotos es caro)
          nv.tapT = 0.25;
          nv.tap = tapado(pos, sub(w.c, mul(v, 0.05 / d)), ws || (ws = solidas()));
        }
        if (!nv.tap) nv.visto += dt;
      }
      const k = nv.visto < SALA_NUEVA_MIRAR ? 1 : 1 - (nv.visto - SALA_NUEVA_MIRAR) / SALA_NUEVA_APAGAR;
      if (k <= 0) { salaVista(w); continue; }
      const col = salaColDe(w.de) || [1, 1, 1];
      const a = 0.12 * k * (0.7 + 0.3 * Math.sin(tt * 3));
      let n = norm(cross(w.r, w.u));
      if (dot(n, v) < 0) n = mul(n, -1);                 // hacia atrás de la foto: la foto tapa el centro, se ve el borde
      const atras = add(w.c, mul(n, 0.006 * d)), px = metersPerPx(d);
      for (const g of [4, 8, 12, 16, 20, 25]) drawQuad(scratch, quadData(atras, w.r, w.u, w.w + 2 * g * px, w.h + 2 * g * px), white, col, a);
    }
  } finally { gl.depthMask(true); gl.disable(gl.BLEND); }
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
  if (salaSig) est.sg = salaSig.id;   // a quién sigo (v10.10): si me sigue a mí, no copiamos los giros en ronda
  if (salaLlamo > Date.now()) est.ll = salaLlamo;   // estoy llamando a los demás ("vengan", v10.11): hasta cuándo, como id del llamado
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
  // un salto grande (fue con alguien, o volvió de una reconexión): aparece ahí, sin cruzar el museo flotando
  const salto = finito3(d.p) && finito3(p.disp.p) && Math.hypot(d.p[0] - p.disp.p[0], d.p[1] - p.disp.p[1], d.p[2] - p.disp.p[2]) > 4;
  if (salto) p.disp.p = d.p.slice();
  p.col = d.col || [0.8, 0.8, 0.8];
  p.cam = !!d.cam;
  p.bq = !!d.bq;               // tiene el bloque vacío equipado (v10.6)
  p.sg = typeof d.sg === 'string' ? d.sg : null;   // a quién sigue (v10.10)
  // te llama ("vengan", v10.11): avisar una vez por llamado (aunque se reconecte y vuelva a llegar)
  // (un llamado viejo, de alguien que quedó colgado en la base sin despedirse, no cuenta: vence en su reloj
  // y, con 30 s de margen por la diferencia de hora entre celulares, en el mío)
  const ll = Number.isFinite(d.ll) && d.ll > (d.t || 0) && d.ll + 30000 > Date.now();
  p.llHasta = ll ? d.ll + 30000 : 0;
  if (!ll) p.llAviso = false;
  if (ll && salaLlAvisados.get(id) !== d.ll) { salaLlAvisados.set(id, d.ll); p.llAviso = true; diag('sala: me llama ' + id.slice(0, 4)); }
  p.ll = ll;
  pjLeer(p, d);
  const m = Array.isArray(d.m) && d.m.length >= 15 ? d.m : null;
  if (m) {
    const t = { c: m.slice(0, 3), r: m.slice(3, 6), u: m.slice(6, 9), w: m[9], h: m[10], uv: m.slice(11, 15), mid: d.mid || null };
    if (!p.mano || p.mano.mid !== t.mid) p.mano = { ...t, c: t.c.slice(), r: t.r.slice(), u: t.u.slice() };
    p.manoT = t;
    if (salto) p.mano = { ...t, c: t.c.slice(), r: t.r.slice(), u: t.u.slice() };   // lo que tiene en la mano también salta
  } else { p.mano = p.manoT = null; }
  p.t = d.t || Date.now();
  p.visto = Date.now();
}

// al cerrar o mandar la app al fondo, avisar que me fui
function salaChau() {
  if (sala.active && sala.hash) sala.chau = salaApi('gente/' + salaYo, 'DELETE', undefined, { keepalive: true }).catch(() => {});
  sala.ultimoEstado = '';
}
window.addEventListener('pagehide', () => { salaVistasGuardar(); salaChau(); });
window.addEventListener('pageshow', e => { if (e.persisted) salaReconectar(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { salaVistasGuardar(); salaChau(); } else salaReconectar(); });

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

// ---------- encontrarse (v10.9, propuesta 13 de José, parte 1) ----------
// cada uno que no se ve en la pantalla aparece como una carita en el borde (su cara en vivo, o su color),
// del lado para donde está, con la distancia. Tocarla ofrece "ir": aparecés al lado suyo, mirándolo.
const salaLejosEl = document.getElementById('lejos'), salaIrEl = document.getElementById('lejosOps');
const salaSeguirBtn = document.getElementById('lejosSeguir');
const salaCaritas = new Map();      // id -> { el, cv, x, fl, m, sx, sy }
let salaElegido = null, salaElegidoHasta = 0;
function salaCarita(id) {
  let c = salaCaritas.get(id);
  if (c) return c;
  const el = document.createElement('div'); el.className = 'lejos';
  el.innerHTML = '<canvas width="64" height="64"></canvas><div class="giro"><div class="fl"></div></div><span class="m"></span>';
  el.addEventListener('pointerdown', e => e.stopPropagation());
  el.addEventListener('click', () => salaElegir(salaElegido === id ? null : id));
  salaLejosEl.appendChild(el);
  c = { el, cv: el.querySelector('canvas'), giro: el.querySelector('.giro'), fl: el.querySelector('.fl'), m: el.querySelector('.m'), visible: false, tx: '' };
  c.x = c.cv.getContext('2d');
  salaCaritas.set(id, c);
  return c;
}
function salaElegir(id) {
  salaElegido = id; salaElegidoHasta = Date.now() + 6000;
  salaIrEl.style.display = id ? '' : 'none';
  if (id) { salaSeguirBtn.textContent = salaSig && salaSig.id === id ? 'dejar de seguir' : 'seguir'; salaIrEl.style.transform = 'translate(-999px,-999px)'; }
  salaLejosEl.style.display = id || salaLejosEl.querySelector('.lejos:not([style*="none"])') ? '' : 'none';
}
salaIrEl.addEventListener('pointerdown', e => e.stopPropagation());
document.getElementById('lejosIr').addEventListener('click', () => { const id = salaElegido; salaElegir(null); if (id) salaIr(id); });
salaSeguirBtn.addEventListener('click', () => {
  const id = salaElegido; salaElegir(null);
  if (!id) return;
  if (salaSig && salaSig.id === id) salaDejarDeSeguir('lo pediste');
  else salaSeguir(id);
});
document.addEventListener('pointerdown', e => {   // tocar en otro lado cierra la opción (y el toque sigue de largo)
  if (salaElegido && !salaIrEl.contains(e.target) && !salaLejosEl.contains(e.target)) salaElegir(null);
}, true);
function salaIr(id) {
  const p = sala.gente.get(id);
  if (!p || !sala.active) return;
  salaDejarDeSeguir('fuiste');
  if (!irHacia(p.target.p, p.target.yaw)) return;
  diag('sala: fui con ' + id.slice(0, 4));
  buzz(10);
  showHint('acá está');
  sala.ultimoEstado = ''; salaEnviarPresencia();   // que te vea llegar ya
}
const salaRgb = (c, k = 1) => `rgb(${c.map(v => Math.round(clamp(v * k, 0, 1) * 255)).join(',')})`;
function salaLejosPintar(c, id, p) {
  const x = c.x, col = Array.isArray(p.col) && p.col.length === 3 && p.col.every(Number.isFinite) ? p.col : [0.8, 0.8, 0.8];
  const tx = salaRgb(col);
  if (c.tx !== tx) { c.tx = tx; c.cv.style.borderColor = tx; c.fl.style.borderLeftColor = tx; }
  const t = typeof rtcCaraLienzo === 'function' ? rtcCaraLienzo(id) : null, cara = t && t.c;
  const clave = tx + (t ? t.cuando : '-');
  if (c.clave === clave) return;          // la misma cara (o la carita de color): no hace falta redibujar
  c.clave = clave;
  x.fillStyle = salaRgb(col, cara ? 0.35 : 0.8); x.fillRect(0, 0, 64, 64);
  if (cara && cara.width && cara.height) {
    const k = Math.max(64 / cara.width, 64 / cara.height), w = cara.width * k, h = cara.height * k;   // cubrir el círculo
    x.drawImage(cara, (64 - w) / 2, (64 - h) / 2, w, h);
  } else {                                // sin cara: una carita de su color
    x.fillStyle = 'rgba(0,0,0,0.6)';
    x.beginPath(); x.arc(24, 27, 3.5, 0, Math.PI * 2); x.arc(40, 27, 3.5, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 3.5; x.lineCap = 'round';
    x.beginPath(); x.arc(32, 34, 11, 0.25 * Math.PI, 0.75 * Math.PI); x.stroke();
  }
}
// las zonas que tapa el iPhone (env(safe-area-inset-*)), leídas de un elemento de prueba cada 2 s
let salaSeguroV = { t: 0, r: 0, b: 0, l: 0 }, salaSeguroT = 0;
function salaSeguro() {
  const now = Date.now();
  if (now - salaSeguroT < 2000) return salaSeguroV;
  salaSeguroT = now;
  const cs = getComputedStyle(document.getElementById('seguro')), n = v => parseFloat(v) || 0;
  salaSeguroV = { t: n(cs.paddingTop), r: n(cs.paddingRight), b: n(cs.paddingBottom), l: n(cs.paddingLeft) };
  return salaSeguroV;
}
function salaLejos(b) {
  const activo = sala.active && started && !pjVista;
  const vistos = new Set();
  if (activo && sala.gente.size) {
    const [tx, ty] = tans(), cx = W / 2, cy = H / 2, sg = salaSeguro();
    // el marco donde van las caritas: lejos de tu cara y los botones de arriba, del joystick y los botones de abajo,
    // de la barra de distancia (cuando está) y de las zonas que tapa el iPhone (notch, barrita de abajo)
    const x0 = 34 + sg.l, x1 = W - 34 - sg.r - (distEl.style.display !== 'none' ? 50 : 0);
    let y0 = 120 + sg.t, y1 = H - 196 - sg.b;
    if (y1 - y0 < 60) { y0 = cy - 30; y1 = cy + 30; }
    const puestos = [], ws = solidas();
    for (const [id, p] of sala.gente) {
      const q = p.disp && p.disp.p;
      if (!finito3(q)) continue;
      // ¿se ve? (la cabeza o el medio del cuerpo adentro de la pantalla y sin una foto en el medio)
      const cuerpo = [q[0], q[1] - 0.7, q[2]];
      const enPantalla = v => { const l = toLocalV(b, sub(v, pos)); return l[2] > 0.05 && Math.abs(l[0] / l[2]) < tx * 0.95 && Math.abs(l[1] / l[2]) < ty * 0.95; };
      const enCuadro = enPantalla(q) || enPantalla(cuerpo);
      // (con una foto en la mano no: la carita en el medio de la pantalla estorbaría para editar)
      if (enCuadro && (held || !tapado(pos, q, ws) || !tapado(pos, cuerpo, ws))) continue;
      const l = toLocalV(b, sub(q, pos));
      let dx = l[0] / tx, dy = -l[1] / ty, sx, sy, flecha = true;
      if (Math.hypot(dx, dy) < 1e-3) { dx = 0; dy = 1; }                      // justo atrás: abajo
      if (enCuadro && l[2] > 0.05) {
        // atrás de una pared pero para este lado: la carita va donde está (sin flecha)
        sx = clamp(cx + l[0] / l[2] / tx * cx, x0, x1); sy = clamp(cy - l[1] / l[2] / ty * cy, y0, y1); flecha = false;
      } else {
        // del centro hacia él, hasta el borde del marco
        const k = Math.min(dx > 0 ? (x1 - cx) / dx : dx < 0 ? (x0 - cx) / dx : Infinity, dy > 0 ? (y1 - cy) / dy : dy < 0 ? (y0 - cy) / dy : Infinity);
        sx = cx + dx * k; sy = cy + dy * k;
      }
      // si se encima con otra, correrla a lo largo del borde (para un lado o para el otro)
      const enLado = Math.abs(sx - x0) < 1 || Math.abs(sx - x1) < 1;
      const libre = (x, y) => !puestos.some(o => Math.hypot(o[0] - x, o[1] - y) < 52);
      if (!libre(sx, sy)) {
        for (const o of [54, -54, 108, -108, 162, -162]) {
          const nx = enLado ? sx : clamp(sx + o, x0, x1), ny = enLado ? clamp(sy + o, y0, y1) : sy;
          if (libre(nx, ny)) { sx = nx; sy = ny; break; }
        }
      }
      puestos.push([sx, sy]);
      const c = salaCarita(id);
      vistos.add(id);
      if (!c.visible) { c.el.style.display = ''; c.visible = true; }
      c.el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
      c.giro.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
      if (c.flecha !== flecha) { c.flecha = flecha; c.giro.style.display = flecha ? '' : 'none'; }
      const m = (p.ll ? 'te llama\n' : '') + Math.max(1, Math.round(len(sub(q, pos)))) + ' m';
      if (c.m.textContent !== m) c.m.textContent = m;
      if (c.llama !== p.ll) { c.llama = p.ll; c.el.classList.toggle('llama', p.ll); }
      c.sx = sx; c.sy = sy; c.dx = dx / Math.hypot(dx, dy); c.dy = dy / Math.hypot(dx, dy);
      salaLejosPintar(c, id, p);
    }
  }
  for (const [id, c] of salaCaritas) {
    if (vistos.has(id)) continue;
    if (!sala.gente.has(id)) { c.el.remove(); salaCaritas.delete(id); }
    else if (c.visible) { c.el.style.display = 'none'; c.visible = false; }
  }
  // las opciones "ir ahí / seguir": al lado de la carita elegida (hacia adentro de la pantalla),
  // o debajo de su cabeza si se lo tocó en 3D y se ve (v10.10)
  if (salaElegido) {
    let xy = null;
    const p = activo && sala.gente.get(salaElegido), q = p && p.disp && p.disp.p;
    if (vistos.has(salaElegido)) { const c = salaCaritas.get(salaElegido); xy = [c.sx - c.dx * 80, c.sy - c.dy * 58]; }
    else if (finito3(q)) {
      const [tx, ty] = tans(), l = toLocalV(b, sub(q, pos));
      if (l[2] > 0.05) xy = [clamp(W / 2 + l[0] / l[2] / tx * W / 2, 90, W - 90), clamp(H / 2 - l[1] / l[2] / ty * H / 2 + 56, 130, H - 210)];
    }
    if (!xy || Date.now() > salaElegidoHasta) salaElegir(null);
    else salaIrEl.style.transform = `translate(${xy[0].toFixed(1)}px,${xy[1].toFixed(1)}px) translate(-50%,-50%)`;
  }
  salaLejosEl.style.display = vistos.size || salaElegido ? '' : 'none';
  // "vengan" (v10.11): avisar cuando alguien empieza a llamar; y mi llamado se vence solo al minuto
  for (const p of sala.gente.values()) if (p.ll && Date.now() > p.llHasta) { p.ll = false; p.llAviso = false; }   // si no avisa que terminó
  if (activo) for (const [id, p] of sala.gente) if (p.llAviso) {
    p.llAviso = false;
    if (!p.ll) continue;
    showHint(vistos.has(id) ? 'te llaman: tocá su carita para ir' : held ? 'te llaman' : 'te llaman: tocalo para ir');
    buzz(30);
  }
  if (salaLlamo && Date.now() > salaLlamo) salaLlamar(false, false, 'terminó el llamado');
}

// ¿tocaste a alguien de la sala? (v10.10) El cuerpo es un palito de la cabeza a los pies con ~30 cm de radio.
// Devuelve { id, t } (t = distancia por el rayo) del más cercano, o null.
function salaPersonaEn(x, y) {
  if (!sala.active || !sala.gente.size || pjVista) return null;
  const d = rayoEn(x, y);
  let mejor = null;
  for (const [id, p] of sala.gente) {
    const q = p.disp && p.disp.p;
    if (!finito3(q) || len(sub(q, pos)) < 0.45) continue;      // pegado a vos no se dibuja
    // punto del palito (vertical, de los pies a la cabeza) más cercano al rayo
    const a = [q[0], Math.max(0, q[1] - EYE) + 0.1, q[2]], e = [0, q[1] + 0.2 - a[1], 0];
    const w0 = sub(pos, a), A = dot(d, d), B = dot(d, e), C = dot(e, e), D = dot(d, w0), E = dot(e, w0);
    const den = A * C - B * B;
    let s = den > 1e-9 ? (B * E - C * D) / den : 0, u = den > 1e-9 ? (A * E - B * D) / den : 0;
    u = clamp(u, 0, 1); s = Math.max(0, (B * u - D) / A);
    const dist = len(sub(add(pos, mul(d, s)), add(a, mul(e, u))));
    if (s > 0.1 && dist < 0.32 && (!mejor || s < mejor.t)) mejor = { id, t: s };
  }
  return mejor;
}

// ---------- seguir a alguien (v10.10, propuesta 13 parte 2) ----------
// caminás solo detrás suyo (hasta quedar a 1,5 m) y la vista gira con la suya: lo que gira, girás vos
// (con el giroscopio igual podés mirar alrededor). Se corta con el joystick, el teclado o arrastrando para mirar.
// Si te trabás (una pared, una plataforma que no se sube) o se va lejos, aparecés detrás suyo.
const salaSigEl = document.getElementById('siguiendo');
let salaSig = null;
salaSigEl.addEventListener('pointerdown', e => e.stopPropagation());
salaSigEl.addEventListener('click', () => salaDejarDeSeguir('lo pediste'));
const salaDirDe = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
function salaSeguir(id) {
  const p = sala.gente.get(id);
  if (!p || !sala.active || !finito3(p.disp.p) || !Number.isFinite(p.disp.yaw) || !Number.isFinite(p.disp.pitch)) return;
  salaSig = { id, yaw: p.disp.yaw, pitch: p.disp.pitch, trabado: 0, alto: 0, pared: 0, prev: pos.slice(), paso: 0, ultimoSalto: 0, fallidos: 0 };
  if (held && held.aim) finishAim();
  mirarDir(salaDirDe(p.disp.yaw, p.disp.pitch));   // mirar lo que mira
  const col = Array.isArray(p.col) && p.col.length === 3 && p.col.every(Number.isFinite) ? p.col : [0.8, 0.8, 0.8];
  salaSigEl.style.borderColor = salaRgb(col);
  salaSigEl.style.display = '';
  diag('sala: sigo a ' + id.slice(0, 4));
  buzz(10);
  showHint(TACTIL ? 'siguiendo · tocá el joystick o arrastrá para dejar' : 'siguiendo · moverte o mirar con el mouse lo corta');
}
function salaDejarDeSeguir(por) {
  if (!salaSig) return;
  salaSig = null;
  salaSigEl.style.display = 'none';
  diag('sala: dejé de seguir (' + por + ')');
  if (por !== 'fuiste' && por !== 'saliste' && por !== 'agarraste') showHint(por === 'se fue' ? 'se fue de la sala' : por === 'no llego' ? 'no llego hasta ahí: dejé de seguir' : 'dejaste de seguir');
}
// ---------- "vengan" (v10.11, propuesta 13 parte 3) ----------
// desde el panel de la sala: durante un minuto, a los demás les titila tu carita ("te llama") para que vengan.
// Se corta con "llamando ✕" arriba, con "dejar de llamar" en el panel o saliendo de la sala.
const salaLlamandoEl = document.getElementById('llamando');
let salaLlamo = 0;                 // hasta cuándo llamo (ms), 0 = no llamo
const salaLlAvisados = new Map();  // id -> el llamado suyo que ya avisé
const SALA_LLAMO_MS = 60000;
salaLlamandoEl.addEventListener('pointerdown', e => e.stopPropagation());
salaLlamandoEl.addEventListener('click', () => salaLlamar(false));
function salaLlamar(on, callado, aviso) {
  if (on && !sala.active) return;
  if (!on && !salaLlamo) return;
  salaLlamo = on ? Date.now() + SALA_LLAMO_MS : 0;
  salaLlamandoEl.style.display = on ? '' : 'none';
  diag(on ? 'sala: llamo a los demás' : 'sala: dejé de llamar');
  if (on) { buzz(10); showHint('les avisé que vengan · titila tu carita un minuto'); }
  // callado: saliendo de la sala (ya se mandó el "me fui": no volver a aparecer)
  // (y en plena reconexión tampoco: que el "me fui" llegue antes; el timer lo manda al reabrir)
  if (!callado) { if (!on) showHint(aviso || 'dejaste de llamar'); sala.ultimoEstado = ''; if (sala.esGente) salaEnviarPresencia(); }
  salaPintar();
}
// cada cuadro, desde draw(): gira la vista con la suya y devuelve el paso [x, z] de este cuadro (o null)
function salaSeguirPaso(dt) {
  if (!salaSig) return null;
  const p = sala.gente.get(salaSig.id), q = p && p.disp && p.disp.p;
  if (!sala.active || !p) { salaDejarDeSeguir(sala.active ? 'se fue' : 'saliste'); return null; }
  if (pjVista || !finito3(q) || !Number.isFinite(p.disp.yaw) || !Number.isFinite(p.disp.pitch)) return null;
  // lo que giró desde el cuadro anterior, lo girás vos; salvo que en la cadena de a quién sigue cada uno
  // esté yo (A sigue a B y B a A): ahí cada giro rebotaría de uno a otro sin fin
  let ronda = false;
  for (let o = p, i = 0; o && o.sg && i < 8; o = sala.gente.get(o.sg), i++) if (o.sg === salaYo) { ronda = true; break; }
  if (!ronda && !held) {
    let gy = p.disp.yaw - salaSig.yaw; gy = Math.atan2(Math.sin(gy), Math.cos(gy));
    yawOff += gy;
    pitchOff = clamp(pitchOff + p.disp.pitch - salaSig.pitch, -1.4, 1.4);
  }
  salaSig.yaw = p.disp.yaw; salaSig.pitch = p.disp.pitch;
  const dx = q[0] - pos[0], dz = q[2] - pos[2], d = Math.hypot(dx, dz), alto = Math.abs(q[1] - pos[1]);
  // ¿trabado? quise caminar y casi no me moví (una pared) durante 2,5 s; o está a otra altura que no alcanzo
  // (una plataforma); o se fue muy lejos de golpe
  const movi = Math.hypot(pos[0] - salaSig.prev[0], pos[2] - salaSig.prev[2]);
  if (salaSig.paso > 0.002 && movi < salaSig.paso * 0.3) salaSig.trabado += dt; else salaSig.trabado = 0;
  if (alto > 0.6 && d < 3) salaSig.alto += dt; else salaSig.alto = 0;
  // cerca pero con una pared en el medio (quedé del otro lado a 1,5 m): también cuenta como trabado
  if (d < 4 && tapado(pos, q, solidas())) salaSig.pared += dt; else salaSig.pared = 0;
  salaSig.paso = 0; salaSig.prev = pos.slice();
  if (d > 15 || salaSig.trabado > 2.5 || salaSig.alto > 2.5 || salaSig.pared > 2.5) {
    salaSig.trabado = 0; salaSig.alto = 0; salaSig.pared = 0;
    // si no hay caso (aparezco y enseguida me vuelvo a trabar o caer, 3 veces seguidas), dejo de seguir
    const ahora = Date.now();
    salaSig.fallidos = ahora - salaSig.ultimoSalto < 4000 ? salaSig.fallidos + 1 : 0;
    salaSig.ultimoSalto = ahora;
    if (salaSig.fallidos >= 3) { salaDejarDeSeguir('no llego'); return null; }
    if (irHacia(q, p.disp.yaw, true)) {
      salaSig.prev = pos.slice();
      mirarDir(salaDirDe(p.disp.yaw, p.disp.pitch));
      diag('sala: siguiendo, aparecí detrás de ' + salaSig.id.slice(0, 4));
      sala.ultimoEstado = ''; salaEnviarPresencia();
    }
    return null;
  }
  // caminar hacia él hasta quedar a 1,5 m (más rápido cuanto más lejos, hasta correr)
  if (d <= 1.5) return null;
  const v = Math.min(MOVE * 2.5, (d - 1.5) * 2);
  salaSig.paso = v * dt;
  return [dx / d * v * dt, dz / d * v * dt];
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
  document.getElementById('salaVenganFila').style.display = sala.active && (n || salaLlamo) ? '' : 'none';
  const vb = document.getElementById('salaVengan');
  vb.textContent = salaLlamo ? 'dejar de llamar' : 'vengan';
  vb.classList.toggle('on', !!salaLlamo);
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
document.getElementById('salaVengan').addEventListener('click', () => {
  const on = !salaLlamo;
  salaLlamar(on);
  if (on) salaPanel.style.display = 'none';
});
document.getElementById('salaSalir').addEventListener('click', () => { salaSalir(); salaPanel.style.display = 'none'; });
salaPintar();
