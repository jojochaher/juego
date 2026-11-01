// fotos con datos rotos en el museo guardado: no tienen que romper la física ni la pantalla
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], puerto = 8155 + (+process.argv[3] || 0);
(async () => {
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(puerto);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto(`http://localhost:${puerto}/?borrar`); await pg.waitForTimeout(800);
  // meter fotos en el guardado: una sana, una sin tamaño, una con ejes paralelos, todas cerca del origen
  await pg.evaluate(async () => {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 48; cv.getContext('2d').fillStyle = '#c84'; cv.getContext('2d').fillRect(0, 0, 64, 48);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg'));
    const recs = [
      { id: 'sana', c: [0.5, 1.5, -1], r: [1, 0, 0], u: [0, 1, 0], w: 0.5, h: 0.4, blob },
      { id: 'sin-tam', c: [0, 1.5, -0.3], r: [1, 0, 0], u: [0, 1, 0], blob },
      { id: 'paralela', c: [0.1, 1.2, 0.2], r: [1, 0, 0], u: [1, 0, 0], w: 0.5, h: 0.4, blob },
    ];
    await store('readwrite', s => { for (const o of recs) s.put(o); });
  });
  await pg.reload(); await pg.waitForTimeout(400); await pg.tap('#start'); await pg.waitForTimeout(2500);
  await pg.evaluate(() => { __game.joy.y = -0.5; }); await pg.waitForTimeout(800); await pg.evaluate(() => { __game.joy.y = 0; }); await pg.waitForTimeout(3500);
  const st = await pg.evaluate(() => ({ pos: __game.pos.slice(), n: __game.works.length, log: diagLog.slice(-14).join(' | ') }));
  ok('pos sigue siendo un número: ' + st.pos.map(v => v.toFixed(2)), st.pos.every(Number.isFinite));
  ok('cargó las 3', st.n === 3);
  ok('no anota "no se ve el piso"', !/no se ve el piso/.test(st.log));
  ok('anota las fotos rotas', /foto rota/.test(st.log));
  console.log('   ', st.log);
  await pg.screenshot({ path: require('path').join(__dirname, 'out', 'v92_rotas.png') });
  console.log('errores', pg.errs);
  await b.close(); web.close(); process.exit(0);
})();
