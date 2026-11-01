// prueba rápida (~1 min): arranca, se ve el piso, saca foto, sala con 2 que se ven, se escuchan y comparten fotos.
// uso: node tests/rapido.js .   (desde la raíz del repo)
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.');
const mock = require('./mockdb.js');
const t0 = Date.now();
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
(async () => {
  const dbSrv = await mock(8190);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8180);
  const URL = 'http://localhost:8180/?db=http://localhost:8190';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async () => { const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 }); return pg; };
  const piso = pg => pg.evaluate(() => new Promise(res => requestAnimationFrame(() => {
    const w = canvas.width, h = canvas.height, px = new Uint8Array(w * 4); let n = 0;
    for (let y = Math.floor(h * 0.1); y < h * 0.45; y += 6) { gl.readPixels(0, y, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); for (let i = 0; i < px.length; i += 4) if (px[i] > 40) n++; }
    res(n); })));
  const errHint = async pg => /error/i.test(await pg.textContent('#hint'));
  const A = await mk();
  ok('arranca y se ve el piso', (await piso(A)) > 20);
  await A.tap('#shoot'); await A.waitForTimeout(400);
  ok('saca una foto', await A.evaluate(() => __game.works.length === 1));
  await A.tap('#unequip'); await A.waitForTimeout(200);
  await A.tap('#salaBtn'); await A.fill('#salaPass', 'prueba rapida'); await A.tap('#salaEntrar');
  const B = await mk(); await B.tap('#unequip');
  await B.tap('#salaBtn'); await B.fill('#salaPass', 'prueba rapida'); await B.tap('#salaEntrar');
  const idA = await A.evaluate(() => __game.salaYo), idB = await B.evaluate(() => __game.salaYo);
  const espera = (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  ok('se ven en la sala', await espera(A, id => __game.sala.gente.has(id), idB) && await espera(B, id => __game.sala.gente.has(id), idA));
  ok('conexión de video/voz', await espera(A, id => { const p = __game.rtc.peers.get(id); return p && p.pc.connectionState === 'connected'; }, idB, 20000));
  ok('A recibe la cara y la voz de B', await espera(A, id => { const p = __game.rtc.peers.get(id); return p && p.video && p.video.videoWidth > 0 && p.audio; }, idB));
  await B.tap('#equip'); await B.waitForFunction(() => __game.camReady); await B.tap('#shoot'); await B.waitForTimeout(500);
  ok('A ve la foto que saca B', await espera(A, () => __game.works.length === 1, null, 8000));
  ok('se sigue viendo el piso en la sala', (await piso(A)) > 20);
  ok('sin errores', !(await errHint(A)) && !(await errHint(B)) && !A.errs.length && !B.errs.length);
  if (A.errs.length || B.errs.length) console.log('errores', A.errs, B.errs);
  console.log(`\n${fallas ? fallas + ' FALLAS' : 'TODO OK'} en ${Math.round((Date.now() - t0) / 1000)} s`);
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
