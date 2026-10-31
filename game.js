// juego — v3: museo en el vacío
// Mirás girando el celu (giroscopio). Mantenés apretado para caminar hacia donde mirás.
// Frente a vos flota un rectángulo con lo que ve la cámara. Tocás: la foto queda fija ahí.
// Arrastrar de costado gira el mundo (para acomodarlo si arrancó torcido).
const VERSION = 'v3.4';
document.getElementById('ver').textContent = VERSION;

const canvas = document.getElementById('c');
const video = document.getElementById('vid');
const hint = document.getElementById('hint');
const flash = document.getElementById('flash');
const startEl = document.getElementById('start');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false });

// --- diagnóstico en pantalla (temporal) ---
const dbgEl = document.getElementById('dbg');
let lastErr = '';
window.addEventListener('error', e => { lastErr = e.message; });
window.addEventListener('unhandledrejection', e => { lastErr = String(e.reason && (e.reason.name + ': ' + e.reason.message) || e.reason); });
function dbg() {
  const g = gyro ? `${gyro.a.toFixed(0)} ${gyro.b.toFixed(0)} ${gyro.g.toFixed(0)}` : '-';
  dbgEl.textContent =
    `gl:${gl ? 'ok' : 'NO'} cam:${camState} video:${video.videoWidth}x${video.videoHeight} rs:${video.readyState} paused:${video.paused}\n` +
    `gyro:${gyroMode ? 'si' : 'no'} [${g}] perm:${permState} obras:${works.length}\n` +
    `frames:${frames} lost:${gl.isContextLost()} glErr:${gl.getError()}\n` +
    (lastErr ? 'ERR: ' + lastErr : '');
}
let camState = 'sin pedir', permState = '-', frames = 0;
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lastErr = 'CONTEXTO WEBGL PERDIDO (frame ' + frames + ')'; });

// --- unidades: metros. x derecha, y arriba, arrancás mirando -z ---
const EYE = 1.6;
const FOVX = 50 * Math.PI / 180; // campo horizontal; el vertical sale de la pantalla
const WALK = 1.4;          // m/s
const PREVIEW_DIST = 1.0;  // a qué distancia flota el rectángulo
const PREVIEW_FRAC = 0.58; // el rectángulo ocupa ~58% del ancho de la pantalla
const pos = [0, EYE, 0];

// ---------- vectores y cuaterniones ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
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

// ---------- orientación ----------
let gyro = null;        // último deviceorientation {a,b,g}
let gyroMode = false;
let yawOffset = 0;      // giro manual del mundo (arrastrando)
let lookYaw = 0, lookPitch = 0; // modo sin giroscopio (compu / tests)

window.addEventListener('deviceorientation', e => {
  if (e.alpha == null) return;
  gyro = { a: e.alpha, b: e.beta, g: e.gamma };
  gyroMode = true;
});

function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  return typeof window.orientation === 'number' ? window.orientation : 0;
}

// orientación de la cámara como cuaternión (misma matemática que DeviceOrientationControls de three.js)
function camQuat() {
  let q;
  if (gyroMode && gyro) {
    const R = Math.PI / 180;
    const x = gyro.b * R, y = gyro.a * R, z = -gyro.g * R; // euler YXZ
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    q = [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
    q = qmul(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);          // la cámara mira por la espalda del celu
    q = qmul(q, qaxis([0, 0, 1], -screenAngle() * R));
  } else {
    q = qmul(qaxis([0, 1, 0], -lookYaw * Math.PI / 180), qaxis([1, 0, 0], lookPitch * Math.PI / 180));
  }
  return qmul(qaxis([0, 1, 0], yawOffset), q);
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

// cuadros (fotos, vista previa, marco)
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
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  gl_FragColor = vec4(vec3(1.0), a * 0.5);
}`);
const DP = {
  p: gl.getAttribLocation(dotProg, 'p'), m: gl.getUniformLocation(dotProg, 'm'), eye: gl.getUniformLocation(dotProg, 'eye'),
};
const GRID = 12; // ±12 m alrededor tuyo, 1 punto por metro
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
// iOS se rompe subiendo el video de la cámara directo a WebGL: lo copiamos antes a un canvas 2D
const vc = document.createElement('canvas');
const vcx = vc.getContext('2d');
function videoFrame() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const k = Math.min(1, 640 / Math.max(vw, vh));
  const w = Math.round(vw * k), h = Math.round(vh * k);
  if (vc.width !== w || vc.height !== h) { vc.width = w; vc.height = h; }
  vcx.drawImage(video, 0, 0, w, h);
  return vc;
}
const videoTex = texture(null);

// un cuadro: centro c, vectores r/u (unitarios), ancho w, alto h
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

// ---------- obras (fotos fijas en el espacio) ----------
const works = []; // {id, c, r, u, w, h, tex, buf}

// las texturas de las obras van a 512px: alcanza de sobra para verlas y entran muchas en memoria
// (a 1280px cada foto ocupaba ~13MB y con 20 fotos iOS mataba la página)
const TEX_MAX = 512;
const smallC = document.createElement('canvas');
const smallX = smallC.getContext('2d');
function small(src) {
  const sw = src.naturalWidth || src.videoWidth || src.width, sh = src.naturalHeight || src.videoHeight || src.height;
  const k = Math.min(1, TEX_MAX / Math.max(sw, sh));
  smallC.width = Math.max(1, Math.round(sw * k)); smallC.height = Math.max(1, Math.round(sh * k));
  smallX.drawImage(src, 0, 0, smallC.width, smallC.height);
  return smallC;
}

function addWork(o, img) {
  const w = { ...o, tex: texture(small(img)), buf: gl.createBuffer() };
  gl.bindBuffer(gl.ARRAY_BUFFER, w.buf);
  gl.bufferData(gl.ARRAY_BUFFER, quadData(w.c, w.r, w.u, w.w, w.h), gl.STATIC_DRAW);
  works.push(w);
}

// rectángulo de vista previa: dónde está ahora mismo
function previewPose(b) {
  const vw = video.videoWidth || 3, vh = video.videoHeight || 4;
  const [tx, ty] = tans();
  let w = 2 * PREVIEW_DIST * tx * PREVIEW_FRAC, h = w * vh / vw;
  const maxH = 2 * PREVIEW_DIST * ty * 0.42;
  if (h > maxH) { h = maxH; w = h * vw / vh; }
  return { c: add(pos, mul(b.f, PREVIEW_DIST)), r: b.r, u: b.u, w, h };
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
    try { await img.decode(); delete o.blob; addWork(o, img); } catch (e) {}
    img.src = ''; URL.revokeObjectURL(url);
    await new Promise(r => setTimeout(r, 0));
  }
}

async function undo() {
  const w = works.pop();
  if (!w) return;
  gl.deleteTexture(w.tex); gl.deleteBuffer(w.buf);
  store('readwrite', s => s.delete(w.id)).catch(() => {});
  if (navigator.vibrate) navigator.vibrate(10);
  updateUndo();
}
const undoBtn = document.getElementById('undo');
undoBtn.addEventListener('click', undo);
function updateUndo() { undoBtn.style.display = works.length && started ? 'flex' : 'none'; }

// ---------- cámara ----------
let camReady = false;
async function startCamera() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: 'environment', width: { ideal: 960 }, height: { ideal: 960 } },
    });
    camState = 'stream ok';
    video.srcObject = s;
    await video.play();
    camState = 'play ok';
    camReady = true;
  } catch (e) {
    camState = 'ERROR ' + (e && e.name || e);
    showHint('no pude abrir la cámara: ' + (e && e.name || e), true);
  }
}

function shoot() {
  if (!camReady || !video.videoWidth) return;
  const b = basis();
  const pose = previewPose(b);
  const k = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  const o = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), ...pose };
  addWork(o, c);
  updateUndo();
  c.toBlob(blob => store('readwrite', s => s.put({ ...o, blob })).catch(() => {}), 'image/jpeg', 0.85);
  flash.style.transition = 'none'; flash.style.opacity = 0.7;
  requestAnimationFrame(() => { flash.style.transition = 'opacity 0.35s'; flash.style.opacity = 0; });
  if (navigator.vibrate) navigator.vibrate(15);
  if (works.length >= 1) hideHint();
}

// ---------- texto ----------
let hintTimer = null;
function showHint(t, stay) {
  hint.innerHTML = t; hint.style.opacity = 1;
  clearTimeout(hintTimer);
  if (!stay) hintTimer = setTimeout(hideHint, 7000);
}
function hideHint() { hint.style.opacity = 0; }

// ---------- arranque (en iPhone los permisos necesitan un toque) ----------
let started = false;
startEl.addEventListener('click', async () => {
  if (started) return;
  started = true;
  let perm = Promise.resolve('n/a');
  if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
    perm = DeviceOrientationEvent.requestPermission().catch(e => 'error ' + (e && e.name || e));
  }
  const camP = startCamera();
  permState = await perm;
  startEl.remove();
  updateUndo();
  await camP;
  setTimeout(() => {
    showHint(gyroMode
      ? 'girá con el celu para mirar<br>mantené apretado para caminar<br>tocá para sacar la foto'
      : 'arrastrá para mirar<br>mantené apretado para caminar<br>tocá para sacar la foto', works.length === 0);
  }, 600);
});

// ---------- input: un dedo ----------
let ptr = null;
canvas.addEventListener('pointerdown', e => {
  if (ptr || !started) return;
  canvas.setPointerCapture(e.pointerId);
  ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false };
});
canvas.addEventListener('pointermove', e => {
  if (!ptr || e.pointerId !== ptr.id) return;
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
  ptr.x = e.clientX; ptr.y = e.clientY;
  if (!ptr.moved && Math.hypot(e.clientX - ptr.x0, e.clientY - ptr.y0) > 10 && !walking()) ptr.moved = true;
  if (!ptr.moved) return;
  if (gyroMode) {
    yawOffset += dx * 0.006;           // arrastrar de costado gira el mundo
  } else {
    lookYaw -= dx * 0.25;
    lookPitch = Math.max(-85, Math.min(85, lookPitch + dy * 0.25));
  }
});
function endPtr(e) {
  if (!ptr || e.pointerId !== ptr.id) return;
  const quick = performance.now() - ptr.t0 < HOLD_MS;
  if (!ptr.moved && quick) shoot();
  ptr = null;
}
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', e => { if (ptr && e.pointerId === ptr.id) ptr = null; });

const HOLD_MS = 250;
function walking() { return ptr && !ptr.moved && performance.now() - ptr.t0 >= HOLD_MS; }

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  frames++;
  try { draw(now); } catch (e) { lastErr = (e && (e.name + ': ' + e.message)) || String(e); }
  dbg();
  requestAnimationFrame(frame);
}
function draw(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const b = basis();

  if (walking()) {
    const flat = norm([b.f[0], 0, b.f[2]]);
    pos[0] += flat[0] * WALK * dt;
    pos[2] += flat[2] * WALK * dt;
  }

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

  // obras + vista previa
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  gl.useProgram(quadProg);
  gl.uniformMatrix4fv(Q.m, false, m);
  for (const w of works) drawQuad(w.buf, null, w.tex, [1, 1, 1]);

  if (camReady) {
    const p = previewPose(b);
    // marco, un centímetro detrás
    const back = add(p.c, mul(b.f, 0.01));
    drawQuad(scratch, quadData(back, p.r, p.u, p.w + 0.03, p.h + 0.03), white, [1, 0.47, 0.31]);
  }
  if (camReady && video.readyState >= 2) {
    const p = previewPose(b);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, videoFrame());
    drawQuad(scratch, quadData(p.c, p.r, p.u, p.w, p.h), videoTex, [1, 1, 1]);
  }
  gl.disableVertexAttribArray(Q.p); gl.disableVertexAttribArray(Q.uv);
}

// ---------- auto-actualización ----------
// Si hay una versión nueva publicada, recarga sola (las fotos ya están guardadas).
async function checkUpdate() {
  try {
    const r = await fetch('game.js?t=' + Date.now(), { cache: 'no-store' });
    const m = (await r.text()).match(/const VERSION = '([^']+)'/);
    if (m && m[1] !== VERSION && !ptr) {
      // no recargar dos veces por la misma versión (el CDN a veces sirve viejo y nuevo mezclado)
      if (sessionStorage.getItem('recargado') === m[1]) return;
      sessionStorage.setItem('recargado', m[1]);
      location.reload();
    }
  } catch (e) {}
}
setInterval(checkUpdate, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });

loadWorks().catch(() => {}).finally(() => requestAnimationFrame(frame));

// para los tests
window.__game = {
  pos, works, get gyroMode() { return gyroMode; },
  look(y, p) { lookYaw = y; lookPitch = p; },
  get camReady() { return camReady; },
};
