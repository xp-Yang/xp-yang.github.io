import { createBaseline, referenceDiagnostics } from './reference.js';

self.onmessage = ({ data }) => {
  const { id, epoch, type, snapshot, config = snapshot?.config } = data;
  try {
    if (!snapshot || !config) throw new Error('数值观察缺少完整快照或配置。');
    const started = performance.now();
    if (type === 'baseline') {
      const baseline = createBaseline(snapshot, config);
      self.postMessage({ id, epoch, type, ok: true, baseline, computeMs: performance.now() - started });
    } else if (type === 'sample') {
      const diagnostics = referenceDiagnostics(snapshot, config, data.baseline);
      self.postMessage({ id, epoch, type, ok: true, diagnostics, computeMs: performance.now() - started });
    } else throw new Error(`未知数值观察请求：${type}`);
  } catch (error) {
    self.postMessage({ id, epoch, type, ok: false, error: error.message || String(error) });
  }
};
