// v10.3.5: el toque que cierra la barra del campo de visión se traga hasta que se levanta ese dedo (no por tiempo)
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.');
(async () => {
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8165);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const ctx = await b.newContext({ ...devices['iPhone 13'], permissions: ['camera'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto('http://localhost:8165/?borrar'); await pg.goto('http://localhost:8165/'); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady);
  await pg.waitForTimeout(500);
  const fotos = () => pg.evaluate(() => __game.works.length);
  const abrirFov = async () => { await pg.tap('#menuBtn'); await pg.tap('#fov'); await pg.waitForTimeout(200); return pg.isVisible('#fovPanel'); };
  const cdp = await ctx.newCDPSession(pg);
  const toque = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const sb = await pg.$eval('#shoot', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });

  const largo = async () => { await toque('touchStart', sb[0], sb[1]); await pg.waitForTimeout(900); await toque('touchEnd'); await pg.waitForTimeout(300); };
  // 0. con la barra cerrada, un toque largo en el disparador saca foto (si no, la prueba 1 no probaría nada)
  let n0 = await fotos();
  await largo();
  ok('con la barra cerrada, un toque largo saca foto', (await fotos()) === n0 + 1);

  // 1. cerrar la barra con un toque largo (más de 600 ms) sobre el disparador: no tiene que sacar foto
  ok('abre la barra', await abrirFov());
  n0 = await fotos();
  await largo();
  ok('toque largo que cierra la barra: la cierra', !(await pg.isVisible('#fovPanel')));
  ok('toque largo que cierra la barra: no saca foto', (await fotos()) === n0);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  ok('el toque siguiente sí saca', (await fotos()) === n0 + 1);
  // lo mismo con el mouse (clic largo)
  ok('abre la barra (mouse)', await abrirFov());
  n0 = await fotos();
  await pg.mouse.move(sb[0], sb[1]); await pg.mouse.down(); await pg.waitForTimeout(900); await pg.mouse.up(); await pg.waitForTimeout(300);
  ok('clic largo que cierra la barra: no saca foto', !(await pg.isVisible('#fovPanel')) && (await fotos()) === n0);

  // 2. cerrarla arrastrando (no hay click): el toque que viene enseguida no se tiene que perder
  ok('abre la barra otra vez', await abrirFov());
  n0 = await fotos();
  ok('en (200, 300) está el canvas', await pg.evaluate(() => document.elementFromPoint(200, 300) === canvas));
  const yaw0 = await pg.evaluate(() => yawOff);
  await toque('touchStart', 200, 300); await toque('touchMove', 240, 300); await toque('touchMove', 280, 300); await toque('touchEnd');
  ok('arrastre que cierra la barra: la cierra sin girar la vista', !(await pg.isVisible('#fovPanel')) && (await pg.evaluate(() => yawOff)) === yaw0);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  ok('el toque justo después del arrastre saca foto', (await fotos()) === n0 + 1);
  const yaw1 = await pg.evaluate(() => yawOff);
  await toque('touchStart', 200, 300); await toque('touchMove', 240, 300); await toque('touchMove', 280, 300); await toque('touchEnd');
  ok('(control) el mismo arrastre sin la barra sí gira la vista', (await pg.evaluate(() => yawOff)) !== yaw1);

  // 3. lo de siempre: toque corto sobre el disparador solo cierra, y el siguiente saca
  ok('abre la barra (3)', await abrirFov());
  n0 = await fotos();
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  ok('toque corto que cierra: no saca foto', !(await pg.isVisible('#fovPanel')) && (await fotos()) === n0);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  ok('y el siguiente sí', (await fotos()) === n0 + 1);

  // 4. con el mouse (compu): clic que cierra no saca; el próximo clic sí
  ok('abre la barra (4)', await abrirFov());
  n0 = await fotos();
  await pg.mouse.click(sb[0], sb[1]); await pg.waitForTimeout(150);
  await pg.mouse.click(sb[0], sb[1]); await pg.waitForTimeout(300);
  ok('clic que cierra no saca, el siguiente (150 ms después) sí', !(await pg.isVisible('#fovPanel')) && (await fotos()) === n0 + 1);

  // 5. dos dedos: uno apoyado cerró la barra; el click de OTRO dedo pasa, y el del que cerró se traga al levantarlo
  //    (Chromium no da click con dos dedos apoyados: se arma con eventos sintéticos, en el orden de Safari)
  ok('abre la barra (5)', await abrirFov());
  n0 = await fotos();
  const r5 = await pg.evaluate(() => {
    const ev = (el, t, id, prim) => el.dispatchEvent(new PointerEvent(t, { pointerId: id, isPrimary: prim, bubbles: true, cancelable: true, pointerType: 'touch' }));
    const sh = document.getElementById('shoot');
    const n = () => __game.works.length, a = n();
    ev(canvas, 'pointerdown', 70, true);            // dedo A en el canvas: cierra la barra
    ev(sh, 'pointerdown', 71, false); ev(sh, 'pointerup', 71, false); sh.click();   // dedo B toca el disparador
    const b = n();
    ev(canvas, 'pointerup', 70, true); sh.click();   // A se levanta: su click (acá sobre el disparador) se traga
    return { cerro: getComputedStyle(document.getElementById('fovPanel')).display === 'none', a, b, c: n() };
  });
  ok('dos dedos: cierra, el otro dedo saca foto ' + JSON.stringify(r5), r5.cerro && r5.b === r5.a + 1 && r5.c === r5.b);
  // si nunca llegó el pointerup del dedo que cerró, el próximo toque (primario) no queda trabado
  ok('abre la barra (5b)', await abrirFov());
  n0 = await fotos();
  await pg.evaluate(() => canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 80, isPrimary: true, bubbles: true, cancelable: true, pointerType: 'touch' })));
  await pg.waitForTimeout(100);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  ok('sin pointerup del que cerró, el toque siguiente igual saca', !(await pg.isVisible('#fovPanel')) && (await fotos()) === n0 + 1);

  // 6. el toque que cierra la barra sobre una foto no la agarra
  const pt = await pg.evaluate(() => { for (let y = 200; y < innerHeight; y += 25) for (let x = 40; x < 380; x += 25) if (workAt(x, y) && document.elementFromPoint(x, y) === canvas) return [x, y]; return null; });
  ok('hay una foto en pantalla para tocar ' + JSON.stringify(pt), !!pt);
  if (pt) {
    ok('abre la barra (6)', await abrirFov());
    await pg.tap('canvas', { position: { x: pt[0], y: pt[1] } }); await pg.waitForTimeout(300);
    ok('el toque que cierra sobre una foto no la agarra', !(await pg.isVisible('#fovPanel')) && !(await pg.evaluate(() => __game.held)));
    await pg.tap('canvas', { position: { x: pt[0], y: pt[1] } }); await pg.waitForTimeout(300);
    ok('el siguiente toque sí la agarra', !!(await pg.evaluate(() => __game.held)));
  }

  console.log('errores', pg.errs);
  await b.close(); web.close(); process.exit(0);
})();
