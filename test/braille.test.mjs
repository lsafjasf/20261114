// 盲文转换核心测试：node test/braille.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Braille = require('../js/braille.js');
const { pinyin } = require('../lib/pinyin-pro.umd.js');

const pinyinFn = (run) => pinyin(run, { toneType: 'num', type: 'array' });
const U = (lines) => Braille.linesToUnicode(lines);
let failures = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`  期望: ${JSON.stringify(expected)}\n  实际: ${JSON.stringify(actual)}`);
}

// 1. 英文一级盲文 + 大写号
check('Hello', U(Braille.convert('Hello', { maxCells: 40 }).lines), '⠠⠓⠑⠇⠇⠕');
check('braille', U(Braille.convert('braille', { maxCells: 40 }).lines), '⠃⠗⠁⠊⠇⠇⠑');

// 2. 数字号切换：2026 -> ⠼ b j b f
check('2026', U(Braille.convert('2026', { maxCells: 40 }).lines), '⠼⠃⠚⠃⠋');

// 3. 数字后紧跟 a-j 字母需字母号分隔：3F -> ⠼c ⠰(字母号) ⠠(大写) f
check('3F', U(Braille.convert('3F', { maxCells: 40 }).lines), '⠼⠉⠰⠠⠋');

// 4. 中文音节：中 zhong1 = zh(34) ong(256) 阴平(1)
check('中(标调)', U(Braille.convert('中', { maxCells: 10, pinyinFn }).lines), '⠌⠲⠁');
check('中(不标调)', U(Braille.convert('中', { maxCells: 10, pinyinFn, withTone: false }).lines), '⠌⠲');

// 5. 整体认读：知 zhi1 = zh(34) + 阴平(1)；四 si4 = s(234) + 去声(23)
check('知', U(Braille.convert('知', { maxCells: 10, pinyinFn }).lines), '⠌⠁');
check('四', U(Braille.convert('四', { maxCells: 10, pinyinFn }).lines), '⠎⠆');

// 6. j/q/x + ü：去 qu4 = q(13) ü(346) 去声(23)；绿 lü4 = l(123) ü(346) 去声
check('去', U(Braille.convert('去', { maxCells: 10, pinyinFn }).lines), '⠅⠬⠆');
check('绿', U(Braille.convert('绿', { maxCells: 10, pinyinFn }).lines), '⠇⠬⠆');

// 7. 零声母 y/w：一 yi1 = i(24) 阴平；无 wu2 = u(136) 阳平
check('一', U(Braille.convert('一', { maxCells: 10, pinyinFn }).lines), '⠊⠁');
check('无', U(Braille.convert('无', { maxCells: 10, pinyinFn }).lines), '⠥⠂');

// 8. 中英混排：中文后英文需字母号(56)。出 chu1 口 kou3 + ⠰ + ⠠E x i t
check('出口Exit', U(Braille.convert('出口Exit', { maxCells: 40, pinyinFn }).lines),
  '⠟⠥⠁⠅⠷⠄⠰⠠⠑⠭⠊⠞');

// 9. 中文标点：，= (5)
check('你好，世界', U(Braille.convert('你好，世界', { maxCells: 40, pinyinFn }).lines),
  '⠝⠊⠄⠓⠖⠄⠐⠱⠆⠛⠑⠆');

// 10. 自动换行：maxCells=8，长混排文本应折行且行宽不超 8
{
  const { lines } = Braille.convert('无障碍通道 Accessible Route 50米', { maxCells: 8, pinyinFn });
  check('换行行数>1', String(lines.length > 1), 'true');
  check('换行行宽<=8', String(lines.every((l) => l.length <= 8)), 'true');
  check('换行不丢字（总方数守恒）',
    String(lines.flat().filter((c) => c !== 0).length),
    String(Braille.convert('无障碍通道 Accessible Route 50米', { maxCells: 100, pinyinFn })
      .lines.flat().filter((c) => c !== 0).length));
}

// 11. 英文单词不被拆散（宽度足够时整词下移）
{
  const { lines } = Braille.convert('ab cdefgh ij', { maxCells: 8 });
  check('整词换行', U(lines), '⠁⠃\n⠉⠙⠑⠋⠛⠓\n⠊⠚');
}

// 12. 多音字：重庆 -> chong2 qing4
check('重庆', U(Braille.convert('重庆', { maxCells: 20, pinyinFn }).lines), '⠟⠲⠂⠅⠡⠆');

console.log(failures ? `\n${failures} 个测试失败` : '\n全部测试通过');
process.exit(failures ? 1 : 0);
