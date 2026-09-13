export function scrollbarGeometry(viewport: number, content: number, track: number, scroll: number) {
  const maximum = Math.max(0, content - viewport);
  const thumb = Math.min(track, Math.max(44, track * viewport / Math.max(1, content)));
  const travel = Math.max(0, track - thumb);
  const position = Math.min(maximum, Math.max(0, scroll));
  return { maximum, thumb, travel, offset: maximum ? position / maximum * travel : 0, progress: maximum ? Math.round(position / maximum * 100) : 0, scrollable: maximum > 1 && travel > 0 };
}

export function scrollbarKeyTarget(key: string, position: number, viewport: number, maximum: number, shift: boolean) {
  const page = viewport * 0.9;
  const targets: Record<string, number> = { ArrowDown: position + 60, ArrowUp: position - 60, PageDown: position + page, PageUp: position - page, Home: 0, End: maximum, ' ': position + (shift ? -page : page) };
  return key in targets ? Math.max(0, Math.min(maximum, targets[key])) : null;
}
