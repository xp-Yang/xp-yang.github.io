// Manual performance timing only. Nothing runs until the button is clicked.
const runButton = document.getElementById('run');
const stopButton = document.getElementById('stop');
const downloadButton = document.getElementById('download');
const status = document.getElementById('status');
const output = document.getElementById('results');
const CASE_WALL_LIMIT_MS = 30000;
let worker = null;
let watchdog = null;
let currentCase = null;
let report = null;
let saving = false;

function append(record) {
  report.records.push(record);
  output.textContent += `${JSON.stringify(record)}\n`;
  downloadButton.disabled = false;
}

function stopWorker() {
  clearTimeout(watchdog);
  watchdog = null;
  currentCase = null;
  worker?.terminate();
  worker = null;
  stopButton.disabled = true;
}

async function saveReport(message) {
  if (saving) return;
  saving = true;
  report.finishedAt = new Date().toISOString();
  let saved = false, detail = null;
  try {
    const response = await fetch('/__perf-result', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report),
      signal: AbortSignal.timeout(5000),
    });
    saved = response.ok;
    if (!saved) detail = `HTTP ${response.status}`;
  } catch (error) { detail = error?.message || String(error); }
  append({ kind: 'save', status: saved ? 'saved' : 'unavailable', detail });
  status.textContent = `${message}${saved ? '结果已写回本地服务。' : '结果保留在页面，可下载 JSON。'}`;
  saving = false;
  runButton.disabled = false;
}

function endEarly(reason, detail) {
  if (!worker) return;
  append({
    kind: 'integration', ...(currentCase || {}), status: reason,
    wallLimitMs: CASE_WALL_LIMIT_MS, detail,
    telemetryUnavailable: 'Worker was terminated; only preceding records are available.',
  });
  stopWorker();
  void saveReport(reason === 'cancelled' ? '已停止计时，保留已有记录。' : '计时已中断，保留已有记录。');
}

runButton.addEventListener('click', () => {
  if (worker || saving) return;
  runButton.disabled = true;
  stopButton.disabled = false;
  downloadButton.disabled = true;
  output.textContent = '';
  const environment = {
    userAgent: navigator.userAgent, platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    secureContext: globalThis.isSecureContext, webgpuExposed: Boolean(navigator.gpu),
    visibilityState: document.visibilityState, brands: navigator.userAgentData?.brands ?? null,
  };
  report = {
    kind: 'benchmark-resident-browser', schemaVersion: 1,
    startedAt: new Date().toISOString(), environment, records: [],
  };
  status.textContent = '正在创建独立计时 Worker…';
  try {
    const taskWorker = new Worker(new URL('./benchmark-resident.worker.js', import.meta.url), { type: 'module' });
    worker = taskWorker;
    // This main-thread timer can terminate a worker blocked inside a CPU or GPU call.
    watchdog = setTimeout(() => endEarly('wall-limit', 'Worker startup exceeded 30 seconds.'), CASE_WALL_LIMIT_MS);
    taskWorker.onmessage = ({ data }) => {
      if (worker !== taskWorker) return;
      if (data.type === 'record') append(data.record);
      else if (data.type === 'progress') status.textContent = data.message;
      else if (data.type === 'case-start') {
        currentCase = data.case;
        clearTimeout(watchdog);
        watchdog = setTimeout(() => endEarly('wall-limit', 'The case exceeded its 30-second main-thread watchdog.'), CASE_WALL_LIMIT_MS);
      } else if (data.type === 'case-end') {
        currentCase = null;
        clearTimeout(watchdog);
        watchdog = setTimeout(() => endEarly('wall-limit', 'The worker did not start the next case within 30 seconds.'), CASE_WALL_LIMIT_MS);
      } else if (data.type === 'error') {
        endEarly('error', data.message);
      } else if (data.type === 'done') {
        stopWorker();
        void saveReport(`性能计时完成：${data.recordCount} 条记录。`);
      }
    };
    taskWorker.onerror = event => endEarly('error', event.message || 'Performance worker failed.');
    taskWorker.postMessage({ type: 'run', environment });
  } catch (error) {
    append({ kind: 'worker', status: 'error', detail: error?.message || String(error) });
    stopWorker();
    void saveReport('无法启动计时 Worker。');
  }
});

stopButton.addEventListener('click', () => endEarly('cancelled', 'The user stopped manual performance timing.'));
downloadButton.addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'gravity-resident-performance.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
window.addEventListener('pagehide', stopWorker);
