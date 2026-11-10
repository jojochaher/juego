// biblioteca de texturas (v10.23, propuesta 8 de José): fotos que se guardan para volver a usarlas.
// Con una foto en la mano, "guardar textura" guarda lo que se ve de ella (su recorte) en tu biblioteca, que es de este
// celu (sirve en tu museo y en cualquier sala). Al llenar un bloque, cambiar la imagen de una foto o ponerle otra foto a
// una cara de una caja, si tenés texturas se abre la hoja "tus texturas" (en vez de ir directo a cámara / galería).
// Guardado: en el mismo IndexedDB de las obras, registros 'tex~<g>' = {id, g, img: blob JPEG (≤512 px), mini: blob (≤168 px),
// a: alto/ancho, t}. No tienen blob ni vacio: loadWorks (también el de versiones viejas) los saltea.
// Ojo: nada de acá corre al cargar usando cosas de game.js (store, gl, held...): solo adentro de funciones.
const TX_MAX = 40;          // a lo sumo 40 (cada una ocupa ~50 KB en memoria; las miniaturas solo con la hoja abierta)
const tx = { lista: [], cargada: false, quitar: false, cambiar: false, cambiando: null, para: null, urls: [] };
// cambiar la imagen de una textura (v10.30, propuesta 22 de José): la entrada toma otra clave g y anota en antes las que
// tuvo; los bloques que la usan (tx = una de antes) se actualizan solos: en tu museo, en la sala donde estés y en tus
// otras salas cuando entrás (txAplicar, desde addWork). En la sala la imagen nueva sube una vez con la clave nueva y se
// reescribe tx en cada pose (los demás la bajan; un cliente viejo sigue viendo la vieja). Las caras no se actualizan.
const txReemplazos = new Map();                           // clave vieja → la entrada de ahora
const txClaveOk = g => typeof g === 'string' && /^[a-z0-9]{1,12}$/.test(g);
function txIndexar() { txReemplazos.clear(); for (const e of tx.lista) for (const g of e.antes || []) if (g !== e.g) txReemplazos.set(g, e); }
// el selector de archivo se abrió para la biblioteca: {tipo: 'tx', e} (cambiar la imagen de e) o {tipo: 'bloque'} (el bloque equipado)
let txArchivoPara = null;

// al arrancar: leer la biblioteca (una copia en memoria de cada blob: en WebKit un blob de IndexedDB leído mucho después falla)
async function txCargar() {
  try {
    const keys = await store('readonly', s => s.getAllKeys());
    const out = [];
    for (const k of keys || []) {
      if (typeof k !== 'string' || !k.startsWith('tex~')) continue;
      const o = await store('readonly', s => s.get(k));
      if (!o || !(o.img instanceof Blob) || !o.img.size || !(o.a > 0) || !Number.isFinite(o.a)) continue;
      try {
        const img = new Blob([await o.img.arrayBuffer()], { type: o.img.type || 'image/jpeg' });
        const mini = o.mini instanceof Blob && o.mini.size ? new Blob([await o.mini.arrayBuffer()], { type: o.mini.type || 'image/jpeg' }) : img;
        const antes = Array.isArray(o.antes) ? o.antes.filter(txClaveOk).slice(-20) : [];
        out.push({ id: o.id, g: String(o.g || k.slice(4)), a: o.a, t: Number.isFinite(o.t) ? o.t : 0, img, mini, antes });
      } catch (e) { diag('texturas: no pude leer una (' + e.message + ')'); }
    }
    out.sort((x, y) => y.t - x.t);                      // las más nuevas primero
    tx.lista = out;
    if (out.length) diag('texturas: ' + out.length);
  } catch (e) { diag('texturas: no pude abrir la biblioteca (' + (e && e.message) + ')'); }
  tx.cargada = true;
  txIndexar();
  txAplicarTodas();                                       // lo que ya cargó con una textura que cambiaste
  bloqueTxRecordar();                                     // la textura del bloque equipado (v10.30)
}

const txBlob = (c, q) => new Promise(res => c.toBlob(res, 'image/jpeg', q));
function txMini(c) {
  const k = Math.min(1, 168 / Math.max(c.width, c.height)), m = document.createElement('canvas');
  m.width = Math.max(1, Math.round(c.width * k)); m.height = Math.max(1, Math.round(c.height * k));
  m.getContext('2d').drawImage(c, 0, 0, m.width, m.height);
  return m;
}
// lo que se ve de la foto que tenés en la mano (repetida: la imagen entera), como textura nueva
async function txGuardar() {
  if (!held || held.work.vacio || held.work.rota) return;
  if (tx.lista.length >= TX_MAX) { showHint('ya tenés ' + TX_MAX + ' texturas: quitá alguna (tocá una foto en la mano → quitar)'); return; }
  const L = cur(), w = held.work;
  const uv = repValida(L.rep) ? FULL : (L.uv || FULL);
  const c = texLeer(w.tex, uv, TEX_MAX);
  if (!c) { showHint('no pude guardar la textura'); return; }
  const [img, mini] = await Promise.all([txBlob(c, 0.85), txBlob(txMini(c), 0.8)]);
  if (!img || !mini) { showHint('no pude guardar la textura'); diag('texturas: toBlob falló'); return; }
  const g = (Math.random().toString(36).slice(2) + '00000000').slice(0, 8);
  const e = { id: 'tex~' + g, g, a: c.height / c.width, t: Date.now(), img, mini };
  try { await store('readwrite', s => s.put({ id: e.id, g, img, mini, a: e.a, t: e.t })); }
  catch (err) { showHint('no pude guardar la textura'); diag('texturas: no pude guardar (' + (err && err.message) + ')'); return; }
  tx.lista.unshift(e);
  buzz(15);
  showHint('guardada en tus texturas (' + tx.lista.length + ') · para usarla, tocá una foto en la mano (en una caja: su cara → "foto")');
}

// abrir la hoja para elegir: para = {cara: i, held} (la foto de una cara) o {held} (llenar / cambiar la imagen)
function txAbrir(para) {
  tx.para = para; tx.quitar = false; tx.cambiar = false; tx.cambiando = null;
  txPintar();
  $('texHoja').style.display = '';
}
function txCerrar() {
  const el = $('texHoja');
  if (!el || el.style.display === 'none') return;
  el.style.display = 'none';
  tx.para = null; tx.quitar = false; tx.cambiar = false; tx.cambiando = null;
  $('texLista').textContent = '';
  for (const u of tx.urls) URL.revokeObjectURL(u);
  tx.urls = [];
}
const txAbierta = () => { const el = $('texHoja'); return !!el && el.style.display !== 'none'; };
function txPintar() {
  const lista = $('texLista');
  lista.textContent = '';
  for (const u of tx.urls) URL.revokeObjectURL(u);
  tx.urls = [];
  for (const e of tx.lista) {
    const im = document.createElement('img'), u = URL.createObjectURL(e.mini);
    tx.urls.push(u);
    im.src = u; im.alt = 'textura'; im.dataset.id = e.id;
    if (tx.cambiando === e) im.classList.add('elegida');
    im.addEventListener('click', () => txElegir(e));
    lista.appendChild(im);
  }
  const show = (id, on) => { $(id).style.display = on ? '' : 'none'; };
  $('texHoja').classList.toggle('quitando', tx.quitar);
  $('texHoja').classList.toggle('cambiando', tx.cambiar);
  $('texQuitar').classList.toggle('on', tx.quitar);
  $('texCambiar').classList.toggle('on', tx.cambiar);
  show('texQuitar', tx.lista.length && !tx.cambiar);
  show('texCambiar', tx.lista.length && !tx.quitar);
  show('texArchivo', !tx.cambiar && !tx.quitar);
  show('texVacio', !!(tx.para && tx.para.bloque && bloqueTx) && !tx.cambiar && !tx.quitar);
  const conMano = !!held && !held.aim && !held.work.vacio && !held.work.rota;
  show('texCambioOps', !!tx.cambiando);
  show('texCambioMano', conMano);
  $('texNota').textContent = tx.quitar ? 'tocá las que quieras sacar' : tx.cambiar ? (tx.cambiando ? '' : 'tocá la que querés cambiar: cambian todos los bloques que la usan')
    : tx.lista.length ? (tx.para && tx.para.bloque ? 'el bloque sale con la que elijas' : '') : 'todavía no guardaste ninguna';
}
async function txElegir(e) {
  if (tx.quitar) {
    tx.lista = tx.lista.filter(x => x !== e);
    txImgs.delete(e.g); txIndexar();
    store('readwrite', s => s.delete(e.id)).catch(() => {});
    buzz(10);
    txPintar();
    return;
  }
  if (tx.cambiar) { tx.cambiando = e; txPintar(); return; }
  const para = tx.para;
  txCerrar();
  if (para && para.bloque) { bloqueTxPoner(e); return; }   // la textura del bloque equipado (v10.30)
  if (!para || para.held !== held || !held) return;   // mientras tanto soltaste o agarraste otra cosa
  const u = URL.createObjectURL(e.img), img = new Image();
  try {
    img.src = u; await img.decode();
    if (para.held !== held || !held) return;
    if (para.cara) llenarCara(img, para.cara);
    else llenarBloque(img, true, e.g);
  } catch (err) { showHint('no pude abrir esa textura'); diag('texturas: no pude abrir una (' + (err && err.message) + ')'); }
  finally { URL.revokeObjectURL(u); }
}
// "cámara o galería" desde la hoja (es un click: Safari deja abrir el selector de archivo)
function txArchivo() {
  const para = tx.para;
  txCerrar();
  if (para && para.bloque) { archivoCara = null; txArchivoPara = { tipo: 'bloque' }; $('bloqueArchivo').click(); return; }
  if (!para || para.held !== held || !held) return;
  txArchivoPara = null;
  if (para.cara) { archivoCara = { i: para.cara, held }; }
  else archivoCara = null;
  $('bloqueArchivo').click();
}
// cambiar la imagen de la textura elegida: con cámara / galería (un click: Safari deja abrir el selector) o con lo que
// tenés en la mano (lo que se ve de ella, como "guardar textura")
function txCambioArchivo() {
  const e = tx.cambiando;
  if (!e) return;
  archivoCara = null; txArchivoPara = { tipo: 'tx', e };
  txCerrar();
  $('bloqueArchivo').click();
}
function txCambioMano() {
  const e = tx.cambiando;
  if (!e || !held || held.aim || held.work.vacio || held.work.rota) return;
  const L = cur(), c = texLeer(held.work.tex, repValida(L.rep) ? FULL : (L.uv || FULL), TEX_MAX);
  txCerrar();
  if (!c) { showHint('no pude leer la foto'); return; }
  txReemplazar(e, c);
}
async function txReemplazar(e, src) {
  if (!tx.lista.includes(e) || e.cambiando) return;      // (dos veces seguidas: la primera alcanza)
  e.cambiando = true;
  try { await txReemplazarYa(e, src); } finally { e.cambiando = false; }
}
async function txReemplazarYa(e, src) {
  const c = copiaCara(src, TEX_MAX);
  const [img, mini] = await Promise.all([txBlob(c, 0.85), txBlob(txMini(c), 0.8)]);
  if (!img || !mini) { showHint('no pude cambiar la textura'); return; }
  const g = (Math.random().toString(36).slice(2) + '00000000').slice(0, 8), id = 'tex~' + g;
  const antes = [...(e.antes || []), e.g].filter(txClaveOk).slice(-20), a = c.height / c.width;
  if (!tx.lista.includes(e)) return;                     // la quitaste mientras tanto
  try { await store('readwrite', s => { s.delete(e.id); s.put({ id, g, img, mini, a, t: e.t, antes }); }); }
  catch (err) { showHint('no pude cambiar la textura'); diag('texturas: no pude cambiar (' + (err && err.message) + ')'); return; }
  txImgs.delete(e.g);                                     // la imagen vieja ya no hace falta en memoria
  Object.assign(e, { id, g, img, mini, a, antes });
  txIndexar();
  if (bloqueTx && bloqueTx.e === e) bloqueTxPoner(e, true);
  const n = txAplicarTodas();
  buzz(15);
  showHint('textura cambiada' + (n ? ': ' + n + (n > 1 ? ' bloques' : ' bloque') + ' acá' : '') + ' · en tus otras salas, cuando entres');
}
// la imagen de una entrada (decodificada una vez por clave)
const txImgs = new Map();
function txImagen(e) {
  let p = txImgs.get(e.g);
  if (p) return p;
  p = (async () => { const u = URL.createObjectURL(e.img), im = new Image(); try { im.src = u; await im.decode(); return im; } finally { URL.revokeObjectURL(u); } })();
  txImgs.set(e.g, p);
  p.catch(() => txImgs.delete(e.g));
  return p;
}
// un bloque con una textura que cambiaste: toma la imagen nueva (si no la tenés en la mano ni está cambiando)
function txAplicar(w) {
  if (!w || !w.tx || w.vacio || w.rota || w.relleno || w.subiendo || (held && held.work === w)) return false;
  const e = txReemplazos.get(w.tx);
  if (!e || e.g === w.tx) return false;
  const viejo = w.tx;
  txImagen(e).then(img => {
    if (!works.includes(w) || w.tx !== viejo || w.vacio || w.relleno || w.subiendo || (held && held.work === w)) return;
    const ia = (img.naturalHeight || img.height) / (img.naturalWidth || img.width);
    gl.deleteTexture(w.tex); w.tex = texture(small(img)); w.aspect = ia;
    if (repValida(w.rep)) { w.rep = repDe(w.rep[0], ia); w.uv = FULL.slice(); } else w.uv = uvLlena(ia, w.h / w.w);
    w.tx = e.g; w.iv = Date.now();
    setBuf(w);
    if (sala.active) salaTxReemplazo(w, img, viejo);
    else store('readwrite', s => { const q = s.get(w.id); q.onsuccess = () => q.result && !q.result.vacio && s.put({ ...q.result, blob: e.img, tx: e.g, uv: w.uv, rep: w.rep, iv: w.iv }); }).catch(() => {});
  }).catch(() => diag('texturas: no pude abrir la nueva'));
  return true;
}
function txAplicarTodas() {
  if (!txReemplazos.size) return 0;
  let n = 0;
  for (const w of works.slice()) if (txAplicar(w)) n++;
  return n;
}
function txIniciar() {
  $('texCerrar').addEventListener('click', txCerrar);
  $('texArchivo').addEventListener('click', txArchivo);
  $('texQuitar').addEventListener('click', () => { tx.quitar = !tx.quitar; tx.cambiar = false; tx.cambiando = null; txPintar(); });
  $('texCambiar').addEventListener('click', () => { tx.cambiar = !tx.cambiar; tx.quitar = false; tx.cambiando = null; txPintar(); });
  $('texCambioArchivo').addEventListener('click', txCambioArchivo);
  $('texCambioMano').addEventListener('click', txCambioMano);
  $('texCambioNo').addEventListener('click', () => { tx.cambiando = null; txPintar(); });
  $('texVacio').addEventListener('click', () => { txCerrar(); bloqueTxPoner(null); });
}

// ---------- la textura del bloque equipado (v10.30, propuesta 21 de José) ----------
// Con el bloque equipado, tocar la vista previa abre la hoja: el bloque queda "cargado" con esa textura (o con una foto de
// la cámara o la galería) y cada bloque que ponés sale ya lleno con ella; "vacío" vuelve a los bloques vacíos. Se
// recuerda la textura elegida (localStorage 'bloqueTx' = su clave).
let bloqueTx = null;                                      // {e?, img, c, a, tex}
function bloqueTxPoner(e, callado) {
  const viejo = bloqueTx;
  if (!e) {
    bloqueTx = null;
    if (viejo && viejo.tex) gl.deleteTexture(viejo.tex);
    try { localStorage.removeItem('bloqueTx'); } catch (er) {}
    if (!callado) showHint('bloque vacío');
    return;
  }
  txImagen(e).then(img => bloqueTxDe(img, e, callado)).catch(() => showHint('no pude abrir esa textura'));
}
function bloqueTxDe(img, e, callado) {
  const viejo = bloqueTx;
  const c = copiaCara(img, 1024);
  // g: la de la biblioteca o, para una foto de la cámara / galería, una propia (así en la sala sube una vez para todos los bloques)
  bloqueTx = { e: e || null, g: e ? e.g : (Math.random().toString(36).slice(2) + '00000000').slice(0, 8), c, a: c.height / c.width, tex: texture(small(c)) };
  if (viejo && viejo.tex) gl.deleteTexture(viejo.tex);
  try { if (e) localStorage.setItem('bloqueTx', e.g); else localStorage.removeItem('bloqueTx'); } catch (er) {}
  if (!callado) { buzz(10); showHint('el bloque sale con esa imagen · tocalo para cambiarla'); }
}
function bloqueTxRecordar() {
  let g = null;
  try { g = localStorage.getItem('bloqueTx'); } catch (er) {}
  if (!g || bloqueTx) return;
  const e = tx.lista.find(x => x.g === g) || txReemplazos.get(g);
  if (e) bloqueTxPoner(e, true);
}
