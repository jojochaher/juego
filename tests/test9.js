const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = require('path').join(__dirname, 'out') + '/';
const srv = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8137);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] }); const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const G = f => pg.evaluate(f);
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  // simular los dos permisos de iPhone y anotar el orden
  await pg.addInitScript(() => {
    window.__log = [];
    window.DeviceOrientationEvent = window.DeviceOrientationEvent || function(){};
    DeviceOrientationEvent.requestPermission = () => { __log.push('pide movimiento'); return new Promise(r => setTimeout(() => { __log.push('cierra movimiento'); r('granted'); }, 400)); };
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => { __log.push('pide cámara'); return gum(c); };
  });
  await pg.goto('http://localhost:8137/?borrar'); await pg.waitForTimeout(300);
  await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady, null, {timeout: 5000});
  const log = await G(() => __log);
  ok('permisos de a uno: ' + log.join(' → '), log.join('|') === 'pide movimiento|cierra movimiento|pide cámara');
  // guardar la cámara
  await pg.tap('#unequip'); await pg.waitForTimeout(200);
  const st = await G(() => ({ camOn: __game.camOn, camReady: __game.camReady, tracks: document.getElementById('vid').srcObject }));
  ok('guardar: cámara apagada', !st.camOn && !st.camReady && !st.tracks);
  ok('guardar: sin obturador, modos ni barra; aparece equipar', !(await pg.isVisible('#shoot')) && !(await pg.isVisible('#modes')) && !(await pg.isVisible('#dist')) && await pg.isVisible('#equip'));
  await pg.screenshot({ path: out + 'v52_guardada.png' });
  await pg.reload(); await pg.waitForTimeout(400);
  await G(() => { __log = []; });
  await pg.tap('#start'); await pg.waitForTimeout(800);
  ok('recordada guardada: al entrar no pide cámara', !(await G(() => __log)).includes('pide cámara') && !(await G(() => __game.camOn)));
  await pg.tap('#equip'); await pg.waitForFunction(() => window.__game.camReady, null, {timeout: 5000});
  ok('equipar: vuelve la cámara y el obturador', await pg.isVisible('#shoot') && await pg.isVisible('#unequip'));
  // fov
  ok('panel fov cerrado', !(await pg.isVisible('#fovPanel')));
  await pg.tap('#fov');
  ok('tocar fov abre la barra', await pg.isVisible('#fovPanel'));
  const tr = await pg.locator('#fovTrack').boundingBox();
  await pg.mouse.move(tr.x + tr.width*0.5, tr.y+2); await pg.mouse.down(); await pg.mouse.move(tr.x - 40, tr.y+2, {steps: 4}); await pg.mouse.up();
  const lo = await G(() => __game.fov);
  await pg.mouse.move(tr.x + 10, tr.y+2); await pg.mouse.down(); await pg.mouse.move(tr.x + tr.width + 60, tr.y+2, {steps: 6}); await pg.mouse.up();
  const hi = await G(() => __game.fov);
  ok(`barra va de punta a punta (${lo}° a ${hi}°)`, lo === 5 && hi === 170);
  await pg.screenshot({ path: out + 'v52_fov.png' });
  await pg.mouse.move(tr.x + 10, tr.y+2); await pg.mouse.down(); await pg.mouse.move(tr.x + tr.width*(45/165), tr.y+2, {steps: 4}); await pg.mouse.up();
  await pg.tap('#fov');
  ok(`tocar fov de nuevo la cierra (quedó en ${await G(() => __game.fov)}°)`, !(await pg.isVisible('#fovPanel')));
  console.log('errors', errs);
  await b.close(); srv.close();
})();
