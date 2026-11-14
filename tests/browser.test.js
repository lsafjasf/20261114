import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

async function startServer() {
  const server = createServer(async (req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    try {
      const content = await readFile(path.join(root, urlPath));
      res.writeHead(200, { 'content-type': mime[path.extname(urlPath)] || 'application/octet-stream' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function launch() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: path.join(
      os.homedir(),
      '.cache/puppeteer/chrome/linux-157.0.8103.50/chrome-linux64/chrome'
    ),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files'],
  });
  return browser;
}

test('浏览器端：五条字幕渲染、播放暂停、拖动与微调、重叠拦截、VTT 回读', async () => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1000 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(msg.text());
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });

    const rowCount = await page.$$eval('.cue-row', (rows) => rows.length);
    assert.equal(rowCount, 5);
    const blockCount = await page.$$eval('.cue-block', (blocks) => blocks.length);
    assert.equal(blockCount, 5);

    const initial = await page.$$eval('.cue-block', (blocks) =>
      blocks.map((block) => block.querySelector('.cue-time').textContent)
    );
    assert.deepEqual(initial, ['2.8–4.2', '8.8–10.2', '14.8–16.2', '20.8–22.2', '26.8–28.4']);

    await page.click('#playBtn');
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(await page.$eval('#playBtn', (btn) => btn.textContent), '⏸ 暂停');
    const runningTime = await page.$eval('#timeNow', (el) => Number(el.textContent));
    assert.ok(runningTime > 0, `播放头应前进，实际 ${runningTime}`);
    await page.click('#playBtn');
    assert.equal(await page.$eval('#playBtn', (btn) => btn.textContent), '▶ 播放');

    const firstBlock = await page.$('.cue-block');
    const boxBefore = await firstBlock.boundingBox();
    await page.mouse.move(boxBefore.x + boxBefore.width / 2, boxBefore.y + boxBefore.height / 2);
    await page.mouse.down();
    await page.mouse.move(boxBefore.x + boxBefore.width / 2 + 40, boxBefore.y + boxBefore.height / 2, { steps: 8 });
    await page.mouse.up();
    const afterDrag = await page.$eval('.cue-block .cue-time', (el) => el.textContent);
    assert.notEqual(afterDrag, initial[0]);
    const [dragStart] = afterDrag.split('–').map(Number);
    assert.ok(Math.abs(dragStart - 4.0) < 0.21, `拖动后入点应约为 4.0，实际 ${dragStart}`);

    await page.$$eval('.cue-row', (rows) => rows[0].querySelectorAll('button')[1].click());
    const nudged = await page.$eval('.cue-block .cue-time', (el) => el.textContent);
    assert.equal(Number(nudged.split('–')[0]), Number((dragStart + 0.1).toFixed(1)));

    await page.click('#resetBtn');
    const edgeBox = await (await page.$('.cue-block .edge.right')).boundingBox();
    await page.mouse.move(edgeBox.x + 2, edgeBox.y + edgeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(edgeBox.x + 36, edgeBox.y + edgeBox.height / 2, { steps: 6 });
    await page.mouse.up();
    const resized = await page.$eval('.cue-block .cue-time', (el) => el.textContent);
    const [resizedStart, resizedEnd] = resized.split('–').map(Number);
    assert.equal(resizedStart, 2.8);
    assert.ok(Math.abs(resizedEnd - 5.3) < 0.21, `右边缘拖动后出点应约为 5.3，实际 ${resizedEnd}`);

    await page.click('#resetBtn');
    await page.$$eval('.cue-row', (rows) => {
      const startInput = rows[1].querySelectorAll('input[type="number"]')[0];
      startInput.value = '3.5';
      startInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('#saveBtn');
    const blockedStatus = await page.$eval('#status', (el) => ({ text: el.textContent, cls: el.className }));
    assert.match(blockedStatus.text, /保存被阻止/);
    assert.match(blockedStatus.cls, /error/);
    const overlapBlocks = await page.$$eval('.cue-block.overlap', (blocks) => blocks.length);
    assert.ok(overlapBlocks >= 2);

    await page.click('#resetBtn');
    await page.click('#saveBtn');
    assert.match(await page.$eval('#status', (el) => el.textContent), /已保存/);

    const exportContent = await page.evaluate(async () => {
      const { cuesToVtt } = await import('/js/vtt.js');
      const { DEFAULT_CUES } = await import('/js/constants.js');
      return cuesToVtt(DEFAULT_CUES);
    });
    assert.match(exportContent, /WEBVTT/);
    assert.match(exportContent, /00:00:02\.800 --> 00:00:04\.200/);

    const restored = await page.evaluate(async (vtt) => {
      const { parseVtt } = await import('/js/vtt.js');
      return parseVtt(vtt);
    }, exportContent);
    assert.equal(restored.length, 5);
    assert.deepEqual(
      restored.map((cue) => [cue.start, cue.end, cue.text]),
      [
        [2.8, 4.2, '提示音一：系统就绪'],
        [8.8, 10.2, '提示音二：开始采集'],
        [14.8, 16.2, '提示音三：数据同步'],
        [20.8, 22.2, '提示音四：波形校验'],
        [26.8, 28.4, '提示音五：流程完成'],
      ]
    );

    const vttPath = path.join(root, 'artifacts', 'subtitles.vtt');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(vttPath, exportContent, 'utf-8');

    const fileInput = await page.$('#vttFile');
    await fileInput.uploadFile(vttPath);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const importedStatus = await page.$eval('#status', (el) => el.textContent);
    assert.match(importedStatus, /导入成功/);
    const importedRows = await page.$$eval('.cue-row input[type="text"]', (inputs) =>
      inputs.map((input) => input.value)
    );
    assert.deepEqual(importedRows, restored.map((cue) => cue.text));
    const importedTimes = await page.$$eval('.cue-block .cue-time', (els) =>
      els.map((el) => el.textContent)
    );
    assert.deepEqual(importedTimes, initial);

    assert.deepEqual(errors, []);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
});
