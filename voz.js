// juego — efectos de voz: se aplican ANTES de mandar, así todos te escuchan igual.
// tono: semitonos (-12 a +12), con el "pitch shifter" de líneas de retardo moduladas (Chris Wilson, "Jungle").
// efecto: nada / robot (modulación en anillo) / radio (filtro + saturación) / eco / cueva (reverb).
// Sin tono ni efecto se manda el micrófono tal cual (menos demora, nada que pueda fallar).
// Se carga ANTES que game.js: acá solo se definen funciones (y se enganchan los botones).

let voz = { tono: 0, efecto: 'nada', escucharme: false };
try { voz = { ...voz, ...JSON.parse(localStorage.getItem('voz') || '{}'), escucharme: false }; } catch (e) {}
const vozCadena = { nodos: [], fuentes: [], salida: null, dest: null, de: null, prueba: null };
const vozActiva = () => voz.tono !== 0 || voz.efecto !== 'nada';

function vozPitch(ctx) {
  const T = 0.1, F = 0.05, sr = ctx.sampleRate;
  const l1 = Math.round(T * sr), l2 = Math.round((T - 2 * F) * sr), n = l1 + l2;
  const buf = fn => { const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0); for (let i = 0; i < l1; i++) d[i] = fn(i); return b; };
  const bajar = buf(i => i / l1), subir = buf(i => (l1 - i) / n);
  const fl = F * sr, f2 = l1 - fl;
  const fundido = buf(i => i < fl ? Math.sqrt(i / fl) : i >= f2 ? Math.sqrt(Math.max(0, 1 - (i - f2) / fl)) : 1);
  const src = b => { const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; vozCadena.fuentes.push(s); return s; };
  const g = v => { const x = ctx.createGain(); x.gain.value = v; vozCadena.nodos.push(x); return x; };
  const entrada = g(1), salida = g(1);
  const m1 = src(bajar), m2 = src(bajar), m3 = src(subir), m4 = src(subir);
  const r = Math.pow(2, voz.tono / 12), arriba = r > 1;
  const g1 = g(arriba ? 0 : 1), g2 = g(arriba ? 0 : 1), g3 = g(arriba ? 1 : 0), g4 = g(arriba ? 1 : 0);
  const mult = arriba ? (r - 1) * 2 : (1 - r) * 2;
  const mg1 = g(0.5 * T * mult), mg2 = g(0.5 * T * mult);
  const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1); vozCadena.nodos.push(d1, d2);
  m1.connect(g1); m2.connect(g2); m3.connect(g3); m4.connect(g4);
  g1.connect(mg1); g3.connect(mg1); g2.connect(mg2); g4.connect(mg2);
  mg1.connect(d1.delayTime); mg2.connect(d2.delayTime);
  const f1 = src(fundido), f2b = src(fundido), x1 = g(0), x2 = g(0);
  f1.connect(x1.gain); f2b.connect(x2.gain);
  entrada.connect(d1); entrada.connect(d2); d1.connect(x1); d2.connect(x2); x1.connect(salida); x2.connect(salida);
  const t = ctx.currentTime + 0.05, t2 = t + T - F;
  m1.start(t); m2.start(t2); m3.start(t); m4.start(t2); f1.start(t); f2b.start(t2);
  return { entrada, salida };
}

function vozEfecto(ctx) {
  const reg = x => { vozCadena.nodos.push(x); return x; };
  const entrada = reg(ctx.createGain()), salida = reg(ctx.createGain());
  const e = voz.efecto;
  if (e === 'robot') {
    const ring = reg(ctx.createGain()); ring.gain.value = 0;
    const osc = ctx.createOscillator(); osc.frequency.value = 55; vozCadena.fuentes.push(osc);
    osc.connect(ring.gain); osc.start();
    entrada.connect(ring); ring.connect(salida); salida.gain.value = 1.6;
  } else if (e === 'radio') {
    const hp = reg(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 450;
    const lp = reg(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 2800;
    const ws = reg(ctx.createWaveShaper()); const c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; c[i] = Math.tanh(x * 4); }
    ws.curve = c;
    entrada.connect(hp); hp.connect(ws); ws.connect(lp); lp.connect(salida); salida.gain.value = 0.7;
  } else if (e === 'eco') {
    const d = reg(ctx.createDelay(1)); d.delayTime.value = 0.28;
    const fb = reg(ctx.createGain()); fb.gain.value = 0.42;
    const wet = reg(ctx.createGain()); wet.gain.value = 0.6;
    entrada.connect(salida); entrada.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(salida);
  } else if (e === 'cueva') {
    const cv = reg(ctx.createConvolver()), sr = ctx.sampleRate, n = Math.round(sr * 2.6);
    const ir = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
    cv.buffer = ir;
    const wet = reg(ctx.createGain()); wet.gain.value = 0.55;
    entrada.connect(salida); entrada.connect(cv); cv.connect(wet); wet.connect(salida);
  } else entrada.connect(salida);
  return { entrada, salida };
}

function vozDesarmar() {
  for (const s of vozCadena.fuentes) { try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} }
  for (const nd of vozCadena.nodos) { try { nd.disconnect(); } catch (e) {} }
  if (vozCadena.de) try { vozCadena.de.disconnect(); } catch (e) {}
  vozCadena.nodos = []; vozCadena.fuentes = []; vozCadena.salida = null; vozCadena.dest = null; vozCadena.de = null;
}
// arma la cadena con el micrófono que haya (el de la sala o uno de prueba para escucharte)
function vozArmar() {
  vozDesarmar();
  const mic = rtc.mic || vozCadena.prueba;
  vozCadena.micUsado = mic;
  const ctx = rtcAudio();
  if (!mic || !ctx || !(vozActiva() || voz.escucharme)) { rtcPistas(); return; }
  try {
    vozCadena.de = ctx.createMediaStreamSource(mic);
    const p = voz.tono !== 0 ? vozPitch(ctx) : null, ef = vozEfecto(ctx);
    if (p) { vozCadena.de.connect(p.entrada); p.salida.connect(ef.entrada); } else vozCadena.de.connect(ef.entrada);
    vozCadena.salida = ef.salida;
    vozCadena.dest = ctx.createMediaStreamDestination();
    ef.salida.connect(vozCadena.dest);
    if (voz.escucharme) ef.salida.connect(ctx.destination);
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  } catch (e) { diag('voz: no pude armar el efecto ' + e.message); vozDesarmar(); }
  rtcPistas();
}
// la pista de audio que se manda
function vozPista() {
  if (vozActiva() && vozCadena.dest && rtc.mic) return vozCadena.dest.stream.getAudioTracks()[0];
  return rtc.mic ? rtc.mic.getAudioTracks()[0] : null;
}

async function vozEscucharme(si) {
  voz.escucharme = si;
  if (si && !rtc.mic && !vozCadena.prueba) {
    try { vozCadena.prueba = await navigator.mediaDevices.getUserMedia({ audio: RTC_MIC }); }
    catch (e) { showHint('no pude abrir el micrófono'); voz.escucharme = false; }
  }
  if (!si && vozCadena.prueba) { vozCadena.prueba.getTracks().forEach(t => t.stop()); vozCadena.prueba = null; }
  if (si) showHint('con auriculares, si no se acopla');
  vozArmar(); vozPintar();
}
function vozGuardar() { try { localStorage.setItem('voz', JSON.stringify({ tono: voz.tono, efecto: voz.efecto })); } catch (e) {} }
function vozPintar() {
  for (const el of document.querySelectorAll('[data-efecto]')) el.classList.toggle('on', el.dataset.efecto === voz.efecto);
  document.getElementById('vozTono').value = voz.tono;
  document.getElementById('vozTonoVal').textContent = voz.tono === 0 ? '0' : (voz.tono > 0 ? '+' : '') + voz.tono;
  const esc = document.getElementById('vozEscuchar');
  esc.classList.toggle('on', voz.escucharme); esc.textContent = voz.escucharme ? 'escuchándome' : 'escucharme';
}
(() => {
  for (const el of document.querySelectorAll('[data-efecto]')) el.addEventListener('click', () => { voz.efecto = el.dataset.efecto; vozGuardar(); vozArmar(); vozPintar(); });
  const tono = document.getElementById('vozTono');
  tono.addEventListener('input', () => { voz.tono = +tono.value; vozPintar(); });
  tono.addEventListener('change', () => { vozGuardar(); vozArmar(); });
  document.getElementById('vozEscuchar').addEventListener('click', () => vozEscucharme(!voz.escucharme));
  vozPintar();
})();
