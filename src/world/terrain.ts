/**
 * 解析式地形(方案 02 决策:验证阶段零物理引擎,地形用解析 heightAt)
 *
 * 公式(方案 03·地形实现要点):
 *   h(x,z) = continentMask(r) * fbm(...)            // 基础起伏
 *          + pow(continentMask(r), 2) * ridged      // 山脊
 *   其中 r 经过域扭曲 —— 让海岸线"不圆也不碎"
 *
 * heightAt 是全场唯一真源:地形网格、角色落地、散布约束、海水岸线泡沫全部吃它。
 */
import { fbm, ridged, clamp } from './noise';

export const SEA_LEVEL = 0;
/** 岛的大致半径(米)。世界尺度"几百米,用雾遮远景"(方案 07·性能预算) */
export const ISLAND_RADIUS = 95;
/** 地形网格覆盖范围(米,正方形边长) */
export const TERRAIN_SIZE = 300;
/** 地形网格分段数。160×160×2 ≈ 51k 三角形,符合 <100k 预算 */
export const TERRAIN_SEGMENTS = 160;
/** 出生点(岛心小山丘,数学上保证高出海面,见 verify 断言) */
export const SPAWN = { x: 0, z: 0 } as const;

/** 递减 smoothstep:r <= inner → 1,r >= outer → 0 */
function falloff(r: number, inner: number, outer: number): number {
  const t = clamp((r - inner) / (outer - inner), 0, 1);
  const s = t * t * (3 - 2 * t);
  return 1 - s;
}

/** 域扭曲后的岛掩码 → [0, 1] */
export function islandMask(x: number, z: number): number {
  // 域扭曲:对采样坐标加低频噪声偏移,海岸线才不会是一个完美的圆
  const wx = x + 30 * fbm(x * 0.02 + 5.2, z * 0.02 + 1.3, 3, 17);
  const wz = z + 30 * fbm(x * 0.02 + 9.1, z * 0.02 + 7.7, 3, 29);
  const r = Math.hypot(wx, wz) / ISLAND_RADIUS;
  return falloff(r, 0.3, 1.0);
}

/** 未熨平的原始高度 */
function rawHeight(x: number, z: number): number {
  const mask = islandMask(x, z);
  if (mask <= 0.001) return -6; // 远海海床

  const hills = fbm(x * 0.012, z * 0.012, 4, 3) * 7.5;
  const swell = fbm(x * 0.005 - 3.1, z * 0.005 + 8.8, 3, 21) * 3.5;
  const ridge = ridged(x * 0.028, z * 0.028, 4, 8) * 7 * mask * mask;
  // 岛心台地:保证出生点数学上必然在海面之上(下限 = 3.2+12-|hills|-|swell| ≈ 4.2m)
  const r0 = Math.hypot(x - SPAWN.x, z - SPAWN.z) / ISLAND_RADIUS;
  const mound = Math.pow(Math.max(0, 1 - r0), 2) * 12;

  return mask * (3.2 + hills + swell) + ridge + mound * mask - 5.5 * (1 - mask);
}

/** 出生点平台高度(惰性求值一次) */
let spawnPlateau: number | null = null;
function plateauHeight(): number {
  if (spawnPlateau === null) spawnPlateau = rawHeight(SPAWN.x, SPAWN.z);
  return spawnPlateau;
}

/** 世界高度:正值为陆地,负值为海床。出生点周围熨平成平台(空地) */
export function heightAt(x: number, z: number): number {
  const raw = rawHeight(x, z);
  const d = Math.hypot(x - SPAWN.x, z - SPAWN.z);
  const blend = falloff(d, 4, 10); // 4m 内全平,10m 外完全自然
  if (blend <= 0) return raw;
  return raw + (plateauHeight() - raw) * blend;
}

/** 数值坡度(高度差/距离)。>1 即超过 45° */
export function slopeAt(x: number, z: number, eps = 0.6): number {
  const hx = heightAt(x + eps, z) - heightAt(x - eps, z);
  const hz = heightAt(x, z + eps) - heightAt(x, z - eps);
  return Math.hypot(hx, hz) / (2 * eps);
}

/** 植被密度噪声:让森林成片,而不是均匀撒(方案 03·散布要点 2) */
export function densityAt(x: number, z: number): number {
  return fbm(x * 0.03 + 11.7, z * 0.03 - 4.9, 3, 51) * 0.5 + 0.5;
}

/** 地形生态着色采样(沙滩/草/岩石/高处岩壁),Terrain 顶点色与 verify 共用 */
export function biomeAt(x: number, z: number): 'sand' | 'grass' | 'rock' | 'cliff' | 'seabed' {
  const h = heightAt(x, z);
  const s = slopeAt(x, z);
  if (h < SEA_LEVEL - 0.3) return 'seabed';
  if (s > 0.85) return 'cliff';
  if (h < SEA_LEVEL + 0.9) return 'sand';
  // 露岩要"陡"或"极高"——平缓的山顶平台是草甸,不是石头
  if (s > 0.55 || (h > 14 && s > 0.3)) return 'rock';
  return 'grass';
}
