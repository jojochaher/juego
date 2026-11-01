// grilla
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = require('path').join(__dirname, 'out') + '/';
(async () => {
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8145);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto('http://localhost:8145/?borrar'); await pg.goto('http://localhost:8145/'); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady);
  // unidad: pose torcida
  const r = await pg.evaluate(() => {
    const g = __game, n = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
    const p = { c: [0.237, 1.43, -1.18], r: n([0.9, 0.15, 0.3]), u: n([-0.1, 0.95, 0.2]), w: 0.537, h: 0.4, uv: [0, 0, 1, 1] };
    const s = g.snapPose(p);
    const corner = s.c.map((v, i) => v - s.r[i] * s.w / 2 - s.u[i] * s.h / 2);
    const nn = [s.r[1]*s.u[2]-s.r[2]*s.u[1], s.r[2]*s.u[0]-s.r[0]*s.u[2], s.r[0]*s.u[1]-s.r[1]*s.u[0]];
    const n0 = [p.r[1]*p.u[2]-p.r[2]*p.u[1], p.r[2]*p.u[0]-p.r[0]*p.u[2], p.r[0]*p.u[1]-p.r[1]*p.u[0]];
    return { s, corner, frente: nn[0]*n0[0]+nn[1]*n0[1]+nn[2]*n0[2],
      flat: g.snapPose({ c: [0.31, 0.02, 0.44], r: [1, 0, 0.05], u: n([0.05, 0.02, -1]), w: 0.6, h: 0.45, uv: [0, 0, 1, 1] }) };
  });
  const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
  ok('de pie: u es vertical', near(r.s.u[1], 1));
  ok('mira en pasos de 90° (ejes x o z)', r.s.r.every(v => near(Math.abs(v), 0) || near(Math.abs(v), 1)));
  ok('ancho en metros enteros (mínimo 1) y proporción igual', near(r.s.w, 1) && near(r.s.h / r.s.w, 0.4 / 0.537, 1e-9));
  ok('esquina en la grilla de 1 m (x, y, z enteros)', r.corner.every(v => near(v, Math.round(v))));
  ok('no se da vuelta (mismo lado adelante)', r.frente > 0.5);
  ok('casi horizontal: queda acostada', near(Math.abs(r.flat.r[1]), 0) && near(Math.abs(r.flat.u[1]), 0));
  // en el juego: el botón aparece al editar
  ok('botón grilla visible con la cámara', await pg.isVisible('#grilla'));
  await pg.tap('#grilla');
  ok('grilla prendida', await pg.evaluate(() => __game.grilla && document.getElementById('grilla').classList.contains('on')));
  await pg.evaluate(() => __game.look(17, 9)); await pg.waitForTimeout(300);
  await pg.tap('#shoot'); await pg.waitForTimeout(600);
  const w = await pg.evaluate(() => { const w = __game.works[0]; return { c: w.c, r: w.r, u: w.u, w: w.w, h: w.h }; });
  const corner = w.c.map((v, i) => v - w.r[i] * w.w / 2 - w.u[i] * w.h / 2);
  ok('la foto sacada queda alineada', near(w.u[1], 1) && corner.every(v => near(v, Math.round(v))) && near(w.w, Math.round(w.w)) && w.w >= 1);
  await pg.screenshot({ path: out + 'v73_grilla.png' });
  // reload: se recuerda
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForTimeout(800);
  ok('se recuerda', await pg.evaluate(() => __game.grilla));
  console.log('errores', pg.errs);
  await b.close(); web.close(); process.exit(0);
})();
