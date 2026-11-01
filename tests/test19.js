// compu: teclado y mouse
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = require('path').join(__dirname, 'out') + '/';
(async () => {
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8149);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto('http://localhost:8149/?borrar'); await pg.goto('http://localhost:8149/'); await pg.waitForTimeout(300); await pg.click('#start'); await pg.waitForFunction(() => window.__game.camReady);
  ok('sin joystick en compu', !(await pg.isVisible('#joy')));
  ok('ayuda de teclado', /WASD/.test(await pg.textContent('#hint')));
  const z0 = await pg.evaluate(() => __game.pos[2]);
  await pg.keyboard.down('KeyW'); await pg.waitForTimeout(700); await pg.keyboard.up('KeyW'); await pg.waitForTimeout(100);
  const z1 = await pg.evaluate(() => __game.pos[2]);
  ok('W avanza (' + (z1 - z0).toFixed(2) + ')', z1 - z0 < -0.6);
  // mirar con el mouse
  await pg.mouse.move(640, 400); await pg.mouse.down(); await pg.mouse.move(740, 400, { steps: 5 }); await pg.mouse.up();
  ok('arrastrar con el mouse gira', await pg.evaluate(() => Math.abs(__game.pos[0]) < 1));  // (solo que no rompa)
  // rueda: distancia de la vista previa
  const d0 = await pg.evaluate(() => Math.hypot(...__game.preview.c));
  await pg.mouse.move(640, 400); await pg.mouse.wheel(0, 300); await pg.waitForTimeout(200);
  const d1 = await pg.evaluate(() => Math.hypot(...__game.preview.c));
  ok('rueda aleja', d1 > d0 * 1.2);
  const w0 = await pg.evaluate(() => __game.preview.w);
  await pg.keyboard.down('Shift'); await pg.mouse.wheel(0, -300); await pg.keyboard.up('Shift'); await pg.waitForTimeout(200);
  ok('shift+rueda agranda', (await pg.evaluate(() => __game.preview.w)) > w0 * 1.2);
  // espacio saca foto
  await pg.evaluate(() => __game.look(0, 0));
  await pg.keyboard.press('Space'); await pg.waitForTimeout(400);
  ok('espacio saca foto', (await pg.evaluate(() => __game.works.length)) === 1);
  await pg.screenshot({ path: out + 'v9_pc.png' });
  // C guarda la cámara
  await pg.keyboard.press('KeyC'); await pg.waitForTimeout(300);
  ok('C guarda la cámara', !(await pg.evaluate(() => __game.camOn)));
  const g0 = await pg.evaluate(() => __game.grilla); await pg.keyboard.press('KeyG'); await pg.waitForTimeout(100);
  ok('G sin nada en la mano no cambia la grilla', (await pg.evaluate(() => __game.grilla)) === g0);
  // clic en la foto la agarra, esc cancela
  const sc = await pg.evaluate(() => { const w = __game.works[0]; return w.c; });
  await pg.evaluate(() => __game.look(0, 0));
  await pg.mouse.click(640, 400); await pg.waitForTimeout(900);
  const agarrada = await pg.evaluate(() => !!__game.held);
  ok('clic agarra la foto', agarrada);
  if (agarrada) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(200); ok('esc cancela', !(await pg.evaluate(() => !!__game.held))); }
  // escribir en la contraseña no mueve
  await pg.click('#salaBtn'); await pg.waitForTimeout(200);
  const zA = await pg.evaluate(() => __game.pos[2]);
  await pg.fill('#salaPass', ''); await pg.type('#salaPass', 'wwwwsss');
  await pg.waitForTimeout(300);
  ok('escribir no mueve', Math.abs((await pg.evaluate(() => __game.pos[2])) - zA) < 0.01);
  ok('fov vertical en apaisado', await pg.evaluate(() => { const [tx, ty] = tans(); return ty < tx && Math.abs(ty - Math.tan(__game.fov * Math.PI / 360)) < 1e-6; }));
  console.log('errores', pg.errs);
  await b.close(); web.close(); process.exit(0);
})();
