import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import {
  ArrowUpRight,
  ChevronLeftIcon,
  ChevronRightIcon,
  MinusIcon,
  SlidersHorizontal,
  Button,
  Input,
  NumericControl,
  ToggleControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';

type Control = HTMLInputElement | HTMLSelectElement;

// The simulation retains its original DOM bindings; React supplies shared UI.
function useControl(input: Control) {
  const output = document.getElementById(`${input.id}-value`);
  const read = useCallback(
    () => ({
      value: input.value,
      checked: input instanceof HTMLInputElement && input.checked,
      disabled: input.disabled,
      display: output?.textContent ?? input.value,
    }),
    [input, output],
  );
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    input.addEventListener('input', update);
    input.addEventListener('change', update);
    const observer = new MutationObserver(update);
    observer.observe(input, {
      attributes: true,
      attributeFilter: ['disabled'],
    });
    if (output)
      observer.observe(output, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    return () => {
      input.removeEventListener('input', update);
      input.removeEventListener('change', update);
      observer.disconnect();
    };
  }, [input, output, read]);
  return state;
}

function setValue(input: Control, value: string, commit = true) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (commit) input.dispatchEvent(new Event('change', { bubbles: true }));
}

function setChecked(input: HTMLInputElement, checked: boolean) {
  input.checked = checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function RangeControl({
  input,
  label,
  help,
}: {
  input: HTMLInputElement;
  label: string;
  help: string;
}) {
  const state = useControl(input);
  return (
    <>
      <NumericControl
        label={label}
        value={Number(state.value)}
        displayValue={state.display}
        min={Number(input.min)}
        max={Number(input.max)}
        step={Number(input.step)}
        disabled={state.disabled}
        onChange={(value) => setValue(input, String(value), false)}
        onCommit={() =>
          input.dispatchEvent(new Event('change', { bubbles: true }))
        }
      />
      {help && (
        <p className="mt-2 text-[11px] leading-4 text-text-subtle">{help}</p>
      )}
    </>
  );
}

function ComboControl({
  input,
  label,
}: {
  input: HTMLSelectElement;
  label: string;
}) {
  const state = useControl(input);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const panels = [
      input.closest<HTMLElement>('#initial-panel-body, #live-parameters'),
      input.closest<HTMLElement>('#live-panel-body'),
    ].filter((panel): panel is HTMLElement => panel !== null);
    if (!panels.length) return;
    const observer = new MutationObserver(() => {
      if (panels.some(panel => panel.inert || panel.hidden)) setOpen(false);
    });
    for (const panel of panels) observer.observe(panel, {
      attributes: true,
      attributeFilter: ['inert', 'hidden'],
    });
    return () => observer.disconnect();
  }, [input]);
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-text-soft">{label}</p>
      <Select
        value={state.value}
        disabled={state.disabled}
        open={open}
        onOpenChange={setOpen}
        onValueChange={(value) => value && setValue(input, value)}
      >
        <SelectTrigger
          aria-label={label}
          className="h-10 w-full border-white/10 bg-white/[.035] text-text-strong"
        >
          <SelectValue>
            {
              Array.from(input.options).find(
                (option) => option.value === state.value,
              )?.textContent
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="border-white/10 bg-surface-control text-text-strong">
          {Array.from(input.options).map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.textContent}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function CheckControl({
  input,
  label,
}: {
  input: HTMLInputElement;
  label: string;
}) {
  const state = useControl(input);
  return (
    <ToggleControl
      label={label}
      checked={state.checked}
      onCheckedChange={(checked) => setChecked(input, checked)}
    />
  );
}

function SeedControl({ input }: { input: HTMLInputElement }) {
  const state = useControl(input);
  return (
    <Input
      id="seed-ui"
      type="number"
      required
      min={input.min}
      max={input.max}
      step={input.step}
      aria-label="随机种子"
      value={state.value}
      disabled={state.disabled}
      onChange={(event) => setValue(input, event.target.value)}
      className="h-10 w-[88px] border-white/10 bg-white/[.035] font-mono text-[11px] text-text-strong"
    />
  );
}

function LivePanelTabs({
  parameters,
  errors,
}: {
  parameters: HTMLElement;
  errors: HTMLElement;
}) {
  const [tab, setTab] = useState('parameters');
  const scrollArea = useRef<HTMLDivElement>(null);
  // Retain the existing controls and diagnostic outputs across tab switches.
  const attachParameters = useCallback((host: HTMLDivElement | null) => {
    if (host) host.append(parameters);
  }, [parameters]);
  const attachErrors = useCallback((host: HTMLDivElement | null) => {
    if (host) host.append(errors);
  }, [errors]);
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (value !== 'parameters' && value !== 'errors') return;
        parameters.inert = value !== 'parameters';
        setTab(value);
        if (scrollArea.current) scrollArea.current.scrollTop = 0;
      }}
      className="h-full min-h-0 flex-1 gap-0"
    >
      <TabsList
        variant="line"
        className="grid h-11 w-full shrink-0 grid-cols-2 border-b border-white/10 px-3"
        aria-label="参数面板"
      >
        <TabsTrigger value="parameters" className="rounded-none text-xs data-active:text-white">
          参数
        </TabsTrigger>
        <TabsTrigger value="errors" className="rounded-none text-xs data-active:text-white">
          误差
        </TabsTrigger>
      </TabsList>
      <div ref={scrollArea} className="live-panel-scroll">
        <TabsContent value="parameters" keepMounted ref={attachParameters} />
        <TabsContent value="errors" keepMounted ref={attachErrors} />
      </div>
    </Tabs>
  );
}

export function mountWorkControls() {
  const roots: ReturnType<typeof createRoot>[] = [];
  const panelIcons = {
    minus: MinusIcon,
    parameters: SlidersHorizontal,
    left: ChevronLeftIcon,
    right: ChevronRightIcon,
  };
  for (const host of document.querySelectorAll<HTMLElement>('[data-panel-icon]')) {
    const Icon = panelIcons[host.dataset.panelIcon as keyof typeof panelIcons];
    const root = createRoot(host);
    roots.push(root);
    flushSync(() => root.render(<Icon className="size-4" />));
  }
  const mount = (container: HTMLElement, nodes: Node[], content: ReactNode) => {
    const bindings = document.createElement('div');
    bindings.hidden = true;
    bindings.inert = true;
    bindings.append(...nodes);
    const host = document.createElement('div');
    container.replaceChildren(bindings, host);
    const root = createRoot(host);
    roots.push(root);
    flushSync(() => root.render(content));
  };

  for (const input of document.querySelectorAll<HTMLInputElement>(
    '.control input[type=range]',
  )) {
    const container = input.parentElement!;
    const label = container
      .querySelector('.control-label')!
      .firstChild!.textContent!.trim();
    const help = container.querySelector('small')?.textContent ?? '';
    mount(
      container,
      Array.from(container.childNodes),
      <RangeControl input={input} label={label} help={help} />,
    );
  }
  for (const input of document.querySelectorAll<HTMLSelectElement>(
    '.select-control select',
  )) {
    const container = input.parentElement!;
    const label = container.firstChild!.textContent!.trim();
    mount(
      container,
      Array.from(container.childNodes),
      <ComboControl input={input} label={label} />,
    );
  }
  for (const checkbox of document.querySelectorAll<HTMLInputElement>(
    '.toggle-row input[type=checkbox]',
  )) {
    const toggle = checkbox.parentElement!;
    const toggleLabel = toggle.querySelector('label')!.textContent!;
    mount(
      toggle,
      Array.from(toggle.childNodes),
      <CheckControl input={checkbox} label={toggleLabel} />,
    );
  }

  const seed = document.getElementById('seed') as HTMLInputElement;
  const seedHost = document.createElement('div');
  seed.replaceWith(seedHost);
  mount(seedHost, [seed], <SeedControl input={seed} />);

  for (const id of ['new-seed', 'apply']) {
    const button = document.getElementById(id) as HTMLButtonElement;
    const host = document.createElement('div');
    host.className = id === 'apply' ? 'apply-control' : 'seed-button-control';
    button.replaceWith(host);
    mount(
      host,
      [button],
      <Button
        type="button"
        variant={id === 'apply' ? 'outline' : 'ghost'}
        onClick={() => button.click()}
        title={button.title || undefined}
        className={
          id === 'apply'
            ? 'h-10 w-full justify-between border-white/15 bg-white/[.035] text-text-strong hover:bg-white/10'
            : 'text-text-muted hover:bg-white/10 hover:text-white'
        }
      >
        {id === 'apply' ? '应用' : '换一个'}
        <ArrowUpRight className="size-4" />
      </Button>,
    );
  }
  const livePanelRoot = createRoot(document.getElementById('live-panel-body')!);
  const parameters = document.getElementById('live-parameters')!;
  const errors = document.getElementById('live-errors')!;
  roots.push(livePanelRoot);
  flushSync(() => livePanelRoot.render(
    <LivePanelTabs parameters={parameters} errors={errors} />,
  ));
  return () => roots.forEach((root) => root.unmount());
}
