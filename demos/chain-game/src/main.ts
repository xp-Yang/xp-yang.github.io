import './assets/ui/font.css';
import './styles.css';
import {
  getLevel,
  getRunLevel,
  inspectPath,
  isElite,
  LEVELS,
  legalTargets,
  previewTurn,
  itemComboBonus,
  type GameEvent,
  type ItemKind,
  type RunState,
  type TurnPreview,
} from './core';
import {
  commitPath,
  getNextSessionLevelId,
  getAvailableEndlessLevelIds,
  isLevelUnlocked,
  newSession,
  startLevel,
  ensureShop,
  buyShopOffer,
  refreshShop,
  finishShop,
  getShopOfferState,
  selectComboItem,
  teleportItem,
  type SessionData,
} from './application/session';
import { SHOP_OFFERS, SHOP_REFRESH_PRICE, type ShopOfferId } from './application/shop';
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
import { LevelEntryPresenter } from './presentation/level-entry-presenter';
import { DamageFeedbackPresenter } from './presentation/damage-feedback';
import { GameAudio } from './presentation/game-audio';
import { TutorialPresenter } from './presentation/tutorial-presenter';
import { itemIcon } from './presentation/item-visual';

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
let enteringLevel = false;
let assetError = '';
let message = '';
let pendingAction: (() => void) | null = null;
let renderRequest = 0;
let teleportIndex: number | null = null;
let shopVisible = false;
let inventorySignature = '';
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
        <div class="gem-counter hud-plaque" role="group" aria-label="已收集宝石">${icons.gems}<div><strong id="carried">0</strong></div><span id="gem-multiplier" class="gem-multiplier" hidden>×2</span></div>
        <p id="objective-label" class="sr-only"></p>
      </section>
      <nav class="top-actions" aria-label="游戏菜单"><button class="icon-button" id="help-button" aria-label="玩法说明">${icons.help}</button><button class="icon-button" id="menu-button" aria-label="打开菜单">${icons.menu}</button></nav>
      <section class="inventory-panel" aria-label="道具栏，最多三个道具"><div class="inventory-bar" id="inventory"></div><p id="item-status" class="item-status" role="status" hidden></p></section>
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
const presenter = new AnimatedTurnPresenter(renderer, audio, new DamageFeedbackPresenter($('health')), () => {
  showItemFeedback('shield');
  renderInventory(true);
});
const levelEntry = new LevelEntryPresenter(renderer);
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
  undo: () => {
    if (teleportIndex !== null) cancelTeleport();
    else changePath({ type: 'undo' });
  },
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
  onMenu: () => {
    if (teleportIndex !== null) cancelTeleport();
    else openMenu();
  },
  tap: handleTap,
  onInteractionStart: () => inspectEntity(null),
});

function handleTap(id: string | null): void {
  if (busy || dialog.open || store.data.run.status !== 'playing') return;
  if (teleportIndex !== null) {
    if (id && id !== 'exit' && id !== 'player') void useTeleport(id);
    return;
  }
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
  if (busy || teleportIndex !== null || store.data.run.status !== 'playing') return false;
  inspectEntity(null);
  const next = editPath(store.data.run, path, command);
  if (next === path) return false;
  if (next.length > path.length &&
      store.data.run.entities[next[next.length - 1]]) {
    audio.count(inspectPath(store.data.run, next).chainCount);
  }
  path = next;
  message = '';
  updateControls();
  requestRender();
  return true;
}

const ITEM_NAMES: Record<ItemKind, string> = {
  shield: '护盾', teleport: '瞬移药水',
  'combo-3': '连击药水 +3', 'combo-5': '连击药水 +5', 'combo-10': '连击药水 +10',
};

function renderInventory(force = false): void {
  const run = store.data.run;
  const items = run.inventory ?? [];
  const locked = busy || !renderer.assetsReady || run.status !== 'playing' || dialog.open;
  const signature = JSON.stringify([items, run.selectedComboIndex, teleportIndex, locked]);
  if (!force && signature === inventorySignature) return;
  inventorySignature = signature;
  $('inventory').innerHTML = [0, 1, 2].map((index) => {
    const item = items[index];
    const selected = item && (run.selectedComboIndex === index || teleportIndex === index);
    const label = item ? `${ITEM_NAMES[item]}${item === 'shield' ? '，受击时自动使用' : selected ? '，再次点击取消' : '，点击使用'}` : '空道具栏';
    return `<button class="item-slot ${!item ? 'empty' : ''} ${selected ? 'selected' : ''}" data-item="${index}" aria-label="${label}" title="${label} · ${index + 1}" aria-keyshortcuts="${index + 1}" aria-pressed="${Boolean(selected)}" ${locked || !item ? 'disabled' : ''}>${item ? itemIcon(item) : ''}${item === 'shield' ? '<span class="item-auto" aria-hidden="true">A</span>' : ''}<kbd class="item-slot-key" aria-hidden="true">${index + 1}</kbd></button>`;
  }).join('');
  for (const button of $('inventory').querySelectorAll<HTMLButtonElement>('[data-item]'))
    button.onclick = () => selectInventoryItem(Number(button.dataset.item));
  const selected = run.selectedComboIndex === undefined ? undefined : items[run.selectedComboIndex];
  const status = teleportIndex !== null ? '选择瞬移落点 · 右键 / Esc 取消'
    : selected ? `下一条路线 +${itemComboBonus(selected)} 连击 · 执行后消耗` : '';
  $('item-status').hidden = !status || run.status !== 'playing';
  $('item-status').textContent = status;
}

function saveItemChange(next: SessionData): boolean {
  return next === store.data || store.save(next);
}

function selectInventoryItem(index: number): void {
  if (busy || input.isDragging() || dialog.open || store.data.run.status !== 'playing') return;
  const item = store.data.run.inventory?.[index];
  if (!item) return;
  if (item === 'shield') {
    message = '护盾将在受到攻击时自动使用，抵挡本轮全部攻击。';
    $('item-status').textContent = message;
    $('item-status').hidden = false;
    return;
  }
  input.cancelDrag();
  inspectEntity(null);
  if (item === 'teleport') {
    teleportIndex = teleportIndex === index ? null : index;
    render();
    canvas.focus({ preventScroll: true });
    return;
  }
  teleportIndex = null;
  try {
    const selected = store.data.run.selectedComboIndex === index ? null : index;
    if (!saveItemChange(selectComboItem(store.data, selected))) { render(); return; }
    // Removing a potion may invalidate an elite prefix that previously used it.
    while (path.length && !inspectPath(store.data.run, path).valid) path = path.slice(0, -1);
    render();
    canvas.focus({ preventScroll: true });
  } catch (error) { message = error instanceof Error ? error.message : '无法使用道具。'; render(); }
}

function cancelTeleport(): void {
  teleportIndex = null;
  render();
}

function showItemFeedback(kind: 'shield' | 'teleport'): void {
  const overlay = document.createElement('div');
  overlay.className = `${kind}-feedback`;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = itemIcon(kind);
  $('play-area').append(overlay);
  overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
  setTimeout(() => overlay.remove(), 750);
}

async function useTeleport(targetId: string): Promise<void> {
  if (teleportIndex === null || busy) return;
  try {
    const next = teleportItem(store.data, teleportIndex, targetId);
    if (!saveItemChange(next)) { render(); return; }
    teleportIndex = null;
    path = [];
    inspectedEntityId = null;
    message = '';
    showItemFeedback('teleport');
    audio.gemPickup(1);
    render();
    canvas.focus({ preventScroll: true });
  } catch (error) {
    message = error instanceof Error ? error.message : '请选择瞬移落点。';
    $('item-status').textContent = message;
    $('item-status').hidden = false;
  }
}

function openShop(note = ''): void {
  if (busy) return;
  const shop = store.data.shop;
  if (!shop || shop.closed) return;
  teleportIndex = null;
  const { profile } = store.data;
  shopVisible = true;
  openDialog('关间商店', `<section class="shop-panel"><div class="shop-header"><button class="secondary shop-refresh" id="shop-refresh" ${profile.bankedGems < SHOP_REFRESH_PRICE ? 'disabled' : ''}>刷新 ${icons.gems} ${SHOP_REFRESH_PRICE}</button><strong class="shop-wallet">${icons.gems} ${profile.bankedGems}</strong></div><div class="shop-offers">${shop.offers.map((id) => {
    const offer = SHOP_OFFERS.find((entry) => entry.id === id)!;
    const state = getShopOfferState(store.data, id);
    const healed = offer.healing ? Math.min(3, profile.health + offer.healing) - profile.health : 0;
    const description = offer.healing ? `回复 ${healed} 点生命 · ${profile.health} → ${Math.min(3, profile.health + offer.healing)} / 3` : offer.description;
    return `<article class="shop-offer ${shop.purchased.includes(id) ? 'purchased' : ''}"><div class="shop-item-visual">${itemIcon(id)}</div><h3 class="shop-name">${offer.name}</h3><p class="shop-effect">${description}</p><div class="shop-price">${icons.gems} ${offer.price}</div><button class="primary shop-buy" data-buy="${id}" ${state.disabled ? 'disabled' : ''}>${state.reason ?? '购买'}</button></article>`;
  }).join('')}</div>${note ? `<p class="shop-note" role="status">${note}</p>` : ''}<div class="shop-actions"><button class="primary" id="shop-next">下一关 ${icons.execute}</button></div></section>`);
  dialog.classList.add('shop-dialog');
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-buy]'))
    button.onclick = () => transactShop(() => buyShopOffer(store.data, button.dataset.buy as ShopOfferId), '购买成功');
  $('shop-refresh').onclick = () => transactShop(() => refreshShop(store.data), '商品已刷新');
  $('shop-next').onclick = leaveShop;
  renderInventory(true);
}

function transactShop(action: () => SessionData, note: string): void {
  if (busy || !shopVisible) return;
  try {
    const next = action();
    if (!store.save(next)) { openShop(store.notice); return; }
    audio.gemPickup(1);
    render();
    openShop(note);
  } catch (error) { openShop(error instanceof Error ? error.message : '购买失败。'); }
}

function leaveShop(): void {
  if (!shopVisible || busy) return;
  const nextId = store.data.shop?.nextLevelId;
  const next = finishShop(store.data);
  if (!saveItemChange(next)) { openShop(store.notice); return; }
  shopVisible = false;
  closeDialog();
  if (nextId) beginLevel(nextId);
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
    teleportIndex !== null ||
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
  renderInventory();
  tutorialPresenter.render(
    enteringLevel ? null : tutorialView,
    enteringLevel ? false : busy,
    input.isDragging() || dialog.open,
  );
  if (busy) {
    $('hint').textContent = enteringLevel ? '正在进入下一关…' : '沿路线行动中…';
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
  const level = getRunLevel(run);
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
  $('gem-multiplier').hidden = run.gemMultiplier !== 2;
  canvas.style.cursor = teleportIndex !== null ? 'crosshair' : '';
  $('objective-label').textContent = run.exitUnlocked
    ? '出口已打开 · 走到上方出口撤离'
    : level.elite
      ? `切开 ${level.goal} 个水果并击败精英，打开出口。精英${(run.eliteKills ?? 0) > 0 ? '已击败' : '尚未击败'}。`
      : `切开 ${level.goal} 个水果，打开出口`;
  $('objective-count').textContent = `${run.killCount} / ${level.goal}`;
  $('progress-fill').style.width =
    `${Math.min(100, (run.killCount / level.goal) * 100)}%`;
  $('route-preview').hidden = path.length === 0;
  $('chain-count').textContent = String(preview.chainCount);
  renderGeneratedGems(path.length ? preview.rewardCount : 0);
  $('route-summary').textContent = path.length
    ? `连击 ${preview.chainCount}，本轮生成 ${preview.rewardCount} 颗宝石`
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
    path: teleportIndex !== null ? [] : path,
    preview,
    inspectedEntityId,
    teleportSelecting: teleportIndex !== null,
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
  if (run.status === 'escaped')
    hint = '随身宝石已入库，正在前往下一关。';
  if (run.status === 'dead') hint = '本关行动结束，宝石库存和已通关记录保留。';
  if (inspectedEntityId) {
    const inspected = run.entities[inspectedEntityId];
    hint = inspected && isElite(inspected)
      ? `精英攻击周围八格，连接它时需要至少 ${level.elite?.minChain ?? 10} 连击。每堆宝石也计 1 连。`
      : '红色方框是这个危险水果的攻击范围。点击其他位置关闭。';
  }
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
  result.hidden = run.status !== 'dead';
  if (result.hidden) {
    result.replaceChildren();
    return;
  }
  result.innerHTML = `<div class="result-card"><span class="result-symbol failure">${icons.close}</span><span class="eyebrow">行动结束</span><h2>生命已耗尽</h2><p>本关随身宝石已失去，库存宝石保留。</p><p class="result-note">生命回复可在通关后的商店购买。此次行动已结束，可在菜单重置进度。</p><button id="death-menu" class="primary">打开菜单</button></div>`;
  $('death-menu').onclick = openMenu;
}

async function commit(): Promise<void> {
  if (
    busy ||
    teleportIndex !== null ||
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
        ? `受到了 ${before.player.hp - result.data.run.player.hp} 点伤害。普通危险水果攻击上下左右，精英攻击周围八格。`
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
    renderer.setAnimation(null);
    render();
  }
  if (committed) continueAfterExit();
}

/** The previous exit is settled before a new run is created and saved. */
function continueAfterExit(): void {
  if (busy || !renderer.assetsReady || store.data.run.status !== 'escaped') return;
  const prepared = ensureShop(store.data);
  if (prepared !== store.data && !store.save(prepared)) { render(); return; }
  if (store.data.shop && !store.data.shop.closed) { openShop(); return; }
  const nextId = getNextSessionLevelId(store.data);
  if (nextId) beginLevel(nextId);
}

async function playLevelEntry(): Promise<void> {
  if (busy || !renderer.assetsReady || store.data.run.status !== 'playing') return;
  const run = store.data.run;
  const levelNumber = getRunLevel(run).levelNumber;
  cancelScheduledRender();
  busy = true;
  enteringLevel = true;
  tutorialView = null;
  updateControls();
  const controller = new AbortController();
  if (document.hidden) controller.abort();
  try {
    await levelEntry.play(run, levelNumber, controller.signal);
  } catch {
    levelEntry.finishImmediately();
  } finally {
    enteringLevel = false;
    busy = false;
    render();
  }
}

function beginLevel(levelId: string): boolean {
  if (busy) return false;
  input.cancelDrag();
  teleportIndex = null;
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
    renderer.setAnimation(null);
    render();
    void playLevelEntry();
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
  dialog.classList.remove('shop-dialog');
  $('dialog-title').textContent = title;
  $('dialog-body').innerHTML = html;
  if (!dialog.open) dialog.showModal();
  updateControls();
}
function closeDialog(): void {
  if (shopVisible) { leaveShop(); return; }
  dialog.classList.remove('shop-dialog');
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
    `<div class="help-content"><p><b>规划</b>：点击水果，或按住鼠标左键、单指拖动，从武士连接八方向相邻的同种水果。路线可以交叉，但不能重复连接同一个目标。松开只保留路线，不会执行。</p><p><b>修改</b>：点击或回拖到之前已选的水果会截短路线；点击或拖回武士清空。松手后按右键、Backspace 或 Delete 退一步。不同种类的水果不影响已有路线。</p><p><b>行动</b>：按「GO」，或让棋盘获得焦点后按 Enter / 空格。主角停在路线终点，已选水果被切开，空位掉落补充。</p><p><b>宝石</b>：一条路线达到 10 / 15 / 20 / 25 连击，分别生成价值 1 / 2 / 3 / 5 的宝石。每个水果或每堆宝石都计 1 次连击，出口不计。宝石留在棋盘；经过它才能收集，并允许下一段切换水果种类。</p><p><b>危险</b>：点击带红色 ! 的危险水果时，能接入当前路线就优先连线，不显示攻击范围；无法接入时，用闪烁红框查看它上下左右四格的攻击范围。已选节点仍按路线回退规则处理。一次只查看一个，点击其他位置关闭。只要本轮没有切开它，停在其攻击范围内就会扣血；多个攻击会叠加。新变危险的水果到下一轮才会攻击。</p><p><b>愤怒出现</b>：第 N 关少于 min(3 + N, 8) 连击时，前两次各随机变异 1 个现有平静水果，第三次起各变异 2 个。次数在本关累计，长连击不清零；水果和宝石堆都计 1 连。击杀进度达到目标的 max(1/N, 1/10) 后，每个补位普通水果有 1/15 概率愤怒。新变异和新补位的愤怒水果都从下一轮开始攻击。</p><p><b>精英</b>：第三关及后续守门关门口的金冠水果始终愤怒，攻击周围八格；接入它时必须已达到 10 连击（包含它自己，宝石堆计 1 连），水果种类仍需匹配。精英不会被宝石砸死。首次击败精英且累计切开数量达到本关目标后开门（第三关为 60）；之后无精英时，每个新补位水果有 1/40 概率成为精英，场上最多一个。</p><p><b>撤离</b>：已有击杀加当前路线水果达到目标时，可在同一条路线连到顶部入口，再拖向门并按 GO 直接撤离。拖到门上会预览开锁，撤回则复锁；此前已解锁的门保持开启。倒下会失去本关随身宝石。</p><p><b>生命</b>：换关、重试和刷新都不回血。第二关起通关后可在商店花宝石回复生命、购买道具或下一关双倍宝石；5 宝石可刷新商品。全新存档从 3 点生命开始。</p><p><b>道具</b>：右侧最多持有三个道具，可点击槽位或在棋盘获得焦点后按 1 / 2 / 3 选择。护盾自动抵挡一次路线结束后的全部攻击；点击瞬移药水再点击普通水果或宝石即可交换位置，不推进回合，右键或 Esc 取消。连击药水点选后为下一次路线增加连击，执行时才消耗，再点一次可取消；不增加实际击杀。</p><div class="legend"><span>橙子</span><span>梨</span><span>黑莓</span><span>${icons.gems} 宝石</span></div></div>`,
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
  if (store.data.run.status === 'escaped' && store.data.shop && !store.data.shop.closed) {
    openShop(); return;
  }
  teleportIndex = null;
  const { run, profile } = store.data;
  const menuLevels = [...LEVELS, ...getAvailableEndlessLevelIds(store.data).map((id) =>
    id === run.levelId ? getRunLevel(run) : getLevel(id),
  )];
  openDialog(
    '行囊与关卡',
    `<div class="menu-summary"><span>生命 ${profile.health} / 3</span><span>宝石库存 ${profile.bankedGems}</span></div><div class="level-list">${menuLevels.map(
      (level) => {
        const unlocked = isLevelUnlocked(store.data, level.id);
        return `<button data-level="${level.id}" class="level-option" ${!unlocked || profile.health === 0 ? 'disabled' : ''}><span class="level-option-number">${String(level.levelNumber).padStart(2, '0')}</span><span><b>${level.name}</b><small>${level.height} 行 × ${level.width} 列 · 切开 ${level.goal} 个水果${level.elite ? '＋击败精英' : ''}${profile.clearedLevelIds.includes(level.id) ? ' · 已通关' : level.id === run.levelId ? ' · 当前关卡' : level.generation ? ' · 继续前进' : ''}</small></span><span>${unlocked ? icons.execute : icons.lock}</span></button>`;
      },
    ).join(
      '',
    )}</div><p class="dialog-copy">重试、换关均保留当前生命。离开未完成的关卡会失去随身宝石；成功撤离后自动进入下一关。第四关起持续生成新关卡，守门关需要击败精英。</p><button id="tutorial-restart" class="secondary" ${profile.health === 0 ? 'disabled' : ''}>${run.levelId === LEVELS[0].id && run.status === 'playing' ? '重看新手引导' : '进入教程关'}</button><div class="menu-tools"><button id="export-save" class="secondary">导出存档</button><button id="reset-save" class="text-button danger-text">重置全部进度</button></div>`,
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
        void playLevelEntry();
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
canvas.addEventListener('keydown', (event) => {
  if (document.activeElement !== canvas || event.target !== canvas ||
      event.repeat || event.ctrlKey || event.altKey || event.metaKey ||
      busy || dialog.open || !renderer.assetsReady) return;
  const index = ['1', '2', '3'].indexOf(event.key);
  if (index < 0) return;
  event.preventDefault();
  selectInventoryItem(index);
});
$('menu-button').onclick = openMenu;
$('help-button').onclick = openHelp;
$('close-dialog').onclick = closeDialog;
dialog.addEventListener('close', () => {
  pendingAction = null;
  shopVisible = false;
  dialog.classList.remove('shop-dialog');
  updateControls();
});
dialog.addEventListener('cancel', (event) => {
  if (shopVisible) { event.preventDefault(); leaveShop(); }
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
    levelEntry.finishImmediately();
    audio.stop();
  }
});
window.addEventListener('blur', () => inspectEntity(null));
window.addEventListener('pagehide', () => {
  presenter.finishImmediately();
  levelEntry.finishImmediately();
  audio.stop();
});
render();
void renderer.ready.then(
  () => {
    render();
    // A reload between exit settlement and the next save resumes progression.
    // An untouched run replays only its visuals, never regenerates its board.
    if (store.data.run.status === 'escaped') continueAfterExit();
    else if (store.data.run.status === 'playing' && store.data.run.turn === 0)
      void playLevelEntry();
  },
  (error: unknown) => {
    assetError = error instanceof Error ? error.message : '素材加载失败，请刷新重试。';
    render();
  },
);
void registerOfflineSupport();
