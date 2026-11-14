// Canvas renderer: magnetic field, coils, rings, ball trail, HUD.
window.Renderer = (function () {
  const CFG = Physics.CFG;

  function draw(ctx, s, auto) {
    ctx.clearRect(0, 0, CFG.W, CFG.H);
    drawField(ctx, s);
    drawBase(ctx, s);
    drawRings(ctx, s);
    drawTrail(ctx, s);
    drawCoils(ctx, s);
    drawBall(ctx, s);
    drawHud(ctx, s, auto);
    if (s.phase === "success") overlay(ctx, "任务完成！安全着陆", "#7dffa8", "得分 " + s.score + " · 触环 " + s.touches + " 次 · 空格重来");
    if (s.phase === "crashed") overlay(ctx, "球体坠毁", "#ff7d7d", "按空格重新开始");
  }

  function drawField(ctx, s) {
    // field lines: arcs from each coil toward the ball, alpha ~ current
    ctx.save();
    for (let i = 0; i < 4; i++) {
      const c = CFG.coils[i];
      const I = s.currents[i] / CFG.iMax;
      if (I < 0.02) continue;
      const lines = 7;
      for (let j = 0; j < lines; j++) {
        const t = (j + 0.5) / lines;
        const px = c.x + (s.x - c.x) * t;
        const py = c.y + (s.y - c.y) * t;
        const r = 26 + 90 * t;
        const a = I * (1 - t * 0.75) * 0.5;
        ctx.strokeStyle = `rgba(90,160,255,${a.toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // straight field rays
      for (let j = 0; j < 5; j++) {
        const ang = (j / 5) * Math.PI * 2 + s.t * 0.3;
        ctx.strokeStyle = `rgba(120,190,255,${(I * 0.25).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(ang) * 24, c.y + Math.sin(ang) * 24);
        ctx.lineTo(c.x + Math.cos(ang) * (24 + 40 * I), c.y + Math.sin(ang) * (24 + 40 * I));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawCoils(ctx, s) {
    for (let i = 0; i < 4; i++) {
      const c = CFG.coils[i];
      const I = s.currents[i] / CFG.iMax;
      ctx.save();
      ctx.translate(c.x, c.y);
      const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 46);
      glow.addColorStop(0, `rgba(120,190,255,${0.55 * I})`);
      glow.addColorStop(1, "rgba(120,190,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(-46, -46, 92, 92);
      ctx.fillStyle = "#22345e";
      ctx.strokeStyle = "#4d9fff";
      ctx.lineWidth = 2;
      roundRect(ctx, -18, -14, 36, 28, 6);
      ctx.fill(); ctx.stroke();
      // winding
      ctx.strokeStyle = `rgba(255,${120 + Math.round(100 * I)},80,${0.35 + 0.65 * I})`;
      ctx.lineWidth = 2.4;
      for (let w = -10; w <= 10; w += 5) {
        ctx.beginPath(); ctx.moveTo(w, -12); ctx.lineTo(w, 12); ctx.stroke();
      }
      ctx.fillStyle = "#9fc6ff";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(s.currents[i].toFixed(2) + "A", 0, 4);
      ctx.restore();
    }
  }

  function drawRings(ctx, s) {
    CFG.rings.forEach((r, idx) => {
      const done = s.ringDone[idx];
      const active = idx === s.ringIdx && s.phase === "rings";
      const pulse = active ? 1 + 0.06 * Math.sin(s.t * 6) : 1;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.scale(pulse, pulse);
      ctx.lineWidth = CFG.ringOut - CFG.ringIn;
      const flash = active && s.touchFlash > 0;
      ctx.strokeStyle = done ? "rgba(90,220,140,0.85)"
        : flash ? "rgba(255,90,90,0.95)"
        : active ? "rgba(255,205,90,0.9)" : "rgba(110,130,180,0.35)";
      ctx.beginPath();
      ctx.arc(0, 0, (CFG.ringIn + CFG.ringOut) / 2, 0, Math.PI * 2);
      ctx.stroke();
      if (done) {
        ctx.fillStyle = "rgba(90,220,140,0.9)";
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("✓", 0, 0);
      }
      ctx.restore();
    });
  }

  function drawBase(ctx, s) {
    const b = CFG.base;
    const active = s.phase === "landing";
    ctx.save();
    ctx.fillStyle = active ? "rgba(90,220,140,0.3)" : "rgba(120,140,190,0.18)";
    ctx.fillRect(b.x0, b.y, b.x1 - b.x0, CFG.H - b.y);
    ctx.strokeStyle = active ? "#5adc8c" : "#3a4f7e";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(b.x0, b.y); ctx.lineTo(b.x1, b.y); ctx.stroke();
    if (active) {
      ctx.fillStyle = "#7dffa8";
      ctx.font = "12px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("安全着陆区 · 慢速下降", (b.x0 + b.x1) / 2, b.y + 16);
    }
    // floor line
    ctx.strokeStyle = "rgba(70,90,140,0.5)";
    ctx.beginPath(); ctx.moveTo(0, CFG.base.y); ctx.lineTo(CFG.W, CFG.base.y); ctx.stroke();
    ctx.restore();
  }

  function drawTrail(ctx, s) {
    const n = s.trail.length;
    for (let i = 1; i < n; i++) {
      const a = (i / n) * 0.5;
      ctx.strokeStyle = `rgba(255,180,90,${a.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.trail[i - 1].x, s.trail[i - 1].y);
      ctx.lineTo(s.trail[i].x, s.trail[i].y);
      ctx.stroke();
    }
  }

  function drawBall(ctx, s) {
    ctx.save();
    const g = ctx.createRadialGradient(s.x - 3, s.y - 4, 1, s.x, s.y, CFG.ballR + 8);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.4, "#ffd27f");
    g.addColorStop(1, "rgba(255,150,50,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(s.x, s.y, CFG.ballR + 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffb84d";
    ctx.strokeStyle = "#fff2d9";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, CFG.ballR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (s.gustFlash > 0) {
      ctx.strokeStyle = `rgba(160,220,255,${s.gustFlash})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, CFG.ballR + 16 + 10 * (0.6 - s.gustFlash), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawHud(ctx, s, auto) {
    ctx.save();
    ctx.fillStyle = "#cfe3ff";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("得分 " + s.score, 16, 26);
    ctx.fillText("圆环 " + s.ringDone.filter(Boolean).length + " / 3", 16, 46);
    ctx.fillText("触环 " + s.touches, 16, 66);
    ctx.textAlign = "right";
    ctx.fillText("高度 " + Math.round(CFG.base.y - s.y) + " px", CFG.W - 16, 26);
    ctx.fillText("扰动 " + Math.round(Math.hypot(s.distFx, s.distFy)), CFG.W - 16, 46);
    if (auto) {
      ctx.fillStyle = "#7dffa8";
      ctx.fillText("自动驾驶中", CFG.W - 16, 66);
    }
    if (s.phase === "landing") {
      ctx.fillStyle = "#7dffa8";
      ctx.textAlign = "center";
      ctx.fillText("三环完成 —— 缓缓落回底座！", CFG.W / 2, 26);
    }
    ctx.restore();
  }

  function overlay(ctx, title, color, sub) {
    ctx.save();
    ctx.fillStyle = "rgba(5,10,25,0.55)";
    ctx.fillRect(0, 0, CFG.W, CFG.H);
    ctx.fillStyle = color;
    ctx.font = "bold 34px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(title, CFG.W / 2, CFG.H / 2 - 12);
    ctx.fillStyle = "#cfe3ff";
    ctx.font = "16px sans-serif";
    ctx.fillText(sub, CFG.W / 2, CFG.H / 2 + 26);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return { draw };
})();
