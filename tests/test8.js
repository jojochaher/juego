const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = require('path').join(__dirname, 'out') + '/';
const srv = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8135);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] }); const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type()==='error' && errs.push(m.text()));
  const G = (f, a) => pg.evaluate(f, a);
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const cdp = await ctx.newCDPSession(pg);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p,i)=>({x:p[0],y:p[1],id:i})) });
  const vw = pg.viewportSize(), cx = vw.width/2, cy = vw.height/2;
  const drag1 = async (x0,y0,x1,y1,n=8) => { await T('touchStart',[[x0,y0]]); for(let i=1;i<=n;i++){ await T('touchMove',[[x0+(x1-x0)*i/n, y0+(y1-y0)*i/n]]); await pg.waitForTimeout(16);} await T('touchEnd',[]); };
  const two = async (a0, d0, a1, d1, n=8) => { const p = (a,d)=>[[cx-d*Math.cos(a), cy-d*Math.sin(a)],[cx+d*Math.cos(a), cy+d*Math.sin(a)]]; await T('touchStart', p(a0,d0)); for(let i=1;i<=n;i++){ await T('touchMove', p(a0+(a1-a0)*i/n, d0+(d1-d0)*i/n)); await pg.waitForTimeout(16);} await T('touchEnd',[]); };
  // helper: proyectar a pantalla las esquinas de lo que está en la mano
  await pg.addInitScript(() => { window.__proj = (p) => { const b = basis(); const v = [p[0]-__game.pos[0], p[1]-__game.pos[1], p[2]-__game.pos[2]]; const z = v[0]*b.f[0]+v[1]*b.f[1]+v[2]*b.f[2]; const tx = Math.tan(25*Math.PI/180), ty = tx*innerHeight/innerWidth; return [ (1 + (v[0]*b.r[0]+v[1]*b.r[1]+v[2]*b.r[2])/z/tx)*innerWidth/2, (1 - (v[0]*b.u[0]+v[1]*b.u[1]+v[2]*b.u[2])/z/ty)*innerHeight/2 ]; };
    window.__heldScreen = () => { const L = __game.held ? __game.held.L : __game.preview; const P = worldPose(basis(), L); const c = (sx,sy)=>__proj([P.c[0]+P.r[0]*P.w/2*sx+P.u[0]*P.h/2*sy, P.c[1]+P.r[1]*P.w/2*sx+P.u[1]*P.h/2*sy, P.c[2]+P.r[2]*P.w/2*sx+P.u[2]*P.h/2*sy]); return { tl: c(-1,1), tr: c(1,1), bl: c(-1,-1), br: c(1,-1), P }; }; });
  await pg.goto('http://localhost:8135/?borrar'); await pg.waitForTimeout(400);
  await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady); await pg.waitForTimeout(300);
  ok('barra de modos visible, mover activo', await pg.isVisible('#modes') && await G(() => __game.mode) === 'mover');
  const s0 = await G(() => __heldScreen());
  // marco de grosor constante: comparar grosor en px a distinta distancia (se mide en la captura)
  // mover: agrandar y girar en sentido horario
  const w0 = await G(() => __game.preview.w);
  await two(0, 60, 0.5, 100);
  const s1 = await G(() => __heldScreen());
  const ang = s => Math.atan2(s.tr[1]-s.tl[1], s.tr[0]-s.tl[0]);
  ok(`mover: pellizco agranda (${w0.toFixed(2)} -> ${(await G(() => __game.preview.w)).toFixed(2)})`, await G(() => __game.preview.w) > w0*1.4);
  ok(`mover: giro horario de dedos = foto gira horario (${(ang(s0)*57).toFixed(0)}° -> ${(ang(s1)*57).toFixed(0)}°)`, ang(s1) > ang(s0) + 0.3);
  // barra de distancia: alejar achica en pantalla, el tamaño real no cambia
  const pd0 = await G(() => ({ w: __game.preview.w, d: Math.hypot(...__game.preview.c), sw: __heldScreen().tr[0] - __heldScreen().tl[0] }));
  const dbx = await pg.locator('#dist').boundingBox();
  await pg.mouse.move(dbx.x+22, dbx.y+dbx.height*0.6); await pg.mouse.down(); await pg.mouse.move(dbx.x+22, dbx.y+dbx.height*0.25, {steps:5}); await pg.mouse.up();
  const pd1 = await G(() => ({ w: __game.preview.w, d: Math.hypot(...__game.preview.c), sw: __heldScreen().tr[0] - __heldScreen().tl[0] }));
  ok(`barra: alejar achica en pantalla (${pd0.sw.toFixed(0)}px -> ${pd1.sw.toFixed(0)}px), tamaño real igual`, pd1.d > pd0.d * 1.5 && Math.abs(pd1.w - pd0.w) < 1e-9 && pd1.sw < pd0.sw * 0.7);
  await pg.tap('#reset'); await pg.waitForTimeout(100);
  ok('↺ restablece la vista previa', Math.abs(await G(() => __game.preview.w) - w0) < 1e-6);
  // recortar la vista previa: arrastrar el borde derecho hacia la izquierda
  await pg.tap('[data-m="recortar"]');
  let s = await G(() => __heldScreen());
  const rightX = s.tr[0], midY = (s.tr[1]+s.br[1])/2, leftX0 = s.tl[0];
  await drag1(rightX - 4, midY, rightX - 80, midY);
  s = await G(() => __heldScreen());
  const pv = await G(() => __game.preview);
  ok(`recortar: borde derecho se mueve con el dedo (${rightX.toFixed(0)} -> ${s.tr[0].toFixed(0)}), izquierdo quieto (${leftX0.toFixed(0)} -> ${s.tl[0].toFixed(0)}), uv ${pv.uv.map(v=>v.toFixed(2))}`, Math.abs(s.tr[0] - (rightX-80+4)) < 6 && Math.abs(s.tl[0]-leftX0) < 1 && pv.uv[2] < 0.9);
  // esquina arriba-izquierda hacia adentro
  await drag1(s.tl[0]+3, s.tl[1]+3, s.tl[0]+50, s.tl[1]+60);
  const pv2 = await G(() => __game.preview);
  ok(`recortar: esquina mueve dos bordes (uv ${pv2.uv.map(v=>v.toFixed(2))})`, pv2.uv[0] > 0.05 && pv2.uv[1] > 0.05);
  // mirar fuera del borde sigue mirando
  const y0 = await G(() => heading(basis().f));
  await drag1(40, cy+200, 140, cy+200);
  ok('recortar: arrastrar lejos de la foto sigue mirando', Math.abs(await G(() => heading(basis().f)) - y0) > 0.2);
  await G(() => __game.look(0,0));
  // encuadre: zoom y pan
  await pg.tap('#reset'); await pg.tap('[data-m="encuadre"]');
  await two(0, 50, 0, 120);
  const z = await G(() => __game.preview.uv);
  ok(`encuadre: pellizco hace zoom adentro (uv ${z.map(v=>v.toFixed(2))})`, (z[2]-z[0]) < 0.6 && Math.abs((z[0]+z[2])/2 - 0.5) < 0.01);
  await drag1(cx, cy, cx + 60, cy);
  const z2 = await G(() => __game.preview.uv);
  ok(`encuadre: arrastrar a la derecha mueve la imagen a la derecha (u0 ${z[0].toFixed(3)} -> ${z2[0].toFixed(3)})`, z2[0] < z[0] - 0.02);
  // girar: arrastrar a la derecha => el borde derecho se aleja (se ve más chico)
  await pg.tap('#reset'); await pg.tap('[data-m="girar"]');
  await drag1(cx, cy, cx + 80, cy);
  s = await G(() => __heldScreen());
  const hl = s.bl[1]-s.tl[1], hr = s.br[1]-s.tr[1];
  ok(`girar: arrastrar a la derecha aleja el lado derecho (alto izq ${hl.toFixed(0)} der ${hr.toFixed(0)})`, hr < hl - 5);
  await pg.tap('#reset'); await pg.tap('[data-m="mover"]');

  // sacar con recorte y agarrar sin salto
  await pg.tap('[data-m="recortar"]');
  s = await G(() => __heldScreen());
  await drag1(s.tr[0]-4, (s.tr[1]+s.br[1])/2, s.tr[0]-60, (s.tr[1]+s.br[1])/2);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  const wk = await G(() => ({ uv: __game.works[0].uv, c: __game.works[0].c }));
  ok(`la foto sacada guarda el recorte (uv ${wk.uv.map(v=>v.toFixed(2))})`, wk.uv[2] < 0.95);
  await pg.tap('#reset'); await pg.tap('[data-m="mover"]');
  await G(() => __game.look(10, 5)); await pg.waitForTimeout(100);
  const tgt = await G(() => __proj(__game.works[0].c));
  console.log('     la foto estaba en pantalla en', tgt.map(v=>v.toFixed(0)));
  await pg.touchscreen.tap(tgt[0], tgt[1]); await pg.waitForTimeout(1200);
  const hp = await G(() => ({ held: !!__game.held, aim: !!__game.held.aim, c: worldPose(basis(), __game.held.L).c, scr: __proj(__game.works[0].c) }));
  ok(`agarrar: la cámara gira hasta centrarla (ahora en ${hp.scr.map(v=>v.toFixed(0))}) y la foto no se mueve`, hp.held && !hp.aim && Math.hypot(hp.c[0]-wk.c[0], hp.c[1]-wk.c[1], hp.c[2]-wk.c[2]) < 1e-6 && Math.abs(hp.scr[0]-cx) < 3 && Math.abs(hp.scr[1]-cy) < 3);
  await G(() => __game.look(-40, 0)); await pg.waitForTimeout(150);
  await pg.screenshot({ path: out + 'v5_fantasma.png' });
  // cancelar
  await pg.tap('#cancel'); await pg.waitForTimeout(100);
  ok('cancelar no cambia nada', await G(c => { const w = __game.works[0]; return !__game.held && Math.hypot(w.c[0]-c[0], w.c[1]-c[1], w.c[2]-c[2]) < 1e-9; }, wk.c));
  // agarrar, encuadre, soltar, recargar
  await G(() => __game.look(10, 5)); await pg.waitForTimeout(100);
  await pg.touchscreen.tap(tgt[0], tgt[1]); await pg.waitForTimeout(1200);
  await pg.tap('[data-m="encuadre"]'); await two(0, 50, 0, 100);
  const uvE = await G(() => __game.held.L.uv);
  await pg.tap('#drop'); await pg.waitForTimeout(500);
  await pg.reload(); await pg.waitForTimeout(800);
  const uvR = await G(() => __game.works[0] && __game.works[0].uv);
  ok(`al recargar mantiene encuadre (uv ${uvR && uvR.map(v=>v.toFixed(2))})`, uvR && Math.abs(uvR[0]-uvE[0]) < 1e-6 && Math.abs(uvR[2]-uvE[2]) < 1e-6);
  // fov
  const f0 = await G(() => __game.fov);
  await pg.tap('#start').catch(()=>{}); await pg.waitForTimeout(300);
  await pg.tap('#fov'); const f1 = await G(() => __game.fov);
  await pg.reload(); await pg.waitForTimeout(500);
  ok(`fov cambia (${f0} -> ${f1}) y se guarda (${await G(() => __game.fov)})`, f1 !== f0 && await G(() => __game.fov) === f1);
  await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady); await pg.waitForTimeout(300);
  await pg.screenshot({ path: out + 'v51.png' });
  console.log('errors', errs);
  await b.close(); srv.close();
})();
