import {
  attackCells,
  getLevel,
  type ColorId,
  type Entity,
  type Point,
} from '../core';
import type { BoardView, GameRenderer } from './contracts';
import { drawGemCluster } from './gem-visual';
import { MOTION_TIMING, type MotionFrame, type EntityMotion } from './motion';

const COLORS: Record<ColorId, string> = {
  blue: '#75bee6',
  green: '#b7ce82',
  purple: '#b9a0db',
};

export class CanvasRenderer implements GameRenderer {
  private view: BoardView | null = null;
  private motion: MotionFrame | null = null;
  private ctx: CanvasRenderingContext2D;
  private cell = 1;
  private left = 0;
  private top = 0;
  private width = 0;
  private height = 0;
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
    this.canvas.style.aspectRatio = `${level.width + 0.5} / ${level.height + 1.25}`;
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
    this.motion = frame;
    this.stopLoop();
    this.paint();
  }

  resize(): void {
    if (!this.view || this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.round(rect.width * ratio),
      height = Math.round(rect.height * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.width = rect.width;
    this.height = rect.height;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const level = getLevel(this.view.state.levelId);
    this.cell = rect.width / (level.width + 0.5);
    this.left = this.cell * 0.25;
    this.top = this.cell;
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
    const gate = this.center(level.exit.pos);
    if (
      Math.abs(x - gate.x) < this.cell * 0.65 &&
      Math.abs(y - gate.y) < this.cell * 0.28
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
      (this.view.path.length ||
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
    radius: number,
    fill: string,
    stroke?: string,
    lineWidth = 1,
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  private label(
    text: string,
    point: Point,
    size: number,
    color: string,
    weight = '600',
  ): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, point.x, point.y);
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
      this.rect(
        -c * 0.4,
        -c * 0.4,
        c * 0.8,
        c * 0.8,
        c * 0.14,
        COLORS[entity.color],
        selected ? '#f3f8d7' : entity.mood === 'angry' ? '#ff725a' : undefined,
        selected ? 3 : 2.5,
      );
    } else drawGemCluster(this.ctx, c, entity.value, selected);
  }

  private drawEntityLabel(entity: Entity, index: number): void {
    const ctx = this.ctx,
      c = this.cell;
    if (index >= 0) {
      ctx.beginPath();
      ctx.arc(0, 0, c * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = '#173331';
      ctx.fill();
      this.label(String(index + 1), { x: 0, y: 0 }, c * 0.18, '#f5ffdf');
    } else if (entity.kind === 'creep')
      this.label(
        entity.color === 'blue' ? '●' : entity.color === 'green' ? '+' : '▲',
        { x: 0, y: 0 },
        c * 0.22,
        '#243d42b3',
      );
    if (entity.kind === 'creep' && entity.mood === 'angry') {
      const p = { x: c * 0.27, y: -c * 0.26 };
      ctx.beginPath();
      ctx.arc(p.x, p.y, c * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = '#9e2f24';
      ctx.fill();
      this.label('!', p, c * 0.17, '#fff0da', '800');
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
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
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
    ctx.shadowColor = '#ff4e4966';
    ctx.shadowBlur = c * 0.045;
    for (const pos of this.inspectedThreatCells) {
      const p = this.center(pos);
      this.rect(
        p.x - c * 0.43,
        p.y - c * 0.43,
        c * 0.86,
        c * 0.86,
        c * 0.06,
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
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const pos of guidance.cells) {
      const p = this.center(pos);
      ctx.beginPath();
      ctx.arc(p.x, p.y, c * 0.43, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 224, 146, ${pulse})`;
      ctx.lineWidth = Math.max(2, c * 0.028);
      ctx.setLineDash([c * 0.06, c * 0.055]);
      ctx.stroke();
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
        ctx.beginPath();
        ctx.arc(p.x, p.y, c * 0.078, 0, Math.PI * 2);
        ctx.fillStyle = '#ffe092';
        ctx.fill();
        ctx.strokeStyle = '#26352d';
        ctx.lineWidth = Math.max(1, c * 0.02);
        ctx.stroke();
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
    const gate = this.center(level.exit.pos);
    this.rect(
      gate.x - c * 0.67,
      gate.y - c * 0.24,
      c * 1.34,
      c * 0.48,
      c * 0.12,
      state.exitUnlocked ? '#d1eb93' : '#293438',
      state.exitUnlocked ? '#e4f6b4' : '#435054',
    );
    this.label(
      state.exitUnlocked ? '↑ 出口' : '出口 · 锁定',
      gate,
      c * 0.17,
      state.exitUnlocked ? '#1c3028' : '#98a8a8',
    );
    for (let y = 0; y < level.height; y++)
      for (let x = 0; x < level.width; x++) {
        const p = this.center({ x, y });
        this.rect(
          p.x - c * 0.45,
          p.y - c * 0.45,
          c * 0.9,
          c * 0.9,
          c * 0.14,
          '#1b272a',
          '#283638',
        );
      }
    for (const entity of Object.values(state.entities))
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
    for (const entity of Object.values(state.entities))
      this.withEntity(entity, motion?.entities[entity.id], () =>
        this.drawEntityLabel(entity, path.indexOf(entity.id)),
      );
    if (motion) {
      for (const impact of motion.impacts) {
        const p = this.center(impact.pos);
        ctx.save();
        ctx.globalAlpha = impact.alpha;
        ctx.strokeStyle = impact.color;
        ctx.lineWidth = c * 0.055;
        ctx.beginPath();
        ctx.arc(p.x, p.y, impact.radius * c, 0, Math.PI * 2);
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
          size * 0.13,
          particle.color,
        );
        ctx.restore();
      }
      if (motion.playerTrail.length > 1) {
        ctx.save();
        ctx.beginPath();
        motion.playerTrail.forEach((point, index) => {
          const p = this.center(point);
          if (index === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.strokeStyle = '#e8ffbc36';
        ctx.lineWidth = c * 0.38;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
      }
    }
    if (motion ? motion.player.alpha > 0 : state.status !== 'escaped') {
      const p = this.center(motion?.player.pos ?? state.player.pos);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(motion?.player.scaleX ?? 1, motion?.player.scaleY ?? 1);
      ctx.globalAlpha = motion?.player.alpha ?? 1;
      ctx.beginPath();
      ctx.arc(0, 0, c * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = '#edf4df';
      ctx.fill();
      ctx.strokeStyle = '#b9d892';
      ctx.lineWidth = 3;
      ctx.stroke();
      this.label('P', { x: 0, y: 0 }, c * 0.29, '#1c3932', '800');
      ctx.restore();
    }
    if (!motion && view.preview.valid && path.length && !view.preview.exits) {
      const p = this.center(view.preview.endpoint);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, c * 0.44, 0, Math.PI * 2);
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
    this.inspectedThreatCells = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
