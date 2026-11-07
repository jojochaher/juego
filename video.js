// ---------- videos cortos (v10.27, propuesta 6 de José) ----------
// Con la cámara en la mano, mantener apretado el disparador saca la foto (como siempre) y graba hasta VID_MAX_MS de video
// mientras lo tenés apretado. El video queda en loop en la foto, pero solo se mueven las VID_MAX más cercanas (a menos de
// VID_LEJOS); las demás muestran la foto quieta. No se graba con MediaRecorder: son VID_FPS cuadros chiquitos (VID_LADO px)
// en una sola imagen JPEG ("tira de cuadros", ~150-250 KB). Así anda igual en todos los navegadores, se sube y se guarda
// como una foto más, y la placa la tiene entera: dibujarla es elegir el pedazo del cuadro (cuadroUniformes en game.js; el
// shader mezcla un cuadro con el siguiente para que 8 por segundo no se vean a los saltos, y el último con el primero).
// vi = {n: cuadros, c: columnas, f: cuadros por segundo}; w.vid = la imagen (Blob). Cambiar o vaciar la imagen se lo saca.
// Museo: en el registro de la obra van vid y vi. Sala (v10.28): la tira va aparte, en imgs/<id>~vid, y la pose lleva vo;
// los demás la bajan recién al acercarse (salaVidSubir / salaVidBajar en sala.js).
// Ojo: nada de lo que corre al cargar puede usar cosas de game.js (solo adentro de funciones).
const VID_FPS = 8, VID_MAX_MS = 3000, VID_MIN = 4, VID_MIN_MS = 600;   // menos que eso queda solo la foto
const VID_ESPERA = 450;                               // cuánto hay que mantener apretado para que sea video
const VID_LADO = 240;                                 // el lado más largo de cada cuadro
const VID_KB = 280;                                   // tope de la imagen (en la sala va como texto: < 400 KB)
const VID_LEJOS = 10, VID_MAX = 4, VID_CACHE = 6;     // se mueven las VID_MAX más cercanas; VID_CACHE en la placa
const vid = { rec: null, espera: null, ptr: null, tragar: 0, texs: new Map(), activos: new Set(), t: 0, avisos: 0 };
try { vid.avisos = +localStorage.getItem('vidAviso') || 0; } catch (e) {}

function vidMetaValida(vi) {
  if (!vi || typeof vi !== 'object') return null;
  const n = vi.n, c = vi.c, f = vi.f;
  if (!Number.isInteger(n) || n < 2 || n > 64 || !Number.isInteger(c) || c < 1 || c > n || !Number.isFinite(f) || f < 1 || f > 30) return null;
  return { n, c, f };
}
const vidRedondo = x => Math.max(16, Math.round(x / 16) * 16);   // de a 16 px: los bloques del JPEG no mezclan dos cuadros

// ---------- grabar ----------
function vidPuede() {
  return started && camOn && camReady && video.videoWidth > 0 && !held && !bloqueOn && !vid.rec;
}
function vidApretar(e) {
  if (e.button > 0 || vid.espera || vid.rec || !vidPuede()) return;
  vid.ptr = e.pointerId;
  vid.espera = setTimeout(() => { vid.espera = null; vidEmpezar('ptr'); }, VID_ESPERA);
}
// via: 'ptr' (soltaste el dedo), 'tecla' (soltaste la V) o 'fondo' (la app se fue al fondo o perdió el foco)
function vidSoltar(via) {
  if (vid.espera) { clearTimeout(vid.espera); vid.espera = null; }
  // el click que viene después de soltar el dedo no saca otra foto (aunque ya haya cortado solo a los 3 s)
  if (vid.grabo === 'ptr' && via === 'ptr') { vid.tragar = performance.now() + 450; vid.tragarPtr = vid.ptrSoltado; }
  if (via === vid.grabo || via === 'fondo') vid.grabo = null;
  if (vid.rec) vidTerminar();
}
function vidEmpezar(via) {
  if (!vidPuede()) return;
  vid.grabo = via;                                    // (shoot no avisa "mantené apretado")
  const w = shoot();
  if (!w) { vid.grabo = null; return; }
  const vw = video.videoWidth, vh = video.videoHeight, k = VID_LADO / Math.max(vw, vh);
  const fw = vidRedondo(vw * k), fh = vidRedondo(vh * k), max = Math.round(VID_FPS * VID_MAX_MS / 1000);
  // los cuadros van directo a la tira (las columnas, para el máximo; al final se cortan las filas que sobran)
  const c = Math.max(1, Math.min(max, Math.ceil(Math.sqrt(max * fh / fw)))), tira = document.createElement('canvas');
  tira.width = c * fw; tira.height = Math.ceil(max / c) * fh;
  const r = vid.rec = { w, n: 0, c, tira, x: tira.getContext('2d'), fw, fh, t0: performance.now(), timer: null };
  const cuadro = () => {
    if (vid.rec !== r) return;
    if (!camOn || !camReady || held || !works.includes(w) || w.vacio || w.relleno || w.imgN) return vidTerminar();
    // un hueco largo (la app estuvo al fondo, o se trabó): termina con lo de antes (si no, el loop queda en cámara lenta)
    if (r.n && performance.now() - r.tFin > 700) return vidTerminar();
    if (video.readyState >= 2) {
      r.x.drawImage(video, (r.n % c) * fw, Math.floor(r.n / c) * fh, fw, fh);
      r.n++; r.tFin = performance.now();
      if (r.n === 1) r.tIni = r.tFin;
    }
    const s = (performance.now() - r.t0) / 1000;
    showHint('● video ' + s.toFixed(1).replace('.', ',') + ' s · soltá para terminar', true);
    if (r.n >= max || performance.now() - r.t0 >= VID_MAX_MS) vidTerminar();
  };
  r.timer = setInterval(cuadro, 1000 / VID_FPS);
  cuadro();
  shootBtn.classList.add('grabando');
  buzz(25);
  diag(`video ${String(w.id).slice(-6)}: grabando`);
}
function vidTerminar() {
  const r = vid.rec;
  if (!r) return;
  vid.rec = null;
  clearInterval(r.timer);
  shootBtn.classList.remove('grabando');
  const w = r.w, n = r.n, c = r.c;
  if (n < VID_MIN || r.tFin - r.tIni < VID_MIN_MS) {
    showHint(n ? 'muy corto para video: quedó la foto' : '');
    return;
  }
  const filas = Math.ceil(n / c);
  const tira = document.createElement('canvas'); tira.width = r.tira.width; tira.height = filas * r.fh;
  tira.getContext('2d').drawImage(r.tira, 0, 0);
  // los cuadros por segundo que salieron de verdad (con el celu ocupado el reloj se atrasa): el loop dura lo que duró
  const dur = (r.tFin - r.tIni) / 1000 + 1 / VID_FPS, f = Math.round(Math.min(12, Math.max(2, n / dur)) * 10) / 10;
  const vi = { n, c, f };
  showHint('video de ' + dur.toFixed(1).replace('.', ',') + ' s: se mueve cuando estás cerca');
  buzz(15);
  vidJpeg(tira).then(blob => {
    if (!blob) { diag('video: no pude armar la imagen'); return; }
    diag(`video ${String(w.id).slice(-6)}: ${n} cuadros, ${Math.round(blob.size / 1024)} KB`);
    vidPegar(w, blob, vi);
  });
}
// la tira en JPEG, bajando la calidad hasta que entre en VID_KB
async function vidJpeg(tira) {
  let b = null;
  for (const q of [0.62, 0.5, 0.4, 0.3]) {
    b = await new Promise(res => tira.toBlob(res, 'image/jpeg', q));
    if (b && b.size <= VID_KB * 1024) return b;
  }
  return null;   // ni con la peor calidad: queda la foto sola
}
// se pega a la foto si sigue siendo la misma imagen; en el museo se guarda en su registro, en la sala se sube
function vidPegar(w, blob, vi, intento = 0) {
  if (!works.includes(w) || w.vacio || w.imgN || w.relleno) return;
  if (!intento) { w.vid = blob; w.vi = vi; vidOlvidar(w.id); }
  if (sala.active) { if (!intento && w.subidaFoto) salaVidSubir(w, blob, vi, w.subidaFoto); return; }
  if (w.vid !== blob) return;
  store('readwrite', s => {
    const q = s.get(w.id);
    q.onsuccess = () => {
      if (q.result && q.result.blob && !q.result.vacio) s.put({ ...q.result, vid: blob, vi });
      else if (!q.result && intento < 5) setTimeout(() => vidPegar(w, blob, vi, intento + 1), 600);   // la foto todavía no se guardó
    };
  }).catch(() => {});
}
// otra imagen o vaciarla: el video era de la vieja
function vidQuitar(w) {
  w.vid = null; w.vi = undefined; w.vidSube = null;
  vidOlvidar(w.id);
}
// al cargar el museo: una copia en memoria (en WebKit un Blob de IndexedDB leído mucho después a veces ya no se lee)
function vidCopia(w, blob, vi) {
  const m = vidMetaValida(vi);
  if (!m) return;
  blob.arrayBuffer().then(ab => { if (works.includes(w) && !w.vacio && !w.imgN) { w.vid = new Blob([ab], { type: 'image/jpeg' }); w.vi = m; } })
    .catch(e => diag(`video ${String(w.id).slice(-6)}: no lo pude leer (${e && e.name || e})`));
}
// en las primeras 2 fotos con la cámara, un aviso: se puede mantener apretado (en la compu, la V)
function vidAvisar() {
  if (vid.avisos >= 2) return;
  vid.avisos++;
  try { localStorage.setItem('vidAviso', String(vid.avisos)); } catch (e) {}
  const antes = hint.innerHTML;   // si mientras tanto salió otro aviso (en la sala hay más), no lo tapa
  setTimeout(() => { if (!held && !vid.rec && (hint.style.opacity === '0' || hint.innerHTML === antes)) showHint(matchMedia('(pointer: coarse)').matches ? 'mantené apretado el disparador: graba un video de hasta 3 s' : 'mantené apretada la V: graba un video de hasta 3 s'); }, 4600);
}

// ---------- mirar ----------
function vidOlvidar(id) {
  const e = vid.texs.get(id);
  if (e && e.tex) gl.deleteTexture(e.tex);
  vid.texs.delete(id);
}
function vidCargar(w) {
  let e = vid.texs.get(w.id);
  if (e && e.blob === w.vid) { e.usado = performance.now(); return e; }
  if (e) vidOlvidar(w.id);
  e = { blob: w.vid, tex: null, error: false, usado: performance.now(), fase: Math.random() * 10, W: 0, H: 0 };
  vid.texs.set(w.id, e);
  const url = URL.createObjectURL(w.vid), img = new Image();
  img.src = url;
  img.decode().then(() => {
    URL.revokeObjectURL(url);
    if (vid.texs.get(w.id) !== e) return;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    e.tex = t; e.W = img.naturalWidth; e.H = img.naturalHeight;
  }).catch(err => { URL.revokeObjectURL(url); e.error = true; diag(`video ${String(w.id).slice(-6)}: no lo pude abrir (${err && err.name || err})`); });
  return e;
}
// cada cuadro (desde draw): cuáles se mueven. El cálculo cada 1/5 s. En la sala, las de los demás todavía no tienen la tira
// (w.vo sin w.vid): se baja recién cuando está entre las que se mueven
function vidPaso() {
  const ahora = performance.now();
  if (ahora - vid.t < 200) return;
  vid.t = ahora;
  const cerca = [];
  for (const w of works) {
    const fallo = w.vidPedido && w.vo && w.vidPedido.t === w.vo.t && w.vidPedido.intentos >= 4 && !w.vidPedido.cargando;   // no baja: no ocupa lugar
    if (!((w.vid && w.vi) || (sala.active && w.vo && !fallo)) || w.rota || w.vacio || w === cieloW) continue;
    const d = sonDist(w, pos);
    if (d < VID_LEJOS) cerca.push({ w, d });
  }
  cerca.sort((a, b) => a.d - b.d);
  vid.activos = new Set(cerca.slice(0, VID_MAX).map(o => o.w.id));
  for (const o of cerca.slice(0, VID_MAX)) if (o.w.vid && o.w.vi) vidCargar(o.w); else salaVidBajar(o.w);
  // en la placa: las que ya no están (o cambiaron) se borran, y de las otras quedan VID_CACHE
  const vivas = new Map(works.filter(w => w.vid).map(w => [w.id, w]));
  for (const [id, e] of [...vid.texs]) { const w = vivas.get(id); if (!w || w.vid !== e.blob) vidOlvidar(id); }
  if (vid.texs.size > VID_CACHE) {
    const viejas = [...vid.texs.entries()].filter(([id]) => !vid.activos.has(id)).sort((a, b) => a[1].usado - b[1].usado);
    for (const [id] of viejas.slice(0, vid.texs.size - VID_CACHE)) vidOlvidar(id);
  }
}
// qué cuadro mostrar ahora (o null: la foto quieta). a = [x, y, ancho, alto] del cuadro en la tira; b = [x, y] del siguiente
// y [medio pixel] (para no tomar el borde del vecino); m = cuánto del siguiente.
function vidCuadro(w) {
  if (!w.vid || !w.vi || w.relleno || !vid.activos.has(w.id)) return null;
  const e = vid.texs.get(w.id);
  if (!e || !e.tex || e.blob !== w.vid) return null;
  const { n, c, f } = w.vi, filas = Math.ceil(n / c);
  const s = ((performance.now() / 1000 + e.fase) * f) % n, i = Math.floor(s), j = (i + 1) % n;
  const fw = e.W / c, fh = e.H / filas;
  return { tex: e.tex, a: [(i % c) / c, Math.floor(i / c) / filas, 1 / c, 1 / filas], b: [(j % c) / c, Math.floor(j / c) / filas, 0.5 / fw, 0.5 / fh], m: s - i };
}

{
  const el = document.getElementById('shoot');
  if (el) {
    el.addEventListener('pointerdown', vidApretar);
    el.addEventListener('contextmenu', e => e.preventDefault());   // el toque largo no abre el menú del navegador
  }
  // soltar ese dedo (aunque ya no esté sobre el botón); los otros dedos no cuentan
  for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, e => { if (e.pointerId === vid.ptr) { vid.ptrSoltado = vid.ptr; vid.ptr = null; vidSoltar('ptr'); } }, true);
  window.addEventListener('blur', () => { vid.ptr = null; vid.tecla = false; vidSoltar('fondo'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { vid.ptr = null; vid.tecla = false; vidSoltar('fondo'); } });
  // el click que llega al soltar el video no saca otra foto ni toca lo que haya quedado abajo del dedo (en la ventana,
  // antes que el del botón): el de ese dedo, o uno en el disparador. Si no llega ninguno (Chrome después de un toque largo),
  // a lo sumo se traga un toque al disparador de hasta 0,45 s después.
  window.addEventListener('click', e => {
    if (vid.tragar && performance.now() < vid.tragar && ((e.pointerId != null && e.pointerId === vid.tragarPtr) || (e.target && e.target.closest && e.target.closest('#shoot')))) { e.stopPropagation(); e.preventDefault(); vid.tragar = 0; }
  }, true);
}
