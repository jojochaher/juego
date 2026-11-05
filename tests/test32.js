// v10.6: el bloque vacío se equipa (como la cámara), escalar, recortar/escalar con la grilla de a metro, agarraderas
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
(async () => {
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8172);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.addInitScript(() => {
    window.__proj = (p) => { const b = basis(); const v = [p[0]-__game.pos[0], p[1]-__game.pos[1], p[2]-__game.pos[2]]; const z = v[0]*b.f[0]+v[1]*b.f[1]+v[2]*b.f[2]; const [tx, ty] = tans(); return [ (1 + (v[0]*b.r[0]+v[1]*b.r[1]+v[2]*b.r[2])/z/tx)*innerWidth/2, (1 - (v[0]*b.u[0]+v[1]*b.u[1]+v[2]*b.u[2])/z/ty)*innerHeight/2 ]; };
    window.__visto = () => { const P = previewPose(basis()); const c = (sx,sy)=>__proj([0,1,2].map(i => P.c[i]+P.r[i]*P.w/2*sx+P.u[i]*P.h/2*sy)); return { tl: c(-1,1), tr: c(1,1), bl: c(-1,-1), br: c(1,-1), w: P.w, h: P.h, uv: P.uv }; };
  });
  const cdp = await ctx.newCDPSession(pg);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p,i)=>({x:p[0],y:p[1],id:i})) });
  const arrastrar = async (x, y, dx, dy, pasos = 8, foto) => { await T('touchStart', [[x, y]]); for (let i = 1; i <= pasos; i++) { await T('touchMove', [[x + dx * i / pasos, y + dy * i / pasos]]); await pg.waitForTimeout(16); } if (foto) await pg.screenshot({ path: out + foto }); await T('touchEnd', []); await pg.waitForTimeout(50); };
  const vis = async id => pg.isVisible('#' + id);
  const cerca = (a, b) => Math.abs(a - b) < 1e-6;
  await pg.goto('http://localhost:8172/?borrar'); await pg.goto('http://localhost:8172/'); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady);
  await pg.waitForTimeout(5500);   // que se vaya el texto de ayuda
  if (await pg.evaluate(() => __game.grilla)) await pg.tap('#grilla');

  // 1. el bloque se equipa como la cámara
  ok('con la cámara: botón del bloque al lado de guardar la cámara', await vis('bloque') && await vis('unequip') && !(await pg.evaluate(() => document.getElementById('bloque').classList.contains('solo'))));
  await pg.tap('#bloque'); await pg.waitForTimeout(300);
  ok('tocarlo equipa el bloque y guarda la cámara', await pg.evaluate(() => __game.bloqueOn && !__game.camOn && !__game.camReady));
  ok('disparador (de bloque), guardar el bloque y pasar a la cámara; sin equipar ni guardar la cámara',
    await vis('shoot') && await pg.evaluate(() => document.getElementById('shoot').classList.contains('bloque')) && await vis('guardarBloque') && await vis('camChica') && !(await vis('equip')) && !(await vis('unequip')) && !(await vis('bloque')));
  ok('se puede acomodar como la vista previa (grilla, ajustar, distancia)', await vis('edicion') && await vis('dist'));
  await pg.evaluate(() => { const L = __game.previewBloque; L.w = 0.8; L.h = 0.5; });
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: out + 'v106_bloque_equipado.png' });
  const n0 = await pg.evaluate(() => __game.works.length);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  const puesto = await pg.evaluate(() => { const w = __game.works[__game.works.length - 1], P = previewPose(basis()); return { n: __game.works.length, vacio: w.vacio, w: w.w, h: w.h, d: Math.hypot(...w.c.map((v, i) => v - P.c[i])) }; });
  ok('el disparador lo pone donde se ve, con su forma ' + JSON.stringify(puesto), puesto.n === n0 + 1 && puesto.vacio && Math.abs(puesto.w - 0.8) < 1e-9 && Math.abs(puesto.h - 0.5) < 1e-9 && puesto.d < 1e-9);
  ok('y sigue equipado (para poner otro)', await pg.evaluate(() => __game.bloqueOn && !__game.held) && await vis('shoot'));
  await pg.waitForTimeout(300);
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForTimeout(600);
  ok('al volver a abrir sigue equipado el bloque (y la cámara no se abre)', await pg.evaluate(() => __game.bloqueOn && !__game.camOn && !__game.camReady) && await vis('shoot'));
  await pg.tap('#guardarBloque'); await pg.waitForTimeout(200);
  ok('guardar el bloque: nada equipado (cámara grande y bloque al lado)', await pg.evaluate(() => !__game.bloqueOn && !__game.camOn) && await vis('equip') && await vis('bloque') && !(await vis('shoot'))
    && await pg.evaluate(() => document.getElementById('bloque').classList.contains('solo')));
  await pg.tap('#bloque'); await pg.waitForTimeout(200);
  ok('sin nada equipado, el bloque se equipa directo', await pg.evaluate(() => __game.bloqueOn));
  // con el bloque equipado: recortar no recorta (no hay imagen), estira
  await pg.tap('#ajustar'); await pg.tap('[data-m="recortar"]');
  ok('bloque en recortar: agarraderas de escalar', await pg.evaluate(() => deco() && deco().modo === 'escalar'));
  await pg.evaluate(() => { const L = __game.previewBloque; L.c = [0, 0, 2]; L.r = [1, 0, 0]; L.u = [0, 1, 0]; L.w = 0.6; L.h = 0.6; L.uv = [0, 0, 1, 1]; });
  let v = await pg.evaluate(() => __visto());
  await arrastrar(v.tr[0] - 2, (v.tr[1] + v.br[1]) / 2, 60, 0);
  let L = await pg.evaluate(() => ({ w: __game.previewBloque.w, h: __game.previewBloque.h, uv: __game.previewBloque.uv }));
  ok(`el bloque se estira a lo ancho (${L.w.toFixed(2)} x ${L.h.toFixed(2)}, uv ${L.uv})`, L.w > 0.7 && Math.abs(L.h - 0.6) < 1e-9 && L.uv.join() === '0,0,1,1');
  await pg.tap('#camChica'); await pg.waitForFunction(() => window.__game.camReady); await pg.waitForTimeout(200);
  ok('pasar a la cámara guarda el bloque (y pliega ajustar)', await pg.evaluate(() => __game.camOn && !__game.bloqueOn && __game.mode === 'mover') && !(await vis('modes')));

  await pg.evaluate(() => clearWorks());   // el bloque puesto taparía la vista previa en las capturas
  // 2. escalar (sin grilla): estira la imagen, no la recorta
  await pg.tap('#ajustar'); await pg.tap('[data-m="escalar"]');
  ok('modo escalar', await pg.evaluate(() => __game.mode === 'escalar' && deco().modo === 'escalar'));
  await pg.evaluate(() => { resetHeld(); const L = __game.preview; L.c = [0, 0, 2]; });
  v = await pg.evaluate(() => __visto());
  const h0 = v.h;
  await arrastrar((v.tl[0] + v.tr[0]) / 2, v.tl[1] + 2, 0, -50, 8, 'v106_escalar.png');
  v = await pg.evaluate(() => __visto());
  ok(`escalar: el borde de arriba estira a lo alto (${h0.toFixed(2)} -> ${v.h.toFixed(2)} m) sin recortar (uv ${v.uv})`, v.h > h0 * 1.1 && v.uv.join() === '0,0,1,1');
  await pg.tap('[data-m="recortar"]');
  ok('recortar: agarraderas de recortar', await pg.evaluate(() => deco().modo === 'recortar'));
  await pg.evaluate(() => { resetHeld(); const L = __game.preview; L.c = [0, 0, 2]; });
  v = await pg.evaluate(() => __visto());
  await arrastrar(v.tr[0] - 2, (v.tr[1] + v.br[1]) / 2, -60, 0, 8, 'v106_recortar.png');
  v = await pg.evaluate(() => __visto());
  ok(`recortar sigue recortando (uv ${v.uv.map(x => x.toFixed(2))})`, v.uv[2] < 0.9);

  // 3. con la grilla, los bordes van de a metro (cuentas directas)
  const casos = await pg.evaluate(() => {
    const base = (w, h) => ({ c: [0, 0, 3], r: [1, 0, 0], u: [0, 1, 0], w, h, uv: [0, 0, 1, 1] });
    const prueba = (w, h, edges, a, bb, estirar) => { const B = base(w, h), L = JSON.parse(JSON.stringify(B)); const r = bordesA(L, B, edges, a, bb, estirar, true); return { r, w: +L.w.toFixed(6), h: +L.h.toFixed(6), uv: L.uv.map(x => +x.toFixed(4)), cx: +L.c[0].toFixed(6) }; };
    return {
      r3: prueba(3, 1, { r: true }, 0.2, 0, false),        // 3x1, derecho hacia 0.2 → 2 m
      l3: prueba(3, 1, { l: true }, -0.4, 0, false),       // izquierdo → 2 m, la esquina corre 1 m
      uno: prueba(1, 1, { r: true }, -0.4, 0, false),      // 1x1: no se puede (avisa)
      ancha: prueba(2, 1.5, { r: true }, -0.5, 0, false),  // 2x1.5 a 1 de ancho: el lado largo quedaría de 1.5 → no
      alta: prueba(2, 1.5, { t: true }, 0, -0.25, false),  // 2x1.5, el de arriba a 1 m → 2x1
      esc: prueba(1, 1, { r: true }, 1.4, 0, true),        // escalar 1x1 → 2x1, sin recortar
      esc2: prueba(1, 0.75, { t: true }, 0, 0.7, true),    // escalar a lo alto un 1x0.75 → 1x1
      esq: prueba(3, 2, { r: true, t: true }, 0.4, 0.1, false),   // esquina 3x2 → 2x1
    };
  });
  const c = casos;
  ok('3x1, recortar el derecho: 2x1, uv hasta 2/3 ' + JSON.stringify(c.r3), c.r3.w === 2 && c.r3.h === 1 && Math.abs(c.r3.uv[2] - 0.6667) < 1e-3 && c.r3.cx === -0.5);
  ok('3x1, recortar el izquierdo: 2x1, uv desde 1/3, corrida 50 cm ' + JSON.stringify(c.l3), c.l3.w === 2 && Math.abs(c.l3.uv[0] - 0.3333) < 1e-3 && c.l3.cx === 0.5);
  ok('1x1: no se recorta y avisa ' + JSON.stringify(c.uno), c.uno.w === 1 && c.uno.uv.join() === '0,0,1,1' && c.uno.r && c.uno.r.lejos);
  ok('2x1.5 a 1 m de ancho: no se permite (no entra en la grilla) ' + JSON.stringify(c.ancha), c.ancha.w === 2 && c.ancha.h === 1.5 && c.ancha.r.lejos);
  ok('2x1.5, el de arriba: 2x1 ' + JSON.stringify(c.alta), c.alta.w === 2 && c.alta.h === 1 && Math.abs(c.alta.uv[1] - 0.3333) < 1e-3);
  ok('escalar 1x1 a lo ancho: 2x1 sin recortar ' + JSON.stringify(c.esc), c.esc.w === 2 && c.esc.h === 1 && c.esc.uv.join() === '0,0,1,1');
  ok('escalar 1x0.75 a lo alto: 1x1 ' + JSON.stringify(c.esc2), c.esc2.w === 1 && c.esc2.h === 1);
  ok('esquina de 3x2: 2x1 ' + JSON.stringify(c.esq), c.esq.w === 2 && c.esq.h === 1);

  // 4. con la grilla y el dedo de verdad: lo que se ve queda alineado todo el tiempo (de a metro)
  await pg.tap('#grilla'); await pg.waitForTimeout(100);
  await pg.evaluate(() => { const L = __game.preview; L.uv = [0, 0, 1, 1]; L.c = [0, 0, 7]; L.r = [1, 0, 0]; L.u = [0, 1, 0]; L.w = 3; L.h = 1; });
  await pg.waitForTimeout(100);
  v = await pg.evaluate(() => __visto());
  ok(`con grilla se ve de ${v.w} x ${v.h} m`, cerca(v.w, 3) && cerca(v.h, 1));
  const anchoPx = v.tr[0] - v.tl[0];
  await T('touchStart', [[v.tr[0] - 2, (v.tr[1] + v.br[1]) / 2]]);
  for (let i = 1; i <= 8; i++) { await T('touchMove', [[v.tr[0] - 2 - anchoPx * 0.3 * i / 8, (v.tr[1] + v.br[1]) / 2]]); await pg.waitForTimeout(16); }
  const mitad = await pg.evaluate(() => __visto());
  await pg.screenshot({ path: out + 'v106_recortar_grilla.png' });
  await T('touchEnd', []); await pg.waitForTimeout(50);
  ok(`mientras recorta ya se ve alineado: ${mitad.w} x ${mitad.h} m (de a metro), izquierdo quieto`, cerca(mitad.w, 2) && cerca(mitad.h, 1) && Math.abs(mitad.tl[0] - v.tl[0]) < 2);
  const fin = await pg.evaluate(() => __visto());
  ok(`al soltar queda igual (${fin.w} x ${fin.h}, uv ${fin.uv.map(x => x.toFixed(2))})`, cerca(fin.w, 2) && Math.abs(fin.uv[2] - 2 / 3) < 1e-3);
  // 1x1 con la grilla: el borde no se mueve y avisa
  await pg.evaluate(() => { const L = __game.preview; L.uv = [0, 0, 1, 1]; L.c = [0, 0, 4]; L.r = [1, 0, 0]; L.u = [0, 1, 0]; L.w = 1; L.h = 1; });
  await pg.evaluate(() => { document.getElementById('hint').innerHTML = ''; });
  v = await pg.evaluate(() => __visto());
  await arrastrar(v.tr[0] - 2, (v.tr[1] + v.br[1]) / 2, -(v.tr[0] - v.tl[0]) * 0.8, 0);
  const uno = await pg.evaluate(() => ({ v: __visto(), hint: document.getElementById('hint').textContent }));
  ok(`1x1 con grilla: no se recorta (${uno.v.w} x ${uno.v.h}) y avisa: "${uno.hint}"`, cerca(uno.v.w, 1) && uno.v.uv.join() === '0,0,1,1' && /de a metro/.test(uno.hint));
  // escalar con la grilla: de a metro
  await pg.tap('[data-m="escalar"]');
  v = await pg.evaluate(() => __visto());
  await arrastrar(v.tr[0] - 2, (v.tr[1] + v.br[1]) / 2, (v.tr[0] - v.tl[0]) * 1.1, 0, 8, 'v106_escalar_grilla.png');
  v = await pg.evaluate(() => __visto());
  ok(`escalar con grilla: 1x1 → ${v.w} x ${v.h} m, sin recortar`, cerca(v.w, 2) && cerca(v.h, 1) && v.uv.join() === '0,0,1,1');

  // 5. con el bloque equipado (cámara guardada), un bloque agarrado se llena igual con la cámara: "cámara" la abre
  await pg.tap('#grilla'); await pg.tap('[data-m="escalar"]'); await pg.tap('#ajustar');
  await pg.tap('#bloque'); await pg.waitForTimeout(200);
  await pg.evaluate(() => { const L = __game.previewBloque; L.c = [0, 0, 1.5]; L.r = [1, 0, 0]; L.u = [0, 1, 0]; L.w = 0.9; L.h = 0.45; });
  await pg.tap('#shoot'); await pg.waitForTimeout(200);
  await pg.evaluate(() => { pick(__game.works[__game.works.length - 1]); ui(); }); await pg.waitForTimeout(1200);
  ok('agarrado con la cámara guardada: botón "cámara"', (await pg.textContent('#llenarFoto')) === 'cámara' && !(await pg.evaluate(() => __game.camOn)));
  await pg.tap('#llenarFoto'); await pg.waitForFunction(() => window.__game.camReady); await pg.waitForTimeout(300);
  ok('lo abre y pasa a "sacar foto" (el bloque sigue en la mano, la cámara queda equipada)', (await pg.textContent('#llenarFoto')) === 'sacar foto' && await pg.evaluate(() => __game.held && __game.held.work.vacio && !__game.bloqueOn));
  await pg.tap('#llenarFoto'); await pg.waitForTimeout(200);
  ok('sacar foto lo llena', await pg.evaluate(() => __game.held && !__game.held.work.vacio));
  await pg.tap('#cancel'); await pg.waitForTimeout(200);
  const asp = await pg.evaluate(() => { const w = __game.works[__game.works.length - 1]; return { vacio: w.vacio, aspect: w.aspect }; });
  ok('cancelar lo deja vacío, con su proporción ' + JSON.stringify(asp), asp.vacio && cerca(asp.aspect, 0.5));

  // 6. en la compu: 3 es escalar, 4 es girar
  await pg.keyboard.press('Digit4'); ok('tecla 4: girar', await pg.evaluate(() => __game.mode === 'girar'));
  await pg.keyboard.press('Digit3'); ok('tecla 3: escalar', await pg.evaluate(() => __game.mode === 'escalar'));
  console.log('errores', pg.errs);
  await b.close(); web.close(); process.exit(0);
})();
