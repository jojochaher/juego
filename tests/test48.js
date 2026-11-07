// piezas (v10.24, propuesta 9 de José, parte 1): con una foto en la mano, "agrupar" y tocar otras: se suman a la mano y se
// mueven y giran juntas; al soltar con ✓ todas guardan gr y después agarrar cualquiera agarra la pieza. "separar" las
// suelta sin gr. Con una pieza: solo mover y girar; con la grilla no cambia de tamaño; borrar borra la pieza entera.
// Museo (se guarda, recargar) y sala (el otro ve la pieza en tu mano y la recibe movida; datos rotos; cliente viejo).
// uso: node tests/test48.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const PASS = 'prueba piezas', H = crypto.createHash('sha256').update('juego:' + PASS).digest('hex');
const DB = 'http://localhost:8482';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8482);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8481);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const visto = (pg, sel) => pg.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; }, sel);
  const proj = (pg, p) => pg.evaluate(p => { const b = basis(), P = __game.pos; const v = [0, 1, 2].map(i => p[i] - P[i]); const d = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2]; const z = d(v, b.f); const [tx, ty] = tans(); return [(1 + d(v, b.r) / z / tx) / 2, (1 + d(v, b.u) / z / ty) / 2]; }, p);
  const px = (pg, x, y) => pg.evaluate(([x, y]) => new Promise(res => requestAnimationFrame(() => {
    const a = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); res([...a].slice(0, 3));
  })), [x, y]);
  const pxEn = async (pg, p) => { const [x, y] = await proj(pg, p); return px(pg, x, y); };
  // a pantalla (px CSS) desde un punto del mundo
  const enPantalla = async (pg, p) => { const [x, y] = await proj(pg, p); const vp = pg.viewportSize(); return [x * vp.width, (1 - y) * vp.height]; };
  const rojo = c => c[0] > 90 && c[0] > c[1] * 2 && c[0] > c[2] * 2, azul = c => c[2] > 90 && c[2] > c[0] * 2 && c[2] > c[1] * 1.5, verde = c => c[1] > 90 && c[1] > c[0] * 2 && c[1] > c[2] * 2;
  const COLOR = col => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 64, 64); return c; };
  // distancias y ángulos entre dos poses (lo que no cambia si se mueven juntas)
  const relDe = (a, c) => { const s = (p, q) => p.map((v, i) => v - q[i]), d = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]; const v = s(c.c, a.c); return [d(v, a.r), d(v, a.u), d(c.r, a.r), d(c.r, a.u), d(c.u, a.u), d(c.u, a.r)]; };
  const igualRel = (x, y) => x.every((v, i) => Math.abs(v - y[i]) < 0.01);

  // ---------- museo ----------
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] });
  let pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  const cdp = await ctx.newCDPSession(pg);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
  const tocar = async (x, y) => { await T('touchStart', [[x, y]]); await pg.waitForTimeout(40); await T('touchEnd', []); await pg.waitForTimeout(150); };
  const vp = pg.viewportSize();
  await pg.goto('http://localhost:8481/?borrar'); await pg.goto('http://localhost:8481/'); await pg.waitForTimeout(300);
  await pg.tap('#start'); await espera(pg, () => __game.camReady);
  while (await pg.evaluate(() => __game.grilla)) await pg.tap('#grilla');
  await pg.tap('#unequip'); await pg.waitForTimeout(300);
  const poner = (q, lista) => q.evaluate(async ([src, lista]) => {
    const COLOR = eval(src);
    for (const [o, col] of lista) {
      const img = COLOR(col);
      addWork(o, img);
      if (!__game.sala.active) await new Promise(res => img.toBlob(blob => store('readwrite', s => s.put({ ...o, blob })).then(res), 'image/jpeg', 0.9));
    }
  }, ['(' + COLOR.toString() + ')', lista]);
  await poner(pg, [
    [{ id: 'a', c: [0, 1.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.8, h: 0.8, t0: 1 }, '#e02010'],
    [{ id: 'b', c: [1, 1.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.6, h: 0.6, t0: 1 }, '#1040e0'],
    [{ id: 'k', c: [-1, 1.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.6, h: 0.6, d: 0.4, t0: 1 }, '#20d040'],
    [{ id: 'z', c: [0, 0.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.5, h: 0.5, t0: 1 }, '#e02010'],
  ]);
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  await pg.waitForTimeout(300);
  const antes = await pg.evaluate(() => Object.fromEntries(__game.works.map(w => [w.id, { c: w.c.slice(), r: w.r.slice(), u: w.u.slice(), w: w.w, h: w.h }])));
  await pg.evaluate(() => pick(__game.works.find(w => w.id === 'a'))); await pg.waitForTimeout(1200);
  ok('con una foto en la mano está "agrupar"', await visto(pg, '#agrupar') && !(await visto(pg, '#separar')));
  await pg.tap('#agrupar');
  ok('agrupando: el botón lo dice y avisa cómo', (await pg.textContent('#agrupar')).includes('agrupando') && (await pg.textContent('#hint')).includes('tocá las fotos'));
  let [x, y] = await enPantalla(pg, [1, 1.6, -3]);
  await tocar(x, y);
  ok('tocar otra la suma a la mano', await pg.evaluate(() => __game.held.pz.ids.has('b')) && (await pg.textContent('#agrupar')).includes('2'));
  [x, y] = await enPantalla(pg, [-1, 1.6, -3]);
  await tocar(x, y);
  ok('y una caja', await pg.evaluate(() => __game.held.pz.ids.has('k')));
  ok('todavía en la mano la que agarré', await pg.evaluate(() => __game.held.work.id === 'a'));
  [x, y] = await enPantalla(pg, [1, 1.6, -3]);
  await tocar(x, y);
  ok('tocarla otra vez la saca', await pg.evaluate(() => !__game.held.pz.ids.has('b')));
  await tocar(x, y);
  ok('y otra vez la suma', await pg.evaluate(() => __game.held.pz.ids.has('b')));
  [x, y] = await enPantalla(pg, [0, 1.6, -3]);
  await tocar(x, y);
  ok('tocar la principal no hace nada raro', await pg.evaluate(() => __game.held.work.id === 'a' && __game.held.pz.ids.size === 2));
  ok('con el teclado, mientras se agrupa, no se pasa a escalar', await pg.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit3' })); return __game.mode === 'mover'; }));
  await pg.tap('#agrupar');
  ok('dejar de agrupar: queda la pieza en la mano, aparece "separar"', await pg.evaluate(() => !__game.held.pz.agrupando && __game.held.pz.ids.size === 2) && await visto(pg, '#separar'));
  ok('con una pieza no hay vaciar / repetir / guardar textura / cielo', !(await visto(pg, '#vaciarFoto')) && !(await visto(pg, '#repetir')) && !(await visto(pg, '#aTextura')) && !(await visto(pg, '#cieloFoto')));
  await pg.tap('#ajustar'); await pg.waitForTimeout(100);
  ok('ajustar: solo girar (sin recortar, escalar, extruir ni ↺)', await visto(pg, '#modes [data-m="girar"]') && !(await visto(pg, '#modes [data-m="recortar"]')) && !(await visto(pg, '#modes [data-m="escalar"]')) && !(await visto(pg, '#modes [data-m="extruir"]')) && !(await visto(pg, '#reset')));
  ok('setMode escalar no entra', await pg.evaluate(() => { setMode('escalar'); return __game.mode === 'mover'; }));
  // pellizcar no cambia el tamaño
  const w0 = await pg.evaluate(() => __game.held.L.w);
  await T('touchStart', [[150, 400], [250, 400]]); for (let i = 1; i <= 8; i++) { await T('touchMove', [[150 - i * 8, 400], [250 + i * 8, 400]]); await pg.waitForTimeout(16); } await T('touchEnd', []); await pg.waitForTimeout(100);
  ok('pellizcar no la agranda', await pg.evaluate(w0 => Math.abs(__game.held.L.w - w0) < 1e-6, w0));
  // mientras la tenés: las otras no chocan y se ven en la mano, no en su lugar
  ok('las de la pieza no chocan mientras la tenés', await pg.evaluate(() => !solidas().some(f => ['a', 'b', 'k'].includes((f.obra || f).id)) && solidas().some(f => (f.obra || f).id === 'z')));
  await pg.evaluate(() => { __game.pos[0] = -1.5; }); await pg.waitForTimeout(400);
  let c1 = await pxEn(pg, [-0.5, 1.6, -3]), c2 = await pxEn(pg, [1, 1.6, -3]);
  ok('al moverme, la azul va conmigo (' + c1 + ' / donde estaba: ' + c2 + ')', azul(c1) && !azul(c2));
  c1 = await pxEn(pg, [-2.5, 1.6, -3]);
  ok('y la caja también (' + c1 + ')', verde(c1));
  await pg.screenshot({ path: out + 'v10.24_pieza_mano.png' });
  // girarla: un poco de giro con spinBy
  await pg.evaluate(() => { spinBy(__game.held.L, 0.6, 0.2); });
  const enMano = await pg.evaluate(() => { const p = heldPose(basis()); return { c: p.c, r: p.r, u: p.u }; });
  await pg.tap('#drop'); await pg.waitForTimeout(500);
  let w = await pg.evaluate(() => Object.fromEntries(__game.works.map(w => [w.id, { c: w.c.slice(), r: w.r.slice(), u: w.u.slice(), w: w.w, h: w.h, d: w.d, gr: w.gr }])));
  ok('la principal quedó donde estaba en la mano', w.a.c.every((v, i) => Math.abs(v - enMano.c[i]) < 1e-3));
  ok('se movieron juntas (mismas distancias y ángulos)', igualRel(relDe(antes.a, antes.b), relDe(w.a, w.b)) && igualRel(relDe(antes.a, antes.k), relDe(w.a, w.k)));
  ok('la caja sigue siendo caja y del mismo tamaño', w.k.d === 0.4 && w.k.w === 0.6 && w.b.w === 0.6);
  ok('todas con la misma gr (' + w.a.gr + ')', !!w.a.gr && w.a.gr === w.b.gr && w.b.gr === w.k.gr && !w.z.gr);
  ok('la que no sumé no se movió', w.z.c.every((v, i) => v === antes.z.c[i]));
  // agarrar cualquiera agarra la pieza
  await pg.evaluate(() => pick(__game.works.find(w => w.id === 'k'))); await pg.waitForTimeout(1200);
  ok('agarrar otra de la pieza trae las demás', await pg.evaluate(() => __game.held.work.id === 'k' && __game.held.pz && __game.held.pz.ids.has('a') && __game.held.pz.ids.has('b')));
  ok('el botón dice "sumar a la pieza"', (await pg.textContent('#agrupar')).includes('sumar'));
  // cancelar: nada cambia
  await pg.evaluate(() => { __game.pos[2] = 1; }); await pg.waitForTimeout(200);
  await pg.tap('#cancel'); await pg.waitForTimeout(300);
  const w2 = await pg.evaluate(() => Object.fromEntries(__game.works.map(w => [w.id, { c: w.c.slice(), gr: w.gr }])));
  ok('cancelar la deja como estaba', ['a', 'b', 'k'].every(id => w2[id].c.every((v, i) => Math.abs(v - w[id].c[i]) < 1e-9) && w2[id].gr === w.a.gr));
  // recargar: se guardó
  await pg.reload(); await pg.waitForTimeout(400); await pg.tap('#start'); await espera(pg, () => __game.works.length === 4, null, 8000);
  await pg.waitForTimeout(300);
  const w3 = await pg.evaluate(() => Object.fromEntries(__game.works.map(w => [w.id, { c: w.c.slice(), gr: w.gr }])));
  ok('al recargar: las poses y la gr', ['a', 'b', 'k'].every(id => w3[id] && w3[id].c.every((v, i) => Math.abs(v - w[id].c[i]) < 1e-3) && w3[id].gr === w.a.gr) && !w3.z.gr);
  if (await pg.evaluate(() => __game.camOn)) { await pg.tap('#unequip'); await pg.waitForTimeout(200); }
  // con la grilla: la principal se alinea sin cambiar de tamaño y las otras la siguen
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); pick(__game.works.find(w => w.id === 'b')); }); await pg.waitForTimeout(1200);
  await pg.tap('#grilla'); await pg.waitForTimeout(100);
  ok('con la grilla prendida', await pg.evaluate(() => __game.grilla && __game.pasoGrilla === 1));
  await pg.evaluate(() => { __game.pos[0] += 0.37; __game.pos[2] -= 0.21; }); await pg.waitForTimeout(200);
  await pg.tap('#drop'); await pg.waitForTimeout(400);
  const w4 = await pg.evaluate(() => Object.fromEntries(__game.works.map(w => [w.id, { c: w.c.slice(), r: w.r.slice(), u: w.u.slice(), w: w.w, h: w.h, d: w.d, gr: w.gr }])));
  ok('con la grilla no cambia de tamaño (' + w4.b.w + ')', w4.b.w === 0.6 && w4.a.w === 0.8 && w4.k.d === 0.4);
  const esq = w4.b.c.map((v, i) => v - w4.b.r[i] * 0.3 - w4.b.u[i] * 0.3);
  ok('la principal en la grilla (' + esq.map(v => v.toFixed(2)) + ')', esq.every(v => Math.abs(v - Math.round(v)) < 1e-6));
  ok('y las otras siguen pegadas', igualRel(relDe(w.b, w.a), relDe(w4.b, w4.a)) && igualRel(relDe(w.b, w.k), relDe(w4.b, w4.k)));
  await pg.evaluate(() => { while (__game.grilla) grillaBtn.click(); });
  // sumar otra pieza: se juntan
  await pg.evaluate(() => { __game.works.find(w => w.id === 'z').gr = 'otrapieza'; });
  await poner(pg, [[{ id: 'z2', c: [5, 1, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.5, h: 0.5, gr: 'otrapieza' }, '#1040e0']]);
  const zc = await pg.evaluate(() => __game.works.find(w => w.id === 'z').c.slice());
  await pg.evaluate(zc => { const ax = __game.works.find(w => w.id === 'a').c[0]; __game.pos[0] = (ax + zc[0]) / 2; __game.pos[1] = 1.6; __game.pos[2] = zc[2] + 5; __game.look(0, -5); pick(__game.works.find(w => w.id === 'a')); }, zc); await pg.waitForTimeout(1200);
  await pg.tap('#agrupar');
  [x, y] = await enPantalla(pg, zc);
  await pg.evaluate(([x, y]) => pzTocar(x, y), [x, y]);   // (cae cerca de la barra de la distancia: directo)
  ok('tocar una de otra pieza suma la pieza entera', await pg.evaluate(() => __game.held.pz.ids.has('z') && __game.held.pz.ids.has('z2')));
  await pg.tap('#drop'); await pg.waitForTimeout(300);
  ok('y quedan todas en una', await pg.evaluate(() => { const g = __game.works.find(w => w.id === 'a').gr; return __game.works.every(w => w.gr === g); }));
  // sacar una de una pieza guardada: pierde gr
  await pg.evaluate(() => { pick(__game.works.find(w => w.id === 'a')); }); await pg.waitForTimeout(1200);
  await pg.tap('#agrupar');
  await pg.evaluate(() => { const e = __game.held.pz.m.find(e => e.w.id === 'z2'); __game.held.pz.m = __game.held.pz.m.filter(x => x !== e); __game.held.pz.ids.delete('z2'); __game.held.pz.fuera.add('z2'); });
  await pg.tap('#drop'); await pg.waitForTimeout(300);
  ok('la que saqué ya no es de la pieza', await pg.evaluate(() => !__game.works.find(w => w.id === 'z2').gr && !!__game.works.find(w => w.id === 'a').gr));
  // separar
  await pg.evaluate(() => { pick(__game.works.find(w => w.id === 'b')); }); await pg.waitForTimeout(1200);
  await pg.evaluate(() => { __game.pos[0] += 0.5; });
  await pg.waitForTimeout(200);
  const kAntes = await pg.evaluate(() => { const e = __game.held.pz.m.find(e => e.w.id === 'k'); return pzMover(e.w, pzT(e.ref, heldPose(basis()))).c; });
  await pg.tap('#separar'); await pg.waitForTimeout(300);
  ok('separar: nada en la mano y ninguna con gr', await pg.evaluate(() => !__game.held && __game.works.every(w => !w.gr)));
  ok('y quedaron donde se veían', await pg.evaluate(k => __game.works.find(w => w.id === 'k').c.every((v, i) => Math.abs(v - k[i]) < 1e-6), kAntes));
  await pg.reload(); await pg.waitForTimeout(400); await pg.tap('#start'); await espera(pg, () => __game.works.length === 5, null, 8000);
  ok('separadas también al recargar', await pg.evaluate(() => __game.works.every(w => !w.gr)));
  if (await pg.evaluate(() => __game.camOn)) { await pg.tap('#unequip'); await pg.waitForTimeout(200); }
  // gr rota en el registro: se ignora
  await pg.evaluate(() => new Promise(res => store('readwrite', s => { const q = s.get('z'); q.onsuccess = () => { s.put({ ...q.result, gr: { x: 1 } }); }; }).then(res)));
  await pg.reload(); await pg.waitForTimeout(400); await pg.tap('#start'); await espera(pg, () => __game.works.length === 5, null, 8000);
  ok('gr rota: no es de ninguna pieza', await pg.evaluate(() => __game.works.find(w => w.id === 'z').gr === undefined));
  if (await pg.evaluate(() => __game.camOn)) { await pg.tap('#unequip'); await pg.waitForTimeout(200); }
  // tocar la principal con otra detrás: no suma la de atrás
  await poner(pg, [[{ id: 'atras', c: [0, 1.6, -6], r: [1, 0, 0], u: [0, 1, 0], w: 2, h: 2 }, '#1040e0']]);
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[1] = 1.6; __game.pos[2] = 0; __game.look(0, 0); addWork({ id: 'frente', c: [0, 1.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.6, h: 0.6 }, VACIO_IMG); pick(__game.works.find(w => w.id === 'frente')); });
  await pg.waitForTimeout(1200);
  await pg.tap('#agrupar');
  await pg.evaluate(() => pzTocar(innerWidth / 2, innerHeight / 2));
  ok('tocar la que agarraste no suma la de atrás', await pg.evaluate(() => __game.held.pz.ids.size === 0) && (await pg.textContent('#hint')).includes('la que agarraste'));
  await pg.evaluate(() => cancelHold());
  // con una imagen nueva sin soltar, no se agrupa
  await pg.evaluate(() => { pick(__game.works.find(w => w.id === 'frente')); }); await pg.waitForTimeout(1200);
  await pg.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 32; llenarBloque(c); });
  ok('con una imagen nueva sin soltar no aparece "agrupar"', !(await visto(pg, '#agrupar')));
  await pg.evaluate(() => { pzAgrupar(); });
  ok('y si se pide, avisa', await pg.evaluate(() => !(__game.held.pz && __game.held.pz.agrupando)) && (await pg.textContent('#hint')).includes('primero soltala'));
  await pg.evaluate(() => cancelHold());
  await pg.evaluate(() => { const w = __game.works.find(w => w.id === 'frente'); __game.works.splice(__game.works.indexOf(w), 1); const a = __game.works.find(w => w.id === 'atras'); __game.works.splice(__game.works.indexOf(a), 1); store('readwrite', s => s.delete('atras')); });
  // mientras el museo carga, una pieza no se agarra (le faltarían las que no cargaron)
  await pg.evaluate(() => { for (const id of ['a', 'b']) __game.works.find(w => w.id === id).gr = 'borrar1'; museoCargando++; pick(__game.works.find(w => w.id === 'a')); });
  ok('mientras el museo carga no se agarra una pieza (y avisa)', await pg.evaluate(() => !__game.held) && (await pg.textContent('#hint')).includes('cargando'));
  await pg.evaluate(() => { museoCargando--; });
  // borrar con una pieza en la mano: se borra entera
  await pg.evaluate(() => { pick(__game.works.find(w => w.id === 'a')); }); await pg.waitForTimeout(1200);
  ok('pieza en la mano (para borrar)', await pg.evaluate(() => __game.held.pz && __game.held.pz.ids.has('b')));
  await pg.tap('#trash'); await pg.waitForTimeout(400);
  ok('borrar borra la pieza entera (y avisa)', await pg.evaluate(() => !__game.works.some(w => w.id === 'a' || w.id === 'b')) && (await pg.textContent('#hint')).includes('pieza'));
  const quedan = await pg.evaluate(() => new Promise(res => store('readonly', s => s.getAllKeys()).then(res)));
  ok('también del guardado (' + quedan + ')', !quedan.includes('a') && !quedan.includes('b') && quedan.includes('k'));
  ok('museo: sin errores', !pg.errs.length && !/error/i.test(await pg.textContent('#hint')));
  if (pg.errs.length) console.log(pg.errs);

  // ---------- sala ----------
  const URL = 'http://localhost:8481/?db=' + DB;
  const mk = async () => {
    const c = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const q = await c.newPage(); q.errs = []; q.on('pageerror', e => q.errs.push(e.message));
    await q.goto(URL); await q.waitForTimeout(300); await q.tap('#start'); await q.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 });
    while (await q.evaluate(() => __game.grilla)) await q.tap('#grilla');
    await q.tap('#unequip'); await q.tap('#salaBtn'); await q.fill('#salaPass', PASS); await q.tap('#salaEntrar');
    await espera(q, () => __game.sala.active && __game.sala.estadoVisto, null, 8000);
    return q;
  };
  const dump = async () => ((((await (await fetch(DB + '/__dump')).json()) || {}).salas || {})[H] || {});
  const A = await mk(), B = await mk();
  const img = async col => A.evaluate(([src, col]) => eval(src)(col).toDataURL('image/jpeg', 0.92), ['(' + COLOR.toString() + ')', col]);
  const subir = async (id, pose, col) => { await fetch(DB + '/salas/' + H + '/imgs/' + id + '.json', { method: 'PUT', body: JSON.stringify(await img(col)) }); await fetch(DB + '/salas/' + H + '/poses/' + id + '.json', { method: 'PUT', body: JSON.stringify(pose) }); };
  await subir('s1', { c: [0, 1.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.8, h: 0.8, uv: [0, 0, 1, 1], t0: Date.now() }, '#e02010');
  await subir('s2', { c: [1, 1.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.6, h: 0.6, uv: [0, 0, 1, 1], t0: Date.now() }, '#1040e0');
  await subir('s3', { c: [-1, 1.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.6, h: 0.6, d: 0.4, uv: [0, 0, 1, 1], t0: Date.now() }, '#20d040');
  ok('A y B tienen las 3', await espera(A, () => __game.works.length === 3) && await espera(B, () => __game.works.length === 3));
  const idA = await A.evaluate(() => __game.salaYo);
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); pick(__game.works.find(w => w.id === 's1')); }); await A.waitForTimeout(1200);
  await A.tap('#agrupar');
  await A.evaluate(() => { pzTocar(...(() => { const p = [1, 1.6, -3], b = basis(), v = p.map((x, i) => x - __game.pos[i]), d = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2], z = d(v, b.f), [tx, ty] = tans(); return [(1 + d(v, b.r) / z / tx) / 2 * innerWidth, (1 - d(v, b.u) / z / ty) / 2 * innerHeight]; })()); });
  await A.evaluate(() => { pzTocar(...(() => { const p = [-1, 1.6, -3], b = basis(), v = p.map((x, i) => x - __game.pos[i]), d = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2], z = d(v, b.f), [tx, ty] = tans(); return [(1 + d(v, b.r) / z / tx) / 2 * innerWidth, (1 - d(v, b.u) / z / ty) / 2 * innerHeight]; })()); });
  ok('A: sumó las dos', await A.evaluate(() => __game.held.pz.ids.size === 2));
  ok('B sabe que A las está sumando (mp) y no las puede agarrar', await espera(B, id => { const p = __game.sala.gente.get(id); return p && p.mp && p.mp.length === 2 && salaOcupadas().has('s2') && salaOcupadas().has('s3'); }, idA, 4000));
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); }); await B.waitForTimeout(300);
  ok('B: tocar donde está s2 no la agarra', await B.evaluate(() => { const p = [1, 1.6, -3], b = basis(), v = p.map((x, i) => x - __game.pos[i]), d = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2], z = d(v, b.f), [tx, ty] = tans(); const h = workHit((1 + d(v, b.r) / z / tx) / 2 * innerWidth, (1 - d(v, b.u) / z / ty) / 2 * innerHeight); return !h || h.w.id !== 's2'; }));
  await A.tap('#drop'); await A.waitForTimeout(600);
  let d = await dump();
  const g = d.poses.s1.gr;
  ok('en la base las 3 con la misma gr (' + g + ')', !!g && d.poses.s2.gr === g && d.poses.s3.gr === g && d.poses.s3.d === 0.4);
  ok('B las recibe con gr', await espera(B, g => __game.works.every(w => w.gr === g), g, 6000));
  // A agarra la pieza y se mueve: B la ve moverse en su mano (también las que no agarró)
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 2; __game.look(0, 0); }); await B.waitForTimeout(200);
  await A.evaluate(() => pick(__game.works.find(w => w.id === 's2'))); await A.waitForTimeout(1200);
  ok('A: agarrar una trae la pieza', await A.evaluate(() => __game.held.pz && __game.held.pz.ids.size === 2));
  await A.evaluate(() => { __game.pos[0] = 1.2; }); await A.waitForTimeout(400);
  // mientras A la tiene, llega una pose de s3 de otro lado (otro que la movió): A sigue con la suya hasta soltar
  const s3b = (await dump()).poses.s3;
  await fetch(DB + '/salas/' + H + '/poses/s3.json', { method: 'PUT', body: JSON.stringify({ ...s3b, c: [-1, 1.6, -7] }) });
  await A.waitForTimeout(800);
  ok('A: la pose que llega de una de la pieza en la mano no la mueve', await A.evaluate(() => { const w = __game.works.find(w => w.id === 's3'); return Math.abs(w.c[2] + 3) < 0.01 && !!w.gr; }));
  await A.waitForTimeout(700);
  ok('B ve que A tiene s2 en la mano', await espera(B, id => { const p = __game.sala.gente.get(id); return p && p.mano && p.mano.mid === 's2'; }, idA, 4000));
  ok('B no dibuja ninguna de la pieza en su lugar (y no chocan)', await B.evaluate(() => { const s = salaEnManos(); return ['s1', 's2', 's3'].every(id => s.has(id)) && !solidas().length; }));
  ok('B no puede agarrar una invisible de la pieza de A', await B.evaluate(() => { const p = [-1, 1.6, -3], b = basis(), v = p.map((x, i) => x - __game.pos[i]), d = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2], z = d(v, b.f), [tx, ty] = tans(); return !workHit((1 + d(v, b.r) / z / tx) / 2 * innerWidth, (1 - d(v, b.u) / z / ty) / 2 * innerHeight); }));
  await B.waitForTimeout(800);
  let cb1 = await pxEn(B, [-1 + 1.2, 1.6, -3]), cb2 = await pxEn(B, [-1, 1.6, -3]);
  ok('B ve la caja verde movida con A (' + cb1 + ') y no donde estaba (' + cb2 + ')', verde(cb1) && !verde(cb2));
  await B.screenshot({ path: out + 'v10.24_pieza_B.png' });
  await A.tap('#drop'); await A.waitForTimeout(600);
  d = await dump();
  ok('en la base, todas movidas 1,2 m', Math.abs(d.poses.s1.c[0] - 1.2) < 0.01 && Math.abs(d.poses.s2.c[0] - 2.2) < 0.01 && Math.abs(d.poses.s3.c[0] - 0.2) < 0.01 && d.poses.s1.gr === g);
  ok('B las recibe movidas', await espera(B, () => { const s = id => __game.works.find(w => w.id === id); return Math.abs(s('s3').c[0] - 0.2) < 0.01 && Math.abs(s('s1').c[0] - 1.2) < 0.01; }, null, 6000));
  ok('B: ya no están en la mano de A', await espera(B, () => salaEnManos().size === 0, null, 4000));
  // una pieza con una foto que todavía baja no se agarra
  ok('con una de la pieza bajando no se agarra', await A.evaluate(g => { __game.sala.cargando.set('zz', { gr: g, c: [0, 0, 0] }); pick(__game.works.find(w => w.id === 's1')); const r = !__game.held; __game.sala.cargando.delete('zz'); return r; }, g));
  // un cliente viejo mueve s3 (le saca gr): sale de la pieza
  await fetch(DB + '/salas/' + H + '/poses/s3.json', { method: 'PUT', body: JSON.stringify({ ...d.poses.s3, gr: undefined, c: [0.2, 1.6, -4] }) });
  ok('cliente viejo: s3 queda sin gr', await espera(A, () => !__game.works.find(w => w.id === 's3').gr, null, 6000));
  await A.evaluate(() => pick(__game.works.find(w => w.id === 's1'))); await A.waitForTimeout(1200);
  ok('y ya no viene con la pieza', await A.evaluate(() => __game.held.pz && __game.held.pz.ids.size === 1 && !__game.held.pz.ids.has('s3')));
  await A.evaluate(() => cancelHold());
  // gr rota en la base: se ignora
  await fetch(DB + '/salas/' + H + '/poses/s2.json', { method: 'PUT', body: JSON.stringify({ ...d.poses.s2, gr: 'NO VALE!' }) });
  ok('gr rota: s2 sin gr', await espera(B, () => __game.works.find(w => w.id === 's2').gr === undefined, null, 6000));
  // separar en la sala
  await fetch(DB + '/salas/' + H + '/poses/s2.json', { method: 'PUT', body: JSON.stringify({ ...d.poses.s2 }) });
  await espera(A, g => __game.works.find(w => w.id === 's2').gr === g, g, 6000);
  await A.evaluate(() => pick(__game.works.find(w => w.id === 's1'))); await A.waitForTimeout(1200);
  await A.tap('#separar'); await A.waitForTimeout(600);
  d = await dump();
  ok('separar: en la base sin gr', !d.poses.s1.gr && !d.poses.s2.gr);
  ok('B también', await espera(B, () => __game.works.every(w => !w.gr), null, 6000));
  // borrar una pieza en la sala
  await A.evaluate(() => { pick(__game.works.find(w => w.id === 's1')); }); await A.waitForTimeout(1200);
  await A.tap('#agrupar');
  await A.evaluate(() => { const o = __game.works.find(w => w.id === 's2'); const p = __game.held.pz; p.m.push({ w: o, ref: pzRef(heldPose(basis())) }); p.ids.add('s2'); ui(); });
  await A.tap('#trash'); await A.waitForTimeout(800);
  d = await dump();
  ok('borrar la pieza en la sala: se van las dos (y sus imágenes)', !d.poses.s1 && !d.poses.s2 && !(d.imgs || {}).s1 && !(d.imgs || {}).s2 && !!d.poses.s3);
  ok('B ya no las tiene', await espera(B, () => __game.works.length === 1, null, 6000));
  ok('sala: sin errores', !A.errs.length && !B.errs.length && !/error/i.test(await A.textContent('#hint')) && !/error/i.test(await B.textContent('#hint')));
  if (A.errs.length || B.errs.length) console.log(A.errs, B.errs);

  console.log(`\n${fallas ? fallas + ' FALLAS' : 'TODO OK'}`);
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
