import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGcode, roleFromComment } from '../lib/gcode/parser';
import { buildGeometry, drawRanges } from '../lib/gcode/geometry';
import { createInstanceMesh } from '../lib/gcode/instance-mesh';
import { createSampleGcode } from '../lib/gcode/sample';
import { MAX_SEGMENTS, STRIDE, type ViewRange } from '../lib/gcode/types';

const segment = (text: string, index = 0) =>
  Array.from(
    parseGcode(text).segments.slice(index * STRIDE, (index + 1) * STRIDE),
  );
const close = (actual: number, expected: number, epsilon = 1e-5) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

void test('absolute coordinates, per-axis preservation and G92 do not create spurious jumps', () => {
  const parsed = parseGcode(
    'G90\nM82\nG0 X10 Y20 Z0.2\nG1 X20 E1\nG92 X0 E0\nG1 X5 E0.5',
  );
  assert.equal(parsed.segmentCount, 2);
  assert.deepEqual(Array.from(parsed.segments.slice(0, 6)), [
    10,
    20,
    Math.fround(0.2),
    20,
    20,
    Math.fround(0.2),
  ]);
  close(parsed.segments[STRIDE + 3], 25);
  assert.equal(parsed.segments[STRIDE + 9], 6);
});

void test('relative XYZ and independently absolute E, plus relative E with absolute XYZ', () => {
  const parsed = parseGcode(
    'G91\nM82\nG1 X10 E1\nG1 X10 E2\nG90\nM83\nG1 X30 E1\nG1 X40 E1',
  );
  assert.equal(parsed.segmentCount, 4);
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => parsed.segments[i * STRIDE + 3]),
    [10, 20, 30, 40],
  );
});

void test('retract, stationary prime, travel and wipe/flush do not generate extrusion geometry', () => {
  const parsed = parseGcode(
    'M83\nG1 X10 E1\nG1 E-1\nG1 X20 E-1\nG1 E1\nG0 X30\n; WIPE_START\nG1 X35 E1\n; WIPE_END\n; FLUSH_START\nG1 X40 E1\n; FLUSH_END\nG1 X50 E1',
  );
  assert.equal(parsed.segmentCount, 2);
  assert.equal(parsed.segments[STRIDE], 40);
});

void test('inch units apply to XYZ/E and arc parameters', () => {
  const s = segment('G20\nM83\nG0 Z0.01\nG1 X1 E0.05');
  close(s[3], 25.4);
  close(s[2], 0.254);
});

void test('Bambu and Orca comments preserve role colors, dimensions and explicit layers', () => {
  const parsed = parseGcode(
    'M83\n; CHANGE_LAYER\n; layer num/total_layer_count: 1/2\n; LAYER_HEIGHT: 0.2\n; LINE_WIDTH: 0.45\n; FEATURE: Outer wall\nG1 X10 Z0.2 E1\n; LAYER_CHANGE\n; HEIGHT:0.3\n; WIDTH:0.6\n; TYPE:Internal solid infill\nG1 Y10 Z0.5 E1',
  );
  assert.equal(parsed.layers.length, 2);
  close(parsed.segments[6], 0.45);
  close(parsed.segments[7], 0.2);
  assert.equal(parsed.segments[8], 2);
  close(parsed.segments[STRIDE + 6], 0.6);
  close(parsed.segments[STRIDE + 7], 0.3);
  assert.equal(parsed.segments[STRIDE + 8], 5);
  assert.equal(roleFromComment('Support interface'), 14);
});

void test('fallback layer detection ignores Z-hop and unknown roles remain visible', () => {
  const parsed = parseGcode(
    'M83\nG0 Z0.2\nG1 X10 E1\nG0 Z2\nG0 X20\nG0 Z0.2\nG1 X30 E1\nG0 Z0.4\nG1 X40 E1',
  );
  assert.equal(parsed.layers.length, 2);
  assert.equal(parsed.roleCounts[0], 3);
  const model = buildGeometry(parsed);
  assert.equal(model.batches[0].role, 0);
  assert.equal(model.batches[0].instances.length, 3 * 8);
});

void test('XY arcs interpolate clockwise/counterclockwise paths and preserve source instruction', () => {
  const ccw = parseGcode('M83\nG0 X10 Y0 Z0.2\nG3 X0 Y10 I-10 J0 E2');
  assert.ok(ccw.segmentCount >= 9);
  const last = ccw.segments.slice(-STRIDE);
  close(last[3], 0);
  close(last[4], 10);
  assert.ok(ccw.segments[4] > 0);
  assert.ok(
    Array.from(ccw.segments)
      .filter((_, i) => i % STRIDE === 9)
      .every((id) => id === 3),
  );
  const cw = parseGcode('M83\nG0 X10 Y0 Z0.2\nG2 X0 Y-10 I-10 J0 E2');
  assert.ok(cw.segments[4] < 0);
  const circle = parseGcode('M83\nG0 X10 Y0 Z0.2\nG3 I-10 J0 E2');
  close(circle.segments[circle.segments.length - 7], 10);
  assert.ok(circle.segmentCount > ccw.segmentCount);
});

void test('signed radius selects the major arc, and helical arcs interpolate Z', () => {
  const small = parseGcode('M83\nG0 X10\nG3 X0 Y10 R10 E2');
  const large = parseGcode('M83\nG0 X10\nG3 X0 Y10 R-10 E2');
  assert.ok(large.segmentCount > small.segmentCount * 2);
  const helix = parseGcode('M83\nG0 X10 Z0.2\nG3 X0 Y10 Z0.4 I-10 E2');
  assert.ok(helix.segments[5] > 0.2 && helix.segments[5] < 0.4);
});

void test('invalid paths, non-text files and unsupported arc modes fail with actionable errors', () => {
  assert.throws(() => parseGcode(''), /没有可显示/);
  assert.throws(() => parseGcode('G0 X10'), /没有可显示/);
  assert.throws(() => parseGcode('GCDE\0'), /二进制/);
  assert.throws(() => parseGcode('G1 XNaN E1'), /第 1 行/);
  assert.throws(() => parseGcode('G1 X1.2.3 E1'), /无效参数/);
  assert.throws(() => parseGcode('G18\nG2 X10 I5 E1'), /未支持的平面/);
  assert.throws(() => parseGcode('G2 X10 E1'), /缺少/);
  assert.throws(() => parseGcode('G2 X100 R1 E1'), /不匹配/);
  assert.throws(() => parseGcode('G1 X10 A2 E1'), /未支持的运动轴/);
});

void test('machine offsets and tool changes produce diagnostics instead of silent full compatibility', () => {
  const result = parseGcode('G28\nG54\nM206 X2\nT1\nM83\nG1 X10 E1');
  assert.equal(result.diagnostics.length, 4);
});

void test('Bambu 01.07.03.50 bed leveling flags preserve geometry and source lines', () => {
  // Startup commands from the three real X1 Carbon files that failed to import.
  for (const leveling of [
    'G29 A X88.3189 Y126.167 I36.1622 J13.6665',
    'G29 A X117.2 Y117.2 I25.6 J25.6',
    'G29 A X116.882 Y121.901 I38.9903 J16.198',
  ]) {
    const lines = [
      '; BambuStudio 01.07.03.50',
      'G90',
      'M83',
      'G0 X10 Y20 Z0.2',
      'M1002 judge_flag g29_before_print_flag',
      'M622 J1',
      `    ${leveling}`,
      'M400',
      'M500',
      'M623',
      '; CHANGE_LAYER',
      '; FEATURE: Outer wall',
      '; LINE_WIDTH: 0.45',
      '; LAYER_HEIGHT: 0.2',
      'G1 X30 E1',
    ];
    const parsed = parseGcode(lines.join('\n'));
    const expected = parseGcode(
      lines
        .map((line) =>
          line.includes('G29 A') ? '; omitted bed leveling' : line,
        )
        .join('\n'),
    );
    assert.deepEqual(parsed, expected);
    assert.equal(parsed.segmentCount, 1);
    assert.deepEqual(Array.from(parsed.segments.slice(0, 6)), [
      10,
      20,
      Math.fround(0.2),
      30,
      20,
      Math.fround(0.2),
    ]);
    assert.equal(parsed.segments[9], lines.length);
    assert.equal(buildGeometry(parsed).batches[0].instances.length, 8);
  }
});

void test('unmodeled machine flags warn while malformed interpreted commands still fail', () => {
  const parsed = parseGcode('G380 S\nG29.1 Z\nM206 X\nM83\nG1 X10 E1');
  assert.equal(parsed.segmentCount, 1);
  for (const cmd of ['G380', 'G29.1', 'M206'])
    assert.ok(
      parsed.diagnostics.some((diagnostic) =>
        diagnostic.message.startsWith(cmd + ' '),
      ),
    );
  for (const cmd of ['G0 X', 'G1 A', 'G2 I', 'G3 J', 'G92 E', 'G90 A', 'M83 A'])
    assert.throws(() => parseGcode(`${cmd}\nG1 X10 E1`), /第 1 行包含无效参数/);
});

void test('draw ranges preserve step semantics, hidden roles and partial highest-layer dimming', () => {
  const parsed = parseGcode(
    'M83\n; FEATURE: Outer wall\nG1 X10 Z0.2 E1\nG1 Y10 E1\nG1 X0 Z0.4 E1\nG1 Y0 E1',
  );
  const model = buildGeometry(parsed),
    batch = model.batches[0];
  const range: ViewRange = {
    low: 0,
    high: 1,
    move: 6,
    visible: Array(19).fill(true),
  };
  assert.deepEqual(drawRanges(batch, model.layers, range), {
    colored: [0, 4],
    muted: [0, 0],
  });
  assert.deepEqual(drawRanges(batch, model.layers, { ...range, move: 5 }), {
    colored: [2, 1],
    muted: [0, 2],
  });
  assert.deepEqual(drawRanges(batch, model.layers, { ...range, move: 4 }), {
    colored: [2, 0],
    muted: [0, 2],
  });
  assert.deepEqual(drawRanges(batch, model.layers, { ...range, low: 1 }), {
    colored: [2, 2],
    muted: [2, 0],
  });
  assert.deepEqual(
    drawRanges(batch, model.layers, {
      ...range,
      visible: Array(19).fill(false),
    }),
    { colored: [0, 0], muted: [0, 0] },
  );
});

void test('compact instances preserve every path endpoint, dimension, type and source line', () => {
  const source = createSampleGcode();
  assert.equal(source, createSampleGcode());
  const parsed = parseGcode(source);
  assert.equal(parsed.layers.length, 144);
  assert.equal(parsed.diagnostics.length, 0);
  for (const role of [1, 2, 4, 13, 14]) assert.ok(parsed.roleCounts[role] > 0);
  const model = buildGeometry(parsed);
  for (const batch of model.batches) {
    assert.ok(batch.instances.every(Number.isFinite));
    const expected = [];
    const ids = [];
    for (let i = 0; i < parsed.segmentCount; i++) {
      if (parsed.segments[i * STRIDE + 8] !== batch.role) continue;
      expected.push(...parsed.segments.subarray(i * STRIDE, i * STRIDE + 8));
      ids.push(parsed.segments[i * STRIDE + 9]);
    }
    assert.deepEqual(Array.from(batch.instances), expected);
    assert.deepEqual(Array.from(batch.moveIds), ids);
    assert.equal(
      batch.instances.byteLength + batch.moveIds.byteLength,
      ids.length * 36,
    );
    assert.ok(
      batch.moveIds.every(
        (id, index) => index === 0 || id >= batch.moveIds[index - 1],
      ),
    );
  }
});

void test('geometry budget is checked before allocating batch buffers', () => {
  const parsed = parseGcode('M83\nG1 X1 E1');
  assert.throws(
    () => buildGeometry({ ...parsed, segmentCount: MAX_SEGMENTS + 1 }),
    /1024 MiB/,
  );
});

void test('instance visibility and stepping update ranges without rebuilding buffers', () => {
  const parsed = parseGcode(
    'M83\nG1 X10 Z0.2 E1\nG1 Y10 E1\nG1 X0 Z0.4 E1\nG1 Y0 E1',
  );
  const model = buildGeometry(parsed),
    batch = model.batches[0];
  const view = createInstanceMesh(batch);
  const attribute = view.mesh.geometry.getAttribute('pathStart');
  const range: ViewRange = {
    low: 0,
    high: 1,
    move: 4,
    visible: Array(19).fill(true),
  };
  view.setIntervals(drawRanges(batch, model.layers, range));
  assert.equal(view.mesh.geometry.instanceCount, 3);
  assert.equal(view.mesh.visible, true);
  view.setIntervals(drawRanges(batch, model.layers, { ...range, move: 5 }));
  assert.equal(view.mesh.geometry.instanceCount, 4);
  assert.equal(view.mesh.geometry.getAttribute('pathStart'), attribute);
  view.setIntervals(
    drawRanges(batch, model.layers, {
      ...range,
      visible: Array(19).fill(false),
    }),
  );
  assert.equal(view.mesh.visible, false);
  assert.equal(view.mesh.geometry.instanceCount, 0);
  view.mesh.geometry.dispose();
  view.mesh.material.dispose();
});
