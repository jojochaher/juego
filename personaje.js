// juego — personajes: cómo se dibujan y el editor (con vista en tercera persona)
// Cuerpo: "con torso" (palito) o "sin torso" (la cabeza es el cuerpo: brazos y piernas salen de ahí).
// Cabeza: esfera (un círculo que siempre te mira, como un recorte) o cubo (caja 3D que gira con la mirada).
// Forma: ancha ↔ alta. Color: el de tu personaje (también el marco de lo que tenés en la mano).
// Se carga ANTES que game.js: acá solo se definen funciones (y se enganchan los botones).

let pj = { cuerpo: 'torso', cabeza: 'esfera', forma: 1 };
try {
  const g = JSON.parse(localStorage.getItem('pj') || 'null');
  if (g) pj = { ...pj, ...g };
  else if (localStorage.getItem('modelo') === 'caja') pj = { cuerpo: 'sin', cabeza: 'cubo', forma: +localStorage.getItem('forma') || 1 };
} catch (e) {}
function pjGuardar() { try { localStorage.setItem('pj', JSON.stringify(pj)); } catch (e) {} }

// lo que viaja en la presencia (sin nada = palito de siempre)
function pjPresencia(est) {
  if (pj.cuerpo === 'sin') est.cu = 1;
  if (pj.cabeza === 'cubo') est.ca = 1;
  if (pj.forma !== 1) est.fa = Math.round(pj.forma * 100) / 100;
}
function pjLeer(p, d) {
  p.cu = d.cu === 1 || d.mod === 1;            // mod: 1 = la "caja" de la v8
  p.ca = d.ca === 1 || d.mod === 1;
  p.fa = Math.min(2, Math.max(0.5, +d.fa || 1));
}

// medidas de la cabeza
function pjCabeza(p, conCara) {
  const S = p.cu ? 0.6 : p.ca ? 0.3 : conCara ? 0.36 : 0.26;
  return { W: S / Math.sqrt(p.fa), H: S * Math.sqrt(p.fa), D: p.cu ? 0.32 : S * 0.85 };
}
function pjElipse(c, w, h, col, b, tex) { drawQuad(scratch, quadData(c, b.r, b.u, w, h), tex || salaDisco(), col); }

// dibuja a una persona. cara(aspect, redonda) da la textura de su cara (o null). Devuelve dónde está su boca.
function pjDibujar(id, p, b, tt, cara) {
  const col = p.col, w = p.walk, shade = f => col.map(v => v * f), dark = shade(0.3);
  const down = [0, -1, 0];
  const yaw = p.disp.yaw;
  const look = [-Math.sin(yaw) * Math.cos(p.disp.pitch), Math.sin(p.disp.pitch), -Math.cos(yaw) * Math.cos(p.disp.pitch)];
  const lookRight = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const fwd = dirYaw(p.body), right = [Math.cos(p.body), 0, -Math.sin(p.body)];
  const swing = a => norm(add(mul(down, Math.cos(a)), mul(fwd, Math.sin(a))));
  const bob = Math.sin(tt * 1.8 + id.length) * 0.008 + Math.abs(Math.sin(p.phase)) * 0.035 * w;
  const E = [p.disp.p[0], p.disp.p[1] + bob - 0.03 * w, p.disp.p[2]];
  const piso = p.disp.p[1] - EYE;
  const mira = dot(look, sub(pos, E)) > 0;

  // ---- cabeza ----
  // la caja gira con la mirada y se inclina un poco; la esfera es un recorte que siempre te da la cara
  const bp = p.disp.pitch * (p.cu ? 0.35 : 0.6);
  const fB = [-Math.sin(yaw) * Math.cos(bp), Math.sin(bp), -Math.cos(yaw) * Math.cos(bp)];
  const rB = lookRight, uB = cross(rB, fB);
  let tex = null;
  if (p.ca) tex = cara(pjCabeza(p, true).H / pjCabeza(p, true).W, false);
  else if (mira) { const m = pjCabeza(p, true); tex = cara(m.H / m.W, true); }
  const { W, H, D } = pjCabeza(p, !!tex);
  const C = p.cu ? add(E, mul(uB, 0.16 - H / 2)) : E;      // sin torso: los ojos quedan cerca de arriba
  if (p.ca) {
    drawQuad(scratch, quadData(sub(C, mul(fB, D / 2)), rB, uB, W, H), white, shade(0.55));   // atrás
    drawQuad(scratch, quadData(add(C, mul(rB, W / 2)), fB, uB, D, H), white, shade(0.72));   // costados
    drawQuad(scratch, quadData(sub(C, mul(rB, W / 2)), fB, uB, D, H), white, shade(0.72));
    drawQuad(scratch, quadData(add(C, mul(uB, H / 2)), rB, fB, W, D), white, shade(0.9));    // arriba
    drawQuad(scratch, quadData(sub(C, mul(uB, H / 2)), rB, fB, W, D), white, shade(0.45));   // abajo
    const frente = add(C, mul(fB, D / 2 + 0.002)), izq = mul(rB, -1);    // visto de frente, su derecha es tu izquierda
    drawQuad(scratch, quadData(frente, izq, uB, W, H), white, col);
    if (tex) {
      const borde = Math.min(W, H) * 0.06;
      drawQuad(scratch, quadData(add(frente, mul(fB, 0.002)), izq, uB, W - 2 * borde, H - 2 * borde), tex, p.cam ? [0.5, 0.5, 0.5] : [1, 1, 1]);
    } else {
      const ojos = add(add(frente, mul(fB, 0.002)), mul(uB, p.cu ? H / 2 - 0.16 : H * 0.12));
      const ow = Math.max(0.035, W * 0.12);
      for (const s of [1, -1]) drawQuad(scratch, quadData(add(ojos, mul(rB, W * 0.2 * s)), izq, uB, ow, ow), salaDisco(), dark);
    }
  } else {
    if (tex) {
      const anillo = Math.min(W, H) * 0.08;
      pjElipse(add(C, mul(norm(sub(C, pos)), 0.01)), W + anillo, H + anillo, col, b);      // aro de su color, apenas detrás
      pjElipse(C, W, H, p.cam ? [0.5, 0.5, 0.5] : [1, 1, 1], b, tex);
    } else {
      pjElipse(C, W, H, col, b);
      if (mira) {
        // ojos pegados al círculo (en el plano de la pantalla), corridos hacia donde mira
        const hacia = norm(sub(pos, C)), lx = dot(look, b.r), ly = dot(look, b.u);
        const ojos = add(add(add(C, mul(hacia, 0.01)), mul(b.r, lx * W * 0.28)), mul(b.u, (p.cu ? H / 2 - 0.16 - (H / 2 - 0.16) * 0.3 : H * 0.08) + ly * H * 0.2));
        const sep = W * 0.17 * Math.max(0.3, Math.abs(dot(lookRight, b.r))), ro = Math.max(0.022, W * 0.06);
        for (const s of [1, -1]) salaBola(add(ojos, mul(b.r, sep * s)), ro, dark, b);
      }
    }
  }

  // ---- cuerpo ----
  let hipBase, hipAncho, hombros, hombroAncho;
  if (p.cu) {
    hipBase = sub(C, mul(uB, H / 2 - 0.02)); hipAncho = Math.min(0.12, W / 2 - 0.05);
    hombros = add(C, mul(uB, -0.02)); hombroAncho = W / 2;
  } else {
    const neck = add(E, [0, -(H / 2 + 0.04), 0]);
    const pelvis = add(E, [0, -0.7, 0]);
    salaPalo(neck, pelvis, col);                                            // torso
    salaPalo(add(pelvis, mul(right, -0.09)), add(pelvis, mul(right, 0.09)), col);
    salaPalo(add(neck, mul(right, -0.17)), add(neck, mul(right, 0.17)), col);
    salaJunta(neck, col); salaJunta(pelvis, col);
    hipBase = pelvis; hipAncho = 0.09; hombros = neck; hombroAncho = 0.17;
  }
  // piernas: dos tramos hasta el piso, la rodilla se dobla al levantar el pie
  for (const s of [1, -1]) {
    const hip = add(hipBase, mul(right, hipAncho * s));
    const L = Math.max(0.2, (hip[1] - piso) / 2);
    const a = Math.sin(p.phase) * 0.55 * w * s;
    const knee = add(hip, mul(swing(a), L));
    const bend = Math.max(0, Math.sin(p.phase + (s > 0 ? 0 : Math.PI))) * 0.7 * w;
    const foot = add(knee, mul(swing(a - bend), L));
    salaPalo(hip, knee, col); salaPalo(knee, foot, col);
    salaJunta(hip, col); salaJunta(knee, col); salaJunta(foot, col);
  }
  // brazos: se balancean al caminar; con la cámara equipada, el derecho la sostiene adelante
  const rH = p.cu ? rB : right;
  for (const s of [1, -1]) {
    const sh = add(hombros, mul(rH, hombroAncho * s));
    const a = -Math.sin(p.phase) * 0.45 * w * s + Math.sin(tt * 1.3 + s) * 0.04;
    let elbow = add(add(sh, mul(swing(a), 0.3)), mul(rH, 0.04 * s));
    let hand = add(elbow, mul(swing(a + 0.25 * (1 - w)), 0.28));
    if (s > 0 && p.raise > 0.01) {
      const ade = p.cu ? D / 2 : 0;
      const hold = add(add(E, mul(look, 0.42 + ade)), mul(lookRight, 0.08));
      const holdElbow = add(add(sh, mul(look, 0.2 + ade / 2)), [0, -0.12, 0]);
      elbow = add(mul(elbow, 1 - p.raise), mul(holdElbow, p.raise));
      hand = add(mul(hand, 1 - p.raise), mul(hold, p.raise));
    }
    salaPalo(sh, elbow, col); salaPalo(elbow, hand, col);
    salaJunta(sh, col); salaJunta(elbow, col); salaJunta(hand, col);
    if (s > 0 && p.raise > 0.5) drawQuad(scratch, quadData(add(hand, mul(look, 0.02)), lookRight, norm(cross(lookRight, look)), 0.13, 0.09), white, dark);
  }
  return E;
}

// ---------- editor: panel abajo, arriba te ves en tercera persona ----------
const pjPanel = document.getElementById('personajePanel');
const PJ_COLORES = ['#ff5d5d', '#ff9f43', '#ffd93d', '#9be15d', '#3ddc97', '#36cfc9', '#4dabf7', '#7c6cff', '#c06cff', '#ff6fb5', '#f5f5f5', '#8a8f99'];
let pjVista = null;   // { ang, yaw0 } mientras el editor está abierto
const hexA = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
function pjAbrir() {
  document.getElementById('salaPanel').style.display = 'none';
  pjPanel.style.display = '';
  pjVista = { ang: 0.5, yaw0: heading(basis().f) };
  document.getElementById('hint').style.opacity = 0;
  pjPintar();
  if (typeof ui === 'function') ui();
}
function pjCerrar() { pjPanel.style.display = 'none'; pjVista = null; if (voz.escucharme) vozEscucharme(false); if (typeof ui === 'function') ui(); }
function pjPintar() {
  for (const el of pjPanel.querySelectorAll('[data-cuerpo]')) el.classList.toggle('on', el.dataset.cuerpo === pj.cuerpo);
  for (const el of pjPanel.querySelectorAll('[data-cabeza]')) el.classList.toggle('on', el.dataset.cabeza === pj.cabeza);
  document.getElementById('pjForma').value = Math.log2(pj.forma);
  const actual = '#' + salaColor.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  for (const el of pjPanel.querySelectorAll('.color')) el.classList.toggle('on', el.dataset.c === actual);
}
(() => {
  const cont = document.getElementById('pjColores');
  for (const c of PJ_COLORES) {
    const el = document.createElement('div'); el.className = 'color'; el.dataset.c = c; el.style.background = c;
    el.addEventListener('click', () => { salaColor = hexA(c); try { localStorage.setItem('color', JSON.stringify(salaColor)); } catch (e) {} pjPintar(); });
    cont.append(el);
  }
  for (const el of pjPanel.querySelectorAll('[data-cuerpo]')) el.addEventListener('click', () => { pj.cuerpo = el.dataset.cuerpo; pjGuardar(); pjPintar(); });
  for (const el of pjPanel.querySelectorAll('[data-cabeza]')) el.addEventListener('click', () => { pj.cabeza = el.dataset.cabeza; pjGuardar(); pjPintar(); });
  document.getElementById('pjForma').addEventListener('input', e => { pj.forma = Math.min(2, Math.max(0.5, Math.pow(2, +e.target.value))); pjGuardar(); });
  document.getElementById('pjListo').addEventListener('click', pjCerrar);
  for (const el of document.querySelectorAll('.abrirPersonaje')) el.addEventListener('click', pjAbrir);
})();

// la cámara de la vista en tercera persona: te mira de frente (arrastrando, gira alrededor tuyo).
// Con un campo de visión fijo (PJ_FOV, no el tuyo) y a la distancia justa para que el personaje ocupe
// casi todo el lugar libre arriba del panel, centrado ahí.
const PJ_FOV = 40 * Math.PI / 180;
function pjCamara() {
  const yaw = pjVista.yaw0 + pjVista.ang;
  const ty = tans()[1];
  const alto = innerHeight || 1;
  const arriba = pjPanel.style.display === 'none' ? alto : pjPanel.getBoundingClientRect().top;
  // el lugar libre va de abajo de los botones de arriba (sala, mic, ☰) hasta el panel: si no, la cabeza queda pegada a los botones
  const mb = document.getElementById('menuBtn'), techo = mb && mb.offsetParent !== undefined ? Math.max(0, mb.getBoundingClientRect().bottom + 12) : 0;
  const libre = Math.max(alto * 0.3, arriba - techo);
  const frac = Math.min(1, libre / alto);                      // parte de la pantalla que queda libre
  const centroY = 1 - (techo + libre / 2) * 2 / alto;          // su centro, en coordenadas de pantalla (-1..1)
  const cima = pos[1] + (pj.cabeza === 'cubo' ? 0.35 : 0.2) + 0.25 * Math.max(0, pj.forma - 1), pies = pos[1] - EYE;
  const c = (cima + pies) / 2, medio = (cima - pies) / 2;
  const d = medio / (0.72 * frac * ty);                        // que ocupe el 72% del lugar libre
  const th = Math.atan(centroY * ty);                          // mirar un poco hacia abajo: el personaje sube al centro del lugar libre
  const eye = [pos[0] - Math.sin(yaw) * d, c, pos[2] - Math.cos(yaw) * d];
  const f = norm([Math.sin(yaw) * Math.cos(th), -Math.sin(th), Math.cos(yaw) * Math.cos(th)]);
  const r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  return { eye, b: { f, r, u } };
}
function pjYo(p0) {
  return {
    disp: { p: p0.slice(), yaw: pjVista.yaw0, pitch: 0 }, body: pjVista.yaw0, col: salaColor,
    walk: 0, phase: 0, raise: 0, cam: false,
    cu: pj.cuerpo === 'sin', ca: pj.cabeza === 'cubo', fa: pj.forma,
  };
}
