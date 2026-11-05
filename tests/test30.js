// v10.4: en el celu, botón para cambiar la cámara de fotos entre la de atrás y la de adelante
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
(async () => {
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8169);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const espia = () => {
    window.__pedidos = [];
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = c => { window.__pedidos.push(c && c.video ? c.video.facingMode : null); return orig(c); };
    // el contenedor tiene una sola cámara falsa: hacemos de cuenta que hay dos, como en el celu
    const enumOrig = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => { const ds = await enumOrig(); const v = ds.find(d => d.kind === 'videoinput'); return v ? [...ds, v] : ds; };
  };
  const ctx = await b.newContext({ ...devices['iPhone 13'], permissions: ['camera'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.addInitScript(espia);
  await pg.goto('http://localhost:8169/?borrar'); await pg.goto('http://localhost:8169/'); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady);
  await pg.waitForTimeout(500);
  ok('arranca con la de atrás ' + JSON.stringify(await pg.evaluate(() => __pedidos)), (await pg.evaluate(() => __pedidos)).slice(-1)[0] === 'environment');
  ok('el botón aparece con la cámara equipada', await pg.isVisible('#girarCam'));
  const w0 = await pg.evaluate(() => __game.works.length);
  await pg.evaluate(() => { window.__pistaVieja = document.getElementById('vid').srcObject.getVideoTracks()[0]; });
  await pg.tap('#girarCam'); await pg.waitForFunction(() => window.__game.camReady); await pg.waitForTimeout(300);
  ok('la pista de la de atrás quedó parada', await pg.evaluate(() => __pistaVieja.readyState === 'ended'));
  ok('cambia a la de adelante ' + JSON.stringify(await pg.evaluate(() => __pedidos)), (await pg.evaluate(() => __pedidos)).slice(-1)[0] === 'user' && await pg.evaluate(() => camFrente));
  ok('la de adelante está viva', await pg.evaluate(() => document.getElementById('vid').srcObject.getVideoTracks()[0].readyState === 'live'));
  await pg.tap('#shoot'); await pg.waitForTimeout(400);
  ok('saca foto con la de adelante', (await pg.evaluate(() => __game.works.length)) === w0 + 1);
  await pg.evaluate(() => { pick(__game.works[__game.works.length - 1]); ui(); });
  ok('con una foto en la mano no aparece', !(await pg.isVisible('#girarCam')));
  await pg.evaluate(() => { cancelHold(); ui(); });
  await pg.screenshot({ path: out + 'v104_camara_frente.png' });
  // se recuerda al volver a abrir
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady); await pg.waitForTimeout(300);
  ok('se recuerda al volver a abrir', (await pg.evaluate(() => __pedidos)).slice(-1)[0] === 'user');
  await pg.tap('#girarCam'); await pg.waitForFunction(() => window.__game.camReady); await pg.waitForTimeout(300);
  ok('y vuelve a la de atrás', (await pg.evaluate(() => __pedidos)).slice(-1)[0] === 'environment' && !(await pg.evaluate(() => camFrente)));
  // guardada la cámara o con una foto en la mano no aparece
  await pg.tap('#unequip'); await pg.waitForTimeout(200);
  ok('con la cámara guardada no aparece', !(await pg.isVisible('#girarCam')));
  // con una sola cámara (compu o celu viejo) no aparece
  const ctx2 = await b.newContext({ ...devices['iPhone 13'], permissions: ['camera'] }); const pg2 = await ctx2.newPage();
  await pg2.goto('http://localhost:8169/?borrar'); await pg2.goto('http://localhost:8169/'); await pg2.waitForTimeout(300); await pg2.tap('#start'); await pg2.waitForFunction(() => window.__game.camReady); await pg2.waitForTimeout(500);
  ok('con una sola cámara no aparece', !(await pg2.isVisible('#girarCam')));
  console.log('errores', pg.errs);
  await b.close(); web.close(); process.exit(0);
})();
