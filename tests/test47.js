// biblioteca de texturas (v10.23, propuesta 8 de José, parte 1): "guardar textura" guarda lo que se ve de la foto en la
// mano en tu biblioteca (IndexedDB 'tex~<g>', no la ve loadWorks); con texturas, tocar lo que tenés en la mano (o "foto"
// de una cara) abre la hoja "tus texturas" (elegir, "cámara o galería", quitar); "repetir" repite la imagen de a 1 m /
// 50 / 25 cm (rep en la pose, museo y sala; recortar es escalar; con la grilla, los dos lados de a un paso).
// uso: node tests/test47.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const PASS = 'prueba texturas', H = crypto.createHash('sha256').update('juego:' + PASS).digest('hex');
const DB = 'http://localhost:8472';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8472);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8471);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const visto = (pg, sel) => pg.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && (!e.parentElement || getComputedStyle(e.parentElement).display !== 'none'); }, sel);
  const px = (pg, x, y) => pg.evaluate(([x, y]) => new Promise(res => requestAnimationFrame(() => {
    const a = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); res([...a].slice(0, 3));
  })), [x, y]);
  const proj = (pg, p) => pg.evaluate(p => { const b = basis(), P = __game.pos; const v = [0, 1, 2].map(i => p[i] - P[i]); const z = dot(v, b.f); const [tx, ty] = tans(); return [(1 + dot(v, b.r) / z / tx) / 2, (1 + dot(v, b.u) / z / ty) / 2]; }, p);
  const pxEn = async (pg, p) => { const [x, y] = await proj(pg, p); return px(pg, x, y); };
  const rojo = c => c[0] > 90 && c[0] > c[1] * 2 && c[0] > c[2] * 2, azul = c => c[2] > 90 && c[2] > c[0] * 2 && c[2] > c[1] * 1.5;
  const amarillo = c => c[0] > 90 && c[1] > 90 && c[2] < c[0] * 0.5 && c[2] < c[1] * 0.5;
  const IMG = () => { const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#e02010'; x.fillRect(0, 0, 64, 128); x.fillStyle = '#1040e0'; x.fillRect(64, 0, 64, 128); return c; };
  // una foto de 1.6 x 0.8 a 2.5 m, de frente (centro a la altura del ojo)
  const poner = (pg, o, src = '(' + IMG.toString() + ')') => pg.evaluate(async ([o, src]) => {
    const img = eval(src)();
    addWork(o, img);
    await new Promise(res => img.toBlob(blob => store('readwrite', s => s.put({ ...o, blob })).then(res), 'image/jpeg', 0.95));
    __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0);
  }, [o, src]);
  const tiras = async (pg, z = -2.5) => { const r = []; for (const x of [-0.7, -0.5, -0.3, -0.1, 0.1, 0.3]) r.push(await pxEn(pg, [x, 1.6, z])); return r; };
  const alterna = cs => cs.every((c, i) => i % 2 ? azul(c) : rojo(c));

  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] });
  let pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto('http://localhost:8471/?borrar'); await pg.goto('http://localhost:8471/'); await pg.waitForTimeout(300);
  await pg.tap('#start'); await espera(pg, () => __game.camReady);
  while (await pg.evaluate(() => __game.grilla)) await pg.tap('#grilla');
  await pg.tap('#unequip'); await pg.waitForTimeout(300);
  ok('al arrancar no hay texturas', await espera(pg, () => tx.cargada && tx.lista.length === 0, null, 4000));
  ok('repValida', await pg.evaluate(() => JSON.stringify(repValida([0.5, 0.25])) === '[0.5,0.25]' && !repValida([0, 1]) && !repValida([NaN, 1]) && !repValida([1]) && !repValida('x') && !repValida([1, 41])));
  await poner(pg, { id: 'f1', c: [0, 1.6, -2.5], r: [1, 0, 0], u: [0, 1, 0], w: 1.6, h: 0.8, t0: Date.now() });
  await pg.waitForTimeout(200);
  let c = await tiras(pg);
  ok('estirada: mitad roja y mitad azul (' + c.map(x => rojo(x) ? 'r' : azul(x) ? 'a' : '?').join('') + ')', c.slice(0, 3).every(rojo) && c.slice(4).every(azul));
  const vp = pg.viewportSize();
  const agarrar = async (id) => { await pg.evaluate(id => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); pick(__game.works.find(w => w.id === id)); }, id); await pg.waitForTimeout(1200); };
  await agarrar('f1');
  ok('con una foto en la mano: "repetir" y "guardar textura"', await visto(pg, '#repetir') && await visto(pg, '#aTextura'));
  ok('"repetir" dice repetir', (await pg.textContent('#repetir')).trim() === 'repetir');
  // repetir: 1 m → 50 cm → 25 cm → estirada
  const textos = [];
  for (let i = 0; i < 4; i++) { await pg.tap('#repetir'); await pg.waitForTimeout(60); textos.push((await pg.textContent('#repetir')).trim()); }
  ok('cada toque cambia (' + textos.join(' / ') + ')', textos.join('|') === 'repite: 1 m|repite: 50 cm|repite: 25 cm|repetir');
  await pg.tap('#repetir'); await pg.waitForTimeout(60);
  ok('repetida: la imagen entera y la repetición con su proporción', await pg.evaluate(() => { const L = __game.held.L; return JSON.stringify(L.uv) === '[0,0,1,1]' && L.rep[0] === 1 && Math.abs(L.rep[1] - 1) < 1e-3; }));
  ok('repetida, recortar es escalar (agrandarla suma baldosas)', await pg.evaluate(() => vacioEnMano()));
  // cancelar: no queda
  await pg.evaluate(() => cancelHold()); await pg.waitForTimeout(100);
  ok('cancelar: sigue estirada', await pg.evaluate(() => !__game.works.find(w => w.id === 'f1').rep));
  // repetir de a 40 cm (a mano: la misma cuenta que el botón) y soltar
  await agarrar('f1');
  await pg.evaluate(() => { const L = cur(); L.rep = repDe(0.4, 1); L.uv = FULL.slice(); ui(); });
  ok('el botón dice la medida', (await pg.textContent('#repetir')).trim() === 'repite: 40 cm');
  await pg.tap('#drop'); await pg.waitForTimeout(300);
  ok('soltada: la foto queda repetida', await pg.evaluate(() => { const w = __game.works.find(w => w.id === 'f1'); return w.rep && w.rep[0] === 0.4; }));
  c = await tiras(pg);
  ok('se ve repetida: rojo/azul de a 20 cm (' + c.map(x => rojo(x) ? 'r' : azul(x) ? 'a' : '?').join('') + ')', alterna(c));
  await pg.screenshot({ path: out + 'v10.23_repetida.png' });
  ok('se guarda en el museo con rep', await pg.evaluate(() => store('readonly', s => s.get('f1')).then(o => o && o.rep && o.rep[0] === 0.4 && o.blob instanceof Blob)));
  // caja repetida: las caras siguen en baldosas
  ok('una caja repetida: las caras en baldosas (sin tope)', await pg.evaluate(() => { const cs = cajaCaras({ c: [0, 0, 0], r: [1, 0, 0], u: [0, 1, 0], w: 2, h: 1, uv: FULL, d: 1, rep: [0.5, 0.5] }); return cs[0].uv[2] === 4 && cs[0].uv[3] === 2 && Math.abs(cs[2].uv[2] - cs[2].uv[0]) === 2 && Math.abs(cs[4].uv[3] - cs[4].uv[1]) === 2; }));
  // con la grilla: los dos lados de a un paso (no sigue la proporción)
  ok('grilla: repetida, los dos lados de a un paso', await pg.evaluate(() => { const p = { c: [0, 1, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1.3, h: 0.7, uv: FULL }; const a = __game.snapPose({ ...p, rep: [0.5, 0.5] }, 0.5), e = __game.snapPose(p, 0.5); return a.w === 1.5 && a.h === 0.5 && e.w === 1.5 && Math.abs(e.h - 0.7 * 1.5 / 1.3) < 1e-9 && __game.stableGrilla(1.5, 0.5, 0.5, true) && !__game.stableGrilla(1.5, 0.7, 0.5, true); }));

  // recargar: sigue repetida
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await espera(pg, () => __game.works.length >= 1);
  while (await pg.evaluate(() => __game.grilla)) await pg.tap('#grilla');
  await pg.evaluate(() => { if (__game.camOn) setCam(false); __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); }); await pg.waitForTimeout(400);
  ok('recargada: sigue repetida', await pg.evaluate(() => { const w = __game.works.find(w => w.id === 'f1'); return w && w.rep && w.rep[0] === 0.4; }));
  c = await tiras(pg);
  ok('y se ve repetida (' + c.map(x => rojo(x) ? 'r' : azul(x) ? 'a' : '?').join('') + ')', alterna(c));

  // guardar textura: lo que se ve (repetida: la imagen entera)
  await agarrar('f1');
  await pg.tap('#aTextura');
  ok('guardar textura: queda en la biblioteca', await espera(pg, () => tx.lista.length === 1, null, 4000));
  ok('en el celu: tex~<g> con la imagen y la miniatura (sin blob: loadWorks no la ve)', await pg.evaluate(() => store('readonly', s => s.get(tx.lista[0].id)).then(o => o && /^tex~[a-z0-9]{8}$/.test(o.id) && o.img instanceof Blob && o.mini instanceof Blob && !('blob' in o) && !o.vacio && o.a === 1)));
  const mitades = (blob) => pg.evaluate(async (k) => {
    const e = tx.lista[k], u = URL.createObjectURL(e.img), im = new Image(); im.src = u; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const p = (a, b) => [...x.getImageData(Math.floor(a * im.width), Math.floor(b * im.height), 1, 1).data].slice(0, 3);
    return { izq: p(0.25, 0.5), der: p(0.75, 0.5), w: im.width, h: im.height };
  }, blob);
  let m = await mitades(0);
  ok('la textura guardada es la foto (roja | azul, ' + m.w + 'x' + m.h + ')', rojo(m.izq) && azul(m.der) && m.w === 128 && m.h === 128);
  // sin repetir y recortada: guarda solo lo que se ve
  await pg.evaluate(() => { const L = cur(); L.rep = undefined; L.uv = [0, 0, 0.5, 1]; ui(); });
  await pg.tap('#aTextura');
  await espera(pg, () => tx.lista.length === 2, null, 4000);
  m = await mitades(0);
  ok('recortada: guarda solo el recorte (toda roja, ' + m.w + 'x' + m.h + ')', rojo(m.izq) && rojo(m.der) && m.w === 64 && m.h === 128);
  ok('no rompió el dibujo (se sigue viendo la foto)', rojo(await pxEn(pg, [-0.7, 1.6, -2.5])));
  await pg.evaluate(() => cancelHold()); await pg.waitForTimeout(100);
  ok('sigue repetida en el mundo (cancelé)', await pg.evaluate(() => !!__game.works.find(w => w.id === 'f1').rep));

  // recargar: la biblioteca vuelve y no aparece como foto
  const nWorks = await pg.evaluate(() => __game.works.length);
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await espera(pg, () => __game.works.length >= 1);
  while (await pg.evaluate(() => __game.grilla)) await pg.tap('#grilla');
  await pg.evaluate(() => { if (__game.camOn) setCam(false); });
  ok('recargada: las 2 texturas vuelven (la última primero)', await espera(pg, () => tx.cargada && tx.lista.length === 2, null, 4000) && await pg.evaluate(() => tx.lista[0].t >= tx.lista[1].t));
  ok('y no son fotos del museo (' + nWorks + ')', await pg.evaluate(n => __game.works.length === n && !__game.works.some(w => String(w.id).startsWith('tex~')), nWorks));

  // un bloque vacío: tocarlo en la mano abre la hoja (no el selector)
  await pg.evaluate(() => { const o = { id: 'v1', c: [0, 1.6, -2.5], r: [1, 0, 0], u: [0, 1, 0], w: 0.8, h: 0.4, vacio: true, t0: Date.now() }; addWork(o, VACIO_IMG); store('readwrite', s => s.put({ ...o, blob: null })); __game.pos[2] = 1; });
  await agarrar('v1');
  ok('bloque vacío: sin "repetir" ni "guardar textura"', !(await visto(pg, '#repetir')) && !(await visto(pg, '#aTextura')));
  let fc = null; pg.once('filechooser', f => { fc = f; });
  await pg.touchscreen.tap(vp.width / 2, vp.height / 2); await pg.waitForTimeout(500);
  ok('tocarlo abre "tus texturas" (no el selector)', await visto(pg, '#texHoja') && !fc);
  ok('con las 2 miniaturas', await pg.evaluate(() => document.querySelectorAll('#texLista img').length === 2));
  await pg.screenshot({ path: out + 'v10.23_hoja.png' });
  // "cámara o galería" abre el selector
  const [f2] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null), pg.tap('#texArchivo')]);
  ok('"cámara o galería" abre el selector y cierra la hoja', !!f2 && !(await visto(pg, '#texHoja')));
  // elegir la textura roja | azul (la segunda: la primera es la roja recortada)
  await pg.touchscreen.tap(vp.width / 2, vp.height / 2); await pg.waitForTimeout(500);
  await pg.tap('#texLista img:nth-child(2)');
  ok('elegir una la pone en el bloque (entera, con el recorte que llena la forma)', await espera(pg, () => __game.held && !__game.held.work.vacio && __game.held.work.relleno && __game.held.work.relleno.aspectImg === 1, null, 4000)
    && await pg.evaluate(() => { const u = __game.held.L.uv; return u[0] === 0 && Math.abs(u[1] - 0.25) < 1e-9 && Math.abs(u[3] - 0.75) < 1e-9; }));
  ok('y la hoja se cerró', !(await visto(pg, '#texHoja')));
  ok('ahora sí: "repetir" y "guardar textura"', await visto(pg, '#repetir') && await visto(pg, '#aTextura'));
  await pg.tap('#repetir'); await pg.waitForTimeout(60);
  ok('repetida: la imagen entera de a 1 m', await pg.evaluate(() => { const L = __game.held.L; return JSON.stringify(L.uv) === '[0,0,1,1]' && L.rep[0] === 1 && L.rep[1] === 1; }));
  await pg.tap('#drop'); await pg.waitForTimeout(500);
  let guardado = false;
  for (let i = 0; i < 30 && !guardado; i++) { guardado = await pg.evaluate(() => store('readonly', s => s.get('v1')).then(o => !!(o && o.blob instanceof Blob && !o.vacio && o.rep && o.rep[0] === 1))); if (!guardado) await pg.waitForTimeout(200); }
  ok('soltado: el bloque se guarda con la imagen entera, repetida', guardado);
  ok('su proporción es la de la imagen (no la del bloque)', await pg.evaluate(() => __game.works.find(w => w.id === 'v1').aspect === 1));
  // vaciar le saca la repetición
  await agarrar('v1');
  await pg.tap('#vaciarFoto'); await pg.waitForTimeout(60);
  ok('vaciar le saca la repetición', await pg.evaluate(() => !__game.held.L.rep));
  await pg.evaluate(() => cancelHold());

  // quitar una textura
  await agarrar('f1');
  await pg.touchscreen.tap(vp.width / 2, vp.height / 2); await pg.waitForTimeout(500);
  await pg.tap('#texQuitar');
  ok('quitar: marcado', await pg.evaluate(() => document.getElementById('texHoja').classList.contains('quitando')));
  await pg.tap('#texLista img:nth-child(1)'); await pg.waitForTimeout(300);
  ok('tocar una la saca (queda 1, la hoja sigue abierta)', await pg.evaluate(() => tx.lista.length === 1 && document.querySelectorAll('#texLista img').length === 1) && await visto(pg, '#texHoja'));
  ok('y se borró del celu', await pg.evaluate(() => store('readonly', s => s.getAllKeys()).then(ks => ks.filter(k => String(k).startsWith('tex~')).length === 1)));
  await pg.tap('#texCerrar');
  ok('cerrar', !(await visto(pg, '#texHoja')));
  await pg.evaluate(() => cancelHold());

  // una cara de una caja: "foto" abre la hoja y la textura va en esa cara
  await pg.evaluate(() => { const w = __game.works.find(w => w.id === 'f1'); w.d = 0.6; w.rep = undefined; setBuf(w); });
  await agarrar('f1');
  await pg.evaluate(() => { if (!ajustando) setAjustar(true); setMode('mover'); caraSel = 2; pintarCaras(); }); await pg.waitForTimeout(100);
  fc = null; pg.once('filechooser', f => { fc = f; });
  await pg.tap('#caraFoto'); await pg.waitForTimeout(300);
  ok('"foto" de una cara abre la hoja', await visto(pg, '#texHoja') && !fc);
  await pg.tap('#texLista img');
  ok('la textura va en esa cara', await espera(pg, () => __game.held && __game.held.L.cc && __game.held.L.cc[1] === 'o' && !!ciVer(2), null, 4000));
  await pg.evaluate(() => cancelHold());
  // soltar o cancelar cierra la hoja (plana: tocar una caja elige la cara, v10.29)
  await pg.evaluate(() => { const w = __game.works.find(w => w.id === 'f1'); w.d = undefined; setBuf(w); });
  await agarrar('f1');
  await pg.touchscreen.tap(vp.width / 2, vp.height / 2); await pg.waitForTimeout(500);
  ok('(hoja abierta)', await visto(pg, '#texHoja'));
  await pg.evaluate(() => cancelHold()); await pg.waitForTimeout(60);
  ok('cancelar cierra la hoja', !(await visto(pg, '#texHoja')));
  ok('museo: sin errores', !pg.errs.length && !/error/i.test(await pg.textContent('#hint')));
  if (pg.errs.length) console.log(pg.errs);
  await ctx.close();

  // ---------- sala ----------
  const URL = 'http://localhost:8471/?db=' + DB;
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
  const ROJA = await A.evaluate(src => eval(src)().toDataURL('image/jpeg', 0.92), '(' + IMG.toString() + ')');
  await fetch(DB + '/salas/' + H + '/imgs/s1.json', { method: 'PUT', body: JSON.stringify(ROJA) });
  await fetch(DB + '/salas/' + H + '/poses/s1.json', { method: 'PUT', body: JSON.stringify({ c: [0, 1.6, -2.5], r: [1, 0, 0], u: [0, 1, 0], w: 1.6, h: 0.8, uv: [0, 0, 1, 1], t0: Date.now() }) });
  ok('A y B tienen la foto', await espera(A, () => __game.works.some(w => w.id === 's1')) && await espera(B, () => __game.works.some(w => w.id === 's1')));
  const idA = await A.evaluate(() => __game.salaYo);
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); pick(__game.works.find(w => w.id === 's1')); }); await A.waitForTimeout(1200);
  await A.evaluate(() => { const L = cur(); L.rep = repDe(0.4, 1); L.uv = FULL.slice(); ui(); }); await A.waitForTimeout(600);
  ok('B ve en la mano de A que está repetida (mr)', await espera(B, id => { const p = __game.sala.gente.get(id); return p && p.manoT && p.manoT.rep && p.manoT.rep[0] === 0.4; }, idA, 4000));
  await A.tap('#drop'); await A.waitForTimeout(600);
  let d = await dump();
  ok('la pose lleva rep (' + JSON.stringify(d.poses.s1.rep) + ')', d.poses.s1.rep && d.poses.s1.rep[0] === 0.4 && d.poses.s1.rep[1] === 0.4);
  ok('B la recibe repetida', await espera(B, () => { const w = __game.works.find(w => w.id === 's1'); return w && w.rep && w.rep[0] === 0.4; }, null, 6000));
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); }); await B.waitForTimeout(300);
  c = await tiras(B);
  ok('B la ve repetida (' + c.map(x => rojo(x) ? 'r' : azul(x) ? 'a' : '?').join('') + ')', alterna(c));
  // rep roto en la base: se ignora
  await fetch(DB + '/salas/' + H + '/poses/s1.json', { method: 'PUT', body: JSON.stringify({ ...d.poses.s1, rep: [0, 'x'] }) });
  ok('rep roto: B la deja estirada', await espera(B, () => { const w = __game.works.find(w => w.id === 's1'); return w && !w.rep; }, null, 6000));
  await B.waitForTimeout(300);
  c = await tiras(B);
  ok('y se ve estirada', c.slice(0, 3).every(rojo) && c.slice(4).every(azul));
  // A guarda la textura en la sala y llena un bloque vacío con ella: B lo ve lleno
  await fetch(DB + '/salas/' + H + '/poses/v2.json', { method: 'PUT', body: JSON.stringify({ c: [0, 1.6, -2.4], r: [1, 0, 0], u: [0, 1, 0], w: 0.8, h: 0.4, vacio: true, t0: Date.now() }) });
  ok('A y B tienen el bloque', await espera(A, () => __game.works.some(w => w.id === 'v2')) && await espera(B, () => __game.works.some(w => w.id === 'v2')));
  await A.evaluate(() => pick(__game.works.find(w => w.id === 's1'))); await A.waitForTimeout(1200);
  await A.tap('#aTextura');
  ok('en la sala también se guarda la textura', await espera(A, () => tx.lista.length === 1, null, 4000));
  await A.evaluate(() => cancelHold());
  await A.evaluate(() => { __game.pos[2] = 1.2; pick(__game.works.find(w => w.id === 'v2')); }); await A.waitForTimeout(1200);
  await A.touchscreen.tap(vp.width / 2, vp.height / 2); await A.waitForTimeout(500);
  ok('A: tocar el bloque abre la hoja', await visto(A, '#texHoja'));
  await A.tap('#texLista img');
  await espera(A, () => __game.held && !__game.held.work.vacio, null, 4000);
  await A.tap('#repetir'); await A.waitForTimeout(60);
  await A.tap('#drop');
  ok('B ve el bloque lleno y repetido', await espera(B, () => { const w = __game.works.find(w => w.id === 'v2'); return w && !w.vacio && w.rep && w.rep[0] === 1; }, null, 8000));
  d = await dump();
  const g = await A.evaluate(() => tx.lista[0].g);
  ok('la textura subió una vez a imgs/tx-<clave> (no a imgs/v2) y la pose la nombra', /^data:image\/jpeg/.test(d.imgs['tx-' + g] || '') && !d.imgs.v2 && d.poses.v2.tx === g);
  ok('la pose lleva la imagen entera (uv FULL) y rep', JSON.stringify(d.poses.v2.uv) === '[0,0,1,1]' && d.poses.v2.rep[0] === 1);
  ok('B ve la textura en el bloque (' + (await B.evaluate(() => { const w = __game.works.find(w => w.id === 'v2'); return w.tx; })) + ')', await B.evaluate(g => __game.works.find(w => w.id === 'v2').tx === g, g));
  // otro bloque con la misma textura: no sube nada más, y B no la vuelve a bajar
  await B.evaluate(() => { window.__txPedidos = 0; const f = window.fetch; window.fetch = (u, o) => { if (String(u).includes('/imgs/tx-')) window.__txPedidos++; return f(u, o); }; });
  await fetch(DB + '/salas/' + H + '/poses/v3.json', { method: 'PUT', body: JSON.stringify({ c: [0, 0.9, -2.4], r: [1, 0, 0], u: [0, 1, 0], w: 0.8, h: 0.4, vacio: true, t0: Date.now() }) });
  await espera(A, () => __game.works.some(w => w.id === 'v3')); await espera(B, () => __game.works.some(w => w.id === 'v3'));
  await A.evaluate(() => { __game.pos[2] = 1.2; __game.look(0, -17); pick(__game.works.find(w => w.id === 'v3')); }); await A.waitForTimeout(1200);
  await A.evaluate(() => { tx.para = { held: __game.held }; }); await A.evaluate(() => txElegir(tx.lista[0]));
  await espera(A, () => __game.held && !__game.held.work.vacio, null, 4000);
  await A.tap('#drop');
  ok('B ve el segundo bloque lleno con la misma textura', await espera(B, g => { const w = __game.works.find(w => w.id === 'v3'); return w && !w.vacio && w.tx === g; }, g, 8000));
  d = await dump();
  ok('en la base sigue habiendo una sola textura y nada en imgs/v3', Object.keys(d.imgs).filter(k => k.startsWith('tx-')).length === 1 && !d.imgs.v3 && d.poses.v3.tx === g);
  ok('B no la volvió a bajar (' + await B.evaluate(() => window.__txPedidos) + ')', (await B.evaluate(() => window.__txPedidos)) === 0);
  // uno que entra después: ve los dos llenos (y baja la textura una vez)
  const C = await mk();
  ok('C (entra después) ve los dos bloques con la textura', await espera(C, g => ['v2', 'v3'].every(id => { const w = __game.works.find(w => w.id === id); return w && !w.vacio && w.tx === g; }), g, 8000));
  await C.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = -1; __game.look(0, 0); }); await C.waitForTimeout(400);
  const cv = await pxEn(C, [-0.2, 1.6, -2.4]);
  ok('C la ve (' + cv + ')', rojo(cv) || azul(cv));
  // un cliente de antes mueve v3 y le saca tx (misma imagen: mismo iv): se lo vuelven a poner
  const p3 = (await dump()).poses.v3, sinTx = { ...p3, c: [0.2, 0.9, -2.4] }; delete sinTx.tx;
  await fetch(DB + '/salas/' + H + '/poses/v3.json', { method: 'PUT', body: JSON.stringify(sinTx) });
  ok('un cliente viejo le sacó tx: los demás se lo vuelven a poner en la base', await espera(A, () => true) && await (async () => { for (let i = 0; i < 30; i++) { const q = (await dump()).poses.v3; if (q && q.tx === g && q.c[0] === 0.2) return true; await new Promise(r => setTimeout(r, 200)); } return false; })());
  ok('y B sigue viéndolo lleno', await B.evaluate(g => { const w = __game.works.find(w => w.id === 'v3'); return !w.vacio && w.tx === g; }, g));
  // vaciar v2: la textura sigue (la usa v3); borrar v3: se borra de la base
  await A.evaluate(() => { __game.pos[2] = 1.2; __game.look(0, 0); pick(__game.works.find(w => w.id === 'v2')); }); await A.waitForTimeout(1200);
  await A.tap('#vaciarFoto'); await A.tap('#drop'); await A.waitForTimeout(4000);
  d = await dump();
  ok('vaciado v2: la pose sin tx ni rep, y la textura sigue (la usa v3)', d.poses.v2.vacio && !d.poses.v2.tx && !d.poses.v2.rep && !!d.imgs['tx-' + g]);
  await A.evaluate(() => { __game.pos[2] = 1.2; __game.look(0, -17); pick(__game.works.find(w => w.id === 'v3')); }); await A.waitForTimeout(1200);
  await A.tap('#trash');
  let borrada = false;
  for (let i = 0; i < 40 && !borrada; i++) { borrada = !((await dump()).imgs || {})['tx-' + g]; if (!borrada) await A.waitForTimeout(200); }
  ok('borrado el último que la usaba, la textura se borra de la base', borrada);
  // volver a ponerla después: sube de nuevo
  await A.evaluate(() => { __game.pos[2] = 1.2; __game.look(0, 0); pick(__game.works.find(w => w.id === 'v2')); }); await A.waitForTimeout(1200);
  await A.evaluate(() => { tx.para = { held: __game.held }; }); await A.evaluate(() => txElegir(tx.lista[0]));
  await espera(A, () => __game.held && !__game.held.work.vacio, null, 4000);
  await A.tap('#repetir'); await A.waitForTimeout(60);
  await A.tap('#drop');
  ok('ponerla otra vez la vuelve a subir', await (async () => { for (let i = 0; i < 40; i++) { const q = await dump(); if (q.imgs && q.imgs['tx-' + g] && q.poses.v2.tx === g) return true; await new Promise(r => setTimeout(r, 200)); } return false; })());
  ok('B ve v2 lleno otra vez', await espera(B, g => { const w = __game.works.find(w => w.id === 'v2'); return w && !w.vacio && w.tx === g && w.rep; }, g, 8000));
  // A le saca la repetición: B la ve estirada
  await A.evaluate(() => { __game.pos[2] = 1.2; pick(__game.works.find(w => w.id === 'v2')); }); await A.waitForTimeout(1200);
  await A.tap('#repetir'); await A.tap('#repetir'); await A.tap('#repetir');   // 1 m → 50 → 25 → estirada
  ok('A: estirada otra vez', (await A.textContent('#repetir')).trim() === 'repetir');
  await A.tap('#drop');
  ok('B la ve sin repetir', await espera(B, () => { const w = __game.works.find(w => w.id === 'v2'); return w && !w.rep; }, null, 6000));
  ok('sala: sin errores', !A.errs.length && !B.errs.length && !C.errs.length && !/error/i.test(await A.textContent('#hint')) && !/error/i.test(await B.textContent('#hint')));
  if (A.errs.length || B.errs.length || C.errs.length) console.log(A.errs, B.errs, C.errs);

  console.log(`\n${fallas ? fallas + ' FALLAS' : 'TODO OK'}`);
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
