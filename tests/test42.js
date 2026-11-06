// el sonido del lugar en la sala (v10.17, propuesta 4 parte 2): la foto que sacás en la sala graba 4 s del micrófono de
// la voz y lo sube (imgs/<id>~son + so en la pose); los demás lo bajan recién al acercarse y lo escuchan; vaciarla o
// borrarla le saca el sonido (también en la base); con "mic: no" no graba; llenar un bloque con la cámara también graba
// (en la sala y en el museo, aunque lo sueltes antes de que termine).
// uso: node tests/test42.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.');
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const PASS = 'prueba sonido sala', H = crypto.createHash('sha256').update('juego:' + PASS).digest('hex');
const DB = 'http://localhost:8432';
(async () => {
  const dbSrv = await mock(8432);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8431);
  const URL = 'http://localhost:8431/?db=' + DB;
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const base = async () => (await (await fetch(DB + '/__dump')).json()).salas[H] || {};
  const esperaBase = async (f, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f(await base())) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
  const nueva = async () => {
    const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] });
    const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL + '&borrar'); await pg.goto(URL); await pg.waitForTimeout(300);
    await pg.tap('#start'); await espera(pg, () => __game.camReady); await pg.waitForTimeout(200);
    return pg;
  };
  const entrar = async pg => {
    await pg.tap('#salaBtn'); await pg.fill('#salaPass', PASS); await pg.tap('#salaEntrar');
    await espera(pg, () => __game.sala.active && __game.sala.estadoVisto);
    await pg.evaluate(() => { const p = document.getElementById('salaPanel'); if (p) p.style.display = 'none'; });
    await espera(pg, () => __game.rtc.mic && __game.rtc.mic.getAudioTracks().some(t => t.readyState === 'live'), null, 8000);
  };
  const A = await nueva(), B = await nueva();
  await entrar(A); await entrar(B);
  ok('los dos en la sala con el mic de la voz', await A.evaluate(() => !!__game.rtc.mic) && await B.evaluate(() => !!__game.rtc.mic));

  await B.evaluate(() => { __game.pos[0] = 40; __game.pos[2] = 40; });   // B lejos desde antes (si no, lo baja mientras sube)
  // A saca una foto: graba del micrófono de la voz (no abre otro)
  if (!(await A.evaluate(() => __game.camOn))) { await A.tap('#equip'); await espera(A, () => __game.camReady); }
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  await A.tap('#shoot'); await A.waitForTimeout(300);
  ok('en la sala graba al sacar', (await A.evaluate(() => __game.son.grabando)) === 1);
  ok('sin abrir otro micrófono', await A.evaluate(() => !__game.son.mic));
  const id = await A.evaluate(() => __game.works[__game.works.length - 1].id);
  ok('la foto tiene su sonido', await espera(A, id => { const w = __game.works.find(w => w.id === id); return w && w.son && w.son.size > 500; }, id, 9000));
  ok('el micrófono de la voz sigue vivo', await A.evaluate(() => __game.rtc.mic.getAudioTracks().every(t => t.readyState === 'live')));
  ok('subió el sonido y la marca a la base', await esperaBase(s => typeof (s.imgs || {})[id + '~son'] === 'string' && /^data:audio\//.test(s.imgs[id + '~son']) && s.poses && s.poses[id] && s.poses[id].so > 0));
  const kb = ((await base()).imgs[id + '~son'].length / 1024);
  ok(`pesa poco en la base (${kb.toFixed(1)} KB)`, kb < 40);
  ok('la foto sigue en la base', !!(await base()).poses[id].c && typeof (await base()).imgs[id] === 'string');

  // B: lejos no lo baja; cerca sí, y suena
  await B.evaluate(() => { __game.pos[0] = 40; __game.pos[2] = 40; });
  ok('B ve la foto con su marca de sonido', await espera(B, id => { const w = __game.works.find(w => w.id === id); return w && w.so > 0; }, id, 8000));
  await B.waitForTimeout(1200);
  ok('lejos no lo baja', await B.evaluate(id => { const w = __game.works.find(w => w.id === id); return !w.son && !w.sonPedido; }, id));
  await B.evaluate(id => { const w = __game.works.find(w => w.id === id); __game.pos[0] = w.c[0]; __game.pos[2] = w.c[2] + 1; }, id);
  ok('cerca lo baja', await espera(B, id => { const w = __game.works.find(w => w.id === id); return w.son && w.son.size > 500; }, id, 5000));
  ok('y suena', await espera(B, () => __game.son.sonando.size === 1 && [...__game.son.sonando.values()][0].vol > 0.3, null, 5000));

  // C entra después (o recarga): la foto le llega con su marca y lo escucha al acercarse
  const C = await nueva(); await entrar(C);
  ok('C, que entró después, ve la marca de sonido', await espera(C, id => { const w = __game.works.find(w => w.id === id); return w && w.so > 0; }, id, 8000));
  await C.evaluate(id => { const w = __game.works.find(w => w.id === id); __game.pos[0] = w.c[0] + 0.3; __game.pos[2] = w.c[2] + 1.2; }, id);
  ok('y lo escucha al acercarse', await espera(C, () => __game.son.sonando.size === 1, null, 8000));
  await C.context().close();

  // A la mueve: el sonido sigue
  await A.tap('#unequip'); await A.waitForTimeout(200);
  await A.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, id); await A.waitForTimeout(1000);
  await A.evaluate(() => { __game.look(20, 0); }); await A.waitForTimeout(300);
  await A.tap('#drop'); await A.waitForTimeout(800);
  ok('movida, la base sigue con el sonido', await esperaBase(s => s.poses[id] && s.poses[id].so > 0 && typeof s.imgs[id + '~son'] === 'string', 3000));
  ok('B la sigue escuchando', await B.evaluate(() => __game.son.sonando.size === 1));

  // A la vacía: se le va el sonido (en la base y en B)
  await A.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, id); await A.waitForTimeout(1000);
  await A.tap('#vaciarFoto'); await A.waitForTimeout(200); await A.tap('#drop');
  ok('vaciada: sin sonido en la base', await esperaBase(s => s.poses[id] && s.poses[id].vacio && !s.poses[id].so && !(id + '~son' in (s.imgs || {})), 5000));
  ok('B no la escucha más', await espera(B, id => { const w = __game.works.find(w => w.id === id); return w.vacio && !w.son && !w.so && __game.son.sonando.size === 0; }, id, 5000));

  // un bloque vacío llenado con la cámara también graba (y lo soltás antes de que termine)
  await A.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, id); await A.waitForTimeout(1000);
  ok('agarré el bloque', await A.evaluate(id => __game.held && __game.held.work.id === id, id));
  await A.tap('#llenarFoto');   // con la cámara guardada: la equipa
  await espera(A, () => __game.camReady && document.getElementById('llenarFoto').textContent === 'sacar foto', null, 6000);
  await A.tap('#llenarFoto'); await A.waitForTimeout(400);
  ok('al llenarlo con la cámara graba', (await A.evaluate(() => __game.son.grabando)) === 1);
  await A.tap('#drop'); await A.waitForTimeout(300);
  ok('lo solté antes de que termine y el sonido llega igual', await esperaBase(s => s.poses[id] && !s.poses[id].vacio && s.poses[id].so > 0 && typeof s.imgs[id + '~son'] === 'string' && typeof s.imgs[id] === 'string', 10000));
  ok('B lo escucha', await espera(B, () => __game.son.sonando.size === 1, null, 8000));

  // borrarla borra el sonido
  await A.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, id); await A.waitForTimeout(1000);
  await A.evaluate(() => trash()); await A.waitForTimeout(300);
  ok('borrada: sin foto ni sonido en la base', await esperaBase(s => !(s.poses || {})[id] && !(id in (s.imgs || {})) && !(id + '~son' in (s.imgs || {})), 5000));
  ok('B ya no la escucha', await espera(B, () => __game.son.sonando.size === 0, null, 4000));

  // sonido roto que llega por la red: no se toma
  await A.evaluate(() => { if (!__game.camOn) document.getElementById('equip').click(); });
  await espera(A, () => __game.camReady);
  ok('un sonido roto no se toma', await B.evaluate(() => salaSonBlob('data:text/html;base64,PGI+') === null && salaSonBlob('<script>') === null && salaSonBlob(12) === null && salaSonBlob('data:audio/mp4;base64,' + 'A'.repeat(400)) instanceof Blob));

  // apagar el mic en medio de la grabación la corta y no sube nada
  await A.tap('#shoot'); await A.waitForTimeout(600);
  const id2 = await A.evaluate(() => __game.works[__game.works.length - 1].id);
  ok('graba la otra foto', (await A.evaluate(() => __game.son.grabando)) === 1);
  await A.tap('#micBtn'); await A.waitForTimeout(300);
  ok('mic apagado en medio: deja de grabar', (await A.evaluate(() => __game.son.grabando)) === 0);
  await A.waitForTimeout(5000);
  ok('y no se sube nada', await A.evaluate(id => !__game.works.find(w => w.id === id).son, id2) && !((id2 + '~son') in ((await base()).imgs || {})) && !(await base()).poses[id2].so);

  // con "mic: no" no graba
  await A.waitForTimeout(400);
  await A.tap('#shoot'); await A.waitForTimeout(400);
  ok('con mic apagado no graba', (await A.evaluate(() => __game.son.grabando)) === 0);
  ok('y lo avisa', /mic apagado/.test(await A.textContent('#hint')));
  await A.tap('#micBtn'); await A.waitForTimeout(400);

  // en el museo: llenar un bloque con la cámara también graba, y se guarda
  await A.evaluate(() => salaSalir()); await A.waitForTimeout(800);
  await A.evaluate(() => { const o = { id: 'bq1', c: [0, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 0.8, h: 0.6, uv: [0, 0, 1, 1], vacio: true, t0: Date.now() };
    addWork(o, VACIO_IMG); return store('readwrite', s => s.put({ ...o, blob: null })); });
  await A.evaluate(() => { pick(__game.works.find(w => w.id === 'bq1')); ui(); }); await A.waitForTimeout(1000);
  await espera(A, () => __game.camReady && document.getElementById('llenarFoto').textContent === 'sacar foto', null, 6000);
  await A.tap('#llenarFoto'); await A.waitForTimeout(300);
  ok('museo: llenar con la cámara graba', (await A.evaluate(() => __game.son.grabando)) === 1);
  await A.waitForTimeout(800); await A.tap('#drop');
  ok('museo: el bloque llenado tiene su sonido', await espera(A, () => { const w = __game.works.find(w => w.id === 'bq1'); return w && !w.vacio && w.son && w.son.size > 500; }, null, 9000));
  await A.waitForTimeout(500);
  ok('museo: y quedó guardado con la imagen', await A.evaluate(async () => { const o = await store('readonly', s => s.get('bq1')); return !!(o && o.blob && !o.vacio && o.son && o.son.size > 500); }));

  for (const [n, pg] of [['A', A], ['B', B]]) {
    ok(n + ' sin errores', !pg.errs.length && !/error/i.test(await pg.textContent('#hint')));
    if (pg.errs.length) console.log(pg.errs);
  }
  console.log(`\n${fallas ? fallas + ' FALLAS' : 'TODO OK'}`);
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
