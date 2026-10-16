/** All effects use the turn presenter's clock; no independent animation loop. */
export interface DamageFeedbackFrame {
  elapsed: number;
  beforeHp: number;
  afterHp: number;
}

export interface TurnDamageFeedback {
  render(frame: DamageFeedbackFrame | null): void;
}

export const DAMAGE_FEEDBACK_TIMING = {
  hitStaggerMs: 460,
  durationMs: 520,
} as const;

const HEART = [
  '................', '..####....####..', '.######..######.',
  '.##############.', '.##############.', '.##############.',
  '..############..', '..############..', '...##########...',
  '....########....', '.....######.....', '......####......',
  '.......##.......', '................', '................',
  '................',
];

interface SavedHeart {
  node: HTMLElement;
  style: string | null;
  className: string | null;
  color: string;
}

/** Screen flash and individual pixel heart shatter, driven by render(elapsed). */
export class DamageFeedbackPresenter implements TurnDamageFeedback {
  private overlay: HTMLCanvasElement | null = null;
  private saved: SavedHeart[] = [];
  private signature = '';

  constructor(private readonly hearts: HTMLElement) {}

  render(frame: DamageFeedbackFrame | null): void {
    if (!frame || frame.elapsed < 0 || frame.beforeHp <= frame.afterHp) {
      this.clear();
      return;
    }
    const signature = `${frame.beforeHp}:${frame.afterHp}`;
    const children = Array.from(this.hearts.children).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    if (signature !== this.signature || children.some((node, i) => node !== this.saved[i]?.node)) {
      this.clear();
      this.signature = signature;
      this.saved = children.map((node) => ({
        node,
        style: node.getAttribute('style'),
        className: node.getAttribute('class'),
        color: getComputedStyle(node).color,
      }));
      this.overlay = document.createElement('canvas');
      this.overlay.setAttribute('aria-hidden', 'true');
      this.overlay.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:1000;image-rendering:pixelated;';
      document.body.append(this.overlay);
    }
    const overlay = this.overlay!;
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (overlay.width !== width || overlay.height !== height) {
      overlay.width = width;
      overlay.height = height;
    }
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
    const beforeHp = Math.min(this.saved.length, Math.max(0, Math.floor(frame.beforeHp)));
    const afterHp = Math.min(beforeHp, Math.max(0, Math.floor(frame.afterHp)));
    const loss = beforeHp - afterHp;
    // Flash begins on each actual hit. Keep the entire viewport visible underneath it.
    let flash = 0;
    for (let beat = 0; beat < loss; beat += 1) {
      const age = frame.elapsed - beat * DAMAGE_FEEDBACK_TIMING.hitStaggerMs;
      if (age >= 0 && age < 140) flash = Math.max(flash, 0.18 * (1 - age / 140));
    }
    if (flash > 0) {
      ctx.fillStyle = `rgba(244,88,96,${flash})`;
      ctx.fillRect(0, 0, width, height);
    }
    for (let beat = 0; beat < loss; beat += 1) {
      const heart = this.saved[beforeHp - beat - 1];
      if (!heart) continue;
      const age = frame.elapsed - beat * DAMAGE_FEEDBACK_TIMING.hitStaggerMs;
      const { node } = heart;
      // Restore the authored inline style before applying this clock sample.
      this.restoreStyle(heart);
      node.classList.toggle('lost', age >= 230);
      if (age >= 90 && age < 230) {
        const step = Math.floor((age - 90) / 22);
        const offset = [0, -3, 3, -2, 2, -1, 1][step % 7];
        node.style.transform = `translate(${offset}px,${step % 2 ? -1 : 1}px) rotate(${offset * 2}deg)`;
      }
      if (age >= 230 && age < DAMAGE_FEEDBACK_TIMING.durationMs) {
        const icon = node.querySelector('svg') ?? node;
        const rect = icon.getBoundingClientRect();
        this.drawShatter(ctx, rect, heart.color, (age - 230) / 290);
      }
    }
  }

  private drawShatter(ctx: CanvasRenderingContext2D, rect: DOMRect, color: string, progress: number): void {
    const unit = rect.width / 16;
    ctx.globalAlpha = Math.min(1, (1 - progress) * 1.7);
    ctx.fillStyle = color;
    // Sixteen rigid 4×4 chunks preserve the original heart's pixel silhouette.
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const dx = (col - 1.5) * rect.width * 1.7 * progress;
        const dy = (row - 1.6) * rect.height * 1.1 * progress + rect.height * 2 * progress * progress;
        const angle = ((col + row) % 2 ? 1 : -1) * progress * 1.25;
        const cx = (col * 4 + 2) * unit;
        const cy = (row * 4 + 2) * unit;
        ctx.save();
        ctx.translate(Math.round(rect.left + cx + dx), Math.round(rect.top + cy + dy));
        ctx.rotate(angle);
        for (let y = row * 4; y < row * 4 + 4; y += 1) {
          for (let x = col * 4; x < col * 4 + 4; x += 1) {
            if (HEART[y][x] !== '#') continue;
            ctx.fillRect(Math.round(x * unit - cx), Math.round(y * unit - cy), Math.ceil(unit), Math.ceil(unit));
          }
        }
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  private restoreStyle(heart: SavedHeart): void {
    if (heart.style === null) heart.node.removeAttribute('style');
    else heart.node.setAttribute('style', heart.style);
  }

  private clear(): void {
    this.overlay?.remove();
    this.overlay = null;
    for (const heart of this.saved) {
      this.restoreStyle(heart);
      if (heart.className === null) heart.node.removeAttribute('class');
      else heart.node.setAttribute('class', heart.className);
    }
    this.saved = [];
    this.signature = '';
  }
}
