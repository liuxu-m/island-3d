/**
 * 大海水面:自定义 shader。
 *  - 顶点:三波叠加的 Gerstner-lite 波浪
 *  - 片元:按"水深"混色(采样 CPU 同款 heightAt 生成的高度图纹理)
 *          岸线白沫 + 菲涅尔天空反射 + 太阳高光
 *  世界尺度几百米,用大水面 + 雾遮远景(方案 07·性能预算)。
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { heightAt, TERRAIN_SIZE } from './terrain';

const HEIGHTMAP_RES = 256;
const HEIGHTMAP_EXTENT = 360; // 高度图覆盖范围(米),略大于地形,保证岸线泡沫采样不越界

function buildHeightmapTexture(): THREE.DataTexture {
  const data = new Float32Array(HEIGHTMAP_RES * HEIGHTMAP_RES);
  for (let j = 0; j < HEIGHTMAP_RES; j++) {
    for (let i = 0; i < HEIGHTMAP_RES; i++) {
      const x = (i / (HEIGHTMAP_RES - 1) - 0.5) * HEIGHTMAP_EXTENT;
      const z = (j / (HEIGHTMAP_RES - 1) - 0.5) * HEIGHTMAP_EXTENT;
      data[j * HEIGHTMAP_RES + i] = heightAt(x, z);
    }
  }
  const tex = new THREE.DataTexture(data, HEIGHTMAP_RES, HEIGHTMAP_RES, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  // 三组方向/波长/速度不同的正弦波,叠加出"活"的海面
  float wave(vec2 p, vec2 dir, float freq, float speed, float amp, float t) {
    return sin(dot(p, dir) * freq + t * speed) * amp;
  }

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float t = uTime;
    float h = 0.0;
    h += wave(wp.xz, normalize(vec2( 1.0,  0.35)), 0.10, 1.1, 0.28, t);
    h += wave(wp.xz, normalize(vec2(-0.6,  1.0 )), 0.23, 1.7, 0.12, t);
    h += wave(wp.xz, normalize(vec2( 0.8, -0.7 )), 0.45, 2.6, 0.05, t);
    wp.y += h;

    // 数值法线(波浪对 x/z 的偏导)
    float e = 0.6;
    float hx = wave(wp.xz + vec2(e, 0.0), normalize(vec2( 1.0,  0.35)), 0.10, 1.1, 0.28, t)
             + wave(wp.xz + vec2(e, 0.0), normalize(vec2(-0.6,  1.0 )), 0.23, 1.7, 0.12, t)
             + wave(wp.xz + vec2(e, 0.0), normalize(vec2( 0.8, -0.7 )), 0.45, 2.6, 0.05, t);
    float hz = wave(wp.xz + vec2(0.0, e), normalize(vec2( 1.0,  0.35)), 0.10, 1.1, 0.28, t)
             + wave(wp.xz + vec2(0.0, e), normalize(vec2(-0.6,  1.0 )), 0.23, 1.7, 0.12, t)
             + wave(wp.xz + vec2(0.0, e), normalize(vec2( 0.8, -0.7 )), 0.45, 2.6, 0.05, t);
    vNormalW = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));

    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uHeightmap;
  uniform float uExtent;
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform vec3 uSkyColor;
  uniform vec3 uFoamColor;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  float terrainH(vec2 xz) {
    vec2 uv = xz / uExtent + 0.5;
    return texture2D(uHeightmap, uv).r;
  }

  void main() {
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 N = normalize(vNormalW);

    // 水深 → 颜色:岸边浅绿,远海深蓝
    float depth = clamp(-terrainH(vWorldPos.xz) / 7.0, 0.0, 1.0);
    vec3 col = mix(uShallowColor, uDeepColor, pow(depth, 0.7));

    // 菲涅尔:掠射角反射天空
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col = mix(col, uSkyColor, fresnel * 0.65);

    // 太阳高光
    vec3 H = normalize(V + normalize(uSunDir));
    float spec = pow(max(dot(N, H), 0.0), 220.0) * 1.2;
    col += vec3(spec);

    // 岸线泡沫:紧贴海平面的窄条带 + 动态噪声碎边
    float th = terrainH(vWorldPos.xz);
    float band = 1.0 - smoothstep(0.0, 0.45, abs(th + 0.12));
    float n = sin(vWorldPos.x * 1.7 + uTime * 1.3) * sin(vWorldPos.z * 1.9 - uTime * 1.1);
    float foam = band * smoothstep(0.25, 0.8, band + n * 0.18);
    col = mix(col, uFoamColor, foam * 0.85);

    // 波峰细碎高光
    float sparkle = smoothstep(0.985, 1.0, sin(vWorldPos.x * 3.1 + uTime * 2.0) * sin(vWorldPos.z * 2.7 - uTime * 1.7));
    col += vec3(sparkle * 0.15);

    float alpha = mix(0.82, 0.96, depth);
    alpha = mix(alpha, 1.0, foam * 0.5);
    gl_FragColor = vec4(col, alpha);
  }
`;

export function Water({ frozen }: { frozen?: boolean }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const heightmap = useMemo(buildHeightmapTexture, []);
  const scene = useThree((s) => s.scene);

  const uniforms = useMemo(
    () => ({
      uTime: { value: frozen ? 12 : 0 },
      uHeightmap: { value: heightmap },
      uExtent: { value: HEIGHTMAP_EXTENT },
      uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.35).normalize() },
      uShallowColor: { value: new THREE.Color('#3ec9b0') },
      uDeepColor: { value: new THREE.Color('#0b3f6e') },
      uSkyColor: { value: new THREE.Color('#aee3f5') },
      uFoamColor: { value: new THREE.Color('#f4fbf7') },
    }),
    [heightmap, frozen],
  );

  useFrame((_, delta) => {
    if (!frozen && matRef.current) {
      matRef.current.uniforms.uTime.value += delta;
    }
  });

  // 让水面颜色与雾衔接:把雾色同步给天空反射色
  useMemo(() => {
    const fog = scene.fog as THREE.Fog | null;
    if (fog) uniforms.uSkyColor.value.copy(fog.color).lerp(new THREE.Color('#ffffff'), 0.3);
  }, [scene.fog, uniforms]);

  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0} renderOrder={1}>
      <planeGeometry args={[900, 900, 96, 96]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}
