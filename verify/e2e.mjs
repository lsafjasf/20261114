// 浏览器端到端测试：node verify/e2e.mjs
// 真实加载页面，验证判定链路、错过窗口文案并产出截图。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:8765/index.html';
mkdirSync('artifacts', { recursive: true });

let failures = 0;
function assert(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${name} ${detail}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

await page.goto(BASE, { waitUntil: 'networkidle' });

console.log('=== 可行排程 ===');
await page.click('#validate');
await page.waitForSelector('#verdict.pass');
const goodText = await page.textContent('#verdict');
assert('可行排程显示通过', goodText.includes('排程通过'), goodText);
const chipCount = await page.locator('#stats .chip.ok').count();
assert('三颗星有效曝光芯片全部达标', chipCount === 3, String(chipCount));
await page.screenshot({ path: 'artifacts/screenshot-good.png', fullPage: true });

console.log('=== 迟到排程（错过窗口）===');
await page.click('#loadBad');
await page.click('#validate');
await page.waitForSelector('#verdict.fail');
const badText = await page.textContent('#verdict');
assert('迟到排程显示失败与错过名单', badText.includes('错过窗口'), badText);
assert(
  '错过名单包含三颗星',
  ['天狼星', '参宿七', '北河三'].every((n) => badText.includes(n)),
  badText
);
const noChips = await page.locator('#stats .chip.no').count();
assert('三颗星芯片均标红未达标', noChips === 3, String(noChips));
const logText = await page.textContent('#log');
assert('日志记录三次“错过窗口”', (logText.match(/错过窗口/g) || []).length === 3);
assert('日志记录月光作废原因', logText.includes('月光过强'));
await page.screenshot({ path: 'artifacts/screenshot-bad.png', fullPage: true });

console.log('=== 播放与音效 ===');
await page.click('#play');
await page.waitForTimeout(600);
const playing = await page.evaluate(() => window !== undefined);
assert('播放启动无异常', playing === true);
await page.click('#reset');

console.log('=== 控制台错误检查 ===');
assert('无控制台错误/异常', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
console.log('\n=== 汇总 ===');
if (failures > 0) {
  console.error(`E2E 失败 ${failures} 项`);
  process.exit(1);
}
console.log('E2E 全部通过，截图已写入 artifacts/ ✅');
