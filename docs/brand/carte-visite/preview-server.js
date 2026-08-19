// Tiny zero-dependency static server — for LOCAL PREVIEW ONLY.
// Not needed in production: the landing page is a single static index.html
// you can host anywhere (Netlify/Vercel/GitHub Pages) or serve via express.static.
// Uses __dirname (not process.cwd()) to stay sandbox-friendly.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 4323;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/' || urlPath.endsWith('/')) urlPath += 'index.html';
    const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404</h1>');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Aloo landing preview on http://localhost:${PORT}`));
