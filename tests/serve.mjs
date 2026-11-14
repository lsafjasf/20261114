import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const root = process.cwd();
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent((request.url || '/').split('?')[0]);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end('forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(data);
  });
});

const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${server.address().port}`);
});
