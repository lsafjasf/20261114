"use strict";
// 顶点着色器：全屏四边形
const VERT_SRC = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// 公共片段：可平铺的正弦波叠加 + 折射命中计算。
// 所有波矢 k 均为 2π/POOL 的整数倍，因此高度场沿 x/z 严格周期，
// 太阳掠过画面边缘时焦散图案在边界处连续，无接缝。
const COMMON_GLSL = `
precision highp float;
in vec2 vUv;
uniform float uTime;    // 动画时间（秒）
uniform vec3  uSunDir;  // 指向太阳的单位向量
uniform float uWave;    // 波浪强度 0..2
uniform float uDepth;   // 池底深度（世界单位）
const float POOL = 10.0;               // 平铺周期（世界单位）
const float TAU = 6.28318530718;

// 10 组正弦波：vec4(整数kx, 整数kz, 角速度, 相位)，振幅在 AMPL 中
const int NW = 10;
const vec4 WAVES[NW] = vec4[NW](
  vec4( 3.0,  1.0, 1.15, 0.0),
  vec4(-2.0,  4.0, 1.60, 1.7),
  vec4( 5.0, -3.0, 0.85, 3.1),
  vec4( 1.0, -6.0, 2.10, 4.4),
  vec4(-4.0, -2.0, 1.35, 2.2),
  vec4( 7.0,  5.0, 2.60, 5.3),
  vec4( 6.0, -8.0, 1.90, 0.9),
  vec4(-7.0,  3.0, 2.40, 3.8),
  vec4( 9.0,  2.0, 2.90, 5.9),
  vec4(-5.0, -9.0, 3.30, 2.6)
);
const float AMPL[NW] = float[NW](0.42, 0.30, 0.26, 0.20, 0.20, 0.14, 0.12, 0.10, 0.08, 0.07);

// 高度场与梯度（解析导数，保证与高度完全一致）
void waveField(vec2 p, out float h, out vec2 grad){
  h = 0.0; grad = vec2(0.0);
  for (int i = 0; i < NW; i++){
    vec2 k = WAVES[i].xy * (TAU / POOL);
    float ph = dot(k, p) + WAVES[i].z * uTime + WAVES[i].w;
    float a = AMPL[i] * uWave * 0.15;
    h += a * sin(ph);
    grad += a * k * cos(ph);
  }
}

// 太阳直射光经水面折射后打到池底的位置（xz 平面）
vec2 refractHit(vec2 p){
  float h; vec2 g;
  waveField(p, h, g);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 r = refract(-uSunDir, n, 1.0 / 1.333);
  float ry = min(r.y, -0.08);            // 低高度角时防止除零
  float t = (uDepth + h) / (-ry);
  t = min(t, uDepth * 6.0);              // 掠射时限制偏移，避免数值爆炸
  return p + r.xz * t;
}

// 焦散强度：折射映射雅可比行列式的倒数（面积压缩率）
float causticIntensity(vec2 p){
  float eps = POOL / 720.0;
  vec2 c  = refractHit(p);
  vec2 cx = refractHit(p + vec2(eps, 0.0));
  vec2 cz = refractHit(p + vec2(0.0, eps));
  vec2 j0 = (cx - c) / eps;
  vec2 j1 = (cz - c) / eps;
  float det = abs(j0.x * j1.y - j0.y * j1.x);
  float I = 1.0 / max(det, 0.02);
  // 以平静水面 (det=1) 为基准，突出聚焦产生的亮丝
  return max(pow(clamp(I, 0.0, 12.0), 1.7) - 1.0, 0.0) * 0.20;
}

// 程序生成的池底瓷砖图案（不加载任何纹理）
vec3 floorPattern(vec2 p){
  vec2 tp = p * 2.0;                       // 每周期 20 块瓷砖
  vec2 cell = floor(tp);
  vec2 f = fract(tp);
  float grout = smoothstep(0.0, 0.06, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
  float hsh = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  vec3 tile = mix(vec3(0.62, 0.78, 0.82), vec3(0.42, 0.66, 0.78), hsh);
  tile *= 0.92 + 0.08 * sin(p.x * 3.0) * sin(p.y * 3.0);
  return mix(vec3(0.18, 0.26, 0.30), tile, grout);
}
`;

// 第一遍：池底基色 + 水体吸收（不透明写入）
const FLOOR_FRAG = `#version 300 es
${COMMON_GLSL}
uniform vec3 uSunColor;
out vec4 outColor;
void main(){
  vec2 p = vUv * POOL;
  vec3 base = floorPattern(p);
  // 水体吸收：随深度增加偏蓝变暗
  vec3 absorb = exp(-uDepth * vec3(0.30, 0.12, 0.06));
  float diffuse = 0.35 + 0.65 * max(uSunDir.y, 0.0);
  vec3 col = base * absorb * diffuse * uSunColor;
  // 轻微的水面环境反射，增强水体感
  col += vec3(0.02, 0.05, 0.08) * (1.0 - absorb);
  outColor = vec4(col, 1.0);
}
`;

// 第二遍：焦散高光 + 太阳镜面反光（加色/透明混合叠加）
const CAUSTIC_FRAG = `#version 300 es
${COMMON_GLSL}
uniform vec3 uSunColor;
out vec4 outColor;
void main(){
  vec2 p = vUv * POOL;
  float I = causticIntensity(p);
  vec3 absorb = exp(-uDepth * vec3(0.30, 0.12, 0.07));
  float sunBoost = 0.3 + 0.7 * max(uSunDir.y, 0.0);
  vec3 caus = uSunColor * absorb * I * 0.42 * sunBoost;
  // 太阳镜面闪光（Blinn 半向量，视线垂直向下）
  float h; vec2 g;
  waveField(p, h, g);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 hv = normalize(uSunDir + vec3(0.0, 1.0, 0.0));
  float spec = pow(max(dot(n, hv), 0.0), 240.0) * 1.4;
  vec3 col = caus + uSunColor * spec;
  // alpha 携带亮度信息，配合 (SRC_ALPHA, ONE) 做加色透明混合
  float lum = max(col.r, max(col.g, col.b));
  outColor = vec4(col, clamp(lum, 0.0, 1.0));
}
`;
