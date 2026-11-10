// biblioteca de texturas (v10.23, propuesta 8 de José): fotos que se guardan para volver a usarlas.
// Con una foto en la mano, "guardar textura" guarda lo que se ve de ella (su recorte) en tu biblioteca, que es de este
// celu (sirve en tu museo y en cualquier sala). Al llenar un bloque, cambiar la imagen de una foto o ponerle otra foto a
// una cara de una caja, si tenés texturas se abre la hoja "tus texturas" (en vez de ir directo a cámara / galería).
// Guardado: en el mismo IndexedDB de las obras, registros 'tex~<g>' = {id, g, img: blob JPEG (≤512 px), mini: blob (≤168 px),
// a: alto/ancho, t}. No tienen blob ni vacio: loadWorks (también el de versiones viejas) los saltea.
// Ojo: nada de acá corre al cargar usando cosas de game.js (store, gl, held...): solo adentro de funciones.
const TX_MAX = 40;          // a lo sumo 40 (cada una ocupa ~50 KB en memoria; las miniaturas solo con la hoja abierta)
const tx = { lista: [], cargada: false, quitar: false, para: null, urls: [] };

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
        out.push({ id: o.id, g: String(o.g || k.slice(4)), a: o.a, t: Number.isFinite(o.t) ? o.t : 0, img, mini });
      } catch (e) { diag('texturas: no pude leer una (' + e.message + ')'); }
    }
    out.sort((x, y) => y.t - x.t);                      // las más nuevas primero
    tx.lista = out;
    if (out.length) diag('texturas: ' + out.length);
  } catch (e) { diag('texturas: no pude abrir la biblioteca (' + (e && e.message) + ')'); }
  tx.cargada = true;
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
  tx.para = para; tx.quitar = false;
  txPintar();
  $('texHoja').style.display = '';
}
function txCerrar() {
  const el = $('texHoja');
  if (!el || el.style.display === 'none') return;
  el.style.display = 'none';
  tx.para = null; tx.quitar = false;
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
    im.addEventListener('click', () => txElegir(e));
    lista.appendChild(im);
  }
  $('texHoja').classList.toggle('quitando', tx.quitar);
  $('texQuitar').classList.toggle('on', tx.quitar);
  $('texQuitar').style.display = tx.lista.length ? '' : 'none';
  $('texNota').textContent = tx.quitar ? 'tocá las que quieras sacar' : tx.lista.length ? '' : 'todavía no guardaste ninguna';
}
async function txElegir(e) {
  if (tx.quitar) {
    tx.lista = tx.lista.filter(x => x !== e);
    store('readwrite', s => s.delete(e.id)).catch(() => {});
    buzz(10);
    txPintar();
    return;
  }
  const para = tx.para;
  txCerrar();
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
  if (!para || para.held !== held || !held) return;
  if (para.cara) { archivoCara = { i: para.cara, held }; }
  else archivoCara = null;
  $('bloqueArchivo').click();
}
function txIniciar() {
  $('texCerrar').addEventListener('click', txCerrar);
  $('texArchivo').addEventListener('click', txArchivo);
  $('texQuitar').addEventListener('click', () => { tx.quitar = !tx.quitar; txPintar(); });
}
