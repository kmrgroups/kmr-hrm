// Organisation chart layout — pure functions (no database, no DOM), so the screen and the PDF draw exactly the same chart.
// Top-down tree. Each box is centred over its children; a group of more than STACK_MIN end-of-line boxes (people with nobody reporting
// to them) hangs in a single column under their manager so a supervisor with 20 operators does not make the chart 20 boxes wide.

export interface OrgItem {
  key: string;                      // "e:<employee id>" or "n:<box id>"
  parent: string | null;            // key of the box this one reports to
  title: string;                    // person's name (or the vacancy / position)
  subtitle?: string;                // designation / position
  line3?: string;                   // employee code · department
  group: string;                    // department name: gives the colour bar
  kind: "person" | "vacant" | "external";
  order: number;
}
export interface Placed extends OrgItem { x: number; y: number; w: number; h: number; level: number }
export interface Layout { nodes: Placed[]; edges: [number, number][][]; width: number; height: number; levels: number }

export const BOX = { w: 184, h: 60, gapX: 16, gapY: 38, indent: 26, stackGap: 8 };
export const STACK_MIN = 4;
const PAD = 14;

const cmp = (a: OrgItem, b: OrgItem) => a.order - b.order || a.title.localeCompare(b.title, "en", { sensitivity: "base" });

/** Cuts the chart at `maxLevels` (1 = top boxes only); null = everything */
export function trimLevels(items: OrgItem[], maxLevels: number | null): OrgItem[] {
  if (!maxLevels || maxLevels < 1) return items;
  const depth = depthMap(items);
  return items.filter((i) => (depth.get(i.key) ?? 0) < maxLevels);
}

function depthMap(items: OrgItem[]): Map<string, number> {
  const by = new Map(items.map((i) => [i.key, i]));
  const depth = new Map<string, number>();
  const walk = (k: string, seen: Set<string>): number => {
    if (depth.has(k)) return depth.get(k)!;
    const it = by.get(k)!;
    if (!it.parent || !by.has(it.parent) || seen.has(it.parent)) { depth.set(k, 0); return 0; }
    seen.add(k);
    const d = walk(it.parent, seen) + 1; depth.set(k, d); return d;
  };
  for (const i of items) walk(i.key, new Set());
  return depth;
}

export function layoutChart(items: OrgItem[]): Layout {
  const by = new Map(items.map((i) => [i.key, i]));
  const kids = new Map<string, OrgItem[]>();
  const roots: OrgItem[] = [];
  const placedKeys = new Set<string>();
  for (const i of items) {
    if (i.parent && by.has(i.parent) && i.parent !== i.key) (kids.get(i.parent) ?? kids.set(i.parent, []).get(i.parent)!).push(i);
    else roots.push(i);
  }
  for (const l of kids.values()) l.sort(cmp);
  roots.sort(cmp);
  // a loop of people reporting to each other has no top: break it at its first box so nobody disappears from the chart
  const reach = new Set<string>();
  const mark = (k: string) => { if (reach.has(k)) return; reach.add(k); for (const c of kids.get(k) ?? []) mark(c.key); };
  roots.forEach((r) => mark(r.key));
  for (const i of [...items].sort(cmp)) if (!reach.has(i.key)) { kids.get(i.parent!)?.splice(kids.get(i.parent!)!.indexOf(i), 1); roots.push(i); mark(i.key); }

  const { w, h, gapX, gapY, indent, stackGap } = BOX;
  type Slot = { kind: "tree" | "stack"; items: OrgItem[]; width: number };
  const slotsOf = (it: OrgItem): Slot[] => {
    const ch = kids.get(it.key) ?? [];
    const leaves = ch.filter((c) => !(kids.get(c.key)?.length));
    const stack = leaves.length > STACK_MIN ? leaves : [];
    const slots: Slot[] = ch.filter((c) => !stack.includes(c)).map((c) => ({ kind: "tree" as const, items: [c], width: widthOf(c) }));
    if (stack.length) slots.push({ kind: "stack", items: stack, width: indent + w });
    return slots;
  };
  const wcache = new Map<string, number>();
  const widthOf = (it: OrgItem): number => {
    const c = wcache.get(it.key); if (c != null) return c;
    const slots = slotsOf(it);
    const total = slots.reduce((s, x) => s + x.width, 0) + gapX * Math.max(0, slots.length - 1);
    const v = Math.max(w, total); wcache.set(it.key, v); return v;
  };

  const nodes: Placed[] = [];
  const edges: [number, number][][] = [];
  const place = (it: OrgItem, left: number, top: number, level: number) => {
    placedKeys.add(it.key);
    const slots = slotsOf(it);
    const total = slots.reduce((s, x) => s + x.width, 0) + gapX * Math.max(0, slots.length - 1);
    const blockW = widthOf(it);
    let sx = left + (blockW - total) / 2;
    const childTop = top + h + gapY, busY = top + h + gapY / 2;
    const anchors: number[] = [];
    const drops: [number, number][][] = [];
    for (const s of slots) {
      if (s.kind === "tree") {
        const c = s.items[0]!; const cx = place(c, sx, childTop, level + 1);
        anchors.push(cx); drops.push([[cx, busY], [cx, childTop]]);
      } else {
        const spine = sx + 9;
        let y = busY + 12, lastMid = y;
        for (const c of s.items) {
          nodes.push({ ...c, x: sx + indent, y, w, h, level: level + 1 }); placedKeys.add(c.key);
          lastMid = y + h / 2; drops.push([[spine, lastMid], [sx + indent, lastMid]]);
          y += h + stackGap;
        }
        anchors.push(spine); drops.push([[spine, busY], [spine, lastMid]]);
      }
      sx += s.width + gapX;
    }
    // the box sits over the middle of what hangs from it (a lone stack: over its left edge, so the spine falls under the box)
    let cx = left + blockW / 2;
    if (anchors.length) {
      const lo = Math.min(...anchors), hi = Math.max(...anchors);
      cx = slots.length === 1 && slots[0]!.kind === "stack" ? lo - 9 + w / 2 : (lo + hi) / 2;
      const ax = Math.min(Math.max(cx, lo), hi);
      edges.push([[ax, top + h], [ax, busY]]);
      if (hi - lo > 0.5 || Math.abs(ax - lo) > 0.5) edges.push([[Math.min(lo, ax), busY], [Math.max(hi, ax), busY]]);
      edges.push(...drops);
    }
    nodes.push({ ...it, x: cx - w / 2, y: top, w, h, level });
    return cx;
  };

  let x = 0;
  for (const r of roots) { place(r, x, 0, 0); x += widthOf(r) + gapX * 2; }
  if (!nodes.length) return { nodes: [], edges: [], width: w + 2 * PAD, height: h + 2 * PAD, levels: 0 };
  const minX = Math.min(...nodes.map((n) => n.x)), minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.w)), maxY = Math.max(...nodes.map((n) => n.y + n.h));
  const dx = PAD - minX, dy = PAD - minY;
  for (const n of nodes) { n.x += dx; n.y += dy; }
  for (const e of edges) for (const p of e) { p[0] += dx; p[1] += dy; }
  return { nodes, edges, width: maxX - minX + 2 * PAD, height: maxY - minY + 2 * PAD, levels: Math.max(...nodes.map((n) => n.level)) + 1 };
}

/** One colour per department (stable: by name), for the bar on each box and the legend */
export const PALETTE = ["#1F6FB2", "#2E8B57", "#C2410C", "#7C3AED", "#0E7490", "#B45309", "#BE185D", "#4D7C0F", "#4338CA", "#0F766E", "#9F1239", "#64748B"];
export function groupColors(items: OrgItem[]): Map<string, string> {
  const names = [...new Set(items.map((i) => i.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return new Map(names.map((n, i) => [n, PALETTE[i % PALETTE.length]!]));
}
