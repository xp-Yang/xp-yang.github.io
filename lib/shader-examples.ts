import sources from '@/content/shader-sources.json';

export const SHADER_REPOSITORY = 'https://github.com/xp-Yang/shader-examples';
export const SHADER_REVISION = 'ee537cc8a2f0f9ae1f6d96f1d1b1658d2469bc33';

export type ShaderExample = {
  slug: string;
  title: string;
  category: string;
  path: keyof typeof sources;
  summary: string;
  time: number;
  animated: boolean;
  credit?: string;
  license?: string;
};

export const shaderExamples: ShaderExample[] = [
  { slug: 'ocean', title: '海面', category: 'Simulation', path: 'shader2d/Simulation/ocean.glsl', summary: '程序化海浪、天空反射与海面光照。', time: 2, animated: true, credit: 'Seascape · Alexander Alekseev / TDM (2014)', license: 'CC BY-NC-SA 3.0' },
  { slug: 'beating-heart', title: '跳动的心', category: 'Simulation', path: 'shader2d/Simulation/beatingHeart.glsl', summary: '三十层旋转与波动叠加，形成红色的分形脉动。', time: 3.2, animated: true },
  { slug: 'halo', title: '光晕', category: 'Simulation', path: 'shader2d/Simulation/halo.glsl', summary: '三个颜色通道的相位偏移，构成波动的光点与光环。', time: 2.6, animated: true, credit: 'Danilo Guanabara · Shadertoy XsXXDn（原源码署名）' },
  { slug: 'virus', title: '病毒形态', category: 'Simulation', path: 'shader2d/Simulation/virus.glsl', summary: '通过距离场光线步进绘制的艺术化微观形态，并非科学模型。', time: 8, animated: true, credit: 'Corona Virus · Martijn Steinrucken / BigWings (2020)', license: 'CC BY-NC-SA 3.0' },
  { slug: 'flash-line', title: '闪烁连线', category: 'Noise', path: 'shader2d/noise/flashLine.glsl', summary: '多层发光节点与连线；移动鼠标可改变视差。', time: 35, animated: true, credit: 'The Universe Within · Martijn Steinrucken / BigWings (2018)', license: 'CC BY-NC-SA 3.0' },
  { slug: 'voronoi', title: 'Voronoi 色块', category: 'Noise', path: 'shader2d/noise/voronoi.glsl', summary: '动态种子点划分细胞边界，并以噪声生成颜色。', time: 2.5, animated: true, credit: '噪声公共函数保留 Morgan McGuire 与 Inigo Quilez 的原始署名。' },
  { slug: 'circle-sdf', title: '圆形距离场', category: 'SDF', path: 'shader2d/SDF/circleSDF.glsl', summary: '将到圆形边界的有符号距离直接映射为灰度。', time: 0, animated: false },
  { slug: 'rectangle-sdf', title: '矩形等距线', category: 'SDF', path: 'shader2d/SDF/rectSDF.glsl', summary: '将矩形距离场重复取样，显示黑白等距线。', time: 0, animated: false },
  { slug: 'segment-sdf', title: '线段距离场', category: 'SDF', path: 'shader2d/SDF/segmentSDF.glsl', summary: '用投影与截断计算到有限线段的距离。', time: 0, animated: false },
  { slug: 'triangle-sdf', title: '三角形等距线', category: 'SDF', path: 'shader2d/SDF/triangleSDF.glsl', summary: '通过对称折叠绘制等边三角形的距离场等高线。', time: 0, animated: false },
  { slug: 'grid', title: '抗锯齿网格', category: 'Pattern', path: 'shader2d/pattern/grid.glsl', summary: '使用屏幕空间导数控制边界宽度的规则网格。', time: 0, animated: false },
];

export function shaderSourceUrl(example: ShaderExample) {
  return `${SHADER_REPOSITORY}/blob/${SHADER_REVISION}/${example.path}`;
}

// Expand the repository's relative includes without changing the source effects.
export function shaderSource(path: string, chain: string[] = []): string {
  if (chain.includes(path)) throw new Error(`Circular shader include: ${path}`);
  const source = (sources as Record<string, string>)[path];
  if (source === undefined) throw new Error(`Missing shader include: ${path}`);
  return source.replace(/^\s*#include\s+"([^"]+)"\s*$/gm, (_, include: string) => {
    const parts = path.split('/').slice(0, -1);
    for (const part of include.split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
    }
    return shaderSource(parts.join('/'), [...chain, path]);
  });
}
