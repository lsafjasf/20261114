"use strict";
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const state = {
  az:     parseFloat(params.get("az")    ?? 125),
  el:     parseFloat(params.get("el")    ?? 48),
  wave:   parseFloat(params.get("wave")  ?? 1.0),
  depth:  parseFloat(params.get("depth") ?? 1.1),
  time:   parseFloat(params.get("t")     ?? 0),
  paused: params.get("pause") === "1" || params.has("t"),
};
for (const k of ["az", "el", "wave", "depth"]) $(k).value = state[k];

const canvas = $("glcanvas");
const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
if (!gl) { $("err").style.display = "grid"; $("err").textContent = "当前环境不支持 WebGL2"; throw new Error("no webgl2"); }

function compile(type, src){
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s) + "\n" + src);
  return s;
}
function makeProgram(fragSrc){
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT_SRC));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (const name of ["uTime", "uSunDir", "uSunColor", "uWave", "uDepth"])
    u[name] = gl.getUniformLocation(p, name);
  return { prog: p, u };
}
const floorPass = makeProgram(FLOOR_FRAG);
const causticPass = makeProgram(CAUSTIC_FRAG);

const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

function sunDir(){
  const az = state.az * Math.PI / 180, el = state.el * Math.PI / 180;
  return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
}
function sunColor(){
  // 低角度太阳偏暖
  const t = Math.min(1, Math.sin(state.el * Math.PI / 180) * 1.6);
  return [1.0, 0.72 + 0.28 * t, 0.5 + 0.5 * t];
}

function resize(){
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; }
}

function setUniforms(pass){
  gl.uniform1f(pass.u.uTime, state.time);
  gl.uniform3fv(pass.u.uSunDir, sunDir());
  gl.uniform3fv(pass.u.uSunColor, sunColor());
  gl.uniform1f(pass.u.uWave, state.wave);
  gl.uniform1f(pass.u.uDepth, state.depth);
}

function renderFrame(){
  resize();
  gl.viewport(0, 0, canvas.width, canvas.height);
  // 第一遍：不透明池底
  gl.disable(gl.BLEND);
  gl.useProgram(floorPass.prog);
  setUniforms(floorPass);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  // 第二遍：焦散与反光，加色透明混合
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.useProgram(causticPass.prog);
  setUniforms(causticPass);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disable(gl.BLEND);
}

// ---- FPS ----
let frames = 0, fpsLast = performance.now();
function tickFps(now){
  frames++;
  if (now - fpsLast >= 500){
    $("fps").textContent = "FPS: " + Math.round(frames * 1000 / (now - fpsLast));
    frames = 0; fpsLast = now;
  }
}

// ---- 主循环 ----
let prevNow = performance.now();
function loop(now){
  if (!state.paused) state.time += Math.min((now - prevNow) / 1000, 0.1);
  prevNow = now;
  renderFrame();
  tickFps(now);
  requestAnimationFrame(loop);
}

// ---- UI ----
function syncLabels(){
  $("azV").textContent = state.az.toFixed(0) + "°";
  $("elV").textContent = state.el.toFixed(0) + "°";
  $("waveV").textContent = state.wave.toFixed(2);
  $("depthV").textContent = state.depth.toFixed(2);
}
for (const k of ["az", "el", "wave", "depth"])
  $(k).addEventListener("input", e => { state[k] = parseFloat(e.target.value); syncLabels(); });
$("pauseBtn").addEventListener("click", () => {
  state.paused = !state.paused;
  $("pauseBtn").textContent = state.paused ? "继续" : "暂停";
});
$("shotBtn").addEventListener("click", () => {
  renderFrame();
  canvas.toBlob(b => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = "caustics-" + Date.now() + ".png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, "image/png");
});
if (state.paused) $("pauseBtn").textContent = "继续";
syncLabels();
requestAnimationFrame(loop);

// ---- 测试探针：渲染一帧并读取左右边缘列像素，用于接缝检测 ----
window.__probe = function(){
  renderFrame();
  const w = canvas.width, h = canvas.height;
  const col = x => {
    const buf = new Uint8Array(4 * h);
    gl.readPixels(x, 0, 1, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return Array.from(buf);
  };
  const interior = [];
  for (const x of [Math.floor(w/2) - 1, Math.floor(w/2)]) interior.push(col(x));
  return { w, h, left: col(0), right: col(w - 1), interior, time: state.time };
};
