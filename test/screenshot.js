/* 无头截图：保存工作台整体与四宫格特写，用于人工确认 UI 渲染 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = 8789;
const CHROME = process.env.CHROME_BIN ||
  '/home/hj/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(JSON.parse(d))); })
      .on('error', reject);
  });
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map();
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
    });
  }
  ready() { return new Promise(r => this.ws.addEventListener('open', r, { once: true })); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === '/' ? 'web/index.html' : req.url.split('?')[0]);
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const profile = path.join(ROOT, 'test', '.shot-profile');
  fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--window-size=1400,900', `--remote-debugging-port=${PORT + 1}`,
    `--user-data-dir=${profile}`, `http://127.0.0.1:${PORT}/web/index.html`
  ]);
  let cdp;
  for (let i = 0; i < 50; i++) {
    try {
      const list = await getJson(`http://127.0.0.1:${PORT + 1}/json/list`);
      const page = list.find(t => t.type === 'page');
      if (page) { cdp = new Cdp(page.webSocketDebuggerUrl); break; }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 200));
  }
  await cdp.ready();
  await cdp.send('Page.enable');
  await new Promise(r => setTimeout(r, 900));
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'exports', 'ui-workbench.png'),
    Buffer.from(shot.data, 'base64'));
  chrome.kill(); server.close();
  fs.rmSync(profile, { recursive: true, force: true });
  console.log('截图已保存: exports/ui-workbench.png');
})().catch(err => { console.error(err); process.exit(1); });
