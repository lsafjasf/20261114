const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "artifacts");

// 三组测试参数：含太阳低角度掠射边缘的情形
const CASES = [
  { name: "case1-midday",   az: 125, el: 48, wave: 1.0, depth: 1.1, t: 4.2 },
  { name: "case2-grazing",  az: 2,   el: 6,  wave: 1.8, depth: 2.4, t: 9.7 },
  { name: "case3-calm-shallow", az: 270, el: 75, wave: 0.35, depth: 0.4, t: 15.3 },
];

function colDiff(a, b){
  let sum = 0, n = 0;
  for (let i = 0; i < a.length; i += 4){
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2]);
    n += 3;
  }
  return sum / n;
}

(async () => {
  const browser = await chromium.launch({
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on("pageerror", e => { console.error("PAGE ERROR:", e.message); process.exitCode = 1; });

  let shotSaved = false;
  for (const c of CASES){
    const url = `file://${ROOT}/index.html?az=${c.az}&el=${c.el}&wave=${c.wave}&depth=${c.depth}&t=${c.t}`;
    await page.goto(url);
    await page.waitForTimeout(1200);

    const fps = await page.textContent("#fps");
    const probe = await page.evaluate(() => window.__probe());
    if (!probe) throw new Error("probe missing");

    // 接缝度量：右列与左列的差异（跨越边界）应接近内部相邻列差异
    const seam = colDiff(probe.right, probe.left);
    const inner = colDiff(probe.interior[0], probe.interior[1]);
    const ratio = seam / Math.max(inner, 0.01);
    console.log(`${c.name}: ${fps} | seam=${seam.toFixed(2)} interior=${inner.toFixed(2)} ratio=${ratio.toFixed(2)}`);
    if (!(fps && !fps.includes("--"))) throw new Error("FPS 未更新");
    if (ratio > 4.0) throw new Error(`边缘接缝过大: ratio=${ratio}`);

    const file = path.join(OUT, `caustics-${c.name}.png`);
    await page.locator("#glcanvas").screenshot({ path: file });
    if (!shotSaved && c.name === "case2-grazing"){
      fs.copyFileSync(file, path.join(OUT, "caustics-screenshot.png"));
      shotSaved = true;
    }
  }

  // 暂停/截图按钮功能验证
  await page.goto(`file://${ROOT}/index.html`);
  await page.waitForTimeout(600);
  await page.click("#pauseBtn");
  const label = await page.textContent("#pauseBtn");
  if (label.trim() !== "继续") throw new Error("暂停按钮未切换");
  const dl = page.waitForEvent("download", { timeout: 5000 });
  await page.click("#shotBtn");
  const download = await dl;
  console.log("暂停/截图按钮正常, 下载文件:", download.suggestedFilename());

  await browser.close();
  console.log(process.exitCode ? "测试失败" : "全部测试通过");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
