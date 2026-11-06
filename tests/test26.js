// v10.3: comentarios (texto + captura + foto de galería) y cuenta de admin (todas las salas, borrar).
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
const DB = 'http://localhost:8291';
const pedir = (p, method = 'GET', body) => new Promise(res => {
  const q = http.request(DB + p, { method }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d })); });
  if (body) q.write(body); q.end();
});
const dump = async () => JSON.parse((await pedir('/__dump')).body);
const hash = p => crypto.createHash('sha256').update('juego:' + p).digest('hex');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8291);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200,{'content-type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p)); }).listen(8290);
  const URL = 'http://localhost:8290/?db=' + DB;
  // dos salas de otros (contraseñas que este celu no conoce), con una foto cada una
  const img = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(root, 'icon-192.png')).toString('base64');
  for (const s of ['sala de otro 1', 'sala de otro 2']) {
    await pedir(`/salas/${hash(s)}/poses/f1.json`, 'PUT', JSON.stringify({ c: [0, 1, -2], r: [1, 0, 0], u: [0, 1, 0], w: 1, h: 1, uv: [0, 0, 1, 1] }));
    await pedir(`/salas/${hash(s)}/imgs/f1.json`, 'PUT', JSON.stringify(img));
    await pedir(`/salas/${hash(s)}/gente/alguien.json`, 'PUT', JSON.stringify({ p: [0, 0, 0], t: 1 }));
  }
  await pedir(`/salas/${hash('sala de otro 2')}/imgs/f1~son.json`, 'PUT', JSON.stringify('data:audio/mp4;base64,' + 'A'.repeat(15978)));   // un sonido del lugar (~16 KB)
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ ...devices['iPhone 13'], permissions: ['camera'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' | ')));
  await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady);
  await pg.tap('#unequip'); await pg.waitForTimeout(5500);   // que se vaya el texto de ayuda

  // ---- comentario anónimo
  await pg.tap('#menuBtn'); await pg.tap('#opcComentario');
  await pg.waitForSelector('#comPanel', { state: 'visible' });
  ok('el comentario se abre desde ☰ y el menú se cierra', !(await pg.isVisible('#opciones')));
  const cap = await pg.evaluate(() => comFotos.length && comFotos[0].length);
  ok('trae una captura del juego (' + cap + ' letras)', cap > 5000);
  // que la captura no esté negra: el piso tiene puntitos claros
  const claros = await pg.evaluate(() => new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 60) n++; res(n); }; im.src = comFotos[0]; }));
  ok('la captura no es una pantalla vacía (' + claros + ' px claros)', claros > 50);
  await pg.setInputFiles('#comArchivo', path.join(root, 'icon-512.png'));
  await pg.waitForFunction(() => comFotos.length === 2);
  ok('agrega una foto de la galería', true);
  await pg.tap('#comFotos .miniFoto:nth-child(1) .x');
  ok('se puede sacar la captura', await pg.evaluate(() => comFotos.length === 1));
  await pg.fill('#comTexto', 'la grilla se ve rara cuando giro');
  await pg.keyboard.press('KeyW'); await pg.waitForTimeout(300);
  ok('escribir no mueve al personaje', await pg.evaluate(() => Math.abs(__game.pos[2]) < 0.01));
  await pg.screenshot({ path: out + 'v103_comentario.png' });
  await pg.tap('#comMandar');
  await pg.waitForSelector('#comPanel', { state: 'hidden', timeout: 5000 }).catch(() => {});
  let d = await dump(), cs = Object.values(d.comentarios || {});
  ok('llegó el comentario', cs.length === 1);
  ok('anónimo = autor otro, con versión, registro y la foto', cs[0] && cs[0].autor === 'otro' && cs[0].texto === 'la grilla se ve rara cuando girow' && /^v\d/.test(cs[0].v) && cs[0].registro.includes('AHORA') && Object.keys(cs[0].fotos || {}).length === 1);
  ok('dice gracias', /gracias/.test(await pg.textContent('#hint')));

  // ---- lo que no puede hacer alguien sin cuenta
  ok('sin cuenta no se pueden listar las salas', (await pedir('/salas.json?shallow=true')).status === 401);
  ok('sin cuenta no se pueden leer los comentarios', (await pedir('/comentarios.json')).status === 401);
  ok('sin cuenta no se puede mandar como José', (await pedir('/comentarios.json', 'POST', JSON.stringify({ texto: 'x', autor: 'jose', v: 'v1', t: 1 }))).status === 401);

  // ---- cuenta de admin: 3 toques en el título de mis salas
  await pg.tap('#menuBtn'); await pg.tap('#opciones .abrirSalas');
  ok('sin cuenta no aparece "ver todas"', !(await pg.isVisible('#salasModo')));
  for (let i = 0; i < 3; i++) await pg.tap('#salasTit');
  ok('3 toques en el título abren la cuenta', await pg.isVisible('#cuentaPanel'));
  // una cuenta que no es la de las reglas: sus comentarios van como anónimos y no ve las salas
  await pg.fill('#cuentaMail', 'otro@ejemplo.com'); await pg.fill('#cuentaPass', 'otra contraseña');
  await pg.tap('#cuentaCrear'); await pg.waitForSelector('#cuentaDentro', { state: 'visible', timeout: 5000 }).catch(() => {});
  await pg.tap('#cuentaSalas');
  await pg.waitForFunction(() => /no pude/.test(document.getElementById('salasLista').textContent), null, { timeout: 5000 }).catch(() => {});
  ok('cuenta ajena: "ver todas" avisa que la base no la deja', /no pude traer/.test(await pg.textContent('#salasLista')));
  await pg.tap('#salasCerrar');
  await pg.tap('#menuBtn'); await pg.tap('#opcComentario'); await pg.waitForSelector('#comPanel', { state: 'visible' });
  await pg.fill('#comTexto', 'desde cuenta ajena'); await pg.tap('#comMandar');
  await pg.waitForSelector('#comPanel', { state: 'hidden', timeout: 5000 }).catch(() => {});
  d = await dump();
  ok('cuenta ajena: el comentario llega igual, como otro', Object.values(d.comentarios || {}).some(c => c.texto === 'desde cuenta ajena' && c.autor === 'otro'));
  ok('y avisa que fue como anónimo', /anónimo/.test(await pg.textContent('#hint')));
  await pg.evaluate(() => { cuentaSalir(); cuentaAbrir(); });
  await pg.fill('#cuentaMail', 'jose@ejemplo.com'); await pg.fill('#cuentaPass', 'corta');
  await pg.tap('#cuentaCrear'); await pg.waitForTimeout(400);
  ok('contraseña corta: avisa', /6 letras/.test(await pg.textContent('#cuentaError')));
  await pg.fill('#cuentaPass', 'una contraseña larga'); await pg.tap('#cuentaCrear');
  await pg.waitForSelector('#cuentaDentro', { state: 'visible', timeout: 5000 }).catch(() => {});
  ok('crea la cuenta y muestra el id', /^uid2/.test(await pg.textContent('#cuentaUid')));
  await pg.screenshot({ path: out + 'v103_cuenta.png' });
  await pg.tap('#cuentaSalas');
  await pg.waitForFunction(() => document.querySelectorAll('#salasLista .salaFila').length === 2, null, { timeout: 5000 }).catch(() => {});
  ok('ve todas las salas (2, sin nombre)', await pg.evaluate(() => [...document.querySelectorAll('#salasLista .salaFila .nom')].every(e => /sin nombre/.test(e.textContent)) && document.querySelectorAll('#salasLista .salaFila').length === 2));
  await pg.waitForFunction(() => /la más pesada/.test(document.getElementById('salasPeso')?.textContent), null, { timeout: 5000 }).catch(() => {});
  const notas = await pg.evaluate(() => [...document.querySelectorAll('#salasLista .salaFila .nota')].map(e => e.textContent).sort());
  ok('cuenta las fotos de cada una y estima cuánto pesa (' + notas.join(' / ') + ')', notas[0] === '1 foto · ≈ 100 KB' && notas[1] === '1 foto · ≈ 116 KB');
  // v10.18 (propuesta 5): cuánto ocupa la base
  const peso = await pg.textContent('#salasPeso');
  console.log('     ' + peso);
  ok('el total contra 1 GB', /en total ≈ 216 KB de 1 GB \(menos del 0,1%\)/.test(peso));
  ok('la que más baja al entrar y cuántas entradas deja el plan', /la más pesada es una sin nombre \(/.test(peso) && /≈ 100 KB por entrada/.test(peso) && /más de 10\.000/.test(peso));
  ok('cifras con coma, KB/MB/GB y porcentaje', await pg.evaluate(() => [salaMB(1.5e6), salaMB(23.4e6), salaMB(1.2e9), salaMB(400), salaPct(250e6, 1e9), salaPct(5e6, 1e9)].join('|')) === '1,5 MB|23 MB|1,2 GB|1 KB|25%|0,5%');
  ok('link a la consola de Firebase', await pg.evaluate(() => /console\.firebase\.google\.com\/project\/juego-dd2eb\//.test(document.querySelector('#salasPeso a').href)));
  await pg.screenshot({ path: out + 'v103_todas.png' });
  const conSon = await pg.evaluate(() => [...document.querySelectorAll('#salasLista .salaFila .nota')].findIndex(f => /116/.test(f.textContent)));
  await pg.locator('#salasLista .salaFila').nth(conSon).locator('.pill').tap();
  await pg.waitForFunction(() => document.querySelector('#salasFotos .miniFoto img'), null, { timeout: 5000 }).catch(() => {});
  ok('ver una: muestra su foto', await pg.isVisible('#salasFotos .miniFoto img'));
  await pg.waitForFunction(() => !/midiendo/.test(document.getElementById('salasCuenta').textContent) && /KB/.test(document.getElementById('salasCuenta').textContent), null, { timeout: 5000 }).catch(() => {});
  const kb = Math.round((img.length + 16000) / 1000);
  ok('ver una: dice lo que pesa medido (' + await pg.textContent('#salasCuenta') + ', esperado ≈ ' + kb + ' KB)', (await pg.textContent('#salasCuenta')) === ` · 1 foto · ≈ ${kb} KB`);
  ok('la foto medida ajusta la estimación', await pg.evaluate(n => { const o = JSON.parse(localStorage.getItem('pesoFotos')); return o.n === 1 && o.b === n; }, img.length));
  // la otra sala tarda en bajar su foto: volver y ver esta antes de que llegue no le pisa la cabecera
  const otraH = hash('sala de otro 1');
  const lenta = u => u.href.includes(otraH + '/imgs/f1.json');
  await pg.route(lenta, async r => { await new Promise(z => setTimeout(z, 1500)); r.continue().catch(() => {}); });
  await pg.tap('#salasVolver');
  await pg.waitForFunction(() => /la más pesada/.test(document.getElementById('salasPeso')?.textContent), null, { timeout: 5000 }).catch(() => {});
  const sinSon = await pg.evaluate(() => [...document.querySelectorAll('#salasLista .salaFila .nota')].findIndex(f => !/116/.test(f.textContent)));
  await pg.locator('#salasLista .salaFila').nth(sinSon).locator('.pill').tap();
  await pg.waitForTimeout(200);
  await pg.tap('#salasVolver');
  await pg.waitForFunction(() => /la más pesada/.test(document.getElementById('salasPeso')?.textContent), null, { timeout: 5000 }).catch(() => {});
  await pg.locator('#salasLista .salaFila').nth(await pg.evaluate(() => [...document.querySelectorAll('#salasLista .salaFila .nota')].findIndex(f => /116/.test(f.textContent)))).locator('.pill').tap();
  await pg.waitForTimeout(2200);
  ok('una sala que tardaba no pisa la cabecera de la que estás viendo (' + await pg.textContent('#salasCuenta') + ')', (await pg.textContent('#salasCuenta')) === ` · 1 foto · ≈ ${kb} KB`);
  ok('volver a ver la misma sala no la cuenta dos veces en la media', await pg.evaluate(() => JSON.parse(localStorage.getItem('pesoFotos')).n === 1));
  await pg.unroute(lenta);
  ok('ver una ajena: sin "sacar de la lista"', !(await pg.isVisible('#salasOlvidar')));
  await pg.tap('#salasBorrar'); await pg.tap('#salasBorrar');
  await pg.waitForFunction(() => document.querySelectorAll('#salasLista .salaFila').length === 1, null, { timeout: 5000 }).catch(() => {});
  d = await dump();
  ok('borrar una: se va entera (también la gente)', Object.keys(d.salas || {}).length === 1);
  // comentario como José
  await pg.tap('#salasCerrar');
  await pg.tap('#menuBtn'); await pg.tap('#opcComentario'); await pg.waitForSelector('#comPanel', { state: 'visible' });
  ok('el panel dice que va como José', /José/.test(await pg.textContent('#comComo')));
  await pg.fill('#comTexto', 'bug: se traba al soltar'); await pg.tap('#comMandar');
  await pg.waitForSelector('#comPanel', { state: 'hidden', timeout: 5000 }).catch(() => {});
  d = await dump(); cs = Object.values(d.comentarios || {});
  ok('comentario de José = autor jose', cs.some(c => c.autor === 'jose' && c.texto === 'bug: se traba al soltar'));
  // el token se renueva solo
  const renovado = await pg.evaluate(async () => { const viejo = cuenta.token; cuenta.vence = 0; const t = await cuentaToken(); return t && t !== viejo; });
  ok('renueva el token vencido', renovado);
  // borrar todas
  await pg.tap('#menuBtn'); await pg.tap('#opciones .abrirSalas');
  ok('con cuenta aparece "ver todas"', await pg.isVisible('#salasModo'));
  await pg.tap('#salasModo');
  await pg.waitForFunction(() => [...document.querySelectorAll('#salasLista .pill.rojo')].length === 1, null, { timeout: 5000 }).catch(() => {});
  await pg.tap('#salasLista .pill.rojo'); await pg.tap('#salasLista .pill.rojo');
  await pg.waitForTimeout(800);
  d = await dump();
  ok('borrar todas', !d.salas || !Object.keys(d.salas).length);
  // salir y volver a entrar con la misma cuenta
  await pg.tap('#salasCerrar');
  await pg.evaluate(() => cuentaAbrir()); await pg.tap('#cuentaSalir');
  ok('salir de la cuenta', await pg.isVisible('#cuentaFuera') && await pg.evaluate(() => !localStorage.getItem('cuenta')));
  await pg.fill('#cuentaMail', 'jose@ejemplo.com'); await pg.fill('#cuentaPass', 'una contraseña larga'); await pg.tap('#cuentaEntrar');
  await pg.waitForSelector('#cuentaDentro', { state: 'visible', timeout: 5000 }).catch(() => {});
  ok('volver a entrar', await pg.evaluate(() => cuentaAdmin()));
  // la cuenta sobrevive a una recarga
  await pg.reload(); await pg.waitForTimeout(400);
  ok('sigue con la cuenta después de recargar', await pg.evaluate(() => cuentaAdmin()));
  ok('sin errores', !pg.errs.length && !/error/i.test(await pg.textContent('#hint')));
  if (pg.errs.length) console.log(pg.errs);
  // ?db= con otra base que no sea localhost: se ignora (no se lleva fotos ni el token)
  const pg2 = await ctx.newPage(); await pg2.goto('http://localhost:8290/?db=https://otra-base.example.com'); await pg2.waitForTimeout(300);
  ok('?db= ajeno se ignora', await pg2.evaluate(() => SALA_DB === 'https://juego-dd2eb-default-rtdb.firebaseio.com'));
  console.log(fallas ? fallas + ' FALLAS' : 'TODO OK');
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
