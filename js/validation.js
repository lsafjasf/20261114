import { DURATION } from './constants.js';

const EPSILON = 1e-6;

export function validateCues(cues, duration = DURATION) {
  const errors = [];
  const overlapIds = new Set();

  cues.forEach((cue, index) => {
    const label = `第 ${index + 1} 条字幕`;
    if (!cue.text || !cue.text.trim()) {
      errors.push(`${label}文本为空`);
    }
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end)) {
      errors.push(`${label}时间不是数字`);
      return;
    }
    if (cue.start < -EPSILON || cue.end > duration + EPSILON) {
      errors.push(`${label}超出 0–${duration} 秒范围`);
    }
    if (cue.end <= cue.start + EPSILON) {
      errors.push(`${label}出点必须晚于入点`);
    }
  });

  const ordered = cues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => Number.isFinite(cue.start) && Number.isFinite(cue.end))
    .sort((a, b) => a.cue.start - b.cue.start || a.cue.end - b.cue.end);

  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1].cue;
    const current = ordered[i].cue;
    if (current.start < previous.end - EPSILON) {
      overlapIds.add(previous.id);
      overlapIds.add(current.id);
      errors.push(
        `字幕时间重叠：「${previous.text || '未命名'}」与「${current.text || '未命名'}」`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    overlapIds: [...overlapIds],
  };
}

export function hasOverlap(cues) {
  return validateCues(cues).overlapIds.length > 0;
}
