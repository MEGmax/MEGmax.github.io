/**
 * Single source of truth for colour.
 *
 * - `vite.config.ts` injects these values into index.html as CSS custom
 *   properties (`--c-cyan`, `--c-cyan-rgb`, ...) at build time, so the first
 *   paint is styled before any JavaScript runs.
 * - The WebGL scene imports the same values as shader uniforms.
 */
export const palette = {
  base: '#04050c', // deep-space near-black
  night: '#0b0d22', // indigo haze
  ink: '#f3f5ff', // primary text
  inkMuted: '#b4bad4', // secondary text (AA on base and on glass)
  cyan: '#38e1ff',
  violet: '#8a63ff',
  magenta: '#ff4fd1',
} as const;

/**
 * Each section has a "mood": how the background and particles behave while it
 * is on screen. The scene blends between neighbouring moods as you scroll.
 * `shift` rotates along the cyclic cyan → violet → magenta ramp.
 */
export interface Mood {
  id: string;
  shift: number;
  intensity: number;
  speed: number;
  warp: number;
  particles: number;
  blobs: number;
}

export const moods: Mood[] = [
  { id: 'intro', shift: 0.0, intensity: 1.0, speed: 1.0, warp: 4.0, particles: 1.0, blobs: 1.0 },
  { id: 'about', shift: 0.12, intensity: 0.8, speed: 0.75, warp: 3.6, particles: 0.75, blobs: 0.6 },
  { id: 'experience', shift: 0.95, intensity: 0.7, speed: 0.65, warp: 3.2, particles: 0.6, blobs: 0.45 },
  { id: 'projects', shift: 0.3, intensity: 0.9, speed: 0.9, warp: 4.4, particles: 0.85, blobs: 0.8 },
  { id: 'skills', shift: 0.45, intensity: 0.75, speed: 0.7, warp: 3.8, particles: 0.7, blobs: 0.5 },
  { id: 'education', shift: 0.2, intensity: 0.65, speed: 0.55, warp: 3.0, particles: 0.55, blobs: 0.4 },
  { id: 'recent-projects', shift: 0.6, intensity: 0.7, speed: 0.6, warp: 3.4, particles: 0.6, blobs: 0.5 },
  { id: 'contact', shift: 0.1, intensity: 0.45, speed: 0.22, warp: 2.4, particles: 0.3, blobs: 0.25 },
];

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexToVec3(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** `:root { --c-*: #hex; --c-*-rgb: r g b; ... }` for index.html. */
export function cssVariables(): string {
  const vars = Object.entries(palette).map(([key, hex]) => {
    const [r, g, b] = hexToRgb(hex);
    return `--c-${kebab(key)}:${hex};--c-${kebab(key)}-rgb:${r} ${g} ${b};`;
  });
  const accent = `linear-gradient(90deg,${palette.cyan},${palette.violet} 50%,${palette.magenta})`;
  return `:root{${vars.join('')}--grad-accent:${accent};}`;
}
