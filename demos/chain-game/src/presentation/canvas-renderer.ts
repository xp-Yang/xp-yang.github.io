import {
  attackCells,
  getLevel,
  type Entity,
  type Point,
} from '../core';
import type { BoardView, GameRenderer } from './contracts';
import { GemVisual } from './gem-visual';
import { FruitVisual } from './fruit-visual';
import { GateVisual } from './gate-visual';
import {
  BOARD_SIDE_PADDING_CELLS,
  BOARD_TOP_CELLS,
  boardAspectRatio,
  exitGateBounds,
} from './board-geometry';
import { MOTION_TIMING, type MotionFrame, type EntityMotion } from './motion';
import { SamuraiVisual } from './samurai-visual';
import type { SamuraiFacing, SamuraiPose } from './samurai-sprites';

export class CanvasRenderer implements GameRenderer {
  private view: BoardView | null = null;
  private motion: MotionFrame | null = null;
  private ctx: CanvasRenderingContext2D;
  private cell = 1;
  private left = 0;
  private top = 0;
  private width = 0;
  private height = 0;
  private pixelRatio = 1;
  private facing: SamuraiFacing = 'right';
  private idleStartedAt = performance.now();
  private trailCapturedAt = 0;
  private readonly samurai = new SamuraiVisual();
  private readonly fruits = new FruitVisual();
  private readonly gems = new GemVisual();
  private readonly gate = new GateVisual();
  private fontReady = false;
  private spriteTrail: {
    pos: Point;
    sprite: SamuraiPose;
    capturedAt: number;
  }[] = [];
  readonly ready = Promise.all([
    this.samurai.ready,
    this.fruits.ready,
    this.gems.ready,
    this.gate.ready,
    document.fonts.load('12px "ChainPixel"').then(
      () => {
        this.fontReady = true;
      },
      () => {
        throw new Error('像素字体加载失败，请刷新重试。');
      },
    ),
  ]).then(() => this.paint());
  private inspectedThreatCells: readonly Point[] = [];
  private frameRequest = 0;
  private disposed = false;
  private readonly reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  );
  private readonly lifecycle = new AbortController();

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('此浏览器无法创建画布。');
    this.ctx = context;
    document.addEventListener(
      'visibilitychange',
      () => {
        this.stopLoop();
        this.paint();
      },
      { signal: this.lifecycle.signal },
    );
    this.reducedMotion.addEventListener(
      'change',
      () => {
        this.stopLoop();
        this.paint();
      },
      { signal: this.lifecycle.signal },
    );
  }

  get assetsReady(): boolean {
    return (
      this.samurai.loaded && this.fruits.loaded &&
      this.gems.loaded && this.gate.loaded && this.fontReady
    );
  }

  get playerFacing(): SamuraiFacing {
    return this.facing;
  }

  render(view: BoardView): void {
    this.view = view;
    const inspected = view.inspectedEntityId
      ? view.state.entities[view.inspectedEntityId]
      : undefined;
    this.inspectedThreatCells =
      inspected?.kind === 'creep' && inspected.mood === 'angry'
        ? attackCells({
            ...view.state,
            entities: { [inspected.id]: inspected },
          })
        : [];
    const level = getLevel(view.state.levelId);
    this.canvas.style.aspectRatio = String(
      boardAspectRatio(level.width, level.height),
    );
    const position =
      view.state.status === 'escaped'
        ? '已从出口撤离。'
        : `当前位置第 ${view.state.player.pos.y + 1} 行、第 ${view.state.player.pos.x + 1} 列。`;
    this.canvas.setAttribute(
      'aria-label',
      `${level.name}，${level.height} 行 ${level.width} 列。按住鼠标或手指连线，松开后点击执行。${position}`,
    );
    this.resize();
  }

  /** Visual frames never replace the authoritative rules state or hit-test data. */
  setAnimation(frame: MotionFrame | null): void {
    const now = performance.now();
    const previous = this.motion;
    if (
      frame?.phase === 'route' &&
      previous?.phase === 'route' &&
      frame.routeProgress > previous.routeProgress &&
      !this.reducedMotion.matches
    ) {
      if (now - this.trailCapturedAt >= 38) {
        this.spriteTrail.push({
          pos: previous.player.pos,
          sprite: previous.player.sprite,
          capturedAt: now,
        });
        this.trailCapturedAt = now;
      }
      this.spriteTrail = this.spriteTrail
        .filter((sample) => now - sample.capturedAt < 155)
        .slice(-4);
    } else this.spriteTrail = [];
    if (frame) this.facing = frame.player.sprite.facing;
    else this.idleStartedAt = now;
    this.motion = frame;
    this.stopLoop();
    this.paint();
  }

  resize(): void {
    if (!this.view || this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    this.pixelRatio = ratio;
    const width = Math.round(rect.width * ratio),
      height = Math.round(rect.height * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.width = rect.width;
    this.height = rect.height;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    const level = getLevel(this.view.state.levelId);
    this.cell = rect.width / (level.width + BOARD_SIDE_PADDING_CELLS * 2);
    this.left = this.cell * BOARD_SIDE_PADDING_CELLS;
    this.top = this.cell * BOARD_TOP_CELLS;
    this.paint();
  }

  private center(point: Point): Point {
    return {
      x: this.left + (point.x + 0.5) * this.cell,
      y: this.top + (point.y + 0.5) * this.cell,
    };
  }

  hitTest(clientX: number, clientY: number): string | null {
    if (!this.view || this.motion) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left,
      y = clientY - rect.top;
    const { state } = this.view;
    const level = getLevel(state.levelId);
    const gate = exitGateBounds(this.center(level.exit.pos), this.cell);
    if (
      x >= gate.x && x <= gate.x + gate.width &&
      y >= gate.y && y <= gate.y + gate.height
    )
      return 'exit';
    const pos = {
      x: Math.floor((x - this.left) / this.cell),
      y: Math.floor((y - this.top) / this.cell),
    };
    if (pos.x < 0 || pos.y < 0 || pos.x >= level.width || pos.y >= level.height)
      return null;
    const center = this.center(pos);
    if (
      Math.abs(x - center.x) > this.cell * 0.38 ||
      Math.abs(y - center.y) > this.cell * 0.38
    )
      return null;
    if (state.player.pos.x === pos.x && state.player.pos.y === pos.y)
      return 'player';
    return (
      Object.values(state.entities).find(
        (entity) => entity.pos.x === pos.x && entity.pos.y === pos.y,
      )?.id ?? null
    );
  }

  private stopLoop(): void {
    if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
  }

  private paint(time = performance.now()): void {
    if (!this.view || this.disposed || document.hidden) return;
    this.draw(time);
    // Turn playback owns its clock; idle guidance shares the preview clock.
    if (
      !this.motion &&
      ((this.samurai.loaded && this.view.state.status === 'playing') ||
        this.view.path.length ||
        this.inspectedThreatCells.length ||
        this.view.tutorial?.cells.length ||
        this.view.tutorial?.route.length) &&
      !this.reducedMotion.matches
    ) {
      if (!this.frameRequest)
        this.frameRequest = requestAnimationFrame((now) => {
          this.frameRequest = 0;
          this.paint(now);
        });
    } else this.stopLoop();
  }

  private rect(
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    stroke?: string,
    lineWidth = 1,
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.rect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(2, Math.round(lineWidth / 2) * 2);
      ctx.stroke();
    }
  }

  private label(
    text: string,
    point: Point,
    size: number,
    color: string,
  ): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    const fontSize = Math.max(12, Math.round(size / 12) * 12);
    ctx.font = `${fontSize}px "ChainPixel", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, Math.round(point.x), Math.round(point.y));
  }

  private corners(x: number, y: number, size: number, color: string): void {
    const ctx = this.ctx;
    const edge = Math.round(size / 2);
    const unit = Math.max(1, Math.round(this.cell / 40));
    const length = Math.max(unit * 3, Math.round(size * 0.2));
    ctx.fillStyle = color;
    for (const dx of [-edge, edge - unit])
      for (const dy of [-edge, edge - unit]) {
        const left = dx < 0 ? dx : dx - length + unit;
        const top = dy < 0 ? dy : dy - length + unit;
        ctx.fillRect(Math.round(x + left), Math.round(y + dy), length, unit);
        ctx.fillRect(Math.round(x + dx), Math.round(y + top), unit, length);
      }
  }

  private withEntity(
    entity: Entity,
    transform: EntityMotion | undefined,
    draw: () => void,
  ): void {
    const ctx = this.ctx,
      c = this.cell;
    ctx.save();
    // Spawned pieces enter their own gravity segment, never through a gem/player.
    if (
      transform?.clipTop !== undefined &&
      transform.clipBottom !== undefined
    ) {
      const top = this.center({ x: 0, y: transform.clipTop }).y;
      const bottom = this.center({ x: 0, y: transform.clipBottom }).y;
      ctx.beginPath();
      ctx.rect(this.left - c * 0.1, top, this.width, bottom - top);
      ctx.clip();
    }
    const p = this.center(transform?.pos ?? entity.pos);
    ctx.translate(p.x, p.y);
    ctx.rotate(transform?.rotation ?? 0);
    ctx.scale(transform?.scaleX ?? 1, transform?.scaleY ?? 1);
    ctx.globalAlpha = transform?.alpha ?? 1;
    draw();
    ctx.restore();
  }

  private drawEntityBody(entity: Entity, selected: boolean): void {
    const c = this.cell;
    if (entity.kind === 'creep') {
      this.fruits.draw(this.ctx, entity.color, c);
      if (selected || entity.mood === 'angry') {
        this.corners(0, 0, c * 0.8, selected ? '#e5f1d5' : '#f0837c');
      }
    } else this.gems.drawCluster(this.ctx, c, entity.value, selected);
  }

  private drawEntityLabel(entity: Entity, index: number): void {
    const c = this.cell;
    if (index >= 0) {
      const size = Math.max(16, Math.round(c * 0.3));
      this.rect(-size / 2, -size / 2, size, size, '#17253a', '#8ba17a');
      this.label(String(index + 1), { x: 0, y: 0 }, c * 0.18, '#f5ffdf');
    }
    if (entity.kind === 'creep' && entity.mood === 'angry') {
      const p = { x: c * 0.27, y: -c * 0.26 };
      const size = Math.max(12, Math.round(c * 0.24));
      this.rect(p.x - size / 2, p.y - size / 2, size, size, '#873f49', '#f09c87');
      this.label('!', p, c * 0.17, '#fff0da');
    }
  }

  private drawRoute(
    points: readonly Point[],
    time: number,
    consumed = 0,
  ): void {
    if (points.length < 2) return;
    const ctx = this.ctx,
      c = this.cell;
    const segments: {
      from: Point;
      to: Point;
      start: number;
      length: number;
    }[] = [];
    let total = 0;
    for (let index = 1; index < points.length; index++) {
      const length = Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].y - points[index - 1].y,
      );
      if (!length) continue;
      segments.push({
        from: points[index - 1],
        to: points[index],
        start: total,
        length,
      });
      total += length;
    }
    if (consumed >= total) return;
    const at = (distance: number) => {
      const segment =
        segments.find((item) => distance <= item.start + item.length) ??
        segments[segments.length - 1];
      const t = Math.max(
        0,
        Math.min(1, (distance - segment.start) / segment.length),
      );
      const pos = this.center({
        x: segment.from.x + (segment.to.x - segment.from.x) * t,
        y: segment.from.y + (segment.to.y - segment.from.y) * t,
      });
      return {
        ...pos,
        angle: Math.atan2(
          segment.to.y - segment.from.y,
          segment.to.x - segment.from.x,
        ),
      };
    };
    const start = at(consumed);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (const segment of segments)
      if (segment.start + segment.length > consumed) {
        const p = this.center(segment.to);
        ctx.lineTo(p.x, p.y);
      }
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.lineWidth = c * 0.11;
    ctx.strokeStyle = '#10272bbf';
    ctx.stroke();
    ctx.lineWidth = c * 0.025;
    ctx.strokeStyle = '#effbd5d9';
    ctx.stroke();
    // Repeating chevrons travel continuously toward the endpoint along arc length.
    const spacing = MOTION_TIMING.routeSpacing;
    const offset = this.reducedMotion.matches
      ? 0.24
      : ((time / 1000) * MOTION_TIMING.routeSpeed) % spacing;
    let distance = Math.ceil((consumed - offset) / spacing) * spacing + offset;
    ctx.lineWidth = c * 0.047;
    ctx.strokeStyle = '#f3ffd3';
    for (; distance < total - 0.07; distance += spacing) {
      if (distance < consumed + 0.06) continue;
      const p = at(distance);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.beginPath();
      ctx.moveTo(-c * 0.075, -c * 0.065);
      ctx.lineTo(c * 0.018, 0);
      ctx.lineTo(-c * 0.075, c * 0.065);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawInspectedThreats(time: number): void {
    if (!this.inspectedThreatCells.length) return;
    const ctx = this.ctx,
      c = this.cell;
    ctx.save();
    // A slow breath keeps the inspected range legible without rapid flashing.
    ctx.globalAlpha = this.reducedMotion.matches
      ? 1
      : 0.4 + 0.6 * (0.5 + 0.5 * Math.cos((time / 1100) * Math.PI * 2));
    for (const pos of this.inspectedThreatCells) {
      const p = this.center(pos);
      this.rect(
        p.x - c * 0.43,
        p.y - c * 0.43,
        c * 0.86,
        c * 0.86,
        '#ff4e4910',
        '#ff4e49',
        Math.max(2, c * 0.035),
      );
    }
    ctx.restore();
  }

  private drawTutorial(time: number): void {
    const guidance = this.view?.tutorial;
    if (!guidance) return;
    const ctx = this.ctx,
      c = this.cell;
    const pulse = this.reducedMotion.matches
      ? 1
      : 0.7 + 0.3 * Math.sin((time / 1600) * Math.PI * 2);
    ctx.save();
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    for (const pos of guidance.cells) {
      const p = this.center(pos);
      this.corners(p.x, p.y, c * 0.86, `rgba(255, 224, 146, ${pulse})`);
    }
    if (guidance.route.length > 1) {
      ctx.beginPath();
      const lengths: number[] = [];
      let total = 0;
      guidance.route.forEach((pos, index) => {
        const p = this.center(pos);
        if (index === 0) ctx.moveTo(p.x, p.y);
        else {
          ctx.lineTo(p.x, p.y);
          const previous = guidance.route[index - 1];
          total += Math.hypot(pos.x - previous.x, pos.y - previous.y);
          lengths.push(total);
        }
      });
      ctx.setLineDash([c * 0.025, c * 0.105]);
      ctx.strokeStyle = '#ffe092ba';
      ctx.lineWidth = Math.max(2, c * 0.037);
      ctx.stroke();
      ctx.setLineDash([]);
      if (total > 0) {
        // This dot demonstrates the drag without selecting any game nodes.
        const distance = this.reducedMotion.matches
          ? total
          : ((time / 1000) * 2.2) % total;
        const index = Math.max(
          0,
          lengths.findIndex((end) => end >= distance),
        );
        const from = guidance.route[index];
        const to = guidance.route[index + 1];
        const start = index === 0 ? 0 : lengths[index - 1];
        const progress = (distance - start) / (lengths[index] - start || 1);
        const p = this.center({
          x: from.x + (to.x - from.x) * progress,
          y: from.y + (to.y - from.y) * progress,
        });
        const size = Math.max(4, Math.round(c * 0.12));
        this.rect(p.x - size / 2, p.y - size / 2, size, size, '#ffe092', '#26352d');
      }
    }
    ctx.restore();
  }

  private draw(time: number): void {
    const view = this.view!,
      motion = this.motion;
    const state = motion?.state ?? view.state;
    const path = motion ? [] : view.path;
    const level = getLevel(state.levelId),
      ctx = this.ctx,
      c = this.cell;
    ctx.clearRect(0, 0, this.width, this.height);
    this.gate.draw(ctx, this.center(level.exit.pos), c, state.exitUnlocked);
    const entities = Object.values(state.entities);
    for (const entity of entities.filter((item) => item.kind === 'creep'))
      this.withEntity(entity, motion?.entities[entity.id], () =>
        this.drawEntityBody(entity, path.includes(entity.id)),
      );
    if (motion) {
      for (const burst of motion.fruitBursts) {
        const p = this.center(burst.entity.pos);
        ctx.save();
        ctx.translate(p.x, p.y);
        this.fruits.drawBurst(ctx, burst.entity.color, c, burst);
        ctx.restore();
      }
    }
    // A falling gem stays in front of the pieces it just crushed.
    for (const entity of entities.filter((item) => item.kind === 'gem'))
      this.withEntity(entity, motion?.entities[entity.id], () =>
        this.drawEntityBody(entity, path.includes(entity.id)),
      );
    const route = motion?.route ?? [
      state.player.pos,
      ...path
        .map((id) => (id === 'exit' ? level.exit.pos : state.entities[id]?.pos))
        .filter((pos): pos is Point => Boolean(pos)),
    ];
    this.drawRoute(route, time, motion?.routeProgress ?? 0);
    for (const entity of entities)
      this.withEntity(entity, motion?.entities[entity.id], () =>
        this.drawEntityLabel(entity, path.indexOf(entity.id)),
      );
    if (motion) {
      for (const cut of motion.fruitCuts) {
        const p = this.center(cut.entity.pos);
        ctx.save();
        ctx.translate(p.x, p.y);
        this.fruits.drawCut(ctx, cut.entity.color, c, cut);
        ctx.restore();
      }
      for (const impact of motion.impacts) {
        const p = this.center(impact.pos);
        ctx.save();
        ctx.globalAlpha = impact.alpha;
        ctx.strokeStyle = impact.color;
        ctx.lineWidth = c * 0.055;
        ctx.beginPath();
        ctx.rect(
          p.x - impact.radius * c, p.y - impact.radius * c,
          impact.radius * c * 2, impact.radius * c * 2,
        );
        ctx.stroke();
        ctx.restore();
      }
      for (const particle of motion.particles) {
        const p = this.center(particle.pos);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(particle.rotation);
        ctx.globalAlpha = particle.alpha;
        const size = particle.size * c;
        this.rect(
          -size / 2,
          -size / 2,
          size,
          size,
          particle.color,
        );
        ctx.restore();
      }
      for (const sample of this.spriteTrail) {
        const alpha = 0.15 * Math.max(0, 1 - (time - sample.capturedAt) / 155);
        this.samurai.draw(
          ctx,
          this.center(sample.pos),
          c,
          this.pixelRatio,
          sample.sprite,
          alpha,
        );
      }
    }
    if (motion ? motion.player.alpha > 0 : state.status !== 'escaped') {
      const p = this.center(motion?.player.pos ?? state.player.pos);
      const sprite: SamuraiPose = motion?.player.sprite ?? {
        clip: 'idle',
        elapsedMs: this.reducedMotion.matches ? 0 : time - this.idleStartedAt,
        facing: this.facing,
      };
      this.samurai.draw(
        ctx,
        p,
        c,
        this.pixelRatio,
        sprite,
        motion?.player.alpha ?? 1,
      );
    }
    if (!motion && view.preview.valid && path.length && !view.preview.exits) {
      const p = this.center(view.preview.endpoint);
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x - c * 0.44, p.y - c * 0.44, c * 0.88, c * 0.88);
      ctx.lineWidth = 2;
      ctx.strokeStyle = view.preview.damage ? '#ff654d' : '#f4ffdb';
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = this.reducedMotion.matches ? 0 : -time * 0.012;
      ctx.stroke();
      ctx.restore();
    }
    if (!motion) {
      this.drawTutorial(time);
      // Danger remains the topmost overlay when it overlaps tutorial guidance.
      this.drawInspectedThreats(time);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopLoop();
    this.lifecycle.abort();
    this.view = null;
    this.motion = null;
    this.spriteTrail = [];
    this.inspectedThreatCells = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
