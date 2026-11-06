// huellas (v10.12, propuesta 2 parte 1): cada foto de la sala guarda quién la puso (de: id, color, forma) y cuándo (t0);
// lo que no viste desde tu última vez brilla en el color de quien lo puso hasta que lo mirás, y al entrar avisa
// "desde tu última vez: N fotos nuevas". La primera vez en una sala no brilla nada; lo tuyo nunca.
// uso: node tests/test38.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const PASS = 'prueba huellas', H = crypto.createHash('sha256').update('juego:' + PASS).digest('hex');
const DB = 'http://localhost:8382';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8382);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8381);
  const URL = 'http://localhost:8381/?db=' + DB;
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async (ctx) => { ctx = ctx || await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 }); return pg; };
  const espera = (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const entrar = async pg => { await pg.tap('#unequip'); await pg.tap('#salaBtn'); await pg.fill('#salaPass', PASS); await pg.tap('#salaEntrar'); };
  const dump = async () => ((((await (await fetch(DB + '/__dump')).json()) || {}).salas || {})[H] || {});
  const sacar = async (pg) => { const n = await pg.evaluate(() => __game.works.length); await pg.tap('#equip'); await espera(pg, () => __game.camReady && __game.camOn, null, 5000); await pg.waitForTimeout(300); await pg.tap('#shoot'); await pg.waitForTimeout(200); await pg.tap('#unequip'); await espera(pg, n => __game.works.length > n, n, 3000); return pg.evaluate(() => __game.works[__game.works.length - 1].id); };
  const nueva = (pg, id) => pg.evaluate(id => { const w = __game.works.find(x => x.id === id); return w ? !!w.nueva : null; }, id);

  const A = await mk(); await entrar(A);
  const ctxB = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] });
  const B = await mk(ctxB); await entrar(B);
  const idA = await A.evaluate(() => __game.salaYo), idB = await B.evaluate(() => __game.salaYo);
  ok('se ven en la sala', await espera(A, id => __game.sala.gente.has(id), idB) && await espera(B, id => __game.sala.gente.has(id), idA));
  const colA = await A.evaluate(() => salaColor.map(v => Math.round(v * 100) / 100));

  // A saca una foto: la pose lleva quién y cuándo
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 6; __game.look(180, 0); });   // B mira para el otro lado
  const t0 = Date.now();
  const f1 = await sacar(A);
  await A.waitForTimeout(1500);
  let d = await dump();
  const p1 = (d.poses || {})[f1];
  ok('la pose en la base lleva de (id y color de A) y t0', !!p1 && p1.de && p1.de.id === idA && JSON.stringify(p1.de.col) === JSON.stringify(colA) && p1.t0 >= t0 - 1000 && p1.t0 <= Date.now());
  ok('A: lo suyo no brilla', (await nueva(A, f1)) === false);
  ok('B: llegó mientras estaba y brilla', await espera(B, id => { const w = __game.works.find(x => x.id === id); return w && w.nueva && w.de && w.de.id; }, f1, 8000));
  await B.waitForTimeout(3500);
  ok('B: mirando para otro lado sigue brillando', (await nueva(B, f1)) === true);
  // B la mira: se apaga en ~3 + 1,5 s
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 1.5; __game.look(0, 0); });
  await B.waitForTimeout(700);
  await B.screenshot({ path: out + 'v1012_brilla.png' });
  const brillo = await B.evaluate(id => { const w = __game.works.find(x => x.id === id); return w.nueva && w.nueva.visto; }, f1);
  ok('B: mirándola se cuenta el tiempo (' + (brillo || 0).toFixed(2) + ' s)', brillo > 0.3);
  ok('B: después de mirarla un rato deja de brillar', await espera(B, id => { const w = __game.works.find(x => x.id === id); return w && !w.nueva; }, f1, 8000));

  // B se va; A pone dos fotos y un bloque; llega también una foto de un cliente viejo (sin de)
  await B.evaluate(() => salaSalir());
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 6; __game.look(0, 75); });   // al volver mira al cielo: no ve nada
  await A.waitForTimeout(500);
  await A.evaluate(() => { __game.look(-90, 0); });
  const f2 = await sacar(A);
  await A.evaluate(() => { __game.look(90, 0); });
  const f3 = await sacar(A);
  await A.evaluate(() => { setBloque(true); });
  await A.waitForTimeout(300);
  await A.evaluate(() => ponerBloque());
  await A.evaluate(() => setBloque(false));
  const bq = await A.evaluate(() => __game.works[__game.works.length - 1].id);
  await fetch(`${DB}/salas/${H}/poses/viejo1.json`, { method: 'PUT', body: JSON.stringify({ c: [5, 1.5, 5], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, vacio: true }) });
  await A.waitForTimeout(1500);
  d = await dump();
  ok('el bloque también lleva de y t0', !!(d.poses || {})[bq] && d.poses[bq].de && d.poses[bq].de.id === idA && Number.isFinite(d.poses[bq].t0) && d.poses[bq].vacio);
  // A mueve la primera: de y t0 se mantienen
  await A.evaluate(id => { const w = __game.works.find(x => x.id === id); w.c = [w.c[0] + 0.5, w.c[1], w.c[2]]; salaSavePose(w); }, f1);
  await A.waitForTimeout(800);
  d = await dump();
  ok('mover la foto mantiene de y t0', d.poses[f1].de && d.poses[f1].de.id === idA && d.poses[f1].t0 === p1.t0 && Math.abs(d.poses[f1].c[0] - p1.c[0] - 0.5) < 1e-6);

  // B vuelve: aviso con el color de A, brillan las 4 nuevas, la que ya vio no
  await B.evaluate(() => showHint('nada'));
  await B.evaluate(p => salaEntrarConPass(p), PASS);
  ok('B: "desde tu última vez: 4 fotos nuevas de ●"', await espera(B, () => /desde tu última vez: 4 fotos nuevas de ●/.test(document.getElementById('hint').textContent), null, 8000));
  const punto = await B.evaluate(() => { const s = document.querySelector('#hint span'); return s && getComputedStyle(s).color; });
  ok('el punto es del color de A (' + punto + ')', punto === `rgb(${colA.map(v => Math.round(v * 255)).join(', ')})`);
  ok('B: las nuevas brillan', await espera(B, ids => ids.every(id => { const w = __game.works.find(x => x.id === id); return w && w.nueva; }), [f2, f3, bq, 'viejo1'], 8000));
  ok('B: la que ya vio no brilla', await espera(B, id => { const w = __game.works.find(x => x.id === id); return w && !w.nueva; }, f1, 5000));
  ok('B: la foto vieja sin de brilla en blanco (sin error)', await B.evaluate(() => { const w = __game.works.find(x => x.id === 'viejo1'); return !!w && !salaColDe(w.de); }));
  // agarrar una la da por vista
  await B.evaluate(id => pick(__game.works.find(x => x.id === id)), f2);
  await B.waitForTimeout(1200);
  ok('B: agarrarla la da por vista', (await nueva(B, f2)) === false);
  ok('B: mientras tanto las otras siguen brillando', await B.evaluate(ids => ids.every(id => __game.works.find(x => x.id === id).nueva), [f3, bq, 'viejo1']));
  await B.evaluate(() => { releaseHold(); __game.look(0, 75); });   // agarrar giró la vista hacia las otras: que no las mire
  // una sin imagen (no baja nunca) y una rota: no quedan pendientes (si no, avisarían en cada visita)
  await fetch(`${DB}/salas/${H}/poses/sinimg1.json`, { method: 'PUT', body: JSON.stringify({ c: [9, 1.5, 9], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1 }) });
  await fetch(`${DB}/salas/${H}/poses/rota1.json`, { method: 'PUT', body: JSON.stringify({ c: [9, 1.5, -9], r: [1, 0, 0], u: [0, 1, 0], w: 0, h: 1, vacio: true }) });
  ok('la rota llega y no brilla', await espera(B, () => { const w = __game.works.find(x => x.id === 'rota1'); return w && w.rota && !w.nueva; }, null, 5000));
  // se recuerda al recargar: vuelven a brillar solo las que no vio
  await B.waitForTimeout(4500);   // se guarda cada 4 s
  const vistas = await B.evaluate(h => (JSON.parse(localStorage.getItem('vistas'))[h] || {}).ids || [], H);
  ok('lo guardado: las vistas, la sin imagen y la rota; no las que brillan', [f1, f2, 'sinimg1', 'rota1'].every(id => vistas.includes(id)) && ![f3, bq, 'viejo1'].some(id => vistas.includes(id)));
  await B.evaluate(() => showHint('nada'));
  await B.reload(); await B.waitForTimeout(300);
  // antes de tocar "entrar" (la pantalla tapa todo) no cuenta como mirada, aunque la tenga adelante
  await espera(B, id => __game.works.some(x => x.id === id && x.nueva), f3, 8000);
  await B.evaluate(id => { const w = __game.works.find(x => x.id === id); __game.pos[0] = w.c[0]; __game.pos[2] = w.c[2] + 2; __game.look(0, 0); }, f3);
  await B.waitForTimeout(5000);
  ok('antes de entrar, tenerla adelante no la apaga', (await nueva(B, f3)) === true);
  await B.tap('#start');
  await B.evaluate(() => { __game.look(0, 75); });
  await espera(B, () => __game.sala.active, null, 8000);
  ok('B (recargó): "3 fotos nuevas"', await espera(B, () => /desde tu última vez: 3 fotos nuevas/.test(document.getElementById('hint').textContent), null, 8000));
  ok('B (recargó): brillan f3, el bloque y la vieja, no f1 ni f2', await espera(B, ([si, no]) => si.every(id => { const w = __game.works.find(x => x.id === id); return w && w.nueva; }) && no.every(id => { const w = __game.works.find(x => x.id === id); return w && !w.nueva; }), [[f3, bq, 'viejo1'], [f1, f2]], 8000));
  // un cliente viejo mueve una foto (manda la pose sin de): B la conserva, y al moverla B se la vuelve a poner
  const sinDe = { ...d.poses[f1] }; delete sinDe.de; delete sinDe.t0;
  await fetch(`${DB}/salas/${H}/poses/${f1}.json`, { method: 'PUT', body: JSON.stringify(sinDe) });
  await B.waitForTimeout(800);
  await B.evaluate(id => salaSavePose(__game.works.find(x => x.id === id)), f1);
  await B.waitForTimeout(800);
  d = await dump();
  ok('una pose sin de de un cliente viejo no borra quién la puso', d.poses[f1].de && d.poses[f1].de.id === idA && d.poses[f1].t0 === p1.t0);
  // de roto que llega por la red: no rompe nada
  await fetch(`${DB}/salas/${H}/poses/roto1.json`, { method: 'PUT', body: JSON.stringify({ c: [-5, 1.5, 5], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, vacio: true, de: { id: 7, col: ['x', null, 9] }, t0: 'ayer' }) });
  ok('un de roto llega sin romper (brilla en blanco)', await espera(B, () => { const w = __game.works.find(x => x.id === 'roto1'); return w && w.nueva && !salaColDe(w.de) && w.t0 === undefined; }, null, 5000));
  await B.evaluate(() => { __game.pos[0] = -5; __game.pos[2] = 7; __game.look(0, 0); });
  await B.waitForTimeout(600);

  // la primera vez en una sala no brilla nada
  const C = await mk(); await C.evaluate(() => showHint('nada')); await entrar(C);
  ok('C (primera vez): llegan las fotos', await espera(C, n => __game.works.length >= n, 6, 8000));
  await C.waitForTimeout(800);
  ok('C (primera vez): nada brilla ni avisa', await C.evaluate(() => !__game.works.some(w => w.nueva)) && !/desde tu última vez/.test(await C.textContent('#hint')));

  // museo: la foto guarda cuándo (sin de)
  await C.evaluate(() => salaSalir());
  await C.waitForTimeout(800);
  const fm = await sacar(C);
  await C.waitForTimeout(800);
  const reg = await C.evaluate(async id => { const o = await store('readonly', s => s.get(id)); return o && { t0: o.t0, de: o.de }; }, fm);
  ok('museo: la foto guarda t0 y no de', !!reg && Number.isFinite(reg.t0) && reg.de === undefined);

  const err = pg => pg.textContent('#hint').then(t => /error/i.test(t));
  ok('sin errores', !(await err(A)) && !(await err(B)) && !(await err(C)) && !A.errs.length && !B.errs.length && !C.errs.length);
  if (A.errs.length || B.errs.length || C.errs.length) console.log('errores', A.errs, B.errs, C.errs);
  console.log(`\n${fallas ? fallas + ' FALLAS' : 'TODO OK'}`);
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
