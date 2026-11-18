export interface QualityLevel {
  /** Device pixel ratio for the canvas (particles + composite). */
  dpr: number;
  /** Background render-target size as a fraction of CSS pixels. */
  bgScale: number;
  /** Fraction of the particle pool that is drawn. */
  particles: number;
}

/**
 * Watches frame times and steps quality down (DPR, background resolution,
 * particle count) when the page can't hold ~50fps for two seconds in a row.
 * It uses the median frame of each one-second window, so one-off hitches
 * (GC, tab switches, screenshots) don't count, only sustained slowness.
 * It only steps down, so it can't oscillate.
 */
export class AdaptiveQuality {
  level = 0;
  fps = 0;
  private samples: number[] = [];
  private elapsed = 0;
  private slowWindows = 0;
  private holdUntil = 0;

  constructor(
    readonly levels: QualityLevel[],
    private readonly onChange: () => void,
    private readonly budgetMs = 1000 / 50,
  ) {}

  get current(): QualityLevel {
    return this.levels[this.level];
  }

  /** Ignore the next stretch of frames (start-up, shader compiles, returning to the tab). */
  hold(now: number, ms = 2000): void {
    this.samples = [];
    this.elapsed = 0;
    this.slowWindows = 0;
    this.holdUntil = now + ms;
  }

  tick(now: number, frameMs: number): void {
    if (now < this.holdUntil) return;
    this.samples.push(frameMs);
    this.elapsed += frameMs;
    if (this.elapsed < 1000) return;

    const sorted = this.samples.sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.fps = 1000 / median;
    this.samples = [];
    this.elapsed = 0;
    this.slowWindows = median > this.budgetMs ? this.slowWindows + 1 : 0;

    if (this.slowWindows >= 2 && this.level < this.levels.length - 1) {
      this.level++;
      this.hold(now, 1500);
      this.onChange();
    }
  }
}
