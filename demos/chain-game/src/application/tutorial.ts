import { getRunLevel, TUTORIAL_CHAIN } from '../content/levels';
import {
  samePoint,
  type ColorId,
  type GameEvent,
  type Point,
  type RunState,
  type TurnPreview,
} from '../core/model';
import { entityAt, inspectPath, legalTargets } from '../core/path';
import type { SessionData } from './session';

export interface TutorialView {
  id: string;
  step: number;
  total: number;
  title: string;
  body: string;
  detail: string;
  focus: 'board' | 'execute' | 'kills' | 'gems' | 'health' | 'exit';
  cells: readonly Point[];
  route: readonly Point[];
  action: string | null;
}

interface TutorialProgress {
  status: 'active' | 'skipped' | 'completed';
  firstAction: boolean;
  generatedGem: boolean;
  collectedGem: boolean;
  switchedColor: boolean;
  inspectedDanger: boolean;
  dangerAcknowledged: boolean;
  longChainAcknowledged: boolean;
}

type Acknowledgement = 'danger' | 'long-chain';

const STORAGE_KEY = 'chain-game:tutorial:v1';
const TUTORIAL_LEVEL = 'level-001';
const freshProgress = (): TutorialProgress => ({
  status: 'active',
  firstAction: false,
  generatedGem: false,
  collectedGem: false,
  switchedColor: false,
  inspectedDanger: false,
  dangerAcknowledged: false,
  longChainAcknowledged: false,
});

/** Presentation preferences only: this controller never edits a run or its rules. */
export class TutorialController {
  private readonly profiles = new Map<string, TutorialProgress>();
  private pendingAcknowledgement: {
    profileId: string;
    kind: Acknowledgement;
  } | null = null;

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  ) {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved: unknown = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      const envelope = saved as { version?: unknown; profiles?: unknown };
      if (
        envelope.version !== 1 ||
        !envelope.profiles ||
        typeof envelope.profiles !== 'object' ||
        Array.isArray(envelope.profiles)
      )
        return;
      for (const [id, value] of Object.entries(envelope.profiles)) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          continue;
        const candidate = value as Record<string, unknown>;
        if (
          candidate.status !== 'active' &&
          candidate.status !== 'skipped' &&
          candidate.status !== 'completed'
        )
          continue;
        const progress = freshProgress();
        progress.status = candidate.status;
        for (const key of Object.keys(progress) as (keyof TutorialProgress)[]) {
          if (key !== 'status' && typeof candidate[key] === 'boolean')
            progress[key] = candidate[key] === true;
        }
        this.profiles.set(id, progress);
      }
    } catch {
      // Private browsing, unavailable storage and malformed data use memory.
    }
  }

  enabled(data: SessionData): boolean {
    if (data.run.levelId !== TUTORIAL_LEVEL || data.run.status !== 'playing')
      return false;
    // Level completion predates the tutorial for existing players. Only an
    // explicit tutorial skip/completion should suppress their first guidance.
    return this.progress(data).status === 'active';
  }

  view(
    data: SessionData,
    path: readonly string[],
    preview: TurnPreview,
    dragging: boolean,
    inspectedId: string | null,
  ): TutorialView | null {
    this.pendingAcknowledgement = null;
    if (!this.enabled(data)) return null;
    const progress = this.progress(data);
    const run = data.run;
    const level = getRunLevel(run);
    const entities = Object.values(run.entities);
    const gems = entities.filter((entity) => entity.kind === 'gem');
    const angry = entities.filter(
      (entity) => entity.kind === 'creep' && entity.mood === 'angry',
    );
    const firstAction = progress.firstAction || run.turn > 0;
    const collectedGem = progress.collectedGem || run.carriedGems > 0;
    const generatedGem =
      progress.generatedGem || collectedGem || gems.length > 0;
    const availableCells = () =>
      legalTargets(run, path).flatMap((id) =>
        id === 'exit' ? [level.exit.pos] : [run.entities[id].pos],
      );
    const show = (
      id: string,
      step: number,
      title: string,
      body: string,
      focus: TutorialView['focus'],
      options: Partial<Pick<TutorialView, 'detail' | 'cells' | 'route'>> & {
        action?: string;
        acknowledge?: Acknowledgement;
      } = {},
    ): TutorialView => {
      if (options.acknowledge)
        this.pendingAcknowledgement = {
          profileId: data.profile.id,
          kind: options.acknowledge,
        };
      return {
        id,
        step,
        total: 6,
        title,
        body,
        detail: options.detail ?? '',
        focus,
        cells: options.cells ?? [],
        route: options.route ?? [],
        action: options.action ?? null,
      };
    };

    if (preview.valid && preview.damage > 0)
      return show(
        'unsafe-endpoint',
        5,
        '先看看落脚点',
        '这条路线结束后会受到攻击。沿原路回拖，或右键退一步，换一个安全的落脚点再出发。',
        'health',
        {
          detail: `预计损失 ${preview.damage} 点生命 · 换关不会恢复生命`,
          cells: [preview.endpoint],
        },
      );

    if (preview.valid && preview.exits)
      return show(
        'confirm-exit',
        6,
        '带着宝石离开',
        '路线已经连到出口。松手后按 GO，就能安全离开矿洞，把随身宝石存入仓库。',
        'execute',
        {
          detail: `本次可带回 ${run.carriedGems + preview.collectedGems} 颗宝石`,
        },
      );

    const inspected = inspectedId ? run.entities[inspectedId] : undefined;
    if (
      inspected?.kind === 'creep' &&
      inspected.mood === 'angry' &&
      !progress.inspectedDanger
    ) {
      progress.inspectedDanger = true;
      this.persist();
    }
    // Dismissing the range on pointerdown must not remove its acknowledgement
    // before the following click reaches the tutorial button.
    if (progress.inspectedDanger && !progress.dangerAcknowledged) {
      return show(
        'inspect-danger',
        5,
        '红框就是危险范围',
        '危险水果会攻击上下左右的格子，刚变危险时下回合才会攻击。首关少于 4 连会让场上水果变异；避开红框落脚，点击别处关闭范围。',
        'board',
        {
          cells:
            inspected?.kind === 'creep' && inspected.mood === 'angry'
              ? [inspected.pos]
              : [],
          detail: '多个危险水果的攻击会叠加',
          action: '知道了',
          acknowledge: 'danger',
        },
      );
    }

    const selectable = new Set(legalTargets(run, path));
    const inspectableAngry = angry.find(
      (entity) => !selectable.has(entity.id) && !path.includes(entity.id),
    );
    if (
      inspectableAngry &&
      !progress.inspectedDanger &&
      !progress.dangerAcknowledged &&
      path.length === 0
    )
      return show(
        'discover-danger',
        5,
        '水果变得危险了',
        '短连击会使水果变异。轻点标出的危险水果，查看闪烁红框标出的攻击范围，再规划安全的路线。',
        'board',
        {
          cells: [inspectableAngry.pos],
          action: '继续规划',
          acknowledge: 'danger',
        },
      );

    if (run.exitUnlocked || (preview.valid && inspectPath(run, path).exitAvailable)) {
      return show(
        'reach-exit',
        6,
        run.exitUnlocked ? '出口已经打开' : '这条路线已经能开门',
        run.exitUnlocked
          ? '继续连接水果，走到出口下方，再把路线连到顶部出口。不必继续切开更多水果就能撤离。'
          : '沿这条路线走到门前，再拖向顶部出口。松手按 GO，就能切开水果并直接撤离；回拖离开门会重新锁上。',
        'exit',
        {
          cells: [...level.exit.entryCells, level.exit.pos],
          detail: '宝石在撤离后入库 · 留意红色感叹号的危险水果',
        },
      );
    }

    const routeFacts = this.routeFacts(run, path);
    if (routeFacts.switchedColor)
      return show(
        'color-switched',
        3,
        '成功切换水果种类',
        '经过宝石后，你接上了另一种水果。可以继续延长路线，也可以松手，按 GO 出发。',
        dragging ? 'board' : 'execute',
        {
          detail: `本次连击 ${preview.chainCount} · 拾取 ${preview.collectedGems} 颗宝石`,
        },
      );

    if (
      routeFacts.hasGem &&
      dragging &&
      run.entities[path[path.length - 1]]?.kind === 'gem'
    )
      return show(
        'gem-switch',
        3,
        '宝石可以切换水果种类',
        '路线经过宝石后，下一个相邻目标可以换成另一种水果。每堆宝石也计 1 次连击。',
        'board',
        { cells: availableCells(), detail: '也可以在宝石处结束路线，不必切换水果种类' },
      );

    if (routeFacts.hasGem && dragging)
      return show(
        'gem-in-route',
        3,
        '宝石已经选入',
        '执行路线后就会收集这堆宝石，它也计 1 次连击。可以继续连接水果，也可以沿原路回拖调整。',
        'board',
        {
          cells: availableCells(),
          detail: `本次连击 ${preview.chainCount} · 拾取 ${preview.collectedGems} 颗宝石`,
        },
      );

    if (preview.valid && path.length > 0 && !dragging)
      return show(
        firstAction ? 'confirm-route' : 'first-execution',
        firstAction && routeFacts.hasGem ? 3 : 2,
        routeFacts.hasGem ? '把宝石收入囊中' : '准备好了就出发',
        '松手只会保留路线。按右下角 GO，主角才会行动；想改路线，可以回拖或右键退一步。',
        'execute',
        {
          detail:
            preview.rewardValue > 0
              ? `${preview.chainCount} 连击 · 将生成价值 ${preview.rewardValue} 的宝石`
              : `本次连击 ${preview.chainCount} · 10 连击起可生成宝石`,
        },
      );

    if (!firstAction) {
      const route = this.openingRoute(run, path);
      if (path.length === 0)
        return show(
          'first-drag',
          1,
          '连起同种水果',
          '从武士或它旁边的橙子按住拖动，沿同种水果连线。横着、竖着、斜着都可以走。',
          'board',
          {
            route,
            cells: [TUTORIAL_CHAIN[0]],
            detail: '虚线是一条示范路线，也可以自己规划',
          },
        );
      return show(
        'extend-first-chain',
        1,
        preview.chainCount >= 10 ? '已连满十个' : '试试一笔连十个',
        preview.chainCount >= 10
          ? '这条路线已经能生成宝石。松手后再决定是否执行；想调整路线，沿已选水果往回拖即可。'
          : '一笔连满 10 个水果或宝石节点会生成宝石。每堆宝石计 1 次，连得更长，奖励更多。',
        'board',
        {
          route,
          cells: route.length > 1 ? [route[1]] : availableCells(),
          detail: `${preview.chainCount} / 10 连击 · 不必照着示范路线走`,
        },
      );
    }

    if (!collectedGem && gems.length > 0)
      return show(
        'collect-gem',
        3,
        '收下这颗宝石',
        '长链产生的宝石会留在棋盘上。连到它并执行才能收集；每堆宝石计 1 次连击，还可以切换水果种类。',
        'board',
        {
          cells: gems.map((gem) => gem.pos),
          detail: '先用同种水果规划能走到宝石旁边的路线',
        },
      );

    if (!generatedGem && !progress.longChainAcknowledged)
      return show(
        'earn-first-gem',
        3,
        '长链会留下宝石',
        '一次连接 10 个水果或宝石节点，会在棋盘上生成宝石。每堆宝石计 1 次；可以先切短链调整棋盘。',
        'board',
        {
          cells: dragging ? availableCells() : [],
          detail: `${preview.chainCount} / 10 连击 · 连得越长，宝石价值越高`,
          action: '记住了',
          acknowledge: 'long-chain',
        },
      );

    return show(
      'kill-goal',
      4,
      '打开矿洞出口',
      '左上角记录本关累计切开的水果。切开 20 个就能打开出口，不用在同一条路线里完成。',
      'kills',
      {
        detail: `${run.killCount} / ${level.goal} 个水果${collectedGem ? ' · 已收集的宝石撤离后入库' : ''}`,
      },
    );
  }

  afterTurn(
    data: SessionData,
    before: RunState,
    events: readonly GameEvent[],
  ): void {
    if (before.levelId !== TUTORIAL_LEVEL) return;
    const progress = this.progress(data);
    if (progress.status !== 'active') return;
    progress.firstAction ||= data.run.turn > before.turn;
    progress.generatedGem ||= events.some(
      (event) =>
        event.type === 'gem-spawned' || event.type === 'reward-pending',
    );
    progress.collectedGem ||= events.some(
      (event) => event.type === 'gem-collected',
    );
    const performedPath = events.flatMap((event) =>
      event.type === 'creep-killed' || event.type === 'gem-collected'
        ? [event.entity.id]
        : [],
    );
    progress.switchedColor ||= this.routeFacts(
      before,
      performedPath,
    ).switchedColor;
    if (data.run.status === 'escaped') progress.status = 'completed';
    this.persist();
  }

  skip(data: SessionData): void {
    this.progress(data).status = 'skipped';
    this.pendingAcknowledgement = null;
    this.persist();
  }

  restart(data: SessionData): void {
    const progress = freshProgress();
    this.profiles.set(data.profile.id, progress);
    this.pendingAcknowledgement = null;
    this.persist();
  }

  continue(data: SessionData): void {
    const acknowledgement = this.pendingAcknowledgement;
    if (!acknowledgement || acknowledgement.profileId !== data.profile.id)
      return;
    const progress = this.progress(data);
    if (acknowledgement.kind === 'danger') progress.dangerAcknowledged = true;
    if (acknowledgement.kind === 'long-chain')
      progress.longChainAcknowledged = true;
    this.pendingAcknowledgement = null;
    this.persist();
  }

  private progress(data: SessionData): TutorialProgress {
    let progress = this.profiles.get(data.profile.id);
    if (!progress) {
      progress = freshProgress();
      this.profiles.set(data.profile.id, progress);
    }
    return progress;
  }

  private openingRoute(
    run: RunState,
    path: readonly string[],
  ): readonly Point[] {
    if (run.turn !== 0 || path.length > TUTORIAL_CHAIN.length) return [];
    if (
      !path.every((id, index) => {
        const entity = run.entities[id];
        return entity && samePoint(entity.pos, TUTORIAL_CHAIN[index]);
      }) ||
      !TUTORIAL_CHAIN.every((point) => {
        const entity = entityAt(run, point);
        return entity?.kind === 'creep' && entity.color === 'blue';
      })
    )
      return [];
    return [
      path.length > 0 ? TUTORIAL_CHAIN[path.length - 1] : run.player.pos,
      ...TUTORIAL_CHAIN.slice(path.length),
    ];
  }

  private routeFacts(
    run: RunState,
    path: readonly string[],
  ): { hasGem: boolean; switchedColor: boolean } {
    let color: ColorId | null = null;
    let canSwitch = false;
    let hasGem = false;
    let switchedColor = false;
    for (const id of path) {
      const entity = run.entities[id];
      if (!entity) continue;
      if (entity.kind === 'gem') {
        hasGem = true;
        canSwitch = true;
      } else {
        if (canSwitch && color !== null && color !== entity.color)
          switchedColor = true;
        color = entity.color;
        canSwitch = false;
      }
    }
    return { hasGem, switchedColor };
  }

  private persist(): void {
    try {
      this.storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          profiles: Object.fromEntries(this.profiles),
        }),
      );
    } catch {
      // The in-memory preferences remain usable if persistence is unavailable.
    }
  }
}
