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
function allowed(p) { // reglas: solo /salas/<64>/...
  return p[0] === 'salas' && p.length >= 2 && p[1].length === 64 && (p.length < 3 || ['poses', 'imgs', 'gente', 'rtc'].includes(p[2]));
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
  r.setHeader('Access-Control-Allow-Methods', 'GET,PUT,PATCH,DELETE,OPTIONS');
  r.setHeader('Access-Control-Allow-Headers', '*');
  if (q.method === 'OPTIONS') { r.writeHead(204); return r.end(); }
  const p = segs(q.url); if (process.env.MOCKLOG && q.method !== 'OPTIONS' && p[2] === 'gente') console.log('DB', Date.now() % 100000, q.method, p.slice(3).join('/') || '(stream)');
  if (p[0] === '__freeze') { for (const L of listeners) L.frozen = true; r.writeHead(200); return r.end('ok'); }
  if (p[0] === '__streams') { r.writeHead(200); return r.end(JSON.stringify([...listeners].map(L => L.p.slice(2).join('/')))); }
  if (p[0] === '__dump') { r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify(tree)); }
  if (!allowed(p)) { r.writeHead(401, { 'content-type': 'application/json' }); return r.end('{"error":"Permission denied"}'); }
  if (q.method === 'GET' && (q.headers.accept || '').includes('text/event-stream')) {
    r.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    r.write(`event: put\ndata: ${JSON.stringify({ path: '/', data: get(p) })}\n\n`);
    const L = { p, res: r }; listeners.add(L);
    r.on('close', () => listeners.delete(L));
    return;
  }
  let body = ''; q.on('data', c => body += c); q.on('end', () => {
    if (q.method === 'GET') { let v = get(p); if (/shallow=true/.test(q.url) && v && typeof v === 'object') v = Object.fromEntries(Object.keys(v).map(k => [k, true])); r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify(v)); }
    if (q.method === 'PUT') { const v = JSON.parse(body); set(p, v); notify(p); r.writeHead(200); return r.end(JSON.stringify(v)); }
    if (q.method === 'PATCH') { const v = JSON.parse(body); for (const k in v) { set([...p, k], v[k]); } notify(p); r.writeHead(200); return r.end(body); }
    if (q.method === 'DELETE') { set(p, null); notify(p); r.writeHead(200); return r.end('null'); }
    r.writeHead(405); r.end();
  });
});
module.exports = (port) => new Promise(res => srv.listen(port, () => res(srv)));
