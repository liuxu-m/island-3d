/**
 * 植被与岩石:全部走 InstancedMesh(方案 07·性能预算:draw call < 80)。
 * 这里 4 种物体 = 4 个 draw call,上千个实例。
 *
 * 几何体是程序化低模(方案 04·资产管线的起点):
 * 先用代码拼出风格统一的"占位资产",后续换 GLB 时 pivot/缩放规则不变。
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { solveLayout, type Placed, type ObjectKind } from './layout';

/* ---------- 微型几何合并工具(统一转非索引,附顶点色) ---------- */

function paint(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const g = geo.toNonIndexed();
  g.deleteAttribute('uv');
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let offset = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, offset * 3);
    nrm.set(g.attributes.normal.array as Float32Array, offset * 3);
    col.set(g.attributes.color.array as Float32Array, offset * 3);
    offset += n;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return merged;
}

function xform(
  geo: THREE.BufferGeometry,
  px: number, py: number, pz: number,
  rx = 0, ry = 0, rz = 0,
  sx = 1, sy = 1, sz = 1,
): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  return geo.applyMatrix4(m);
}

/* ---------- 程序化低模资产(pivot 统一在底部中心) ---------- */

const TRUNK = new THREE.Color('#7a5236');
const LEAF_A = new THREE.Color('#2f7d3c');
const LEAF_B = new THREE.Color('#49a04b');
const LEAF_TOP = new THREE.Color('#63b84f');
const PALM_LEAF = new THREE.Color('#3f9e4d');
const ROCK = new THREE.Color('#8a8478');
const GRASS = new THREE.Color('#6fbf5a');

/** 阔叶树:树干 + 三层圆锥,约 60 三角形 */
function buildTree(): THREE.BufferGeometry {
  return merge([
    paint(xform(new THREE.CylinderGeometry(0.14, 0.24, 1.4, 5), 0, 0.7, 0), TRUNK),
    paint(xform(new THREE.ConeGeometry(1.5, 1.9, 6), 0, 2.2, 0), LEAF_A),
    paint(xform(new THREE.ConeGeometry(1.15, 1.6, 6), 0, 3.25, 0), LEAF_B),
    paint(xform(new THREE.ConeGeometry(0.75, 1.3, 6), 0, 4.15, 0), LEAF_TOP),
  ]);
}

/** 棕榈:微弯树干 + 放射状下垂叶片 */
function buildPalm(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    paint(xform(new THREE.CylinderGeometry(0.1, 0.2, 1.8, 5), 0.12, 0.9, 0, 0, 0, -0.12), TRUNK),
    paint(xform(new THREE.CylinderGeometry(0.08, 0.1, 1.6, 5), 0.38, 2.5, 0, 0, 0, -0.22), TRUNK),
  ];
  const fronds = 7;
  const up = new THREE.Vector3(0, 1, 0);
  const crown = new THREE.Vector3(0.55, 3.4, 0);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2;
    // 用四元数把圆锥的 +Y 轴对齐到"朝外下垂"的方向,欧拉角顺序在这里靠不住
    const dir = new THREE.Vector3(Math.cos(a), -0.55, Math.sin(a)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const frond = new THREE.ConeGeometry(0.45, 2.3, 4);
    frond.scale(1, 1, 0.5); // 压扁成叶片
    const m = new THREE.Matrix4().compose(
      crown.clone().addScaledVector(dir, 1.05),
      q,
      new THREE.Vector3(1, 1, 1),
    );
    parts.push(paint(frond.applyMatrix4(m), PALM_LEAF));
  }
  parts.push(paint(xform(new THREE.SphereGeometry(0.22, 5, 4), 0.55, 3.3, 0), TRUNK));
  return merge(parts);
}

function buildRock(): THREE.BufferGeometry {
  return merge([paint(xform(new THREE.IcosahedronGeometry(0.7, 0), 0, 0.35, 0, 0, 0, 0, 1, 0.72, 1), ROCK)]);
}

function buildGrass(): THREE.BufferGeometry {
  return merge([
    paint(xform(new THREE.ConeGeometry(0.16, 0.55, 4), 0, 0.27, 0), GRASS),
    paint(xform(new THREE.ConeGeometry(0.13, 0.42, 4), 0.16, 0.2, 0.06, 0, 0, -0.25), LEAF_B),
    paint(xform(new THREE.ConeGeometry(0.12, 0.38, 4), -0.14, 0.18, -0.05, 0.22, 0, 0.2), GRASS),
  ]);
}

const BUILDERS: Record<ObjectKind, () => THREE.BufferGeometry> = {
  tree: buildTree,
  palm: buildPalm,
  rock: buildRock,
  grass: buildGrass,
};

/* ---------- 实例化渲染 ---------- */

function Instanced({ kind, items, shadow }: { kind: ObjectKind; items: Placed[]; shadow: boolean }) {
  const geometry = useMemo(() => BUILDERS[kind](), [kind]);

  const mesh = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.9,
      metalness: 0,
    });
    const m = new THREE.InstancedMesh(geometry, material, items.length);
    const mat4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const color = new THREE.Color();
    items.forEach((p, i) => {
      euler.set(0, p.rotY, 0);
      // 棕榈沿朝向倾斜,模拟被海风吹歪
      if (kind === 'palm') euler.z = 0.12;
      quat.setFromEuler(euler);
      mat4.compose(new THREE.Vector3(p.x, p.y - 0.05, p.z), quat, new THREE.Vector3(p.scale, p.scale, p.scale));
      m.setMatrixAt(i, mat4);
      // 个体色差:亮度 ±12%,往黄/蓝轻微漂移,避免"复制粘贴感"
      color.setHSL(0, 0, 0.88 + p.tint * 0.24).offsetHSL((p.tint - 0.5) * 0.04, 0.05, 0);
      m.setColorAt(i, color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = shadow;
    m.receiveShadow = false;
    return m;
  }, [geometry, items, kind]);

  return <primitive object={mesh} />;
}

export function Vegetation() {
  const placed = useMemo(() => solveLayout(), []);
  const groups = useMemo(() => {
    const g: Record<ObjectKind, Placed[]> = { tree: [], palm: [], rock: [], grass: [] };
    for (const p of placed) g[p.kind].push(p);
    return g;
  }, [placed]);

  return (
    <group>
      <Instanced kind="tree" items={groups.tree} shadow />
      <Instanced kind="palm" items={groups.palm} shadow />
      <Instanced kind="rock" items={groups.rock} shadow />
      <Instanced kind="grass" items={groups.grass} shadow={false} />
    </group>
  );
}
