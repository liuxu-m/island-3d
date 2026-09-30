/**
 * 角色控制 + 第三人称相机(零物理引擎,方案 02 决策):
 *  - 地面吸附:解析 heightAt,不用碰撞体
 *  - 下水自动浮游:水深 > 0.5m 时浮到水面,移速减半
 *  - 指针锁定第三人称;相机不穿山、不入水
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { heightAt, SEA_LEVEL, SPAWN } from '../world/terrain';

const WALK_SPEED = 4.2;
const RUN_SPEED = 8.0;
const SWIM_FACTOR = 0.45;
const JUMP_VEL = 6.2;
const GRAVITY = 16;
const CAM_DIST = 6.5;
const CAM_HEIGHT = 2.0;

/** 跨组件共享的角色状态(HUD 读取坐标,免状态库) */
export const playerState = {
  pos: new THREE.Vector3(SPAWN.x, 0, SPAWN.z),
  grounded: true,
  swimming: false,
  fps: 0,
};

export function Player({ active }: { active: boolean }) {
  const group = useRef<THREE.Group>(null);
  const bodyYaw = useRef(0);
  const vel = useRef(new THREE.Vector3());
  const camAngles = useRef({ yaw: Math.PI * 0.75, pitch: 0.32 });
  const keys = useRef<Record<string, boolean>>({});
  const { camera, gl } = useThree();

  const spawnY = useMemo(() => heightAt(SPAWN.x, SPAWN.z), []);

  useEffect(() => {
    playerState.pos.set(SPAWN.x, spawnY, SPAWN.z);
  }, [spawnY]);

  useEffect(() => {
    if (!active) return;
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      keys.current[e.code] = down;
      if (down && e.code === 'KeyR') {
        playerState.pos.set(SPAWN.x, heightAt(SPAWN.x, SPAWN.z), SPAWN.z);
        vel.current.set(0, 0, 0);
      }
    };
    const kd = onKey(true);
    const ku = onKey(false);
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return;
      camAngles.current.yaw -= e.movementX * 0.0026;
      camAngles.current.pitch = THREE.MathUtils.clamp(
        camAngles.current.pitch + e.movementY * 0.0022,
        -0.25,
        1.15,
      );
    };
    const onClick = () => {
      if (document.pointerLockElement !== gl.domElement) {
        gl.domElement.requestPointerLock();
      }
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('mousemove', onMouseMove);
    gl.domElement.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('mousemove', onMouseMove);
      gl.domElement.removeEventListener('click', onClick);
    };
  }, [active, gl]);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const p = playerState.pos;
    const groundY = heightAt(p.x, p.z);
    const inWater = groundY < SEA_LEVEL - 0.5;
    playerState.swimming = inWater;

    if (active) {
      // 输入方向(相机相对)
      const f = (keys.current['KeyW'] ? 1 : 0) - (keys.current['KeyS'] ? 1 : 0);
      const r = (keys.current['KeyD'] ? 1 : 0) - (keys.current['KeyA'] ? 1 : 0);
      const yaw = camAngles.current.yaw;
      const dir = new THREE.Vector3(
        Math.sin(yaw) * -f + Math.cos(yaw) * r,
        0,
        Math.cos(yaw) * -f - Math.sin(yaw) * r,
      );
      const moving = dir.lengthSq() > 0.001;
      if (moving) dir.normalize();

      let speed = keys.current['ShiftLeft'] || keys.current['ShiftRight'] ? RUN_SPEED : WALK_SPEED;
      if (inWater) speed *= SWIM_FACTOR;

      // 水平速度:直接向目标速度收敛(街机手感,无物理引擎)
      vel.current.x = THREE.MathUtils.damp(vel.current.x, dir.x * speed, 12, dt);
      vel.current.z = THREE.MathUtils.damp(vel.current.z, dir.z * speed, 12, dt);

      // 垂直:重力 or 浮力
      if (inWater) {
        const targetY = SEA_LEVEL - 0.35;
        vel.current.y = THREE.MathUtils.damp(vel.current.y, (targetY - p.y) * 4, 8, dt);
      } else {
        vel.current.y -= GRAVITY * dt;
        if (playerState.grounded && keys.current['Space']) {
          vel.current.y = JUMP_VEL;
          playerState.grounded = false;
        }
      }

      p.x += vel.current.x * dt;
      p.z += vel.current.z * dt;
      p.y += vel.current.y * dt;

      // 地面吸附
      const newGround = heightAt(p.x, p.z);
      if (!inWater && p.y <= newGround) {
        p.y = newGround;
        vel.current.y = 0;
        playerState.grounded = true;
      } else if (inWater) {
        playerState.grounded = false;
      } else {
        playerState.grounded = p.y - newGround < 0.05;
      }

      // 身体朝向运动方向
      if (moving && group.current) {
        const targetYaw = Math.atan2(vel.current.x, vel.current.z);
        let d = targetYaw - bodyYaw.current;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        bodyYaw.current += d * Math.min(1, dt * 10);
        group.current.rotation.y = bodyYaw.current;
      }
    }

    if (group.current) group.current.position.copy(p);

    // 第三人称相机
    if (active) {
      const { yaw, pitch } = camAngles.current;
      const ideal = new THREE.Vector3(
        p.x + Math.sin(yaw) * Math.cos(pitch) * CAM_DIST,
        p.y + CAM_HEIGHT + Math.sin(pitch) * CAM_DIST,
        p.z + Math.cos(yaw) * Math.cos(pitch) * CAM_DIST,
      );
      // 相机约束:不穿山、不入水
      const camGround = heightAt(ideal.x, ideal.z);
      ideal.y = Math.max(ideal.y, camGround + 0.5, SEA_LEVEL + 0.6);
      camera.position.lerp(ideal, Math.min(1, dt * 8));
      camera.lookAt(p.x, p.y + 1.4, p.z);
    }

    // FPS 采样(每 30 帧更新一次)
    if (state.clock.elapsedTime % 1 < rawDelta) {
      playerState.fps = Math.round(1 / Math.max(rawDelta, 1e-4));
    }
  });

  return (
    <group ref={group}>
      {/* 身体 */}
      <mesh castShadow position-y={0.85}>
        <capsuleGeometry args={[0.32, 0.7, 6, 12]} />
        <meshStandardMaterial color="#e8632c" roughness={0.6} flatShading />
      </mesh>
      {/* 头 */}
      <mesh castShadow position-y={1.72}>
        <sphereGeometry args={[0.26, 12, 10]} />
        <meshStandardMaterial color="#f2d8b8" roughness={0.7} flatShading />
      </mesh>
      {/* 遮阳帽 */}
      <mesh castShadow position-y={1.92}>
        <coneGeometry args={[0.34, 0.24, 10]} />
        <meshStandardMaterial color="#d94f3d" roughness={0.7} flatShading />
      </mesh>
      {/* 背包 */}
      <mesh castShadow position={[0, 1.0, -0.36]}>
        <boxGeometry args={[0.4, 0.5, 0.2]} />
        <meshStandardMaterial color="#3e6b8a" roughness={0.8} flatShading />
      </mesh>
    </group>
  );
}
