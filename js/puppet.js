class PuppetRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 1200;
    this.height = 700;
    this.dpr = 1;
    this.floorY = 575;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(box.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(box.height * dpr));
    this.dpr = dpr;
    this.cssWidth = box.width;
    this.cssHeight = box.height;
  }

  draw(state, time, effects = {}) {
    const ctx = this.ctx;
    if (!this.cssWidth || !this.cssHeight) this.resize();
    const scaleX = this.canvas.width / this.width;
    const scaleY = this.canvas.height / this.height;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    if (effects.shake) {
      const amount = effects.shake;
      ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount * 0.5);
    }

    this.drawRoom(time, state);
    this.drawFloor(time);
    this.drawLight(time, state);
    this.drawShadow(state, time);
    this.drawPuppet(state, time);
    this.drawAtmosphere(time, state, effects);

    if (effects.flash > 0) {
      ctx.fillStyle = `rgba(238, 195, 124, ${effects.flash * 0.16})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  drawRoom(time, state) {
    const ctx = this.ctx;
    const bg = ctx.createLinearGradient(0, 0, 0, this.height);
    bg.addColorStop(0, "#09070b");
    bg.addColorStop(0.42, "#171016");
    bg.addColorStop(0.7, "#100b0d");
    bg.addColorStop(1, "#070507");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.width, this.height);

    const glow = ctx.createRadialGradient(600, 260, 20, 600, 330, 500);
    glow.addColorStop(0, "rgba(107, 61, 48, .22)");
    glow.addColorStop(0.5, "rgba(47, 31, 36, .1)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, 590);

    this.drawBackWall();
    this.drawValance(time);
    this.drawCurtain(0, 0, 178, this.height, -1, time);
    this.drawCurtain(this.width, 0, -178, this.height, 1, time + 1.4);
  }

  drawBackWall() {
    const ctx = this.ctx;
    ctx.save();
    const wall = ctx.createLinearGradient(0, 130, 0, 540);
    wall.addColorStop(0, "rgba(25, 19, 22, .25)");
    wall.addColorStop(1, "rgba(9, 8, 10, .65)");
    ctx.fillStyle = wall;
    ctx.fillRect(150, 105, 900, 440);

    ctx.strokeStyle = "rgba(205, 166, 106, .055)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(600, 145);
    ctx.lineTo(285, 540);
    ctx.moveTo(600, 145);
    ctx.lineTo(915, 540);
    ctx.stroke();

    for (let i = 0; i < 7; i += 1) {
      const x = 238 + i * 120;
      ctx.strokeStyle = `rgba(210, 180, 140, ${0.018 + (i % 2) * 0.012})`;
      ctx.beginPath();
      ctx.moveTo(x, 220);
      ctx.bezierCurveTo(x - 9, 320, x + 8, 450, x - 5, 540);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawValance(time) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(Math.sin(time * 0.18) * 1.5, 0);
    const grad = ctx.createLinearGradient(0, 0, 0, 100);
    grad.addColorStop(0, "#271216");
    grad.addColorStop(0.55, "#3c1b1e");
    grad.addColorStop(1, "#1b0c10");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-10, -5);
    ctx.lineTo(1210, -5);
    ctx.lineTo(1210, 70);
    for (let x = 1210; x >= -10; x -= 54) {
      ctx.quadraticCurveTo(x - 22, 97, x - 54, 70);
    }
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(234, 184, 98, .22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 67);
    for (let x = 0; x <= 1200; x += 54) {
      ctx.quadraticCurveTo(x + 27, 102, x + 54, 67);
    }
    ctx.stroke();

    for (let x = 12; x < 1200; x += 34) {
      ctx.strokeStyle = "rgba(0,0,0,.28)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x - 11, 54, x + 3, 82);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawCurtain(originX, top, width, height, side, time) {
    const ctx = this.ctx;
    const edge = originX + width;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(originX, top);
    ctx.lineTo(edge, top);
    ctx.lineTo(edge + side * 22, height);
    ctx.lineTo(originX, height);
    ctx.closePath();
    const grad = ctx.createLinearGradient(originX, 0, edge, 0);
    grad.addColorStop(0, "#11070b");
    grad.addColorStop(0.35, "#3a171b");
    grad.addColorStop(0.62, "#291116");
    grad.addColorStop(1, "#13080c");
    ctx.fillStyle = grad;
    ctx.fill();

    for (let i = 0; i < 5; i += 1) {
      const x = originX + (width / 5) * (i + 0.5) + Math.sin(time * 0.2 + i) * 2;
      const fold = ctx.createLinearGradient(x - 20, 0, x + 20, 0);
      fold.addColorStop(0, "rgba(0,0,0,0)");
      fold.addColorStop(0.5, "rgba(0,0,0,.24)");
      fold.addColorStop(1, "rgba(255,216,160,.025)");
      ctx.fillStyle = fold;
      ctx.beginPath();
      ctx.moveTo(x - 16, top);
      ctx.bezierCurveTo(x - 28, 260, x + 14, 450, x - 7 + side * 10, height);
      ctx.lineTo(x + 18 + side * 12, height);
      ctx.bezierCurveTo(x + 41, 430, x + 2, 230, x + 17, top);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(229, 177, 96, .24)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(edge + side * 4, 65);
    ctx.bezierCurveTo(edge + side * 20, 250, edge + side * 8, 480, edge + side * 24, height);
    ctx.stroke();
    ctx.restore();
  }

  drawFloor(time) {
    const ctx = this.ctx;
    const floorTop = 505;
    const grad = ctx.createLinearGradient(0, floorTop, 0, this.height);
    grad.addColorStop(0, "#141013");
    grad.addColorStop(0.36, "#1b1516");
    grad.addColorStop(1, "#080607");
    ctx.fillStyle = grad;
    ctx.fillRect(0, floorTop, this.width, this.height - floorTop);

    const perspective = y => floorTop + (y - floorTop) * 0.92;
    ctx.save();
    ctx.strokeStyle = "rgba(197, 154, 98, .075)";
    ctx.lineWidth = 1;
    for (let x = -300; x <= 1500; x += 92) {
      ctx.beginPath();
      ctx.moveTo(600 + (x - 600) * 0.12, perspective(500));
      ctx.lineTo(x, perspective(this.height + 40));
      ctx.stroke();
    }
    for (let i = 0; i < 7; i += 1) {
      const t = i / 7;
      const y = floorTop + Math.pow(t, 1.8) * (this.height - floorTop);
      ctx.strokeStyle = `rgba(220, 174, 112, ${0.018 + t * 0.035})`;
      ctx.beginPath();
      ctx.moveTo(135, y);
      ctx.lineTo(1065, y);
      ctx.stroke();
    }
    ctx.restore();

    const edge = ctx.createLinearGradient(0, floorTop - 7, 0, floorTop + 8);
    edge.addColorStop(0, "rgba(0,0,0,0)");
    edge.addColorStop(0.45, "rgba(227, 170, 89, .16)");
    edge.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = edge;
    ctx.fillRect(120, floorTop - 8, 960, 16);

    ctx.strokeStyle = "rgba(232, 197, 141, .13)";
    ctx.beginPath();
    ctx.moveTo(114, floorTop + 66);
    ctx.lineTo(1086, floorTop + 66);
    ctx.stroke();

    const vignette = ctx.createRadialGradient(600, 590, 80, 600, 590, 480);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,.67)");
    ctx.fillStyle = vignette;
    ctx.fillRect(100, floorTop, 1000, this.height - floorTop);
  }

  drawLight(time, state) {
    const ctx = this.ctx;
    const flicker = 0.96 + Math.sin(time * 2.3) * 0.018 + Math.sin(time * 6.7) * 0.009;
    const focus = state.pelvisX || 600;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const cone = ctx.createLinearGradient(0, 90, 0, 590);
    cone.addColorStop(0, "rgba(255, 215, 154, .035)");
    cone.addColorStop(0.45, "rgba(255, 209, 135, .055)");
    cone.addColorStop(1, "rgba(251, 196, 111, .11)");
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(focus - 24, 45);
    ctx.lineTo(focus + 24, 45);
    ctx.lineTo(focus + 360, 600);
    ctx.lineTo(focus - 360, 600);
    ctx.closePath();
    ctx.fill();

    const spot = ctx.createRadialGradient(focus, 574, 5, focus, 574, 315);
    spot.addColorStop(0, `rgba(248, 205, 141, ${0.24 * flicker})`);
    spot.addColorStop(0.35, `rgba(215, 156, 88, ${0.11 * flicker})`);
    spot.addColorStop(1, "rgba(160, 90, 48, 0)");
    ctx.fillStyle = spot;
    ctx.beginPath();
    ctx.ellipse(focus, 575, 345, 87, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawShadow(state, time) {
    const ctx = this.ctx;
    const pose = this.computePose(state);
    const pulse = 1 + Math.sin(time * 1.4) * 0.008;
    ctx.save();
    ctx.filter = "blur(7px)";
    ctx.globalAlpha = 0.28;
    ctx.translate(pose.pelvis.x + 84, this.floorY + 21);
    ctx.scale(1.04 * pulse, 0.26);
    ctx.fillStyle = "#050304";
    ctx.strokeStyle = "#050304";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.ellipse(0, 9, 106, 28, -0.08, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 17;
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(0, -88);
    ctx.stroke();
    ctx.lineWidth = 11;
    this.shadowLimb(pose.leftShoulder, pose.leftElbow, pose.leftHand);
    this.shadowLimb(pose.rightShoulder, pose.rightElbow, pose.rightHand);
    this.shadowLimb(pose.leftHip, pose.leftKnee, pose.leftAnkle);
    this.shadowLimb(pose.rightHip, pose.rightKnee, pose.rightAnkle);
    ctx.beginPath();
    ctx.ellipse(0, -150, 36, 43, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.strokeStyle = "rgba(0,0,0,.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(pose.pelvis.x + 84, this.floorY + 23, 122, 28, -0.06, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  shadowLimb(a, b, c) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }

  computePose(state) {
    const crouch = Math.max(0, Math.min(1, state.crouch || 0));
    const pelvis = { x: 600, y: 366 + crouch * 51 };
    const torsoRad = (state.waist || 0) * Math.PI / 180 * 0.42;
    const local = (x, y) => ({
      x: pelvis.x + x * Math.cos(torsoRad) - y * Math.sin(torsoRad),
      y: pelvis.y + x * Math.sin(torsoRad) + y * Math.cos(torsoRad)
    });

    const leftShoulder = { x: -35, y: -76 };
    const rightShoulder = { x: 35, y: -76 };
    const leftArm = this.armPoints(leftShoulder, state.leftArm || 0, -1);
    const rightArm = this.armPoints(rightShoulder, state.rightArm || 0, 1);
    const localLeftHip = { x: -18, y: 7 };
    const localRightHip = { x: 18, y: 7 };
    const ankleY = this.floorY - pelvis.y;
    const kneeY = 7 + (ankleY - 7) * 0.47 + crouch * 3;
    const leftKnee = { x: -(13 + crouch * 27), y: kneeY };
    const rightKnee = { x: 13 + crouch * 27, y: kneeY };
    const leftAnkle = { x: -(35 + crouch * 5), y: ankleY };
    const rightAnkle = { x: 35 + crouch * 5, y: ankleY };
    const leftFoot = { x: leftAnkle.x - 21, y: ankleY + 1 };
    const rightFoot = { x: rightAnkle.x + 21, y: ankleY + 1 };

    return {
      crouch,
      pelvis,
      torsoRad,
      pelvisLocal: { x: 0, y: 0 },
      chest: { x: 0, y: -77 },
      neck: { x: 0, y: -116 },
      head: { x: 0, y: -154 },
      leftShoulder,
      rightShoulder,
      leftElbow: leftArm.elbow,
      leftHand: leftArm.hand,
      rightElbow: rightArm.elbow,
      rightHand: rightArm.hand,
      leftHip: localLeftHip,
      rightHip: localRightHip,
      leftKnee,
      rightKnee,
      leftAnkle,
      rightAnkle,
      leftFoot,
      rightFoot,
      local
    };
  }

  armPoints(shoulder, value, side) {
    const angle = Math.max(-78, Math.min(146, 16 + value));
    const rad = angle * Math.PI / 180;
    const length = 67;
    const elbow = {
      x: shoulder.x + side * Math.sin(rad) * length,
      y: shoulder.y + Math.cos(rad) * length
    };
    const rad2 = (angle * 0.91 + 5) * Math.PI / 180;
    const hand = {
      x: elbow.x + side * Math.sin(rad2) * 58,
      y: elbow.y + Math.cos(rad2) * 58
    };
    return { elbow, hand };
  }

  drawPuppet(state, time) {
    const ctx = this.ctx;
    const pose = this.computePose(state);
    const breath = Math.sin(time * 1.55) * 1.1;
    const strain = Math.max(state.leftStrain || 0, state.rightStrain || 0, state.waistStrain || 0, state.headStrain || 0);

    ctx.save();
    ctx.translate(pose.pelvis.x, pose.pelvis.y + breath);
    ctx.rotate(pose.torsoRad);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    this.drawStrings(pose, time);
    this.drawLegs(pose, state);
    if (state.act === 0 || state.act === 2) this.drawRod(pose, state, time);
    this.drawTorso(pose, state, strain);
    this.drawArms(pose, state);
    this.drawHead(pose, state, time);
    this.drawArmArcs(pose, state);
    this.drawHeadArc(pose, state);
    ctx.restore();

    this.drawWaistArc(pose, state);
    this.drawStrainSparks(pose, state, time);
  }

  drawStrings(pose, time) {
    const ctx = this.ctx;
    const sway = Math.sin(time * 0.8) * 2;
    const anchors = [
      { from: { x: -190, y: -620 }, to: { x: pose.head.x - 4, y: pose.head.y - 28 } },
      { from: { x: 205, y: -635 }, to: { x: pose.head.x + 8, y: pose.head.y - 25 } },
      { from: { x: -290, y: -610 }, to: pose.leftHand },
      { from: { x: 300, y: -625 }, to: pose.rightHand },
      { from: { x: -135, y: -650 }, to: pose.leftShoulder }
    ];
    ctx.save();
    for (let i = 0; i < anchors.length; i += 1) {
      const { from, to } = anchors[i];
      ctx.strokeStyle = i < 2 ? "rgba(235, 206, 160, .24)" : "rgba(223, 189, 134, .17)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(from.x + sway, from.y);
      ctx.quadraticCurveTo((from.x + to.x) / 2 - sway, (from.y + to.y) / 2, to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  bone(a, b, width = 7, color = "#bf8b5b") {
    const ctx = this.ctx;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(18, 10, 9, .82)";
    ctx.lineWidth = width + 4;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 224, 178, .22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x - 1, a.y - 1);
    ctx.lineTo(b.x - 1, b.y - 1);
    ctx.stroke();
  }

  woodenJoint(p, radius = 5.5, hot = false) {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(p.x - 2, p.y - 2, 1, p.x, p.y, radius + 2);
    g.addColorStop(0, hot ? "#ffd49a" : "#efd09c");
    g.addColorStop(0.45, hot ? "#c66c4d" : "#ac7449");
    g.addColorStop(1, "#3b241b");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(24, 12, 8, .7)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(30, 15, 9, .7)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  drawLegs(pose, state) {
    const ctx = this.ctx;
    const accent = "#aa7b50";
    this.bone(pose.leftHip, pose.leftKnee, 9, accent);
    this.bone(pose.leftKnee, pose.leftAnkle, 7, "#b98859");
    this.bone(pose.rightHip, pose.rightKnee, 9, accent);
    this.bone(pose.rightKnee, pose.rightAnkle, 7, "#b98859");
    this.bone(pose.leftAnkle, pose.leftFoot, 8, "#9b6e44");
    this.bone(pose.rightAnkle, pose.rightFoot, 8, "#9b6e44");

    this.woodenJoint(pose.leftHip, 5.5);
    this.woodenJoint(pose.rightHip, 5.5);
    this.woodenJoint(pose.leftKnee, 5);
    this.woodenJoint(pose.rightKnee, 5);
    this.woodenJoint(pose.leftAnkle, 4.2);
    this.woodenJoint(pose.rightAnkle, 4.2);

    ctx.save();
    ctx.strokeStyle = "rgba(229, 195, 145, .16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-31, pose.leftKnee.y - 9);
    ctx.lineTo(-20, pose.leftKnee.y + 16);
    ctx.moveTo(31, pose.rightKnee.y - 9);
    ctx.lineTo(20, pose.rightKnee.y + 16);
    ctx.stroke();
    ctx.restore();
  }

  drawRod(pose, state, time) {
    const ctx = this.ctx;
    const a = pose.leftHand;
    const b = pose.rightHand;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 68) return;
    const nx = -dy / length;
    const ny = dx / length;
    const sway = Math.sin(time * 1.1) * 0.6;
    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, "#71452d");
    grad.addColorStop(0.18, "#c28f5d");
    grad.addColorStop(0.5, "#8f5d3d");
    grad.addColorStop(0.82, "#c59461");
    grad.addColorStop(1, "#664029");
    ctx.strokeStyle = "rgba(16,8,6,.75)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(a.x - nx * 2, a.y - ny * 2);
    ctx.lineTo(b.x - nx * 2, b.y - ny * 2);
    ctx.stroke();
    ctx.strokeStyle = grad;
    ctx.lineWidth = 6.5;
    ctx.beginPath();
    ctx.moveTo(a.x + sway, a.y);
    ctx.lineTo(b.x + sway, b.y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,225,175,.23)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x + nx * 1.6, a.y + ny * 1.6);
    ctx.lineTo(b.x + nx * 1.6, b.y + ny * 1.6);
    ctx.stroke();
    ctx.fillStyle = "#d9a666";
    ctx.beginPath();
    ctx.arc(a.x + sway, a.y, 2.2, 0, Math.PI * 2);
    ctx.arc(b.x + sway, b.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  drawTorso(pose, state, strain) {
    const ctx = this.ctx;
    const hot = strain > 62;
    const wood = hot ? "#b97956" : "#bd8a5a";
    this.bone({ x: 0, y: 4 }, { x: 0, y: -76 }, 10, wood);
    this.bone({ x: -36, y: -75 }, { x: 36, y: -75 }, 6, "#9b6d45");
    this.bone({ x: -19, y: 3 }, { x: 19, y: 3 }, 8, "#9b6d45");

    ctx.save();
    ctx.strokeStyle = "rgba(218, 179, 123, .55)";
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 4; i += 1) {
      const y = -19 - i * 14;
      const width = 16 + Math.sin((i + 1) * 0.62) * 11;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(-width * 0.8, y - 1, -width, y + 9, -width * 0.65, y + 17);
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(width * 0.8, y - 1, width, y + 9, width * 0.65, y + 17);
      ctx.stroke();
    }
    ctx.restore();

    const pelvisGrad = ctx.createRadialGradient(-5, 0, 2, 0, 3, 25);
    pelvisGrad.addColorStop(0, "#d0a06d");
    pelvisGrad.addColorStop(0.55, "#9e6e49");
    pelvisGrad.addColorStop(1, "#4b2e21");
    ctx.fillStyle = pelvisGrad;
    ctx.beginPath();
    ctx.ellipse(0, 4, 24, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(30,15,10,.65)";
    ctx.lineWidth = 1;
    ctx.stroke();

    this.woodenJoint({ x: 0, y: -76 }, 6, hot);
    this.woodenJoint(pose.leftShoulder, 5.5);
    this.woodenJoint(pose.rightShoulder, 5.5);
    this.woodenJoint({ x: 0, y: -116 }, 5);

    ctx.save();
    ctx.translate(0, -94);
    ctx.rotate(-0.06);
    ctx.fillStyle = "rgba(230, 215, 188, .72)";
    ctx.beginPath();
    ctx.moveTo(-10, -7);
    ctx.lineTo(11, -5);
    ctx.lineTo(7, 5);
    ctx.lineTo(-2, 8);
    ctx.lineTo(-11, 1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(113, 78, 52, .38)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.fillStyle = "rgba(111, 72, 47, .65)";
    ctx.font = "5px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("III", 0, 1);
    ctx.restore();
  }

  drawArms(pose, state) {
    const leftColor = "#c4925f";
    const rightColor = "#bc8758";
    this.bone(pose.leftShoulder, pose.leftElbow, 7.5, leftColor);
    this.bone(pose.leftElbow, pose.leftHand, 6, leftColor);
    this.bone(pose.rightShoulder, pose.rightElbow, 7.5, rightColor);
    this.bone(pose.rightElbow, pose.rightHand, 6, rightColor);
    this.woodenJoint(pose.leftElbow, 4.7);
    this.woodenJoint(pose.rightElbow, 4.7);
    this.woodenJoint(pose.leftHand, 5.2);
    this.woodenJoint(pose.rightHand, 5.2);
  }

  drawHead(pose, state, time) {
    const ctx = this.ctx;
    const h = pose.head;
    const yaw = (state.head || 0) * Math.PI / 180;
    const nod = Math.sin(time * 1.2) * 0.008;
    this.bone({ x: 0, y: -112 }, { x: 0, y: -133 }, 7, "#a8764b");
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(yaw * 0.34 + nod);

    const headGrad = ctx.createRadialGradient(-10, -12, 3, 0, 0, 41);
    headGrad.addColorStop(0, "#d3a36e");
    headGrad.addColorStop(0.54, "#b78052");
    headGrad.addColorStop(0.85, "#8a5a3b");
    headGrad.addColorStop(1, "#4b2d20");
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 34, 40, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(33,17,11,.75)";
    ctx.lineWidth = 1.3;
    ctx.stroke();

    ctx.strokeStyle = "rgba(72,41,26,.4)";
    ctx.lineWidth = 0.8;
    for (let i = -2; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * 10 - 3, -37);
      ctx.quadraticCurveTo(i * 13, -17, i * 11 + 5, 3);
      ctx.stroke();
    }

    const eyeShift = Math.sin(yaw) * 7;
    const eyes = [-10 + eyeShift, 10 + eyeShift];
    ctx.fillStyle = "#2b1810";
    for (const x of eyes) {
      ctx.beginPath();
      ctx.ellipse(x, -5, 3.1, 4.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 232, 190, .72)";
      ctx.beginPath();
      ctx.arc(x - 1, -6.5, 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2b1810";
    }

    ctx.strokeStyle = "rgba(66, 37, 23, .72)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(eyeShift * 0.3, 2);
    ctx.lineTo(eyeShift * 0.8, 9);
    ctx.stroke();

    ctx.strokeStyle = "rgba(58, 29, 18, .85)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-6 + eyeShift, 18);
    ctx.quadraticCurveTo(eyeShift, 21, 7 + eyeShift, 18);
    ctx.stroke();

    ctx.fillStyle = "#3b2118";
    ctx.beginPath();
    ctx.arc(-35, 4, 3.1, 0, Math.PI * 2);
    ctx.arc(35, 4, 3.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  armDirection(value, side) {
    const rad = Math.max(-78, Math.min(146, 16 + value)) * Math.PI / 180;
    return Math.atan2(Math.cos(rad), side * Math.sin(rad));
  }

  jointTarget(state, name) {
    const target = state.targets && state.targets[name];
    return target && target.active ? target : null;
  }

  drawArmArcs(pose, state) {
    const ctx = this.ctx;
    const pairs = [
      {
        shoulder: pose.leftShoulder,
        value: state.leftArm || 0,
        side: -1,
        target: this.jointTarget(state, "leftArm"),
        label: "左臂"
      },
      {
        shoulder: pose.rightShoulder,
        value: state.rightArm || 0,
        side: 1,
        target: this.jointTarget(state, "rightArm"),
        label: "右臂"
      }
    ];
    for (const item of pairs) {
      const p = item.shoulder;
      const dir = this.armDirection(item.value, item.side);
      const inRange = item.target && item.value >= item.target.min && item.value <= item.target.max;
      const targetAlpha = item.target ? (inRange ? 0.82 : 0.36) : 0;

      if (item.target) {
        const a = this.armDirection(item.target.min, item.side);
        const b = this.armDirection(item.target.max, item.side);
        ctx.save();
        ctx.lineCap = "round";
        ctx.strokeStyle = inRange ? "rgba(131, 191, 178, .92)" : `rgba(227, 170, 89, ${targetAlpha})`;
        ctx.lineWidth = 8;
        if (inRange) {
          ctx.shadowColor = "rgba(131, 191, 178, .55)";
          ctx.shadowBlur = 10;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, 30, a, b, item.side > 0);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255, 225, 173, .62)";
        ctx.lineWidth = 0.8;
        for (const angle of [a, b]) {
          ctx.beginPath();
          ctx.moveTo(p.x + Math.cos(angle) * 25, p.y + Math.sin(angle) * 25);
          ctx.lineTo(p.x + Math.cos(angle) * 36, p.y + Math.sin(angle) * 36);
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.save();
      ctx.strokeStyle = inRange ? "#9bd8ca" : "rgba(237, 206, 158, .74)";
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 41, Math.PI / 2, dir, item.side > 0);
      ctx.stroke();
      const tickX = p.x + Math.cos(dir) * 41;
      const tickY = p.y + Math.sin(dir) * 41;
      ctx.fillStyle = inRange ? "#b8e5d9" : "#f3d8a5";
      ctx.beginPath();
      ctx.arc(tickX, tickY, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(8,6,8,.55)";
      ctx.fillRect(tickX - 18, tickY - 8, 36, 12);
      ctx.fillStyle = inRange ? "#b8e5d9" : "rgba(243, 216, 165, .9)";
      ctx.font = "8px 'Stage CJK', 'Avenir Next', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const sign = item.value > 0 ? "+" : "";
      ctx.fillText(`${item.label} ${sign}${Math.round(item.value)}°`, tickX, tickY - 2);
      ctx.restore();
    }
  }

  drawHeadArc(pose, state) {
    const ctx = this.ctx;
    const target = this.jointTarget(state, "head");
    const inRange = target && state.head >= target.min && state.head <= target.max;
    const dir = -Math.PI / 2 + (state.head || 0) * Math.PI / 180 * 0.95;
    const center = pose.head;
    const radius = 51;

    if (target) {
      const a = -Math.PI / 2 + target.min * Math.PI / 180 * 0.95;
      const b = -Math.PI / 2 + target.max * Math.PI / 180 * 0.95;
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = inRange ? "rgba(131,191,178,.9)" : "rgba(227,170,89,.34)";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, a, b);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = inRange ? "#a9ddcf" : "rgba(239, 209, 160, .78)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius + 5, -Math.PI / 2, dir);
    ctx.stroke();
    const x = center.x + Math.cos(dir) * (radius + 5);
    const y = center.y + Math.sin(dir) * (radius + 5);
    ctx.fillStyle = inRange ? "#b8e5d9" : "#f1d6a3";
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "8px 'Stage CJK', 'Avenir Next', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const sign = state.head > 0 ? "+" : "";
    ctx.fillText(`头 ${sign}${Math.round(state.head || 0)}°`, center.x, center.y - radius - 16);
    ctx.restore();
  }

  drawWaistArc(pose, state) {
    const ctx = this.ctx;
    const target = this.jointTarget(state, "waist");
    const value = state.waist || 0;
    const inRange = target && value >= target.min && value <= target.max;
    const c = pose.pelvis;
    const dir = -Math.PI / 2 + value * Math.PI / 180 * 1.02;
    const radius = 45;

    if (target) {
      const a = -Math.PI / 2 + target.min * Math.PI / 180 * 1.02;
      const b = -Math.PI / 2 + target.max * Math.PI / 180 * 1.02;
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = inRange ? "rgba(131,191,178,.9)" : "rgba(227,170,89,.34)";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(c.x, c.y, radius, a, b);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = inRange ? "#a9ddcf" : "rgba(239, 209, 160, .78)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius + 5, -Math.PI / 2, dir);
    ctx.stroke();
    const x = c.x + Math.cos(dir) * (radius + 5);
    const y = c.y + Math.sin(dir) * (radius + 5);
    ctx.fillStyle = inRange ? "#b8e5d9" : "#f1d6a3";
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(8,6,8,.55)";
    ctx.fillRect(c.x - 22, c.y + 53, 44, 12);
    ctx.fillStyle = inRange ? "#b8e5d9" : "rgba(241,214,163,.9)";
    ctx.font = "8px 'Stage CJK', 'Avenir Next', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const sign = value > 0 ? "+" : "";
    ctx.fillText(`腰部 ${sign}${Math.round(value)}°`, c.x, c.y + 59);
    ctx.restore();
  }

  drawStrainSparks(pose, state, time) {
    const ctx = this.ctx;
    const joints = [
      { point: pose.leftShoulder, strain: state.leftStrain || 0, seed: 1 },
      { point: pose.rightShoulder, strain: state.rightStrain || 0, seed: 2 },
      { point: pose.head, strain: state.headStrain || 0, seed: 3 },
      { point: { x: 0, y: 0 }, strain: state.waistStrain || 0, seed: 4 }
    ];
    for (const joint of joints) {
      if (joint.strain < 48) continue;
      const p = joint.point === pose.head || joint.point.x === 0 && joint.point.y === 0
        ? pose.local(joint.point.x, joint.point.y)
        : pose.local(joint.point.x, joint.point.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      const flicker = 0.55 + Math.sin(time * 13 + joint.seed) * 0.24;
      ctx.globalAlpha = Math.min(1, (joint.strain - 40) / 55) * flicker;
      ctx.strokeStyle = joint.strain > 82 ? "#ff9e7d" : "#e3aa59";
      ctx.lineWidth = 1.1;
      for (let i = 0; i < 3; i += 1) {
        const angle = (joint.seed * 1.3 + i * 2.1) % (Math.PI * 2);
        const r0 = 7 + i * 2;
        const r1 = 18 + i * 5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * r0, Math.sin(angle) * r0);
        ctx.lineTo(Math.cos(angle + 0.25) * (r0 + (r1 - r0) * 0.52), Math.sin(angle + 0.25) * (r0 + (r1 - r0) * 0.52));
        ctx.lineTo(Math.cos(angle - 0.08) * r1, Math.sin(angle - 0.08) * r1);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawAtmosphere(time, state, effects) {
    const ctx = this.ctx;
    for (let i = 0; i < 34; i += 1) {
      const speed = 3 + (i % 5) * 1.3;
      const x = (i * 173 + time * speed) % 1120 + 40;
      const y = 105 + ((i * 83) % 430) + Math.sin(time * 0.38 + i) * 12;
      const a = 0.05 + ((i * 7) % 10) / 150;
      ctx.fillStyle = `rgba(244, 214, 163, ${a})`;
      ctx.beginPath();
      ctx.arc(x, y, i % 7 === 0 ? 1.2 : 0.65, 0, Math.PI * 2);
      ctx.fill();
    }

    if (effects.celebration) {
      const amount = Math.max(0, Math.min(1, effects.celebration));
      const colors = ["#e3aa59", "#d6cfb9", "#a46a57", "#83bfb2"];
      for (let i = 0; i < 36; i += 1) {
        const delay = (i % 9) * 0.13;
        const t = (time * 0.18 + delay) % 1;
        const x = 160 + ((i * 71) % 880) + Math.sin(time * 1.2 + i) * 18;
        const y = 80 + t * 520;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(time * 0.7 + i);
        ctx.fillStyle = colors[i % colors.length];
        ctx.globalAlpha = amount * (1 - t) * 0.75;
        ctx.fillRect(-2.5, -4, 5, 8);
        ctx.restore();
      }
    }

    if (effects.curtainClose > 0) {
      const close = Math.min(1, effects.curtainClose);
      this.drawClosingCurtain(80 + close * 520, -1, close);
      this.drawClosingCurtain(1120 - close * 520, 1, close);
    }
  }

  drawClosingCurtain(edge, side, close) {
    const ctx = this.ctx;
    const width = 570;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(edge, 0);
    ctx.lineTo(edge + side * width, 0);
    ctx.lineTo(edge + side * width, 700);
    ctx.lineTo(edge, 700);
    ctx.closePath();
    const g = ctx.createLinearGradient(edge, 0, edge + side * width, 0);
    g.addColorStop(0, "#2e1218");
    g.addColorStop(0.5, "#41181d");
    g.addColorStop(1, "#190a0e");
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.94;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(229,177,96,.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(edge, 0);
    ctx.lineTo(edge, 700);
    ctx.stroke();
    ctx.restore();
  }
}

window.PuppetRenderer = PuppetRenderer;
