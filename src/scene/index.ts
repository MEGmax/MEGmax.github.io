import {
  BufferAttribute,
  BufferGeometry,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { hexToVec3, moods, palette, type Mood } from '../palette';
import { ParticleField } from './particles';
import { AdaptiveQuality, type QualityLevel } from './quality';
import { sampleNameHalo } from './nameTargets';
import noise from './glsl/noise.glsl?raw';
import backgroundFrag from './glsl/background.frag?raw';
import compositeFrag from './glsl/composite.frag?raw';

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  nameEl: HTMLElement | null;
  heroEl: HTMLElement | null;
  sectionEls: HTMLElement[];
  reduceMotion: MediaQueryList;
  debug?: boolean;
}

interface Tier {
  name: 'desktop' | 'mobile';
  sim: number; // particle texture size (count = sim²)
  blobs: number;
  octaves: number;
  pointSize: number;
  gatherFraction: number;
  levels: QualityLevel[];
}

function pickTier(): Tier {
  const dpr = window.devicePixelRatio || 1;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = innerWidth < 760 || Math.min(innerWidth, innerHeight) < 560;
  if (coarse || small) {
    return {
      name: 'mobile',
      sim: 64, // 4,096 particles
      blobs: 2,
      octaves: 3,
      pointSize: 2.1,
      gatherFraction: 0.6,
      levels: [
        { dpr: Math.min(dpr, 1.5), bgScale: 0.3, particles: 1 },
        { dpr: Math.min(dpr, 1.25), bgScale: 0.25, particles: 0.7 },
        { dpr: 1, bgScale: 0.2, particles: 0.45 },
      ],
    };
  }
  const lowCores = (navigator.hardwareConcurrency || 8) <= 4;
  return {
    name: 'desktop',
    sim: lowCores ? 96 : 128, // 9,216 or 16,384 particles
    blobs: 4,
    octaves: 5,
    pointSize: 2.0,
    gatherFraction: 0.5,
    levels: [
      { dpr: Math.min(dpr, 2), bgScale: 0.5, particles: 1 },
      { dpr: Math.min(dpr, 1.5), bgScale: 0.42, particles: 0.75 },
      { dpr: 1, bgScale: 0.34, particles: 0.5 },
      { dpr: 0.75, bgScale: 0.26, particles: 0.3 },
    ],
  };
}

type MoodState = Omit<Mood, 'id'>;
const MOOD_KEYS = ['shift', 'intensity', 'speed', 'warp', 'particles', 'blobs'] as const;
const moodState = ({ id: _id, ...rest }: Mood): MoodState => ({ ...rest });

function mixMood(out: MoodState, a: MoodState, b: MoodState, t: number): void {
  for (const k of MOOD_KEYS) {
    if (k === 'shift') {
      let d = b.shift - a.shift;
      d -= Math.round(d); // shortest way round the cyclic ramp
      out.shift = a.shift + d * t;
    } else {
      out[k] = a[k] + (b[k] - a[k]) * t;
    }
  }
}

const vec3 = (hex: string) => new Vector3(...hexToVec3(hex));
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export function startScene(o: SceneOptions) {
  const root = document.documentElement;
  const tier = pickTier();

  const renderer = new WebGLRenderer({
    canvas: o.canvas,
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.autoClear = false;
  const floatTargets =
    renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');

  // ---- Shared uniforms (colours from src/palette.ts) -----------------------
  const colors = {
    uBase: { value: vec3(palette.base) },
    uNight: { value: vec3(palette.night) },
    uA: { value: vec3(palette.cyan) },
    uB: { value: vec3(palette.violet) },
    uC: { value: vec3(palette.magenta) },
  };

  const tri = new BufferGeometry();
  tri.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fullscreen = (material: ShaderMaterial) => {
    const scene = new Scene();
    const mesh = new Mesh(tri, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return scene;
  };

  // ---- Background: low-res shader pass -> dithered upscale ---------------
  const bgUniforms = {
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uScroll: { value: 0 },
    uShift: { value: 0 },
    uIntensity: { value: 1 },
    uWarp: { value: 4 },
    uBlobs: { value: 1 },
    uScrim: { value: new Vector4(0, 2, 1, 1) },
    ...colors,
  };
  const bgScene = fullscreen(
    new ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: noise + backgroundFrag,
      uniforms: bgUniforms,
      defines: { OCTAVES: tier.octaves, BLOBS: tier.blobs },
      depthTest: false,
      depthWrite: false,
    }),
  );
  const rtBg = new WebGLRenderTarget(2, 2, {
    type: floatTargets ? HalfFloatType : UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  });
  const compUniforms = { tBg: { value: rtBg.texture }, uTime: { value: 0 }, uGrain: { value: 0.007 } };
  const compScene = fullscreen(
    new ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: compositeFrag,
      uniforms: compUniforms,
      depthTest: false,
      depthWrite: false,
    }),
  );

  // ---- Particles --------------------------------------------------------
  const particleScene = new Scene();
  const particleCam = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
  let particles: ParticleField | null = null;

  // ---- State ------------------------------------------------------------
  const quality = new AdaptiveQuality(tier.levels, () => applyQuality());
  let cssW = 1;
  let cssH = 1;
  let aspect = 1;
  let sectionTops: number[] = [];
  let scrimRect = { cx: 0, top: 0, w: 0, h: 0 }; // hero text block, document coords
  const sectionMoods = o.sectionEls.map((el) => moodState(moods.find((m) => m.id === el.id) ?? moods[0]));
  const mood = moodState(moods[0]);
  const moodTarget = moodState(moods[0]);
  let simTime = 0;
  let clock = 0;
  let lastScrollY = scrollY;
  let scrollVel = 0;
  const pointer = { x: 0, y: 0, dx: 0, dy: 0, vx: 0, vy: 0, active: 0, lastMove: -10 };
  let particleFade = 0;
  let gatherStart = -1;
  let leftHero = false;
  let targetsReady = false;
  let staticMode = o.reduceMotion.matches;
  let running = false;
  let ready = false;
  let lost = false;
  let raf = 0;
  let last = 0;

  function measure() {
    cssW = o.canvas.clientWidth || innerWidth;
    cssH = o.canvas.clientHeight || innerHeight;
    aspect = cssW / cssH;
    sectionTops = o.sectionEls.map((el) => el.getBoundingClientRect().top + scrollY);
    const inner = o.heroEl?.querySelector<HTMLElement>('.hero-inner');
    if (inner) {
      // offsetTop/offsetHeight ignore the CSS entrance transform
      const r = inner.getBoundingClientRect();
      scrimRect = { cx: r.left + r.width / 2, top: inner.offsetTop + (o.heroEl?.offsetTop ?? 0), w: r.width, h: inner.offsetHeight };
    }
  }

  function updateScrim(sy: number) {
    const s = bgUniforms.uScrim.value;
    const cy = scrimRect.top + scrimRect.h / 2 - sy;
    s.set(
      (scrimRect.cx / cssW - 0.5) * aspect,
      0.5 - cy / cssH,
      Math.max(0.2, (scrimRect.w / cssH) * 0.62),
      Math.max(0.15, (scrimRect.h / cssH) * 0.85),
    );
  }

  function applyQuality() {
    const lv = quality.current;
    renderer.setPixelRatio(lv.dpr);
    renderer.setSize(cssW, cssH, false);
    rtBg.setSize(Math.max(2, Math.round(cssW * lv.bgScale)), Math.max(2, Math.round(cssH * lv.bgScale)));
    particles?.setDpr(lv.dpr);
    particles?.setDrawFraction(lv.particles);
    root.dataset.quality = String(quality.level);
  }

  function updateMoodTarget() {
    if (!sectionTops.length) return;
    const mid = scrollY + innerHeight * 0.5;
    let i = 0;
    while (i < sectionTops.length - 1 && mid >= sectionTops[i + 1]) i++;
    const top = sectionTops[i];
    const end = sectionTops[i + 1] ?? top + o.sectionEls[i].offsetHeight;
    const t = smoothstep(0.6, 1.0, (mid - top) / Math.max(1, end - top));
    mixMood(moodTarget, sectionMoods[i], sectionMoods[Math.min(i + 1, sectionMoods.length - 1)], t);
  }

  // ---- Gather: particles trace the name, then let go ---------------------
  let targetTimer = 0;
  function scheduleTargets() {
    if (!particles || !o.nameEl) return;
    clearTimeout(targetTimer);
    targetTimer = window.setTimeout(computeTargets, 150);
  }
  async function computeTargets() {
    const el = o.nameEl;
    if (!particles || !el) return;
    await document.fonts.ready;
    const anims = el.parentElement?.getAnimations({ subtree: true }) ?? [];
    await Promise.all(anims.map((a) => a.finished.catch(() => undefined)));
    if (!particles) return;
    const pts = sampleNameHalo(el, Math.ceil(particles.count * tier.gatherFraction));
    const world = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i += 2) {
      world[i] = ((pts[i] / cssW) * 2 - 1) * aspect;
      world[i + 1] = 1 - (pts[i + 1] / cssH) * 2;
    }
    particles.setTargets(world, tier.gatherFraction);
    if (!targetsReady) {
      targetsReady = true;
      gatherStart = clock + 0.8;
    }
  }
  function gatherAt(t: number) {
    if (gatherStart < 0) return 0;
    const s = t - gatherStart;
    if (s <= 0) return 0;
    if (s < 1.6) return easeInOut(s / 1.6);
    if (s < 3.4) return 1;
    if (s < 5.6) return 1 - easeInOut((s - 3.4) / 2.2);
    return 0;
  }

  function ensureParticles() {
    if (particles) {
      if (!particles.points.parent) particleScene.add(particles.points);
      return;
    }
    try {
      particles = new ParticleField(renderer, tier.sim, aspect, tier.pointSize, colors);
      particleScene.add(particles.points);
      particles.setDpr(quality.current.dpr);
      particles.setDrawFraction(quality.current.particles);
      scheduleTargets();
    } catch {
      particles = null; // background still runs without particles
    }
  }

  // ---- Input ------------------------------------------------------------
  const onPointer = (e: PointerEvent) => {
    const x = ((e.clientX / cssW) * 2 - 1) * aspect;
    const y = 1 - (e.clientY / cssH) * 2;
    if (clock - pointer.lastMove < 0.25) {
      pointer.dx += x - pointer.x;
      pointer.dy += y - pointer.y;
    }
    pointer.x = x;
    pointer.y = y;
    pointer.lastMove = clock;
  };
  addEventListener('pointermove', onPointer, { passive: true });
  addEventListener('pointerdown', onPointer, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => (pointer.lastMove = -10));

  // ---- Frame ------------------------------------------------------------
  function step(dt: number) {
    updateMoodTarget();
    mixMood(mood, mood, moodTarget, 1 - Math.exp(-dt * 2.5));
    simTime += dt * mood.speed;

    const sy = scrollY;
    const rawVel = (sy - lastScrollY) / Math.max(dt, 1e-3);
    lastScrollY = sy;
    scrollVel += (rawVel - scrollVel) * (1 - Math.exp(-dt * 12));

    bgUniforms.uTime.value = simTime;
    bgUniforms.uScroll.value = sy / cssH;
    updateScrim(sy);
    bgUniforms.uShift.value = mood.shift;
    bgUniforms.uIntensity.value = mood.intensity;
    bgUniforms.uWarp.value = mood.warp;
    bgUniforms.uBlobs.value = mood.blobs;
    compUniforms.uTime.value = clock;

    if (!particles) return;
    const heroH = o.heroEl?.offsetHeight ?? cssH;
    if (sy > heroH * 0.9) leftHero = true;
    else if (leftHero && sy < heroH * 0.2 && clock - gatherStart > 7) {
      leftHero = false;
      gatherStart = clock + 0.3;
    }

    const k = 1 - Math.exp(-dt * 8);
    pointer.vx += (pointer.dx / dt - pointer.vx) * k;
    pointer.vy += (pointer.dy / dt - pointer.vy) * k;
    pointer.dx = pointer.dy = 0;
    const wantActive = clock - pointer.lastMove < 1.2 ? 1 : 0;
    pointer.active += (wantActive - pointer.active) * (1 - Math.exp(-dt * 3));

    particleFade = Math.min(1, particleFade + dt / 1.8);
    particles.update({
      dt,
      time: simTime,
      flow: 0.55 + 0.45 * mood.speed,
      scrollWorld: (sy / cssH) * 2,
      scrollVel: (scrollVel / cssH) * 2,
      gather: gatherAt(clock),
      pointerX: pointer.x,
      pointerY: pointer.y,
      pointerVX: Math.max(-4, Math.min(4, pointer.vx)),
      pointerVY: Math.max(-4, Math.min(4, pointer.vy)),
      pointerActive: pointer.active,
      alpha: mood.particles * particleFade,
      shift: mood.shift,
    });
  }

  function render(withParticles: boolean) {
    renderer.setRenderTarget(rtBg);
    renderer.render(bgScene, quadCam);
    renderer.setRenderTarget(null);
    renderer.render(compScene, quadCam);
    if (withParticles && particles?.points.parent) renderer.render(particleScene, particleCam);
    if (!ready) {
      ready = true;
      o.canvas.classList.add('is-ready');
    }
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const frameMs = last ? now - last : 1000 / 60;
    last = now;
    const dt = Math.min(frameMs / 1000, 1 / 30);
    clock += dt;
    quality.tick(now, frameMs);
    step(dt);
    render(true);
  }

  function start() {
    if (running || staticMode || lost || document.hidden) return;
    running = true;
    last = 0;
    quality.hold(performance.now(), ready ? 1000 : 2500);
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  // Reduced motion: one still frame of the gradient, no particles. It is
  // re-rendered (not animated) when the section changes or the window resizes.
  function renderStatic() {
    if (lost) return;
    updateMoodTarget();
    Object.assign(mood, moodTarget);
    bgUniforms.uTime.value = 36;
    bgUniforms.uScroll.value = 0;
    updateScrim(scrollY);
    bgUniforms.uShift.value = mood.shift;
    bgUniforms.uIntensity.value = mood.intensity;
    bgUniforms.uWarp.value = mood.warp;
    bgUniforms.uBlobs.value = mood.blobs * 0.6;
    compUniforms.uTime.value = 0;
    render(false);
  }
  let staticTimer = 0;
  addEventListener(
    'scroll',
    () => {
      if (!staticMode) return;
      clearTimeout(staticTimer);
      staticTimer = window.setTimeout(renderStatic, 120);
    },
    { passive: true },
  );

  function setMotion(on: boolean) {
    staticMode = !on;
    if (staticMode) {
      stop();
      if (particles) particleScene.remove(particles.points);
      root.dataset.scene = 'static';
      renderStatic();
    } else {
      ensureParticles();
      root.dataset.scene = 'webgl';
      start();
    }
  }
  o.reduceMotion.addEventListener('change', (e) => setMotion(!e.matches));

  // ---- Lifecycle --------------------------------------------------------
  let resizeQueued = false;
  const onResize = () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      const prevW = cssW;
      measure();
      bgUniforms.uAspect.value = aspect;
      particleCam.left = -aspect;
      particleCam.right = aspect;
      particleCam.updateProjectionMatrix();
      particles?.setAspect(aspect);
      applyQuality();
      if (staticMode) renderStatic();
      if (cssW !== prevW || !targetsReady) scheduleTargets();
    });
  };
  addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe(document.body);

  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  o.canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    stop();
    o.canvas.classList.remove('is-ready');
    root.dataset.scene = 'fallback';
  });

  if (o.debug) attachDebug();

  measure();
  bgUniforms.uAspect.value = aspect;
  particleCam.left = -aspect;
  particleCam.right = aspect;
  particleCam.updateProjectionMatrix();
  applyQuality();
  setMotion(!staticMode);

  function attachDebug() {
    const el = document.createElement('div');
    el.className = 'scene-debug';
    el.setAttribute('aria-hidden', 'true');
    document.body.append(el);
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown GPU';
    setInterval(() => {
      const lv = quality.current;
      const drawn = particles ? Math.floor(particles.count * lv.particles) : 0;
      el.textContent =
        `${tier.name} · level ${quality.level} · ${quality.fps.toFixed(0)} fps\n` +
        `dpr ${lv.dpr} · bg ${lv.bgScale} · ${drawn.toLocaleString()} particles\n` +
        `mood ${mood.shift.toFixed(2)}/${mood.intensity.toFixed(2)} · ${gpu.slice(0, 48)}`;
    }, 500);
  }

  return {
    stop,
    start,
    get fps() {
      return quality.fps;
    },
  };
}
