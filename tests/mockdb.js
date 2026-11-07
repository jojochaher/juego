// Imita lo justo de Firebase Realtime Database REST + streaming (EventSource) para tests.
const http = require('http');
let tree = {};
const listeners = new Set();
const segs = u => decodeURIComponent(u.split('?')[0]).replace(/\.json$/, '').split('/').filter(Boolean);
const get = (p) => p.reduce((o, k) => (o && typeof o === 'object') ? o[k] : undefined, tree) ?? null;
function prune(o) { if (o && typeof o === 'object') { for (const k of Object.keys(o)) { o[k] = prune(o[k]); if (o[k] === null || o[k] === undefined) delete o[k]; } return Object.keys(o).length ? o : null; } return o; }
function set(p, v) {
  if (!p.length) { tree = v || {}; return; }
  let o = tree; for (const k of p.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  if (v === null) delete o[p[p.length - 1]]; else o[p[p.length - 1]] = v;
  tree = prune(tree) || {};
}
// login falso (imita lo justo de Firebase Auth REST). La cuenta jose@... es la que figura en las reglas (admin).
const users = new Map(), tokens = new Map(), refreshes = new Map();
let ADMIN = null, nUid = 0;
const nuevoToken = uid => { const t = 'tok' + Math.random().toString(36).slice(2), f = 'ref' + Math.random().toString(36).slice(2); tokens.set(t, uid); refreshes.set(f, uid); return [t, f]; };
const uidDe = url => { const m = /[?&]auth=([^&]+)/.exec(url); return m ? tokens.get(decodeURIComponent(m[1])) || null : null; };
function allowed(p, uid, method, body) { // reglas (ver firebase-rules.json)
  const admin = uid && uid === ADMIN;
  if (p[0] === 'salas') {
    if (admin) return true;
    if (!(p.length >= 2 && p[1].length === 64 && (p.length < 3 || ['poses', 'imgs', 'gente', 'rtc'].includes(p[2])))) return false;
    // poses/$id: ".validate": "newData.hasChildren(['c', 'r', 'u', 'w', 'h'])" (un campo suelto de una pose que ya no está no la crea)
    if (p[2] === 'poses' && p.length >= 4 && (method === 'PUT' || method === 'PATCH')) {
      let v; try { v = JSON.parse(body); } catch (e) { return false; }
      if (p.length === 4 && method === 'PUT') return v === null || (!!v && ['c', 'r', 'u', 'w', 'h'].every(k => k in v));
      if (v === null && p.length > 4 && method === 'PUT') return true;
      const ya = get(p.slice(0, 4));
      return !!ya && ['c', 'r', 'u', 'w', 'h'].every(k => k in ya);
    }
    return true;
  }
  if (p[0] === 'comentarios') {
    if (admin && method !== 'POST') return true;
    if (method !== 'POST' || p.length !== 1) return false;
    let v; try { v = JSON.parse(body); } catch (e) { return false; }
    if (!v || typeof v.texto !== 'string' || v.texto.length > 4000 || typeof v.v !== 'string' || v.v.length >= 20 || typeof v.t !== 'number') return false;
    if ('registro' in v && !(typeof v.registro === 'string' && v.registro.length < 100000)) return false;
    if ('disp' in v && !(typeof v.disp === 'string' && v.disp.length < 300)) return false;
    if ('sala' in v && typeof v.sala !== 'boolean') return false;
    if (!(v.autor === 'otro' || (v.autor === 'jose' && admin))) return false;
    for (const k in v) if (!['texto', 'autor', 'v', 't', 'registro', 'disp', 'sala', 'fotos'].includes(k)) return false;
    for (const k in (v.fotos || {})) if (!/^[0-3]$/.test(k) || typeof v.fotos[k] !== 'string' || v.fotos[k].length >= 700000) return false;
    return true;
  }
  return false;
}
function auth(p, q, r, body) {
  const js = (code, o) => { r.writeHead(code, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  const err = m => js(400, { error: { code: 400, message: m } });
  if (p[1] === 'token') {
    const f = new URLSearchParams(body).get('refresh_token'), uid = refreshes.get(f);
    if (!uid) return err('INVALID_REFRESH_TOKEN');
    const [t, f2] = nuevoToken(uid);
    return js(200, { id_token: t, refresh_token: f2, expires_in: '3600', user_id: uid });
  }
  let d; try { d = JSON.parse(body); } catch (e) { return err('INVALID_JSON'); }
  if (p[1] === 'accounts:signUp') {
    if (users.has(d.email)) return err('EMAIL_EXISTS');
    if ((d.password || '').length < 6) return err('WEAK_PASSWORD : Password should be at least 6 characters');
    const uid = 'uid' + (++nUid) + 'x'.repeat(20); users.set(d.email, { pass: d.password, uid }); if (/^jose@/.test(d.email)) ADMIN = uid;
    const [t, f] = nuevoToken(uid);
    return js(200, { email: d.email, localId: uid, idToken: t, refreshToken: f, expiresIn: '3600' });
  }
  if (p[1] === 'accounts:signInWithPassword') {
    const u = users.get(d.email);
    if (!u || u.pass !== d.password) return err('INVALID_LOGIN_CREDENTIALS');
    const [t, f] = nuevoToken(u.uid);
    return js(200, { email: d.email, localId: u.uid, idToken: t, refreshToken: f, expiresIn: '3600' });
  }
  err('NOT_FOUND');
}
function notify(w) {
  for (const L of listeners) {
    if (L.frozen) continue;
    const lp = L.p;
    let ev = null;
    if (w.length >= lp.length && lp.every((k, i) => w[i] === k)) ev = { path: '/' + w.slice(lp.length).join('/'), data: get(w) };
    else if (lp.length > w.length && w.every((k, i) => lp[i] === k)) ev = { path: '/', data: get(lp) };
    if (ev) L.res.write(`event: put\ndata: ${JSON.stringify(ev)}\n\n`);
  }
}
const srv = http.createServer((q, r) => {
  r.setHeader('Access-Control-Allow-Origin', '*');
  r.setHeader('Access-Control-Allow-Methods', 'GET,PUT,PATCH,POST,DELETE,OPTIONS');
  r.setHeader('Access-Control-Allow-Headers', '*');
  if (q.method === 'OPTIONS') { r.writeHead(204); return r.end(); }
  const p = segs(q.url); if (process.env.MOCKLOG && q.method !== 'OPTIONS' && p[2] === 'gente') console.log('DB', Date.now() % 100000, q.method, p.slice(3).join('/') || '(stream)');
  if (p[0] === '__freeze') { for (const L of listeners) L.frozen = true; r.writeHead(200); return r.end('ok'); }
  if (p[0] === '__streams') { r.writeHead(200); return r.end(JSON.stringify([...listeners].map(L => L.p.slice(2).join('/')))); }
  if (p[0] === '__dump') { r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify(tree)); }
  if (p[0] === '__auth') { let body = ''; q.on('data', c => body += c); q.on('end', () => auth(p, q, r, body)); return; }
  const uid = uidDe(q.url);
  if (q.method === 'GET' && (q.headers.accept || '').includes('text/event-stream')) {
    if (!allowed(p, uid, 'GET')) { r.writeHead(401); return r.end(); }
    r.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    r.write(`event: put\ndata: ${JSON.stringify({ path: '/', data: get(p) })}\n\n`);
    const L = { p, res: r }; listeners.add(L);
    r.on('close', () => listeners.delete(L));
    return;
  }
  let body = ''; q.on('data', c => body += c); q.on('end', () => {
    if (!allowed(p, uid, q.method, body)) { r.writeHead(401, { 'content-type': 'application/json' }); return r.end('{"error":"Permission denied"}'); }
    if (q.method === 'POST') { const k = '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); set([...p, k], JSON.parse(body)); notify([...p, k]); r.writeHead(200); return r.end(JSON.stringify({ name: k })); }
    if (q.method === 'GET') { let v = get(p); if (/shallow=true/.test(q.url) && v && typeof v === 'object') v = Object.fromEntries(Object.keys(v).map(k => [k, true])); r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify(v)); }
    if (q.method === 'PUT') { const v = JSON.parse(body); set(p, v); notify(p); r.writeHead(200); return r.end(JSON.stringify(v)); }
    if (q.method === 'PATCH') { const v = JSON.parse(body); for (const k in v) { set([...p, k], v[k]); } notify(p); r.writeHead(200); return r.end(body); }
    if (q.method === 'DELETE') { set(p, null); notify(p); r.writeHead(200); return r.end('null'); }
    r.writeHead(405); r.end();
  });
});
module.exports = (port) => new Promise(res => srv.listen(port, () => res(srv)));
