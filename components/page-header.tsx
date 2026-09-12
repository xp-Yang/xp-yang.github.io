type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  count?: number;
};

export function PageHeader({ eyebrow, title, description, count }: PageHeaderProps) {
  return (
    <header className="border-b border-white/10 pb-14 pt-36 md:pb-20 md:pt-44">
      <div className="site-shell">
        <div className="flex items-start justify-between gap-8">
          <div className="max-w-3xl">
            <p className="eyebrow mb-5 flex items-center gap-3"><span className="h-px w-8 bg-[#ff9f43]" />{eyebrow}</p>
            <h1 className="text-balance text-5xl font-medium tracking-[-0.055em] md:text-7xl">{title}</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-400">{description}</p>
          </div>
          {typeof count === 'number' && <span className="mt-2 font-mono text-xs text-stone-600">{String(count).padStart(2, '0')} entries</span>}
        </div>
      </div>
    </header>
  );
}
