// efectos de voz
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = require('path').join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
(async () => {
  const dbSrv = await mock(8162);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8153);
  const URL = 'http://localhost:8153/?db=http://localhost:8162';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const mk = async () => { const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady); await pg.tap('#unequip'); await pg.waitForTimeout(200); return pg; };
  const A = await mk();
  // escucharse fuera de la sala
  await A.tap('#salaBtn'); await A.tap('#salaFuera .abrirPersonaje'); await A.waitForTimeout(300);
  await A.tap('[data-efecto="robot"]'); await A.tap('#vozEscuchar'); await A.waitForTimeout(800);
  ok('escucharme abre un mic de prueba y arma la cadena', await A.evaluate(() => !!vozCadena.prueba && !!vozCadena.dest));
  await A.screenshot({ path: out + 'v9_voz.png' });
  await A.tap('#pjListo'); await A.waitForTimeout(200);
  ok('al cerrar se apaga la prueba', await A.evaluate(() => !vozCadena.prueba && !voz.escucharme));
  // en la sala
  for (const pg of [A]) { await pg.tap('#salaBtn'); await pg.fill('#salaPass', 'sala de voces'); await pg.tap('#salaEntrar'); }
  const B = await mk(); await B.tap('#salaBtn'); await B.fill('#salaPass', 'sala de voces'); await B.tap('#salaEntrar');
  const idA = await A.evaluate(() => __game.salaYo), idB = await B.evaluate(() => __game.salaYo);
  await A.waitForFunction(id => { const p = __game.rtc.peers.get(id); return p && p.pc.connectionState === 'connected'; }, idB, { timeout: 20000 });
  await A.waitForTimeout(1500);
  ok('A manda la voz con efecto (no el mic crudo)', await A.evaluate(id => {
    const t = __game.rtc.peers.get(id).pc.getTransceivers().find(t => t.receiver.track.kind === 'audio');
    return t.sender.track && t.sender.track === vozCadena.dest.stream.getAudioTracks()[0];
  }, idB));
  // tono
  await A.evaluate(() => { const t = document.getElementById('vozTono'); t.value = 7; t.dispatchEvent(new Event('input')); t.dispatchEvent(new Event('change')); });
  await A.waitForTimeout(800);
  ok('con tono +7 sigue mandando la cadena', await A.evaluate(id => {
    const t = __game.rtc.peers.get(id).pc.getTransceivers().find(t => t.receiver.track.kind === 'audio');
    return voz.tono === 7 && t.sender.track === vozCadena.dest.stream.getAudioTracks()[0];
  }, idB));
  // B escucha algo
  const nivel = await B.evaluate(async id => {
    const p = __game.rtc.peers.get(id); const ctx = rtc.ctx; if (ctx.state !== 'running') await ctx.resume();
    const an = ctx.createAnalyser(); p.src.connect(an); const d = new Float32Array(an.fftSize);
    let max = 0; for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 100)); an.getFloatTimeDomainData(d); for (const v of d) max = Math.max(max, Math.abs(v)); }
    return max;
  }, idA);
  ok('B recibe sonido (' + nivel.toFixed(3) + ')', nivel > 0.01);
  // sin efecto vuelve al mic crudo
  await A.evaluate(() => { const t = document.getElementById('vozTono'); t.value = 0; t.dispatchEvent(new Event('input')); t.dispatchEvent(new Event('change')); });
  await A.evaluate(() => document.querySelector('[data-efecto="nada"]').click()); await A.waitForTimeout(600);
  ok('sin efecto manda el mic tal cual', await A.evaluate(id => {
    const t = __game.rtc.peers.get(id).pc.getTransceivers().find(t => t.receiver.track.kind === 'audio');
    return t.sender.track === __game.rtc.mic.getAudioTracks()[0];
  }, idB));
  for (const e of ['radio', 'eco', 'cueva']) { await A.evaluate(e => document.querySelector(`[data-efecto="${e}"]`).click(), e); await A.waitForTimeout(300); }
  ok('todos los efectos arman sin error', !(await A.evaluate(() => diagLog.some(l => /voz: no pude/.test(l)))));
  console.log('errores', A.errs, B.errs);
  await b.close(); web.close(); dbSrv.close(); process.exit(0);
})();
