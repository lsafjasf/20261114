const ACTS = [
  {
    key: "swing",
    name: "挥杆",
    number: "01",
    duration: 14,
    kicker: "同步动作 · 第一幕",
    title: "让双臂抬入金色窗口",
    rule: "W + ↑ 同时抬臂，停稳后保持半秒。",
    hint: "两侧同时抬臂，等指尖进入窄窗。",
    success: "挥杆落定。木杆两端同时受力。",
    targets: { leftArm: [43, 51], rightArm: [43, 51] }
  },
  {
    key: "turn",
    name: "转身",
    number: "02",
    duration: 14,
    kicker: "同步动作 · 第二幕",
    title: "腰与头一起向右转",
    rule: "D + → 同向右转，停在 27° 附近。",
    hint: "腰与头同向发力，别让任何一侧抢先。",
    success: "腰颈同轴。木偶听见了背后的声音。",
    targets: { waist: [24, 30], head: [24, 30] }
  },
  {
    key: "crouch",
    name: "下蹲",
    number: "03",
    duration: 14,
    kicker: "同步动作 · 第三幕",
    title: "两侧收臂，折膝下蹲",
    rule: "S + ↓ 同时沉臂，让身体降低。",
    hint: "左右臂一起下沉，保持腰与头居中。",
    success: "重心落稳。木偶向黑暗里低了一次头。",
    targets: { leftArm: [-41, -33], rightArm: [-41, -33] }
  }
];

const JOINT_META = {
  leftArm: { min: -48, max: 72, speed: 52, label: "左臂" },
  waist: { min: -38, max: 38, speed: 39, label: "腰部" },
  rightArm: { min: -48, max: 72, speed: 52, label: "右臂" },
  head: { min: -40, max: 40, speed: 39, label: "头部" }
};

const KEY_TO_JOINT = {
  KeyW: ["leftArm", 1],
  KeyS: ["leftArm", -1],
  KeyD: ["waist", 1],
  KeyA: ["waist", -1],
  ArrowUp: ["rightArm", 1],
  ArrowDown: ["rightArm", -1],
  ArrowRight: ["head", 1],
  ArrowLeft: ["head", -1]
};

const JOINT_KEYS = {
  leftArm: ["KeyW", "KeyS"],
  waist: ["KeyD", "KeyA"],
  rightArm: ["ArrowUp", "ArrowDown"],
  head: ["ArrowRight", "ArrowLeft"]
};

const KEY_LABELS = {
  KeyW: "W",
  KeyA: "A",
  KeyS: "S",
  KeyD: "D",
  ArrowUp: "ARROWUP",
  ArrowDown: "ARROWDOWN",
  ArrowLeft: "ARROWLEFT",
  ArrowRight: "ARROWRIGHT"
};

class PuppetShow {
  constructor() {
    this.canvas = document.getElementById("stage");
    this.renderer = new PuppetRenderer(this.canvas);
    this.sound = new SoundEngine();
    this.keys = new Set();
    this.autoKeys = new Set();
    this.readouts = {};
    this.keyEls = new Map();
    this.cacheDom();
    this.bindEvents();
    this.resetState();
    this.lastFrame = performance.now();
    this.time = 0;
    this.toastTimer = 0;
    this.creakTimer = 0;
    this.lastInWindow = false;
    requestAnimationFrame(now => this.loop(now));
  }

  cacheDom() {
    const ids = [
      "actChip", "clockValue", "instructionCard", "settleFill", "toast",
      "startOverlay", "endOverlay", "soundBtn", "soundLabel", "restartBtn",
      "startBtn", "demoBtn", "againBtn", "replayDemoBtn", "actTimeline",
      "stageHint", "imbalanceCount", "balancePips", "strainValue", "strainFill",
      "endEyebrow", "endTitle", "endCopy", "resActs", "resStress", "resTime",
      "leftPanel", "rightPanel"
    ];
    this.el = {};
    for (const id of ids) this.el[id] = document.getElementById(id);

    document.querySelectorAll(".readout").forEach(root => {
      const joint = root.dataset.joint;
      this.readouts[joint] = {
        root,
        value: root.querySelector(".readout-line b"),
        marker: root.querySelector(".meter i"),
        target: root.querySelector(".target-slot")
      };
    });
    document.querySelectorAll(".key[data-key]").forEach(key => {
      this.keyEls.set(key.dataset.key, key);
    });
  }

  bindEvents() {
    window.addEventListener("keydown", event => {
      if (KEY_TO_JOINT[event.code]) {
        event.preventDefault();
        if (!event.repeat) this.keys.add(event.code);
      }
    });
    window.addEventListener("keyup", event => {
      if (KEY_TO_JOINT[event.code]) {
        event.preventDefault();
        this.keys.delete(event.code);
      }
    });
    window.addEventListener("blur", () => this.keys.clear());

    this.el.startBtn.addEventListener("click", () => this.startPerformance(false));
    this.el.demoBtn.addEventListener("click", () => this.startPerformance(true));
    this.el.againBtn.addEventListener("click", () => this.startPerformance(false));
    this.el.replayDemoBtn.addEventListener("click", () => this.startPerformance(true));
    this.el.restartBtn.addEventListener("click", () => this.returnToLobby());
    this.el.soundBtn.addEventListener("click", () => {
      const enabled = this.sound.toggle();
      this.el.soundBtn.setAttribute("aria-pressed", String(enabled));
      this.el.soundLabel.textContent = enabled ? "声音 · 开" : "声音 · 关";
    });
  }

  resetState() {
    this.mode = "intro";
    this.demo = false;
    this.currentAct = 0;
    this.phase = "intro";
    this.phaseTimer = 0;
    this.actElapsed = 0;
    this.settle = 0;
    this.imbalance = 0;
    this.actResults = ["", "", ""];
    this.startedAt = 0;
    this.lastFailReason = "";
    this.pendingEnd = "";
    this.joints = {};
    for (const [name, meta] of Object.entries(JOINT_META)) {
      this.joints[name] = {
        value: 0,
        vel: 0,
        strain: 0,
        broken: false,
        min: meta.min,
        max: meta.max,
        speed: meta.speed,
        label: meta.label
      };
    }
    this.stats = { maxStress: 0, completed: 0, failedAttempts: 0 };
    this.effects = { flash: 0, shake: 0, celebration: 0, curtainClose: 0 };
    this.crouch = 0;
  }

  startPerformance(demo) {
    this.sound.ensure();
    this.sound.curtains();
    this.resetState();
    this.mode = "playing";
    this.demo = demo;
    this.startedAt = performance.now();
    this.el.startOverlay.classList.remove("visible");
    this.el.endOverlay.classList.remove("visible");
    this.el.instructionCard.classList.remove("out");
    this.showToast(demo ? "排练开始 · 提线师由左至右接管" : "合演开始 · 两侧同时发力", "success");
    this.beginAct(0);
  }

  returnToLobby() {
    this.keys.clear();
    this.resetState();
    this.el.endOverlay.classList.remove("visible");
    this.el.startOverlay.classList.add("visible");
    this.el.instructionCard.classList.remove("out");
    this.el.actChip.querySelector(".act-number").textContent = "幕 01";
    this.el.actChip.querySelector("strong").textContent = "挥杆";
    this.updateTimeline();
    this.el.clockValue.textContent = ACTS[0].duration.toFixed(1);
    this.el.stageHint.textContent = ACTS[0].hint;
  }

  beginAct(index) {
    this.currentAct = index;
    this.phase = "cue";
    this.phaseTimer = this.demo ? 1.15 : 1.35;
    this.actElapsed = 0;
    this.settle = 0;
    this.lastInWindow = false;
    const act = ACTS[index];
    this.el.instructionCard.classList.remove("out");
    this.el.instructionCard.querySelector(".instruction-kicker").textContent = act.kicker;
    this.el.instructionCard.querySelector("h3").textContent = act.title;
    this.el.instructionCard.querySelector("p").innerHTML = act.rule
      .replace(/\b(W|A|S|D)\b/g, "<kbd>$1</kbd>")
      .replace(/(↑|←|↓|→)/g, "<kbd>$1</kbd>");
    this.el.actChip.querySelector(".act-number").textContent = `幕 ${act.number}`;
    this.el.actChip.querySelector("strong").textContent = act.name;
    this.el.actChip.classList.remove("enter");
    void this.el.actChip.offsetWidth;
    this.el.actChip.classList.add("enter");
    this.el.stageHint.textContent = act.hint;
    this.el.clockValue.textContent = act.duration.toFixed(1);
    this.updateTimeline();
    this.showToast(`第${["一", "二", "三"][index]}幕 · ${act.name}`, "");
    this.sound.cue();
  }

  getActiveTargets() {
    if (this.phase !== "active" || this.mode !== "playing") return null;
    const raw = ACTS[this.currentAct].targets;
    const targets = {};
    for (const [name, [min, max]] of Object.entries(raw)) {
      targets[name] = { min, max, active: true };
    }
    return targets;
  }

  loop(now) {
    const dt = Math.min(0.034, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.time += dt;
    this.update(dt);
    this.updateUI(dt);
    this.draw();
    requestAnimationFrame(next => this.loop(next));
  }

  update(dt) {
    this.effects.flash = Math.max(0, this.effects.flash - dt * 2.6);
    this.effects.shake = Math.max(0, this.effects.shake - dt * 34);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove("visible");
    }
    this.creakTimer = Math.max(0, this.creakTimer - dt);

    const targetDown = this.computeCrouchTarget();
    const crouchRate = 1 - Math.exp(-dt * 7);
    this.crouch += (targetDown - this.crouch) * crouchRate;

    if (this.mode !== "playing") {
      for (const joint of Object.values(this.joints)) {
        joint.vel += (0 - joint.vel) * Math.min(1, dt * 7);
        joint.value += joint.vel * dt;
        joint.strain = Math.max(0, joint.strain - dt * 5);
      }
      return;
    }

    if (this.phase === "cue") {
      this.phaseTimer -= dt;
      this.updateNeutralPose(dt);
      if (this.phaseTimer <= 0) {
        this.phase = "active";
        this.actElapsed = 0;
        this.settle = 0;
        this.showToast("动作窗口开启", "success");
        this.sound.paper(0.23, 0.045, 0);
      }
      return;
    }

    if (this.phase === "active") {
      this.actElapsed += dt;
      const act = ACTS[this.currentAct];
      if (this.actElapsed >= act.duration) {
        this.failAction("动作窗口关闭，重心失控");
        return;
      }
      this.autoKeys.clear();
      for (const name of Object.keys(this.joints)) {
        if (this.phase !== "active") break;
        const input = this.demo ? this.getAutoInput(name) : this.getManualInput(name);
        this.stepJoint(name, input.velocity, input.opposing, dt);
      }
      this.updateStressAudio();
      this.checkSettle(dt);
      return;
    }

    if (this.phase === "transition") {
      this.phaseTimer -= dt;
      this.updateNeutralPose(dt, 0.55);
      if (this.phaseTimer <= 0) {
        if (this.currentAct < ACTS.length - 1) this.beginAct(this.currentAct + 1);
        else this.endPerformance(true);
      }
      return;
    }

    if (this.phase === "penalty") {
      this.phaseTimer -= dt;
      this.updateNeutralPose(dt, 0.7);
      if (this.phaseTimer <= 0) {
        if (this.pendingEnd === "fail") {
          this.endPerformance(false);
        } else {
          for (const joint of Object.values(this.joints)) {
            joint.broken = false;
            joint.strain = Math.min(joint.strain, 16);
          }
          this.beginAct(this.currentAct);
        }
      }
    }
  }

  getManualInput(name) {
    const [positiveKey, negativeKey] = JOINT_KEYS[name];
    const positive = this.keys.has(positiveKey);
    const negative = this.keys.has(negativeKey);
    const opposing = positive && negative;
    let velocity = 0;
    if (positive && !negative) velocity = JOINT_META[name].speed;
    if (negative && !positive) velocity = -JOINT_META[name].speed;
    return { velocity, opposing };
  }

  getAutoInput(name) {
    const raw = ACTS[this.currentAct].targets[name];
    const error = raw ? (raw[0] + raw[1]) / 2 - this.joints[name].value : -this.joints[name].value;
    const meta = JOINT_META[name];
    if (Math.abs(error) < 0.35) return { velocity: 0, opposing: false };
    const velocity = Math.max(-meta.speed * 0.72, Math.min(meta.speed * 0.72, error * 2.5));
    if (velocity > 1.4) this.autoKeys.add(JOINT_KEYS[name][0]);
    if (velocity < -1.4) this.autoKeys.add(JOINT_KEYS[name][1]);
    return { velocity, opposing: false };
  }

  updateNeutralPose(dt, factor = 0.35) {
    for (const [name, joint] of Object.entries(this.joints)) {
      if (joint.broken) {
        joint.vel += (0 - joint.vel) * Math.min(1, dt * 5);
        continue;
      }
      const velocity = Math.max(-joint.speed * factor, Math.min(joint.speed * factor, -joint.value * 4.2));
      joint.vel += (velocity - joint.vel) * Math.min(1, dt * 8);
      joint.value += joint.vel * dt;
      joint.value = Math.max(joint.min, Math.min(joint.max, joint.value));
      joint.strain = Math.max(0, joint.strain - dt * 6);
    }
  }

  stepJoint(name, targetVelocity, opposing, dt) {
    const joint = this.joints[name];
    if (joint.broken) {
      joint.vel += (0 - joint.vel) * Math.min(1, dt * 8);
      return;
    }
    const before = joint.vel;
    joint.vel += (targetVelocity - joint.vel) * Math.min(1, dt * 9);
    const acceleration = Math.abs(joint.vel - before) / Math.max(dt, 0.001);
    joint.value += joint.vel * dt;

    if (joint.value > joint.max) {
      joint.value = joint.max;
      if (targetVelocity > 0) joint.strain += dt * 22;
      joint.vel = Math.min(0, joint.vel) * 0.3;
    } else if (joint.value < joint.min) {
      joint.value = joint.min;
      if (targetVelocity < 0) joint.strain += dt * 22;
      joint.vel = Math.max(0, joint.vel) * 0.3;
    }

    if (opposing) joint.strain += dt * 37;
    if (acceleration > 520) joint.strain += (acceleration - 520) * dt * 0.11;
    const speedExcess = Math.max(0, Math.abs(joint.vel) - 55);
    if (speedExcess > 0) joint.strain += speedExcess * dt * 0.6;

    joint.strain = Math.max(0, joint.strain - dt * 4.2);
    joint.strain = Math.min(100, joint.strain);
    this.stats.maxStress = Math.max(this.stats.maxStress, joint.strain);

    if (joint.strain >= 100) {
      joint.broken = true;
      joint.strain = 100;
      this.effects.shake = 9;
      this.failAction(`关节脱臼 · ${joint.label}用力过猛`);
    }
  }

  checkSettle(dt) {
    if (this.phase !== "active") return;
    const targets = this.getActiveTargets();
    const names = Object.keys(targets);
    const inWindow = names.every(name => {
      const value = this.joints[name].value;
      return value >= targets[name].min && value <= targets[name].max;
    });
    const calm = names.every(name => Math.abs(this.joints[name].vel) <= 24);

    if (inWindow && !this.lastInWindow) {
      this.sound.paper(0.18, 0.042, 0);
    }
    this.lastInWindow = inWindow;

    if (inWindow && calm) {
      this.settle += dt;
      if (this.settle >= 0.6) this.completeAct();
    } else {
      this.settle = 0;
    }
  }

  completeAct() {
    if (this.phase !== "active") return;
    const act = ACTS[this.currentAct];
    this.actResults[this.currentAct] = "done";
    this.imbalance = 0;
    this.stats.completed += 1;
    this.settle = 0;
    this.phase = "transition";
    this.phaseTimer = 1.25;
    this.effects.flash = 1;
    this.el.instructionCard.classList.add("out");
    this.el.stageHint.textContent = act.success;
    this.showToast(act.success, "success");
    this.sound.success(this.currentAct);
    this.updateTimeline();
  }

  failAction(reason) {
    if (this.phase !== "active") return;
    this.imbalance += 1;
    this.stats.failedAttempts += 1;
    this.lastFailReason = reason;
    this.actResults[this.currentAct] = "failed";
    this.settle = 0;
    this.pendingEnd = this.imbalance >= 3 ? "fail" : "";
    this.phase = "penalty";
    this.phaseTimer = 1.45;
    this.effects.shake = Math.max(this.effects.shake, 5);
    this.sound.failure();
    this.el.instructionCard.classList.add("out");
    this.el.stageHint.textContent = `失衡 ${this.imbalance} / 3 · ${reason}`;
    this.showToast(`${reason} · 第 ${this.imbalance} 次失衡`, "danger");
    this.updateTimeline();
  }

  updateStressAudio() {
    let highest = 0;
    for (const joint of Object.values(this.joints)) highest = Math.max(highest, joint.strain);
    if (highest > 48 && this.creakTimer <= 0) {
      this.sound.creak(Math.min(1.4, highest / 58));
      this.creakTimer = 0.55;
    }
  }

  computeCrouchTarget() {
    const leftDown = Math.max(0, -this.joints.leftArm.value);
    const rightDown = Math.max(0, -this.joints.rightArm.value);
    const down = (leftDown + rightDown) / 2;
    return Math.max(0, Math.min(0.94, (down - 7) / 27));
  }

  endPerformance(success) {
    const wasDemo = this.demo;
    this.mode = "ended";
    this.phase = "ended";
    this.demo = false;
    this.keys.clear();
    this.autoKeys.clear();
    this.el.instructionCard.classList.add("out");
    this.el.clockValue.textContent = "—";
    this.updateTimeline();

    const elapsed = Math.max(0, (performance.now() - this.startedAt) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60).toString().padStart(2, "0");
    this.el.resActs.textContent = `${this.stats.completed} / 3`;
    this.el.resStress.textContent = `${Math.round(this.stats.maxStress)}%`;
    this.el.resTime.textContent = `${minutes}:${seconds}`;

    if (success) {
      this.effects.celebration = 1;
      this.sound.success(2);
      this.sound.curtains();
      this.el.endEyebrow.textContent = wasDemo ? "排练完成 · 幕落" : "幕落 · 谢幕";
      this.el.endTitle.textContent = "三幕完成";
      this.el.endTitle.classList.remove("failure");
      this.el.endCopy.textContent = wasDemo
        ? "排练回放完整走完挥杆、转身与下蹲。"
        : "三条提线，一次呼吸。两只手终于落在同一根木轴上。";
      this.el.stageHint.textContent = "三个动作窗口全部通过。";
    } else {
      this.el.endEyebrow.textContent = "幕落 · 演出中断";
      this.el.endTitle.textContent = "失衡三次";
      this.el.endTitle.classList.add("failure");
      this.el.endCopy.textContent = this.lastFailReason || "关节与呼吸再也没能对齐。";
      this.el.stageHint.textContent = "演出中断 · 可重新入场排练。";
    }
    this.el.endOverlay.classList.add("visible");
  }

  updateUI() {
    const act = ACTS[this.currentAct];
    const showTargets = this.mode === "playing" && (this.phase === "cue" || this.phase === "active");
    const targetMap = showTargets ? act.targets : {};

    for (const [name, readout] of Object.entries(this.readouts)) {
      const joint = this.joints[name];
      const meta = JOINT_META[name];
      const pct = (joint.value - meta.min) / (meta.max - meta.min) * 100;
      readout.marker.style.left = `${Math.max(0, Math.min(100, pct))}%`;
      const sign = joint.value > 0 ? "+" : "";
      readout.value.textContent = `${sign}${Math.round(joint.value)}°`;
      const target = targetMap[name];
      if (target) {
        const left = (target[0] - meta.min) / (meta.max - meta.min) * 100;
        const width = (target[1] - target[0]) / (meta.max - meta.min) * 100;
        readout.target.style.left = `${left}%`;
        readout.target.style.width = `${width}%`;
        readout.target.style.opacity = "1";
        readout.root.classList.toggle(
          "in-window",
          this.phase === "active" && joint.value >= target[0] && joint.value <= target[1]
        );
      } else {
        readout.target.style.width = "0%";
        readout.target.style.opacity = "0";
        readout.root.classList.remove("in-window");
      }
    }

    const activeKeys = this.demo && this.mode === "playing" ? this.autoKeys : this.keys;
    for (const [label, element] of this.keyEls) {
      let pressed = false;
      for (const [code, keyLabel] of Object.entries(KEY_LABELS)) {
        if (keyLabel === label) pressed = activeKeys.has(code);
      }
      element.classList.toggle("pressed", pressed);
    }

    this.el.imbalanceCount.textContent = String(this.imbalance);
    const pips = this.el.balancePips.querySelectorAll("i");
    pips.forEach((pip, index) => pip.classList.toggle("lost", index < this.imbalance));

    let maxStrain = 0;
    for (const joint of Object.values(this.joints)) maxStrain = Math.max(maxStrain, joint.strain);
    this.el.strainValue.textContent = `${Math.round(maxStrain)}%`;
    this.el.strainFill.style.width = `${Math.max(0, Math.min(100, maxStrain))}%`;

    const settleRatio = this.phase === "active" ? Math.min(1, this.settle / 0.6) : 0;
    this.el.settleFill.style.width = `${settleRatio * 100}%`;

    let remaining = act.duration;
    if (this.phase === "active") {
      remaining = Math.max(0, act.duration - this.actElapsed);
      this.el.clockValue.textContent = remaining.toFixed(1);
    } else if (this.phase === "cue") {
      this.el.clockValue.textContent = act.duration.toFixed(1);
    } else if (this.phase === "transition") {
      this.el.clockValue.textContent = "✓";
    } else if (this.phase === "penalty") {
      this.el.clockValue.textContent = "!";
    }
    this.el.clockValue.parentElement.classList.toggle("danger", this.phase === "active" && remaining < 4);

    if (this.mode === "playing") {
      if (this.phase === "active") {
        const names = Object.keys(targetMap);
        const inWindow = names.length > 0 && names.every(name => {
          const value = this.joints[name].value;
          return value >= targetMap[name][0] && value <= targetMap[name][1];
        });
        if (this.settle > 0) {
          this.el.stageHint.textContent = `同步保持 · ${Math.round(settleRatio * 100)}%`;
        } else if (inWindow) {
          this.el.stageHint.textContent = "已进入窄窗 · 松手，等关节停稳";
        } else {
          this.el.stageHint.textContent = act.hint;
        }
      } else if (this.phase === "cue") {
        this.el.stageHint.textContent = `${act.hint} · 准备`;
      }
    }
  }

  updateTimeline() {
    const acts = this.el.actTimeline.querySelectorAll(".timeline-act");
    acts.forEach((element, index) => {
      element.classList.remove("active", "done", "failed");
      if (this.actResults[index] === "done") element.classList.add("done");
      if (this.actResults[index] === "failed") element.classList.add("failed");
      if (this.mode === "playing" && index === this.currentAct) element.classList.add("active");
    });
  }

  showToast(message, type = "") {
    this.el.toast.textContent = message;
    this.el.toast.className = `toast visible ${type}`.trim();
    this.toastTimer = 2.1;
  }

  draw() {
    const displayTargets = this.mode === "playing" &&
      (this.phase === "cue" || this.phase === "active")
      ? this.getPreviewTargets()
      : null;
    const state = {
      act: this.currentAct,
      leftArm: this.joints.leftArm.value,
      waist: this.joints.waist.value,
      rightArm: this.joints.rightArm.value,
      head: this.joints.head.value,
      leftStrain: this.joints.leftArm.strain,
      waistStrain: this.joints.waist.strain,
      rightStrain: this.joints.rightArm.strain,
      headStrain: this.joints.head.strain,
      crouch: this.crouch,
      targets: displayTargets
    };
    this.renderer.draw(state, this.time, this.effects);
  }

  getPreviewTargets() {
    const result = {};
    for (const [name, [min, max]] of Object.entries(ACTS[this.currentAct].targets)) {
      result[name] = { min, max, active: true };
    }
    return result;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.puppetShow = new PuppetShow();
});
