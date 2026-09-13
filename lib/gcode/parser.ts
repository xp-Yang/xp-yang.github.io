import {
  MAX_FILE_BYTES,
  MAX_SEGMENTS,
  GEOMETRY_LIMIT_MESSAGE,
  ROLES,
  STRIDE,
  type Diagnostic,
  type Layer,
  type ParsedGcode,
} from './types';

const ALIASES: Record<string, number> = {
  'inner wall': 1,
  perimeter: 1,
  'wall-inner': 1,
  'outer wall': 2,
  'external perimeter': 2,
  'wall-outer': 2,
  'overhang wall': 3,
  'overhang perimeter': 3,
  'sparse infill': 4,
  'internal infill': 4,
  fill: 4,
  'internal solid infill': 5,
  'solid infill': 5,
  'top surface': 6,
  'top solid infill': 6,
  'bottom surface': 7,
  'bottom solid infill': 7,
  skin: 6,
  ironing: 8,
  bridge: 9,
  'bridge infill': 9,
  'internal bridge': 9,
  'gap infill': 10,
  'gap fill': 10,
  skirt: 11,
  brim: 12,
  support: 13,
  'support material': 13,
  'support interface': 14,
  'support material interface': 14,
  'support transition': 15,
  'prime tower': 16,
  'wipe tower': 16,
  custom: 17,
  'custom gcode': 17,
  multiple: 18,
  mixed: 18,
};
const EPS = 1e-6;
const TAU = Math.PI * 2;

export function roleFromComment(value: string): number {
  return ALIASES[value.trim().toLowerCase()] ?? 0;
}

function sweepAngle(start: number, end: number, clockwise: boolean) {
  let angle = end - start;
  if (clockwise) {
    while (angle >= -EPS) angle -= TAU;
  } else {
    while (angle <= EPS) angle += TAU;
  }
  return angle;
}

/** XY arcs, including full circles and signed-R major/minor arcs. */
function arcPoints(
  start: number[],
  end: number[],
  p: Record<string, number>,
  scale: number,
  clockwise: boolean,
): number[][] {
  let cx: number, cy: number;
  if (p.P !== undefined && p.P !== 1)
    throw new Error('多圈圆弧 P 参数尚未支持');
  if (p.R !== undefined) {
    if (p.I !== undefined || p.J !== undefined)
      throw new Error('圆弧不能同时指定 R 和 I/J');
    const radius = Math.abs(p.R * scale);
    const dx = end[0] - start[0],
      dy = end[1] - start[1];
    const chord = Math.hypot(dx, dy);
    if (chord < EPS || chord > radius * 2 + EPS)
      throw new Error('圆弧 R 半径与端点不匹配');
    const h = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
    const sign = (clockwise ? -1 : 1) * (p.R < 0 ? -1 : 1);
    cx = (start[0] + end[0]) / 2 - (sign * dy * h) / chord;
    cy = (start[1] + end[1]) / 2 + (sign * dx * h) / chord;
  } else {
    if (p.I === undefined && p.J === undefined)
      throw new Error('圆弧缺少 I/J 或 R 参数');
    cx = start[0] + (p.I ?? 0) * scale;
    cy = start[1] + (p.J ?? 0) * scale;
  }
  const radius = Math.hypot(start[0] - cx, start[1] - cy);
  if (
    radius < EPS ||
    Math.abs(Math.hypot(end[0] - cx, end[1] - cy) - radius) >
      Math.max(0.05, radius * 0.001)
  ) {
    throw new Error('圆弧中心与端点不匹配');
  }
  const angle = Math.atan2(start[1] - cy, start[0] - cx);
  const sweep = sweepAngle(
    angle,
    Math.atan2(end[1] - cy, end[0] - cx),
    clockwise,
  );
  // Chord error <= 0.02 mm, angle <= 10 degrees. Fail instead of silently coarsening.
  const step = Math.min(
    Math.PI / 18,
    2 * Math.acos(Math.max(-1, 1 - 0.02 / radius)),
  );
  const count = Math.ceil(Math.abs(sweep) / step);
  if (!Number.isFinite(count) || count > 20000)
    throw new Error('圆弧细分超过安全预算');
  return Array.from({ length: count }, (_, i) =>
    i === count - 1
      ? end.slice(0, 3)
      : [
          cx + radius * Math.cos(angle + (sweep * (i + 1)) / count),
          cy + radius * Math.sin(angle + (sweep * (i + 1)) / count),
          start[2] + ((end[2] - start[2]) * (i + 1)) / count,
        ],
  );
}

export function parseGcode(
  text: string,
  onProgress: (progress: number) => void = () => {},
): ParsedGcode {
  if (
    text.length > MAX_FILE_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES
  )
    throw new Error('文件超过 100 MiB，请导入更小的文本 GCode。');
  if (
    text.includes('\0') ||
    text.includes('\ufffd') ||
    text.startsWith('GCDE') ||
    text.startsWith('PK\x03\x04')
  )
    throw new Error('请使用 UTF-8 文本 GCode，不支持二进制 GCode 或 3MF。');
  const diagnostics = new Map<string, Diagnostic>();
  const warn = (line: number, message: string) => {
    const previous = diagnostics.get(message);
    if (previous) previous.count++;
    else if (diagnostics.size < 40)
      diagnostics.set(message, { line, message, count: 1 });
  };
  let packed = new Float32Array(Math.min(4096, MAX_SEGMENTS) * STRIDE);
  let segmentCount = 0,
    moveCount = 0;
  const roleCounts = Array<number>(ROLES.length).fill(0);
  const layers: Layer[] = [];
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  let position = [0, 0, 0, 0];
  const origin = [0, 0, 0];
  let relative = false,
    relativeE: boolean | null = null,
    scale = 1;
  let role = 0,
    forcedWidth = 0,
    forcedHeight = 0,
    height = 0.2,
    lastExtrusionZ = 0;
  let diameter = 1.75,
    pendingLayer = false,
    explicitLayers = false,
    wipe = false,
    flush = false;
  let plane = 17,
    absoluteArcCenter = false,
    lineNo = 0,
    cursor = 0;
  const append = (start: number[], end: number[], width: number, h: number) => {
    if (segmentCount >= MAX_SEGMENTS) throw new Error(GEOMETRY_LIMIT_MESSAGE);
    if ((segmentCount + 1) * STRIDE > packed.length) {
      const grown = new Float32Array(
        Math.min(MAX_SEGMENTS * STRIDE, packed.length * 2),
      );
      grown.set(packed);
      packed = grown;
    }
    packed.set(
      [...start.slice(0, 3), ...end.slice(0, 3), width, h, role, lineNo],
      segmentCount * STRIDE,
    );
    segmentCount++;
    roleCounts[role]++;
    for (let axis = 0; axis < 3; axis++) {
      const padding = (axis === 2 ? h : width) / 2;
      min[axis] = Math.min(
        min[axis],
        start[axis] - padding,
        end[axis] - padding,
      );
      max[axis] = Math.max(
        max[axis],
        start[axis] + padding,
        end[axis] + padding,
      );
    }
  };
  while (cursor < text.length) {
    const newline = text.indexOf('\n', cursor);
    const stop = newline === -1 ? text.length : newline;
    const raw = text.slice(cursor, stop).trim();
    cursor = stop + 1;
    lineNo++;
    if (lineNo % 4096 === 0) onProgress(Math.min(1, cursor / text.length));
    const semicolon = raw.indexOf(';');
    const comment = semicolon === -1 ? '' : raw.slice(semicolon + 1).trim();
    const feature = /^(?:FEATURE|TYPE)\s*:\s*(.*)$/i.exec(comment);
    if (feature) {
      role = roleFromComment(feature[1]);
      if (role === 0 && !/^(?:undefined|unknown)$/i.test(feature[1]))
        warn(lineNo, `未识别走线类型：${feature[1].slice(0, 80)}`);
    }
    if (
      /^(?:CHANGE_LAYER|LAYER_CHANGE|layer\s+num\/total_layer_count\s*:|LAYER\s*:)/i.test(
        comment,
      )
    ) {
      pendingLayer = true;
      explicitLayers = true;
    }
    const dimension =
      /^(WIDTH|LINE_WIDTH|HEIGHT|LAYER_HEIGHT|layer height)\s*[:=]\s*(\S+)/i.exec(
        comment,
      );
    if (dimension) {
      const value = Number(dimension[2]);
      if (Number.isFinite(value) && value > 0 && value <= 20) {
        if (/width/i.test(dimension[1])) forcedWidth = value;
        else forcedHeight = value;
      } else warn(lineNo, '无效线宽或层高注释，使用推导值');
    }
    const filament = /^filament_diameter\s*=\s*([\d.]+)/i.exec(comment);
    if (filament && Number(filament[1]) > 0 && Number(filament[1]) <= 4)
      diameter = Number(filament[1]);
    if (/^WIPE_START/i.test(comment)) wipe = true;
    if (/^WIPE_END/i.test(comment)) wipe = false;
    if (/^FLUSH_START/i.test(comment)) flush = true;
    if (/^FLUSH_END/i.test(comment)) flush = false;
    const code = (semicolon === -1 ? raw : raw.slice(0, semicolon))
      .replace(/\([^)]*\)/g, '')
      .replace(/^N\d+\s*/i, '')
      .replace(/\*\d+\s*$/, '')
      .trim()
      .toUpperCase();
    if (!code) continue;
    const command = /^([GMT])\s*(\d+(?:\.\d+)?)/.exec(code);
    if (!command) {
      warn(lineNo, '未识别指令已忽略，路径可能不完整');
      continue;
    }
    const cmd = command[1] + Number(command[2]);
    const rest = code.slice(command[0].length);
    const p: Record<string, number> = {};
    const residue = rest
      .replace(
        /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g,
        (_, key: string, value: string) => {
          p[key] = Number(value);
          return '';
        },
      )
      .trim();
    // Validate parameters only for commands whose state we actually interpret.
    // Machine commands such as Bambu's G29 A have valid nonnumeric flags;
    // leave them to the ignore/diagnostic dispatch below.
    const pathCommand = [
      'G0',
      'G1',
      'G2',
      'G3',
      'G17',
      'G18',
      'G19',
      'G20',
      'G21',
      'G28',
      'G90',
      'G91',
      'G90.1',
      'G91.1',
      'G92',
      'M82',
      'M83',
    ].includes(cmd);
    if (
      pathCommand &&
      (Object.values(p).some((v) => !Number.isFinite(v) || Math.abs(v) > 1e9) ||
        (residue && cmd !== 'G28'))
    ) {
      throw new Error(`第 ${lineNo} 行包含无效参数，未替换当前模型。`);
    }
    if (cmd === 'G90') {
      relative = false;
      relativeE = null;
      continue;
    }
    if (cmd === 'G91') {
      relative = true;
      relativeE = null;
      continue;
    }
    if (cmd === 'M82') {
      relativeE = false;
      continue;
    }
    if (cmd === 'M83') {
      relativeE = true;
      continue;
    }
    if (cmd === 'G20') {
      scale = 25.4;
      continue;
    }
    if (cmd === 'G21') {
      scale = 1;
      continue;
    }
    if (['G17', 'G18', 'G19'].includes(cmd)) {
      plane = Number(command[2]);
      continue;
    }
    if (cmd === 'G90.1') {
      absoluteArcCenter = true;
      continue;
    }
    if (cmd === 'G91.1') {
      absoluteArcCenter = false;
      continue;
    }
    if (cmd === 'G92') {
      const hasAxes = ['X', 'Y', 'Z', 'E'].some(
        (axis) => p[axis] !== undefined,
      );
      ['X', 'Y', 'Z'].forEach((axis, index) => {
        if (p[axis] !== undefined || !hasAxes)
          origin[index] = position[index] - (p[axis] ?? 0) * scale;
      });
      if (p.E !== undefined || !hasAxes) position[3] = (p.E ?? 0) * scale;
      continue;
    }
    if (cmd === 'G28') {
      const selected = ['X', 'Y', 'Z'].filter((axis) => rest.includes(axis));
      ['X', 'Y', 'Z'].forEach((axis, index) => {
        if (!selected.length || selected.includes(axis)) {
          position[index] = 0;
          origin[index] = 0;
        }
      });
      warn(lineNo, '归零位置按 0 mm 解释，未模拟机器原点偏移');
      continue;
    }
    if (!['G0', 'G1', 'G2', 'G3'].includes(cmd)) {
      if (['G4', 'G10', 'G11', 'G29'].includes(cmd)) continue;
      if (
        command[1] === 'G' ||
        command[1] === 'T' ||
        [
          'M200',
          'M206',
          'M218',
          'M290',
          'M400',
          'M620',
          'M621',
          'M622',
          'M623',
        ].includes(cmd)
      ) {
        // Ordinary M400 is only a wait; its Bambu U branch can change position.
        if (cmd !== 'M400' || p.U !== undefined)
          warn(lineNo, `${cmd} 未模拟，坐标、挤出或条件分支结果可能有差异`);
      }
      continue;
    }
    if (['A', 'B', 'C', 'U', 'V', 'W'].some((axis) => p[axis] !== undefined))
      throw new Error(`第 ${lineNo} 行使用未支持的运动轴。`);
    const end = position.map((value, axis) => {
      const parameter = p['XYZE'[axis]];
      if (parameter === undefined) return value;
      const isRelative = axis === 3 ? (relativeE ?? relative) : relative;
      return (
        parameter * scale + (isRelative ? value : axis < 3 ? origin[axis] : 0)
      );
    });
    if (end.slice(0, 3).some((value) => Math.abs(value) > 1e6))
      throw new Error(`第 ${lineNo} 行坐标超过预览范围。`);
    moveCount++;
    let points: number[][];
    if (cmd === 'G2' || cmd === 'G3') {
      if (plane !== 17 || absoluteArcCenter)
        throw new Error(`第 ${lineNo} 行圆弧使用未支持的平面或绝对圆心模式。`);
      try {
        points = arcPoints(position, end, p, scale, cmd === 'G2');
      } catch (error) {
        throw new Error(
          `第 ${lineNo} 行：${error instanceof Error ? error.message : '无效圆弧'}。`,
        );
      }
    } else points = [end];
    const deltaE = end[3] - position[3];
    const hasXY = points.some(
      (point) =>
        Math.hypot(point[0] - position[0], point[1] - position[1]) > EPS,
    );
    if (deltaE > EPS && hasXY && !wipe && !flush) {
      if (
        !layers.length ||
        pendingLayer ||
        (!explicitLayers && end[2] > layers[layers.length - 1].height + 0.001)
      ) {
        layers.push({ height: end[2], startMove: lineNo, endMove: lineNo });
        pendingLayer = false;
      }
      layers[layers.length - 1].endMove = lineNo;
      height =
        forcedHeight ||
        (end[2] > lastExtrusionZ + EPS ? end[2] - lastExtrusionZ : height);
      if (!(height > 0 && height <= 20)) height = 0.2;
      lastExtrusionZ = end[2];
      let length = 0,
        prev = position;
      for (const point of points) {
        length += Math.hypot(
          point[0] - prev[0],
          point[1] - prev[1],
          point[2] - prev[2],
        );
        prev = point;
      }
      const area = (Math.PI * (diameter / 2) ** 2 * deltaE) / length;
      const inferredWidth =
        role === 2
          ? (area * 1.05 ** 2) / height
          : role === 9 || role === 0
            ? Math.sqrt((4 * area) / Math.PI)
            : area / height + (1 - Math.PI / 4) * height;
      const width =
        forcedWidth ||
        Math.max(0.01, Math.min(inferredWidth, Math.max(2, 4 * height)));
      prev = position;
      for (const point of points) {
        if (
          Math.hypot(
            point[0] - prev[0],
            point[1] - prev[1],
            point[2] - prev[2],
          ) > EPS
        )
          append(prev, point, width, height);
        prev = point;
      }
    }
    position = end;
  }
  if (!segmentCount)
    throw new Error(
      '文件中没有可显示的挤出走线，请检查是否为已切片的文本 GCode。',
    );
  onProgress(1);
  return {
    segments: packed.slice(0, segmentCount * STRIDE),
    layers,
    bounds: { min, max },
    diagnostics: [...diagnostics.values()],
    segmentCount,
    moveCount,
    roleCounts,
  };
}
