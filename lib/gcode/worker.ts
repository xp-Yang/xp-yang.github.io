import { buildGeometry } from './geometry';
import { parseGcode } from './parser';
import { MAX_FILE_BYTES, type WorkerResponse } from './types';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ file: File }>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: ArrayBuffer[]) => void;
};
scope.onmessage = async ({ data }) => {
  try {
    if (data.file.size > MAX_FILE_BYTES)
      throw new Error('文件超过 100 MiB，请导入更小的文本 GCode。');
    const text = await data.file.text();
    const parsed = parseGcode(text, (value) =>
      scope.postMessage({
        type: 'progress',
        progress: value * 0.7,
        stage: '解析走线',
      }),
    );
    const model = buildGeometry(parsed, (value) =>
      scope.postMessage({
        type: 'progress',
        progress: 0.7 + value * 0.3,
        stage: '构建轨迹',
      }),
    );
    const transfer = model.batches.flatMap(
      (batch) =>
        [batch.instances.buffer, batch.moveIds.buffer] as ArrayBuffer[],
    );
    scope.postMessage({ type: 'complete', model }, transfer);
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message:
        error instanceof Error
          ? error.message
          : '文件解析失败，请尝试其他文本 GCode。',
    });
  }
};
