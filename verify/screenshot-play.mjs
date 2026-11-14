// 播放过程截图：node verify/screenshot-play.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle' });
await page.click('#loadBad');
await page.click('#validate');
await page.click('#play');
await page.waitForTimeout(1400); // 播放到约 t=5.6 分，星1 月光屏蔽中
await page.screenshot({ path: 'artifacts/screenshot-playing.png' });
await browser.close();
console.log('播放截图已写入 artifacts/screenshot-playing.png');
