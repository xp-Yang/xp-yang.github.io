'use client';

import { RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DEFAULT_BLACK_HOLE_CONTROLS,
  type BlackHoleCameraMode,
  type BlackHoleControls,
  type BlackHoleQuality,
} from '@/lib/black-hole/controls';

function NumericControl({
  label,
  displayValue,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  displayValue: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[13px] text-stone-300">{label}</span>
        <output className="font-mono text-[11px] tabular-nums text-stone-100">
          {displayValue}
        </output>
      </div>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) =>
          onChange((Array.isArray(next) ? next[0] : next) ?? value)
        }
        className="[&_[data-slot=slider-range]]:bg-[#ffad61] [&_[data-slot=slider-thumb]]:border-[#ffad61]/60"
      />
    </div>
  );
}

function ToggleControl({
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
        <p className="text-[13px] text-stone-200">{label}</p>
        {description && (
          <p className="mt-1 text-[11px] leading-4 text-stone-500">
            {description}
          </p>
        )}
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="data-checked:bg-[#ffad61]"
      />
    </div>
  );
}

function FixedRadii() {
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10">
      {[
        ['2M', '事件视界'],
        ['3M', '光子球'],
        ['6M', 'ISCO'],
      ].map(([value, label]) => (
        <div key={label} className="bg-[#090b0f]/95 px-2 py-3 text-center">
          <strong className="block font-mono text-[13px] font-normal text-[#ffad61]">
            {value}
          </strong>
          <span className="mt-1 block text-[10px] text-stone-500">{label}</span>
        </div>
      ))}
    </div>
  );
}

export function BlackHoleControlPanel({
  controls,
  onChange,
}: {
  controls: BlackHoleControls;
  onChange: (controls: BlackHoleControls) => void;
}) {
  const [open, setOpen] = useState(true);
  const update = <Key extends keyof BlackHoleControls>(
    key: Key,
    value: BlackHoleControls[Key],
  ) => onChange({ ...controls, [key]: value });

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 h-11 border-white/15 bg-black/65 px-4 text-stone-100 backdrop-blur-xl hover:bg-white/10 md:bottom-auto md:top-20"
      >
        <SlidersHorizontal className="size-4 text-[#ffad61]" />
        调整参数
      </Button>
    );
  }

  return (
    <aside
      aria-label="黑洞观测参数"
      className="fixed inset-x-3 bottom-3 z-50 flex max-h-[72svh] flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#07090d]/88 text-stone-100 shadow-2xl shadow-black/60 backdrop-blur-2xl md:inset-x-auto md:bottom-auto md:right-5 md:top-20 md:max-h-[calc(100svh-6rem)] md:w-[22.5rem]"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#ffad61]">
            Schwarzschild observer
          </p>
          <h2 className="mt-1 text-sm font-medium tracking-wide">观测参数</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="恢复默认参数"
            title="恢复默认参数"
            onClick={() => onChange({ ...DEFAULT_BLACK_HOLE_CONTROLS })}
            className="text-stone-400 hover:bg-white/10 hover:text-white"
          >
            <RotateCcw className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="收起参数面板"
            title="收起参数面板"
            onClick={() => setOpen(false)}
            className="text-stone-400 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="observe" className="min-h-0 flex-1 gap-0">
        <TabsList
          variant="line"
          className="grid h-11 w-full grid-cols-3 border-b border-white/10 px-3"
        >
          <TabsTrigger
            value="observe"
            className="rounded-none text-xs data-active:text-white"
          >
            观察
          </TabsTrigger>
          <TabsTrigger
            value="physics"
            className="rounded-none text-xs data-active:text-white"
          >
            物理
          </TabsTrigger>
          <TabsTrigger
            value="imaging"
            className="rounded-none text-xs data-active:text-white"
          >
            成像
          </TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-color:rgba(255,255,255,.18)_transparent]">
          <TabsContent value="observe" className="space-y-5">
            <NumericControl
              label="水平视角"
              displayValue={`${Math.round(controls.azimuth)}°`}
              value={controls.azimuth}
              min={-180}
              max={180}
              step={1}
              onChange={(value) => update('azimuth', value)}
            />
            <NumericControl
              label="盘面倾角"
              displayValue={`${Math.round(controls.inclination)}°`}
              value={controls.inclination}
              min={0}
              max={85}
              step={1}
              onChange={(value) => update('inclination', value)}
            />
            <NumericControl
              label="观察距离"
              displayValue={`${controls.observerRadius.toFixed(0)} M`}
              value={controls.observerRadius}
              min={10}
              max={80}
              step={1}
              onChange={(value) => update('observerRadius', value)}
            />
            <NumericControl
              label="画面缩放"
              displayValue={`${controls.zoom.toFixed(2)}×`}
              value={controls.zoom}
              min={0.5}
              max={2.4}
              step={0.01}
              onChange={(value) => update('zoom', value)}
            />
            <div className="space-y-2">
              <p className="text-[13px] text-stone-300">相机模式</p>
              <Select
                value={controls.cameraMode}
                onValueChange={(value) =>
                  value && update('cameraMode', value as BlackHoleCameraMode)
                }
              >
                <SelectTrigger className="h-10 w-full border-white/10 bg-white/[.035] text-stone-100">
                  <SelectValue>
                    {
                      {
                        free: '自由观察',
                        orbit: '稳定圆轨道',
                        fixed: '固定观测点',
                      }[controls.cameraMode]
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#0b0d12] text-stone-100">
                  <SelectItem value="free">自由观察</SelectItem>
                  <SelectItem value="orbit">稳定圆轨道</SelectItem>
                  <SelectItem value="fixed">固定观测点</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="border-t border-white/8 pt-3 font-mono text-[10px] leading-5 text-stone-500">
              拖动画面调整视角 · 滚轮缩放
            </p>
          </TabsContent>

          <TabsContent value="physics" className="space-y-5">
            <NumericControl
              label="黑洞质量"
              displayValue={`10^${Math.log10(controls.blackHoleMassSolar).toFixed(1)} M☉`}
              value={Math.log10(controls.blackHoleMassSolar)}
              min={6}
              max={10}
              step={0.05}
              onChange={(value) =>
                update('blackHoleMassSolar', Math.pow(10, value))
              }
            />
            <NumericControl
              label="吸积率"
              displayValue={`${controls.eddingtonRatio.toFixed(2)} Edd`}
              value={controls.eddingtonRatio}
              min={0.01}
              max={1}
              step={0.01}
              onChange={(value) => update('eddingtonRatio', value)}
            />
            <NumericControl
              label="吸积盘外径"
              displayValue={`${controls.diskOuterRadius.toFixed(0)} M`}
              value={controls.diskOuterRadius}
              min={12}
              max={48}
              step={1}
              onChange={(value) => update('diskOuterRadius', value)}
            />
            <ToggleControl
              label="观察者轨道运动"
              description="启用局部光行差与相对论频移"
              checked={controls.observerMotion}
              onCheckedChange={(value) => update('observerMotion', value)}
            />
            <FixedRadii />
          </TabsContent>

          <TabsContent value="imaging" className="space-y-5">
            <div className="space-y-2">
              <p className="text-[13px] text-stone-300">渲染质量</p>
              <Select
                value={controls.quality}
                onValueChange={(value) =>
                  value && update('quality', value as BlackHoleQuality)
                }
              >
                <SelectTrigger className="h-10 w-full border-white/10 bg-white/[.035] text-stone-100">
                  <SelectValue>
                    {
                      {
                        auto: '自动',
                        high: '高',
                        balanced: '平衡',
                        safe: '省电',
                      }[controls.quality]
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#0b0d12] text-stone-100">
                  <SelectItem value="auto">自动</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="balanced">平衡</SelectItem>
                  <SelectItem value="safe">省电</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NumericControl
              label="曝光"
              displayValue={controls.exposure.toFixed(2)}
              value={controls.exposure}
              min={0.25}
              max={1.5}
              step={0.01}
              onChange={(value) => update('exposure', value)}
            />
            <NumericControl
              label="传感器泛光"
              displayValue={controls.bloom.toFixed(2)}
              value={controls.bloom}
              min={0}
              max={0.7}
              step={0.01}
              onChange={(value) => update('bloom', value)}
            />
            <ToggleControl
              label="程序化星空"
              checked={controls.starsEnabled}
              onCheckedChange={(value) => update('starsEnabled', value)}
            />
            <ToggleControl
              label="性能信息"
              description="显示 FPS、GPU 时间与内部画幅"
              checked={controls.performanceInfo}
              onCheckedChange={(value) => update('performanceInfo', value)}
            />
            <p className="rounded-lg border border-white/8 bg-white/[.025] px-3 py-2.5 font-mono text-[10px] leading-5 text-stone-500">
              ACES tone mapping · Linear sRGB
            </p>
          </TabsContent>
        </div>
      </Tabs>

      <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-stone-500">
        <span className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.7)]" />
          实时生效
        </span>
        <span>G = c = M = 1</span>
      </div>
    </aside>
  );
}
