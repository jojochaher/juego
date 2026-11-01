// juego — v5: museo en el vacío, con edición de fotos
// Mirás con el giroscopio y ajustás arrastrando con el dedo. Te movés con el joystick.
// Lo que tenés "en la mano" (la vista previa de la cámara, o una foto que agarraste) viaja pegado
// a la cámara. Se edita por modos: mover (escala/giro con dos dedos), recortar (bordes),
// encuadre (pan y zoom adentro de la foto), girar (sobre su eje).
// Obturador: la vista previa queda fija. Tocar una foto la agarra; ✓ suelta, ✕ cancela, tacho borra.
const VERSION = 'v7.2';
document.getElementById('ver').textContent = VERSION;

const $ = id => document.getElementById(id);
const canvas = $('c'), video = $('vid'), hint = $('hint'), flash = $('flash'), startEl = $('start');
const joyEl = $('joy'), knobEl = $('knob'), distEl = $('dist'), distKnob = $('distKnob');
const shootBtn = $('shoot'), dropBtn = $('drop'), trashBtn = $('trash'), cancelBtn = $('cancel');
const homeBtn = $('home'), gyroBtn = $('gyroT'), invEl = $('inv'), modesEl = $('modes'), resetBtn = $('reset');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false });

window.addEventListener('error', e => showHint('error: ' + e.message));
window.addEventListener('unhandledrejection', e => showHint('error: ' + (e.reason && e.reason.message || e.reason)));

// --- unidades: metros. x derecha, y arriba, arrancás mirando -z ---
const EYE = 1.6;
const FOV_MIN = 5, FOV_MAX = 170;          // campo horizontal en grados (menú fov)
let fovDeg = 50;
try { const f = +localStorage.getItem('fov'); if (f >= FOV_MIN && f <= FOV_MAX) fovDeg = f; } catch (e) {}
let FOVX = fovDeg * Math.PI / 180;
const MOVE = 1.6;                 // m/s con el joystick a fondo
const LOOK = 0.0045;              // radianes por px de arrastre
const DIST_MIN = 0.3, DIST_MAX = 12;
const OUTLINE_PX = 3;             // grosor del marco, en px de pantalla
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
// rota v alrededor del eje k (unitario)
function rotAxis(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}

// ---------- orientación: giroscopio + ajuste con el dedo ----------
let gyro = null, gyroMode = false;
let yawOff = 0, pitchOff = 0;
let gyroOn = true;
try { gyroOn = localStorage.getItem('giroscopio') !== '0'; } catch (e) {}

window.addEventListener('deviceorientation', e => {
  if (e.alpha == null) return;
  gyro = { a: e.alpha, b: e.beta, g: e.gamma };
  if (!gyroMode) { gyroMode = true; ui(); }
});

function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  return typeof window.orientation === 'number' ? window.orientation : 0;
}

function camQuat() {
  let q = [0, 0, 0, 1];
  if (gyroMode && gyro && gyroOn) {
    const R = Math.PI / 180;
    const x = gyro.b * R, y = gyro.a * R, z = -gyro.g * R; // euler YXZ (como DeviceOrientationControls)
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    q = [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
    q = qmul(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    q = qmul(q, qaxis([0, 0, 1], -screenAngle() * R));
  }
  return qmul(qmul(qaxis([0, 1, 0], yawOff), q), qaxis([1, 0, 0], pitchOff));
}

function basis() {
  const q = camQuat();
  return { f: qrot(q, [0, 0, -1]), u: qrot(q, [0, 1, 0]), r: qrot(q, [1, 0, 0]) };
}
function heading(f) { return Math.atan2(-f[0], -f[2]); }

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
precision mediump float; uniform sampler2D t; uniform vec3 tint; uniform float alpha; varying vec2 v;
void main() { vec4 c = texture2D(t, v); if (c.a < 0.5) discard; gl_FragColor = vec4(c.rgb * tint, alpha); }`);
const Q = {
  p: gl.getAttribLocation(quadProg, 'p'), uv: gl.getAttribLocation(quadProg, 'uv'),
  m: gl.getUniformLocation(quadProg, 'm'), tint: gl.getUniformLocation(quadProg, 'tint'), alpha: gl.getUniformLocation(quadProg, 'alpha'),
};

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
const vc = document.createElement('canvas'), vcx = vc.getContext('2d');
function videoFrame() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const k = Math.min(1, 640 / Math.max(vw, vh));
  const w = Math.round(vw * k), h = Math.round(vh * k);
  if (vc.width !== w || vc.height !== h) { vc.width = w; vc.height = h; }
  vcx.drawImage(video, 0, 0, w, h);
  return vc;
}

const TEX_MAX = 512;
const smallC = document.createElement('canvas'), smallX = smallC.getContext('2d');
function small(src) {
  const sw = src.naturalWidth || src.videoWidth || src.width, sh = src.naturalHeight || src.videoHeight || src.height;
  const k = Math.min(1, TEX_MAX / Math.max(sw, sh));
  smallC.width = Math.max(1, Math.round(sw * k)); smallC.height = Math.max(1, Math.round(sh * k));
  smallX.drawImage(src, 0, 0, smallC.width, smallC.height);
  return smallC;
}

const FULL = [0, 0, 1, 1];
// cuadro: centro c, ejes r/u (unitarios), ancho w, alto h, recorte uv = [u0, v0, u1, v1] (v0 = arriba)
function quadData(c, r, u, w, h, uv = FULL) {
  const pt = (sx, sy) => add(c, add(mul(r, w / 2 * sx), mul(u, h / 2 * sy)));
  const [u0, v0, u1, v1] = uv;
  return new Float32Array([
    ...pt(-1, 1), u0, v0, ...pt(1, 1), u1, v0, ...pt(-1, -1), u0, v1,
    ...pt(1, 1), u1, v0, ...pt(1, -1), u1, v1, ...pt(-1, -1), u0, v1,
  ]);
}
const scratch = gl.createBuffer();
function drawQuad(buf, data, tex, tint, alpha = 1) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  if (data) gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(Q.p); gl.vertexAttribPointer(Q.p, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(Q.uv); gl.vertexAttribPointer(Q.uv, 2, gl.FLOAT, false, 20, 12);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform3fv(Q.tint, tint);
  gl.uniform1f(Q.alpha, alpha);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function tans() { const tx = Math.tan(FOVX / 2); return [tx, tx * H / W]; }
const metersPerPx = d => d * 2 * Math.tan(FOVX / 2) / W;   // cuánto mide un px a distancia d

// foto con marco de grosor fijo en pantalla, el marco apenas detrás
function drawFramed(p, tex, color) {
  const d = len(sub(p.c, pos));
  const m = OUTLINE_PX * metersPerPx(d);
  let n = norm(cross(p.r, p.u));
  if (dot(n, sub(p.c, pos)) < 0) n = mul(n, -1);         // hacia atrás de la foto
  drawQuad(scratch, quadData(add(p.c, mul(n, 0.004 * d)), p.r, p.u, p.w + 2 * m, p.h + 2 * m), white, color);
  drawQuad(scratch, quadData(p.c, p.r, p.u, p.w, p.h, p.uv), tex, [1, 1, 1]);
}

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
const works = []; // {id, c, r, u, w, h, uv, aspect, tex, buf}

function setBuf(w) {
  gl.bindBuffer(gl.ARRAY_BUFFER, w.buf);
  gl.bufferData(gl.ARRAY_BUFFER, quadData(w.c, w.r, w.u, w.w, w.h, w.uv), gl.STATIC_DRAW);
}
function addWork(o, img) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const w = { id: o.id, c: o.c, r: o.r, u: o.u, w: o.w, h: o.h, uv: (o.uv || FULL).slice(), aspect: ih / iw,
              tex: texture(small(img)), buf: gl.createBuffer() };
  setBuf(w);
  works.push(w);
  return w;
}

// ---------- lo que tenés en la mano ----------
// pose relativa a la cámara: x = derecha, y = arriba, z = adelante
const toWorldV = (b, l) => add(add(mul(b.r, l[0]), mul(b.u, l[1])), mul(b.f, l[2]));
const toLocalV = (b, v) => [dot(v, b.r), dot(v, b.u), dot(v, b.f)];
const DEFAULT_W = 2 * Math.tan(25 * Math.PI / 180) * 0.58;  // a 1 m, con fov 50°, ocupa ~58% del ancho

function freshPreview(aspect = 4 / 3) {
  return { c: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0], w: DEFAULT_W, h: DEFAULT_W * aspect, uv: FULL.slice(), aspect, fresh: true };
}
let preview = freshPreview();
let held = null;            // { work, L }
let mode = 'mover';
const cur = () => { if (held && held.aim) finishAim(); return held ? held.L : preview; };
// distancia de lo que está en la mano (sin cortar el giro hacia la foto)
const heldDist = () => held && held.aim ? len(sub(held.work.c, pos)) : len(cur().c);

function worldPose(b, L) {
  return { c: add(pos, toWorldV(b, L.c)), r: toWorldV(b, L.r), u: toWorldV(b, L.u), w: L.w, h: L.h, uv: L.uv.slice() };
}

// operaciones sobre lo que está en la mano
function scaleBy(L, k) {
  k = clamp(k, 0.02 / Math.min(L.w, L.h), 40 / Math.max(L.w, L.h));
  L.w *= k; L.h *= k;
}
function setDist(L, d) {   // acercar = se ve más grande, alejar = más chica (no cambia el tamaño real)
  L.c = mul(L.c, d / len(L.c));
}
function rollBy(L, a) {   // giro en el plano de la foto
  const n = norm(cross(L.r, L.u));
  L.r = norm(rotAxis(L.r, n, a)); L.u = norm(rotAxis(L.u, n, a));
}
function spinBy(L, ax, ay) {  // girar sobre su propio eje vertical (ax) y horizontal (ay)
  L.r = norm(rotAxis(L.r, L.u, ax));
  L.u = norm(rotAxis(L.u, L.r, ay));
  L.r = norm(cross(L.u, cross(L.r, L.u)));   // re-ortogonalizar
}
// zoom del contenido: achica/agranda la ventana uv alrededor de su centro
function zoomContent(L, uv0, k) {
  const cu = (uv0[0] + uv0[2]) / 2, cv = (uv0[1] + uv0[3]) / 2;
  let ru = (uv0[2] - uv0[0]) / k, rv = (uv0[3] - uv0[1]) / k;
  const big = Math.max(ru, rv);
  if (big > 1) { ru /= big; rv /= big; }
  if (Math.min(ru, rv) < 0.03) { const s = 0.03 / Math.min(ru, rv); ru *= s; rv *= s; }
  L.uv = fitUV([cu - ru / 2, cv - rv / 2, cu + ru / 2, cv + rv / 2]);
}
function panContent(L, du, dv) {
  L.uv = fitUV([L.uv[0] + du, L.uv[1] + dv, L.uv[2] + du, L.uv[3] + dv]);
}
function fitUV(uv) {   // mantiene la ventana adentro de la imagen sin cambiar su tamaño
  let [u0, v0, u1, v1] = uv;
  if (u0 < 0) { u1 -= u0; u0 = 0; } if (u1 > 1) { u0 -= u1 - 1; u1 = 1; }
  if (v0 < 0) { v1 -= v0; v0 = 0; } if (v1 > 1) { v0 -= v1 - 1; v1 = 1; }
  return [Math.max(0, u0), Math.max(0, v0), Math.min(1, u1), Math.min(1, v1)];
}
// recortar: mover bordes. edges = {l, r, t, b}; (a, bb) = punto del dedo en el plano de la foto, en metros
function cropTo(L, edges, a, bb) {
  const [u0, v0, u1, v1] = L.uv;
  const su = L.w / (u1 - u0), sv = L.h / (v1 - v0);
  let left = -L.w / 2, right = L.w / 2, top = L.h / 2, bottom = -L.h / 2;
  const mn = 0.04 * len(L.c);
  let nu0 = u0, nu1 = u1, nv0 = v0, nv1 = v1;
  if (edges.r) { right = clamp(a, left + mn, left + (1 - u0) * su); nu1 = u0 + (right - left) / su; }
  if (edges.l) { left = clamp(a, right - u1 * su, right - mn); nu0 = u1 - (right - left) / su; }
  if (edges.t) { top = clamp(bb, bottom + mn, bottom + v1 * sv); nv0 = v1 - (top - bottom) / sv; }
  if (edges.b) { bottom = clamp(bb, top - (1 - v0) * sv, top - mn); nv1 = v0 + (top - bottom) / sv; }
  L.c = add(L.c, add(mul(L.r, (left + right) / 2), mul(L.u, (top + bottom) / 2)));
  L.w = right - left; L.h = top - bottom;
  L.uv = [nu0, nv0, nu1, nv1];
}
// dónde toca el dedo el plano de lo que está en la mano (coordenadas de la foto, en metros)
function touchOnHeld(L, x, y) {
  const [tx, ty] = tans();
  const d = [((x / W) * 2 - 1) * tx, (1 - (y / H) * 2) * ty, 1];
  const n = cross(L.r, L.u);
  const den = dot(d, n);
  if (Math.abs(den) < 1e-6) return null;
  const t = dot(L.c, n) / den;
  if (t <= 0) return null;
  const p = sub(mul(d, t), L.c);
  return [dot(p, L.r), dot(p, L.u)];
}
function resetHeld() {
  const L = cur();
  const d = held ? len(L.c) : 1;                      // la vista previa vuelve a 1 m
  const aspect = held ? held.work.aspect : (video.videoWidth ? video.videoHeight / video.videoWidth : 4 / 3);
  const w = held ? L.w : DEFAULT_W * d;
  Object.assign(L, { c: [0, 0, d], r: [1, 0, 0], u: [0, 1, 0], w, h: w * aspect, uv: FULL.slice() });
  buzz(10);
  ui();
}

// agarrar: la cámara gira hasta que la foto queda en el centro (la foto no se mueve);
// recién ahí queda pegada a la cámara
function pick(w) {
  if (held) return;
  held = { work: w, L: null, aim: { t: 0 } };
  setMode('mover');
  buzz(12);
  ui();
}
function finishAim() {
  const w = held.work, b = basis();
  held.L = { c: toLocalV(b, sub(w.c, pos)), r: toLocalV(b, w.r), u: toLocalV(b, w.u), w: w.w, h: w.h, uv: w.uv.slice() };
  held.aim = null;
}
function stepAim(dt) {
  const a = held.aim;
  a.t += dt;
  const f = basis().f, d = norm(sub(held.work.c, pos));
  let eh = heading(d) - heading(f); eh = Math.atan2(Math.sin(eh), Math.cos(eh));
  const ee = Math.asin(clamp(d[1], -1, 1)) - Math.asin(clamp(f[1], -1, 1));
  if (Math.hypot(d[0], d[2]) < 0.05) eh = 0;          // foto justo arriba o abajo: el rumbo no importa
  const k = 1 - Math.exp(-dt * 14);
  yawOff += eh * k;
  pitchOff = clamp(pitchOff + ee * k, -1.4, 1.4);
  if ((Math.abs(eh) < 0.002 && Math.abs(ee) < 0.002) || a.t > 0.9) finishAim();
}
function releaseHold() { held = null; setMode('mover'); ui(); }
function clearWorks() {
  held = null;
  for (const w of works) { gl.deleteTexture(w.tex); gl.deleteBuffer(w.buf); }
  works.length = 0;
}

function drop() {
  if (!held) return;
  cur();
  const w = held.work;
  Object.assign(w, worldPose(basis(), held.L));
  setBuf(w);
  const pose = { c: w.c, r: w.r, u: w.u, w: w.w, h: w.h, uv: w.uv };
  if (sala.active) salaSavePose(w);
  else store('readwrite', s => { const q = s.get(w.id); q.onsuccess = () => q.result && s.put({ ...q.result, ...pose }); }).catch(() => {});
  buzz(12);
  releaseHold();
}
function cancelHold() { if (held) { buzz(8); releaseHold(); } }
function trash() {
  if (!held) return;
  const w = held.work;
  works.splice(works.indexOf(w), 1);
  gl.deleteTexture(w.tex); gl.deleteBuffer(w.buf);
  if (sala.active) salaRemove(w);
  else store('readwrite', s => s.delete(w.id)).catch(() => {});
  buzz(20);
  releaseHold();
}

function workAt(x, y) {
  const b = basis();
  const [tx, ty] = tans();
  const nx = (x / W) * 2 - 1, ny = 1 - (y / H) * 2;
  const d = norm(add(b.f, add(mul(b.r, nx * tx), mul(b.u, ny * ty))));
  let best = null, bestT = Infinity;
  for (const w of works) {
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
async function store(m, fn) {
  const d = await db;
  return new Promise((res, rej) => {
    const tx = d.transaction('obras', m);
    const out = fn(tx.objectStore('obras'));
    tx.oncomplete = () => res(out && out.result); tx.onerror = () => rej(tx.error);
  });
}
async function loadWorks() {
  if (/[?&]borrar/.test(location.search)) {
    await store('readwrite', s => s.clear());
    history.replaceState(null, '', location.pathname);
  }
  const keys = await store('readonly', s => s.getAllKeys());
  for (const k of keys || []) {
    const o = await store('readonly', s => s.get(k));
    if (!o || !o.blob) continue;
    const url = URL.createObjectURL(o.blob);
    const img = new Image(); img.src = url;
    try { await img.decode(); if (!sala.active) addWork(o, img); } catch (e) {}
    img.src = ''; URL.revokeObjectURL(url);
    await new Promise(r => setTimeout(r, 0));
  }
}

// ---------- cámara (un ítem que se equipa y se guarda) ----------
let camReady = false, camOn = true, camStarting = false;
try { camOn = localStorage.getItem('camara') !== '0'; } catch (e) {}
async function startCamera() {
  if (camReady || camStarting) return;
  camStarting = true;
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: 'environment', width: { ideal: 960 }, height: { ideal: 960 } },
    });
    if (!camOn) { s.getTracks().forEach(t => t.stop()); return; }   // la guardaste mientras abría
    video.srcObject = s;
    await video.play();
    camReady = true;
    rtcPistas();   // en una sala, los demás ven lo que encuadrás
  } catch (e) {
    showHint('no pude abrir la cámara: ' + (e && e.name || e), true);
  } finally {
    camStarting = false;
    ui();
  }
}
function stopCamera() {
  const s = video.srcObject;
  if (s) s.getTracks().forEach(t => t.stop());   // apaga la cámara de verdad (batería y el puntito verde)
  video.srcObject = null;
  camReady = false;
}
function setCam(on) {
  camOn = on;
  try { localStorage.setItem('camara', on ? '1' : '0'); } catch (e) {}
  // la cámara de fotos (trasera) y la de tu cara (frontal) no pueden estar prendidas a la vez
  if (on) { rtcSoltarCara(); startCamera(); }
  else { stopCamera(); if (!held) setMode('mover'); rtcMedios(); }
  buzz(10);
  ui();
}

function shoot() {
  if (!camOn || !camReady || !video.videoWidth || held) return;
  const pose = worldPose(basis(), preview);
  const k = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  const o = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), ...pose };
  addWork(o, c);
  if (sala.active) salaShoot(o, c);
  else c.toBlob(blob => store('readwrite', s => s.put({ ...o, blob })).catch(() => {}), 'image/jpeg', 0.85);
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
  if (!stay) hintTimer = setTimeout(() => { hint.style.opacity = 0; }, 5000);
}

const MODE_HINT = {
  mover: 'dos dedos: tamaño y giro · barra: distancia',
  recortar: 'arrastrá un borde o una esquina',
  encuadre: 'un dedo mueve la imagen · dos dedos zoom',
  girar: 'un dedo la gira sobre su eje · dos dedos la rotan',
};
function setMode(m) {
  mode = m;
  for (const el of modesEl.querySelectorAll('[data-m]')) el.classList.toggle('on', el.dataset.m === m);
}
for (const el of modesEl.querySelectorAll('[data-m]')) {
  el.addEventListener('click', () => { setMode(el.dataset.m); showHint(MODE_HINT[mode]); });
}
resetBtn.addEventListener('click', resetHeld);

let started = false;
function ui() {
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };
  const holding = !!held, camUp = camOn && camReady, canEdit = started && (holding || camUp);
  show(joyEl, started);
  show(invEl, started);
  show(homeBtn, started);
  show($('salaBtn'), started);
  show($('micBtn'), started && sala.active);
  show($('caraBtn'), started && sala.active);
  show($('fov'), started);
  show(gyroBtn, started && gyroMode);
  show(distEl, canEdit);
  show(modesEl, canEdit);
  show(shootBtn, started && camUp && !holding);
  show(equipBtn, started && !camOn && !holding);
  show(unequipBtn, started && camOn && !holding);
  show(dropBtn, started && holding);
  show(trashBtn, started && holding);
  show(cancelBtn, started && holding);
  distKnob.style.top = (1 - distT(heldDist())) * 100 + '%';
}

shootBtn.addEventListener('click', shoot);
dropBtn.addEventListener('click', drop);
trashBtn.addEventListener('click', trash);
cancelBtn.addEventListener('click', cancelHold);

// ---------- invertir el arrastre de la cámara ----------
let invertLook = false;
try { invertLook = localStorage.getItem('invertir') === '1'; } catch (e) {}
function paintInv() { invEl.textContent = invertLook ? 'arrastre: invertido' : 'arrastre: normal'; invEl.classList.toggle('on', invertLook); }
invEl.addEventListener('click', () => {
  invertLook = !invertLook;
  try { localStorage.setItem('invertir', invertLook ? '1' : '0'); } catch (e) {}
  paintInv();
});
paintInv();

// ---------- campo de visión ----------
const fovBtn = $('fov'), fovPanel = $('fovPanel'), fovTrack = $('fovTrack'), fovKnob = $('fovKnob'), fovVal = $('fovVal');
function paintFov() {
  fovBtn.textContent = 'fov';
  fovVal.textContent = fovDeg + '°';
  fovKnob.style.left = (fovDeg - FOV_MIN) / (FOV_MAX - FOV_MIN) * 100 + '%';
}
function setFov(d) {
  fovDeg = Math.round(clamp(d, FOV_MIN, FOV_MAX));
  FOVX = fovDeg * Math.PI / 180;
  try { localStorage.setItem('fov', String(fovDeg)); } catch (e) {}
  paintFov();
}
fovBtn.addEventListener('click', () => {
  const open = fovPanel.style.display === 'none';
  fovPanel.style.display = open ? '' : 'none';
  fovBtn.classList.toggle('on', open);
});
function fovFromX(x) {
  const r = fovTrack.getBoundingClientRect();
  setFov(FOV_MIN + clamp((x - r.left) / r.width, 0, 1) * (FOV_MAX - FOV_MIN));
}
let fovPtr = null;
fovPanel.addEventListener('pointerdown', e => { fovPtr = e.pointerId; fovPanel.setPointerCapture(e.pointerId); fovFromX(e.clientX); });
fovPanel.addEventListener('pointermove', e => { if (e.pointerId === fovPtr) fovFromX(e.clientX); });
fovPanel.addEventListener('pointerup', e => { if (e.pointerId === fovPtr) fovPtr = null; });
fovPanel.addEventListener('pointercancel', e => { if (e.pointerId === fovPtr) fovPtr = null; });
paintFov();

// ---------- equipar / guardar la cámara ----------
const equipBtn = $('equip'), unequipBtn = $('unequip');
equipBtn.addEventListener('click', () => setCam(true));
unequipBtn.addEventListener('click', () => setCam(false));

// ---------- volver al inicio ----------
homeBtn.addEventListener('click', () => {
  pos[0] = 0; pos[1] = EYE; pos[2] = 0;
  pitchOff = 0; yawOff = 0;
  yawOff = -heading(basis().f);
  buzz(10);
});

// ---------- prender/apagar el giroscopio sin que salte la vista ----------
function paintGyro() { gyroBtn.textContent = gyroOn ? 'giroscopio: sí' : 'giroscopio: no'; gyroBtn.classList.toggle('on', !gyroOn); }
gyroBtn.addEventListener('click', () => {
  const f = basis().f;
  gyroOn = !gyroOn;
  try { localStorage.setItem('giroscopio', gyroOn ? '1' : '0'); } catch (e) {}
  if (gyroOn) {
    pitchOff = 0; yawOff = 0;
    yawOff = heading(f) - heading(basis().f);
  } else {
    pitchOff = Math.asin(clamp(f[1], -1, 1));
    yawOff = heading(f);
  }
  paintGyro();
});
paintGyro();

// ---------- barra de distancia (arriba = más lejos) ----------
const LMIN = Math.log(DIST_MIN), LMAX = Math.log(DIST_MAX);
const distT = d => clamp((Math.log(d) - LMIN) / (LMAX - LMIN), 0, 1);
function distFromY(y) {
  const r = distEl.getBoundingClientRect();
  const t = clamp(1 - (y - r.top) / r.height, 0, 1);
  setDist(cur(), Math.exp(LMIN + t * (LMAX - LMIN)));
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

// ---------- dedos sobre la pantalla ----------
const touches = new Map(); // id -> {x, y, x0, y0, t0, moved, crop}
let gesture = null;        // dos dedos

function twoFingers() {
  const [a, b] = [...touches.values()];
  return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
}

// en recortar: qué bordes quedan debajo del dedo
function edgesAt(L, x, y) {
  const p = touchOnHeld(L, x, y);
  if (!p) return null;
  const tol = 36 * metersPerPx(len(L.c));
  const [a, b] = p, hw = L.w / 2, hh = L.h / 2;
  if (Math.abs(a) > hw + tol || Math.abs(b) > hh + tol) return null;
  const e = { l: Math.abs(a + hw) < tol, r: Math.abs(a - hw) < tol, t: Math.abs(b - hh) < tol, b: Math.abs(b + hh) < tol };
  return (e.l || e.r || e.t || e.b) ? e : null;
}

canvas.addEventListener('pointerdown', e => {
  if (!started) return;
  canvas.setPointerCapture(e.pointerId);
  const t = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, crop: null };
  if (mode === 'recortar') t.crop = edgesAt(cur(), e.clientX, e.clientY);
  touches.set(e.pointerId, t);
  if (touches.size === 2) {
    const g = twoFingers();
    const L = cur();
    gesture = { d0: g.d, a0: g.a, lastD: g.d, lastA: g.a, uv0: L.uv.slice() };
    for (const tt of touches.values()) { tt.moved = true; tt.crop = null; }
  }
});

canvas.addEventListener('pointermove', e => {
  const t = touches.get(e.pointerId);
  if (!t) return;
  const dx = e.clientX - t.x, dy = e.clientY - t.y;
  t.x = e.clientX; t.y = e.clientY;
  const L = cur();

  if (touches.size >= 2 && gesture) {
    const g = twoFingers();
    let da = g.a - gesture.lastA; da = Math.atan2(Math.sin(da), Math.cos(da));
    const k = g.d / Math.max(10, gesture.lastD);
    gesture.lastA = g.a; gesture.lastD = g.d;
    if (mode === 'mover') { scaleBy(L, k); rollBy(L, -da); }
    else if (mode === 'girar') rollBy(L, -da);
    else if (mode === 'encuadre') zoomContent(L, gesture.uv0, g.d / Math.max(10, gesture.d0));
    return;
  }
  if (!t.moved && Math.hypot(t.x - t.x0, t.y - t.y0) > 8) t.moved = true;
  if (!t.moved) return;

  if (mode === 'recortar' && t.crop) {
    const p = touchOnHeld(L, e.clientX, e.clientY);
    if (p) cropTo(L, t.crop, p[0], p[1]);
    return;
  }
  if (mode === 'encuadre') {
    // el dedo arrastra la imagen: proyectar el movimiento sobre los ejes de la foto (por si está girada)
    const mpp = metersPerPx(len(L.c));
    const v = [dx * mpp, -dy * mpp, 0];
    const su = L.w / (L.uv[2] - L.uv[0]), sv = L.h / (L.uv[3] - L.uv[1]);
    panContent(L, -dot(v, L.r) / su, dot(v, L.u) / sv);
    return;
  }
  // girar: como una bola, la cara de adelante sigue al dedo
  if (mode === 'girar') { spinBy(L, -dx * 0.008, -dy * 0.008); return; }
  // mirar
  const kk = invertLook ? -LOOK : LOOK;
  yawOff += dx * kk;
  pitchOff = clamp(pitchOff + dy * kk, -1.4, 1.4);
});

function endTouch(e) {
  const t = touches.get(e.pointerId);
  if (!t) return;
  touches.delete(e.pointerId);
  if (touches.size < 2) gesture = null;
  if (e.type === 'pointerup' && !t.moved && performance.now() - t.t0 < 350 && !held) {
    const w = workAt(e.clientX, e.clientY);
    if (w) pick(w);
  }
}
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);

// ---------- arranque ----------
startEl.addEventListener('click', async () => {
  if (started) return;
  started = true;
  // un permiso por vez: primero movimiento; cuando se cierra ese, la cámara (si está equipada)
  if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
    await DeviceOrientationEvent.requestPermission().catch(() => {});
  }
  startEl.remove();
  setMode('mover');
  ui();
  if (camOn) await startCamera();
  if (sala.active) rtcMedios();   // micrófono y cara recién después de tocar (en iPhone, pedirlos antes falla)
  showHint('joystick para moverte · arrastrá para mirar<br>tocá una foto para agarrarla');
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
  if (held && held.aim) stepAim(dt);
  const b = basis();

  if (joy.x || joy.y) {
    let fw = [b.f[0], 0, b.f[2]];
    if (len(fw) < 0.2) fw = [b.u[0], 0, b.u[2]];
    fw = norm(fw);
    const rt = norm(cross(fw, [0, 1, 0]));
    const v = add(mul(fw, -joy.y), mul(rt, joy.x));
    pos[0] += v[0] * MOVE * dt; pos[2] += v[2] * MOVE * dt;
  }

  // la vista previa toma la proporción real de la cámara la primera vez
  if (preview.fresh && camReady && video.videoWidth) {
    preview = freshPreview(video.videoHeight / video.videoWidth);
    preview.fresh = false;
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

  // obras
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  gl.useProgram(quadProg);
  gl.uniformMatrix4fv(Q.m, false, m);
  const otros = salaEnManos();   // las que tiene agarradas otro se dibujan en su mano
  for (const w of works) if ((!held || w !== held.work) && !otros.has(w.id)) drawQuad(w.buf, null, w.tex, [1, 1, 1]);
  salaDraw(b, dt);

  // en la mano
  if (held) {
    drawFramed(held.aim ? held.work : worldPose(b, held.L), held.work.tex, [1, 1, 1]);
  } else if (camOn && camReady && video.readyState >= 2) {
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, videoFrame());
    drawFramed(worldPose(b, preview), videoTex, [1, 0.47, 0.31]);
  }

  // fantasma: dónde estaba la foto antes de agarrarla (a media opacidad, encima de todo)
  if (held) {
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    drawQuad(held.work.buf, null, held.work.tex, [1, 1, 1], 0.35);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
  gl.disableVertexAttribArray(Q.p); gl.disableVertexAttribArray(Q.uv);

  if (distPtr == null) distKnob.style.top = (1 - distT(heldDist())) * 100 + '%';
}

// ---------- auto-actualización ----------
async function checkUpdate() {
  try {
    const r = await fetch('game.js?t=' + Date.now(), { cache: 'no-store' });
    const mm = (await r.text()).match(/const VERSION = '([^']+)'/);
    if (mm && mm[1] !== VERSION && touches.size === 0 && !held) {
      if (sessionStorage.getItem('recargado') === mm[1]) return;
      sessionStorage.setItem('recargado', mm[1]);
      location.reload();
    }
  } catch (e) {}
}
setInterval(checkUpdate, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  checkUpdate();
  // el iPhone apaga la cámara cuando la app pasa al fondo: al volver, si quedó muerta, se vuelve a abrir
  const tr = video.srcObject && video.srcObject.getVideoTracks()[0];
  if (camOn && camReady && (!tr || tr.readyState === 'ended')) { stopCamera(); startCamera(); }
});

ui();
const salaPrevia = salaGuardada();
(salaPrevia ? salaEntrar(salaPrevia) : loadWorks()).catch(() => {}).finally(() => requestAnimationFrame(frame));

// para los tests (grados: yaw positivo = mirar a la derecha)
window.__game = {
  pos, works, joy,
  get held() { return held; }, sala, salaYo, rtc, get camOn() { return camOn; }, get fov() { return fovDeg; }, get preview() { return preview; }, get mode() { return mode; },
  get invertLook() { return invertLook; }, get gyroOn() { return gyroOn; },
  get gyroMode() { return gyroMode; }, get camReady() { return camReady; },
  look(y, p) { yawOff = -y * Math.PI / 180; pitchOff = p * Math.PI / 180; },
};
