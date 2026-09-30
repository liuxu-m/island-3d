/**
 * 地形网格:一次性构建,顶点色按生态着色(方案 03·生态层:高度 + 坡度规则)。
 * 顶点色 = 零贴图显存占用,配合 flatShading 出低模风格。
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { heightAt, slopeAt, densityAt, TERRAIN_SIZE, TERRAIN_SEGMENTS, SEA_LEVEL } from './terrain';
import { clamp, lerp } from './noise';

const C = {
  sand: new THREE.Color('#dcc489'),
  grassA: new THREE.Color('#5fae4e'),
  grassB: new THREE.Color('#3e8e52'),
  rock: new THREE.Color('#8d8578'),
  cliff: new THREE.Color('#6f6a5e'),
  seabed: new THREE.Color('#9d8f66'),
};

function colorAt(x: number, z: number, out: THREE.Color): THREE.Color {
  const h = heightAt(x, z);
  const s = slopeAt(x, z);
  const d = densityAt(x, z);

  if (h < SEA_LEVEL - 0.3) return out.copy(C.seabed);

  // 草地双色按密度噪声混合,避免一整片死绿
  const grass = new THREE.Color().copy(C.grassA).lerp(C.grassB, d);

  // 沙滩 → 草地过渡带
  const sandT = clamp((h - (SEA_LEVEL + 0.35)) / 0.9, 0, 1);
  let col = new THREE.Color().copy(C.sand).lerp(grass, sandT);

  // 坡地露岩 / 高处岩壁(阈值抬高,避免整片山坡变土色)
  const rockT = clamp((s - 0.62) / 0.6, 0, 1);
  col.lerp(C.rock, rockT);
  const cliffT = clamp((s - 0.85) / 0.4, 0, 1);
  col.lerp(C.cliff, cliffT);
  // 高海拔露岩只染陡处,平缓山顶保留草甸(与 biomeAt 规则一致)
  const highT = clamp((h - 13) / 4, 0, 1) * clamp((s - 0.25) / 0.3, 0, 1);
  col.lerp(C.rock, highT * 0.7);

  return out.copy(col);
}

export function Terrain() {
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(
      TERRAIN_SIZE,
      TERRAIN_SIZE,
      TERRAIN_SEGMENTS,
      TERRAIN_SEGMENTS,
    );
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, heightAt(x, z));
      colorAt(x, z, tmp);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <mesh geometry={geometry} receiveShadow castShadow>
      <meshStandardMaterial vertexColors flatShading roughness={0.95} metalness={0} />
    </mesh>
  );
}
