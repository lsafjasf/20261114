import { MATERIAL_BY_ID, formatPan } from "./engine.js";

const BASE = Object.freeze({
  trayTop: 50,
  trayHeight: 142,
  waveHeight: 132,
  pad: 28,
  cardGap: 12,
});

const COLORS = Object.freeze({
  ink: "#e6e3d8",
  muted: "#7f9090",
  faint: "#3d5052",
  line: "#263539",
  amber: "#f2c66d",
  amberDim: "#7c6739",
  cyan: "#7ae2d2",
  cyanDim: "#3f7a76",
  red: "#ee7f73",
  green: "#a8df88",
  panel: "#0a1518",
  panelRaised: "#101f22",
  border: "#213438",
});

export class StageRenderer {
  constructor(canvas, { onDoor = () => {} } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onDoor = onDoor;
    this.model = null;
    this.width = 0;
    this.height = 0;
    this.layout = null;
    this.pointer = { x: -999, y: -999, down: false };
    this.hover = null;
    this.drag = null;
    this.flash = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setModel(model) {
    this.model = model;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.width = Math.max(760, rect.width);
    this.height = Math.max(640, rect.height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout = this.#computeLayout(this.width, this.height);
  }

  pointerDown(x, y) {
    this.pointer = { x, y, down: true };
    this.drag = this.hitTest(x, y);
    if (this.drag?.kind === "door") {
      this.onDoor();
      this.drag = null;
      return null;
    }
    return this.drag;
  }

  pointerMove(x, y, down = false) {
    this.pointer = { x, y, down };
    this.hover = this.hitTest(x, y);
    return this.hover;
  }

  pointerUp() {
    this.pointer.down = false;
    const drag = this.drag;
    this.drag = null;
    return drag;
  }

  setDrag(drag) {
    this.drag = drag;
  }

  bump(kind = "error") {
    this.flash = performance.now();
    this.flashKind = kind;
  }

  hitTest(x, y) {
    if (!this.model || !this.layout) return null;
    const { door } = this.layout;
    if (inside(x, y, door)) return { kind: "door" };

    const placedIds = new Set(this.model.placement.keys());
    for (const card of this.layout.trayCards) {
      if (placedIds.has(card.event.id)) continue;
      if (inside(x, y, card)) {
        return { kind: "event", eventId: card.event.id, origin: "tray", card };
      }
    }
    for (const block of this.layout.placedBlocks) {
      if (inside(x, y, block)) {
        return {
          kind: "event",
          eventId: block.event.id,
          origin: "slot",
          slot: block.slot,
          card: block,
        };
      }
    }
    for (const slot of this.layout.slots) {
      if (inside(x, y, slot)) return { kind: "slot", slot: slot.index };
    }
    return null;
  }

  render(now = performance.now()) {
    const ctx = this.ctx;
    if (!ctx || !this.model) return;
    this.layout = this.#computeLayout(this.width, this.height);
    this.#layoutCards();

    ctx.clearRect(0, 0, this.width, this.height);
    this.#drawBackdrop(ctx);
    this.#drawTray(ctx, now);
    this.#drawWavePanel(ctx, now);
    this.#drawCorridor(ctx, now);
    this.#drawDragGhost(ctx, now);
    this.#drawFlash(ctx, now);
  }

  #computeLayout(width, height) {
    const pad = BASE.pad;
    const innerWidth = width - pad * 2;
    const gap = BASE.cardGap;
    const cardWidth = (innerWidth - gap * 5) / 6;
    const trayCards = [];
    const slots = [];
    const waveTop = BASE.trayTop + BASE.trayHeight + 26;
    const corridorTop = waveTop + BASE.waveHeight + 28;
    const corridorBottom = height - 26;
    const slotGap = 12;
    const slotWidth = (innerWidth - slotGap * 5) / 6;
    const slotY = corridorBottom - 104;

    for (let index = 0; index < 6; index += 1) {
      slots.push({
        x: pad + index * (slotWidth + slotGap),
        y: slotY,
        width: slotWidth,
        height: 104,
        index,
      });
    }

    return {
      width,
      height,
      pad,
      gap,
      cardWidth,
      trayTop: BASE.trayTop,
      trayHeight: BASE.trayHeight,
      waveTop,
      waveHeight: BASE.waveHeight,
      corridorTop,
      corridorBottom,
      slotY,
      slots,
      trayCards,
      placedBlocks: [],
      door: {
        x: width - pad - 68,
        y: corridorTop + 15,
        width: 68,
        height: 58,
      },
    };
  }

  #layoutCards() {
    const { pad, gap, cardWidth, trayTop, trayHeight, slots } = this.layout;
    this.layout.trayCards = this.model.round.events.map((event, index) => ({
      x: pad + index * (cardWidth + gap),
      y: trayTop,
      width: cardWidth,
      height: trayHeight,
      event,
    }));

    this.layout.placedBlocks = [];
    for (const [eventId, slotIndex] of this.model.placement) {
      const slot = slots[slotIndex];
      const event = this.model.round.events.find((item) => item.id === eventId);
      if (!event) continue;
      this.layout.placedBlocks.push({
        x: slot.x + 4,
        y: slot.y - 96,
        width: slot.width - 8,
        height: 92,
        event,
        slot: slotIndex,
      });
    }
  }

  #drawBackdrop(ctx) {
    const { width, height } = this.layout;
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#091417");
    bg.addColorStop(0.56, "#071013");
    bg.addColorStop(1, "#0a1415");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(122, 226, 210, 0.035)";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }

    const glow = ctx.createRadialGradient(width * 0.7, 80, 0, width * 0.7, 80, width * 0.55);
    glow.addColorStop(0, "rgba(242, 198, 109, 0.07)");
    glow.addColorStop(1, "rgba(242, 198, 109, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height * 0.6);
  }

  #drawTray(ctx, now) {
    const { pad, trayTop, trayHeight, cardWidth, gap } = this.layout;
    this.#sectionTitle(ctx, pad, trayTop - 22, "01 / 声纹样本架", "SIX ISOLATED GROUND CONTACTS");
    ctx.fillStyle = COLORS.faint;
    ctx.font = mono(10, 500);
    ctx.textAlign = "right";
    ctx.fillText(`${this.model.round.seed}  ·  实时合成`, this.width - pad, trayTop - 22);
    ctx.textAlign = "left";

    const placedIds = new Set(this.model.placement.keys());
    for (const card of this.layout.trayCards) {
      if (placedIds.has(card.event.id)) {
        this.#drawEmptyCard(ctx, card);
      } else {
        this.#drawSampleCard(ctx, card, now);
      }
    }

    if (this.layout.trayCards.length) {
      const right = this.layout.trayCards.at(-1).x + this.layout.trayCards.at(-1).width;
      ctx.strokeStyle = COLORS.line;
      ctx.beginPath();
      ctx.moveTo(pad, trayTop + trayHeight + 10);
      ctx.lineTo(right, trayTop + trayHeight + 10);
      ctx.stroke();
    }
  }

  #drawEmptyCard(ctx, card) {
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = "rgba(127, 144, 144, 0.22)";
    ctx.lineWidth = 1;
    roundRect(ctx, card.x, card.y, card.width, card.height, 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(127, 144, 144, 0.2)";
    ctx.font = mono(10);
    ctx.textAlign = "center";
    ctx.fillText("已落位", card.x + card.width / 2, card.y + card.height / 2);
    ctx.textAlign = "left";
  }

  #drawSampleCard(ctx, card, now) {
    const { event } = card;
    const material = MATERIAL_BY_ID[event.materialId];
    const selected = this.model.selectedId === event.id;
    const hover = this.hover?.kind === "event" && this.hover.eventId === event.id;
    const dragging = this.drag?.kind === "event" && this.drag.eventId === event.id;
    if (dragging) return;

    ctx.save();
    if (hover) ctx.translate(0, -3);
    const body = ctx.createLinearGradient(card.x, card.y, card.x, card.y + card.height);
    body.addColorStop(0, appAlpha(material.color, 0.22));
    body.addColorStop(0.18, COLORS.panelRaised);
    body.addColorStop(1, COLORS.panel);
    fillRoundRect(ctx, card.x, card.y, card.width, card.height, 8, body);
    ctx.strokeStyle = selected ? COLORS.amber : hover ? material.color : COLORS.border;
    ctx.lineWidth = selected ? 1.5 : 1;
    roundRect(ctx, card.x, card.y, card.width, card.height, 8);
    ctx.stroke();

    ctx.fillStyle = material.color;
    ctx.font = mono(10, 700);
    ctx.fillText(`${event.label} / ${material.code}`, card.x + 11, card.y + 18);
    ctx.fillStyle = COLORS.muted;
    ctx.font = cjk(11, 600);
    ctx.textAlign = "right";
    ctx.fillText(material.name, card.x + card.width - 10, card.y + 18);
    ctx.textAlign = "left";

    this.#miniWave(ctx, event, card.x + 10, card.y + 29, card.width - 20, 38, material.color, now);

    ctx.strokeStyle = COLORS.line;
    ctx.beginPath();
    ctx.moveTo(card.x + 10, card.y + 75);
    ctx.lineTo(card.x + card.width - 10, card.y + 75);
    ctx.stroke();

    this.#reading(ctx, card.x + 10, card.y + 91, "回声", `${event.echoMs}`, "ms");
    this.#reading(ctx, card.x + 10, card.y + 111, "偏向", formatPan(event.pan), "");
    this.#reading(ctx, card.x + 10, card.y + 131, "低频", `${event.lowFreq}%`, "");
    ctx.restore();
  }

  #reading(ctx, x, y, key, value, unit) {
    ctx.font = cjk(9, 500);
    ctx.fillStyle = COLORS.faint;
    ctx.fillText(key, x, y);
    ctx.font = mono(11, 600);
    ctx.fillStyle = COLORS.ink;
    const valueText = unit ? `${value} ${unit}` : value;
    ctx.fillText(valueText, x + 34, y);
  }

  #miniWave(ctx, event, x, y, width, height, color, now) {
    const mid = y + height / 2;
    const wave = event.wave;
    ctx.fillStyle = "rgba(4, 10, 12, 0.45)";
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = "rgba(122, 226, 210, 0.08)";
    ctx.beginPath();
    ctx.moveTo(x, mid);
    ctx.lineTo(x + width, mid);
    ctx.stroke();
    const active = this.model.selectedId === event.id && this.model.playing;
    const limit = active ? Math.ceil(wave.length * this.model.playProgress(now)) : wave.length;
    ctx.strokeStyle = active ? color : appAlpha(color, 0.66);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let index = 0; index < limit; index += 1) {
      const px = x + (index / (wave.length - 1)) * width;
      const py = mid - wave[index] * (height * 0.4);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  #drawWavePanel(ctx, now) {
    const { pad, waveTop, waveHeight } = this.layout;
    const innerWidth = this.width - pad * 2;
    this.#sectionTitle(ctx, pad, waveTop - 18, "02 / 监听台", "LIVE SIGNAL MONITOR");

    const selected = this.model.round.events.find((event) => event.id === this.model.selectedId);
    fillRoundRect(
      ctx,
      pad,
      waveTop,
      innerWidth,
      waveHeight,
      7,
      "rgba(6, 14, 16, 0.78)",
    );
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    roundRect(ctx, pad, waveTop, innerWidth, waveHeight, 7);
    ctx.stroke();
    this.#waveGrid(ctx, pad + 14, waveTop + 16, innerWidth - 28, waveHeight - 32);

    if (!selected) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = cjk(12, 500);
      ctx.textAlign = "center";
      ctx.fillText("选择一段声纹开始监听", this.width / 2, waveTop + waveHeight / 2);
      ctx.textAlign = "left";
      return;
    }

    const material = MATERIAL_BY_ID[selected.materialId];
    ctx.fillStyle = material.color;
    ctx.font = mono(11, 700);
    ctx.fillText(`${selected.label} / ${material.en}`, pad + 14, waveTop + 18);
    ctx.fillStyle = COLORS.muted;
    ctx.font = cjk(11);
    ctx.textAlign = "right";
    ctx.fillText(
      this.model.playing && this.model.playingId === selected.id
        ? "正在合成 · REALTIME"
        : "按播放或拖动以试听",
      pad + innerWidth - 14,
      waveTop + 18,
    );
    ctx.textAlign = "left";

    const live = this.model.playing && this.model.playingId === selected.id
      ? this.model.liveSamples
      : null;
    this.#largeWave(ctx, selected, pad + 16, waveTop + 31, innerWidth - 32, waveHeight - 46, live);
  }

  #waveGrid(ctx, x, y, width, height) {
    ctx.strokeStyle = "rgba(122, 226, 210, 0.08)";
    ctx.lineWidth = 1;
    for (let row = 0; row <= 4; row += 1) {
      const py = y + (row / 4) * height;
      ctx.beginPath();
      ctx.moveTo(x, py + 0.5);
      ctx.lineTo(x + width, py + 0.5);
      ctx.stroke();
    }
    for (let column = 0; column <= 12; column += 1) {
      const px = x + (column / 12) * width;
      ctx.beginPath();
      ctx.moveTo(px + 0.5, y);
      ctx.lineTo(px + 0.5, y + height);
      ctx.stroke();
    }
  }

  #largeWave(ctx, event, x, y, width, height, live) {
    const material = MATERIAL_BY_ID[event.materialId];
    const mid = y + height / 2;
    const values = live?.length === event.wave.length ? live : event.wave;
    const baseY = y + 9;

    ctx.strokeStyle = "rgba(230, 227, 216, 0.055)";
    ctx.beginPath();
    ctx.moveTo(x, mid);
    ctx.lineTo(x + width, mid);
    ctx.stroke();

    ctx.strokeStyle = live ? COLORS.amber : appAlpha(COLORS.cyan, 0.86);
    ctx.lineWidth = live ? 1.8 : 1.2;
    ctx.beginPath();
    for (let index = 0; index < values.length; index += 1) {
      const px = x + (index / (values.length - 1)) * width;
      const value = values[index] * (live ? 1 : 0.92);
      const py = baseY + (1 - value) * (height - 18) * 0.5;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    if (live) {
      ctx.fillStyle = appAlpha(COLORS.amber, 0.09);
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      for (let index = 0; index < values.length; index += 1) {
        const px = x + (index / (values.length - 1)) * width;
        const py = baseY + (1 - values[index]) * (height - 18) * 0.5;
        ctx.lineTo(px, py);
      }
      ctx.lineTo(x + width, baseY);
      ctx.closePath();
      ctx.fill();
    }

    if (this.model.playing && this.model.playingId === event.id) {
      const playX = x + width * this.model.playProgress();
      ctx.strokeStyle = appAlpha(COLORS.amber, 0.7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(playX, y + 2);
      ctx.lineTo(playX, y + height - 2);
      ctx.stroke();
    }

    ctx.fillStyle = COLORS.faint;
    ctx.font = mono(9);
    ctx.fillText("+6", x, y - 2);
    ctx.fillText("-6", x, y + height + 10);
    ctx.textAlign = "right";
    ctx.fillText(`${material.grainHz} Hz 纹理`, x + width, y + height + 10);
    ctx.textAlign = "left";
  }

  #drawCorridor(ctx, now) {
    const { pad, corridorTop, corridorBottom, slotY } = this.layout;
    const innerWidth = this.width - pad * 2;
    this.#sectionTitle(ctx, pad, corridorTop - 18, "03 / 走廊时间线", "CORRIDOR TIMELINE");
    ctx.fillStyle = COLORS.faint;
    ctx.font = mono(10, 500);
    ctx.textAlign = "right";
    ctx.fillText("入口 01  →  终端 06", this.width - pad, corridorTop - 18);
    ctx.textAlign = "left";

    const corridorHeight = corridorBottom - corridorTop;
    fillRoundRect(
      ctx,
      pad,
      corridorTop,
      innerWidth,
      corridorHeight,
      7,
      "rgba(5, 12, 14, 0.62)",
    );
    ctx.strokeStyle = "rgba(122, 226, 210, 0.07)";
    for (let line = 0; line < 4; line += 1) {
      ctx.beginPath();
      ctx.moveTo(pad, corridorTop + 55 + line * 33);
      ctx.lineTo(this.width - pad, corridorTop + 55 + line * 33);
      ctx.stroke();
    }

    const centerY = slotY + 39;
    ctx.strokeStyle = appAlpha(COLORS.cyan, 0.24);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad + 16, centerY);
    ctx.lineTo(this.width - pad - 16, centerY);
    ctx.stroke();
    ctx.fillStyle = appAlpha(COLORS.cyan, 0.12);
    ctx.fillRect(pad + 16, centerY - 4, innerWidth - 32, 8);

    this.#drawDoor(ctx, this.model.round.doorOpen, now);
    this.#drawSlots(ctx, now);
    for (const block of this.layout.placedBlocks) this.#drawPlacedBlock(ctx, block, now);
    if (this.model.phase === "success") this.#drawSourcePath(ctx, now);
    this.#drawCorridorLabels(ctx);
  }

  #drawDoor(ctx, open, now) {
    const { door } = this.layout;
    const pulse = ((now % 2200) / 2200) * 0.22;
    ctx.save();
    ctx.fillStyle = open
      ? `rgba(242, 198, 109, ${0.12 + pulse})`
      : "rgba(122, 226, 210, 0.05)";
    ctx.strokeStyle = open ? COLORS.amber : COLORS.faint;
    ctx.lineWidth = open ? 1.5 : 1;
    roundRect(ctx, door.x, door.y, door.width, door.height, 4);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = open ? COLORS.amber : COLORS.muted;
    ctx.beginPath();
    if (open) {
      ctx.moveTo(door.x + 10, door.y + 48);
      ctx.lineTo(door.x + 10, door.y + 14);
      ctx.lineTo(door.x + 55, door.y + 17);
      ctx.lineTo(door.x + 55, door.y + 48);
    } else {
      ctx.rect(door.x + 13, door.y + 10, 42, 38);
    }
    ctx.stroke();
    ctx.fillStyle = open ? COLORS.amber : COLORS.muted;
    ctx.font = cjk(9, 700);
    ctx.textAlign = "center";
    ctx.fillText(open ? "侧门开启" : "侧门封闭", door.x + door.width / 2, door.y + door.height - 17);
    ctx.textAlign = "left";
    ctx.restore();
  }

  #drawSlots(ctx, now) {
    for (const slot of this.layout.slots) {
      const occupied = this.model.placement.has(this.model.slotEventId?.[slot.index]);
      const hovered = this.hover?.kind === "slot" && this.hover.slot === slot.index;
      ctx.fillStyle = hovered
        ? "rgba(242, 198, 109, 0.1)"
        : occupied
          ? "rgba(122, 226, 210, 0.045)"
          : "rgba(9, 22, 24, 0.7)";
      fillRoundRect(ctx, slot.x, slot.y, slot.width, slot.height, 5, ctx.fillStyle);
      ctx.strokeStyle = hovered
        ? COLORS.amber
        : occupied
          ? appAlpha(COLORS.cyan, 0.32)
          : COLORS.line;
      ctx.lineWidth = hovered ? 1.4 : 1;
      roundRect(ctx, slot.x, slot.y, slot.width, slot.height, 5);
      ctx.stroke();

      const centerX = slot.x + slot.width / 2;
      ctx.fillStyle = hovered ? COLORS.amber : COLORS.faint;
      ctx.font = mono(12, 700);
      ctx.textAlign = "center";
      ctx.fillText(String(slot.index + 1).padStart(2, "0"), centerX, slot.y + slot.height - 13);
      ctx.textAlign = "left";

      if (!occupied) {
        ctx.fillStyle = COLORS.faint;
        ctx.font = mono(9);
        ctx.fillText("+", centerX - 3, slot.y + 40);
        ctx.beginPath();
        ctx.arc(centerX, slot.y + 37, 9, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(127, 144, 144, 0.18)";
        ctx.stroke();
      }
    }
  }

  #drawPlacedBlock(ctx, block, now) {
    const { event, slot } = block;
    const material = MATERIAL_BY_ID[event.materialId];
    const selected = this.model.selectedId === event.id;
    const dragging = this.drag?.kind === "event" && this.drag.eventId === event.id;
    if (dragging) return;
    const correct = this.model.phase === "success" && event.targetSlot === slot;

    const fill = ctx.createLinearGradient(block.x, block.y, block.x, block.y + block.height);
    fill.addColorStop(0, appAlpha(material.color, 0.25));
    fill.addColorStop(0.28, COLORS.panelRaised);
    fill.addColorStop(1, COLORS.panel);
    fillRoundRect(ctx, block.x, block.y, block.width, block.height, 6, fill);
    ctx.strokeStyle = selected
      ? COLORS.amber
      : correct
        ? COLORS.green
        : appAlpha(material.color, 0.72);
    ctx.lineWidth = selected || correct ? 1.6 : 1;
    roundRect(ctx, block.x, block.y, block.width, block.height, 6);
    ctx.stroke();

    ctx.fillStyle = material.color;
    ctx.font = mono(9, 700);
    ctx.fillText(`${event.label} / ${material.code}`, block.x + 8, block.y + 15);
    ctx.fillStyle = COLORS.muted;
    ctx.font = cjk(9);
    ctx.textAlign = "right";
    ctx.fillText(material.name, block.x + block.width - 8, block.y + 15);
    ctx.textAlign = "left";
    this.#miniWave(ctx, event, block.x + 8, block.y + 22, block.width - 16, 28, material.color, now);
    ctx.fillStyle = COLORS.muted;
    ctx.font = mono(8.5);
    ctx.fillText(`${event.echoMs}ms · ${formatPan(event.pan)}`, block.x + 8, block.y + 65);
    ctx.fillStyle = material.color;
    ctx.textAlign = "right";
    ctx.fillText(`LOW ${event.lowFreq}`, block.x + block.width - 8, block.y + 65);
    ctx.textAlign = "left";

    if (this.model.phase === "success") {
      ctx.fillStyle = correct ? COLORS.green : COLORS.red;
      ctx.font = mono(10, 700);
      ctx.textAlign = "center";
      ctx.fillText(correct ? "MATCH" : "±", block.x + block.width / 2, block.y + 83);
      ctx.textAlign = "left";
    }
  }

  #drawSourcePath(ctx, now) {
    const reveal = clamp((now - (this.model.successAt || now)) / 800, 0, 1);
    const events = this.model.round.targetOrder
      .map((id) => this.model.round.events.find((event) => event.id === id))
      .filter(Boolean);
    const points = [];
    const startX = this.layout.pad + 24;
    const baseY = this.layout.corridorTop + 92;
    points.push({ x: startX, y: baseY });
    for (const event of events) {
      const slot = this.layout.slots[event.targetSlot];
      points.push({
        x: slot.x + slot.width / 2,
        y: baseY + event.pan * 16,
      });
    }
    points.push({ x: this.width - this.layout.pad - 24, y: baseY - 4 });

    ctx.save();
    ctx.strokeStyle = appAlpha(COLORS.amber, 0.22);
    ctx.lineWidth = 7;
    ctx.shadowColor = COLORS.amber;
    ctx.shadowBlur = 16;
    this.#pathLine(ctx, points, reveal);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = COLORS.amber;
    ctx.lineWidth = 2;
    this.#pathLine(ctx, points, reveal);
    ctx.stroke();

    for (let index = 0; index < points.length; index += 1) {
      const progress = index / (points.length - 1);
      if (progress > reveal) break;
      const point = points[index];
      ctx.fillStyle = index === 0 || index === points.length - 1 ? COLORS.ink : COLORS.amber;
      ctx.beginPath();
      ctx.arc(point.x, point.y, index === 0 || index === points.length - 1 ? 3.5 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = COLORS.amber;
    ctx.font = cjk(10, 700);
    ctx.textAlign = "center";
    ctx.fillText("复原声源路径", this.width / 2, baseY - 25);
    ctx.textAlign = "left";
    ctx.restore();
  }

  #pathLine(ctx, points, reveal) {
    const visible = Math.max(1, (points.length - 1) * reveal);
    ctx.beginPath();
    for (let index = 0; index < points.length; index += 1) {
      if (index > visible) break;
      const point = points[index];
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        const previous = points[index - 1];
        const midX = (previous.x + point.x) / 2;
        ctx.bezierCurveTo(midX, previous.y, midX, point.y, point.x, point.y);
      }
    }
  }

  #drawCorridorLabels(ctx) {
    const { pad, corridorTop, corridorBottom } = this.layout;
    ctx.fillStyle = COLORS.faint;
    ctx.font = mono(9);
    ctx.fillText("B1 / SERVICE PASSAGE", pad + 15, corridorTop + 20);
    ctx.save();
    ctx.translate(pad + 17, corridorBottom - 18);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("ENTRY", 0, 0);
    ctx.restore();
    ctx.textAlign = "right";
    ctx.fillText("SEALED END", this.width - pad - 14, corridorTop + 92);
    ctx.textAlign = "left";
    if (this.model.phase === "success") {
      ctx.fillStyle = COLORS.amber;
      ctx.font = mono(10, 700);
      ctx.textAlign = "right";
      ctx.fillText("PATH RECONSTRUCTED / 0" + this.model.evaluation.mismatches, this.width - pad - 12, corridorTop + 20);
      ctx.textAlign = "left";
    }
  }

  #drawDragGhost(ctx, now) {
    if (!this.drag?.eventId) return;
    const event = this.model.round.events.find((item) => item.id === this.drag.eventId);
    if (!event) return;
    const material = MATERIAL_BY_ID[event.materialId];
    const width = Math.min(148, this.layout.cardWidth);
    const x = this.pointer.x - width / 2;
    const y = this.pointer.y - 47;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.translate(x, y);
    ctx.rotate(-0.015);
    fillRoundRect(ctx, 0, 0, width, 88, 7, "rgba(9, 22, 24, 0.96)");
    ctx.strokeStyle = COLORS.amber;
    ctx.lineWidth = 1.4;
    roundRect(ctx, 0, 0, width, 88, 7);
    ctx.stroke();
    ctx.fillStyle = material.color;
    ctx.font = mono(9.5, 700);
    ctx.fillText(`${event.label} / ${material.code}`, 9, 15);
    ctx.fillStyle = COLORS.muted;
    ctx.font = cjk(9.5);
    ctx.textAlign = "right";
    ctx.fillText(material.name, width - 8, 15);
    ctx.textAlign = "left";
    this.#miniWave(ctx, event, 8, 24, width - 16, 29, material.color, now);
    ctx.fillStyle = COLORS.ink;
    ctx.font = mono(8.5);
    ctx.fillText(`${event.echoMs}ms  ${formatPan(event.pan)}  ${event.lowFreq}%`, 9, 72);
    ctx.restore();
  }

  #drawFlash(ctx, now) {
    if (!this.flash) return;
    const age = now - this.flash;
    if (age > 620) {
      this.flash = 0;
      return;
    }
    const color = this.flashKind === "success" ? COLORS.green : COLORS.red;
    ctx.save();
    ctx.strokeStyle = appAlpha(color, (1 - age / 620) * 0.8);
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, this.width - 4, this.height - 4);
    ctx.restore();
  }

  #sectionTitle(ctx, x, y, title, subtitle) {
    ctx.fillStyle = COLORS.ink;
    ctx.font = cjk(11, 700);
    ctx.fillText(title, x, y);
    const titleWidth = ctx.measureText(title).width;
    ctx.fillStyle = COLORS.faint;
    ctx.font = mono(9);
    ctx.fillText(subtitle, x + titleWidth + 12, y);
  }
}

function mono(size, weight = 500) {
  return `${weight} ${size}px "SFMono-Regular", "Cascadia Mono", "Consolas", "Noto Sans SC", monospace`;
}

function cjk(size, weight = 400) {
  return `${weight} ${size}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
}

function roundRect(ctx, x, y, width, height, radius) {
  const safe = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safe, y);
  ctx.arcTo(x + width, y, x + width, y + height, safe);
  ctx.arcTo(x + width, y + height, x, y + height, safe);
  ctx.arcTo(x, y + height, x, y, safe);
  ctx.arcTo(x, y, x + width, y, safe);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, width, height, radius, fill) {
  roundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
}

function inside(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function appAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const number = Number.parseInt(value.length === 3 ? value.split("").map((char) => char + char).join("") : value, 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
