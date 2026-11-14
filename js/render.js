/* Canvas 2D 渲染：街景 + 手持相机变换 + 取景框裁剪 + 安全区/警告叠加。 */
(function () {
  "use strict";
  const HH = (window.HH = window.HH || globalThis.HH || {}); globalThis.HH = HH;

  HH.Renderer = function Renderer(canvas, sceneCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.scene = sceneCanvas;
    this.showSafe = true;
  };

  HH.Renderer.prototype.render = function (state, playT) {
    const ctx = this.ctx;
    const vw = HH.VIEW_W;
    const vh = HH.VIEW_H;
    const sw = HH.SCENE_W;
    const sh = HH.SCENE_H;

    ctx.fillStyle = "#050608";
    ctx.fillRect(0, 0, vw, vh);

    ctx.save();
    ctx.translate(vw / 2, vh / 2);
    ctx.rotate(HH.degToRad(state.roll));
    ctx.translate(-sw / 2 + state.pan, -sh / 2 + state.tilt);
    ctx.drawImage(this.scene, 0, 0);
    ctx.restore();

    const edges = HH.overscanEdges(sw, sh, vw, vh, state);

    if (this.showSafe) this.drawSafeOverlay(state);
    if (edges.length) this.drawWarningBorder(edges);

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(12, 12, 150, 52);
    ctx.fillStyle = "#dfe6f0";
    ctx.font = "13px monospace";
    ctx.fillText(
          "X " + state.pan.toFixed(1) + "px", 22, 32);
    ctx.fillText(
          "Y " + state.tilt.toFixed(1) + "px  R " + state.roll.toFixed(2) + "°", 22, 52);

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(vw - 132, vh - 34, 120, 24);
    ctx.fillStyle = "#dfe6f0";
    ctx.fillText("t " + playT.toFixed(2), vw - 122, vh - 17);

    return edges;
  };

  HH.Renderer.prototype.drawSafeOverlay = function (state) {
    const ctx = this.ctx;
    const vw = HH.VIEW_W;
    const vh = HH.VIEW_H;
    ctx.save();
    ctx.strokeStyle = "rgba(70,209,138,0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(vw * 0.05, vh * 0.05, vw * 0.9, vh * 0.9);
    ctx.restore();

    const corners = HH.viewCornersInScene(HH.SCENE_W, HH.SCENE_H, vw, vh, state);
    const angle = HH.degToRad(state.roll);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.save();
    ctx.strokeStyle = "rgba(255,210,122,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    corners.forEach((p, i) => {
      const dx = p.x - (HH.SCENE_W / 2 + state.pan);
      const dy = p.y - (HH.SCENE_H / 2 + state.tilt);
      const x = vw / 2 + cos * dx - sin * dy;
      const y = vh / 2 + sin * dx + cos * dy;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  };

  HH.Renderer.prototype.drawWarningBorder = function (edges) {
    const ctx = this.ctx;
    const vw = HH.VIEW_W;
    const vh = HH.VIEW_H;
    ctx.save();
    ctx.strokeStyle = "rgba(255,93,93,0.95)";
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, vw - 10, vh - 10);
    ctx.fillStyle = "rgba(255,93,93,0.18)";
    ctx.fillRect(0, 0, vw, vh);
    ctx.restore();

    const labels = {
      "左": [0, vh / 2, -90],
      "右": [vw, vh / 2, 90],
      "上": [vw / 2, 0, 0],
      "下": [vw / 2, vh, 0],
    };
    ctx.save();
    ctx.font = "bold 15px sans-serif";
    edges.forEach((edge) => {
      const [x, y, rot] = labels[edge];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(HH.degToRad(rot));
      ctx.fillStyle = "#ff5d5d";
      ctx.fillText(edge + "侧露边", -30, rot ? -14 : 24);
      ctx.restore();
    });
    ctx.restore();
  };

  HH.Renderer.prototype.exportFrame = function (state) {
    const out = document.createElement("canvas");
    out.width = HH.VIEW_W;
    out.height = HH.VIEW_H;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#050608";
    ctx.fillRect(0, 0, HH.VIEW_W, HH.VIEW_H);
    ctx.save();
    ctx.translate(HH.VIEW_W / 2, HH.VIEW_H / 2);
    ctx.rotate(HH.degToRad(state.roll));
    ctx.translate(-HH.SCENE_W / 2 + state.pan, -HH.SCENE_H / 2 + state.tilt);
    ctx.drawImage(this.scene, 0, 0);
    ctx.restore();
    return out.toDataURL("image/png");
  };
})();
