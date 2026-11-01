// v10: menú ☰ y edición plegada
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
(async () => {
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8164);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const ctx = await b.newContext({ ...devices['iPhone 13'], permissions: ['camera'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto('http://localhost:8164/?borrar'); await pg.goto('http://localhost:8164/'); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady);
  await pg.waitForTimeout(5500);   // que se vaya el texto de ayuda
  const topVis = await pg.$$eval('#top .pill', els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.textContent));
  ok('arriba solo sala y ☰: ' + JSON.stringify(topVis), topVis.length === 2);
  ok('al editar: solo grilla y ajustar (modos plegados)', await pg.isVisible('#edicion') && !(await pg.isVisible('#modes')));
  await pg.screenshot({ path: out + 'v10_camara.png' });
  await pg.tap('#ajustar');
  ok('ajustar despliega los modos', await pg.isVisible('#modes'));
  await pg.tap('[data-m="recortar"]');
  ok('recortar activo', await pg.evaluate(() => __game.mode === 'recortar'));
  await pg.tap('[data-m="recortar"]');
  ok('tocarlo de nuevo vuelve a mover', await pg.evaluate(() => __game.mode === 'mover'));
  await pg.tap('[data-m="girar"]'); await pg.tap('#ajustar');
  ok('plegar vuelve a mover', await pg.evaluate(() => __game.mode === 'mover') && !(await pg.isVisible('#modes')));
  // menú
  await pg.tap('#menuBtn'); await pg.waitForTimeout(200);
  ok('☰ abre opciones', await pg.isVisible('#opciones'));
  ok('sin giroscopio no aparece su botón', !(await pg.isVisible('#gyroT')));
  ok('en el celu no aparecen los atajos de teclado', !(await pg.isVisible('#opcAtajos')));
  await pg.screenshot({ path: out + 'v10_menu.png' });
  await pg.evaluate(() => { __game.pos[0] = 3; });
  await pg.tap('#home'); await pg.waitForTimeout(200);
  ok('volver al inicio funciona y cierra el menú', await pg.evaluate(() => __game.pos[0] === 0) && !(await pg.isVisible('#opciones')));
  await pg.tap('#menuBtn'); await pg.tap('#fov'); await pg.waitForTimeout(200);
  ok('campo de visión abre su barra', await pg.isVisible('#fovPanel'));
  await pg.tap('canvas', { position: { x: 200, y: 200 } }); await pg.waitForTimeout(200);
  ok('tocar afuera la cierra', !(await pg.isVisible('#fovPanel')));
  await pg.tap('#menuBtn'); await pg.tap('#fov'); await pg.waitForTimeout(200);
  const n0 = await pg.evaluate(() => __game.works.length);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  ok('el toque que la cierra no saca foto', !(await pg.isVisible('#fovPanel')) && (await pg.evaluate(() => __game.works.length)) === n0);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  ok('el siguiente toque sí', (await pg.evaluate(() => __game.works.length)) === n0 + 1);
  await pg.tap('#menuBtn'); await pg.tap('#inv');
  ok('arrastre se cambia desde el menú', await pg.evaluate(() => __game.invertLook) && await pg.isVisible('#opciones'));
  await pg.tap('#inv'); await pg.tap('#opcCerrar');
  await pg.tap('#menuBtn'); await pg.tap('#opciones .abrirPersonaje'); await pg.waitForTimeout(300);
  ok('tu personaje desde el menú', await pg.isVisible('#personajePanel') && !(await pg.isVisible('#opciones')));
  await pg.tap('#pjListo');
  // pellizcar sin girar: agranda y no tuerce (el giro tiene zona muerta)
  const L0 = await pg.evaluate(() => ({ w: __game.preview.w, r: __game.preview.r.slice() }));
  const cdp = await pg.context().newCDPSession(pg);
  const tp = (a, b) => [{ x: a[0], y: a[1], id: 1 }, { x: b[0], y: b[1], id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([150, 400], [240, 400]) });
  for (let i = 1; i <= 10; i++) { const a = 0.012 * i; const d = 45 + i * 6; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([195 - d * Math.cos(a), 400 - d * Math.sin(a)], [195 + d * Math.cos(a), 400 + d * Math.sin(a)]) }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const L1 = await pg.evaluate(() => ({ w: __game.preview.w, r: __game.preview.r.slice() }));
  const dr = Math.hypot(L1.r[0] - L0.r[0], L1.r[1] - L0.r[1], L1.r[2] - L0.r[2]);
  ok(`pellizcar agranda (${(L1.w / L0.w).toFixed(2)}x) sin torcer (${dr.toFixed(3)})`, L1.w > L0.w * 1.5 && dr < 1e-6);
  // girar a propósito sí gira
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([150, 400], [240, 400]) });
  for (let i = 1; i <= 10; i++) { const a = 0.06 * i; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([195 - 45 * Math.cos(a), 400 - 45 * Math.sin(a)], [195 + 45 * Math.cos(a), 400 + 45 * Math.sin(a)]) }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const L2 = await pg.evaluate(() => __game.preview.r.slice());
  ok('girar a propósito gira', Math.hypot(L2[0] - L1.r[0], L2[1] - L1.r[1], L2[2] - L1.r[2]) > 0.2);
  // joystick a fondo: acelera
  await pg.evaluate(() => { __game.works.length = 0; __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); __game.joy.y = -1; });
  await pg.waitForTimeout(3000);
  const z = await pg.evaluate(() => { __game.joy.y = 0; return __game.pos[2]; });
  ok(`a fondo acelera (${(-z).toFixed(1)} m en 3 s; sin acelerar serían 4.8)`, -z > 5.6);
  console.log('errores', pg.errs);
  await b.close(); web.close(); process.exit(0);
})();
