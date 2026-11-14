(function () {
  "use strict";

  const DOUGHS = [
    {
      id: "ciabatta",
      name: "海盐恰巴塔",
      shortName: "恰巴塔",
      cue: "气孔活跃 · 先熟",
      note: "高水合面团，发酵最积极，也最容易醒过头。",
      start: 48,
      baseRate: 2.15,
      idealTemp: 27,
      idealHumidity: 75,
      color: "#e8bd75",
      highlight: "#f3d99e",
      shadow: "#bd8241",
      accent: "#b96734",
      flour: "#f7ead1",
      seed: 17,
    },
    {
      id: "milk",
      name: "黄油小餐包",
      shortName: "小餐包",
      cue: "富油面团 · 居中",
      note: "黄油让面筋松弛，喜欢再暖一点、再润一点。",
      start: 29,
      baseRate: 1.95,
      idealTemp: 29,
      idealHumidity: 79,
      color: "#efc47f",
      highlight: "#ffe1a8",
      shadow: "#c38a45",
      accent: "#bc7b3d",
      flour: "#f9eed9",
      seed: 39,
    },
    {
      id: "rye",
      name: "黑麦酸种",
      shortName: "酸种",
      cue: "低温慢发 · 最后",
      note: "黑麦脾气慢，过暖反而会失去漂亮的酸香。",
      start: 10,
      baseRate: 1.79,
      idealTemp: 24,
      idealHumidity: 70,
      color: "#bd9361",
      highlight: "#d6b183",
      shadow: "#886244",
      accent: "#765032",
      flour: "#e8d2b3",
      seed: 67,
    },
  ];

  window.Bakery = window.Bakery || {};
  window.Bakery.CONFIG = {
    doughs: Object.freeze(DOUGHS.map((dough) => Object.freeze(dough))),
    readyAt: 76,
    overAt: 100,
    bakeSeconds: 7,
    recoverySeconds: 5,
    tempRange: [18, 36],
    humidityRange: [55, 95],
  };
})();
