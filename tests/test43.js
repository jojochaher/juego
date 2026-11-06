// extruir (v10.19, propuesta 7 de José, parte 1): en "ajustar" → extruir, arrastrar le da profundidad a la foto (crece
// para atrás) y queda una caja con la misma imagen en todas las caras; con la grilla, de a un paso. Choca con su volumen
// (una baja se sube como un escalón, arriba se camina) y se agarra de cualquier cara. Museo (se guarda) y sala.
// uso: node tests/test43.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const PASS = 'prueba cajas', H = crypto.createHash('sha256').update('juego:' + PASS).digest('hex');
const DB = 'http://localhost:8432';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8432);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8431);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const visto = (pg, sel) => pg.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; }, sel);
  const proj = (pg, p) => pg.evaluate(p => { const b = basis(), P = __game.pos; const v = [0, 1, 2].map(i => p[i] - P[i]); const d = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2]; const z = d(v, b.f); const [tx, ty] = tans(); return [(1 + d(v, b.r) / z / tx) / 2, (1 + d(v, b.u) / z / ty) / 2]; }, p);
  const px = (pg, x, y) => pg.evaluate(([x, y]) => new Promise(res => requestAnimationFrame(() => {
    const a = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); res([...a].slice(0, 3));
  })), [x, y]);
  const pxEn = async (pg, p) => { const [x, y] = await proj(pg, p); return px(pg, x, y); };
  const rojo = c => c[0] > 90 && c[0] > c[1] * 2 && c[0] > c[2] * 2, azul = c => c[2] > 90 && c[2] > c[0] * 2 && c[2] > c[1] * 1.5, verde = c => c[1] > 90 && c[1] > c[0] * 2 && c[1] > c[2] * 2;
  // la imagen de prueba: mitad izquierda roja, derecha azul, franja de arriba verde (así se ve si una cara está espejada o dada vuelta)
  const IMG = () => { const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#e02010'; x.fillRect(0, 0, 64, 128); x.fillStyle = '#1040e0'; x.fillRect(64, 0, 64, 128); x.fillStyle = '#20d040'; x.fillRect(0, 0, 128, 20); return c; };

  // ---------- museo ----------
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] });
  let pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  const cdp = await ctx.newCDPSession(pg);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
  const arrastrar = async (x, y, dx, dy, pasos = 10) => { await T('touchStart', [[x, y]]); for (let i = 1; i <= pasos; i++) { await T('touchMove', [[x + dx * i / pasos, y + dy * i / pasos]]); await pg.waitForTimeout(16); } await T('touchEnd', []); await pg.waitForTimeout(80); };
  await pg.goto('http://localhost:8431/?borrar'); await pg.goto('http://localhost:8431/'); await pg.waitForTimeout(300);
  await pg.tap('#start'); await espera(pg, () => __game.camReady);
  while (await pg.evaluate(() => __game.grilla)) await pg.tap('#grilla');
  await pg.tap('#unequip'); await pg.waitForTimeout(300);
  await pg.evaluate(async (src) => {
    const img = eval(src)();
    const pon = (o) => new Promise(res => { addWork(o, img); img.toBlob(blob => store('readwrite', s => s.put({ ...o, blob })).then(res), 'image/jpeg', 0.9); });
    await pon({ id: 'c1', c: [0, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, t0: Date.now() });
    __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0);
  }, '(' + IMG.toString() + ')');
  await pg.waitForTimeout(300);
  const vp = pg.viewportSize();
  await pg.touchscreen.tap(vp.width / 2, vp.height / 2); await pg.waitForTimeout(1200);
  ok('agarré la foto', (await pg.evaluate(() => __game.held && __game.held.work.id)) === 'c1');
  await pg.tap('#ajustar'); await pg.waitForTimeout(150);
  ok('"extruir" en ajustar', await visto(pg, '#modes [data-m="extruir"]'));
  const enFila = await pg.evaluate(() => [...document.querySelectorAll('#modes .pill')].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
  ok('los 5 botones de ajustar entran en la pantalla', enFila);
  await pg.screenshot({ path: out + 'v10.19_ajustar.png' });
  await pg.tap('#modes [data-m="extruir"]'); await pg.waitForTimeout(150);
  ok('modo extruir (y avisa cómo)', (await pg.evaluate(() => __game.mode)) === 'extruir' && (await pg.textContent('#hint')).includes('profundidad'));
  await arrastrar(vp.width / 2, vp.height * 0.7, 0, -150);
  let d1 = await pg.evaluate(() => __game.held.L.d);
  ok('arrastrar para arriba le da profundidad (' + d1 + ')', d1 > 0.2 && d1 < 2);
  ok('arriba dice cuánta', /profundidad: [\d,]+ c?m/.test(await pg.textContent('#hint')));
  ok('mirar no se movió (el arrastre fue para la caja)', await pg.evaluate(() => Math.abs(basis().f[1]) < 0.05 && Math.abs(basis().f[0]) < 0.05));
  await arrastrar(vp.width / 2, vp.height * 0.4, 0, 80);
  const d2 = await pg.evaluate(() => __game.held.L.d);
  ok('para abajo, menos (' + d2 + ')', d2 < d1);
  await arrastrar(vp.width / 2, vp.height * 0.3, 0, 400);
  ok('hasta sacársela del todo: una foto', await pg.evaluate(() => !__game.held.L.d) && (await pg.textContent('#hint')).includes('sin profundidad'));
  // agarrada desde atrás: crece para el otro lado (la cara de tu lado queda quieta; si no, la caja se te venía encima)
  await pg.evaluate(() => { cancelHold(); addWork({ id: 'detras', c: [10, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1 }, VACIO_IMG); __game.pos[0] = 10; __game.pos[2] = -4; __game.look(180, 0); }); await pg.waitForTimeout(200);
  await pg.evaluate(() => pick(__game.works.find(w => w.id === 'detras'))); await pg.waitForTimeout(1200);
  await pg.evaluate(() => { if (!ajustando) setAjustar(true); setMode('extruir'); });
  await arrastrar(vp.width / 2, vp.height * 0.7, 0, -150);
  const detras = await pg.evaluate(() => { const p = heldPose(basis()); return { d: p.d, foto: p.c[2], atras: p.c[2] - p.d }; });
  ok('agarrada desde atrás crece alejándose ' + JSON.stringify(detras), detras.d > 0.2 && Math.abs(detras.atras + 2) < 0.02 && detras.foto > -2);
  await pg.evaluate(() => { cancelHold(); const w = __game.works.find(x => x.id === 'detras'); __game.works.splice(__game.works.indexOf(w), 1); __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  await pg.waitForTimeout(200);
  await pg.evaluate(() => pick(__game.works.find(w => w.id === 'c1'))); await pg.waitForTimeout(1200);
  await pg.evaluate(() => { if (!ajustando) setAjustar(true); setMode('extruir'); });
  // con la grilla: de a un paso
  await pg.evaluate(() => { __game.held.L.d = 0.8; });
  const conGrilla = [];
  for (let i = 0; i < 3; i++) { await pg.tap('#grilla'); conGrilla.push(await pg.evaluate(() => [__game.pasoGrilla, heldPose(basis()).d])); }
  ok('con la grilla la profundidad va de a un paso ' + JSON.stringify(conGrilla), conGrilla[0][1] === 1 && conGrilla[1][1] === 1 && conGrilla[2][1] === 0.75);
  await pg.evaluate(() => { __game.held.L.d = 0.1; });
  ok('con 25 cm, 10 cm de profundidad es una foto (no hay medio paso)', await pg.evaluate(() => heldPose(basis()).d === undefined));
  await pg.tap('#grilla'); await pg.waitForTimeout(100);
  ok('grilla apagada', !(await pg.evaluate(() => __game.grilla)));
  await pg.evaluate(() => { __game.held.L.d = 0.6; });
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: out + 'v10.19_caja_en_la_mano.png' });
  ok('en extruir se ven las aristas de la caja (las de atrás también)', await pg.evaluate(() => deco() && deco().modo === 'extruir'));
  await pg.tap('#drop'); await pg.waitForTimeout(400);
  let w = await pg.evaluate(() => { const w = __game.works.find(x => x.id === 'c1'); return { d: w.d, caras: w.caras && w.caras.length, c: w.c }; });
  ok('soltada: es una caja de 60 cm ' + JSON.stringify(w), Math.abs(w.d - 0.6) < 1e-9 && w.caras === 6);
  const g = await pg.evaluate(() => store('readonly', s => s.get('c1')));
  ok('guardada en el museo con su profundidad', g && Math.abs(g.d - 0.6) < 1e-9);
  // de frente se ve la foto; de costado, la misma imagen (derecha, no espejada); desde atrás, la foto derecha
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); }); await pg.waitForTimeout(250);
  let a = await pxEn(pg, [-0.25, 1.5, -2]), z = await pxEn(pg, [0.25, 1.5, -2]);
  ok('de frente: la foto (izquierda roja ' + a + ', derecha azul ' + z + ')', rojo(a) && azul(z));
  await pg.evaluate(() => { __game.pos[0] = 2; __game.pos[2] = -2.3; __game.look(-90, 0); }); await pg.waitForTimeout(300);
  await pg.screenshot({ path: out + 'v10.19_caja_costado.png' });
  a = await pxEn(pg, [0.5, 1.5, -2.08]); z = await pxEn(pg, [0.5, 1.5, -2.52]); let arr = await pxEn(pg, [0.5, 2.06, -2.3]);
  ok('de costado: la misma imagen (cerca de la foto rojo ' + a + ', atrás azul ' + z + ', arriba verde ' + arr + ')', rojo(a) && azul(z) && verde(arr));
  ok('el costado es más oscuro que la foto (sombra)', a[0] < 200);
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = -4.5; __game.look(180, 0); }); await pg.waitForTimeout(300);
  a = await pxEn(pg, [0.25, 1.5, -2.6]); z = await pxEn(pg, [-0.25, 1.5, -2.6]); arr = await pxEn(pg, [0, 2.05, -2.6]);
  ok('desde atrás: la foto derecha (izquierda roja ' + a + ', derecha azul ' + z + ', arriba verde ' + arr + ')', rojo(a) && azul(z) && verde(arr));
  // en el aire (si no, se cae): cada cuadro vuelve a 3,6 m
  await pg.evaluate(() => { window.__fijo = [0, 3.6, -1.5]; const f = () => { if (!window.__fijo) return; __game.pos.splice(0, 3, ...window.__fijo); velY = 0; requestAnimationFrame(f); }; f(); __game.look(0, -60); }); await pg.waitForTimeout(250);
  await pg.screenshot({ path: out + 'v10.19_caja_arriba.png' });
  a = await pxEn(pg, [-0.25, 2.1, -2.3]); z = await pxEn(pg, [0.25, 2.1, -2.3]);
  ok('arriba (mirando desde adelante): derecha, no espejada (izquierda roja ' + a + ', derecha azul ' + z + ')', rojo(a) && azul(z));
  await pg.evaluate(() => { window.__fijo = null; __game.pos[1] = EYE; fisica(0); });
  // se agarra de cualquier cara
  await pg.evaluate(() => { __game.pos[0] = 2; __game.pos[2] = -2.3; __game.look(-90, 0); }); await pg.waitForTimeout(200);
  ok('tocar el costado la agarra', await pg.evaluate(() => { const h = workHit(innerWidth / 2, innerHeight / 2); return h && h.w.id === 'c1'; }));
  // choca con su volumen: un cubo en el piso no se atraviesa ni de costado; uno bajo se sube; arriba de uno alto se camina
  await pg.evaluate((src) => {
    const img = eval(src)();
    addWork({ id: 'cubo', c: [3, 0.5, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, d: 1 }, img);
    addWork({ id: 'bajo', c: [6, 0.15, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 0.3, d: 1 }, img);
  }, '(' + IMG.toString() + ')');
  const fis = await pg.evaluate(() => {
    const P = __game.pos, r = {};
    const en = (x, y, z) => { P[0] = x; P[1] = y; P[2] = z; for (let i = 0; i < 10; i++) fisica(0.016); return P.slice(); };
    r.frente = en(3, EYE, -1.9);          // pegado a la cara de la foto
    r.costado = en(3.6, EYE, -2.5);       // contra el costado (x = 3.5)
    r.atras = en(3, EYE, -3.1);           // contra la de atrás (z = -3)
    r.adentroDelBajo = en(6, EYE, -2.5);  // la caja baja (30 cm): se sube
    r.arriba = en(3, 1 + EYE, -2.5);      // arriba del cubo: se camina
    r.alBorde = en(3.45, 1 + EYE, -2.5);  // arriba, cerca del borde: no lo empujan los costados
    return r;
  });
  ok('el cubo no se atraviesa de frente ' + fis.frente.map(v => v.toFixed(2)), fis.frente[2] > -1.8);
  ok('ni de costado ' + fis.costado.map(v => v.toFixed(2)), fis.costado[0] > 3.7);
  ok('ni de atrás ' + fis.atras.map(v => v.toFixed(2)), fis.atras[2] < -3.2);
  const EYE = await pg.evaluate(() => EYE);
  ok('la caja baja se sube como un escalón (pies a ' + (fis.adentroDelBajo[1] - EYE).toFixed(2) + ')', Math.abs(fis.adentroDelBajo[1] - EYE - 0.3) < 0.01);
  ok('arriba del cubo se camina (pies a ' + (fis.arriba[1] - EYE).toFixed(2) + ')', Math.abs(fis.arriba[1] - EYE - 1) < 0.01);
  ok('arriba, cerca del borde, no te empuja ' + fis.alBorde.map(v => v.toFixed(2)), Math.abs(fis.alBorde[0] - 3.45) < 0.01 && Math.abs(fis.alBorde[1] - EYE - 1) < 0.01);
  // una caja baja apoyada sobre una arista (sin cara de piso arriba) no se sube: choca (si no, se atravesaba)
  await pg.evaluate(() => { const k = Math.SQRT1_2; addWork({ id: 'arista', c: [9, 0.2, -2], r: [k, k, 0], u: [-k, k, 0], w: 0.25, h: 0.25, d: 1 }, VACIO_IMG); });
  const arista = await pg.evaluate(() => { const P = __game.pos; P[0] = 9; P[1] = EYE; P[2] = -1.9; for (let i = 0; i < 10; i++) fisica(0.016); return P.slice(); });
  ok('una caja baja inclinada sobre una arista no se atraviesa ' + arista.map(v => v.toFixed(2)), arista[2] > -1.85);
  ok('las sólidas: 6 caras por caja', await pg.evaluate(() => solidas().filter(f => f.obra && f.obra.id === 'cubo').length === 6));
  await pg.evaluate(() => { for (const id of ['cubo', 'bajo', 'arista']) { const w = __game.works.find(x => x.id === id); __game.works.splice(__game.works.indexOf(w), 1); } __game.pos[0] = 0; __game.pos[1] = EYE; __game.pos[2] = 0; fisica(0); });
  // al recargar sigue siendo una caja
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForTimeout(1500);
  w = await pg.evaluate(() => { const w = __game.works.find(x => x.id === 'c1'); return w && { d: w.d, caras: w.caras && w.caras.length }; });
  ok('al recargar sigue siendo una caja ' + JSON.stringify(w), w && Math.abs(w.d - 0.6) < 1e-9 && w.caras === 6);
  // aplanarla de nuevo
  await pg.evaluate(() => { pick(__game.works.find(w => w.id === 'c1')); }); await pg.waitForTimeout(1200);
  await pg.evaluate(() => { cur().d = undefined; drop(); }); await pg.waitForTimeout(300);
  ok('sin profundidad vuelve a ser una foto (y se guarda así)', await pg.evaluate(async () => { const w = __game.works.find(x => x.id === 'c1'); const g = await store('readonly', s => s.get('c1')); return !w.d && !w.caras && !g.d; }));
  // el bloque vacío equipado, extruido: pone cajas vacías
  if (await pg.evaluate(() => __game.camOn)) await pg.tap('#unequip');
  await pg.tap('#bloque'); await pg.waitForTimeout(200);
  await pg.tap('#ajustar'); await pg.tap('#modes [data-m="extruir"]'); await pg.waitForTimeout(100);
  await arrastrar(vp.width / 2, vp.height * 0.7, 0, -120);
  const dB = await pg.evaluate(() => __game.previewBloque.d);
  ok('el bloque equipado también se extruye (' + dB + ')', dB > 0.1);
  await pg.screenshot({ path: out + 'v10.19_bloque_extruido.png' });
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  w = await pg.evaluate(() => { const w = __game.works[__game.works.length - 1]; return { vacio: w.vacio, d: w.d, caras: w.caras && w.caras.length }; });
  ok('el disparador pone una caja vacía ' + JSON.stringify(w), w.vacio && Math.abs(w.d - dB) < 1e-6 && w.caras === 6);
  // y la cámara extruida saca fotos que ya son cajas
  await pg.tap('#camChica'); await espera(pg, () => __game.camReady && __game.camOn, null, 5000); await pg.waitForTimeout(200);
  await pg.evaluate(() => { __game.preview.d = 0.5; });
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  w = await pg.evaluate(() => { const w = __game.works[__game.works.length - 1]; return { vacio: w.vacio, d: w.d, caras: w.caras && w.caras.length }; });
  ok('la cámara extruida saca una foto-caja ' + JSON.stringify(w), !w.vacio && Math.abs(w.d - 0.5) < 1e-6 && w.caras === 6);
  ok('museo: sin errores de dibujo', !(await pg.textContent('#hint')).includes('error'));
  ok('museo: sin errores de JS ' + pg.errs, pg.errs.length === 0);
  await ctx.close();

  // ---------- sala ----------
  const URL = 'http://localhost:8431/?db=' + DB;
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
  await A.evaluate(() => { __game.preview.d = 0.5; });
  await A.tap('#shoot'); await A.waitForTimeout(200); await A.tap('#unequip');
  const f1 = await A.evaluate(() => __game.works[__game.works.length - 1].id);
  ok('B recibe la caja (50 cm)', await espera(B, id => { const w = __game.works.find(x => x.id === id); return w && Math.abs(w.d - 0.5) < 1e-6 && w.caras && w.caras.length === 6; }, f1));
  let dd = await dump();
  ok('base: la pose lleva d', dd.poses && dd.poses[f1] && Math.abs(dd.poses[f1].d - 0.5) < 1e-6);
  await espera(A, id => __game.sala.idsSala.has(id), f1, 5000);
  await A.evaluate(id => pick(__game.works.find(w => w.id === id)), f1); await A.waitForTimeout(1200);
  await A.evaluate(() => { cur().d = 1.2; });
  ok('B ve que A la tiene en la mano con 1,2 m de profundidad', await espera(B, id => { const p = __game.sala.gente.get(id); return p && p.manoT && Math.abs(p.manoT.d - 1.2) < 1e-6; }, idA));
  await A.evaluate(() => drop());
  ok('A la suelta: B la tiene de 1,2 m', await espera(B, id => { const w = __game.works.find(x => x.id === id); return w && Math.abs(w.d - 1.2) < 1e-6; }, f1));
  await A.evaluate(id => pick(__game.works.find(w => w.id === id)), f1); await A.waitForTimeout(1200);
  await A.evaluate(() => { cur().d = undefined; drop(); });
  ok('A la aplana: para B vuelve a ser una foto', await espera(B, id => { const w = __game.works.find(x => x.id === id); return w && !w.d && !w.caras; }, f1));
  dd = await dump();
  ok('base: sin d', dd.poses && dd.poses[f1] && !('d' in dd.poses[f1]));
  // datos rotos o de otro cliente
  const pose = dd.poses[f1];
  for (const [n, v] of [['negativa', -2], ['texto', 'x'], ['enorme', 1e9]]) {
    await fetch(DB + '/salas/' + H + '/poses/' + f1 + '.json', { method: 'PUT', body: JSON.stringify({ ...pose, d: v, t0: (pose.t0 || 0) + 1 }) });
    await B.waitForTimeout(600);
    const r = await B.evaluate(id => { const w = __game.works.find(x => x.id === id); return w && { d: w.d, ok: w.c.every(Number.isFinite) }; }, f1);
    ok('profundidad ' + n + ' en la base: ' + JSON.stringify(r), r && r.ok && (n === 'enorme' ? r.d === 40 : r.d === undefined));
  }
  await fetch(DB + '/salas/' + H + '/poses/' + f1 + '.json', { method: 'PUT', body: JSON.stringify({ ...pose, d: 0.75 }) });
  ok('una caja que llega de afuera', await espera(B, id => { const w = __game.works.find(x => x.id === id); return w && w.d === 0.75 && w.caras && w.caras.length === 6; }, f1, 5000));
  await fetch(DB + '/salas/' + H + '/poses/' + f1 + '.json', { method: 'PUT', body: JSON.stringify(pose) });
  ok('un cliente viejo que la mueve (sin d) la deja plana', await espera(B, id => { const w = __game.works.find(x => x.id === id); return w && !w.d && !w.caras; }, f1, 5000));
  await B.evaluate(id => { const w = __game.works.find(x => x.id === id); __game.pos[0] = w.c[0]; __game.pos[2] = w.c[2] + 1.5; __game.look(0, 0); }, f1);
  await B.waitForTimeout(300);
  await B.screenshot({ path: out + 'v10.19_sala_B.png' });
  for (const [n, q] of [['A', A], ['B', B]]) {
    ok(n + ': sin errores de dibujo', !(await q.textContent('#hint')).includes('error'));
    ok(n + ': sin errores de JS ' + q.errs, q.errs.length === 0);
  }
  console.log(fallas ? 'FALLAS: ' + fallas : 'todo OK');
  await b.close(); web.close(); dbSrv.close && dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
