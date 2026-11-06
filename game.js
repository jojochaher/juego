// juego — museo en el vacío con fotos (ver claude/instrucciones.md del proyecto para el estado)
// Mirás con el giroscopio y ajustás arrastrando con el dedo. Te movés con el joystick.
// Lo que tenés "en la mano" (la vista previa de la cámara, o una foto que agarraste) viaja pegado
// a la cámara. Se edita por modos: mover (escala/giro con dos dedos), recortar (bordes; adentro, pan y zoom de la
// imagen), escalar (bordes: estirar en x o en y), girar (sobre su eje).
// Obturador: la vista previa queda fija. Tocar una foto la agarra; ✓ suelta, ✕ cancela, tacho borra.
const VERSION = 'v10.10';
document.getElementById('ver').textContent = VERSION;

const $ = id => document.getElementById(id);
const canvas = $('c'), video = $('vid'), hint = $('hint'), flash = $('flash'), startEl = $('start');
const joyEl = $('joy'), knobEl = $('knob'), distEl = $('dist'), distKnob = $('distKnob');
const shootBtn = $('shoot'), dropBtn = $('drop'), trashBtn = $('trash'), cancelBtn = $('cancel');
const homeBtn = $('home'), gyroBtn = $('gyroT'), invEl = $('inv'), modesEl = $('modes'), resetBtn = $('reset');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false });

diag('versión ' + VERSION);
window.addEventListener('error', e => showHint('error: ' + e.message));
window.addEventListener('unhandledrejection', e => showHint('error: ' + (e.reason && e.reason.message || e.reason)));

// --- unidades: metros. x derecha, y arriba, arrancás mirando -z ---
const EYE = 1.6;
const FOV_MIN = 5, FOV_MAX = 170;          // campo horizontal en grados (menú fov)
let fovDeg = 50;
try { const f = +localStorage.getItem('fov'); if (f >= FOV_MIN && f <= FOV_MAX) fovDeg = f; } catch (e) {}
let FOVX = fovDeg * Math.PI / 180;
const MOVE = 1.6;
let corriendo = 0, corriendoT = 0;   // aceleración al mantener el joystick a fondo                 // m/s con el joystick a fondo
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
precision mediump float; uniform sampler2D t; uniform vec3 tint; uniform float alpha; uniform vec2 fade; varying vec2 v;
void main() { vec4 c = texture2D(t, v); if (c.a < 0.5) discard; gl_FragColor = vec4(c.rgb * tint, alpha * mix(fade.x, fade.y, v.y)); }`);
const Q = {
  p: gl.getAttribLocation(quadProg, 'p'), uv: gl.getAttribLocation(quadProg, 'uv'),
  m: gl.getUniformLocation(quadProg, 'm'), tint: gl.getUniformLocation(quadProg, 'tint'), alpha: gl.getUniformLocation(quadProg, 'alpha'), fade: gl.getUniformLocation(quadProg, 'fade'),
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
// fade = [a, b]: el alfa va de a (borde de arriba del cuadro, +u) a b (abajo, -u); para que las guías se desvanezcan en las puntas
const SIN_FADE = [1, 1];
function drawQuad(buf, data, tex, tint, alpha = 1, fade = SIN_FADE) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  if (data) gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(Q.p); gl.vertexAttribPointer(Q.p, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(Q.uv); gl.vertexAttribPointer(Q.uv, 2, gl.FLOAT, false, 20, 12);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform3fv(Q.tint, tint);
  gl.uniform1f(Q.alpha, alpha);
  gl.uniform2fv(Q.fade, fade);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// el fov va sobre el lado más corto de la pantalla (celu vertical: el ancho; compu apaisada: el alto)
function tans() { const t = Math.tan(FOVX / 2); return W <= H ? [t, t * H / W] : [t * W / H, t]; }
const metersPerPx = d => d * 2 * tans()[0] / W;   // cuánto mide un px a distancia d

// foto con marco de grosor fijo en pantalla, el marco apenas detrás.
// deco (en recortar / escalar): las agarraderas encima de la foto. Recortar: esquinas en L y barritas en el medio de
// cada lado (y los tercios mientras se recorta); escalar: cuadraditos en las esquinas y en el medio de los lados.
// El lado que se está moviendo va en amarillo: su línea del marco y sus agarraderas, con la misma forma (sin barras encimadas).
const COLOR_RECORTE = [1, 0.85, 0.2];
function drawFramed(p, tex, color, deco = null) {
  const d = len(sub(p.c, pos));
  const m = OUTLINE_PX * metersPerPx(d);
  let n = norm(cross(p.r, p.u));
  if (dot(n, sub(p.c, pos)) < 0) n = mul(n, -1);         // hacia atrás de la foto
  const atras = add(p.c, mul(n, 0.004 * d));
  drawQuad(scratch, quadData(atras, p.r, p.u, p.w + 2 * m, p.h + 2 * m), white, color);
  drawQuad(scratch, quadData(p.c, p.r, p.u, p.w, p.h, p.uv), tex, [1, 1, 1]);
  if (deco) {
    // sin prueba de profundidad: el borde oscuro y el centro blanco de los cuadraditos están en el mismo plano y,
    // con la precisión de profundidad del iPhone, titilaban (z-fighting). Se pintan en orden, encima de la foto.
    const dt = gl.isEnabled(gl.DEPTH_TEST);
    gl.disable(gl.DEPTH_TEST);
    try { agarraderas(p, n, d, m, deco); } finally { if (dt) gl.enable(gl.DEPTH_TEST); }
  }
}
function agarraderas(p, n, d, m, deco) {
  const px = m / OUTLINE_PX, act = deco.activo || {};
  const frente = add(p.c, mul(n, -0.002 * d));          // apenas delante de la foto
  const hw = p.w / 2, hh = p.h / 2;
  // un rectángulo en el plano de la foto: centro (x, y) desde el centro de la foto, ancho y alto en metros
  const rect = (x, y, w, h, col, alfa = 1) => {
    const c = add(frente, add(mul(p.r, x), mul(p.u, y)));
    if (alfa < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
    drawQuad(scratch, quadData(c, p.r, p.u, w, h), white, col, alfa);
    if (alfa < 1) gl.disable(gl.BLEND);
  };
  const B = [1, 1, 1], Y = COLOR_RECORTE;
  const cl = k => act[k] ? Y : B;
  // el lado activo: su línea del marco, en amarillo (justo encima del marco, mismo grosor)
  const lineaActiva = () => {
    if (act.l) rect(-hw - m / 2, 0, m, p.h + 2 * m, Y);
    if (act.r) rect(hw + m / 2, 0, m, p.h + 2 * m, Y);
    if (act.t) rect(0, hh + m / 2, p.w + 2 * m, m, Y);
    if (act.b) rect(0, -hh - m / 2, p.w + 2 * m, m, Y);
  };
  if (deco.modo === 'escalar') {
    lineaActiva();                                       // abajo de los cuadraditos
    const s = 10 * px;                                   // cuadraditos de 10 px, centrados en el borde
    for (const [x, y, ks] of [[-hw, hh, 'lt'], [hw, hh, 'rt'], [-hw, -hh, 'lb'], [hw, -hh, 'rb'], [0, hh, 't'], [0, -hh, 'b'], [-hw, 0, 'l'], [hw, 0, 'r']]) {
      const on = [...ks].every(k => act[k]);
      rect(x, y, s + 2 * px, s + 2 * px, [0.1, 0.1, 0.12]);   // borde oscuro, así se ve sobre una foto clara
      rect(x, y, s, s, on ? Y : B);
    }
    return;
  }
  // recortar: tercios mientras un dedo recorta
  if (deco.activo) {
    for (const k of [-1 / 6, 1 / 6]) { rect(k * p.w, 0, px, p.h, B, 0.45); rect(0, k * p.h, p.w, px, B, 0.45); }
  }
  const g = 5 * px;                                      // grosor de las agarraderas (más que el marco), por fuera hasta el marco
  const brazo = (lado) => Math.min(26 * px, lado * 0.3);
  const ax = brazo(p.w), ay = brazo(p.h);
  const o = m - g / 2;                                   // el centro de la agarradera: su borde de afuera coincide con el del marco
  for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const kx = sx < 0 ? 'l' : 'r', ky = sy > 0 ? 't' : 'b';
    const ex = sx * (hw + o), ey = sy * (hh + o);        // centro de la línea de la agarradera
    // brazo horizontal (sobre el lado de arriba o abajo) y vertical (sobre el izquierdo o derecho)
    rect(sx * (hw + m) - sx * (ax + m) / 2, ey, ax + m, g, cl(ky));
    rect(ex, sy * (hh + m) - sy * (ay + m) / 2, g, ay + m, cl(kx));
  }
  // barritas en el medio de cada lado
  const bx = Math.min(30 * px, p.w * 0.25), by = Math.min(30 * px, p.h * 0.25);
  rect(0, hh + o, bx, g, cl('t')); rect(0, -hh - o, bx, g, cl('b'));
  rect(-hw - o, 0, g, by, cl('l')); rect(hw + o, 0, g, by, cl('r'));
  lineaActiva();                                         // al final: el lado que se mueve se ve entero, sin cortes
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
// una foto con números rotos (NaN, ejes en cero) no puede tocar la física: si no, te deja en NaN y no se ve nada
const finito3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
function poseRota(o) {
  if (!finito3(o.c) || !finito3(o.r) || !finito3(o.u)) return 'ejes';
  if (!(o.w > 0) || !(o.h > 0) || !Number.isFinite(o.w) || !Number.isFinite(o.h)) return 'tamaño ' + o.w + 'x' + o.h;
  if (len(o.r) < 1e-3 || len(o.u) < 1e-3 || len(cross(o.r, o.u)) < 1e-3) return 'ejes en cero o paralelos';
  return null;
}
function addWork(o, img) {
  const rota = poseRota(o);
  if (rota) diag(`foto rota ${String(o.id).slice(-6)}: ${rota} → no choca`);
  else { o = { ...o, r: norm(o.r), u: norm(o.u) }; }
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const w = { id: o.id, c: o.c, r: o.r, u: o.u, w: o.w, h: o.h, uv: (o.uv || FULL).slice(), aspect: o.vacio && o.w > 0 && o.h > 0 ? o.h / o.w : ih / iw,
              tex: texture(small(img)), buf: gl.createBuffer(), rota: !!rota, vacio: !!o.vacio, iv: o.iv };
  setBuf(w);
  works.push(w);
  return w;
}

// ---------- bloques vacíos: se ponen ahora y se llenan con una foto después ----------
const VACIO_IMG = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#3a3b44'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = '#6b6d7a'; x.lineWidth = 6; x.strokeRect(3, 3, 122, 122);
  x.lineWidth = 5; x.lineCap = 'round'; x.beginPath(); x.moveTo(64, 46); x.lineTo(64, 82); x.moveTo(46, 64); x.lineTo(82, 64); x.stroke();
  return c;
})();
// recorte centrado de una imagen (o del video) con la proporción alto/ancho pedida, a lo sumo de 1024 px
function recorteCentrado(src, aspecto) {
  const sw = src.naturalWidth || src.videoWidth || src.width, sh = src.naturalHeight || src.videoHeight || src.height;
  let cw = sw, ch = sw * aspecto;
  if (ch > sh) { ch = sh; cw = sh / aspecto; }
  const k = Math.min(1, 1024 / Math.max(cw, ch));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(cw * k)); c.height = Math.max(1, Math.round(ch * k));
  c.getContext('2d').drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, c.width, c.height);
  return c;
}
// uv para mostrar el video de la cámara centrado con la proporción de un bloque (mientras lo tenés en la mano)
function uvCentrado(aspecto) {
  const va = video.videoWidth ? video.videoHeight / video.videoWidth : 1;
  if (va > aspecto) { const k = aspecto / va; return [0, (1 - k) / 2, 1, (1 + k) / 2]; }
  const k = va / aspecto; return [(1 - k) / 2, 0, (1 + k) / 2, 1];
}
// con el bloque equipado, el disparador lo pone donde se ve en la mano (con su tamaño y forma)
function ponerBloque() {
  if (!started || held || !bloqueOn) return;
  const p = previewPose(basis());
  const o = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), c: p.c, r: p.r, u: p.u, w: p.w, h: p.h, uv: FULL.slice(), vacio: true };
  addWork(o, VACIO_IMG);
  if (sala.active) salaApi('poses/' + o.id, 'PUT', soloPose(o)).catch(() => showHint('no se pudo poner el bloque en la sala'));
  else store('readwrite', s => s.put({ ...o, blob: null })).catch(() => {});
  buzz(12);
  showHint('bloque vacío: agarralo para ponerle una foto');
}
// llenar el bloque que tenés en la mano con una imagen (foto de la cámara o de la galería). Se guarda recién al soltarlo
// (con la pose final: si se guardaba al llenarlo, una subida lenta pisaba después la pose de soltar); cancelar lo deja vacío.
// v10.7 (pedido de José): también a una foto que ya tiene imagen (se la cambia) o vaciarla (vaciarFoto).
// w.relleno guarda cómo estaba (texVieja, vacioViejo) para volver atrás si se suelta sin ✓.
function guardarComoEstaba(w) {
  if (w.relleno) { if (w.tex !== w.relleno.texVieja) gl.deleteTexture(w.tex); return w.relleno; }
  return { texVieja: w.tex, aspect: w.aspect, vacioViejo: !!w.vacio };
}
function llenarBloque(src) {
  if (!held) return;
  cur();
  const w = held.work, L = held.L, asp = L.h / L.w;
  const c = recorteCentrado(src, asp);
  const antes = guardarComoEstaba(w);
  w.relleno = { texVieja: antes.texVieja, aspect: antes.aspect, vacioViejo: antes.vacioViejo, c };
  w.tex = texture(small(c)); w.vacio = false; L.uv = FULL.slice(); w.aspect = asp;
  flash.style.transition = 'none'; flash.style.opacity = 0.7;
  requestAnimationFrame(() => { flash.style.transition = 'opacity 0.35s'; flash.style.opacity = 0; });
  buzz(15);
  ui();
}
// sacarle la imagen a la foto que tenés en la mano: queda un bloque vacío (se guarda recién al soltar con ✓)
function vaciarFoto() {
  if (!held || held.work.vacio) return;
  cur();
  const w = held.work;
  const antes = guardarComoEstaba(w);
  w.relleno = { texVieja: antes.texVieja, aspect: antes.aspect, vacioViejo: antes.vacioViejo, vaciar: true };
  w.tex = texture(VACIO_IMG); w.vacio = true; held.L.uv = FULL.slice();
  buzz(12);
  showHint('vacía: soltala con ✓ para guardarla así');
  ui();
}
// si se soltó sin ✓ (cancelar, la sala lo sacó de la mano...), vuelve a como estaba
function deshacerRelleno(w) {
  if (!w.relleno) return;
  gl.deleteTexture(w.tex); w.tex = w.relleno.texVieja; w.vacio = w.relleno.vacioViejo; w.aspect = w.relleno.aspect; w.relleno = null;
}
// tocar lo que tenés en la mano (sin moverlo): abre cámara / galería para ponerle una foto
function enLoQueTenes(x, y) {
  if (!held || held.aim) return false;
  const b = basis(), p = heldPose(b);
  const [tx, ty] = tans();
  const nx = (x / W) * 2 - 1, ny = 1 - (y / H) * 2;
  const d = norm(add(b.f, add(mul(b.r, nx * tx), mul(b.u, ny * ty))));
  const n = cross(p.r, p.u), den = dot(d, n);
  if (Math.abs(den) < 1e-6) return false;
  const t = dot(sub(p.c, pos), n) / den;
  if (t <= 0) return false;
  const q = sub(add(pos, mul(d, t)), p.c);
  return Math.abs(dot(q, p.r)) <= p.w / 2 && Math.abs(dot(q, p.u)) <= p.h / 2;
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
// el bloque vacío también es un ítem que se equipa (como la cámara): en la mano se ve un cuadrado gris que se
// acomoda igual que la vista previa de la cámara, y el disparador lo pone donde está
const freshBloque = () => ({ c: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0], w: DEFAULT_W, h: DEFAULT_W, uv: FULL.slice(), aspect: 1 });
let previewBloque = freshBloque();
let bloqueOn = false;
try { bloqueOn = localStorage.getItem('bloque') === '1'; } catch (e) {}
const enMano = () => bloqueOn ? previewBloque : preview;     // la vista previa del ítem equipado
const vacioEnMano = () => held ? !!held.work.vacio : bloqueOn;   // un bloque vacío: recortar es escalar (no hay imagen)
let held = null;            // { work, L }
let mode = 'mover';
const cur = () => { if (held && held.aim) finishAim(); return held ? held.L : enMano(); };
// distancia de lo que está en la mano (sin cortar el giro hacia la foto)
const heldDist = () => held && held.aim ? len(sub(held.work.c, pos)) : len(cur().c);

function worldPose(b, L) {
  return { c: add(pos, toWorldV(b, L.c)), r: toWorldV(b, L.r), u: toWorldV(b, L.u), w: L.w, h: L.h, uv: L.uv.slice() };
}

// ---------- colisiones: las fotos son paredes y pisos ----------
// casi horizontales (menos de 45°) = piso: te parás encima y subís escalones de hasta 40 cm sin saltar.
// el resto = pared: no se atraviesa. Lo que tenés en la mano (o tiene otro) no choca.
const CUERPO = 0.22, ESCALON = 0.4, GRAVEDAD = 9.8;
let velY = 0;
function solidas() {
  const otros = salaEnManos();
  return works.filter(w => (!held || w !== held.work) && !otros.has(w.id) && !w.rota);
}
const normal = w => norm(cross(w.r, w.u));
let posBuena = [0, EYE, 0];
function fisica(dt) {
  if (!pos.every(Number.isFinite)) {
    diagUna('pos rota ' + pos.join(',') + ' → vuelvo a la última buena');
    pos[0] = posBuena[0]; pos[1] = posBuena[1]; pos[2] = posBuena[2]; velY = 0;
  }
  const ws = solidas();
  let pies = pos[1] - EYE;
  // paredes: esferas apiladas de las rodillas a la cabeza; cada una se empuja afuera de cada foto, en horizontal
  for (let pasada = 0; pasada < 2; pasada++) {
    for (const w of ws) {
      const n = normal(w);
      if (Math.abs(n[1]) > 0.7) continue;
      for (let hy = ESCALON + 0.05; hy <= EYE + 0.01; hy += 0.2) {
        const q = [pos[0], pies + hy, pos[2]];
        const d = sub(q, w.c);
        const lx = clamp(dot(d, w.r), -w.w / 2, w.w / 2), ly = clamp(dot(d, w.u), -w.h / 2, w.h / 2);
        const cp = add(w.c, add(mul(w.r, lx), mul(w.u, ly)));
        const dist = len(sub(q, cp));
        if (dist >= CUERPO) continue;
        let e = sub(q, cp); e[1] = 0;
        if (len(e) < 1e-4) { e = [n[0], 0, n[2]]; if (dot(e, d) < 0) e = mul(e, -1); }
        e = norm(e);
        const px = pos[0] + e[0] * (CUERPO - dist), pz = pos[2] + e[2] * (CUERPO - dist);
        if (!Number.isFinite(px) || !Number.isFinite(pz)) { w.rota = true; diag(`foto ${String(w.id).slice(-6)} rompía la física → no choca`); continue; }
        pos[0] = px; pos[2] = pz;
      }
    }
  }
  const suelo = sueloEn(pos[0], pos[2], pies, ws);
  if (pies <= suelo + 0.001) { pies = suelo; velY = 0; }            // parado (o subió un escalón)
  else { velY -= GRAVEDAD * dt; pies = Math.max(suelo, pies + velY * dt); if (pies === suelo) velY = 0; }
  pos[1] = pies + EYE;
  if (pos.every(Number.isFinite)) posBuena = pos.slice();
}

// piso: el más alto que esté abajo de los pies (o apenas arriba: escalón)
function sueloEn(x, z, pies, ws) {
  let suelo = 0;
  for (const w of ws) {
    const n = normal(w);
    if (Math.abs(n[1]) <= 0.7) continue;
    const y = w.c[1] - (n[0] * (x - w.c[0]) + n[2] * (z - w.c[2])) / n[1];
    if (y > pies + ESCALON || y <= suelo) continue;
    const d = sub([x, y, z], w.c), m = 0.08;
    if (Math.abs(dot(d, w.r)) <= w.w / 2 + m && Math.abs(dot(d, w.u)) <= w.h / 2 + m) suelo = y;
  }
  return suelo;
}
// ¿alguna foto corta el segmento de a a b?
function tapado(a, b, ws) {
  const d = sub(b, a);
  for (const w of ws) {
    const n = cross(w.r, w.u), den = dot(d, n);
    if (Math.abs(den) < 1e-9) continue;
    const t = dot(sub(w.c, a), n) / den;
    if (t <= 0 || t >= 1) continue;
    const p = sub(add(a, mul(d, t)), w.c);
    if (Math.abs(dot(p, w.r)) <= w.w / 2 + 0.05 && Math.abs(dot(p, w.u)) <= w.h / 2 + 0.05) return true;
  }
  return false;
}
// ir al lado de alguien (v10.9, propuesta 13: encontrarse): a 1,5 m, delante suyo si se puede, en un lugar
// del mismo piso y sin una pared en el medio (así quedan en el mismo cuarto), y mirándolo.
// q = sus ojos, yaw = para dónde mira. atras (v10.10, al seguir): primero detrás suyo. Devuelve false si los datos no sirven.
function irHacia(q, yaw, atras) {
  if (!finito3(q) || !Number.isFinite(yaw)) return false;
  if (held && held.aim) finishAim();
  const ws = solidas(), piesQ = Math.max(0, q[1] - EYE);
  const ojos = piesQ + EYE;
  let dest = null;
  const giro0 = atras ? Math.PI : 0;
  buscar: for (const d of [1.5, 0.9]) for (const a of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
    const dir = [-Math.sin(yaw + giro0 + a), 0, -Math.cos(yaw + giro0 + a)], lejos = d + CUERPO + 0.1;
    const x = q[0] + dir[0] * d, z = q[2] + dir[2] * d;
    if (Math.abs(sueloEn(x, z, piesQ, ws) - piesQ) > 0.1) continue;          // otro piso (o el vacío, si está arriba)
    let libre = true;
    for (const h of [EYE, 0.6]) {                                             // a la altura de los ojos y de las rodillas
      const a0 = [q[0], piesQ + h, q[2]];
      if (tapado(a0, [q[0] + dir[0] * lejos, piesQ + h, q[2] + dir[2] * lejos], ws)) { libre = false; break; }
    }
    if (libre) { dest = [x, z]; break buscar; }
  }
  if (!dest) dest = [q[0] - Math.sin(yaw + giro0) * 0.6, q[2] - Math.cos(yaw + giro0) * 0.6];   // muy encerrado: pegado a él (la física acomoda)
  pos[0] = dest[0]; pos[1] = ojos; pos[2] = dest[1]; velY = 0;
  fisica(0);
  mirarDir(sub(q, pos));   // mirarlo
  return true;
}
// girar la vista para mirar en la dirección d (con el giroscopio el ajuste no es exacto de una: unas vueltas)
function mirarDir(d) {
  if (!finito3(d) || len(d) < 1e-6) return;
  d = norm(d);
  for (let i = 0; i < 6; i++) {
    const f = basis().f;
    let eh = heading(d) - heading(f); eh = Math.atan2(Math.sin(eh), Math.cos(eh));
    if (Math.hypot(d[0], d[2]) < 0.05) eh = 0;
    yawOff += eh;
    pitchOff = clamp(pitchOff + Math.asin(clamp(d[1], -1, 1)) - Math.asin(clamp(f[1], -1, 1)), -1.4, 1.4);
  }
}

// ---------- grilla: alinear lo que está en la mano ----------
const SNAP = 0.1, SNAP_YAW = Math.PI / 2;
let grilla = false;
// el paso de la grilla (v10.8, pedido de José): 1 m, 50 cm o 25 cm; el botón va 1 m → 50 cm → 25 cm → apagada
const PASOS_GRILLA = [1, 0.5, 0.25];
let pasoGrilla = 1;
try {
  grilla = localStorage.getItem('grilla') === '1';
  const pg = Number(localStorage.getItem('grillaPaso'));
  if (PASOS_GRILLA.includes(pg)) pasoGrilla = pg;
} catch (e) {}
const snapA = (a, k) => Math.round(a / k) * k;
const snapP = (v, P) => Math.round(v / P) * P;
// grilla (de a P: 1 m como los puntitos del piso, 50 cm o 25 cm): de pie (o acostada si está casi horizontal), mirando en
// pasos de 90°, girada en pasos de 90°, el lado más largo en múltiplos de P (P mínimo; el otro sigue la proporción)
// y la esquina de abajo a la izquierda en un punto de la grilla (x, y, z múltiplos de P).
function snapPose(p, P = pasoGrilla) {
  const up = [0, 1, 0];
  let n = norm(cross(p.r, p.u)), u;
  if (Math.abs(n[1]) > 0.7) {                       // acostada (piso o techo)
    n = [0, n[1] > 0 ? 1 : -1, 0];
    const a = snapA(Math.atan2(p.u[0], p.u[2]), SNAP_YAW);
    u = [Math.round(Math.sin(a)), 0, Math.round(Math.cos(a))];
  } else {                                           // de pie
    const a = snapA(Math.atan2(n[0], n[2]), SNAP_YAW);
    n = [Math.round(Math.sin(a)), 0, Math.round(Math.cos(a))];
    const r0 = cross(up, n);
    const t = snapA(Math.atan2(dot(p.u, r0), dot(p.u, up)), Math.PI / 2);
    u = add(mul(up, Math.round(Math.cos(t))), mul(r0, Math.round(Math.sin(t))));
  }
  const r = cross(u, n);                             // así cross(r, u) = n (el lado de adelante no cambia)
  // el lado más largo, al múltiplo de P más cercano (mínimo P); el otro sigue la proporción (una tira angosta no se estira)
  const k = p.w >= p.h ? Math.max(P, snapP(p.w, P)) / p.w : Math.max(P, snapP(p.h, P)) / p.h;
  const w = p.w * k, h = p.h * k;
  const c0 = sub(sub(p.c, mul(r, w / 2)), mul(u, h / 2));
  const corner = c0.map(v => snapP(v, P));
  return { c: add(add(corner, mul(r, w / 2)), mul(u, h / 2)), r, u, w, h, uv: p.uv.slice() };
}
// guías: la grilla en 3D (de a pasoGrilla) alrededor de lo que tenés en la mano; se apaga del todo a GUIA_R de la foto
// (alfa según la distancia a la foto: las líneas a GUIA_R o más ya no se ven, así que no se dibujan).
// GUIA_R es 1 m con pasos de 1 m y 50 cm, y 50 cm con pasos de 25 cm (si no, son demasiadas líneas para el celu).
// Los 4 bordes de la foto, prolongados, van más marcados; las demás líneas, más tenues y finas cuanto más lejos y más chico el paso.
// Todas se desvanecen en las puntas. No se dibujan las que cruzan la cara de la foto.
const guiaR = P => Math.min(1, 2 * P);
function guiasGrilla(p, col) {
  const P = pasoGrilla, finas = P >= 1 ? 1 : P >= 0.5 ? 0.85 : 0.7;
  const esquina = sub(sub(p.c, mul(p.r, p.w / 2)), mul(p.u, p.h / 2));
  const otra = add(add(esquina, mul(p.r, p.w)), mul(p.u, p.h));
  const lo = [0, 1, 2].map(i => Math.min(esquina[i], otra[i])), hi = [0, 1, 2].map(i => Math.max(esquina[i], otra[i]));
  if (![...lo, ...hi].every(Number.isFinite)) return;
  const ext = [0, 1, 2].map(i => hi[i] - lo[i]);
  // el paso de las guías: el de la grilla, salvo en fotos grandes (más de 12 pasos), donde se duplica hasta 1 m
  // (si no, con 25 cm una foto de 4 m son cientos de líneas por cuadro). Igual caen en líneas de la grilla.
  let G = P;
  while (G < 1 && Math.max(...ext) / G > 12) G *= 2;
  const GUIA_R = guiaR(G);
  const t = ext.indexOf(Math.min(...ext));            // el eje del grosor (la foto es plana en ese eje)
  const E = 1e-4, dentro = (i, v) => v > lo[i] + E && v < hi[i] - E, igual = (a, b) => Math.abs(a - b) < E;
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  const tramo = (a, b, px, alfa, fade) => {
    const dir = sub(b, a), largo = len(dir);
    if (largo < 1e-3 || alfa <= 0.01) return;
    const mid = add(a, mul(dir, 0.5)), tt = mul(dir, 1 / largo);
    let lado = cross(tt, sub(mid, pos));
    if (len(lado) < 1e-6) lado = cross(tt, [0, 1, 0]);
    drawQuad(scratch, quadData(mid, norm(lado), tt, metersPerPx(Math.max(0.3, len(sub(mid, pos)))) * px, largo), white, col, alfa, fade);
  };
  // una línea a lo largo del eje e, que pasa por q (las otras dos coordenadas); con núcleo (a lo largo de la foto) y colas
  // d = a qué distancia de la foto pasa la línea (de costado); las colas se apagan donde quedan a GUIA_R de la foto
  const linea = (e, q, px, alfa, conNucleo, d) => {
    const en = v => { const r = q.slice(); r[e] = v; return r; };
    const cola = Math.sqrt(Math.max(0, GUIA_R * GUIA_R - d * d));
    if (conNucleo) tramo(en(lo[e]), en(hi[e]), px, alfa);
    tramo(en(hi[e]), en(hi[e] + cola), px, alfa, [0, 1]);          // +u = la punta: se apaga
    const piso = e === 1 ? Math.max(0, lo[e] - cola) : lo[e] - cola;   // las verticales no bajan del piso
    const f = cola > 0 ? 1 - (lo[e] - piso) / cola : 0;
    tramo(en(piso), en(lo[e]), px, alfa, [1, f]);
  };
  // los 4 bordes, prolongados
  const bordes = [];
  for (const e of [0, 1, 2]) {
    if (e === t) continue;
    const o = 3 - e - t;                               // el otro eje del plano de la foto
    for (const v of [lo[o], hi[o]]) { const q = [0, 0, 0]; q[t] = lo[t]; q[o] = v; bordes.push([e, o, v]); linea(e, q, 2.2, 0.85, true, 0); }
  }
  // la grilla
  // en números enteros de pasos (así no se acumulan errores de redondeo)
  const nR = Math.ceil(GUIA_R / G - E);
  const rango = i => { const a = Math.floor((lo[i] + E) / G) - nR, b = Math.ceil((hi[i] - E) / G) + nR; return [i === 1 ? Math.max(0, a) : a, b]; };
  for (const e of [0, 1, 2]) {
    const b = (e + 1) % 3, c = (e + 2) % 3, [b0, b1] = rango(b), [c0, c1] = rango(c);
    for (let nb = b0; nb <= b1; nb++) for (let nc = c0; nc <= c1; nc++) {
      const vb = nb * G, vc = nc * G;
      const q = [0, 0, 0]; q[b] = vb; q[c] = vc;
      const d = Math.hypot(Math.max(0, lo[b] - vb, vb - hi[b]), Math.max(0, lo[c] - vc, vc - hi[c]));
      if (d > GUIA_R - 0.05 * GUIA_R) continue;                       // a GUIA_R ya no se ve
      if (bordes.some(([be, bo, bv]) => be === e && igual(q[t], lo[t]) && igual(q[bo], bv))) continue;   // ya es un borde
      let conNucleo = true;
      if (e === t) { if (dentro(b, vb) && dentro(c, vc)) continue; }          // atraviesa la foto de frente
      else if (dentro(3 - e - t, q[3 - e - t])) conNucleo = false;   // va por encima de la cara de la foto (o delante/detrás, a un paso: v10.8)
      linea(e, q, 1.2 * finas, 0.3 * (1 - d / GUIA_R), conNucleo, d);
    }
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

// dónde queda lo que tenés en la mano (con la grilla prendida, ya alineado; también mientras se recorta o se escala:
// los bordes se mueven de a un paso de la grilla, así lo que se ve es lo que queda)
function heldPose(b) {
  if (held.aim) return held.work;
  const p = worldPose(b, held.L);
  return grilla ? snapPose(p) : p;
}
function previewPose(b) {
  const p = worldPose(b, enMano());
  return grilla ? snapPose(p) : p;
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
// girar como una bola: alrededor del eje vertical (ax) y horizontal (ay) DE LA PANTALLA, no de la foto
// (con los de la foto, después de darla vuelta 180° el arrastre vertical giraba al revés). L está en coordenadas de la cámara.
function spinBy(L, ax, ay) {
  const Y = [0, 1, 0], X = [1, 0, 0];
  L.r = norm(rotAxis(rotAxis(L.r, Y, ax), X, ay));
  L.u = norm(rotAxis(rotAxis(L.u, Y, ax), X, ay));
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
// recortar o escalar: mover bordes. edges = {l, r, t, b}; base = cómo estaba al apoyar el dedo; (a, bb) = el dedo
// en el plano de la foto (metros, desde el centro de base). Recortar cambia qué parte de la imagen se ve (uv);
// escalar (estirar) estira la imagen en x o en y. Con la grilla, los bordes caen en líneas de la grilla (de a un paso
// desde la esquina, que ya está en un punto de la grilla) y solo se permite lo que queda igual al alinearlo: el lado más
// largo en múltiplos del paso. Si no hay ninguna posición posible, el borde no se mueve (devuelve false).
function stableGrilla(w, h, P = pasoGrilla) { const m = Math.max(w, h); return m >= P - 1e-6 && Math.abs(m - snapP(m, P)) < 1e-6; }
function bordesA(L, base, edges, a, bb, estirar, alinear) {
  const [u0, v0, u1, v1] = base.uv;
  const su = base.w / (u1 - u0), sv = base.h / (v1 - v0);
  const L0 = -base.w / 2, R0 = base.w / 2, T0 = base.h / 2, B0 = -base.h / 2;
  const P = pasoGrilla, mn = alinear ? 0.05 : 0.04 * len(base.c), MAX = 40;
  const lim = {
    r: [L0 + mn, estirar ? L0 + MAX : L0 + (1 - u0) * su],
    l: [estirar ? R0 - MAX : R0 - u1 * su, R0 - mn],
    t: [B0 + mn, estirar ? B0 + MAX : B0 + v1 * sv],
    b: [estirar ? T0 - MAX : T0 - (1 - v0) * sv, T0 - mn],
  };
  const E = 1e-6;
  // posiciones posibles de cada borde (con la grilla: la de ahora y las líneas de la grilla dentro del límite)
  const opciones = (k, fijo, desde, quiero) => {
    if (!edges[k]) return [fijo];
    const [lo, hi] = lim[k];
    if (!alinear) return [clamp(quiero, lo, hi)];
    const o = [fijo];
    for (let n = Math.ceil((lo - desde) / P - E); desde + n * P <= hi + E; n++) if (desde + n * P >= lo - E) o.push(desde + n * P);
    return o;
  };
  // los bordes de la izquierda y de abajo están en la grilla (la esquina); los otros, a pasos enteros de ellos
  const xs = edges.r ? opciones('r', R0, L0, a).map(x => [L0, x]) : opciones('l', L0, L0, a).map(x => [x, R0]);
  const ys = edges.t ? opciones('t', T0, B0, bb).map(y => [B0, y]) : opciones('b', B0, B0, bb).map(y => [y, T0]);
  // la distancia se mide hasta donde iría el borde sin grilla (el dedo, dentro del límite): así pasarse de la imagen no avisa
  const ta = edges.l ? clamp(a, ...lim.l) : edges.r ? clamp(a, ...lim.r) : 0, tb = edges.b ? clamp(bb, ...lim.b) : edges.t ? clamp(bb, ...lim.t) : 0;
  let mejor = null, costo = Infinity;
  for (const [l, r] of xs) for (const [b, t] of ys) {
    if (alinear && !stableGrilla(r - l, t - b)) continue;
    const c = (edges.l ? Math.abs(l - ta) : edges.r ? Math.abs(r - ta) : 0) + (edges.b ? Math.abs(b - tb) : edges.t ? Math.abs(t - tb) : 0);
    if (c < costo - 1e-9) { costo = c; mejor = [l, r, b, t]; }
  }
  if (!mejor) return false;
  const [left, right, bottom, top] = mejor;
  L.c = add(base.c, add(mul(base.r, (left + right) / 2), mul(base.u, (top + bottom) / 2)));
  L.r = base.r.slice(); L.u = base.u.slice();
  L.w = right - left; L.h = top - bottom;
  if (estirar) L.uv = base.uv.slice();
  else {
    const c01 = v => clamp(v, 0, 1);
    L.uv = [c01(u0 + (left - L0) / su), c01(v0 + (T0 - top) / sv), c01(u0 + (right - L0) / su), c01(v0 + (T0 - bottom) / sv)];
  }
  // ¿se quedó lejos del dedo porque la grilla no deja? (para avisar)
  return { lejos: costo > 0.55 * P };
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
  const aspect = held ? held.work.aspect : bloqueOn ? 1 : (video.videoWidth ? video.videoHeight / video.videoWidth : 4 / 3);
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
function releaseHold() {
  const w = held && held.work;
  held = null;
  if (w) { deshacerRelleno(w); if (sala.active) salaSoltado(w); }
  setMode('mover'); if (ajustando) setAjustar(false); ui();
}
function clearWorks() {
  held = null;
  for (const w of works) { if (w.relleno) gl.deleteTexture(w.relleno.texVieja); gl.deleteTexture(w.tex); gl.deleteBuffer(w.buf); }
  works.length = 0;
}

function drop() {
  if (!held) return;
  cur();
  const w = held.work;
  Object.assign(w, heldPose(basis(), true));
  const relleno = w.relleno; w.relleno = null;
  if (relleno) { gl.deleteTexture(relleno.texVieja); w.aspect = w.h / w.w; }
  if (relleno) w.imgN = (w.imgN || 0) + 1;               // museo: si la cambiás otra vez antes de que se guarde, gana la última
  const imgN = w.imgN;
  if (relleno && !relleno.vaciar) w.iv = Date.now();     // imagen nueva: los demás de la sala la vuelven a bajar
  if (relleno) w.llenadoAfuera = null;                   // cambiaste la imagen vos: gana lo tuyo
  setBuf(w);
  const pose = { c: w.c, r: w.r, u: w.u, w: w.w, h: w.h, uv: w.uv };
  if (sala.active) {
    if (relleno && relleno.vaciar) salaVaciar(w);
    else relleno ? salaShoot({ id: w.id, ...pose }, relleno.c, w) : salaSavePose(w);
  } else if (relleno && relleno.vaciar) {
    store('readwrite', s => { const q = s.get(w.id); q.onsuccess = () => q.result && s.put({ ...q.result, ...pose, blob: null, vacio: true }); }).catch(() => {});
  } else {
    store('readwrite', s => { const q = s.get(w.id); q.onsuccess = () => q.result && s.put({ ...q.result, ...pose }); }).catch(() => {});
    // el bloque lleno: la imagen se agrega al registro que haya (si mientras tanto lo borraste, no lo revive)
    if (relleno) relleno.c.toBlob(blob => {
      if (!blob) { diag('bloque: no pude guardar la imagen'); return; }
      if (w.imgN !== imgN) return;   // mientras tanto la vaciaste o la cambiaste
      store('readwrite', s => { const q = s.get(w.id); q.onsuccess = () => q.result && s.put({ ...q.result, blob, vacio: false }); }).catch(() => {});
    }, 'image/jpeg', 0.85);
  }
  buzz(12);
  releaseHold();
}
function cancelHold() { if (held) { buzz(8); releaseHold(); } }
function trash() {
  if (!held) return;
  const w = held.work;
  works.splice(works.indexOf(w), 1);
  if (w.relleno) { gl.deleteTexture(w.relleno.texVieja); w.relleno = null; }
  gl.deleteTexture(w.tex); gl.deleteBuffer(w.buf);
  if (sala.active) salaRemove(w);
  else store('readwrite', s => s.delete(w.id)).catch(() => {});
  buzz(20);
  releaseHold();
}

// el rayo que sale de la cámara por el punto (x, y) de la pantalla
function rayoEn(x, y) {
  const b = basis();
  const [tx, ty] = tans();
  const nx = (x / W) * 2 - 1, ny = 1 - (y / H) * 2;
  return norm(add(b.f, add(mul(b.r, nx * tx), mul(b.u, ny * ty))));
}
function workAt(x, y) { const h = workHit(x, y); return h && h.w; }
function workHit(x, y) {
  const d = rayoEn(x, y);
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
  return best && { w: best, t: bestT };
}

// ---------- guardado (solo en el celu) ----------
// bug conocido de Safari/iOS: al reabrir la app, indexedDB.open a veces no responde nunca (hasta que se lo
// vuelve a "tocar"). Se lo pincha cada 150 ms y, si en 6 s no abre, se rinde (el juego sigue sin el museo guardado).
const db = new Promise((res, rej) => {
  let listo = false;
  const r = indexedDB.open('juego', 2);
  r.onupgradeneeded = () => {
    if (!r.result.objectStoreNames.contains('obras')) r.result.createObjectStore('obras', { keyPath: 'id' });
  };
  r.onsuccess = () => { listo = true; res(r.result); };
  r.onerror = () => { listo = true; rej(r.error); };
  let n = 0;
  const pinchar = setInterval(() => {
    if (listo) { if (n) diag(`guardado: abrió después de ${n * 150} ms`); return clearInterval(pinchar); }
    n++;
    if (n === 2) diag('guardado: indexedDB tarda en abrir');
    try { if (indexedDB.databases) indexedDB.databases().catch(() => {}); } catch (e) {}
    if (n > 40) { clearInterval(pinchar); diag('guardado: indexedDB no responde'); listo = true; rej(new Error('indexedDB no responde')); }
  }, 150);
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
    if (o && o.vacio && !o.blob) { if (!sala.active) addWork(o, VACIO_IMG); continue; }
    if (!o || !o.blob) continue;
    const url = URL.createObjectURL(o.blob);
    const img = new Image(); img.src = url;
    try {
      await Promise.race([img.decode(), new Promise((_, rej) => setTimeout(() => rej(new Error('tardó')), 5000))]);
      if (!sala.active) addWork(o, img);
    } catch (e) { diag('museo: no pude abrir una foto (' + e.message + ')'); }
    img.src = ''; URL.revokeObjectURL(url);
    await new Promise(r => setTimeout(r, 0));
  }
  diag(`museo: ${works.length} fotos cargadas`);
}

// ---------- cámara (un ítem que se equipa y se guarda) ----------
let camReady = false, camOn = true, camStarting = false;
try { camOn = localStorage.getItem('camara') !== '0'; } catch (e) {}
if (bloqueOn) camOn = false;   // un ítem a la vez: la cámara o el bloque
// qué cámara usa la de fotos: la de atrás (normal) o la de adelante (para ponerte vos en las fotos)
let camFrente = false, camVarias = false, camAspecto = 0;
try { camFrente = localStorage.getItem('camFrente') === '1'; } catch (e) {}
// conMic: al arrancar ya en una sala, cámara y micrófono en un solo pedido (un cartel en vez de dos en iPhone)
async function startCamera(conMic) {
  if (camReady || camStarting) return;
  camStarting = true;
  try {
    const vid = { facingMode: camFrente ? 'user' : 'environment', width: { ideal: 960 }, height: { ideal: 960 } };
    let s;
    if (conMic) {
      try {
        s = await navigator.mediaDevices.getUserMedia({ audio: RTC_MIC, video: vid });
        if (s.getAudioTracks().length && !rtc.mic) rtc.mic = new MediaStream(s.getAudioTracks());
        else s.getAudioTracks().forEach(t => t.stop());
        s = new MediaStream(s.getVideoTracks());
      } catch (e) { diag('cámara y mic juntos: falló ' + e.name + ', pruebo solo la cámara'); s = null; }
    }
    if (!s) s = await navigator.mediaDevices.getUserMedia({ audio: false, video: vid });
    if (!camOn) { s.getTracks().forEach(t => t.stop()); return; }   // la guardaste mientras abría
    video.srcObject = s;
    await video.play().catch(e => { if (camOn) throw e; });
    if (!camOn || video.srcObject !== s) { s.getTracks().forEach(t => t.stop()); return; }   // la guardaste (o pusiste el bloque) mientras abría
    camReady = true;
    diag('cámara de fotos: abierta ' + video.videoWidth + 'x' + video.videoHeight + (camFrente ? ' (la de adelante)' : ''));
    // si la otra cámara tiene otra proporción, la vista previa la sigue (sin perder el tamaño ni el recorte)
    const asp = video.videoWidth ? video.videoHeight / video.videoWidth : 0;
    if (asp && camAspecto && Math.abs(asp - camAspecto) > 1e-3 && !preview.fresh) preview.h *= asp / camAspecto;
    if (asp) camAspecto = asp;
    if (!camVarias && navigator.mediaDevices.enumerateDevices) navigator.mediaDevices.enumerateDevices()
      .then(ds => { camVarias = ds.filter(d => d.kind === 'videoinput').length > 1; ui(); }).catch(() => {});
    rtcPistas();   // en una sala, los demás ven lo que encuadrás
  } catch (e) {
    if (camOn) showHint('no pude abrir la cámara: ' + (e && e.name || e), true);
    diag('cámara de fotos: falló ' + (e && e.name || e));
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
  if (on && bloqueOn) { bloqueOn = false; try { localStorage.setItem('bloque', '0'); } catch (e) {} if (!held) { setMode('mover'); if (ajustando) setAjustar(false); } }
  if (on) { rtcSoltarCara(); startCamera(); }
  else { stopCamera(); if (!held) { setMode('mover'); if (ajustando) setAjustar(false); } rtcMedios(); }   // guardarla pliega ajustar (como soltar)
  buzz(10);
  ui();
}

// equipar / guardar el bloque vacío (un ítem a la vez: equiparlo guarda la cámara)
function setBloque(on) {
  const apagoCam = on && camOn;
  if (apagoCam) { camOn = false; try { localStorage.setItem('camara', '0'); } catch (e) {} stopCamera(); }
  bloqueOn = on;
  try { localStorage.setItem('bloque', on ? '1' : '0'); } catch (e) {}
  if (!held) { setMode('mover'); if (ajustando) setAjustar(false); }
  if (apagoCam) rtcMedios();   // sin la cámara de fotos vuelve tu cara
  if (on) showHint('bloque vacío: el disparador lo pone ahí · después agarralo para ponerle una foto');
  buzz(10);
  ui();
}

// cambiar entre la cámara de atrás y la de adelante (las dos no pueden estar abiertas a la vez)
async function camGirar() {
  if (!camOn || camStarting) return;
  camFrente = !camFrente;
  try { localStorage.setItem('camFrente', camFrente ? '1' : '0'); } catch (e) {}
  stopCamera();
  const abriendo = startCamera(); ui();   // startCamera ya marcó camStarting: el botón se ve ocupado
  await abriendo;
  if (camReady) showHint(camFrente ? 'cámara de adelante' : 'cámara de atrás');
}

function shoot() {
  if (bloqueOn) return ponerBloque();
  if (!camOn || !camReady || !video.videoWidth || held) return;
  const pose = previewPose(basis());
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
  recortar: 'borde o esquina: recortar · adentro: mover la imagen · dos dedos: zoom',
  escalar: 'borde: estirar a lo ancho o a lo alto · esquina: las dos cosas · dos dedos: tamaño',
  girar: 'un dedo la gira sobre su eje · dos dedos la rotan',
};
function setMode(m) {
  mode = m;
  for (const el of modesEl.querySelectorAll('[data-m]')) el.classList.toggle('on', el.dataset.m === m);
}
// modos de ajuste: tocar uno lo activa; tocar el activo vuelve a "mover" (el normal)
for (const el of modesEl.querySelectorAll('[data-m]')) {
  el.addEventListener('click', () => { const m = mode === el.dataset.m ? 'mover' : el.dataset.m; setMode(m); showHint(MODE_HINT[m]); });
}
const ajustarBtn = $('ajustar');
let ajustando = false;
function setAjustar(on) {
  ajustando = on;
  if (!on && mode !== 'mover') setMode('mover');
  ajustarBtn.classList.toggle('on', on);
  ajustarBtn.textContent = on ? 'ajustar ▴' : 'ajustar ▾';
  ui();
}
ajustarBtn.addEventListener('click', () => setAjustar(!ajustando));
resetBtn.addEventListener('click', resetHeld);
const grillaBtn = $('grilla');
const pasoTxt = P => P >= 1 ? '1 m' : Math.round(P * 100) + ' cm';
function paintGrilla() { grillaBtn.textContent = grilla ? '▦ ' + pasoTxt(pasoGrilla) : '▦ grilla: no'; grillaBtn.classList.toggle('on', grilla); }
// cada toque: apagada → 1 m → 50 cm → 25 cm → apagada
grillaBtn.addEventListener('click', () => {
  if (!grilla) { grilla = true; pasoGrilla = PASOS_GRILLA[0]; }
  else {
    const i = PASOS_GRILLA.indexOf(pasoGrilla);
    if (i < 0 || i >= PASOS_GRILLA.length - 1) grilla = false; else pasoGrilla = PASOS_GRILLA[i + 1];
  }
  try { localStorage.setItem('grilla', grilla ? '1' : '0'); localStorage.setItem('grillaPaso', String(pasoGrilla)); } catch (e) {}
  paintGrilla(); buzz(8);
  if (grilla) showHint(pasoGrilla >= 1 ? 'grilla de a metro, como los puntitos del piso: posición, altura, tamaño y giros de 90°'
    : 'grilla de a ' + pasoTxt(pasoGrilla) + ': posición, altura y tamaño; giros de 90°');
});
paintGrilla();

let started = false;
function ui() {
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };
  const holding = !!held, camUp = camOn && camReady, previa = camUp || bloqueOn, canEdit = started && (holding || previa) && !pjVista;   // en el editor de personaje no se edita lo de la mano
  show(joyEl, started && TACTIL);
  show($('menuBtn'), started);
  show($('salaBtn'), started);
  show($('micBtn'), started && sala.active);
  rtcPintar();   // la carita de "cara apagada" (solo en sala)
  show(gyroBtn, gyroMode);
  show($('opcAtajos'), !TACTIL);
  show(distEl, canEdit);
  show($('edicion'), canEdit);
  show(modesEl, canEdit && ajustando);
  show(shootBtn, started && previa && !holding);
  shootBtn.classList.toggle('bloque', bloqueOn);
  show(equipBtn, started && !camOn && !bloqueOn && !holding);
  show(unequipBtn, started && camOn && !holding);
  show($('girarCam'), started && camOn && !holding && TACTIL && camVarias);
  // el bloque: equiparlo (al lado de la cámara) o, ya equipado, guardarlo o pasar a la cámara
  show($('bloque'), started && !bloqueOn && !holding);
  $('bloque').classList.toggle('solo', !camOn);
  show($('guardarBloque'), started && bloqueOn && !holding);
  show($('camChica'), started && bloqueOn && !holding);
  const vacio = holding && held.work.vacio;
  // con el bloque equipado (cámara guardada), "cámara" la abre para sacarle la foto; ya abierta, "sacar foto"
  show($('llenarFoto'), vacio); show($('vaciarFoto'), holding && !held.work.vacio);
  if (vacio) $('llenarFoto').textContent = camUp ? 'sacar foto' : camOn ? 'abriendo…' : 'cámara';
  $('girarCam').classList.toggle('ocupado', camStarting);
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
  fovBtn.textContent = 'campo de visión';
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
$('bloque').addEventListener('click', () => setBloque(true));
$('guardarBloque').addEventListener('click', () => setBloque(false));
$('camChica').addEventListener('click', () => setCam(true));
$('llenarFoto').addEventListener('click', () => { if (camReady && video.videoWidth) llenarBloque(video); else if (!camOn) setCam(true); });
$('vaciarFoto').addEventListener('click', vaciarFoto);
$('bloqueArchivo').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  const url = URL.createObjectURL(f), img = new Image();
  try { img.src = url; await img.decode(); llenarBloque(img); }
  catch (err) { showHint('no pude abrir esa imagen'); diag('bloque: no pude abrir la imagen (' + (err && err.message) + ')'); }
  finally { URL.revokeObjectURL(url); }
});
$('girarCam').addEventListener('click', camGirar);
equipBtn.addEventListener('click', () => setCam(true));
unequipBtn.addEventListener('click', () => setCam(false));

// ---------- volver al inicio ----------
homeBtn.addEventListener('click', () => {
  salaDejarDeSeguir('inicio');
  pos[0] = 0; pos[1] = EYE; pos[2] = 0; velY = 0;
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
joyEl.addEventListener('pointerdown', e => { joy.id = e.pointerId; joyEl.setPointerCapture(e.pointerId); joyUpdate(e); salaDejarDeSeguir('joystick'); });
joyEl.addEventListener('pointermove', e => { if (e.pointerId === joy.id) joyUpdate(e); });
joyEl.addEventListener('pointerup', joyEnd);
joyEl.addEventListener('pointercancel', joyEnd);

// ---------- menú de opciones (☰): lo que no hace falta tener siempre a la vista ----------
const opcionesEl = $('opciones');
$('menuBtn').addEventListener('click', () => {
  const abrir = opcionesEl.style.display === 'none';
  for (const id of ['salaPanel', 'fovPanel', 'salasPanel', 'comPanel', 'cuentaPanel']) $(id).style.display = 'none';
  if (pjVista) pjCerrar();
  opcionesEl.style.display = abrir ? '' : 'none';
  $('menuBtn').classList.toggle('on', abrir);
});
const cerrarOpciones = () => { opcionesEl.style.display = 'none'; $('menuBtn').classList.remove('on'); };
$('opcCerrar').addEventListener('click', cerrarOpciones);
for (const el of opcionesEl.querySelectorAll('.cierra')) el.addEventListener('click', cerrarOpciones);
$('opcAtajos').addEventListener('click', () => showHint(ATAJOS));
$('salaBtn').addEventListener('click', cerrarOpciones);
// la barra del campo de visión se cierra tocando afuera de ella
// y ese toque solo cierra (no agarra una foto, no saca otra, no borra).
// Se traga el click de ESE dedo, que llega después de levantarlo (aunque haya sido un toque largo):
// hasta 600 ms después de su pointerup. Mientras sigue apoyado, los clicks son de otros dedos y pasan.
// Si fue un arrastre no hay click: el bloqueo se va solo, o con el próximo toque.
let tragarPtr = null, tragarHasta = 0;
document.addEventListener('pointerdown', e => {
  // un toque nuevo: su click es suyo, no se traga (isPrimary = no hay otro dedo apoyado: si quedó un dedo viejo anotado, es que no llegó su pointerup)
  if (tragarPtr === null || e.isPrimary) { tragarPtr = null; tragarHasta = 0; }
  if (fovPanel.style.display !== 'none' && !fovPanel.contains(e.target) && e.target !== fovBtn) {
    fovPanel.style.display = 'none'; fovBtn.classList.remove('on');
    e.stopPropagation(); e.preventDefault();
    tragarPtr = e.pointerId; tragarHasta = 0;
  }
}, true);
const tragarSuelta = e => {
  if (e.pointerId !== tragarPtr) return;
  tragarPtr = null; tragarHasta = e.type === 'pointerup' ? performance.now() + 600 : 0;
};
document.addEventListener('pointerup', tragarSuelta, true);
document.addEventListener('pointercancel', tragarSuelta, true);
document.addEventListener('click', e => {
  if (tragarPtr === null && performance.now() < tragarHasta) { tragarHasta = 0; e.stopPropagation(); e.preventDefault(); }
}, true);
$('opcRegistro').addEventListener('click', () => diagAbrir());

// ---------- compu: teclado y rueda del mouse ----------
const TACTIL = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const teclas = new Set();
function tecladoMover() {
  const k = c => teclas.has(c);
  const x = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
  const y = (k('KeyS') || k('ArrowDown') ? 1 : 0) - (k('KeyW') || k('ArrowUp') ? 1 : 0);
  const l = Math.hypot(x, y) || 1, rapido = k('ShiftLeft') || k('ShiftRight') ? 1.8 : 1;
  return [x / l * rapido, y / l * rapido];
}
const ATAJOS = 'WASD/flechas: moverse (shift: más rápido) · mouse: mirar · clic: agarrar foto<br>' +
  'C: cámara · B: bloque vacío · espacio: sacar foto o poner el bloque / soltar · esc: cancelar · supr: borrar · G: grilla<br>' +
  '1: mover · 2: recortar · 3: escalar · 4: girar · rueda: distancia · shift+rueda: tamaño · alt+rueda: girar · H: esta ayuda';
const escribiendo = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
const visible = el => el.style.display !== 'none' && getComputedStyle(el).display !== 'none';
window.addEventListener('keydown', e => {
  if (escribiendo() || e.metaKey || e.ctrlKey) return;
  teclas.add(e.code);
  if (e.repeat || !started) return;
  const c = e.code;
  const click = el => { if (visible(el)) el.click(); };
  if (c === 'Space') { e.preventDefault(); if (held) click(dropBtn); else click(shootBtn); }
  else if (c === 'Enter') click(dropBtn);
  else if (c === 'Escape') {
    if (held) click(cancelBtn);
    else {
      for (const id of ['salaPanel', 'fovPanel', 'diag', 'salasPanel', 'opciones', 'comPanel', 'cuentaPanel']) { const el = $(id); if (el) el.style.display = 'none'; }
      if (pjVista) pjCerrar();
      $('menuBtn').classList.remove('on'); fovBtn.classList.remove('on');
    }
  }
  else if (c === 'Delete' || c === 'Backspace') click(trashBtn);
  else if (c === 'KeyC' && !held) click(camOn ? unequipBtn : bloqueOn ? $('camChica') : equipBtn);
  else if (c === 'KeyB' && !held) click(bloqueOn ? $('guardarBloque') : $('bloque'));
  else if (c === 'KeyG') { if (visible($('edicion'))) grillaBtn.click(); }
  else if (c === 'KeyH') showHint(ATAJOS);
  else if (/^Digit[1-4]$/.test(c)) { const m = ['mover', 'recortar', 'escalar', 'girar'][+c.slice(5) - 1]; if (visible($('edicion'))) { if (m !== 'mover' && !ajustando) setAjustar(true); setMode(m); showHint(MODE_HINT[m]); } }
  if (c.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', e => teclas.delete(e.code));
window.addEventListener('blur', () => teclas.clear());
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (!started || !(held || (camOn && camReady) || bloqueOn)) return;
  const L = cur(), d = Math.max(-200, Math.min(200, e.deltaY || e.deltaX));
  if (e.shiftKey) scaleBy(L, Math.exp(-d * 0.002));
  else if (e.altKey) rollBy(L, d * 0.004);
  else setDist(L, clamp(len(L.c) * Math.exp(d * 0.0015), DIST_MIN, DIST_MAX));
}, { passive: false });

// ---------- dedos sobre la pantalla ----------
const touches = new Map(); // id -> {x, y, x0, y0, t0, moved, crop}
let gesture = null;        // dos dedos

function twoFingers() {
  const [a, b] = [...touches.values()];
  return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
}

// en recortar: qué bordes quedan debajo del dedo
// qué borde agarra el dedo: el más cercano (nunca dos opuestos); y si está en una esquina, también el de al lado
function edgesAt(L, x, y) {
  const p = touchOnHeld(L, x, y);
  if (!p) return null;
  const tol = 36 * metersPerPx(len(L.c));
  const [a, b] = p, hw = L.w / 2, hh = L.h / 2;
  if (Math.abs(a) > hw + tol || Math.abs(b) > hh + tol) return null;
  const dl = Math.abs(a + hw), dr = Math.abs(a - hw), dt = Math.abs(b - hh), db = Math.abs(b + hh);
  const dx = Math.min(dl, dr), dy = Math.min(dt, db);
  // para la esquina, el segundo borde tiene que estar bien cerca (en una foto chiquita, todo queda cerca de todo)
  const esqX = Math.min(tol, L.w * 0.25), esqY = Math.min(tol, L.h * 0.25);
  const e = { l: false, r: false, t: false, b: false };
  if (dx < tol && (dx <= dy || dx < esqX)) e[dl <= dr ? 'l' : 'r'] = true;
  if (dy < tol && (dy < dx || dy < esqY)) e[dt <= db ? 't' : 'b'] = true;
  return (e.l || e.r || e.t || e.b) ? e : null;
}
// ¿el dedo cae adentro de lo que se ve en la mano? (con la grilla, de la pose alineada, que pasa a ser la de la mano:
// así la imagen se mueve a la par del dedo)
function dentroDeLoQueSeVe(L, x, y) {
  let M = L;
  if (grilla) { const b = basis(), p = snapPose(worldPose(b, L)); M = { c: toLocalV(b, sub(p.c, pos)), r: toLocalV(b, p.r), u: toLocalV(b, p.u), w: p.w, h: p.h, uv: L.uv.slice() }; }
  const q = touchOnHeld(M, x, y);
  if (!q || Math.abs(q[0]) > M.w / 2 || Math.abs(q[1]) > M.h / 2) return false;
  if (M !== L) Object.assign(L, M);
  return true;
}
// el borde que se está recortando o escalando (para pintarlo de otro color)
const modoBordes = () => mode === 'recortar' || mode === 'escalar';
function recorteActivo() { if (!modoBordes()) return null; for (const t of touches.values()) if (t.crop) return t.crop; return null; }
// con la grilla, al apoyar el dedo se toma el tamaño y lugar alineados que se ven, así el borde queda bajo el dedo
// (y la esquina en un punto de la grilla: los bordes se mueven de a un paso desde ahí)
function recorteDesdeLoQueSeVe(L, x, y) {
  if (!grilla) return edgesAt(L, x, y);
  const b = basis(), p = snapPose(worldPose(b, L));
  const L2 = { c: toLocalV(b, sub(p.c, pos)), r: toLocalV(b, p.r), u: toLocalV(b, p.u), w: p.w, h: p.h, uv: L.uv.slice() };
  const e = edgesAt(L2, x, y);
  if (e) Object.assign(L, L2);
  return e;
}

canvas.addEventListener('pointerdown', e => {
  abrirArchivoHasta = 0;   // un toque nuevo: el del archivo ya no va
  if (!started) return;
  canvas.setPointerCapture(e.pointerId);
  const t = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, crop: null };
  if (modoBordes() && touches.size === 0) {        // un solo dedo recorta (o escala); en recortar, adentro de la foto mueve la imagen
    t.crop = recorteDesdeLoQueSeVe(cur(), e.clientX, e.clientY);
    if (t.crop) { const L = cur(); t.obj = L; t.base = { c: L.c.slice(), r: L.r.slice(), u: L.u.slice(), w: L.w, h: L.h, uv: L.uv.slice() }; t.grilla = grilla; }
    else if (mode === 'recortar' && !vacioEnMano()) t.pan = dentroDeLoQueSeVe(cur(), e.clientX, e.clientY);
  }
  touches.set(e.pointerId, t);
  if (touches.size === 2) {
    const g = twoFingers();
    const L = cur();
    gesture = { d0: g.d, a0: g.a, lastD: g.d, lastA: g.a, uv0: L.uv.slice(), giro: 0, girando: false };
    for (const tt of touches.values()) { tt.moved = true; tt.crop = null; tt.pan = false; }
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
    // el giro con dos dedos recién arranca pasados ~10°: así al agrandar/achicar no se tuerce sin querer
    let giro = 0;
    if (gesture.girando) giro = da;
    else { gesture.giro += da; if (Math.abs(gesture.giro) > 0.17) { gesture.girando = true; giro = gesture.giro - Math.sign(gesture.giro) * 0.17; } }
    if (mode === 'mover') { scaleBy(L, k); if (giro) rollBy(L, -giro); }
    else if (mode === 'girar') { if (giro) rollBy(L, -giro); }
    else if (mode === 'recortar' && !vacioEnMano()) zoomContent(L, gesture.uv0, g.d / Math.max(10, gesture.d0));
    else if (mode === 'escalar' || mode === 'recortar') scaleBy(L, k);
    return;
  }
  if (!t.moved && Math.hypot(t.x - t.x0, t.y - t.y0) > 8) t.moved = true;
  if (!t.moved) return;

  if (modoBordes() && t.crop) {
    if (L !== t.obj) { t.crop = null; return; }   // lo soltaste (o te lo sacaron) a mitad del arrastre
    const p = touchOnHeld(t.base, e.clientX, e.clientY);
    if (p) {
      const r = bordesA(L, t.base, t.crop, p[0], p[1], mode === 'escalar' || vacioEnMano(), t.grilla && grilla);
      if (t.grilla && grilla && (!r || r.lejos) && !t.avisado) {
        t.avisado = true;
        showHint('con la grilla los lados van de a ' + (pasoGrilla >= 1 ? 'metro' : pasoTxt(pasoGrilla)) + ': ' + (mode === 'escalar' ? 'así no entra' : 'así no se puede recortar'));
      }
    }
    return;
  }
  if (mode === 'recortar' && t.pan) {
    // el dedo arrastra la imagen: proyectar el movimiento sobre los ejes de la foto (por si está girada)
    const mpp = metersPerPx(len(L.c));
    const v = [dx * mpp, -dy * mpp, 0];
    const su = L.w / (L.uv[2] - L.uv[0]), sv = L.h / (L.uv[3] - L.uv[1]);
    panContent(L, -dot(v, L.r) / su, dot(v, L.u) / sv);
    return;
  }
  // girar: como una bola, la cara de adelante sigue al dedo
  if (mode === 'girar') { spinBy(L, -dx * 0.008, -dy * 0.008); return; }
  // editor de personaje abierto: arrastrar gira la cámara alrededor tuyo
  if (pjVista) { pjVista.ang -= dx * 0.008; return; }
  // mirar (y si estabas siguiendo a alguien, lo dejás: v10.10)
  salaDejarDeSeguir('arrastre');
  const kk = invertLook ? -LOOK : LOOK;
  yawOff += dx * kk;
  pitchOff = clamp(pitchOff + dy * kk, -1.4, 1.4);
});

function endTouch(e) {
  const t = touches.get(e.pointerId);
  if (!t) return;
  touches.delete(e.pointerId);
  if (touches.size < 2) gesture = null;
  if (e.type === 'pointerup' && !t.moved && performance.now() - t.t0 < 350 && !held && !pjVista) {
    // tocar a alguien de la sala (más cerca que la foto que hay detrás) abre "ir ahí / seguir" (v10.10)
    const h = workHit(e.clientX, e.clientY), q = touches.size === 0 ? salaPersonaEn(e.clientX, e.clientY) : null;
    if (q && (!h || q.t < h.t)) salaElegir(q.id);
    else if (h) { salaDejarDeSeguir('agarraste'); pick(h.w); }
  } else if (e.type === 'pointerup' && !t.moved && performance.now() - t.t0 < 350 && held && !pjVista && mode === 'mover'
             && touches.size === 0 && e.button === 0 && enLoQueTenes(e.clientX, e.clientY)) {
    abrirArchivoHasta = performance.now() + 800;   // se abre con el click que sigue (Safari solo abre un input de archivo desde un click)
  }
}
let abrirArchivoHasta = 0;
canvas.addEventListener('click', () => {
  if (performance.now() > abrirArchivoHasta || !held) return;
  abrirArchivoHasta = 0;
  $('bloqueArchivo').click();   // en el iPhone abre el menú: sacar foto / fototeca / archivos
});
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
  if (camOn) await startCamera(sala.active && rtc.on && rtc.micOn && !rtc.mic);
  if (sala.active) rtcMedios();   // micrófono y cara recién después de tocar (en iPhone, pedirlos antes falla)
  showHint(TACTIL ? 'joystick para moverte · arrastrá para mirar<br>tocá una foto para agarrarla'
    : 'WASD o flechas para moverte · arrastrá con el mouse para mirar<br>clic en una foto para agarrarla · tecla H: atajos');
});

// ---------- loop ----------
let last = performance.now();
let ultimoCuadro = 0, cuadros = 0;
function estadoTxt() {
  const f = basis().f;
  return `pos ${pos.map(v => v.toFixed(2))} mira ${f.map(v => v.toFixed(2))} fotos ${works.length} (rotas ${works.filter(w => w.rota).length}) fov ${fovDeg} cam ${camOn ? 1 : 0}`;
}
setInterval(() => {
  if (document.hidden || !started) return;
  if (performance.now() - ultimoCuadro > 3000) diagUna('no se dibuja hace ' + Math.round((performance.now() - ultimoCuadro) / 1000) + ' s' + (gl.isContextLost() ? ' (webgl perdido)' : ''));
}, 3000);
function frame(now) {
  ultimoCuadro = performance.now();
  if (++cuadros === 60) diag('dibujando ok · ' + estadoTxt());
  if (!Number.isFinite(yawOff) || !Number.isFinite(pitchOff)) { diagUna('mirada rota → la reseteo'); yawOff = 0; pitchOff = 0; }
  if (!gl.isContextLost()) {
    try {
      draw(now); pantallaOk(now);
      if (comCapturaPedida) { const f = comCapturaPedida; comCapturaPedida = null; let u = null; try { u = canvas.toDataURL('image/jpeg', 0.85); } catch (e) {} f(u); }
    } catch (e) { showHint('error: ' + e.message); diagUna('ERROR dibujando: ' + e.message + ' ' + ((e.stack || '').split('\n')[1] || '').trim()); }
  }
  requestAnimationFrame(frame);
}

// ---------- pantalla gris / negra: si el iPhone se lleva el contexto de WebGL, recargar ----------
// (pasa al volver del fondo cuando el sistema necesita memoria). Se recarga guardando dónde estabas.
function recargarSeguro(por) {
  diag('recargo: ' + por);
  try { sessionStorage.setItem('volver', JSON.stringify({ pos, yawOff, pitchOff, t: Date.now() })); } catch (e) {}
  diagGuardar();
  location.reload();
}
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault(); diag('webgl: se perdió el contexto');
  setTimeout(() => { if (gl.isContextLost() && !document.hidden) recargarSeguro('webgl no volvió'); }, 2500);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && started) diag('estado · ' + estadoTxt()); });
canvas.addEventListener('webglcontextrestored', () => recargarSeguro('webgl volvió (las texturas se perdieron)'));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && gl.isContextLost()) setTimeout(() => { if (gl.isContextLost()) recargarSeguro('webgl perdido al volver'); }, 1500);
});
try {
  const v = JSON.parse(sessionStorage.getItem('volver') || 'null');
  sessionStorage.removeItem('volver');
  if (v && Date.now() - v.t < 60000) { pos[0] = v.pos[0]; pos[1] = v.pos[1]; pos[2] = v.pos[2]; yawOff = v.yawOff; pitchOff = v.pitchOff; diag('volví a donde estaba'); }
} catch (e) {}
// cada 3 s mira 5 puntos de la pantalla: si son todos iguales y claros, algo anda mal (se anota)
let pantallaT = 0;
const pantallaPx = new Uint8Array(4);
function pantallaOk(now) {
  if (now - pantallaT < 3000) return;
  pantallaT = now;
  const pts = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]], vals = [];
  for (const [x, y] of pts) { gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pantallaPx); vals.push(pantallaPx.join(',')); }
  const lum = pantallaPx[0] + pantallaPx[1] + pantallaPx[2];
  if (vals.every(v => v === vals[0]) && lum > 90) diagUna(`pantalla pareja rgb(${vals[0]}) · ${estadoTxt()}`);
  // ¿se ven los puntos del piso? (mirando más o menos al frente siempre tienen que verse en la mitad de abajo)
  if (started && !pjVista && basis().f[1] < 0.2) {
    const w = canvas.width, h = canvas.height, fila = new Uint8Array(w * 4);
    let claros = 0;
    for (let y = Math.floor(h * 0.05); y < h * 0.45 && !claros; y += Math.max(3, Math.floor(h / 120))) {
      gl.readPixels(0, y, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, fila);
      for (let i = 0; i < fila.length; i += 4) if (fila[i] > 45 || fila[i + 1] > 45 || fila[i + 2] > 45) { claros++; break; }
    }
    if (!claros) diagUna('no se ve el piso · ' + estadoTxt());
  }
}
function draw(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (held && held.aim) stepAim(dt);
  const b = basis();

  const [kx, ky] = tecladoMover();
  if (!joy.x && !joy.y && !kx && !ky) { corriendoT = 0; corriendo = 0; }
  const mx = clamp(joy.x + kx, -2, 2), my = clamp(joy.y + ky, -2, 2);   // teclado con shift llega a 1.8
  let paso = [0, 0];
  if (mx || my) salaDejarDeSeguir('joystick');   // moverte corta el seguir (también con el teclado)
  else { const s = salaSeguirPaso(dt); if (s) paso = s; }   // siguiendo a alguien (v10.10): camina solo
  if (mx || my) {
    let fw = [b.f[0], 0, b.f[2]];
    if (len(fw) < 0.2) fw = [b.u[0], 0, b.u[2]];
    fw = norm(fw);
    const rt = norm(cross(fw, [0, 1, 0]));
    const v = add(mul(fw, -my), mul(rt, mx));
    // con el joystick a fondo más de un segundo, de a poco va más rápido (hasta 2.5x): cruzar un museo grande no aburre.
    // (solo el joystick: el teclado siempre está "a fondo" y para eso tiene shift)
    if (Math.hypot(joy.x, joy.y) > 0.9) { corriendoT += dt; if (corriendoT > 1) corriendo = Math.min(1, corriendo + dt); }
    else { corriendoT = 0; corriendo = Math.max(0, corriendo - dt * 3); }
    const rapido = 1 + 1.5 * corriendo;
    paso = [v[0] * MOVE * rapido * dt, v[2] * MOVE * rapido * dt];
  }
  // de a pasos de 10 cm como mucho: si en un cuadro lento avanzás más que el radio del cuerpo, atravesarías paredes
  const nPasos = Math.max(1, Math.ceil(Math.hypot(paso[0], paso[1]) / 0.1));
  for (let i = 0; i < nPasos; i++) {
    pos[0] += paso[0] / nPasos; pos[2] += paso[1] / nPasos;
    fisica(dt / nPasos);
  }

  // la vista previa toma la proporción real de la cámara la primera vez
  if (preview.fresh && camReady && video.videoWidth) {
    preview = freshPreview(video.videoHeight / video.videoWidth);
    preview.fresh = false;
  }

  if (pjVista) {
    // editor de personaje: la cámara se va afuera y te mira (pos se usa como ojo durante el dibujo)
    // y con un campo de visión propio (el tuyo puede ser muy abierto y el personaje quedaría chiquito)
    const yo = pos.slice(), fovTuyo = FOVX;
    FOVX = PJ_FOV;
    try {
      const cam = pjCamara();
      pos[0] = cam.eye[0]; pos[1] = cam.eye[1]; pos[2] = cam.eye[2];
      escena(cam.b, dt, yo);
    } finally { pos[0] = yo[0]; pos[1] = yo[1]; pos[2] = yo[2]; FOVX = fovTuyo; }
  } else escena(b, dt, null);
  salaLejos(b);   // las caritas del borde (los de la sala que no se ven)
  if (distPtr == null) distKnob.style.top = (1 - distT(heldDist())) * 100 + '%';
}

const COLOR_PREVIA = [1, 0.47, 0.31];
// las agarraderas de recortar / escalar (con el lado que se está moviendo)
const deco = () => modoBordes() && !(held && held.aim) ? { modo: mode === 'recortar' && !vacioEnMano() ? 'recortar' : 'escalar', activo: recorteActivo() } : null;
let vacioTexGL = null;
const texVacio = () => vacioTexGL || (vacioTexGL = texture(VACIO_IMG));
// en el editor de personaje, las fotos que quedan entre la cámara y el personaje no se dibujan (pedido de José: lo tapaban)
function tapaAlPersonaje(w, yo, b) {
  const pies = yo[1] - EYE;
  const puntos = [[0, yo[1] + 0.15], [0, pies + EYE * 0.6], [0, pies + 0.1], [-0.3, pies + EYE * 0.6], [0.3, pies + EYE * 0.6]]
    .map(([x, y]) => [yo[0] + b.r[0] * x, y, yo[2] + b.r[2] * x]);
  const n = cross(w.r, w.u);
  for (const q of puntos) {
    const d = sub(q, pos), den = dot(d, n);
    if (Math.abs(den) < 1e-9) continue;
    const t = dot(sub(w.c, pos), n) / den;
    if (t <= 0 || t >= 1) continue;                        // el plano de la foto no está entre la cámara y el punto
    const p = sub(add(pos, mul(d, t)), w.c);
    if (Math.abs(dot(p, w.r)) <= w.w / 2 && Math.abs(dot(p, w.u)) <= w.h / 2) return true;
  }
  return false;
}
function escena(b, dt, yo) {
  gl.clearColor(0.04, 0.04, 0.05, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const m = matrix(b);

  // obras
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  gl.useProgram(quadProg);
  gl.uniformMatrix4fv(Q.m, false, m);
  const otros = salaEnManos();   // las que tiene agarradas otro se dibujan en su mano
  for (const w of works) if ((!held || w !== held.work) && !otros.has(w.id) && !(yo && tapaAlPersonaje(w, yo, b))) drawQuad(w.buf, null, w.tex, [1, 1, 1]);
  salaDraw(b, dt);
  if (yo) { salaB = b; pjDibujar('yo', pjYo(yo), b, Date.now() / 1000, rtcMiCara); }

  // en la mano (con la grilla prendida, primero las guías en su plano)
  if (yo) { /* en el editor no se muestra lo que tenés en la mano */ }
  else if (held) {
    const p = heldPose(b);
    if (grilla && !held.aim) guiasGrilla(p, [1, 1, 1]);   // las guías, de donde va a quedar
    let tex = held.work.tex;
    if (held.work.vacio && camOn && camReady && video.readyState >= 2) {   // bloque vacío: muestra la cámara, para sacarle la foto
      gl.bindTexture(gl.TEXTURE_2D, videoTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, videoFrame());
      tex = videoTex;
    }
    drawFramed(tex === videoTex ? { ...p, uv: uvCentrado(p.h / p.w) } : p, tex, [1, 1, 1], deco());
  } else if (camOn && camReady && video.readyState >= 2) {
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, videoFrame());
    const p = previewPose(b);
    if (grilla) guiasGrilla(p, COLOR_PREVIA);
    drawFramed(p, videoTex, COLOR_PREVIA, deco());
  } else if (bloqueOn && started) {                       // el bloque vacío equipado: un cuadrado gris en la mano
    const p = previewPose(b);
    if (grilla) guiasGrilla(p, COLOR_PREVIA);
    drawFramed(p, texVacio(), COLOR_PREVIA, deco());
  }

  // fantasma: dónde estaba la foto antes de agarrarla (a media opacidad, encima de todo)
  if (held && !yo) {
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    drawQuad(held.work.buf, null, held.work.tex, [1, 1, 1], 0.35);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
  gl.disableVertexAttribArray(Q.p); gl.disableVertexAttribArray(Q.uv);

  // piso de puntos: al final y con profundidad, así una foto los tapa solo si está adelante
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(false);
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
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

// ---------- auto-actualización ----------
async function checkUpdate() {
  try {
    const r = await fetch('game.js?t=' + Date.now(), { cache: 'no-store' });
    const mm = (await r.text()).match(/const VERSION = '([^']+)'/);
    // no recargar con dedos en pantalla, una foto en la mano, ni escribiendo un comentario o la cuenta (se perdería)
    const ocupado = escribiendo() || ['comPanel', 'cuentaPanel'].some(id => $(id).style.display !== 'none') || comMandando;
    if (mm && mm[1] !== VERSION && touches.size === 0 && !held && !ocupado) {
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
// el dibujo arranca ya, sin esperar a que cargue nada (si el guardado se traba, antes quedaba la pantalla vacía)
requestAnimationFrame(frame);
(salaPrevia ? salaEntrar(salaPrevia) : loadWorks()).catch(e => diag('carga: falló ' + (e && e.message || e)));

// para los tests (grados: yaw positivo = mirar a la derecha)
window.__game = {
  pos, works, joy,
  get held() { return held; }, sala, salaYo, rtc, get camOn() { return camOn; }, get fov() { return fovDeg; }, get preview() { return preview; }, get previewBloque() { return previewBloque; }, get bloqueOn() { return bloqueOn; }, get mode() { return mode; },
  get invertLook() { return invertLook; }, get gyroOn() { return gyroOn; },
  get gyroMode() { return gyroMode; }, get camReady() { return camReady; }, get grilla() { return grilla; }, get pasoGrilla() { return pasoGrilla; }, snapPose, stableGrilla,
  look(y, p) { yawOff = -y * Math.PI / 180; pitchOff = p * Math.PI / 180; },
};
