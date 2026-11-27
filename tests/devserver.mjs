// Local preview: serves static files and the /api functions.
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const mod = await import(path.join(root, u.pathname + '.js') + '?' + Date.now());
    let body = ''; for await (const c of req) body += c;
    const r = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(o) { res.writeHead(this.statusCode, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); } };
    return mod.default({ headers: req.headers, method: req.method, query: Object.fromEntries(u.searchParams), body: body ? JSON.parse(body) : {} }, r);
  }
  const f = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(process.env.PORT || 4173, () => console.log('preview on', process.env.PORT || 4173));
