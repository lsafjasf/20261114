import { DURATION, clampTime, round1 } from './constants.js';
import { AudioEngine } from './audio-engine.js';
import { Renderer } from './renderer.js';
import { Timeline } from './timeline.js';
import { CueEditor } from './cue-editor.js';
import { validateCues } from './validation.js';
import {
  defaultCues,
  exportVttBlob,
  importVttText,
  loadCues,
  persistCues,
} from './storage.js';

const initialCues = loadCues();
const state = {
  cues: initialCues,
  selectedId: null,
  savedSnapshot: JSON.stringify(initialCues),
};

const engine = new AudioEngine();
const renderer = new Renderer(document.querySelector('#stage'), engine);
const timeline = new Timeline(document.querySelector('#timeline'), {
  onSeek: seek,
  onSelect: selectCue,
  onTimeChange: updateCueTime,
  onDragEnd: () => setStatus('已结束拖动，可继续微调或保存。', 'info'),
});
const editor = new CueEditor(document.querySelector('#cueList'), {
  onTextChange: updateCueText,
  onTimeChange: updateCueTime,
  onDelete: deleteCue,
});

renderer.setActiveCueProvider((time) =>
  state.cues.find((cue) => time >= cue.start && time <= cue.end) || null
);
renderer.start();

engine.onEnded = () => {
  document.querySelector('#playBtn').textContent = '▶ 播放';
};

function validation() {
  return validateCues(state.cues, DURATION);
}

function render() {
  const result = validation();
  timeline.setCues(state.cues, result.overlapIds, state.selectedId);
  editor.render(state.cues, result.overlapIds);
  return result;
}

function setStatus(message, kind = 'info') {
  const element = document.querySelector('#status');
  element.textContent = message;
  element.className = `status ${kind}`;
}

function selectCue(id) {
  state.selectedId = id;
  render();
}

function updateCueText(id, text) {
  const cue = state.cues.find((item) => item.id === id);
  if (cue) {
    cue.text = text;
  }
  render();
}

function updateCueTime(id, patch) {
  const cue = state.cues.find((item) => item.id === id);
  if (!cue) {
    return;
  }
  if (patch.start !== undefined) {
    cue.start = clampTime(round1(patch.start));
  }
  if (patch.end !== undefined) {
    cue.end = clampTime(round1(patch.end));
  }
  if (cue.end <= cue.start) {
    if (patch.end !== undefined) {
      cue.end = clampTime(cue.start + 0.1);
    } else {
      cue.start = clampTime(cue.end - 0.1);
    }
  }
  state.selectedId = id;
  render();
}

function deleteCue(id) {
  state.cues = state.cues.filter((cue) => cue.id !== id);
  if (state.selectedId === id) {
    state.selectedId = null;
  }
  render();
  setStatus('已删除一条字幕。', 'info');
}

function seek(time) {
  engine.seek(clampTime(time));
  timeline.setPlayhead(engine.getCurrentTime());
}

async function togglePlay() {
  const button = document.querySelector('#playBtn');
  if (engine.isPlaying()) {
    engine.pause();
    button.textContent = '▶ 播放';
  } else {
    await engine.play();
    button.textContent = '⏸ 暂停';
  }
}

function save() {
  const result = validation();
  if (!result.valid) {
    setStatus(`保存被阻止：${result.errors.join('；')}`, 'error');
    return false;
  }
  persistCues(state.cues);
  state.savedSnapshot = JSON.stringify(state.cues);
  setStatus(`已保存 ${state.cues.length} 条字幕（本地存储）。`, 'ok');
  return true;
}

function addCue() {
  const id = `c-${Date.now()}`;
  const lastEnd = state.cues.length ? Math.max(...state.cues.map((cue) => cue.end)) : 0;
  const start = clampTime(round1(Math.min(lastEnd + 0.2, DURATION - 2)));
  state.cues.push({ id, start, end: clampTime(start + 1.2), text: '新字幕' });
  state.selectedId = id;
  render();
  setStatus('已新增字幕，请编辑文本与时间。', 'info');
}

function exportVtt() {
  const result = validation();
  if (!result.valid) {
    setStatus(`导出被阻止：${result.errors.join('；')}`, 'error');
    return;
  }
  const blob = exportVttBlob(state.cues);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'subtitles.vtt';
  link.click();
  URL.revokeObjectURL(url);
  setStatus('已导出 subtitles.vtt，可通过“导入 WebVTT”重新载入校验。', 'ok');
}

function importVtt(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = importVttText(String(reader.result));
      const result = validateCues(imported, DURATION);
      if (!imported.length) {
        throw new Error('文件中没有可导入的字幕');
      }
      state.cues = imported;
      state.selectedId = null;
      render();
      const suffix = result.valid
        ? '导入成功，文本与时间已恢复。'
        : `已导入，但存在问题：${result.errors.join('；')}`;
      setStatus(suffix, result.valid ? 'ok' : 'error');
    } catch (error) {
      setStatus(`导入失败：${error.message}`, 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
}

function resetCues() {
  state.cues = defaultCues();
  state.selectedId = null;
  render();
  setStatus('已恢复内置五条示例字幕。', 'info');
}

document.querySelector('#playBtn').addEventListener('click', togglePlay);
document.querySelector('#restartBtn').addEventListener('click', () => {
  engine.stopAll();
  document.querySelector('#playBtn').textContent = '▶ 播放';
  timeline.setPlayhead(0);
  document.querySelector('#timeNow').textContent = '0.0';
});
document.querySelector('#addBtn').addEventListener('click', addCue);
document.querySelector('#saveBtn').addEventListener('click', save);
document.querySelector('#exportBtn').addEventListener('click', exportVtt);
document.querySelector('#importBtn').addEventListener('click', () => {
  document.querySelector('#vttFile').click();
});
document.querySelector('#vttFile').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    importVtt(file);
  }
  event.target.value = '';
});
document.querySelector('#resetBtn').addEventListener('click', resetCues);

function clockLoop() {
  const time = engine.getCurrentTime();
  timeline.setPlayhead(time);
  document.querySelector('#timeNow').textContent = time.toFixed(1);
  window.requestAnimationFrame(clockLoop);
}
clockLoop();

render();
setStatus('已载入五条示例字幕，点击播放试听并查看同步动画。', 'info');
