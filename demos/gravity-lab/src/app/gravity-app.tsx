import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight, ChevronLeftIcon, ChevronRightIcon, MinusIcon, RotateCcw,
  SlidersHorizontal, Button, NumericControl, ToggleControl, Select,
  SelectContent, SelectItem, SelectTrigger, SelectValue,
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui';
import { createRuntime } from '../runtime/create-runtime.js';
import { DEFAULT_INITIAL, DISTRIBUTIONS } from './config.js';
import { ParticleCountControl } from './particle-count-control';
import { PARTICLE_RADIUS, PARTICLE_MASS } from '../physics/constants.js';

type InitialConfig = {
  count: number; packing: number; virial: number; seed: number; distribution: string;
  G: number; restitution: number; collisionless: boolean; softeningRatio: number;
  forceBackend: string;
};
type Quality = 'auto' | 'high' | 'low';
type Metrics = {
  ready: boolean; paused: boolean; loading: boolean; time: number; collisions: number;
  count: number; fps: number | null; actualSpeed: number | null; computeMs: number | null;
  computeLabel?: string; renderMs?: number | null; forceBackend?: string; forceBackendDetail?: string;
  status?: string; detail?: string;
  diagnostics?: { energyDrift?: number | null; momentumError?: number | null; forceError?: number | null } | null;
};
type Runtime = {
  apply(config: InitialConfig): Promise<void>; restart(): Promise<void>;
  setSpeed(value: number): void; setPaused(value: boolean): void; step(): void;
  setTrails(value: boolean): void; setQuality(value: Quality): void;
  setDiagnostics(value: boolean): void; focus(): void; dispose(): void;
};
const initialMetrics: Metrics = {
  ready: false, paused: false, loading: true, time: 0, collisions: 0,
  count: DEFAULT_INITIAL.count, fps: null, actualSpeed: null, computeMs: null,
};
const paths: Record<string, ReactNode> = {
  play: <path d="M8 4l12 8-12 8Z" />,
  pause: <path d="M8 4v16M16 4v16" />,
  step: <path d="M4 4l12 8-12 8ZM20 4v16" />,
  focus: <><circle cx="12" cy="12" r="6" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
};
function Icon({ name }: { name: string }) {
  return <svg className="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Choice({ label, value, options, onChange }: {
  label: string; value: string; options: string[][]; onChange: (value: string) => void;
}) {
  return <div className="select-control space-y-2">
    <p className="text-[13px] text-text-soft">{label}</p>
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger aria-label={label} className="h-10 w-full border-white/10 bg-white/[.035] text-text-strong">
        <SelectValue>{options.find(([key]) => key === value)?.[1]}</SelectValue>
      </SelectTrigger>
      <SelectContent className="border-white/10 bg-surface-control text-text-strong">
        {options.map(([key, title]) => <SelectItem key={key} value={key}>{title}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>;
}
function percent(value: number | null | undefined, signed = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const n = value * 100, magnitude = Math.abs(n);
  const text = magnitude > 0 && magnitude < .00001 ? n.toExponential(2)
    : n.toFixed(magnitude > 0 && magnitude < .001 ? 6 : 3);
  return `${signed && value > 0 ? '+' : ''}${text}%`;
}

function GravityApp() {
  const embedded = new URLSearchParams(window.location.search).get('embed') === '1';
  const viewport = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const livePanel = useRef<HTMLElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const initialToggle = useRef<HTMLButtonElement>(null);
  const initialOpenButton = useRef<HTMLButtonElement>(null);
  const initialFocus = useRef<'open' | 'heading' | null>(null);
  const [draft, setDraft] = useState<InitialConfig>({ ...DEFAULT_INITIAL });
  const [applied, setApplied] = useState<InitialConfig>({ ...DEFAULT_INITIAL });
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [quality, setQuality] = useState<Quality>('auto');
  const [trails, setTrails] = useState(false);
  const [tab, setTab] = useState('parameters');
  const [collapsed, setCollapsed] = useState(false);
  const [about, setAbout] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 1100px)').matches);
  const [desktopInitialCollapsed, setDesktopInitialCollapsed] = useState(false);
  const [mobileInitialOpen, setMobileInitialOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const initialOpen = mobile ? mobileInitialOpen : !desktopInitialCollapsed;
  const pending = Object.keys(DEFAULT_INITIAL).some(key => draft[key as keyof InitialConfig] !== applied[key as keyof InitialConfig]);
  const busy = applying || metrics.loading;
  const patchDraft = <K extends keyof InitialConfig>(key: K, value: InitialConfig[K]) => setDraft(current => ({ ...current, [key]: value }));

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let instance: Runtime | undefined;
    const host = viewport.current!;
    void (async () => {
      try {
        instance = await createRuntime(host, {
          signal: controller.signal,
          onUpdate: (update: Partial<Metrics>) => {
            if (!disposed) setMetrics(current => ({ ...current, ...update }));
          },
          onError: (message: string) => { if (!disposed) setError(message); },
        });
        if (disposed) { instance?.dispose(); return; }
        runtime.current = instance!;
        await instance!.apply({ ...DEFAULT_INITIAL });
      } catch (reason) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setMetrics(current => ({ ...current, loading: false }));
        }
      }
    })();
    return () => { disposed = true; controller.abort(); instance?.dispose(); runtime.current = null; };
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (initialFocus.current === 'open') initialOpenButton.current?.focus();
    if (initialFocus.current === 'heading') initialToggle.current?.focus();
    initialFocus.current = null;
  }, [initialOpen]);
  useEffect(() => {
    runtime.current?.setDiagnostics(!collapsed && tab === 'errors');
  }, [collapsed, tab, metrics.ready]);
  useEffect(() => { runtime.current?.setSpeed(speed); }, [speed, metrics.ready]);
  useEffect(() => { runtime.current?.setTrails(trails); }, [trails, metrics.ready]);
  useEffect(() => { runtime.current?.setQuality(quality); }, [quality, metrics.ready]);
  useEffect(() => {
    const node = dialog.current!;
    const backdrop = (event: MouseEvent) => { if (event.target === node) setAbout(false); };
    node.addEventListener('click', backdrop);
    return () => node.removeEventListener('click', backdrop);
  }, []);
  useEffect(() => {
    const node = dialog.current;
    if (about && !node?.open) node?.showModal();
    if (!about && node?.open) node.close();
  }, [about]);
  useEffect(() => {
    const isPauseKey = (event: KeyboardEvent) => event.code === 'Space'
      && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing;
    const keydown = (event: KeyboardEvent) => {
      if (!isPauseKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || !metrics.ready || busy || metrics.status === 'stopped') return;
      runtime.current?.setPaused(!metrics.paused);
    };
    const keyup = (event: KeyboardEvent) => {
      if (!isPauseKey(event)) return;
      // Buttons and switches can activate on release as well as on press.
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
    };
  }, [metrics.ready, metrics.paused, metrics.status, busy]);
  useEffect(() => {
    const panel = livePanel.current!;
    const stage = panel.parentElement!;
    const observer = new ResizeObserver(() => {
      setPanelPosition(current => current ? {
        left: Math.max(8, Math.min(current.left, stage.clientWidth - panel.offsetWidth - 8)),
        top: Math.max(8, Math.min(current.top, stage.clientHeight - panel.offsetHeight - 8)),
      } : null);
    });
    observer.observe(panel); observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  async function apply(restart = false) {
    if (!runtime.current || busy) return;
    const next = { ...draft };
    setApplying(true); setError('');
    try {
      if (restart) await runtime.current.restart();
      else { await runtime.current.apply(next); setApplied(next); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setApplying(false); }
  }
  function beginDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const panel = livePanel.current!, bounds = panel.getBoundingClientRect();
    const stage = panel.parentElement!.getBoundingClientRect();
    suppressClick.current = false;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left - stage.left, top: bounds.top - stage.top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < 5) return;
    current.moved = true; suppressClick.current = true; setDragging(true);
    const panel = livePanel.current!, stage = panel.parentElement!;
    setPanelPosition({
      left: Math.max(8, Math.min(current.left + dx, stage.clientWidth - panel.offsetWidth - 8)),
      top: Math.max(8, Math.min(current.top + dy, stage.clientHeight - panel.offsetHeight - 8)),
    });
    event.preventDefault();
  }
  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function toggleInitial() {
    if (mobile) setMobileInitialOpen(!mobileInitialOpen);
    else setDesktopInitialCollapsed(!desktopInitialCollapsed);
    initialFocus.current = !mobile && initialOpen ? 'open' : 'heading';
  }
  const backend = metrics.forceBackend === 'webgpu' ? 'WebGPU · 并行求和' : metrics.forceBackend === 'direct' ? 'CPU · 直接求和' : '—';
  const numeric = (key: 'packing' | 'virial' | 'G' | 'restitution' | 'softeningRatio', label: string, min: number, max: number, step: number, display: string) =>
    <div className="control"><NumericControl label={label} value={draft[key]} displayValue={display} min={min} max={max} step={step} onChange={value => patchDraft(key, value)} /></div>;

  return <div className={`${embedded ? 'embedded' : ''} ${initialOpen ? '' : 'initial-panel-collapsed'}`}>
    {!embedded && <header className="topbar"><div className="wordmark"><span className="mark" aria-hidden="true">◌</span> YANG<span className="divider">/</span><span className="wordmark-sub">LABORATORY</span></div><div className="topbar-right"><span className="local-badge">本地实验</span><button className="text-button" onClick={() => setAbout(true)}>模型说明 <span aria-hidden="true">↗</span></button></div></header>}
    <main className="workspace">
      <section className="stage" aria-label="三维引力模拟">
        <div id="viewport" className="viewport" ref={viewport} />
        <div className="view-tools">
          <span className="fps-badge"><b id="fps">{metrics.fps == null ? '—' : Math.round(metrics.fps)}</b> FPS</span>
          <button id="fit" className="icon-button" aria-label="聚焦全部粒子" title="聚焦全部粒子" onClick={() => runtime.current?.focus()}><Icon name="focus" /></button>
          {embedded && <button id="about" className="icon-button" aria-label="模型说明" title="模型说明" onClick={() => setAbout(true)}><Icon name="info" /></button>}
        </div>
        <aside id="live-panel" ref={livePanel} className={`live-panel${collapsed ? ' collapsed' : ''}${dragging ? ' dragging' : ''}`} aria-label="参数调节" style={panelPosition ? { ...panelPosition, right: 'auto' } : undefined}>
          <button id="live-panel-toggle" className="live-panel-toggle" aria-expanded={!collapsed} aria-controls="live-panel-body" aria-label={collapsed ? '展开参数调节' : '收起参数调节'} title={collapsed ? '展开参数调节' : '收起参数调节'} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onClick={event => { if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; } setCollapsed(!collapsed); }}>
            <span className="live-panel-title">参数调节</span><span className="live-panel-minimize"><MinusIcon className="size-4" /></span><span className="live-panel-restore"><SlidersHorizontal className="size-4" /></span>
          </button>
          {!collapsed && <div id="live-panel-body" className="live-panel-body">
            <Tabs value={tab} onValueChange={value => { if (value === 'parameters' || value === 'errors') { setTab(value); if (scrollArea.current) scrollArea.current.scrollTop = 0; } }} className="h-full min-h-0 flex-1 gap-0">
              <TabsList variant="line" className="grid h-11 w-full shrink-0 grid-cols-2 border-b border-white/10 px-3" aria-label="参数面板"><TabsTrigger value="parameters" className="rounded-none text-xs data-active:text-white">参数</TabsTrigger><TabsTrigger value="errors" className="rounded-none text-xs data-active:text-white">误差</TabsTrigger></TabsList>
              <div className="live-panel-scroll" ref={scrollArea}>
                <TabsContent value="parameters"><div id="live-parameters" className="live-parameters">
                  <NumericControl label="时间倍速" value={speed} displayValue={`${speed.toFixed(1)}×`} min={.1} max={20} step={.1} onChange={setSpeed} />
                  <p className="speed-note">实际推进 <span id="actual-speed">{metrics.actualSpeed == null ? '—' : `${metrics.actualSpeed.toFixed(2)}×`}</span><span id="budget-note">{!metrics.paused && metrics.actualSpeed != null && metrics.actualSpeed < speed * .8 ? ' · 当前计算量受限' : ''}</span></p>
                  <div id="fixed-timestep" className="timestep-readout"><span>固定时间步长</span><output>1/60 s</output></div>
                  <div className="toggle-row"><ToggleControl label="显示全部粒子轨迹" checked={trails} onCheckedChange={setTrails} /></div>
                  <Choice label="渲染清晰度" value={quality} options={[[ 'auto', '自动' ], [ 'high', '清晰' ], [ 'low', '节能' ]]} onChange={value => setQuality(value as Quality)} />
                </div></TabsContent>
                <TabsContent value="errors"><section id="live-errors" className="control-section diagnostics-section" aria-labelledby="diagnostics-heading"><div className="section-heading"><h2 id="diagnostics-heading">数值观察</h2><span className="section-no">约每秒更新</span></div><div className="diagnostics">
                  <div><span>计算方式</span><output id="force-backend" title={metrics.forceBackendDetail}>{backend}</output></div>
                  <div><span>求力偏差 RMS</span><output id="force-error">{percent(metrics.diagnostics?.forceError)}</output></div>
                  <div><span>归一化能量漂移</span><output id="energy-error">{percent(metrics.diagnostics?.energyDrift, true)}</output></div>
                  <div><span>归一化动量偏差</span><output id="momentum-error">{percent(metrics.diagnostics?.momentumError)}</output></div>
                  <div><span>{metrics.computeLabel || '物理计算 / 批次'}</span><output id="compute-time">{metrics.computeMs == null ? '—' : `${metrics.computeMs.toFixed(1)} ms`}</output></div>
                  {metrics.forceBackend === 'webgpu' && typeof metrics.renderMs === 'number' && Number.isFinite(metrics.renderMs) && <div><span>GPU 绘制时间</span><output id="render-time">{metrics.renderMs.toFixed(2)} ms</output></div>}
                </div><p className="diagnostic-note">能量漂移已扣除碰撞耗散。基线在开始运行时建立。</p></section></TabsContent>
              </div>
            </Tabs>
          </div>}
        </aside>
        <div className="stage-bottom"><div className="readouts"><div><span className="readout-label">SIMULATION TIME</span><strong id="time">{metrics.time.toFixed(2)}<span>s</span></strong></div><div><span className="readout-label">COLLISIONS</span><strong id="collisions">{metrics.collisions.toLocaleString()}</strong></div><div><span className="readout-label">BODIES</span><strong id="body-count">{metrics.count.toLocaleString()}</strong></div></div><div className="transport">
          <button id="pause" className="icon-button" disabled={!metrics.ready || busy || metrics.status === 'stopped'} aria-label={metrics.paused ? '继续模拟' : '暂停模拟'} title={metrics.paused ? '继续' : '暂停'} onClick={() => { setError(''); runtime.current?.setPaused(!metrics.paused); }}><Icon name={metrics.paused ? 'play' : 'pause'} /></button>
          <button id="step" className="icon-button" disabled={!metrics.ready || busy || !metrics.paused || metrics.status === 'stopped'} aria-label="单步推进" title="暂停后单步推进" onClick={() => runtime.current?.step()}><Icon name="step" /></button>
          <button id="restart" className="icon-button" disabled={busy} aria-label="重新开始当前模型" title="重新开始当前模型" onClick={() => void apply(true)}><RotateCcw className="button-icon" /></button>
        </div></div>
        {error && <div id="error" className="error-banner" role="alert">{error}</div>}
      </section>
      <aside id="initial-panel" className="panel" aria-label="初始条件">
        <button ref={initialOpenButton} id="initial-panel-open" className="initial-panel-open" hidden={mobile || initialOpen} aria-expanded={initialOpen} aria-controls="initial-panel-body" aria-label="展开初始条件面板" title="展开初始条件面板" onClick={toggleInitial}><ChevronLeftIcon className="size-4" /></button>
        <button ref={initialToggle} id="initial-panel-close" className="panel-heading" inert={!mobile && !initialOpen} aria-expanded={initialOpen} aria-controls="initial-panel-body" aria-label={initialOpen ? '收起初始条件面板' : '展开初始条件面板'} title={initialOpen ? '收起初始条件面板' : '展开初始条件面板'} onClick={toggleInitial}><span id="initial-heading" className="panel-heading-title">初始条件</span>{pending && <span id="pending-label" className="pending-label">待应用</span>}<span className="panel-heading-icon"><ChevronRightIcon className="size-4" /></span></button>
        <div id="initial-panel-body" className="panel-scroll" inert={!initialOpen} aria-hidden={!initialOpen}>
          {initialOpen && <section className="control-section" aria-labelledby="initial-heading">
            <div id="seed-row" className="seed-row"><label htmlFor="seed-ui">种子</label><output id="seed-ui" aria-live="polite" className="font-mono text-[11px] tabular-nums text-text-muted">{draft.seed}</output><div className="seed-button-control"><Button type="button" variant="ghost" size="icon-sm" title="刷新种子" aria-label="刷新种子" className="text-text-muted hover:bg-white/10 hover:text-white" onClick={() => { let next = 1 + Math.floor(Math.random() * 999998); if (next >= draft.seed) next++; patchDraft('seed', next); }}><RotateCcw className="size-3.5" aria-hidden="true" /></Button></div></div>
            <Choice label="位置分布" value={draft.distribution} options={DISTRIBUTIONS} onChange={value => patchDraft('distribution', value)} />
            <ParticleCountControl value={draft.count} onChange={value => patchDraft('count', value)} />
            {numeric('packing', '初始紧密度', .005, .06, .005, `${(draft.packing * 100).toFixed(1)}%`)}
            {numeric('virial', '初始运动强度', 0, 2, .05, draft.virial.toFixed(2))}
            {numeric('G', '引力强度', 0, 10, .1, `${draft.G.toFixed(1)} G`)}
            <Choice label="引力计算" value={draft.forceBackend} options={[[ 'webgpu', 'WebGPU · 并行求和' ], [ 'direct', 'CPU · 直接求和' ]]} onChange={value => patchDraft('forceBackend', value)} />
            <div className="toggle-row"><ToggleControl label="碰撞" checked={!draft.collisionless} onCheckedChange={value => patchDraft('collisionless', !value)} /></div>
            {!draft.collisionless ? <div id="restitution-control">{numeric('restitution', '碰撞恢复系数 e', 0, 1, .01, draft.restitution.toFixed(2))}</div> : <div id="softening-control">{numeric('softeningRatio', 'Plummer 软化长度', .1, 5, .1, `${draft.softeningRatio.toFixed(1)} R`)}<p className="mt-2 text-[11px] leading-4 text-text-subtle">对引力方程做软化，避免近距离引力发散；R 为小球半径。</p></div>}
            <Button id="apply" type="button" variant="outline" disabled={busy} onClick={() => void apply()} className="h-10 w-full justify-between border-white/15 bg-white/[.035] text-text-strong hover:bg-white/10">{busy ? '正在准备' : '应用'}<ArrowUpRight className="size-4" /></Button>
          </section>}
        </div>
      </aside>
    </main>
    <dialog id="about-dialog" ref={dialog} aria-label="模型说明" onClose={() => setAbout(false)}>
      <button className="dialog-close" aria-label="关闭模型说明" onClick={() => setAbout(false)}>×</button><p className="eyebrow">ABOUT THIS EXPERIMENT</p>
      <p>“碰撞”默认关闭，粒子互相穿过，不产生碰撞或重叠分离。引力使用 Plummer 软化：单粒子产生的加速度为 Gm·r / (r² + ε²)³⁄²。软化长度 ε 默认 1R，范围 0.1–5R，R 为粒子半径。</p>
      <p>开启碰撞后使用无软化牛顿引力，接触时进行无摩擦连续碰撞。e = 1 为完全弹性碰撞；e 越小，法向动能损失越多；e = 0 时碰撞后的法向相对速度为 0，粒子仍不合并，切向速度保持不变。同刻的多体碰撞按固定顺序处理。</p>
      <p>初始条件和计算方式点击“应用”后生效，重新开始使用已应用的条件。默认优先使用 WebGPU；不支持时自动使用 CPU。也可手动选择 CPU Float64 直接求和。求力偏差是小样本与独立 Float64 计算的对照，不是全系统误差保证。</p>
      <p>固定时间步为 1/60 秒；碰撞在步内按接触时间处理。时间倍速通过增加计算量实现，计算跟不上时实际倍速会下降。能量漂移补偿碰撞耗散后，以初始动能与势能绝对值之和归一化。</p>
      <p>粒子半径固定为 {PARTICLE_RADIUS}、单粒子质量固定为 {PARTICLE_MASS}，两者独立设置。所有初态避免重叠，随机分布重叠时重新采样。初始运动强度默认 0，初速度按固定参考 G = 1 标定，与实际引力强度独立，0G 时也可运动。种子影响随机位置与非零初始速度；对称分布的位置保持确定性。</p>
      <p className="dialog-muted">长度、质量和时间使用归一化单位。无边界、无周期回绕、无额外阻尼。GPU 运行中断后恢复最近完整检查点并暂停；未保存的进度可能丢失，点击继续后使用 CPU。</p>
    </dialog>
  </div>;
}

export function mountGravityApp(host: HTMLElement) {
  const root = createRoot(host);
  root.render(<GravityApp />);
  return () => root.unmount();
}
