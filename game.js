// juego — v4: museo en el vacío, con fotos en la mano
// Mirás con el giroscopio y ajustás arrastrando con el dedo (horizontal y vertical).
// Te movés con el joystick de abajo a la izquierda.
// Lo que tenés "en la mano" (la vista previa de la cámara, o una foto que agarraste)
// flota frente a vos: dos dedos = escala y giro, barra de la derecha = distancia.
// Obturador: la vista previa queda fija como foto. Tocar una foto la agarra; ✓ la suelta, tacho la borra.
const VERSION = 'v4.1';
document.getElementById('ver').textContent = VERSION;

const $ = id => document.getElementById(id);
const canvas = $('c'), video = $('vid'), hint = $('hint'), flash = $('flash'), startEl = $('start');
const joyEl = $('joy'), knobEl = $('knob'), distEl = $('dist'), distKnob = $('distKnob');
const shootBtn = $('shoot'), dropBtn = $('drop'), trashBtn = $('trash');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false });

window.addEventListener('error', e => showHint('error: ' + e.message));
window.addEventListener('unhandledrejection', e => showHint('error: ' + (e.reason && e.reason.message || e.reason)));

// --- unidades: metros. x derecha, y arriba, arrancás mirando -z ---
const EYE = 1.6;
const FOVX = 50 * Math.PI / 180;
const MOVE = 1.6;                 // m/s con el joystick a fondo
const LOOK = 0.0045;              // radianes por px de arrastre
const DIST_MIN = 0.3, DIST_MAX = 12;
const pos = [0, EYE, 0];

// ---------- vectores y cuaterniones ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function qmul(a, b) { // [x,y,z,w]
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qrot(q, v) {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [p[0], p[1], p[2]];
}
function qaxis(ax, ang) { const s = Math.sin(ang / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)]; }

// ---------- orientación: giroscopio + ajuste con el dedo ----------
let gyro = null, gyroMode = false;
let yawOff = 0, pitchOff = 0;     // lo que sumás arrastrando (radianes)

window.addEventListener('deviceorientation', e => {
  if (e.alpha == null) return;
  gyro = { a: e.alpha, b: e.beta, g: e.gamma };
  gyroMode = true;
});

function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  return typeof window.orientation === 'number' ? window.orientation : 0;
}

// giro del mundo (yaw) * giroscopio * inclinación propia (pitch, en el eje de la cámara)
function camQuat() {
  let q = [0, 0, 0, 1];
  if (gyroMode && gyro) {
    const R = Math.PI / 180;
    const x = gyro.b * R, y = gyro.a * R, z = -gyro.g * R; // euler YXZ (como DeviceOrientationControls)
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    q = [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
    q = qmul(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);   // la cámara mira por la espalda del celu
    q = qmul(q, qaxis([0, 0, 1], -screenAngle() * R));
  }
  return qmul(qmul(qaxis([0, 1, 0], yawOff), q), qaxis([1, 0, 0], pitchOff));
}

function basis() {
  const q = camQuat();
  return { f: qrot(q, [0, 0, -1]), u: qrot(q, [0, 1, 0]), r: qrot(q, [1, 0, 0]) };
}

// ---------- GL ----------
let W = 1, H = 1;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

function program(vs, fs) {
  const p = gl.createProgram();
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  return p;
}

const quadProg = program(`
attribute vec3 p; attribute vec2 uv; uniform mat4 m; varying vec2 v;
void main() { v = uv; gl_Position = m * vec4(p, 1.0); }`, `
precision mediump float; uniform sampler2D t; uniform vec3 tint; varying vec2 v;
void main() { gl_FragColor = vec4(texture2D(t, v).rgb * tint, 1.0); }`);
const Q = {
  p: gl.getAttribLocation(quadProg, 'p'), uv: gl.getAttribLocation(quadProg, 'uv'),
  m: gl.getUniformLocation(quadProg, 'm'), tint: gl.getUniformLocation(quadProg, 'tint'),
};

// puntitos del piso (para sentir que te movés)
const dotProg = program(`
attribute vec3 p; uniform mat4 m; uniform vec3 eye; varying float a;
void main() {
  gl_Position = m * vec4(p, 1.0);
  float d = distance(p, eye);
  a = clamp(1.0 - d / 12.0, 0.0, 1.0);
  gl_PointSize = clamp(30.0 / d, 2.0, 14.0);
}`, `
precision mediump float; varying float a;
void main() {
  if (length(gl_PointCoord - 0.5) > 0.5) discard;
  gl_FragColor = vec4(vec3(1.0), a * 0.5);
}`);
const DP = { p: gl.getAttribLocation(dotProg, 'p'), m: gl.getUniformLocation(dotProg, 'm'), eye: gl.getUniformLocation(dotProg, 'eye') };
const GRID = 12;
const dotBuf = gl.createBuffer();
const dotData = new Float32Array((GRID * 2 + 1) ** 2 * 3);

function texture(src) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255]));
  return t;
}
const white = texture(null);
const videoTex = texture(null);
// el video pasa por un canvas 2D chico antes de WebGL
const vc = document.createElement('canvas'), vcx = vc.getContext('2d');
function videoFrame() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const k = Math.min(1, 640 / Math.max(vw, vh));
  const w = Math.round(vw * k), h = Math.round(vh * k);
  if (vc.width !== w || vc.height !== h) { vc.width = w; vc.height = h; }
  vcx.drawImage(video, 0, 0, w, h);
  return vc;
}

// texturas de obras a 512px: entran muchas en la memoria del iPhone
const TEX_MAX = 512;
const smallC = document.createElement('canvas'), smallX = smallC.getContext('2d');
function small(src) {
  const sw = src.naturalWidth || src.videoWidth || src.width, sh = src.naturalHeight || src.videoHeight || src.height;
  const k = Math.min(1, TEX_MAX / Math.max(sw, sh));
  smallC.width = Math.max(1, Math.round(sw * k)); smallC.height = Math.max(1, Math.round(sh * k));
  smallX.drawImage(src, 0, 0, smallC.width, smallC.height);
  return smallC;
}

function quadData(c, r, u, w, h) {
  const pt = (sx, sy) => add(c, add(mul(r, w / 2 * sx), mul(u, h / 2 * sy)));
  return new Float32Array([
    ...pt(-1, 1), 0, 0, ...pt(1, 1), 1, 0, ...pt(-1, -1), 0, 1,
    ...pt(1, 1), 1, 0, ...pt(1, -1), 1, 1, ...pt(-1, -1), 0, 1,
  ]);
}
const scratch = gl.createBuffer();
function drawQuad(buf, data, tex, tint) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  if (data) gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(Q.p); gl.vertexAttribPointer(Q.p, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(Q.uv); gl.vertexAttribPointer(Q.uv, 2, gl.FLOAT, false, 20, 12);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform3fv(Q.tint, tint);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}
// cuadro con marco de color, el marco un centímetro detrás
function drawFramed(p, f, tex, color) {
  drawQuad(scratch, quadData(add(p.c, mul(f, 0.01)), p.r, p.u, p.w + 0.03 * Math.max(1, p.w), p.h + 0.03 * Math.max(1, p.w)), white, color);
  drawQuad(scratch, quadData(p.c, p.r, p.u, p.w, p.h), tex, [1, 1, 1]);
}

function tans() { const tx = Math.tan(FOVX / 2); return [tx, tx * H / W]; }

function matrix(b) {
  const { f, r, u } = b;
  const [tx, ty] = tans();
  const n = 0.03, fa = 200;
  const A = (fa + n) / (n - fa), B = 2 * fa * n / (n - fa);
  const sx = 1 / tx, sy = 1 / ty;
  return new Float32Array([
    sx * r[0], sy * u[0], -A * f[0], f[0],
    sx * r[1], sy * u[1], -A * f[1], f[1],
    sx * r[2], sy * u[2], -A * f[2], f[2],
    -sx * dot(r, pos), -sy * dot(u, pos), A * dot(f, pos) + B, -dot(f, pos),
  ]);
}

// ---------- obras ----------
const works = []; // {id, c, r, u, w, h, tex, buf}

function setBuf(w) {
  gl.bindBuffer(gl.ARRAY_BUFFER, w.buf);
  gl.bufferData(gl.ARRAY_BUFFER, quadData(w.c, w.r, w.u, w.w, w.h), gl.STATIC_DRAW);
}
function addWork(o, img) {
  const w = { id: o.id, c: o.c, r: o.r, u: o.u, w: o.w, h: o.h, tex: texture(small(img)), buf: gl.createBuffer() };
  setBuf(w);
  works.push(w);
  return w;
}

// ---------- lo que tenés en la mano ----------
// ang = ancho / distancia (tamaño aparente), roll = giro sobre la línea de mirada
const DEFAULT_ANG = 2 * Math.tan(FOVX / 2) * 0.58;
const hold = { dist: 1.0, ang: DEFAULT_ANG, roll: 0, aspect: 4 / 3, work: null };
let previewSaved = null;   // cómo estaba la vista previa antes de agarrar una foto

function heldPose(b) {
  const cr = Math.cos(hold.roll), sr = Math.sin(hold.roll);
  const r = add(mul(b.r, cr), mul(b.u, sr));
  const u = sub(mul(b.u, cr), mul(b.r, sr));
  const w = hold.ang * hold.dist;
  return { c: add(pos, mul(b.f, hold.dist)), r, u, w, h: w * hold.aspect };
}

function pick(w) {
  if (hold.work) return;
  const b = basis();
  previewSaved = { dist: hold.dist, ang: hold.ang, roll: hold.roll };
  hold.work = w;
  hold.dist = clamp(len(sub(w.c, pos)), DIST_MIN, DIST_MAX);
  hold.ang = w.w / hold.dist;
  hold.aspect = w.h / w.w;
  hold.roll = Math.atan2(dot(w.r, b.u), dot(w.r, b.r));
  buzz(12);
  ui();
}

function releaseHold() {
  hold.work = null;
  if (previewSaved) Object.assign(hold, previewSaved);
  previewSaved = null;
  ui();
}

function drop() {
  const w = hold.work;
  if (!w) return;
  Object.assign(w, heldPose(basis()));
  setBuf(w);
  const pose = { c: w.c, r: w.r, u: w.u, w: w.w, h: w.h };
  store('readwrite', s => { const q = s.get(w.id); q.onsuccess = () => q.result && s.put({ ...q.result, ...pose }); }).catch(() => {});
  buzz(12);
  releaseHold();
}

function trash() {
  const w = hold.work;
  if (!w) return;
  works.splice(works.indexOf(w), 1);
  gl.deleteTexture(w.tex); gl.deleteBuffer(w.buf);
  store('readwrite', s => s.delete(w.id)).catch(() => {});
  buzz(20);
  releaseHold();
}

// qué foto hay debajo de un punto de la pantalla
function workAt(x, y) {
  const b = basis();
  const [tx, ty] = tans();
  const nx = (x / W) * 2 - 1, ny = 1 - (y / H) * 2;
  const d = norm(add(b.f, add(mul(b.r, nx * tx), mul(b.u, ny * ty))));
  let best = null, bestT = Infinity;
  for (const w of works) {
    if (w === hold.work) continue;
    const n = cross(w.r, w.u);
    const den = dot(d, n);
    if (Math.abs(den) < 1e-6) continue;
    const t = dot(sub(w.c, pos), n) / den;
    if (t <= 0 || t >= bestT) continue;
    const p = sub(add(pos, mul(d, t)), w.c);
    if (Math.abs(dot(p, w.r)) <= w.w / 2 && Math.abs(dot(p, w.u)) <= w.h / 2) { best = w; bestT = t; }
  }
  return best;
}

// ---------- guardado (solo en el celu) ----------
const db = new Promise((res, rej) => {
  const r = indexedDB.open('juego', 2);
  r.onupgradeneeded = () => {
    if (!r.result.objectStoreNames.contains('obras')) r.result.createObjectStore('obras', { keyPath: 'id' });
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function store(mode, fn) {
  const d = await db;
  return new Promise((res, rej) => {
    const tx = d.transaction('obras', mode);
    const out = fn(tx.objectStore('obras'));
    tx.oncomplete = () => res(out && out.result); tx.onerror = () => rej(tx.error);
  });
}
async function loadWorks() {
  if (/[?&]borrar/.test(location.search)) {           // escape: jojochaher.github.io/juego/?borrar
    await store('readwrite', s => s.clear());
    history.replaceState(null, '', location.pathname);
  }
  const keys = await store('readonly', s => s.getAllKeys());
  for (const k of keys || []) {                       // de a una, para no juntar todas en memoria
    const o = await store('readonly', s => s.get(k));
    if (!o || !o.blob) continue;
    const url = URL.createObjectURL(o.blob);
    const img = new Image(); img.src = url;
    try { await img.decode(); addWork(o, img); } catch (e) {}
    img.src = ''; URL.revokeObjectURL(url);
    await new Promise(r => setTimeout(r, 0));
  }
}

// ---------- cámara ----------
let camReady = false;
async function startCamera() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: 'environment', width: { ideal: 960 }, height: { ideal: 960 } },
    });
    video.srcObject = s;
    await video.play();
    camReady = true;
  } catch (e) {
    showHint('no pude abrir la cámara: ' + (e && e.name || e), true);
  }
  ui();
}

function shoot() {
  if (!camReady || !video.videoWidth || hold.work) return;
  const pose = heldPose(basis());
  const k = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  const o = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), ...pose };
  addWork(o, c);
  c.toBlob(blob => store('readwrite', s => s.put({ ...o, blob })).catch(() => {}), 'image/jpeg', 0.85);
  flash.style.transition = 'none'; flash.style.opacity = 0.7;
  requestAnimationFrame(() => { flash.style.transition = 'opacity 0.35s'; flash.style.opacity = 0; });
  buzz(15);
}

function buzz(ms) { if (navigator.vibrate) navigator.vibrate(ms); }

// ---------- texto y botones ----------
let hintTimer = null;
function showHint(t, stay) {
  hint.innerHTML = t; hint.style.opacity = 1;
  clearTimeout(hintTimer);
  if (!stay) hintTimer = setTimeout(() => { hint.style.opacity = 0; }, 7000);
}

let started = false;
function ui() {
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };
  show(joyEl, started);
  show(invEl, started);
  show(distEl, started && (camReady || hold.work));
  show(shootBtn, started && camReady && !hold.work);
  show(dropBtn, started && !!hold.work);
  show(trashBtn, started && !!hold.work);
  distKnob.style.top = (1 - distT(hold.dist)) * 100 + '%';
}

shootBtn.addEventListener('click', shoot);

// ---------- invertir el arrastre de la cámara (se guarda en el celu) ----------
const invEl = $('inv');
let invertLook = false;
try { invertLook = localStorage.getItem('invertir') === '1'; } catch (e) {}
function paintInv() { invEl.textContent = invertLook ? 'arrastre: invertido' : 'arrastre: normal'; invEl.classList.toggle('on', invertLook); }
invEl.addEventListener('click', () => {
  invertLook = !invertLook;
  try { localStorage.setItem('invertir', invertLook ? '1' : '0'); } catch (e) {}
  paintInv();
});
paintInv();
dropBtn.addEventListener('click', drop);
trashBtn.addEventListener('click', trash);

// ---------- barra de distancia (arriba = más lejos) ----------
const LMIN = Math.log(DIST_MIN), LMAX = Math.log(DIST_MAX);
const distT = d => (Math.log(d) - LMIN) / (LMAX - LMIN);
function distFromY(y) {
  const r = distEl.getBoundingClientRect();
  const t = clamp(1 - (y - r.top) / r.height, 0, 1);
  hold.dist = Math.exp(LMIN + t * (LMAX - LMIN));
  distKnob.style.top = (1 - t) * 100 + '%';
}
let distPtr = null;
distEl.addEventListener('pointerdown', e => { distPtr = e.pointerId; distEl.setPointerCapture(e.pointerId); distFromY(e.clientY); });
distEl.addEventListener('pointermove', e => { if (e.pointerId === distPtr) distFromY(e.clientY); });
distEl.addEventListener('pointerup', e => { if (e.pointerId === distPtr) distPtr = null; });
distEl.addEventListener('pointercancel', e => { if (e.pointerId === distPtr) distPtr = null; });

// ---------- joystick ----------
const joy = { x: 0, y: 0, id: null };
const JOY_R = 50;
function joyUpdate(e) {
  const r = joyEl.getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const l = Math.hypot(dx, dy);
  if (l > JOY_R) { dx *= JOY_R / l; dy *= JOY_R / l; }
  joy.x = dx / JOY_R; joy.y = dy / JOY_R;
  knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
}
function joyEnd(e) {
  if (e.pointerId !== joy.id) return;
  joy.id = null; joy.x = joy.y = 0;
  knobEl.style.transform = '';
}
joyEl.addEventListener('pointerdown', e => { joy.id = e.pointerId; joyEl.setPointerCapture(e.pointerId); joyUpdate(e); });
joyEl.addEventListener('pointermove', e => { if (e.pointerId === joy.id) joyUpdate(e); });
joyEl.addEventListener('pointerup', joyEnd);
joyEl.addEventListener('pointercancel', joyEnd);

// ---------- dedos sobre la pantalla: mirar, agarrar, escala y giro ----------
const touches = new Map(); // id -> {x, y, x0, y0, t0, moved}
let gesture = null;        // dos dedos: {d0, a0, ang0, roll0}

function twoFingers() {
  const [a, b] = [...touches.values()];
  return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
}

canvas.addEventListener('pointerdown', e => {
  if (!started) return;
  canvas.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false });
  if (touches.size === 2) {
    const g = twoFingers();
    gesture = { d0: g.d, a0: g.a, ang0: hold.ang, roll0: hold.roll };
    for (const t of touches.values()) t.moved = true;  // ya no es un toque
  }
});

canvas.addEventListener('pointermove', e => {
  const t = touches.get(e.pointerId);
  if (!t) return;
  const dx = e.clientX - t.x, dy = e.clientY - t.y;
  t.x = e.clientX; t.y = e.clientY;
  if (touches.size >= 2 && gesture) {
    const g = twoFingers();
    hold.ang = clamp(gesture.ang0 * g.d / Math.max(10, gesture.d0), 0.05, 4);
    let da = g.a - gesture.a0;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    hold.roll = gesture.roll0 - da;
    return;
  }
  if (!t.moved && Math.hypot(t.x - t.x0, t.y - t.y0) > 8) t.moved = true;
  if (!t.moved) return;
  // normal: el mundo sigue al dedo. invertido: la cámara sigue al dedo
  const k = invertLook ? -LOOK : LOOK;
  yawOff += dx * k;
  pitchOff = clamp(pitchOff + dy * k, -1.4, 1.4);
});

function endTouch(e) {
  const t = touches.get(e.pointerId);
  if (!t) return;
  touches.delete(e.pointerId);
  if (touches.size < 2) gesture = null;
  if (e.type === 'pointerup' && !t.moved && performance.now() - t.t0 < 350) {
    const w = workAt(e.clientX, e.clientY);
    if (w) pick(w);
  }
}
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);

// ---------- arranque (en iPhone los permisos necesitan un toque) ----------
startEl.addEventListener('click', async () => {
  if (started) return;
  started = true;
  let perm = Promise.resolve();
  if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
    perm = DeviceOrientationEvent.requestPermission().catch(() => {});
  }
  const camP = startCamera();
  await perm;
  startEl.remove();
  ui();
  await camP;
  showHint('joystick para moverte · arrastrá para mirar<br>dos dedos: tamaño y giro · barra: distancia<br>tocá una foto para agarrarla');
});

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  try { draw(now); } catch (e) { showHint('error: ' + e.message); }
  requestAnimationFrame(frame);
}
function draw(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const b = basis();

  // joystick: adelante/atrás y costado, siempre sobre el piso
  if (joy.x || joy.y) {
    let fw = [b.f[0], 0, b.f[2]];
    if (len(fw) < 0.2) fw = [b.u[0], 0, b.u[2]];      // mirando derecho al piso o al techo
    fw = norm(fw);
    const rt = norm(cross(fw, [0, 1, 0]));
    const v = add(mul(fw, -joy.y), mul(rt, joy.x));
    pos[0] += v[0] * MOVE * dt; pos[2] += v[2] * MOVE * dt;
  }

  if (camReady && video.videoWidth && !hold.work) hold.aspect = video.videoHeight / video.videoWidth;

  gl.clearColor(0.04, 0.04, 0.05, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const m = matrix(b);

  // piso de puntos
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(dotProg);
  const gx = Math.round(pos[0]), gz = Math.round(pos[2]);
  let i = 0;
  for (let x = -GRID; x <= GRID; x++) for (let z = -GRID; z <= GRID; z++) {
    dotData[i++] = gx + x; dotData[i++] = 0; dotData[i++] = gz + z;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, dotBuf);
  gl.bufferData(gl.ARRAY_BUFFER, dotData, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(DP.p); gl.vertexAttribPointer(DP.p, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(DP.m, false, m);
  gl.uniform3fv(DP.eye, pos);
  gl.drawArrays(gl.POINTS, 0, dotData.length / 3);
  gl.disableVertexAttribArray(DP.p);
  gl.disable(gl.BLEND);

  // obras
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  gl.useProgram(quadProg);
  gl.uniformMatrix4fv(Q.m, false, m);
  for (const w of works) if (w !== hold.work) drawQuad(w.buf, null, w.tex, [1, 1, 1]);

  // en la mano
  if (hold.work) {
    drawFramed(heldPose(b), b.f, hold.work.tex, [1, 1, 1]);
  } else if (camReady && video.readyState >= 2) {
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, videoFrame());
    drawFramed(heldPose(b), b.f, videoTex, [1, 0.47, 0.31]);
  }
  gl.disableVertexAttribArray(Q.p); gl.disableVertexAttribArray(Q.uv);
}

// ---------- auto-actualización ----------
async function checkUpdate() {
  try {
    const r = await fetch('game.js?t=' + Date.now(), { cache: 'no-store' });
    const m = (await r.text()).match(/const VERSION = '([^']+)'/);
    if (m && m[1] !== VERSION && touches.size === 0 && !hold.work) {
      if (sessionStorage.getItem('recargado') === m[1]) return;
      sessionStorage.setItem('recargado', m[1]);
      location.reload();
    }
  } catch (e) {}
}
setInterval(checkUpdate, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });

ui();
loadWorks().catch(() => {}).finally(() => requestAnimationFrame(frame));

// para los tests (grados, como antes: yaw positivo = mirar a la derecha)
window.__game = {
  pos, works, hold, joy, get invertLook() { return invertLook; },
  get gyroMode() { return gyroMode; }, get camReady() { return camReady; },
  look(y, p) { yawOff = -y * Math.PI / 180; pitchOff = p * Math.PI / 180; },
};
