import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderExamples, shaderSource, shaderSourceUrl } from '../lib/shader-examples';
import { fragmentSource } from '../lib/shader-renderer';
import { gridCamera, gridStageSource } from '../lib/grid-camera';

test('all 12 runnable examples have unique routes and fully resolved includes', () => {
  assert.equal(shaderExamples.length, 12);
  assert.equal(new Set(shaderExamples.map(item => item.slug)).size, 12);
  for (const example of shaderExamples) {
    const source = shaderSource(example.path);
    assert.match(source, example.vertexPath ? /void main\s*\(/ : /void mainImage\s*\(/);
    assert.doesNotMatch(source, /#include/);
    assert.match(shaderSourceUrl(example), /^(https:\/\/github.com\/xp-Yang\/shader-examples\/blob\/|\/shaders\/)/);
    assert.match(example.vertexPath ? gridStageSource(source) : fragmentSource(source), /^#version 300 es/);
  }
});

test('reverses S01-S11 and appends the original 3D grid as S12', () => {
  assert.deepEqual(shaderExamples.map(item => item.slug), ['grid', 'triangle-sdf', 'segment-sdf', 'rectangle-sdf', 'circle-sdf', 'voronoi', 'flash-line', 'virus', 'halo', 'beating-heart', 'ocean', 'pristine-grid']);
  const example = shaderExamples[11];
  assert.match(shaderSource(example.vertexPath!), /inverse\(view\)/);
  assert.match(shaderSource(example.path), /gl_FragDepth = computeDepth/);
  assert.match(shaderSource(example.path), /grid\(fragPos3D, 0.1\)/);
  const camera = gridCamera(4 / 3);
  assert.ok([...camera.view, ...camera.projection].every(Number.isFinite));
  assert.equal(camera.view[14], -16);
  assert.ok(Math.abs(camera.projection[0] * 4 / 3 - camera.projection[5]) < 1e-6);
});
test('source attributions are preserved and legacy float suffix is normalized', () => {
  assert.match(shaderSource('shader2d/Simulation/ocean.glsl'), /Alexander Alekseev/);
  assert.match(shaderSource('shader2d/Simulation/virus.glsl'), /NonCommercial-ShareAlike/);
  assert.match(shaderSource('shader2d/Simulation/halo.glsl'), /Danilo Guanabara/);
  assert.doesNotMatch(fragmentSource(shaderSource('shader2d/noise/flashLine.glsl')), /0\.0f/);
  assert.throws(() => shaderSource('missing.glsl'), /Missing shader include/);
});
