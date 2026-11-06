// ---------- el sonido del lugar (v10.16-v10.17, propuesta 4 de José) ----------
// Al sacar una foto se graban SON_MS del sonido de ahí. Al acercarte a esa foto se escucha en loop, con sonido espacial
// (como las voces), y se apaga al alejarte. Suenan solo las SON_MAX más cercanas (con 200 fotos juntas sería un ruido).
// Se decodifica recién al acercarse y se guardan pocas decodificadas (cada una son ~800 KB de memoria). ☰ → "sonido del
// lugar" lo apaga. En el museo usa un micrófono propio, crudo (sin cancelación de eco ni de ruido: es el ambiente; en el
// iPhone es un cartel más cada vez que se abre la app). En la sala (v10.17) graba del micrófono de la voz (no pide otro:
// en el iPhone un segundo pedido puede callar el de la voz), así que con "mic: no" las fotos de la sala no graban; se sube
// a imgs/<id>~son y los demás lo bajan recién al acercarse (salaSonSubir / salaSonBajar en sala.js).
// También graba al llenar un bloque (o cambiar una foto) con la cámara (v10.17); de la galería no.
// Ojo: nada de lo que corre al cargar puede usar cosas de game.js (solo adentro de funciones).
const SON_MS = 4000, SON_BPS = 24000;
const SON_CERCA = 1.5, SON_LEJOS = 5;     // a menos de SON_CERCA suena entero; a SON_LEJOS ya no suena
const SON_MAX = 3;                        // cuántas suenan a la vez (las más cercanas)
const SON_CACHE = 6;                      // cuántas decodificadas se guardan
const SON_MIC_MS = 60000;                 // el micrófono queda abierto un rato después de grabar (si no, otro cartel)
const son = { on: true, grabando: 0, micNo: false, mic: null, micP: null, micT: null, sonando: new Map(), bufs: new Map(), t: 0, enSala: new Set() };
try { son.on = localStorage.getItem('sonido') !== '0'; } catch (e) {}

function sonTipo() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return null;
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } }) || null;
}
async function sonMic() {
  if (son.mic && son.mic.getAudioTracks().some(t => t.readyState === 'live')) return son.mic;
  son.mic = null;
  if (!son.micP) son.micP = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    .then(s => { son.mic = s; diag('sonido: micrófono abierto'); return s; })
    .finally(() => { son.micP = null; });
  return son.micP;
}
function sonMicCerrar() {
  clearTimeout(son.micT);
  if (son.grabando || !son.mic) return;
  son.mic.getTracks().forEach(t => t.stop()); son.mic = null;
  diag('sonido: micrófono cerrado');
}
function sonMicSoltar() {
  clearTimeout(son.micT);
  son.micT = setTimeout(sonMicCerrar, sala.active ? 0 : SON_MIC_MS);   // en la sala ya hay otro micrófono (el de la voz): este se cierra ya
}
// en la sala: una copia de la pista del micrófono de la voz (la crudo, antes del efecto de voz), o null si está apagado
function sonMicSala() {
  const t = rtc.mic && rtc.mic.getAudioTracks().find(t => t.readyState === 'live');
  if (!t) return null;
  const c = t.clone(); c.enabled = true;
  return new MediaStream([c]);
}
// graba el sonido de la foto recién sacada. listo(blob) se llama al terminar (blob null si no se pudo).
async function sonGrabar(id, listo) {
  if (!son.on || (son.micNo && !sala.active)) return;
  const tipo = sonTipo();
  if (!tipo) { if (!son.avisoTipo) { son.avisoTipo = true; diag('sonido: este navegador no graba audio'); } return; }
  let copia = null;
  if (sala.active) {
    copia = sonMicSala();
    if (!copia) {   // con "mic: no" no se graba (el micrófono apagado es apagado)
      if (rtc.micOn) diag('sonido: el micrófono de la sala todavía no está');
      else if (!son.avisoSalaMic) { son.avisoSalaMic = true; showHint('con el mic apagado las fotos de la sala quedan sin el sonido del lugar'); }
      return;
    }
  }
  son.grabando++;
  let fin = false;
  const terminar = blob => {
    if (fin) return; fin = true; son.grabando--; son.enSala.delete(terminar);
    if (copia) copia.getTracks().forEach(t => t.stop()); else sonMicSoltar();
    listo(blob);
  };
  if (copia) son.enSala.add(terminar);   // apagar el mic (o salir de la sala) en medio la corta y no se guarda nada
  setTimeout(() => { if (!fin) diag('sonido: la grabación no terminó'); terminar(null); }, SON_MS + 8000);   // si el micrófono o el grabador no responden nunca
  sonCallar();
  try {
    const s = copia || await Promise.race([sonMic(), new Promise((_, rej) => setTimeout(() => rej(new Error('el micrófono no responde')), 6000))]);
    if (fin) return;
    await new Promise(r => setTimeout(r, 150));   // que lo que suena termine de callarse (si no, se graba)
    if (fin) return;
    const rec = new MediaRecorder(new MediaStream(s.getAudioTracks()), { mimeType: tipo, audioBitsPerSecond: SON_BPS });
    const partes = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) partes.push(e.data); };
    rec.onstop = () => {
      const blob = partes.length ? new Blob(partes, { type: rec.mimeType || tipo }) : null;
      if (blob) diag(`sonido ${String(id).slice(-6)}: ${Math.round(blob.size / 1024)} KB (${blob.type})`);
      terminar(blob);
    };
    rec.onerror = e => { diag('sonido: falló la grabación (' + (e.error && e.error.name || e) + ')'); terminar(null); };
    rec.start();
    showHint('● grabando 4 s del sonido de acá');
    setTimeout(() => { try { if (rec.state !== 'inactive') rec.stop(); } catch (e) { terminar(null); } }, SON_MS);
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
      son.micNo = true;   // no lo pide de nuevo hasta que se recargue la app
      showHint('sin permiso del micrófono: la foto queda sin sonido<br>(☰ → sonido del lugar lo apaga)');
    }
    diag('sonido: sin micrófono (' + (e && e.name || e) + ')');
    terminar(null);
  }
}
// el mic de la voz se apagó o se cerró: las grabaciones de la sala se cortan sin guardar
function sonCortarSala() { for (const t of [...son.enSala]) t(null); }
function sonAlternar() {
  son.on = !son.on;
  son.micNo = false;
  try { localStorage.setItem('sonido', son.on ? '1' : '0'); } catch (e) {}
  sonPintar();
  if (!son.on) { sonApagarTodo(); sonMicCerrar(); }
  showHint(son.on ? 'cada foto que saques graba 4 s del sonido de ahí: se escucha al acercarte' + (sala.active && !rtc.micOn ? '<br>(en la sala, con el mic prendido)' : '')
    : 'sin sonido del lugar: las fotos no graban ni suenan');
}
function sonPintar() {
  const el = document.getElementById('opcSonido');
  if (el) { el.textContent = son.on ? 'sonido del lugar: sí' : 'sonido del lugar: no'; el.classList.toggle('on', !son.on); }
}

// ---------- escuchar ----------
// el loop sin costura: el final se funde con el principio (fundido de igual potencia) y se saca el arranque del grabador
function sonLoop(ctx, b) {
  const sr = b.sampleRate, cortar = Math.min(Math.round(0.12 * sr), Math.floor(b.length / 4));
  const L = b.length - cortar, X = Math.min(Math.round(0.4 * sr), Math.floor(L / 4));
  if (L - X < sr * 0.3) return b;
  const out = ctx.createBuffer(b.numberOfChannels, L - X, sr);
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const a = b.getChannelData(ch).subarray(cortar), o = out.getChannelData(ch);
    for (let i = 0; i < L - X; i++) {
      if (i < X) { const k = i / X; o[i] = a[i] * Math.sqrt(k) + a[L - X + i] * Math.sqrt(1 - k); }
      else o[i] = a[i];
    }
  }
  return out;
}
function sonBuffer(ctx, w) {
  let e = son.bufs.get(w.id);
  if (e && e.blob === w.son) { e.usado = performance.now(); return e; }
  e = { blob: w.son, buf: null, error: false, usado: performance.now() };
  son.bufs.set(w.id, e);
  w.son.arrayBuffer()
    .then(ab => new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); }))
    .then(b => { e.buf = sonLoop(ctx, b); })
    .catch(err => { e.error = true; diag(`sonido ${String(w.id).slice(-6)}: no lo pude abrir (${err && err.name || err})`); });
  if (son.bufs.size > SON_CACHE) {   // se olvida la que se usó hace más tiempo (y no está sonando)
    const viejas = [...son.bufs.entries()].filter(([id]) => !son.sonando.has(id)).sort((a, b) => a[1].usado - b[1].usado);
    for (const [id] of viejas.slice(0, son.bufs.size - SON_CACHE)) son.bufs.delete(id);
  }
  return e;
}
// distancia de un punto al rectángulo de la foto (una foto grande suena en toda su pared, no solo en el medio)
function sonDist(w, p) {
  const d = sub(p, w.c);
  const x = clamp(dot(d, w.r), -w.w / 2, w.w / 2), y = clamp(dot(d, w.u), -w.h / 2, w.h / 2);   // c es el centro
  return len(sub(d, add(mul(w.r, x), mul(w.u, y))));
}
const sonVol = d => d <= SON_CERCA ? 1 : d >= SON_LEJOS ? 0 : 1 - (d - SON_CERCA) / (SON_LEJOS - SON_CERCA);
function sonApagar(id, e, ctx, rapido) {
  const t = ctx.currentTime;
  e.g.gain.cancelScheduledValues(t); e.g.gain.setTargetAtTime(0, t, rapido ? 0.02 : 0.15);
  try { e.src.stop(t + (rapido ? 0.1 : 0.8)); } catch (er) {}
  son.sonando.delete(id);
}
// mientras graba, lo que suena se calla ya (sin esperar al próximo cálculo; sin cancelación de eco se grabaría)
function sonCallar() {
  const ctx = rtc.ctx;
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const e of son.sonando.values()) { e.vol = 0; e.g.gain.cancelScheduledValues(t); e.g.gain.setTargetAtTime(0, t, 0.02); }
}
function sonApagarTodo() {
  const ctx = rtc.ctx;
  if (!ctx) { son.sonando.clear(); return; }
  for (const [id, e] of [...son.sonando]) sonApagar(id, e, ctx, true);
}
// cada cuadro (desde draw): cuáles suenan y con qué volumen. El cálculo cada 1/5 s; el volumen cambia suave.
function sonPaso(b) {
  if (sala.active && son.mic && !son.grabando) sonMicCerrar();   // entraste a una sala: ahí está el micrófono de la voz
  if (document.hidden || !started || !son.on) { if (son.sonando.size && !son.on) sonApagarTodo(); return; }
  const ahora = performance.now();
  if (ahora - son.t < 200) return;
  son.t = ahora;
  const cerca = [];
  for (const w of works) {
    if (w.rota || w.vacio || w === cieloW) continue;
    if (!w.son && !(w.so && sala.active)) continue;
    const d = sonDist(w, pos);
    if (d >= SON_LEJOS) continue;
    if (!w.son) { salaSonBajar(w); continue; }   // en la sala el sonido se baja recién al acercarse
    cerca.push({ w, d });
  }
  if (!cerca.length && !son.sonando.size) return;
  const ctx = rtcAudio();
  if (!ctx) return;
  rtcOido(b);
  cerca.sort((a, b) => a.d - b.d);
  const elegidas = new Map(cerca.slice(0, SON_MAX).map(o => [o.w.id, o]));
  for (const [id, e] of [...son.sonando]) {
    const o = elegidas.get(id);
    if (!o || o.w.son !== e.blob) sonApagar(id, e, ctx);
  }
  const t = ctx.currentTime;
  for (const [id, { w, d }] of elegidas) {
    let e = son.sonando.get(id);
    if (!e) {
      const bb = sonBuffer(ctx, w);
      if (!bb.buf) continue;   // todavía se está decodificando (o no se pudo)
      const src = ctx.createBufferSource(); src.buffer = bb.buf; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0;
      const pn = ctx.createPanner();
      Object.assign(pn, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, rolloffFactor: 0 });   // el volumen lo maneja la distancia de acá
      src.connect(g).connect(pn).connect(ctx.destination);
      src.onended = () => { try { src.disconnect(); g.disconnect(); pn.disconnect(); } catch (er) {} };
      src.start(t, Math.random() * bb.buf.duration);   // cada una arranca en otro punto: dos juntas no suenan igual
      e = { src, g, pn, blob: w.son, vol: 0 };
      son.sonando.set(id, e);
    } else sonBuffer(ctx, w);   // la marca como usada
    const m = w.c;
    if (e.pn.positionX) { e.pn.positionX.setValueAtTime(m[0], t); e.pn.positionY.setValueAtTime(m[1], t); e.pn.positionZ.setValueAtTime(m[2], t); }
    else e.pn.setPosition(...m);
    e.vol = son.grabando ? 0 : sonVol(d) * 0.9;   // mientras graba se callan (si no, se graban a sí mismas)
    e.g.gain.setTargetAtTime(e.vol, t, 0.25);
  }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { sonApagarTodo(); sonMicCerrar(); } });
// al cargar el museo: una copia en memoria del sonido guardado (pesan ~10 KB). En WebKit, un Blob de IndexedDB leído
// mucho después (y con su registro reescrito al mover la foto) a veces ya no se puede leer.
function sonCopia(w, blob) {
  blob.arrayBuffer().then(ab => { if (works.includes(w) && !w.vacio && !w.imgN) w.son = new Blob([ab], { type: blob.type }); })
    .catch(e => diag(`sonido ${String(w.id).slice(-6)}: no lo pude leer (${e && e.name || e})`));
}
