import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { DEFAULT_CUES, DURATION } from '../js/constants.js';
import { cuesToVtt, parseVtt, formatTimestamp, parseTimestamp } from '../js/vtt.js';
import { validateCues } from '../js/validation.js';

test('内置五条示例字幕均为合法字幕', () => {
  assert.equal(DEFAULT_CUES.length, 5);
  const result = validateCues(DEFAULT_CUES, DURATION);
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.deepEqual(result.overlapIds, []);
  for (const cue of DEFAULT_CUES) {
    assert.ok(cue.text.length > 0);
    assert.ok(cue.start >= 0 && cue.end <= DURATION);
    assert.ok(cue.end > cue.start);
  }
});

test('WebVTT 导出后重新导入，文本与时间完全恢复', () => {
  const vtt = cuesToVtt(DEFAULT_CUES);
  assert.ok(vtt.startsWith('WEBVTT\n'));
  const imported = parseVtt(vtt);
  assert.equal(imported.length, DEFAULT_CUES.length);
  imported.forEach((cue, index) => {
    const expected = DEFAULT_CUES[index];
    assert.equal(cue.text, expected.text);
    assert.equal(cue.start, expected.start);
    assert.equal(cue.end, expected.end);
  });
});

test('VTT 文件落盘后再读取，回读结果仍与原始数据一致', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vtt-'));
  try {
    const file = path.join(dir, 'subtitles.vtt');
    await writeFile(file, cuesToVtt(DEFAULT_CUES), 'utf-8');
    const content = await readFile(file, 'utf-8');
    const imported = parseVtt(content);
    assert.deepEqual(
      imported.map(({ start, end, text }) => [start, end, text]),
      DEFAULT_CUES.map(({ start, end, text }) => [start, end, text])
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('时间戳支持 0.1 秒精度并可双向转换', () => {
  for (const cue of DEFAULT_CUES) {
    const startStamp = formatTimestamp(cue.start);
    const endStamp = formatTimestamp(cue.end);
    assert.equal(parseTimestamp(startStamp), cue.start);
    assert.equal(parseTimestamp(endStamp), cue.end);
  }
  assert.equal(formatTimestamp(0), '00:00:00.000');
  assert.equal(parseTimestamp('00:00:28.400'), 28.4);
});
