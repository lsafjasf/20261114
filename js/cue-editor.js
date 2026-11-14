import { clampTime, round1 } from './constants.js';

export class CueEditor {
  constructor(container, callbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.cues = [];
    this.overlapIds = new Set();
    this.invalidIds = new Set();
  }

  render(cues, overlapIds) {
    this.cues = cues;
    this.overlapIds = new Set(overlapIds);
    this.invalidIds = new Set(overlapIds);
    this.container.innerHTML = '';
    cues.forEach((cue, index) => this.container.appendChild(this.row(cue, index)));
  }

  row(cue, index) {
    const element = document.createElement('div');
    element.className = 'cue-row';
    if (this.overlapIds.has(cue.id)) {
      element.classList.add('invalid');
    }
    element.dataset.id = cue.id;

    const label = document.createElement('label');
    label.textContent = `#${index + 1}`;

    const startCell = this.timeCell(cue, 'start');
    const endCell = this.timeCell(cue, 'end');

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = cue.text;
    textInput.placeholder = '字幕文本';
    textInput.addEventListener('input', () => {
      this.callbacks.onTextChange(cue.id, textInput.value);
    });

    const deleteButton = document.createElement('button');
    deleteButton.className = 'danger';
    deleteButton.type = 'button';
    deleteButton.textContent = '删除';
    deleteButton.addEventListener('click', () => this.callbacks.onDelete(cue.id));

    element.append(label, startCell.wrapper, endCell.wrapper, textInput, deleteButton);

    if (this.overlapIds.has(cue.id)) {
      const message = document.createElement('div');
      message.className = 'row-msg';
      message.textContent = '该字幕与其他字幕时间重叠，保存已被阻止。';
      element.appendChild(message);
    }
    return element;
  }

  timeCell(cue, field) {
    const wrapper = document.createElement('div');
    wrapper.className = 'nudge';

    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−0.1';
    minus.title = field === 'start' ? '入点提前 0.1 秒' : '出点提前 0.1 秒';
    minus.addEventListener('click', () => this.nudge(cue.id, field, -0.1));

    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.1';
    input.min = '0';
    input.max = '30';
    input.value = cue[field].toFixed(1);
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (Number.isFinite(value)) {
        this.callbacks.onTimeChange(cue.id, { [field]: clampTime(value) });
      }
    });

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+0.1';
    plus.title = field === 'start' ? '入点延后 0.1 秒' : '出点延后 0.1 秒';
    plus.addEventListener('click', () => this.nudge(cue.id, field, 0.1));

    wrapper.append(minus, input, plus);
    return { wrapper };
  }

  nudge(id, field, delta) {
    const cue = this.cues.find((item) => item.id === id);
    if (!cue) {
      return;
    }
    this.callbacks.onTimeChange(id, { [field]: clampTime(round1(cue[field] + delta)) });
  }
}
