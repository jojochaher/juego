// videos cortos en la sala (v10.28, propuesta 6 parte 2): mantener apretado el disparador en la sala saca la foto, graba
// y sube la tira aparte (imgs/<id>~vid + vo en la pose); los demás la bajan recién al acercarse y la ven moverse; moverla
// la mantiene; un cliente viejo que la mueve le saca vo (queda quieta); vaciarla o borrarla borra la tira; datos rotos no
// se toman; irse de la sala a mitad no deja nada suelto; "cuánto ocupa" cuenta los videos aparte.
// uso: node tests/test52.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.');
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const PASS = 'prueba video sala', H = crypto.createHash('sha256').update('juego:' + PASS).digest('hex');
const DB = 'http://localhost:8522';
(async () => {
  const dbSrv = await mock(8522);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8521);
  const URL = 'http://localhost:8521/?db=' + DB;
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const base = async () => (await (await fetch(DB + '/__dump')).json()).salas[H] || {};
  const esperaBase = async (f, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f(await base())) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
  const put = (p, v) => fetch(`${DB}/salas/${H}/${p}.json`, { method: 'PUT', body: JSON.stringify(v) });
  const nueva = async () => {
    const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] });
    const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    pg.cdp = await ctx.newCDPSession(pg);
    await pg.goto(URL + '&borrar'); await pg.goto(URL); await pg.waitForTimeout(300);
    await pg.tap('#start'); await espera(pg, () => __game.camReady); await pg.waitForTimeout(200);
    return pg;
  };
  const entrar = async pg => {
    await pg.tap('#salaBtn'); await pg.fill('#salaPass', PASS); await pg.tap('#salaEntrar');
    await espera(pg, () => __game.sala.active && __game.sala.estadoVisto);
    await pg.evaluate(() => { const p = document.getElementById('salaPanel'); if (p) p.style.display = 'none'; });
  };
  // mantener apretado un botón ms milisegundos (un dedo de verdad)
  const apretar = async (pg, sel, ms) => {
    const r = await pg.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
    await pg.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] });
    await pg.waitForTimeout(ms);
    await pg.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pg.waitForTimeout(400);
  };
  const conCam = async pg => { if (!(await pg.evaluate(() => __game.camOn))) await pg.tap('#equip'); await espera(pg, () => __game.camReady); await pg.waitForTimeout(400); };
  const sinCam = async pg => { if (await pg.evaluate(() => __game.camOn)) { await pg.tap('#unequip'); await pg.waitForTimeout(250); } };
  const de = (pg, id) => pg.evaluate(id => { const w = __game.works.find(w => w.id === id); return w && { vid: w.vid ? w.vid.size : 0, vi: w.vi || null, vo: w.vo || null, pedido: !!w.vidPedido, cuadro: !!vidCuadro(w), vacio: w.vacio }; }, id);
  const ultimaId = pg => pg.evaluate(() => __game.works[__game.works.length - 1].id);

  const A = await nueva(), B = await nueva();
  await entrar(A); await entrar(B);
  await B.evaluate(() => { __game.pos[0] = 40; __game.pos[2] = 40; });   // B lejos desde antes
  await conCam(A);
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });

  // A mantiene apretado: una foto con video, que sube aparte
  await apretar(A, '#shoot', 1700);
  ok('en la sala: mantener apretado saca una foto (una sola)', await espera(A, () => __game.works.length === 1, null, 3000));
  const id = await ultimaId(A);
  ok('la foto tiene su video', await espera(A, id => { const w = __game.works.find(w => w.id === id); return w.vid && w.vid.size > 1000 && w.vi; }, id, 5000));
  ok('subió la tira y vo a la base', await esperaBase(s => typeof (s.imgs || {})[id + '~vid'] === 'string' && /^data:image\/jpeg;base64,/.test(s.imgs[id + '~vid']) && s.poses && s.poses[id] && s.poses[id].vo && s.poses[id].vo.t > 0, 10000));
  const s1 = await base(), va = await de(A, id);
  ok(`vo dice lo mismo que la tira (${JSON.stringify(s1.poses[id].vo)})`, va.vi && s1.poses[id].vo.n === va.vi.n && s1.poses[id].vo.c === va.vi.c && s1.poses[id].vo.f === va.vi.f);
  ok(`entra en la base (${Math.round(s1.imgs[id + '~vid'].length / 1024)} KB < 400)`, s1.imgs[id + '~vid'].length < 400000);
  ok('la foto también está (aparte)', typeof s1.imgs[id] === 'string' && s1.imgs[id] !== s1.imgs[id + '~vid']);
  ok('A ve la suya moverse', (await sinCam(A), await espera(A, id => vid.activos.has(id) && !!vidCuadro(__game.works.find(w => w.id === id)), id, 3000)));

  // B: lejos no la baja (no suma a lo que se baja al entrar); cerca sí, y se mueve
  ok('B ve la foto con su marca de video', await espera(B, id => { const w = __game.works.find(w => w.id === id); return w && w.vo && w.vo.t > 0; }, id, 8000));
  await B.waitForTimeout(1200);
  const lejos = await de(B, id);
  ok('lejos no la baja', !lejos.vid && !lejos.pedido && !lejos.cuadro);
  await B.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  ok('cerca la baja', await espera(B, id => { const w = __game.works.find(w => w.id === id); return w.vid && w.vid.size > 1000 && w.vi; }, id, 6000));
  const vb = await de(B, id);
  ok('con los mismos datos que la de A', vb.vid === va.vid && vb.vi.n === va.vi.n && vb.vi.c === va.vi.c);
  ok('y la ve moverse', await espera(B, id => !!vidCuadro(__game.works.find(w => w.id === id)), id, 3000));
  const clip = await B.evaluate(id => { const w = __game.works.find(w => w.id === id); const s = proyectar(w.c); return s && { x: s[0] - 30, y: s[1] - 30, width: 60, height: 60 }; }, id).catch(() => null);
  const fotos = [];
  for (let i = 0; i < 4; i++) { fotos.push(await B.screenshot({ clip: clip || { x: 150, y: 330, width: 100, height: 100 } })); await B.waitForTimeout(260); }
  ok('en la pantalla de B cambia (pixeles)', fotos.some((f, i) => i && !f.equals(fotos[0])));

  // C entra después: le llega con vo (addWork) y la baja al acercarse
  const C = await nueva(); await entrar(C);
  await C.evaluate(() => { __game.pos[0] = 0.3; __game.pos[2] = 0.5; });
  ok('C, que entró después, la baja y la ve moverse', await espera(C, id => { const w = __game.works.find(w => w.id === id); return w && w.vid && !!vidCuadro(w); }, id, 9000));
  await C.context().close();

  // A la mueve: el video sigue (en la base y en B)
  await A.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, id); await A.waitForTimeout(1000);
  await A.evaluate(() => { __game.look(20, 0); }); await A.waitForTimeout(300);
  await A.tap('#drop'); await A.waitForTimeout(800);
  ok('movida: la base sigue con vo y la tira', await esperaBase(s => s.poses[id] && s.poses[id].vo && typeof s.imgs[id + '~vid'] === 'string', 3000));
  ok('B la sigue viendo moverse', (await de(B, id)).vid > 0);

  // un cliente viejo (v10.27) la mueve: manda la pose sin vo → queda quieta para todos
  const pv = { ...(await base()).poses[id] }; delete pv.vo; pv.c = [pv.c[0] + 0.2, pv.c[1], pv.c[2]];
  await put('poses/' + id, pv);
  ok('un cliente viejo le saca vo: B la deja quieta', await espera(B, id => { const w = __game.works.find(w => w.id === id); return !w.vo && !w.vid && !vidCuadro(w); }, id, 5000));
  ok('y A también', await espera(A, id => { const w = __game.works.find(w => w.id === id); return !w.vo && !w.vid; }, id, 5000));
  // se la devuelvo (como si lo hubiera grabado otra vez): vuelve
  const vo1 = s1.poses[id].vo;
  await put('poses/' + id + '/vo', vo1);
  ok('con vo de vuelta, B la baja otra vez', await espera(B, id => { const w = __game.works.find(w => w.id === id); return w.vo && w.vid && !!vidCuadro(w); }, id, 8000));

  // A la vacía: se va la tira (de la base y de B)
  await A.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, id); await A.waitForTimeout(1000);
  await A.tap('#vaciarFoto'); await A.waitForTimeout(200); await A.tap('#drop');
  ok('vaciada: sin video en la base', await esperaBase(s => s.poses[id] && s.poses[id].vacio && !s.poses[id].vo && !(id + '~vid' in (s.imgs || {})), 6000));
  ok('B no la ve moverse más', await espera(B, id => { const w = __game.works.find(w => w.id === id); return w.vacio && !w.vid && !w.vo && !vidCuadro(w); }, id, 5000));

  // otra con video, y borrarla borra la tira
  await conCam(A);
  await apretar(A, '#shoot', 1900);
  await A.waitForTimeout(300);
  const id2 = await ultimaId(A);
  if (id2 === id || !(await esperaBase(s => s.poses[id2] && s.poses[id2].vo, 8000))) console.log(id, id2, await A.evaluate(() => __game.works.map(w => [w.id, !!w.vid, w.vo && w.vo.t])), JSON.stringify(await A.evaluate(() => (typeof diagLog === 'function' ? diagLog() : diagLog).slice(-10))));
  ok('otra con video sube', id2 !== id && await esperaBase(s => typeof (s.imgs || {})[id2 + '~vid'] === 'string' && s.poses[id2] && s.poses[id2].vo, 10000));
  await sinCam(A);
  await A.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, id2); await A.waitForTimeout(800);
  await A.evaluate(() => trash()); await A.waitForTimeout(300);
  ok('borrada: sin foto ni video en la base', await esperaBase(s => !(s.poses || {})[id2] && !(id2 in (s.imgs || {})) && !(id2 + '~vid' in (s.imgs || {})), 6000));

  // otra imagen en una foto con video (llenarla de nuevo con la cámara): se le va el video
  await conCam(A);
  await apretar(A, '#shoot', 1900);
  const id3 = await ultimaId(A);
  ok('una tercera con video', await esperaBase(s => typeof (s.imgs || {})[id3 + '~vid'] === 'string' && s.poses[id3] && s.poses[id3].vo, 10000));
  await sinCam(A);
  // antes, un cliente viejo la mueve (le saca vo): igual, al cambiarle la imagen se borra la tira
  const p3 = { ...(await base()).poses[id3] }; delete p3.vo; await put('poses/' + id3, p3);
  await espera(A, id => !__game.works.find(w => w.id === id).vo, id3, 5000);
  await A.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, id3); await A.waitForTimeout(800);
  await A.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; c.getContext('2d').fillStyle = '#3a7'; c.getContext('2d').fillRect(0, 0, 64, 48); llenarBloque(c); });
  await A.waitForTimeout(300); await A.tap('#drop');
  ok('cambiada la imagen: sin video en la base (la foto nueva sí)', await esperaBase(s => s.poses[id3] && !s.poses[id3].vo && !(id3 + '~vid' in (s.imgs || {})) && typeof s.imgs[id3] === 'string', 8000));
  ok('y en B tampoco', await espera(B, id => { const w = __game.works.find(w => w.id === id); return w && !w.vo && !w.vid; }, id3, 6000));

  // mientras sube el video, una pose vieja sin vo (un eco, o un cliente viejo) no le saca el video al que lo sube
  ok('subiendo: una pose sin vo no le saca el video', await A.evaluate(() => { const w = { id: 'x', vid: new Blob(['a']), vi: { n: 4, c: 2, f: 8 }, vidSube: { t: 9, n: 4, c: 2, f: 8 } };
    salaVidMarca(w, undefined); const a = !!w.vid; salaVidMarca(w, { t: 9, n: 4, c: 2, f: 8 }); const b = !!w.vid && w.vo && w.vo.t === 9; return a && b; }));

  // datos rotos que llegan por la red: no se toman
  ok('vo roto no se toma', await B.evaluate(() => [null, 5, 'x', { t: 1 }, { t: NaN, n: 4, c: 2, f: 8 }, { t: 1, n: 1000, c: 2, f: 8 }, { t: 1, n: 8, c: 0, f: 8 }, { t: 1, n: 8, c: 3, f: 99 }].every(v => salaVoValida(v) === undefined) && salaVoValida({ t: 5, n: 8, c: 3, f: 8, x: 'basura' }).x === undefined));
  ok('una tira rota no se toma', await B.evaluate(() => salaVidBlob('data:image/png;base64,' + 'A'.repeat(800)) === null && salaVidBlob('<script>') === null && salaVidBlob(12) === null && salaVidBlob('data:image/jpeg;base64,' + 'A'.repeat(900)) === null && salaVidBlob('data:image/jpeg;base64,/9j/' + 'A'.repeat(900)) instanceof Blob));
  const idR = 'roto-' + Date.now();
  const src = (await base()).imgs[id3];
  await put('imgs/' + idR, src);
  await put('imgs/' + idR + '~vid', 'data:text/html;base64,PGI+');
  await put('poses/' + idR, { c: [0, 1.5, -1.2], r: [1, 0, 0], u: [0, 1, 0], w: 0.6, h: 0.45, uv: [0, 0, 1, 1], vo: { t: 7, n: 8, c: 3, f: 8 } });
  ok('B ve la foto con un video roto', await espera(B, id => { const w = __game.works.find(w => w.id === id); return w && w.vo; }, idR, 8000));
  await B.waitForTimeout(2500);
  ok('y la deja quieta, sin romperse', await B.evaluate(id => { const w = __game.works.find(w => w.id === id); return !w.vid && !vidCuadro(w); }, idR));

  // irse de la sala justo al soltar: no queda la tira suelta
  await conCam(A);
  await apretar(A, '#shoot', 1900);
  const id4 = await A.evaluate(() => __game.works.length && __game.works[__game.works.length - 1].id);
  await A.evaluate(() => salaSalir());
  await A.waitForTimeout(3000);
  ok('se fue al soltar: nada suelto en la base', !((id4 + '~vid') in ((await base()).imgs || {})));

  // cuánto ocupa: los videos cuentan aparte (y no en lo que se baja al entrar)
  const cu = await A.evaluate(() => salaContarImgs({ a: true, 'a~son': true, 'a~vid': true, b: true }));
  ok(`cuánto ocupa cuenta los videos aparte (${JSON.stringify(cu)})`, cu.f === 2 && cu.s === 1 && cu.v === 1 && cu.b > cu.bf);

  for (const [n, pg] of [['A', A], ['B', B]]) {
    ok(n + ' sin errores', !pg.errs.length && !/error/i.test(await pg.textContent('#hint')));
    if (pg.errs.length) console.log(pg.errs);
  }
  console.log(`\n${fallas ? fallas + ' FALLAS' : 'TODO OK'}`);
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
