export const DURATION = 30;

export const BEAT_INTERVAL = 0.5;

export const CUE_FREQS = [523.25, 587.33, 659.25, 783.99, 880.0];

export const CUE_TIMES = [3, 9, 15, 21, 27];

export const BEEP_DURATION = 0.18;

export const DEFAULT_CUES = [
  { id: 'c1', start: 2.8, end: 4.2, text: '提示音一：系统就绪' },
  { id: 'c2', start: 8.8, end: 10.2, text: '提示音二：开始采集' },
  { id: 'c3', start: 14.8, end: 16.2, text: '提示音三：数据同步' },
  { id: 'c4', start: 20.8, end: 22.2, text: '提示音四：波形校验' },
  { id: 'c5', start: 26.8, end: 28.4, text: '提示音五：流程完成' },
];

export function round1(value) {
  return Math.round(value * 10) / 10;
}

export function clampTime(value) {
  return Math.min(DURATION, Math.max(0, round1(value)));
}
