// v10.4: recortar agarra un solo borde (o dos en una esquina), nunca dos opuestos; con la grilla, el borde que se ve
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
(async () => {
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8168);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.addInitScript(() => {
    window.__proj = (p) => { const b = basis(); const v = [p[0]-__game.pos[0], p[1]-__game.pos[1], p[2]-__game.pos[2]]; const z = v[0]*b.f[0]+v[1]*b.f[1]+v[2]*b.f[2]; const [tx, ty] = tans(); return [ (1 + (v[0]*b.r[0]+v[1]*b.r[1]+v[2]*b.r[2])/z/tx)*innerWidth/2, (1 - (v[0]*b.u[0]+v[1]*b.u[1]+v[2]*b.u[2])/z/ty)*innerHeight/2 ]; };
    // lo que se ve en la mano (con la grilla, alineado), en px
    window.__visto = () => { const P = previewPose(basis()); const c = (sx,sy)=>__proj([0,1,2].map(i => P.c[i]+P.r[i]*P.w/2*sx+P.u[i]*P.h/2*sy)); return { tl: c(-1,1), tr: c(1,1), bl: c(-1,-1), br: c(1,-1), w: P.w, h: P.h }; };
  });
  const cdp = await ctx.newCDPSession(pg);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p,i)=>({x:p[0],y:p[1],id:i})) });
  await pg.goto('http://localhost:8168/?borrar'); await pg.goto('http://localhost:8168/'); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady);
  await pg.waitForTimeout(300);
  if (await pg.evaluate(() => __game.grilla)) await pg.tap('#grilla');
  await pg.tap('#ajustar'); await pg.tap('[data-m="recortar"]');
  ok('modo recortar', await pg.evaluate(() => __game.mode === 'recortar'));

  // 1. foto chiquita en pantalla (los dos lados quedan cerca del dedo): agarra uno solo
  await pg.evaluate(() => { const L = __game.preview; L.c = L.c.map(v => v * 5); });
  await pg.waitForTimeout(100);
  let v = await pg.evaluate(() => __visto());
  const anchoPx = v.tr[0] - v.tl[0];
  const mx = (v.tl[0] + v.tr[0]) / 2 + anchoPx * 0.2, my = (v.tr[1] + v.br[1]) / 2;
  const e1 = await pg.evaluate(([x, y]) => edgesAt(__game.preview, x, y), [mx, my]);
  ok(`foto de ${anchoPx.toFixed(0)} px: agarra un solo borde ${JSON.stringify(e1)}`, e1 && e1.r && !e1.l && !e1.t && !e1.b);
  // justo en el medio de cada borde: ese solo (en una foto chica, todo queda cerca de la esquina)
  const medios = await pg.evaluate(v => { const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L = __game.preview;
    return [m(v.tl, v.bl), m(v.tr, v.br), m(v.tl, v.tr), m(v.bl, v.br)].map(([x, y]) => edgesAt(L, x, y)); }, v);
  ok('en el medio de cada borde agarra solo ese ' + JSON.stringify(medios), ['l', 'r', 't', 'b'].every((k, i) => medios[i] && medios[i][k] && Object.values(medios[i]).filter(Boolean).length === 1));
  const antes = await pg.evaluate(() => ({ c: __game.preview.c.slice(), w: __game.preview.w, uv: __game.preview.uv.slice() }));
  await T('touchStart', [[mx, my]]);
  for (let i = 1; i <= 6; i++) { await T('touchMove', [[mx - i * 3, my + i * 2]]); await pg.waitForTimeout(16); }
  const activo = await pg.evaluate(() => recorteActivo());
  await pg.screenshot({ path: out + 'v104_recorte_chica.png' });
  await T('touchEnd', []);
  const desp = await pg.evaluate(() => ({ c: __game.preview.c.slice(), w: __game.preview.w, uv: __game.preview.uv.slice() }));
  ok('mientras recorta, se sabe qué borde (para pintarlo) ' + JSON.stringify(activo), activo && activo.r && !activo.l);
  ok(`solo se mueve el derecho: uv ${antes.uv.map(x => x.toFixed(2))} -> ${desp.uv.map(x => x.toFixed(2))}`, desp.uv[0] === antes.uv[0] && desp.uv[1] === antes.uv[1] && desp.uv[3] === antes.uv[3] && desp.uv[2] < antes.uv[2] && desp.w > 0.1 * antes.w);
  ok('al soltar ya no hay borde activo', !(await pg.evaluate(() => recorteActivo())));
  // esquina: dos bordes vecinos, no opuestos
  await pg.evaluate(() => { __game.preview.uv = [0, 0, 1, 1]; resetHeld(); const L = __game.preview; L.c = L.c.map(x => x * 2); });
  v = await pg.evaluate(() => __visto());
  const e2 = await pg.evaluate(([x, y]) => edgesAt(__game.preview, x, y), [v.tl[0] + 2, v.tl[1] + 2]);
  ok('en la esquina: arriba e izquierda ' + JSON.stringify(e2), e2 && e2.l && e2.t && !e2.r && !e2.b);
  // 2. con la grilla: el borde que se ve (alineado, 1 m) es el que se agarra
  await pg.evaluate(() => { resetHeld(); const L = __game.preview; L.w = 0.6; L.h = 0.45; L.c = L.c.map(x => x * 2.6); });
  await pg.tap('#grilla'); await pg.waitForTimeout(200);
  v = await pg.evaluate(() => __visto());
  ok(`con grilla se ve de ${v.w} m (${v.tl[0].toFixed(0)}-${v.tr[0].toFixed(0)} px)`, Math.abs(v.w - 1) < 1e-9 && v.tr[0] < 400);
  const gx = v.tr[0] - 3, gy = (v.tr[1] + v.br[1]) / 2;
  const tlAntes = v.tl;
  await T('touchStart', [[gx, gy]]);
  for (let i = 1; i <= 8; i++) { await T('touchMove', [[gx - i * 8, gy]]); await pg.waitForTimeout(16); }
  const g = await pg.evaluate(() => ({ a: recorteActivo(), v: __visto() }));
  await pg.screenshot({ path: out + 'v104_recorte_grilla.png' });
  await T('touchEnd', []);
  ok('con grilla agarra el borde derecho que se ve ' + JSON.stringify(g.a), g.a && g.a.r && !g.a.l);
  ok(`mientras recorta, el borde sigue al dedo (${g.v.tr[0].toFixed(0)} vs ${(gx - 64 + 3).toFixed(0)}) y el izquierdo no se mueve (${tlAntes[0].toFixed(0)} -> ${g.v.tl[0].toFixed(0)})`, Math.abs(g.v.tr[0] - (gx - 64 + 3)) < 6 && Math.abs(g.v.tl[0] - tlAntes[0]) < 2);
  const fin = await pg.evaluate(() => ({ uv: __game.preview.uv, P: previewPose(basis()) }));
  ok(`al soltar queda recortada y alineada (uv ${fin.uv.map(x => x.toFixed(2))}, ${fin.P.w.toFixed(2)} x ${fin.P.h.toFixed(2)} m)`, fin.uv[2] < 0.95 && Math.abs(Math.max(fin.P.w, fin.P.h) - Math.round(Math.max(fin.P.w, fin.P.h))) < 1e-9);

  console.log('errores', pg.errs);
  await b.close(); web.close(); process.exit(0);
})();
