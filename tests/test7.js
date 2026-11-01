const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2];
const srv = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8134);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] }); const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const G = f => pg.evaluate(f);
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const cdp = await ctx.newCDPSession(pg);
  const t = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p,i)=>({x:p[0],y:p[1],id:i})) });
  const vw = pg.viewportSize(), cx = vw.width/2, cy = vw.height/2;
  await pg.goto('http://localhost:8134/?borrar'); await pg.waitForTimeout(400);
  await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady); await pg.waitForTimeout(200);
  ok('inicio visible', await pg.isVisible('#home'));
  ok('toggle giroscopio oculto sin giroscopio', !(await pg.isVisible('#gyroT')));
  // cancelar
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  const before = await G(() => JSON.stringify(window.__game.works[0].c));
  await pg.touchscreen.tap(cx, cy); await pg.waitForTimeout(150);
  ok('agarrada + botón cancelar', await G(() => !!window.__game.held) && await pg.isVisible('#cancel'));
  await G(() => window.__game.look(70, 20));
  await t('touchStart', [[cx-80, cy],[cx+80, cy]]); for (let i=1;i<=5;i++){ await t('touchMove', [[cx-80-i*15, cy],[cx+80+i*15, cy]]); await pg.waitForTimeout(20);} await t('touchEnd', []);
  await pg.tap('#cancel'); await pg.waitForTimeout(200);
  ok('cancelar deja la foto donde estaba', !(await G(() => !!window.__game.held)) && before === await G(() => JSON.stringify(window.__game.works[0].c)));
  // volver al inicio
  const jb = await pg.locator('#joy').boundingBox();
  await t('touchStart', [[jb.x+60, jb.y+60]]); await t('touchMove', [[jb.x+60, jb.y+10]]); await pg.waitForTimeout(800); await t('touchEnd', []);
  await G(() => window.__game.look(120, 30));
  await pg.tap('#home'); await pg.waitForTimeout(100);
  const st = await G(() => ({ p: [...window.__game.pos], f: basis().f }));
  ok(`inicio vuelve al origen mirando al frente (${st.p.map(v=>v.toFixed(2))} f ${st.f.map(v=>v.toFixed(2))})`, Math.abs(st.p[0])+Math.abs(st.p[2]) < 1e-6 && st.f[2] < -0.99);
  // giroscopio simulado
  await G(() => { window.__iv = setInterval(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {alpha: 30, beta: 80, gamma: 5})), 40); });
  await pg.waitForTimeout(200);
  ok('toggle giroscopio aparece', await pg.isVisible('#gyroT'));
  await t('touchStart', [[200,500]]); for (let i=1;i<=5;i++){ await t('touchMove', [[200+i*20, 500+i*10]]); await pg.waitForTimeout(20);} await t('touchEnd', []);
  const f1 = await G(() => basis().f);
  await pg.tap('#gyroT'); await pg.waitForTimeout(100);
  const f2 = await G(() => basis().f);
  ok(`apagar sin salto (dif ${Math.hypot(f1[0]-f2[0], f1[1]-f2[1], f1[2]-f2[2]).toFixed(3)}) label ${await pg.textContent('#gyroT')}`, Math.hypot(f1[0]-f2[0], f1[1]-f2[1], f1[2]-f2[2]) < 0.01);
  // con el giroscopio apagado, mover el celu no cambia nada
  await G(() => { clearInterval(window.__iv); window.__iv = setInterval(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {alpha: 90, beta: 40, gamma: 30})), 40); });
  await pg.waitForTimeout(200);
  const f3 = await G(() => basis().f);
  ok('apagado ignora el celu', Math.hypot(f3[0]-f2[0], f3[1]-f2[1], f3[2]-f2[2]) < 1e-6);
  await pg.tap('#gyroT'); await pg.waitForTimeout(100);
  const f4 = await G(() => basis().f);
  const h = f => Math.atan2(-f[0], -f[2]);
  ok(`prender mantiene el rumbo (${h(f3).toFixed(3)} vs ${h(f4).toFixed(3)})`, Math.abs(h(f3) - h(f4)) < 0.01);
  await pg.screenshot({ path: require('path').join(__dirname, 'out', 'v42.png') });
  console.log('errors', errs);
  await b.close(); srv.close();
})();
