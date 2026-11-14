/*
 * 盲文转换核心：文本 -> 六点盲文单元序列 -> 自动换行排版
 * 依赖 BRAILLE_DATA（js/braille-data.js）与 pinyinPro（汉字转拼音）
 */
(function (root, factory) {
  const DATA = (typeof module !== 'undefined' && module.exports)
    ? require('./braille-data.js')
    : root.BRAILLE_DATA;
  const mod = factory(DATA);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.Braille = mod;
})(typeof self !== 'undefined' ? self : this, function (DATA) {
  const { INITIALS, FINALS, TONES, LATIN, DIGITS, SIGNS, PUNCT_ZH, PUNCT_EN } = DATA;

  const HANZI_RE = /[㐀-䶿一-鿿]/;
  const INITIAL_LIST = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l',
    'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];

  // ---- 拼音音节 -> 盲文单元 ----
  function normalizeFinal(initial, final) {
    if (initial === 'y') {
      if (final === '') return 'i';
      if (final[0] === 'u') return 'ü' + final.slice(1);       // yu/yue/yuan/yun
      if (final[0] === 'i') return final;                       // yi/yin/ying
      return 'i' + final;                                       // ya/ye/yao/you/yan/yang/yong
    }
    if (initial === 'w') {
      if (final === '') return 'u';
      if (final[0] === 'u') return final;                       // wu
      return 'u' + final;                                       // wa/wo/wai/wei/wan/wen/wang/weng
    }
    if (initial === 'j' || initial === 'q' || initial === 'x') {
      if (final[0] === 'u') return 'ü' + final.slice(1);        // ju/jue/juan/jun
      return final;
    }
    if (final === 'un') return 'uen';                           // lun/dun/...
    return final;
  }

  const FINAL_ALIAS = { iou: 'iu', uei: 'ui', ueng: 'ong' };

  // 返回单元掩码数组；无法识别返回 null
  function syllableToCells(syl, withTone) {
    const m = String(syl).toLowerCase().match(/^([a-zü]+)([1-5])?$/);
    if (!m) return null;
    const base = m[1].replace(/u:/g, 'ü').replace(/v/g, 'ü');
    const tone = m[2] ? Number(m[2]) : 5;

    let initial = '';
    let final = base;
    for (const ini of INITIAL_LIST) {
      if (base.startsWith(ini)) { initial = ini; final = base.slice(ini.length); break; }
    }
    // zhi/chi/shi/ri/zi/ci/si：舌尖元音省略韵母
    if (final === 'i' && ['zh', 'ch', 'sh', 'r', 'z', 'c', 's'].includes(initial)) {
      final = '';
    } else {
      final = normalizeFinal(initial, final);
      if (FINAL_ALIAS[final]) final = FINAL_ALIAS[final];
    }

    const cells = [];
    const realInitial = (initial === 'y' || initial === 'w') ? '' : initial;
    if (realInitial && INITIALS[realInitial] === undefined) return null;
    if (realInitial) cells.push(INITIALS[realInitial]);
    if (final) {
      if (FINALS[final] === undefined) return null;
      cells.push(FINALS[final]);
    }
    if (!cells.length) return null;
    if (withTone && TONES[tone]) cells.push(TONES[tone]);
    return cells;
  }

  // ---- 文本分词 ----
  function segmentText(text) {
    const segs = [];
    let buf = '';
    let kind = '';
    const kindOf = (ch) => {
      if (HANZI_RE.test(ch)) return 'zh';
      if (/[a-zA-Z]/.test(ch)) return 'en';
      if (/[0-9]/.test(ch)) return 'num';
      if (/\s/.test(ch)) return 'space';
      return 'punct';
    };
    for (const ch of text) {
      const k = kindOf(ch);
      if (k !== kind && buf) { segs.push({ kind, text: buf }); buf = ''; }
      kind = k;
      buf += ch;
    }
    if (buf) segs.push({ kind, text: buf });
    return segs;
  }

  // ---- 分词 -> 排版 token ----
  // token: { type, label, cells:[mask...], sticky }
  function buildTokens(text, opts) {
    const withTone = opts.withTone !== false;
    const pinyinFn = opts.pinyinFn; // (hanziRun) => ['wu2','zhang4',...]
    const tokens = [];
    const segs = segmentText(text);
    let prevContent = null; // 上一个非空 token 类型

    const push = (t) => { tokens.push(t); if (t.type !== 'space') prevContent = t.type; };

    for (const seg of segs) {
      if (seg.kind === 'zh') {
        const pys = pinyinFn ? pinyinFn(seg.text) : null;
        for (let i = 0; i < seg.text.length; i++) {
          const ch = seg.text[i];
          const cells = pys && pys[i] ? syllableToCells(pys[i], withTone) : null;
          push({ type: 'zh', label: ch, cells: cells || [0x3f], sticky: true });
        }
      } else if (seg.kind === 'en') {
        const cells = [];
        if (prevContent === 'zh' || prevContent === 'num') cells.push(SIGNS.letter);
        for (const ch of seg.text) {
          const lower = ch.toLowerCase();
          if (ch !== lower) cells.push(SIGNS.capital);
          cells.push(LATIN[lower]);
        }
        push({ type: 'en', label: seg.text, cells, sticky: true });
      } else if (seg.kind === 'num') {
        const cells = [SIGNS.number];
        for (const ch of seg.text) cells.push(DIGITS[ch]);
        push({ type: 'num', label: seg.text, cells, sticky: true });
      } else if (seg.kind === 'space') {
        const count = seg.text.replace(/[^\n]/g, '').length;
        const blanks = seg.text.replace(/\n/g, '').length;
        push({ type: 'space', label: ' ', cells: new Array(Math.max(1, blanks)).fill(0), sticky: false, newlines: count });
      } else {
        const cells = [];
        for (const ch of seg.text) {
          const mapped = PUNCT_ZH[ch] || PUNCT_EN[ch];
          if (mapped) cells.push(...mapped);
          else cells.push(0x3f); // 未识别符号占位
        }
        push({ type: 'punct', label: seg.text, cells, sticky: true, noBreakBefore: true });
      }
    }
    return tokens;
  }

  // ---- 自动换行 ----
  // 返回行数组，每行为掩码数组（0 = 空方）
  function layout(tokens, maxCells) {
    const lines = [[]];
    const cur = () => lines[lines.length - 1];
    const newLine = () => { if (cur().length || lines.length === 0) lines.push([]); };

    for (const tok of tokens) {
      if (tok.type === 'space') {
        if (tok.newlines > 0) { for (let i = 0; i < tok.newlines; i++) newLine(); continue; }
        if (cur().length > 0 && cur().length < maxCells) cur().push(0);
        continue;
      }
      const w = tok.cells.length;
      if (cur().length > 0 && cur().length + w > maxCells) {
        // 去掉行尾空方
        while (cur().length && cur()[cur().length - 1] === 0) cur().pop();
        newLine();
      }
      if (w <= maxCells) {
        for (const c of tok.cells) {
          if (cur().length >= maxCells) newLine();
          cur().push(c);
        }
      } else {
        // 超长 token 硬切分
        for (const c of tok.cells) {
          if (cur().length >= maxCells) newLine();
          cur().push(c);
        }
      }
    }
    while (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
    return lines;
  }

  function maskToChar(mask) { return String.fromCharCode(0x2800 + mask); }
  function linesToUnicode(lines) {
    return lines.map((l) => l.map(maskToChar).join('')).join('\n');
  }

  function convert(text, opts) {
    const tokens = buildTokens(text, opts || {});
    const lines = layout(tokens, (opts && opts.maxCells) || 24);
    return { tokens, lines };
  }

  return { syllableToCells, segmentText, buildTokens, layout, convert, maskToChar, linesToUnicode };
});
