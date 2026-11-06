// "vengan" (v10.11, propuesta 13 parte 3): desde el panel de la sala llamás a los demás un minuto;
// a ellos les titila tu carita ("te llama") y les avisa una vez; con "ir ahí" llegan.
// Lo cortan "llamando ✕", "dejar de llamar", el minuto, o salir de la sala (sin volver a aparecer en ella).
// uso: node tests/test37.js .
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.'), out = path.join(__dirname, 'out') + '/';
const mock = require('./mockdb.js');
let fallas = 0;
const ok = (n, c) => { if (!c) fallas++; console.log((c ? 'OK   ' : 'FAIL ') + n); };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dbSrv = await mock(8372);
  const web = http.createServer((q, r) => { const u = q.url.split('?')[0]; let p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(8371);
  const URL = 'http://localhost:8371/?db=http://localhost:8372';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async () => { const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'microphone'] }); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(e.message));
    await pg.goto(URL); await pg.waitForTimeout(300); await pg.tap('#start'); await pg.waitForFunction(() => window.__game.camReady, null, { timeout: 8000 }); return pg; };
  const espera = (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  const entrar = async pg => { await pg.tap('#unequip'); await pg.tap('#salaBtn'); await pg.fill('#salaPass', 'prueba vengan'); await pg.tap('#salaEntrar'); };
  const visible = (pg, sel) => pg.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.offsetWidth > 0; }, sel);
  const A = await mk(); await entrar(A);
  await A.tap('#salaBtn');
  ok('solo en la sala: no hay "vengan"', !(await visible(A, '#salaVengan')));
  await A.tap('#salaBtn');
  const B = await mk(); await entrar(B);
  const idA = await A.evaluate(() => __game.salaYo), idB = await B.evaluate(() => __game.salaYo);
  ok('se ven en la sala', await espera(A, id => __game.sala.gente.has(id), idB) && await espera(B, id => __game.sala.gente.has(id), idA));

  // B lejos, atrás de A: B llama
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  await B.evaluate(() => { __game.pos[0] = 3; __game.pos[2] = 20; __game.look(0, 0); });
  await espera(A, () => document.querySelectorAll('#lejos .lejos').length === 1 && getComputedStyle(document.getElementById('lejos')).display !== 'none', null, 6000);
  await A.waitForTimeout(800);
  ok('antes de llamar, la carita no titila', await A.evaluate(() => !document.querySelector('#lejos .lejos').classList.contains('llama')));
  await B.tap('#salaBtn');
  ok('con alguien más: está "vengan" en el panel', await visible(B, '#salaVengan') && (await B.textContent('#salaVengan')) === 'vengan');
  await B.screenshot({ path: out + 'v1011_panel.png' });
  await B.tap('#salaVengan');
  ok('tocar "vengan" cierra el panel, muestra "llamando ✕" y avisa', !(await visible(B, '#salaPanel')) && await visible(B, '#llamando') && /avisé/.test(await B.textContent('#hint')));
  ok('A: la carita de B titila y dice "te llama"', await espera(A, () => { const e = document.querySelector('#lejos .lejos'); return e && e.classList.contains('llama') && /^te llama\n\d+ m$/.test(e.querySelector('.m').textContent); }, null, 5000));
  await A.waitForTimeout(300);
  ok('el texto de la carita entra en la pantalla', await A.evaluate(() => { const r = document.querySelector('#lejos .lejos .m').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width > 0; }));
  ok('A: le avisa una vez ("te llaman: tocá su carita")', /te llaman: tocá su carita/.test(await A.textContent('#hint')));
  await A.screenshot({ path: out + 'v1011_llama.png' });
  // una reconexión no vuelve a avisar
  await A.evaluate(() => showHint('otra cosa'));
  await A.evaluate(() => salaReconectar());
  await A.waitForTimeout(2500);
  ok('reconectar no vuelve a avisar, y sigue titilando', (await A.textContent('#hint')) === 'otra cosa' && await A.evaluate(id => __game.sala.gente.get(id) && __game.sala.gente.get(id).ll, idB));
  await B.tap('#salaBtn');
  ok('B: el panel dice "dejar de llamar"', (await B.textContent('#salaVengan')) === 'dejar de llamar');
  await B.tap('#salaBtn');
  // A va
  await A.tap('#lejos .lejos');
  await A.tap('#lejosIr');
  await A.waitForTimeout(300);
  const pA = await A.evaluate(() => __game.pos.slice()), pB = await B.evaluate(() => __game.pos.slice());
  ok('A llegó al lado de B (' + Math.hypot(pA[0] - pB[0], pA[2] - pB[2]).toFixed(2) + ' m)', Math.abs(Math.hypot(pA[0] - pB[0], pA[2] - pB[2]) - 1.5) < 0.2);
  // B corta con "llamando ✕"
  await B.tap('#llamando');
  ok('B: "llamando ✕" lo corta', !(await visible(B, '#llamando')) && /dejaste de llamar/.test(await B.textContent('#hint')) && await B.evaluate(() => salaLlamo === 0));
  ok('A: ya no lo llama', await espera(A, id => !__game.sala.gente.get(id).ll, idB, 5000));
  await A.evaluate(() => { __game.pos[0] = 0; __game.pos[2] = 0; __game.look(0, 0); });
  await A.waitForTimeout(1200);
  ok('A: la carita ya no titila ni dice "te llama"', await A.evaluate(() => { const e = document.querySelector('#lejos .lejos'); return e && !e.classList.contains('llama') && /^\d+ m$/.test(e.querySelector('.m').textContent); }));

  // otro llamado: avisa de nuevo; se vence solo (acá, en 1,5 s)
  await A.evaluate(() => showHint('nada'));
  await B.tap('#salaBtn'); await B.tap('#salaVengan');
  ok('un llamado nuevo avisa de nuevo', await espera(A, () => /te llaman/.test(document.getElementById('hint').textContent), null, 5000));
  await B.evaluate(() => { salaLlamo = Date.now() + 1500; sala.ultimoEstado = ''; salaEnviarPresencia(); });
  ok('se vence solo: "terminó el llamado"', await espera(B, () => getComputedStyle(document.getElementById('llamando')).display === 'none' && /terminó el llamado/.test(document.getElementById('hint').textContent), null, 5000));
  ok('A: al vencerse ya no lo llama', await espera(A, id => !__game.sala.gente.get(id).ll, idB, 5000));

  // si lo tenés a la vista, el aviso dice "tocalo"
  await A.evaluate(() => { __game.pos[0] = 3; __game.pos[2] = 26; __game.look(0, 0); });   // B (3, 20) adelante
  await A.waitForTimeout(800);
  await B.tap('#salaBtn'); await B.tap('#salaVengan');
  ok('a la vista: "te llaman: tocalo para ir"', await espera(A, () => /te llaman: tocalo/.test(document.getElementById('hint').textContent), null, 5000));
  // siguiendo y llamando a la vez: las dos pills van una al lado de la otra (no tapan el aviso ni las caritas)
  await B.evaluate(id => salaSeguir(id), idA);
  await B.waitForTimeout(200);
  const pills = await B.evaluate(() => ['siguiendo', 'llamando'].map(i => { const r = document.getElementById(i).getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom]; }));
  ok('siguiendo y llamando: una al lado de la otra (' + JSON.stringify(pills.map(a => a.map(Math.round))) + ')', Math.abs(pills[0][2] - pills[1][2]) < 2 && pills[0][1] <= pills[1][0] && pills[0][0] >= 0 && pills[1][1] <= (await B.evaluate(() => innerWidth)));
  await B.screenshot({ path: out + 'v1011_dos.png' });
  await B.evaluate(() => salaDejarDeSeguir('lo pediste'));
  // B sale de la sala llamando: deja de llamar y no vuelve a aparecer en la sala
  await B.tap('#salaBtn'); await B.tap('#salaSalir');
  ok('B salió: ya no llama', !(await visible(B, '#llamando')) && await B.evaluate(() => salaLlamo === 0));
  ok('A: B se fue de la sala', await espera(A, id => !__game.sala.gente.has(id), idB, 8000));
  await A.waitForTimeout(2500);
  ok('A: y no vuelve a aparecer', await A.evaluate(id => !__game.sala.gente.has(id), idB));
  const dump = await (await fetch('http://localhost:8372/__dump')).json().catch(() => null);
  const sala1 = dump && dump.salas && Object.values(dump.salas)[0];
  ok('en la base B no está en gente', !!sala1 && !(sala1.gente || {})[idB]);
  // un llamado viejo colgado en la base (alguien que no se despidió) no avisa; uno que no avisa que terminó se apaga solo
  await A.evaluate(() => showHint('nada'));
  const h = await A.evaluate(() => __game.sala.hash), ahora = Date.now();
  await fetch(`http://localhost:8372/salas/${h}/gente/fantasma.json`, { method: 'PUT', body: JSON.stringify({ p: [0, 1.6, 15], t: ahora - 120000, ll: ahora - 70000, col: [1, 0, 0] }) });
  ok('llega el fantasma', await espera(A, () => __game.sala.gente.has('fantasma'), null, 5000));
  await A.waitForTimeout(800);
  ok('un llamado viejo no avisa ni titila', (await A.textContent('#hint')) === 'nada' && await A.evaluate(() => !__game.sala.gente.get('fantasma').ll));
  await fetch(`http://localhost:8372/salas/${h}/gente/fantasma.json`, { method: 'PUT', body: JSON.stringify({ p: [0, 1.6, 15], t: ahora - 29000, ll: ahora - 28000, col: [1, 0, 0] }) });
  ok('uno reciente sí avisa', await espera(A, () => /te llaman/.test(document.getElementById('hint').textContent) && __game.sala.gente.get('fantasma').ll, null, 5000));
  ok('y se apaga solo aunque no avise que terminó', await espera(A, () => !__game.sala.gente.get('fantasma').ll, null, 6000));
  await fetch(`http://localhost:8372/salas/${h}/gente/fantasma.json`, { method: 'DELETE' });
  // fuera de la sala, "vengan" no hace nada
  await B.evaluate(() => salaLlamar(true));
  ok('fuera de la sala no se puede llamar', await B.evaluate(() => salaLlamo === 0) && !(await visible(B, '#llamando')));
  const err = pg => pg.textContent('#hint').then(t => /error/i.test(t));
  ok('sin errores', !(await err(A)) && !(await err(B)) && !A.errs.length && !B.errs.length);
  if (A.errs.length || B.errs.length) console.log('errores', A.errs, B.errs);
  console.log(`\n${fallas ? fallas + ' FALLAS' : 'TODO OK'}`);
  await b.close(); web.close(); dbSrv.close(); process.exit(fallas ? 1 : 0);
})();
