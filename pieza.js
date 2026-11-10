// ---------- piezas (v10.24, propuesta 9 de José, parte 1): agrupar fotos y cajas en una pieza ----------
// Con una foto en la mano, "agrupar" y tocar otras fotos o cajas: se suman a lo que tenés en la mano (quedan donde están,
// pegadas a la principal) y se mueven y giran juntas. Al soltar con ✓ todas guardan gr = la clave de la pieza; después,
// agarrar cualquiera agarra la pieza entera. "separar" las suelta donde están y les saca gr. Con una pieza en la mano solo
// se mueve y se gira (no se recorta, escala ni extruye: cambiaría la principal y no las otras); con la grilla, la
// principal se alinea sin cambiar de tamaño y las otras la siguen (si se armaron con la grilla, encajan de a paso).
// En la mano, cada otra va con ref = cómo estaba la principal cuando se sumó: su pose ahora es la transformación rígida
// que lleva ref a la principal de ahora (pzT), aplicada a su pose guardada (que no cambia hasta soltar).
// En la sala no hay datos nuevos en la presencia: los demás ven en tu mano la principal (mid) y, si tiene gr, mueven con
// ella todas las de su pieza (salaEnManos, salaManoDe). Un cliente viejo que mueve una le saca gr (sale de la pieza).
// Nada de esto corre al cargar: usa cosas de game.js (norm, held, works...).
const PZ_MAX = 80;                                         // a lo sumo tantas en una pieza (dibujo y guardado)
const grValido = g => typeof g === 'string' && /^[a-z0-9]{1,20}$/.test(g) ? g : undefined;
const pzNuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// el marco de una pose: origen c y ejes r, u, n = r × u (ortonormales)
function pzMarco(p) {
  const r = norm(p.r), u = norm(sub(p.u, mul(r, dot(p.u, r))));
  return { c: p.c, r, u, n: cross(r, u) };
}
// la transformación rígida que lleva el marco de a al de b: v → R·v + t (R = B·Aᵀ)
function pzT(a, b) {
  const A = pzMarco(a), B = pzMarco(b);
  const R = [0, 1, 2].map(i => [0, 1, 2].map(j => B.r[i] * A.r[j] + B.u[i] * A.u[j] + B.n[i] * A.n[j]));
  const rot = v => [0, 1, 2].map(i => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
  const t = sub(B.c, rot(A.c));
  return { R, rot, t, pt: v => add(rot(v), t), inv: v => { const e = sub(v, t); return [0, 1, 2].map(j => R[0][j] * e[0] + R[1][j] * e[1] + R[2][j] * e[2]); },
           invRot: v => [0, 1, 2].map(j => R[0][j] * v[0] + R[1][j] * v[1] + R[2][j] * v[2]) };
}
const pzOk = T => T.t.every(Number.isFinite) && T.R.every(f => f.every(Number.isFinite));
// la pose de una obra movida con T (solo la posición y los ejes; tamaño, recorte, caja y caras quedan)
const pzMover = (w, T) => ({ c: T.pt(w.c), r: norm(T.rot(w.r)), u: norm(T.rot(w.u)) });

// dibujar una obra (su buffer de siempre) movida con T: la matriz de la vista por la de T, y la niebla con el ojo llevado
// al revés (la distancia al ojo no cambia con un movimiento rígido)
let pzVista = null;                                        // la matriz de la vista del cuadro (la pone escena)
function pzDibujar(w, T, alpha = 1) {
  if (!pzVista || !pzOk(T)) return;
  const R = T.R, t = T.t, m = pzVista, M = [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, t[0], t[1], t[2], 1];
  const o = new Float32Array(16);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { let s = 0; for (let k = 0; k < 4; k++) s += m[k * 4 + i] * M[j * 4 + k]; o[j * 4 + i] = s; }
  gl.uniformMatrix4fv(Q.m, false, o); gl.uniform3fv(Q.eye, T.inv(pos));
  try { drawObra(w, alpha); } finally { gl.uniformMatrix4fv(Q.m, false, m); gl.uniform3fv(Q.eye, pos); }
}

// ---------- la pieza en la mano ----------
// held.pz = { gr (la clave que tenía la principal, o null), m: [{w, ref}], ids (Set de las otras), fuera (Set de las que
// se sacaron: al soltar pierden gr), agrupando (tocar suma/saca), separar }
const pzDe = h => h && h.pz;
const pzLista = () => { const p = pzDe(held); return p ? p.m.filter(e => works.includes(e.w)) : []; };   // (otro pudo borrar una)
const pzEsPieza = () => { const p = pzDe(held); return !!p && p.m.some(e => works.includes(e.w)); };
const pzEnMano = w => { const p = pzDe(held); return !!p && p.ids.has(w.id); };   // (se llama con las de works)
const pzRef = p => ({ c: p.c.slice(), r: p.r.slice(), u: p.u.slice() });
// cómo está la principal ahora (mientras gira hacia ella, donde estaba)
const pzPrincipal = b => held.aim ? held.work : heldPose(b);
// las que se pueden sumar: no la del cielo, ni rotas, ni las que tiene otro en la mano (o está sumando a la suya), ni una
// cuya imagen todavía sube (su pose sale recién al terminar: se perdería la gr)
const pzSumable = (w, otros) => !!w && w !== cieloW && !w.rota && !w.subiendo && !otros.has(w.id) && works.includes(w);

// una pieza se agarra solo entera: no mientras el museo carga o bajan fotos suyas, ni con una que sube (si no, al soltar
// las que faltan quedarían en la pieza pero en su lugar viejo)
function pzPuedeAgarrar(w) {
  const g = grValido(w.gr);
  if (!g || w.rota) return true;
  let falta = !sala.active && museoCargando > 0;
  if (sala.active) for (const [id, p] of sala.cargando) if (p && typeof p === 'object' && p.gr === g) falta = true;
  if (works.some(o => o.gr === g && o.subiendo)) falta = true;
  if (falta) showHint('esa pieza todavía está cargando: probá en un ratito');
  return !falta;
}
// al agarrar una que tiene gr: vienen todas las de su pieza
function pzAlAgarrar(w) {
  const g = grValido(w.gr);
  if (!g || w.rota) return;
  const otros = salaOcupadas();
  const m = works.filter(o => o !== w && o.gr === g && pzSumable(o, otros));
  if (!m.length) return;                                   // quedó sola: es una foto más
  held.pz = { gr: g, m: m.map(o => ({ w: o, ref: pzRef(w) })), ids: new Set(m.map(o => o.id)), fuera: new Set(), agrupando: false };
  for (const o of m) if (o.nueva) salaVista(o);           // agarradas: ya las viste (huellas)
}
function pzNueva() {
  if (!held.pz) held.pz = { gr: grValido(held.work.gr) || null, m: [], ids: new Set(), fuera: new Set(), agrupando: false };
  return held.pz;
}
// con la grilla, la principal queda fija en su tamaño alineado (con una pieza, heldPose ya no lo cambia)
function pzFijarL() {
  if (!grilla || !held || held.aim) return;
  const b = basis(), p = snapPose(worldPose(b, held.L));
  Object.assign(held.L, { c: toLocalV(b, sub(p.c, pos)), r: toLocalV(b, p.r), u: toLocalV(b, p.u), w: p.w, h: p.h, d: p.d });
  if (held.pz && held.pz.fijo) held.pz.fijo = pzRef(p);   // agrupando: queda quieta donde quedó alineada
}
// agrupando (v10.30, pedido de José): todo queda quieto en el mundo, también la principal, así te movés y vas tocando las
// partes. Cada cuadro la principal vuelve a su lugar fijo (held.L se recalcula desde ahí); al salir de agrupar, queda en
// la mano tal como está respecto de vos y te la llevás entera.
function pzQuieta(b) {
  const p = pzDe(held);
  if (!p || !p.agrupando || !p.fijo || held.aim) return;
  const f = p.fijo;
  Object.assign(held.L, { c: toLocalV(b, sub(f.c, pos)), r: toLocalV(b, f.r), u: toLocalV(b, f.u) });
}
function pzAgrupar() {
  if (!held || held.work.rota) return;
  // con una imagen nueva que todavía no soltaste (o que sube), la principal guardaría su pose después que las otras
  if (held.work.relleno || held.work.subiendo) { showHint('primero soltala con ✓ (cambiaste su imagen) y después agrupá'); return; }
  cur();
  const p = pzNueva();
  p.agrupando = !p.agrupando;
  if (p.agrupando) {
    if (mode !== 'mover' && mode !== 'girar') setMode('mover');
    if (pzEsPieza() || grilla) pzFijarL();
    p.fijo = pzRef(heldPose(basis()));                    // todo queda quieto: también la principal
    showHint('todo queda quieto: caminá y tocá las fotos o cajas que van con esta (otra vez: la sacás) · tocá "agrupando" para llevártela');
  } else {
    p.fijo = null;                                        // desde acá se mueve con vos: la pieza entera
    showHint(pzEsPieza() ? 'la tenés entera: se mueve con vos · ✓ para soltarla' : 'sola: no agrupaste ninguna');
  }
  buzz(10);
  ui();
}
function pzSeparar() {
  if (!held || !pzEsPieza()) return;
  pzNueva().separar = true;
  const n = pzLista().length + 1;
  drop();
  showHint('separadas (' + n + '): ahora se agarran de a una');
}
// un toque mientras se agrupa: una de la mano → se saca; una de afuera → se suma (con toda su pieza, si tiene)
function pzTocar(x, y) {
  pzQuieta(basis());
  const p = pzNueva(), b = basis(), main = pzPrincipal(b), d = rayoEn(x, y);
  // ¿una de la mano? el rayo, llevado a donde está guardada cada una
  let best = null, bt = Infinity;
  for (const e of pzLista()) {
    const T = pzT(e.ref, main);
    if (!pzOk(T)) continue;
    const o = T.inv(pos), dd = T.invRot(d);
    for (const f of e.w.caras || [e.w]) { const t = rayoCara(o, dd, f); if (t < bt) { bt = t; best = e.w; } }
  }
  // ¿la que agarraste? (tapa lo de atrás)
  const pm = cajaCaras(main) || [main];
  let mt = Infinity;
  for (const f of pm) mt = Math.min(mt, rayoCara(pos, d, f));
  // ¿una de afuera?
  const otros = salaOcupadas();
  let afuera = null, at = Infinity;
  for (const w of works) {
    if (w === held.work || p.ids.has(w.id) || !pzSumable(w, otros)) continue;
    for (const f of w.caras || [w]) { const t = rayoCara(pos, d, f); if (t < at) { at = t; afuera = w; } }
  }
  if (mt < bt && mt < at) { showHint('esa es la que agarraste: tocá otras para sumarlas'); return true; }
  if (best && bt <= at) {
    p.m = p.m.filter(e => e.w !== best); p.ids.delete(best.id);
    if (p.gr && best.gr === p.gr) p.fuera.add(best.id);
    showHint('la sacaste de la pieza (queda donde estaba)');
    buzz(8); ui(); return true;
  }
  if (afuera) {
    if (!pzEsPieza()) pzFijarL();
    const ref = pzRef(pzPrincipal(b));
    const g = grValido(afuera.gr);
    const suma = g ? works.filter(o => o.gr === g && o !== held.work && !p.ids.has(o.id) && pzSumable(o, otros)) : [afuera];
    if (!suma.includes(afuera)) suma.unshift(afuera);
    let n = 0;
    for (const o of suma) {
      if (p.m.length >= PZ_MAX - 1) { showHint('una pieza llega a ' + PZ_MAX); break; }
      p.m.push({ w: o, ref }); p.ids.add(o.id); p.fuera.delete(o.id); n++;
      if (o.nueva) salaVista(o);
    }
    if (mode !== 'mover' && mode !== 'girar') setMode('mover');   // con una pieza: solo mover y girar
    if (n) showHint(n > 1 ? 'sumaste ' + n + ' (era otra pieza) · ya son ' + (pzLista().length + 1) : 'sumada · ya son ' + (pzLista().length + 1));
    buzz(12); ui(); return true;
  }
  showHint('tocá una foto o caja para sumarla');
  return true;
}
// dónde el rayo (desde o, dirección d) cruza la cara f (Infinity si no)
function rayoCara(o, d, f) {
  const n = cross(f.r, f.u), den = dot(d, n);
  if (Math.abs(den) < 1e-6) return Infinity;
  const t = dot(sub(f.c, o), n) / den;
  if (t <= 0) return Infinity;
  const q = sub(add(o, mul(d, t)), f.c);
  return Math.abs(dot(q, f.r)) <= f.w / 2 && Math.abs(dot(q, f.u)) <= f.h / 2 ? t : Infinity;
}

// dibujar las otras de la pieza en la mano (y su fantasma, donde estaban)
function pzDibujarMano(b) {
  const l = pzLista();
  if (!l.length) return;
  const main = pzPrincipal(b), otros = salaEnManos();
  for (const e of l) if (!otros.has(e.w.id)) pzDibujar(e.w, pzT(e.ref, main));   // (si otro la agarró, se ve en su mano)
}
function pzFantasmas() { for (const e of pzLista()) drawObra(e.w, 0.35); }
// el contorno de cada parte (agrupando y con una pieza en la mano, v10.30): en amarillo, por encima de todo, así se ve qué
// partes van. La principal también. Sin prueba de profundidad (las de atrás se ven a través).
function pzContornos(b) {
  const p = pzDe(held);
  if (!p || held.aim || !(p.agrupando || pzEsPieza())) return;
  const main = pzPrincipal(b), poses = [main];
  for (const e of pzLista()) { const T = pzT(e.ref, main); if (pzOk(T)) poses.push({ ...e.w, ...pzMover(e.w, T) }); }
  const col = [1, 0.85, 0.2];
  const linea = (a, c, g) => {
    const dir = sub(c, a), largo = len(dir);
    if (largo < 1e-4) return;
    const mid = add(a, mul(dir, 0.5)), t = mul(dir, 1 / largo);
    const lado = cross(t, sub(mid, pos));
    if (len(lado) < 1e-6) return;
    drawQuad(scratch, quadData(mid, norm(lado), t, metersPerPx(Math.max(0.2, len(sub(mid, pos)))) * g, largo), white, col, 0.95);
  };
  const dt = gl.isEnabled(gl.DEPTH_TEST);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  try {
    for (const q of poses) for (const f of cajaCaras(q) || [q]) {
      const es = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([sx, sy]) => add(f.c, add(mul(f.r, sx * f.w / 2), mul(f.u, sy * f.h / 2))));
      for (let i = 0; i < 4; i++) linea(es[i], es[i + 1], 2.5);
    }
  } finally { gl.disable(gl.BLEND); if (dt) gl.enable(gl.DEPTH_TEST); }
}
// lo que otro tiene en la mano (sala): las otras de la pieza de su principal w, movidas como ella (de su pose guardada a pose)
function pzDibujarDeOtro(w, pose) {
  const g = grValido(w.gr);
  if (!g || w.rota) return;
  const T = pzT(w, pose);
  for (const o of works) if (o !== w && o.gr === g && o !== cieloW && !o.rota) pzDibujar(o, T);
}

// al soltar con ✓ (drop ya movió y guardó la principal w): las otras van a donde se ven, todas con la misma gr;
// las que se sacaron pierden gr. Separar: todas sin gr. guardar(o) guarda la pose de una (museo o sala)
// Devuelve la gr de la principal (o null si no hay que tocarla: agrupar sin sumar ni sacar nada)
function pzSoltar(pz, w, guardar) {
  const l = pz.m.filter(e => works.includes(e.w));
  if (!l.length && !pz.fuera.size && !pz.separar) return null;
  const g = pz.separar || !l.length ? undefined : (grValido(pz.gr) || pzNuevoId());
  for (const e of l) {
    const T = pzT(e.ref, w);
    if (!pzOk(T)) continue;
    Object.assign(e.w, pzMover(e.w, T));
    e.w.gr = g;
    setBuf(e.w);
    guardar(e.w);
  }
  for (const id of pz.fuera) {
    const o = works.find(x => x.id === id);
    if (!o || pz.ids.has(id) || o === w) continue;
    o.gr = undefined;
    guardar(o);
  }
  return { g };
}
// borrar con una pieza en la mano: se borra la pieza entera (devuelve las otras, para borrarlas igual que la principal)
const pzParaBorrar = () => pzLista().map(e => e.w);

document.getElementById('agrupar').addEventListener('click', () => pzAgrupar());
document.getElementById('separar').addEventListener('click', () => pzSeparar());
function pzPintar() {
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };
  const a = document.getElementById('agrupar'), s = document.getElementById('separar');
  const p = pzDe(held), n = pzLista().length;
  show(a, !!held && !held.work.rota && !held.work.relleno);
  show(s, n > 0 && !(p && p.agrupando));
  a.classList.toggle('on', !!(p && p.agrupando));
  a.textContent = p && p.agrupando ? 'agrupando · ' + (n + 1) : n ? 'sumar a la pieza' : 'agrupar';
  show(document.getElementById('aPieza'), pzPuedeGuardar());   // guardarla en tus piezas (v10.25)
}

// ---------- biblioteca de piezas (v10.25, propuesta 9, parte 2): guardar una pieza y ponerla las veces que quieras ----------
// Con una pieza en la mano, "guardar pieza" la guarda en este celu (sirve en tu museo y en cualquier sala) con sus imágenes
// (las lee de la placa de video, como "guardar textura": 512 px como mucho; las caras con su foto también) y una
// miniatura de cómo se veía en la mano. ☰ → "tus piezas" abre la hoja: tocar una la pone delante tuyo, en el piso, como
// la estabas mirando al guardarla (con la grilla, alineada), con todo nuevo: otras fotos, otra gr. En tu museo queda en
// la mano para acomodarla; en la sala se sube (las imágenes que se repiten en la pieza, una sola vez: como una textura
// compartida, tx) y se agarra cuando terminó de subir.
// Guardado: registros 'pz~<k>' en el IndexedDB de las obras = {id, k, t, mini: blob, obras: [{c, r, u (relativos al
// marco de la pieza: x a la derecha, y arriba desde el piso, z hacia adelante), w, h, uv, d?, cc?, rep?, vacio?,
// img (índice en imgs, -1 = ninguna), ci? (5 índices: la foto de cada cara)}], imgs: [blob JPEG]}. No tienen blob ni
// vacio: loadWorks (también el de versiones viejas) los saltea. No guarda el sonido del lugar ni el cielo.
const PZ_LIB_MAX = 30;
const pzLib = { lista: [], urls: [], quitar: false, poniendo: false, guardando: false };
let pzFotoPide = null;                                     // {esq, res}: el próximo cuadro lee la miniatura (pzFotoHacer)
const pzClave = () => (Math.random().toString(36).slice(2) + '00000000').slice(0, 8);

async function pzLibCargar() {
  try {
    const keys = await store('readonly', s => s.getAllKeys());
    const out = [];
    for (const k of keys || []) {
      if (typeof k !== 'string' || !k.startsWith('pz~')) continue;
      const o = await store('readonly', s => s.get(k));
      if (!o || !Array.isArray(o.obras) || !o.obras.length || !Array.isArray(o.imgs)) continue;
      let mini = null;
      try { if (o.mini instanceof Blob && o.mini.size) mini = new Blob([await o.mini.arrayBuffer()], { type: o.mini.type || 'image/jpeg' }); } catch (e) {}
      out.push({ id: k, t: Number.isFinite(o.t) ? o.t : 0, n: o.obras.length, mini });
    }
    out.sort((a, b) => b.t - a.t);
    pzLib.lista = [...pzLib.lista.filter(e => !out.some(x => x.id === e.id)), ...out].sort((a, b) => b.t - a.t);   // (las que guardaste mientras cargaba)
    if (out.length) diag('piezas: ' + out.length);
  } catch (e) { diag('piezas: no pude abrir la biblioteca (' + (e && e.message) + ')'); }
}

// el marco en el que se guarda y se pone una pieza: adelante = para donde mirás (horizontal; con la grilla, el eje más cercano)
function pzMarcoVista(b) {
  let f = [b.f[0], 0, b.f[2]];
  if (len(f) < 0.2) f = [b.u[0], 0, b.u[2]];
  f = norm(f);
  if (grilla) f = Math.abs(f[0]) > Math.abs(f[2]) ? [Math.sign(f[0]), 0, 0] : [0, 0, Math.sign(f[2])];
  return { f, x: cross(f, [0, 1, 0]), up: [0, 1, 0] };
}
// las 4 esquinas de cada cara de una pose (una caja: sus 6 caras)
function pzEsquinas(p) {
  const out = [];
  for (const f of cajaCaras(p, null) || [p]) for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push(add(add(f.c, mul(f.r, a * f.w / 2)), mul(f.u, c * f.h / 2)));
  return out;
}
// lo que tenés en la mano como pieza: la principal (como se ve ahora) y las otras donde se ven, con su imagen y sus caras
function pzPosesMano(b) {
  const main = heldPose(b), w = held.work;
  const l = [{ p: { c: main.c, r: main.r, u: main.u, w: main.w, h: main.h, uv: main.uv, d: main.d, cc: main.cc, rep: main.rep, vacio: !!w.vacio }, tex: w.tex, ci: ciMano() || w.ci }];
  for (const e of pzLista()) {
    const T = pzT(e.ref, main), o = e.w;
    if (!pzOk(T) || o.rota) continue;
    l.push({ p: { ...pzMover(o, T), w: o.w, h: o.h, uv: o.uv, d: o.d, cc: o.cc, rep: o.rep, vacio: !!o.vacio }, tex: o.tex, ci: o.ci });
  }
  return l;
}
const pzPuedeGuardar = () => !!held && pzEsPieza() && !(held.pz && held.pz.agrupando) && !held.work.rota && !held.work.relleno;
async function pzGuardar() {
  if (!pzPuedeGuardar() || pzLib.guardando) return;
  if (pzLib.lista.length >= PZ_LIB_MAX) { showHint('ya tenés ' + PZ_LIB_MAX + ' piezas: quitá alguna (☰ → tus piezas → quitar)'); return; }
  pzLib.guardando = true;
  try {
    cur();
    const b = basis(), l = pzPosesMano(b), M = pzMarcoVista(b);
    const esq = l.flatMap(e => pzEsquinas(e.p));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity;
    for (const q of esq) { const x = dot(q, M.x), z = dot(q, M.f); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); y0 = Math.min(y0, q[1]); }
    // el origen: el centro de abajo de lo que ocupa
    const o0 = add(add(mul(M.x, (x0 + x1) / 2), mul(M.f, (z0 + z1) / 2)), [0, y0, 0]);
    const rel = v => [dot(v, M.x), v[1], dot(v, M.f)];
    // cada imagen va una vez: la misma textura (una caja con "a todas") o la misma imagen en otra foto (bloques llenados con
    // la misma textura de la biblioteca: se comparan los pixeles), así en la sala sube una sola vez
    const imgs = [], idx = new Map(), porPixeles = new Map();
    const imgDe = tex => {
      if (!tex) return -1;
      if (idx.has(tex)) return idx.get(tex);
      const c = texLeer(tex, FULL, TEX_MAX);
      let i = -1;
      if (c) {
        const firma = pzFirma(c);
        if (porPixeles.has(firma)) i = porPixeles.get(firma);
        else { i = imgs.length; imgs.push(c); porPixeles.set(firma, i); }
      }
      idx.set(tex, i);
      return i;
    };
    const obras = l.map(e => {
      const p = e.p, m = { c: rel(sub(p.c, o0)), r: rel(p.r), u: rel(p.u), w: p.w, h: p.h, uv: (p.uv || FULL).slice() };
      if (dValida(p.d)) m.d = dValida(p.d);
      const cc = ccValida(p.cc);
      if (cc) m.cc = cc;
      if (p.vacio) m.vacio = true;
      else if (repValida(p.rep)) m.rep = repValida(p.rep);
      m.img = p.vacio ? -1 : imgDe(e.tex);
      if (m.d && cc && cc.includes('o') && e.ci) m.ci = [1, 2, 3, 4, 5].map(i => cc[i - 1] === 'o' && e.ci[i] && e.ci[i].tex ? imgDe(e.ci[i].tex) : -1);
      return m;
    });
    const foto = await pzFoto(esq);
    const blobs = await Promise.all(imgs.map(c => txBlob(c, 0.85)));
    if (blobs.some(x => !x)) { showHint('no pude guardar la pieza'); diag('piezas: toBlob falló'); return; }
    const mini = (foto && await txBlob(foto, 0.8)) || (imgs[0] && await txBlob(txMini(imgs[0]), 0.8)) || null;
    const k = pzClave(), t = Date.now(), id = 'pz~' + k;
    try { await store('readwrite', s => s.put({ id, k, t, mini, obras, imgs: blobs })); }
    catch (err) { showHint('no pude guardar la pieza'); diag('piezas: no pude guardar (' + (err && err.message) + ')'); return; }
    pzLib.lista.unshift({ id, t, n: obras.length, mini });
    buzz(15);
    showHint('guardada en tus piezas (' + pzLib.lista.length + ') · ☰ → tus piezas para ponerla otra vez');
  } finally { pzLib.guardando = false; }
}
// tamaño + un hash (FNV-1a) de todos los pixeles: dos imágenes iguales dan lo mismo
function pzFirma(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); }
  return c.width + 'x' + c.height + ':' + (h >>> 0);
}
// la miniatura: lo que se ve de la pieza en la pantalla, en el próximo cuadro (sin las guías ni el borde de la mano)
function pzFoto(esq) {
  return new Promise(res => {
    pzFotoPide = { esq, res };
    setTimeout(() => { if (pzFotoPide && pzFotoPide.res === res) { pzFotoPide = null; res(null); } }, 1500);
  });
}
function pzFotoHacer() {
  const q = pzFotoPide;
  pzFotoPide = null;
  let out = null;
  try {
    const m = pzVista, W = canvas.width, H = canvas.height;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, atras = !m;
    for (const v of atras ? [] : q.esq) {
      const cl = [0, 1, 2, 3].map(i => m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i]);
      if (!(cl[3] > 1e-3)) { atras = true; break; }
      const x = (cl[0] / cl[3] + 1) / 2 * W, y = (cl[1] / cl[3] + 1) / 2 * H;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (atras || !(x1 - x0 > 4) || !(y1 - y0 > 4)) { const s = Math.min(W, H) * 0.7; x0 = (W - s) / 2; x1 = x0 + s; y0 = (H - s) / 2; y1 = y0 + s; }
    const mx = (x1 - x0) * 0.06 + 2, my = (y1 - y0) * 0.06 + 2;
    x0 = Math.max(0, Math.floor(x0 - mx)); y0 = Math.max(0, Math.floor(y0 - my));
    x1 = Math.min(W, Math.ceil(x1 + mx)); y1 = Math.min(H, Math.ceil(y1 + my));
    const cw = x1 - x0, ch = y1 - y0;
    if (cw >= 8 && ch >= 8) {
      const px = new Uint8Array(cw * ch * 4);
      gl.readPixels(x0, y0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const x = c.getContext('2d'), im = x.createImageData(cw, ch);
      for (let j = 0; j < ch; j++) im.data.set(px.subarray((ch - 1 - j) * cw * 4, (ch - j) * cw * 4), j * cw * 4);   // la fila 0 de la placa es la de abajo
      for (let i = 3; i < im.data.length; i += 4) im.data[i] = 255;
      x.putImageData(im, 0, 0);
      out = txMini(c);
    }
  } catch (e) { diag('piezas: no pude sacar la miniatura (' + e.message + ')'); }
  q.res(out);
}

// lo guardado, validado (si algo está roto, esa foto no va; si no queda nada, null)
function pzLeer(o) {
  if (!o || !Array.isArray(o.obras) || !Array.isArray(o.imgs)) return null;
  const imgs = o.imgs.map(x => x instanceof Blob && x.size ? x : null);
  const idxOk = i => Number.isInteger(i) && i >= 0 && i < imgs.length && imgs[i] ? i : -1;
  const obras = [];
  for (const m of o.obras.slice(0, PZ_MAX)) {
    if (!m || typeof m !== 'object' || poseRota(m) || !(m.w <= 100 && m.h <= 100)) continue;
    const uv = Array.isArray(m.uv) && m.uv.length === 4 && m.uv.every(Number.isFinite) ? m.uv.slice() : FULL.slice();
    const p = { c: m.c.slice(), r: norm(m.r), u: norm(m.u), w: m.w, h: m.h, uv, d: dValida(m.d), cc: ccValida(m.cc), vacio: !!m.vacio, img: idxOk(m.img) };
    if (!p.vacio && p.img < 0) { p.vacio = true; p.uv = FULL.slice(); }   // sin su imagen: queda un bloque vacío
    if (!p.vacio) p.rep = repValida(m.rep);
    if (p.d && Array.isArray(m.ci) && m.ci.length === 5) p.ci = m.ci.map(idxOk);
    obras.push(p);
  }
  return obras.length ? { obras, imgs } : null;
}
// una copia en memoria de la imagen (un blob de IndexedDB leído tarde falla en WebKit) y abierta
async function pzAbrirImg(blob) {
  if (!blob) return null;
  let url = null;
  try {
    const copia = new Blob([await blob.arrayBuffer()], { type: blob.type || 'image/jpeg' });
    url = URL.createObjectURL(copia);
    const img = new Image(); img.src = url;
    await Promise.race([img.decode(), new Promise((_, rej) => setTimeout(() => rej(new Error('tardó')), 5000))]);
    const c = copiaCara(img, 1024);                        // un lienzo: sirve para la textura, la sala y las caras
    img.src = '';
    return { c, blob: copia, a: c.height / c.width };
  } catch (e) { diag('piezas: no pude abrir una imagen (' + (e && e.message) + ')'); return null; }
  finally { if (url) URL.revokeObjectURL(url); }
}
// poner una pieza de la biblioteca delante tuyo
async function pzPoner(e) {
  if (!started || pzLib.poniendo) return;
  if (held) { showHint('primero soltá lo que tenés en la mano'); return; }
  pzLib.poniendo = true;
  const enSala = sala.active, hash = sala.hash;
  try {
    let o = null;
    try { o = await store('readonly', s => s.get(e.id)); } catch (err) {}
    const P = pzLeer(o);
    if (!P) { showHint('no pude abrir esa pieza'); diag('piezas: rota ' + e.id); return; }
    const usadas = new Set();
    for (const m of P.obras) { if (m.img >= 0) usadas.add(m.img); for (const j of m.ci || []) if (j >= 0) usadas.add(j); }
    const imgs = [];
    for (let j = 0; j < P.imgs.length; j++) imgs[j] = usadas.has(j) ? await pzAbrirImg(P.imgs[j]) : null;
    if (sala.active !== enSala || sala.hash !== hash) return;   // mientras tanto entraste o saliste de una sala
    if (held) { showHint('primero soltá lo que tenés en la mano'); return; }
    // dónde: delante tuyo, en el piso donde estás, a una distancia en la que entra entera
    const b = basis(), M = pzMarcoVista(b);
    let rad = 0, alto = 0;
    for (const m of P.obras) for (const q of pzEsquinas(m)) { rad = Math.max(rad, Math.hypot(q[0], q[2])); alto = Math.max(alto, q[1]); }
    // (una alta, más lejos: que se vea entera)
    const D = clamp(Math.max(rad + 1.2, alto * 1.2), 1.5, 30), o0 = [pos[0] + M.f[0] * D, pos[1] - EYE, pos[2] + M.f[2] * D];
    const W = v => add(add(mul(M.x, v[0]), mul(M.up, v[1])), mul(M.f, v[2]));
    let poses = P.obras.map(m => ({ ...m, c: add(o0, W(m.c)), r: norm(W(m.r)), u: norm(W(m.u)) }));
    if (grilla) {                                          // la principal en la grilla, sin cambiar de tamaño; las otras la siguen
      const T = pzT(poses[0], snapPose(poses[0], pasoGrilla, true));
      if (pzOk(T)) poses = poses.map(p => ({ ...p, ...pzMover(p, T) }));
    }
    if (poses.some(p => poseRota(p))) { showHint('no pude poner esa pieza'); return; }
    // en la sala, una imagen que usan varias de la pieza sube una sola vez (textura compartida, como la biblioteca de texturas)
    const usos = new Map();
    for (const p of poses) if (!p.vacio && imgs[p.img]) usos.set(p.img, (usos.get(p.img) || 0) + 1);
    const txDe = new Map([...usos].filter(([, n]) => n > 1).map(([j]) => [j, pzClave()]));
    const gr = poses.length > 1 ? pzNuevoId() : undefined, t0 = Date.now(), creadas = [];
    poses.forEach((p, i) => {
      const im = p.vacio ? null : imgs[p.img];
      const o = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6) + i, c: p.c, r: p.r, u: p.u, w: p.w, h: p.h, uv: im ? p.uv : FULL.slice(), t0 };
      if (gr) o.gr = gr;
      if (p.d) o.d = p.d;
      if (p.cc) o.cc = p.cc;
      if (!im) o.vacio = true;
      else if (p.rep) o.rep = p.rep;
      if (enSala) { o.de = salaDe(); if (im && txDe.has(p.img)) { o.tx = txDe.get(p.img); o.iv = t0; } }   // (iv: salaTxDeViejo)
      const w = addWork(o, im ? im.c : VACIO_IMG);
      // las caras con su foto (las de la misma imagen comparten la textura, como "a todas")
      const caras = new Map(), cc = (ccValida(w.cc) || 'mmmmm').split('');
      let ci = null;
      for (let k = 1; k <= 5; k++) {
        const j = p.ci ? p.ci[k - 1] : -1;
        if (cc[k - 1] !== 'o') continue;
        if (!(j >= 0) || !imgs[j]) { cc[k - 1] = 'm'; continue; }   // sin su imagen: la misma
        let ce = caras.get(j);
        if (!ce) { const s = imgs[j]; ce = { tex: texture(small(s.c)), a: s.a, g: pzClave() }; if (enSala) ce.c = s.c; else ce.blob = s.blob; caras.set(j, ce); }
        (ci = ci || [])[k] = ce;
      }
      w.cc = ccValida(cc.join('')); w.ci = ci || undefined;
      setBuf(w);
      creadas.push({ w, o, im });
    });
    if (enSala) pzSubir(creadas, hash);
    else {
      for (const { w, o, im } of creadas) {
        const rec = { ...o, cc: ccGuardar(w.cc), co: coDe(w.cc), blob: im ? im.blob : null };
        store('readwrite', s => s.put(rec)).then(() => { if (w.ci) for (let k = 1; k <= 5; k++) if (w.ci[k]) guardarCara(w, k, w.ci[k]); }).catch(() => {});
      }
    }
    buzz(15);
    if (!enSala) {                                         // en tu museo queda en la mano, para acomodarla
      pick(creadas[0].w);
      showHint(held ? 'pusiste la pieza (' + creadas.length + ') · acomodala y soltala con ✓' : 'pusiste la pieza (' + creadas.length + ') · agarrala cuando termine de cargar tu museo');
    }
  } finally { pzLib.poniendo = false; }
}
// en la sala: cada una sube su imagen (o su pose vacía) y después sus caras; las imágenes compartidas, la primera vez.
// De a una, cediendo el hilo (una pieza grande no traba el celu); todas quedan "subiendo" desde el principio: tu celu no
// la deja agarrar a medias
async function pzSubir(creadas, hash) {
  const primera = new Map(), todas = [];
  let listas = 0, fallas = 0;
  const sigue = () => sala.active && sala.hash === hash;
  showHint('subiendo la pieza a la sala (0/' + creadas.length + ')…');
  for (const { w } of creadas) w.subiendo = true;
  for (const { w, o, im } of creadas) {
    if (todas.length) await new Promise(r => setTimeout(r, 0));
    let p;
    if (!im) {
      const n = w.subidaN = (w.subidaN || 0) + 1;
      p = salaEnCola(w, () => {
        if (w.subidaN !== n) return;
        w.subiendo = false;                                // antes del PUT: el eco de su pose tiene que encontrarla como un bloque vacío más
        if (!sigue() || !works.includes(w)) return;
        return salaApi('poses/' + w.id, 'PUT', soloPose(w));
      });
    } else {
      const k = w.tx;
      if (k && primera.has(k)) salaEnCola(w, () => primera.get(k).catch(() => {}));   // espera a que la primera la suba
      p = salaShoot({ ...o, id: w.id }, im.c, w);
      if (k && !primera.has(k)) primera.set(k, p);
    }
    if (w.ci) salaCarasSubir(w, undefined);                // en la misma cola: después de la pose (y ya protege sus caras del eco)
    todas.push(p.then(() => {}, () => {
      fallas++;
      // la pose no quedó en la base: las fotos de sus caras que hayan subido no pueden quedar sueltas
      const gs = [...new Set((w.ci || []).filter(Boolean).map(e => e.g))];
      if (gs.length) (w.colaImg || Promise.resolve()).then(() => Promise.all(gs.map(g => fetch(salaUrlDe(hash, salaCaraUrl(w, g)), { method: 'DELETE' }).catch(() => {}))));
    }).then(() => { listas++; if (sigue() && listas < creadas.length) showHint('subiendo la pieza a la sala (' + listas + '/' + creadas.length + ')…'); }));
  }
  await Promise.all(todas);
  if (!sigue()) return;
  if (fallas) showHint('no se pudo subir toda la pieza a la sala (' + fallas + ' de ' + creadas.length + ' quedaron solo en tu celu)');
  else showHint('la pieza ya está en la sala (' + creadas.length + ') · agarrala para moverla');
}

// la hoja "tus piezas" (☰)
function pzLibAbrir() {
  pzLib.quitar = false;
  pzLibPintar();
  $('pzHoja').style.display = '';
}
function pzLibCerrar() {
  const el = $('pzHoja');
  if (!el || el.style.display === 'none') return;
  el.style.display = 'none';
  pzLib.quitar = false;
  $('pzLista').textContent = '';
  for (const u of pzLib.urls) URL.revokeObjectURL(u);
  pzLib.urls = [];
}
function pzLibPintar() {
  const lista = $('pzLista');
  lista.textContent = '';
  for (const u of pzLib.urls) URL.revokeObjectURL(u);
  pzLib.urls = [];
  for (const e of pzLib.lista) {
    const d = document.createElement('div'), im = document.createElement('img'), n = document.createElement('span');
    d.className = 'pz'; d.dataset.id = e.id;
    if (e.mini) { const u = URL.createObjectURL(e.mini); pzLib.urls.push(u); im.src = u; }
    im.alt = 'pieza';
    n.textContent = e.n;
    d.append(im, n);
    d.addEventListener('click', () => pzLibElegir(e));
    lista.appendChild(d);
  }
  $('pzHoja').classList.toggle('quitando', pzLib.quitar);
  $('pzQuitar').classList.toggle('on', pzLib.quitar);
  $('pzQuitar').style.display = pzLib.lista.length ? '' : 'none';
  $('pzNota').textContent = pzLib.quitar ? 'tocá las que quieras sacar' : pzLib.lista.length ? 'tocá una para ponerla delante tuyo'
    : 'todavía no guardaste ninguna: agarrá una pieza y tocá "guardar pieza"';
}
function pzLibElegir(e) {
  if (pzLib.quitar) {
    pzLib.lista = pzLib.lista.filter(x => x !== e);
    store('readwrite', s => s.delete(e.id)).catch(() => {});
    buzz(10);
    pzLibPintar();
    return;
  }
  if (held) { showHint('primero soltá lo que tenés en la mano'); return; }
  pzLibCerrar();
  pzPoner(e).catch(err => { showHint('no pude poner esa pieza'); diag('piezas: no pude poner una (' + (err && err.message) + ')'); });
}
document.getElementById('aPieza').addEventListener('click', () => pzGuardar().catch(err => { showHint('no pude guardar la pieza'); diag('piezas: no pude guardar (' + (err && err.message) + ')'); }));
document.getElementById('opcPiezas').addEventListener('click', () => pzLibAbrir());
document.getElementById('pzCerrar').addEventListener('click', () => pzLibCerrar());
document.getElementById('pzQuitar').addEventListener('click', () => { pzLib.quitar = !pzLib.quitar; pzLibPintar(); });
