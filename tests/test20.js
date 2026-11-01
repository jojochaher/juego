// mis salas: registro, entrar con un toque, ver fotos, borrar foto, borrar sala
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = require('path').join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
(async () => {
  const dbSrv = await mock(8160);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8150);
  const URL = 'http://localhost:8150/?db=http://localhost:8160';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady);
  const entrar = async pass => { await pg.tap('#salaBtn'); if (await pg.isVisible('#salaSalir')) { await pg.tap('#salaSalir'); await pg.tap('#salaBtn'); } await pg.fill('#salaPass', pass); await pg.tap('#salaEntrar'); await pg.waitForTimeout(600); };
  await entrar('primera sala');
  for (let i = 0; i < 3; i++) { await pg.evaluate(i => __game.look(i * 40 - 40, 0), i); await pg.tap('#shoot'); await pg.waitForTimeout(500); }
  await entrar('segunda sala');
  await pg.tap('#shoot'); await pg.waitForTimeout(500);
  await pg.tap('#salaBtn'); await pg.tap('#salaDentro .abrirSalas'); await pg.waitForTimeout(300);
  const filas = await pg.$$eval('.salaFila', fs => fs.map(f => f.textContent));
  ok('lista con las dos salas (la más nueva primero): ' + JSON.stringify(filas), filas.length === 2 && /segunda/.test(filas[0]) && /estás acá/.test(filas[0]) && /primera/.test(filas[1]));
  await pg.screenshot({ path: out + 'v9_salas.png' });
  // ver la primera
  await pg.locator('.salaFila').nth(1).locator('text=ver').tap();
  await pg.waitForFunction(() => document.querySelectorAll('#salasFotos .miniFoto img').length === 3, null, { timeout: 8000 }).catch(() => {});
  ok('3 miniaturas', (await pg.$$('#salasFotos .miniFoto img')).length === 3);
  ok('cuenta 3 fotos', /3 fotos/.test(await pg.textContent('#salasCuenta')));
  await pg.screenshot({ path: out + 'v9_salas_ver.png' });
  // borrar una
  await pg.locator('#salasFotos .miniFoto .x').first().tap(); await pg.waitForTimeout(500);
  ok('borrar una foto', (await pg.$$('#salasFotos .miniFoto')).length === 2 && /2 fotos/.test(await pg.textContent('#salasCuenta')));
  // entrar desde el detalle
  await pg.tap('#salasEntrar'); await pg.waitForTimeout(1500);
  ok('entré a la primera con un toque', await pg.evaluate(() => __game.sala.active && __game.works.length === 2));
  await pg.tap('#salaBtn');
  ok('se ve la contraseña de la sala a la que entré', /primera sala|•/.test(await pg.textContent('#salaClave')));
  await pg.tap('#salaVer2'); ok('y es la correcta', (await pg.textContent('#salaClave')) === 'primera sala');
  // borrar la segunda sala desde la lista
  await pg.tap('#salaDentro .abrirSalas'); await pg.waitForTimeout(300);
  await pg.locator('.salaFila', { hasText: 'segunda' }).locator('text=ver').tap(); await pg.waitForTimeout(800);
  await pg.tap('#salasBorrar'); ok('pide confirmar', /seguro/.test(await pg.textContent('#salasBorrar')));
  await pg.tap('#salasBorrar'); await pg.waitForTimeout(800);
  const dump = await (await fetch('http://localhost:8160/__dump')).json();
  const salas = Object.values(dump.salas || {});
  ok('la segunda quedó sin fotos y la primera con 2', salas.filter(s => s.poses).length === 1 && Object.keys(salas.find(s => s.poses).poses).length === 2);
  ok('la segunda salió de la lista', (await pg.$$('.salaFila')).length === 1);
  // recargar: la lista persiste
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForTimeout(500);
  ok('al recargar sigue en la sala', await pg.evaluate(() => __game.sala.active));
  console.log('errores', pg.errs);
  await b.close(); web.close(); dbSrv.close(); process.exit(0);
})();
