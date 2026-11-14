const TIME_PATTERN = /^(\d{1,3}):(\d{2}):(\d{2})\.(\d{1,3})$/;

export function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`非法时间值: ${seconds}`);
  }
  const totalMs = Math.round(seconds * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(millis, 3)}`;
}

export function parseTimestamp(token) {
  const match = TIME_PATTERN.exec(token);
  if (!match) {
    throw new Error(`时间戳格式错误: ${token}`);
  }
  const [, hours, minutes, seconds, fraction] = match;
  if (Number(minutes) > 59 || Number(seconds) > 59) {
    throw new Error(`时间戳超出范围: ${token}`);
  }
  const fractionMs = Number(fraction.padEnd(3, '0'));
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + fractionMs / 1000;
}

function escapeVttText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeVttText(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function cuesToVtt(cues) {
  const lines = ['WEBVTT', ''];
  for (const cue of cues) {
    lines.push(`${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}`);
    lines.push(escapeVttText(cue.text.trim()));
    lines.push('');
  }
  return lines.join('\n');
}

function splitBlocks(content) {
  return content
    .replace(/^﻿/, '')
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

export function parseVtt(content) {
  const blocks = splitBlocks(content);
  if (!blocks.length || !/^WEBVTT(\s|$)/.test(blocks[0])) {
    throw new Error('缺少 WEBVTT 文件头');
  }
  const cues = [];
  for (const block of blocks.slice(1)) {
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(block)) {
      continue;
    }
    const rows = block.split(/\r?\n/);
    let timingRow = rows[0];
    let textRows = rows.slice(1);
    if (!timingRow.includes('-->')) {
      timingRow = rows[1];
      textRows = rows.slice(2);
    }
    if (!timingRow || !timingRow.includes('-->')) {
      throw new Error(`字幕块缺少时间行: ${block}`);
    }
    const [startToken, endTokenRaw] = timingRow.split('-->').map((part) => part.trim());
    const endToken = endTokenRaw.split(/\s+/)[0];
    const start = parseTimestamp(startToken);
    const end = parseTimestamp(endToken);
    const text = unescapeVttText(textRows.join('\n')).trim();
    cues.push({ start, end, text });
  }
  return cues;
}
