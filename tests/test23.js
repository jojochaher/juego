// indexedDB trabado (bug de iOS al reabrir la app): igual se dibuja
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = require('path').join(__dirname, 'out') + '/';
(async () => {
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8154);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ok = (n, c) => console.log((c ? 'OK   ' : 'FAIL ') + n);
  const run = async (trabar, despertar) => {
    const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] });
    if (trabar) await ctx.addInitScript(despertar => {
      const orig = indexedDB.open.bind(indexedDB);
      indexedDB.open = (...a) => {   // devuelve un pedido que no responde (como iOS); si "despertar", responde cuando lo pinchan
        const fake = {}; let real = null;
        const conectar = () => { if (real) return; real = orig(...a); real.onupgradeneeded = e => fake.onupgradeneeded && (fake.result = real.result, fake.onupgradeneeded(e)); real.onsuccess = e => { fake.result = real.result; fake.onsuccess && fake.onsuccess(e); }; real.onerror = e => fake.onerror && fake.onerror(e); };
        if (despertar) { const d = indexedDB.databases.bind(indexedDB); let n = 0; indexedDB.databases = () => { if (++n >= 3) conectar(); return d(); }; }
        return fake;
      };
    }, despertar);
    const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto('http://localhost:8154/'); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForTimeout(1500);
    // ¿hay puntos del piso? (algún píxel más claro que el fondo en la mitad de abajo)
    const hayPiso = await pg.evaluate(() => new Promise(res => requestAnimationFrame(() => {
      const w = canvas.width, h = canvas.height, px = new Uint8Array(w * 4);
      let claros = 0; for (let y = Math.floor(h * 0.6); y < h * 0.95; y += 7) { gl.readPixels(0, y, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); for (let i = 0; i < px.length; i += 4) if (px[i] > 40) claros++; }
      res(claros);
    })));
    await pg.waitForTimeout(6500);
    const log = await pg.evaluate(() => diagLog.slice(-12).join(' | '));
    return { pg, ctx, hayPiso, log };
  };
  let r = await run(true, false);
  ok('con indexedDB trabado igual se dibuja el piso (' + r.hayPiso + ' píxeles)', r.hayPiso > 20);
  ok('el registro lo anota', /tarda en abrir/.test(r.log) && /no responde/.test(r.log));
  ok('y se puede sacar una foto', await (async () => { await r.pg.tap('#equip').catch(() => {}); await r.pg.waitForTimeout(1500); await r.pg.tap('#shoot'); await r.pg.waitForTimeout(500); return r.pg.evaluate(() => __game.works.length === 1); })());
  console.log('   ', r.log); await r.ctx.close();
  r = await run(true, true);
  ok('pinchándolo, abre', /abrió después de/.test(r.log) && /fotos cargadas/.test(r.log));
  console.log('   ', r.log); await r.ctx.close();
  r = await run(false);
  ok('normal: dibuja y carga', r.hayPiso > 20 && /fotos cargadas/.test(r.log) && /dibujando ok/.test(r.log));
  console.log('errores', r.pg.errs);
  await b.close(); web.close(); process.exit(0);
})();
