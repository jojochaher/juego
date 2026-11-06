// el cielo (v10.15, propuesta 3 parte 2): "usar de cielo" con una foto en la mano la sube al cielo (envuelve todo,
// no está más en su lugar: no se dibuja ahí, no choca, no se agarra); "bajar el cielo" (☰) la devuelve. Museo y sala.
// uso: node tests/test40.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const PASS = 'prueba cielo', H = crypto.createHash('sha256').update('juego:' + PASS).digest('hex');
const DB = 'http://localhost:8402';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8402);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8401);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const visto = (pg, sel) => pg.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; }, sel);
  const px = (pg, x, y) => pg.evaluate(([x, y]) => new Promise(res => requestAnimationFrame(() => {
    const a = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * (1 - y)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); res([...a].slice(0, 3));
  })), [x, y]);
  const cielo = pg => pg.evaluate(() => __game.cielo && __game.cielo.id);

  // ---------- museo ----------
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] });
  let pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto('http://localhost:8401/?borrar'); await pg.goto('http://localhost:8401/'); await pg.waitForTimeout(300);
  await pg.tap('#start'); await espera(pg, () => __game.camReady);
  await pg.tap('#unequip'); await pg.waitForTimeout(300);
  ok('sin cielo: no hay "bajar el cielo" en ☰', !(await visto(pg, '#opcCielo')));
  // dos fotos guardadas en el museo: una roja común (4:3) y una panorámica 2:1 (mitad izquierda roja, derecha azul,
  // franja de arriba verde) — guardadas como las de la cámara, así sobreviven a recargar
  await pg.evaluate(async () => {
    const mk = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d')); return c; };
    const rojo = mk(64, 48, x => { x.fillStyle = '#d23020'; x.fillRect(0, 0, 64, 48); });
    const pano = mk(128, 64, x => { x.fillStyle = '#e02010'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#1040e0'; x.fillRect(64, 0, 64, 64); x.fillStyle = '#20d040'; x.fillRect(0, 0, 128, 8); });
    const pon = (o, c) => new Promise(res => { addWork(o, c); c.toBlob(blob => store('readwrite', s => s.put({ ...o, blob })).then(res), 'image/jpeg', 0.9); });
    await pon({ id: 'r1', c: [0, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 0.8, h: 0.6, t0: Date.now() }, rojo);
    await pon({ id: 'p2', c: [2.5, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1.2, h: 0.6, t0: Date.now() }, pano);
    __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0);
  });
  await pg.waitForTimeout(300);
  const vp = pg.viewportSize();
  await pg.touchscreen.tap(vp.width / 2, vp.height / 2); await pg.waitForTimeout(1200);
  ok('agarré la roja', (await pg.evaluate(() => __game.held && __game.held.work.id)) === 'r1');
  ok('con una foto en la mano: "usar de cielo"', await visto(pg, '#cieloFoto'));
  const nSol = await pg.evaluate(() => solidas().length);
  await pg.tap('#cieloFoto'); await pg.waitForTimeout(400);
  ok('se suelta y es el cielo', !(await pg.evaluate(() => __game.held)) && (await cielo(pg)) === 'r1');
  ok('avisa cómo bajarla', (await pg.textContent('#hint')).includes('bajar el cielo'));
  ok('no choca más (' + nSol + ' → ' + (await pg.evaluate(() => solidas().length)) + ')', (await pg.evaluate(() => solidas().length)) === nSol);   // la de la mano tampoco chocaba
  ok('no está en las sólidas', await pg.evaluate(() => !solidas().some(w => w.id === 'r1')));
  await pg.evaluate(() => __game.look(0, 0)); await pg.waitForTimeout(200);
  ok('tocar donde estaba no la agarra', await pg.evaluate(() => !workHit(innerWidth / 2, innerHeight / 2)));
  await pg.evaluate(() => __game.look(-90, 50)); await pg.waitForTimeout(300);
  let p = await px(pg, 0.5, 0.5);
  ok('mirando para arriba a otro lado se ve el cielo rojo ' + p, p[0] > 120 && p[0] > p[1] * 2 && p[0] > p[2] * 2);
  await pg.screenshot({ path: out + 'v10.15_cielo_rojo.png' });
  p = await px(pg, 0.5, 0.97);
  await pg.evaluate(() => __game.look(-90, -70)); await pg.waitForTimeout(300);
  const abajo = await px(pg, 0.5, 0.5), atm = await pg.evaluate(() => __game.atm.map(v => v * 255));
  ok('mirando abajo, el fondo (más oscuro, del color del cielo) ' + abajo, abajo[0] < 110 && abajo.every((v, i) => Math.abs(v - atm[i]) < 25));
  await pg.waitForTimeout(2500);
  const a2 = await pg.evaluate(() => __game.atm.slice());
  ok('la niebla toma el color del cielo ' + a2.map(v => v.toFixed(2)), a2[0] > 0.2 && a2[0] > a2[1] * 2);
  ok('☰ tiene "bajar el cielo"', await visto(pg, '#opcCielo'));
  const guardado = await pg.evaluate(() => store('readonly', s => s.get('r1')));
  ok('guardado en el museo (cielo > 0)', guardado && guardado.cielo > 0);

  // la panorámica: da la vuelta entera (mirando al frente: a la izquierda lo rojo, a la derecha lo azul, arriba lo verde)
  await pg.evaluate(() => { __game.look(0, 0); pick(__game.works.find(w => w.id === 'p2')); }); await pg.waitForTimeout(1200);
  ok('agarré la panorámica', (await pg.evaluate(() => __game.held && __game.held.work.id)) === 'p2' && await visto(pg, '#cieloFoto'));
  await pg.tap('#cieloFoto'); await pg.waitForTimeout(400);
  ok('ahora el cielo es la panorámica', (await cielo(pg)) === 'p2');
  ok('la roja bajó a su lugar (cielo < 0, choca de nuevo)', await pg.evaluate(() => __game.works.find(w => w.id === 'r1').cielo < 0 && solidas().some(w => w.id === 'r1')));
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 30); }); await pg.waitForTimeout(300);
  const izq = await px(pg, 0.15, 0.3), der = await px(pg, 0.85, 0.3);
  ok('panorámica: izquierda roja ' + izq + ', derecha azul ' + der, izq[0] > izq[2] + 60 && der[2] > der[0] + 60);
  await pg.evaluate(() => __game.look(0, 88)); await pg.waitForTimeout(300);
  p = await px(pg, 0.5, 0.5);
  ok('panorámica: arriba de todo, lo de arriba de la foto (verde) ' + p, p[1] > p[0] + 50 && p[1] > p[2] + 50);
  await pg.evaluate(() => __game.look(0, 0)); await pg.waitForTimeout(300);
  p = await px(pg, 0.5, 0.5);
  ok('la roja se ve otra vez donde estaba ' + p, p[0] > 180 && p[1] < 90);
  await pg.screenshot({ path: out + 'v10.15_panoramica.png' });

  // se recuerda al recargar
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await espera(pg, () => __game.works.length >= 2);
  ok('al recargar el cielo sigue siendo la panorámica', await espera(pg, () => __game.cielo && __game.cielo.id === 'p2', null, 5000));
  // bajarla desde ☰
  await pg.tap('#menuBtn'); await pg.waitForTimeout(200);
  ok('☰ → "bajar el cielo"', await visto(pg, '#opcCielo'));
  await pg.tap('#opcCielo'); await pg.waitForTimeout(400);
  ok('sin cielo', !(await cielo(pg)) && !(await visto(pg, '#opciones')));
  ok('la panorámica volvió a su lugar', await pg.evaluate(() => solidas().some(w => w.id === 'p2')));
  ok('guardado (cielo < 0)', (await pg.evaluate(() => store('readonly', s => s.get('p2')))).cielo < 0);
  await pg.waitForTimeout(6000);
  await pg.evaluate(() => { __game.pos[0] = -300; __game.look(0, 70); }); await pg.waitForTimeout(6000);
  const a3 = await pg.evaluate(() => __game.atm.slice());
  ok('lejos de todo y sin cielo, el fondo de siempre ' + a3.map(v => v.toFixed(3)), a3.every((v, i) => Math.abs(v - [0.04, 0.04, 0.05][i]) < 0.01));
  ok('sin "bajar el cielo"', !(await visto(pg, '#opcCielo')));
  // un bloque vacío no puede ser el cielo
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; addWork({ id: 'v1', c: [0, 1.6, 2], r: [-1, 0, 0], u: [0, 1, 0], w: 1, h: 1, vacio: true }, VACIO_IMG); pick(__game.works.find(w => w.id === 'v1')); });
  await pg.waitForTimeout(1200);
  ok('con un bloque vacío en la mano no hay "usar de cielo"', !(await visto(pg, '#cieloFoto')));
  await pg.evaluate(() => releaseHold());
  // cómo se reparte una foto común alrededor: copias pares (espejadas sin costura)
  const mapas = await pg.evaluate(() => [0.75, 1.33, 1.78, 2, 4].map(A => cieloMapa({ w: A, h: 1 })));
  ok('mapas: ' + JSON.stringify(mapas.map(m => m[0] + (m[3] ? 'e' : ''))), mapas.slice(0, 3).every(m => m[0] % 2 === 0 && m[3] === 1) && mapas[3][0] === 1 && mapas[4][0] === 1);
  ok('museo: sin errores de dibujo', !(await pg.textContent('#hint')).includes('error'));
  ok('museo: sin errores de JS ' + pg.errs, pg.errs.length === 0);
  await ctx.close();

  // ---------- sala ----------
  const URL = 'http://localhost:8401/?db=' + DB;
  const mk = async () => { const c = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await c.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 }); return pg; };
  const entrar = async pg => { await pg.tap('#unequip'); await pg.tap('#salaBtn'); await pg.fill('#salaPass', PASS); await pg.tap('#salaEntrar'); };
  const dump = async () => ((((await (await fetch(DB + '/__dump')).json()) || {}).salas || {})[H] || {});
  const sacar = async (pg) => { const n = await pg.evaluate(() => __game.works.length); await pg.tap('#equip'); await espera(pg, () => __game.camReady && __game.camOn, null, 5000); await pg.waitForTimeout(300); await pg.tap('#shoot'); await pg.waitForTimeout(200); await pg.tap('#unequip'); await espera(pg, n => __game.works.length > n, n, 3000); return pg.evaluate(() => __game.works[__game.works.length - 1].id); };
  const A = await mk(); await entrar(A);
  const B = await mk(); await entrar(B);
  const idA = await A.evaluate(() => __game.salaYo), idB = await B.evaluate(() => __game.salaYo);
  ok('se ven en la sala', await espera(A, id => __game.sala.gente.has(id), idB) && await espera(B, id => __game.sala.gente.has(id), idA));
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  const f1 = await sacar(A);
  await A.evaluate(() => __game.look(90, 0));
  const f2 = await sacar(A);
  ok('B tiene las dos', await espera(B, ids => ids.every(id => __game.works.some(w => w.id === id)), [f1, f2]));
  await espera(A, ids => ids.every(id => __game.sala.idsSala.has(id)), [f1, f2], 5000);
  await A.evaluate(id => pick(__game.works.find(w => w.id === id)), f1); await A.waitForTimeout(1200);
  ok('A: "usar de cielo" con la foto de la sala', await visto(A, '#cieloFoto'));
  await A.tap('#cieloFoto'); await A.waitForTimeout(800);
  let d = await dump();
  ok('en la base: la pose lleva cielo > 0 y sigue entera', d.poses[f1].cielo > 0 && d.poses[f1].c && d.poses[f1].w > 0);
  ok('B: el cielo de la sala es esa foto', await espera(B, id => __game.cielo && __game.cielo.id === id, f1, 6000));
  ok('B: no la puede agarrar ni choca', await B.evaluate(id => !solidas().some(w => w.id === id), f1));
  ok('A: dice que lo ven todos', (await A.textContent('#hint')).includes('lo ven todos'));
  await B.screenshot({ path: out + 'v10.15_sala_B.png' });
  // A pasa al cielo la otra: la primera vuelve a su lugar (para todos)
  await A.evaluate(id => pick(__game.works.find(w => w.id === id)), f2); await A.waitForTimeout(1200);
  await A.tap('#cieloFoto'); await A.waitForTimeout(800);
  d = await dump();
  ok('base: la nueva > 0, la vieja < 0', d.poses[f2].cielo > 0 && d.poses[f1].cielo < 0);
  ok('B: cielo nuevo', await espera(B, id => __game.cielo && __game.cielo.id === id, f2, 6000));
  // B lo baja desde ☰: para A también
  await B.tap('#menuBtn'); await B.waitForTimeout(200); await B.tap('#opcCielo'); await B.waitForTimeout(800);
  ok('B lo bajó', !(await cielo(B)));
  ok('A: sin cielo', await espera(A, () => !__game.cielo, null, 6000));
  d = await dump();
  ok('base: las dos < 0', d.poses[f2].cielo < 0 && d.poses[f1].cielo < 0);
  // la vuelven a subir; mientras B tiene la foto en la mano otro la sube al cielo: al soltarla B no lo pisa
  await B.evaluate(id => pick(__game.works.find(w => w.id === id)), f1); await B.waitForTimeout(1200);
  await A.evaluate(id => pick(__game.works.find(w => w.id === id)), f1); await A.waitForTimeout(1200);
  await A.tap('#cieloFoto'); await A.waitForTimeout(1000);
  await B.evaluate(() => drop()); await B.waitForTimeout(1000);
  d = await dump();
  ok('B soltó la foto que A subió al cielo: sigue en el cielo', d.poses[f1].cielo > 0);
  ok('B: cielo f1', await espera(B, id => __game.cielo && __game.cielo.id === id, f1, 6000));
  // borran la foto del cielo (desde "mis salas"): no vuelve ninguna otra al cielo
  await fetch(DB + '/salas/' + H + '/poses/' + f1 + '.json', { method: 'DELETE' });
  ok('borrada la del cielo: B sin cielo', await espera(B, () => !__game.cielo, null, 6000));
  ok('A sin cielo', await espera(A, () => !__game.cielo, null, 6000));
  // un cielo que llega roto no rompe nada
  await fetch(DB + '/salas/' + H + '/poses/' + f2 + '/cielo.json', { method: 'PUT', body: JSON.stringify('x') });
  await B.waitForTimeout(1500);
  ok('cielo roto: se ignora', !(await cielo(B)) && await B.evaluate(id => __game.works.find(w => w.id === id).cielo === undefined, f2));
  // un celu con el reloj adelantado subió f2 al cielo: aunque mi reloj vaya atrás, "usar de cielo" con otra anda
  await fetch(DB + '/salas/' + H + '/poses/' + f2 + '/cielo.json', { method: 'PUT', body: JSON.stringify(Date.now() + 3600e3) });
  ok('B: cielo del reloj adelantado', await espera(B, id => __game.cielo && __game.cielo.id === id, f2, 6000));
  await B.evaluate(() => { __game.look(-90, 0); });
  const f3 = await sacar(B);
  await espera(B, id => __game.sala.idsSala.has(id), f3, 5000);
  await B.evaluate(id => pick(__game.works.find(w => w.id === id)), f3); await B.waitForTimeout(1200);
  await B.tap('#cieloFoto'); await B.waitForTimeout(800);
  ok('B: con el reloj atrás igual queda su foto en el cielo', (await cielo(B)) === f3);
  ok('A también', await espera(A, id => __game.cielo && __game.cielo.id === id, f3, 6000));
  // dos arriba a la vez (dos subieron casi juntos): bajar el cielo las baja a las dos
  await fetch(DB + '/salas/' + H + '/poses/' + f2 + '/cielo.json', { method: 'PUT', body: JSON.stringify(1000) });
  await A.waitForTimeout(1000);
  await A.tap('#menuBtn'); await A.waitForTimeout(200); await A.tap('#opcCielo'); await A.waitForTimeout(800);
  ok('A bajó el cielo: no aparece la otra', !(await cielo(A)));
  ok('B: tampoco', await espera(B, () => !__game.cielo, null, 6000));
  d = await dump();
  ok('base: ninguna arriba', Object.values(d.poses || {}).every(p => !(p.cielo > 0)));
  for (const [n, q] of [['A', A], ['B', B]]) {
    ok(n + ': sin errores de dibujo', !(await q.textContent('#hint')).includes('error'));
    ok(n + ': sin errores de JS ' + q.errs, q.errs.length === 0);
  }
  console.log(fallas ? 'FALLAS: ' + fallas : 'todo OK');
  await b.close(); web.close(); dbSrv.close && dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
