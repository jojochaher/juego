// test de caos: 3 jugadores hacen cosas al azar; al final todos tienen que verse y nadie tener errores.
// uso: node test18.js <root> [pasos] [semilla]
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], PASOS = +process.argv[3] || 40;
let seed = +process.argv[4] || Date.now() % 100000;
console.log('semilla', seed);
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = a => a[Math.floor(rnd() * a.length)];
const mock = require('./mockdb.js');
(async () => {
  const dbSrv = await mock(8158);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8148);
  const URL = 'http://localhost:8148/?db=http://localhost:8158';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const fallas = [];
  const falla = (who, t) => { fallas.push(`${who}: ${t}`); console.log('FALLA', who, t); };
  const mk = async (nombre) => {
    const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage();
    pg.nombre = nombre; pg.errs = [];
    pg.on('pageerror', e => { pg.errs.push(e.message); falla(nombre, 'pageerror ' + e.message); });
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady);
    await pg.tap('#unequip'); await pg.waitForTimeout(200);
    await pg.tap('#salaBtn'); await pg.fill('#salaPass', 'museo de caos'); await pg.tap('#salaEntrar'); await pg.waitForTimeout(300);
    return pg;
  };
  const J = [await mk('A'), await mk('B'), await mk('C')];
  const setHidden = (pg, h) => pg.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, h);
  const vis = async (pg, sel) => pg.isVisible(sel).catch(() => false);
  const arrancar = async pg => { await pg.waitForTimeout(400); if (await vis(pg, '#start')) await pg.tap('#start'); await pg.waitForTimeout(600); };
  const acciones = {
    mover: async pg => { await pg.evaluate(([x, y]) => { __game.joy.x = x; __game.joy.y = y; }, [rnd() * 2 - 1, rnd() * 2 - 1]); await pg.waitForTimeout(300 + rnd() * 700); await pg.evaluate(() => { __game.joy.x = 0; __game.joy.y = 0; }); },
    mirar: async pg => pg.evaluate(([y, p]) => __game.look(y, p), [rnd() * 360 - 180, rnd() * 60 - 30]),
    camara: async pg => { if (await vis(pg, '#equip')) await pg.tap('#equip'); else if (await vis(pg, '#unequip')) await pg.tap('#unequip'); await pg.waitForTimeout(500); },
    foto: async pg => { if (await vis(pg, '#shoot')) { await pg.tap('#shoot'); await pg.waitForTimeout(400); } },
    agarrar: async pg => {
      if (await vis(pg, '#drop')) { await pg.tap(pick(['#drop', '#cancel'])); return; }
      const vp = pg.viewportSize(); await pg.tap('canvas', { position: { x: vp.width / 2, y: vp.height / 2 } }); await pg.waitForTimeout(800);
      if (await vis(pg, '#drop')) { await pg.evaluate(() => { __game.joy.x = 0.5; }); await pg.waitForTimeout(400); await pg.evaluate(() => { __game.joy.x = 0; }); await pg.tap(pick(['#drop', '#drop', '#cancel'])); }
    },
    salirEntrar: async pg => {
      if (await vis(pg, '#salaPanel')) await pg.tap('#salaBtn');
      await pg.tap('#salaBtn'); await pg.waitForTimeout(150);
      if (await vis(pg, '#salaSalir')) { await pg.tap('#salaSalir'); await pg.waitForTimeout(300 + rnd() * 1500); await pg.tap('#salaBtn'); }
      await pg.fill('#salaPass', 'museo de caos'); await pg.tap('#salaEntrar');
    },
    fondo: async pg => { await setHidden(pg, true); await pg.waitForTimeout(500 + rnd() * 2500); await setHidden(pg, false); },
    recargar: async pg => { await pg.reload(); await arrancar(pg); },
    webgl: async pg => { await pg.evaluate(() => gl.getExtension('WEBGL_lose_context').loseContext()); await pg.waitForTimeout(3500); await arrancar(pg); },
    mic: async pg => {
      const b = pick(['#micBtn', '#yoCara', '#yoCaraOff']);
      await pg.tap(b, { timeout: 3000 }).catch(() => {});
    },
  };
  const pesos = { mover: 4, mirar: 3, camara: 2, foto: 2, agarrar: 2, salirEntrar: 2, fondo: 2, recargar: 1, webgl: 1, mic: 1 };
  const bolsa = Object.entries(pesos).flatMap(([k, n]) => Array(n).fill(k));
  for (let i = 0; i < PASOS; i++) {
    const pg = pick(J), a = pick(bolsa);
    process.stdout.write(`${i} ${pg.nombre} ${a} | `);
    try { await acciones[a](pg); } catch (e) { falla(pg.nombre, `acción ${a} tiró: ${e.message.split('\n')[0]}`); }
    for (const q of J) {
      const h = await q.textContent('#hint').catch(() => '');
      if (/error/i.test(h)) { falla(q.nombre, `hint con error después de ${pg.nombre} ${a}: ${h}`); await q.evaluate(() => { document.getElementById('hint').textContent = ''; }); }
    }
  }
  console.log('\n-- asentando --');
  // al final todos adentro, sin cámara, mirando
  for (const pg of J) {
    if (await vis(pg, '#start')) await pg.tap('#start');
    if (await vis(pg, '#drop')) await pg.tap('#drop');
    if (await vis(pg, '#salaPanel')) await pg.tap('#salaBtn');
    if (!(await pg.evaluate(() => __game.sala.active))) { await pg.tap('#salaBtn'); await pg.fill('#salaPass', 'museo de caos'); await pg.tap('#salaEntrar'); }
    if (await vis(pg, '#unequip')) await pg.tap('#unequip');
    if (await pg.evaluate(() => !__game.rtc.caraOn)) await pg.evaluate(() => rtcCaraAlternar());
  }
  await J[0].waitForTimeout(12000);
  const ids = await Promise.all(J.map(pg => pg.evaluate(() => __game.salaYo)));
  for (const [i, pg] of J.entries()) {
    const st = await pg.evaluate(ids => ({
      lost: gl.isContextLost(), gente: [...__game.sala.gente.keys()], works: __game.works.length,
      peers: Object.fromEntries([...__game.rtc.peers].map(([id, p]) => [id, p.pc.connectionState])),
      cara: !!__game.rtc.cara, mic: !!__game.rtc.mic,
      caras: ids.map(id => { const p = __game.rtc.peers.get(id); return !!(p && p.video && p.video.videoWidth); }),
    }), ids);
    const otros = ids.filter((_, j) => j !== i);
    if (st.lost) falla(pg.nombre, 'webgl perdido al final');
    for (const o of otros) {
      if (!st.gente.includes(o)) falla(pg.nombre, 'no ve a ' + o);
      if (st.peers[o] !== 'connected') falla(pg.nombre, `rtc con ${o}: ${st.peers[o]}`);
    }
    if (!st.cara) falla(pg.nombre, 'sin cara propia');
    if (st.caras.filter(x => x).length < 2) falla(pg.nombre, 'no recibe todas las caras ' + JSON.stringify(st.caras));
    console.log(pg.nombre, JSON.stringify(st));
  }
  const nw = await Promise.all(J.map(pg => pg.evaluate(() => __game.works.length)));
  if (new Set(nw).size > 1) falla('todos', 'distinta cantidad de fotos: ' + nw);
  if (fallas.length) { console.log('\nFALLAS', fallas.length); for (const pg of J) console.log(pg.nombre, 'registro:\n  ' + (await pg.evaluate(() => diagLog.slice(-25).join('\n  ')))); }
  else console.log('\nOK sin fallas');
  await b.close(); web.close(); dbSrv.close(); process.exit(0);
})();
