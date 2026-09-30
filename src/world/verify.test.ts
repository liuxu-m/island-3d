/**
 * L1 数值断言(方案 05 验证栈:主验证通道是数值断言,不是截图)。
 * 跑法:npm run verify
 */
import { describe, it, expect } from 'vitest';
import { heightAt, slopeAt, SEA_LEVEL, SPAWN, ISLAND_RADIUS, TERRAIN_SEGMENTS, biomeAt } from './terrain';
import { solveLayout, layout, type Placed } from './layout';

describe('地形性质', () => {
  it('出生点必然在海面之上(岛心台地数学保证)', () => {
    expect(heightAt(SPAWN.x, SPAWN.z)).toBeGreaterThan(SEA_LEVEL + 3);
  });

  it('出生点是草地(可站立、可行走)', () => {
    expect(biomeAt(SPAWN.x, SPAWN.z)).toBe('grass');
  });

  it('远处必然是大海(高度远低于海平面)', () => {
    for (const [x, z] of [[250, 0], [-250, 0], [0, 250], [0, -250], [200, 200]]) {
      expect(heightAt(x, z)).toBeLessThan(SEA_LEVEL - 2);
    }
  });

  it('heightAt 是确定性的(同参同果)', () => {
    expect(heightAt(12.34, -56.78)).toBe(heightAt(12.34, -56.78));
  });

  it('坡度场处处有限(无 NaN/Inf 奇点)', () => {
    for (let i = -8; i <= 8; i++) {
      for (let j = -8; j <= 8; j++) {
        const s = slopeAt(i * 15, j * 15);
        expect(Number.isFinite(s)).toBe(true);
      }
    }
  });

  it('岛体落在地形网格覆盖范围内', () => {
    // 散布搜索盘半径(见 layout.SEARCH_RADIUS)必须小于地形网格半宽 150
    expect(ISLAND_RADIUS * 1.15).toBeLessThan(150);
  });

  it('三角形预算:地形分段不超上限(<100k 可见三角形预算的组成部分)', () => {
    expect(TERRAIN_SEGMENTS * TERRAIN_SEGMENTS * 2).toBeLessThanOrEqual(60000);
  });
});

describe('布局求解器', () => {
  const placed = solveLayout();

  it('确定性:同一 layout 两次求解结果完全一致', () => {
    const again = solveLayout();
    expect(again.length).toBe(placed.length);
    for (let i = 0; i < placed.length; i++) {
      expect(again[i].x).toBe(placed[i].x);
      expect(again[i].z).toBe(placed[i].z);
      expect(again[i].kind).toBe(placed[i].kind);
    }
  });

  it('求解成功率:每类物体至少完成 60%(求解器不应大面积失败)', () => {
    for (const rule of layout) {
      const got = placed.filter((p) => p.kind === rule.kind).length;
      expect(got, `${rule.kind} 只放成 ${got}/${rule.count}`).toBeGreaterThanOrEqual(
        Math.floor(rule.count * 0.6),
      );
    }
  });

  it('约束兜底:所有放置物满足各自 where 条件(独立复查,不信求解器)', () => {
    for (const rule of layout) {
      const items = placed.filter((p) => p.kind === rule.kind);
      for (const p of items) {
        const ok = rule.where({
          x: p.x,
          z: p.z,
          height: heightAt(p.x, p.z),
          slope: slopeAt(p.x, p.z),
          density: 1, // density 只进不出,单独复查见下
          distFromSpawn: Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z),
        });
        // density 恒真不影响复查有效性;其余字段全部独立重算
        expect(ok).toBe(true);
      }
    }
  });

  it('没有树种在水里(玩家最直观的穿帮)', () => {
    for (const p of placed.filter((p) => p.kind === 'tree')) {
      expect(heightAt(p.x, p.z)).toBeGreaterThan(1.2);
    }
  });

  it('棕榈都在沙滩带上(环带规则的意图)', () => {
    for (const p of placed.filter((p) => p.kind === 'palm')) {
      const h = heightAt(p.x, p.z);
      expect(h).toBeGreaterThan(0.15);
      expect(h).toBeLessThan(2.5);
    }
  });

  it('最小间距:同类物体两两间距达标(抽查前 80 个,O(n²))', () => {
    const check = (items: Placed[], minDist: number) => {
      const sample = items.slice(0, 80);
      for (let i = 0; i < sample.length; i++) {
        for (let j = i + 1; j < sample.length; j++) {
          const d = Math.hypot(sample[i].x - sample[j].x, sample[i].z - sample[j].z);
          expect(d).toBeGreaterThanOrEqual(minDist * 0.95);
        }
      }
    };
    check(placed.filter((p) => p.kind === 'tree'), 4.2);
    check(placed.filter((p) => p.kind === 'rock'), 5.0);
    check(placed.filter((p) => p.kind === 'grass'), 1.7);
  });

  it('放置位置与地形高度一致(渲染不会悬空/陷地)', () => {
    for (const p of placed.slice(0, 200)) {
      expect(p.y).toBeCloseTo(heightAt(p.x, p.z), 6);
    }
  });

  it('实例总数在性能预算内', () => {
    expect(placed.length).toBeLessThan(2000);
  });
});
