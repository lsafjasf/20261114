import {
  CATEGORY,
  DIRECTIONS,
  MODULES,
  MODULE_BY_ID,
  RESOURCE_TARGETS,
} from "./data.js";
import {
  facesFor,
  nextHint,
  placementFor,
  placementsFromSolution,
  rotateFaces,
  validateCamp,
} from "./logic.js";
import { SoundEngine } from "./audio.js";
import { CampRenderer } from "./render.js";

const $ = (selector) => document.querySelector(selector);
const refs = {
  canvas: $("#world"),
  moduleRack: $("#moduleRack"),
  rackCount: $("#rackCount"),
  bedCount: $("#bedCount"),
  batteryCount: $("#batteryCount"),
  valveCount: $("#valveCount"),
  powerState: $("#powerState"),
  oxygenState: $("#oxygenState"),
  sealState: $("#sealState"),
  missionStatus: $("#missionStatus"),
  missionClock: $("#missionClock"),
  checkBadge: $("#checkBadge"),
  checkSummary: $("#checkSummary"),
  railCheckButton: $("#railCheckButton"),
  checkButton: $("#checkButton"),
  launchButton: $("#launchButton"),
  rotateLeft: $("#rotateLeft"),
  rotateRight: $("#rotateRight"),
  undoButton: $("#undoButton"),
  removeButton: $("#removeButton"),
  hintButton: $("#hintButton"),
  resetButton: $("#resetButton"),
  clearSelection: $("#clearSelection"),
  selectionReadout: $("#selectionReadout"),
  readoutTitle: $("#readoutTitle"),
  readoutDetail: $("#readoutDetail"),
  diagnosticsPanel: $("#diagnosticsPanel"),
  diagnosticsTitle: $("#diagnosticsTitle"),
  diagnosticsBody: $("#diagnosticsBody"),
  diagnosticsFoot: $("#diagnosticsFoot"),
  closeDiagnostics: $("#closeDiagnostics"),
  launchScreen: $("#launchScreen"),
  launchResetButton: $("#launchResetButton"),
  toast: $("#toast"),
  hintCallout: $("#hintCallout"),
  soundButton: $("#soundButton"),
  soundIcon: $("#soundIcon"),
  guideButton: $("#guideButton"),
  guideModal: $("#guideModal"),
  closeGuide: $("#closeGuide"),
  resumeButton: $("#resumeButton"),
  loadBlueprintButton: $("#loadBlueprintButton"),
  briefingModal: $("#briefingModal"),
  enterButton: $("#enterButton"),
  resourceRows: [...document.querySelectorAll(".resource-row")],
  phases: [...document.querySelectorAll(".phase")],
};

const state = {
  placements: [],
  selectedModuleId: null,
  ghostRotation: 0,
  hover: null,
  preview: null,
  hint: null,
  report: validateCamp([]),
  checkResult: null,
  showErrors: false,
  launched: false,
  history: [],
  hintTimer: null,
};

const audio = new SoundEngine();
const renderer = new CampRenderer(refs.canvas);
let toastTimer = null;
let missionStart = null;

function selectedModule() {
  return state.selectedModuleId ? MODULE_BY_ID[state.selectedModuleId] : null;
}

function selectedPlacement() {
  return state.selectedModuleId
    ? placementFor(state.placements, state.selectedModuleId)
    : null;
}

function cellLabel(x, y) {
  return `${String.fromCharCode(65 + x)}${y + 1}`;
}

function resourceLabel(module) {
  if (module.beds) return `${module.beds} 床位`;
  if (module.batteries) return `${module.batteries} 电池`;
  if (module.valves) return `${module.valves} 空气阀`;
  if (module.crew) return "乘员舱";
  return "保障舱";
}

function clonePlacements() {
  return state.placements.map((placement) => ({ ...placement }));
}

function pushHistory() {
  state.history.push({
    placements: clonePlacements(),
    selectedModuleId: state.selectedModuleId,
    ghostRotation: state.ghostRotation,
  });
  if (state.history.length > 30) state.history.shift();
  refs.undoButton.disabled = false;
}

function toast(message, tone = "normal") {
  refs.toast.textContent = message;
  refs.toast.className = `toast is-visible${tone === "danger" ? " is-danger" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    refs.toast.classList.remove("is-visible");
  }, 2600);
}

function buildRack() {
  refs.moduleRack.innerHTML = "";
  for (const module of MODULES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "module-card";
    button.dataset.moduleId = module.id;
    button.style.setProperty("--cat", CATEGORY[module.category].color);
    button.innerHTML = `
      <div class="module-card-top">
        <span class="module-code">${module.code}</span>
        <span class="module-state">待装</span>
      </div>
      <div class="module-card-main">
        <span class="module-silhouette"><span>${CATEGORY[module.category].icon}</span></span>
        <span class="module-title-block">
          <span class="module-name">${module.name}</span>
          <span class="module-resource">${resourceLabel(module)}</span>
        </span>
      </div>
      <div class="module-card-bottom">
        <span class="face-map" aria-hidden="true">
          ${["empty", "N", "empty", "W", "center", "E", "empty", "S", "empty"]
            .map((slot) => `<span class="face-cell ${slot === "empty" ? "empty" : slot}" data-slot="${slot}"></span>`)
            .join("")}
        </span>
        <span class="rot-label">R0°</span>
      </div>
    `;
    button.addEventListener("click", () => {
      state.hover = null;
      selectModule(module.id, true);
    });
    refs.moduleRack.append(button);
  }
}

function updateRack() {
  for (const card of refs.moduleRack.querySelectorAll(".module-card")) {
    const module = MODULE_BY_ID[card.dataset.moduleId];
    const placement = placementFor(state.placements, module.id);
    const selected = state.selectedModuleId === module.id;
    const rotation = placement
      ? placement.rotation
      : selected
        ? state.ghostRotation
        : 0;
    const faces = facesFor(module, rotation);
    card.classList.toggle("is-placed", Boolean(placement));
    card.classList.toggle("is-selected", selected);
    card.querySelector(".module-state").textContent = placement
      ? `已装 · R${(placement.rotation * 90) % 360}`
      : selected
        ? "已选择"
        : "待装";
    card.querySelector(".rot-label").textContent = `R${(rotation * 90) % 360}`;
    for (const face of card.querySelectorAll(".face-cell[data-slot]")) {
      const slot = face.dataset.slot;
      if (slot === "empty" || slot === "center") continue;
      const index = DIRECTIONS.indexOf(slot);
      const value = faces[index];
      face.className = `face-cell ${slot} ${
        value === "P" ? "power" : value === "O" ? "oxygen" : ""
      }`;
    }
  }
}

function selectModule(moduleId, fromRack = false) {
  const module = MODULE_BY_ID[moduleId];
  if (!module) return;
  const placement = placementFor(state.placements, moduleId);
  state.selectedModuleId = moduleId;
  state.ghostRotation = placement ? placement.rotation : 0;
  if (fromRack) state.hover = null;
  state.preview = computePreview();
  clearHint();
  audio.select();
  syncUI();
}

function computePreview() {
  if (state.launched || !state.selectedModuleId || !state.hover) return null;
  const module = MODULE_BY_ID[state.selectedModuleId];
  const placement = selectedPlacement();
  if (placement && state.hover.x === placement.x && state.hover.y === placement.y) return null;
  return {
    moduleId: module.id,
    x: state.hover.x,
    y: state.hover.y,
    rotation: placement ? placement.rotation : state.ghostRotation,
  };
}

function syncRenderer() {
  renderer.update({
    placements: state.placements,
    preview: state.preview,
    hover: state.hover,
    selectedId: selectedPlacement()?.moduleId ?? null,
    report: state.report,
    showErrors: state.showErrors,
    hint: state.hint,
  });
}

function updateReadout() {
  const module = selectedModule();
  const placement = selectedPlacement();
  const occupiedHere = state.hover
    ? state.placements.find(
        (item) =>
          item.x === state.hover.x &&
          item.y === state.hover.y &&
          item.moduleId !== state.selectedModuleId,
      )
    : null;

  refs.selectionReadout.classList.toggle("is-active", Boolean(module));
  refs.clearSelection.hidden = !module;
  if (!module) {
    refs.readoutTitle.textContent = "从货架选择一个舱段";
    refs.readoutDetail.textContent = "点击模块，再点击网格落位。按 R 旋转。";
    return;
  }

  refs.readoutTitle.textContent = `${module.code} · ${module.name}`;
  if (state.launched) {
    refs.readoutDetail.textContent = `${resourceLabel(module)} · 营地已接通`;
    return;
  }

  if (placement) {
    const moveText = occupiedHere
      ? `${cellLabel(occupiedHere.x, occupiedHere.y)} 已被 ${MODULE_BY_ID[occupiedHere.moduleId].code} 占用`
      : state.hover
        ? `移至 ${cellLabel(state.hover.x, state.hover.y)}`
        : "点击空格重新定位";
    refs.readoutDetail.textContent = `${resourceLabel(module)} · ${cellLabel(placement.x, placement.y)} · R${(placement.rotation * 90) % 360}° · ${moveText}`;
  } else {
    const target = state.hover
      ? occupiedHere
        ? `${cellLabel(state.hover.x, state.hover.y)} 已占用`
        : `落在 ${cellLabel(state.hover.x, state.hover.y)}`
      : "点击网格落位";
    refs.readoutDetail.textContent = `${resourceLabel(module)} · R${(state.ghostRotation * 90) % 360}° · ${target}`;
  }
}

function networkText(components, installed) {
  if (!installed) return ["待装配", ""];
  if (components.length === 1) return ["已接通", "ok"];
  return ["断开", "bad"];
}

function updateResources() {
  const counts = state.report.counts;
  const values = { beds: counts.beds, batteries: counts.batteries, valves: counts.valves };
  refs.bedCount.textContent = values.beds;
  refs.batteryCount.textContent = values.batteries;
  refs.valveCount.textContent = values.valves;
  for (const row of refs.resourceRows) {
    const resource = row.dataset.resource;
    row.classList.toggle("is-met", values[resource] >= RESOURCE_TARGETS[resource]);
    row.classList.toggle("is-low", values[resource] < RESOURCE_TARGETS[resource]);
  }
  refs.rackCount.textContent = state.placements.length;

  const power = networkText(state.report.power.components, state.placements.length);
  const oxygen = networkText(state.report.oxygen.components, state.placements.length);
  const seal = networkText(state.report.seal.components, state.placements.length);
  refs.powerState.textContent = power[0];
  refs.oxygenState.textContent = oxygen[0];
  refs.sealState.textContent = seal[0];
  refs.powerState.className = power[1];
  refs.oxygenState.className = oxygen[1];
  refs.sealState.className = seal[1];
}

function updatePhases() {
  const allPlaced = state.placements.length === MODULES.length;
  const resourcesMet = state.report.resourcesMet;
  const checkPassed = Boolean(state.checkResult?.ok);
  const phases = [
    ["build", allPlaced, !allPlaced],
    ["resources", allPlaced && resourcesMet, allPlaced && !resourcesMet],
    ["check", checkPassed, allPlaced && resourcesMet && !checkPassed],
    ["launch", state.launched, checkPassed && !state.launched],
  ];
  for (const phase of refs.phases) {
    const [key, done, active] = phases.find(([name]) => name === phase.dataset.phase);
    phase.classList.toggle("done", done);
    phase.classList.toggle("active", active);
  }
}

function updateCheckUI() {
  const result = state.checkResult;
  refs.checkBadge.className = "check-badge";
  refs.launchButton.disabled = !(result?.ok && !state.launched);
  refs.rotateLeft.disabled = !state.selectedModuleId || state.launched;
  refs.rotateRight.disabled = !state.selectedModuleId || state.launched;
  refs.removeButton.disabled = !state.selectedModuleId || state.launched;
  refs.undoButton.disabled = state.history.length === 0 || state.launched;

  if (state.launched) {
    refs.missionStatus.className = "status-chip is-success";
    refs.missionStatus.querySelector("span").textContent = "运行中";
    refs.checkBadge.textContent = "已启动";
    refs.checkBadge.classList.add("pass");
    refs.checkSummary.textContent = "SELENE-12 已完成两阶段连接检查，气密房正在运行。";
    return;
  }

  if (result) {
    if (result.ok) {
      refs.missionStatus.className = "status-chip is-success";
      refs.missionStatus.querySelector("span").textContent = "待启动";
      refs.checkBadge.textContent = "通过";
      refs.checkBadge.classList.add("pass");
      refs.checkSummary.textContent =
        "三网完好，资源配额满足。可执行最终复检并启动营地。";
    } else {
      refs.missionStatus.className = "status-chip is-danger";
      refs.missionStatus.querySelector("span").textContent = "检查未通过";
      refs.checkBadge.textContent = "未通过";
      refs.checkBadge.classList.add("fail");
      refs.checkSummary.textContent = `发现 ${result.issues.length} 项阻断启动的问题。调整后可再次检查。`;
    }
    return;
  }

  refs.missionStatus.className = "status-chip";
  refs.missionStatus.querySelector("span").textContent = "装配中";
  refs.checkBadge.textContent = state.placements.length === MODULES.length ? "待检查" : "未执行";
  refs.checkSummary.textContent =
    state.placements.length === MODULES.length
      ? "十二个舱段已就位。运行连接检查验证三网和资源配额。"
      : `当前 ${state.placements.length}/12 个舱段。所有模块就位后可执行连接检查。`;
}

function syncUI() {
  updateRack();
  updateReadout();
  updateResources();
  updatePhases();
  updateCheckUI();
  syncRenderer();
}

function closeDiagnostics() {
  refs.diagnosticsPanel.hidden = true;
}

function invalidateCheck() {
  const hadResult = Boolean(state.checkResult);
  state.checkResult = null;
  state.showErrors = false;
  closeDiagnostics();
  if (hadResult) toast("设计已更改 · 请重新运行连接检查");
}

function refreshReport({ invalidate = true, sync = true } = {}) {
  if (invalidate) invalidateCheck();
  state.report = validateCamp(state.placements);
  if (sync) syncUI();
}

function clearHint() {
  state.hint = null;
  clearTimeout(state.hintTimer);
  state.hintTimer = null;
  refs.hintCallout.hidden = true;
}

function selectCell(cell) {
  if (!cell || state.launched) return;
  const occupant = state.placements.find(
    (placement) => placement.x === cell.x && placement.y === cell.y,
  );
  if (occupant) {
    if (state.selectedModuleId && state.selectedModuleId !== occupant.moduleId) {
      toast(`${cellLabel(cell.x, cell.y)} 已被 ${MODULE_BY_ID[occupant.moduleId].code} 占用`);
    }
    selectModule(occupant.moduleId);
    return;
  }

  const module = selectedModule();
  if (!module) {
    toast("先从右侧货架选择一个舱段");
    return;
  }

  const current = selectedPlacement();
  if (current && current.x === cell.x && current.y === cell.y) return;

  pushHistory();
  if (current) {
    current.x = cell.x;
    current.y = cell.y;
    audio.place();
    renderer.burst(cell.x, cell.y, CATEGORY[module.category].color);
    refreshReport({ invalidate: true, sync: false });
    state.hover = null;
    state.preview = null;
    clearHint();
    syncUI();
    toast(`${module.code} 已移至 ${cellLabel(cell.x, cell.y)}`);
    return;
  }

  state.placements.push({
    moduleId: module.id,
    x: cell.x,
    y: cell.y,
    rotation: ((state.ghostRotation % 4) + 4) % 4,
  });
  audio.place();
  renderer.burst(cell.x, cell.y, CATEGORY[module.category].color);

  const next = MODULES.find(
    (candidate) => !placementFor(state.placements, candidate.id),
  );
  state.selectedModuleId = next?.id ?? null;
  state.ghostRotation = 0;
  state.hover = null;
  state.preview = null;
  clearHint();
  refreshReport({ invalidate: true, sync: false });
  syncUI();

  if (state.placements.length === MODULES.length) {
    toast("十二个舱段已就位 · 现在运行连接检查");
  } else {
    toast(`${module.code} 已锁定 · 继续装配 ${state.placements.length}/12`);
  }
}

function rotateSelected(delta) {
  if (state.launched) return;
  const module = selectedModule();
  if (!module) {
    toast("先选择一个舱段再旋转");
    return;
  }
  pushHistory();
  const placement = selectedPlacement();
  if (placement) {
    placement.rotation = ((placement.rotation + delta) % 4 + 4) % 4;
    state.ghostRotation = placement.rotation;
  } else {
    state.ghostRotation = ((state.ghostRotation + delta) % 4 + 4) % 4;
  }
  state.preview = computePreview();
  state.hint = null;
  refs.hintCallout.hidden = true;
  audio.rotate();
  refreshReport({ invalidate: true, sync: true });
}

function removeSelected() {
  if (state.launched) return;
  const module = selectedModule();
  if (!module) return;
  const placement = selectedPlacement();
  if (!placement) {
    state.selectedModuleId = null;
    state.ghostRotation = 0;
    state.preview = null;
    state.hover = null;
    clearHint();
    syncUI();
    return;
  }

  pushHistory();
  state.ghostRotation = placement.rotation;
  state.placements = state.placements.filter((item) => item.moduleId !== module.id);
  state.hint = null;
  state.hover = null;
  state.preview = null;
  audio.remove();
  clearHint();
  refreshReport({ invalidate: true, sync: true });
  toast(`${module.code} 已拆回货架`);
}

function undo() {
  if (state.launched || !state.history.length) return;
  const snapshot = state.history.pop();
  state.placements = snapshot.placements;
  state.selectedModuleId = snapshot.selectedModuleId;
  state.ghostRotation = snapshot.ghostRotation;
  state.hover = null;
  state.preview = null;
  clearHint();
  closeDiagnostics();
  state.checkResult = null;
  state.showErrors = false;
  state.report = validateCamp(state.placements);
  audio.remove();
  syncUI();
  toast("已撤销上一步");
}

function resetAssembly() {
  if (state.placements.length) pushHistory();
  state.placements = [];
  state.selectedModuleId = null;
  state.ghostRotation = 0;
  state.hover = null;
  state.preview = null;
  state.hint = null;
  state.checkResult = null;
  state.showErrors = false;
  state.launched = false;
  refs.launchScreen.hidden = true;
  refs.hintCallout.hidden = true;
  closeDiagnostics();
  state.report = validateCamp([]);
  audio.remove();
  syncUI();
  toast("施工区已清空 · 按 Z 可撤销");
}

function showHint() {
  if (state.launched) return;
  const hint = nextHint(state.placements);
  if (!hint) {
    toast("当前布局已匹配参考方案 · 可运行连接检查");
    return;
  }
  state.hint = hint;
  const module = MODULE_BY_ID[hint.moduleId];
  refs.hintCallout.textContent = `${module.code} 建议落位 ${cellLabel(hint.x, hint.y)} · 旋转 R${(hint.rotation * 90) % 360}°`;
  refs.hintCallout.hidden = false;
  clearTimeout(state.hintTimer);
  state.hintTimer = setTimeout(() => {
    state.hint = null;
    refs.hintCallout.hidden = true;
    syncRenderer();
  }, 6500);
  syncRenderer();
}

function makeDiagnosticItem(pass, title, detail) {
  const item = document.createElement("div");
  item.className = `issue-item${pass ? " pass" : ""}`;
  const mark = document.createElement("b");
  mark.textContent = pass ? "✓" : "!";
  const copy = document.createElement("div");
  const heading = document.createElement("h4");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = detail;
  copy.append(heading, paragraph);
  item.append(mark, copy);
  return item;
}

function showDiagnostics(report) {
  refs.diagnosticsPanel.hidden = false;
  refs.diagnosticsPanel.classList.toggle("is-pass", report.ok);
  refs.diagnosticsTitle.textContent = report.ok ? "连接检查通过" : "连接检查未通过";
  refs.diagnosticsBody.innerHTML = "";

  if (report.ok) {
    const checks = [
      ["舱段清单", `${report.installed} / ${report.total} 个模块全部锁定`],
      [
        "气密舱壁",
        `通行网络完整，${report.interfaceErrors.length} 个暴露接口`,
      ],
      ["供电总线", `${report.installed} 个模块接入同一电池网络`],
      [
        "供氧环路",
        `${report.oxygen.components[0]?.length ?? 0} 个乘员节点接入空气阀`,
      ],
      [
        "资源配额",
        `床位 ${report.counts.beds} · 电池 ${report.counts.batteries} · 空气阀 ${report.counts.valves}`,
      ],
    ];
    for (const [title, detail] of checks) {
      refs.diagnosticsBody.append(makeDiagnosticItem(true, title, detail));
    }
    refs.diagnosticsFoot.textContent =
      "可执行 FINAL TEST。启动前系统会自动再运行一次完整检查。";
    return;
  }

  for (const issue of report.issues) {
    refs.diagnosticsBody.append(
      makeDiagnosticItem(false, issue.title, issue.detail),
    );
  }
  if (!report.issues.length) {
    refs.diagnosticsBody.append(
      makeDiagnosticItem(false, "连接不完整", "检查到未满足的启动条件。"),
    );
  }
  refs.diagnosticsFoot.textContent =
    "检查失败不会锁定布局。拆卸或旋转模块后，可再次运行连接检查。";
}

function runCheck(final = false) {
  if (state.launched) return;
  audio.ensure();
  const report = validateCamp(state.placements);
  state.report = report;
  state.checkResult = report;
  state.showErrors = !report.ok;
  state.preview = null;
  clearHint();
  state.report = report;
  syncUI();
  showDiagnostics(report);

  if (report.ok) {
    audio.checkPass();
    toast(final ? "最终复检通过 · 正在启动" : "连接检查通过 · 启动权限已解锁");
    if (final) setTimeout(launchCamp, 520);
  } else {
    audio.fail();
    toast(`连接检查未通过 · ${report.issues.length} 项需要调整`, "danger");
  }
}

function launchCamp() {
  if (state.launched) return;
  const report = validateCamp(state.placements);
  state.report = report;
  if (!report.ok) {
    state.checkResult = report;
    state.showErrors = true;
    syncUI();
    showDiagnostics(report);
    audio.fail();
    toast("最终复检失败 · 启动已中止", "danger");
    return;
  }

  state.launched = true;
  state.checkResult = report;
  state.showErrors = false;
  state.selectedModuleId = null;
  state.preview = null;
  state.hint = null;
  state.hover = null;
  clearHint();
  closeDiagnostics();
  refs.launchScreen.hidden = false;
  syncUI();
  audio.launch();
  state.placements.forEach((placement, index) => {
    setTimeout(() => {
      renderer.burst(
        placement.x,
        placement.y,
        MODULE_BY_ID[placement.moduleId].category === "valve"
          ? "#54dbe6"
          : "#ffc95a",
      );
    }, 180 + index * 55);
  });
}

function openGuide() {
  refs.guideModal.hidden = false;
  audio.select();
}

function closeGuide() {
  refs.guideModal.hidden = true;
}

function loadBlueprint() {
  pushHistory();
  state.placements = placementsFromSolution();
  state.selectedModuleId = null;
  state.ghostRotation = 0;
  state.hover = null;
  state.preview = null;
  state.hint = null;
  state.checkResult = null;
  state.showErrors = false;
  state.launched = false;
  refs.launchScreen.hidden = true;
  refs.hintCallout.hidden = true;
  closeDiagnostics();
  closeGuide();
  state.report = validateCamp(state.placements);
  audio.place();
  syncUI();
  state.placements.forEach((placement, index) => {
    setTimeout(
      () => renderer.burst(placement.x, placement.y, CATEGORY[MODULE_BY_ID[placement.moduleId].category].color),
      35 * index,
    );
  });
  toast("参考蓝图已装载 · 请运行连接检查");
}

refs.rotateLeft.addEventListener("click", () => rotateSelected(-1));
refs.rotateRight.addEventListener("click", () => rotateSelected(1));
refs.undoButton.addEventListener("click", undo);
refs.removeButton.addEventListener("click", removeSelected);
refs.hintButton.addEventListener("click", showHint);
refs.resetButton.addEventListener("click", resetAssembly);
refs.checkButton.addEventListener("click", () => runCheck(false));
refs.railCheckButton.addEventListener("click", () => runCheck(false));
refs.launchButton.addEventListener("click", () => runCheck(true));
refs.launchResetButton.addEventListener("click", resetAssembly);
refs.closeDiagnostics.addEventListener("click", closeDiagnostics);
refs.clearSelection.addEventListener("click", () => {
  state.selectedModuleId = null;
  state.ghostRotation = 0;
  state.preview = null;
  state.hover = null;
  clearHint();
  syncUI();
});
refs.guideButton.addEventListener("click", openGuide);
refs.closeGuide.addEventListener("click", closeGuide);
refs.resumeButton.addEventListener("click", closeGuide);
refs.loadBlueprintButton.addEventListener("click", loadBlueprint);
refs.soundButton.addEventListener("click", () => {
  audio.init();
  const enabled = audio.toggle();
  refs.soundButton.classList.toggle("sound-on", enabled);
  refs.soundButton.setAttribute("aria-pressed", String(enabled));
  refs.soundIcon.textContent = enabled ? "◖" : "◌";
  toast(enabled ? "音效已开启" : "音效已关闭");
});
refs.guideModal.addEventListener("click", (event) => {
  if (event.target === refs.guideModal) closeGuide();
});
refs.enterButton.addEventListener("click", () => {
  audio.init();
  refs.briefingModal.hidden = true;
  toast("从右侧货架选择舱段 · R 旋转 · 点击网格落位");
});

refs.canvas.addEventListener("pointerdown", () => audio.ensure());
refs.canvas.addEventListener("pointermove", (event) => {
  const cell = renderer.cellFromClient(event.clientX, event.clientY);
  const changed =
    (cell?.x ?? null) !== (state.hover?.x ?? null) ||
    (cell?.y ?? null) !== (state.hover?.y ?? null);
  if (!changed) return;
  state.hover = cell;
  state.preview = computePreview();
  updateReadout();
  syncRenderer();
});
refs.canvas.addEventListener("pointerleave", () => {
  state.hover = null;
  state.preview = null;
  updateReadout();
  syncRenderer();
});
refs.canvas.addEventListener("click", (event) => {
  const cell = renderer.cellFromClient(event.clientX, event.clientY);
  if (!cell) return;
  state.hover = cell;
  selectCell(cell);
});
refs.canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (state.launched) return;
  const cell = renderer.cellFromClient(event.clientX, event.clientY);
  if (!cell) return;
  const occupant = state.placements.find(
    (placement) => placement.x === cell.x && placement.y === cell.y,
  );
  if (!occupant) return;
  state.selectedModuleId = occupant.moduleId;
  state.ghostRotation = occupant.rotation;
  state.hover = cell;
  removeSelected();
});

window.addEventListener("keydown", (event) => {
  const guideOpen = !refs.guideModal.hidden;
  const briefingOpen = !refs.briefingModal.hidden;
  if (guideOpen || briefingOpen) {
    if (event.key === "Escape") {
      if (guideOpen) closeGuide();
      if (briefingOpen) refs.briefingModal.hidden = true;
    }
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === "r") {
    event.preventDefault();
    rotateSelected(1);
  } else if (key === "q") {
    event.preventDefault();
    rotateSelected(-1);
  } else if (key === "z") {
    event.preventDefault();
    undo();
  } else if (key === "delete" || key === "backspace") {
    event.preventDefault();
    removeSelected();
  } else if (key === "h") {
    showHint();
  } else if (event.key === "Escape") {
    if (!refs.diagnosticsPanel.hidden) {
      closeDiagnostics();
    } else {
      state.selectedModuleId = null;
      state.hover = null;
      state.preview = null;
      state.ghostRotation = 0;
      syncUI();
    }
  }
});

function updateClock() {
  if (!missionStart) missionStart = Date.now();
  const elapsed = Math.floor((Date.now() - missionStart) / 1000);
  const hours = String(Math.floor(elapsed / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  refs.missionClock.textContent = `T+ ${hours}:${minutes}:${seconds}`;
}

function init() {
  buildRack();
  state.report = validateCamp([]);
  syncUI();
  renderer.start();
  updateClock();
  setInterval(updateClock, 1000);

  const resizeObserver = new ResizeObserver(() => renderer.resize());
  resizeObserver.observe(refs.canvas.parentElement);
  window.addEventListener("resize", () => renderer.resize());

  setTimeout(() => {
    if (!refs.briefingModal.hidden || !refs.guideModal.hidden) return;
    toast("从右侧货架选择舱段 · R 旋转 · 点击网格落位");
  }, 700);

  window.seleneGame = {
    state,
    renderer,
    runCheck,
    launchCamp,
    loadBlueprint,
    resetAssembly,
    solution: placementsFromSolution(),
  };
}

init();
