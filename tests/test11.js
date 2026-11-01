const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = require('path').join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
(async () => {
  const dbSrv = await mock(8152);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8142);
  const URL = 'http://localhost:8142/?db=http://localhost:8152';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const mk = async () => { const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message)); pg.on('console', m => m.type()==='error' && !/401|Failed to load/.test(m.text()) && pg.errs.push(m.text()));
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady); await pg.tap('#unequip'); await pg.waitForTimeout(200);
    await pg.tap('#salaBtn'); await pg.fill('#salaPass', 'museo de prueba'); await pg.tap('#salaEntrar'); return pg; };
  const A = await mk(), B = await mk();
  const idA = await A.evaluate(() => __game.salaYo), idB = await B.evaluate(() => __game.salaYo);
  ok('botones mic y cara visibles en la sala', await A.isVisible('#micBtn') && await A.isVisible('#caraBtn'));
  ok('A tiene mic y cara propios', await A.waitForFunction(() => __game.rtc.mic && __game.rtc.cara, null, { timeout: 8000 }).then(() => true).catch(() => false));
  const conectado = await A.waitForFunction(id => { const p = __game.rtc.peers.get(id); return p && p.pc.connectionState === 'connected'; }, idB, { timeout: 20000 }).then(() => true).catch(() => false);
  ok('A y B conectados por WebRTC', conectado);
  ok('A recibe audio de B (con sonido espacial)', await A.evaluate(id => { const p = __game.rtc.peers.get(id); return !!(p && p.audio && p.panner); }, idB));
  ok('A recibe la cara de B', await A.waitForFunction(id => { const p = __game.rtc.peers.get(id); return p && p.video && p.video.videoWidth > 0; }, idB, { timeout: 8000 }).then(() => true).catch(() => false));
  // ponerlos frente a frente
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = -2.2; __game.look(180, -3); });
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, -2); });
  await A.waitForTimeout(2000);
  ok('A dibuja la cara de B en la cabeza', await A.evaluate(id => !!(__game.rtc.peers.get(id).caraR && __game.rtc.peers.get(id).caraR.ok), idB));
  await A.screenshot({ path: out + 'v7_cara.png' });
  // B equipa la cámara de fotos: su cara se apaga y levanta la cámara
  await B.tap('#equip'); await B.waitForTimeout(2500);
  ok('al equipar la cámara de fotos, B suelta la frontal', await B.evaluate(() => !__game.rtc.cara && __game.camReady));
  await A.screenshot({ path: out + 'v7_cara_pausa.png' });
  await B.tap('#unequip'); await B.waitForTimeout(2500);
  ok('al guardarla vuelve la cara', await B.evaluate(() => !!__game.rtc.cara));
  // mic no
  await B.tap('#micBtn'); await B.waitForTimeout(300);
  ok('mic: no apaga el micrófono', await B.evaluate(() => !__game.rtc.mic) && /no/.test(await B.textContent('#micBtn')));
  // salir corta la conexión
  await B.tap('#salaBtn'); await B.tap('#salaSalir');
  ok('al salir B, A cierra la conexión', await A.waitForFunction(id => !__game.rtc.peers.has(id), idB, { timeout: 8000 }).then(() => true).catch(() => false));
  ok('B apagó todo lo suyo', await B.evaluate(() => !__game.rtc.on && !__game.rtc.mic && !__game.rtc.cara));
  console.log('errores', A.errs, B.errs);
  await b.close(); web.close(); dbSrv.close(); process.exit(0);
})();
