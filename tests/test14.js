// contraseña visible adentro + ver lo que el otro tiene en la mano
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = require('path').join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
(async () => {
  const dbSrv = await mock(8154);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8144);
  const URL = 'http://localhost:8144/?db=http://localhost:8154';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const mk = async () => { const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady); await pg.tap('#unequip'); await pg.waitForTimeout(200);
    await pg.tap('#salaBtn'); await pg.fill('#salaPass', 'museo de prueba'); await pg.tap('#salaEntrar'); return pg; };
  const A = await mk(), B = await mk();
  const idA = await A.evaluate(() => __game.salaYo), idB = await B.evaluate(() => __game.salaYo);
  // contraseña
  await A.tap('#salaBtn');
  ok('adentro se ve la contraseña tapada', (await A.textContent('#salaClave')) === '•'.repeat(15));
  await A.tap('#salaVer2');
  ok('con "ver" se ve', (await A.textContent('#salaClave')) === 'museo de prueba');
  await A.screenshot({ path: out + 'v72_clave.png' });
  await A.reload(); await A.waitForTimeout(300); await A.tap('#start'); await A.waitForTimeout(300);
  await A.tap('#salaBtn'); await A.tap('#salaVer2');
  ok('después de recargar se sigue viendo', (await A.textContent('#salaClave')) === 'museo de prueba');
  await A.tap('#salaBtn');
  await A.waitForFunction(id => { const p = __game.rtc.peers.get(id); return p && p.pc.connectionState === 'connected'; }, idB, { timeout: 20000 }).catch(() => {});
  // frente a frente
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = -2.4; __game.look(180, -8); });
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, -2); });
  // B equipa la cámara: A ve lo que encuadra
  await B.tap('#equip');
  ok('A ve la vista previa de B en su mano', await A.waitForFunction(id => { const p = __game.sala.gente.get(id); return p && p.mano && !p.mano.mid && p.cam; }, idB, { timeout: 8000 }).then(() => true).catch(() => false));
  ok('y le llega el video de lo que encuadra', await A.waitForFunction(id => { const p = __game.rtc.peers.get(id); return p && p.vistaTex; }, idB, { timeout: 10000 }).then(() => true).catch(() => false));
  ok('B: la cara no manda nada y la vista manda la cámara trasera', await B.evaluate(id => {
    const pc = __game.rtc.peers.get(id).pc, v = pc.getTransceivers().filter(t => t.receiver.track.kind === 'video');
    return v.length === 2 && v[0].sender.track === null && v[1].sender.track && v[1].sender.track.readyState === 'live';
  }, idA));
  ok('A: cara y vista en videos distintos', await A.evaluate(id => { const p = __game.rtc.peers.get(id); return p.video && p.vistaV && p.video !== p.vistaV; }, idB));
  await A.waitForTimeout(1500);
  await A.screenshot({ path: out + 'v73_vista.png' });
  // B saca una foto y la agarra
  await B.tap('#shoot'); await B.waitForTimeout(1500);
  const wid = await B.evaluate(() => __game.works[0] && __game.works[0].id);
  ok('A recibe la foto', await A.waitForFunction(id => __game.works.some(w => w.id === id), wid, { timeout: 8000 }).then(() => true).catch(() => false));
  await B.tap('#unequip'); await B.waitForTimeout(2500);
  ok('al guardar la cámara, B vuelve a mandar la cara', await B.evaluate(id => {
    const pc = __game.rtc.peers.get(id).pc, v = pc.getTransceivers().filter(t => t.receiver.track.kind === 'video');
    return v[0].sender.track && v[0].sender.track.readyState === 'live' && !v[1].sender.track;
  }, idA));
  const vp = B.viewportSize();
  await B.tap('canvas', { position: { x: vp.width / 2, y: vp.height / 2 } }); await B.waitForTimeout(1200);
  ok('B la agarró', await B.evaluate(() => !!__game.held));
  ok('A ve que B la tiene en la mano', await A.waitForFunction(([id, wid]) => { const p = __game.sala.gente.get(id); return p && p.mano && p.mano.mid === wid; }, [idB, wid], { timeout: 8000 }).then(() => true).catch(() => false));
  // B se mueve con la foto: A la ve moverse
  const c0 = await A.evaluate(id => __game.sala.gente.get(id).mano.c.slice(), idB);
  await B.evaluate(() => { __game.pos[0] = 1.2; }); await A.waitForTimeout(1500);
  const c1 = await A.evaluate(id => __game.sala.gente.get(id).mano.c.slice(), idB);
  ok('se mueve con B', Math.abs(c1[0] - c0[0]) > 0.8);
  await A.screenshot({ path: out + 'v72_mano.png' });
  await B.tap('#drop'); await B.waitForTimeout(1500);
  ok('al soltar, A la ve en su lugar nuevo', await A.evaluate(([id, wid]) => { const p = __game.sala.gente.get(id); const w = __game.works.find(w => w.id === wid); return (!p.mano) && w && Math.abs(w.c[0] - 1.2) < 0.3; }, [idB, wid]));
  console.log('errores', A.errs, B.errs);
  await b.close(); web.close(); dbSrv.close(); process.exit(0);
})();
