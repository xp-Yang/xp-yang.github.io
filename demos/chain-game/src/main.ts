import './styles.css';
import {
  getLevel,
  LEVELS,
  legalTargets,
  previewTurn,
  type GameEvent,
} from './core';
import {
  commitPath,
  isLevelUnlocked,
  newSession,
  startLevel,
} from './application/session';
import { editPath } from './application/path-editor';
import { TutorialController, type TutorialView } from './application/tutorial';
import { SessionStore } from './platform/storage';
import { registerOfflineSupport } from './platform/offline';
import { CanvasRenderer } from './presentation/canvas-renderer';
import { GEM_ICON_PATH } from './presentation/gem-visual';
import { attachInput } from './presentation/input';
import { AnimatedTurnPresenter } from './presentation/animated-turn-presenter';
import { TutorialPresenter } from './presentation/tutorial-presenter';

const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const identity = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `local-${Date.now()}-${seed().toString(16)}`;
let storage: Storage | null = null;
try {
  storage = window.localStorage;
} catch {
  /* Private/blocked storage uses memory. */
}
const store = new SessionStore(storage, () => newSession(seed(), identity()));
const tutorial = new TutorialController(storage);
let tutorialView: TutorialView | null = null;
let path: readonly string[] = [];
let inspectedEntityId: string | null = null;
let busy = false;
let message = '';
let pendingAction: (() => void) | null = null;

const hudIcon = (content: string) =>
  `<svg class="hud-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
const icons = {
  kills: hudIcon(
    '<path d="M5 14.5a8 8 0 1 1 14 0l-2 1.5v4H7v-4z"/><path d="M10 17v3m4-3v3"/><circle cx="9" cy="10.5" r="1.5"/><circle cx="15" cy="10.5" r="1.5"/>',
  ),
  gems: hudIcon(`<path d="${GEM_ICON_PATH}"/>`),
  execute: hudIcon('<path d="m6 18 12-12M6 6h12v12"/>'),
  menu: hudIcon('<path d="M4 6h16M4 12h16M4 18h16"/>'),
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="game-layout">
    <section id="play-area" class="play-area" aria-label="游戏棋盘">
      <section class="hud-counters" aria-label="关卡战绩">
        <div class="kill-counter hud-plaque" aria-describedby="objective-label">
          ${icons.kills}<div><span class="hud-label">击杀</span><strong id="objective-count"></strong></div>
          <div class="progress-track" aria-hidden="true"><div id="progress-fill"></div></div>
        </div>
        <div class="gem-counter hud-plaque">${icons.gems}<div><span class="hud-label">已收集宝石</span><strong id="carried">0</strong></div></div>
        <p id="objective-label" class="sr-only"></p>
      </section>
      <header class="level-heading"><span class="eyebrow" id="level-number"></span><h1 id="level-title"></h1><span class="turn-counter">回合 <b id="turn">0</b></span></header>
      <nav class="top-actions" aria-label="游戏菜单"><button class="icon-button" id="help-button" aria-label="玩法说明">?</button><button class="icon-button" id="menu-button" aria-label="打开菜单">${icons.menu}</button></nav>
      <div class="board-stage"><canvas id="board" tabindex="0"></canvas><div id="result" class="result-overlay" hidden></div></div>
      <section class="route-panel" aria-label="路线规划">
        <div id="route-preview" class="preview" aria-live="polite" aria-atomic="true" hidden><div><span>连击</span><strong id="chain-count">—</strong></div><div><span>拾取宝石</span><strong id="pickup-count">—</strong></div><div><span>生成宝石</span><strong id="reward-count">—</strong></div><div id="damage-metric"><span>预计伤害</span><strong id="damage-count">—</strong></div></div>
      </section>
      <section class="health-block hud-plaque" aria-label="生命值"><span class="hud-label">生命</span><span id="health" class="hearts" role="img"></span></section>
      <button id="execute" class="primary execute-button"><span class="execute-icon">${icons.execute}</span><span class="execute-label">执行路线</span></button>
      <div class="game-messages"><p id="hint" class="hint" role="status"></p><p id="notice" class="notice" role="alert" hidden></p></div>
    </section>
  </main>
  <dialog id="dialog" aria-labelledby="dialog-title"><div class="dialog-heading"><h2 id="dialog-title"></h2><button id="close-dialog" class="icon-button" aria-label="关闭">×</button></div><div id="dialog-body"></div></dialog>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('board');
const dialog = $<HTMLDialogElement>('dialog');
const renderer = new CanvasRenderer(canvas);
const presenter = new AnimatedTurnPresenter(renderer);
const tutorialPresenter = new TutorialPresenter($('play-area'), {
  skip: () => {
    if (busy || input.isDragging() || dialog.open) return;
    tutorial.skip(store.data);
    render();
  },
  continue: () => {
    if (busy || input.isDragging() || dialog.open) return;
    tutorial.continue(store.data);
    render();
  },
});
const input = attachInput(canvas, {
  hitTest: (x, y) => renderer.hitTest(x, y),
  visit: (id) => changePath({ type: 'visit', id }),
  undo: () => changePath({ type: 'undo' }),
  clear: () => changePath({ type: 'clear' }),
  commit: () => void commit(),
  enabled: () => !busy && !dialog.open && store.data.run.status === 'playing',
  onDraggingChange: () => render(),
  onMenu: () => openMenu(),
  tap: handleTap,
  onInteractionStart: () => inspectEntity(null),
});

function handleTap(id: string | null): void {
  if (busy || dialog.open || store.data.run.status !== 'playing') return;
  if (id !== null) {
    // Taps use the same route rules as dragging, including gem switches and
    // backtracking. Inspection is only the fallback for an uneditable target.
    if (changePath({ type: 'visit', id })) return;
    if (id === 'player' || path.includes(id)) return;
  }
  inspectEntity(id);
}

function inspectEntity(id: string | null): void {
  const { run } = store.data;
  const entity = id === null ? undefined : run.entities[id];
  const next =
    !busy &&
    !dialog.open &&
    run.status === 'playing' &&
    entity?.kind === 'creep' &&
    entity.mood === 'angry'
      ? entity.id
      : null;
  if (next === inspectedEntityId) return;
  inspectedEntityId = next;
  render();
}

function changePath(command: Parameters<typeof editPath>[2]): boolean {
  if (busy || store.data.run.status !== 'playing') return false;
  inspectEntity(null);
  const next = editPath(store.data.run, path, command);
  if (next === path) return false;
  path = next;
  message = '';
  render();
  return true;
}

function updateControls(): void {
  const locked =
    busy ||
    input.isDragging() ||
    store.data.run.status !== 'playing' ||
    dialog.open;
  $<HTMLButtonElement>('execute').disabled =
    locked || !previewTurn(store.data.run, path).valid;
  for (const id of ['menu-button', 'help-button', 'close-dialog'])
    $<HTMLButtonElement>(id).disabled = busy;
  canvas.setAttribute('aria-busy', String(busy));
  tutorialPresenter.render(
    tutorialView,
    busy,
    input.isDragging() || dialog.open,
  );
  if (busy) {
    $('execute').querySelector<HTMLElement>('.execute-label')!.textContent =
      '行动中…';
    $('execute').dataset.mode = 'busy';
    $('hint').textContent = '沿路线行动中…';
    $('hint').classList.remove('danger-text');
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      '#dialog button, #result button',
    ))
      button.disabled = true;
  }
}

function render(): void {
  // The saved run is already final while the presenter is still showing the
  // accepted route. Storage notices must not replace that display mid-action.
  if (busy) {
    updateControls();
    $('notice').hidden = !store.notice;
    $('notice').textContent = store.notice;
    return;
  }
  const { run, profile } = store.data;
  const level = getLevel(run.levelId);
  const preview = previewTurn(run, path);
  const index = LEVELS.findIndex((item) => item.id === level.id);
  document.documentElement.style.setProperty(
    '--board-ratio',
    String((level.width + 0.5) / (level.height + 1.25)),
  );
  $('health').innerHTML = [0, 1, 2]
    .map(
      (i) =>
        `<span class="${i < profile.health ? '' : 'lost'}" aria-hidden="true">♥</span>`,
    )
    .join('');
  $('health').setAttribute('aria-label', `剩余 ${profile.health} / 3 点生命`);
  $('carried').textContent = String(run.carriedGems);
  $('level-number').textContent =
    `关卡 ${String(index + 1).padStart(2, '0')} / ${String(LEVELS.length).padStart(2, '0')}`;
  $('level-title').textContent = level.name;
  $('turn').textContent = String(run.turn);
  $('objective-label').textContent = run.exitUnlocked
    ? '出口已打开 · 走到上方出口撤离'
    : `击杀 ${level.goal} 只小怪，打开出口`;
  $('objective-count').textContent = `${run.killCount} / ${level.goal}`;
  $('progress-fill').style.width =
    `${Math.min(100, (run.killCount / level.goal) * 100)}%`;
  $('route-preview').hidden = path.length === 0;
  $('chain-count').textContent = path.length ? String(preview.kills) : '—';
  $('pickup-count').textContent = path.length
    ? `+${preview.collectedGems}`
    : '—';
  $('reward-count').textContent = path.length ? `+${preview.rewardValue}` : '—';
  $('damage-count').textContent = path.length
    ? preview.damage
      ? `−${preview.damage} ♥`
      : '安全'
    : '—';
  $('damage-metric').classList.toggle('danger', preview.damage > 0);
  $('execute').querySelector<HTMLElement>('.execute-label')!.textContent =
    preview.exits ? '确认撤离' : '执行路线';
  $('execute').dataset.mode = preview.exits ? 'exit' : 'route';
  tutorialView = tutorial.view(
    store.data,
    path,
    preview,
    input.isDragging(),
    inspectedEntityId,
  );
  tutorialPresenter.render(
    tutorialView,
    false,
    input.isDragging() || dialog.open,
  );
  renderer.render({
    state: run,
    path,
    preview,
    inspectedEntityId,
    tutorial: tutorialView,
  });
  let hint = '点击或拖动连接同色方块；点击无法接入路线的愤怒方块查看范围。';
  if (run.exitUnlocked) hint = '出口已打开。连到顶部入口，再拖向「↑ 出口」。';
  if (path.length && preview.valid)
    hint = preview.exits
      ? '这条路线将安全撤离，随身宝石计入库存。'
      : preview.damage >= run.player.hp
        ? '这条路线会耗尽生命，随身宝石将全部失去。'
        : preview.damage
          ? `终点会受到 ${preview.attackers.length} 只小怪攻击。可以回退，重新规划。`
          : preview.rewardValue
            ? '长链将生成宝石。记得在之后的路线中拾取它。'
            : '路线已保留。继续点击或拖动选线、右键回退，或点击执行。';
  if (
    !path.length &&
    run.status === 'playing' &&
    legalTargets(run).length === 0
  )
    hint = '当前位置没有可行动路线。可在菜单重试，生命会保留。';
  if (run.status === 'escaped') hint = '随身宝石已入库，当前生命已保存。';
  if (run.status === 'dead') hint = '本关行动结束，宝石库存和已通关记录保留。';
  if (inspectedEntityId)
    hint = '红色方框是这只小怪的攻击范围。点击其他位置关闭。';
  $('hint').textContent = inspectedEntityId ? hint : message || hint;
  $('hint').classList.toggle('danger-text', preview.damage > 0);
  $('notice').hidden = !store.notice;
  $('notice').textContent = store.notice;
  renderResult();
  updateControls();
}

function renderResult(): void {
  const { run } = store.data;
  const result = $('result');
  result.hidden = run.status === 'playing';
  if (result.hidden) return;
  const next =
    LEVELS[LEVELS.findIndex((level) => level.id === run.levelId) + 1];
  if (run.status === 'escaped') {
    result.innerHTML = `<div class="result-card"><span class="result-symbol">◇</span><span class="eyebrow">${next ? '关卡完成' : '两关已完成'}</span><h2>安全撤离</h2><p>${run.killCount} 次击杀 · ${run.carriedGems} 宝石已入库</p><p class="result-note">剩余 ${run.player.hp} 点生命会带入下一次行动。</p>${next ? '<button id="next-level" class="primary">进入第二关 →</button>' : '<button id="choose-level" class="primary">选择关卡 →</button>'}<button id="replay-level" class="text-button">再玩这一关</button></div>`;
    if (next) $('next-level').onclick = () => beginLevel(next.id);
    else $('choose-level').onclick = openMenu;
    $('replay-level').onclick = () => beginLevel(run.levelId);
  } else {
    result.innerHTML = `<div class="result-card"><span class="result-symbol failure">×</span><span class="eyebrow">行动结束</span><h2>生命已耗尽</h2><p>本关随身宝石已失去，库存宝石保留。</p><p class="result-note">本版尚未开放宝石回血。可在菜单重置整个存档，重新体验。</p><button id="death-menu" class="primary">打开菜单</button></div>`;
    $('death-menu').onclick = openMenu;
  }
}

async function commit(): Promise<void> {
  if (
    busy ||
    input.isDragging() ||
    dialog.open ||
    !path.length ||
    store.data.run.status !== 'playing'
  )
    return;
  inspectEntity(null);
  const before = store.data.run;
  const acceptedPath = [...path];
  let committed = false;
  let committedEvents: readonly GameEvent[] = [];
  busy = true;
  updateControls();
  try {
    const result = commitPath(store.data, acceptedPath);
    if (!result.ok) {
      message = result.error;
      return;
    }
    // Persist the complete result before any visual delay. Closing the page
    // during motion cannot replay rewards or roll back damage.
    if (!store.save(result.data)) return;
    committed = true;
    committedEvents = result.events;
    const controller = new AbortController();
    if (document.hidden) controller.abort();
    await presenter.play(
      before,
      result.events,
      result.data.run,
      controller.signal,
    );
    message =
      result.data.run.player.hp < before.player.hp
        ? `受到了 ${before.player.hp - result.data.run.player.hp} 点伤害。注意愤怒小怪的十字攻击范围。`
        : '';
  } catch {
    presenter.finishImmediately();
    message = committed ? '行动已完成。' : '这次行动未能完成，请重新规划路线。';
  } finally {
    if (committed) {
      path = [];
      tutorial.afterTurn(store.data, before, committedEvents);
    }
    busy = false;
    render();
    renderer.setAnimation(null);
  }
}

function beginLevel(levelId: string): boolean {
  if (busy) return false;
  input.cancelDrag();
  inspectEntity(null);
  try {
    const next = startLevel(store.data, levelId, seed(), identity());
    if (!store.save(next)) {
      render();
      return false;
    }
    path = [];
    message = '';
    closeDialog();
    render();
    canvas.focus({ preventScroll: true });
    return true;
  } catch (error) {
    message = error instanceof Error ? error.message : '无法进入关卡';
    render();
    return false;
  }
}

function openDialog(title: string, html: string): void {
  if (busy) return;
  input.cancelDrag();
  inspectEntity(null);
  $('dialog-title').textContent = title;
  $('dialog-body').innerHTML = html;
  if (!dialog.open) dialog.showModal();
  updateControls();
}
function closeDialog(): void {
  dialog.close();
  pendingAction = null;
  updateControls();
}

function confirmAction(
  title: string,
  description: string,
  action: () => void,
): void {
  if (busy) return;
  pendingAction = action;
  openDialog(
    title,
    `<p class="dialog-copy">${description}</p><div class="dialog-actions"><button class="secondary" id="cancel-action">取消</button><button class="primary" id="confirm-action">确认</button></div>`,
  );
  $('cancel-action').onclick = closeDialog;
  $('confirm-action').onclick = () => {
    if (busy) return;
    const next = pendingAction;
    pendingAction = null;
    closeDialog();
    next?.();
  };
}

function openHelp(): void {
  if (busy) return;
  openDialog(
    '每一步，都可以想清楚',
    `<div class="help-content"><p><b>规划</b>：点击方块，或按住鼠标左键、单指拖动，从 P 连接八方向相邻的同色方块。路线可以交叉，但不能重复连接同一个目标。松开只保留路线，不会执行。</p><p><b>修改</b>：点击或回拖到之前已选的方块会截短路线；点击或拖回 P 清空。松手后按右键、Backspace 或 Delete 退一步。无效颜色不影响已有路线。</p><p><b>行动</b>：点击「执行路线」，或让棋盘获得焦点后按 Enter / 空格。主角停在路线终点，已选小怪被消除，空位掉落补充。</p><p><b>宝石</b>：一条路线击杀 10 / 15 / 20 / 25 只小怪，分别生成价值 1 / 2 / 3 / 5 的宝石。宝石留在棋盘；经过它才能收集，并允许下一段改换颜色。</p><p><b>危险</b>：点击带红色 ! 的小怪时，能接入当前路线就优先连线，不显示攻击范围；无法接入时，用闪烁红框查看它上下左右四格的攻击范围。已选节点仍按路线回退规则处理。一次只查看一只，点击其他位置关闭。只要本轮没有杀掉它，停在其攻击范围内就会扣血；多只攻击会叠加。新变愤怒的小怪到下一轮才会攻击。</p><p><b>撤离</b>：达标只打开出口。必须在之后的路线中连到顶部入口，再连出口，才能带走宝石。倒下会失去本关随身宝石。</p><p><b>生命</b>：换关、重试和刷新都不回血。宝石购买回血、装备与能力升级尚未开放。全新存档从 3 点生命开始。</p><div class="legend"><span class="blue">● 蓝色</span><span class="green">+ 绿色</span><span class="purple">▲ 紫色</span><span>${icons.gems} 宝石</span></div></div>`,
  );
}

function openTutorial(): void {
  if (busy || store.data.profile.health === 0) return;
  const { run } = store.data;
  const resumeGuide = () => {
    tutorial.restart(store.data);
    inspectEntity(null);
    closeDialog();
    render();
    canvas.focus({ preventScroll: true });
  };
  const startGuide = () => {
    if (beginLevel(LEVELS[0].id)) resumeGuide();
  };
  if (run.levelId === LEVELS[0].id && run.status === 'playing') {
    if (run.turn === 0 && path.length === 0) {
      resumeGuide();
      return;
    }
    openDialog(
      '新手引导',
      `<p class="dialog-copy">可以在当前棋盘继续学习，也可以回到第一关开场，从同色连线开始。</p><div class="dialog-actions"><button id="tutorial-resume" class="primary">继续当前引导</button><button id="tutorial-from-start" class="secondary">从头学习</button></div>`,
    );
    $('tutorial-resume').onclick = resumeGuide;
    $('tutorial-from-start').onclick = () =>
      confirmAction(
        '从头学习',
        '将重新开始第一关，清空当前路线和本关随身宝石。生命和宝石库存保留，从第一步连线开始引导。',
        startGuide,
      );
    return;
  }
  if (run.status === 'playing')
    confirmAction(
      '进入新手引导',
      '将离开当前关卡，清空当前路线和本关随身宝石。生命和宝石库存保留，进入第一关从连线开始学习。',
      startGuide,
    );
  else startGuide();
}

function openMenu(): void {
  if (busy) return;
  const { run, profile } = store.data;
  openDialog(
    '行囊与关卡',
    `<div class="menu-summary"><span>生命 ${profile.health} / 3</span><span>宝石库存 ${profile.bankedGems}</span></div><div class="level-list">${LEVELS.map(
      (level, index) => {
        const unlocked = isLevelUnlocked(store.data, level.id);
        return `<button data-level="${level.id}" class="level-option" ${!unlocked || profile.health === 0 ? 'disabled' : ''}><span class="level-option-number">0${index + 1}</span><span><b>${level.name}</b><small>${level.height} 行 × ${level.width} 列 · 击杀 ${level.goal} 只${profile.clearedLevelIds.includes(level.id) ? ' · 已通关' : ''}</small></span><span>${unlocked ? '↗' : '锁定'}</span></button>`;
      },
    ).join(
      '',
    )}</div><p class="dialog-copy">重试、换关均保留当前生命。离开未完成的关卡会失去随身宝石；成功撤离第一关后解锁第二关。</p><button id="tutorial-restart" class="secondary" ${profile.health === 0 ? 'disabled' : ''}>${run.levelId === LEVELS[0].id && run.status === 'playing' ? '重看新手引导' : '进入教程关'}</button><div class="menu-tools"><button id="export-save" class="secondary">导出存档</button><button id="reset-save" class="text-button danger-text">重置全部进度</button></div>`,
  );
  for (const button of dialog.querySelectorAll<HTMLButtonElement>(
    '[data-level]',
  ))
    button.onclick = () => {
      if (busy) return;
      const levelId = button.dataset.level!;
      if (run.status === 'playing')
        confirmAction(
          '重新出发',
          '当前路线和随身宝石将清空，已经损失的生命不会恢复。',
          () => beginLevel(levelId),
        );
      else beginLevel(levelId);
    };
  $('tutorial-restart').onclick = openTutorial;
  $('export-save').onclick = () => {
    if (busy) return;
    const url = URL.createObjectURL(
      new Blob([store.export()], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chain-game-save.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('reset-save').onclick = () =>
    confirmAction(
      '重置全部进度',
      '这会删除宝石库存、关卡记录和当前进度，并创建全新的 3 点生命存档。此操作不能撤销。',
      () => {
        if (busy) return;
        store.reset(newSession(seed(), identity()));
        path = [];
        message = '';
        render();
      },
    );
}

$('execute').onclick = () => void commit();
$('menu-button').onclick = openMenu;
$('help-button').onclick = openHelp;
$('close-dialog').onclick = closeDialog;
dialog.addEventListener('close', () => {
  pendingAction = null;
  updateControls();
});
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      closeDialog();
  }
});
const observer = new ResizeObserver(() => {
  input.cancelDrag();
  renderer.resize();
});
observer.observe(canvas);
window.addEventListener('storage', (event) => {
  if (event.key === 'chain-game:save:v1') {
    store.notice = '另一个页面已更新存档。请刷新此页后继续。';
    render();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    inspectEntity(null);
    presenter.finishImmediately();
  }
});
window.addEventListener('blur', () => inspectEntity(null));
window.addEventListener('pagehide', () => presenter.finishImmediately());
render();
void registerOfflineSupport();
