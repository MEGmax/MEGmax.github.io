import { initNav } from './nav';
import { initSmoothScroll } from './scroll';

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

const scroller = initSmoothScroll(reduceMotion.matches);
initNav(scroller);

// ---- Background scene ------------------------------------------------------
// The hero is plain HTML/CSS and paints immediately. Three.js and the shaders
// are a separate chunk, fetched once the page has loaded and the main thread
// is idle.

function hasWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

function useFallback() {
  root.dataset.scene = 'fallback';
}

function loadScene() {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  if (!canvas || !hasWebGL2()) return useFallback();

  import('./scene')
    .then(({ startScene }) =>
      startScene({
        canvas,
        nameEl: document.getElementById('hero-name'),
        heroEl: document.getElementById('intro'),
        sectionEls: [...document.querySelectorAll<HTMLElement>('main > section[id]')],
        reduceMotion,
        debug: new URLSearchParams(location.search).has('debug'),
      }),
    )
    .catch(useFallback);
}

const whenIdle = (cb: () => void) =>
  'requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 1200 }) : setTimeout(cb, 150);

if (document.readyState === 'complete') whenIdle(loadScene);
else addEventListener('load', () => whenIdle(loadScene), { once: true });
