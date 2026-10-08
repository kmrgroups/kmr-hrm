import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { layoutChart, trimLevels, BOX, type OrgItem } from "@/lib/org/layout";
import { buildItems, wouldLoop, fingerprint, type OrgEmployee } from "@/lib/org/model";
import { orgChartPdf } from "@/lib/org/pdf";

const it_ = (key: string, parent: string | null, extra: Partial<OrgItem> = {}): OrgItem => ({ key, parent, title: key, group: "A", kind: "person", order: 0, ...extra });
const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function big(n: number): OrgItem[] {
  const out: OrgItem[] = [it_("e:0", null)];
  for (let i = 1; i < n; i++) out.push(it_(`e:${i}`, `e:${Math.floor((i - 1) / 4)}`, { group: `D${i % 5}` }));
  return out;
}

describe("org chart layout", () => {
  it("places every box once, without overlap, inside the reported size", () => {
    for (const n of [1, 2, 30, 400]) {
      const L = layoutChart(big(n));
      expect(L.nodes.length).toBe(n);
      for (const a of L.nodes) { expect(a.x).toBeGreaterThanOrEqual(0); expect(a.y).toBeGreaterThanOrEqual(0); expect(a.x + a.w).toBeLessThanOrEqual(L.width + 0.5); expect(a.y + a.h).toBeLessThanOrEqual(L.height + 0.5); }
      for (let i = 0; i < L.nodes.length; i++) for (let j = i + 1; j < L.nodes.length; j++) expect(overlap(L.nodes[i]!, L.nodes[j]!)).toBe(false);
    }
  });
  it("a loop of people reporting to each other and orphans still appear", () => {
    const L = layoutChart([it_("a", "b"), it_("b", "a"), it_("c", "missing"), it_("d", "d")]);
    expect(L.nodes.map((x) => x.key).sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("a supervisor with many operators hangs them in a column, not one very wide row", () => {
    const items = [it_("boss", null), ...Array.from({ length: 20 }, (_, i) => it_(`o${i}`, "boss"))];
    const L = layoutChart(items);
    expect(L.width).toBeLessThan(BOX.w * 3);
  });
  it("trimLevels keeps only the top levels", () => {
    const items = [it_("a", null), it_("b", "a"), it_("c", "b")];
    expect(trimLevels(items, 2).map((i) => i.key)).toEqual(["a", "b"]);
    expect(trimLevels(items, null).length).toBe(3);
  });
});

describe("org chart model", () => {
  const emp = (id: string, manager: string | null, status = "active", dept: string | null = "d1"): OrgEmployee => ({ id, name: id, code: null, status, manager_id: manager, designation: null, position: null, department: null, plant_id: null, department_id: dept });
  it("builds from reporting managers; a left manager is skipped to the next one up", () => {
    const items = buildItems([emp("ceo", null), emp("mid", "ceo", "exited"), emp("w", "mid")], [], []);
    expect(items.find((i) => i.key === "e:w")?.parent).toBe("e:ceo");
    expect(items.some((i) => i.key === "e:mid")).toBe(false);
  });
  it("direct boxes and a link from an employee to a box", () => {
    const node = { id: "n1", title: "Director", subtitle: null, kind: "external" as const, parent_employee_id: null, parent_node_id: null, department: null, sort_order: 0 };
    const items = buildItems([emp("a", null)], [node], [{ employee_id: "a", parent_node_id: "n1" }]);
    expect(items.find((i) => i.key === "e:a")?.parent).toBe("n:n1");
  });
  it("detects loops and changes", () => {
    const es = [{ id: "a", manager_id: null }, { id: "b", manager_id: "a" }];
    expect(wouldLoop(es, "a", "b")).toBe(true);
    expect(wouldLoop(es, "b", "a")).toBe(false);
    expect(fingerprint([it_("x", null)])).not.toBe(fingerprint([it_("x", null, { title: "y" })]));
  });
});

describe("org chart PDF", () => {
  it("renders a big chart on exactly one page", async () => {
    const bytes = await orgChartPdf({ tenant: { id: "t", name: "Esbee Precision Industries", logo_path: null } as never, items: big(600), title: "Organisation Chart", docNo: "HR-ORG-01", rev: null, history: [], draft: true, printedOn: "2026-10-08" });
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  }, 30000);
});
