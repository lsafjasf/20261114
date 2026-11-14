// 端到端验证：node test/e2e.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'artifacts');
mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    const path = join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('nf');
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForTimeout(500);

let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

// 1. 页面加载无报错
check('页面无脚本错误', errors.length === 0, errors.join('; '));

// 2. 混排示例已渲染：SVG 有凸点、高度图非全黑
const dotCount = await page.locator('#svgHost circle[fill="url(#dotGrad)"]').count();
check('SVG 视觉点阵有凸点', dotCount > 50, `凸点 ${dotCount}`);
const info = await page.locator('#plateInfo').textContent();
check('牌面信息已计算', /mm · \d+ 行/.test(info), info.trim());
const heightNonBlack = await page.evaluate(() => {
  const c = document.getElementById('heightmap');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let bright = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200) bright++;
  return bright;
});
check('高度图有凸起区域', heightNonBlack > 500, `亮像素 ${heightNonBlack}`);

// 3. 换行：缩小每行方数 -> 行数增加
const linesBefore = (await page.locator('#unicodeOut').textContent()).trim().split('\n').length;
await page.locator('#maxCells').fill('8');
await page.waitForTimeout(300);
const linesAfter = (await page.locator('#unicodeOut').textContent()).trim().split('\n').length;
check('缩小每行方数后自动换行', linesAfter > linesBefore, `${linesBefore} -> ${linesAfter} 行`);
const widthOk = await page.evaluate(() =>
  document.getElementById('unicodeOut').textContent.trim().split('\n')
    .every((l) => [...l].length <= 8));
check('每行不超过 8 方', widthOk);

// 4. 参数联动：改点距后凸点坐标变化
const xBefore = await page.locator('#svgHost circle[fill="url(#dotGrad)"]').first().getAttribute('cx');
await page.locator('#dotPitch').fill('3.5');
await page.waitForTimeout(300);
const xAfter = await page.locator('#svgHost circle[fill="url(#dotGrad)"]').first().getAttribute('cx');
check('点距调整生效', xBefore !== xAfter, `${xBefore} -> ${xAfter}`);

// 5. 凸起样式切换：渐变定义变化
await page.locator('input[name="emboss"][value="cone"]').check();
await page.waitForTimeout(300);
const hasLinear = await page.locator('#svgHost defs linearGradient').count();
check('圆锥样式使用线性渐变', hasLinear === 1);
await page.locator('input[name="emboss"][value="dome"]').check();
await page.waitForTimeout(300);

// 6. 三种导出
async function expectDownload(btnId, filename, magic) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.locator('#' + btnId).click(),
  ]);
  const path = join(OUT, filename);
  await download.saveAs(path);
  const buf = await readFile(path);
  const ok = magic(buf);
  check(`导出 ${filename}`, ok && buf.length > 500, `${buf.length} 字节`);
}
await expectDownload('exportSvg', 'braille-sign.svg',
  (b) => b.slice(0, 200).toString().includes('<svg'));
await expectDownload('exportPng', 'braille-sign.png',
  (b) => b[0] === 0x89 && b[1] === 0x50);
await expectDownload('exportHeight', 'braille-heightmap.png',
  (b) => b[0] === 0x89 && b[1] === 0x50);

// 7. 自定义混排文本：数字/英文规则切换
await page.locator('#inputText').fill('A1出口 Exit 2026');
await page.waitForTimeout(300);
const uni = await page.locator('#unicodeOut').textContent();
check('数字号切换 (⠼)', uni.includes('⠼'));
check('字母号切换 (⠰)', uni.includes('⠰'));
check('大写号 (⠠)', uni.includes('⠠'));

// 8. 页面截图存档
await page.locator('#inputText').fill('无障碍通道 Accessible Route\n请前行50米，乘电梯Elevator至B2层。\n服务热线：138-0011-2026');
await page.locator('#maxCells').fill('16');
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, 'preview.png'), fullPage: true });

check('全程无脚本错误', errors.length === 0, errors.join('; '));

await browser.close();
server.close();
console.log(failures ? `\n${failures} 项失败` : '\n端到端验证全部通过');
process.exit(failures ? 1 : 0);
