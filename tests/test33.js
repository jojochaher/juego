// v10.7: tocar lo que tenés en la mano abre cámara/galería; cambiarle la foto o vaciarla (museo y sala);
// colores del personaje en una línea; las fotos entre la cámara y el personaje no lo tapan.
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8491);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8490);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const nueva = async (url) => {
    const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(url); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady); await pg.waitForTimeout(300);
    await pg.evaluate(() => { const el = document.getElementById('bloqueArchivo'); window.__abrio = 0; el.click = () => { window.__abrio++; }; });
    return pg;
  };
  const registro = (pg, id) => pg.evaluate(async id => { const o = await store('readonly', s => s.get(id)); return o ? { vacio: !!o.vacio, blob: o.blob ? o.blob.size : 0 } : null; }, id);
  const centro = pg => { const v = pg.viewportSize(); return [v.width / 2, v.height / 2]; };
  const agarrar = async (pg, id) => { await pg.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, id); await pg.waitForTimeout(1200); };

  // ---- museo
  let pg = await nueva('http://localhost:8490/?borrar');
  await pg.goto('http://localhost:8490/'); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady); await pg.waitForTimeout(300);
  await pg.evaluate(() => { const el = document.getElementById('bloqueArchivo'); window.__abrio = 0; el.click = () => { window.__abrio++; }; });
  await pg.tap('#shoot'); await pg.waitForTimeout(800);
  const id = await pg.evaluate(() => __game.works[__game.works.length - 1].id);
  await pg.waitForTimeout(700);
  const antes = await registro(pg, id);
  await agarrar(pg, id);
  ok('con una foto en la mano aparece "vaciar"', await pg.isVisible('#vaciarFoto'));
  ok('no hay botón "galería"', !(await pg.$('#llenarGaleria')));
  const [cx, cy] = centro(pg);
  await pg.touchscreen.tap(cx, cy); await pg.waitForTimeout(300);
  ok('tocar la foto que tenés en la mano abre cámara / galería', await pg.evaluate(() => window.__abrio === 1));
  await pg.touchscreen.tap(cx, 40); await pg.waitForTimeout(300);
  ok('tocar afuera de la foto no la abre', await pg.evaluate(() => window.__abrio === 1));
  const tex0 = await pg.evaluate(() => __game.held.work.tex);
  await pg.setInputFiles('#bloqueArchivo', path.join(root, 'icon-512.png'));
  ok('elegir una imagen le cambia la foto (todavía en la mano)', await espera(pg, () => __game.held && __game.held.work.relleno && !__game.held.work.vacio));
  await pg.tap('#cancel'); await pg.waitForTimeout(200);
  ok('cancelar deja la foto de antes', await pg.evaluate(t => { const w = __game.works.find(x => !x.vacio); return !!w && !w.relleno; }, tex0));
  await agarrar(pg, id);
  await pg.setInputFiles('#bloqueArchivo', path.join(root, 'icon-192.png'));
  await espera(pg, () => __game.held && __game.held.work.relleno);
  await pg.tap('#drop');
  let despues = null;
  for (let i = 0; i < 20; i++) { await pg.waitForTimeout(250); despues = await registro(pg, id); if (despues && despues.blob !== antes.blob) break; }
  ok(`al soltar se guarda la foto nueva (${antes.blob} → ${despues.blob} bytes)`, despues && despues.blob > 0 && despues.blob !== antes.blob && !despues.vacio);
  // vaciar
  await agarrar(pg, id);
  await pg.tap('#vaciarFoto'); await pg.waitForTimeout(200);
  ok('vaciar la deja vacía en la mano', await pg.evaluate(() => __game.held.work.vacio));
  ok('  y ofrece llenarla de nuevo', await pg.isVisible('#llenarFoto') && !(await pg.isVisible('#vaciarFoto')));
  await pg.tap('#cancel'); await pg.waitForTimeout(200);
  ok('cancelar el vaciado la deja con su foto', await pg.evaluate(id => { const w = __game.works.find(x => x.id === id); return !w.vacio && !w.relleno; }, id));
  await agarrar(pg, id); await pg.tap('#vaciarFoto'); await pg.tap('#drop'); await pg.waitForTimeout(600);
  const vac = await registro(pg, id);
  ok('soltar vacía la guarda vacía (sin imagen)', vac && vac.vacio && vac.blob === 0);
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForTimeout(1500);
  ok('al volver a abrir sigue vacía', await pg.evaluate(id => { const w = __game.works.find(x => x.id === id); return !!w && w.vacio; }, id));

  // ---- personaje
  await pg.tap('#menuBtn'); await pg.tap('#opciones .abrirPersonaje'); await pg.waitForTimeout(800);
  const filas = await pg.evaluate(() => new Set([...document.querySelectorAll('#pjColores .color')].map(e => Math.round(e.getBoundingClientRect().top))).size);
  ok('los colores del personaje entran en una sola línea', filas === 1);
  ok('en el editor no se ven la distancia ni la edición de la mano', !(await pg.isVisible('#edicion')));
  const tapa = await pg.evaluate(() => {
    const cam = pjCamara(), yo = __game.pos.slice();
    const m = [(cam.eye[0] + yo[0]) / 2, yo[1] - 0.6, (cam.eye[2] + yo[2]) / 2];   // una foto a mitad de camino, de frente a la cámara
    const f = norm(sub(yo, cam.eye)); f[1] = 0; const fn = norm(f);
    const r = norm(cross([0, 1, 0], fn));
    const w = { c: m, r, u: [0, 1, 0], w: 1, h: 1 };
    const lejos = { c: [yo[0] + fn[0] * 3, yo[1], yo[2] + fn[2] * 3], r, u: [0, 1, 0], w: 1, h: 1 };   // detrás del personaje
    const eye = __game.pos.slice(); __game.pos[0] = cam.eye[0]; __game.pos[1] = cam.eye[1]; __game.pos[2] = cam.eye[2];
    const res = [tapaAlPersonaje(w, yo, cam.b), tapaAlPersonaje(lejos, yo, cam.b)];
    __game.pos[0] = eye[0]; __game.pos[1] = eye[1]; __game.pos[2] = eye[2];
    return res;
  });
  ok('una foto entre la cámara y el personaje no se dibuja; una de atrás sí', tapa[0] === true && tapa[1] === false);
  await pg.screenshot({ path: out + 'v107_personaje.png' });
  ok('sin errores (museo)', !pg.errs.length && !/error/i.test(await pg.textContent('#hint')));
  if (pg.errs.length) console.log(pg.errs);
  await pg.context().close();

  // ---- sala: A le cambia la foto y después la vacía; B lo ve
  const URL = 'http://localhost:8490/?db=http://localhost:8491';
  const A = await nueva(URL), B = await nueva(URL);
  for (const p of [A, B]) { await p.tap('#salaBtn'); await p.fill('#salaPass', 'prueba cambiar foto'); await p.tap('#salaEntrar'); await p.waitForTimeout(800); }
  await A.tap('#shoot');
  ok('B ve la foto de A', await espera(B, () => __game.works.length === 1 && !__game.works[0].vacio));
  const sid = await A.evaluate(() => __game.works[0].id);
  const texB = await B.evaluate(() => { window.__texB = __game.works[0].tex; return true; });
  await agarrar(A, sid);
  await A.setInputFiles('#bloqueArchivo', path.join(root, 'icon-512.png'));
  await espera(A, () => __game.held && __game.held.work.relleno);
  await A.tap('#drop');
  ok('B recibe la foto nueva (cambió la imagen)', await espera(B, () => __game.works[0].iv && __game.works[0].tex !== window.__texB && !__game.works[0].vacio));
  await agarrar(A, sid); await A.tap('#vaciarFoto'); await A.tap('#drop');
  ok('B la ve vacía', await espera(B, () => __game.works[0].vacio));
  await A.waitForTimeout(600);
  const dump = await (await fetch('http://localhost:8491/__dump').catch(() => null))?.json?.().catch(() => null);
  if (dump) { const h = Object.keys(dump.salas || {})[0]; ok('en la base: pose vacía y sin imagen', dump.salas[h].poses[sid].vacio === true && !(dump.salas[h].imgs || {})[sid]); }
  // mientras B la tiene en la mano, A le pone foto: B suelta con ✓ (sin cambiar la imagen) y queda la foto de A
  await agarrar(B, sid);
  await agarrar(A, sid);
  await A.setInputFiles('#bloqueArchivo', path.join(root, 'icon-192.png'));
  await espera(A, () => __game.held && __game.held.work.relleno);
  await A.tap('#drop'); await A.waitForTimeout(1500);
  ok('B tiene la foto en la mano y se entera del cambio', await espera(B, () => __game.held && !!__game.held.work.llenadoAfuera));
  await B.tap('#drop');
  ok('B suelta con ✓: queda la foto de A (en B también)', await espera(B, () => !__game.works[0].vacio && !__game.held));
  await B.waitForTimeout(800);
  let d2 = await (await fetch('http://localhost:8491/__dump')).json(); let h2 = Object.keys(d2.salas)[0];
  ok('  y en la base sigue con imagen', !d2.salas[h2].poses[sid].vacio && !!(d2.salas[h2].imgs || {})[sid]);
  // mientras B la tiene, A la vacía: B cancela y la ve vacía
  await agarrar(B, sid);
  await agarrar(A, sid); await A.tap('#vaciarFoto'); await A.tap('#drop');
  await espera(B, () => __game.held && !!__game.held.work.llenadoAfuera);
  await B.tap('#cancel');
  ok('B cancela: la ve vacía, como la dejó A', await espera(B, () => __game.works[0].vacio));
  // vaciar mientras todavía sube la foto nueva: gana lo último (vacía)
  await agarrar(A, sid);
  await A.setInputFiles('#bloqueArchivo', path.join(root, 'icon-512.png'));
  await espera(A, () => __game.held && __game.held.work.relleno);
  await A.tap('#drop');
  await agarrar(A, sid); await A.tap('#vaciarFoto'); await A.tap('#drop');
  await A.waitForTimeout(2500);
  d2 = await (await fetch('http://localhost:8491/__dump')).json(); h2 = Object.keys(d2.salas)[0];
  ok('vaciar mientras subía la anterior: queda vacía en la base y en B', d2.salas[h2].poses[sid].vacio === true && !(d2.salas[h2].imgs || {})[sid] && await espera(B, () => __game.works[0].vacio));
  // mientras sube la imagen nueva de A llega una pose con la versión anterior (eco, reconexión, otro que la movió): no la pisa
  await agarrar(A, sid);
  await A.setInputFiles('#bloqueArchivo', path.join(root, 'icon-512.png'));
  await espera(A, () => __game.held && __game.held.work.relleno);
  await A.tap('#drop');
  await espera(B, () => !__game.works[0].vacio);
  await A.waitForTimeout(1500);
  const iv1 = await A.evaluate(() => __game.works[0].iv);
  await A.route('**/imgs/**', async r => { if (r.request().method() === 'PUT') await new Promise(res => setTimeout(res, 2500)); r.continue(); });
  await agarrar(A, sid);
  await A.setInputFiles('#bloqueArchivo', path.join(root, 'icon-192.png'));
  await espera(A, () => __game.held && __game.held.work.relleno);
  await A.tap('#drop');
  const iv2 = await A.evaluate(() => __game.works[0].iv);
  await A.waitForTimeout(300);
  await A.evaluate(([sid, iv1]) => { const w = __game.works[0]; salaUpsert(sid, { c: w.c, r: w.r, u: w.u, w: w.w, h: w.h, uv: w.uv, iv: iv1 }); }, [sid, iv1]);
  await A.waitForTimeout(4000);
  await A.unroute('**/imgs/**');
  d2 = await (await fetch('http://localhost:8491/__dump')).json(); h2 = Object.keys(d2.salas)[0];
  ok('una pose vieja mientras sube no pisa la versión nueva (A, base y B)', iv2 !== iv1 && await A.evaluate(iv2 => __game.works[0].iv === iv2, iv2)
     && d2.salas[h2].poses[sid].iv === iv2 && await espera(B, iv2 => __game.works[0].iv === iv2, iv2));
  ok('sin errores (sala)', !A.errs.length && !B.errs.length);
  if (A.errs.length || B.errs.length) console.log(A.errs, B.errs);
  console.log(fallas ? fallas + ' FALLAS' : 'TODO OK');
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
