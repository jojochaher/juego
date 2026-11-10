// texturas al poner un bloque y cambiar una textura (v10.30, propuestas 21 y 22 de José).
// 21: con el bloque equipado, tocar la vista previa abre "tus texturas"; el bloque queda cargado con la elegida (se ve en
// la vista previa y se recuerda) y cada bloque que ponés sale lleno con ella; "vacío" vuelve a los vacíos.
// 22: en la hoja, "cambiar imagen" → tocar una → cámara o galería / la que tenés en la mano. Cambian los bloques que la
// usan: en el museo (tx en el registro), en la sala donde estás (sube con otra clave, se reescribe tx, la vieja se borra)
// y en otra sala al entrar.
// uso: node tests/test53.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const PASS = 'prueba cambiar textura', H = crypto.createHash('sha256').update('juego:' + PASS).digest('hex');
const PASS2 = 'otra sala de texturas', H2 = crypto.createHash('sha256').update('juego:' + PASS2).digest('hex');
const DB = 'http://localhost:8532';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8532);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8531);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const visto = (pg, sel) => pg.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && (!e.parentElement || getComputedStyle(e.parentElement).display !== 'none'); }, sel);
  const px = (pg, x, y) => pg.evaluate(([x, y]) => new Promise(res => requestAnimationFrame(() => {
    const a = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); res([...a].slice(0, 3));
  })), [x, y]);
  const proj = (pg, p) => pg.evaluate(p => { const b = basis(), P = __game.pos; const v = [0, 1, 2].map(i => p[i] - P[i]); const z = dot(v, b.f); const [tx, ty] = tans(); return [(1 + dot(v, b.r) / z / tx) / 2, (1 + dot(v, b.u) / z / ty) / 2]; }, p);
  const pxEn = async (pg, p) => { const [x, y] = await proj(pg, p); return px(pg, x, y); };
  const rojo = c => c[0] > 90 && c[0] > c[1] * 2 && c[0] > c[2] * 2, azul = c => c[2] > 90 && c[2] > c[0] * 2 && c[2] > c[1] * 1.5;
  const verde = c => c[1] > 90 && c[1] > c[0] * 2 && c[1] > c[2] * 2;
  const lleno = col => `(() => { const c = document.createElement('canvas'); c.width = 96; c.height = 96; const x = c.getContext('2d'); x.fillStyle = '${col}'; x.fillRect(0, 0, 96, 96); return c; })`;
  // archivos para el selector (cámara / galería)
  const archivo = async (pg, col, nombre) => {
    const data = await pg.evaluate(src => eval(src)().toDataURL('image/png'), lleno(col));
    const f = path.join(out, nombre); fs.writeFileSync(f, Buffer.from(data.split(',')[1], 'base64')); return f;
  };
  const centroPantalla = pg => { const v = pg.viewportSize(); return [v.width / 2, v.height / 2]; };

  // ---------- museo ----------
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] });
  const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto('http://localhost:8531/?borrar'); await pg.goto('http://localhost:8531/'); await pg.waitForTimeout(300);
  await pg.tap('#start'); await espera(pg, () => __game.camReady && tx.cargada);
  while (await pg.evaluate(() => __game.grilla)) await pg.tap('#grilla');
  await pg.tap('#unequip'); await pg.waitForTimeout(200);
  const AZUL = await archivo(pg, '#1040e0', 'v1030_azul.png'), VERDE = await archivo(pg, '#20c040', 'v1030_verde.png');
  // una textura roja en la biblioteca
  await pg.evaluate(async src => {
    addWork({ id: 'r1', c: [5, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1 }, eval(src)());
    __game.pos[0] = 5; __game.pos[2] = 0; __game.look(0, 0);
    pick(__game.works.find(w => w.id === 'r1'));
    await new Promise(r => setTimeout(r, 1200));
    await txGuardar(); cancelHold();
    __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0);
  }, lleno('#e02010'));
  ok('hay una textura', await pg.evaluate(() => tx.lista.length === 1));
  const g1 = await pg.evaluate(() => tx.lista[0].g);
  // 21: el bloque equipado, tocar su vista previa abre la hoja
  await pg.tap('#bloque'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { const L = __game.previewBloque; L.w = L.h = 0.6; setDist(L, 1.5); });
  await pg.waitForTimeout(150);
  await pg.touchscreen.tap(...centroPantalla(pg)); await pg.waitForTimeout(300);
  ok('tocar la vista previa del bloque abre "tus texturas" (sin agarrar nada)', await visto(pg, '#texHoja') && await pg.evaluate(() => !__game.held && tx.para && tx.para.bloque));
  ok('sin textura cargada no está "vacío"', !(await visto(pg, '#texVacio')));
  await pg.tap('#texLista img');
  ok('elegida: el bloque queda cargado con ella', await espera(pg, g => bloqueTx && bloqueTx.e && bloqueTx.e.g === g, g1, 4000) && !(await visto(pg, '#texHoja')));
  ok('se recuerda (localStorage)', await pg.evaluate(g => localStorage.getItem('bloqueTx') === g, g1));
  ok('la vista previa se ve roja (' + await pxEn(pg, await pg.evaluate(() => previewPose(basis()).c)) + ')', rojo(await pxEn(pg, await pg.evaluate(() => previewPose(basis()).c))));
  // una foto más cerca que la vista previa la tapa: tocar ahí la agarra (no abre la hoja)
  await pg.evaluate(src => { addWork({ id: 'cerca', c: [0, 1.6, -0.8], r: [1, 0, 0], u: [0, 1, 0], w: 0.4, h: 0.4 }, eval(src)()); }, lleno('#888888'));
  await pg.waitForTimeout(150);
  await pg.touchscreen.tap(...centroPantalla(pg)); await pg.waitForTimeout(400);
  ok('con una foto más cerca, tocar la agarra y no abre la hoja', await pg.evaluate(() => __game.held && __game.held.work.id === 'cerca') && !(await visto(pg, '#texHoja')));
  await pg.evaluate(() => { cancelHold(); const w = __game.works.find(w => w.id === 'cerca'); __game.works.splice(__game.works.indexOf(w), 1); __game.look(0, 0); });
  await pg.waitForTimeout(1300);
  await pg.tap('#shoot'); await pg.waitForTimeout(500);
  const b1 = await pg.evaluate(() => { const w = __game.works[__game.works.length - 1]; return { id: w.id, vacio: w.vacio, tx: w.tx, c: w.c }; });
  ok('el bloque sale lleno, con su textura ' + JSON.stringify(b1), !b1.vacio && b1.tx === g1);
  ok('se ve rojo', rojo(await pxEn(pg, b1.c)));
  ok('guardado en el museo con imagen y tx', await espera(pg, ([id, g]) => { if (!window.__g) { window.__g = 1; store('readonly', s => s.get(id)).then(r => { window.__r = r; window.__g = 0; }); } return window.__r && window.__r.blob && window.__r.blob.size > 0 && window.__r.tx === g && !window.__r.vacio; }, [b1.id, g1], 5000));
  // al recargar: el bloque y el bloque cargado
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await espera(pg, () => tx.cargada && __game.works.length >= 2, null, 8000);
  ok('al recargar el bloque equipado sigue cargado', await espera(pg, g => bloqueTx && bloqueTx.e && bloqueTx.e.g === g, g1, 4000));
  ok('y el bloque puesto tiene su tx', await pg.evaluate(([id, g]) => { const w = __game.works.find(w => w.id === id); return w && w.tx === g; }, [b1.id, g1]));
  // 22: cambiar la imagen de la textura (cámara o galería)
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  await pg.waitForTimeout(200);
  await pg.touchscreen.tap(...centroPantalla(pg)); await pg.waitForTimeout(300);
  ok('con textura cargada está "vacío" y "cambiar imagen"', await visto(pg, '#texVacio') && await visto(pg, '#texCambiar'));
  await pg.tap('#texCambiar');
  ok('cambiar: avisa que cambian todos', (await pg.textContent('#texNota')).includes('cambian todos'));
  await pg.tap('#texLista img');
  ok('elegida: "cámara o galería" y no "la que tenés en la mano" (no tenés nada)', await visto(pg, '#texCambioArchivo') && !(await visto(pg, '#texCambioMano')));
  const [fc] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null), pg.tap('#texCambioArchivo')]);
  ok('"cámara o galería" abre el selector', !!fc);
  if (fc) await fc.setFiles(AZUL);
  ok('la textura tiene otra clave y anota la de antes', await espera(pg, g => tx.lista.length === 1 && tx.lista[0].g !== g && tx.lista[0].antes.includes(g), g1, 5000));
  const g2 = await pg.evaluate(() => tx.lista[0].g);
  ok('el bloque puesto cambió (tx nuevo)', await espera(pg, ([id, g]) => __game.works.find(w => w.id === id).tx === g, [b1.id, g2], 5000));
  await pg.waitForTimeout(300);
  ok('y se ve azul', azul(await pxEn(pg, b1.c)));
  ok('el bloque equipado también', await espera(pg, g => bloqueTx && bloqueTx.e && bloqueTx.e.g === g, g2, 4000));
  ok('en la biblioteca: solo la nueva', await pg.evaluate(async ([g1, g2]) => { const k = await store('readonly', s => s.getAllKeys()); return k.includes('tex~' + g2) && !k.includes('tex~' + g1); }, [g1, g2]));
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await espera(pg, () => tx.cargada && __game.works.length >= 2, null, 8000);
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); }); await pg.waitForTimeout(400);
  ok('al recargar sigue azul (se guardó la imagen)', azul(await pxEn(pg, b1.c)) && await pg.evaluate(([id, g]) => __game.works.find(w => w.id === id).tx === g, [b1.id, g2]));
  ok('la biblioteca recuerda la de antes', await pg.evaluate(g => tx.lista[0].antes.includes(g), g1));
  // cambiarla con la que tenés en la mano (una foto verde)
  await pg.evaluate(src => { addWork({ id: 'v1', c: [-5, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1 }, eval(src)()); __game.pos[0] = -5; __game.pos[2] = 0; __game.look(0, 0); pick(__game.works.find(w => w.id === 'v1')); }, lleno('#20c040'));
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => txAbrir({ held: __game.held }));
  await pg.tap('#texCambiar'); await pg.tap('#texLista img');
  ok('con algo en la mano: "la que tenés en la mano"', await visto(pg, '#texCambioMano'));
  await pg.tap('#texCambioMano');
  ok('cambiada por la verde', await espera(pg, ([id, g]) => { const w = __game.works.find(w => w.id === id); return tx.lista[0].g !== g && w.tx === tx.lista[0].g; }, [b1.id, g2], 5000));
  await pg.evaluate(() => { cancelHold(); __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); }); await pg.waitForTimeout(400);
  ok('el bloque se ve verde', verde(await pxEn(pg, b1.c)));
  // "vacío": vuelve a los bloques vacíos
  await pg.touchscreen.tap(30, 300); await pg.waitForTimeout(100);
  await pg.evaluate(() => txAbrir({ bloque: true })); await pg.tap('#texVacio');
  ok('"vacío": el bloque equipado ya no tiene textura', await pg.evaluate(() => !bloqueTx && !localStorage.getItem('bloqueTx')));
  await pg.evaluate(() => { __game.look(40, 0); }); await pg.waitForTimeout(150);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  ok('y pone bloques vacíos', await pg.evaluate(() => __game.works[__game.works.length - 1].vacio));
  // la cámara o galería desde la hoja del bloque: el bloque sale con esa foto (sin textura de la biblioteca)
  await pg.evaluate(() => txAbrir({ bloque: true }));
  const [fc2] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null), pg.tap('#texArchivo')]);
  if (fc2) await fc2.setFiles(AZUL);
  ok('cámara o galería: el bloque queda cargado con esa foto (sin textura de la biblioteca)', await espera(pg, () => bloqueTx && !bloqueTx.e, null, 4000));
  await pg.evaluate(() => { __game.look(-40, 0); }); await pg.waitForTimeout(150);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  ok('y el bloque sale con esa foto (con una clave propia, que no es de la biblioteca)', await pg.evaluate(() => { const w = __game.works[__game.works.length - 1]; return !w.vacio && w.tx === bloqueTx.g && !tx.lista.some(e => e.g === w.tx); }));
  await pg.evaluate(() => bloqueTxPoner(null, true));
  ok('museo: sin errores', !pg.errs.length && !/error/i.test(await pg.textContent('#hint')));
  if (pg.errs.length) console.log(pg.errs);
  await pg.screenshot({ path: out + 'v1030_museo.png' });

  // ---------- sala ----------
  const URL = 'http://localhost:8531/?db=' + DB;
  const mk = async (pass) => {
    const c = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const q = await c.newPage(); q.errs = []; q.on('pageerror', e => q.errs.push(e.message));
    await q.goto(URL); await q.waitForTimeout(300); await q.tap('#start'); await q.waitForFunction(() => window.__game.camReady && tx.cargada, null, { timeout: 8000 });
    while (await q.evaluate(() => __game.grilla)) await q.tap('#grilla');
    await q.tap('#unequip');
    await entrar(q, pass);
    return q;
  };
  const entrar = async (q, pass) => { await q.tap('#salaBtn'); await q.fill('#salaPass', pass); await q.tap('#salaEntrar'); await espera(q, () => __game.sala.active && __game.sala.estadoVisto, null, 8000); };
  const dump = async (h = H) => ((((await (await fetch(DB + '/__dump')).json()) || {}).salas || {})[h] || {});
  const A = await mk(PASS), B = await mk(PASS);
  // A: una textura azul y el bloque cargado con ella
  await A.evaluate(async src => {
    const img = eval(src)(), w = addWork({ id: 'tmp', c: [9, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1 }, img);
    __game.pos[0] = 9; __game.pos[2] = 0; __game.look(0, 0); pick(w);
    await new Promise(r => setTimeout(r, 1200));
    await txGuardar(); cancelHold();
    __game.works.splice(__game.works.indexOf(w), 1);
    __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0);
    setBloque(true); bloqueTxPoner(tx.lista[0], true);
  }, lleno('#1040e0'));
  await espera(A, () => !!bloqueTx, null, 4000);
  const t1 = await A.evaluate(() => tx.lista[0].g);
  await A.evaluate(() => { const L = __game.previewBloque; L.w = L.h = 0.6; setDist(L, 1.5); }); await A.waitForTimeout(150);
  await A.tap('#shoot');
  const sid = await A.evaluate(() => __game.works[__game.works.length - 1].id);
  ok('sala: la pose nombra la textura y no hay imgs/<id>', await espera(A, () => true) && await (async () => { for (let i = 0; i < 40; i++) { const d = await dump(); if (d.poses && d.poses[sid] && d.poses[sid].tx === t1 && d.imgs && d.imgs['tx-' + t1] && !d.imgs[sid]) return true; await new Promise(r => setTimeout(r, 200)); } return false; })());
  ok('B lo recibe con la textura', await espera(B, ([id, g]) => { const w = __game.works.find(w => w.id === id); return w && w.tx === g && !w.vacio; }, [sid, t1], 8000));
  const cB = await A.evaluate(id => __game.works.find(w => w.id === id).c, sid);
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); }); await B.waitForTimeout(400);
  ok('B lo ve azul', azul(await pxEn(B, cB)));
  // A cambia la textura (verde) estando en la sala
  await A.evaluate(async src => { await txReemplazar(tx.lista[0], eval(src)()); }, lleno('#20c040'));
  const t2 = await A.evaluate(() => tx.lista[0].g);
  ok('sala: la pose tiene el tx nuevo y la textura nueva está en la base', await (async () => { for (let i = 0; i < 40; i++) { const d = await dump(); if (d.poses[sid].tx === t2 && d.imgs['tx-' + t2]) return true; await new Promise(r => setTimeout(r, 200)); } return false; })());
  ok('B lo ve verde', await espera(B, ([id, g]) => { const w = __game.works.find(w => w.id === id); return w && w.tx === g; }, [sid, t2], 8000) && (await B.waitForTimeout(400), verde(await pxEn(B, cB))));
  ok('la textura vieja se borró de la base (nadie la usa)', await (async () => { for (let i = 0; i < 30; i++) { const d = await dump(); if (!d.imgs['tx-' + t1]) return true; await new Promise(r => setTimeout(r, 300)); } return false; })());
  // otra sala: A pone un bloque ahí, sale, cambia la textura en el museo y al volver se actualiza (y B, que está ahí, lo ve)
  await A.tap('#salaBtn'); await A.tap('#salaSalir'); await A.waitForTimeout(500);
  await entrar(A, PASS2);
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); }); await A.waitForTimeout(150);
  await A.tap('#shoot');
  const sid2 = await A.evaluate(() => __game.works[__game.works.length - 1].id);
  ok('otra sala: el bloque con la textura verde', await (async () => { for (let i = 0; i < 40; i++) { const d = await dump(H2); if (d.poses && d.poses[sid2] && d.poses[sid2].tx === t2) return true; await new Promise(r => setTimeout(r, 200)); } return false; })());
  await B.tap('#salaBtn'); await B.tap('#salaSalir'); await B.waitForTimeout(500);
  await entrar(B, PASS2);
  ok('B entra a la otra sala y lo tiene', await espera(B, id => __game.works.some(w => w.id === id), sid2, 8000));
  await A.tap('#salaBtn'); await A.tap('#salaSalir'); await A.waitForTimeout(800);
  await A.evaluate(async src => { await txReemplazar(tx.lista[0], eval(src)()); }, lleno('#e02010'));
  const t3 = await A.evaluate(() => tx.lista[0].g);
  ok('afuera de la sala no la toca', (await dump(H2)).poses[sid2].tx === t2);
  await entrar(A, PASS2);
  ok('al volver a entrar se actualiza (pose con el tx nuevo)', await (async () => { for (let i = 0; i < 50; i++) { const d = await dump(H2); if (d.poses[sid2].tx === t3 && d.imgs['tx-' + t3]) return true; await new Promise(r => setTimeout(r, 200)); } return false; })());
  ok('y B lo ve rojo', await espera(B, ([id, g]) => { const w = __game.works.find(w => w.id === id); return w && w.tx === g; }, [sid2, t3], 8000) && (await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); }), await B.waitForTimeout(500), rojo(await pxEn(B, await B.evaluate(id => __game.works.find(w => w.id === id).c, sid2)))));
  ok('sala: sin errores', !A.errs.length && !B.errs.length);
  if (A.errs.length || B.errs.length) console.log(A.errs, B.errs);
  console.log(fallas ? 'FALLAS: ' + fallas : 'TODO OK');
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
