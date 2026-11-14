import {
  DIRECTIONS,
  DIR_VECTORS,
  GRID_SIZE,
  MODULES,
  MODULE_BY_ID,
  RESOURCE_TARGETS,
  SOLUTION,
} from "./data.js";

const RESOURCE_LABELS = {
  beds: "床位",
  batteries: "电池",
  valves: "空气阀",
};

export function cellKey(x, y) {
  return `${x},${y}`;
}

export function rotateFaces(faces, rotation = 1) {
  let result = [...faces];
  const turns = ((rotation % 4) + 4) % 4;
  for (let turn = 0; turn < turns; turn += 1) {
    result = [result[3], result[0], result[1], result[2]];
  }
  return result;
}

export function facesFor(module, rotation = 0) {
  return rotateFaces(module.faces, rotation);
}

export function faceAt(module, rotation, direction) {
  return facesFor(module, rotation)[DIRECTIONS.indexOf(direction)];
}

export function placementAt(placements, x, y) {
  return placements.find((placement) => placement.x === x && placement.y === y) ?? null;
}

export function placementFor(placements, moduleId) {
  return placements.find((placement) => placement.moduleId === moduleId) ?? null;
}

export function moduleForPlacement(placement) {
  return MODULE_BY_ID[placement.moduleId];
}

export function resourcesFor(placements) {
  return placements.reduce(
    (totals, placement) => {
      const module = moduleForPlacement(placement);
      totals.beds += module.beds;
      totals.batteries += module.batteries;
      totals.valves += module.valves;
      return totals;
    },
    { beds: 0, batteries: 0, valves: 0 },
  );
}

function uniqueAdjacentPairs(placements) {
  const occupied = new Map(placements.map((placement) => [cellKey(placement.x, placement.y), placement]));
  const pairs = [];
  const checked = new Set();

  for (const placement of placements) {
    for (const direction of ["E", "S"]) {
      const vector = DIR_VECTORS[direction];
      const neighbor = occupied.get(cellKey(placement.x + vector.x, placement.y + vector.y));
      if (!neighbor) continue;
      const pairKey = [placement.moduleId, neighbor.moduleId].sort().join("::");
      if (checked.has(pairKey)) continue;
      checked.add(pairKey);
      pairs.push({ a: placement, b: neighbor, direction, opposite: vector.opposite });
    }
  }
  return pairs;
}

function graphComponents(nodes, edges) {
  const adjacency = new Map(nodes.map((id) => [id, []]));
  for (const [a, b] of edges) {
    adjacency.get(a)?.push(b);
    adjacency.get(b)?.push(a);
  }

  const seen = new Set();
  const components = [];
  for (const node of nodes) {
    if (seen.has(node)) continue;
    const component = [];
    const stack = [node];
    seen.add(node);
    while (stack.length) {
      const current = stack.pop();
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

function makeIssue(code, title, detail, extra = {}) {
  return { code, title, detail, severity: "error", ...extra };
}

export function validateCamp(placements, options = {}) {
  const { checkResources = true, gridSize = GRID_SIZE } = options;
  const modules = placements.map(moduleForPlacement);
  const occupied = new Map(placements.map((placement) => [cellKey(placement.x, placement.y), placement]));
  const links = [];
  const exposedPorts = [];
  const interfaceErrors = [];
  const hatchEdges = [];
  const powerEdges = [];
  const oxygenEdges = [];
  const issues = [];

  const outOfBounds = placements.filter(
    (placement) => placement.x < 0 || placement.y < 0 || placement.x >= gridSize || placement.y >= gridSize,
  );

  for (const placement of placements) {
    const module = moduleForPlacement(placement);
    const faces = facesFor(module, placement.rotation);
    for (let index = 0; index < DIRECTIONS.length; index += 1) {
      const direction = DIRECTIONS[index];
      const face = faces[index];
      if (face === "X") continue;
      const vector = DIR_VECTORS[direction];
      const nx = placement.x + vector.x;
      const ny = placement.y + vector.y;
      const neighbor = occupied.get(cellKey(nx, ny));

      if (!neighbor) {
        const port = { moduleId: module.id, direction, x: placement.x, y: placement.y, face };
        exposedPorts.push(port);
        interfaceErrors.push({ ...port, code: "exposed" });
        continue;
      }

      const neighborModule = moduleForPlacement(neighbor);
      const neighborFace = faceAt(neighborModule, neighbor.rotation, vector.opposite);
      if (neighborFace === "X") {
        const port = { moduleId: module.id, direction, x: placement.x, y: placement.y, face };
        exposedPorts.push(port);
        interfaceErrors.push({ ...port, code: "exposed" });
      }
    }
  }

  for (const pair of uniqueAdjacentPairs(placements)) {
    const moduleA = moduleForPlacement(pair.a);
    const moduleB = moduleForPlacement(pair.b);
    const faceA = faceAt(moduleA, pair.a.rotation, pair.direction);
    const faceB = faceAt(moduleB, pair.b.rotation, pair.opposite);
    const bothOpen = faceA !== "X" && faceB !== "X";
    const serviceMatch = bothOpen && faceA === faceB;
    const link = {
      a: pair.a.moduleId,
      b: pair.b.moduleId,
      ax: pair.a.x,
      ay: pair.a.y,
      bx: pair.b.x,
      by: pair.b.y,
      faceA,
      faceB,
      service: serviceMatch ? faceA : null,
      mismatch: bothOpen && faceA !== faceB,
    };
    links.push(link);

    if (bothOpen) hatchEdges.push([pair.a.moduleId, pair.b.moduleId]);
    if (serviceMatch && faceA === "P") powerEdges.push([pair.a.moduleId, pair.b.moduleId]);
    if (serviceMatch && faceA === "O") oxygenEdges.push([pair.a.moduleId, pair.b.moduleId]);

    if (bothOpen && faceA !== faceB) {
      interfaceErrors.push({
        code: "mismatch",
        a: pair.a.moduleId,
        b: pair.b.moduleId,
        ax: pair.a.x,
        ay: pair.a.y,
        bx: pair.b.x,
        by: pair.b.y,
        faceA,
        faceB,
      });
    }
  }

  const ids = placements.map((placement) => placement.moduleId);
  const sealComponents = graphComponents(ids, hatchEdges);
  const powerComponents = graphComponents(ids, powerEdges);
  const crewPlacements = placements.filter((placement) => moduleForPlacement(placement).crew);
  const crewIds = crewPlacements.map((placement) => placement.moduleId);
  const oxygenComponents = graphComponents(crewIds, oxygenEdges);
  const counts = resourcesFor(placements);
  const missingResources = {};
  if (checkResources) {
    for (const [resource, target] of Object.entries(RESOURCE_TARGETS)) {
      if (counts[resource] < target) missingResources[resource] = target - counts[resource];
    }
  }

  if (outOfBounds.length) {
    issues.push(
      makeIssue("bounds", "舱段越出施工网格", `${outOfBounds.length} 个模块落在 5×5 施工区之外。`),
    );
  }

  if (placements.length < MODULES.length) {
    issues.push(
      makeIssue(
        "modules",
        "舱段未装配完成",
        `已放置 ${placements.length}/${MODULES.length} 个模块，还缺 ${MODULES.length - placements.length} 个。`,
      ),
    );
  }

  if (interfaceErrors.length) {
    const exposed = interfaceErrors.filter((error) => error.code === "exposed").length;
    const mismatched = interfaceErrors.filter((error) => error.code === "mismatch").length;
    const details = [];
    if (mismatched) details.push(`${mismatched} 处管线类型未对齐`);
    if (exposed) details.push(`${exposed} 个接口暴露在真空或封死舱壁`);
    issues.push(
      makeIssue(
        "interface",
        "接口方向错误",
        `${details.join("，")}。旋转或移动对应模块后重新检查。`,
        { cells: interfaceErrors },
      ),
    );
  }

  if (placements.length && sealComponents.length > 1) {
    issues.push(
      makeIssue(
        "seal",
        "气密通行网络被切断",
        `检测到 ${sealComponents.length} 个独立气密段，乘员无法抵达全部舱室。`,
        { components: sealComponents },
      ),
    );
  }

  if (placements.length && powerComponents.length > 1) {
    const largest = Math.max(...powerComponents.map((component) => component.length));
    issues.push(
      makeIssue(
        "power",
        "供电总线不完整",
        `${placements.length - largest} 个模块未接入主电池总线。检查黄色接口朝向。`,
        { components: powerComponents },
      ),
    );
  }

  if (crewPlacements.length && oxygenComponents.length > 1) {
    const largest = Math.max(...oxygenComponents.map((component) => component.length));
    issues.push(
      makeIssue(
        "oxygen",
        "供氧环路断裂",
        `${crewPlacements.length - largest} 个乘员舱未接入空气阀网络。检查青色接口朝向。`,
        { components: oxygenComponents },
      ),
    );
  }

  if (checkResources) {
    for (const [resource, missing] of Object.entries(missingResources)) {
      issues.push(
        makeIssue(
          "resource",
          `${RESOURCE_LABELS[resource]}资源不足`,
          `还缺少 ${missing} 单位${RESOURCE_LABELS[resource]}，请补装对应模块。`,
        ),
      );
    }
  }

  const sealConnected =
    placements.length === MODULES.length && sealComponents.length === 1;
  const powerConnected =
    placements.length === MODULES.length && powerComponents.length === 1;
  const oxygenConnected =
    crewIds.length === MODULES.filter((module) => module.crew).length && oxygenComponents.length === 1;
  const allPlaced = placements.length === MODULES.length;
  const resourcesMet = Object.keys(missingResources).length === 0;
  const ok =
    allPlaced &&
    !outOfBounds.length &&
    !interfaceErrors.length &&
    sealConnected &&
    powerConnected &&
    oxygenConnected &&
    resourcesMet;

  return {
    ok,
    issues,
    links,
    exposedPorts,
    interfaceErrors,
    seal: { components: sealComponents, connected: sealConnected },
    power: { components: powerComponents, connected: powerConnected },
    oxygen: { components: oxygenComponents, connected: oxygenConnected },
    counts,
    missingResources,
    allPlaced,
    resourcesMet,
    installed: placements.length,
    total: MODULES.length,
  };
}

export function placementsFromSolution() {
  return SOLUTION.map((placement) => ({ ...placement }));
}

export function getSolutionTarget(moduleId) {
  return SOLUTION.find((entry) => entry.moduleId === moduleId) ?? null;
}

export function nextHint(placements) {
  for (const target of SOLUTION) {
    const current = placementFor(placements, target.moduleId);
    if (!current) return { ...target, reason: "missing" };
    if (
      current.x !== target.x ||
      current.y !== target.y ||
      ((current.rotation % 4) + 4) % 4 !== target.rotation
    ) {
      return { ...target, reason: "adjust" };
    }
  }
  return null;
}
