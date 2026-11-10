// biblioteca de piezas (v10.25, propuesta 9 de José, parte 2): con una pieza en la mano, "guardar pieza" la guarda en el
// celu con sus imágenes (y las caras con su foto) y una miniatura; ☰ → "tus piezas" la pone delante tuyo las veces que
// quieras, con todo nuevo (otra gr). Museo: queda en la mano, se guarda, recargar, grilla, quitar, datos rotos.
// Sala: se sube (las imágenes repetidas una vez, como textura compartida), el otro la ve como pieza, con las caras.
// uso: node tests/test49.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const PASS = 'prueba biblioteca de piezas', H = crypto.createHash('sha256').update('juego:' + PASS).digest('hex');
const DB = 'http://localhost:8492';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8492);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8491);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const visto = (pg, sel) => pg.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; }, sel);
  const proj = (pg, p) => pg.evaluate(p => { const b = basis(), P = __game.pos; const v = [0, 1, 2].map(i => p[i] - P[i]); const d = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2]; const z = d(v, b.f); const [tx, ty] = tans(); return [(1 + d(v, b.r) / z / tx) / 2, (1 + d(v, b.u) / z / ty) / 2]; }, p);
  const px = (pg, x, y) => pg.evaluate(([x, y]) => new Promise(res => requestAnimationFrame(() => {
    const a = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); res([...a].slice(0, 3));
  })), [x, y]);
  const pxEn = async (pg, p) => { const [x, y] = await proj(pg, p); return px(pg, x, y); };
  const rojo = c => c[0] > 90 && c[0] > c[1] * 2 && c[0] > c[2] * 2, verde = c => c[1] > 90 && c[1] > c[0] * 2 && c[1] > c[2] * 2;
  const COLOR = col => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 64, 64); return c; };
  // distancias y ángulos de cada una respecto de la primera (lo que no cambia si se mueven juntas)
  const relDe = (a, c) => { const s = (p, q) => p.map((v, i) => v - q[i]), d = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]; const v = s(c.c, a.c); return [d(v, a.r), d(v, a.u), d(c.r, a.r), d(c.r, a.u), d(c.u, a.u), d(c.u, a.r), c.w, c.h]; };
  const igualRel = (x, y) => x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) < 0.01);
  // la forma de un grupo de obras (ordenadas como vengan: la primera es la referencia)
  const forma = (lista) => lista.slice(1).map(o => relDe(lista[0], o)).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const igualForma = (x, y) => x.length === y.length && x.every((r, i) => igualRel(r, y[i]));

  // ---------- museo ----------
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] });
  let pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto('http://localhost:8491/?borrar'); await pg.goto('http://localhost:8491/'); await pg.waitForTimeout(300);
  await pg.tap('#start'); await espera(pg, () => __game.camReady);
  while (await pg.evaluate(() => __game.grilla)) await pg.tap('#grilla');
  await pg.tap('#unequip'); await pg.waitForTimeout(300);
  const poner = (q, lista) => q.evaluate(async ([src, lista]) => {
    const COLOR = eval(src);
    for (const [o, col] of lista) {
      const img = col ? COLOR(col) : VACIO_IMG;
      addWork(o, img);
      if (!__game.sala.active) await new Promise(res => col ? img.toBlob(blob => store('readwrite', s => s.put({ ...o, blob })).then(res), 'image/jpeg', 0.9) : store('readwrite', s => s.put({ ...o, blob: null })).then(res));
    }
  }, ['(' + COLOR.toString() + ')', lista]);
  // una foto roja, una caja azul con el costado derecho verde (su propia foto), un bloque vacío y una roja repetida
  await poner(pg, [
    [{ id: 'a', c: [0, 1.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.8, h: 0.8, gr: 'pz1', t0: 1 }, '#e02010'],
    [{ id: 'k', c: [1, 1.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.6, h: 0.6, d: 0.4, cc: 'mmmmm', gr: 'pz1', t0: 1 }, '#1040e0'],
    [{ id: 'v', c: [-1, 1.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.5, h: 0.5, vacio: true, gr: 'pz1', t0: 1 }, null],
    [{ id: 'r', c: [0, 0.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 0.5, rep: [0.5, 0.5], gr: 'pz1', t0: 1 }, '#e02010'],
    [{ id: 'sola', c: [3, 1.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.5, h: 0.5, t0: 1 }, '#e02010'],
  ]);
  await pg.evaluate(src => { const w = __game.works.find(w => w.id === 'k'); w.ci = []; w.ci[2] = { tex: texture(eval(src)('#20d040')), a: 1, g: 'verde001' }; w.cc = 'mommm'; setBuf(w); }, '(' + COLOR.toString() + ')');
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  await pg.waitForTimeout(300);
  ok('"tus piezas" está en ☰', await pg.evaluate(() => !!document.querySelector('#opciones #opcPiezas')));
  await pg.evaluate(() => pick(__game.works.find(w => w.id === 'sola'))); await pg.waitForTimeout(1200);
  ok('con una sola foto no está "guardar pieza"', !(await visto(pg, '#aPieza')));
  await pg.tap('#agrupar');
  ok('agrupando tampoco', !(await visto(pg, '#aPieza')));
  await pg.evaluate(() => cancelHold());
  await pg.evaluate(() => pick(__game.works.find(w => w.id === 'a'))); await pg.waitForTimeout(1200);
  ok('agarrar una trae la pieza (4)', await pg.evaluate(() => __game.held.pz && __game.held.pz.ids.size === 3));
  ok('con la pieza en la mano está "guardar pieza"', await visto(pg, '#aPieza'));
  const formaOrig = await pg.evaluate(() => { const b = basis(), m = heldPose(b); return [m, ...pzLista().map(e => ({ ...pzMover(e.w, pzT(e.ref, m)), w: e.w.w, h: e.w.h }))]; });
  await pg.tap('#aPieza');
  ok('guardar pieza: avisa', await espera(pg, () => document.getElementById('hint').textContent.includes('guardada en tus piezas'), null, 5000));
  const reg = await pg.evaluate(() => new Promise(res => store('readonly', s => s.getAllKeys()).then(async ks => {
    const k = ks.find(k => String(k).startsWith('pz~'));
    const o = k && await store('readonly', s => s.get(k));
    if (!o) return res(null);
    // la miniatura: ¿tiene rojo y no es toda del mismo color?
    const u = URL.createObjectURL(o.mini), im = new Image(); im.src = u; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; let rojos = 0, otros = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] > 120 && d[i] > d[i + 1] * 2 && d[i] > d[i + 2] * 2) rojos++; else otros++; }
    res({ k, n: o.obras.length, imgs: o.imgs.length, todas: o.imgs.every(x => x instanceof Blob && x.size > 0), mini: [c.width, c.height], rojos, otros,
          vacio: o.obras.filter(m => m.vacio).length, rep: o.obras.filter(m => m.rep).length, caja: o.obras.find(m => m.d), ks });
  })));
  ok('en el celu: un registro pz~ con las 4 (' + (reg && reg.n) + ')', !!reg && reg.n === 4);
  ok('las imágenes: roja (una vez para las dos rojas), azul y la verde de la cara (' + (reg && reg.imgs) + ')', !!reg && reg.imgs === 3 && reg.todas);
  ok('el bloque vacío va vacío y la repetida, repetida', !!reg && reg.vacio === 1 && reg.rep === 1);
  ok('la caja con su profundidad y su cara con foto', !!reg && reg.caja && reg.caja.d === 0.4 && reg.caja.cc === 'mommm' && reg.caja.ci && reg.caja.ci[1] >= 0);
  ok('la miniatura: chica y con lo que se veía (' + (reg && reg.mini) + ', rojos ' + (reg && reg.rojos) + ')', !!reg && Math.max(...reg.mini) <= 168 && reg.rojos > 20 && reg.otros > 20);
  ok('lo que tenías en la mano sigue igual', await pg.evaluate(() => __game.held && __game.held.work.id === 'a' && __game.held.pz.ids.size === 3));
  await pg.evaluate(() => cancelHold());
  // la hoja
  await pg.tap('#menuBtn'); await pg.tap('#opcPiezas'); await pg.waitForTimeout(200);
  ok('☰ → tus piezas abre la hoja con 1 (y dice cuántas tiene)', await visto(pg, '#pzHoja') && await pg.evaluate(() => document.querySelectorAll('#pzLista .pz').length === 1 && document.querySelector('#pzLista .pz span').textContent === '4'));
  await pg.screenshot({ path: out + 'v10.25_hoja.png' });
  const n0 = await pg.evaluate(() => __game.works.length);
  await pg.evaluate(() => { __game.pos[0] = 5; __game.pos[2] = 5; __game.look(90, 0); });
  await pg.tap('#pzLista .pz');
  ok('tocarla la pone: 4 más', await espera(pg, n => __game.works.length === n + 4, n0, 6000));
  ok('se cierra la hoja', !(await visto(pg, '#pzHoja')));
  ok('y queda en la mano como pieza', await espera(pg, () => __game.held && __game.held.pz && __game.held.pz.ids.size === 3, null, 3000) && (await pg.textContent('#hint')).includes('pusiste la pieza'));
  await pg.waitForTimeout(1200);
  const nuevas = await pg.evaluate(() => { const h = __game.held, b = basis(), m = heldPose(b); return { gr: h.work.gr, ids: [h.work.id, ...h.pz.ids], f: [m, ...pzLista().map(e => ({ ...pzMover(e.w, pzT(e.ref, m)), w: e.w.w, h: e.w.h }))], todas: __game.works.filter(w => w.gr === h.work.gr).length, x: m.c[0] }; });
  ok('con una gr nueva (' + nuevas.gr + ')', !!nuevas.gr && nuevas.gr !== 'pz1' && nuevas.todas === 4 && !nuevas.ids.some(id => ['a', 'k', 'v', 'r'].includes(id)));
  ok('con la misma forma que la que guardé', igualForma(forma(formaOrig), forma(nuevas.f)));
  ok('delante tuyo (mirando a la derecha: x > 5)', nuevas.x > 5.8);
  const nk = await pg.evaluate(ids => { const ws = ids.map(id => __game.works.find(w => w.id === id)); const k = ws.find(w => w.d); const v = ws.find(w => w.vacio); const rr = ws.find(w => w.rep); return { k: !!k && k.d === 0.4 && k.cc === 'mommm' && !!(k.ci && k.ci[2] && k.ci[2].tex), v: !!v, r: !!rr && rr.rep[0] === 0.5, piso: Math.min(...ws.map(w => w.c[1] - Math.abs(w.u[1]) * w.h / 2)) }; }, nuevas.ids);
  ok('la caja con su cara verde, el vacío y la repetida', nk.k && nk.v && nk.r);
  ok('apoyada en el piso (' + nk.piso.toFixed(2) + ')', Math.abs(nk.piso) < 0.02);
  await pg.evaluate(() => { const h = __game.held; __game.look(90, 0); });
  await pg.waitForTimeout(300);
  const cRojo = await pg.evaluate(() => heldPose(basis()).c);
  const cr = await pxEn(pg, cRojo);
  ok('se ve la roja en la mano (' + cr + ')', rojo(cr));
  await pg.screenshot({ path: out + 'v10.25_puesta.png' });
  await pg.tap('#drop'); await pg.waitForTimeout(600);
  // la cara verde se ve: mirar el costado derecho de la caja nueva
  const ladoK = await pg.evaluate(ids => { const k = __game.works.find(w => ids.includes(w.id) && w.d); const n = [k.u[1] * k.r[2] - k.u[2] * k.r[1], 0, 0]; return { c: k.c, r: k.r, u: k.u, w: k.w, d: k.d }; }, nuevas.ids);
  const nrm = (v) => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const fwd = nrm([ladoK.r[1] * ladoK.u[2] - ladoK.r[2] * ladoK.u[1], ladoK.r[2] * ladoK.u[0] - ladoK.r[0] * ladoK.u[2], ladoK.r[0] * ladoK.u[1] - ladoK.r[1] * ladoK.u[0]]);   // cross(r, u): hacia el que la mira
  const centroLado = [0, 1, 2].map(i => ladoK.c[i] + ladoK.r[i] * ladoK.w / 2 - fwd[i] * ladoK.d / 2);
  await pg.evaluate(([c, r]) => { const p = __game.pos; p[0] = c[0] + r[0] * 1.5; p[1] = 1.6; p[2] = c[2] + r[2] * 1.5; __game.look(Math.atan2(-r[0], r[2]) * 180 / Math.PI, 0); }, [centroLado, ladoK.r]);
  await pg.waitForTimeout(400);
  const cv = await pxEn(pg, centroLado);
  ok('el costado de la caja nueva es verde (' + cv + ')', !!cv && verde(cv));
  // recargar: siguen ahí, como pieza, con su cara; la biblioteca también
  await pg.reload(); await pg.waitForTimeout(400); await pg.tap('#start');
  ok('al recargar: las 9 (las nuevas no se cargan de más)', await espera(pg, () => __game.works.length === 9, null, 8000));
  if (await pg.evaluate(() => __game.camOn)) { await pg.tap('#unequip'); await pg.waitForTimeout(200); }
  ok('las nuevas siguen siendo una pieza y la caja tiene su foto en la cara', await espera(pg, g => { const ws = __game.works.filter(w => w.gr === g); const k = ws.find(w => w.d); return ws.length === 4 && !!k && !!(k.ci && k.ci[2]) && ws.some(w => w.vacio); }, nuevas.gr, 6000));
  ok('la biblioteca también (1)', await espera(pg, () => pzLib.lista.length === 1 && !!pzLib.lista[0].mini, null, 4000));
  // otra vez, ahora con la grilla
  await pg.evaluate(() => { __game.pos[0] = 0.37; __game.pos[1] = 1.6; __game.pos[2] = 6.2; __game.look(-17, 0); });
  await pg.evaluate(() => $('grilla').click());
  ok('grilla prendida', await pg.evaluate(() => __game.grilla && __game.pasoGrilla === 1));
  await pg.evaluate(() => pzPoner(pzLib.lista[0]));
  ok('otra más (13)', await espera(pg, () => __game.works.length === 13 && !!__game.held, null, 6000));
  await pg.waitForTimeout(1200);
  const conG = await pg.evaluate(() => { const h = __game.held, b = basis(), m = heldPose(b); return { gr: h.work.gr, f: [m, ...pzLista().map(e => ({ ...pzMover(e.w, pzT(e.ref, m)), w: e.w.w, h: e.w.h }))], m }; });
  const enGrilla = v => Math.abs(v - Math.round(v)) < 0.01;
  const esq = conG.m.c.map((v, i) => v - conG.m.r[i] * conG.m.w / 2 - conG.m.u[i] * conG.m.h / 2);
  ok('con la grilla: la principal derecha y su esquina en la grilla (' + esq.map(v => v.toFixed(2)) + ')', esq.every(enGrilla) && conG.m.r.every(v => Math.abs(v) < 0.01 || Math.abs(Math.abs(v) - 1) < 0.01));
  ok('con la grilla: misma forma y otra gr', igualForma(forma(formaOrig), forma(conG.f)) && conG.gr !== nuevas.gr);
  await pg.tap('#drop'); await pg.waitForTimeout(400);
  while (await pg.evaluate(() => __game.grilla)) await pg.evaluate(() => $('grilla').click());
  // con algo en la mano no se pone
  await pg.evaluate(() => pick(__game.works.find(w => w.id === 'sola'))); await pg.waitForTimeout(1200);
  await pg.evaluate(() => pzLibElegir(pzLib.lista[0]));
  ok('con algo en la mano: avisa y no pone nada', await pg.evaluate(() => __game.works.length === 13) && (await pg.textContent('#hint')).includes('primero soltá'));
  await pg.evaluate(() => cancelHold());
  // datos rotos: una pieza con una foto rota y una imagen que falta (queda vacía), y otra toda rota
  await pg.evaluate(() => new Promise(res => store('readwrite', s => {
    s.put({ id: 'pz~rotas', k: 'rotas', t: 5, mini: null, imgs: [null, 'no es un blob'], obras: [
      { c: [0, 0.5, 0], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, uv: [0, 0, 1, 1], img: 0 },
      { c: [NaN, 0.5, 0], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, uv: [0, 0, 1, 1], img: -1, vacio: true },
      { c: [1, 0.5, 0], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, uv: 'x', img: 7, d: 'mucho', cc: 'zzzzz', rep: [0, 0] }] });
    s.put({ id: 'pz~todarota', k: 'todarota', t: 4, obras: [{ c: 'x' }], imgs: [] });
  }).then(res)));
  await pg.reload(); await pg.waitForTimeout(400); await pg.tap('#start');
  await espera(pg, () => __game.works.length === 13, null, 8000);
  if (await pg.evaluate(() => __game.camOn)) { await pg.tap('#unequip'); await pg.waitForTimeout(200); }
  ok('las rotas aparecen en la lista (3) y no son obras', await espera(pg, () => pzLib.lista.length === 3, null, 4000) && await pg.evaluate(() => __game.works.length === 13));
  await pg.evaluate(() => pzPoner(pzLib.lista.find(e => e.id === 'pz~todarota')));
  await pg.waitForTimeout(500);
  ok('toda rota: no pone nada y avisa', await pg.evaluate(() => __game.works.length === 13 && !__game.held) && (await pg.textContent('#hint')).includes('no pude abrir'));
  await pg.evaluate(() => pzPoner(pzLib.lista.find(e => e.id === 'pz~rotas')));
  ok('con una rota: pone las otras dos, vacías y sanas', await espera(pg, () => __game.works.length === 15, null, 4000) && await pg.evaluate(() => { const h = __game.held; const ws = __game.works.filter(w => w.gr && w.gr === h.work.gr); return ws.length === 2 && ws.every(w => w.vacio && !w.rota && !w.rep && !w.d && !w.cc && w.c.every(Number.isFinite)); }));
  await pg.evaluate(() => cancelHold());
  ok('sin NaN en la posición', await pg.evaluate(() => __game.pos.every(Number.isFinite)));
  // quitar
  await pg.evaluate(() => pzLibAbrir());
  await pg.tap('#pzQuitar');
  ok('quitar: avisa', (await pg.textContent('#pzNota')).includes('sacar'));
  await pg.evaluate(() => { for (const d of [...document.querySelectorAll('#pzLista .pz')]) { const e = pzLib.lista.find(x => x.id === d.dataset.id); if (e && e.n !== 4) d.click(); } });
  await pg.waitForTimeout(300);
  const ks = await pg.evaluate(() => new Promise(res => store('readonly', s => s.getAllKeys()).then(res)));
  ok('quitar saca de la lista y del celu (' + ks.filter(k => String(k).startsWith('pz~')) + ')', await pg.evaluate(() => pzLib.lista.length === 1) && ks.filter(k => String(k).startsWith('pz~')).length === 1);
  await pg.evaluate(() => pzLibCerrar());
  // el tope
  await pg.evaluate(() => { for (let i = 0; i < 29; i++) pzLib.lista.push({ id: 'pz~falsa' + i, n: 1, t: 0 }); pick(__game.works.find(w => w.gr === __game.works.find(x => x.id === 'a').gr && w.id === 'a')); });
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => pzGuardar()); await pg.waitForTimeout(300);
  ok('con 30 no guarda más y avisa', (await pg.textContent('#hint')).includes('ya tenés 30'));
  await pg.evaluate(() => { cancelHold(); pzLib.lista.length = 1; });
  ok('museo: sin errores', !pg.errs.length && !/error/i.test(await pg.textContent('#hint')));
  if (pg.errs.length) console.log(pg.errs);

  // ---------- sala ----------
  const URL = 'http://localhost:8491/?db=' + DB;
  const mk = async () => {
    const c = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const q = await c.newPage(); q.errs = []; q.on('pageerror', e => q.errs.push(e.message));
    await q.goto(URL); await q.waitForTimeout(300); await q.tap('#start'); await q.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 });
    while (await q.evaluate(() => __game.grilla)) await q.tap('#grilla');
    await q.tap('#unequip'); await q.tap('#salaBtn'); await q.fill('#salaPass', PASS); await q.tap('#salaEntrar');
    await espera(q, () => __game.sala.active && __game.sala.estadoVisto, null, 8000);
    return q;
  };
  const dump = async () => ((((await (await fetch(DB + '/__dump')).json()) || {}).salas || {})[H] || {});
  const A = await mk(), B = await mk();
  const img = async col => A.evaluate(([src, col]) => eval(src)(col).toDataURL('image/jpeg', 0.92), ['(' + COLOR.toString() + ')', col]);
  const rojoSrc = await img('#e02010'), verdeSrc = await img('#20d040');
  const subir = async (id, pose, src) => { if (src) await fetch(DB + '/salas/' + H + '/imgs/' + id + '.json', { method: 'PUT', body: JSON.stringify(src) }); await fetch(DB + '/salas/' + H + '/poses/' + id + '.json', { method: 'PUT', body: JSON.stringify(pose) }); };
  // dos rojas iguales, una caja con el costado derecho verde y un bloque vacío: ya son una pieza
  await fetch(DB + '/salas/' + H + '/imgs/s3~cverde002.json', { method: 'PUT', body: JSON.stringify(verdeSrc) });
  await subir('s1', { c: [0, 1.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.8, h: 0.8, uv: [0, 0, 1, 1], gr: 'sg1', t0: Date.now() }, rojoSrc);
  await subir('s2', { c: [1, 1.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.6, h: 0.6, uv: [0, 0, 1, 1], gr: 'sg1', t0: Date.now() }, rojoSrc);
  await subir('s3', { c: [-1, 1.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.6, h: 0.6, d: 0.4, cc: 'mmmmm', cg: ',verde002,,,', uv: [0, 0, 1, 1], gr: 'sg1', t0: Date.now() }, await img('#1040e0'));
  await subir('s4', { c: [0, 0.6, -3], r: [1, 0, 0], u: [0, 1, 0], w: 0.5, h: 0.5, uv: [0, 0, 1, 1], vacio: true, gr: 'sg1', t0: Date.now() }, null);
  ok('A y B tienen las 4 (y la caja su cara)', await espera(A, () => __game.works.length === 4 && __game.works.some(w => w.ci && w.ci[2])) && await espera(B, () => __game.works.length === 4));
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); pick(__game.works.find(w => w.id === 's1')); }); await A.waitForTimeout(1200);
  ok('A: la pieza en la mano', await A.evaluate(() => __game.held.pz && __game.held.pz.ids.size === 3));
  await A.tap('#aPieza');
  ok('A: guardada', await espera(A, () => document.getElementById('hint').textContent.includes('guardada en tus piezas'), null, 5000));
  ok('A: las dos rojas iguales se guardan una vez (3 imágenes)', await A.evaluate(() => new Promise(res => store('readonly', s => s.get(pzLib.lista[0].id)).then(o => res(o.imgs.length === 3)))));
  await A.evaluate(() => cancelHold());
  const antes = await dump();
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 4; __game.look(0, 0); });
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  await A.evaluate(() => pzPoner(pzLib.lista[0]));
  ok('A: las pone (8) y avisa que sube', await espera(A, () => __game.works.length === 8, null, 5000) && (await A.textContent('#hint')).includes('subiendo la pieza'));
  ok('A: en la sala no queda en la mano', await A.evaluate(() => !__game.held));
  ok('A: avisa cuando terminó', await espera(A, () => document.getElementById('hint').textContent.includes('ya está en la sala'), null, 10000));
  const d = await dump();
  const nuevasS = Object.entries(d.poses).filter(([id]) => !antes.poses[id]);
  const gS = nuevasS.length && nuevasS[0][1].gr;
  ok('en la base: 4 poses nuevas con la misma gr nueva (' + gS + ')', nuevasS.length === 4 && !!gS && gS !== 'sg1' && nuevasS.every(([, p]) => p.gr === gS));
  const conTx = nuevasS.filter(([, p]) => p.tx);
  ok('las dos rojas comparten una textura subida una vez (' + conTx.map(([, p]) => p.tx) + ')', conTx.length === 2 && conTx[0][1].tx === conTx[1][1].tx && !!(d.imgs || {})['tx-' + conTx[0][1].tx] && conTx.every(([id]) => !(d.imgs || {})[id]));
  const cajaS = nuevasS.find(([, p]) => p.d);
  ok('la caja con su imagen y la foto de su cara (cg)', !!cajaS && !!d.imgs[cajaS[0]] && !!cajaS[1].cg && !!d.imgs[cajaS[0] + '~c' + cajaS[1].cg.split(',')[1]] && cajaS[1].cg.split(',')[1].length > 0);
  ok('el vacío, vacío', nuevasS.filter(([, p]) => p.vacio).length === 1);
  ok('B las recibe: 8, como una pieza', await espera(B, g => __game.works.length === 8 && __game.works.filter(w => w.gr === g).length === 4, gS, 8000));
  ok('B: la caja nueva con su cara verde y las rojas con imagen', await espera(B, g => { const ws = __game.works.filter(w => w.gr === g); const k = ws.find(w => w.d); return !!k && !!(k.ci && k.ci[2]) && ws.filter(w => !w.vacio).length === 3 && ws.every(w => !w.rota); }, gS, 8000));
  const formaA = await A.evaluate(g => { const ws = __game.works.filter(w => w.gr === g).sort((x, y) => x.w - y.w || x.c[0] - y.c[0]); return ws.map(w => ({ c: w.c, r: w.r, u: w.u, w: w.w, h: w.h })); }, gS);
  const formaS = await A.evaluate(() => { const ws = __game.works.filter(w => w.gr === 'sg1').sort((x, y) => x.w - y.w || x.c[0] - y.c[0]); return ws.map(w => ({ c: w.c, r: w.r, u: w.u, w: w.w, h: w.h })); });
  ok('con la misma forma que la original', igualForma(forma(formaS), forma(formaA)));
  // B la ve donde la puso A (cerca de A, mirando para atrás: z < 4)
  ok('quedó delante de A', formaA.every(o => o.c[2] < 3.2));
  const pR = await B.evaluate(g => __game.works.find(w => w.gr === g && w.tx).c, gS);
  await B.evaluate(p => { __game.pos[0] = p[0]; __game.pos[2] = p[2] + 2.5; __game.look(0, 0); }, pR); await B.waitForTimeout(600);
  const cb = await pxEn(B, pR);
  ok('B ve roja una de las nuevas (' + cb + ')', rojo(cb));
  await B.screenshot({ path: out + 'v10.25_sala_B.png' });
  // A la agarra: viene entera
  await A.evaluate(g => pick(__game.works.find(w => w.gr === g && w.d)), gS); await A.waitForTimeout(1200);
  ok('A: agarrar una de las nuevas trae la pieza', await A.evaluate(() => __game.held && __game.held.pz && __game.held.pz.ids.size === 3));
  await A.evaluate(() => { __game.pos[0] += 1; }); await A.waitForTimeout(300);
  await A.tap('#drop');
  const movidas = d => nuevasS.every(([id, p]) => d.poses[id] && Math.abs(d.poses[id].c[0] - p.c[0] - 1) < 0.02 && d.poses[id].gr === gS);
  let d2 = await dump();
  for (let i = 0; i < 30 && !movidas(d2); i++) { await A.waitForTimeout(200); d2 = await dump(); }   // (con la máquina cargada tarda más)
  ok('A la movió y en la base se movieron las 4', movidas(d2));
  ok('y conservan la textura compartida y la cara', conTx.every(([id]) => d2.poses[id].tx === conTx[0][1].tx) && d2.poses[cajaS[0]].cg === cajaS[1].cg);
  // borrar la pieza nueva: se van sus imágenes y la textura compartida (la original sigue)
  await A.evaluate(g => pick(__game.works.find(w => w.gr === g && w.tx)), gS); await A.waitForTimeout(1200);
  await A.tap('#trash'); await A.waitForTimeout(4500);
  const d3 = await dump();
  ok('borrarla: se van las 4, su textura y la foto de su cara', nuevasS.every(([id]) => !d3.poses[id]) && !(d3.imgs || {})['tx-' + conTx[0][1].tx] && !(d3.imgs || {})[cajaS[0] + '~c' + cajaS[1].cg.split(',')[1]] && !!d3.poses.s1 && !!d3.imgs.s1);
  ok('B vuelve a tener 4', await espera(B, () => __game.works.length === 4, null, 6000));
  // salir de la sala mientras sube: no queda nada a medias
  await A.evaluate(() => { pzPoner(pzLib.lista[0]); });
  await espera(A, () => __game.works.length === 8, null, 5000);
  await A.evaluate(() => salaSalir());
  await A.waitForTimeout(3000);
  const d4 = await dump();
  const sueltas = Object.keys(d4.poses || {}).filter(id => !antes.poses[id]);
  ok('salir mientras sube: las poses que llegaron están enteras (' + sueltas.length + ')', sueltas.every(id => { const p = d4.poses[id]; return p.gr && (p.vacio || p.tx ? true : !!(d4.imgs || {})[id]); }));
  ok('sala: sin errores', !A.errs.length && !B.errs.length && !/error/i.test(await A.textContent('#hint')) && !/error/i.test(await B.textContent('#hint')));
  if (A.errs.length || B.errs.length) console.log(A.errs, B.errs);

  console.log(`\n${fallas ? fallas + ' FALLAS' : 'TODO OK'}`);
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
