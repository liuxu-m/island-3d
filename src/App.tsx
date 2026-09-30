/**
 * 场景组织(方案 02:R3F 组织场景 + 原生 three 对象做热路径)。
 *
 * 性能决策(方案 07,针对 Arc 核显 + 3K 屏):
 *  - 内部渲染分辨率固定 ~1280 宽,CSS 放大铺满(dpr 反算)
 *  - 动态光 ≤ 2:一盏太阳平行光(唯一阴影源)+ 一盏半球环境光
 *  - 雾遮远景,抗锯齿关(反正要放大,MSAA 是白烧填充率)
 *
 * ?shot=1 进入截图模式:固定机位、冻结水面、隐藏 HUD,供 pnpm shot 使用。
 */
import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import { Terrain } from './world/TerrainMesh';
import { Water } from './world/Water';
import { Vegetation } from './world/Vegetation';
import { Player } from './player/Player';
import { HUD } from './ui/HUD';
import { heightAt, SPAWN } from './world/terrain';

const SUN_DIR = new THREE.Vector3(0.5, 0.8, 0.35).normalize();
const FOG_COLOR = '#bcd9e8';

declare global {
  interface Window {
    __READY?: boolean;
  }
}

/** 截图模式:固定机位 + 首帧后置 __READY 旗标 */
function ShotCamera({ ground }: { ground: boolean }) {
  const { camera } = useThree();
  useFrame(() => {
    if (ground) {
      // 玩家视角:越肩望向海滩,验证角色/树木比例与水面观感
      const h = heightAt(SPAWN.x, SPAWN.z);
      camera.position.set(SPAWN.x + 14, h + 5, SPAWN.z + 14);
      camera.lookAt(SPAWN.x - 30, h - 4, SPAWN.z - 35);
    } else {
      camera.position.set(95, 55, 95);
      camera.lookAt(0, 2, 0);
    }
    if (!window.__READY) window.__READY = true;
  });
  return null;
}

function Sun() {
  return (
    <directionalLight
      position={[SUN_DIR.x * 140, SUN_DIR.y * 140, SUN_DIR.z * 140]}
      intensity={1.7}
      color="#fff3e0"
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-100}
      shadow-camera-right={100}
      shadow-camera-top={100}
      shadow-camera-bottom={-100}
      shadow-camera-near={10}
      shadow-camera-far={400}
      shadow-bias={-0.0004}
    />
  );
}

export default function App() {
  const shotParam = useMemo(() => new URLSearchParams(window.location.search).get('shot'), []);
  const shotMode = shotParam !== null;
  const groundShot = shotParam === 'ground';

  // 内部渲染分辨率 ≈1280 宽:buffer = CSS尺寸 × dpr
  const [dpr] = useState(() => Math.min(1, 1280 / window.innerWidth));

  return (
    <>
      <Canvas
        shadows
        dpr={dpr}
        gl={{ powerPreference: 'high-performance', antialias: false }}
        camera={{ fov: 55, near: 0.1, far: 900, position: [40, 25, 40] }}
        style={{ width: '100vw', height: '100vh' }}
      >
        <color attach="background" args={[FOG_COLOR]} />
        <fog attach="fog" args={[FOG_COLOR, 130, 460]} />

        <Sky
          distance={4000}
          sunPosition={[SUN_DIR.x * 100, SUN_DIR.y * 100, SUN_DIR.z * 100]}
          turbidity={6}
          rayleigh={1.2}
        />

        <hemisphereLight args={['#cfe8ff', '#4a6b48', 0.55]} />
        <Sun />

        <Terrain />
        <Water frozen={shotMode} />
        <Vegetation />
        <Player active={!shotMode} />
        {shotMode && <ShotCamera ground={groundShot} />}
      </Canvas>
      {!shotMode && <HUD />}
    </>
  );
}
