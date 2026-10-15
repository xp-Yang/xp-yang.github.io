import './assets/ui/font.css';
import './styles.css';
import {
  getLevel,
  inspectPath,
  LEVELS,
  legalTargets,
  previewTurn,
  type GameEvent,
  type RunState,
  type TurnPreview,
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
import { GEM_ICON_URL, gemClusterPlacements } from './presentation/gem-visual';
import { boardAspectRatio } from './presentation/board-geometry';
import { pixelIcon } from './presentation/pixel-icons';
import { attachInput } from './presentation/input';
import { AnimatedTurnPresenter } from './presentation/animated-turn-presenter';
import { GameAudio } from './presentation/game-audio';
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
let assetError = '';
let message = '';
let pendingAction: (() => void) | null = null;
let renderRequest = 0;
let cachedPreview: {
  run: RunState;
  path: readonly string[];
  value: TurnPreview;
} | null = null;

const icons = {
  kills: pixelIcon('skull'),
  gems: `<img class="hud-icon pixel-art" src="${GEM_ICON_URL}" alt="" aria-hidden="true"/>`,
  execute: pixelIcon('arrow'),
  menu: pixelIcon('menu'),
  help: pixelIcon('help'),
  close: pixelIcon('close'),
  heart: pixelIcon('heart'),
  lock: pixelIcon('lock'),
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="game-layout">
    <section id="play-area" class="play-area" aria-label="游戏棋盘">
      <section class="hud-counters" aria-label="关卡战绩">
        <div class="kill-counter hud-plaque" role="group" aria-label="切开进度" aria-describedby="objective-label">
          ${icons.kills}<div><strong id="objective-count"></strong></div>
          <div class="progress-track" aria-hidden="true"><div id="progress-fill"></div></div>
        </div>
        <div class="gem-counter hud-plaque" role="group" aria-label="已收集宝石">${icons.gems}<div><strong id="carried">0</strong></div></div>
        <p id="objective-label" class="sr-only"></p>
      </section>
      <nav class="top-actions" aria-label="游戏菜单"><button class="icon-button" id="help-button" aria-label="玩法说明">${icons.help}</button><button class="icon-button" id="menu-button" aria-label="打开菜单">${icons.menu}</button></nav>
      <div class="board-stage"><canvas id="board" tabindex="0"></canvas><div id="result" class="result-overlay" hidden></div></div>
      <section class="health-block hud-plaque" aria-label="生命值"><span id="health" class="hearts" role="img"></span></section>
      <button id="execute" class="primary execute-button" aria-label="执行路线" aria-describedby="route-summary" aria-keyshortcuts="Space Enter"><span id="execute-gems" class="execute-gem-background" aria-hidden="true" hidden></span><span id="route-preview" class="execute-preview" aria-hidden="true" hidden><span class="execute-metric execute-chain">${icons.kills}<strong id="chain-count">0</strong></span></span><span class="execute-label">GO</span><kbd class="execute-shortcut" aria-hidden="true"><span class="shortcut-key">${pixelIcon('space')}</span></kbd></button>
      <span id="route-summary" class="sr-only" aria-live="polite" aria-atomic="true"></span>
      <div class="game-messages"><p id="hint" class="sr-only" role="status"></p><p id="notice" class="notice" role="alert" hidden></p></div>
    </section>
  </main>
  <dialog id="dialog" aria-labelledby="dialog-title"><div class="dialog-heading"><h2 id="dialog-title"></h2><button id="close-dialog" class="icon-button" aria-label="关闭">${icons.close}</button></div><div id="dialog-body"></div></dialog>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('board');
const dialog = $<HTMLDialogElement>('dialog');
const executeButton = $<HTMLButtonElement>('execute');
const executeGems = $('execute-gems');
let displayedRewardCount = -1;

function renderGeneratedGems(count: number): void {
  if (count === displayedRewardCount) return;
  displayedRewardCount = count;
  executeGems.hidden = count === 0;
  if (count === 0) {
    executeGems.replaceChildren();
    return;
  }
  executeGems.replaceChildren(
    ...gemClusterPlacements(count).map(({ x, y, size }) => {
      const gem = document.createElement('img');
      gem.src = GEM_ICON_URL;
      gem.alt = '';
      gem.draggable = false;
      gem.className = 'pixel-art';
      gem.style.left = `${50 + x * 100}%`;
      gem.style.top = `${50 + y * 100}%`;
      gem.style.width = `${size * 100}%`;
      return gem;
    }),
  );
}

const renderer = new CanvasRenderer(canvas);
const audio = new GameAudio();
// Unlock from real input, before route editing or GO can request a sound.
document.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
document.addEventListener('keydown', () => audio.unlock(), { capture: true });
const presenter = new AnimatedTurnPresenter(renderer, audio);
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
  enabled: () =>
    renderer.assetsReady &&
    !busy &&
    !dialog.open &&
    store.data.run.status === 'playing',
  onDraggingChange: () => {
    // finishDrag clears its pointer synchronously: unlock before any repaint.
    updateControls();
    requestRender();
  },
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
  requestRender();
}

function changePath(command: Parameters<typeof editPath>[2]): boolean {
  if (busy || store.data.run.status !== 'playing') return false;
  inspectEntity(null);
  const next = editPath(store.data.run, path, command);
  if (next === path) return false;
  if (next.length > path.length &&
      store.data.run.entities[next[next.length - 1]]?.kind === 'creep') {
    audio.count(inspectPath(store.data.run, next).kills);
  }
  path = next;
  message = '';
  updateControls();
  requestRender();
  return true;
}

function requestRender(): void {
  if (renderRequest) return;
  renderRequest = requestAnimationFrame(() => {
    renderRequest = 0;
    render();
  });
}

function cancelScheduledRender(): void {
  if (renderRequest) cancelAnimationFrame(renderRequest);
  renderRequest = 0;
}

function currentPreview(): TurnPreview {
  const run = store.data.run;
  if (cachedPreview?.run === run && cachedPreview.path === path)
    return cachedPreview.value;
  const value = previewTurn(run, path);
  cachedPreview = { run, path, value };
  return value;
}

function updateControls(): void {
  const locked =
    busy ||
    !renderer.assetsReady ||
    input.isDragging() ||
    store.data.run.status !== 'playing' ||
    dialog.open;
  // Enabling GO only needs path validity; do not simulate rewards and gravity.
  const route = inspectPath(store.data.run, path);
  executeButton.disabled = locked || !route.valid;
  executeButton.dataset.mode = busy ? 'busy' : route.exits ? 'exit' : 'route';
  executeButton.setAttribute('aria-busy', String(busy || !renderer.assetsReady));
  executeButton.setAttribute(
    'aria-label',
    busy ? '行动中' : route.exits ? '确认撤离' : '执行路线',
  );
  for (const id of ['menu-button', 'help-button', 'close-dialog'])
    $<HTMLButtonElement>(id).disabled = busy;
  canvas.setAttribute('aria-busy', String(busy || !renderer.assetsReady));
  tutorialPresenter.render(
    tutorialView,
    busy,
    input.isDragging() || dialog.open,
  );
  if (busy) {
    $('hint').textContent = '沿路线行动中…';
    $('hint').classList.remove('danger-text');
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      '#dialog button, #result button',
    ))
      button.disabled = true;
  } else if (!renderer.assetsReady) {
    executeButton.setAttribute('aria-label', assetError ? '加载失败' : '载入中');
    $('hint').textContent = assetError || '正在载入…';
    $('hint').classList.remove('danger-text');
  }
}

function render(): void {
  cancelScheduledRender();
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
  const preview = currentPreview();
  document.documentElement.style.setProperty(
    '--board-ratio',
    String(boardAspectRatio(level.width, level.height)),
  );
  $('health').innerHTML = [0, 1, 2]
    .map(
      (i) =>
        `<span class="${i < profile.health ? '' : 'lost'}" aria-hidden="true">${icons.heart}</span>`,
    )
    .join('');
  $('health').setAttribute('aria-label', `剩余 ${profile.health} / 3 点生命`);
  $('carried').textContent = String(run.carriedGems);
  $('objective-label').textContent = run.exitUnlocked
    ? '出口已打开 · 走到上方出口撤离'
    : `切开 ${level.goal} 个水果，打开出口`;
  $('objective-count').textContent = `${run.killCount} / ${level.goal}`;
  $('progress-fill').style.width =
    `${Math.min(100, (run.killCount / level.goal) * 100)}%`;
  $('route-preview').hidden = path.length === 0;
  $('chain-count').textContent = String(preview.kills);
  renderGeneratedGems(path.length ? preview.rewardCount : 0);
  $('route-summary').textContent = path.length
    ? `连击 ${preview.kills}，本轮生成 ${preview.rewardCount} 颗宝石`
    : '';
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
  let hint = '点击或拖动连接同种水果；点击无法接入路线的危险水果查看范围。';
  if (run.exitUnlocked) hint = '出口已打开。连到顶部入口，再拖向门内。';
  if (path.length && preview.valid)
    hint = preview.exits
      ? '这条路线将安全撤离，随身宝石计入库存。'
      : preview.damage >= run.player.hp
        ? '这条路线会耗尽生命，随身宝石将全部失去。'
        : preview.damage
          ? `终点会受到 ${preview.attackers.length} 个危险水果攻击。可以回退，重新规划。`
          : preview.rewardValue
            ? '长链将生成宝石。记得在之后的路线中拾取它。'
            : '路线已保留。继续点击或拖动选线、右键回退，或按 GO。';
  if (
    !path.length &&
    run.status === 'playing' &&
    legalTargets(run).length === 0
  )
    hint = '当前位置没有可行动路线。可在菜单重试，生命会保留。';
  if (run.status === 'escaped') hint = '随身宝石已入库，当前生命已保存。';
  if (run.status === 'dead') hint = '本关行动结束，宝石库存和已通关记录保留。';
  if (inspectedEntityId)
    hint = '红色方框是这个危险水果的攻击范围。点击其他位置关闭。';
  $('hint').textContent = inspectedEntityId ? hint : message || hint;
  $('hint').classList.toggle('danger-text', preview.damage > 0);
  const notice = store.notice || assetError;
  $('notice').hidden = !notice;
  $('notice').textContent = notice;
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
    result.innerHTML = `<div class="result-card"><span class="result-symbol">${icons.gems}</span><span class="eyebrow">${next ? '关卡完成' : '两关已完成'}</span><h2>安全撤离</h2><p>切开 ${run.killCount} 个水果 · ${run.carriedGems} 宝石已入库</p><p class="result-note">剩余 ${run.player.hp} 点生命会带入下一次行动。</p>${next ? '<button id="next-level" class="primary">进入第二关 →</button>' : '<button id="choose-level" class="primary">选择关卡 →</button>'}<button id="replay-level" class="text-button">再玩这一关</button></div>`;
    if (next) $('next-level').onclick = () => beginLevel(next.id);
    else $('choose-level').onclick = openMenu;
    $('replay-level').onclick = () => beginLevel(run.levelId);
  } else {
    result.innerHTML = `<div class="result-card"><span class="result-symbol failure">${icons.close}</span><span class="eyebrow">行动结束</span><h2>生命已耗尽</h2><p>本关随身宝石已失去，库存宝石保留。</p><p class="result-note">本版尚未开放宝石回血。可在菜单重置整个存档，重新体验。</p><button id="death-menu" class="primary">打开菜单</button></div>`;
    $('death-menu').onclick = openMenu;
  }
}

async function commit(): Promise<void> {
  if (
    busy ||
    !renderer.assetsReady ||
    input.isDragging() ||
    dialog.open ||
    !path.length ||
    store.data.run.status !== 'playing'
  )
    return;
  inspectEntity(null);
  cancelScheduledRender();
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
        ? `受到了 ${before.player.hp - result.data.run.player.hp} 点伤害。注意危险水果的十字攻击范围。`
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
    `<div class="help-content"><p><b>规划</b>：点击水果，或按住鼠标左键、单指拖动，从武士连接八方向相邻的同种水果。路线可以交叉，但不能重复连接同一个目标。松开只保留路线，不会执行。</p><p><b>修改</b>：点击或回拖到之前已选的水果会截短路线；点击或拖回武士清空。松手后按右键、Backspace 或 Delete 退一步。不同种类的水果不影响已有路线。</p><p><b>行动</b>：按「GO」，或让棋盘获得焦点后按 Enter / 空格。主角停在路线终点，已选水果被切开，空位掉落补充。</p><p><b>宝石</b>：一条路线切开 10 / 15 / 20 / 25 个水果，分别生成价值 1 / 2 / 3 / 5 的宝石。宝石留在棋盘；经过它才能收集，并允许下一段切换水果种类。</p><p><b>危险</b>：点击带红色 ! 的危险水果时，能接入当前路线就优先连线，不显示攻击范围；无法接入时，用闪烁红框查看它上下左右四格的攻击范围。已选节点仍按路线回退规则处理。一次只查看一个，点击其他位置关闭。只要本轮没有切开它，停在其攻击范围内就会扣血；多个攻击会叠加。新变危险的水果到下一轮才会攻击。</p><p><b>撤离</b>：达标只打开出口。必须在之后的路线中连到顶部入口，再连出口，才能带走宝石。倒下会失去本关随身宝石。</p><p><b>生命</b>：换关、重试和刷新都不回血。宝石购买回血、装备与能力升级尚未开放。全新存档从 3 点生命开始。</p><div class="legend"><span>橙子</span><span>梨</span><span>黑莓</span><span>${icons.gems} 宝石</span></div></div>`,
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
      `<p class="dialog-copy">可以在当前棋盘继续学习，也可以回到第一关开场，从连接同种水果开始。</p><div class="dialog-actions"><button id="tutorial-resume" class="primary">继续当前引导</button><button id="tutorial-from-start" class="secondary">从头学习</button></div>`,
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
        return `<button data-level="${level.id}" class="level-option" ${!unlocked || profile.health === 0 ? 'disabled' : ''}><span class="level-option-number">0${index + 1}</span><span><b>${level.name}</b><small>${level.height} 行 × ${level.width} 列 · 切开 ${level.goal} 个水果${profile.clearedLevelIds.includes(level.id) ? ' · 已通关' : ''}</small></span><span>${unlocked ? icons.execute : icons.lock}</span></button>`;
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
    link.download = '连刃物语-存档.json';
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

executeButton.addEventListener('pointerdown', (event) => {
  if (
    event.button !== 0 ||
    event.isPrimary === false ||
    event.defaultPrevented ||
    executeButton.disabled ||
    input.isDragging()
  )
    return;
  // A fresh press after drawing commits immediately, without waiting for click.
  event.preventDefault();
  void commit();
});
executeButton.addEventListener('click', (event) => {
  // Pointer activation was already handled on press. Keep native keyboard and
  // assistive-technology clicks without submitting the same route twice.
  if (event.detail === 0) void commit();
});
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
    audio.stop();
  }
});
window.addEventListener('blur', () => inspectEntity(null));
window.addEventListener('pagehide', () => {
  presenter.finishImmediately();
  audio.stop();
});
render();
void renderer.ready.then(
  () => render(),
  (error: unknown) => {
    assetError = error instanceof Error ? error.message : '素材加载失败，请刷新重试。';
    render();
  },
);
void registerOfflineSupport();
