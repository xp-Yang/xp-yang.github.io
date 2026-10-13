import { Simulation } from '../physics/simulation.js';

let simulation = null;
let activeEpoch = null;

function transferSnapshot(snapshot) {
  const buffers = [snapshot.positions.buffer, snapshot.velocities.buffer, snapshot.sampleIndices.buffer];
  if (snapshot.accelerations) buffers.push(snapshot.accelerations.buffer);
  return buffers;
}

self.onmessage = ({ data }) => {
  const { id, epoch, type } = data;
  try {
    if (type === 'initialize') {
      const next = new Simulation(data.config);
      simulation = next; activeEpoch = epoch;
      const snapshot = simulation.snapshot();
      self.postMessage({ id, epoch, type, ok: true, config: simulation.config, snapshot }, transferSnapshot(snapshot));
      return;
    }
    if (type === 'restore') {
      const next = Simulation.restore(data.snapshot, data.config ?? data.snapshot.config);
      simulation = next; activeEpoch = epoch;
      const snapshot = simulation.snapshot();
      self.postMessage({ id, epoch, type, ok: true, config: simulation.config, snapshot }, transferSnapshot(snapshot));
      return;
    }
    if (!simulation || epoch !== activeEpoch) throw new Error('CPU 模拟请求属于已失效场景。');
    if (type === 'advance') {
      const result = simulation.advanceSteps(data.steps ?? 1, data.budgetMs ?? 8);
      const positions = new Float32Array(simulation.positions);
      self.postMessage({ id, epoch, type, ok: true, ...result, meta: simulation.metadata(), positions, bounds: simulation.bounds() }, [positions.buffer]);
    } else if (type === 'snapshot') {
      const snapshot = simulation.snapshot();
      self.postMessage({ id, epoch, type, ok: true, snapshot }, transferSnapshot(snapshot));
    } else {
      throw new Error(`未知 CPU 请求：${type}`);
    }
  } catch (error) {
    self.postMessage({ id, epoch, type, ok: false, error: error.message || String(error) });
  }
};
