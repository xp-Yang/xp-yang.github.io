// Manual performance timing entry point. No assertions or automatic tests.
const runButton = document.getElementById('run');
const status = document.getElementById('status');
const output = document.getElementById('results');
let worker = null;

function append(record) {
  output.textContent += `${JSON.stringify(record)}\n`;
}

runButton.addEventListener('click', () => {
  if (worker) return;
  runButton.disabled = true;
  output.textContent = '';
  status.textContent = '正在创建独立计时 Worker…';
  try {
    worker = new Worker(new URL('./benchmark-webgpu.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') status.textContent = data.message;
      else if (data.type === 'record') append(data.record);
      else if (data.type === 'error') {
        status.textContent = `性能计时中断：${data.message} 已有记录保留。`;
        worker.terminate();
        worker = null;
        runButton.disabled = false;
      }
      else if (data.type === 'save') {
        append({ kind: 'save', status: data.saved ? 'saved' : 'unavailable', detail: data.detail });
      } else if (data.type === 'done') {
        status.textContent = `性能计时完成：${data.recordCount} 条记录。${data.saved ? '结果已写回本地服务。' : '写回服务不可用，结果保留在此页面。'}`;
        worker.terminate();
        worker = null;
        runButton.disabled = false;
      }
    };
    worker.onerror = event => {
      append({ kind: 'worker', status: 'error', detail: event.message || 'Performance worker failed.' });
      status.textContent = '计时 Worker 中断，已有记录保留。';
      worker?.terminate();
      worker = null;
      runButton.disabled = false;
    };
    worker.postMessage({
      type: 'run',
      environment: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency,
        secureContext: globalThis.isSecureContext,
        webgpuExposed: Boolean(navigator.gpu),
        visibilityState: document.visibilityState,
        brands: navigator.userAgentData?.brands ?? null,
      },
    });
  } catch (error) {
    append({ kind: 'worker', status: 'error', detail: error.message || String(error) });
    status.textContent = '无法启动计时 Worker。';
    worker?.terminate();
    worker = null;
    runButton.disabled = false;
  }
});

window.addEventListener('pagehide', () => { worker?.terminate(); });
