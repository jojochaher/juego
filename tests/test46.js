// extruir, parte 3b (v10.22, propuesta 7 de José): otra foto en una cara de la caja, en la sala. Al soltar con ✓ la
// imagen de la cara sube a imgs/<id>~c<clave> y la pose lleva cg (la clave de cada cara; cc va sin 'o' para los de
// antes). Los demás la bajan y la ven puesta y en la mano; "a todas" sube una sola; volver a "la misma" o borrar la
// caja la borra de la base; el que entra después también la ve; cg roto o sin imagen no rompe nada.
// uso: node tests/test46.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const PASS = 'prueba caras en sala', H = crypto.createHash('sha256').update('juego:' + PASS).digest('hex');
const DB = 'http://localhost:8462';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8462);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8461);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const visto = (pg, sel) => pg.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && (!e.parentElement || getComputedStyle(e.parentElement).display !== 'none'); }, sel);
  const px = (pg, x, y) => pg.evaluate(([x, y]) => new Promise(res => requestAnimationFrame(() => {
    const a = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); res([...a].slice(0, 3));
  })), [x, y]);
  const amarillo = c => c[0] > 90 && c[1] > 90 && c[2] < c[0] * 0.5 && c[2] < c[1] * 0.5;
  const dump = async () => ((((await (await fetch(DB + '/__dump')).json()) || {}).salas || {})[H] || {});
  const carasEnBase = async id => Object.keys((await dump()).imgs || {}).filter(k => k.startsWith(id + '~c'));
  const URL = 'http://localhost:8461/?db=' + DB;
  const mk = async () => {
    const c = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await c.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 });
    await pg.tap('#unequip'); await pg.tap('#salaBtn'); await pg.fill('#salaPass', PASS); await pg.tap('#salaEntrar');
    await espera(pg, () => __game.sala.active && __game.sala.estadoVisto, null, 8000);
    return pg;
  };
  const A = await mk(), B = await mk();
  const AMARILLA = Buffer.from((await A.evaluate(() => { const c = document.createElement('canvas'); c.width = 60; c.height = 120; const x = c.getContext('2d'); x.fillStyle = '#e8d020'; x.fillRect(0, 0, 60, 120); return c.toDataURL('image/png'); })).split(',')[1], 'base64');
  const elegir = async (q) => { const [fc] = await Promise.all([q.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null), q.tap('#caraFoto')]); if (!fc) return false; await fc.setFiles({ name: 'cara.png', mimeType: 'image/png', buffer: AMARILLA }); return true; };
  // una caja roja/azul de 1 m en la sala
  const ROJA = await A.evaluate(() => { const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#e02010'; x.fillRect(0, 0, 64, 128); x.fillStyle = '#1040e0'; x.fillRect(64, 0, 64, 128); return c.toDataURL('image/jpeg', 0.9); });
  await fetch(DB + '/salas/' + H + '/imgs/k1.json', { method: 'PUT', body: JSON.stringify(ROJA) });
  await fetch(DB + '/salas/' + H + '/poses/k1.json', { method: 'PUT', body: JSON.stringify({ c: [0, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, uv: [0, 0, 1, 1], d: 1, t0: Date.now() }) });
  ok('A y B tienen la caja', await espera(A, () => __game.works.some(w => w.id === 'k1')) && await espera(B, () => __game.works.some(w => w.id === 'k1')));
  const agarrar = async (pg) => { await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); pick(__game.works.find(w => w.id === 'k1')); }); await pg.waitForTimeout(1200);
    await pg.evaluate(() => { if (!ajustando) setAjustar(true); setMode('extruir'); caraSel = 2; pintarCaras(); }); await pg.waitForTimeout(100); };
  await agarrar(A);
  ok('en la sala, con una cara elegida, está "foto"', await visto(A, '#caraFoto'));
  ok('"foto" abre el selector', await elegir(A));
  ok('la cara queda con otra foto (en la mano)', await espera(A, () => __game.held && __game.held.L.cc && __game.held.L.cc[1] === 'o' && !!ciVer(2), null, 4000));
  await A.waitForTimeout(400);
  const idA = await A.evaluate(() => __game.salaYo);
  ok('B, mientras A la tiene: todavía sin foto en esa cara (no subió)', await B.evaluate(id => { const p = __game.sala.gente.get(id); return !!(p && p.manoT) && !(p.manoT.cc || '').includes('o'); }, idA));
  await A.tap('#drop');
  ok('subió la imagen de la cara', await espera(A, () => { const w = __game.works.find(x => x.id === 'k1'); return w && w.cg && w.ci && w.ci[2] && w.ci[2].subida; }, null, 6000));
  await A.waitForTimeout(500);
  let d = await dump(), pose = d.poses.k1, ks = await carasEnBase('k1');
  const g = (pose.cg || '').split(',')[1];
  ok('la pose lleva cg con la clave en el costado derecho (' + pose.cg + ')', !!g && pose.cg === ',' + g + ',,,');
  ok('y cc sin "o" (lo entienden los de antes: ' + pose.cc + ')', !pose.cc || /^[mebc]{5}$/.test(pose.cc));
  ok('en la base: imgs/k1~c' + g + ' (una sola)', ks.length === 1 && ks[0] === 'k1~c' + g && /^data:image\/jpeg;base64,/.test(d.imgs[ks[0]]));
  ok('A: soltada, la cara tiene su foto', await A.evaluate(() => { const w = __game.works.find(x => x.id === 'k1'); return w.cc[1] === 'o' && w.caras[2].img === w.ci[2]; }));
  ok('B la baja y la cara tiene su foto', await espera(B, () => { const w = __game.works.find(x => x.id === 'k1'); return w && w.cc && w.cc[1] === 'o' && w.ci && w.ci[2] && w.caras[2].img === w.ci[2]; }, null, 6000));
  // B mira el costado derecho de la caja
  const mirarCara = async (pg, i) => {
    await pg.evaluate(i => { const w = __game.works.find(x => x.id === 'k1'), f = w.caras[i], n = norm(cross(f.r, f.u));
      __game.pos[0] = f.c[0] + n[0] * 2; __game.pos[2] = f.c[2] + n[2] * 2; __game.look(Math.atan2(-n[0], n[2]) * 180 / Math.PI, 0); }, i);
    await pg.waitForTimeout(300);
    const q = await pg.evaluate(i => { const f = __game.works.find(x => x.id === 'k1').caras[i], b = basis(), P = __game.pos; const v = [0, 1, 2].map(k => f.c[k] - P[k]); const z = dot(v, b.f); const [tx, ty] = tans(); return [(1 + dot(v, b.r) / z / tx) / 2, (1 + dot(v, b.u) / z / ty) / 2]; }, i);
    return px(pg, q[0], q[1]);
  };
  let c = await mirarCara(B, 2);
  ok('B la ve amarilla (' + c + ')', amarillo(c));
  await B.screenshot({ path: out + 'v10.22_cara_foto_sala_B.png' });
  // A la vuelve a agarrar: B la ve en la mano con la foto en esa cara
  await agarrar(A); await A.waitForTimeout(500);
  ok('B ve la foto de la cara en la mano de A (mo)', await espera(B, id => { const p = __game.sala.gente.get(id); return p && p.manoT && p.manoT.cc && p.manoT.cc[1] === 'o'; }, idA, 4000));
  // a todas: la misma imagen en las 5, sin subir nada nuevo
  await A.evaluate(() => { caraSel = 2; pintarCaras(); }); await A.tap('#caraTodas'); await A.waitForTimeout(100);
  await A.tap('#drop');
  ok('a todas: cg con la misma clave en las 5', await espera(A, g => { const w = __game.works.find(x => x.id === 'k1'); return w.cg === [g, g, g, g, g].join(','); }, g, 4000));
  await A.waitForTimeout(800);
  ks = await carasEnBase('k1'); d = await dump();
  ok('a todas: en la base sigue habiendo una sola imagen de cara', ks.length === 1 && d.poses.k1.cg === [g, g, g, g, g].join(','));
  ok('B: las 5 caras con la misma foto (una textura)', await espera(B, () => { const w = __game.works.find(x => x.id === 'k1'); return w && w.ci && [1, 2, 3, 4, 5].every(i => w.ci[i] === w.ci[2]) && w.caras.slice(1).every(f => f.img); }, null, 5000));
  // el que entra después (B recarga) también las ve
  await B.reload(); await B.waitForTimeout(300); await B.tap('#start');
  ok('al recargar B vuelve a la sala', await espera(B, () => __game.sala.active && __game.sala.estadoVisto, null, 8000));
  ok('y baja las fotos de las caras', await espera(B, () => { const w = __game.works.find(x => x.id === 'k1'); return w && w.ci && w.ci[2] && w.caras[2].img; }, null, 8000));
  // C entra y no llega a bajar las fotos de las caras (fallan): moverla no se las borra a los demás (pasaba con la primera versión)
  const C = await (async () => { const c = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await c.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.route(/~c[a-z0-9]+\.json/, r => r.abort()); return pg; })();
  await C.goto(URL); await C.waitForTimeout(300); await C.tap('#start'); await C.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 });
  await C.tap('#unequip'); await C.tap('#salaBtn'); await C.fill('#salaPass', PASS); await C.tap('#salaEntrar');
  await espera(C, () => __game.sala.active && __game.works.some(w => w.id === 'k1'), null, 8000);
  await C.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); pick(__game.works.find(w => w.id === 'k1')); }); await C.waitForTimeout(1200);
  ok('C la agarró (sin las fotos de las caras)', await C.evaluate(() => __game.held && !__game.held.work.ci));
  await C.evaluate(() => { const L = __game.held.L; L.c[1] += 0.3; }); await C.tap('#drop'); await C.waitForTimeout(1200);
  d = await dump();
  ok('C la movió: el cg sigue en la base', d.poses.k1.cg === [g, g, g, g, g].join(',') && (await carasEnBase('k1')).length === 1);
  ok('B la sigue viendo con las fotos', await B.evaluate(() => { const w = __game.works.find(x => x.id === 'k1'); return w.ci && w.ci[2] && w.caras[2].img; }));
  ok('C: sin errores de JS ' + C.errs, C.errs.length === 0);
  await C.context().close();
  // otra foto en el costado izquierdo: dos imágenes
  await agarrar(A); await A.evaluate(() => { caraSel = 3; pintarCaras(); });
  await elegir(A); await espera(A, () => __game.held && __game.held.ciN && __game.held.ciN[3], null, 4000);
  await A.tap('#drop');
  const g3 = await espera(A, g => { const w = __game.works.find(x => x.id === 'k1'); const a = (w.cg || '').split(','); return a[2] && a[2] !== g && a[1] === g; }, g, 6000);
  ok('otra en el costado izquierdo: otra clave', g3);
  await A.waitForTimeout(500);
  ok('en la base, dos imágenes de cara', (await carasEnBase('k1')).length === 2);
  // todas a "la misma": se borran de la base
  await agarrar(A); await A.evaluate(() => { caraSel = 2; pintarCaras(); });
  await A.tap('#caraOps [data-t="m"]'); await A.tap('#caraTodas'); await A.waitForTimeout(100);
  await A.tap('#drop'); await A.waitForTimeout(1200);
  d = await dump();
  ok('todas la misma: sin cg en la base', !d.poses.k1.cg);
  ok('y sin imágenes de cara', (await carasEnBase('k1')).length === 0);
  ok('B: sin fotos en las caras', await espera(B, () => { const w = __game.works.find(x => x.id === 'k1'); return w && !w.ci && !(w.cc || '').includes('o') && w.caras.slice(1).every(f => !f.img); }, null, 5000));
  // soltar dos veces seguidas mientras sube: sube igual, sin error
  await agarrar(A); await A.evaluate(() => { caraSel = 5; pintarCaras(); });
  await elegir(A); await espera(A, () => __game.held && __game.held.ciN && __game.held.ciN[5], null, 4000);
  await A.tap('#drop'); await A.evaluate(() => { pick(__game.works.find(w => w.id === 'k1')); drop(); });
  ok('dos veces seguidas: abajo sube igual', await espera(A, () => { const w = __game.works.find(x => x.id === 'k1'); return (w.cg || '').split(',')[4] && w.ci[5].subida; }, null, 6000));
  await A.waitForTimeout(800);
  ok('sin aviso de error', !(await A.textContent('#hint')).includes('no se pudo'));
  ok('en la base, una sola imagen de cara', (await carasEnBase('k1')).length === 1 && (await dump()).poses.k1.cg.split(',')[4]);
  await agarrar(A); await A.evaluate(() => { caraSel = 5; pintarCaras(); }); await A.tap('#caraOps [data-t="m"]'); await A.tap('#drop'); await A.waitForTimeout(1000);
  ok('y al sacarla se borra', (await carasEnBase('k1')).length === 0);
  // cg roto o con una clave que no está: no rompe nada
  const p0 = (await dump()).poses.k1;
  await fetch(DB + '/salas/' + H + '/poses/k1.json', { method: 'PUT', body: JSON.stringify({ ...p0, cg: 'xx<b>,,,' }) });
  await B.waitForTimeout(600);
  ok('cg roto: se ignora', await B.evaluate(() => { const w = __game.works.find(x => x.id === 'k1'); return !w.cg && !w.ci; }));
  await fetch(DB + '/salas/' + H + '/poses/k1.json', { method: 'PUT', body: JSON.stringify({ ...p0, cg: ',noesta1,,,' }) });
  ok('cg con una imagen que no está: la cara se ve como la misma', await espera(B, () => { const w = __game.works.find(x => x.id === 'k1'); return w.cg === ',noesta1,,,' && w.cc && w.cc[1] === 'o' && !w.caras[2].img && w.caras[2].t === 'm'; }, null, 3000));
  await fetch(DB + '/salas/' + H + '/poses/k1.json', { method: 'PUT', body: JSON.stringify(p0) });
  await B.waitForTimeout(500);
  // un cliente v10.21 que manda cc con 'o' y sin cg: se ve como la misma
  await fetch(DB + '/salas/' + H + '/poses/k1.json', { method: 'PUT', body: JSON.stringify({ ...p0, cc: 'oommm' }) });
  ok('cc con "o" sin cg (de un v10.21): se ve como la misma', await espera(B, () => { const w = __game.works.find(x => x.id === 'k1'); return w && !w.cc && w.caras[1].t === 'm' && !w.caras[1].img; }, null, 4000));
  await fetch(DB + '/salas/' + H + '/poses/k1.json', { method: 'PUT', body: JSON.stringify(p0) });
  await A.waitForTimeout(500);
  // una foto en una cara y borrar la caja enseguida (mientras sube): no queda nada suelto en la base
  await agarrar(A); await elegir(A); await espera(A, () => __game.held && __game.held.ciN && __game.held.ciN[2], null, 4000);
  await A.tap('#drop');
  await A.evaluate(() => { pick(__game.works.find(w => w.id === 'k1')); trash(); });
  let limpio = false;
  for (let k = 0; k < 20 && !limpio; k++) { await A.waitForTimeout(400); d = await dump(); limpio = !(d.poses || {}).k1 && (await carasEnBase('k1')).length === 0; }
  if (!limpio) console.log('quedó: pose ' + JSON.stringify((d.poses || {}).k1) + ' caras ' + (await carasEnBase('k1')));
  ok('borrada mientras subía: sin pose ni imágenes de cara', limpio);
  ok('B ya no la tiene', await espera(B, () => !__game.works.some(w => w.id === 'k1'), null, 4000));
  // una caja con foto en una cara, borrada después: se borra su imagen
  await fetch(DB + '/salas/' + H + '/imgs/k2.json', { method: 'PUT', body: JSON.stringify(ROJA) });
  await fetch(DB + '/salas/' + H + '/poses/k2.json', { method: 'PUT', body: JSON.stringify({ c: [0, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, uv: [0, 0, 1, 1], d: 1 }) });
  await espera(A, () => __game.works.some(w => w.id === 'k2'));
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); pick(__game.works.find(w => w.id === 'k2')); }); await A.waitForTimeout(1200);
  await A.evaluate(() => { if (!ajustando) setAjustar(true); setMode('extruir'); caraSel = 4; pintarCaras(); });
  await elegir(A); await espera(A, () => __game.held && __game.held.ciN && __game.held.ciN[4], null, 4000);
  await A.tap('#drop');
  await espera(A, () => { const w = __game.works.find(x => x.id === 'k2'); return w && w.cg; }, null, 6000);
  ok('k2: arriba con foto, en la base', (await carasEnBase('k2')).length === 1);
  await A.evaluate(() => { pick(__game.works.find(w => w.id === 'k2')); }); await A.waitForTimeout(1200);
  await A.evaluate(() => trash()); await A.waitForTimeout(1500);
  ok('k2 borrada: se borra la imagen de la cara', (await carasEnBase('k2')).length === 0);
  for (const [n, pg] of [['A', A], ['B', B]]) {
    ok(n + ': sin errores de dibujo', !(await pg.textContent('#hint')).includes('error'));
    ok(n + ': sin errores de JS ' + pg.errs, pg.errs.length === 0);
  }
  console.log(fallas ? 'FALLAS: ' + fallas : 'todo OK');
  await b.close(); web.close(); dbSrv.close && dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
