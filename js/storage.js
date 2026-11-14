import { DEFAULT_CUES, DURATION } from './constants.js';
import { parseVtt, cuesToVtt } from './vtt.js';

const STORAGE_KEY = 'cue-editor-cues-v1';

export function withIds(cues) {
  return cues.map((cue, index) => ({
    id: cue.id || `c${index + 1}-${Date.now()}-${index}`,
    start: cue.start,
    end: cue.end,
    text: cue.text,
  }));
}

export function cloneCues(cues) {
  return cues.map((cue) => ({ ...cue }));
}

export function defaultCues() {
  return cloneCues(DEFAULT_CUES);
}

export function loadCues() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultCues();
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) {
      return defaultCues();
    }
    return withIds(parsed);
  } catch {
    return defaultCues();
  }
}

export function persistCues(cues) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cues));
}

export function exportVttBlob(cues) {
  const content = cuesToVtt(cues);
  return new Blob([content], { type: 'text/vtt;charset=utf-8' });
}

export function importVttText(content) {
  const parsed = parseVtt(content);
  return withIds(
    parsed.map((cue) => ({
      start: Math.min(DURATION, cue.start),
      end: Math.min(DURATION, cue.end),
      text: cue.text,
    }))
  );
}
