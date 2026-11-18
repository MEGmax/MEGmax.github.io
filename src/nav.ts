import type { Scroller } from './scroll';

/**
 * Floating pill nav:
 * - smooth anchor scrolling (through Lenis when it's on) for every in-page link
 * - active-section highlight and URL hash updates as you scroll
 * - scroll-progress line
 * - collapsible menu on narrow screens (Escape / outside click closes it)
 */
export function initNav(scroller: Scroller): void {
  const nav = document.querySelector<HTMLElement>('[data-nav]');
  const toggle = nav?.querySelector<HTMLButtonElement>('.nav-toggle');
  const links = [...(nav?.querySelectorAll<HTMLAnchorElement>('.nav-links a[href^="#"]') ?? [])];
  if (!nav || !toggle) return;

  // ---- Mobile menu --------------------------------------------------------
  const setOpen = (open: boolean, returnFocus = false) => {
    nav.toggleAttribute('data-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (!open && returnFocus) toggle.focus();
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.hasAttribute('data-open')) setOpen(false, true);
  });
  document.addEventListener('pointerdown', (e) => {
    if (nav.hasAttribute('data-open') && !nav.contains(e.target as Node)) setOpen(false);
  });
  matchMedia('(min-width: 901px)').addEventListener('change', (e) => e.matches && setOpen(false));

  // ---- Anchor links -------------------------------------------------------
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!a) return;
    const id = decodeURIComponent(a.hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    e.preventDefault();
    setOpen(false);
    scroller.scrollTo(target, () => target.focus({ preventScroll: true }));
  });

  // ---- Active section + hash ---------------------------------------------
  const ids = ['intro', ...links.map((a) => a.hash.slice(1))];
  const sections = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
  let active = '';
  let hashSync = false; // don't rewrite the hash until the first scroll, so deep links aren't clobbered on load

  const setActive = (id: string) => {
    if (id === active) return;
    active = id;
    for (const a of links) {
      if (a.hash === `#${id}`) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
    if (hashSync) {
      const url = id === 'intro' ? location.pathname + location.search : `#${id}`;
      history.replaceState(history.state, '', url);
    }
  };

  // A zero-height band across the middle of the viewport: whichever section crosses it is active.
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
    },
    { rootMargin: '-50% 0px -50% 0px', threshold: 0 },
  );
  sections.forEach((s) => io.observe(s));

  // ---- Scroll progress ----------------------------------------------------
  let ticking = false;
  const updateProgress = () => {
    ticking = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    nav.style.setProperty('--progress', p.toFixed(4));
  };
  addEventListener(
    'scroll',
    () => {
      hashSync = true;
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(updateProgress);
      }
    },
    { passive: true },
  );
  addEventListener('resize', updateProgress, { passive: true });
  updateProgress();
}
