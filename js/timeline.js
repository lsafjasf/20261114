import { CUE_TIMES, DURATION, clampTime, round1 } from './constants.js';

export class Timeline {
  constructor(element, callbacks) {
    this.element = element;
    this.ruler = element.querySelector('#ruler');
    this.track = element.querySelector('#track');
    this.playhead = element.querySelector('#playhead');
    this.callbacks = callbacks;
    this.cues = [];
    this.overlapIds = new Set();
    this.selectedId = null;
    this.dragState = null;
    this.buildRuler();
    this.bindRulerSeek();
  }

  buildRuler() {
    for (let second = 0; second <= DURATION; second += 1) {
      const tick = document.createElement('div');
      tick.className = `tick ${second % 5 === 0 ? 'major' : ''}`;
      tick.style.left = `${(second / DURATION) * 100}%`;
      if (second % 5 === 0) {
        tick.textContent = `${second}s`;
      }
      this.ruler.appendChild(tick);
    }
    CUE_TIMES.forEach((time, index) => {
      const marker = document.createElement('div');
      marker.className = 'cue-marker';
      marker.style.left = `${(time / DURATION) * 100}%`;
      marker.dataset.label = `P${index + 1}`;
      this.track.appendChild(marker);
    });
  }

  bindRulerSeek() {
    this.element.addEventListener('click', (event) => {
      if (event.target.closest('.cue-block')) {
        return;
      }
      const time = this.timeFromEvent(event);
      this.callbacks.onSeek(clampTime(time));
    });
  }

  setCues(cues, overlapIds, selectedId) {
    this.cues = cues;
    this.overlapIds = new Set(overlapIds);
    this.selectedId = selectedId;
    this.renderBlocks();
  }

  renderBlocks() {
    this.track.querySelectorAll('.cue-block').forEach((node) => node.remove());
    this.cues.forEach((cue) => {
      const block = document.createElement('div');
      block.className = 'cue-block';
      if (this.overlapIds.has(cue.id)) {
        block.classList.add('overlap');
      }
      if (cue.id === this.selectedId) {
        block.classList.add('selected');
      }
      block.style.left = `${(cue.start / DURATION) * 100}%`;
      block.style.width = `${((cue.end - cue.start) / DURATION) * 100}%`;
      block.dataset.id = cue.id;
      block.innerHTML =
        '<span class="edge left" data-edge="start"></span>' +
        `<span class="cue-time">${cue.start.toFixed(1)}–${cue.end.toFixed(1)}</span>` +
        cue.text.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch])) +
        '<span class="edge right" data-edge="end"></span>';
      block.addEventListener('pointerdown', (event) => this.startDrag(event, cue));
      this.track.appendChild(block);
    });
  }

  startDrag(event, cue) {
    event.preventDefault();
    event.stopPropagation();
    const edge = event.target.dataset.edge || null;
    this.selectedId = cue.id;
    this.callbacks.onSelect(cue.id);
    this.dragState = {
      id: cue.id,
      edge,
      startX: event.clientX,
      original: { ...cue },
    };
    const onMove = (moveEvent) => this.drag(moveEvent);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.dragState = null;
      this.callbacks.onDragEnd();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  drag(event) {
    if (!this.dragState) {
      return;
    }
    const { id, edge, startX, original } = this.dragState;
    const width = this.element.getBoundingClientRect().width;
    const delta = ((event.clientX - startX) / width) * DURATION;
    let { start, end } = original;
    if (edge === 'start') {
      start = clampTime(original.start + delta);
    } else if (edge === 'end') {
      end = clampTime(original.end + delta);
    } else {
      const length = original.end - original.start;
      start = clampTime(original.start + delta);
      end = round1(start + length);
      if (end > DURATION) {
        end = DURATION;
        start = round1(end - length);
      }
    }
    this.callbacks.onTimeChange(id, { start, end });
  }

  timeFromEvent(event) {
    const rect = this.element.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * DURATION;
  }

  setPlayhead(time) {
    this.playhead.style.left = `${(time / DURATION) * 100}%`;
  }
}
