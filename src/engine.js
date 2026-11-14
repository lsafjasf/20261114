// 望远镜排程核心引擎：纯逻辑，不依赖 DOM。
// 时间单位均为“分钟”，以模拟之夜 19:00 为 t=0。

export const CONFIG = {
  sessionStart: 0,      // 19:00
  sessionEnd: 60,       // 20:00，总时长上限（分钟）
  slewTime: 2,          // 换目标转动时间
  filterTime: 1,        // 换滤色片时间
  initialTarget: 0,     // 初始指向：无目标（0 表示未指向任何星）
  initialFilter: null,  // 初始滤色片：未安装
};

// 三颗固定目标星：窗口依次出现。
// window: 升起到落下的可观测区间（不含月光屏蔽段）
// moonBlocked: 月光过强区间（可能落在窗口内或窗口外）
export const STARS = [
  {
    id: 1,
    name: '天狼星',
    filter: 'R',
    required: 6,
    rise: 2,
    set: 22,
    moonBlocked: [{ start: 4, end: 8 }],
    az: 105, // 地平经度（仅用于画面布局）
  },
  {
    id: 2,
    name: '参宿七',
    filter: 'G',
    required: 8,
    rise: 18,
    set: 42,
    moonBlocked: [{ start: 26, end: 32 }],
    az: 90,
  },
  {
    id: 3,
    name: '北河三',
    filter: 'B',
    required: 5,
    rise: 38,
    set: 60,
    moonBlocked: [{ start: 50, end: 54 }],
    az: 75,
  },
];

export function cloneActions(actions) {
  return actions.map((a) => ({ ...a }));
}

export function starById(id) {
  return STARS.find((s) => s.id === id) || null;
}

// 判断某星在时刻 t 是否位于地平线之上
export function isAboveHorizon(star, t) {
  return t >= star.rise && t <= star.set;
}

// 判断某星在时刻 t 是否受月光屏蔽
export function isMoonBlocked(star, t) {
  return star.moonBlocked.some((m) => t >= m.start && t < m.end);
}

// 判断某星在时刻 t 是否可以有效观测
export function isObservable(star, t) {
  return isAboveHorizon(star, t) && !isMoonBlocked(star, t);
}

// 计算某星的连续可观测窗口（排除月光段后的子区间）
export function observableWindows(star) {
  const windows = [];
  let cursor = star.rise;
  const blocks = [...star.moonBlocked].sort((a, b) => a.start - b.start);
  for (const block of blocks) {
    const bStart = Math.max(block.start, star.rise);
    const bEnd = Math.min(block.end, star.set);
    if (bStart > cursor) windows.push({ start: cursor, end: bStart });
    cursor = Math.max(cursor, bEnd);
  }
  if (cursor < star.set) windows.push({ start: cursor, end: star.set });
  return windows;
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function insideSession(action, issues) {
  if (action.start < CONFIG.sessionStart || action.end > CONFIG.sessionEnd) {
    issues.push(
      `动作「${action.kind}」超出观测夜范围（${CONFIG.sessionStart}-${CONFIG.sessionEnd} 分钟）`
    );
    return false;
  }
  return true;
}

// 运行一次完整排程，返回事件流、有效曝光与判定结果。
export function simulate(actionsInput) {
  const actions = cloneActions(actionsInput).sort((a, b) => a.start - b.start);
  const events = [];
  const issues = [];
  const state = {
    target: CONFIG.initialTarget,
    filter: CONFIG.initialFilter,
    pointingAt: CONFIG.sessionStart, // 指向当前目标的起始时刻
    filterReadyAt: CONFIG.sessionStart,
  };
  const validExposure = new Map(); // starId -> 累计有效曝光分钟

  const log = (time, type, message) => events.push({ time, type, message });

  // 动作重叠检查
  for (let i = 1; i < actions.length; i += 1) {
    if (overlaps(actions[i - 1], actions[i])) {
      issues.push(
        `t=${actions[i].start}：动作时间重叠，望远镜同一时刻只能执行一件事`
      );
    }
  }

  for (const action of actions) {
    if (!insideSession(action, issues)) continue;
    const star = action.starId ? starById(action.starId) : null;

    if (action.kind === 'slew') {
      if (!star) {
        issues.push(`t=${action.start}：转动动作缺少目标星`);
        continue;
      }
      if (action.end - action.start !== CONFIG.slewTime) {
        issues.push(
          `t=${action.start}：转动「${star.name}」耗时必须为 ${CONFIG.slewTime} 分钟`
        );
      }
      log(action.start, 'slew', `转台开始转向 ${star.name}`);
      log(action.end, 'slew-done', `转台锁定 ${star.name}`);
      state.target = star.id;
      state.pointingAt = action.end;
    } else if (action.kind === 'filter') {
      if (!action.filter) {
        issues.push(`t=${action.start}：换色片动作缺少滤色片类型`);
        continue;
      }
      if (action.end - action.start !== CONFIG.filterTime) {
        issues.push(
          `t=${action.start}：换色片耗时必须为 ${CONFIG.filterTime} 分钟`
        );
      }
      log(action.start, 'filter', `开始更换 ${action.filter} 色片`);
      log(action.end, 'filter-done', `${action.filter} 色片就位`);
      state.filter = action.filter;
      state.filterReadyAt = action.end;
    } else if (action.kind === 'expose') {
      if (!star) {
        issues.push(`t=${action.start}：曝光动作缺少目标星`);
        continue;
      }
      const reasons = [];
      if (state.target !== star.id) {
        reasons.push(`望远镜未指向 ${star.name}`);
      } else if (action.start < state.pointingAt) {
        reasons.push('转台尚未完成锁定');
      }
      if (state.filter !== star.filter) {
        reasons.push(`需要 ${star.filter} 色片，当前为 ${state.filter ?? '空'}`);
      } else if (action.start < state.filterReadyAt) {
        reasons.push('色片尚未就位');
      }
      if (reasons.length > 0) {
        const msg = `t=${action.start}：对 ${star.name} 的曝光无效（${reasons.join('；')}）`;
        issues.push(msg);
        log(action.start, 'expose-invalid', msg);
        continue;
      }

      // 逐分钟检查地平线与月光，记录无效区间原因
      const badSegments = [];
      let segStart = null;
      let segReason = null;
      for (let t = action.start; t < action.end; t += 1) {
        let reason = null;
        if (!isAboveHorizon(star, t)) reason = '目标低于地平线';
        else if (isMoonBlocked(star, t)) reason = '月光过强';
        if (reason && segStart === null) {
          segStart = t;
          segReason = reason;
        } else if (!reason && segStart !== null) {
          badSegments.push({ start: segStart, end: t, reason: segReason });
          segStart = null;
        }
      }
      if (segStart !== null) {
        badSegments.push({ start: segStart, end: action.end, reason: segReason });
      }

      const badMinutes = badSegments.reduce((sum, s) => sum + (s.end - s.start), 0);
      const goodMinutes = action.end - action.start - badMinutes;
      for (const seg of badSegments) {
        const msg = `t=${seg.start}-${seg.end}：${star.name}${segReason}，该段曝光作废`;
        issues.push(msg);
        log(seg.start, 'expose-blocked', msg);
      }
      if (goodMinutes > 0) {
        validExposure.set(star.id, (validExposure.get(star.id) || 0) + goodMinutes);
        log(
          action.start,
          'expose',
          `开始曝光 ${star.name}（${action.end - action.start} 分钟，有效 ${goodMinutes} 分钟）`
        );
      }
    } else {
      issues.push(`t=${action.start}：未知动作类型 ${action.kind}`);
    }
  }

  // 错过窗口检测：某星在夜结束前始终未凑齐有效曝光
  const missed = [];
  for (const star of STARS) {
    const got = validExposure.get(star.id) || 0;
    if (got < star.required) {
      missed.push({
        starId: star.id,
        name: star.name,
        required: star.required,
        got,
        windowEnd: star.set,
      });
      log(
        star.set,
        'missed',
        `${star.name} 窗口已于 t=${star.set} 关闭：有效曝光 ${got}/${star.required} 分钟，错过窗口`
      );
    }
  }

  const overTime = actions.some((a) => a.end > CONFIG.sessionEnd);
  const passed = missed.length === 0 && issues.length === 0 && !overTime;

  return {
    events,
    issues,
    missed,
    validExposure: Object.fromEntries(validExposure),
    overTime,
    passed,
  };
}

// 预置可行排程：每颗星都在其首个可观测子窗口内完成曝光
export function goodSchedule() {
  return [
    // 星1：等月光段 4-8 过去后，在 8-22 子窗口内曝光
    { kind: 'slew', starId: 1, start: 8, end: 10 },
    { kind: 'filter', filter: 'R', start: 10, end: 11 },
    { kind: 'expose', starId: 1, start: 11, end: 17 },
    // 星2：月光段 26-32 过后，在 32-42 子窗口内曝光
    { kind: 'slew', starId: 2, start: 17, end: 19 },
    { kind: 'filter', filter: 'G', start: 19, end: 20 },
    { kind: 'expose', starId: 2, start: 32, end: 40 },
    // 星3：升起后、月光段 50-54 之前完成曝光
    { kind: 'slew', starId: 3, start: 40, end: 42 },
    { kind: 'filter', filter: 'B', start: 42, end: 43 },
    { kind: 'expose', starId: 3, start: 44, end: 49 },
  ];
}

// 预置失败排程：贪睡迟到，前两颗星被月光打断 / 窗口关闭
export function badSchedule() {
  return [
    { kind: 'slew', starId: 1, start: 0, end: 2 },
    { kind: 'filter', filter: 'R', start: 2, end: 3 },
    { kind: 'expose', starId: 1, start: 4, end: 12 }, // 4-8 月光，有效仅 4/6
    { kind: 'slew', starId: 2, start: 12, end: 14 },
    { kind: 'filter', filter: 'G', start: 14, end: 15 },
    { kind: 'expose', starId: 2, start: 20, end: 33 }, // 26-32 月光，有效仅 7/8
    { kind: 'slew', starId: 3, start: 34, end: 36 },
    { kind: 'filter', filter: 'B', start: 36, end: 37 },
    { kind: 'expose', starId: 3, start: 50, end: 58 }, // 50-54 月光，有效仅 4/5
  ];
}
