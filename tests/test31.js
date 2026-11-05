// v10.5: girar sin quedar al revés, bloques vacíos (museo y sala), tocar tu cara la apaga, recortar adentro mueve la imagen
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
(async () => {
  const dbSrv = await mock(8191);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json','.png':'image/png'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8171);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const espera = (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto('http://localhost:8171/?borrar'); await pg.goto('http://localhost:8171/'); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady);
  await pg.waitForTimeout(300);

  // 1. girar: después de darla vuelta 180° sobre el eje vertical, el arrastre vertical la inclina para el mismo lado
  const g = await pg.evaluate(() => {
    const L1 = { r: [1, 0, 0], u: [0, 1, 0] }; spinBy(L1, 0, 0.3);
    const L2 = { r: [1, 0, 0], u: [0, 1, 0] }; spinBy(L2, Math.PI, 0); spinBy(L2, 0, 0.3);
    return { a: L1.u[2], b: L2.u[2] };
  });
  ok(`girar 180° y después inclinar: mismo sentido (${g.a.toFixed(3)} y ${g.b.toFixed(3)})`, Math.sign(g.a) === Math.sign(g.b) && Math.abs(g.a - g.b) < 1e-9);

  // 2. recortar adentro de la foto mueve la imagen (era "encuadre")
  ok('ya no hay botón de encuadre', (await pg.$$('[data-m="encuadre"]')).length === 0);
  await pg.tap('#ajustar'); await pg.tap('[data-m="recortar"]');
  await pg.evaluate(() => { __game.preview.uv = [0.2, 0.2, 0.8, 0.8]; });
  const vw = pg.viewportSize(), cx = vw.width / 2, cy = vw.height / 2;
  const cdp = await ctx.newCDPSession(pg);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
  await T('touchStart', [[cx, cy]]); for (let i = 1; i <= 6; i++) { await T('touchMove', [[cx + i * 10, cy]]); await pg.waitForTimeout(16); } await T('touchEnd', []);
  const uv = await pg.evaluate(() => __game.preview.uv);
  ok(`recortar: arrastrar adentro mueve la imagen (u0 0.2 -> ${uv[0].toFixed(3)})`, uv[0] < 0.19 && Math.abs((uv[2] - uv[0]) - 0.6) < 1e-6);
  await pg.tap('[data-m="recortar"]'); await pg.tap('#ajustar');

  // 3. bloque vacío en el museo (v10.6: se equipa, el disparador lo pone, y se vuelve a la cámara)
  const bloque = async p => { await p.tap('#bloque'); await p.waitForTimeout(150); await p.tap('#shoot'); await p.waitForTimeout(150);
    await p.tap('#camChica'); await p.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 }); await p.waitForTimeout(150); };
  ok('botón de bloque con la cámara', await pg.isVisible('#bloque'));
  const n0 = await pg.evaluate(() => __game.works.length);
  await bloque(pg);
  const bl = await pg.evaluate(() => { const w = __game.works[__game.works.length - 1]; return { n: __game.works.length, vacio: w.vacio, w: w.w, h: w.h }; });
  ok('pone un bloque vacío cuadrado ' + JSON.stringify(bl), bl.n === n0 + 1 && bl.vacio && Math.abs(bl.w - bl.h) < 1e-9);
  await pg.waitForTimeout(300);
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady); await pg.waitForTimeout(600);
  ok('el bloque vacío queda al volver a abrir', await pg.evaluate(() => __game.works.some(w => w.vacio)));
  await pg.evaluate(() => { pick(__game.works.find(w => w.vacio)); ui(); }); await pg.waitForTimeout(1200);
  ok('agarrado: aparecen "sacar foto" y "galería"', await pg.isVisible('#llenarFoto') && await pg.isVisible('#llenarGaleria'));
  await pg.screenshot({ path: out + 'v105_bloque_en_la_mano.png' });
  const id1 = await pg.evaluate(() => __game.held.work.id);
  await pg.tap('#llenarFoto'); await pg.waitForTimeout(300);
  ok('sacar foto lo llena (y sigue en la mano)', await pg.evaluate(() => __game.held && !__game.held.work.vacio));
  ok('ya no ofrece llenarlo (para otra, cancelar)', !(await pg.isVisible('#llenarFoto')));
  // cancelar deshace: vuelve a estar vacío
  await pg.tap('#cancel'); await pg.waitForTimeout(200);
  ok('cancelar lo deja vacío', await pg.evaluate(id => __game.works.find(w => w.id === id).vacio, id1));
  await pg.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, id1); await pg.waitForTimeout(1200);
  await pg.tap('#llenarFoto'); await pg.waitForTimeout(200);
  // moverlo antes de soltar: queda donde lo soltás (y lleno) al volver a abrir
  await pg.evaluate(() => { const L = cur(); L.c = L.c.map(v => v * 1.5); });
  await pg.tap('#drop');
  const cSuelto = await pg.evaluate(id => __game.works.find(w => w.id === id).c.slice(), id1); await pg.waitForTimeout(2000);
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady); await pg.waitForTimeout(800);
  const tras = await pg.evaluate(id => { const w = __game.works.find(x => x.id === id); return w && { vacio: w.vacio, c: w.c }; }, id1);
  ok('al volver a abrir, el bloque tiene su foto y está donde lo soltaste ' + JSON.stringify(tras), tras && !tras.vacio && Math.hypot(...tras.c.map((v, i) => v - cSuelto[i])) < 1e-6);
  // desde la galería
  await bloque(pg);
  await pg.evaluate(() => { pick(__game.works.find(w => w.vacio)); ui(); }); await pg.waitForTimeout(1200);
  await pg.setInputFiles('#bloqueArchivo', path.join(root, 'icon-192.png')); await pg.waitForTimeout(600);
  ok('desde la galería también se llena', await pg.evaluate(() => __game.held && !__game.held.work.vacio));
  await pg.tap('#drop'); await pg.waitForTimeout(300);

  const errsMuseo = pg.errs.slice(); await ctx.close();   // menos navegadores abiertos a la vez (el WebGL por software es lento)
  // 4. en una sala: A pone un bloque, B lo ve vacío y lo llena, A ve la foto. Tocar tu cara la apaga.
  const URL = 'http://localhost:8171/?db=http://localhost:8191';
  const mk = async () => { const c = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.goto(URL); await p.waitForTimeout(300); await p.tap('#start'); await p.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 });
    await p.tap('#salaBtn'); await p.fill('#salaPass', 'bloques'); await p.tap('#salaEntrar'); await p.waitForTimeout(500); return p; };
  const A = await mk(), B = await mk();
  await bloque(A);
  const idB = await A.evaluate(() => __game.works.find(w => w.vacio).id);
  ok('B ve el bloque vacío de A', await espera(B, id => __game.works.some(w => w.id === id && w.vacio), idB));
  await B.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, idB); await B.waitForTimeout(1200);
  // B lo corre, lo llena y lo suelta enseguida: tiene que quedar donde lo soltó (la subida de la imagen no pisa la pose)
  await B.evaluate(() => { const L = cur(); L.c = L.c.map(v => v * 1.4); });
  await B.tap('#llenarFoto'); await B.tap('#drop');
  const cB = await B.evaluate(id => __game.works.find(w => w.id === id).c, idB);
  ok('A ve la foto que B le puso al bloque', await espera(A, id => __game.works.some(w => w.id === id && !w.vacio), idB));
  await A.waitForTimeout(800);
  const cA = await A.evaluate(id => __game.works.find(w => w.id === id).c, idB);
  ok(`y en el lugar donde B lo soltó (${cB.map(v => v.toFixed(2))} / ${cA.map(v => v.toFixed(2))})`, Math.hypot(cA[0] - cB[0], cA[1] - cB[1], cA[2] - cB[2]) < 1e-6);
  // A tiene otro bloque en la mano mientras B lo llena; al soltarlo A no lo vacía
  await bloque(A);
  const id2 = await A.evaluate(() => __game.works.find(w => w.vacio).id);
  await espera(B, id => __game.works.some(w => w.id === id), id2);
  await A.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, id2); await A.waitForTimeout(1200);
  await B.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, id2); await B.waitForTimeout(1200);
  await B.tap('#llenarFoto'); await B.tap('#drop'); await B.waitForTimeout(800);
  await A.tap('#drop');
  ok('A lo soltó después: queda lleno para A', await espera(A, id => __game.works.some(w => w.id === id && !w.vacio), id2));
  await A.waitForTimeout(800);
  const C = await mk();
  ok('y para alguien que entra después', await espera(C, id => __game.works.some(w => w.id === id && !w.vacio), id2));
  ok('B también lo sigue viendo lleno', await B.evaluate(id => __game.works.some(w => w.id === id && !w.vacio), id2));
  const errsC = C.errs.slice(); await C.context().close();
  await A.tap('#unequip');
  ok('con la cámara guardada se ve tu cara arriba', await espera(A, () => getComputedStyle(document.getElementById('yoCara')).display !== 'none'));
  await A.tap('#yoCara'); await A.waitForTimeout(400);
  ok('tocar tu cara la apaga', await A.evaluate(() => !__game.rtc.caraOn && getComputedStyle(document.getElementById('yoCara')).display === 'none'));
  console.log('errores', errsMuseo, errsC, A.errs, B.errs);
  await b.close(); web.close(); dbSrv.close && dbSrv.close(); process.exit(0);
})();
