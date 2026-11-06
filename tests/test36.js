// encontrarse, parte 2 (v10.10, propuesta 13): tocar a alguien en 3D abre "ir ahí / seguir"; seguir camina solo
// hasta quedar a 1,5 m y gira la vista con la suya; si se va lejos o te trabás, aparecés detrás; el joystick,
// arrastrar, el botón "siguiendo ✕" o salir de la sala lo cortan. Una foto delante de la persona se agarra (no la persona).
// uso: node tests/test36.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8362);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8361);
  const URL = 'http://localhost:8361/?db=http://localhost:8362';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async () => { const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 }); return pg; };
  const espera = (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const entrar = async pg => { await pg.tap('#unequip'); await pg.tap('#salaBtn'); await pg.fill('#salaPass', 'prueba seguir'); await pg.tap('#salaEntrar'); };
  const A = await mk(); await entrar(A);
  const B = await mk(); await entrar(B);
  const idA = await A.evaluate(() => __game.salaYo), idB = await B.evaluate(() => __game.salaYo);
  ok('se ven en la sala', await espera(A, id => __game.sala.gente.has(id), idB) && await espera(B, id => __game.sala.gente.has(id), idA));
  // dónde se ve el pecho de B en la pantalla de A
  const dondeB = () => A.evaluate(id => {
    const q = __game.sala.gente.get(id).disp.p, [tx, ty] = tans(), l = toLocalV(basis(), sub([q[0], q[1] - 0.6, q[2]], __game.pos));
    return [innerWidth / 2 + l[0] / l[2] / tx * innerWidth / 2, innerHeight / 2 - l[1] / l[2] / ty * innerHeight / 2];
  }, idB);
  const heading = pg => pg.evaluate(() => { const f = basis().f; return Math.atan2(-f[0], -f[2]); });
  const distAB = async () => { const pa = await A.evaluate(() => __game.pos.slice()), pb = await B.evaluate(() => __game.pos.slice()); return Math.hypot(pa[0] - pb[0], pa[2] - pb[2]); };
  const angDif = (a, c) => Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c)));

  // B adelante de A, mirando hacia la derecha
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = -5; __game.look(90, 0); });
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  await espera(A, id => { const p = __game.sala.gente.get(id).disp.p; return Math.abs(p[2] + 5) < 0.05 && Math.abs(p[0]) < 0.05; }, idB, 5000);
  await A.waitForTimeout(500);
  // tocar al lado (donde no hay nadie) no abre nada
  await A.tap('canvas', { position: { x: 40, y: 300 } });
  ok('tocar el vacío no abre nada', !(await A.isVisible('#lejosOps')));
  let [x, y] = await dondeB();
  await A.tap('canvas', { position: { x: Math.round(x), y: Math.round(y) } });
  ok('tocar a B en 3D muestra "ir ahí" y "seguir"', await A.isVisible('#lejosIr') && await A.isVisible('#lejosSeguir') && (await A.textContent('#lejosSeguir')) === 'seguir');
  await A.screenshot({ path: out + 'v1010_opciones.png' });
  // las opciones quedan cerca de B (debajo de su cabeza)
  const r = await A.evaluate(() => document.getElementById('lejosOps').getBoundingClientRect());
  ok('las opciones están cerca de B (' + Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2) + ' vs ' + Math.round(x) + ',' + Math.round(y) + ')', Math.abs(r.x + r.width / 2 - x) < 100 && Math.abs(r.y + r.height / 2 - y) < 150);
  await A.tap('#lejosSeguir');
  ok('siguiendo: aparece "siguiendo ✕" y se fue el menú', await A.isVisible('#siguiendo') && !(await A.isVisible('#lejosOps')));
  ok('miro para donde mira B', angDif(await heading(A), await heading(B)) < 0.05);
  await A.screenshot({ path: out + 'v1010_siguiendo.png' });
  ok('camina hasta quedar a 1,5 m', await (async () => { for (let i = 0; i < 30; i++) { await A.waitForTimeout(200); const d = await distAB(); if (Math.abs(d - 1.5) < 0.25) return true; } return false; })());
  // B camina: A lo sigue
  await B.evaluate(() => { __game.pos[0] = 3; __game.pos[2] = -1; });
  await A.waitForTimeout(3500);
  let d = await distAB();
  ok('B camina 4 m: A lo sigue y queda a ~1,5 m (' + d.toFixed(2) + ')', d > 1.3 && d < 2.0);
  // B gira: A gira lo mismo
  const hA0 = await heading(A);
  await B.evaluate(() => __game.look(0, 0));     // de mirar a +x (yaw -90°) a mirar a -z: 90° a la izquierda
  await A.waitForTimeout(1500);
  const hA1 = await heading(A);
  ok('B gira 90°: A gira lo mismo (' + ((hA1 - hA0) * 180 / Math.PI).toFixed(0) + '°)', angDif(hA1 - hA0, Math.PI / 2) < 0.1);
  // B salta lejos: A aparece detrás suyo
  await B.evaluate(() => { __game.pos[0] = 40; __game.pos[2] = 40; __game.look(0, 0); });
  ok('B se va lejos: A aparece cerca', await (async () => { for (let i = 0; i < 25; i++) { await A.waitForTimeout(200); if (await distAB() < 2.2) return true; } return false; })());
  const pa = await A.evaluate(() => __game.pos.slice());
  ok('detrás de B (' + pa.map(v => v.toFixed(2)) + ')', pa[2] > 40.8);
  ok('sigue siguiendo', await A.isVisible('#siguiendo'));
  // una pared en el medio: A se traba y aparece del otro lado
  const pared = async pg => pg.evaluate(() => { const cv = document.createElement('canvas'); cv.width = cv.height = 8; addWork({ id: 'pared36', c: [40, 1.5, 38], r: [1, 0, 0], u: [0, 1, 0], w: 8, h: 3 }, cv); });
  await pared(A);
  await B.evaluate(() => { __game.pos[0] = 40; __game.pos[2] = 34; });
  ok('con una pared en el medio: se traba y aparece del otro lado', await (async () => { for (let i = 0; i < 30; i++) { await A.waitForTimeout(200); const p = await A.evaluate(() => __game.pos[2]); if (p < 38) return true; } return false; })());
  d = await distAB();
  ok('quedó cerca de B (' + d.toFixed(2) + ')', d < 2.2);
  // B se da vuelta (A también: queda de espaldas a B y aparece su carita); tocarla: "dejar de seguir"
  await B.evaluate(() => { __game.pos[0] = 40; __game.pos[2] = 30; __game.look(180, 0); });
  await A.waitForTimeout(2500);
  ok('B se da vuelta: A también, y B queda atrás con su carita', await espera(A, () => document.querySelectorAll('#lejos .lejos').length === 1 && getComputedStyle(document.getElementById('lejos')).display !== 'none', null, 4000));
  d = await distAB();
  ok('sigue a 1,5 m (' + d.toFixed(2) + ')', Math.abs(d - 1.5) < 0.3);
  await A.tap('#lejos .lejos');
  ok('tocar su carita mientras lo sigo ofrece "dejar de seguir"', await A.isVisible('#lejosSeguir') && (await A.textContent('#lejosSeguir')) === 'dejar de seguir');
  await A.tap('#lejosSeguir');
  ok('"dejar de seguir" lo corta', !(await A.isVisible('#siguiendo')));
  // el joystick lo corta
  const seguirDeNuevo = async () => { await A.evaluate(id => salaSeguir(id), idB); return A.isVisible('#siguiendo'); };
  ok('seguir de nuevo', await seguirDeNuevo());
  await A.tap('#joy');
  ok('tocar el joystick lo corta', !(await A.isVisible('#siguiendo')) && /dejaste de seguir/.test(await A.textContent('#hint')));
  // arrastrar para mirar lo corta
  await seguirDeNuevo();
  const cdp = await A.context().newCDPSession(A);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 400 }] });
  for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120 + i * 12, y: 400 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await A.waitForTimeout(200);
  ok('arrastrar para mirar lo corta', !(await A.isVisible('#siguiendo')));
  // el botón "siguiendo ✕" lo corta
  await seguirDeNuevo();
  await A.tap('#siguiendo');
  ok('"siguiendo ✕" lo corta', !(await A.isVisible('#siguiendo')));
  // "volver al inicio" lo corta
  await seguirDeNuevo();
  await A.tap('#menuBtn'); await A.tap('#home');
  await A.waitForTimeout(400);
  ok('"volver al inicio" lo corta (y me quedo en el inicio)', !(await A.isVisible('#siguiendo')) && await A.evaluate(() => Math.hypot(__game.pos[0], __game.pos[2]) < 0.3));
  if (await A.isVisible('#opciones')) await A.tap('#menuBtn');
  // los dos se siguen: no giran sin parar
  await B.evaluate(() => { __game.pos[0] = 20; __game.pos[2] = 0; __game.look(0, 0); });
  await A.evaluate(() => { __game.pos[0] = 20; __game.pos[2] = 3; __game.look(0, 0); });
  await A.waitForTimeout(800);
  await A.evaluate(id => salaSeguir(id), idB); await B.evaluate(id => salaSeguir(id), idA);
  await B.evaluate(() => { __game.look(45, 0); });
  await A.waitForTimeout(2500);
  const h1 = [await heading(A), await heading(B)];
  await A.waitForTimeout(2500);
  const h2 = [await heading(A), await heading(B)];
  ok('A y B se siguen mutuamente: las vistas quedan quietas (' + (angDif(h1[0], h2[0]) * 57.3).toFixed(1) + '°, ' + (angDif(h1[1], h2[1]) * 57.3).toFixed(1) + '°)', angDif(h1[0], h2[0]) < 0.05 && angDif(h1[1], h2[1]) < 0.05);
  await B.evaluate(() => salaDejarDeSeguir('prueba')); await A.evaluate(() => salaDejarDeSeguir('prueba'));
  // B a 2,5 m pero detrás de una pared: A se traba contra la pared y aparece del otro lado
  await A.evaluate(() => { const cv = document.createElement('canvas'); cv.width = cv.height = 8; addWork({ id: 'pared36b', c: [60, 1.5, -1.2], r: [1, 0, 0], u: [0, 1, 0], w: 6, h: 3 }, cv); __game.pos[0] = 60; __game.pos[2] = 0; __game.look(0, 0); });
  await B.evaluate(() => { __game.pos[0] = 60; __game.pos[2] = -2.5; __game.look(180, 0); });
  await espera(A, id => Math.abs(__game.sala.gente.get(id).disp.p[2] + 2.5) < 0.05 && Math.abs(__game.sala.gente.get(id).disp.p[0] - 60) < 0.05, idB, 5000);
  await A.evaluate(id => salaSeguir(id), idB);
  ok('a 2,5 m del otro lado de una pared: aparece de su lado', await (async () => { for (let i = 0; i < 30; i++) { await A.waitForTimeout(200); if (await A.evaluate(() => __game.pos[2]) < -1.3) return true; } return false; })());
  await A.evaluate(() => salaDejarDeSeguir('prueba'));
  // B arriba de algo que A no tiene (no hay cómo llegar): después de unos intentos deja de seguir
  await B.evaluate(() => { __game.pos[0] = 80; __game.pos[1] = 4.6; __game.pos[2] = 0; const cv = document.createElement('canvas'); cv.width = cv.height = 8; addWork({ id: 'plat36', c: [80, 3, 0], r: [1, 0, 0], u: [0, 0, -1], w: 1, h: 1 }, cv); });
  await A.evaluate(() => { __game.pos[0] = 78; __game.pos[2] = 0; });
  await espera(A, id => __game.sala.gente.get(id).disp.p[1] > 4.5, idB, 5000);
  await A.evaluate(id => salaSeguir(id), idB);
  ok('si no llega (aparece y se cae una y otra vez), deja de seguir y avisa', await espera(A, () => getComputedStyle(document.getElementById('siguiendo')).display === 'none' && /no llego/.test(document.getElementById('hint').textContent), null, 16000));
  await B.evaluate(() => { const i = __game.works.findIndex(w => w.id === 'plat36'); __game.works.splice(i, 1); __game.pos[1] = 1.6; });
  // agarrar una foto mientras sigo lo corta
  await A.evaluate(() => { __game.pos[0] = 40; __game.pos[1] = 1.6; __game.pos[2] = 26; __game.look(0, 0); });
  await B.evaluate(() => { __game.pos[0] = 40; __game.pos[1] = 1.6; __game.pos[2] = 22; __game.look(0, 0); });
  await A.waitForTimeout(800);
  await seguirDeNuevo();
  await A.waitForTimeout(300);
  await A.evaluate(() => { const cv = document.createElement('canvas'); cv.width = cv.height = 8; addWork({ id: 'agarrar36', c: [__game.pos[0], 1.4, __game.pos[2] - 0.9], r: [1, 0, 0], u: [0, 1, 0], w: 0.8, h: 0.8 }, cv); });
  await A.tap('canvas', { position: { x: 206, y: 500 } });
  await A.waitForTimeout(300);
  ok('agarrar una foto corta el seguir', !(await A.isVisible('#siguiendo')) && await A.evaluate(() => !!__game.held));
  await A.tap('#cancel').catch(() => {});
  await A.evaluate(() => { const i = __game.works.findIndex(w => w.id === 'agarrar36'); if (i >= 0) __game.works.splice(i, 1); });
  await A.waitForTimeout(300);
  // una foto delante de B: tocar ahí agarra la foto, no a la persona
  await A.evaluate(() => { __game.pos[0] = 40; __game.pos[2] = 26; __game.look(0, 0); });
  await B.evaluate(() => { __game.pos[0] = 40; __game.pos[2] = 22; });
  await A.evaluate(() => { const cv = document.createElement('canvas'); cv.width = cv.height = 8; cv.getContext('2d').fillStyle = '#c33'; cv.getContext('2d').fillRect(0, 0, 8, 8); addWork({ id: 'tapa36', c: [40, 1.3, 24], r: [1, 0, 0], u: [0, 1, 0], w: 1.5, h: 1.5 }, cv); });
  await espera(A, id => Math.abs(__game.sala.gente.get(id).disp.p[2] - 22) < 0.05, idB, 5000);
  [x, y] = await dondeB();
  await A.tap('canvas', { position: { x: Math.round(x), y: Math.round(y) } });
  await A.waitForTimeout(300);
  ok('con una foto delante de B, tocar agarra la foto', !(await A.isVisible('#lejosOps')) && await A.evaluate(() => !!__game.held));
  await A.tap('#cancel').catch(() => {});
  await A.waitForTimeout(300);
  // datos rotos de la otra persona: no se mueve ni se rompe la vista
  await A.evaluate(() => { const i = __game.works.findIndex(w => w.id === 'tapa36'); if (i >= 0) __game.works.splice(i, 1); });
  await seguirDeNuevo();
  await A.evaluate(id => { const p = __game.sala.gente.get(id); p.disp.yaw = NaN; }, idB);
  await A.waitForTimeout(300);
  ok('con datos rotos no se rompe la vista', await A.evaluate(() => __game.pos.every(Number.isFinite) && basis().f.every(Number.isFinite)));
  // B se va de la sala: se corta
  await A.waitForTimeout(500);
  await B.tap('#salaBtn'); await B.tap('#salaSalir');
  ok('B se va: se corta el seguir', await espera(A, () => getComputedStyle(document.getElementById('siguiendo')).display === 'none', null, 8000));
  // seguir y salir yo de la sala
  const C = await mk(); await entrar(C);
  const idC = await C.evaluate(() => __game.salaYo);
  await espera(A, id => __game.sala.gente.has(id), idC);
  await A.evaluate(id => salaSeguir(id), idC);
  ok('sigo a C', await A.isVisible('#siguiendo'));
  await A.tap('#salaBtn'); await A.tap('#salaSalir');
  await A.waitForTimeout(300);
  ok('salgo de la sala: se corta, sin decir que se fue', !(await A.isVisible('#siguiendo')) && !/se fue/.test(await A.textContent('#hint')));
  const err = pg => pg.textContent('#hint').then(t => /error/i.test(t));
  ok('sin errores', !(await err(A)) && !(await err(B)) && !(await err(C)) && !A.errs.length && !B.errs.length && !C.errs.length);
  if (A.errs.length || B.errs.length || C.errs.length) console.log('errores', A.errs, B.errs, C.errs);
  console.log(`\n${fallas ? fallas + ' FALLAS' : 'TODO OK'}`);
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
