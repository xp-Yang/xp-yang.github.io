import '@/components/ui/styles.css';
import './styles.css';
import { mountWorkControls } from './work-controls.tsx';
import { createRenderer } from './renderer.js';

const defaults = {
  count: 384, radius: 0.25, density: 1, packing: 0.025,
  virial: 0, rotation: 0, distribution: 'uniform', seed: 42, restitution: 1,
  G: 1, theta: 0.55, maxDt: 0.016, travelFraction: 0.2, forceBackend: 'webgpu',
};
const app = document.querySelector('#app');
const embedded = new URLSearchParams(window.location.search).get('embed') === '1';
app.classList.toggle('embedded', embedded);
function slider(id, title, min, max, step, value, unit = '', help = '') {
  return `<div class="control"><span class="control-label">${title}<output id="${id}-value">${value}${unit}</output></span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />${help ? `<small>${help}</small>` : ''}</div>`;
}
const iconPaths = {
  play: '<path d="M8 4l12 8-12 8Z" />',
  pause: '<path d="M8 4v16M16 4v16" />',
  step: '<path d="M4 4l12 8-12 8ZM20 4v16" />',
  restart: '<path d="M5 8a8 8 0 1 1-1 4M5 4v4h4" />',
  focus: '<circle cx="12" cy="12" r="6" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" />',
  info: '<circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" />',
  right: '<path d="m9 5 7 7-7 7" />',
  left: '<path d="m15 5-7 7 7 7" />',
};
function icon(name) {
  return `<svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconPaths[name]}</svg>`;
}
app.innerHTML = `
  ${embedded ? '' : `<header class="topbar">
    <div class="wordmark"><span class="mark" aria-hidden="true">◌</span> YANG<span class="divider">/</span><span class="wordmark-sub">LABORATORY</span></div>
    <div class="topbar-right"><span class="local-badge">本地实验</span><button id="about" class="text-button">模型说明 <span aria-hidden="true">↗</span></button></div>
  </header>`}
  <main class="workspace">
    <section class="stage" aria-label="三维引力模拟">
      <div id="viewport" class="viewport"></div>
      <div class="view-tools">
        <span class="fps-badge"><b id="fps">—</b> <span>FPS</span></span>
        <button id="fit" class="icon-button" aria-label="聚焦全部小球" title="聚焦全部小球">${icon('focus')}</button>
        ${embedded ? `<button id="about" class="icon-button" aria-label="模型说明" title="模型说明">${icon('info')}</button>` : ''}
      </div>
      <aside id="live-panel" class="live-panel" aria-label="参数调节">
        <button id="live-panel-toggle" class="live-panel-toggle" aria-expanded="true" aria-controls="live-panel-body" aria-label="收起参数调节" title="收起参数调节">
          <span class="live-panel-title">参数调节</span>
          <span class="live-panel-minimize" data-panel-icon="minus" aria-hidden="true"></span>
          <span class="live-panel-restore" data-panel-icon="parameters" aria-hidden="true"></span>
        </button>
        <div id="live-panel-body" class="live-panel-body">
          <div id="live-parameters" class="live-parameters">
          ${slider('density', '小球密度', 0.25, 4, 0.05, 1)}
          ${slider('restitution', '碰撞恢复系数 e', 0, 1, 0.01, 1)}
          ${slider('speed', '时间倍速', 0.1, 20, 0.1, 1, '×')}
          <p class="speed-note">实际推进 <span id="actual-speed">—</span><span id="budget-note"></span></p>
          <div class="select-control">引力计算<select id="solver"><option value="webgpu" selected>WebGPU · 并行求和</option><option value="tree">近似加速 · 八叉树</option><option value="direct">直接求和 · 无求力近似</option></select></div>
          ${slider('theta', '引力近似开角 θ', 0.2, 0.9, 0.05, 0.55, '', '越小通常越准、越慢；θ 不是误差百分比。')}
          <div class="select-control">时间精度<select id="timestep"><option value="0.032">流畅 · 最大步长 0.032 s</option><option value="0.016" selected>均衡 · 最大步长 0.016 s</option><option value="0.008">精细 · 最大步长 0.008 s</option></select></div>
          <div class="toggle-row"><label for="trails">显示少量运动轨迹</label><input id="trails" type="checkbox" role="switch" /></div>
          <div class="select-control">渲染清晰度<select id="quality"><option value="auto">自动</option><option value="high">清晰</option><option value="low">节能</option></select></div>
          </div>
          <section id="live-errors" class="control-section diagnostics-section" aria-labelledby="diagnostics-heading">
            <div class="section-heading"><h2 id="diagnostics-heading">数值观察</h2><span class="section-no">约每秒更新</span></div>
            <div class="diagnostics">
              <div><span>计算方式</span><output id="force-backend">—</output></div>
              <div><span>求力偏差 RMS</span><output id="force-error">—</output></div>
              <div><span>归一化能量漂移</span><output id="energy-error">—</output></div>
              <div><span>归一化动量偏差</span><output id="momentum-error">—</output></div>
              <div><span>物理计算 / 批次</span><output id="compute-time">—</output></div>
            </div>
            <p class="diagnostic-note">能量漂移已扣除碰撞耗散。基线在开始运行时建立；改变密度会重建基线。</p>
          </section>
        </div>
      </aside>
      <div class="stage-bottom">
        <div class="readouts">
          <div><span class="readout-label">SIMULATION TIME</span><strong id="time">0.00<span>s</span></strong></div>
          <div><span class="readout-label">COLLISIONS</span><strong id="collisions">0</strong></div>
          <div><span class="readout-label">BODIES</span><strong id="body-count">384</strong></div>
        </div>
        <div class="transport">
          <button id="pause" class="icon-button" aria-label="暂停模拟" title="暂停" disabled><span id="pause-icon" data-icon="pause">${icon('pause')}</span></button>
          <button id="step" class="icon-button" aria-label="单步推进" title="暂停后单步推进" disabled>${icon('step')}</button>
          <button id="restart" class="icon-button" aria-label="重新开始当前模型" title="重新开始当前模型">${icon('restart')}</button>
        </div>
      </div>
      <div id="error" class="error-banner" role="alert" hidden></div>
    </section>
    <aside id="initial-panel" class="panel" aria-label="初始条件">
      <button id="initial-panel-open" class="initial-panel-open" aria-expanded="false" aria-controls="initial-panel-body" aria-label="展开初始条件面板" title="展开初始条件面板" hidden><span data-panel-icon="left" aria-hidden="true"></span></button>
      <button id="initial-panel-close" class="panel-heading" aria-expanded="true" aria-controls="initial-panel-body" aria-label="收起初始条件面板" title="收起初始条件面板"><span id="initial-heading" class="panel-heading-title">初始条件</span><span id="pending-label" class="pending-label" hidden>待应用</span><span class="panel-heading-icon" data-panel-icon="right" aria-hidden="true"></span></button>
      <div id="initial-panel-body" class="panel-scroll">
        <section class="control-section" aria-labelledby="initial-heading">
          <div class="select-control">位置分布
            <select id="distribution">
              <option value="uniform">均匀球云</option><option value="shell">均匀球壳</option><option value="disk">均匀圆盘</option><option value="symmetric-shell">对称球壳</option><option value="ring">对称圆环</option>
            </select>
          </div>
          ${slider('count', '小球数量', 2, 1000, 1, 384)}
          ${slider('packing', '初始紧密度', 0.005, 0.06, 0.005, 0.025)}
          ${slider('virial', '初始运动强度', 0, 2, 0.05, 0)}
          ${slider('rotation', '整体旋转', 0, 0.95, 0.05, 0)}
          <div class="seed-row"><label for="seed">随机种子</label><input id="seed" type="number" value="42" min="1" max="999999" step="1" /><button id="new-seed" class="text-button" title="更换随机种子">换一个 ↗</button></div>
          <button id="apply" class="apply-button">应用 <span aria-hidden="true">↗</span></button>
        </section>
      </div>
    </aside>
  </main>
  <dialog id="about-dialog" aria-label="模型说明">
    <button id="close-about" class="dialog-close" aria-label="关闭模型说明">×</button>
    <p class="eyebrow">ABOUT THIS EXPERIMENT</p>
    <p>每个球受其他所有球的牛顿引力，接触时进行无摩擦碰撞，保留切向速度。恢复系数 e 可实时调整：e = 1 为完全弹性碰撞；e 越小，碰撞损失的动能越多；e = 0 时碰撞后的法向相对速度为 0，小球仍不合并。</p>
    <p>远处的球团可以用总质量与质心近似。降低开角 θ 可改善求力精度；“直接求和”关闭这项近似，适合小数量比较。求力偏差来自小样本与直接计算的对照，不是全系统误差保证。</p>
    <p>时间倍速通过增加计算量实现。计算跟不上时，实际倍速会下降，不会用更大的时间步长跳过碰撞。能量漂移补偿累计碰撞耗散后，以初始动能与势能绝对值之和归一化，反映积分和求力近似误差。</p>
    <p>碰撞在每个小时间步内按接触时间处理；引力在步内由数值积分近似。严格同时发生的多球接触采用固定顺序处理，是这个演示的数值近似。</p>
    <p>小球半径固定为 0.25，初始球云范围与半径独立。所有分布生成时均避免小球重叠，随机分布遇到重叠位置会重新采样。初始运动强度和整体旋转默认为 0，均可调整；初始速度按运动强度归一化，开始运行时建立能量基线。</p>
    <p class="dialog-muted">长度、质量和时间使用归一化单位，G = 1；无引力软化、无额外阻尼、无周期回绕。</p>
  </dialog>
`;

const $ = (id) => document.getElementById(id);
$('theta').disabled = $('solver').value !== 'tree';
let activeConfig = { ...defaults };
let epoch = 0;
let request = 0;
let pending = false;
let pendingRequest = 0;
let paused = false;
let ready = false;
let failed = false;
let graphicsReady = true;
let accumulatedReal = 0;
let accumulatedSimulation = 0;
let lastSpeedAt = performance.now();
let lastRateFrame = performance.now();
let lastComputeMs = 0;
let runtimeDirty = false;
let animationId;
const cleanup = new AbortController();
const on = (element, event, handler) => element.addEventListener(event, handler, { signal: cleanup.signal });

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = false;
  failed = true;
  pending = false;
  syncPlayback();
  updateTransport();
}

let renderer;
let worker;
try {
  renderer = createRenderer($('viewport'), {
    onError: showError,
    onFps: (fps) => { $('fps').textContent = fps; },
    onContextState: (available) => {
      graphicsReady = available;
      if (!failed) {
        $('error').textContent = '三维画面暂时中断，正在等待显卡恢复。';
        $('error').hidden = available;
      }
      resetRate();
      updateTransport();
      syncPlayback();
    },
  });
  worker = new Worker(new URL('./simulation.worker.js', import.meta.url), { type: 'module' });
} catch (error) {
  showError(`无法启动三维模拟：${error.message}`);
}

function updateTransport() {
  $('pause').disabled = !ready || failed;
  $('pause').setAttribute('aria-label', paused ? '继续模拟' : '暂停模拟');
  $('pause').title = paused ? '继续' : '暂停';
  const playbackIcon = paused ? 'play' : 'pause';
  if ($('pause-icon').dataset.icon !== playbackIcon) {
    $('pause-icon').innerHTML = icon(playbackIcon);
    $('pause-icon').dataset.icon = playbackIcon;
  }
  $('step').disabled = !ready || !paused || pending || failed || !graphicsReady;
}

function resetRate() {
  lastRateFrame = lastSpeedAt = performance.now();
  accumulatedReal = accumulatedSimulation = 0;
  $('actual-speed').textContent = paused || document.hidden ? '0.00×' : '—';
  $('budget-note').textContent = '';
}

function syncPlayback() {
  if (!worker || !ready) return;
  worker.postMessage({
    type: 'playback', epoch,
    running: !paused && !document.hidden && !failed && graphicsReady,
    speed: Number($('speed').value),
  });
}

function readInitial() {
  const seed = Number($('seed').value);
  if (!Number.isInteger(seed) || seed < 1 || seed > 999999) {
    (document.getElementById('seed-ui') ?? $('seed')).reportValidity();
    throw new Error('随机种子须为 1 到 999999 之间的整数。');
  }
  return {
    count: Number($('count').value), radius: 0.25,
    packing: Number($('packing').value), virial: Number($('virial').value),
    rotation: Number($('rotation').value), distribution: $('distribution').value, seed,
  };
}

function runtimeConfig() {
  return {
    density: Number($('density').value),
    restitution: Number($('restitution').value),
    forceBackend: $('solver').value,
    theta: $('solver').value === 'direct' ? 0 : Number($('theta').value),
    maxDt: Number($('timestep').value),
  };
}

function reset(reuse = false) {
  if (!worker) return;
  try {
    const next = { ...activeConfig, ...(!reuse ? readInitial() : {}), ...runtimeConfig() };
    activeConfig = next;
    epoch++;
    ready = false;
    failed = false;
    pending = true;
    $('error').hidden = true;
    if (!reuse) $('pending-label').hidden = true;
    resetRate();
    renderer?.resetTrails();
    $('actual-speed').textContent = '—';
    $('budget-note').textContent = '';
    pendingRequest = ++request;
    worker.postMessage({ type: 'reset', epoch, request: pendingRequest, config: next });
    updateTransport();
  } catch (error) { showError(error.message); }
}

function percent(value, signed = false) {
  if (!Number.isFinite(value)) return '—';
  const percentage = value * 100;
  const magnitude = Math.abs(percentage);
  const formatted = magnitude > 0 && magnitude < .00001 ? percentage.toExponential(2)
    : percentage.toFixed(magnitude > 0 && magnitude < .001 ? 6 : 3);
  return `${signed && value > 0 ? '+' : ''}${formatted}%`;
}

function updateMetrics(data) {
  $('time').innerHTML = `${data.time.toFixed(2)}<span>s</span>`;
  $('collisions').textContent = data.collisions.toLocaleString();
  $('body-count').textContent = data.count.toLocaleString();
  const backendLabels = { webgpu: 'WebGPU · 引力与碰撞', tree: 'CPU · 八叉树', direct: 'CPU · 直接求和' };
  $('force-backend').textContent = backendLabels[data.forceBackend] ?? '—';
  $('force-backend').title = data.forceBackendDetail ?? '';
  const stats = data.diagnostics;
  if (stats) {
    $('force-error').textContent = percent(stats.forceError);
    $('energy-error').textContent = percent(stats.energyDrift, true);
    $('momentum-error').textContent = percent(stats.momentumError);
    if (stats.status === 'stopped' || data.status === 'stopped') showError(stats.detail || '接触过于密集，已安全停止。请降低初始紧密度后重新开始。');
  }
  if (data.type === 'frame') {
    lastComputeMs = lastComputeMs * 0.65 + data.computeMs * 0.35;
    $('compute-time').textContent = `${lastComputeMs.toFixed(1)} ms`;
    if (!paused && !document.hidden) accumulatedSimulation += data.advanced;
  }
}

if (worker) {
  on(worker, 'message', ({ data }) => {
    if (data.epoch !== epoch) return;
    if (data.type === 'error') { showError(data.message); return; }
    if (data.type === 'gpu-paused') {
      paused = true;
      failed = false;
      pending = false;
      $('error').textContent = data.message;
      $('error').hidden = false;
      resetRate();
      updateTransport();
      syncPlayback();
      return;
    }
    if (data.type === 'playback') { resetRate(); return; }
    if (data.request !== null && data.request === pendingRequest) pending = false;
    ready = true;
    if (data.type === 'ready') resetRate();
    renderer.setSnapshot(data.positions, { count: data.count, radius: data.radius, bounds: data.diagnostics?.bounds });
    updateMetrics(data);
    updateTransport();
    if (data.type === 'ready' && runtimeDirty) { runtimeDirty = false; configure(); }
    if (data.type === 'ready') syncPlayback();
  });
  on(worker, 'error', () => showError('后台模拟未能运行，请刷新或重新启动本地网页。'));
}

const sliderDigits = { count: 0, packing: 3, virial: 2, rotation: 2, density: 2, restitution: 2, speed: 1, theta: 2 };
for (const [id, digits] of Object.entries(sliderDigits)) {
  const update = () => {
    let value = Number($(id).value).toFixed(digits);
    if (id === 'speed') value += '×';
    if (id === 'packing' || id === 'rotation') value = `${(Number($(id).value) * 100).toFixed(id === 'packing' ? 1 : 0)}%`;
    $(`${id}-value`).textContent = value;
  };
  on($(id), 'input', update);
  update();
}

for (const id of ['count', 'packing', 'virial', 'rotation', 'seed', 'distribution']) {
  on($(id), 'input', () => {
    $('pending-label').hidden = false;
  });
}
function configure() {
  $('theta').disabled = $('solver').value !== 'tree';
  if (!worker || failed) return;
  if (!ready) { runtimeDirty = true; return; }
  activeConfig = { ...activeConfig, ...runtimeConfig() };
  worker.postMessage({ type: 'configure', epoch, request: ++request, config: runtimeConfig() });
}
for (const id of ['density', 'theta', 'solver', 'timestep']) on($(id), 'change', configure);
on($('restitution'), 'input', configure);
on($('speed'), 'input', () => { resetRate(); syncPlayback(); });
on($('apply'), 'click', () => reset());
on($('restart'), 'click', () => reset(true));
on($('new-seed'), 'click', () => { $('seed').value = 1 + Math.floor(Math.random() * 999998); $('seed').dispatchEvent(new Event('input', { bubbles: true })); });
on($('pause'), 'click', () => { paused = !paused; resetRate(); updateTransport(); syncPlayback(); });
on($('step'), 'click', () => {
  if (!ready || pending || !paused || failed || !graphicsReady) return;
  pending = true;
  pendingRequest = ++request;
  worker.postMessage({ type: 'advance', epoch, request: pendingRequest, duration: activeConfig.maxDt, budgetMs: 100 });
  updateTransport();
});
on($('fit'), 'click', () => renderer?.fit());
on($('trails'), 'change', () => renderer?.setTrails($('trails').checked));
on($('quality'), 'change', () => renderer?.setQuality($('quality').value));
on($('about'), 'click', () => $('about-dialog').showModal());
on($('close-about'), 'click', () => $('about-dialog').close());
on($('about-dialog'), 'click', (event) => { if (event.target === $('about-dialog')) $('about-dialog').close(); });
let livePanelPosition;
let livePanelDrag;
let suppressLivePanelClick = false;
function placeLivePanel(left, top) {
  const panel = $('live-panel'), stage = panel.parentElement;
  const inset = 8;
  const x = Math.max(inset, Math.min(left, stage.clientWidth - panel.offsetWidth - inset));
  const y = Math.max(inset, Math.min(top, stage.clientHeight - panel.offsetHeight - inset));
  livePanelPosition = { left: x, top: y };
  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;
  panel.style.right = 'auto';
}
on($('live-panel-toggle'), 'pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  suppressLivePanelClick = false;
  const bounds = $('live-panel').getBoundingClientRect();
  const stageBounds = $('live-panel').parentElement.getBoundingClientRect();
  livePanelDrag = {
    pointerId: event.pointerId, x: event.clientX, y: event.clientY,
    left: bounds.left - stageBounds.left, top: bounds.top - stageBounds.top, moved: false,
  };
  $('live-panel-toggle').setPointerCapture(event.pointerId);
});
on($('live-panel-toggle'), 'pointermove', (event) => {
  if (!livePanelDrag || event.pointerId !== livePanelDrag.pointerId) return;
  const dx = event.clientX - livePanelDrag.x, dy = event.clientY - livePanelDrag.y;
  if (!livePanelDrag.moved && Math.hypot(dx, dy) < 5) return;
  livePanelDrag.moved = true;
  suppressLivePanelClick = true;
  $('live-panel').classList.add('dragging');
  placeLivePanel(livePanelDrag.left + dx, livePanelDrag.top + dy);
  event.preventDefault();
});
function finishLivePanelDrag(event) {
  if (!livePanelDrag || event.pointerId !== livePanelDrag.pointerId) return;
  livePanelDrag = undefined;
  $('live-panel').classList.remove('dragging');
  if ($('live-panel-toggle').hasPointerCapture(event.pointerId)) {
    $('live-panel-toggle').releasePointerCapture(event.pointerId);
  }
}
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  on($('live-panel-toggle'), event, finishLivePanelDrag);
}
const livePanelResize = new ResizeObserver(() => {
  if (livePanelPosition) placeLivePanel(livePanelPosition.left, livePanelPosition.top);
});
livePanelResize.observe($('live-panel'));
livePanelResize.observe($('live-panel').parentElement);
on($('live-panel-toggle'), 'click', (event) => {
  if (suppressLivePanelClick && event.detail !== 0) {
    suppressLivePanelClick = false;
    return;
  }
  suppressLivePanelClick = false;
  const collapsed = $('live-panel').classList.toggle('collapsed');
  $('live-panel-body').hidden = collapsed;
  $('live-panel-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('live-panel-toggle').setAttribute('aria-label', collapsed ? '展开参数调节' : '收起参数调节');
  $('live-panel-toggle').title = collapsed ? '展开参数调节' : '收起参数调节';
});
const initialPanelMedia = window.matchMedia('(max-width: 1100px)');
let desktopInitialCollapsed = false;
let mobileInitialOpen = false;
function updateInitialPanel() {
  const mobile = initialPanelMedia.matches;
  const open = mobile ? mobileInitialOpen : !desktopInitialCollapsed;
  app.classList.toggle('initial-panel-collapsed', !open);
  $('initial-panel-body').inert = !open;
  $('initial-panel-body').setAttribute('aria-hidden', String(!open));
  $('initial-panel-open').hidden = mobile || open;
  $('initial-panel-open').setAttribute('aria-expanded', String(open));
  $('initial-panel-close').setAttribute('aria-expanded', String(open));
  $('initial-panel-close').setAttribute('aria-label', open ? '收起初始条件面板' : '展开初始条件面板');
  $('initial-panel-close').title = open ? '收起初始条件面板' : '展开初始条件面板';
  $('initial-panel-close').inert = !mobile && !open;
}
function toggleInitialPanel() {
  if (initialPanelMedia.matches) mobileInitialOpen = !mobileInitialOpen;
  else desktopInitialCollapsed = !desktopInitialCollapsed;
  updateInitialPanel();
  if ($('initial-panel-body').inert && !initialPanelMedia.matches) $('initial-panel-open').focus();
  else $('initial-panel-close').focus();
}
on($('initial-panel-open'), 'click', toggleInitialPanel);
on($('initial-panel-close'), 'click', toggleInitialPanel);
on(initialPanelMedia, 'change', updateInitialPanel);
updateInitialPanel();
on(document, 'visibilitychange', () => { resetRate(); updateTransport(); syncPlayback(); });
on(document, 'keydown', (event) => {
  if (event.code === 'Space' && !/INPUT|SELECT|BUTTON|TEXTAREA/.test(event.target.tagName) && !$('about-dialog').open && ready && !failed) {
    event.preventDefault();
    paused = !paused;
    resetRate();
    updateTransport();
    syncPlayback();
  }
});

function tick(now) {
  animationId = requestAnimationFrame(tick);
  const elapsedReal = (now - lastRateFrame) / 1000;
  lastRateFrame = now;
  if (!ready || paused || document.hidden || failed || !graphicsReady || !worker) return;
  accumulatedReal += elapsedReal;
  if (now - lastSpeedAt > 850) {
    const actual = accumulatedReal > 0 ? accumulatedSimulation / accumulatedReal : 0;
    $('actual-speed').textContent = `${actual.toFixed(2)}×`;
    $('budget-note').textContent = actual < Number($('speed').value) * 0.8 ? ' · 当前计算量受限' : '';
    accumulatedSimulation = accumulatedReal = 0;
    lastSpeedAt = now;
  }
}
animationId = requestAnimationFrame(tick);
reset();
const disposeWorkControls = mountWorkControls();

function dispose() {
  cancelAnimationFrame(animationId);
  worker?.terminate();
  renderer?.dispose();
  livePanelResize.disconnect();
  cleanup.abort();
  disposeWorkControls();
}
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); });
