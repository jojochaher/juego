// desafío (v10.26, propuesta 10 de José): reconstruí una imagen con fotos de lo que tenés cerca.
// ☰ → desafío: el juego te da una imagen de referencia (formas y colores simples generados acá, o en una sala una foto
// de la sala) y la armás con tus fotos. "empezar acá" deja una marca en el piso (dónde estás y para dónde mirás): parado
// en la marca, lo que entra en el cuadrado del medio de la pantalla se compara con la referencia (colores y formas en una
// versión chiquita) y arriba a la derecha sale el porcentaje; se guarda el mejor y para dónde mirabas.
// En la sala: tu desafío va en tu presencia (ds), los demás lo ven ("● propone un desafío"), se suman con la misma imagen
// cada uno con su marca, ven los porcentajes de todos y con "ir a mirar" se paran en la marca del otro.
// Es un modo aparte: no cambia nada del museo (José no quiere forzarlo a puzzle). Las referencias nunca son imágenes de
// afuera: figuras generadas o fotos de la sala. Nada en la base salvo un campo opcional de la presencia (los de antes lo ignoran).
const DES_N = 48, DES_G = 12;            // la captura (48×48 px) y la grilla que se compara (12×12, y de 4×4 para la composición)
const DES_RADIO = 0.6, DES_CADA = 400;   // a cuánto de la marca se mide, y cada cuánto (ms)
const DES_TAM = 192;                     // la imagen de referencia
const DES_GV = 'g1';                     // versión del generador (si cambia, las semillas viejas no dan la misma figura)
// colores de cosas de una casa (no muy saturados: los tenés que encontrar en tu alrededor)
const DES_PALETA = [
  ['rojo', [172, 62, 50]], ['azul', [50, 88, 158]], ['amarillo', [226, 186, 66]], ['verde', [76, 128, 64]],
  ['blanco', [226, 222, 210]], ['madera', [146, 98, 58]], ['celeste', [130, 178, 222]], ['naranja', [218, 122, 54]],
  ['rosa', [212, 132, 150]], ['gris', [124, 126, 130]], ['bordó', [112, 38, 50]], ['crema', [234, 212, 168]],
];
const DES_LUGARES = 12;                  // se recuerdan los desafíos de tu museo y de hasta 11 salas (uno por lugar)
const des = {
  acts: {},           // por lugar ('museo' o el hash de la sala): {ctx, k, t, p (la marca: tus ojos), f (para dónde), s (el mejor %)}
  get act() { return desActivo(); },                     // el del lugar donde estás
  set act(v) { desActivo(); const c = desCtx(); if (v) des.acts[c] = v; else delete des.acts[c]; },
  elegido: null,      // la referencia que estás mirando en la hoja antes de empezar
  ref: null,          // {k, url, grid, nombre} de la referencia actual
  s: null,            // el % de ahora (parado en la marca)
  enMarca: false, ultimo: 0, avisoMarca: false, guardadoT: 0, sucio: false, cargado: false,
  fb: null, marcaTex: null, avisados: new Set(), minis: new Map(),
};
const desKValida = k => typeof k === 'string' && (/^g1:\d{1,10}$/.test(k) || /^f:[A-Za-z0-9_-]{1,60}$/.test(k)) ? k : null;
const desRedondo = (v, n = 100) => Math.round(v * n) / n;
function desCtx() { return sala.active && sala.hash ? sala.hash : 'museo'; }
function desActivo() {
  if (!des.cargado) { des.cargado = true; desCargar(); }   // recién al usarlo (al cargar este archivo game.js todavía no está)
  return des.acts[desCtx()] || null;
}
// lo guardado (o lo que llega) se valida: una marca rota no puede dejar la posición en NaN
function desValido(o, ctx) {
  if (!o || typeof o !== 'object') return null;
  const k = desKValida(o.k);
  if (!k || !(typeof ctx === 'string' && ctx.length <= 64)) return null;
  const p = finito3(o.p) && o.p.every(v => Math.abs(v) < 1e5) ? o.p.slice() : null;
  let f = finito3(o.f) && len(o.f) > 0.1 ? norm(o.f) : [0, 0, -1];
  if (!p) return null;
  const s = Number.isFinite(o.s) ? clamp(Math.round(o.s), 0, 100) : 0;
  return { ctx, k, t: Number.isFinite(o.t) ? o.t : 0, p, f, s };
}
function desCargar() {
  des.acts = {};
  try {
    const o = JSON.parse(localStorage.getItem('desafio') || 'null');
    const l = !o || typeof o !== 'object' ? [] : o.k ? [o] : o.acts && typeof o.acts === 'object' ? Object.values(o.acts) : [];
    for (const x of l.slice(0, DES_LUGARES)) { const a = x && desValido(x, x.ctx); if (a) des.acts[a.ctx] = a; }
  } catch (e) {}
  for (const a of Object.values(des.acts)) des.avisados.add(a.k + '|' + a.t);   // los tuyos no se avisan
}
function desGuardar() {
  const l = Object.values(des.acts).sort((a, b) => b.t - a.t).slice(0, DES_LUGARES);
  des.acts = {}; for (const a of l) des.acts[a.ctx] = a;
  try { if (l.length) localStorage.setItem('desafio', JSON.stringify({ acts: des.acts })); else localStorage.removeItem('desafio'); } catch (e) {}
}

// ---------- la imagen de referencia ----------
function desAzar(seed) {   // mulberry32: la misma semilla da la misma figura en todos los celus
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// figuras simples: un horizonte, franjas, una puerta, cuadros, un marco, un círculo. Devuelve {c (lienzo), nombre, colores}
function desGenerar(seed) {
  const r = desAzar(seed), S = DES_TAM, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d'), usados = [];
  const color = () => { let i; do i = Math.floor(r() * DES_PALETA.length); while (usados.includes(i)); usados.push(i); return 'rgb(' + DES_PALETA[i][1].join(',') + ')'; };
  const entre = (a, b) => a + (b - a) * r();
  const rect = (col, x0, y0, w, h) => { x.fillStyle = col; x.fillRect(Math.round(x0 * S), Math.round(y0 * S), Math.round(w * S), Math.round(h * S)); };
  const circ = (col, cx, cy, rr) => { x.fillStyle = col; x.beginPath(); x.arc(cx * S, cy * S, rr * S, 0, Math.PI * 2); x.fill(); };
  const tipo = Math.floor(r() * 6);
  let nombre;
  if (tipo === 0) {                                      // horizonte (y a veces un sol)
    const y = entre(0.4, 0.65);
    rect(color(), 0, 0, 1, y); rect(color(), 0, y, 1, 1 - y);
    if (r() < 0.6) circ(color(), entre(0.25, 0.75), y * entre(0.35, 0.6), entre(0.09, 0.16));
    nombre = 'un horizonte';
  } else if (tipo === 1) {                               // franjas
    const n = 2 + Math.floor(r() * 3), vert = r() < 0.5;
    const ws = Array.from({ length: n }, () => entre(0.6, 1.4)), tot = ws.reduce((a, b) => a + b, 0);
    let p = 0;
    for (const w of ws) { const col = color(), k = w / tot; if (vert) rect(col, p, 0, k + 0.01, 1); else rect(col, 0, p, 1, k + 0.01); p += k; }
    nombre = n + ' franjas';
  } else if (tipo === 2) {                               // una puerta (o ventana) en una pared
    rect(color(), 0, 0, 1, 1);
    const w = entre(0.3, 0.5), h = entre(0.55, 0.8), x0 = entre(0.5 - w / 2 - 0.15, 0.5 - w / 2 + 0.15);
    rect(color(), x0, 1 - h, w, h);
    if (r() < 0.5) { const q = entre(0.14, 0.2), lejos = x0 > 0.5 - w / 2; rect(color(), lejos ? entre(0.06, x0 - q - 0.04) : entre(x0 + w + 0.04, 0.94 - q), entre(0.15, 0.3), q, q); }
    nombre = 'una puerta';
  } else if (tipo === 3) {                               // cuadros de 2×2
    const a = color(), b = color(), cuatro = r() < 0.5, c3 = cuatro ? color() : a, c4 = cuatro ? color() : b;
    rect(a, 0, 0, 0.5, 0.5); rect(b, 0.5, 0, 0.5, 0.5); rect(c4, 0, 0.5, 0.5, 0.5); rect(c3, 0.5, 0.5, 0.5, 0.5);
    nombre = '4 cuadros';
  } else if (tipo === 4) {                               // un marco: un rectángulo en el medio (y adentro otra cosa)
    rect(color(), 0, 0, 1, 1);
    const w = entre(0.45, 0.7), h = entre(0.45, 0.7);
    rect(color(), 0.5 - w / 2, 0.5 - h / 2, w, h);
    if (r() < 0.5) circ(color(), 0.5, 0.5, Math.min(w, h) * entre(0.22, 0.32));
    nombre = 'un marco';
  } else {                                               // un círculo grande (y a veces el piso)
    rect(color(), 0, 0, 1, 1);
    const piso = r() < 0.5, yp = entre(0.7, 0.82);
    if (piso) rect(color(), 0, yp, 1, 1 - yp);
    const rr = entre(0.22, 0.32);
    circ(color(), entre(rr + 0.05, 1 - rr - 0.05), piso ? Math.min(yp - rr * 0.6, entre(0.3, 0.55)) : entre(0.35, 0.65), rr);
    nombre = 'un círculo';
  }
  return { c, nombre, colores: usados.map(i => DES_PALETA[i][0]) };
}
// una foto de la sala como referencia: el cuadrado del medio de lo que se ve de ella (de la placa: ya está cargada)
function desFotoUv(w) {
  let [u0, v0, u1, v1] = w.rep ? FULL : (w.uv || FULL);
  const tam = texTam.get(w.tex), a = w.rep ? (tam ? tam[0] / tam[1] : 1) : w.w / w.h;
  if (!(a > 0) || !Number.isFinite(a)) return [u0, v0, u1, v1];
  if (a > 1) { const cu = (u0 + u1) / 2, hu = (u1 - u0) / 2 / a; u0 = cu - hu; u1 = cu + hu; }
  else { const cv = (v0 + v1) / 2, hv = (v1 - v0) / 2 * a; v0 = cv - hv; v1 = cv + hv; }
  return [u0, v0, u1, v1];
}
const desFotoOk = w => w && !w.vacio && !w.rota && w.tex && w !== cieloW && texTam.get(w.tex);
// para elegir: solo las que ya están en la base (no las que suben, ni con una imagen nueva sin soltar)
const desFotoElegible = w => desFotoOk(w) && !w.subiendo && !w.relleno && !(held && held.work === w);
function desFoto(id) { const w = works.find(o => o.id === id); return desFotoOk(w) ? w : null; }
// la referencia de una clave: {k, url, grid, nombre} (o null si la foto no está)
function desRefDe(k) {
  const w = k.startsWith('f:') ? desFoto(k.slice(2)) : null, iv = w ? w.tex : null;
  if (des.ref && des.ref.k === k && des.ref.iv === iv) return des.ref;   // (si le cambian la imagen a la foto, la nueva)
  let c = null, nombre = '', colores = [];
  if (k.startsWith('g1:')) ({ c, nombre, colores } = desGenerar(+k.slice(3)));
  else {
    const l = w && texLeer(w.tex, desFotoUv(w), DES_TAM);
    if (!l) return null;
    c = document.createElement('canvas'); c.width = c.height = DES_TAM;
    c.getContext('2d').drawImage(l, 0, 0, DES_TAM, DES_TAM);
    nombre = 'una foto de la sala';
  }
  const ref = { k, iv, url: c.toDataURL(k.startsWith('g1:') ? 'image/png' : 'image/jpeg', 0.85), grid: desGridDe(c), nombre, colores };
  des.ref = ref;
  return ref;
}
const desNuevaK = () => DES_GV + ':' + Math.floor(Math.random() * 2147483647);

// ---------- comparar ----------
// a "colores oponentes" (luz, rojo-verde, amarillo-azul): una distancia ahí se parece más a lo que ve el ojo que en RGB
function desGrid(px, flip) {
  const n = DES_N, G = DES_G, k = n / G, g = new Float32Array(G * G * 3);
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    let r = 0, gg = 0, b = 0;
    for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) {
      const yy = gy * k + y, fila = flip ? n - 1 - yy : yy, i = (fila * n + gx * k + x) * 4;
      r += px[i]; gg += px[i + 1]; b += px[i + 2];
    }
    const m = 255 * k * k;
    desOpp(r / m, gg / m, b / m, g, (gy * G + gx) * 3);
  }
  return g;
}
function desOpp(r, g, b, out, i) { out[i] = 0.299 * r + 0.587 * g + 0.114 * b; out[i + 1] = (r - g) * 0.7; out[i + 2] = ((r + g) / 2 - b) * 0.7; }
function desGridDe(c) {
  const t = document.createElement('canvas'); t.width = t.height = DES_N;
  const x = t.getContext('2d');
  x.imageSmoothingEnabled = true; try { x.imageSmoothingQuality = 'high'; } catch (e) {}
  x.drawImage(c, 0, 0, DES_N, DES_N);
  return desGrid(x.getImageData(0, 0, DES_N, DES_N).data, false);
}
function desGrueso(g) {                                  // de 12×12 a 4×4 (la composición: dónde va cada color)
  const G = DES_G, s = 3, C = G / s, o = new Float32Array(C * C * 3);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) for (let c = 0; c < 3; c++) o[((Math.floor(y / s) * C) + Math.floor(x / s)) * 3 + c] += g[(y * G + x) * 3 + c] / (s * s);
  return o;
}
function desDist(a, b) { let t = 0; const n = a.length / 3; for (let i = 0; i < a.length; i += 3) t += Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]); return t / n; }
function desSim(a, b) { return 0.6 * (1 - Math.min(1, desDist(a, b) / 0.4)) + 0.4 * (1 - Math.min(1, desDist(desGrueso(a), desGrueso(b)) / 0.4)); }
// 0-100: 0 = lo mismo que no tener nada (el fondo del museo), 100 = igual
// (fondo: un color, o la grilla de lo que se ve sin ninguna foto: con cielo, el cielo)
function desPuntaje(ref, cap, fondo) {
  let base = fondo;
  if (!(fondo instanceof Float32Array)) { base = new Float32Array(ref.length); for (let i = 0; i < base.length; i += 3) desOpp(fondo[0], fondo[1], fondo[2], base, i); }
  const sb = desSim(ref, base), s = desSim(ref, cap);
  const v = clamp((s - sb) / Math.max(0.05, 1 - sb), 0, 1);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
}

// ---------- la captura: lo que se ve desde acá, en chiquito y solo las fotos ----------
// (sin personajes, guías, lo que tenés en la mano, lo que tienen otros ni la foto de referencia: si no, pararse
// delante de la foto de la sala daría 100%). Se dibuja en un framebuffer aparte y se restaura todo.
function desCapturar(b, sin, vacio) {
  const N = DES_N;
  if (des.fb === false) return null;                     // no se pudo armar: no se mide
  if (!des.fb) {
    const tex = gl.createTexture(), fb = gl.createFramebuffer(), rb = gl.createRenderbuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, N, N);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { gl.deleteFramebuffer(fb); gl.deleteRenderbuffer(rb); gl.deleteTexture(tex); des.fb = false; diagUna('desafío: framebuffer incompleto'); return null; }
    des.fb = { tex, fb, rb, px: new Uint8Array(N * N * 4) };
  }
  const w0 = W, h0 = H, bl = gl.isEnabled(gl.BLEND);
  W = H = Math.min(w0, h0);                              // tans() del cuadrado del medio (el fov va sobre el lado corto)
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER, des.fb.fb);
    gl.viewport(0, 0, N, N);
    gl.disable(gl.BLEND);
    gl.clearColor(atm[0], atm[1], atm[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (cieloW) cieloDibujar(b, cieloW);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.useProgram(quadProg);
    gl.uniformMatrix4fv(Q.m, false, matrix(b));
    gl.uniform3fv(Q.eye, pos); gl.uniform3fv(Q.niebla, atm); gl.uniform3fv(Q.nieblaD, NIEBLA);
    const otros = salaEnManos();
    if (!vacio) for (const w of works) {
      if (w === cieloW || w.id === sin || otros.has(w.id) || (held && (w === held.work || pzEnMano(w)))) continue;
      drawObra(w);
    }
    gl.disableVertexAttribArray(Q.p); gl.disableVertexAttribArray(Q.uv);
    gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, des.fb.px);
    return desGrid(des.fb.px, true);                     // la fila 0 de readPixels es la de abajo
  } catch (e) { diagUna('desafío: no pude medir (' + e.message + ')'); return null; }
  finally {
    W = w0; H = h0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (bl) gl.enable(gl.BLEND);
    gl.clearColor(atm[0], atm[1], atm[2], 1);
  }
}

// ---------- la marca en el piso ----------
function desMarcaTex() {
  if (des.marcaTex) return des.marcaTex;
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.strokeStyle = '#fff'; x.fillStyle = '#fff'; x.lineWidth = 9;
  x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 8, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.moveTo(S / 2, 14); x.lineTo(S / 2 + 20, 46); x.lineTo(S / 2 - 20, 46); x.closePath(); x.fill();   // la flecha: para dónde se mira
  x.beginPath(); x.arc(S / 2, S / 2, 7, 0, Math.PI * 2); x.fill();
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);   // con alfa: el shader descarta lo transparente
  des.marcaTex = t;
  return t;
}
// las marcas: la tuya y (en la sala) las de los demás, en el color de cada uno. Se llama desde escena() con quadProg puesto.
function desMarcas() {
  const l = [], a = desActivo();
  if (a) l.push({ p: a.p, f: a.f, col: salaColor || [1, 1, 1] });
  if (sala.active) for (const p of sala.gente.values()) if (p.ds) l.push({ p: p.ds.p, f: p.ds.f, col: salaColDe(p) || [0.8, 0.8, 0.8] });
  return l;
}
function desDibujar() {
  const l = desMarcas();
  if (!l.length) return;
  const t = desMarcaTex();
  l.forEach((m, i) => {
    let fh = [m.f[0], 0, m.f[2]];
    fh = len(fh) > 0.05 ? norm(fh) : [0, 0, -1];
    const r = norm(cross(fh, [0, 1, 0])), c = [m.p[0], Math.max(0, m.p[1] - EYE) + 0.02 + i * 0.006, m.p[2]];   // (una encima de otra no titilan)
    if (len(sub(c, pos)) > 40) return;
    drawQuad(scratch, quadData(c, r, fh, 0.9, 0.9), t, m.col, 1);
  });
}

// ---------- cada cuadro ----------
const desEl = id => document.getElementById(id);
function desPaso(b, now) {
  const a = started && !pjVista ? desActivo() : null, ref = a && desRefDe(a.k);
  const thumb = desEl('desRef'), marco = desEl('desMarco');
  if (!thumb) return;
  const ver = !!(a && ref);
  if ((thumb.style.display !== 'none') !== ver) thumb.style.display = ver ? '' : 'none';
  if (ver && thumb.dataset.k !== ref.k) { thumb.dataset.k = ref.k; desEl('desRefImg').src = ref.url; }
  const enMarca = ver && !held && Math.hypot(pos[0] - a.p[0], pos[2] - a.p[2]) < DES_RADIO && Math.abs(pos[1] - a.p[1]) < 0.6;
  if (enMarca !== des.enMarca) {
    des.enMarca = enMarca; des.s = null; des.ultimo = 0;
    marco.style.display = enMarca ? '' : 'none';
    if (enMarca && !des.avisoMarca) { des.avisoMarca = true; showHint('desde la marca se mide lo que entra en el cuadrado · mirá para donde armaste la imagen'); }
  }
  if (enMarca) {
    const s = Math.min(W, H) + 'px';
    if (marco.style.width !== s) { marco.style.width = s; marco.style.height = s; }
    if (now - des.ultimo > DES_CADA) {
      des.ultimo = now;
      const cap = desCapturar(b, a.k.startsWith('f:') ? a.k.slice(2) : null);
      if (cap) {
        const fondo = cieloW ? desCapturar(b, null, true) : atm;   // con cielo, 0% es ver solo el cielo
        des.s = desPuntaje(ref.grid, cap, fondo || atm);
        if (des.s > a.s) {
          const antes = a.s;
          a.s = des.s; a.f = b.f.map(v => desRedondo(v, 1000));
          des.sucio = true;
          for (const h of [50, 75, 90]) if (antes < h && a.s >= h) { showHint(a.s >= 99 ? '¡' + a.s + '%! igual' : h >= 90 ? '¡' + a.s + '%! casi igual' : '¡' + a.s + '%!'); buzz(h >= 90 ? 60 : 25); }
        }
      }
    }
  }
  if (ver) {
    const txt = enMarca ? (des.s == null ? '…' : des.s + '%') : a.s ? a.s + '%' : '—';
    const el = desEl('desRefPct');
    if (el.textContent !== txt) el.textContent = txt;
    el.classList.toggle('vivo', enMarca);
  }
  if (des.sucio && now - des.guardadoT > 1500) { des.sucio = false; des.guardadoT = now; desGuardar(); }   // el mejor, a lo sumo cada 1,5 s
}

// ---------- sala: el desafío en la presencia ----------
function desPresencia(est) {
  const a = desActivo();
  if (!a || !sala.active) return;
  est.ds = { k: a.k, t: a.t, p: a.p.map(v => desRedondo(v)), f: a.f.map(v => desRedondo(v, 1000)), s: a.s };
}
function desLeer(id, p, d) {
  const v = d && d.ds ? desValido(d.ds, 'x') : null;
  const antes = p.ds;
  p.ds = v;
  if (desAbierta() && (!antes !== !v || (antes && v && (antes.s !== v.s || antes.k !== v.k)))) desPintarGente();   // la hoja abierta, al día
  if (!v) return;
  const a = desActivo(), clave = v.k + '|' + v.t;
  if (a && a.k === v.k && a.t === v.t) return;          // ya estás en el mismo
  if (!started || des.avisados.has(clave)) return;      // un aviso por desafío (aunque se reconecte o sean varios); los tuyos no
  des.avisados.add(clave);
  if (desAbierta()) desPintarGente();
  showHint('<span style="color:' + desCss(salaColDe(p)) + '">●</span> propone un desafío · ☰ → desafío');
}
const desCss = col => 'rgb(' + (col || [0.8, 0.8, 0.8]).map(v => Math.round(clamp(+v || 0, 0, 1) * 255)).join(',') + ')';

// ---------- la hoja ----------
function desAbierta() { const el = desEl('desHoja'); return !!el && el.style.display !== 'none'; }
function desAbrir() {
  if (!desActivo() && !des.elegido) des.elegido = desNuevaK();
  desPintar();
  desEl('desHoja').style.display = '';
}
function desCerrar() { const el = desEl('desHoja'); if (el) el.style.display = 'none'; desEl('desFotos').textContent = ''; desEl('desGente').textContent = ''; }
function desPintar() {
  const a = desActivo();
  let ref = desRefDe(a ? a.k : des.elegido);
  if (!ref && !a) { des.elegido = desNuevaK(); ref = desRefDe(des.elegido); }
  desEl('desImg').src = ref ? ref.url : '';
  desEl('desElegir').style.display = a ? 'none' : '';
  desEl('desJugando').style.display = a ? '' : 'none';
  const cols = ref && ref.colores.length ? ' (' + ref.colores.join(', ') + ')' : '';
  desEl('desTxt').textContent = !ref ? 'la foto de este desafío todavía no está en la sala'
    : a ? (a.s ? 'tu mejor: ' + a.s + '%. ' : '') + 'armala con fotos y parate en la marca: se mide lo que entra en el cuadrado del medio.'
    : 'armá ' + ref.nombre + cols + ' con fotos de cosas de tu alrededor. parate donde la vas a mirar y tocá "empezar acá": queda una marca en el piso y desde ahí se mide cuánto se parece.';
  desEl('desNota').textContent = sala.active ? 'en la sala lo ven todos' : 'en tu museo';
  // en la sala: elegir una foto de la sala (las de los demás primero)
  const fotos = desEl('desFotos');
  fotos.textContent = '';
  if (sala.active && !a) {
    const lista = works.filter(desFotoElegible).sort((x, y) => ((x.de && x.de.id === salaYo) ? 1 : 0) - ((y.de && y.de.id === salaYo) ? 1 : 0)).slice(0, 18);
    if (lista.length) {
      const t = document.createElement('div'); t.className = 'nota'; t.textContent = 'o una foto de la sala:'; fotos.appendChild(t);
      const fila = document.createElement('div'); fila.className = 'desFotosFila';
      for (const w of lista) {
        let mini = des.minis.get(w.id);
        if (!mini || mini.tex !== w.tex) {                 // una vez por foto (y si le cambian la imagen)
          const l = texLeer(w.tex, desFotoUv(w), 72);
          if (!l) continue;
          mini = { tex: w.tex, url: l.toDataURL('image/jpeg', 0.8) };
          des.minis.set(w.id, mini);
        }
        const im = document.createElement('img'); im.src = mini.url; im.alt = 'foto';
        if (des.elegido === 'f:' + w.id) im.className = 'on';
        im.addEventListener('click', () => { des.elegido = 'f:' + w.id; desPintar(); });
        fila.appendChild(im);
      }
      fotos.appendChild(fila);
    }
  }
  fotos.style.display = fotos.childNodes.length ? '' : 'none';
  desPintarGente();
}
// los demás de la sala con un desafío (los botones leen su desafío de ahora: si ya terminó, no hacen nada)
function desPintarGente() {
  const a = desActivo(), gente = desEl('desGente');
  gente.textContent = '';
  if (sala.active) for (const [id, p] of sala.gente) {
    if (!p.ds) continue;
    const mismo = a && a.k === p.ds.k && a.t === p.ds.t;
    const fila = document.createElement('div'); fila.className = 'fila';
    const n = document.createElement('span'); n.className = 'nota';
    n.innerHTML = '<span style="color:' + desCss(salaColDe(p)) + '">●</span> ' + (mismo ? (p.ds.s ? p.ds.s + '%' : 'todavía sin medir') : 'otro desafío' + (p.ds.s ? ' · ' + p.ds.s + '%' : ''));
    fila.appendChild(n);
    const ir = document.createElement('div'); ir.className = 'pill'; ir.textContent = 'ir a mirar'; ir.dataset.id = id;
    ir.addEventListener('click', () => { const q = sala.gente.get(id); if (q && q.ds) desIrA(q.ds); else { showHint('ya no está en ese desafío'); desPintarGente(); } });
    fila.appendChild(ir);
    if (!mismo) {
      const su = document.createElement('div'); su.className = 'pill'; su.textContent = a ? 'cambiarme a ese' : 'sumarme'; su.dataset.id = id;
      su.addEventListener('click', () => { const q = sala.gente.get(id); if (q && q.ds) desSumarme(q.ds); else { showHint('ya no está en ese desafío'); desPintarGente(); } });
      fila.appendChild(su);
    }
    gente.appendChild(fila);
  }
}
function desAca() { return { p: pos.map(v => desRedondo(v)), f: basis().f.map(v => desRedondo(v, 1000)) }; }
function desEmpezar(k, t) {
  if (!desKValida(k) || !desRefDe(k)) { showHint('esa foto todavía no está en la sala'); return false; }
  if (held) { showHint('primero soltá lo que tenés en la mano'); return false; }
  des.act = { ctx: desCtx(), k, t: Number.isFinite(t) ? t : Date.now(), ...desAca(), s: 0 };
  des.avisados.add(k + '|' + des.act.t);                 // (si otro se suma al tuyo, no te avisa que "propone")
  des.enMarca = false; des.s = null;
  desGuardar();
  diag('desafío: empiezo ' + k + (sala.active ? ' (sala)' : ''));
  return true;
}
function desSumarme(v) {
  if (!v || !desEmpezar(v.k, v.t)) return;
  desCerrar();
  des.avisoMarca = true;
  showHint('te sumaste: la marca quedó acá · armala delante tuyo (o andá a tu rincón y en ☰ → desafío, "la marca acá")');
}
function desIrA(v) {
  if (!v) return;
  if (held) { showHint('primero soltá lo que tenés en la mano'); return; }
  if (!finito3(v.p)) return;
  salaDejarDeSeguir('desafío');
  pos[0] = v.p[0]; pos[1] = v.p[1]; pos[2] = v.p[2]; velY = 0;
  fisica(0);
  mirarDir(v.f);
  desCerrar();
}
desEl('opcDesafio').addEventListener('click', () => desAbrir());
desEl('desRef').addEventListener('click', () => desAbrir());
desEl('desCerrar').addEventListener('click', () => desCerrar());
desEl('desOtra').addEventListener('click', () => { des.elegido = desNuevaK(); desPintar(); });
desEl('desEmpezar').addEventListener('click', () => {
  if (!desEmpezar(des.elegido)) return;
  desCerrar();
  des.avisoMarca = true;
  showHint('la marca quedó en el piso: desde ahí se mide lo que entra en el cuadrado · armá la imagen delante tuyo');
});
desEl('desMirar').addEventListener('click', () => { const a = desActivo(); if (a) desIrA(a); });
desEl('desMarcaAca').addEventListener('click', () => {
  const a = desActivo();
  if (!a) return;
  Object.assign(a, desAca(), { s: 0 });
  des.enMarca = false; des.s = null;
  desGuardar();
  desCerrar();
  showHint('la marca ahora está acá (tu mejor volvió a 0)');
});
desEl('desTerminar').addEventListener('click', () => { desActivo(); des.act = null; des.elegido = null; des.enMarca = false; desEl('desMarco').style.display = 'none'; desGuardar(); desCerrar(); showHint('desafío terminado'); });
