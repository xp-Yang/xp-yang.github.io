export const MAX_FILE_BYTES = 100 * 1024 * 1024;
// Compact instances: 32 bytes of attributes + 4 bytes of source IDs per segment.
// Allow 160 bytes/segment for CPU/GPU data and parser allocation headroom.
export const GEOMETRY_BUDGET_MIB = 1024;
export const MAX_SEGMENTS = Math.floor(
  (GEOMETRY_BUDGET_MIB * 1024 * 1024) / 160,
);
export const GEOMETRY_LIMIT_MESSAGE = `走线数据超过 ${GEOMETRY_BUDGET_MIB} MiB 内存预算，请导入走线更少的文件。`;
export const STRIDE = 10;

export const ROLES = [
  { label: '未分类', color: '#e6b3b3' },
  { label: '内墙', color: '#ffe64d' },
  { label: '外墙', color: '#ff7d38' },
  { label: '悬垂墙', color: '#1f1fff' },
  { label: '稀疏填充', color: '#b03029' },
  { label: '内部实心填充', color: '#9654cc' },
  { label: '顶面', color: '#f04040' },
  { label: '底面', color: '#665cc7' },
  { label: '熨平', color: '#ff8c69' },
  { label: '桥接', color: '#4d80ba' },
  { label: '缝隙填充', color: '#ffffff' },
  { label: '裙边', color: '#00876e' },
  { label: '底边', color: '#003b6e' },
  { label: '支撑', color: '#00ff00' },
  { label: '支撑界面', color: '#008000' },
  { label: '支撑过渡', color: '#004000' },
  { label: '擦料塔', color: '#b3e3ab' },
  { label: '自定义', color: '#5ed194' },
  { label: '混合', color: '#5ed194' },
] as const;

export type Layer = { height: number; startMove: number; endMove: number };
export type Diagnostic = { line: number; message: string; count: number };
export type GcodeMetadata = {
  layers: Layer[];
  bounds: { min: number[]; max: number[] };
  diagnostics: Diagnostic[];
  segmentCount: number;
  moveCount: number;
  roleCounts: number[];
};
// Each packed segment: start XYZ, end XYZ, width, height, role, source line.
export type ParsedGcode = GcodeMetadata & { segments: Float32Array };
export type MeshBatch = {
  role: number;
  // Start XYZ, end XYZ, width, height; expanded by the GPU from a shared mesh.
  instances: Float32Array;
  moveIds: Uint32Array;
};
export type GcodeModel = GcodeMetadata & { batches: MeshBatch[] };
export type WorkerResponse =
  | { type: 'progress'; progress: number; stage: string }
  | { type: 'complete'; model: GcodeModel }
  | { type: 'error'; message: string };
export type ViewRange = {
  low: number;
  high: number;
  move: number;
  visible: boolean[];
};
