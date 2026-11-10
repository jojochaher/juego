// extruir, parte 2 (v10.20, propuesta 7 de José): elegir qué lleva cada cara de la caja. En extruir, tocar una cara de
// lo que tenés en la mano la elige y aparecen las opciones: la misma / espejada / borde / color (y "a todas"). Se guarda
// en la pose (cc, 5 letras: atrás, costado derecho, costado izquierdo, arriba, abajo). Museo (se guarda) y sala.
// uso: node tests/test44.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const PASS = 'prueba caras', H = crypto.createHash('sha256').update('juego:' + PASS).digest('hex');
const DB = 'http://localhost:8442';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8442);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8441);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const visto = (pg, sel) => pg.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && (!e.parentElement || getComputedStyle(e.parentElement).display !== 'none'); }, sel);
  const proj = (pg, p) => pg.evaluate(p => { const b = basis(), P = __game.pos; const v = [0, 1, 2].map(i => p[i] - P[i]); const d = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2]; const z = d(v, b.f); const [tx, ty] = tans(); return [(1 + d(v, b.r) / z / tx) / 2, (1 + d(v, b.u) / z / ty) / 2]; }, p);
  const px = (pg, x, y) => pg.evaluate(([x, y]) => new Promise(res => requestAnimationFrame(() => {
    const a = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); res([...a].slice(0, 3));
  })), [x, y]);
  const pxEn = async (pg, p) => { const [x, y] = await proj(pg, p); return px(pg, x, y); };
  const rojo = c => c[0] > 90 && c[0] > c[1] * 2 && c[0] > c[2] * 2, azul = c => c[2] > 90 && c[2] > c[0] * 2 && c[2] > c[1] * 1.5, verde = c => c[1] > 90 && c[1] > c[0] * 2 && c[1] > c[2] * 2;
  const igual = (a, c) => a.every((v, i) => Math.abs(v - c[i]) < 12);
  // mitad izquierda roja, derecha azul, franja de arriba verde
  const IMG = () => { const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#e02010'; x.fillRect(0, 0, 64, 128); x.fillStyle = '#1040e0'; x.fillRect(64, 0, 64, 128); x.fillStyle = '#20d040'; x.fillRect(0, 0, 128, 20); return c; };

  // ---------- museo ----------
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] });
  let pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto('http://localhost:8441/?borrar'); await pg.goto('http://localhost:8441/'); await pg.waitForTimeout(300);
  await pg.tap('#start'); await espera(pg, () => __game.camReady);
  while (await pg.evaluate(() => __game.grilla)) await pg.tap('#grilla');
  await pg.tap('#unequip'); await pg.waitForTimeout(300);
  await pg.evaluate(async (src) => {
    const img = eval(src)();
    await new Promise(res => { const o = { id: 'k1', c: [0, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, d: 1, t0: Date.now() }; addWork(o, img); img.toBlob(blob => store('readwrite', s => s.put({ ...o, blob })).then(res), 'image/jpeg', 0.95); });
    __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0);
  }, '(' + IMG.toString() + ')');
  await pg.waitForTimeout(300);
  ok('las letras de las caras se validan', await pg.evaluate(() => ccValida('mmmmm') === undefined && ccValida('emcbm') === 'emcbm' && ccValida('bcccc') === 'mcccc' && ccValida('mmmmmm') === undefined && ccValida('xmmmm') === undefined && ccValida(5) === undefined));
  ok('el color de cada borde de la foto', await pg.evaluate(() => {
    const t = __game.works.find(w => w.id === 'k1').tex, c = l => colorBorde(t, FULL, l), mx = (a, i) => a.indexOf(Math.max(...a)) === i;
    return mx(c('l'), 0) && mx(c('r'), 2) && mx(c('t'), 1) && mx(c('b'), 0) && Math.abs(c(null)[0] - c(null)[2]) < 0.1;
  }));
  const vp = pg.viewportSize();
  await pg.touchscreen.tap(vp.width / 2, vp.height / 2); await pg.waitForTimeout(1200);
  ok('agarré la caja', (await pg.evaluate(() => __game.held && __game.held.work.id)) === 'k1');
  // v10.29: la caja es un modelo de caras: en mover (sin entrar a extruir) tocar una cara la elige
  // tocar la de adelante: la elige (es la foto: "foto" y "a todas", sin las opciones de las otras)
  await pg.touchscreen.tap(vp.width / 2, vp.height / 2); await pg.waitForTimeout(150);
  ok('tocar la de adelante la elige (la foto)', (await pg.evaluate(() => caraSel)) === 0 && (await pg.textContent('#caraNombre')).includes('la foto'));
  ok('la foto: "foto" y "a todas", sin la misma/espejada/borde/color', await visto(pg, '#caraFoto') && await visto(pg, '#caraTodas') && !(await visto(pg, '#caraOps [data-t="m"]')) && !(await visto(pg, '#caraOps [data-t="c"]')));
  ok('se resalta ella sola (deco "cara")', await pg.evaluate(() => { const d = deco(); return d && d.modo === 'cara' && d.cara === 0; }));
  ok('tocar no la soltó ni abrió el selector ni cambió de modo', await pg.evaluate(() => __game.held && __game.mode === 'mover' && !abrirArchivoHasta));
  await pg.touchscreen.tap(vp.width / 2, vp.height / 2); await pg.waitForTimeout(150);
  ok('tocarla otra vez la suelta', (await pg.evaluate(() => caraSel)) === null && !(await visto(pg, '#caraOps')));
  // girarla para ver un costado y tocarlo
  await pg.evaluate(() => { const L = __game.held.L; L.w = L.h = 0.5; L.d = 0.5; setDist(L, 1.2); spinBy(L, 0.75, 0); }); await pg.waitForTimeout(200);
  const vis = await pg.evaluate(() => {
    const p = heldPose(basis()), cs = cajaCaras(p), P = __game.pos, r = [];
    cs.forEach((f, i) => { const n = cross(f.r, f.u), v = [0, 1, 2].map(k => P[k] - f.c[k]); if (i > 0 && n[0] * v[0] + n[1] * v[1] + n[2] * v[2] > 0.05) r.push(i); });
    return r;
  });
  const lado = vis.find(i => i === 2 || i === 3);
  ok('girada se ve un costado (' + vis + ')', !!lado);
  // un punto de la cara, cerca de la arista con la foto (k = 0.4) o de la de atrás (k = -0.4)
  // el punto de la pantalla donde se ve la cara i (según caraEn, o sea lo que toca el dedo), a la altura k de su ancho
  // para la foto (k = 0.4: cerca de la arista con la foto; -0.4: cerca de la de atrás); en px de la pantalla
  const enCara = (i, k) => pg.evaluate(([i, k]) => {
    const p = __game.held ? heldPose(basis()) : previewPose(basis()), f = cajaCaras(p)[i], n = norm(cross(p.r, p.u)), P = __game.pos;
    let best = null, bd = Infinity;
    for (let y = H * 0.2; y < H * 0.8; y += 6) for (let x = 4; x < W - 4; x += 6) {
      if (caraEn(x, y) !== i) continue;
      const d = rayoEn(x, y), m = cross(f.r, f.u), t = dot(sub(f.c, P), m) / dot(d, m), q = sub(add(P, mul(d, t)), f.c);
      const a = dot(q, n) / (p.d / 2), y0 = Math.abs(dot(q, [0, 1, 0])) / (p.h / 2), e = Math.abs(a - k) + y0 * 0.5;
      if (e < bd) { bd = e; best = [x, y]; }
    }
    return best;
  }, [i, k]);
  const pxCara = async (i, k) => { const q = await enCara(i, k); return q ? px(pg, q[0] / vp.width, 1 - q[1] / vp.height) : [0, 0, 0]; };
  const centro = await enCara(lado, 0);
  ok('el costado está en la pantalla', !!centro);
  await pg.touchscreen.tap(...(centro || [0, 0])); await pg.waitForTimeout(200);
  ok('tocar el costado lo elige (' + await pg.evaluate(() => caraSel) + ')', (await pg.evaluate(() => caraSel)) === lado);
  ok('aparecen las opciones con el nombre de la cara', await visto(pg, '#caraOps') && (await pg.textContent('#caraNombre')).includes('costado'));
  ok('la que tiene ahora: la misma', await pg.evaluate(() => document.querySelector('#caraOps [data-t="m"]').classList.contains('on')));
  ok('se ve el borde de la cara elegida (deco)', await pg.evaluate(l => deco().cara === l, lado));
  const opsDentro = await pg.evaluate(() => [...document.querySelectorAll('#caraOps .pill')].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top > 0; }));
  ok('las opciones entran en la pantalla', opsDentro);
  ok('las opciones van arriba de la fila de edición', await pg.evaluate(() => { const a = document.getElementById('caraOps').getBoundingClientRect(), m = document.getElementById('grilla').getBoundingClientRect(); return a.bottom <= m.top + 1; }));
  ok('en extruir no hay opciones de caras (se ladea al arrastrar)', await pg.evaluate(() => { setAjustar(true); setMode('extruir'); const r = caraSel === null && document.getElementById('caraOps').style.display === 'none'; setMode('mover'); setAjustar(false); return r; }));
  await pg.touchscreen.tap(...(centro || [0, 0])); await pg.waitForTimeout(200);
  await pg.screenshot({ path: out + 'v10.20_caras_opciones.png' });
  // color de ese lado de la foto (costado derecho: azul; izquierdo: rojo) y el del otro lado
  const suyo = lado === 2 ? azul : rojo, otro = lado === 2 ? rojo : azul;
  let cerca = await pxCara(lado, 0.4);
  ok('la misma: cerca de la foto, el otro lado de la imagen (' + cerca + ')', otro(cerca));
  await pg.tap('#caraOps [data-t="e"]'); await pg.waitForTimeout(150);
  cerca = await pxCara(lado, 0.4);
  ok('espejada: cerca de la foto, su mismo lado, sin costura (' + cerca + ')', suyo(cerca));
  ok('queda marcada y en la mano (' + await pg.evaluate(() => __game.held.L.cc) + ')', await pg.evaluate(l => __game.held.L.cc[l - 1] === 'e' && document.querySelector('#caraOps [data-t="e"]').classList.contains('on'), lado));
  await pg.tap('#caraOps [data-t="b"]'); await pg.waitForTimeout(150);
  cerca = await pxCara(lado, 0.4); let lejos = await pxCara(lado, -0.4);
  ok('borde: el borde de la foto estirado hasta atrás (' + cerca + ' / ' + lejos + ')', suyo(cerca) && suyo(lejos));
  await pg.tap('#caraOps [data-t="c"]'); await pg.waitForTimeout(150);
  cerca = await pxCara(lado, 0.4); lejos = await pxCara(lado, -0.4);
  ok('color: liso, del color de ese borde (' + cerca + ' / ' + lejos + ')', suyo(cerca) && igual(cerca, lejos));
  await pg.screenshot({ path: out + 'v10.20_cara_color.png' });
  // a todas
  await pg.tap('#caraTodas'); await pg.waitForTimeout(100);
  ok('"a todas" ' + await pg.evaluate(() => __game.held.L.cc), (await pg.evaluate(() => __game.held.L.cc)) === 'ccccc');
  // atrás no tiene "borde"
  await pg.evaluate(() => { caraSel = 1; pintarCaras(); });
  ok('atrás: sin la opción borde', !(await visto(pg, '#caraOps [data-t="b"]')) && await visto(pg, '#caraOps [data-t="e"]') && (await pg.textContent('#caraNombre')).includes('atrás'));
  await pg.evaluate(() => { caraSel = 2; pintarCaras(); });
  await pg.tap('#caraOps [data-t="b"]'); await pg.tap('#caraTodas'); await pg.waitForTimeout(100);
  ok('borde "a todas": atrás queda como estaba ' + await pg.evaluate(() => __game.held.L.cc), (await pg.evaluate(() => __game.held.L.cc)) === 'cbbbb');
  // tocar afuera cierra las opciones (y no suelta)
  await pg.touchscreen.tap(30, vp.height * 0.3); await pg.waitForTimeout(150);
  ok('tocar afuera de la caja cierra las opciones', !(await visto(pg, '#caraOps')) && await pg.evaluate(() => !!__game.held && caraSel === null));
  // desde la foto, "a todas": todas como ella
  await pg.evaluate(() => { caraSel = 0; pintarCaras(); }); await pg.tap('#caraTodas'); await pg.waitForTimeout(100);
  ok('desde la foto "a todas" las deja como ella', await pg.evaluate(() => !__game.held.L.cc));
  await pg.evaluate(() => { __game.held.L.cc = 'cbbbb'; caraSel = null; pintarCaras(); });
  // aplanarla esconde las opciones
  await pg.evaluate(() => { caraSel = 3; pintarCaras(); });
  ok('opciones abiertas', await visto(pg, '#caraOps'));
  await pg.evaluate(() => { const d = __game.held.L.d; extruirBy(__game.held.L, -5); window.__d = d; });
  ok('aplanada: sin opciones', !(await visto(pg, '#caraOps')));
  await pg.evaluate(() => { __game.held.L.d = window.__d; });
  // soltar con ✓: se guarda; cancelar: no
  await pg.evaluate(() => { __game.held.L.cc = 'ecbmc'; });
  await pg.tap('#drop'); await pg.waitForTimeout(400);
  ok('soltada: la caja lleva sus caras', await pg.evaluate(() => { const w = __game.works.find(x => x.id === 'k1'); return w.cc === 'ecbmc' && w.caras.map(f => f.t).join('') === 'fecbmc'; }));
  ok('guardada en el museo', (await pg.evaluate(() => store('readonly', s => s.get('k1')))).cc === 'ecbmc');
  ok('tocar la caja ya puesta en modo mover la agarra (no elige caras)', await pg.evaluate(() => __game.mode === 'mover' && !__game.held));
  await pg.evaluate(() => pick(__game.works.find(w => w.id === 'k1'))); await pg.waitForTimeout(1200);
  ok('agarrada: en la mano tiene sus caras', await pg.evaluate(() => __game.held.L.cc === 'ecbmc'));
  await pg.evaluate(() => { __game.held.L.cc = 'mmmmc'; cancelHold(); });
  ok('cancelar no cambia las caras', await pg.evaluate(() => __game.works.find(x => x.id === 'k1').cc === 'ecbmc'));
  await pg.evaluate(() => { if (ajustando) setAjustar(false); });
  // puesta en el mundo: mirar cada cara (la caja va de z = -2 a -3, x de -0.5 a 0.5, y de 1.1 a 2.1)
  await pg.evaluate(() => { const w = __game.works.find(x => x.id === 'k1'); Object.assign(w, { c: [0, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, d: 1 }); setBuf(w); });
  const caja = async (cc) => { await pg.evaluate(cc => { const w = __game.works.find(x => x.id === 'k1'); w.cc = cc; setBuf(w); }, cc); await pg.waitForTimeout(120); };
  await pg.evaluate(() => { __game.pos[0] = 2; __game.pos[2] = -2.5; __game.look(-90, 0); }); await pg.waitForTimeout(250);
  await caja(undefined);
  let a = await pxEn(pg, [0.5, 1.5, -2.1]), z = await pxEn(pg, [0.5, 1.5, -2.9]);
  ok('puesta, costado con la misma: cerca de la foto rojo ' + a + ', atrás azul ' + z, rojo(a) && azul(z));
  await caja('memmm');
  a = await pxEn(pg, [0.5, 1.5, -2.1]); z = await pxEn(pg, [0.5, 1.5, -2.9]);
  ok('espejada: cerca de la foto azul (sigue la foto) ' + a + ', atrás rojo ' + z, azul(a) && rojo(z));
  await pg.screenshot({ path: out + 'v10.20_costado_espejado.png' });
  await caja('mbmmm');
  a = await pxEn(pg, [0.5, 1.5, -2.1]); z = await pxEn(pg, [0.5, 1.5, -2.9]); let arr = await pxEn(pg, [0.5, 2.06, -2.5]);
  ok('borde: azul de punta a punta ' + a + ' / ' + z + ', arriba la franja verde ' + arr, azul(a) && azul(z) && verde(arr));
  await caja('mcmmm');
  a = await pxEn(pg, [0.5, 1.5, -2.1]); z = await pxEn(pg, [0.5, 1.9, -2.9]);
  ok('color: liso ' + a + ' = ' + z, azul(a) && igual(a, z));
  // del otro costado
  await pg.evaluate(() => { __game.pos[0] = -2; __game.pos[2] = -2.5; __game.look(90, 0); }); await pg.waitForTimeout(250);
  await caja('mmemm');
  a = await pxEn(pg, [-0.5, 1.5, -2.1]); z = await pxEn(pg, [-0.5, 1.5, -2.9]);
  ok('costado izquierdo espejado: cerca de la foto rojo ' + a + ', atrás azul ' + z, rojo(a) && azul(z));
  // atrás
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = -5; __game.look(180, 0); }); await pg.waitForTimeout(250);
  await caja('emmmm');
  a = await pxEn(pg, [0.25, 1.5, -3]); z = await pxEn(pg, [-0.25, 1.5, -3]);
  ok('atrás espejada: como si se viera la foto por atrás (x+ azul ' + a + ', x- rojo ' + z + ')', azul(a) && rojo(z));
  await caja('cmmmm');
  a = await pxEn(pg, [0.25, 1.5, -3]); z = await pxEn(pg, [-0.25, 1.9, -3]);
  ok('atrás de color: liso, el color de toda la foto ' + a + ' = ' + z, igual(a, z) && a[0] > 40 && a[2] > 40);
  // arriba, desde arriba
  await pg.evaluate(() => { window.__fijo = [0, 3.8, -1.6]; const f = () => { if (!window.__fijo) return; __game.pos.splice(0, 3, ...window.__fijo); velY = 0; requestAnimationFrame(f); }; f(); __game.look(0, -65); }); await pg.waitForTimeout(250);
  await caja('mmmbm');
  a = await pxEn(pg, [-0.25, 2.1, -2.2]); z = await pxEn(pg, [0.25, 2.1, -2.8]);
  ok('arriba con borde: la franja verde de arriba de la foto, estirada ' + a + ' / ' + z, verde(a) && verde(z));
  await caja('mmmem');
  a = await pxEn(pg, [-0.25, 2.1, -2.05]); z = await pxEn(pg, [-0.25, 2.1, -2.6]);
  ok('arriba espejada: pegado a la foto verde (sigue desde su borde) ' + a + ', más atrás rojo ' + z, verde(a) && rojo(z));
  await pg.evaluate(() => { window.__fijo = null; __game.pos[1] = EYE; fisica(0); });
  await caja('ecbmc');
  // al recargar
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForTimeout(1500);
  ok('al recargar la caja tiene sus caras', await pg.evaluate(() => { const w = __game.works.find(x => x.id === 'k1'); return w && w.cc === 'ecbmc' && w.caras && w.caras[3].t === 'b'; }));
  // la cámara extruida: sus caras van con la foto-caja que saca (elegirlas es con algo en la mano: v10.29)
  if (!(await pg.evaluate(() => __game.camOn))) { await pg.tap('#equip'); }
  await espera(pg, () => __game.camReady && __game.camOn, null, 5000);
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 3; __game.look(180, 0); }); await pg.waitForTimeout(200);
  await pg.evaluate(() => { const L = __game.preview; L.d = 0.4; L.w = 0.5; L.h = 0.4; L.cc = 'mcmmm'; setDist(L, 1.2); spinBy(L, 0.75, 0); }); await pg.waitForTimeout(200);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  const w = await pg.evaluate(() => { const w = __game.works[__game.works.length - 1]; return { id: w.id, cc: w.cc, d: w.d }; });
  ok('la foto-caja sale con las caras de la vista previa ' + JSON.stringify(w), w.cc === 'mcmmm' && Math.abs(w.d - 0.4) < 1e-6);
  ok('y se guarda así', await espera(pg, ([id, cc]) => { if (!window.__g) { window.__g = 1; store('readonly', s => s.get(id)).then(r => { window.__gr = r; window.__g = 0; }); } return window.__gr && window.__gr.cc === cc; }, [w.id, w.cc], 4000));
  // el bloque vacío equipado: pone cajas con sus caras
  await pg.evaluate(() => { __game.previewBloque.d = 0.4; __game.previewBloque.cc = 'mmmcc'; setBloque(true); });
  await pg.waitForTimeout(200);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  ok('el bloque extruido pone una caja vacía con sus caras', await pg.evaluate(() => { const w = __game.works[__game.works.length - 1]; return w.vacio && w.cc === 'mmmcc' && w.d === 0.4; }));
  ok('museo: sin errores de dibujo', !(await pg.textContent('#hint')).includes('error'));
  ok('museo: sin errores de JS ' + pg.errs, pg.errs.length === 0);
  await ctx.close();

  // ---------- sala ----------
  const URL = 'http://localhost:8441/?db=' + DB;
  const mk = async () => { const c = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await c.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 }); return pg; };
  const entrar = async pg => { await pg.tap('#unequip'); await pg.tap('#salaBtn'); await pg.fill('#salaPass', PASS); await pg.tap('#salaEntrar'); };
  const dump = async () => ((((await (await fetch(DB + '/__dump')).json()) || {}).salas || {})[H] || {});
  const A = await mk(); await entrar(A);
  const B = await mk(); await entrar(B);
  const idA = await A.evaluate(() => __game.salaYo), idB = await B.evaluate(() => __game.salaYo);
  ok('se ven en la sala', await espera(A, id => __game.sala.gente.has(id), idB) && await espera(B, id => __game.sala.gente.has(id), idA));
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  await A.tap('#equip'); await espera(A, () => __game.camReady && __game.camOn, null, 5000); await A.waitForTimeout(300);
  await A.evaluate(() => { __game.preview.d = 0.5; __game.preview.cc = 'ecbmm'; });
  await A.tap('#shoot'); await A.waitForTimeout(200); await A.tap('#unequip');
  const f1 = await A.evaluate(() => __game.works[__game.works.length - 1].id);
  ok('B recibe la caja con sus caras', await espera(B, id => { const w = __game.works.find(x => x.id === id); return w && w.cc === 'ecbmm' && w.caras && w.caras[2].t === 'c'; }, f1));
  let dd = await dump();
  ok('base: la pose lleva cc', dd.poses && dd.poses[f1] && dd.poses[f1].cc === 'ecbmm');
  await espera(A, id => __game.sala.idsSala.has(id), f1, 5000);
  await A.evaluate(id => pick(__game.works.find(w => w.id === id)), f1); await A.waitForTimeout(1200);
  await A.evaluate(() => { cur().cc = 'ccccc'; });
  ok('B ve las caras nuevas mientras A la tiene en la mano', await espera(B, id => { const p = __game.sala.gente.get(id); return p && p.manoT && p.manoT.cc === 'ccccc'; }, idA));
  await A.evaluate(() => drop());
  ok('A la suelta: B la tiene con las caras nuevas', await espera(B, id => { const w = __game.works.find(x => x.id === id); return w && w.cc === 'ccccc'; }, f1));
  await A.evaluate(id => pick(__game.works.find(w => w.id === id)), f1); await A.waitForTimeout(1200);
  await A.evaluate(() => { cur().cc = undefined; drop(); });
  ok('A le vuelve a poner la misma en todas: para B también', await espera(B, id => { const w = __game.works.find(x => x.id === id); return w && !w.cc && w.d === 0.5; }, f1));
  dd = await dump();
  ok('base: sin cc', dd.poses && dd.poses[f1] && !('cc' in dd.poses[f1]));
  const pose = dd.poses[f1];
  await fetch(DB + '/salas/' + H + '/poses/' + f1 + '.json', { method: 'PUT', body: JSON.stringify({ ...pose, cc: 'zz<b>' }) });
  await B.waitForTimeout(700);
  ok('caras rotas en la base: la misma en todas, sigue siendo caja', await B.evaluate(id => { const w = __game.works.find(x => x.id === id); return w && !w.cc && w.caras && w.caras.length === 6; }, f1));
  await fetch(DB + '/salas/' + H + '/poses/' + f1 + '.json', { method: 'PUT', body: JSON.stringify({ ...pose, cc: 'memmm' }) });
  ok('caras que llegan de afuera', await espera(B, id => { const w = __game.works.find(x => x.id === id); return w && w.cc === 'memmm'; }, f1, 5000));
  await fetch(DB + '/salas/' + H + '/poses/' + f1 + '.json', { method: 'PUT', body: JSON.stringify(pose) });
  ok('un cliente viejo que la mueve (sin cc) la deja con la misma en todas', await espera(B, id => { const w = __game.works.find(x => x.id === id); return w && !w.cc && w.d === 0.5; }, f1, 5000));
  for (const [n, q] of [['A', A], ['B', B]]) {
    ok(n + ': sin errores de dibujo', !(await q.textContent('#hint')).includes('error'));
    ok(n + ': sin errores de JS ' + q.errs, q.errs.length === 0);
  }
  console.log(fallas ? 'FALLAS: ' + fallas : 'todo OK');
  await b.close(); web.close(); dbSrv.close && dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
