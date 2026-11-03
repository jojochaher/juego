// v10.3.4: menos carteles de permisos. Cuenta los pedidos de cámara/micrófono (getUserMedia) en cada caso:
// arrancar ya en una sala (con la cámara de fotos o sin ella) = 1 pedido; entrar a una sala sin la cámara = 1 pedido.
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.');
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
(async () => {
  const dbSrv = await mock(8391);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8390);
  const URL = 'http://localhost:8390/?db=http://localhost:8391';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const contar = () => {   // anota cada pedido de permisos
    window.__pedidos = [];
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = c => { window.__pedidos.push((c.audio ? 'mic' : '') + (c.audio && c.video ? '+' : '') + (c.video ? 'cam' : '')); return orig(c); };
  };
  const pagina = async (prep) => {
    const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] });
    await ctx.addInitScript(contar);
    if (prep) await ctx.addInitScript(prep);
    const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL); await pg.waitForTimeout(400); await pg.tap('#start'); await pg.waitForTimeout(2500);
    return pg;
  };
  const sh = await (async () => { const c = require('crypto'); return c.createHash('sha256').update('juego:prueba permisos').digest('hex'); })();
  const enSala = cam => `localStorage.setItem('sala', '${sh}'); localStorage.setItem('salaPass', JSON.stringify({h:'${sh}', p:'prueba permisos'})); localStorage.setItem('camara', '${cam}');`;

  // 1) arranca en una sala con la cámara de fotos equipada: cámara + mic en un pedido
  let pg = await pagina(new Function(enSala('1')));
  let p = await pg.evaluate(() => window.__pedidos);
  ok('en sala con la cámara: un solo pedido (' + p + ')', p.length === 1 && p[0] === 'mic+cam');
  ok('  y quedan andando la cámara y el mic', await pg.evaluate(() => __game.camReady && rtc.mic && rtc.mic.getAudioTracks()[0].readyState === 'live'));
  // guardar la cámara: la cara se pide sola (la cámara ya está permitida en la sesión), el mic no se vuelve a pedir
  await pg.tap('#unequip'); await pg.waitForTimeout(1500);
  p = await pg.evaluate(() => window.__pedidos);
  ok('  al guardar la cámara se pide solo la cara (' + p + ')', p.length === 2 && p[1] === 'cam' && await pg.evaluate(() => !!rtc.cara));
  await pg.context().close();

  // 2) arranca en una sala sin la cámara: mic + cara en un pedido
  pg = await pagina(new Function(enSala('0')));
  p = await pg.evaluate(() => window.__pedidos);
  ok('en sala sin la cámara: un solo pedido (' + p + ')', p.length === 1 && p[0] === 'mic+cam');
  ok('  y quedan andando la cara y el mic', await pg.evaluate(() => !!(rtc.cara && rtc.mic)));
  await pg.context().close();

  // 3) sin sala, sin cámara, y después entra a una sala: un pedido
  pg = await pagina(() => localStorage.setItem('camara', '0'));
  ok('sin sala ni cámara: ningún pedido', (await pg.evaluate(() => window.__pedidos)).length === 0);
  await pg.tap('#salaBtn'); await pg.fill('#salaPass', 'prueba permisos 2'); await pg.tap('#salaEntrar'); await pg.waitForTimeout(2000);
  p = await pg.evaluate(() => window.__pedidos);
  ok('al entrar a una sala: un solo pedido (' + p + ')', p.length === 1 && p[0] === 'mic+cam');
  ok('sin errores', !pg.errs.length);
  if (pg.errs.length) console.log(pg.errs);
  await pg.context().close();
  console.log(fallas ? fallas + ' FALLAS' : 'TODO OK');
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
