// el sonido del lugar (v10.16, propuesta 4 parte 1): cada foto que sacás en el museo graba 4 s de sonido; al acercarte
// suena en loop (las 3 más cercanas), se apaga al alejarte, se recuerda al recargar, se calla mientras graba, ☰ lo apaga,
// cambiar o vaciar la imagen le saca el sonido, en la sala no abre su propio micrófono.
// uso: node tests/test41.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.');
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
(async () => {
  const dbSrv = await mock(8412);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8411);
  const URL = 'http://localhost:8411/?db=http://localhost:8412';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] });
  let pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  const arrancar = async (camara = true) => { await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); if (camara) await espera(pg, () => __game.camReady); await pg.waitForTimeout(300); };
  await pg.goto(URL + '&borrar'); await arrancar();
  const n = () => pg.evaluate(() => __game.son.sonando.size);
  const ir = (x, z) => pg.evaluate(([x, z]) => { __game.pos[0] = x; __game.pos[2] = z; }, [x, z]);
  const vol = () => pg.evaluate(() => [...__game.son.sonando.values()].map(e => e.vol));

  ok('☰ dice "sonido del lugar: sí"', (await pg.textContent('#opcSonido')) === 'sonido del lugar: sí');
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  ok('al sacar la foto graba y lo avisa', (await pg.evaluate(() => __game.son.grabando)) === 1 && await espera(pg, () => /grabando/.test(document.getElementById('hint').textContent), null, 2000));
  ok('a los 4 s la foto tiene su sonido', await espera(pg, () => __game.works[0] && __game.works[0].son && __game.works[0].son.size > 500, null, 9000));
  const info = await pg.evaluate(() => ({ kb: __game.works[0].son.size / 1024, tipo: __game.works[0].son.type }));
  ok(`pesa poco (${info.kb.toFixed(1)} KB, ${info.tipo})`, info.kb < 30);
  ok('quedó guardado con la foto', await pg.evaluate(async () => { const o = await store('readonly', s => s.get(__game.works[0].id)); return !!(o && o.blob && o.son && o.son.size > 500); }));
  ok('ya no graba', (await pg.evaluate(() => __game.son.grabando)) === 0);
  ok('cerca de la foto suena', await espera(pg, () => __game.son.sonando.size === 1, null, 4000));
  ok('con volumen (' + (await vol()) + ')', await espera(pg, () => [...__game.son.sonando.values()][0].vol > 0.5, null, 2000));
  ok('el audio corre', await pg.evaluate(() => __game.rtc.ctx && __game.rtc.ctx.state === 'running'));
  const dur = await pg.evaluate(() => { const e = [...__game.son.bufs.values()][0]; return e && e.buf && e.buf.duration; });
  ok('el loop dura ~3,5 s (' + (dur && dur.toFixed(2)) + ')', dur > 2.8 && dur < 4);
  const idF = await pg.evaluate(() => __game.works[0].id);
  const c = await pg.evaluate(() => __game.works[0].c);
  await ir(c[0] + 3.5, c[2] + 0.5); await pg.waitForTimeout(500);
  const v35 = (await vol())[0];
  ok('a 3,5 m más bajo (' + (v35 && v35.toFixed(2)) + ')', v35 > 0.05 && v35 < 0.7);
  // la distancia es a la foto entera (c es el centro): delante de su borde izquierdo, a 1 m, suena entero
  const vb = await pg.evaluate(id => { const w = __game.works.find(w => w.id === id); const n = [w.r[1] * w.u[2] - w.r[2] * w.u[1], w.r[2] * w.u[0] - w.r[0] * w.u[2], w.r[0] * w.u[1] - w.r[1] * w.u[0]];
    const p = [0, 1, 2].map(i => w.c[i] - w.r[i] * w.w * 0.45 + n[i] * 1); return sonDist(w, p); }, idF);
  ok('delante del borde izquierdo, a 1 m: distancia 1 (' + vb.toFixed(2) + ')', Math.abs(vb - 1) < 0.02);
  await ir(c[0] + 20, c[2]); await pg.waitForTimeout(500);
  ok('lejos se apaga', (await n()) === 0);

  // se recuerda al recargar
  await arrancar();
  ok('al recargar la foto sigue con su sonido', await espera(pg, (id) => { const w = __game.works.find(w => w.id === id); return w && w.son && w.son.size > 500; }, idF, 6000));
  await pg.evaluate(id => { const w = __game.works.find(w => w.id === id); __game.pos[0] = w.c[0]; __game.pos[2] = w.c[2] + 1; }, idF);
  ok('y suena al acercarte', await espera(pg, () => __game.son.sonando.size === 1, null, 4000));

  // varias juntas: suenan las 3 más cercanas; mientras graba se callan
  for (let i = 0; i < 3; i++) { await pg.tap('#shoot'); await pg.waitForTimeout(250); }
  ok('mientras graba, lo que suena se calla (la ganancia de verdad)', await espera(pg, () => __game.son.grabando > 0 && [...__game.son.sonando.values()].every(e => e.g.gain.value < 0.05), null, 1500));
  ok('mientras graba, lo que suena se calla', await espera(pg, () => __game.son.grabando > 0 && [...__game.son.sonando.values()].every(e => e.vol === 0), null, 2000));
  ok('las 3 fotos nuevas graban', await espera(pg, () => __game.son.grabando === 0 && __game.works.filter(w => w.son).length === 4, null, 10000));
  ok('suenan 3 a la vez, no 4', await espera(pg, () => __game.son.sonando.size === 3 && [...__game.son.sonando.values()].every(e => e.vol > 0), null, 4000));

  // vaciar una le saca el sonido (también al recargar)
  await pg.tap('#unequip'); await pg.waitForTimeout(200);
  await pg.evaluate(id => { pick(__game.works.find(w => w.id === id)); ui(); }, idF); await pg.waitForTimeout(1200);
  ok('agarré la primera', (await pg.evaluate(() => __game.held && __game.held.work.id)) === idF);
  await pg.tap('#vaciarFoto'); await pg.waitForTimeout(200); await pg.tap('#drop'); await pg.waitForTimeout(600);
  ok('vaciada no tiene sonido', await pg.evaluate(id => { const w = __game.works.find(w => w.id === id); return w.vacio && !w.son; }, idF));
  ok('y en lo guardado tampoco', await pg.evaluate(async id => { const o = await store('readonly', s => s.get(id)); return o && o.vacio && !o.son; }, idF));

  // ☰ lo apaga (y se recuerda)
  await pg.tap('#menuBtn'); await pg.waitForTimeout(200); await pg.tap('#opcSonido'); await pg.waitForTimeout(200);
  ok('☰ → "sonido del lugar: no"', (await pg.textContent('#opcSonido')) === 'sonido del lugar: no');
  await pg.tap('#opcCerrar'); await pg.waitForTimeout(200);
  await pg.tap('#equip'); await espera(pg, () => __game.camReady); await pg.waitForTimeout(300);
  const antes = await pg.evaluate(() => __game.works.length);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  ok('apagado: no suena nada', await espera(pg, () => __game.son.sonando.size === 0, null, 1500));
  ok('apagado: la foto nueva no graba', (await pg.evaluate(() => __game.son.grabando)) === 0 && (await pg.evaluate(() => __game.works.length)) === antes + 1);
  await arrancar();
  ok('apagado se recuerda', (await pg.textContent('#opcSonido')) === 'sonido del lugar: no');
  await pg.tap('#menuBtn'); await pg.waitForTimeout(200); await pg.tap('#opcSonido'); await pg.tap('#opcCerrar'); await pg.waitForTimeout(200);

  // en la sala no graba (parte 1)
  if (!(await pg.evaluate(() => __game.camOn))) { await pg.tap('#equip'); await espera(pg, () => __game.camReady); }
  await pg.tap('#unequip'); await pg.tap('#salaBtn'); await pg.fill('#salaPass', 'prueba sonido'); await pg.tap('#salaEntrar');
  await espera(pg, () => __game.sala.active && __game.sala.estadoVisto);
  ok('en la sala no suena lo del museo', await espera(pg, () => __game.son.sonando.size === 0, null, 3000));
  await pg.tap('#equip'); await espera(pg, () => __game.camReady); await pg.waitForTimeout(300);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  // desde v10.17 en la sala también graba, pero del micrófono de la voz (test42): el propio del sonido queda cerrado
  ok('en la sala graba (del micrófono de la voz)', await espera(pg, () => __game.son.grabando === 1, null, 1500) || await pg.evaluate(() => !__game.rtc.mic));
  ok('en la sala el micrófono del sonido está cerrado', await pg.evaluate(() => !__game.son.mic));

  ok('sin errores', !pg.errs.length && !/error/i.test(await pg.textContent('#hint')));
  if (pg.errs.length) console.log(pg.errs);
  console.log(`\n${fallas ? fallas + ' FALLAS' : 'TODO OK'}`);
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
