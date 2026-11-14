// 节点图数据模型：节点类型、旋转模式、初始故障板与正确解法。

export const NODE_TYPE = {
  FILTER: 'filter',
  GAIN: 'gain',
  DELAY: 'delay',
};

// 每个节点有两个可旋转模式。mode 即旋转档位（0/1）。
export const NODE_MODES = {
  [NODE_TYPE.FILTER]: [
    { label: 'HPF 1200Hz', kind: 'highpass', frequency: 1200, q: 0.7 },
    { label: 'LPF 1800Hz', kind: 'lowpass', frequency: 1800, q: 0.7 },
  ],
  [NODE_TYPE.GAIN]: [
    { label: 'BOOST ×2.8', gain: 2.8 },
    { label: 'PAD ×0.35', gain: 0.35 },
  ],
  // 回声反馈增益由 delay 节点的旋转档位决定。
  [NODE_TYPE.DELAY]: [
    { label: 'FEEDBACK 1.15', delayTime: 0.33, feedback: 1.15 },
    { label: 'FEEDBACK 0.45', delayTime: 0.33, feedback: 0.45 },
  ],
};

let cardSeq = 0;

export function makeCard(type, mode = 0) {
  cardSeq += 1;
  return { id: `card-${cardSeq}`, type, mode };
}

export function modeOf(card) {
  return NODE_MODES[card.type][card.mode];
}

// 旋转：在该节点的两个档位间切换。
export function rotateCard(board, cardId) {
  const next = board.map((card) =>
    card.id === cardId
      ? { ...card, mode: (card.mode + 1) % NODE_MODES[card.type].length }
      : card,
  );
  return next;
}

// 交换：两个槽位上的节点整体互换（含各自旋转档位）。
export function swapCards(board, indexA, indexB) {
  if (indexA === indexB) return board.slice();
  const next = board.slice();
  [next[indexA], next[indexB]] = [next[indexB], next[indexA]];
  return next;
}

// 固定故障板（题目初始状态）：
// 延迟被放在链路最前且处于 1.15 正反馈，增益还是 BOOST——回声环路发散，持续过载。
export function createFaultyBoard() {
  cardSeq = 0;
  return [
    makeCard(NODE_TYPE.DELAY, 0),
    makeCard(NODE_TYPE.GAIN, 0),
    makeCard(NODE_TYPE.FILTER, 0),
  ];
}

// 正确接法：滤波在前，主通道先 PAD 衰减，延迟放最后并切到 0.45 衰减反馈。
// 环路增益 = 0.35 × 0.45 = 0.1575 < 1，回声逐次衰减，主信号不再削波。
export function createSolvedBoard() {
  cardSeq = 0;
  return [
    makeCard(NODE_TYPE.FILTER, 1),
    makeCard(NODE_TYPE.GAIN, 1),
    makeCard(NODE_TYPE.DELAY, 1),
  ];
}

export function isSolved(board) {
  const solved = createSolvedBoard();
  return board.every((card, i) =>
    card.type === solved[i].type && card.mode === solved[i].mode);
}
