'use client';

import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

export function NumericControl({
  label,
  displayValue,
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  disabled,
}: {
  label: string;
  displayValue: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[13px] text-text-soft">{label}</span>
        <output className="font-mono text-[11px] tabular-nums text-text-strong">
          {displayValue}
        </output>
      </div>
      <Slider
        aria-label={label}
        disabled={disabled}
        onValueCommitted={onCommit}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) =>
          onChange((Array.isArray(next) ? next[0] : next) ?? value)
        }
        className="[&_[data-slot=slider-range]]:bg-accent-soft [&_[data-slot=slider-thumb]]:border-accent-soft/60"
      />
    </div>
  );
}

export function ToggleControl({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-5 py-1">
      <div>
        <p className="text-[13px] text-text-body">{label}</p>
        {description && (
          <p className="mt-1 text-[11px] leading-4 text-text-subtle">
            {description}
          </p>
        )}
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="data-checked:bg-accent-soft"
      />
    </div>
  );
}
