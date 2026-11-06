const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = require('path').join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
(async () => {
  const dbSrv = await mock(8150);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8140);
  const URL = 'http://localhost:8140/?db=http://localhost:8150';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const mk = async () => { const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message)); pg.on('console', m => m.type()==='error' && !/401|Failed to load/.test(m.text()) && pg.errs.push(m.text())); pg.cdp = await ctx.newCDPSession(pg); return pg; };
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const wait = (pg, f, arg, ms = 6000) => pg.waitForFunction(f, arg, { timeout: ms }).then(() => true).catch(() => false);
  const enter = async pg => { await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady); await pg.waitForTimeout(200); };
  const joinRoom = async (pg, pass) => { await pg.tap('#salaBtn'); await pg.fill('#salaPass', pass); await pg.tap('#salaEntrar'); await pg.waitForTimeout(400); };
  const A = await mk(), B = await mk(), C = await mk();
  await enter(A); await enter(B); await enter(C);
  // A tiene una foto en su museo personal
  await A.tap('#shoot'); await A.waitForTimeout(400);
  await joinRoom(A, 'museo de prueba'); await joinRoom(B, 'museo de prueba'); await joinRoom(C, 'otra clave larga');
  ok('A entra a la sala y su foto personal no se ve ahí', await A.evaluate(() => __game.sala.active && __game.works.length === 0));
  ok('a la base solo va el hash (la contraseña queda en el celu para verla)', await A.evaluate(() => localStorage.getItem('sala').length === 64));
  // contraseña corta
  const D = await mk(); await enter(D); await joinRoom(D, 'abc');
  ok('contraseña corta rechazada', !(await D.evaluate(() => __game.sala.active)));
  // A saca una foto en la sala → B la ve, C no
  await A.evaluate(() => __game.look(20, 0)); await A.tap('#shoot');
  ok('B ve la foto que sacó A', await wait(B, () => __game.works.length === 1));
  const cA = await A.evaluate(() => __game.works[0].c), cB = await B.evaluate(() => __game.works[0] && __game.works[0].c);
  ok('en el mismo lugar', cB && Math.hypot(cA[0]-cB[0], cA[1]-cB[1], cA[2]-cB[2]) < 1e-6);
  await C.waitForTimeout(500);
  ok('C (otra contraseña) no ve nada', await C.evaluate(() => __game.works.length === 0));
  // B la agarra, la mueve y la suelta → A ve el cambio
  await B.evaluate(() => { const w = __game.works[0]; const d = [w.c[0]-__game.pos[0], w.c[1]-__game.pos[1], w.c[2]-__game.pos[2]]; __game.look(Math.atan2(d[0], -d[2])*180/Math.PI, Math.atan2(d[1], Math.hypot(d[0], d[2]))*180/Math.PI); });
  await B.waitForTimeout(150);
  const scr = [B.viewportSize().width/2, B.viewportSize().height/2];
  await B.touchscreen.tap(scr[0], scr[1]); await B.waitForTimeout(1200);
  ok('B agarra la foto de A', await B.evaluate(() => !!__game.held));
  await B.evaluate(() => __game.look(-60, 10)); await B.waitForTimeout(100);
  await B.tap('#drop');
  ok('A ve la foto movida por B', await wait(A, c => Math.hypot(__game.works[0].c[0]-c[0], __game.works[0].c[2]-c[2]) > 0.1, cA));
  // presencia: A camina, B lo ve moverse
  ok('B ve a A en la sala', await wait(B, id => __game.sala.gente.has(id), await A.evaluate(() => __game.salaYo)));
  ok('A ve a B y el botón dice cuántos son', await wait(A, () => __game.sala.gente.size === 1) && /sala · 2/.test(await A.textContent('#salaBtn')));
  const jb = await A.locator('#joy').boundingBox();
  await A.evaluate(() => __game.look(0, 0));
  await A.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: jb.x+60, y: jb.y+60 }] });
  await A.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: jb.x+60, y: jb.y+10 }] });
  await A.waitForTimeout(1500);
  await A.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const pA = await A.evaluate(() => [...__game.pos]);
  ok(`B ve a A donde está (A z=${pA[2].toFixed(2)})`, await wait(B, ([id, z]) => { const p = __game.sala.gente.get(id); return p && Math.abs(p.disp.p[2] - z) < 0.15; }, [await A.evaluate(() => __game.salaYo), pA[2]]));
  // foto de B mirando a A
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = -3; __game.look(180, -5); });
  await A.tap('#unequip'); await A.waitForTimeout(1500);
  await B.evaluate(() => { __game.pos[0] = 0.4; __game.pos[2] = 0; __game.look(0, -8); });
  await B.tap('#unequip'); await B.waitForTimeout(400);
  await B.screenshot({ path: out + 'v6_otro.png' });
  await A.tap('#equip'); await A.waitForTimeout(1800);
  await B.screenshot({ path: out + 'v6_otro_cam.png' });
  // A camina mientras B mira
  await A.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: jb.x+60, y: jb.y+60 }] });
  await A.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: jb.x+110, y: jb.y+60 }] });
  await B.waitForTimeout(900);
  await B.screenshot({ path: out + 'v6_otro_camina.png' });
  await A.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // borrar
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; });
  const scr2 = await B.evaluate(() => { const w = __game.works[0]; const d = [w.c[0]-__game.pos[0], w.c[1]-__game.pos[1], w.c[2]-__game.pos[2]]; __game.look(Math.atan2(d[0], -d[2])*180/Math.PI, Math.atan2(d[1], Math.hypot(d[0], d[2]))*180/Math.PI); return 1; });
  await B.waitForTimeout(200);
  const vw = B.viewportSize();
  await B.touchscreen.tap(vw.width/2, vw.height/2); await B.waitForTimeout(1200);
  await B.tap('#trash');
  ok('B borra y A deja de verla', await wait(A, () => __game.works.length === 0));
  // desde v10.17 la foto puede tener su sonido del lugar subiendo todavía: se le da unos segundos para limpiarse
  let s = [];
  for (let i = 0; i < 25; i++) {
    const dump = await (await fetch('http://localhost:8150/__dump')).json();
    s = Object.values(dump.salas || {}).map(x => Object.keys(x.imgs || {}).length + Object.keys(x.poses || {}).length);
    if (s.every(n => n === 0)) break;
    await new Promise(r => setTimeout(r, 200));
  }
  ok('la base quedó sin la foto ni su imagen (ni su sonido)', s.every(n => n === 0));
  // recargar dentro de la sala
  await A.reload(); await A.waitForTimeout(800);
  ok('al recargar sigue en la sala', await A.evaluate(() => __game.sala.active));
  await A.tap('#start'); await A.waitForTimeout(600);
  await A.tap('#salaBtn'); await A.tap('#salaSalir');
  ok('A vuelve a su museo y recupera su foto personal', await wait(A, () => !__game.sala.active && __game.works.length === 1));
  ok('B ve que A se fue', await wait(B, () => __game.sala.gente.size === 0));
  console.log('errores A', A.errs, 'B', B.errs, 'C', C.errs);
  await b.close(); web.close(); dbSrv.close(); process.exit(0);
})();
