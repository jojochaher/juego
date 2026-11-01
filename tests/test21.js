// editor de personaje: vista en tercera persona, cuerpo x cabeza, forma, color; y que el otro lo vea
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = require('path').join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
(async () => {
  const dbSrv = await mock(8161);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8151);
  const URL = 'http://localhost:8151/?db=http://localhost:8161';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const mk = async () => { const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady); await pg.tap('#unequip'); await pg.waitForTimeout(200); return pg; };
  const A = await mk();
  // fuera de una sala también se puede editar
  await A.tap('#salaBtn'); await A.tap('#salaFuera .abrirPersonaje'); await A.waitForTimeout(600);
  ok('editor abierto', await A.isVisible('#personajePanel'));
  const hintErr = async pg => /error/.test(await pg.textContent('#hint'));
  for (const [cu, ca] of [['torso', 'esfera'], ['torso', 'cubo'], ['sin', 'esfera'], ['sin', 'cubo']]) {
    await A.tap(`[data-cuerpo="${cu}"]`); await A.tap(`[data-cabeza="${ca}"]`); await A.waitForTimeout(400);
    await A.screenshot({ path: out + `v9_pj_${cu}_${ca}.png` });
    ok(`${cu} + ${ca} sin errores`, !(await hintErr(A)));
  }
  await A.evaluate(() => { const f = document.getElementById('pjForma'); f.value = 0.9; f.dispatchEvent(new Event('input')); });
  await A.locator('#pjColores .color').nth(4).tap();
  // arrastrar arriba gira
  const ang0 = await A.evaluate(() => pjVista.ang);
  const cdp = await A.context().newCDPSession(A);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 250, id: 1 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 - i * 15, y: 250, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  ok('arrastrar gira la vista', Math.abs((await A.evaluate(() => pjVista.ang)) - ang0) > 0.3);
  await A.waitForTimeout(300);
  await A.screenshot({ path: out + 'v9_pj_girado.png' });
  await A.tap('#pjListo');
  ok('listo cierra', !(await A.isVisible('#personajePanel')) && await A.evaluate(() => pjVista === null));
  // en la sala, el otro lo ve así
  await A.tap('#salaBtn'); await A.fill('#salaPass', 'sala de personajes'); await A.tap('#salaEntrar');
  const B = await mk();
  await B.tap('#salaBtn'); await B.fill('#salaPass', 'sala de personajes'); await B.tap('#salaEntrar');
  const idA = await A.evaluate(() => __game.salaYo);
  ok('B recibe el personaje de A', await B.waitForFunction(id => { const p = __game.sala.gente.get(id); return p && p.cu && p.ca && p.fa > 1.7; }, idA, { timeout: 8000 }).then(() => true).catch(() => false));
  ok('B recibe el color nuevo', await B.evaluate(id => Math.abs(__game.sala.gente.get(id).col[0] - 0x3d / 255) < 0.02, idA));
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = -2.6; __game.look(180, -5); });
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, -8); });
  await B.waitForTimeout(4000);
  await B.screenshot({ path: out + 'v9_pj_otro.png' });
  ok('sin errores al dibujar al otro', !(await hintErr(B)));
  // con la cara en el editor
  await A.tap('#salaBtn'); await A.tap('#salaDentro .abrirPersonaje'); await A.waitForTimeout(800);
  await A.tap('[data-cuerpo="torso"]'); await A.tap('[data-cabeza="esfera"]'); await A.waitForTimeout(500);
  await A.screenshot({ path: out + 'v9_pj_cara.png' });
  ok('mi cara en el editor', await A.evaluate(() => !!(rtcYo.caraR && rtcYo.caraR.ok)));
  console.log('errores', A.errs, B.errs);
  await b.close(); web.close(); dbSrv.close(); process.exit(0);
})();
