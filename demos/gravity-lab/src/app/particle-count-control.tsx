import { useState } from 'react';
import { Input, Slider } from '@/components/ui';
import { MIN_PARTICLES, MAX_PARTICLES } from '../physics/limits.js';

export function ParticleCountControl({ value, onChange }: {
  value: number; onChange: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const display = text ?? String(value);
  const parsed = Number(display);
  const valid = display.trim() !== '' && Number.isInteger(parsed)
    && parsed >= MIN_PARTICLES && parsed <= MAX_PARTICLES;

  function commit() {
    const next = display.trim() !== '' && Number.isFinite(parsed)
      ? Math.round(Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, parsed))) : value;
    setText(null);
    onChange(next);
  }

  return <div className="control space-y-2.5">
    <div className="flex items-center justify-between gap-4">
      <label htmlFor="particle-count-input" className="text-[13px] text-text-soft">粒子数量</label>
      <Input id="particle-count-input" className="particle-count-input" type="number" inputMode="numeric"
        min={MIN_PARTICLES} max={MAX_PARTICLES} step={1} value={display}
        aria-invalid={!valid} aria-describedby="particle-count-hint"
        onChange={event => {
          const next = event.currentTarget.value, number = Number(next);
          setText(next);
          if (next.trim() !== '' && Number.isInteger(number) && number >= MIN_PARTICLES && number <= MAX_PARTICLES) onChange(number);
        }}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === 'Escape') { event.preventDefault(); setText(null); }
        }} />
    </div>
    <span id="particle-count-hint" className="sr-only">输入 2–20,000 之间的整数；回车或离开输入框时，超出范围的值会调整到范围内。</span>
    <Slider aria-label="粒子数量" value={[value]} min={MIN_PARTICLES} max={MAX_PARTICLES} step={1}
      onValueChange={next => {
        setText(null);
        onChange((Array.isArray(next) ? next[0] : next) ?? value);
      }}
      className="[&_[data-slot=slider-range]]:bg-accent-soft [&_[data-slot=slider-thumb]]:border-accent-soft/60" />
  </div>;
}
