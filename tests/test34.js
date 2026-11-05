// v10.8: grilla de distintos tamaños (1 m → 50 cm → 25 cm → apagada): botón, alinear, recortar/escalar, guías, se recuerda
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
(async () => {
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8174);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.addInitScript(() => {
    window.__proj = (p) => { const b = basis(); const v = [p[0]-__game.pos[0], p[1]-__game.pos[1], p[2]-__game.pos[2]]; const z = v[0]*b.f[0]+v[1]*b.f[1]+v[2]*b.f[2]; const [tx, ty] = tans(); return [ (1 + (v[0]*b.r[0]+v[1]*b.r[1]+v[2]*b.r[2])/z/tx)*innerWidth/2, (1 - (v[0]*b.u[0]+v[1]*b.u[1]+v[2]*b.u[2])/z/ty)*innerHeight/2 ]; };
    window.__visto = () => { const P = previewPose(basis()); const c = (sx,sy)=>__proj([0,1,2].map(i => P.c[i]+P.r[i]*P.w/2*sx+P.u[i]*P.h/2*sy)); return { tl: c(-1,1), tr: c(1,1), bl: c(-1,-1), br: c(1,-1), w: P.w, h: P.h, uv: P.uv }; };
    // cuántos dibujos hace un cuadro (para ver que las guías de 25 cm no sean demasiadas para el celu)
    window.__dibujos = () => new Promise(res => { const g = gl, orig = g.drawArrays.bind(g), o2 = g.drawElements.bind(g); let n = 0;
      g.drawArrays = (...a) => { n++; return orig(...a); }; g.drawElements = (...a) => { n++; return o2(...a); };
      requestAnimationFrame(() => { n = 0; requestAnimationFrame(() => { const r = n; g.drawArrays = orig; g.drawElements = o2; res(r); }); }); });
  });
  const cdp = await ctx.newCDPSession(pg);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p,i)=>({x:p[0],y:p[1],id:i})) });
  const arrastrar = async (x, y, dx, dy, pasos = 8, foto) => { await T('touchStart', [[x, y]]); for (let i = 1; i <= pasos; i++) { await T('touchMove', [[x + dx * i / pasos, y + dy * i / pasos]]); await pg.waitForTimeout(16); } if (foto) await pg.screenshot({ path: out + foto }); await T('touchEnd', []); await pg.waitForTimeout(50); };
  const cerca = (a, b, e = 1e-6) => Math.abs(a - b) < e;
  const multiplo = (v, P) => cerca(v / P, Math.round(v / P), 1e-6);
  await pg.goto('http://localhost:8174/?borrar'); await pg.goto('http://localhost:8174/'); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady);
  await pg.waitForTimeout(300);
  while (await pg.evaluate(() => __game.grilla)) await pg.tap('#grilla');

  // 1. el botón: apagada → 1 m → 50 cm → 25 cm → apagada
  const estado = () => pg.evaluate(() => ({ on: __game.grilla, P: __game.pasoGrilla, txt: document.getElementById('grilla').textContent, cls: document.getElementById('grilla').classList.contains('on') }));
  const vuelta = [await estado()];
  for (let i = 0; i < 4; i++) { await pg.tap('#grilla'); await pg.waitForTimeout(50); vuelta.push(await estado()); }
  ok('el botón da la vuelta: ' + vuelta.map(e => e.txt).join(' → '),
    !vuelta[0].on && !vuelta[0].cls && vuelta[1].on && vuelta[1].P === 1 && vuelta[1].txt === '▦ 1 m' && vuelta[1].cls &&
    vuelta[2].P === 0.5 && vuelta[2].txt === '▦ 50 cm' && vuelta[3].P === 0.25 && vuelta[3].txt === '▦ 25 cm' && vuelta[3].on && !vuelta[4].on && !vuelta[4].cls);

  // 2. alinear con cada paso (cuentas directas)
  const r = await pg.evaluate(() => {
    const g = __game, n = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
    const p = { c: [0.237, 1.43, -1.18], r: n([0.9, 0.15, 0.3]), u: n([-0.1, 0.95, 0.2]), w: 0.537, h: 0.4, uv: [0, 0, 1, 1] };
    const una = P => { const s = g.snapPose(p, P); return { s, corner: s.c.map((v, i) => v - s.r[i] * s.w / 2 - s.u[i] * s.h / 2) }; };
    const tam = P => [[0.1, 1], [0.2, 2.6], [3.4, 0.5], [0.2, 0.3], [0.62, 0.4], [0.1, 0.12]].map(([w, h]) => { const q = g.snapPose({ c: [0.2, 1.3, -2], r: [1, 0, 0], u: [0, 1, 0], w, h, uv: [0, 0, 1, 1] }, P); return [q.w, q.h]; });
    return { m: una(1), c50: una(0.5), c25: una(0.25), t50: tam(0.5), t25: tam(0.25),
      est: [g.stableGrilla(0.5, 0.3, 0.5), g.stableGrilla(0.75, 0.3, 0.5), g.stableGrilla(0.75, 0.3, 0.25), g.stableGrilla(0.25, 0.1, 0.25), g.stableGrilla(0.2, 0.1, 0.25), g.stableGrilla(1, 1, 1)] };
  });
  ok('de a 1 m sigue igual (esquina en metros enteros, ancho 1)', r.m.corner.every(v => multiplo(v, 1)) && cerca(r.m.s.w, 1));
  ok('de a 50 cm: esquina y lado más largo de a 50 cm ' + JSON.stringify(r.c50.corner.map(v => +v.toFixed(3))) + ` ancho ${r.c50.s.w}`, r.c50.corner.every(v => multiplo(v, 0.5)) && cerca(r.c50.s.w, 0.5));
  ok('de a 25 cm: esquina y lado más largo de a 25 cm ' + JSON.stringify(r.c25.corner.map(v => +v.toFixed(3))) + ` ancho ${r.c25.s.w}`, r.c25.corner.every(v => multiplo(v, 0.25)) && cerca(r.c25.s.w, 0.5));
  ok('con 25 cm sigue de pie y en 90°', cerca(r.c25.s.u[1], 1) && r.c25.s.r.every(v => cerca(Math.abs(v), 0) || cerca(Math.abs(v), 1)));
  const e50 = [[0.5, 5], [0.2 * 2.5 / 2.6, 2.5], [3.5, 0.5 * 3.5 / 3.4], [0.5 * 0.2 / 0.3, 0.5], [0.5, 0.4 * 0.5 / 0.62], [0.5 * 0.1 / 0.12, 0.5]];
  const e25 = [[0.1, 1], [0.2 * 2.5 / 2.6, 2.5], [3.5, 0.5 * 3.5 / 3.4], [0.25 * 0.2 / 0.3, 0.25], [0.5, 0.4 * 0.5 / 0.62], [0.25 * 0.1 / 0.12, 0.25]];
  e50[0] = [0.1, 1];   // 0.1 x 1: el alto (1) ya es múltiplo de 50 cm
  const igualT = (a, e) => a.every((x, i) => cerca(x[0], e[i][0], 1e-9) && cerca(x[1], e[i][1], 1e-9));
  ok('tamaños de a 50 cm (mínimo 50 cm, proporción igual) ' + JSON.stringify(r.t50.map(x => x.map(v => +v.toFixed(3)))), igualT(r.t50, e50));
  ok('tamaños de a 25 cm (mínimo 25 cm) ' + JSON.stringify(r.t25.map(x => x.map(v => +v.toFixed(3)))), igualT(r.t25, e25));
  ok('qué se puede con cada paso ' + JSON.stringify(r.est), JSON.stringify(r.est) === '[true,false,true,true,false,true]');

  // 3. recortar de verdad con 50 cm: una de 1 x 1 se recorta a 50 cm (con 1 m no se podía)
  await pg.tap('#grilla'); await pg.tap('#grilla');   // 1 m → 50 cm
  ok('grilla de 50 cm', await pg.evaluate(() => __game.grilla && __game.pasoGrilla === 0.5));
  await pg.tap('#ajustar'); await pg.tap('[data-m="recortar"]');
  await pg.evaluate(() => { const L = __game.preview; L.uv = [0, 0, 1, 1]; L.c = [0, 0, 4]; L.r = [1, 0, 0]; L.u = [0, 1, 0]; L.w = 1; L.h = 1; });
  await pg.waitForTimeout(100);
  let v = await pg.evaluate(() => __visto());
  ok(`se ve de ${v.w} x ${v.h} m`, cerca(v.w, 1) && cerca(v.h, 1));
  await arrastrar(v.tr[0] - 2, (v.tr[1] + v.br[1]) / 2, -(v.tr[0] - v.tl[0]) * 0.45, 0, 8, 'v108_recortar_50.png');
  v = await pg.evaluate(() => __visto());
  ok(`recortada a ${v.w} x ${v.h} m (uv ${v.uv.map(x => x.toFixed(2))})`, cerca(v.w, 0.5) && cerca(v.h, 1) && cerca(v.uv[2], 0.5, 1e-3));
  // escalar con 25 cm: de 0.5 x 1 sube de a 25 cm
  await pg.tap('#grilla');   // 50 → 25 cm
  await pg.tap('[data-m="escalar"]');
  await pg.evaluate(() => { const L = __game.preview; L.uv = [0, 0, 1, 1]; L.c = [0, 0, 4]; L.r = [1, 0, 0]; L.u = [0, 1, 0]; L.w = 1; L.h = 1; });
  await pg.waitForTimeout(100);
  v = await pg.evaluate(() => __visto());
  const pxM = v.tr[0] - v.tl[0];
  await arrastrar(v.tr[0] - 2, (v.tr[1] + v.br[1]) / 2, pxM * 0.3, 0, 8, 'v108_escalar_25.png');
  v = await pg.evaluate(() => __visto());
  ok(`escalar de a 25 cm: 1 x 1 → ${v.w} x ${v.h} m`, cerca(v.w, 1.25) && cerca(v.h, 1) && v.uv.join() === '0,0,1,1');
  // y el aviso dice el paso
  await pg.evaluate(() => { const L = __game.preview; L.uv = [0, 0, 1, 1]; L.c = [0, 0, 4]; L.r = [1, 0, 0]; L.u = [0, 1, 0]; L.w = 0.25; L.h = 0.25; document.getElementById('hint').innerHTML = ''; });
  await pg.tap('[data-m="recortar"]'); await pg.waitForTimeout(100);
  v = await pg.evaluate(() => __visto());
  await arrastrar(v.tr[0] - 2, (v.tr[1] + v.br[1]) / 2, -(v.tr[0] - v.tl[0]) * 0.8, 0);
  const aviso = await pg.evaluate(() => ({ v: __visto(), hint: document.getElementById('hint').textContent }));
  ok(`25 x 25 cm con la de 25: no se recorta y avisa "${aviso.hint}"`, cerca(aviso.v.w, 0.25) && /de a 25 cm/.test(aviso.hint));
  await pg.tap('[data-m="recortar"]');   // vuelve a mover
  await pg.tap('#ajustar');

  // 4. guías: con 25 cm no son demasiadas para el celu
  await pg.evaluate(() => { const L = __game.preview; L.uv = [0, 0, 1, 1]; L.c = [0, -0.2, 2.5]; L.r = [1, 0, 0]; L.u = [0, 1, 0]; L.w = 1.2; L.h = 0.9; });
  const dib = {};
  for (const [P, taps] of [[0.25, 0], [1, 2], [0.5, 1]]) {
    for (let i = 0; i < taps; i++) await pg.tap('#grilla');
    await pg.waitForTimeout(150);
    const p = await pg.evaluate(() => __game.pasoGrilla);
    dib[p] = await pg.evaluate(() => __dibujos());
    await pg.screenshot({ path: out + `v108_guias_${p * 100}.png` });
  }
  ok('dibujos por cuadro con las guías ' + JSON.stringify(dib), dib[1] > 0 && dib[0.5] > dib[1] && dib[0.25] < 1200 && dib[0.5] < 1200);
  // una foto grande (4 x 3 m) con 25 cm: las guías van más espaciadas y no se disparan
  await pg.tap('#grilla'); await pg.waitForTimeout(100);   // 50 → 25
  await pg.evaluate(() => { const L = __game.preview; L.c = [0, -0.2, 9]; L.w = 4; L.h = 3; });
  await pg.waitForTimeout(150);
  const grande = await pg.evaluate(() => __dibujos());
  await pg.screenshot({ path: out + 'v108_guias_grande.png' });
  ok(`foto de 4 x 3 m con 25 cm: ${grande} dibujos por cuadro`, grande > 0 && grande < 400);
  for (let i = 0; i < 3; i++) await pg.tap('#grilla');   // 25 → no → 1 m → 50

  // 5. una foto con 25 cm queda alineada de a 25 cm, y se recuerda el paso
  await pg.tap('#grilla');   // 50 → 25
  await pg.evaluate(() => { resetHeld(); __game.look(17, 9); }); await pg.waitForTimeout(300);
  await pg.tap('#shoot'); await pg.waitForTimeout(600);
  const w = await pg.evaluate(() => { const w = __game.works[__game.works.length - 1]; return { c: w.c, r: w.r, u: w.u, w: w.w, h: w.h }; });
  const corner = w.c.map((x, i) => x - w.r[i] * w.w / 2 - w.u[i] * w.h / 2);
  ok('foto de a 25 cm ' + JSON.stringify({ corner: corner.map(x => +x.toFixed(3)), w: +w.w.toFixed(3), h: +w.h.toFixed(3) }), corner.every(x => multiplo(x, 0.25)) && multiplo(Math.max(w.w, w.h), 0.25));
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForTimeout(800);
  ok('se recuerda el paso', await pg.evaluate(() => __game.grilla && __game.pasoGrilla === 0.25 && document.getElementById('grilla').textContent === '▦ 25 cm'));
  await pg.evaluate(() => { localStorage.setItem('grillaPaso', 'NaN'); }); await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForTimeout(500);
  ok('un paso guardado roto vuelve a 1 m', await pg.evaluate(() => __game.pasoGrilla === 1));
  ok('sin errores ' + JSON.stringify(pg.errs), pg.errs.length === 0);
  const hint = await pg.evaluate(() => document.getElementById('hint').textContent);
  ok('sin error de dibujo: ' + hint, !/^error/.test(hint));
  await b.close(); web.close(); process.exit(0);
})();
