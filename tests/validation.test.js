import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CUES } from '../js/constants.js';
import { validateCues } from '../js/validation.js';
import { cuesToVtt, parseVtt } from '../js/vtt.js';

test('字幕重叠时校验失败并标出重叠 id，保存应被阻止', () => {
  const overlapping = DEFAULT_CUES.map((cue) => ({ ...cue }));
  overlapping[1].start = 4.0;
  overlapping[1].end = 5.0;
  const result = validateCues(overlapping);
  assert.equal(result.valid, false);
  assert.ok(result.overlapIds.includes(overlapping[0].id));
  assert.ok(result.overlapIds.includes(overlapping[1].id));
  assert.ok(result.errors.some((message) => message.includes('重叠')));
});

test('首尾相接（出点等于下一条入点）不算重叠', () => {
  const touching = [
    { id: 'a', start: 0, end: 1.5, text: '甲' },
    { id: 'b', start: 1.5, end: 3, text: '乙' },
  ];
  const result = validateCues(touching);
  assert.equal(result.valid, true);
});

test('0.1 秒微调后仍可通过 VTT 往返保持一致', () => {
  const nudged = DEFAULT_CUES.map((cue) => ({
    ...cue,
    start: Math.round((cue.start + 0.1) * 10) / 10,
    end: Math.round((cue.end - 0.1) * 10) / 10,
  }));
  assert.equal(validateCues(nudged).valid, true);
  const imported = parseVtt(cuesToVtt(nudged));
  imported.forEach((cue, index) => {
    assert.equal(cue.start, nudged[index].start);
    assert.equal(cue.end, nudged[index].end);
    assert.equal(cue.text, nudged[index].text);
  });
});

test('空文本、反向时间与越界时间均被拒绝', () => {
  const bad = [
    { id: 'x', start: 5, end: 4, text: '' },
    { id: 'y', start: 29, end: 31, text: '越界' },
  ];
  const result = validateCues(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 3);
});

test('VTT 解析对带 cue identifier、NOTE 与设置字段的文件具备容错', () => {
  const vtt = [
    'WEBVTT',
    '',
    'NOTE 这是注释，应被忽略',
    '',
    'cue-1',
    '00:00:02.800 --> 00:00:04.200 align:start',
    '提示音一：系统就绪',
    '',
    '00:00:08.800 --> 00:00:10.200',
    '提示音二：开始采集',
    '',
  ].join('\n');
  const cues = parseVtt(vtt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 2.8);
  assert.equal(cues[0].text, '提示音一：系统就绪');
  assert.equal(cues[1].end, 10.2);
});
