/**
 * 确定性噪声库(零依赖,纯 TS)
 * 原则(方案 03):同样的 seed 永远生成同样的世界 —— 这是 L1 断言可复现的前提。
 */

/** mulberry32: 小而稳的确定性 PRNG */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 整数格点哈希 → [0, 1) */
function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 值噪声 → [-1, 1] */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = smooth(fx);
  const uz = smooth(fz);

  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);

  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return (top + (bottom - top) * uz) * 2 - 1;
}

/** 分形布朗运动 → 约 [-1, 1] */
export function fbm(x: number, z: number, octaves = 4, seed = 0): number {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise(x * frequency, z * frequency, seed + i * 101);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

/** 脊状噪声(山脊用) → [0, 1] */
export function ridged(x: number, z: number, octaves = 4, seed = 0): number {
  const v = fbm(x, z, octaves, seed);
  const r = 1 - Math.abs(v);
  return r * r;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
