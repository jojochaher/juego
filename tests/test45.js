// extruir, parte 3 (v10.21, propuesta 7 de José): otra foto en una cara de la caja. En extruir, con una cara elegida,
// "foto" abre cámara / galería y esa imagen va en esa cara (recortada al centro con su forma). Se guarda al soltar con ✓
// (cancelar la descarta), cada cara en su registro '<id>~c<i>' del museo; "a todas" comparte la imagen; un bloque vacío
// extruido se llena cara por cara. La sala (v10.22) está en test46; acá solo que la opción aparece y una 'o' sin cg se ve como la misma.
// uso: node tests/test45.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const PASS = 'prueba caras fotos', H = crypto.createHash('sha256').update('juego:' + PASS).digest('hex');
const DB = 'http://localhost:8452';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8452);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8451);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const visto = (pg, sel) => pg.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && (!e.parentElement || getComputedStyle(e.parentElement).display !== 'none'); }, sel);
  const proj = (pg, p) => pg.evaluate(p => { const b = basis(), P = __game.pos; const v = [0, 1, 2].map(i => p[i] - P[i]); const d = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2]; const z = d(v, b.f); const [tx, ty] = tans(); return [(1 + d(v, b.r) / z / tx) / 2, (1 + d(v, b.u) / z / ty) / 2]; }, p);
  const px = (pg, x, y) => pg.evaluate(([x, y]) => new Promise(res => requestAnimationFrame(() => {
    const a = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); res([...a].slice(0, 3));
  })), [x, y]);
  const pxEn = async (pg, p) => { const [x, y] = await proj(pg, p); return px(pg, x, y); };
  const rojo = c => c[0] > 90 && c[0] > c[1] * 2 && c[0] > c[2] * 2, azul = c => c[2] > 90 && c[2] > c[0] * 2 && c[2] > c[1] * 1.5;
  const amarillo = c => c[0] > 90 && c[1] > 90 && c[2] < c[0] * 0.5 && c[2] < c[1] * 0.5;
  const gris = c => Math.abs(c[0] - c[2]) < 25 && c[0] > 25 && c[0] < 140;
  // la foto de la caja: mitad izquierda roja, derecha azul
  const IMG = () => { const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#e02010'; x.fillRect(0, 0, 64, 128); x.fillStyle = '#1040e0'; x.fillRect(64, 0, 64, 128); return c; };

  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] });
  let pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto('http://localhost:8451/?borrar'); await pg.goto('http://localhost:8451/'); await pg.waitForTimeout(300);
  // la foto que se elige para una cara: amarilla (alta, 60 x 120, para ver el recorte), con una franja negra arriba
  const AMARILLA = Buffer.from((await pg.evaluate(() => { const c = document.createElement('canvas'); c.width = 60; c.height = 120; const x = c.getContext('2d'); x.fillStyle = '#e8d020'; x.fillRect(0, 0, 60, 120); return c.toDataURL('image/png'); })).split(',')[1], 'base64');
  const elegir = async (q) => { const [fc] = await Promise.all([q.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null), q.tap('#caraFoto')]); if (!fc) return false; await fc.setFiles({ name: 'cara.png', mimeType: 'image/png', buffer: AMARILLA }); return true; };
  await pg.tap('#start'); await espera(pg, () => __game.camReady);
  while (await pg.evaluate(() => __game.grilla)) await pg.tap('#grilla');
  await pg.tap('#unequip'); await pg.waitForTimeout(300);
  await pg.evaluate(async (src) => {
    const img = eval(src)();
    await new Promise(res => { const o = { id: 'k1', c: [0, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, d: 1, t0: Date.now() }; addWork(o, img); img.toBlob(blob => store('readwrite', s => s.put({ ...o, blob })).then(res), 'image/jpeg', 0.95); });
    __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0);
  }, '(' + IMG.toString() + ')');
  await pg.waitForTimeout(300);
  ok('las letras: o (otra foto) vale', await pg.evaluate(() => ccValida('ommmm') === 'ommmm' && ccValida('meobc') === 'meobc' && ccValida('xmmmm') === undefined));
  ok('recorte al centro: una imagen alta en una cara ancha', await pg.evaluate(() => { const u = uvLlena(2, 0.5); const v = uvLlena(0.5, 2); return Math.abs(u[0]) < 1e-9 && Math.abs(u[1] - 0.375) < 1e-9 && Math.abs(u[3] - 0.625) < 1e-9 && Math.abs(v[0] - 0.375) < 1e-9 && Math.abs(v[2] - 0.625) < 1e-9 && v[1] === 0; }));
  const vp = pg.viewportSize();
  await pg.touchscreen.tap(vp.width / 2, vp.height / 2); await pg.waitForTimeout(1200);
  ok('agarré la caja', (await pg.evaluate(() => __game.held && __game.held.work.id)) === 'k1');
  await pg.tap('#ajustar'); await pg.tap('#modes [data-m="extruir"]'); await pg.waitForTimeout(150);
  await pg.evaluate(() => { const L = __game.held.L; L.w = L.h = 0.5; L.d = 0.5; setDist(L, 1.2); spinBy(L, 0.75, 0); }); await pg.waitForTimeout(200);
  const lado = await pg.evaluate(() => {
    const p = heldPose(basis()), cs = cajaCaras(p), P = __game.pos;
    for (const i of [2, 3]) { const f = cs[i], n = cross(f.r, f.u), v = [0, 1, 2].map(k => P[k] - f.c[k]); if (n[0] * v[0] + n[1] * v[1] + n[2] * v[2] > 0.05) return i; }
    return 0;
  });
  ok('girada se ve un costado (' + lado + ')', !!lado);
  // dónde se ve la cara i en la pantalla (lo que toca el dedo: caraEn), cerca de su centro
  const enCara = (i) => pg.evaluate(i => {
    const p = __game.held ? heldPose(basis()) : previewPose(basis()), f = cajaCaras(p)[i];
    let best = null, bd = Infinity;
    for (let y = H * 0.2; y < H * 0.8; y += 6) for (let x = 4; x < W - 4; x += 6) {
      if (caraEn(x, y) !== i) continue;
      const d = rayoEn(x, y), m = cross(f.r, f.u), t = dot(sub(f.c, __game.pos), m) / dot(d, m), q = sub(add(__game.pos, mul(d, t)), f.c);
      const e = len(q); if (e < bd) { bd = e; best = [x, y]; }
    }
    return best;
  }, i);
  const pxCara = async (i) => { const q = await enCara(i); return q ? px(pg, q[0] / vp.width, 1 - q[1] / vp.height) : [0, 0, 0]; };
  const centro = await enCara(lado);
  await pg.touchscreen.tap(...(centro || [0, 0])); await pg.waitForTimeout(200);
  ok('el costado elegido', (await pg.evaluate(() => caraSel)) === lado);
  ok('la opción "foto" está', await visto(pg, '#caraFoto'));
  ok('las opciones (con foto) entran en la pantalla', await pg.evaluate(() => [...document.querySelectorAll('#caraOps .pill')].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top > 0; })));
  ok('y no tapan los modos', await pg.evaluate(() => { const a = document.getElementById('caraOps').getBoundingClientRect(), m = document.querySelector('#modes [data-m="extruir"]').getBoundingClientRect(); return a.bottom <= m.top + 1; }));
  const antes = await pxCara(lado);
  ok('antes, el costado lleva la misma (' + antes + ')', rojo(antes) || azul(antes));
  ok('"foto" abre el selector de archivo', await elegir(pg));
  ok('la cara queda con otra foto (en la mano)', await espera(pg, l => __game.held && __game.held.L.cc && __game.held.L.cc[l - 1] === 'o' && !!ciVer(l), lado, 4000));
  ok('"foto" queda marcada', await pg.evaluate(() => document.getElementById('caraFoto').classList.contains('on')));
  await pg.waitForTimeout(150);
  let c = await pxCara(lado);
  ok('se ve amarilla en la mano (' + c + ')', amarillo(c));
  ok('la de adelante sigue siendo la foto', await pg.evaluate(() => __game.held.work.ci === undefined));
  await pg.screenshot({ path: out + 'v10.21_cara_foto_mano.png' });
  ok('el recorte de la cara llena la cara (alta en una cara cuadrada: el medio)', await pg.evaluate(l => { const f = cajaCaras(heldPose(basis()), ciMano())[l]; return f.img && Math.abs(f.uv[1] - 0.25) < 0.02 && Math.abs(f.uv[3] - 0.75) < 0.02 && f.uv[0] === 0; }, lado));
  // cancelar: se descarta
  await pg.evaluate(() => cancelHold()); await pg.waitForTimeout(100);
  ok('cancelar: la caja no tiene fotos en las caras', await pg.evaluate(() => { const w = __game.works.find(x => x.id === 'k1'); return !w.ci && !(w.cc || '').includes('o'); }));
  ok('cancelar: nada guardado', !(await pg.evaluate(l => store('readonly', s => s.get('k1~c' + l)), lado)));
  // otra vez, y soltar con ✓
  await pg.evaluate(() => { if (ajustando) setAjustar(false); pick(__game.works.find(w => w.id === 'k1')); }); await pg.waitForTimeout(1200);
  await pg.tap('#ajustar'); await pg.tap('#modes [data-m="extruir"]'); await pg.waitForTimeout(150);
  await pg.evaluate(() => { const L = __game.held.L; L.w = L.h = 0.5; L.d = 0.5; setDist(L, 1.2); spinBy(L, 0.75, 0); }); await pg.waitForTimeout(200);
  await pg.touchscreen.tap(...((await enCara(lado)) || [0, 0])); await pg.waitForTimeout(200);
  await elegir(pg);
  await espera(pg, l => __game.held && ciVer(l), lado, 4000);
  await pg.tap('#drop'); await pg.waitForTimeout(500);
  ok('soltada con ✓: la cara tiene su foto', await pg.evaluate(l => { const w = __game.works.find(x => x.id === 'k1'); return w.cc[l - 1] === 'o' && w.ci && w.ci[l] && w.caras[l].img === w.ci[l]; }, lado));
  ok('guardada en el museo (su registro)', await espera(pg, l => { if (!window.__q) { window.__q = 1; store('readonly', s => s.get('k1~c' + l)).then(r => { window.__r = r; window.__q = 0; }); } return window.__r && window.__r.cara instanceof Blob && window.__r.cara.size > 100 && window.__r.obra === 'k1'; }, lado, 4000));
  const reg = await pg.evaluate(() => store('readonly', s => s.get('k1')));
  ok('la pose también, como la entiende v10.20 (cc sin o: ' + reg.cc + ', co: ' + reg.co + ')', /^[mebc]{5}$/.test(reg.cc || 'mmmmm') && reg.co === 1 << (lado - 1));
  // puesta en el mundo
  const xLado = lado === 2 ? 0.5 : -0.5;
  const mirarCostado = () => pg.evaluate(x => { const w = __game.works.find(q => q.id === 'k1'); Object.assign(w, { c: [0, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, d: 1 }); setBuf(w); __game.pos[0] = x * 4; __game.pos[2] = -2.5; __game.look(x > 0 ? -90 : 90, 0); }, xLado);
  await mirarCostado(); await pg.waitForTimeout(250);
  c = await pxEn(pg, [xLado, 1.5, -2.5]);
  ok('puesta: el costado es amarillo (' + c + ')', amarillo(c));
  await pg.screenshot({ path: out + 'v10.21_cara_foto_puesta.png' });
  // al recargar
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForTimeout(1500);
  ok('al recargar la cara tiene su foto', await espera(pg, l => { const w = __game.works.find(x => x.id === 'k1'); return w && w.ci && w.ci[l] && w.caras[l].img; }, lado, 5000));
  if (await pg.evaluate(() => __game.camOn)) await pg.tap('#unequip');
  await mirarCostado(); await pg.waitForTimeout(250);
  c = await pxEn(pg, [xLado, 1.5, -2.5]);
  ok('y se ve amarilla (' + c + ')', amarillo(c));
  // a todas: la misma imagen en las 5, una sola textura
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); pick(__game.works.find(w => w.id === 'k1')); }); await pg.waitForTimeout(1200);
  await pg.tap('#ajustar'); await pg.tap('#modes [data-m="extruir"]'); await pg.waitForTimeout(150);
  await pg.evaluate(l => { caraSel = l; pintarCaras(); }, lado);
  ok('la cara cargada se marca "foto"', await pg.evaluate(() => document.getElementById('caraFoto').classList.contains('on')));
  await pg.tap('#caraTodas'); await pg.waitForTimeout(100);
  ok('"a todas": ' + await pg.evaluate(() => __game.held.L.cc), await pg.evaluate(() => __game.held.L.cc === 'ooooo' && [1, 2, 3, 4, 5].every(i => ciVer(i) === ciVer(1))));
  await pg.tap('#drop'); await pg.waitForTimeout(600);
  ok('soltada: las 5 caras con la foto, una textura', await pg.evaluate(() => { const w = __game.works.find(x => x.id === 'k1'); return w.cc === 'ooooo' && new Set(w.ci.filter(Boolean).map(e => e.tex)).size === 1 && w.ci.filter(Boolean).length === 5; }));
  ok('5 registros', await espera(pg, () => { if (!window.__q2) { window.__q2 = 1; store('readonly', s => s.getAllKeys()).then(k => { window.__k = k; window.__q2 = 0; }); } return window.__k && window.__k.filter(k => String(k).startsWith('k1~c')).length === 5; }, null, 4000));
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForTimeout(1500);
  ok('al recargar: comparten una textura', await espera(pg, () => { const w = __game.works.find(x => x.id === 'k1'); return w && w.ci && w.ci.filter(Boolean).length === 5 && new Set(w.ci.filter(Boolean).map(e => e.tex)).size === 1; }, null, 5000));
  if (await pg.evaluate(() => __game.camOn)) await pg.tap('#unequip');
  await pg.evaluate(() => { const w = __game.works.find(q => q.id === 'k1'); Object.assign(w, { c: [0, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, d: 1 }); setBuf(w); __game.pos[0] = 0; __game.pos[2] = -5; __game.look(180, 0); }); await pg.waitForTimeout(250);
  c = await pxEn(pg, [0, 1.5, -3]);
  ok('atrás también amarilla (' + c + ')', amarillo(c));
  // una cara vuelve a "la misma": su registro se borra
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); pick(__game.works.find(w => w.id === 'k1')); }); await pg.waitForTimeout(1200);
  await pg.evaluate(() => { cur().cc = 'moooo'; drop(); }); await pg.waitForTimeout(500);
  ok('atrás de nuevo la misma: sin su foto y sin su registro', await pg.evaluate(async () => { const w = __game.works.find(x => x.id === 'k1'); return !w.ci[1] && w.ci[2] && !(await store('readonly', s => s.get('k1~c1'))) && !!(await store('readonly', s => s.get('k1~c2'))); }));
  // una cara con foto cuya imagen todavía no cargó: si pasa a otra cosa, su registro igual se borra
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); const w = __game.works.find(x => x.id === 'k1'); ciBorrar([w.ci[3]]); w.ci[3] = null; setBuf(w); pick(w); }); await pg.waitForTimeout(1200);
  await pg.evaluate(() => { cur().cc = 'moemo'; drop(); }); await pg.waitForTimeout(500);
  ok('sin cargar y cambiada: su registro se borra; las otras quedan', await pg.evaluate(async () => !(await store('readonly', s => s.get('k1~c3'))) && !!(await store('readonly', s => s.get('k1~c2'))) && !!(await store('readonly', s => s.get('k1~c5')))));
  ok('guardada: cc ' + await pg.evaluate(async () => { const r = await store('readonly', s => s.get('k1')); return r.cc + ' co ' + r.co; }), await pg.evaluate(async () => { const r = await store('readonly', s => s.get('k1')); return r.cc === 'mmemm' && r.co === (2 | 16) && ccConFotos(r.cc, r.co) === 'moemo'; }));
  // un bloque vacío extruido, llenado cara por cara
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 3; __game.look(180, 0); __game.previewBloque.d = 0.5; __game.previewBloque.cc = undefined; setBloque(true); }); await pg.waitForTimeout(200);
  await pg.tap('#shoot'); await pg.waitForTimeout(300);
  const vid = await pg.evaluate(() => { const w = __game.works[__game.works.length - 1]; return w.vacio && w.d === 0.5 ? w.id : null; });
  ok('puse un bloque vacío extruido', !!vid);
  await pg.evaluate(id => { setBloque(false); pick(__game.works.find(w => w.id === id)); }, vid); await pg.waitForTimeout(1200);
  await pg.tap('#ajustar'); await pg.tap('#modes [data-m="extruir"]'); await pg.waitForTimeout(150);
  await pg.evaluate(() => { const L = __game.held.L; setDist(L, 1.4); spinBy(L, 0.75, 0); }); await pg.waitForTimeout(200);
  const lv = await pg.evaluate(() => { const p = heldPose(basis()), cs = cajaCaras(p), P = __game.pos; for (const i of [2, 3]) { const f = cs[i], n = cross(f.r, f.u), v = [0, 1, 2].map(k => P[k] - f.c[k]); if (n[0] * v[0] + n[1] * v[1] + n[2] * v[2] > 0.05) return i; } return 0; });
  await pg.touchscreen.tap(...((await enCara(lv)) || [0, 0])); await pg.waitForTimeout(200);
  ok('bloque vacío: se elige un costado y está "foto"', (await pg.evaluate(() => caraSel)) === lv && await visto(pg, '#caraFoto'));
  await elegir(pg);
  await espera(pg, l => __game.held && ciVer(l), lv, 4000);
  await pg.evaluate(() => { const w = __game.held.work; w.c = [0, -60, 0]; setBuf(w); });   // el fantasma de donde estaba, lejos (si no, tapa a medias)
  await pg.waitForTimeout(150);
  c = await pxCara(lv); const fr = await pxCara(0); await pg.screenshot({ path: out + 'v10.21_bloque_cara.png' });
  ok('bloque vacío: el costado amarillo (' + c + ') y adelante sigue vacío (' + fr + ')', amarillo(c) && gris(fr));
  await pg.tap('#drop'); await pg.waitForTimeout(500);
  ok('bloque vacío soltado: sigue vacío, con la foto en la cara', await pg.evaluate(([id, l]) => { const w = __game.works.find(x => x.id === id); return w.vacio && w.cc[l - 1] === 'o' && w.ci[l]; }, [vid, lv]));
  ok('y guardada', await espera(pg, ([id, l]) => { if (!window.__q3) { window.__q3 = 1; store('readonly', s => s.get(id + '~c' + l)).then(r => { window.__r3 = r; window.__q3 = 0; }); } return window.__r3 && window.__r3.cara instanceof Blob; }, [vid, lv], 4000));
  // borrarla borra sus caras
  await pg.evaluate(id => pick(__game.works.find(w => w.id === id)), vid); await pg.waitForTimeout(1200);
  await pg.tap('#trash'); await pg.waitForTimeout(400);
  ok('borrada: sin registros de sus caras', await pg.evaluate(async id => { const k = await store('readonly', s => s.getAllKeys()); return !k.some(x => String(x).startsWith(id)); }, vid));
  // la vista previa de la cámara no ofrece "foto"
  await pg.tap('#equip'); await espera(pg, () => __game.camReady && __game.camOn, null, 5000);
  await pg.evaluate(() => { const L = __game.preview; L.d = 0.4; L.w = 0.5; L.h = 0.4; setDist(L, 1.2); spinBy(L, 0.75, 0); caraSel = 2; if (!ajustando) setAjustar(true); setMode('extruir'); caraSel = 2; pintarCaras(); });
  ok('la vista previa: sin "foto"', await visto(pg, '#caraOps') && !(await visto(pg, '#caraFoto')));
  ok('museo: sin errores de dibujo', !(await pg.textContent('#hint')).includes('error'));
  ok('museo: sin errores de JS ' + pg.errs, pg.errs.length === 0);
  await ctx.close();

  // ---------- sala (lo demás, en test46) ----------
  const URL = 'http://localhost:8451/?db=' + DB;
  const mk = async () => { const c = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await c.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 }); return pg; };
  const A = await mk(); await A.tap('#unequip'); await A.tap('#salaBtn'); await A.fill('#salaPass', PASS); await A.tap('#salaEntrar');
  await espera(A, () => __game.sala.active && __game.sala.estadoVisto, null, 8000);
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  await A.tap('#equip'); await espera(A, () => __game.camReady && __game.camOn, null, 5000); await A.waitForTimeout(300);
  await A.evaluate(() => { __game.preview.d = 0.5; __game.preview.cc = undefined; });
  await A.tap('#shoot'); await A.waitForTimeout(200); await A.tap('#unequip');
  const f1 = await A.evaluate(() => __game.works[__game.works.length - 1].id);
  await espera(A, id => __game.sala.idsSala && __game.sala.idsSala.has(id), f1, 5000);
  await A.evaluate(id => pick(__game.works.find(w => w.id === id)), f1); await A.waitForTimeout(1200);
  await A.evaluate(() => { if (!ajustando) setAjustar(true); setMode('extruir'); caraSel = 2; pintarCaras(); });
  ok('sala: con una cara elegida, está "foto" (v10.22)', await visto(A, '#caraOps') && await visto(A, '#caraFoto'));
  await A.evaluate(() => cancelHold());
  const dd = (((await (await fetch(DB + '/__dump')).json()) || {}).salas || {})[H] || {};
  const pose = dd.poses && dd.poses[f1];
  ok('sala: la pose está en la base', !!pose);
  if (pose) {
    await fetch(DB + '/salas/' + H + '/poses/' + f1 + '.json', { method: 'PUT', body: JSON.stringify({ ...pose, cc: 'oommm' }) });
    ok('sala: una "o" que llega sin cg se ve como la misma', await espera(A, id => { const w = __game.works.find(x => x.id === id); return w && !w.cc && w.caras && w.caras[1].t === 'm' && !w.caras[1].img; }, f1, 5000));
  }
  ok('sala: sin errores de dibujo', !(await A.textContent('#hint')).includes('error'));
  ok('sala: sin errores de JS ' + A.errs, A.errs.length === 0);
  console.log(fallas ? 'FALLAS: ' + fallas : 'todo OK');
  await b.close(); web.close(); dbSrv.close && dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
