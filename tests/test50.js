// desafío (v10.26, propuesta 10 de José): ☰ → desafío, una imagen generada (o una foto de la sala) para armar con fotos;
// "empezar acá" deja una marca; parado en ella se mide lo que entra en el cuadrado del medio y se guarda el mejor.
// Museo: generar (misma semilla = misma figura), empezar, medir (vacío ≈ 0, una copia ≈ 100, otra cosa poco), la marca se
// ve en el piso, alejarse, recargar, mirar desde la marca, la marca acá, con algo en la mano no mide, terminar, datos rotos.
// Sala: elegir una foto de la sala (no cuenta al medir), el otro recibe el aviso, se suma, se ven los porcentajes, ir a
// mirar, terminar, presencias rotas o de otro.
// uso: node tests/test50.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const PASS = 'prueba desafio', H = crypto.createHash('sha256').update('juego:' + PASS).digest('hex');
const DB = 'http://localhost:8502';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8502);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8501);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const espera = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const visto = (pg, sel) => pg.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; }, sel);
  const px = (pg, x, y) => pg.evaluate(([x, y]) => new Promise(res => requestAnimationFrame(() => {
    const a = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); res([...a].slice(0, 3));
  })), [x, y]);
  const proj = (pg, p) => pg.evaluate(p => { const b = basis(), P = __game.pos; const v = [0, 1, 2].map(i => p[i] - P[i]); const d = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2]; const z = d(v, b.f); const [tx, ty] = tans(); return [(1 + d(v, b.r) / z / tx) / 2, (1 + d(v, b.u) / z / ty) / 2]; }, p);
  const menu = async (pg, id) => { await pg.tap('#menuBtn'); await pg.waitForTimeout(150); await pg.tap(id); await pg.waitForTimeout(250); };
  const COLOR = col => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 64, 64); return c; };
  // una foto que llena justo el cuadrado del medio de la pantalla, a 2 m delante (mirando a -z)
  const llenar = (pg, id, src) => pg.evaluate(([id, src]) => {
    const t = Math.tan(FOVX / 2), P = __game.pos, s = 2 * 2 * t;
    const img = src === 'ref' ? (() => { const c = document.createElement('canvas'); c.width = c.height = 192; const x = c.getContext('2d'); const im = new Image(); im.src = des.ref.url; return new Promise(r => im.onload = () => { x.drawImage(im, 0, 0); r(c); }); })() : Promise.resolve(eval(src));
    return img.then(c => { addWork({ id, c: [P[0], P[1], P[2] - 2], r: [1, 0, 0], u: [0, 1, 0], w: s, h: s, t0: 1 }, c); return s; });
  }, [id, src]);
  const sacar = (pg, id) => pg.evaluate(id => { const i = __game.works.findIndex(w => w.id === id); if (i >= 0) __game.works.splice(i, 1); }, id);
  const medir = async pg => { await pg.waitForTimeout(1300); return pg.evaluate(() => des.s); };

  // ---------- museo ----------
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera'] });
  let pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
  await pg.goto('http://localhost:8501/?borrar'); await pg.goto('http://localhost:8501/'); await pg.waitForTimeout(300);
  await pg.evaluate(() => localStorage.removeItem('desafio'));
  await pg.tap('#start'); await espera(pg, () => __game.camReady);
  while (await pg.evaluate(() => __game.grilla)) await pg.tap('#grilla');
  await pg.tap('#unequip'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  ok('sin desafío no está la miniatura', !(await visto(pg, '#desRef')));
  ok('"desafío" está en ☰', await pg.evaluate(() => !!document.querySelector('#opciones #opcDesafio')));
  await menu(pg, '#opcDesafio');
  ok('abre la hoja con una imagen', await visto(pg, '#desHoja') && await pg.evaluate(() => document.getElementById('desImg').src.startsWith('data:image/')));
  ok('dice qué figura y qué colores', /armá .+\(.+\)/.test(await pg.textContent('#desTxt')));
  ok('sin "mirar desde la marca" todavía', !(await visto(pg, '#desJugando')) && await visto(pg, '#desElegir'));
  const k1 = await pg.evaluate(() => des.elegido), src1 = await pg.evaluate(() => document.getElementById('desImg').src);
  await pg.tap('#desOtra'); await pg.waitForTimeout(150);
  ok('"otra" cambia la imagen', await pg.evaluate(([k, s]) => des.elegido !== k && document.getElementById('desImg').src !== s, [k1, src1]));
  ok('la misma semilla da la misma figura', await pg.evaluate(() => desGenerar(12345).c.toDataURL() === desGenerar(12345).c.toDataURL() && desGenerar(12345).c.toDataURL() !== desGenerar(54321).c.toDataURL()));
  ok('las seis figuras salen y no tienen negro de fondo', await pg.evaluate(() => {
    const tipos = new Set();
    for (let s = 1; s < 200; s++) { const g = desGenerar(s); tipos.add(g.nombre.replace(/\d/, 'n')); const d = g.c.getContext('2d').getImageData(0, 0, 192, 192).data; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] < 60) return false; }
    return tipos.size === 6;
  }));
  await pg.evaluate(() => { des.elegido = 'g1:777'; desPintar(); });
  await pg.tap('#desEmpezar'); await pg.waitForTimeout(300);
  ok('empezar: cierra la hoja y avisa', !(await visto(pg, '#desHoja')) && (await pg.textContent('#hint')).includes('la marca quedó en el piso'));
  ok('queda guardado', await pg.evaluate(() => { const o = (JSON.parse(localStorage.getItem('desafio')).acts || {}).museo; return o && o.k === 'g1:777' && o.ctx === 'museo' && Math.abs(o.p[0]) < 0.01 && o.f[2] < -0.9; }));
  ok('la miniatura arriba a la derecha', await visto(pg, '#desRef'));
  ok('parado en la marca: el cuadrado', await visto(pg, '#desMarco') && await pg.evaluate(() => Math.abs(parseFloat(document.getElementById('desMarco').style.width) - Math.min(innerWidth, innerHeight)) < 2));
  let s = await medir(pg);
  ok('con el museo vacío: casi 0 (' + s + ')', s != null && s <= 12);
  ok('el % en vivo en la miniatura', /^\d+%$/.test(await pg.textContent('#desRefPct')) && await pg.evaluate(() => document.getElementById('desRefPct').classList.contains('vivo')));
  await llenar(pg, 'copia', 'ref');
  s = await medir(pg);
  ok('una copia de la imagen delante: casi 100 (' + s + ')', s >= 90);
  ok('el mejor se guarda (con para dónde miraba)', await espera(pg, () => { const o = (JSON.parse(localStorage.getItem('desafio')).acts || {}).museo; return o && o.s >= 90; }, null, 4000));
  await pg.screenshot({ path: out + 'v10.26_copia.png' });
  await sacar(pg, 'copia');
  await llenar(pg, 'gris', '(' + COLOR.toString() + ')("#7f7f80")');
  const sg = await medir(pg);
  ok('una foto gris: mucho menos (' + sg + ')', sg < 50);
  // la mitad de arriba bien y la de abajo no: en el medio
  await sacar(pg, 'gris');
  const mitad = await pg.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 192; const x = c.getContext('2d'); const im = new Image(); im.src = des.ref.url; return new Promise(r => im.onload = () => { x.drawImage(im, 0, 0); x.fillStyle = '#808080'; x.fillRect(0, 96, 192, 96); r(c.toDataURL()); }); });
  await llenar(pg, 'mitad', `(() => { const c = document.createElement('canvas'); c.width = c.height = 192; const im = new Image(); im.src = ${JSON.stringify(mitad)}; return new Promise(r => im.onload = () => { c.getContext('2d').drawImage(im, 0, 0); r(c); }); })()`);
  const sm = await medir(pg);
  ok('la mitad bien: entre las dos (' + sm + ')', sm > sg && sm < s);
  ok('el mejor no baja', await pg.evaluate(() => des.act.s >= 90));
  // la marca se ve en el piso (en tu color)
  await pg.evaluate(() => { __game.pos[2] = 1.6; __game.look(0, -45); });
  await pg.waitForTimeout(400);
  const [mx, my] = await proj(pg, [0, 0.02, 0]);
  const cm = await px(pg, mx, my), col = await pg.evaluate(() => salaColor.map(v => v * 255));
  ok('la marca se ve en el piso, en tu color (' + cm + ')', cm.every((v, i) => Math.abs(v - col[i]) < 50));
  ok('lejos de la marca: sin cuadrado y el mejor en la miniatura', !(await visto(pg, '#desMarco')) && /^\d+%$/.test(await pg.textContent('#desRefPct')) && !(await pg.evaluate(() => document.getElementById('desRefPct').classList.contains('vivo'))));
  // con algo en la mano no se mide
  await pg.evaluate(() => { __game.pos[2] = 0; __game.look(0, 0); pick(__game.works.find(w => w.id === 'mitad')); });
  await pg.waitForTimeout(1300);
  ok('con una foto en la mano: sin cuadrado', !(await visto(pg, '#desMarco')));
  await pg.evaluate(() => cancelHold()); await pg.waitForTimeout(300);
  await sacar(pg, 'mitad');
  // recargar
  await pg.evaluate(() => { __game.pos[0] = 3; __game.pos[2] = 4; });
  await pg.waitForTimeout(1700);
  await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await espera(pg, () => __game.camReady);
  if (await visto(pg, '#unequip')) await pg.tap('#unequip'); await pg.waitForTimeout(400);
  await pg.evaluate(() => { __game.pos[0] = 3; __game.pos[2] = 4; __game.look(90, 0); }); await pg.waitForTimeout(300);
  ok('recargar: sigue el desafío con su mejor', await visto(pg, '#desRef') && /^9\d|100/.test(await pg.textContent('#desRefPct')));
  await pg.tap('#desRef'); await pg.waitForTimeout(200);
  ok('la miniatura abre la hoja con el mejor', await visto(pg, '#desHoja') && (await pg.textContent('#desTxt')).includes('tu mejor') && await visto(pg, '#desJugando') && !(await visto(pg, '#desElegir')));
  await pg.tap('#desMirar'); await pg.waitForTimeout(300);
  ok('mirar desde la marca: en la marca y mirando para donde se midió', await pg.evaluate(() => { const P = __game.pos, a = des.act, f = basis().f; return Math.hypot(P[0] - a.p[0], P[2] - a.p[2]) < 0.05 && f[0] * a.f[0] + f[1] * a.f[1] + f[2] * a.f[2] > 0.99; }));
  await pg.evaluate(() => { __game.pos[0] = -2; __game.pos[2] = -1; __game.look(-90, 0); });
  await pg.tap('#desRef'); await pg.waitForTimeout(150); await pg.tap('#desMarcaAca'); await pg.waitForTimeout(200);
  ok('la marca acá: se mueve y el mejor vuelve a 0', await pg.evaluate(() => Math.abs(des.act.p[0] + 2) < 0.01 && des.act.s === 0 && des.act.f[0] < -0.9));
  // el cielo y la sala no rompen la medición: en la sala el desafío del museo no se ve
  await pg.tap('#desRef'); await pg.waitForTimeout(150); await pg.tap('#desTerminar'); await pg.waitForTimeout(200);
  ok('terminar: sin miniatura ni guardado', !(await visto(pg, '#desRef')) && await pg.evaluate(() => localStorage.getItem('desafio') === null && des.act === null));
  // datos rotos
  for (const roto of ['{"ctx":"museo","k":"g1:5","p":["a",1,2]}', '{"ctx":"museo","k":"<script>","p":[0,1.6,0]}', 'no es json', '{"ctx":"museo","k":"g1:5","p":[0,1.6,0],"f":[0,0,0],"s":"mucho"}']) {
    await pg.evaluate(r => localStorage.setItem('desafio', r), roto);
    await pg.reload(); await pg.waitForTimeout(300); await pg.tap('#start'); await espera(pg, () => __game.camReady); await pg.waitForTimeout(500);
  }
  ok('datos rotos: no se rompe nada (el último sirve con lo que tiene)', await pg.evaluate(() => __game.pos.every(Number.isFinite) && des.act && des.act.s === 0 && des.act.f[2] === -1) && !pg.errs.length);
  ok('museo: sin errores', !pg.errs.length && !/error/i.test(await pg.textContent('#hint')));
  if (pg.errs.length) console.log(pg.errs);
  await ctx.close();

  // ---------- sala ----------
  const URL = 'http://localhost:8501/?db=' + DB;
  const mk = async () => {
    const c = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const q = await c.newPage(); q.errs = []; q.on('pageerror', e => q.errs.push(e.message));
    await q.goto(URL); await q.waitForTimeout(300); await q.evaluate(() => localStorage.removeItem('desafio'));
    await q.tap('#start'); await q.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 });
    while (await q.evaluate(() => __game.grilla)) await q.tap('#grilla');
    await q.tap('#unequip'); await q.tap('#salaBtn'); await q.fill('#salaPass', PASS); await q.tap('#salaEntrar');
    await espera(q, () => __game.sala.active && __game.sala.estadoVisto, null, 8000);
    return q;
  };
  const dump = async () => ((((await (await fetch(DB + '/__dump')).json()) || {}).salas || {})[H] || {});
  const A = await mk(), B = await mk();
  const idA = await A.evaluate(() => salaYo), idB = await B.evaluate(() => salaYo);
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[1] = 1.6; __game.pos[2] = 0; __game.look(0, 0); });
  await B.evaluate(() => { __game.pos[0] = 3; __game.pos[2] = 3; __game.look(0, 0); });
  const lado = await A.evaluate(() => 4 * Math.tan(FOVX / 2));
  const verde = await A.evaluate(src => eval(src)('#20b040').toDataURL('image/jpeg', 0.92), '(' + COLOR.toString() + ')');
  await fetch(DB + '/salas/' + H + '/imgs/s1.json', { method: 'PUT', body: JSON.stringify(verde) });
  await fetch(DB + '/salas/' + H + '/poses/s1.json', { method: 'PUT', body: JSON.stringify({ c: [0, 1.6, -2], r: [1, 0, 0], u: [0, 1, 0], w: lado, h: lado, uv: [0, 0, 1, 1], de: { id: idB, col: [0.2, 0.6, 0.9] }, t0: Date.now() }) });
  ok('A y B tienen la foto', await espera(A, () => __game.works.some(w => w.id === 's1' && texTam.get(w.tex))) && await espera(B, () => __game.works.length === 1));
  await A.evaluate(() => { des.acts.museo = { ctx: 'museo', k: 'g1:5', t: 1, p: [5, 1.6, 5], f: [0, 0, -1], s: 40 }; desGuardar(); });
  await menu(A, '#opcDesafio');
  ok('A: en la sala ofrece las fotos de la sala', await visto(A, '#desFotos') && await A.evaluate(() => document.querySelectorAll('.desFotosFila img').length === 1));
  await A.tap('.desFotosFila img'); await A.waitForTimeout(200);
  ok('A: elegir la foto la pone de referencia', await A.evaluate(() => des.elegido === 'f:s1' && document.getElementById('desTxt').textContent.includes('una foto de la sala')));
  await A.tap('#desEmpezar'); await A.waitForTimeout(300);
  ok('A: empezó con la foto', await A.evaluate(() => des.act && des.act.k === 'f:s1' && des.act.ctx === __game.sala.hash));
  const sa = await medir(A);
  ok('A: la foto de referencia no cuenta al medir (' + sa + ')', sa != null && sa <= 12);
  ok('A: (sin sacarla daría casi 100)', await A.evaluate(() => desPuntaje(des.ref.grid, desCapturar(basis(), null), atm) >= 90));
  ok('A: va en la presencia', await espera(A, () => true) && (await dump()).gente && ((await dump()).gente[idA] || {}).ds && (await dump()).gente[idA].ds.k === 'f:s1');
  ok('B: le avisa que A propone un desafío', await espera(B, () => document.getElementById('hint').textContent.includes('propone un desafío'), null, 6000));
  ok('B: ve la marca de A', await B.evaluate(id => desMarcas().length === 1, idA));
  await menu(B, '#opcDesafio');
  ok('B: en la hoja, A con "sumarme" e "ir a mirar"', await B.evaluate(() => { const t = document.getElementById('desGente').textContent; return t.includes('sumarme') && t.includes('ir a mirar'); }));
  await B.evaluate(() => [...document.querySelectorAll('#desGente .pill')].find(e => e.textContent === 'sumarme').click());
  await B.waitForTimeout(300);
  const ka = await A.evaluate(() => [des.act.k, des.act.t]);
  ok('B: se sumó al mismo (misma foto, mismo desafío)', await B.evaluate(k => des.act && des.act.k === k[0] && des.act.t === k[1] && Math.hypot(des.act.p[0] - 3, des.act.p[2] - 3) < 0.05, ka));
  ok('B: sin aviso de nuevo y las dos marcas', await B.evaluate(() => desMarcas().length === 2));
  // A mejora: pone otra copia verde (no la de la sala) en el mismo lugar, un poco adelante
  await A.evaluate(([src, lado]) => { addWork({ id: 'copiaA', c: [0, 1.6, -1.9], r: [1, 0, 0], u: [0, 1, 0], w: lado * 0.95, h: lado * 0.95, t0: 1 }, eval(src)('#20b040')); }, ['(' + COLOR.toString() + ')', lado]);
  const sa2 = await medir(A);
  ok('A: con su copia sí (' + sa2 + ')', sa2 >= 80);
  await A.evaluate(() => { const i = __game.works.findIndex(w => w.id === 'copiaA'); __game.works.splice(i, 1); });
  await menu(B, '#opcDesafio');
  ok('B: ve el % de A', await espera(B, () => /\d+%/.test(document.getElementById('desGente').textContent) && !document.getElementById('desGente').textContent.includes('sumarme'), null, 6000) || await B.evaluate(() => { desPintar(); return /[89]\d%|100%/.test(document.getElementById('desGente').textContent); }));
  await B.evaluate(() => [...document.querySelectorAll('#desGente .pill')].find(e => e.textContent === 'ir a mirar').click());
  await B.waitForTimeout(300);
  ok('B: ir a mirar lo lleva a la marca de A mirando para donde A midió', await B.evaluate(() => { const P = __game.pos, f = basis().f; return Math.hypot(P[0], P[2]) < 0.1 && f[2] < -0.95; }));
  ok('B: parado en la marca de otro no mide la suya', !(await visto(B, '#desMarco')));
  await B.screenshot({ path: out + 'v10.26_sala_B.png' });
  // presencias raras: rotas no rompen; una de otro (sin cliente) con un desafío generado sí avisa
  await fetch(DB + '/salas/' + H + '/gente/roto1.json', { method: 'PUT', body: JSON.stringify({ p: [1, 1.6, 1], t: Date.now(), col: [1, 0, 0], ds: { k: 'nada', p: [NaN, 0, 0] } }) });
  await fetch(DB + '/salas/' + H + '/gente/roto2.json', { method: 'PUT', body: JSON.stringify({ p: [1, 1.6, 1], t: Date.now(), col: [1, 0, 0], ds: { k: 'g1:99', p: 'x', f: [0, 0, -1], s: 50 } }) });
  await fetch(DB + '/salas/' + H + '/gente/otro.json', { method: 'PUT', body: JSON.stringify({ p: [5, 1.6, 5], t: Date.now(), col: [1, 0.8, 0], ds: { k: 'g1:99', t: 5, p: [5, 1.6, 5], f: [0, 0, -1], s: 999 } }) });
  ok('B: las rotas no cuentan, la de otro sí (con el % acotado)', await espera(B, () => __game.sala.gente.has('otro') && __game.sala.gente.get('otro').ds && __game.sala.gente.get('otro').ds.s === 100 && !__game.sala.gente.get('roto1').ds && !__game.sala.gente.get('roto2').ds, null, 6000));
  await B.evaluate(() => desPintar());
  ok('B: "cambiarme a ese" para un desafío distinto', await B.evaluate(() => document.getElementById('desGente').textContent.includes('cambiarme a ese')));
  // A termina: B deja de verlo (con la hoja de B abierta: se actualiza y tocar lo viejo no rompe)
  await menu(B, '#opcDesafio');
  const viejo = await B.evaluateHandle(id => [...document.querySelectorAll('#desGente .pill')].find(e => e.textContent === 'ir a mirar' && e.dataset.id === id), idA);
  await A.tap('#desRef'); await A.waitForTimeout(150); await A.tap('#desTerminar');
  ok('A: terminado, sale de la presencia', await espera(A, () => !des.act) && await new Promise(r => setTimeout(async () => r(!((await dump()).gente[idA] || {}).ds), 1500)));
  ok('B: ya no ve el de A', await espera(B, id => !__game.sala.gente.get(id).ds, idA, 6000));
  ok('B: la hoja abierta se actualizó sola', await espera(B, () => !document.getElementById('desGente').textContent.includes('ir a mirar') || document.querySelectorAll('#desGente .fila').length === 1, null, 3000));
  await viejo.evaluate(e => e && e.click()); await B.waitForTimeout(200);
  ok('B: tocar el botón viejo no rompe', !B.errs.length && !/error/i.test(await B.textContent('#hint')));
  await B.evaluate(() => desCerrar());
  // B sale de la sala: su desafío de la sala no se ve en su museo, y vuelve al entrar
  await B.evaluate(() => salaSalir()); await B.waitForTimeout(800);
  ok('B: en su museo no está el de la sala (pero sigue guardado)', !(await visto(B, '#desRef')) && await B.evaluate(() => !des.act && Object.values(des.acts).some(a => a.ctx !== 'museo')));
  await A.evaluate(() => salaSalir()); await A.waitForTimeout(800);
  ok('A: el de su museo sigue como estaba', await A.evaluate(() => des.act && des.act.k === 'g1:5' && des.act.s === 40) && await visto(A, '#desRef'));
  ok('sala: sin errores', !A.errs.length && !B.errs.length && !/error/i.test(await A.textContent('#hint')) && !/error/i.test(await B.textContent('#hint')));
  if (A.errs.length || B.errs.length) console.log(A.errs, B.errs);

  console.log(fallas ? 'FALLAS: ' + fallas : 'todo bien');
  await b.close(); web.close(); dbSrv.close();
  process.exit(fallas ? 1 : 0);
})();
