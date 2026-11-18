import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  HalfFloatType,
  NearestFilter,
  Points,
  RGBAFormat,
  ShaderMaterial,
  type IUniform,
  type WebGLRenderer,
} from 'three';
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import noise from './glsl/noise.glsl?raw';
import velocityFrag from './glsl/sim-velocity.frag?raw';
import positionFrag from './glsl/sim-position.frag?raw';
import particlesVert from './glsl/particles.vert?raw';
import particlesFrag from './glsl/particles.frag?raw';

export interface ParticleFrame {
  dt: number;
  time: number;
  flow: number;
  scrollWorld: number;
  scrollVel: number;
  gather: number;
  pointerX: number;
  pointerY: number;
  pointerVX: number;
  pointerVY: number;
  pointerActive: number;
  alpha: number;
  shift: number;
}

const hash = (n: number) => {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * GPU particle field: positions and velocities live in float textures and are
 * stepped by fragment shaders (GPUComputationRenderer), so thousands of
 * particles cost almost nothing on the CPU.
 */
export class ParticleField {
  readonly points: Points;
  readonly count: number;
  private readonly gpu: GPUComputationRenderer;
  private readonly velVar: Variable;
  private readonly posVar: Variable;
  private readonly target: DataTexture;
  private readonly material: ShaderMaterial;
  private readonly geometry: BufferGeometry;

  constructor(
    renderer: WebGLRenderer,
    readonly size: number,
    aspect: number,
    pointSize: number,
    colors: Record<'uA' | 'uB' | 'uC', IUniform>,
  ) {
    this.count = size * size;
    const gpu = (this.gpu = new GPUComputationRenderer(size, size, renderer));
    if (!renderer.extensions.has('EXT_color_buffer_float')) gpu.setDataType(HalfFloatType);

    const pos0 = gpu.createTexture();
    const vel0 = gpu.createTexture();
    const pd = pos0.image.data as Float32Array;
    for (let i = 0; i < this.count; i++) {
      pd[i * 4] = (Math.random() * 2 - 1) * (aspect + 0.1);
      pd[i * 4 + 1] = Math.random() * 2.2 - 1.1;
      pd[i * 4 + 2] = Math.random() * 2 - 1;
      pd[i * 4 + 3] = Math.random();
    }

    this.target = new DataTexture(new Float32Array(this.count * 4), size, size, RGBAFormat, FloatType);
    this.target.minFilter = this.target.magFilter = NearestFilter;
    this.target.needsUpdate = true;

    this.velVar = gpu.addVariable('tVel', noise + velocityFrag, vel0);
    this.posVar = gpu.addVariable('tPos', positionFrag, pos0);
    gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);
    gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);

    Object.assign(this.velVar.material.uniforms, {
      uTime: { value: 0 },
      uDt: { value: 0 },
      uFlow: { value: 1 },
      uScrollWorld: { value: 0 },
      uScrollVel: { value: 0 },
      uGather: { value: 0 },
      uPointerActive: { value: 0 },
      uPointer: { value: [0, 0] },
      uPointerVel: { value: [0, 0] },
      tTarget: { value: this.target },
    });
    Object.assign(this.posVar.material.uniforms, {
      uDt: { value: 0 },
      uAspect: { value: aspect },
      uScrollVel: { value: 0 },
      uGather: { value: 0 },
      tTarget: { value: this.target },
    });

    const err = gpu.init();
    if (err) throw new Error(err);

    // Render geometry: one vertex per texel.
    const geometry = (this.geometry = new BufferGeometry());
    const ref = new Float32Array(this.count * 2);
    const rnd = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      ref[i * 2] = ((i % size) + 0.5) / size;
      ref[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size;
      rnd[i] = Math.random();
    }
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.count * 3), 3));
    geometry.setAttribute('ref', new BufferAttribute(ref, 2));
    geometry.setAttribute('rnd', new BufferAttribute(rnd, 1));

    this.material = new ShaderMaterial({
      vertexShader: noise + particlesVert,
      fragmentShader: particlesFrag,
      uniforms: {
        tPos: { value: null },
        tVel: { value: null },
        tTarget: { value: this.target },
        uSize: { value: pointSize },
        uDpr: { value: 1 },
        uShift: { value: 0 },
        uAlpha: { value: 0 },
        uGather: { value: 0 },
        ...colors,
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  /** Assign halo points (world space, at scroll 0) to a stable random subset of particles. */
  setTargets(world: Float32Array, fraction: number): void {
    const data = this.target.image.data as Float32Array;
    const n = world.length / 2;
    let k = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * 4;
      if (n > 0 && hash(i) < fraction) {
        const j = k++ % n;
        data[o] = world[j * 2];
        data[o + 1] = world[j * 2 + 1];
        data[o + 2] = 0.1 + 0.9 * hash(i + 7919);
        data[o + 3] = 1;
      } else {
        data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
      }
    }
    this.target.needsUpdate = true;
  }

  setAspect(aspect: number): void {
    this.posVar.material.uniforms.uAspect.value = aspect;
  }

  setDpr(dpr: number): void {
    this.material.uniforms.uDpr.value = dpr;
  }

  setDrawFraction(f: number): void {
    this.geometry.setDrawRange(0, Math.floor(this.count * f));
  }

  update(f: ParticleFrame): void {
    const vu = this.velVar.material.uniforms;
    vu.uTime.value = f.time;
    vu.uDt.value = f.dt;
    vu.uFlow.value = f.flow;
    vu.uScrollWorld.value = f.scrollWorld;
    vu.uScrollVel.value = f.scrollVel;
    vu.uGather.value = f.gather;
    vu.uPointerActive.value = f.pointerActive;
    vu.uPointer.value = [f.pointerX, f.pointerY];
    vu.uPointerVel.value = [f.pointerVX, f.pointerVY];

    const pu = this.posVar.material.uniforms;
    pu.uDt.value = f.dt;
    pu.uScrollVel.value = f.scrollVel;
    pu.uGather.value = f.gather;

    this.gpu.compute();

    const mu = this.material.uniforms;
    mu.tPos.value = this.gpu.getCurrentRenderTarget(this.posVar).texture;
    mu.tVel.value = this.gpu.getCurrentRenderTarget(this.velVar).texture;
    mu.uAlpha.value = f.alpha;
    mu.uShift.value = f.shift;
    mu.uGather.value = f.gather;
  }

  dispose(): void {
    this.gpu.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.target.dispose();
  }
}
