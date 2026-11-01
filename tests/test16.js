// colisiones: paredes, escalones, caída
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = require('path').join(__dirname, 'out') + '/';
(async () => {
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8146);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto('http://localhost:8146/?borrar'); await pg.goto('http://localhost:8146/'); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady);
  await pg.tap('#unequip');
  await pg.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const x = cv.getContext('2d'); x.fillStyle = '#c84'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#fff'; x.fillRect(8, 8, 20, 20);
    window.__cv = cv;
    // pared frente al origen
    addWork({ id: 'pared', c: [0, 1, -2], r: [1, 0, 0], u: [0, 1, 0], w: 2, h: 2 }, cv);
    // escalera hacia -z en x = 6: tres escalones de 30 cm, después un piso a 0.9
    for (let i = 0; i < 3; i++) addWork({ id: 'esc' + i, c: [6, 0.3 * (i + 1), -1 - 0.6 * i], r: [1, 0, 0], u: [0, 0, -1], w: 1.2, h: 0.6 }, cv);
    // escalón demasiado alto en x = -6
    addWork({ id: 'alto', c: [-6, 0.8, -1.5], r: [1, 0, 0], u: [0, 0, -1], w: 1.2, h: 1 }, cv);
  });
  const walk = async (ms, x = 0, y = -1) => { await pg.evaluate(([x, y]) => { __game.joy.x = x; __game.joy.y = y; }, [x, y]); await pg.waitForTimeout(ms); await pg.evaluate(() => { __game.joy.x = 0; __game.joy.y = 0; }); await pg.waitForTimeout(300); };
  const P = () => pg.evaluate(() => __game.pos.slice());
  await pg.evaluate(() => __game.look(0, 0));
  await walk(2500);
  let p = await P();
  ok('la pared frena: z = ' + p[2].toFixed(2), p[2] > -1.85 && p[2] < -1.7);
  await pg.screenshot({ path: out + 'v8_pared.png' });
  // agarrada no choca: agarrar la pared y caminar
  await pg.tap('canvas', { position: { x: 206, y: 400 } }); await pg.waitForTimeout(1200);
  ok('agarré la pared', await pg.evaluate(() => __game.held && __game.held.work.id === 'pared'));
  await walk(800);
  ok('con la pared en la mano no choca (avancé)', (await P())[2] < -2.2);
  await pg.tap('#cancel'); await pg.waitForTimeout(300);
  // escalera
  await pg.evaluate(() => { __game.pos[0] = 6; __game.pos[2] = 0; __game.pos[1] = 1.6; });
  await walk(1350);
  p = await P();
  ok('subí la escalera: y = ' + p[1].toFixed(2), Math.abs(p[1] - (0.9 + 1.6)) < 0.02);
  await pg.screenshot({ path: out + 'v8_escalera.png' });
  await walk(1500);
  await pg.waitForTimeout(800);
  p = await P();
  ok('al salir del borde me caigo al piso: y = ' + p[1].toFixed(2), Math.abs(p[1] - 1.6) < 0.02);
  // escalón alto: no lo sube (lo atraviesa por abajo, es piso, no pared)
  await pg.evaluate(() => { __game.pos[0] = -6; __game.pos[2] = 0; __game.pos[1] = 1.6; });
  await walk(1500);
  p = await P();
  ok('un piso a 80 cm no se sube: y = ' + p[1].toFixed(2), Math.abs(p[1] - 1.6) < 0.02);
  // inicio
  await pg.evaluate(() => { __game.pos[0] = 6; __game.pos[2] = -2.2; __game.pos[1] = 2.5; });
  await pg.waitForTimeout(300);
  await pg.evaluate(() => { if (document.getElementById('opciones').style.display === 'none') document.getElementById('menuBtn').click(); }); await pg.tap('#home'); await pg.waitForTimeout(300);
  ok('inicio vuelve al piso', Math.abs((await P())[1] - 1.6) < 0.02);
  console.log('errores', pg.errs);
  await b.close(); web.close(); process.exit(0);
})();
