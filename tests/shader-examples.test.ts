import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderExamples, shaderSource, shaderSourceUrl } from '../lib/shader-examples';
import { fragmentSource } from '../lib/shader-renderer';

test('all 11 runnable examples have unique routes and fully resolved includes', () => {
  assert.equal(shaderExamples.length, 11);
  assert.equal(new Set(shaderExamples.map(item => item.slug)).size, 11);
  for (const example of shaderExamples) {
    const source = shaderSource(example.path);
    assert.match(source, /void mainImage\s*\(/);
    assert.doesNotMatch(source, /#include/);
    assert.match(shaderSourceUrl(example), /^https:\/\/github.com\/xp-Yang\/shader-examples\/blob\//);
    assert.match(fragmentSource(source), /^#version 300 es/);
  }
});
test('source attributions are preserved and legacy float suffix is normalized', () => {
  assert.match(shaderSource('shader2d/Simulation/ocean.glsl'), /Alexander Alekseev/);
  assert.match(shaderSource('shader2d/Simulation/virus.glsl'), /NonCommercial-ShareAlike/);
  assert.match(shaderSource('shader2d/Simulation/halo.glsl'), /Danilo Guanabara/);
  assert.doesNotMatch(fragmentSource(shaderSource('shader2d/noise/flashLine.glsl')), /0\.0f/);
  assert.throws(() => shaderSource('missing.glsl'), /Missing shader include/);
});
