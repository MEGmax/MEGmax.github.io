import Lenis from 'lenis';

export interface Scroller {
  lenis: Lenis | null;
  scrollTo(target: HTMLElement, onDone?: () => void): void;
}

/**
 * Smooth scrolling through Lenis. With reduced motion, Lenis isn't created and
 * jumps are instant.
 */
export function initSmoothScroll(reduced: boolean): Scroller {
  if (reduced) {
    return {
      lenis: null,
      scrollTo(target, onDone) {
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
        onDone?.();
      },
    };
  }

  const lenis = new Lenis({ autoRaf: true, lerp: 0.09, wheelMultiplier: 0.95 });

  return {
    lenis,
    scrollTo(target, onDone) {
      lenis.scrollTo(target, {
        duration: 1.5,
        easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
        onComplete: () => onDone?.(),
      });
    },
  };
}
