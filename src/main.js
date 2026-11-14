(function () {
  "use strict";

  const canvas = document.getElementById("game");
  const toast = document.getElementById("toast");
  const liveStatus = document.getElementById("liveStatus");
  const soundToggle = document.getElementById("soundToggle");
  const audio = new window.OrbitalAudio();
  let toastTimer = 0;

  function showToast(message, kind) {
    toast.textContent = message;
    toast.className = `toast visible ${kind || ""}`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("visible");
    }, 2100);
  }

  function announce(status) {
    if (status.phase === "success") {
      liveStatus.textContent = "任务完成，三条吊舱全部锁定。按 R 重新部署。";
    } else if (status.phase === "failed") {
      liveStatus.textContent = "任务失败。按 R 重新部署。";
    } else if (status.holding) {
      liveStatus.textContent = `已夹紧 ${status.holding}。`;
    } else if (status.emptyClamps > 0) {
      liveStatus.textContent = `夹空计数 ${status.emptyClamps}。`;
    } else if (status.collisions > 0) {
      liveStatus.textContent = `发生碰撞 ${status.collisions} 次。`;
    }
  }

  const game = new window.ArmGame({
    audio,
    onToast: showToast,
    onStatus: announce,
  });
  const renderer = new window.OrbitalRenderer(canvas, game);
  const pressed = new Set();

  function ensureAudio() {
    if (!audio.context) {
      audio.start();
      soundToggle.setAttribute("aria-pressed", "true");
      soundToggle.querySelector(".sound-label").textContent = "SOUND ON";
    }
  }

  function updateAxis(axis) {
    if (axis === "turn") {
      const value = (pressed.has("KeyD") ? 1 : 0) - (pressed.has("KeyA") ? 1 : 0);
      game.setControl("turn", value);
    } else {
      const value = (pressed.has("KeyW") ? 1 : 0) - (pressed.has("KeyS") ? 1 : 0);
      game.setControl("reach", value);
    }
  }

  function restart() {
    pressed.clear();
    game.reset(true);
    showToast("任务重新部署 · 吊舱已复位", "success");
  }

  window.addEventListener("keydown", (event) => {
    const code = event.code;
    if (["KeyA", "KeyD", "KeyW", "KeyS", "Space", "KeyR", "KeyM", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code)) {
      event.preventDefault();
    }
    ensureAudio();
    if (code === "KeyM" && !event.repeat) {
      toggleMute();
      return;
    }
    if (code === "KeyR" && !event.repeat) {
      restart();
      return;
    }
    if (code === "Space" && !event.repeat) {
      game.toggleClamp();
      return;
    }
    if (["KeyA", "KeyD", "KeyW", "KeyS"].includes(code)) {
      pressed.add(code);
      if (code === "KeyA" || code === "KeyD") updateAxis("turn");
      else updateAxis("reach");
    }
  });

  window.addEventListener("keyup", (event) => {
    if (!["KeyA", "KeyD", "KeyW", "KeyS"].includes(event.code)) return;
    pressed.delete(event.code);
    if (event.code === "KeyA" || event.code === "KeyD") updateAxis("turn");
    else updateAxis("reach");
  });

  window.addEventListener("blur", () => {
    pressed.clear();
    game.setControl("turn", 0);
    game.setControl("reach", 0);
  });

  function toggleMute() {
    ensureAudio();
    audio.setMuted(!audio.muted);
    soundToggle.setAttribute("aria-pressed", audio.muted ? "false" : "true");
    soundToggle.querySelector(".sound-label").textContent = audio.muted ? "MUTED" : "SOUND ON";
    showToast(audio.muted ? "音频已静音" : "电机与锁定音效已开启", audio.muted ? "danger" : "success");
  }

  soundToggle.addEventListener("click", () => {
    const hadAudio = Boolean(audio.context);
    ensureAudio();
    if (!hadAudio) {
      audio.setMuted(false);
      soundToggle.setAttribute("aria-pressed", "true");
      soundToggle.querySelector(".sound-label").textContent = "SOUND ON";
      showToast("电机与锁定音效已开启", "success");
    } else {
      toggleMute();
    }
    soundToggle.blur();
  });

  let lastTime = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    game.step(dt);
    const pitch = Math.min(
      1,
      Math.abs(game.arm.angularVel) * 0.58 + Math.abs(game.arm.extensionVel) * 0.004
    );
    audio.setMotor(game.motorLevel, pitch);
    renderer.render(now);
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);

  function snapshot() {
    const geometry = game.geometry();
    return {
      phase: game.phase,
      time: game.time,
      elapsed: game.elapsed,
      arm: {
        angle: game.arm.angle,
        angularVel: game.arm.angularVel,
        extension: game.arm.extension,
        extensionVel: game.arm.extensionVel,
        holding: game.arm.holding ? game.arm.holding.id : null,
        clampClosed: game.arm.clampClosed,
      },
      geometry,
      durability: { ...game.durability },
      metrics: { ...game.metrics },
      inertia: game.inertia(),
      completionTime: game.completionTime,
      failureReason: game.failureReason,
      pods: game.pods.map((pod) => ({
        id: pod.id,
        state: pod.state,
        x: pod.x,
        y: pod.y,
        vx: pod.vx,
        vy: pod.vy,
        mass: pod.mass,
        slotX: pod.slotX,
        slotY: pod.slotY,
      })),
    };
  }

  window.__orbitalGame = {
    game,
    snapshot,
    restart,
  };
})();
