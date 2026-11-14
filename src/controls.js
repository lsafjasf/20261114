// 构建控制单元并维护当前参数状态。滑块上不显示噪声频率，只显示玩家自己设定的值。

export function createInitialState() {
  return {
    notches: [0, 1, 2, 3].map(() => ({ frequency: 1000, q: 1 })),
    phases: [0, 1].map(() => ({ phaseDeg: 54, wet: 0 })),
  };
}

function slider(parent, { min, max, step, value, onInput }) {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  input.addEventListener('input', () => onInput(parseFloat(input.value)));
  parent.appendChild(input);
  return input;
}

function row(parent, labelText, valueText, opts) {
  const rowEl = document.createElement('div');
  rowEl.className = 'row';
  const label = document.createElement('label');
  const name = document.createElement('span');
  name.textContent = labelText;
  const val = document.createElement('span');
  val.className = 'value';
  val.textContent = valueText;
  label.append(name, val);
  rowEl.appendChild(label);
  const input = slider(rowEl, opts);
  parent.appendChild(rowEl);
  return { rowEl, val, input };
}

export function buildControls(engine, state, onChange) {
  const notchRack = document.getElementById('notchRack');
  const phaseRack = document.getElementById('phaseRack');
  notchRack.innerHTML = '';
  phaseRack.innerHTML = '';
  const inputs = { notches: [], phases: [] };

  state.notches.forEach((c, i) => {
    const unit = document.createElement('div');
    unit.className = 'unit';

    const freqRow = row(unit, '中心频率', `${c.frequency} Hz`, {
      min: 60, max: 4000, step: 1, value: c.frequency,
      onInput: (v) => {
        c.frequency = v;
        freqRow.val.textContent = `${v} Hz`;
        engine.setNotch(i, { frequency: v });
        onChange();
      },
    });

    const qRow = row(unit, 'Q（深度）', c.q.toFixed(1), {
      min: 0.5, max: 40, step: 0.1, value: c.q,
      onInput: (v) => {
        c.q = v;
        qRow.val.textContent = v.toFixed(1);
        engine.setNotch(i, { q: v });
        onChange();
      },
    });

    const title = document.createElement('h3');
    title.textContent = `陷波器 N${i + 1}`;
    unit.insertBefore(title, unit.firstChild);

    notchRack.appendChild(unit);
    inputs.notches.push({ frequency: freqRow.input, q: qRow.input });
  });

  state.phases.forEach((c, i) => {
    const unit = document.createElement('div');
    unit.className = 'unit';

    const phaseRow = row(unit, '相位角', `${c.phaseDeg}°`, {
      min: 10, max: 180, step: 1, value: c.phaseDeg,
      onInput: (v) => {
        c.phaseDeg = v;
        phaseRow.val.textContent = `${v}°`;
        engine.setPhase(i, { phaseDeg: v });
        onChange();
      },
    });

    const wetRow = row(unit, '对消强度', `${Math.round(c.wet * 100)}%`, {
      min: 0, max: 1, step: 0.01, value: c.wet,
      onInput: (v) => {
        c.wet = v;
        wetRow.val.textContent = `${Math.round(v * 100)}%`;
        engine.setPhase(i, { wet: v });
        onChange();
      },
    });

    const title = document.createElement('h3');
    title.textContent = `相位 P${i + 1}（延迟反相对消）`;
    unit.insertBefore(title, unit.firstChild);

    phaseRack.appendChild(unit);
    inputs.phases.push({ phaseDeg: phaseRow.input, wet: wetRow.input });
  });
  return inputs;
}
