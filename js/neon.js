(() => {
  "use strict";

  const LOOP_SECONDS = 8;
  const MIN_VISIBLE = 0.26;
  const SCENE = {
    width: 1280,
    height: 720,
    sign: { x: 100, y: 66, w: 1080, h: 258 },
    streetY: 486
  };

  const DEFAULTS = [
    { cycle: 1.6, duty: 0.62, hue: 298, sweep: 0.80, delay: 0.14, fault: 0.70 },
    { cycle: 2.8, duty: 0.84, hue: 176, sweep: 0.22, delay: 1.25, fault: 0.28 },
    { cycle: 1.2, duty: 0.55, hue: 328, sweep: 1.00, delay: 0.38, fault: 0.90 },
    { cycle: 3.6, duty: 0.72, hue: 42, sweep: 0.55, delay: 2.10, fault: 0.42 },
    { cycle: 2.2, duty: 0.66, hue: 198, sweep: 0.72, delay: 0.70, fault: 0.60 },
    { cycle: 1.9, duty: 0.76, hue: 112, sweep: 0.36, delay: 0.52, fault: 0.36 },
    { cycle: 3.1, duty: 0.58, hue: 262, sweep: 0.90, delay: 1.55, fault: 0.78 }
  ];

  const GLYPHS = {
    A: ["M .04 1 L .28 .07 Q .30 0 .33 .07 L .58 1", "M .12 .68 L .49 .68"],
    B: ["M .06 0 L .06 1", "M .06 0 L .30 0 Q .48 0 .48 .24 Q .48 .47 .29 .48 L .06 .48", "M .29 .48 Q .56 .48 .56 .73 Q .56 1 .29 1 L .06 1"],
    C: ["M .52 .12 Q .42 0 .26 0 Q .03 0 .03 .5 Q .03 1 .26 1 Q .42 1 .52 .88"],
    D: ["M .06 0 L .06 1", "M .06 0 L .26 0 Q .54 0 .54 .5 Q .54 1 .26 1 L .06 1"],
    E: ["M .54 0 L .06 0 L .06 1 L .54 1", "M .06 .49 L .44 .49"],
    F: ["M .54 0 L .06 0 L .06 1", "M .06 .48 L .43 .48"],
    G: ["M .52 .12 Q .42 0 .26 0 Q .03 0 .03 .5 Q .03 1 .26 1 Q .43 1 .52 .84", "M .52 .51 L .29 .51 L .29 .76"],
    H: ["M .06 0 L .06 1", "M .55 0 L .55 1", "M .06 .5 L .55 .5"],
    I: ["M .31 0 L .31 1", "M .20 .02 L .42 .02", "M .20 .98 L .42 .98"],
    J: ["M .48 0 L .48 .74 Q .48 1 .25 1 Q .06 1 .06 .84"],
    K: ["M .07 0 L .07 1", "M .51 .03 L .07 .5", "M .16 .48 L .53 1"],
    L: ["M .07 0 L .07 1 L .52 1"],
    M: ["M .03 1 L .03 .06 Q .03 0 .08 .07 L .29 .56 L .50 .07 Q .55 0 .55 .06 L .55 1"],
    N: ["M .05 1 L .05 .06 Q .05 0 .10 .08 L .53 .94 L .55 .98 L .55 0"],
    O: ["M .29 0 Q .03 0 .03 .29 L .03 .71 Q .03 1 .29 1 L .33 1 Q .58 1 .58 .71 L .58 .29 Q .58 0 .33 0"],
    P: ["M .06 0 L .06 1", "M .06 0 L .30 0 Q .52 0 .52 .25 Q .52 .49 .30 .5 L .06 .5"],
    Q: ["M .29 0 Q .03 0 .03 .29 L .03 .71 Q .03 1 .29 1 L .33 1 Q .58 1 .58 .71 L .58 .29 Q .58 0 .33 0", "M .38 .72 L .58 1"],
    R: ["M .06 0 L .06 1", "M .06 0 L .30 0 Q .52 0 .52 .25 Q .52 .49 .30 .5 L .06 .5", "M .32 .5 L .56 1"],
    S: ["M .53 .12 Q .45 0 .28 0 Q .06 0 .05 .24 Q .04 .45 .28 .49 Q .52 .53 .53 .75 Q .54 1 .29 1 Q .10 1 .04 .86"],
    T: ["M .03 0 L .59 0", "M .31 0 L .31 1"],
    U: ["M .06 0 L .06 .72 Q .06 1 .31 1 Q .56 1 .56 .72 L .56 0"],
    V: ["M .04 0 L .31 1 L .58 0"],
    W: ["M .02 0 L .15 .78 L .29 .22 L .43 .78 L .56 0"],
    X: ["M .04 0 L .56 1", "M .56 0 L .04 1"],
    Y: ["M .04 0 L .30 .47", "M .56 0 L .30 .47 L .30 1"],
    Z: ["M .04 0 L .56 0 L .07 1 L .58 1"]
  };

  const GLYPH_CACHE = new Map();

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const positiveMod = (value, mod) => ((value % mod) + mod) % mod;
  const smoothstep = (edge0, edge1, value) => {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const loopDistance = (a, b) => {
    const raw = Math.abs(a - b);
    return Math.min(raw, LOOP_SECONDS - raw);
  };
  const hash = (seed) => {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  function glyphPaths(char) {
    if (!GLYPH_CACHE.has(char)) {
      const data = GLYPHS[char] || GLYPHS["?"] || [];
      GLYPH_CACHE.set(char, data.map((commands) => new Path2D(commands)));
    }
    return GLYPH_CACHE.get(char);
  }

  function sampleLetter(rawLetter, time, index) {
    const letter = {
      cycle: clamp(rawLetter.cycle || 2, 1, 4),
      duty: clamp(rawLetter.duty || 0.65, 0.35, 0.9),
      hue: positiveMod(rawLetter.hue || 0, 360),
      sweep: clamp(rawLetter.sweep || 0, 0, 1),
      delay: clamp(rawLetter.delay || 0, 0, 3.9),
      fault: clamp(rawLetter.fault || 0, 0, 1)
    };
    const localTime = positiveMod(time - letter.delay, LOOP_SECONDS);
    const phase = positiveMod(localTime, letter.cycle) / letter.cycle;
    const fade = Math.min(0.035, letter.duty * 0.12, (1 - letter.duty) * 0.18);
    let gate = 0;

    if (phase < letter.duty) {
      gate = smoothstep(0, fade, phase) * smoothstep(0, fade, letter.duty - phase);
    }

    const contact =
      0.91 +
      0.09 * Math.sin(time * 13.7 + index * 2.31) * Math.sin(time * 5.3 + index * 1.17);
    const rawEnergy = gate * contact;
    const energy = MIN_VISIBLE + (1 - MIN_VISIBLE) * rawEnergy;
    const glowPulse = 0.88 + 0.12 * Math.sin(time * 9.2 + index * 1.8);
    const hueShift = letter.fault * 9 * Math.sin(time * 4.1 + index * 0.7);
    const hue = positiveMod(letter.hue + hueShift, 360);
    const sweepPos = positiveMod(
      time * (0.24 + letter.sweep * 0.28) - letter.delay * 0.2 + index * 0.17,
      1.35
    ) - 0.18;

    return {
      energy,
      gate,
      rawEnergy,
      contact,
      glowPulse,
      hue,
      sweepPos: clamp(sweepPos, -0.18, 1.17),
      sweep: letter.sweep,
      fault: letter.fault,
      phase,
      localTime
    };
  }

  function sparkState(time, index) {
    const eventTimes = [
      0.82 + index * 0.47,
      2.34 + index * 0.73,
      5.18 + index * 0.31,
      7.06 + index * 0.89
    ];
    let distance = Infinity;
    let event = 0;

    eventTimes.forEach((eventTime, eventIndex) => {
      const candidate = loopDistance(time, positiveMod(eventTime, LOOP_SECONDS));
      if (candidate < distance) {
        distance = candidate;
        event = eventIndex;
      }
    });

    if (distance > 0.2) {
      return null;
    }

    const life = 1 - distance / 0.2;
    return {
      life,
      strength: Math.pow(life, 0.7),
      seed: index * 37 + event * 13 + Math.floor(time * 60)
    };
  }

  window.NeonEngine = {
    LOOP_SECONDS,
    MIN_VISIBLE,
    SCENE,
    DEFAULTS,
    clamp,
    positiveMod,
    hash,
    glyphPaths,
    sampleLetter,
    sparkState
  };
})();
