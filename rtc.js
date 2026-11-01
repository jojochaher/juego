// juego — verse y escucharse en la sala (WebRTC)
// Cara: cámara frontal en la cabeza del personaje (solo con la cámara de fotos guardada: el iPhone no
// puede usar las dos a la vez). Micrófono con sonido espacial (más fuerte cuanto más cerca).
// La señalización (ofertas/respuestas) pasa por la misma sala de Firebase: salas/<hash>/rtc/<para>/<de>.
// Se carga ANTES que game.js: acá solo se definen funciones.

// Servidor de relevo (TURN) para datos móviles: con cuenta gratis en metered.ca (Open Relay) se completa esto.
const RTC_TURN = { app: '', key: '' };   // ej: { app: 'juego', key: 'abc123' } -> https://juego.metered.live
const RTC_STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

const rtc = {
  on: false, es: null,
  mic: null, cara: null,                 // MediaStreams propios
  peers: new Map(),                      // id -> { pc, video, audio, src, gain, panner, faceC, faceX, faceTex, faceOk, llamo }
  ctx: null, ice: null,
  micOn: true, caraOn: true,
};
try { rtc.micOn = localStorage.getItem('mic') !== '0'; rtc.caraOn = localStorage.getItem('cara') !== '0'; } catch (e) {}

async function rtcIceServers() {
  if (rtc.ice) return rtc.ice;
  rtc.ice = RTC_STUN.slice();
  if (RTC_TURN.app && RTC_TURN.key) {
    try {
      const r = await fetch(`https://${RTC_TURN.app}.metered.live/api/v1/turn/credentials?apiKey=${RTC_TURN.key}`);
      rtc.ice = rtc.ice.concat(await r.json());
    } catch (e) {}
  }
  return rtc.ice;
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
  rtcPintar();
}

// micrófono y cara según preferencias y según si la cámara de fotos está equipada
async function rtcMedios() {
  if (!rtc.on) return;
  if (rtc.micOn && !rtc.mic) {
    try { rtc.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); }
    catch (e) { showHint('no pude abrir el micrófono'); rtc.micOn = false; }
  }
  if (!rtc.micOn && rtc.mic) { rtc.mic.getTracks().forEach(t => t.stop()); rtc.mic = null; }
  const quieroCara = rtc.caraOn && !camOn;
  if (quieroCara && !rtc.cara) {
    try {
      rtc.cara = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 320 } } });
      if (!rtc.on || camOn || !rtc.caraOn) { rtc.cara.getTracks().forEach(t => t.stop()); rtc.cara = null; }
    } catch (e) { showHint('no pude abrir la cámara frontal'); }
  }
  if (!quieroCara && rtc.cara) { rtc.cara.getTracks().forEach(t => t.stop()); rtc.cara = null; }
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

function rtcPonerPistas(p) {
  for (const t of p.pc.getTransceivers()) {
    const kind = t.receiver.track && t.receiver.track.kind;
    if (!t.sender || t.stopped) continue;
    if (kind === 'audio') t.sender.replaceTrack(rtc.mic ? rtc.mic.getAudioTracks()[0] : null).catch(() => {});
    if (kind === 'video') t.sender.replaceTrack(rtc.cara ? rtc.cara.getVideoTracks()[0] : null).catch(() => {});
  }
}

// ---------- con quién conectarse ----------
// por cada persona de la sala hay una conexión; llama el de id menor (así no se pisan)
function rtcSync() {
  if (!rtc.on) return;
  for (const id of sala.gente.keys()) if (!rtc.peers.has(id) && salaYo < id) rtcLlamar(id);
  for (const id of [...rtc.peers.keys()]) if (!sala.gente.has(id)) rtcCerrar(id);
}

async function rtcNuevo(id) {
  const pc = new RTCPeerConnection({ iceServers: await rtcIceServers() });
  const p = { id, pc, faceOk: false };
  rtc.peers.set(id, p);
  pc.ontrack = e => rtcPistaRemota(p, e.track);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      if (rtc.peers.get(id) === p) { rtcCerrar(id); setTimeout(rtcSync, 3000); }
    }
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
  p.pc.addTransceiver('video', { direction: 'sendrecv' });
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
  if (p.audio) p.audio.remove();
  if (p.src) try { p.src.disconnect(); } catch (e) {}
  if (p.faceTex) gl.deleteTexture(p.faceTex);
}

// ---------- lo que llega del otro ----------
function rtcPistaRemota(p, track) {
  const s = new MediaStream([track]);
  if (track.kind === 'video') {
    if (!p.video) { p.video = document.createElement('video'); p.video.playsInline = true; p.video.muted = true; p.video.className = 'oculto'; document.body.appendChild(p.video); }
    p.video.srcObject = s; p.video.play().catch(() => {});
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
  for (const p of rtc.peers.values()) { if (p.audio && p.audio.paused) p.audio.play().catch(() => {}); if (p.video && p.video.paused) p.video.play().catch(() => {}); }
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

// cara del otro como textura redonda (el resto es transparente y el shader lo descarta)
function rtcCara(id) {
  const p = rtc.peers.get(id);
  if (!p || !p.video || p.video.readyState < 2 || !p.video.videoWidth) return null;
  if (!p.faceC) {
    p.faceC = document.createElement('canvas'); p.faceC.width = p.faceC.height = 128;
    p.faceX = p.faceC.getContext('2d');
    p.faceTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, p.faceTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  const v = p.video, x = p.faceX, s = Math.min(v.videoWidth, v.videoHeight);
  x.clearRect(0, 0, 128, 128);
  x.save(); x.beginPath(); x.arc(64, 64, 63, 0, Math.PI * 2); x.clip();
  x.drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, 128, 128);
  x.restore();
  gl.bindTexture(gl.TEXTURE_2D, p.faceTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, p.faceC);
  p.faceOk = true;
  return p.faceTex;
}

// ---------- botones mic / cara ----------
function rtcPintar() {
  const mic = document.getElementById('micBtn'), cara = document.getElementById('caraBtn');
  mic.textContent = rtc.micOn ? 'mic: sí' : 'mic: no';
  cara.textContent = rtc.caraOn ? 'cara: sí' : 'cara: no';
  mic.classList.toggle('on', !rtc.micOn); cara.classList.toggle('on', !rtc.caraOn);
}
document.getElementById('micBtn').addEventListener('click', () => {
  rtc.micOn = !rtc.micOn;
  try { localStorage.setItem('mic', rtc.micOn ? '1' : '0'); } catch (e) {}
  if (!rtc.micOn && rtc.mic) { rtc.mic.getTracks().forEach(t => t.stop()); rtc.mic = null; }
  rtcMedios();
});
document.getElementById('caraBtn').addEventListener('click', () => {
  rtc.caraOn = !rtc.caraOn;
  try { localStorage.setItem('cara', rtc.caraOn ? '1' : '0'); } catch (e) {}
  if (rtc.caraOn && camOn) showHint('tu cara se ve cuando guardás la cámara de fotos');
  rtcMedios();
});
rtcPintar();
