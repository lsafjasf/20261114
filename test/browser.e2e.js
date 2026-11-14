/*
 * 无头浏览器端到端测试（通过 CDP 驱动，无需 npm 依赖）：
 * 加载页面 -> 切换三个预设 -> 修改参数 -> 校验画布像素 -> localStorage 持久化 -> 导出 PNG。
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME_BIN ||
  '/home/hj/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 8765;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      const file = path.join(ROOT, urlPath === '/' ? 'web/index.html' : urlPath);
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  ready() { return new Promise((r) => this.ws.addEventListener('open', r, { once: true })); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function main() {
  const server = await startServer();
  const userData = path.join(ROOT, 'test', '.chrome-profile');
  fs.rmSync(userData, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${PORT + 1}`,
    `--user-data-dir=${userData}`,
    `http://127.0.0.1:${PORT}/web/index.html`
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let cdp;
  for (let i = 0; i < 50; i++) {
    try {
      const list = await getJson(`http://127.0.0.1:${PORT + 1}/json/list`);
      const page = list.find((t) => t.type === 'page');
      if (page) { cdp = new Cdp(page.webSocketDebuggerUrl); break; }
    } catch { /* 等待浏览器启动 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!cdp) throw new Error('浏览器调试端口未就绪');
  await cdp.ready();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const evalJs = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  };

  const waitFor = async (expression) => {
    for (let i = 0; i < 30; i++) {
      const v = await evalJs(expression);
      if (v) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('等待条件超时: ' + expression);
  };

  await new Promise((r) => setTimeout(r, 800));
  const results = {};

  // 1. 三个预设均可渲染，且单单元/四宫格都有非空白像素
  for (const preset of ['plain', 'twill', 'satin']) {
    await evalJs(`document.querySelector('[data-preset="${preset}"]').click()`);
    await new Promise((r) => setTimeout(r, 200));
    results[preset] = await evalJs(`(() => {
      const stats = (id) => {
        const c = document.getElementById(id), ctx = c.getContext('2d');
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const colors = new Set();
        for (let i = 0; i < d.length; i += 4) colors.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
        return { w: c.width, h: c.height, colors: colors.size, opaque: d[3] === 255 };
      };
      return { single: stats('singleCanvas'), grid: stats('gridCanvas') };
    })()`);
    if (results[preset].single.colors < 2) throw new Error(`${preset} 渲染异常`);
  }

  // 2. 调参 + 镜像：画布尺寸提示与无缝单元一致
  const meta = await evalJs(`(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('tileW', 100); set('tileH', 120); set('mirrorX', true); set('mirrorY', true);
    return new Promise((res) => setTimeout(() =>
      res({ hint: document.getElementById('unitHint').textContent,
            meta: document.getElementById('singleMeta').textContent }), 200));
  })()`);
  if (!meta.hint.includes('200 × 240')) throw new Error('镜像单元尺寸提示错误: ' + meta.hint);
  results.mirror = meta;

  // 3. localStorage 持久化（change 事件触发静默自动保存）
  await waitFor(`localStorage.getItem('weave-pattern-params-v1')`);
  const stored = await evalJs(`localStorage.getItem('weave-pattern-params-v1')`);
  const parsed = JSON.parse(stored);
  if (parsed.params.tileW !== 100 || !parsed.params.mirrorX) throw new Error('参数未持久化');
  results.storage = 'saved';

  // 4. 重新加载页面后自动恢复
  await cdp.send('Page.reload');
  await new Promise((r) => setTimeout(r, 800));
  const restored = await evalJs(`({
    tileW: document.getElementById('tileW').value,
    mirrorX: document.getElementById('mirrorX').checked,
    hint: document.getElementById('unitHint').textContent
  })`);
  if (restored.tileW !== '100' || !restored.mirrorX) throw new Error('重载后未恢复参数');
  results.restore = restored;

  // 5. 导出链路：直接在页面上下文编码 PNG 并用 Node zlib 可解码
  const exportCheck = await evalJs(`(async () => {
    const { WeavePatterns, TinyPNG } = window;
    const p = Object.assign({}, WeavePatterns.DEFAULTS, WeavePatterns.PRESETS.twill, { ssaa: 2 });
    const u = WeavePatterns.getUnitSize(p);
    const img = WeavePatterns.renderRegion(p, u.width, u.height, 0, 0, 2);
    const deflate = async (bytes) => {
      return new Uint8Array(await new Response(
        new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    };
    const png = await TinyPNG.encode(img, deflate);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < png.length; i += chunk) {
      binary += String.fromCharCode.apply(null, png.subarray(i, i + chunk));
    }
    return { b64: btoa(binary), len: png.length, w: u.width, h: u.height,
             sig: [png[0], png[1], png[2], png[3]] };
  })()`);
  const pngBytes = Buffer.from(exportCheck.b64, 'base64');
  results.exportSig = exportCheck.sig.join(',') + ` len ${exportCheck.len}->${pngBytes.length}`;
  if (pngBytes.length !== exportCheck.len || exportCheck.sig[0] !== 0x89) {
    throw new Error('PNG 字节在 base64 往返后损坏');
  }
  const decoded = require('../src/png').decode(pngBytes, zlib.inflateSync);
  if (decoded.width !== exportCheck.w || decoded.height !== exportCheck.h) {
    throw new Error('浏览器导出 PNG 尺寸不符');
  }
  results.browserPng = `${decoded.width}x${decoded.height}, ${pngBytes.length} bytes, decode OK`;

  chrome.kill();
  server.close();
  fs.rmSync(userData, { recursive: true, force: true });
  console.log(JSON.stringify(results, null, 2));
  console.log('\nE2E 全部通过');
}

main().catch((err) => {
  console.error('E2E 失败:', err);
  process.exit(1);
});
