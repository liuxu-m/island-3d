/**
 * 布局 DSL + 确定性求解器(方案 03 核心:"LLM 的输出不是地图,是生成地图的程序")
 *
 * 想改地图?改下面 layout 数组里的规则就行 —— "改一行 DSL,地图就变了"(方案 07·P2 验收)。
 * 性质(最小间距、不在水里、坡度限制)由求解器构造保证,再由 verify 断言兜底。
 */
import { mulberry32 } from './noise';
import { heightAt, slopeAt, densityAt, ISLAND_RADIUS, SPAWN } from './terrain';

export type ObjectKind = 'tree' | 'palm' | 'rock' | 'grass';

export interface Sample {
  x: number;
  z: number;
  height: number;
  slope: number;
  density: number;
  distFromSpawn: number;
}

export interface ScatterRule {
  type: 'scatter';
  kind: ObjectKind;
  count: number;
  /** 最小间距(米),由带网格加速的拒绝采样保证 */
  minDist: number;
  seed: number;
  where: (s: Sample) => boolean;
}

export interface RingRule {
  type: 'ring';
  kind: ObjectKind;
  count: number;
  /** 半径范围,以岛半径为单位 [0..1+],用于"沿沙滩种一圈棕榈"这类意图 */
  radius: [number, number];
  jitter: number;
  seed: number;
  where: (s: Sample) => boolean;
}

export type Rule = ScatterRule | RingRule;

export interface Placed {
  kind: ObjectKind;
  x: number;
  z: number;
  y: number;
  rotY: number;
  scale: number;
  tint: number; // 0..1 个体色差
}

/* ------------------------------------------------------------------ */
/* 地图声明 —— 整张地图"需要人摆的东西"只有这些规则,其余全由程序生成      */
/* ------------------------------------------------------------------ */
export const layout: Rule[] = [
  {
    type: 'scatter',
    kind: 'tree',
    count: 240,
    minDist: 4.2,
    seed: 7,
    // 内陆、不陡、密度噪声够高(成片)、避开出生点
    where: (s) =>
      s.height > 1.2 && s.slope < 0.55 && s.density > 0.42 && s.distFromSpawn > 6,
  },
  {
    type: 'ring',
    kind: 'palm',
    count: 14,
    radius: [0.55, 0.92],
    jitter: 0.08,
    seed: 13,
    // 沙滩带:低海拔 + 平缓(域扭曲使真实岸线漂移,窗口要留宽)
    where: (s) => s.height > 0.15 && s.height < 2.5 && s.slope < 0.45,
  },
  {
    type: 'scatter',
    kind: 'rock',
    count: 90,
    minDist: 5.0,
    seed: 11,
    where: (s) => s.height > 0.2 && s.slope < 0.9 && s.distFromSpawn > 3,
  },
  {
    type: 'scatter',
    kind: 'grass',
    count: 650,
    minDist: 1.7,
    seed: 23,
    where: (s) => s.height > 0.9 && s.slope < 0.55 && s.density > 0.16,
  },
];

/* ------------------------------------------------------------------ */
/* 求解器(零 LLM、确定性)                                                */
/* ------------------------------------------------------------------ */

function sampleAt(x: number, z: number): Sample {
  return {
    x,
    z,
    height: heightAt(x, z),
    slope: slopeAt(x, z),
    density: densityAt(x, z),
    distFromSpawn: Math.hypot(x - SPAWN.x, z - SPAWN.z),
  };
}

/** 网格哈希:O(1) 近邻查询,保证任意两个已放置物体间距 >= minDist */
class SpacingGrid {
  private cell: number;
  private map = new Map<string, { x: number; z: number; r: number }[]>();

  constructor(cell: number) {
    this.cell = cell;
  }

  private key(cx: number, cz: number): string {
    return cx + ':' + cz;
  }

  /** 以 (x,z) 为圆心、r 为半径检查是否与已放置物体重叠 */
  isFree(x: number, z: number, r: number): boolean {
    const c = this.cell;
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.map.get(this.key(cx + i, cz + j));
        if (!list) continue;
        for (const p of list) {
          const need = (r + p.r) * 0.5; // 双方半径各让一半,合成最小间距
          const dx = p.x - x;
          const dz = p.z - z;
          if (dx * dx + dz * dz < need * need) return false;
        }
      }
    }
    return true;
  }

  insert(x: number, z: number, r: number): void {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let list = this.map.get(k);
    if (!list) {
      list = [];
      this.map.set(k, list);
    }
    list.push({ x, z, r });
  }
}

const SEARCH_RADIUS = ISLAND_RADIUS * 1.15;
const MAX_TRIES_PER_ITEM = 60;

function solveScatter(rule: ScatterRule, grid: SpacingGrid, rng: () => number, out: Placed[]): void {
  let placedCount = 0;
  let guard = 0;
  const maxGuard = rule.count * MAX_TRIES_PER_ITEM;
  while (placedCount < rule.count && guard < maxGuard) {
    guard++;
    const x = (rng() * 2 - 1) * SEARCH_RADIUS;
    const z = (rng() * 2 - 1) * SEARCH_RADIUS;
    if (Math.hypot(x, z) > SEARCH_RADIUS) continue;
    const s = sampleAt(x, z);
    if (!rule.where(s)) continue;
    if (!grid.isFree(x, z, rule.minDist)) continue;
    grid.insert(x, z, rule.minDist);
    out.push({
      kind: rule.kind,
      x,
      z,
      y: heightAt(x, z),
      rotY: rng() * Math.PI * 2,
      scale: 0.75 + rng() * 0.6,
      tint: rng(),
    });
    placedCount++;
  }
}

function solveRing(rule: RingRule, grid: SpacingGrid, rng: () => number, out: Placed[]): void {
  let placedCount = 0;
  let guard = 0;
  const maxGuard = rule.count * MAX_TRIES_PER_ITEM;
  while (placedCount < rule.count && guard < maxGuard) {
    guard++;
    const angle = rng() * Math.PI * 2;
    const rr = (rule.radius[0] + rng() * (rule.radius[1] - rule.radius[0])) * ISLAND_RADIUS;
    const jr = rule.jitter * ISLAND_RADIUS;
    const x = Math.cos(angle) * rr + (rng() * 2 - 1) * jr;
    const z = Math.sin(angle) * rr + (rng() * 2 - 1) * jr;
    const s = sampleAt(x, z);
    if (!rule.where(s)) continue;
    if (!grid.isFree(x, z, 3.0)) continue;
    grid.insert(x, z, 3.0);
    out.push({
      kind: rule.kind,
      x,
      z,
      y: heightAt(x, z),
      // 棕榈向外海倾斜一点,是"被设计过"的 30% 里最便宜的一笔
      rotY: angle + Math.PI / 2 + (rng() - 0.5) * 0.6,
      scale: 0.85 + rng() * 0.5,
      tint: rng(),
    });
    placedCount++;
  }
}

/** 求解整张地图。同样的 layout → 同样的结果(断言:确定性) */
export function solveLayout(rules: Rule[] = layout): Placed[] {
  const out: Placed[] = [];
  const grid = new SpacingGrid(8);
  for (const rule of rules) {
    const rng = mulberry32(rule.seed);
    if (rule.type === 'scatter') solveScatter(rule, grid, rng, out);
    else solveRing(rule, grid, rng, out);
  }
  return out;
}
