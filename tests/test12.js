const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = require('path').join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
(async () => {
  const dbSrv = await mock(8153);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8143);
  const URL = 'http://localhost:8143/?db=http://localhost:8153';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const mk = async () => { const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message)); await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForTimeout(500); return pg; };
  const join = async (pg) => { await pg.tap('#salaBtn'); await pg.fill('#salaPass', 'museo de prueba'); await pg.tap('#salaEntrar'); };
  const leave = async (pg) => { await pg.tap('#salaBtn'); await pg.tap('#salaSalir'); };
  const sees = (pg, id, ms = 3000) => pg.waitForFunction(id => __game.sala.gente.has(id), id, { timeout: ms }).then(() => true).catch(() => false);
  const notSees = (pg, id, ms = 3000) => pg.waitForFunction(id => !__game.sala.gente.has(id), id, { timeout: ms }).then(() => true).catch(() => false);
  const setHidden = (pg, h) => pg.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, h);

  const A = await mk(), B = await mk();
  const idA = await A.evaluate(() => __game.salaYo), idB = await B.evaluate(() => __game.salaYo);
  // mostrar contraseña
  await A.tap('#salaBtn'); await A.fill('#salaPass', 'museo de prueba');
  ok('la contraseña arranca oculta', await A.getAttribute('#salaPass', 'type') === 'password');
  await A.tap('#salaVer');
  ok('"ver" la muestra', await A.getAttribute('#salaPass', 'type') === 'text' && await A.textContent('#salaVer') === 'ocultar');
  await A.tap('#salaVer');
  ok('"ocultar" la vuelve a esconder', await A.getAttribute('#salaPass', 'type') === 'password');
  await A.tap('#salaEntrar'); await join(B);
  ok('se ven al entrar', await sees(A, idB) && await sees(B, idA));
  // B sale y vuelve a entrar enseguida, sin moverse
  for (let i = 1; i <= 3; i++) {
    await leave(B);
    ok(`vuelta ${i}: A ve que B se fue`, await notSees(A, idB));
    await join(B);
    ok(`vuelta ${i}: A ve a B de nuevo en menos de 2 s`, await sees(A, idB, 2000));
    ok(`vuelta ${i}: B ve a A`, await sees(B, idA, 2000));
  }
  // salida y entrada instantáneas (sin esperar)
  await leave(B); await join(B);
  await A.waitForTimeout(2500);
  ok('salir y entrar al toque: A sigue viendo a B', await A.evaluate(id => __game.sala.gente.has(id), idB));
  // A pasa al fondo: el "celu" corta sus conexiones sin avisar
  await setHidden(A, true);
  await fetch('http://localhost:8153/__freeze');
  ok('B ve que A se fue al fondo', await notSees(B, idA));
  await leave(B); await join(B);
  await B.evaluate(() => { __game.pos[0] = 3; });
  await A.waitForTimeout(1500);
  await setHidden(A, false);
  ok('A vuelve: ve a B', await sees(A, idB, 3000));
  ok('A vuelve: ve dónde está B ahora', await A.waitForFunction(id => { const p = __game.sala.gente.get(id); return p && Math.abs(p.target.p[0] - 3) < 0.01; }, idB, { timeout: 3000 }).then(() => true).catch(() => false));
  ok('B ve a A de nuevo', await sees(B, idA, 3000));
  // y las fotos también se sincronizan después de volver
  await B.tap('#shoot').catch(async () => { await B.tap('#equip'); await B.waitForTimeout(1500); await B.tap('#shoot'); });
  ok('A recibe una foto nueva después de volver', await A.waitForFunction(() => __game.works.length >= 1, null, { timeout: 5000 }).then(() => true).catch(() => false));
  console.log('errores', A.errs, B.errs);
  await b.close(); web.close(); dbSrv.close(); process.exit(0);
})();
