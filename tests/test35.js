// encontrarse (v10.9, propuesta 13 parte 1): caritas en el borde con los de la sala que no se ven, "ir ahí",
// ir esquivando una pared y subiendo a una plataforma, y que el otro te vea llegar sin cruzar el museo flotando.
// uso: node tests/test35.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8352);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8351);
  const URL = 'http://localhost:8351/?db=http://localhost:8352';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async () => { const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 }); return pg; };
  const espera = (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const entrar = async pg => { await pg.tap('#unequip'); await pg.tap('#salaBtn'); await pg.fill('#salaPass', 'prueba encontrarse'); await pg.tap('#salaEntrar'); };
  const A = await mk(); await entrar(A);
  const B = await mk(); await entrar(B);
  const idA = await A.evaluate(() => __game.salaYo), idB = await B.evaluate(() => __game.salaYo);
  ok('se ven en la sala', await espera(A, id => __game.sala.gente.has(id), idB) && await espera(B, id => __game.sala.gente.has(id), idA));
  ok('A recibe la cara de B', await espera(A, id => { const p = __game.rtc.peers.get(id); return p && p.video && p.video.videoWidth > 0; }, idB, 25000));

  // B lejos, atrás a la derecha de A
  await B.evaluate(() => { __game.pos[0] = 10; __game.pos[2] = 5; __game.look(0, 0); });
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  const visibles = pg => pg.evaluate(() => [...document.querySelectorAll('#lejos .lejos')].filter(e => e.style.display !== 'none' && getComputedStyle(document.getElementById('lejos')).display !== 'none').map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, m: e.querySelector('.m').textContent }; }));
  ok('aparece la carita de B en el borde', await espera(A, () => document.querySelectorAll('#lejos .lejos').length === 1 && getComputedStyle(document.getElementById('lejos')).display !== 'none', null, 6000));
  await A.waitForTimeout(1500);
  let v = await visibles(A);
  const W = await A.evaluate(() => innerWidth);
  ok('una sola carita, del lado derecho, con la distancia (' + JSON.stringify(v) + ')', v.length === 1 && v[0].x > W - 60 && /^1[01] m$/.test(v[0].m));
  ok('la carita tiene su cara (no un color liso)', await A.evaluate(() => {
    const c = document.querySelector('#lejos .lejos canvas'), d = c.getContext('2d').getImageData(0, 0, 64, 64).data, vistos = new Set();
    for (let i = 0; i < d.length; i += 4 * 7) vistos.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
    return rtcCaraLienzo(__game.sala.gente.keys().next().value).c && vistos.size > 6;
  }));
  // B atrás: la carita va abajo (o a un costado), nunca arriba entre los botones
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 9; });
  await A.waitForTimeout(1500);
  v = await visibles(A);
  const H = await A.evaluate(() => innerHeight);
  ok('justo atrás: la carita va abajo (' + JSON.stringify(v) + ')', v.length === 1 && v[0].y > H / 2 && v[0].y < H - 100);
  // B adelante: no hay carita
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = -6; });
  ok('si se ve, no hay carita', await espera(A, () => getComputedStyle(document.getElementById('lejos')).display === 'none', null, 4000));
  // B a la izquierda: tocar la carita y "ir ahí"
  await B.evaluate(() => { __game.pos[0] = -14; __game.pos[2] = -3; __game.look(-90, 0); });   // mira hacia +x... (look(-90) = yaw +90°: mira a -x)
  await espera(A, () => document.querySelectorAll('#lejos .lejos').length === 1 && getComputedStyle(document.getElementById('lejos')).display !== 'none', null, 4000);
  await A.waitForTimeout(1200);
  v = await visibles(A);
  ok('a la izquierda: carita del lado izquierdo', v.length === 1 && v[0].x < 60);
  await A.screenshot({ path: out + 'v109_carita.png' });
  await A.tap('#lejos .lejos');
  ok('tocarla muestra "ir ahí"', await A.isVisible('#lejosIr'));
  await A.screenshot({ path: out + 'v109_ir.png' });
  await A.tap('#lejosIr');
  await A.waitForTimeout(300);
  const pB = await B.evaluate(() => __game.pos.slice()), yawB = await B.evaluate(() => { const f = basis().f; return Math.atan2(-f[0], -f[2]); });
  const pA = await A.evaluate(() => __game.pos.slice());
  const dAB = Math.hypot(pA[0] - pB[0], pA[2] - pB[2]);
  ok('fui al lado de B (a ' + dAB.toFixed(2) + ' m)', Math.abs(dAB - 1.5) < 0.15);
  const delante = ((pA[0] - pB[0]) * -Math.sin(yawB) + (pA[2] - pB[2]) * -Math.cos(yawB)) / dAB;
  ok('delante suyo (' + delante.toFixed(2) + ')', delante > 0.9);
  ok('lo estoy mirando: ya no hay carita y dice "acá está"', await espera(A, () => getComputedStyle(document.getElementById('lejos')).display === 'none', null, 3000) && /acá está/.test(await A.textContent('#hint')));
  ok('"ir ahí" se fue', !(await A.isVisible('#lejosIr')));
  // B me ve llegar ahí mismo (sin cruzar flotando)
  await B.waitForTimeout(700);
  const dispA = await B.evaluate(id => __game.sala.gente.get(id).disp.p.slice(), idA);
  ok('B me ve a su lado enseguida (a ' + Math.hypot(dispA[0] - pB[0], dispA[2] - pB[2]).toFixed(2) + ' m)', Math.hypot(dispA[0] - pB[0], dispA[2] - pB[2]) < 2.2);
  await B.screenshot({ path: out + 'v109_llego.png' });

  // atrás de una pared, para este lado: carita donde está, sin flecha
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); const cv = document.createElement('canvas'); cv.width = cv.height = 8; addWork({ id: 'tapa35', c: [0, 1.5, -3], r: [1, 0, 0], u: [0, 1, 0], w: 3, h: 3 }, cv); });
  await B.evaluate(() => { __game.pos[0] = 0.3; __game.pos[2] = -6; });
  ok('atrás de una pared: hay carita', await espera(A, () => getComputedStyle(document.getElementById('lejos')).display !== 'none', null, 4000));
  await A.waitForTimeout(1200);
  v = await visibles(A);
  ok('va donde está, sin flecha (' + JSON.stringify(v) + ')', v.length === 1 && Math.abs(v[0].x - W / 2) < 60 && await A.evaluate(() => document.querySelector('#lejos .lejos .giro').style.display === 'none'));
  await A.screenshot({ path: out + 'v109_pared.png' });
  await A.evaluate(() => { const i = __game.works.findIndex(w => w.id === 'tapa35'); __game.works.splice(i, 1); });
  ok('sin la pared: no hay carita', await espera(A, () => getComputedStyle(document.getElementById('lejos')).display === 'none', null, 4000));
  // con la cámara equipada, la carita de la derecha no tapa la barra de distancia
  await B.evaluate(() => { __game.pos[0] = 10; __game.pos[2] = 0; });
  await A.tap('#equip'); await A.waitForFunction(() => __game.camReady);
  await A.waitForTimeout(1200);
  v = await visibles(A);
  const dist = await A.evaluate(() => document.getElementById('dist').getBoundingClientRect().left);
  ok('con la barra de distancia, la carita queda a su izquierda (' + JSON.stringify(v) + ' barra ' + dist + ')', v.length === 1 && v[0].x + 22 < dist);
  await A.tap('#unequip');
  // lo que el otro tiene en la mano salta con él
  await A.evaluate(() => __game.look(0, 0));
  await B.tap('#equip'); await B.waitForFunction(() => __game.camReady);
  ok('A ve lo que B tiene en la mano', await espera(A, id => !!__game.sala.gente.get(id).mano, idB, 5000));
  await B.evaluate(() => { __game.pos[0] = -30; __game.pos[2] = 30; });
  await espera(A, id => { const p = __game.sala.gente.get(id); return Math.hypot(p.disp.p[0] + 30, p.disp.p[2] - 30) < 1; }, idB, 5000);
  const mano = await A.evaluate(id => { const p = __game.sala.gente.get(id); return Math.hypot(p.mano.c[0] - p.disp.p[0], p.mano.c[2] - p.disp.p[2]); }, idB);
  ok('saltó con él (a ' + mano.toFixed(2) + ' m de su cabeza)', mano < 3);
  await B.tap('#unequip');

  // tocar la carita y tocar afuera: se cierra sin ir
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 20; });
  await A.evaluate(() => __game.look(0, 0));
  await espera(A, () => getComputedStyle(document.getElementById('lejos')).display !== 'none', null, 4000);
  await A.waitForTimeout(800);
  await A.tap('#lejos .lejos');
  const antes = await A.evaluate(() => __game.pos.slice());
  await A.tap('canvas', { position: { x: 200, y: 450 } });
  await A.waitForTimeout(300);
  const despues = await A.evaluate(() => __game.pos.slice());
  ok('tocar afuera cierra "ir ahí" sin moverme', !(await A.isVisible('#lejosIr')) && Math.hypot(antes[0] - despues[0], antes[2] - despues[2]) < 0.05);

  // con una pared delante suyo: va al costado, del mismo lado de la pared
  const r1 = await A.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 8;
    addWork({ id: 'pared35', c: [40, 1, -0.8], r: [1, 0, 0], u: [0, 1, 0], w: 4, h: 3 }, cv);
    irHacia([40, 1.6, 0], 0);   // mira a -z, hacia la pared
    return __game.pos.slice();
  });
  ok('con una pared adelante, va al costado sin cruzarla (' + r1.map(x => x.toFixed(2)) + ')', r1[2] > -0.8 + 0.2 && Math.abs(Math.hypot(r1[0] - 40, r1[2]) - 1.5) < 0.15);
  // arriba de una plataforma chica: queda arriba, a 0.9 m
  const r2 = await A.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 8;
    addWork({ id: 'plataforma35', c: [60, 1, 0], r: [1, 0, 0], u: [0, 0, -1], w: 2, h: 2 }, cv);
    irHacia([60, 2.6, 0], 0);
    return __game.pos.slice();
  });
  await A.waitForTimeout(500);
  const r2b = await A.evaluate(() => __game.pos.slice());
  ok('sube a la plataforma con él (' + r2b.map(x => x.toFixed(2)) + ')', Math.abs(r2b[1] - 2.6) < 0.02 && Math.abs(r2b[0] - 60) <= 1.05 && Math.abs(r2b[2]) <= 1.05);
  ok('datos rotos: no se mueve', await A.evaluate(() => { const p = __game.pos.slice(); const r = irHacia([NaN, 1, 0], 0) || irHacia([1, 2, 3], 'x'); return !r && __game.pos.every((v, i) => v === p[i]); }));

  // cuando B se va de la sala, su carita desaparece
  await B.evaluate(() => { __game.pos[0] = 70; __game.pos[2] = 30; });
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[1] = 1.6; __game.pos[2] = 0; __game.look(0, 0); });
  await espera(A, () => document.querySelectorAll('#lejos .lejos').length === 1 && getComputedStyle(document.getElementById('lejos')).display !== 'none', null, 4000);
  await B.tap('#salaBtn'); await B.tap('#salaSalir');
  ok('se fue: sin carita', await espera(A, () => document.querySelectorAll('#lejos .lejos').length === 0 && getComputedStyle(document.getElementById('lejos')).display === 'none', null, 8000));
  // A sale de la sala: nada
  await A.tap('#salaBtn'); await A.tap('#salaSalir');
  ok('fuera de la sala no hay caritas', await A.evaluate(() => getComputedStyle(document.getElementById('lejos')).display === 'none'));
  const err = pg => pg.textContent('#hint').then(t => /error/i.test(t));
  ok('sin errores', !(await err(A)) && !(await err(B)) && !A.errs.length && !B.errs.length);
  if (A.errs.length || B.errs.length) console.log('errores', A.errs, B.errs);
  console.log(`\n${fallas ? fallas + ' FALLAS' : 'TODO OK'}`);
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
