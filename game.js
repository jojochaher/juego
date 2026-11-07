// juego — museo en el vacío con fotos (ver claude/instrucciones.md del proyecto para el estado)
// Mirás con el giroscopio y ajustás arrastrando con el dedo. Te movés con el joystick.
// Lo que tenés "en la mano" (la vista previa de la cámara, o una foto que agarraste) viaja pegado
// a la cámara. Se edita por modos: mover (escala/giro con dos dedos), recortar (bordes; adentro, pan y zoom de la
// imagen), escalar (bordes: estirar en x o en y), girar (sobre su eje).
// Obturador: la vista previa queda fija. Tocar una foto la agarra; ✓ suelta, ✕ cancela, tacho borra.
const VERSION = 'v10.27';
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
attribute vec3 p; attribute vec2 uv; uniform mat4 m; uniform vec3 eye; varying vec2 v; varying vec3 rel;
void main() { v = uv; rel = (p - eye) / 16.0; gl_Position = m * vec4(p, 1.0); }`, `
precision mediump float; uniform sampler2D t; uniform vec3 tint; uniform float alpha; uniform vec2 fade;
#ifdef GL_FRAGMENT_PRECISION_HIGH
varying highp vec2 v; uniform highp vec4 cuadro; uniform highp vec4 cuadroB;
#else
varying vec2 v; uniform vec4 cuadro; uniform vec4 cuadroB;
#endif
uniform vec3 niebla; uniform vec3 nieblaD; varying vec3 rel; uniform float rep; uniform float mezcla;
void main() {
  vec2 q = clamp(rep > 0.5 ? fract(v) : v, cuadroB.zw, 1.0 - cuadroB.zw);
  vec4 c = texture2D(t, cuadro.xy + q * cuadro.zw);
  if (mezcla > 0.0) c = mix(c, texture2D(t, cuadroB.xy + q * cuadro.zw), mezcla);
  if (c.a < 0.5) discard;
  float f = smoothstep(nieblaD.x, nieblaD.y, length(rel) * 16.0) * nieblaD.z;
  gl_FragColor = vec4(mix(c.rgb * tint, niebla, f), alpha * mix(fade.x, fade.y, v.y));
}`);
const Q = {
  p: gl.getAttribLocation(quadProg, 'p'), uv: gl.getAttribLocation(quadProg, 'uv'),
  m: gl.getUniformLocation(quadProg, 'm'), tint: gl.getUniformLocation(quadProg, 'tint'), alpha: gl.getUniformLocation(quadProg, 'alpha'), fade: gl.getUniformLocation(quadProg, 'fade'),
  eye: gl.getUniformLocation(quadProg, 'eye'), niebla: gl.getUniformLocation(quadProg, 'niebla'), nieblaD: gl.getUniformLocation(quadProg, 'nieblaD'),
  rep: gl.getUniformLocation(quadProg, 'rep'),
  cuadro: gl.getUniformLocation(quadProg, 'cuadro'), cuadroB: gl.getUniformLocation(quadProg, 'cuadroB'), mezcla: gl.getUniformLocation(quadProg, 'mezcla'),
};
// cuadro / cuadroB / mezcla: qué pedazo de la textura es la imagen (los videos, v10.27: un cuadro de la tira, ver video.js).
// Sin video: la textura entera. Quedan así salvo mientras se dibuja un video (cuadroUniformes(null) los vuelve).
function cuadroUniformes(v) {
  if (v) { gl.uniform4fv(Q.cuadro, v.a); gl.uniform4fv(Q.cuadroB, v.b); gl.uniform1f(Q.mezcla, v.m); }
  else { gl.uniform4f(Q.cuadro, 0, 0, 1, 1); gl.uniform4f(Q.cuadroB, 0, 0, 0, 0); gl.uniform1f(Q.mezcla, 0); }
}
gl.useProgram(quadProg); cuadroUniformes(null);
// (rel va dividido por 16: en el iPhone mediump es de 16 bits y el cuadrado de una distancia de 300 m no entraría)

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
// el cielo (v10.15): un cuadro que tapa toda la pantalla; cada pixel calcula hacia dónde mira (rumbo y altura)
// y de ahí qué parte de la foto le toca. map = [copias alrededor, altura del borde de abajo, alto en radianes, espejar]
const cieloProg = program(`
attribute vec2 p; uniform vec3 cr; uniform vec3 cu; uniform vec3 cf; uniform vec2 ct; varying vec3 dir;
void main() { dir = cf + cr * (p.x * ct.x) + cu * (p.y * ct.y); gl_Position = vec4(p, 0.0, 1.0); }`, `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D t; uniform vec4 uvw; uniform vec4 map; uniform vec3 medio; uniform vec3 abajo; uniform float brillo; varying vec3 dir;
void main() {
  vec3 d = normalize(dir);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float x = (atan(d.x, -d.z) / 6.2831853 + 0.5) * map.x;
  float k = floor(x), fx = x - k;
  if (map.w > 0.5 && mod(k, 2.0) > 0.5) fx = 1.0 - fx;     // copias espejadas: no se ven costuras
  float y = (el - map.y) / map.z;                           // 0 = borde de abajo de la foto, 1 = el de arriba
  vec3 c = texture2D(t, vec2(mix(uvw.x, uvw.z, fx), mix(uvw.w, uvw.y, clamp(y, 0.0, 1.0)))).rgb;
  c = mix(c, medio, smoothstep(0.0, 0.45, (y - 1.0) * map.z));   // arriba de la foto, hacia el color promedio
  c *= brillo;
  c = mix(c, abajo, smoothstep(0.0, 0.35, -y * map.z));          // abajo de la foto, hacia el fondo
  gl_FragColor = vec4(c, 1.0);
}`);
const CP = Object.fromEntries(['cr', 'cu', 'cf', 'ct', 'uvw', 'map', 'medio', 'abajo', 'brillo'].map(k => [k, gl.getUniformLocation(cieloProg, k)]));
CP.p = gl.getAttribLocation(cieloProg, 'p');
const cieloBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, cieloBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const GRID = 12;
const dotBuf = gl.createBuffer();
const dotData = new Float32Array((GRID * 2 + 1) ** 2 * 3);

// color promedio de cada textura (para la atmósfera, v10.14): 8x8 px alcanza
const texCol = new WeakMap();
const colC = document.createElement('canvas'); colC.width = colC.height = 8;
const colX = colC.getContext('2d', { willReadFrequently: true });
colX.imageSmoothingQuality = 'high';   // de 512 a 8 px de un saque: sin esto promedia pocos pixeles y salta con fotos con detalle
function colorMedio(src) {
  try {
    colX.clearRect(0, 0, 8, 8); colX.drawImage(src, 0, 0, 8, 8);
    const d = colX.getImageData(0, 0, 8, 8).data, s = [0, 0, 0], g = new Float32Array(192);
    for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; g[i / 4 * 3] = d[i] / 255; g[i / 4 * 3 + 1] = d[i + 1] / 255; g[i / 4 * 3 + 2] = d[i + 2] / 255; }
    const c = s.map(x => x / 64 / 255);
    return c.every(Number.isFinite) ? { c, g } : null;
  } catch (e) { return null; }
}
// los 8x8 colores de cada textura (para el color del borde de una cara de caja, v10.20)
const texGrid = new WeakMap();
const texTam = new WeakMap();   // el tamaño en px de cada textura (para leerla de vuelta: texLeer)
// el color de un borde de la imagen dentro del recorte uv: lado 'r' / 'l' / 't' / 'b' (la columna o fila de la punta) o
// null (todo el recorte). Sin los 8x8 (la vista previa de la cámara), el color promedio o un gris.
function colorBorde(tex, uv, lado) {
  const g = texGrid.get(tex);
  if (!g) return texCol.get(tex) || [0.5, 0.5, 0.5];
  const cel = v => clamp(Math.floor(v * 8), 0, 7), celFin = v => clamp(Math.ceil(v * 8) - 1, 0, 7);
  const x0 = Math.min(uv[0], uv[2]), x1 = Math.max(uv[0], uv[2]), y0 = Math.min(uv[1], uv[3]), y1 = Math.max(uv[1], uv[3]);
  let cx0 = cel(x0), cx1 = Math.max(cx0, celFin(x1)), cy0 = cel(y0), cy1 = Math.max(cy0, celFin(y1));
  if (lado === 'r') cx0 = cx1; else if (lado === 'l') cx1 = cx0; else if (lado === 't') cy1 = cy0; else if (lado === 'b') cy0 = cy1;
  const s = [0, 0, 0]; let n = 0;
  for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) { const i = (y * 8 + x) * 3; s[0] += g[i]; s[1] += g[i + 1]; s[2] += g[i + 2]; n++; }
  return s.map(v => v / n);
}
function texture(src) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (src) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src); const m = colorMedio(src); if (m) { texCol.set(t, m.c); texGrid.set(t, m.g); }
    texTam.set(t, [src.naturalWidth || src.videoWidth || src.width, src.naturalHeight || src.videoHeight || src.height]);
  }
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255]));
  return t;
}
const white = texture(null);
// leer de vuelta (de la placa de video) la parte uv de una textura, a lo sumo de max px: un lienzo (o null si no se puede).
// Sirve para "guardar textura" (v10.23): la imagen de una foto ya está acá, no hace falta volver a bajarla ni leerla del celu.
// Se dibuja en una textura RGBA aparte (leer una RGB directo no anda en todos los celus) y se restaura lo que se tocó.
let leerProg = null, leerBuf = null;
function texLeer(tex, uv = FULL, max = 512) {
  const tam = texTam.get(tex);
  if (!tam || !tam[0] || !tam[1]) return null;
  const aw = Math.abs(uv[2] - uv[0]), ah = Math.abs(uv[3] - uv[1]);
  let cw = aw * tam[0], ch = ah * tam[1];
  const k = Math.min(1, max / Math.max(cw, ch, 1));
  cw = Math.max(1, Math.round(cw * k)); ch = Math.max(1, Math.round(ch * k));
  const dst = gl.createTexture(), fb = gl.createFramebuffer(), dt = gl.isEnabled(gl.DEPTH_TEST), bl = gl.isEnabled(gl.BLEND);
  let out = null;
  try {
    if (!leerProg) {
      leerProg = program(`
attribute vec2 p; uniform vec4 uvr; varying vec2 v;
void main() { vec2 t = p * 0.5 + 0.5; v = vec2(mix(uvr.x, uvr.z, t.x), mix(uvr.y, uvr.w, t.y)); gl_Position = vec4(p, 0.0, 1.0); }`, `
precision mediump float; uniform sampler2D t; varying vec2 v;
void main() { gl_FragColor = vec4(texture2D(t, v).rgb, 1.0); }`);
      leerBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, leerBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    }
    gl.bindTexture(gl.TEXTURE_2D, dst);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incompleto');
    gl.viewport(0, 0, cw, ch);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(leerProg);
    const ap = gl.getAttribLocation(leerProg, 'p');
    gl.bindBuffer(gl.ARRAY_BUFFER, leerBuf);
    gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4f(gl.getUniformLocation(leerProg, 'uvr'), uv[0], uv[1], uv[2], uv[3]);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(ap);
    const px = new Uint8Array(cw * ch * 4);
    gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);   // la fila 0 es la de arriba de la imagen (y = -1 lleva v0)
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const x = c.getContext('2d'), im = x.createImageData(cw, ch);
    im.data.set(px); x.putImageData(im, 0, 0);
    out = c;
  } catch (e) { diag('texturas: no pude leer la imagen (' + e.message + ')'); }
  finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (dt) gl.enable(gl.DEPTH_TEST); if (bl) gl.enable(gl.BLEND);
    gl.deleteFramebuffer(fb); gl.deleteTexture(dst);
    gl.useProgram(quadProg);
  }
  return out;
}
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
// rep: la textura se repite (biblioteca de texturas, v10.23): las coordenadas uv van en "baldosas" (0..n) y se usa fract
function drawQuad(buf, data, tex, tint, alpha = 1, fade = SIN_FADE, first = 0, rep = false) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  if (data) gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(Q.p); gl.vertexAttribPointer(Q.p, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(Q.uv); gl.vertexAttribPointer(Q.uv, 2, gl.FLOAT, false, 20, 12);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform3fv(Q.tint, tint);
  gl.uniform1f(Q.alpha, alpha);
  gl.uniform2fv(Q.fade, fade);
  gl.uniform1f(Q.rep, rep ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, first, 6);
}
// una obra puesta: una foto (un cuadro) o una caja (6 caras en su buffer, cada una con su sombra)
function drawObra(w, alpha = 1) {
  const tile = !!w.rep && !w.vacio;                      // la textura repetida (v10.23)
  const vv = vidCuadro(w);                               // un video cerca: el cuadro de ahora (v10.27)
  if (vv) cuadroUniformes(vv);
  if (!w.caras) { drawQuad(w.buf, null, vv ? vv.tex : w.tex, [1, 1, 1], alpha, SIN_FADE, 0, tile); if (vv) cuadroUniformes(null); return; }
  drawQuad(w.buf, null, vv ? vv.tex : w.tex, [1, 1, 1], alpha, SIN_FADE, 0, tile);   // la de adelante arma todo (buffer, textura, alfa); las otras, solo su sombra
  let lisas = false, fotos = false;
  for (let i = 1; i < w.caras.length; i++) {
    const f = w.caras[i];
    if (f.t === 'c') { lisas = true; continue; }
    if (f.img) { fotos = true; continue; }
    gl.uniform3f(Q.tint, f.k, f.k, f.k); gl.drawArrays(gl.TRIANGLES, i * 6, 6);
  }
  if (vv) cuadroUniformes(null);                         // las fotos propias de las caras y los colores, enteros
  if (fotos) gl.uniform1f(Q.rep, 0);                    // las fotos propias de las caras no se repiten
  if (fotos) for (let i = 1; i < w.caras.length; i++) {   // las que tienen su propia foto (v10.21)
    const f = w.caras[i];
    if (!f.img) continue;
    gl.bindTexture(gl.TEXTURE_2D, f.img.tex); gl.uniform3f(Q.tint, f.k, f.k, f.k); gl.drawArrays(gl.TRIANGLES, i * 6, 6);
  }
  if (!lisas) return;
  gl.bindTexture(gl.TEXTURE_2D, white);                  // las de color liso (v10.20): blanco teñido con el color del borde
  for (let i = 1; i < w.caras.length; i++) {
    const f = w.caras[i];
    if (f.t !== 'c') continue;
    const c = caraColor(f, i, w.tex, w.uv);
    gl.uniform3f(Q.tint, c[0] * f.k, c[1] * f.k, c[2] * f.k); gl.drawArrays(gl.TRIANGLES, i * 6, 6);
  }
}

// ---------- extruir (v10.19, propuesta 7 de José, parte 1): fotos que se vuelven cajas ----------
// d = profundidad (metros). La foto es la cara de adelante y la caja crece para atrás (n = -cross(r, u): cross(r, u) mira
// hacia el que ve la foto derecha, o sea para donde mira la cámara al sacarla, al revés). Las otras caras llevan la misma
// imagen con la misma escala que la de adelante (si la cara es más chica, un pedazo del centro; en un cubo, la foto entera
// en cada cara). Cada cara: c, r, u, w, h, uv, k (sombra: los costados más oscuros, arriba más claro), con cross(r, u) para
// afuera de la caja (así se lee derecha, no espejada, desde afuera).
const D_MAX = 40;
const dValida = d => Number.isFinite(d) && d > 1e-4 ? Math.min(d, D_MAX) : undefined;
// repetir la textura (biblioteca de texturas, v10.23, propuesta 8): rep = [ancho, alto] en metros de cada repetición
// (la imagen entera: con rep, uv es siempre FULL). Sin rep (o roto): estirada, como siempre.
const REP_MIN = 0.05, REP_N = 200;                       // a lo sumo 200 repeticiones por lado (precisión y dibujo)
function repValida(r) {
  if (!Array.isArray(r) || r.length !== 2 || !r.every(v => Number.isFinite(v) && v >= REP_MIN && v <= 40)) return undefined;
  return [Math.round(r[0] * 1000) / 1000, Math.round(r[1] * 1000) / 1000];
}
// las coordenadas de la textura para dibujar una cara de ancho w y alto h: el recorte uv o, repetida, cuántas baldosas entran
function uvDe(p, w = p.w, h = p.h) {
  const r = repValida(p.rep);
  if (!r) return p.uv || FULL;
  return [0, 0, Math.min(REP_N, w / r[0]), Math.min(REP_N, h / r[1])];
}
// qué lleva cada una de las otras 5 caras (v10.20, parte 2): cc = 5 letras, en el orden atrás, costado derecho, costado
// izquierdo, arriba, abajo: m = la misma imagen (derecha desde afuera, como en v10.19), e = espejada (sigue desde el borde
// de la foto como en un espejo: sin costura en la arista), b = el borde de la foto estirado (se "derrama" hacia atrás),
// c = un color liso: el del borde de la foto de ese lado (atrás: el de toda la foto). Atrás no tiene borde: b no vale.
// o = otra foto (v10.21, parte 3): una imagen propia de esa cara (ci[i] = {tex, a: alto/ancho, g}), recortada al centro
// con la forma de la cara. Sin su imagen (todavía no cargó, o en la sala, que todavía no las lleva) se ve como m.
// Sin cc (o 'mmmmm'): todas la misma.
const CARA_NOMBRE = ['la foto', 'atrás', 'el costado derecho', 'el costado izquierdo', 'arriba', 'abajo'];
const CARA_LADO = [null, null, 'r', 'l', 't', 'b'];   // de qué lado de la foto toca cada cara (para el borde y su color)
// en el museo, cc se guarda sin 'o' (la letra que había debajo: m) y aparte co = qué caras tienen su foto (bit i-1): así
// un v10.20 (si se vuelve atrás) ve la caja con la misma en esas caras y no pierde las otras letras al moverla
const ccGuardar = cc => ccValida(cc) ? ccValida(cc.replace(/o/g, 'm')) : undefined;
const coDe = cc => { let m = 0; if (ccValida(cc)) for (let i = 0; i < 5; i++) if (cc[i] === 'o') m |= 1 << i; return m || undefined; };
function ccConFotos(cc, co) {
  if (!Number.isInteger(co) || co <= 0 || co > 31) return ccValida(cc);
  const a = (ccValida(cc) || 'mmmmm').split('');
  for (let i = 0; i < 5; i++) if (co & (1 << i)) a[i] = 'o';
  return ccValida(a.join(''));
}
// en la sala (v10.22) va igual: cc sin 'o' y cg = la imagen de cada cara, 5 claves separadas por coma ('' = sin foto
// propia); la imagen está en imgs/<id>~c<clave>. "a todas" usa la misma clave en las 5 (se sube y se baja una vez)
function cgValida(s) {
  if (typeof s !== 'string' || s.length > 70) return undefined;
  const a = s.split(',');
  return a.length === 5 && a.every(g => /^[a-z0-9]{0,12}$/.test(g)) && a.some(Boolean) ? s : undefined;
}
const cgLista = cg => (cgValida(cg) || ',,,,').split(',');
function ccConCg(cc, cg) {
  const a = (ccValida(cc) || 'mmmmm').replace(/o/g, 'm').split(''), gs = cgLista(cg);
  for (let i = 0; i < 5; i++) if (gs[i]) a[i] = 'o';
  return ccValida(a.join(''));
}
function ccValida(s) {
  if (typeof s !== 'string' || !/^[mebco]{5}$/.test(s)) return undefined;
  if (s[0] === 'b') s = 'm' + s.slice(1);
  return s === 'mmmmm' ? undefined : s;
}
// el recorte centrado de una imagen de alto/ancho a que llena una cara de alto/ancho fa
function uvLlena(a, fa) {
  if (a > fa) { const k = fa / a; return [0, (1 - k) / 2, 1, (1 + k) / 2]; }
  const k = a / fa; return [(1 - k) / 2, 0, (1 + k) / 2, 1];
}
function cajaCaras(p, ci = p.ci) {
  const d = dValida(p.d);
  if (!d) return null;
  const cc = ccValida(p.cc) || 'mmmmm';
  // repetida (v10.23): las mismas cuentas, pero en baldosas (uv de 0 a n) y sin tope: la imagen sigue por todas las caras
  const tile = !!repValida(p.rep), n = mul(norm(cross(p.r, p.u)), -1), r = p.r, u = p.u, C = add(p.c, mul(n, d / 2)), uv = uvDe(p);
  const aw = uv[2] - uv[0], ah = uv[3] - uv[1], su = aw / p.w, sv = ah / p.h;
  const recorte = (w, h) => {
    let a = w * su, b = h * sv;
    const k = tile ? 1 : Math.min(1, aw / a, ah / b); a *= k; b *= k;
    const cu = (uv[0] + uv[2]) / 2, cv = (uv[1] + uv[3]) / 2;
    return [cu - a / 2, cv - b / 2, cu + a / 2, cv + b / 2];
  };
  const neg = v => mul(v, -1);
  // espejada y borde: la cara arranca en la arista que comparte con la foto. a/b = cuánto de la imagen entra en la
  // profundidad (con la misma escala; si la caja es más honda que la foto, se estira)
  const a = tile ? d * su : Math.min(d * su, aw), b = tile ? d * sv : Math.min(d * sv, ah), E = 0.002;
  const [u0, v0, u1, v1] = uv;
  const UV = {
    e: [null, [u1, v0, u0, v1], [u1, v0, u1 - a, v1], [u0 + a, v0, u0, v1], [u0, v0 + b, u1, v0], [u0, v1, u1, v1 - b]],
    b: [null, null, [u1 - E, v0, u1 - E, v1], [u0 + E, v0, u0 + E, v1], [u0, v0 + E, u1, v0 + E], [u0, v1 - E, u1, v1 - E]],
  };
  const cara = (i, c, rr, uu, w, h) => {
    const fuera = norm(cross(rr, uu)), img = cc[i - 1] === 'o' && ci && ci[i] || null, t = cc[i - 1] === 'o' && !img ? 'm' : cc[i - 1];
    return { c, r: rr, u: uu, w, h, uv: img ? uvLlena(img.a, h / w) : (UV[t] && UV[t][i]) || recorte(w, h), k: clamp(0.72 + 0.25 * fuera[1], 0.5, 1), t, img };
  };
  const atras = cara(1, add(p.c, mul(n, d)), neg(r), u, p.w, p.h); atras.k = Math.max(atras.k, 0.9);
  return [
    { c: p.c, r, u, w: p.w, h: p.h, uv: uv.slice(), k: 1, t: 'f' },     // adelante: la foto
    atras,                                                              // atrás: la misma, derecha desde atrás
    cara(2, add(C, mul(r, p.w / 2)), n, u, d, p.h), cara(3, sub(C, mul(r, p.w / 2)), neg(n), u, d, p.h),   // costados
    cara(4, add(C, mul(u, p.h / 2)), r, n, p.w, d), cara(5, sub(C, mul(u, p.h / 2)), r, neg(n), p.w, d),   // arriba y abajo
  ];
}
// el color liso de una cara 'c' (se guarda en la cara; se vuelve a calcular si cambió la imagen)
function caraColor(f, i, tex, uv) {
  if (f.colTex !== tex) { f.col = colorBorde(tex, uv || FULL, CARA_LADO[i]); f.colTex = tex; }
  return f.col;
}

// el fov va sobre el lado más corto de la pantalla (celu vertical: el ancho; compu apaisada: el alto)
function tans() { const t = Math.tan(FOVX / 2); return W <= H ? [t, t * H / W] : [t * W / H, t]; }
const metersPerPx = d => d * 2 * tans()[0] / W;   // cuánto mide un px a distancia d

// foto con marco de grosor fijo en pantalla, el marco apenas detrás.
// deco (en recortar / escalar): las agarraderas encima de la foto. Recortar: esquinas en L y barritas en el medio de
// cada lado (y los tercios mientras se recorta); escalar: cuadraditos en las esquinas y en el medio de los lados.
// El lado que se está moviendo va en amarillo: su línea del marco y sus agarraderas, con la misma forma (sin barras encimadas).
const COLOR_RECORTE = [1, 0.85, 0.2];
function drawFramed(p, tex, color, deco = null, ci = undefined) {
  const d = len(sub(p.c, pos));
  const m = OUTLINE_PX * metersPerPx(d);
  let n = norm(cross(p.r, p.u));
  if (dot(n, sub(p.c, pos)) < 0) n = mul(n, -1);         // hacia atrás de la foto
  const atras = add(p.c, mul(n, 0.004 * d));
  if (color) drawQuad(scratch, quadData(atras, p.r, p.u, p.w + 2 * m, p.h + 2 * m), white, color);   // (sin color: sin borde, para la miniatura de una pieza)
  if (p.rep && !repValida(p.rep)) p = { ...p, rep: undefined };
  const tile = !!p.rep;                                  // la textura repetida (v10.23)
  drawQuad(scratch, quadData(p.c, p.r, p.u, p.w, p.h, uvDe(p)), tex, [1, 1, 1], 1, SIN_FADE, 0, tile);
  const caras = cajaCaras(p, ci);                        // una caja (extruida): las otras 5 caras (ci: sus fotos propias)
  if (caras) for (let i = 1; i < caras.length; i++) {
    const f = caras[i];
    if (f.img) drawQuad(scratch, quadData(f.c, f.r, f.u, f.w, f.h, f.uv), f.img.tex, [f.k, f.k, f.k]);
    else if (f.t === 'c') { const c = colorBorde(tex, p.uv || FULL, CARA_LADO[i]); drawQuad(scratch, quadData(f.c, f.r, f.u, f.w, f.h), white, [c[0] * f.k, c[1] * f.k, c[2] * f.k]); }
    else drawQuad(scratch, quadData(f.c, f.r, f.u, f.w, f.h, f.uv), tex, [f.k, f.k, f.k], 1, SIN_FADE, 0, tile);
  }
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
  if (deco.modo === 'extruir') { aristasCaja(p, Y, deco.cara); return; }
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

// extruir: las aristas de la caja en amarillo, también las de atrás (se ven a través de la foto): de frente la caja
// tapa su propia profundidad y, sin esto, al arrastrar no se vería que crece
function aristasCaja(p, col, sel = 0) {
  const caras = cajaCaras(p);
  if (!caras) return;
  const n = mul(norm(cross(p.r, p.u)), -1), q = (sx, sy, sz) => add(p.c, add(add(mul(p.r, sx * p.w / 2), mul(p.u, sy * p.h / 2)), mul(n, sz * p.d)));
  const linea = (a, b) => {
    const dir = sub(b, a), largo = len(dir);
    if (largo < 1e-4) return;
    const mid = add(a, mul(dir, 0.5)), t = mul(dir, 1 / largo);
    let lado = cross(t, sub(mid, pos));
    if (len(lado) < 1e-6) return;
    drawQuad(scratch, quadData(mid, norm(lado), t, metersPerPx(Math.max(0.2, len(sub(mid, pos)))) * grueso, largo), white, col, 0.9);
  };
  let grueso = 2.5;
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) linea(q(sx, sy, 0), q(sx, sy, 1));   // de adelante para atrás
  const vuelta = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
  for (let i = 0; i < 4; i++) linea(q(...vuelta[i], 1), q(...vuelta[i + 1], 1));                    // la cara de atrás
  const f = sel > 0 && caras[sel];
  if (f) {                                               // la cara que se está eligiendo (v10.20): su borde en blanco, más grueso
    const esq = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([sx, sy]) => add(f.c, add(mul(f.r, sx * f.w / 2), mul(f.u, sy * f.h / 2))));
    grueso = 4.5; col = [1, 1, 1];
    for (let i = 0; i < 4; i++) linea(esq[i], esq[i + 1]);
  }
  gl.disable(gl.BLEND);
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

// con la pose nueva: el buffer para dibujarla y, si es una caja, sus caras (para dibujar, chocar y agarrar).
// Cada cara sabe de qué obra es (obra) y hasta dónde llega la caja arriba (top: una caja baja se sube como un escalón).
function setBuf(w) {
  gl.bindBuffer(gl.ARRAY_BUFFER, w.buf);
  w.d = dValida(w.d); w.cc = ccValida(w.cc); w.rep = w.vacio ? undefined : repValida(w.rep);
  const caras = w.d && !w.rota ? cajaCaras(w) : null;   // una rota no choca ni es caja (pero no pierde su profundidad)
  if (caras) {
    const top = Math.max(...caras.map(f => f.c[1] + (Math.abs(f.r[1]) * f.w + Math.abs(f.u[1]) * f.h) / 2));
    // se sube como un escalón solo si arriba tiene una cara de piso (inclinada sobre una arista no: se atravesaría)
    const escalon = caras.some(f => Math.abs(normal(f)[1]) > 0.7 && f.c[1] > top - 0.01);
    for (const f of caras) { f.obra = w; f.top = escalon ? top : undefined; }
    const data = new Float32Array(caras.length * 30);
    caras.forEach((f, i) => data.set(quadData(f.c, f.r, f.u, f.w, f.h, f.uv), i * 30));
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  } else gl.bufferData(gl.ARRAY_BUFFER, quadData(w.c, w.r, w.u, w.w, w.h, w.vacio ? w.uv : uvDe(w)), gl.STATIC_DRAW);
  w.caras = caras;
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
  if (o.de && typeof o.de === 'object') w.de = o.de;      // quién la puso (sala; ya viene limpio) y cuándo (huellas, v10.12)
  if (Number.isFinite(o.t0)) w.t0 = o.t0;
  if (Number.isFinite(o.cielo)) w.cielo = o.cielo;       // es (o fue) el cielo (v10.15)
  if (Number.isFinite(o.so) && o.so > 0) w.so = o.so;    // tiene sonido del lugar en la sala (v10.17)
  w.d = dValida(o.d);                                    // es una caja: su profundidad (extruir, v10.19)
  w.rep = repValida(o.rep);                              // la textura repetida (biblioteca de texturas, v10.23)
  if (sala.active && !o.vacio) w.tx = salaTxValida(o.tx); // en la sala: su imagen es una textura compartida (v10.23)
  w.cc = ccConFotos(o.cc, o.co);                         // y qué lleva cada cara (v10.20; co: las que tienen su foto, v10.21)
  if (sala.active && o.cg) { w.cg = cgValida(o.cg); w.cc = ccConCg(w.cc, w.cg); }   // en la sala: las fotos de sus caras (v10.22)
  w.gr = grValido(o.gr);                                 // es parte de una pieza (agrupar, v10.24)
  setBuf(w);
  works.push(w);
  if (w.cg) salaCarasSync(w);                            // bajarlas
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
  const o = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), c: p.c, r: p.r, u: p.u, w: p.w, h: p.h, uv: FULL.slice(), vacio: true, t0: Date.now() };
  if (p.d) o.d = p.d;                                    // el bloque equipado extruido: pone cajas (v10.19)
  if (p.d && p.cc) o.cc = p.cc;                          // con sus caras elegidas (v10.20)
  if (sala.active) o.de = salaDe();
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
// entera (una textura de la biblioteca, v10.23) o repetida: se guarda la imagen entera y se muestra con el recorte que
// llena la forma (uvLlena); así la misma textura es la misma imagen en todos los bloques y se puede repetir entera
// tx: la clave de la textura de la biblioteca (en la sala se sube una sola vez y la pose la nombra: salaTxSubir)
function llenarBloque(src, entera = false, tx = undefined) {
  if (!held) return;
  cur();
  const w = held.work, L = held.L, asp = L.h / L.w;
  entera = entera || !!repValida(L.rep);
  const c = entera ? copiaCara(src, 1024) : recorteCentrado(src, asp), ia = c.height / c.width;
  const antes = guardarComoEstaba(w);
  const r = w.relleno = { texVieja: antes.texVieja, aspect: antes.aspect, vacioViejo: antes.vacioViejo, c, aspectImg: entera ? ia : 0, tx: entera ? tx : undefined };
  if (src === video) sonGrabar(w.id, sb => sonDelRelleno(w, r, sb));   // con la cámara también graba el sonido de ahí (v10.17)
  w.tex = texture(small(c)); w.vacio = false; w.aspect = entera ? ia : asp;
  L.uv = !entera || repValida(L.rep) ? FULL.slice() : uvLlena(ia, asp);
  if (repValida(L.rep)) L.rep = repDe(L.rep[0], ia);
  flash.style.transition = 'none'; flash.style.opacity = 0.7;
  requestAnimationFrame(() => { flash.style.transition = 'opacity 0.35s'; flash.style.opacity = 0; });
  buzz(15);
  ui();
}
// el sonido grabado al llenar con la cámara: si todavía no la soltaste, espera en el relleno; si ya la soltaste con ✓ (y
// sigue siendo esa imagen), se pega ahora. Si la soltaste sin ✓ o elegiste otra imagen, no va.
function sonDelRelleno(w, r, sb) {
  if (!sb || !works.includes(w)) return;
  if (w.relleno === r) { r.son = sb; return; }
  if (!r.imgN || w.imgN !== r.imgN || w.vacio || w.relleno) return;
  sonPegar(w, sb, r.subida);
}
function sonPegar(w, sb, subida) {
  w.son = sb;
  if (sala.active) { if (subida) salaSonSubir(w, sb, subida); return; }
  store('readwrite', s => { const q = s.get(w.id); q.onsuccess = () => q.result && !q.result.vacio && s.put({ ...q.result, son: sb }); }).catch(() => {});
}
// sacarle la imagen a la foto que tenés en la mano: queda un bloque vacío (se guarda recién al soltar con ✓)
function vaciarFoto() {
  if (!held || held.work.vacio) return;
  cur();
  const w = held.work;
  const antes = guardarComoEstaba(w);
  w.relleno = { texVieja: antes.texVieja, aspect: antes.aspect, vacioViejo: antes.vacioViejo, vaciar: true };
  w.tex = texture(VACIO_IMG); w.vacio = true; held.L.uv = FULL.slice(); held.L.rep = undefined;
  buzz(12);
  showHint('vacía: soltala con ✓ para guardarla así');
  ui();
}
// repetir la textura (v10.23, propuesta 8): cada toque cambia de cuánto es cada repetición: el paso de la grilla (o 1 m)
// → la mitad → ... → 25 cm → estirada otra vez. Repetida, la imagen va entera (uv FULL); al volver a estirarla, el recorte
// que llena la forma. Se guarda al soltar con ✓ (cancelar la deja como estaba).
const REP_PASOS = [1, 0.5, 0.25];
const repDe = (tw, a) => repValida([tw, clamp(tw * (a > 0 && Number.isFinite(a) ? a : 1), REP_MIN, 40)]);
const repTxt = m => m >= 1 ? m + ' m' : Math.round(m * 100) + ' cm';
function repetirPintar() {
  const r = held && held.L ? repValida(held.L.rep) : held && repValida(held.work.rep);
  const el = $('repetir');
  el.textContent = r ? 'repite: ' + repTxt(r[0]) : 'repetir';
  el.classList.toggle('on', !!r);
}
function repetir() {
  if (!held || held.work.vacio || held.work.rota) return;
  const L = cur(), w = held.work, a = w.aspect > 0 ? w.aspect : L.h / L.w;
  const r = repValida(L.rep), i = r ? REP_PASOS.findIndex(x => Math.abs(x - r[0]) < 1e-3) : -1;
  if (r && (i < 0 || i === REP_PASOS.length - 1)) {
    L.rep = undefined; L.uv = uvLlena(a, L.h / L.w);
    showHint('estirada (sin repetir)');
  } else {
    const tw = r ? REP_PASOS[i + 1] : grilla ? pasoGrilla : 1;
    L.rep = repDe(tw, a); L.uv = FULL.slice();
    showHint('se repite cada ' + repTxt(tw) + ' · agrandala (escalar) para que entren más');
  }
  buzz(10);
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
// un bloque vacío: recortar es escalar (no hay imagen); con la textura repetida (v10.23) también (agrandarla suma baldosas)
const vacioEnMano = () => held ? !!held.work.vacio || !!(held.L && held.L.rep) : bloqueOn;
let held = null;            // { work, L }
let mode = 'mover';
const cur = () => { if (held && held.aim) finishAim(); return held ? held.L : enMano(); };
// distancia de lo que está en la mano (sin cortar el giro hacia la foto)
const heldDist = () => held && held.aim ? len(sub(held.work.c, pos)) : len(cur().c);

function worldPose(b, L) {
  return { c: add(pos, toWorldV(b, L.c)), r: toWorldV(b, L.r), u: toWorldV(b, L.u), w: L.w, h: L.h, uv: L.uv.slice(), d: dValida(L.d), cc: ccValida(L.cc), rep: repValida(L.rep) };
}

// ---------- colisiones: las fotos son paredes y pisos ----------
// casi horizontales (menos de 45°) = piso: te parás encima y subís escalones de hasta 40 cm sin saltar.
// el resto = pared: no se atraviesa. Lo que tenés en la mano (o tiene otro) no choca.
const CUERPO = 0.22, ESCALON = 0.4, GRAVEDAD = 9.8;
let velY = 0;
// una caja (extruida, v10.19) choca con sus 6 caras: cada una es una foto más, con obra = la caja y top = su altura
function solidas() {
  const otros = salaEnManos(), r = [];
  for (const w of works) {
    if ((held && (w === held.work || pzEnMano(w))) || otros.has(w.id) || w.rota || w === cieloW) continue;   // la del cielo no está en su lugar
    if (w.caras) r.push(...w.caras); else r.push(w);
  }
  return r;
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
      if (w.top !== undefined && w.top <= pies + ESCALON) continue;   // costado de una caja baja: se sube como un escalón
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
        if (!Number.isFinite(px) || !Number.isFinite(pz)) { const ob = w.obra || w; ob.rota = true; diag(`foto ${String(ob.id).slice(-6)} rompía la física → no choca`); continue; }
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
// fijo (una pieza en la mano, v10.24): solo se alinean el giro y la posición; el tamaño y la profundidad quedan
function snapPose(p, P = pasoGrilla, fijo = false) {
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
  // el lado más largo, al múltiplo de P más cercano (mínimo P); el otro sigue la proporción (una tira angosta no se estira).
  // Repetida (v10.23) no se estira nada: los dos lados de a un paso
  const k = p.w >= p.h ? Math.max(P, snapP(p.w, P)) / p.w : Math.max(P, snapP(p.h, P)) / p.h;
  const tile = !!repValida(p.rep);
  const w = fijo ? p.w : tile ? Math.max(P, snapP(p.w, P)) : p.w * k, h = fijo ? p.h : tile ? Math.max(P, snapP(p.h, P)) : p.h * k;
  const c0 = sub(sub(p.c, mul(r, w / 2)), mul(u, h / 2));
  const corner = c0.map(v => snapP(v, P));
  const d = fijo ? dValida(p.d) : p.d > 0 ? dValida(snapP(p.d, P)) : undefined;   // la profundidad de una caja, de a un paso (o nada)
  return { c: add(add(corner, mul(r, w / 2)), mul(u, h / 2)), r, u, w, h, uv: p.uv.slice(), d, cc: p.cc, rep: p.rep };
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
  return grilla ? snapPose(p, pasoGrilla, pzEsPieza()) : p;   // con una pieza, sin cambiar de tamaño (v10.24)
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
// extruir (v10.19): sumarle (o sacarle) profundidad a lo que está en la mano; arriba dice cuánta queda (con la grilla, de a un paso)
const largoTxt = m => m < 0.995 ? Math.round(m * 100) + ' cm' : (Math.round(m * 10) / 10).toString().replace('.', ',') + ' m';
let extruirTxt = '';
function extruirBy(L, dd) {
  const d0 = L.d || 0, d = clamp(d0 + dd, 0, D_MAX);
  L.d = d > 0.005 ? d : undefined;
  // agarrada desde atrás, la caja crecería hacia vos (y te encerraría): queda quieta la cara de tu lado y se aleja la otra
  // para donde crece, en coordenadas de la cámara (vos en el origen). Ojo: la base de la cámara (r, u, f) es de mano
  // izquierda (cross(r, u) = -f), así que acá el producto cruz da al revés que en el mundo: sin el -1
  const n = norm(cross(L.r, L.u));
  if (dot(n, L.c) < 0) L.c = sub(L.c, mul(n, (L.d || 0) - d0));
  const p = held ? heldPose(basis()) : previewPose(basis());
  const t = p.d ? 'profundidad: ' + largoTxt(p.d) : 'sin profundidad: una foto';
  if (t !== extruirTxt) { extruirTxt = t; showHint(t); }
  if (caraSel) pintarCaras();
}
// elegir qué lleva cada cara de la caja que tenés en la mano (v10.20, propuesta 7, parte 2): en extruir, tocar una cara
// (sin arrastrar) la elige (su borde en blanco) y arriba de ajustar aparecen las opciones: la misma / espejada / borde /
// color, y "a todas". Va en la pose de la mano (L.cc): se guarda al soltar con ✓, como la profundidad.
let caraSel = 0;
const caraOpsEl = $('caraOps');
// qué cara de la caja en la mano está en (x, y): su número (0 = la foto) o -1 (no es una caja o no la tocaste)
function caraEn(x, y) {
  if (held && held.aim) return -1;
  const b = basis(), p = held ? heldPose(b) : previewPose(b);
  const caras = cajaCaras(p);
  if (!caras) return -1;
  const d = rayoEn(x, y);
  let best = -1, bt = Infinity;
  caras.forEach((f, i) => {
    const n = cross(f.r, f.u), den = dot(d, n);
    if (Math.abs(den) < 1e-6) return;
    const t = dot(sub(f.c, pos), n) / den;
    if (t <= 0 || t >= bt) return;
    const q = sub(add(pos, mul(d, t)), f.c);
    if (Math.abs(dot(q, f.r)) <= f.w / 2 + 1e-4 && Math.abs(dot(q, f.u)) <= f.h / 2 + 1e-4) { best = i; bt = t; }
  });
  return best;
}
function tocarCara(x, y) {
  const i = caraEn(x, y);
  if (i < 0) { if (caraSel) { caraSel = 0; pintarCaras(); } return false; }
  if (i === 0) {
    caraSel = 0; pintarCaras();
    if (!held) return false;                              // la vista previa: el toque sigue (agarrar lo que se ve a través, tocar a alguien)
    showHint('esa es la foto · tocá otra cara (con girar la das vuelta para ver las de atrás)'); return true;
  }
  caraSel = i; buzz(8); pintarCaras(); extruirTxt = '';
  showHint(CARA_NOMBRE[i] + ': elegí qué lleva');
  return true;
}
function setCara(t) {
  if (!caraSel || !caraOpsEl) return;
  const L = cur(), cc = (ccValida(L.cc) || 'mmmmm').split('');
  if (t === 'todas') {
    const v = cc[caraSel - 1];
    if (v === 'o') {                                     // otra foto a todas: la misma imagen en las 5 (una sola textura)
      const e = ciVer(caraSel);
      if (!e || !puedeFotoCara()) { showHint('esa cara todavía no tiene su foto'); return; }
      held.ciN = held.ciN || {};
      for (let i = 1; i <= 5; i++) held.ciN[i] = e;
    }
    for (let i = 0; i < 5; i++) cc[i] = i === 0 && v === 'b' ? cc[0] : v;
  }
  else cc[caraSel - 1] = t;
  L.cc = ccValida(cc.join(''));
  buzz(8); pintarCaras();
  if (t === 'todas') showHint('todas las caras así');
}
function pintarCaras() {
  if (!caraOpsEl) return;
  const L = held ? (held.aim ? null : held.L) : enMano();
  // lo que se ve (con la grilla, menos de medio paso de profundidad es plana aunque L.d tenga algo)
  const plana = !!L && !(held ? heldPose(basis()) : previewPose(basis())).d;
  const on = !!(caraSel && L && mode === 'extruir' && ajustando && !plana);
  if (caraSel && plana) caraSel = 0;                     // la aplanaste: no hay caras
  caraOpsEl.style.display = on ? '' : 'none';
  if (!on) return;
  let t = (ccValida(L.cc) || 'mmmmm')[caraSel - 1];
  if (t === 'o' && !ciVer(caraSel)) t = 'm';            // sin su imagen se ve como la misma
  $('caraNombre').textContent = CARA_NOMBRE[caraSel] + ':';
  for (const el of caraOpsEl.querySelectorAll('[data-t]')) {
    el.classList.toggle('on', el.dataset.t === t);
    el.style.display = el.dataset.t === 'b' && caraSel === 1 ? 'none' : '';   // atrás no toca ningún borde de la foto
  }
  const fo = $('caraFoto');
  fo.classList.toggle('on', t === 'o');
  fo.style.display = puedeFotoCara() ? '' : 'none';
}
if (caraOpsEl) for (const el of caraOpsEl.querySelectorAll('[data-t]')) el.addEventListener('click', () => setCara(el.dataset.t));
if (caraOpsEl) $('caraTodas').addEventListener('click', () => setCara('todas'));
if (caraOpsEl) $('caraFoto').addEventListener('click', () => elegirFotoCara());

// otra foto en una cara (v10.21, propuesta 7, parte 3): en las opciones de la cara, "foto" abre cámara / galería (el
// mismo selector que para llenar la foto) y esa imagen va en esa cara, recortada al centro con su forma (si cambia el
// tamaño de la caja, se vuelve a recortar). Sirve también para llenar un bloque vacío extruido cara por cara. Solo con
// algo en la mano (en la sala desde v10.22: se sube al soltarla, salaCarasSubir). Mientras la tenés en la mano, lo
// elegido está en held.ciN (cara → {tex, a, g, c}); se guarda al soltar con ✓ (ciAplicar) y cancelar lo descarta.
// Museo: cada cara en su propio registro de IndexedDB '<id>~c<i>' = {id, obra, i, cara: blob, a, g} (los v10.20 no los
// ven: no tienen blob ni vacio). g: las caras con la misma imagen ("a todas") la comparten al cargar (una textura).
const puedeFotoCara = () => !!held && !held.aim;
// la imagen de la cara i de lo que tenés en la mano: la elegida ahora o la que ya tenía
function ciVer(i) {
  if (!held) return null;
  if (held.ciN && i in held.ciN) return held.ciN[i];
  return (held.work.ci && held.work.ci[i]) || null;
}
function ciMano() {
  if (!held || (!held.ciN && !held.work.ci)) return undefined;
  const r = [];
  for (let i = 1; i <= 5; i++) r[i] = ciVer(i);
  return r;
}
// una copia de la imagen para la cara (a lo sumo 768 px: es lo que se guarda; la textura, a 512 como todas)
function copiaCara(src, max = 768) {
  const sw = src.naturalWidth || src.videoWidth || src.width, sh = src.naturalHeight || src.videoHeight || src.height;
  const k = Math.min(1, max / Math.max(sw, sh)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}
let archivoCara = null;   // {i, held}: el selector de archivo se abrió para una cara (no para la foto)
function elegirFotoCara() {
  if (!caraSel || !puedeFotoCara()) return;
  if (tx.lista.length) { txAbrir({ cara: caraSel, held }); return; }   // con texturas guardadas: la hoja para elegir (v10.23)
  archivoCara = { i: caraSel, held };
  $('bloqueArchivo').click();   // en el iPhone: sacar foto / fototeca / archivos
}
function llenarCara(src, i) {
  if (!puedeFotoCara() || !(i >= 1 && i <= 5)) return;
  const L = cur(), c = copiaCara(src);
  const e = { tex: texture(small(c)), a: c.height / c.width, g: (Math.random().toString(36).slice(2) + '00000000').slice(0, 8), c };
  held.ciN = held.ciN || {}; held.ciN[i] = e;
  (held.ciCreadas = held.ciCreadas || []).push(e);
  const cc = (ccValida(L.cc) || 'mmmmm').split(''); cc[i - 1] = 'o'; L.cc = ccValida(cc.join(''));
  flash.style.transition = 'none'; flash.style.opacity = 0.5;
  requestAnimationFrame(() => { flash.style.transition = 'opacity 0.35s'; flash.style.opacity = 0; });
  buzz(12);
  if (caraSel === i) pintarCaras();
  extruirTxt = '';
  showHint(CARA_NOMBRE[i] + ': otra foto · soltala con ✓ para guardarla');
}
// borrar las texturas de estas imágenes de cara que no estén en usadas (una vez cada una)
function ciBorrar(lista, usadas = new Set()) {
  const ya = new Set();
  for (const e of lista) if (e && !usadas.has(e) && !ya.has(e.tex)) { ya.add(e.tex); gl.deleteTexture(e.tex); }
}
// al soltar con ✓: las caras con 'o' se quedan con su imagen (la nueva o la que tenían); las otras la pierden
function ciAplicar(h, w, ccAntes) {
  const cc = ccValida(w.cc) || 'mmmmm', viejo = w.ci || [], nuevo = [];
  for (let i = 1; i <= 5; i++) nuevo[i] = cc[i - 1] === 'o' ? ((h.ciN && i in h.ciN ? h.ciN[i] : viejo[i]) || null) : null;
  const usadas = new Set(nuevo.filter(Boolean));
  ciBorrar([...viejo, ...(h.ciCreadas || [])], usadas);
  h.ciN = null; h.ciCreadas = null;
  w.ci = usadas.size ? nuevo : undefined;
  // (también se borra el registro de una cara que tenía foto y ya no, aunque su imagen todavía no hubiera cargado)
  const antes = ccValida(ccAntes) || 'mmmmm';
  if (!sala.active) for (let i = 1; i <= 5; i++) if (nuevo[i] !== (viejo[i] || null) || (antes[i - 1] === 'o' && cc[i - 1] !== 'o')) guardarCara(w, i, nuevo[i]);
}
// soltada sin ✓: lo elegido para las caras se descarta
function ciDescartar(h, w) {
  if (h && h.ciCreadas) ciBorrar(h.ciCreadas, new Set((w && w.ci) || []));
  if (h) { h.ciN = null; h.ciCreadas = null; }
}
function guardarCara(w, i, e) {
  const id = w.id + '~c' + i;
  w.ciGen = w.ciGen || {};
  const n = w.ciGen[i] = (w.ciGen[i] || 0) + 1;   // si se vuelve a cambiar antes de terminar, gana lo último
  if (!e) { store('readwrite', s => s.delete(id)).catch(() => {}); return; }
  e.blobP = e.blobP || new Promise(res => e.blob ? res(e.blob) : e.c ? e.c.toBlob(res, 'image/jpeg', 0.85) : res(null));
  e.blobP.then(blob => {
    if (blob && !e.blob) { e.blob = blob; e.c = null; }   // ya no hace falta el lienzo
    if (!works.includes(w) || w.ciGen[i] !== n) return;
    if (!blob) { diag('caja: no pude guardar la foto de una cara'); return; }
    store('readwrite', s => s.put({ id, obra: w.id, i, cara: blob, a: e.a, g: e.g })).catch(() => {});
  });
}
// al cargar el museo: la foto de una cara (su obra ya está cargada: la clave '<id>~c<i>' va después de '<id>')
async function cargarCara(o) {
  const i = Number(String(o.id).slice(-1)), w = works.find(x => x.id === o.obra);
  if (sala.active || !w || !(o.cara instanceof Blob) || !o.cara.size || (ccValida(w.cc) || '')[i - 1] !== 'o') return;
  const otra = w.ci && o.g && w.ci.find(e => e && e.g === o.g);
  let e = otra;
  if (!e) {
    let url = null;
    try {
      // una copia en memoria: un Blob de IndexedDB leído mucho después puede fallar en WebKit (si hay que volver a guardarlo)
      const blob = new Blob([await o.cara.arrayBuffer()], { type: o.cara.type || 'image/jpeg' });
      url = URL.createObjectURL(blob);
      const img = new Image(); img.src = url;
      await Promise.race([img.decode(), new Promise((_, rej) => setTimeout(() => rej(new Error('tardó')), 5000))]);
      // mientras cargaba: salir, borrarla, otra foto en esa cara (gana la nueva) o la cara ya no lleva foto
      if (sala.active || !works.includes(w) || (w.ci && w.ci[i]) || (ccValida(w.cc) || '')[i - 1] !== 'o') return;
      e = { tex: texture(small(img)), a: img.naturalHeight / img.naturalWidth, g: o.g, blob };
      img.src = '';
    } catch (err) { diag('museo: no pude abrir la foto de una cara (' + err.message + ')'); return; }
    finally { if (url) URL.revokeObjectURL(url); }
  }
  if (!(e.a > 0) || !Number.isFinite(e.a)) return;
  w.ci = w.ci || [];
  if (w.ci[i]) return;                                   // ya tiene (la eligieron mientras tanto)
  w.ci[i] = e;
  setBuf(w);
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
function stableGrilla(w, h, P = pasoGrilla, tile = false) {
  if (tile) return [w, h].every(m => m >= P - 1e-6 && Math.abs(m - snapP(m, P)) < 1e-6);   // repetida: los dos lados de a un paso
  const m = Math.max(w, h); return m >= P - 1e-6 && Math.abs(m - snapP(m, P)) < 1e-6;
}
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
    if (alinear && !stableGrilla(r - l, t - b, P, !!repValida(L.rep))) continue;
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
  if (held && pzEsPieza()) return;                       // una pieza no vuelve a como era (cambiaría la principal sola)
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
  if (held || !pzPuedeAgarrar(w)) return;               // una pieza que todavía no está entera (v10.24)
  held = { work: w, L: null, aim: { t: 0 } };
  pzAlAgarrar(w);                                       // si es parte de una pieza, vienen todas (v10.24)
  if (w.nueva) salaVista(w);                            // la agarraste: ya la viste (huellas)
  const huella = salaHuellaTxt(w);                      // quién la puso y cuándo (huellas, parte 2)
  if (huella) showHint(huella);
  setMode('mover');
  buzz(12);
  ui();
}
function finishAim() {
  const w = held.work, b = basis();
  held.L = { c: toLocalV(b, sub(w.c, pos)), r: toLocalV(b, w.r), u: toLocalV(b, w.u), w: w.w, h: w.h, uv: w.uv.slice(), d: w.d, cc: w.cc, rep: w.rep };
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
  const h = held, w = held && held.work;
  held = null;
  txCerrar();
  ciDescartar(h, w);                                     // fotos de caras elegidas y no guardadas (sin ✓)
  if (w) { deshacerRelleno(w); if (sala.active) salaSoltado(w); }
  setMode('mover'); if (ajustando) setAjustar(false); ui();
}
function clearWorks() {
  txCerrar();
  ciDescartar(held, held && held.work);
  held = null; caraSel = 0;
  for (const w of works) { if (w.relleno) gl.deleteTexture(w.relleno.texVieja); gl.deleteTexture(w.tex); gl.deleteBuffer(w.buf); if (w.ci) ciBorrar(w.ci); }
  works.length = 0;
}

function drop() {
  if (!held) return;
  cur();
  const w = held.work, ccAntes = w.cc, cgAntes = w.cg, pz = held.pz;
  Object.assign(w, heldPose(basis(), true));
  // una pieza (v10.24): las otras van a donde se ven y todas quedan con la misma gr (antes de guardar la principal)
  if (pz) { const r = pzSoltar(pz, w, o => sala.active ? salaSavePose(o) : store('readwrite', s => { const q = s.get(o.id); q.onsuccess = () => q.result && s.put({ ...q.result, c: o.c, r: o.r, u: o.u, gr: o.gr }); }).catch(() => {})); if (r) w.gr = r.g; }
  const relleno = w.relleno; w.relleno = null;
  if (relleno) { gl.deleteTexture(relleno.texVieja); w.aspect = relleno.aspectImg || w.h / w.w; }
  // museo: si la cambiás otra vez antes de que se guarde, gana la última. Otra imagen (o vacía): el sonido era del lugar de la vieja
  const txAntes = w.tx;
  if (relleno) w.tx = relleno.vaciar || !sala.active ? undefined : salaTxValida(relleno.tx);   // otra imagen: ¿es una textura? (v10.23)
  if (relleno) {
    if (sala.active) salaSonBorrar(w);   // en la sala, el sonido de la imagen vieja se borra (si no tenía, no cuesta nada)
    w.imgN = (w.imgN || 0) + 1; w.son = null; w.so = undefined; w.sonPedido = null;
    vidQuitar(w);                                           // y el video (v10.27)
    relleno.imgN = w.imgN;                                  // si el sonido de la cámara llega después, se pega a esta imagen
  }
  const imgN = w.imgN;
  if (relleno && !relleno.vaciar) w.iv = Date.now();     // imagen nueva: los demás de la sala la vuelven a bajar
  if (relleno) w.llenadoAfuera = null;                   // cambiaste la imagen vos: gana lo tuyo
  ciAplicar(held, w, ccAntes);                           // las fotos de las caras (v10.21): antes de armar sus caras
  if (sala.active) w.cg = salaCg(w, cgAntes);            // en la sala (v10.22): las que ya están en la base; las nuevas suben después
  setBuf(w);
  const pose = { c: w.c, r: w.r, u: w.u, w: w.w, h: w.h, uv: w.uv, d: w.d, cc: w.cc, rep: w.rep, gr: w.gr };
  const poseMuseo = { ...pose, cc: ccGuardar(w.cc), co: coDe(w.cc) };   // cc sin 'o' + co (ver ccGuardar)
  if (sala.active) {
    if (relleno && relleno.vaciar) relleno.subida = salaVaciar(w);
    else if (relleno) { relleno.subida = salaShoot({ id: w.id, ...pose }, relleno.c, w); if (relleno.son) sonPegar(w, relleno.son, relleno.subida); }
    else salaSavePose(w);
    salaCarasSubir(w, cgAntes);                          // las fotos nuevas de sus caras, y se borran las que ya no van
    // la textura que tenía, si ya nadie la usa: recién cuando la imagen nueva (o la pose vacía) quedó en la base
    if (txAntes && txAntes !== w.tx && relleno && relleno.subida) { const h = sala.hash; relleno.subida.then(() => salaTxQuizasBorrar(txAntes, h), () => {}); }
  } else if (relleno && relleno.vaciar) {
    store('readwrite', s => { const q = s.get(w.id); q.onsuccess = () => q.result && s.put({ ...q.result, ...poseMuseo, blob: null, vacio: true, son: null, vid: null, vi: null }); }).catch(() => {});
  } else {
    store('readwrite', s => { const q = s.get(w.id); q.onsuccess = () => q.result && s.put({ ...q.result, ...poseMuseo, ...(relleno ? { vid: null, vi: null } : {}) }); }).catch(() => {});
    // el bloque lleno: la imagen se agrega al registro que haya (si mientras tanto lo borraste, no lo revive)
    if (relleno) relleno.c.toBlob(blob => {
      if (!blob) { diag('bloque: no pude guardar la imagen'); return; }
      if (w.imgN !== imgN) return;   // mientras tanto la vaciaste o la cambiaste
      store('readwrite', s => { const q = s.get(w.id); q.onsuccess = () => q.result && s.put({ ...q.result, blob, vacio: false, son: w.son || null, vid: null, vi: null }); }).catch(() => {});
    }, 'image/jpeg', 0.85);
    if (relleno && relleno.son) w.son = relleno.son;   // el sonido que grabó la cámara al llenarlo (lo guarda el put de arriba)
  }
  buzz(12);
  releaseHold();
}
function cancelHold() { if (held) { buzz(8); releaseHold(); } }
function trash() {
  if (!held) return;
  const w = held.work, otras = pzParaBorrar();             // con una pieza en la mano, se borra entera (v10.24)
  for (const o of [w, ...otras]) {
    if (!works.includes(o)) continue;
    works.splice(works.indexOf(o), 1);
    if (o.relleno) { gl.deleteTexture(o.relleno.texVieja); o.relleno = null; }
    gl.deleteTexture(o.tex); gl.deleteBuffer(o.buf);
    if (o.ci) { ciBorrar(o.ci); o.ci = undefined; }
    if (sala.active) salaRemove(o);
    else store('readwrite', s => { s.delete(o.id); for (let i = 1; i <= 5; i++) s.delete(o.id + '~c' + i); }).catch(() => {});
  }
  buzz(20);
  releaseHold();
  if (otras.length) showHint('borraste la pieza (' + (otras.length + 1) + ')');
}

// ---------- el cielo (v10.15, propuesta 3 de José, parte 2) ----------
// "usar de cielo" con una foto en la mano: la foto sube al cielo y lo envuelve todo (deja de estar en su lugar: no se
// dibuja ahí, no choca, no se agarra). "bajar el cielo" (☰) la devuelve a donde estaba. Se guarda en la pose de la foto:
// cielo = cuándo se subió (en el reloj de quien lo hizo); negativo = cuándo se bajó. Vale lo último que se hizo (el
// mayor |cielo|): si es positivo, esa foto es el cielo. En la sala va en la pose (lo ven todos; no sube ni baja ninguna
// imagen nueva: la foto ya estaba). Al subir una, las otras que estaban arriba se bajan (si no, al borrar la nueva
// volvería la vieja). Sin cielo queda la atmósfera de v10.14.
let cieloW = null;
function cieloObra() {
  let best = null, bt = 0;
  for (const w of works) if (Number.isFinite(w.cielo) && Math.abs(w.cielo) > bt) { bt = Math.abs(w.cielo); best = w; }
  return best && best.cielo > 0 && !best.rota && !best.vacio ? best : null;
}
// en la sala, solo una foto que ya está en la base (si todavía sube, su pose no existe) y sin un cambio de imagen a medias
const puedeCielo = w => !!w && !w.vacio && !w.rota && !w.relleno && !w.subiendo && w !== cieloW &&
  (!sala.active || !!(sala.idsSala && sala.idsSala.has(w.id)));
function cieloGuardar(w, v) {
  w.cielo = v;
  if (sala.active) salaCielo(w);
  else store('readwrite', s => { const q = s.get(w.id); q.onsuccess = () => q.result && s.put({ ...q.result, cielo: v }); }).catch(() => {});
}
// cuándo, para el cielo: ahora, pero siempre después de lo último que se hizo (si un celu con el reloj adelantado
// subió una foto al cielo, con Date.now() lo mío quedaría "antes" y no pasaría nada)
function cieloAhora() {
  let m = 0;
  for (const w of works) if (Number.isFinite(w.cielo)) m = Math.max(m, Math.abs(w.cielo));
  return Math.max(Date.now(), m + 1);
}
function usarDeCielo() {
  if (!held || !puedeCielo(held.work) || pzEsPieza()) return;
  const w = held.work, t = cieloAhora();
  for (const o of works) if (o !== w && o.cielo > 0) cieloGuardar(o, -o.cielo);   // la que estaba arriba vuelve a su lugar
  cieloGuardar(w, t);
  releaseHold();                                         // sin ✓: si la habías movido, al bajarla vuelve a donde estaba
  cieloW = cieloObra();
  buzz(15);
  showHint((sala.active ? 'ahora es el cielo de la sala (lo ven todos)' : 'ahora es el cielo') + '<br>para bajarla: ☰ → bajar el cielo');
}
// "usar de cielo" (con una foto en la mano) y "bajar el cielo" (☰): se miran en cada cuadro, porque en la sala
// cambian solos (la foto termina de subir, otro cambia el cielo); solo se toca el DOM si cambió
let cieloBtns = '';
function cieloBotones() {
  const k = (started && held && !pjVista && puedeCielo(held.work) && !pzEsPieza() && !(held.pz && held.pz.agrupando) ? 1 : 0) + ',' + (cieloObra() ? 1 : 0);
  if (k === cieloBtns) return;
  cieloBtns = k;
  $('cieloFoto').style.display = k[0] === '1' ? '' : 'none';
  $('opcCielo').style.display = k[2] === '1' ? '' : 'none';
  modosArriba();                                         // "usar de cielo" puede pasar la edición a dos líneas
}
function bajarCielo() {
  const w = cieloObra();
  if (!w) return;
  const t = cieloAhora();
  for (const o of works) if (o !== w && o.cielo > 0) cieloGuardar(o, -o.cielo);   // si quedó otra arriba (dos a la vez), también baja
  cieloGuardar(w, -t);
  cieloW = cieloObra();
  buzz(12);
  showHint('la foto del cielo volvió a donde estaba');
  ui();
}
// cómo se envuelve: una panorámica entera (2:1) da la vuelta y va de abajo hasta arriba; una más ancha da la vuelta con
// el horizonte en el medio; una foto común se repite alrededor (espejada, para que no se vean costuras) desde un poco
// abajo del horizonte hasta bien arriba, y más arriba se funde en su color promedio
function cieloMapa(w) {
  const A = w.w / w.h;
  if (A >= 1.8 && A <= 2.2) return [1, -Math.PI / 2, Math.PI, 0];
  if (A > 2.2) { const V = 2 * Math.PI / A; return [1, -V / 2, V, 0]; }
  const V = 75 * Math.PI / 180;
  return [2 * Math.max(1, Math.round(2 * Math.PI / (V * A) / 2)), -12 * Math.PI / 180, V, 1];
}
const CIELO_BRILLO = 0.8, CIELO_NIEBLA = 0.6;   // un poco más oscuro que la foto (las del museo tienen que resaltar)
function cieloDibujar(b, w) {
  const [tx, ty] = tans(), uv = w.uv || FULL;
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
  gl.useProgram(cieloProg);
  gl.uniform3fv(CP.cr, b.r); gl.uniform3fv(CP.cu, b.u); gl.uniform3fv(CP.cf, b.f); gl.uniform2fv(CP.ct, [tx, ty]);
  gl.uniform4fv(CP.uvw, uv); gl.uniform4fv(CP.map, cieloMapa(w));
  gl.uniform3fv(CP.medio, texCol.get(w.tex) || [0.5, 0.5, 0.5]); gl.uniform3fv(CP.abajo, atm); gl.uniform1f(CP.brillo, CIELO_BRILLO);
  gl.bindTexture(gl.TEXTURE_2D, w.tex);
  gl.bindBuffer(gl.ARRAY_BUFFER, cieloBuf);
  gl.enableVertexAttribArray(CP.p); gl.vertexAttribPointer(CP.p, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.disableVertexAttribArray(CP.p);
  gl.depthMask(true);
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
  const d = rayoEn(x, y), otros = salaOcupadas();
  let best = null, bestT = Infinity;
  for (const w of works) {
    if (w === cieloW || otros.has(w.id)) continue;      // está en el cielo (se baja desde ☰) o la tiene otro (con su pieza: v10.24)
    for (const f of w.caras || [w]) {                   // una caja se agarra de cualquier cara
      const n = cross(f.r, f.u);
      const den = dot(d, n);
      if (Math.abs(den) < 1e-6) continue;
      const t = dot(sub(f.c, pos), n) / den;
      if (t <= 0 || t >= bestT) continue;
      const p = sub(add(pos, mul(d, t)), f.c);
      if (Math.abs(dot(p, f.r)) <= f.w / 2 && Math.abs(dot(p, f.u)) <= f.h / 2) { best = w; bestT = t; }
    }
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
// mientras carga (de a una) no se agarra una pieza: le faltarían las que no cargaron (v10.24)
let museoCargando = 0;
async function loadWorks() {
  museoCargando++;
  try { await loadWorksYa(); } finally { museoCargando--; }
}
async function loadWorksYa() {
  if (/[?&]borrar/.test(location.search)) {
    await store('readwrite', s => s.clear());
    history.replaceState(null, '', location.pathname);
  }
  const keys = await store('readonly', s => s.getAllKeys());
  for (const k of keys || []) {
    const o = await store('readonly', s => s.get(k));
    if (o && typeof o.id === 'string' && /~c[1-5]$/.test(o.id)) { await cargarCara(o); continue; }   // la foto de una cara (v10.21)
    if (o && o.vacio && !o.blob) { if (!sala.active) addWork(o, VACIO_IMG); continue; }
    if (!o || !o.blob) continue;
    const url = URL.createObjectURL(o.blob);
    const img = new Image(); img.src = url;
    try {
      await Promise.race([img.decode(), new Promise((_, rej) => setTimeout(() => rej(new Error('tardó')), 5000))]);
      if (!sala.active) {
        const w = addWork(o, img);
        if (o.son instanceof Blob && o.son.size) sonCopia(w, o.son);
        if (o.vid instanceof Blob && o.vid.size) vidCopia(w, o.vid, o.vi);   // su video (v10.27)
      }
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
  const o = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), ...pose, t0: Date.now() };
  if (sala.active) o.de = salaDe();
  const w = addWork(o, c);
  const subida = sala.active ? salaShoot(o, c) : null;
  if (!sala.active) c.toBlob(blob => store('readwrite', s => s.put({ ...o, blob })).catch(() => {}), 'image/jpeg', 0.85);
  // el sonido del lugar (v10.16; en la sala desde v10.17): 4 s desde que la sacaste; se pega a la foto si sigue siendo la misma imagen
  sonGrabar(o.id, sb => {
    if (!sb || !works.includes(w) || w.vacio || w.relleno || w.imgN) return;
    w.son = sb;
    if (subida) salaSonSubir(w, sb, subida);
    else store('readwrite', s => { const q = s.get(o.id); q.onsuccess = () => q.result && q.result.blob && !q.result.vacio && s.put({ ...q.result, son: sb }); }).catch(() => {});
  });
  flash.style.transition = 'none'; flash.style.opacity = 0.7;
  requestAnimationFrame(() => { flash.style.transition = 'opacity 0.35s'; flash.style.opacity = 0; });
  buzz(15);
  if (!vid.grabo) vidAvisar();                             // se puede mantener apretado: video (v10.27)
  return w;
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
  extruir: 'arrastrá para arriba: le crece profundidad para atrás (una caja) · para abajo: menos · dos dedos: tamaño · tocá una cara: qué lleva',
};
function setMode(m) {
  if (held && (pzEsPieza() || (held.pz && held.pz.agrupando)) && m !== 'mover' && m !== 'girar') m = 'mover';   // una pieza solo se mueve y se gira (v10.24)
  mode = m; extruirTxt = '';
  if (m !== 'extruir') caraSel = 0;
  pintarCaras();
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
  pintarCaras();
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
  const pieza = holding && (pzEsPieza() || !!(held.pz && held.pz.agrupando));   // con una pieza en la mano (o agrupando: v10.24) solo se mueve y se gira
  const vacio = holding && held.work.vacio && !pieza;
  // con el bloque equipado (cámara guardada), "cámara" la abre para sacarle la foto; ya abierta, "sacar foto"
  show($('llenarFoto'), vacio); show($('vaciarFoto'), holding && !held.work.vacio && !pieza);
  // repetir la textura y guardarla en tu biblioteca (v10.23)
  const conImagen = holding && !held.work.vacio && !held.work.rota && !pieza;
  show($('repetir'), conImagen); show($('aTextura'), conImagen);
  if (conImagen) repetirPintar();
  for (const m of ['recortar', 'escalar', 'extruir']) show(modesEl.querySelector('[data-m="' + m + '"]'), !pieza);
  show(resetBtn, !pieza);
  pzPintar();
  cieloBotones();
  if (vacio) $('llenarFoto').textContent = camUp ? 'sacar foto' : camOn ? 'abriendo…' : 'cámara';
  $('girarCam').classList.toggle('ocupado', camStarting);
  show(dropBtn, started && holding);
  show(trashBtn, started && holding);
  show(cancelBtn, started && holding);
  distKnob.style.top = (1 - distT(heldDist())) * 100 + '%';
  modosArriba();
}
// la fila de ajustar va justo encima de la de edición (que puede ocupar dos líneas en un celu angosto: v10.23)
// edicionArriba: hasta dónde llegan las filas de edición (las caritas de "encontrarse" no van más abajo: salaLejos)
let edicionArriba = Infinity;
function modosArriba() {
  edicionArriba = Infinity;
  if ($('edicion').style.display === 'none') return;
  const r = $('edicion').getBoundingClientRect();
  if (r.height > 0) edicionArriba = r.top;
  if (modesEl.style.display === 'none') return;
  if (r.height > 0) modesEl.style.bottom = Math.round(window.innerHeight - r.top + 6) + 'px';
  const m = modesEl.getBoundingClientRect();
  if (m.height > 0) edicionArriba = Math.min(edicionArriba, m.top);
}
window.addEventListener('resize', () => modosArriba());

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
$('repetir').addEventListener('click', repetir);
$('aTextura').addEventListener('click', () => txGuardar());
txIniciar();
$('cieloFoto').addEventListener('click', usarDeCielo);
$('opcCielo').addEventListener('click', bajarCielo);
$('opcSonido').addEventListener('click', sonAlternar);
sonPintar();
$('bloqueArchivo').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  const url = URL.createObjectURL(f), img = new Image();
  const ac = archivoCara; archivoCara = null;
  try { img.src = url; await img.decode(); if (ac && ac.held === held && held) llenarCara(img, ac.i); else if (!ac) llenarBloque(img); }
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
  pzLibCerrar(); desCerrar();   // (las hojas de abajo quedaban encima del menú)
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
  'C: cámara · B: bloque vacío · espacio: sacar foto o poner el bloque / soltar · V (mantener): video · esc: cancelar · supr: borrar · G: grilla<br>' +
  '1: mover · 2: recortar · 3: escalar · 4: girar · 5: extruir · rueda: distancia · shift+rueda: tamaño · alt+rueda: girar · H: esta ayuda';
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
      pzLibCerrar(); desCerrar();
      if (pjVista) pjCerrar();
      $('menuBtn').classList.remove('on'); fovBtn.classList.remove('on');
    }
  }
  else if (c === 'Delete' || c === 'Backspace') click(trashBtn);
  else if (c === 'KeyC' && !held) click(camOn ? unequipBtn : bloqueOn ? $('camChica') : equipBtn);
  else if (c === 'KeyB' && !held) click(bloqueOn ? $('guardarBloque') : $('bloque'));
  else if (c === 'KeyG') { if (visible($('edicion'))) grillaBtn.click(); }
  else if (c === 'KeyH') showHint(ATAJOS);
  else if (c === 'KeyV' && vidPuede()) { vid.tecla = true; vidEmpezar('tecla'); }   // mantener V: video (v10.27)
  else if (/^Digit[1-5]$/.test(c)) { const m = ['mover', 'recortar', 'escalar', 'girar', 'extruir'][+c.slice(5) - 1]; if (visible($('edicion'))) { if (m !== 'mover' && !ajustando) setAjustar(true); setMode(m); showHint(MODE_HINT[m]); } }
  if (c.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', e => { teclas.delete(e.code); if (e.code === 'KeyV' && vid.tecla) { vid.tecla = false; vidSoltar('tecla'); } });
window.addEventListener('blur', () => teclas.clear());
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (!started || !(held || (camOn && camReady) || bloqueOn)) return;
  const L = cur(), d = Math.max(-200, Math.min(200, e.deltaY || e.deltaX));
  if (e.shiftKey) { if (!(held && pzEsPieza())) scaleBy(L, Math.exp(-d * 0.002)); }
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
    if (mode === 'mover') { if (!(held && pzEsPieza())) scaleBy(L, k); if (giro) rollBy(L, -giro); }   // una pieza no cambia de tamaño
    else if (mode === 'girar') { if (giro) rollBy(L, -giro); }
    else if (mode === 'extruir') { const w0 = L.w; scaleBy(L, k); if (L.d) L.d = Math.min(D_MAX, L.d * L.w / w0); }   // la caja entera
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
  // extruir: arrastrar para arriba le da profundidad (para atrás), para abajo se la saca
  if (mode === 'extruir') { extruirBy(L, -dy * metersPerPx(len(L.c)) * 2); return; }
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
  // extruir: tocar una cara de la caja la elige (v10.20); si no tocaste la caja, sigue como siempre
  if (e.type === 'pointerup' && !t.moved && performance.now() - t.t0 < 350 && mode === 'extruir' && !pjVista && touches.size === 0
      && e.button === 0 && (held || (camOn && camReady) || bloqueOn) && tocarCara(e.clientX, e.clientY)) return;
  // agrupando (v10.24): tocar suma o saca fotos de la pieza
  if (e.type === 'pointerup' && !t.moved && performance.now() - t.t0 < 350 && held && held.pz && held.pz.agrupando && !pjVista
      && touches.size === 0 && e.button === 0) { cur(); pzTocar(e.clientX, e.clientY); return; }
  if (e.type === 'pointerup' && !t.moved && performance.now() - t.t0 < 350 && !held && !pjVista) {
    // tocar a alguien de la sala (más cerca que la foto que hay detrás) abre "ir ahí / seguir" (v10.10)
    const h = workHit(e.clientX, e.clientY), q = touches.size === 0 ? salaPersonaEn(e.clientX, e.clientY) : null;
    if (q && (!h || q.t < h.t)) salaElegir(q.id);
    else if (h) { salaDejarDeSeguir('agarraste'); pick(h.w); }
  } else if (e.type === 'pointerup' && !t.moved && performance.now() - t.t0 < 350 && held && !pjVista && mode === 'mover'
             && touches.size === 0 && e.button === 0 && !pzEsPieza() && enLoQueTenes(e.clientX, e.clientY)) {
    abrirArchivoHasta = performance.now() + 800;   // se abre con el click que sigue (Safari solo abre un input de archivo desde un click)
  }
}
let abrirArchivoHasta = 0;
canvas.addEventListener('click', () => {
  if (performance.now() > abrirArchivoHasta || !held) return;
  abrirArchivoHasta = 0; archivoCara = null;
  if (tx.lista.length) { txAbrir({ held }); return; }   // con texturas guardadas: la hoja para elegir (v10.23)
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
  // si ya llegó el aviso de lo nuevo en la sala (huellas), va debajo; si llega después, se muestra solo
  const nuevas = sala.avisoNuevas; sala.avisoNuevas = null; bienvenida = Date.now();
  showHint((TACTIL ? 'joystick para moverte · arrastrá para mirar<br>tocá una foto para agarrarla'
    : 'WASD o flechas para moverte · arrastrá con el mouse para mirar<br>clic en una foto para agarrarla · tecla H: atajos') + (nuevas ? '<br>' + nuevas : ''));
});
let bienvenida = 0;   // cuándo se mostró el cartel del arranque (lo que avise la sala antes, va con él)

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
  if (vals.every(v => v === vals[0]) && lum > 57 + (atm[0] + atm[1] + atm[2]) * 255) diagUna(`pantalla pareja rgb(${vals[0]}) · ${estadoTxt()}`);
  // ¿se ven los puntos del piso? (mirando más o menos al frente siempre tienen que verse en la mitad de abajo)
  if (started && !pjVista && basis().f[1] < 0.2) {
    const w = canvas.width, h = canvas.height, fila = new Uint8Array(w * 4);
    let claros = 0;
    for (let y = Math.floor(h * 0.05); y < h * 0.45 && !claros; y += Math.max(3, Math.floor(h / 120))) {
      gl.readPixels(0, y, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, fila);
      const [fr, fg, fb] = atm.map(x => x * 255 + 35);   // más claro que el fondo (que con la atmósfera no es negro)
      for (let i = 0; i < fila.length; i += 4) if (fila[i] > fr || fila[i + 1] > fg || fila[i + 2] > fb) { claros++; break; }
    }
    if (!claros) diagUna('no se ve el piso · ' + estadoTxt());
  }
}
function draw(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  cieloW = cieloObra();                                  // la foto que es el cielo (si hay): una vez por cuadro
  cieloBotones();
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
  } else { escena(b, dt, null); if (pzFotoPide) pzFotoHacer(); }   // la miniatura de una pieza (v10.25): recién dibujado
  desPaso(b, now);   // el desafío (v10.26): parado en la marca, cuánto se parece
  salaLejos(b);   // las caritas del borde (los de la sala que no se ven)
  sonPaso(b);     // el sonido del lugar de las fotos cercanas (v10.16)
  vidPaso();      // qué videos se mueven (v10.27)
  if (distPtr == null) distKnob.style.top = (1 - distT(heldDist())) * 100 + '%';
}

const COLOR_PREVIA = [1, 0.47, 0.31];
// las agarraderas de recortar / escalar (con el lado que se está moviendo)
const deco = () => held && held.aim ? null : modoBordes() ? { modo: mode === 'recortar' && !vacioEnMano() ? 'recortar' : 'escalar', activo: recorteActivo() }
  : mode === 'extruir' ? { modo: 'extruir', cara: caraSel } : null;
let vacioTexGL = null;
const texVacio = () => vacioTexGL || (vacioTexGL = texture(VACIO_IMG));
// en el editor de personaje, las fotos que quedan entre la cámara y el personaje no se dibujan (pedido de José: lo tapaban)
function tapaAlPersonaje(w, yo, b) {
  const pies = yo[1] - EYE;
  const puntos = [[0, yo[1] + 0.15], [0, pies + EYE * 0.6], [0, pies + 0.1], [-0.3, pies + EYE * 0.6], [0.3, pies + EYE * 0.6]]
    .map(([x, y]) => [yo[0] + b.r[0] * x, y, yo[2] + b.r[2] * x]);
  for (const f of w.caras || [w]) if (tapaPuntos(f, puntos)) return true;   // una caja: cualquiera de sus caras
  return false;
}
function tapaPuntos(w, puntos) {
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
// atmósfera (v10.14, propuesta 3 de José, parte 1): el fondo y una niebla suave toman el color de las fotos de alrededor
// (su promedio, pesado por tamaño y cercanía, con un poco más de color), así cada rincón tiene su clima y cambia al construir.
// Siempre oscuro (ningún canal pasa de ATM_MAX: las fotos tienen que resaltar). Las lejanas se funden en ese color.
const ATM_BASE = [0.04, 0.04, 0.05], ATM_MAX = 0.15, ATM_R = 6;
const NIEBLA = [12, 50, 0.85];   // empieza a 12 m, llega a 50 m, y como mucho tapa el 85%
const atm = ATM_BASE.slice();
let atmPrimera = true;
function atmosferaMeta(eye) {
  if (cieloW) { const c = texCol.get(cieloW.tex); if (c) return c.map(x => clamp(x * CIELO_BRILLO * CIELO_NIEBLA, 0, 1)); }   // con cielo: la niebla y el fondo de abajo, de su color
  const s = [0, 0, 0];
  let sw = 0;
  for (const w of works) {
    if (w.rota || w.vacio || w === cieloW) continue;
    const col = texCol.get(w.tex);
    if (!col) continue;
    const d = Math.hypot(w.c[0] - eye[0], w.c[1] - eye[1], w.c[2] - eye[2]);
    const k = Math.min(w.w * w.h, 25) / (1 + (d / ATM_R) ** 2);
    if (!(k > 0)) continue;
    s[0] += col[0] * k; s[1] += col[1] * k; s[2] += col[2] * k; sw += k;
  }
  if (!(sw > 0)) return ATM_BASE;
  const m = s.map(x => x / sw), y = 0.3 * m[0] + 0.59 * m[1] + 0.11 * m[2];
  const c = m.map(x => clamp(y + (x - y) * 1.8, 0, 1));          // un poco más de color: el promedio tira a gris
  const cob = sw / (sw + 2);                                       // una foto chica y lejos casi no tiñe
  const extra = c.map(x => x * 0.2 * cob);
  const tope = Math.max(...ATM_BASE.map((b, i) => b + extra[i]));
  const k = tope > ATM_MAX ? (ATM_MAX - Math.max(...ATM_BASE)) / Math.max(1e-6, tope - Math.max(...ATM_BASE)) : 1;
  return ATM_BASE.map((b, i) => Math.min(ATM_MAX, b + extra[i] * k));
}
function atmosfera(dt) {
  const meta = atmosferaMeta(pos);
  const a = atmPrimera ? 1 : 1 - Math.exp(-dt / 1.5);              // cambia de a poco (caminando, "ir ahí", fotos que llegan)
  atmPrimera = false;
  for (let i = 0; i < 3; i++) { atm[i] += (meta[i] - atm[i]) * a; if (!Number.isFinite(atm[i])) atm[i] = ATM_BASE[i]; }
}
function escena(b, dt, yo) {
  atmosfera(dt);
  gl.clearColor(atm[0], atm[1], atm[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (cieloW) cieloDibujar(b, cieloW);                   // el cielo, detrás de todo
  const m = matrix(b);
  pzVista = m;                                           // las de una pieza en la mano se dibujan con esta por su movimiento (v10.24)

  // obras
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  gl.useProgram(quadProg);
  gl.uniformMatrix4fv(Q.m, false, m);
  gl.uniform3fv(Q.eye, pos); gl.uniform3fv(Q.niebla, atm); gl.uniform3fv(Q.nieblaD, NIEBLA);
  const otros = salaEnManos();   // las que tiene agarradas otro se dibujan en su mano
  for (const w of works) if ((!held || (w !== held.work && !pzEnMano(w))) && w !== cieloW && !otros.has(w.id) && !(yo && tapaAlPersonaje(w, yo, b))) drawObra(w);
  if (!yo && !pzFotoPide) desDibujar();                  // las marcas del desafío en el piso (v10.26)
  salaDraw(b, dt);
  if (!yo) salaNuevasDibujar(b, dt);                     // lo nuevo desde tu última vez brilla (huellas, v10.12)
  if (yo) { salaB = b; pjDibujar('yo', pjYo(yo), b, Date.now() / 1000, rtcMiCara); }

  // en la mano (con la grilla prendida, primero las guías en su plano)
  if (yo) { /* en el editor no se muestra lo que tenés en la mano */ }
  else if (held) {
    const p = heldPose(b);
    const foto = !!pzFotoPide;                           // la miniatura de una pieza (v10.25): sin guías, borde ni fantasmas
    if (grilla && !held.aim && !foto) guiasGrilla(p, [1, 1, 1]);   // las guías, de donde va a quedar
    let tex = held.work.tex;
    if (held.work.vacio && camOn && camReady && video.readyState >= 2) {   // bloque vacío: muestra la cámara, para sacarle la foto
      gl.bindTexture(gl.TEXTURE_2D, videoTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, videoFrame());
      tex = videoTex;
    }
    drawFramed(tex === videoTex ? { ...p, uv: uvCentrado(p.h / p.w) } : p, tex, foto ? null : [1, 1, 1], foto ? null : deco(), ciMano());
    pzDibujarMano(b);                                    // las otras de la pieza (v10.24)
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
  if (held && !yo && !pzFotoPide) {
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    drawObra(held.work, 0.35);
    pzFantasmas();
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
    const ocupado = escribiendo() || ['comPanel', 'cuentaPanel'].some(id => $(id).style.display !== 'none') || comMandando || son.grabando || vid.rec || vid.espera;
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
txCargar();   // tus texturas (v10.23): aparte, no frena nada
pzLibCargar();   // tus piezas (v10.25): igual

// para los tests (grados: yaw positivo = mirar a la derecha)
window.__game = {
  pos, works, joy,
  get held() { return held; }, sala, salaYo, rtc, get camOn() { return camOn; }, get fov() { return fovDeg; }, get preview() { return preview; }, get previewBloque() { return previewBloque; }, get bloqueOn() { return bloqueOn; }, get mode() { return mode; },
  get invertLook() { return invertLook; }, get gyroOn() { return gyroOn; },
  get gyroMode() { return gyroMode; }, son, get cielo() { return cieloW; }, get camReady() { return camReady; }, get grilla() { return grilla; }, get pasoGrilla() { return pasoGrilla; }, atm, texCol, snapPose, stableGrilla,
  look(y, p) { yawOff = -y * Math.PI / 180; pitchOff = p * Math.PI / 180; },
};
