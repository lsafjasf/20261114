'use strict';

const { createServer } = require('node:http');
const { join, extname } = require('node:path');
const { statSync, readFileSync } = require('node:fs');

const root = __dirname;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

createServer((req, res) => {
  const file = join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  try {
    if (!statSync(file).isFile()) throw new Error();
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(8123, () => {
  console.log('抓握调试台已启动: http://localhost:8123');
});
