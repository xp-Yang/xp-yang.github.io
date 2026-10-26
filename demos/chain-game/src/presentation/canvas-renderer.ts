import {
  attackCells,
  getRunLevel,
  isElite,
  samePoint,
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
import {
  SAMURAI_GROUND_OFFSET_CELLS,
  type SamuraiFacing,
  type SamuraiPose,
} from './samurai-sprites';
import {
  LEVEL_ENTRY_TIMING,
  type LevelEntryFrame,
  type LevelEntrySink,
} from './level-entry-presenter';

export class CanvasRenderer implements GameRenderer, LevelEntrySink {
  private view: BoardView | null = null;
  private motion: MotionFrame | null = null;
  private levelEntry: LevelEntryFrame | null = null;
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
  private endpointNumber: { count: number; image: HTMLCanvasElement } | null = null;
  private entryCard: { key: string; image: HTMLCanvasElement } | null = null;
  private gateTransition: {
    runId: string;
    from: number;
    to: number;
    startedAt: number;
  } | null = null;
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
    const level = getRunLevel(view.state);
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

  setLevelEntry(frame: LevelEntryFrame | null): void {
    this.levelEntry = frame;
    if (frame) this.spriteTrail = [];
    else this.idleStartedAt = performance.now();
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
    const level = getRunLevel(this.view.state);
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
    if (!this.view || this.motion || this.levelEntry) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left,
      y = clientY - rect.top;
    const { state } = this.view;
    const level = getRunLevel(state);
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

  private gateProgress(runId: string, open: boolean, time: number): number {
    const target = open ? 1 : 0;
    let transition = this.gateTransition;
    // A new run starts with its own lock; previewing never updates saved state.
    if (!transition || transition.runId !== runId || this.reducedMotion.matches) {
      transition = { runId, from: target, to: target, startedAt: time };
      this.gateTransition = transition;
    }
    const duration = Math.abs(transition.to - transition.from) * 320;
    const t = duration ? Math.min(1, Math.max(0, (time - transition.startedAt) / duration)) : 1;
    const current = transition.from + (transition.to - transition.from) * t;
    if (transition.to !== target) {
      // Reverse from the displayed pose, including a quick in/out drag.
      transition.from = current;
      transition.to = target;
      transition.startedAt = time;
    }
    return current;
  }

  private paint(time = performance.now()): void {
    if (!this.view || this.disposed || document.hidden) return;
    this.draw(time);
    // Turn playback owns its clock; idle guidance shares the preview clock.
    if (
      !this.motion && !this.levelEntry &&
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
      if (entity.mood === 'angry') {
        this.corners(0, 0, c * 0.8,
          isElite(entity) ? '#ffc975' : '#f0837c');
      }
      if (isElite(entity)) {
        // A tiny native-pixel crown keeps the existing fruit art recognizable.
        const unit = Math.max(1, Math.round(c / 32));
        const crown = ['#...#...#', '##.###.##', '.#######.', '.#######.'];
        const x = Math.round(-4.5 * unit), y = Math.round(-c * 0.54);
        this.ctx.fillStyle = '#ffe08a';
        crown.forEach((row, dy) => {
          for (let dx = 0; dx < row.length; dx += 1)
            if (row[dx] === '#') this.ctx.fillRect(x + dx * unit, y + dy * unit, unit, unit);
        });
      }
    } else this.gems.drawCluster(this.ctx, c, entity.value, selected);
  }

  private drawEntityLabel(entity: Entity): void {
    const c = this.cell;
    if (entity.kind === 'creep' && entity.mood === 'angry') {
      const p = { x: c * 0.27, y: -c * 0.26 };
      const size = Math.max(12, Math.round(c * 0.24));
      const elite = isElite(entity);
      const width = elite ? Math.max(22, size * 1.5) : size;
      this.rect(p.x - width / 2, p.y - size / 2, width, size,
        '#873f49', elite ? '#ffe08a' : '#f09c87');
      const required = getRunLevel(this.view!.state).elite?.minChain ?? 10;
      this.label(elite ? String(required) : '!', p, c * 0.17,
        elite ? '#ffe08a' : '#fff0da');
    }
  }

  private drawEndpointCount(point: Point, count: number, headroom = 0.44): void {
    if (!this.fontReady || count < 0) return;
    if (this.endpointNumber?.count !== count) {
      // Rasterize at the font's native size, then scale whole pixels. The
      // outline is also built from native pixels, without a smooth text stroke.
      const source = document.createElement('canvas');
      const context = source.getContext('2d');
      if (!context) return;
      const text = String(count);
      context.font = '12px "ChainPixel"';
      source.width = Math.ceil(context.measureText(text).width) + 8;
      source.height = 24;
      context.font = '12px "ChainPixel"';
      context.textBaseline = 'top';
      context.fillStyle = '#09101d';
      for (let y = -2; y <= 3; y += 1)
        for (let x = -2; x <= 3; x += 1)
          context.fillText(text, 3 + x, 3 + y);
      context.fillStyle = '#fff4d9';
      for (let y = -1; y <= 1; y += 1)
        for (let x = -1; x <= 1; x += 1)
          context.fillText(text, 3 + x, 3 + y);
      context.fillStyle = '#ef544b';
      context.fillText(text, 3, 3);

      // Crop transparent font margins so placement follows the visible digits.
      const pixels = context.getImageData(0, 0, source.width, source.height).data;
      let left = source.width, top = source.height, right = -1, bottom = -1;
      for (let y = 0; y < source.height; y += 1)
        for (let x = 0; x < source.width; x += 1)
          if (pixels[(y * source.width + x) * 4 + 3]) {
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
      if (right < left) return;
      const image = document.createElement('canvas');
      image.width = right - left + 1;
      image.height = bottom - top + 1;
      const cropped = image.getContext('2d');
      if (!cropped) return;
      cropped.drawImage(source, left, top, image.width, image.height,
        0, 0, image.width, image.height);
      this.endpointNumber = { count, image };
    }
    const image = this.endpointNumber.image;
    const scale = Math.max(1, Math.round(this.cell * 0.75 / image.height));
    const width = image.width * scale, height = image.height * scale;
    const p = this.center(point);
    const x = Math.max(1, Math.min(this.width - width - 1, p.x - width / 2));
    const y = Math.max(1, p.y - this.cell * headroom - height);
    this.ctx.save();
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(image, Math.round(x), Math.round(y), width, height);
    this.ctx.restore();
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

  private createEntryCard(levelNumber: number, goal: number): HTMLCanvasElement | null {
    // The entire sign is rasterized in native pixels, including the bevel,
    // lettering and skull. It travels as one object instead of fading labels.
    const image = document.createElement('canvas');
    image.width = 128;
    image.height = 88;
    const context = image.getContext('2d');
    if (!context) return null;
    const fill = (x: number, y: number, w: number, h: number, color: string) => {
      context.fillStyle = color;
      context.fillRect(x, y, w, h);
    };
    fill(4, 4, 124, 84, '#060b13');
    fill(0, 0, 124, 84, '#070e1a');
    fill(2, 2, 120, 80, '#586e8a');
    fill(4, 4, 116, 76, '#1c2b43');
    fill(4, 4, 116, 2, '#92a8bf');
    fill(4, 4, 2, 76, '#92a8bf');
    fill(6, 78, 114, 2, '#101a2b');
    fill(118, 6, 2, 74, '#101a2b');
    context.font = '12px "ChainPixel"';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = '#07101d';
    context.fillText(`关卡 ${levelNumber}`, 63, 16);
    context.fillStyle = '#fff0ba';
    context.fillText(`关卡 ${levelNumber}`, 62, 15);
    fill(18, 34, 88, 1, '#5d728d');
    fill(18, 35, 88, 1, '#0e192a');

    // This small pixel skull uses the same visual language as the HUD target.
    const skull = [
      '..########..', '.##########.', '############',
      '###..##..###', '###..##..###', '#####..#####',
      '.##########.', '..#.####.#..', '..#.####.#..',
      '..########..',
    ];
    const number = String(goal);
    context.font = '24px "ChainPixel"';
    const numberWidth = context.measureText(number).width;
    const rowWidth = 24 + 10 + numberWidth;
    const left = Math.round((124 - rowWidth) / 2);
    context.fillStyle = '#d9edaf';
    skull.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1)
        if (row[x] === '#') context.fillRect(left + x * 2, 49 + y * 2, 2, 2);
    });
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillStyle = '#07101d';
    context.fillText(number, left + 35, 60);
    context.fillStyle = '#f2f6da';
    context.fillText(number, left + 34, 59);
    return image;
  }

  private drawLevelEntry(frame: LevelEntryFrame): void {
    const ctx = this.ctx, c = this.cell;
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    const veil = 0.75 * (1 - clamp(frame.elapsed / 180));
    if (veil > 0) {
      ctx.save();
      ctx.globalAlpha = veil;
      ctx.fillStyle = '#080d19';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }
    if (!this.fontReady || frame.elapsed < LEVEL_ENTRY_TIMING.titleEnterAt) return;
    const key = `${frame.levelNumber}:${frame.goal}`;
    if (this.entryCard?.key !== key) {
      const image = this.createEntryCard(frame.levelNumber, frame.goal);
      if (!image) return;
      this.entryCard = { key, image };
    }
    const image = this.entryCard.image;
    const scale = Math.max(1, Math.min(
      Math.round(c * 4.4 / image.width),
      Math.floor(this.width * 0.9 / image.width),
    ));
    const width = image.width * scale, height = image.height * scale;
    const progress = clamp((frame.elapsed - LEVEL_ENTRY_TIMING.titleEnterAt) /
      LEVEL_ENTRY_TIMING.titleDropMs);
    const t = progress - 1;
    const eased = 1 + 2.70158 * t ** 3 + 1.70158 * t ** 2;
    const fromY = -height - c * 0.25;
    const centerY = (this.height - height) / 2;
    const leave = clamp((frame.elapsed - LEVEL_ENTRY_TIMING.titleLeaveAt) /
      LEVEL_ENTRY_TIMING.titleLeaveMs);
    const y = leave > 0
      ? centerY + (this.height + c * 0.25 - centerY) * leave ** 2
      : fromY + (centerY - fromY) * eased;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, Math.round((this.width - width) / 2), Math.round(y), width, height);
    ctx.restore();
  }

  private draw(time: number): void {
    const view = this.view!,
      motion = this.motion,
      entry = this.levelEntry;
    const state = motion?.state ?? view.state;
    const path = motion || entry ? [] : view.path;
    const level = getRunLevel(state),
      ctx = this.ctx,
      c = this.cell;
    ctx.clearRect(0, 0, this.width, this.height);
    const routeEndsAtGate = motion
      ? motion.route.length > 0 && samePoint(motion.route[motion.route.length - 1], level.exit.pos)
      : !entry && !view.teleportSelecting && view.preview.valid && view.preview.exits;
    const gateOpen = state.exitUnlocked || routeEndsAtGate;
    this.gate.draw(ctx, this.center(level.exit.pos), c, gateOpen,
      this.gateProgress(state.runId, gateOpen, time));
    const route = motion?.route ?? [
      state.player.pos,
      ...path
        .map((id) => (id === 'exit' ? level.exit.pos : state.entities[id]?.pos))
        .filter((pos): pos is Point => Boolean(pos)),
    ];
    // The moving line sits underneath fruit, gems, fragments and the actor.
    this.drawRoute(route, time, motion?.routeProgress ?? 0);
    const entities = Object.values(state.entities);
    if (view.teleportSelecting && !motion && !entry) {
      ctx.save();
      ctx.fillStyle = '#9ee9f3';
      for (const entity of entities) {
        if (isElite(entity)) continue;
        const p = this.center(entity.pos);
        const unit = Math.max(1, Math.round(c / 24));
        ctx.fillRect(Math.round(p.x - unit), Math.round(p.y + c * 0.37), unit * 2, unit * 2);
      }
      ctx.restore();
    }
    const transform = (entity: Entity) => motion?.entities[entity.id] ?? entry?.entities[entity.id];
    for (const entity of entities.filter((item) => item.kind === 'creep'))
      this.withEntity(entity, transform(entity), () =>
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
      this.withEntity(entity, transform(entity), () =>
        this.drawEntityBody(entity, path.includes(entity.id)),
      );
    for (const entity of entities)
      this.withEntity(entity, transform(entity), () =>
        this.drawEntityLabel(entity),
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
    if (motion ? motion.player.alpha > 0 : state.status === 'playing') {
      const p = this.center(motion?.player.pos ?? state.player.pos);
      const sprite: SamuraiPose = motion?.player.sprite ?? {
        clip: 'idle',
        elapsedMs: this.reducedMotion.matches ? 0 : entry?.elapsed ?? time - this.idleStartedAt,
        facing: this.facing,
      };
      if (motion) {
        ctx.save();
        ctx.translate(p.x, p.y + c * SAMURAI_GROUND_OFFSET_CELLS);
        ctx.rotate(motion.player.rotation);
        ctx.scale(motion.player.scaleX, motion.player.scaleY);
        this.samurai.draw(
          ctx,
          { x: 0, y: -c * SAMURAI_GROUND_OFFSET_CELLS },
          c,
          this.pixelRatio,
          sprite,
          motion.player.alpha,
        );
        ctx.restore();
      } else {
        this.samurai.draw(
          ctx,
          p,
          c,
          this.pixelRatio,
          sprite,
        );
      }
    }
    if (!motion && !entry) {
      this.drawTutorial(time);
      // Danger remains above tutorial guidance; the endpoint count stays readable.
      this.drawInspectedThreats(time);
      if (view.preview.valid && !view.preview.exits && path.length) {
        const endpoint = state.entities[path[path.length - 1]];
        this.drawEndpointCount(view.preview.endpoint, view.preview.chainCount,
          endpoint && isElite(endpoint) ? 0.62 : 0.44);
      }
    }
    if (entry) this.drawLevelEntry(entry);
  }

  dispose(): void {
    this.disposed = true;
    this.stopLoop();
    this.lifecycle.abort();
    this.view = null;
    this.motion = null;
    this.levelEntry = null;
    this.spriteTrail = [];
    this.inspectedThreatCells = [];
    this.endpointNumber = null;
    this.entryCard = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
