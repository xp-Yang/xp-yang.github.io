import { resolveTurn, type RunState, type TurnResult } from '../core';

export interface TurnPreviewWorkerRequest {
  requestId: number;
  state: RunState;
  targets: readonly string[];
}

export interface TurnPreviewWorkerResponse {
  requestId: number;
  result: TurnResult;
  computeMs: number;
}

self.addEventListener('message', (event: MessageEvent<TurnPreviewWorkerRequest>) => {
  const { requestId, state, targets } = event.data;
  const startedAt = performance.now();
  const result = resolveTurn(state, {
    runId: state.runId,
    revision: state.revision,
    targets,
  });
  const response: TurnPreviewWorkerResponse = {
    requestId,
    result,
    computeMs: performance.now() - startedAt,
  };
  self.postMessage(response);
});
