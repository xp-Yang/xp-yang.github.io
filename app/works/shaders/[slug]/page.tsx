import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ShaderExperience } from '@/components/shader-experience';
import { shaderExamples } from '@/lib/shader-examples';

export function generateStaticParams() { return shaderExamples.map(({ slug }) => ({ slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const example = shaderExamples.find(item => item.slug === slug);
  return { title: example?.title ?? 'Shader', description: example?.summary };
}

export default async function ShaderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const example = shaderExamples.find(item => item.slug === slug);
  if (!example) notFound();
  return <ShaderExperience example={example} />;
}
