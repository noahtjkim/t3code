import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  addPane,
  equalFractions,
  gridPlacement,
  removePane,
  replacePane,
  resizeFractions,
  resolveSplitDrop,
  resolveSplitLayout,
  splitProjectKey,
  swapWithMain,
  visiblePanes,
} from "./splitView.logic";

const ref = (id: string, env = "env-1") => scopeThreadRef(env as EnvironmentId, ThreadId.make(id));
const a = ref("a");
const b = ref("b");
const c = ref("c");
const d = ref("d");
const m = ref("m");

describe("splitProjectKey", () => {
  it("joins environment and project ids", () => {
    expect(
      splitProjectKey({ environmentId: "env-1" as EnvironmentId, projectId: ProjectId.make("p") }),
    ).toBe("env-1:p");
  });
});

describe("addPane", () => {
  it("adds to the end", () => {
    expect(addPane([a], b, m)).toEqual({ panes: [a, b], result: "added" });
  });

  it("reports duplicates without changing the list", () => {
    expect(addPane([a, b], a, m)).toEqual({ panes: [a, b], result: "duplicate" });
  });

  it("treats the main session as a duplicate", () => {
    expect(addPane([a], m, m)).toEqual({ panes: [a], result: "duplicate" });
  });

  it("reports full at the pane limit without changing the list", () => {
    expect(addPane([a, b, c], d, m)).toEqual({ panes: [a, b, c], result: "full" });
  });

  it("does not count the main session stored in the list toward the limit and drops it", () => {
    expect(addPane([a, b, m], d, m)).toEqual({ panes: [a, b, d], result: "added" });
  });

  it("never returns more than the limit when the stored list holds main and three others", () => {
    expect(addPane([a, b, c, m], d, m)).toEqual({ panes: [a, b, c], result: "full" });
  });

  it("compares by environment as well as thread id", () => {
    const sameIdOtherEnv = ref("a", "env-2");
    expect(addPane([a], sameIdOtherEnv, null).result).toBe("added");
  });
});

describe("removePane", () => {
  it("removes only the matching ref", () => {
    expect(removePane([a, b, ref("a", "env-2")], a)).toEqual([b, ref("a", "env-2")]);
  });
});

describe("replacePane", () => {
  it("puts the new session in the old pane's slot", () => {
    expect(replacePane([a, b, c], b, d, m)).toEqual({ panes: [a, d, c], result: "replaced" });
  });

  it.each([
    { name: "the main session", next: m },
    { name: "a visible pane", next: c },
  ])("leaves the list unchanged when the new session is $name", ({ next }) => {
    expect(replacePane([a, b, c], b, next, m)).toEqual({ panes: [a, b, c], result: "duplicate" });
  });

  it("reports a pane that is not visible as missing", () => {
    expect(replacePane([a, b], c, d, m)).toEqual({ panes: [a, b], result: "missing" });
    expect(replacePane([a, m], m, d, m)).toEqual({ panes: [a], result: "missing" });
  });

  it("drops the main session stored in the list", () => {
    expect(replacePane([a, m, b], b, d, m)).toEqual({ panes: [a, d], result: "replaced" });
  });
});

describe("swapWithMain", () => {
  it("puts main into the pane's slot", () => {
    expect(swapWithMain([a, b, c], b, m)).toEqual([a, m, c]);
  });

  it("drops main's old slot when main is already in the list", () => {
    expect(swapWithMain([a, b, c], b, a)).toEqual([a, c]);
  });

  it("removes the pane when there is no main", () => {
    expect(swapWithMain([a, b], b, null)).toEqual([a]);
  });
});

describe("resolveSplitDrop", () => {
  const right = { kind: "strip-right" } as const;
  const bottom = { kind: "strip-bottom" } as const;
  const onPane = { kind: "pane", pane: a } as const;

  it.each([
    { name: "main on a pane swaps", dropped: m, target: onPane, expected: { kind: "swap-main" } },
    {
      name: "main on the right strip",
      dropped: m,
      target: right,
      expected: { kind: "already-open" },
    },
    {
      name: "main on the bottom strip",
      dropped: m,
      target: bottom,
      expected: { kind: "already-open" },
    },
    {
      name: "a pane on another pane",
      dropped: b,
      target: onPane,
      expected: { kind: "already-open" },
    },
    { name: "a pane on itself", dropped: a, target: onPane, expected: { kind: "already-open" } },
    {
      name: "a pane on the right strip",
      dropped: b,
      target: right,
      expected: { kind: "already-open" },
    },
    {
      name: "a pane on the bottom strip",
      dropped: b,
      target: bottom,
      expected: { kind: "already-open" },
    },
    {
      name: "another session on a pane",
      dropped: d,
      target: onPane,
      expected: { kind: "replace" },
    },
    {
      name: "another session on the right strip",
      dropped: d,
      target: right,
      expected: { kind: "add", switchToGrid: false },
    },
    {
      name: "another session on the bottom strip",
      dropped: d,
      target: bottom,
      expected: { kind: "add", switchToGrid: true },
    },
  ] as const)("$name", ({ dropped, target, expected }) => {
    expect(resolveSplitDrop({ panes: [a, b], main: m, dropped, target })).toEqual(expected);
  });

  it.each([
    { target: right, dropped: d, expected: "full" },
    { target: bottom, dropped: d, expected: "full" },
    { target: right, dropped: m, expected: "already-open" },
    { target: bottom, dropped: c, expected: "already-open" },
    { target: onPane, dropped: d, expected: "replace" },
    { target: onPane, dropped: m, expected: "swap-main" },
  ] as const)(
    "with the pane limit reached, $dropped.threadId on $target.kind is $expected",
    ({ target, dropped, expected }) => {
      expect(resolveSplitDrop({ panes: [a, b, c], main: m, dropped, target }).kind).toBe(expected);
    },
  );

  it("ignores the main session stored in the list", () => {
    expect(resolveSplitDrop({ panes: [a, b, m], main: m, dropped: d, target: right })).toEqual({
      kind: "add",
      switchToGrid: false,
    });
  });
});

describe("visiblePanes", () => {
  it("excludes the main session", () => {
    expect(visiblePanes([a, m, c], m)).toEqual([a, c]);
  });
});

describe("resolveSplitLayout", () => {
  it.each([
    { mode: "columns", sessions: 1, width: 1400, height: 900, expected: "single" },
    { mode: "columns", sessions: 4, width: 1400, height: 900, expected: "columns" },
    { mode: "columns", sessions: 4, width: 1000, height: 900, expected: "grid" },
    { mode: "grid", sessions: 3, width: 1400, height: 900, expected: "grid" },
    { mode: "grid", sessions: 2, width: 1400, height: 900, expected: "grid" },
    { mode: "grid", sessions: 2, width: 320, height: 480, expected: "grid" },
    { mode: "grid", sessions: 2, width: 1400, height: 479, expected: "columns" },
    { mode: "grid", sessions: 2, width: 319, height: 900, expected: "hidden" },
    { mode: "columns", sessions: 2, width: 500, height: 900, expected: "grid" },
    { mode: "columns", sessions: 3, width: 600, height: 900, expected: "hidden" },
    { mode: "grid", sessions: 4, width: 1000, height: 400, expected: "hidden" },
    { mode: "grid", sessions: 4, width: 1400, height: 400, expected: "columns" },
  ] as const)(
    "$mode $sessions sessions at $width x $height is $expected",
    ({ expected, ...input }) => {
      expect(resolveSplitLayout(input)).toBe(expected);
    },
  );
});

describe("gridPlacement", () => {
  it("stacks two sessions in full-width rows", () => {
    expect(gridPlacement(2)).toEqual([
      { column: 1, row: 1, columnSpan: 2 },
      { column: 1, row: 2, columnSpan: 2 },
    ]);
  });

  it("spans the third session across the bottom row", () => {
    expect(gridPlacement(3)).toEqual([
      { column: 1, row: 1, columnSpan: 1 },
      { column: 2, row: 1, columnSpan: 1 },
      { column: 1, row: 2, columnSpan: 2 },
    ]);
  });

  it("fills a 2x2 grid for four sessions", () => {
    expect(gridPlacement(4).map(({ column, row }) => [column, row])).toEqual([
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]);
  });
});

describe("equalFractions", () => {
  it("splits evenly and sums to one", () => {
    const fractions = equalFractions(3);
    expect(fractions).toHaveLength(3);
    expect(fractions.reduce((sum, fraction) => sum + fraction, 0)).toBeCloseTo(1, 9);
  });
});

describe("resizeFractions", () => {
  it.each([
    { delta: 100, expected: [0.6, 0.4] },
    { delta: 400, expected: [0.68, 0.32] },
    { delta: -400, expected: [0.32, 0.68] },
  ])("moves the divider by $delta px within the minimum", ({ delta, expected }) => {
    const result = resizeFractions([0.5, 0.5], 0, delta, 1000, 320);
    expect(result[0]).toBeCloseTo(expected[0]!, 9);
    expect(result[1]).toBeCloseTo(expected[1]!, 9);
    expect(result.reduce((sum, fraction) => sum + fraction, 0)).toBeCloseTo(1, 9);
  });

  it("only changes the two panes beside the divider", () => {
    const result = resizeFractions([0.25, 0.25, 0.5], 1, 100, 1000, 100);
    expect(result[0]).toBe(0.25);
    expect(result[1]).toBeCloseTo(0.35, 9);
    expect(result[2]).toBeCloseTo(0.4, 9);
  });

  it("leaves fractions alone when the pair cannot satisfy the minimum", () => {
    expect(resizeFractions([0.5, 0.5], 0, 50, 500, 320)).toEqual([0.5, 0.5]);
  });
});
