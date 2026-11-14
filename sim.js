// sim.js -- Node 端无头模拟：两个 AI 角色实际协同完成一次五段照明
const Core = require('./game-core.js');
const Auto = require('./autopilot.js');

const dt = 1 / 60;

function run(name, inputFn, verbose) {
  const st = Core.createGame();
  let lastLog = -1;
  console.log('=== ' + name + ' ===');
  while (st.status === 'running' && st.time < 180) {
    Core.step(st, inputFn(st), dt);
    for (const ev of st.events.splice(0)) {
      const t = ev.t.toFixed(1).padStart(5);
      if (ev.type === 'overheat') console.log(`[${t}s] !! 灯${ev.light + 1} 电机过热，冷却 ${Core.CFG.overheatCool}s`);
      if (ev.type === 'cooled')   console.log(`[${t}s] .. 灯${ev.light + 1} 冷却完成，恢复追光`);
      if (ev.type === 'segment')  console.log(`[${t}s] ** 第 ${ev.n}/5 段照明完成`);
      if (ev.type === 'win')      console.log(`[${t}s] == 五段照明全部完成，演出通过！`);
      if (ev.type === 'fail')     console.log(`[${t}s] XX 演出失败：${st.failReason}`);
    }
    if (verbose) {
      const sec = Math.floor(st.time);
      if (sec !== lastLog && sec % 5 === 0) {
        lastLog = sec;
        const L = st.lights;
        console.log(
          `[${String(sec).padStart(3)}s] 段${st.segment + 1} ` +
          `进度${st.segmentProgress.toFixed(1)}/${Core.CFG.segNeed[st.segment]}s | ` +
          `色温 ${Math.round(L[0].temp)}K/${Math.round(L[1].temp)}K | ` +
          `热度 ${Math.round(L[0].heat)}/${Math.round(L[1].heat)} | ` +
          `扩散${st.spread.toFixed(2)} 亮度${(st.brightness * 100) | 0}% | ` +
          (st.qualified ? '合格照明中' : `未合格(暗场${st.darkTimer.toFixed(1)}s)`)
        );
      }
    }
  }
  console.log('结果:', st.status === 'won'
    ? `通过（五段照明完成，无暗场事故，用时 ${st.time.toFixed(1)}s）\n`
    : `失败（${st.failReason}，止于第 ${st.segment + 1} 段）\n`);
  return st.status;
}

// 场景一：左右 AI 认真协同，应通过
const coop = run('场景一：双人协同实战（左控台 AI + 右追光 AI）', Auto.autoInput, true);

// 场景二：右侧鲁莽追光（全速来回扫），应触发过热并导致暗场事故
const reckless = run('场景二：鲁莽追光（验证过热与暗场事故）', st => ({
  temp1: 0, temp2: 0, brightness: 0,
  aim: Math.sin(st.time * 2.2) > 0 ? 1 : -1,
  spread: 0,
}), false);

const ok = coop === 'won' && reckless === 'failed';
console.log(ok ? '全部场景符合预期。' : '场景结果不符合预期！');
process.exit(ok ? 0 : 1);
