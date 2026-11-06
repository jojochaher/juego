// juego — verse y escucharse en la sala (WebRTC)
// Cara: cámara frontal en la cabeza del personaje (solo con la cámara de fotos guardada: el iPhone no
// puede usar las dos a la vez). Micrófono con sonido espacial (más fuerte cuanto más cerca).
// La señalización (ofertas/respuestas) pasa por la misma sala de Firebase: salas/<hash>/rtc/<para>/<de>.
// Se carga ANTES que game.js: acá solo se definen funciones.

// Servidor puente (TURN) para cuando la conexión directa no pasa (otro país, datos móviles, wifi de hotel):
// cuenta de José en metered.ca, plan gratis de 500 MB por mes (si se pasa, el puente se corta; no cobra).
// La clave es pública a propósito (va en el juego): lo peor que puede pasar es que alguien gaste los 500 MB.
const RTC_TURN = { app: 'jojochaher-juego', key: '5495d02f64a548b1c01bb827ab437ad94919' };
const RTC_MIC = { echoCancellation: true, noiseSuppression: true };
const RTC_SOLO_PUENTE = new URLSearchParams(location.search).has('puente');
const RTC_STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

const rtc = {
  on: false, es: null,
  mic: null, cara: null,                 // MediaStreams propios
  peers: new Map(),                      // id -> { pc, video, audio, src, gain, panner, faceC, faceX, faceTex, faceOk, llamo }
  ctx: null, ice: null,
  micOn: true, caraOn: true,
};
try { rtc.micOn = localStorage.getItem('mic') !== '0'; rtc.caraOn = localStorage.getItem('cara') !== '0'; } catch (e) {}

// una sola vez por sesión; si falla, solo STUN por 60 s y se reintenta (en las pruebas con el mock, sin puente)
let rtcIcePedido = null, rtcIceFallo = 0;
function rtcIceServers() {
  if (rtc.ice) return Promise.resolve(rtc.ice);
  if (!RTC_TURN.app || /^http:\/\/localhost/.test(SALA_DB) || Date.now() - rtcIceFallo < 60000) return Promise.resolve(RTC_STUN.slice());
  if (!rtcIcePedido) rtcIcePedido = (async () => {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(`https://${RTC_TURN.app}.metered.live/api/v1/turn/credentials?apiKey=${RTC_TURN.key}`, { signal: ctl.signal });
      clearTimeout(t);
      const d = await r.json();
      if (!Array.isArray(d) || !d.length) throw new Error('respuesta rara');
      rtc.ice = RTC_STUN.concat(d);
      diag('rtc: puente listo');
      return rtc.ice;
    } catch (e) {
      rtcIceFallo = Date.now(); diag('rtc: no pude pedir el puente (' + (e.name || e.message) + ')');
      return RTC_STUN.slice();
    } finally { rtcIcePedido = null; }
  })();
  return rtcIcePedido;
}
// para el panel de la sala: con cuántos va directo, por el puente o todavía sin conectar
function rtcResumen() {
  let dir = 0, pte = 0, no = 0;
  for (const p of rtc.peers.values()) {
    if (p.pc.connectionState !== 'connected') no++;
    else if (p.puente) pte++; else dir++;
  }
  return { dir, pte, no };
}

// ---------- prender / apagar ----------
async function rtcStart() {
  if (rtc.on) return;
  rtc.on = true;
  rtc.es = new EventSource(salaUrl('rtc/' + salaYo));
  const onMsg = e => { try { const m = JSON.parse(e.data); rtcSenal(m.path, m.data); } catch (err) {} };
  rtc.es.addEventListener('put', onMsg);
  rtc.es.addEventListener('patch', onMsg);
  await rtcMedios();
  rtcSync();
}

function rtcStop() {
  if (!rtc.on) return;
  rtc.on = false;
  if (rtc.es) rtc.es.close();
  rtc.es = null;
  for (const id of [...rtc.peers.keys()]) rtcCerrar(id);
  for (const s of [rtc.mic, rtc.cara]) if (s) s.getTracks().forEach(t => t.stop());
  rtc.mic = rtc.cara = null;
  vozArmar();
  rtcPintar();
}

// micrófono y cara según preferencias y según si la cámara de fotos está equipada.
// De a un pedido por vez (dos pedidos juntos de la frontal en iPhone dejan una muerta) y recién después de tocar "entrar".
let rtcMediosCola = Promise.resolve();
function rtcMedios() { return (rtcMediosCola = rtcMediosCola.then(rtcMediosYa, rtcMediosYa)); }
const rtcViva = s => s && s.getTracks().some(t => t.readyState === 'live');
async function rtcMediosYa() {
  if (!rtc.on || !started) { rtcPintar(); return; }
  if (rtc.mic && !rtcViva(rtc.mic)) rtc.mic = null;
  if (rtc.cara && !rtcViva(rtc.cara)) rtc.cara = null;
  const quieroCara = rtc.caraOn && !camOn;
  // si faltan los dos, un solo pedido: el iPhone muestra un solo cartel (cámara y micrófono) en vez de dos
  if (rtc.micOn && !rtc.mic && quieroCara && !rtc.cara) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: RTC_MIC, video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 320 } } });
      if (s.getAudioTracks().length) rtc.mic = new MediaStream(s.getAudioTracks());
      if (s.getVideoTracks().length) rtc.cara = new MediaStream(s.getVideoTracks());
      if (rtc.cara && (!rtc.on || camOn || !rtc.caraOn)) { rtc.cara.getTracks().forEach(t => t.stop()); rtc.cara = null; }
    } catch (e) { diag('mic y cara juntos: falló ' + e.name + ', pruebo por separado'); }
  }
  if (rtc.micOn && !rtc.mic) {
    try { rtc.mic = await navigator.mediaDevices.getUserMedia({ audio: RTC_MIC, video: false }); }
    catch (e) { showHint('no pude abrir el micrófono'); diag('mic: falló ' + e.name); rtc.micOn = false; }
  }
  if (!rtc.micOn && rtc.mic) { rtc.mic.getTracks().forEach(t => t.stop()); rtc.mic = null; }
  if (quieroCara && !rtc.cara) {
    try {
      rtc.cara = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 320 } } });
      if (!rtc.on || camOn || !rtc.caraOn) { rtc.cara.getTracks().forEach(t => t.stop()); rtc.cara = null; }
    } catch (e) { diag('cara: falló ' + e.name); rtc.caraFallo = Date.now(); if (!rtc.caraAviso) showHint('no pude abrir la cámara frontal'); rtc.caraAviso = true; }
  }
  if (!quieroCara && rtc.cara) { rtc.cara.getTracks().forEach(t => t.stop()); rtc.cara = null; }
  if ((rtc.mic || vozCadena.prueba) !== vozCadena.micUsado) vozArmar();   // efecto de voz sobre el micrófono nuevo
  const yo = document.getElementById('yoCara');
  yo.srcObject = rtc.cara; yo.style.display = rtc.cara ? '' : 'none';
  if (rtc.cara) yo.play().catch(() => {});
  for (const p of rtc.peers.values()) rtcPonerPistas(p);
  rtcPintar();
}

// la cámara de fotos y la frontal no pueden estar a la vez: game.js avisa antes de prender la de fotos
function rtcSoltarCara() {
  if (rtc.cara) { rtc.cara.getTracks().forEach(t => t.stop()); rtc.cara = null; }
  for (const p of rtc.peers.values()) rtcPonerPistas(p);
  const yo = document.getElementById('yoCara'); yo.srcObject = null; yo.style.display = 'none';
}

// dos videos separados: el primero es tu cara, el segundo lo que encuadrás con la cámara de fotos
// (separados para que nunca se mezclen: si no, la cabeza del otro podía quedar congelada con la cámara trasera)
function rtcVideoVista() {
  const s = camOn && camReady && video.srcObject;
  const t = s && s.getVideoTracks()[0];
  return t && t.readyState === 'live' ? t : null;
}
const rtcVideos = pc => pc.getTransceivers().filter(t => t.receiver.track && t.receiver.track.kind === 'video');
function rtcPonerPistas(p) {
  const vids = rtcVideos(p.pc);
  for (const t of p.pc.getTransceivers()) {
    const kind = t.receiver.track && t.receiver.track.kind;
    if (!t.sender || t.stopped) continue;
    if (kind === 'audio') { const a = vozPista(); if (t.sender.track !== a) t.sender.replaceTrack(a).catch(() => {}); }
    if (kind === 'video') {
      const v = vids.indexOf(t) === 1 ? rtcVideoVista() : (rtc.cara ? rtc.cara.getVideoTracks()[0] : null);
      if (t.sender.track !== v) t.sender.replaceTrack(v).catch(() => {});
      rtcCalidad(t, vids.indexOf(t) === 1, p.puente);
    }
  }
}
// calidad: la cara se ve chica arriba del muñequito, no hace falta más. Por el servidor puente (TURN, se paga
// por GB) va todavía más liviano. Sin límite, WebRTC manda una cara de 320 px a ~500 kbps o más.
const RTC_KBPS = { cara: 150, caraPuente: 80, vista: 400, vistaPuente: 200 };
function rtcCalidad(t, esVista, puente) {
  const max = 1000 * RTC_KBPS[(esVista ? 'vista' : 'cara') + (puente ? 'Puente' : '')], fps = esVista ? 24 : 15;
  try {
    const prm = t.sender.getParameters(), e = prm.encodings && prm.encodings[0];
    if (e && (e.maxBitrate !== max || e.maxFramerate !== fps)) { e.maxBitrate = max; e.maxFramerate = fps; t.sender.setParameters(prm).catch(() => {}); }
  } catch (e) {}
}
// ¿la conexión con esta persona va por el servidor puente? (cuando la directa no pasa, ej. otro país o datos móviles)
async function rtcPorPuente(pc) {
  try {
    const st = await pc.getStats();
    let par = null;
    st.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) par = st.get(r.selectedCandidatePairId); });
    if (!par) st.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') par = r; });
    if (!par) return false;
    const l = st.get(par.localCandidateId), rr = st.get(par.remoteCandidateId);
    return !!((l && l.candidateType === 'relay') || (rr && rr.candidateType === 'relay'));
  } catch (e) { return false; }
}
function rtcPistas() { for (const p of rtc.peers.values()) rtcPonerPistas(p); }

// el iPhone corta el micrófono o la cámara sin avisar (otra app, llamada, fondo): si se murieron, se vuelven a abrir
setInterval(() => {
  if (!rtc.on || !started || document.hidden) return;
  const micMuerto = rtc.mic && !rtcViva(rtc.mic);
  const caraMuerta = rtc.cara && !rtcViva(rtc.cara);
  const faltaCara = !rtc.cara && rtc.caraOn && !camOn && Date.now() - (rtc.caraFallo || 0) > 10000;
  const faltaMic = !rtc.mic && rtc.micOn;
  if (micMuerto || caraMuerta) diag('rtc: ' + (micMuerto ? 'mic ' : '') + (caraMuerta ? 'cara ' : '') + 'muerto, reabro');
  if (micMuerto || caraMuerta || faltaCara || faltaMic) rtcMedios();
  else rtcPistas();   // por si la cámara de fotos se reabrió
}, 2000);

// ---------- con quién conectarse ----------
// por cada persona de la sala hay una conexión; llama el de id menor (así no se pisan)
function rtcSync() {
  if (!rtc.on) return;
  for (const id of sala.gente.keys()) if (!rtc.peers.has(id) && salaYo < id) rtcLlamar(id);
  for (const id of [...rtc.peers.keys()]) if (!sala.gente.has(id)) rtcCerrar(id);
}

async function rtcNuevo(id) {
  // ?puente: obliga a ir por el servidor puente (para probar que anda; gasta de los 500 MB)
  const pc = new RTCPeerConnection({ iceServers: await rtcIceServers(), iceTransportPolicy: RTC_SOLO_PUENTE ? 'relay' : 'all' });
  const p = { id, pc, faceOk: false };
  rtc.peers.set(id, p);
  pc.ontrack = e => rtcPistaRemota(p, e.track, e.transceiver);
  pc.onconnectionstatechange = () => {
    diag(`rtc ${id.slice(0, 4)}: ${pc.connectionState}`);
    if (typeof salaPintar === 'function') salaPintar();
    if (pc.connectionState === 'connected') rtcPorPuente(pc).then(v => {
      if (rtc.peers.get(id) !== p) return;
      if (v) diag(`rtc ${id.slice(0, 4)}: por el puente`);
      if (v !== !!p.puente) { p.puente = v; rtcPonerPistas(p); }
      if (typeof salaPintar === 'function') salaPintar();
    });
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      if (rtc.peers.get(id) === p) { rtcCerrar(id); setTimeout(rtcSync, 1500); }
    }
    // "disconnected" a veces se queda así un rato largo: si no vuelve en 4 s, se rearma
    if (pc.connectionState === 'disconnected') setTimeout(() => {
      if (rtc.peers.get(id) === p && pc.connectionState === 'disconnected') { diag(`rtc ${id.slice(0, 4)}: no vuelve, rearmo`); rtcCerrar(id); setTimeout(rtcSync, 500); }
    }, 4000);
  };
  return p;
}

async function rtcSdpCompleto(pc) {   // sin ir de a poco: se espera a juntar las rutas y se manda todo junto
  if (pc.iceGatheringState === 'complete') return pc.localDescription;
  await new Promise(res => {
    const t = setTimeout(res, 3500);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
  return pc.localDescription;
}

async function rtcLlamar(id) {
  const p = await rtcNuevo(id);
  p.llamo = true;
  p.pc.addTransceiver('audio', { direction: 'sendrecv' });
  p.pc.addTransceiver('video', { direction: 'sendrecv' });   // cara
  p.pc.addTransceiver('video', { direction: 'sendrecv' });   // lo que encuadra
  rtcPonerPistas(p);
  await p.pc.setLocalDescription(await p.pc.createOffer());
  const d = await rtcSdpCompleto(p.pc);
  if (rtc.peers.get(id) !== p) return;
  salaApi(`rtc/${id}/${salaYo}`, 'PUT', { type: 'offer', sdp: d.sdp, t: Date.now() }).catch(() => {});
}

async function rtcSenal(path, data) {
  if (!data) return;
  const parts = path.split('/').filter(Boolean);
  const msgs = parts.length === 0 ? data : { [parts[0]]: data };
  for (const from in msgs) {
    const m = msgs[from];
    if (!m || !m.type || !m.sdp || from === salaYo) continue;
    salaApi(`rtc/${salaYo}/${from}`, 'DELETE').catch(() => {});        // leído: borrar
    if (Date.now() - (m.t || 0) > 60000) continue;                      // viejo
    if (m.type === 'offer') {
      if (rtc.peers.has(from)) rtcCerrar(from);
      const p = await rtcNuevo(from);
      await p.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      for (const t of p.pc.getTransceivers()) t.direction = 'sendrecv';
      rtcPonerPistas(p);
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      const d = await rtcSdpCompleto(p.pc);
      if (rtc.peers.get(from) !== p) continue;
      salaApi(`rtc/${from}/${salaYo}`, 'PUT', { type: 'answer', sdp: d.sdp, t: Date.now() }).catch(() => {});
    } else if (m.type === 'answer') {
      const p = rtc.peers.get(from);
      if (p && p.pc.signalingState === 'have-local-offer') await p.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch(() => {});
    }
  }
}

function rtcCerrar(id) {
  const p = rtc.peers.get(id);
  if (!p) return;
  rtc.peers.delete(id);
  try { p.pc.close(); } catch (e) {}
  if (p.video) p.video.remove();
  if (p.vistaV) p.vistaV.remove();
  if (p.audio) p.audio.remove();
  if (p.src) try { p.src.disconnect(); } catch (e) {}
  for (const k of ['caraR', 'caraQ']) if (p[k]) gl.deleteTexture(p[k].tex);
  if (p.vistaTex) gl.deleteTexture(p.vistaTex);
}

// ---------- lo que llega del otro ----------
function rtcPistaRemota(p, track, tr) {
  const s = new MediaStream([track]);
  const key = track.kind === 'audio' ? 'audio' : rtcVideos(p.pc).indexOf(tr) === 1 ? 'vistaV' : 'video';
  track.onunmute = () => { const el = p[key]; if (el && el.paused) el.play().catch(() => {}); };
  if (track.kind === 'video') {
    if (!p[key]) { const v = p[key] = document.createElement('video'); v.playsInline = true; v.muted = true; v.className = 'oculto'; document.body.appendChild(v); }
    p[key].srcObject = s; p[key].play().catch(() => {});
  } else {
    // iOS: el audio remoto tiene que estar en un <audio> que reproduce (aunque sea mudo) para que WebAudio lo escuche
    if (!p.audio) { p.audio = document.createElement('audio'); p.audio.autoplay = true; p.audio.className = 'oculto'; document.body.appendChild(p.audio); }
    p.audio.srcObject = s;
    const ctx = rtcAudio();
    if (ctx) {
      p.audio.muted = true;
      p.src = ctx.createMediaStreamSource(s);
      p.gain = ctx.createGain();
      p.panner = ctx.createPanner();
      Object.assign(p.panner, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.2, maxDistance: 60, rolloffFactor: 1.2 });
      p.src.connect(p.gain).connect(p.panner).connect(ctx.destination);
    }
    p.audio.play().catch(() => {});
  }
}

function rtcAudio() {
  if (rtc.ctx) return rtc.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  rtc.ctx = new AC();
  return rtc.ctx;
}
// iOS solo deja sonar audio después de un toque
document.addEventListener('pointerdown', () => {
  if (rtc.ctx && rtc.ctx.state !== 'running') rtc.ctx.resume().catch(() => {});
  for (const p of rtc.peers.values()) { if (p.audio && p.audio.paused) p.audio.play().catch(() => {}); for (const v of [p.video, p.vistaV]) if (v && v.paused) v.play().catch(() => {}); }
}, true);

// sonido: el oído soy yo, la boca es la cabeza del otro
function rtcOido(b) {
  const ctx = rtc.ctx;
  if (!ctx) return;
  const L = ctx.listener, t = ctx.currentTime;
  if (L.positionX) {
    L.positionX.setValueAtTime(pos[0], t); L.positionY.setValueAtTime(pos[1], t); L.positionZ.setValueAtTime(pos[2], t);
    L.forwardX.setValueAtTime(b.f[0], t); L.forwardY.setValueAtTime(b.f[1], t); L.forwardZ.setValueAtTime(b.f[2], t);
    L.upX.setValueAtTime(b.u[0], t); L.upY.setValueAtTime(b.u[1], t); L.upZ.setValueAtTime(b.u[2], t);
  } else if (L.setPosition) { L.setPosition(...pos); L.setOrientation(...b.f, ...b.u); }
}
function rtcBoca(id, head) {
  const p = rtc.peers.get(id);
  if (!p || !p.panner || !rtc.ctx) return;
  const t = rtc.ctx.currentTime;
  if (p.panner.positionX) { p.panner.positionX.setValueAtTime(head[0], t); p.panner.positionY.setValueAtTime(head[1], t); p.panner.positionZ.setValueAtTime(head[2], t); }
  else p.panner.setPosition(...head);
}

// cara como textura, recortada con la proporción de la cabeza (aspect = alto / ancho).
// redonda: elipse (el resto transparente, el shader lo descarta); si no, rectángulo.
// congelar: está sosteniendo la cámara de fotos: queda la última imagen.
function rtcCaraDe(h, v, aspect, redonda, congelar) {
  const key = redonda ? 'caraR' : 'caraQ';
  let t = h[key];
  if (congelar) return t && t.ok ? t.tex : null;
  if (!v || v.readyState < 2 || !v.videoWidth) return null;
  if (!t) {
    t = h[key] = { c: document.createElement('canvas'), tex: gl.createTexture(), ok: false };
    t.x = t.c.getContext('2d');
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  const cw = 128, ch = Math.max(16, Math.round(128 * aspect));
  if (t.c.width !== cw || t.c.height !== ch) { t.c.width = cw; t.c.height = ch; }
  const vw = v.videoWidth, vh = v.videoHeight;
  let sw = vw, sh = vw * aspect;
  if (sh > vh) { sh = vh; sw = vh / aspect; }
  const x = t.x;
  x.clearRect(0, 0, cw, ch);
  x.save();
  if (redonda) { x.beginPath(); x.ellipse(cw / 2, ch / 2, cw / 2 - 1, ch / 2 - 1, 0, 0, Math.PI * 2); x.clip(); }
  x.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, cw, ch);
  x.restore();
  gl.bindTexture(gl.TEXTURE_2D, t.tex);
  const fmt = redonda ? gl.RGBA : gl.RGB;
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt, fmt, gl.UNSIGNED_BYTE, t.c);
  t.ok = true; t.cuando = performance.now();
  return t.tex;
}
function rtcCaraTex(id, aspect, redonda, congelar) {
  const p = rtc.peers.get(id);
  return p ? rtcCaraDe(p, p.video, aspect, redonda, congelar) : null;
}
// el último cuadro de su cara (para las caritas del borde de la pantalla): el lienzo que se actualizó más reciente y cuándo
function rtcCaraLienzo(id) {
  const p = rtc.peers.get(id);
  if (!p) return null;
  const ts = [p.caraR, p.caraQ].filter(t => t && t.ok);
  if (!ts.length) return null;
  return ts.reduce((a, b) => (b.cuando || 0) > (a.cuando || 0) ? b : a);   // { c: lienzo, cuando }
}
// tu propia cara (para verte en el editor de personaje)
const rtcYo = {};
function rtcMiCara(aspect, redonda) {
  return rtc.cara ? rtcCaraDe(rtcYo, document.getElementById('yoCara'), aspect, redonda, false) : null;
}

// lo que el otro está encuadrando con la cámara de fotos, como textura
function rtcVista(id) {
  const p = rtc.peers.get(id);
  if (!p || !p.vistaV || p.vistaV.readyState < 2 || !p.vistaV.videoWidth) return null;
  const v = p.vistaV, k = Math.min(1, 320 / Math.max(v.videoWidth, v.videoHeight));
  const w = Math.max(1, Math.round(v.videoWidth * k)), h = Math.max(1, Math.round(v.videoHeight * k));
  if (!p.vistaC) {
    p.vistaC = document.createElement('canvas'); p.vistaX = p.vistaC.getContext('2d');
    p.vistaTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, p.vistaTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  if (p.vistaC.width !== w || p.vistaC.height !== h) { p.vistaC.width = w; p.vistaC.height = h; }
  p.vistaX.drawImage(v, 0, 0, w, h);
  gl.bindTexture(gl.TEXTURE_2D, p.vistaTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, p.vistaC);
  return p.vistaTex;
}

// ---------- mic (botón arriba) / cara (tocar tu cara la apaga; la carita la prende) ----------
function rtcPintar() {
  const mic = document.getElementById('micBtn');
  mic.textContent = rtc.micOn ? 'mic: sí' : 'mic: no';
  mic.classList.toggle('on', !rtc.micOn);
  const enSala = typeof sala === 'object' && sala.active && typeof started !== 'undefined' && started;
  document.getElementById('yoCaraOff').style.display = enSala && !rtc.caraOn ? '' : 'none';
}
document.getElementById('micBtn').addEventListener('click', () => {
  rtc.micOn = !rtc.micOn;
  try { localStorage.setItem('mic', rtc.micOn ? '1' : '0'); } catch (e) {}
  if (!rtc.micOn && rtc.mic) { rtc.mic.getTracks().forEach(t => t.stop()); rtc.mic = null; }
  if (!rtc.micOn) sonCortarSala();   // una foto que grababa el sonido del lugar con este mic: se corta sin guardar (v10.17)
  rtcMedios();
});
function rtcCaraAlternar() {
  rtc.caraOn = !rtc.caraOn; rtc.caraAviso = false; rtc.caraFallo = 0;
  try { localStorage.setItem('cara', rtc.caraOn ? '1' : '0'); } catch (e) {}
  if (rtc.caraOn && camOn) showHint('tu cara se ve cuando guardás la cámara de fotos');
  rtcPintar();
  rtcMedios();
}
document.getElementById('yoCara').addEventListener('click', () => {
  if (!rtc.caraOn) return;
  rtcCaraAlternar();
  showHint('cara apagada · tocá la carita para prenderla');
});
document.getElementById('yoCaraOff').addEventListener('click', () => { if (!rtc.caraOn) rtcCaraAlternar(); });
rtcPintar();
