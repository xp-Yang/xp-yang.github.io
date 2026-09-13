'use client';

import {
  ArrowLeft,
  ArrowUpRight,
  Box,
  ChevronDown,
  FileCode2,
  FolderOpen,
  Layers3,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import { createSampleGcode } from '@/lib/gcode/sample';
import {
  MAX_FILE_BYTES,
  ROLES,
  type GcodeModel,
  type ViewRange,
  type WorkerResponse,
} from '@/lib/gcode/types';
import type { createViewport } from '@/lib/gcode/viewport';
// Vite generates this module's default worker constructor at build time.
// oxlint-disable-next-line import/default
import GcodeWorker from '@/lib/gcode/worker?worker';
import styles from './gcode-experience.module.css';

type Viewport = ReturnType<typeof createViewport>;
const DEFAULT_RANGE: ViewRange = {
  low: 0,
  high: 0,
  move: 0,
  visible: ROLES.map(() => true),
};

export function GcodeExperience() {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<Viewport | null>(null);
  const worker = useRef<Worker | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const currentModel = useRef<GcodeModel | null>(null);
  const currentRange = useRef<ViewRange>(DEFAULT_RANGE);
  const [model, setModel] = useState<GcodeModel | null>(null);
  const [range, setRange] = useState<ViewRange>(DEFAULT_RANGE);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState<{
    name: string;
    progress: number;
    stage: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [graphicsError, setGraphicsError] = useState('');
  const [fps, setFps] = useState(0);
  const [refining, setRefining] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const changeRange = (next: ViewRange) => {
    currentRange.current = next;
    setRange(next);
    viewport.current?.setRange(next);
  };
  const cancel = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    setLoading(null);
  }, []);
  const loadFile = useCallback(
    (file: File) => {
      cancel();
      setError('');
      if (file.size > MAX_FILE_BYTES) {
        setError('文件超过 100 MiB，请导入更小的文本 GCode。');
        return;
      }
      if (/\.(?:3mf|bgcode|zip)$/i.test(file.name)) {
        setError(
          '请先从切片器导出文本 .gcode 文件，不支持 3MF 或二进制 GCode。',
        );
        return;
      }
      setLoading({ name: file.name, progress: 0, stage: '读取文件' });
      try {
        const task = new GcodeWorker();
        worker.current = task;
        task.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
          if (worker.current !== task) return;
          if (data.type === 'progress') {
            setLoading({
              name: file.name,
              progress: data.progress,
              stage: data.stage,
            });
            return;
          }
          if (data.type === 'error') setError(data.message);
          else {
            try {
              viewport.current?.setModel(data.model);
              const high = data.model.layers.length - 1;
              const next = {
                low: 0,
                high,
                move: data.model.layers[high].endMove,
                visible: ROLES.map(() => true),
              };
              currentModel.current = data.model;
              currentRange.current = next;
              viewport.current?.setRange(next);
              setModel(data.model);
              setRange(next);
              setFileName(file.name);
            } catch {
              setError('无法为此模型分配图形资源，请尝试更小的文件。');
            }
          }
          task.terminate();
          worker.current = null;
          setLoading(null);
        };
        task.onerror = () => {
          if (worker.current !== task) return;
          setError('后台解析器未能启动或已停止，请刷新后重试。');
          task.terminate();
          worker.current = null;
          setLoading(null);
        };
        task.postMessage({ file });
      } catch {
        setError('浏览器无法启动后台解析，请使用支持 Web Worker 的浏览器。');
        setLoading(null);
      }
    },
    [cancel],
  );
  const loadSample = useCallback(
    () =>
      loadFile(
        new File([createSampleGcode()], '折光容器.gcode', {
          type: 'text/plain',
        }),
      ),
    [loadFile],
  );

  useEffect(() => {
    let disposed = false;
    const oldOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    import('@/lib/gcode/viewport')
      .then(({ createViewport: initialize }) => {
        if (disposed || !host.current) return;
        try {
          viewport.current = initialize(
            host.current,
            setGraphicsError,
            setFps,
            setRefining,
          );
          if (currentModel.current) {
            viewport.current.setModel(currentModel.current);
            viewport.current.setRange(currentRange.current);
          }
        } catch {
          setGraphicsError(
            '当前浏览器无法创建 WebGL 2 视图，请启用硬件加速或使用支持 WebGL 2 的浏览器。',
          );
        }
      })
      .catch(() => {
        if (!disposed) setGraphicsError('三维模块加载失败，请刷新后重试。');
      });
    const initialLoad = window.setTimeout(loadSample, 0);
    return () => {
      disposed = true;
      window.clearTimeout(initialLoad);
      worker.current?.terminate();
      worker.current = null;
      viewport.current?.dispose();
      viewport.current = null;
      document.documentElement.style.overflow = oldOverflow;
    };
  }, [loadSample]);

  const topLayer = model?.layers[range.high];
  const percent = topLayer
    ? Math.round(
        (100 * (range.move - topLayer.startMove + 1)) /
          (topLayer.endMove - topLayer.startMove + 1),
      )
    : 100;
  const activeRoles = model
    ? ROLES.map((role, index) => ({ ...role, index })).filter(
        (role) => model.roleCounts[role.index] > 0,
      )
    : [];
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) loadFile(file);
  };
  return (
    // The page-wide drop target supplements the accessible file-picker button.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <main
      className={`${styles.experience} ${panelOpen ? styles.controlsExpanded : ''}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (event.dataTransfer.types.includes('Files')) {
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current--;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className={styles.header}>
        {/* Native navigation matches the site's static Pages routing and gallery transition. */}
        {/* oxlint-disable-next-line next/no-html-link-for-pages */}
        <a href="/works/" aria-label="所有作品" className={styles.back}>
          <ArrowLeft size={15} />
          <span>所有作品</span>
        </a>
        <div className={styles.wordmark}>
          <span className={styles.liveDot} /> TOOLPATH{' '}
          <span className={styles.headerSlash}>/</span>{' '}
          <span className={styles.headerSub}>GCODE EXPLORER</span>
        </div>
        <a
          className={styles.sourceLink}
          href="https://github.com/xp-Yang/XPYEngine/tree/main/samples/GcodePreview"
          target="_blank"
          rel="noreferrer"
        >
          XPYEngine <ArrowUpRight size={14} />
        </a>
      </header>

      <div className={styles.workspace}>
        <section className={styles.stage} aria-label="走线预览">
          <div ref={host} className={styles.canvas} />
          <div className={styles.titleBlock}>
            <p className={styles.eyebrow}>
              REALTIME PRINT GEOMETRY <span>01 / EXPERIMENT</span>
            </p>
            <h1>
              一层一层，
              <br />
              看见成形。
            </h1>
            <p className={styles.subtitle}>
              GCode 走线预览<span>从指令到有形的轨迹。</span>
            </p>
          </div>
          <div className={styles.stageTools}>
            <div
              className={styles.fpsBadge}
              aria-label="渲染帧率"
              title="每秒实际绘制帧数，每 0.5 秒更新；停止操作后短暂优化画质，完成后停止绘制。"
            >
              <b>{model && !graphicsError ? fps : '—'}</b>
              <span>FPS</span>
              {model &&
                !graphicsError &&
                (refining ? (
                  <small>优化中</small>
                ) : (
                  fps === 0 && <small>静止</small>
                ))}
            </div>
            <button
              type="button"
              onClick={() => viewport.current?.reset()}
              aria-label="重置视角"
              title="重置视角"
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <div className={styles.axisBadge} aria-hidden="true">
            <span>X</span>
            <span>Y</span>
            <span>Z ↑</span>
            <i>mm</i>
          </div>
          <div className={styles.modelBadge}>
            <span className={styles.liveDot} />
            <span>{model ? 'LIVE GEOMETRY' : 'PREPARING GEOMETRY'}</span>
            <b>{model ? model.segmentCount.toLocaleString() : '—'}</b>
            <span>SEGMENTS</span>
          </div>
          <p className={styles.gestures}>
            拖动旋转 <span>·</span> 右键平移 <span>·</span> 滚轮缩放{' '}
            <span className={styles.touchHint}> / 双指缩放与平移</span>
          </p>
          {graphicsError && (
            <div className={styles.graphicsError} role="alert">
              <Box size={28} />
              <h2>三维视图暂不可用</h2>
              <p>{graphicsError}</p>
              <button type="button" onClick={() => window.location.reload()}>
                重新加载
              </button>
            </div>
          )}
        </section>

        <aside
          className={`${styles.panel} ${panelOpen ? styles.panelOpen : ''}`}
          aria-label="预览控制"
        >
          <button
            className={styles.mobileToggle}
            type="button"
            onClick={() => setPanelOpen((value) => !value)}
            aria-expanded={panelOpen}
          >
            <SlidersHorizontal size={16} />
            <span>走线控制</span>
            <span>{model?.layers.length ?? '—'} 层</span>
            <ChevronDown size={16} />
          </button>
          <div className={styles.panelScroll}>
            <div className={styles.panelHeading}>
              <span>GCODE 走线预览</span>
              <SlidersHorizontal size={15} />
            </div>
            <section className={styles.fileSection}>
              <div className={styles.sectionLabel}>
                <span>01</span> 模型文件{' '}
                <span className={styles.localLabel}>LOCAL ONLY</span>
              </div>
              <button
                className={styles.importButton}
                type="button"
                onClick={() => fileInput.current?.click()}
              >
                <FolderOpen size={18} />
                <span>
                  打开 GCode 文件<small>或将文件拖入窗口 · 最大 100 MiB</small>
                </span>
                <span className={styles.plus}>+</span>
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".gcode,.gco,.g,text/plain"
                className={styles.hiddenInput}
                aria-label="选择 GCode 文件"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) loadFile(file);
                  event.target.value = '';
                }}
              />
              <div className={styles.fileName}>
                <FileCode2 size={14} />
                <span title={fileName}>{fileName || '尚未加载模型'}</span>
                <button type="button" onClick={loadSample}>
                  恢复示例
                </button>
              </div>
              {loading && (
                <div className={styles.loading} aria-live="polite">
                  <div>
                    <span>
                      {loading.stage} · {Math.round(loading.progress * 100)}%
                    </span>
                    <button type="button" onClick={cancel}>
                      取消
                      <X size={12} />
                    </button>
                  </div>
                  <progress
                    max={1}
                    value={loading.progress}
                    aria-label="文件加载进度"
                  />
                  <small>{loading.name}</small>
                </div>
              )}
              {error && (
                <div className={styles.error} role="alert">
                  {error}
                  <button
                    type="button"
                    aria-label="关闭错误提示"
                    onClick={() => setError('')}
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              <p className={styles.privacy}>
                文件仅在当前浏览器解析，不会上传。
              </p>
            </section>

            <section className={styles.layerSection}>
              <div className={styles.sectionLabel}>
                <span>02</span> 层与进度 <Layers3 size={14} />
              </div>
              <div className={styles.layerReadout}>
                <span>
                  {model ? String(range.high + 1).padStart(3, '0') : '—'}
                </span>
                <small>/ {model?.layers.length ?? '—'} 层</small>
                <b>
                  Z {topLayer?.height.toFixed(2) ?? '—'} <i>mm</i>
                </b>
              </div>
              <label className={styles.sliderLabel}>
                起始层 <output>{model ? range.low + 1 : '—'}</output>
                <input
                  aria-label="起始层"
                  type="range"
                  min={0}
                  max={Math.max(0, (model?.layers.length ?? 1) - 1)}
                  value={range.low}
                  disabled={!model}
                  onChange={(event) => {
                    if (!model) return;
                    const low = Number(event.target.value),
                      high = Math.max(low, range.high);
                    changeRange({
                      ...range,
                      low,
                      high,
                      move:
                        high === range.high
                          ? range.move
                          : model.layers[high].endMove,
                    });
                  }}
                />
              </label>
              <label className={styles.sliderLabel}>
                结束层 <output>{model ? range.high + 1 : '—'}</output>
                <input
                  aria-label="结束层"
                  type="range"
                  min={0}
                  max={Math.max(0, (model?.layers.length ?? 1) - 1)}
                  value={range.high}
                  disabled={!model}
                  onChange={(event) => {
                    if (!model) return;
                    const high = Number(event.target.value);
                    changeRange({
                      ...range,
                      low: Math.min(range.low, high),
                      high,
                      move: model.layers[high].endMove,
                    });
                  }}
                />
              </label>
              <div className={styles.progressHeading}>
                <span>当前层走线</span>
                <b>{percent}%</b>
              </div>
              <input
                className={styles.moveSlider}
                aria-label="当前层走线进度"
                type="range"
                min={topLayer ? topLayer.startMove - 1 : 0}
                max={topLayer?.endMove ?? 1}
                value={range.move}
                disabled={!model}
                onChange={(event) =>
                  changeRange({ ...range, move: Number(event.target.value) })
                }
              />
              <div className={styles.stepControls}>
                <button
                  type="button"
                  disabled={!topLayer || range.move < topLayer.startMove}
                  aria-label="上一步"
                  onClick={() =>
                    changeRange({ ...range, move: range.move - 1 })
                  }
                >
                  ← 上一步
                </button>
                <span>{percent === 100 ? '完整显示' : '前层已调暗'}</span>
                <button
                  type="button"
                  disabled={!topLayer || range.move >= topLayer.endMove}
                  aria-label="下一步"
                  onClick={() =>
                    changeRange({ ...range, move: range.move + 1 })
                  }
                >
                  下一步 →
                </button>
              </div>
            </section>

            <section className={styles.legendSection}>
              <div className={styles.sectionLabel}>
                <span>03</span> 走线类型{' '}
                <button
                  type="button"
                  disabled={!model}
                  onClick={() => {
                    const all = activeRoles.every(
                      (role) => range.visible[role.index],
                    );
                    changeRange({ ...range, visible: ROLES.map(() => !all) });
                  }}
                >
                  {activeRoles.every((role) => range.visible[role.index])
                    ? '全部隐藏'
                    : '全部显示'}
                </button>
              </div>
              <div className={styles.legend}>
                {activeRoles.map((role) => (
                  <label
                    key={role.index}
                    className={`${styles.legendRow} ${!range.visible[role.index] ? styles.legendOff : ''}`}
                  >
                    <span
                      className={styles.colorChip}
                      style={{ background: role.color }}
                    />
                    <span>{role.label}</span>
                    <small>
                      {model!.roleCounts[role.index].toLocaleString()}
                    </small>
                    <input
                      type="checkbox"
                      checked={range.visible[role.index]}
                      aria-label={`显示${role.label}`}
                      onChange={(event) => {
                        const visible = [...range.visible];
                        visible[role.index] = event.target.checked;
                        changeRange({ ...range, visible });
                      }}
                    />
                  </label>
                ))}
              </div>
            </section>
            {!!model?.diagnostics.length && (
              <details className={styles.diagnostics}>
                <summary>
                  解析提示 ·{' '}
                  {model.diagnostics.reduce((sum, item) => sum + item.count, 0)}
                </summary>
                <ul>
                  {model.diagnostics.map((item) => (
                    <li key={item.message}>
                      第 {item.line} 行：{item.message}
                      {item.count > 1 ? `（${item.count} 次）` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className={styles.panelFoot}>
              <p>Bambu Studio / OrcaSlicer</p>
              <span>文本 GCode · 三维挤出轨迹</span>
              <details>
                <summary>兼容范围</summary>
                <p>
                  支持直线和 XY
                  圆弧、分层及类型注释。无注释时按挤出高度分层。默认耗材直径
                  1.75 mm；特殊固件指令、机器偏移和条件分支不作完整模拟。不支持
                  3MF 或二进制 GCode。
                </p>
              </details>
            </div>
          </div>
        </aside>
      </div>
      <footer className={styles.footer}>
        <span>
          XPYENGINE <i>→</i> WEB EXPERIMENT
        </span>
        <span>每一条指令，都有迹可循。</span>
        <span>THREE.JS / WEBGL 2</span>
      </footer>
      {dragging && (
        <div className={styles.dropOverlay}>
          <FolderOpen size={40} />
          <h2>放下文件，展开走线</h2>
          <p>文本 GCode · 最大 100 MiB</p>
        </div>
      )}
    </main>
  );
}
