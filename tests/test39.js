// atmósfera (v10.14, propuesta 3 parte 1): el fondo y la niebla toman el color de las fotos de alrededor
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = require('path').join(__dirname, 'out') + '/';
(async () => {
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(8391);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  let fallas = 0;
  const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto('http://localhost:8391/?borrar'); await pg.goto('http://localhost:8391/'); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady);
  await pg.tap('#unequip'); await pg.waitForTimeout(300);
  const ATM = () => pg.evaluate(() => __game.atm.slice());
  // un pixel de la pantalla (x, y en 0-1 desde arriba a la izquierda), leído justo después de dibujar
  const px = (x, y) => pg.evaluate(([x, y]) => new Promise(res => requestAnimationFrame(() => {
    const a = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * (1 - y)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); res([...a].slice(0, 3));
  })), [x, y]);
  const cerca = (a, b, t) => a.every((v, i) => Math.abs(v - b[i]) <= t);
  const f3 = a => a.map(v => v.toFixed(3)).join(',');

  // 1. museo vacío: el fondo de siempre
  await pg.evaluate(() => __game.look(0, 60)); await pg.waitForTimeout(300);
  let a = await ATM();
  ok('vacío: fondo de siempre ' + f3(a), cerca(a, [0.04, 0.04, 0.05], 0.002));
  let p = await px(0.5, 0.1);
  ok('vacío: el fondo se dibuja de ese color ' + p, cerca(p, a.map(v => v * 255), 2));

  // 2. un cuarto rojo alrededor: el fondo se vuelve rojizo (oscuro, ningún canal pasa de 0.15)
  await pg.evaluate(() => {
    const cv = n => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); x.fillStyle = n; x.fillRect(0, 0, 32, 32); return c; };
    window.__cv = cv;
    const rojo = cv('#d23020');
    addWork({ id: 'r1', c: [0, 1.5, -3], r: [1, 0, 0], u: [0, 1, 0], w: 3, h: 3 }, rojo);
    addWork({ id: 'r2', c: [-3, 1.5, 0], r: [0, 0, -1], u: [0, 1, 0], w: 3, h: 3 }, rojo);
    addWork({ id: 'r3', c: [3, 1.5, 0], r: [0, 0, 1], u: [0, 1, 0], w: 3, h: 3 }, rojo);
  });
  await pg.waitForTimeout(150);
  const a1 = await ATM();
  ok('cambia de a poco (no de golpe): ' + f3(a1), a1[0] < 0.1);
  await pg.waitForTimeout(6000);
  a = await ATM();
  ok('cuarto rojo: fondo rojizo ' + f3(a), a[0] > a[1] + 0.05 && a[0] > a[2] + 0.05);
  ok('sigue oscuro (≤ 0.15)', Math.max(...a) <= 0.1501);
  p = await px(0.5, 0.05);
  ok('el fondo se dibuja de ese color ' + p, cerca(p, a.map(v => v * 255), 3));
  await pg.evaluate(() => __game.look(0, 0)); await pg.waitForTimeout(300);
  await pg.screenshot({ path: out + 'v10.14_rojo.png' });

  // 3. un rincón azul lejos: al ir ahí cambia a azulado
  await pg.evaluate(() => {
    const azul = __cv('#2050d8');
    addWork({ id: 'a1', c: [80, 1.5, -3], r: [1, 0, 0], u: [0, 1, 0], w: 3, h: 3 }, azul);
    addWork({ id: 'a2', c: [77, 1.5, 0], r: [0, 0, -1], u: [0, 1, 0], w: 3, h: 3 }, azul);
    __game.pos[0] = 80;
  });
  await pg.waitForTimeout(6000);
  a = await ATM();
  ok('rincón azul: fondo azulado ' + f3(a), a[2] > a[0] + 0.05);
  await pg.screenshot({ path: out + 'v10.14_azul.png' });

  // 4. niebla: una foto blanca cerca se ve blanca; la misma a 48 m se funde en el fondo
  await pg.evaluate(() => {
    const bl = __cv('#ffffff');
    addWork({ id: 'b1', c: [80, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 0.6, h: 0.6 }, bl);
    addWork({ id: 'b2', c: [80, 1.6, 48], r: [-1, 0, 0], u: [0, 1, 0], w: 20, h: 20 }, bl);
    __game.look(0, 0);
  });
  await pg.waitForTimeout(800);
  p = await px(0.5, 0.5);
  ok('blanca cerca: blanca ' + p, p.every(v => v > 245));
  await pg.evaluate(() => __game.look(180, 0)); await pg.waitForTimeout(800);
  a = await ATM();
  p = await px(0.5, 0.5);
  const fondo = a.map(v => v * 255);
  ok('blanca a 48 m: casi del color del fondo ' + p + ' (fondo ' + fondo.map(Math.round) + ')', p.every((v, i) => v < fondo[i] + 70 && v > fondo[i] + 5));
  await pg.screenshot({ path: out + 'v10.14_niebla.png' });

  // 5. lo vacío y lo roto no tiñen ni rompen
  await pg.evaluate(() => {
    __game.pos[0] = -200; __game.pos[2] = 0;
    addWork({ id: 'roto', c: [NaN, 1, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1 }, __cv('#ff0000'));
    addWork({ id: 'vac', c: [-200, 1.5, -2], r: [1, 0, 0], u: [0, 1, 0], w: 3, h: 3, vacio: true }, __cv('#ff0000'));
    __game.works[__game.works.length - 1].vacio = true;
  });
  await pg.waitForTimeout(6000);
  a = await ATM();
  ok('lejos de todo, con un bloque vacío y una rota: fondo de siempre ' + f3(a), a.every(Number.isFinite) && cerca(a, [0.04, 0.04, 0.05], 0.01));

  // 6. con el fondo de color se sigue viendo el piso (el aviso del registro es relativo al fondo)
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  await pg.waitForTimeout(7000);
  const reg = await pg.evaluate(() => JSON.stringify(diagLog));
  ok('el registro no dice "no se ve el piso"', !reg.includes('no se ve el piso'));
  ok('ni "pantalla pareja"', !reg.includes('pantalla pareja'));
  ok('sin errores de dibujo', !(await pg.evaluate(() => document.getElementById('hint').textContent)).includes('error'));
  console.log('errores', pg.errs);
  ok('sin errores de JS', pg.errs.length === 0);
  await b.close(); web.close(); process.exit(0);
})();
