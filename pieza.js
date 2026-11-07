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
    showHint('tocá las fotos o cajas que van con esta (tocá otra vez una para sacarla) · ✓ suelta la pieza');
  } else showHint(pzEsPieza() ? 'se mueven juntas · ✓ para soltar la pieza' : 'sola: no agrupaste ninguna');
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
}
