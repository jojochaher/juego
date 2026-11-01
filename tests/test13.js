// caras al volver a entrar (recargar / salir y entrar)
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
  const mk = async () => { const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady); await pg.tap('#unequip'); await pg.waitForTimeout(200);
    await pg.tap('#salaBtn'); await pg.fill('#salaPass', 'museo de prueba'); await pg.tap('#salaEntrar'); return pg; };
  const A = await mk(), B = await mk();
  const idA = await A.evaluate(() => __game.salaYo), idB = await B.evaluate(() => __game.salaYo);
  console.log('idA<idB', idA < idB);
  // la cara llega viva: el video avanza
  const veCara = async (P, id, ms = 15000) => P.waitForFunction(async id => {
    const p = __game.rtc.peers.get(id); if (!p || !p.video || !p.video.videoWidth || p.video.paused) return false;
    const t0 = p.video.currentTime; await new Promise(r => setTimeout(r, 300)); return p.video.currentTime > t0;
  }, id, { timeout: ms, polling: 500 }).then(() => true).catch(() => false);
  ok('A ve la cara de B', await veCara(A, idB));
  ok('B ve la cara de A', await veCara(B, idA));
  // B recarga (vuelve a la sala sola al abrir)
  await B.reload(); await B.waitForTimeout(400);
  ok('antes de tocar entrar, B no pide cámara ni mic', await B.evaluate(() => !__game.rtc.cara && !__game.rtc.mic));
  await B.tap('#start'); await B.waitForTimeout(500);
  ok('después de recargar, B tiene cara propia', await B.waitForFunction(() => __game.rtc.cara, null, { timeout: 8000 }).then(() => true).catch(() => false));
  ok('después de recargar, A ve la cara de B', await veCara(A, idB));
  ok('después de recargar, B ve la cara de A', await veCara(B, idA));
  // B sale y vuelve a entrar desde el panel
  for (let i = 0; i < 2; i++) {
    await B.tap('#salaBtn'); await B.tap('#salaSalir'); await B.waitForTimeout(800);
    await B.tap('#salaBtn'); await B.fill('#salaPass', 'museo de prueba'); await B.tap('#salaEntrar');
    ok(`vuelta ${i + 1}: A ve la cara de B`, await veCara(A, idB));
    ok(`vuelta ${i + 1}: B ve la cara de A`, await veCara(B, idA));
  }
  // la cara de B se muere (como cuando iOS la corta): se vuelve a abrir sola
  console.log(await B.evaluate(() => JSON.stringify({on: __game.rtc.on, cara: !!__game.rtc.cara, caraOn: __game.rtc.caraOn, camOn: __game.camOn, act: __game.sala.active, peers: __game.rtc.peers.size})));
  await B.waitForFunction(() => __game.rtc.cara, null, {timeout: 8000}).catch(()=>console.log('nunca cara'));
  await B.evaluate(() => __game.rtc.cara.getVideoTracks()[0].stop());
  ok('si la cámara frontal se corta, se vuelve a abrir', await B.waitForFunction(() => __game.rtc.cara && __game.rtc.cara.getVideoTracks()[0].readyState === 'live', null, { timeout: 8000 }).then(() => true).catch(() => false));
  ok('y A la sigue viendo', await veCara(A, idB));
  console.log('errores', A.errs, B.errs);
  await b.close(); web.close(); dbSrv.close(); process.exit(0);
})();
