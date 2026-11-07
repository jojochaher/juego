// videos cortos (v10.27, propuesta 6 parte 1: el museo): mantener apretado el disparador saca la foto y graba hasta 3 s
// de video (una tira de cuadros JPEG); un toque corto sigue siendo solo foto; se mueve cerca (las 4 más cercanas), quieta
// lejos; se guarda y vuelve al recargar; cambiar o vaciar la imagen se lo saca; con el bloque no graba; V en la compu;
// en la sala también graba (v10.28).
// uso: node tests/test51.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.');
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
(async () => {
  const dbSrv = await mock(8512);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8511);
  const URL = 'http://localhost:8511/?db=http://localhost:8512';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] });
  let pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  const cdp = await ctx.newCDPSession(pg);
  const arrancar = async () => { await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForTimeout(400); if (await pg.evaluate(() => __game.camOn)) await espera(pg, () => __game.camReady); await pg.waitForTimeout(300); };
  await pg.goto(URL + '&borrar'); await arrancar();
  // mantener apretado un botón ms milisegundos (un dedo de verdad: touchStart … touchEnd)
  const apretar = async (sel, ms) => {
    const r = await pg.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] });
    await pg.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pg.waitForTimeout(400);
  };
  const n = () => pg.evaluate(() => __game.works.length);
  const ultima = () => pg.evaluate(() => { const w = __game.works[__game.works.length - 1]; return w && { id: w.id, vid: w.vid ? w.vid.size : 0, vi: w.vi || null }; });
  const sinCam = async () => { if (await pg.evaluate(() => __game.camOn)) { await pg.tap('#unequip'); await pg.waitForTimeout(250); } };
  const conCam = async () => { if (!(await pg.evaluate(() => __game.camOn))) await pg.tap('#equip'); await espera(pg, () => __game.camReady); await pg.waitForTimeout(400); };
  const ir = (x, z) => pg.evaluate(([x, z]) => { __game.pos[0] = x; __game.pos[2] = z; }, [x, z]);

  // un toque corto: solo foto
  await pg.tap('#shoot'); await pg.waitForTimeout(600);
  ok('un toque: una foto', (await n()) === 1);
  ok('un toque: sin video', !(await ultima()).vid && !(await pg.evaluate(() => vid.rec)));

  // mantener apretado ~1,6 s: una foto (no dos) con video
  const t0 = Date.now();
  const p = apretar('#shoot', 1600);
  ok('mientras graba el disparador se pone rojo', await espera(pg, () => document.getElementById('shoot').classList.contains('grabando'), null, 1500));
  ok('y lo dice', /video/.test(await pg.textContent('#hint')));
  await p;
  ok('al soltar deja de grabar', !(await pg.evaluate(() => vid.rec)) && !(await pg.evaluate(() => document.getElementById('shoot').classList.contains('grabando'))));
  ok('mantener apretado: una sola foto (el click de soltar no saca otra)', (await n()) === 2);
  ok('la foto tiene su video', await espera(pg, () => { const w = __game.works[__game.works.length - 1]; return w.vid && w.vid.size > 1000 && w.vi; }, null, 4000));
  const u1 = await ultima();
  ok(`con ~1,2 s de cuadros (${u1.vi && u1.vi.n} a ${u1.vi && u1.vi.f} por segundo)`, u1.vi && u1.vi.n >= 5 && u1.vi.n <= 14 && u1.vi.f >= 3 && u1.vi.f <= 12);
  ok(`pesa poco (${(u1.vid / 1024).toFixed(0)} KB)`, u1.vid < 280 * 1024);
  const dims = await pg.evaluate(async () => { const w = __game.works[__game.works.length - 1]; const bm = await createImageBitmap(w.vid); return { W: bm.width, H: bm.height, c: w.vi.c, n: w.vi.n }; });
  ok(`la tira: ${dims.c} columnas, ${dims.W}x${dims.H}, cuadros de a 16 px`, dims.W % dims.c === 0 && (dims.W / dims.c) % 16 === 0 && dims.H % Math.ceil(dims.n / dims.c) === 0 && (dims.H / Math.ceil(dims.n / dims.c)) % 16 === 0 && Math.max(dims.W / dims.c, dims.H / Math.ceil(dims.n / dims.c)) <= 256);
  ok('quedó guardada con la foto', await espera(pg, async id => { const o = await store('readonly', s => s.get(id)); return !!(o && o.blob && o.vid && o.vid.size > 1000 && o.vi && o.vi.n > 5); }, u1.id, 4000));

  // se mueve: dos capturas de la foto, distintas (la cámara falsa cambia); quieta lejos
  await sinCam();
  ok('cerca: está entre las que se mueven', await espera(pg, id => vid.activos.has(id) && vid.texs.get(id) && vid.texs.get(id).tex, u1.id, 3000));
  const clip = await pg.evaluate(id => { const w = __game.works.find(w => w.id === id); const s = proyectar(w.c); return s && { x: s[0] - 30, y: s[1] - 30, width: 60, height: 60 }; }, u1.id).catch(() => null);
  const area = clip || { x: 150, y: 330, width: 100, height: 100 };
  const fotos = [];
  for (let i = 0; i < 4; i++) { fotos.push(await pg.screenshot({ clip: area })); await pg.waitForTimeout(260); }
  ok('se mueve (las capturas cambian)', fotos.some((f, i) => i && !f.equals(fotos[0])));
  const vv = await pg.evaluate(id => { const v = vidCuadro(__game.works.find(w => w.id === id)); return v && { a: v.a, m: v.m }; }, u1.id);
  ok('dibuja un cuadro de la tira (y mezcla con el siguiente)', vv && vv.a[2] > 0 && vv.a[2] < 1 && vv.m >= 0 && vv.m < 1);
  const c1 = await pg.evaluate(id => __game.works.find(w => w.id === id).c, u1.id);
  await ir(c1[0] + 14, c1[2] + 14); await pg.waitForTimeout(500);
  ok('lejos: quieta (la foto)', await pg.evaluate(id => !vid.activos.has(id) && !vidCuadro(__game.works.find(w => w.id === id)), u1.id));
  await ir(c1[0], c1[2] + 2); await pg.waitForTimeout(500);
  ok('al volver se mueve otra vez', await espera(pg, id => vid.activos.has(id) && !!vidCuadro(__game.works.find(w => w.id === id)), u1.id, 3000));

  // tope de 3 s
  await conCam();
  await apretar('#shoot', 4300);
  ok('mantener 4 s: una foto', (await n()) === 3);
  ok('el video corta a los 3 s (24 cuadros o 3 s)', await espera(pg, () => { const w = __game.works[__game.works.length - 1]; return w.vi && w.vi.n > 12 && w.vi.n <= 24 && w.vi.n / w.vi.f > 2.5 && w.vi.n / w.vi.f < 3.3; }, null, 4000));
  const u3 = await ultima();
  ok(`3 s pesan menos de 280 KB (${(u3.vid / 1024).toFixed(0)} KB)`, u3.vid > 0 && u3.vid < 280 * 1024);

  // muy corto: queda la foto sola
  await apretar('#shoot', 600);
  ok('apretado 0,6 s: una foto', (await n()) === 4);
  await pg.waitForTimeout(600);
  ok('sin video (muy corto)', !(await ultima()).vid);

  // al recargar vuelve y se mueve
  await arrancar();
  ok('al recargar la foto tiene su video', await espera(pg, id => { const w = __game.works.find(w => w.id === id); return w && w.vid && w.vid.size > 1000 && w.vi && w.vi.n > 5; }, u1.id, 8000));
  ok('el de 3 s también', await espera(pg, id => { const w = __game.works.find(w => w.id === id); return w && w.vi && w.vi.n > 12; }, u3.id, 4000));
  await sinCam();
  await ir(c1[0], c1[2] + 2);
  ok('y se mueve', await espera(pg, id => !!vidCuadro(__game.works.find(w => w.id === id)), u1.id, 4000));

  // datos rotos en lo guardado: no rompen
  await pg.evaluate(async id => { const o = await store('readonly', s => s.get(id)); await store('readwrite', s => s.put({ ...o, vi: { n: 'x', c: -1, f: NaN } })); }, u3.id);
  await arrancar();
  ok('un vi roto: la foto carga sin video', await espera(pg, id => { const w = __game.works.find(w => w.id === id); return w && !w.vid; }, u3.id, 8000) && (await n()) === 4);
  await sinCam();

  // las 4 más cercanas: con 6 videos juntos se mueven 4
  await pg.evaluate(id => { const v = __game.works.find(w => w.id === id); for (const w of __game.works) if (w !== v) { w.vid = v.vid; w.vi = v.vi; } }, u1.id);
  await pg.evaluate(() => { const w = __game.works[0]; for (let i = 0; i < 3; i++) addWork({ id: 'x' + i, c: [w.c[0] + i * 0.3, w.c[1], w.c[2]], r: w.r, u: w.u, w: w.w, h: w.h }, VACIO_IMG); });
  await pg.evaluate(id => { const v = __game.works.find(w => w.id === id); for (const w of __game.works) if (!w.vid) { w.vacio = false; w.vid = v.vid; w.vi = v.vi; } }, u1.id);
  await pg.waitForTimeout(800);
  ok('con 7 videos cerca se mueven 4', await pg.evaluate(() => vid.activos.size === 4));
  ok('y en la placa quedan a lo sumo 6', await pg.evaluate(() => vid.texs.size <= 6));
  await pg.evaluate(() => { for (const w of [...__game.works]) if (/^x/.test(w.id)) { __game.works.splice(__game.works.indexOf(w), 1); } });
  await pg.evaluate(id => { for (const w of __game.works) if (w.id !== id) { w.vid = null; w.vi = undefined; } }, u1.id);
  await pg.waitForTimeout(500);
  ok('las borradas se olvidan de la placa', await pg.evaluate(() => [...vid.texs.keys()].every(id => __game.works.some(w => w.id === id))));

  // vaciarla le saca el video (también en lo guardado)
  await pg.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, u1.id); await pg.waitForTimeout(1200);
  ok('agarré la del video', (await pg.evaluate(() => __game.held && __game.held.work.id)) === u1.id);
  await pg.tap('#vaciarFoto'); await pg.waitForTimeout(200); await pg.tap('#drop'); await pg.waitForTimeout(700);
  ok('vaciada no tiene video', await pg.evaluate(id => { const w = __game.works.find(w => w.id === id); return w.vacio && !w.vid && !vidCuadro(w); }, u1.id));
  ok('y en lo guardado tampoco', await pg.evaluate(async id => { const o = await store('readonly', s => s.get(id)); return o && o.vacio && !o.vid && !o.vi; }, u1.id));

  // con el bloque equipado, mantener apretado pone un solo bloque
  await pg.tap('#bloque'); await pg.waitForTimeout(300);
  const nb = await n();
  await apretar('#shoot', 1200);
  ok('con el bloque: un solo bloque, sin video', (await n()) === nb + 1 && !(await ultima()).vid && !(await pg.evaluate(() => vid.rec)));
  await pg.tap('#camChica'); await espera(pg, () => __game.camReady); await pg.waitForTimeout(400);

  // compu: mantener V
  const nv = await n();
  await pg.keyboard.down('KeyV'); await pg.waitForTimeout(1500); await pg.keyboard.up('KeyV'); await pg.waitForTimeout(400);
  const conV = (await n()) === nv + 1 && await espera(pg, () => { const w = __game.works[__game.works.length - 1]; return w.vid && w.vi && w.vi.n >= 5; }, null, 4000);
  if (!conV) console.log(await n(), nv, await ultima(), await pg.evaluate(() => JSON.stringify(diagLog.slice(-6))));
  ok('V mantenida: una foto con video', conV);

  // soltar la cámara mientras graba: termina con lo que tenía
  const nu = await n();
  const r = await pg.evaluate(() => { const b = document.getElementById('shoot').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] });
  await pg.waitForTimeout(1700);
  await pg.evaluate(() => document.getElementById('unequip').click()); await pg.waitForTimeout(300);
  ok('guardar la cámara corta la grabación', !(await pg.evaluate(() => vid.rec)));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pg.waitForTimeout(500);
  const quedo = (await n()) === nu + 1 && await espera(pg, () => { const w = __game.works[__game.works.length - 1]; return w.vid && w.vi; }, null, 4000);
  if (!quedo) console.log(await n(), nu, await ultima(), await pg.evaluate(() => diagLog ? JSON.stringify((typeof diagLog === 'function' ? diagLog() : diagLog).slice(-8)) : ''));
  ok('y queda la foto con lo que grabó', quedo);

  // en la sala también graba (v10.28, parte 2; lo de la sala está en test52): mantener apretado = una foto con video
  await pg.tap('#salaBtn'); await pg.fill('#salaPass', 'prueba video'); await pg.tap('#salaEntrar');
  await espera(pg, () => __game.sala.active && __game.sala.estadoVisto);
  await conCam();
  await apretar('#shoot', 1600);
  ok('en la sala: mantener apretado saca una foto (una sola) con video', await espera(pg, () => __game.works.length === 1, null, 3000) && await espera(pg, () => { const w = __game.works[0]; return w.vid && w.vi; }, null, 4000));

  ok('sin errores', !pg.errs.length && !/error/i.test(await pg.textContent('#hint')));
  if (pg.errs.length) console.log(pg.errs);
  console.log(`\n${fallas ? fallas + ' FALLAS' : 'TODO OK'}`);
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
