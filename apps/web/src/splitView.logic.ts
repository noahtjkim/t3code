import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";

import type { SessionGroup } from "./sessionGroups.logic";

export type SplitLayoutMode = "columns" | "grid";
export type SplitLayout = "single" | "columns" | "grid" | "hidden";

export const SPLIT_MAX_PANES = 3;
export const SPLIT_MIN_PANE_WIDTH = 320;
export const SPLIT_MIN_PANE_HEIGHT = 240;

const sameThread = (left: ScopedThreadRef, right: ScopedThreadRef) =>
  scopedThreadKey(left) === scopedThreadKey(right);

export function splitProjectKey(ref: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}): string {
  return `${ref.environmentId}:${ref.projectId}`;
}

export function groupPaneSetKey(groupId: string): string {
  return `group:${groupId}`;
}

/** A group's panes take its own sessions; a project's take any session of that project. */
export function canJoinPaneSet(
  groups: readonly SessionGroup[],
  paneSetKey: string,
  threadKey: string,
  projectRef: { environmentId: EnvironmentId; projectId: ProjectId },
): boolean {
  const group = groups.find((candidate) => groupPaneSetKey(candidate.id) === paneSetKey);
  return group ? group.threadKeys.includes(threadKey) : splitProjectKey(projectRef) === paneSetKey;
}

export function addPane(
  panes: readonly ScopedThreadRef[],
  ref: ScopedThreadRef,
  main: ScopedThreadRef | null,
): { panes: ScopedThreadRef[]; result: "added" | "duplicate" | "full" } {
  const visible = visiblePanes(panes, main);
  if ((main && sameThread(main, ref)) || visible.some((pane) => sameThread(pane, ref))) {
    return { panes: visible, result: "duplicate" };
  }
  if (visible.length >= SPLIT_MAX_PANES) {
    return { panes: visible, result: "full" };
  }
  return { panes: [...visible, ref], result: "added" };
}

export function replacePane(
  panes: readonly ScopedThreadRef[],
  oldRef: ScopedThreadRef,
  newRef: ScopedThreadRef,
  main: ScopedThreadRef | null,
): { panes: ScopedThreadRef[]; result: "replaced" | "duplicate" | "missing" } {
  const visible = visiblePanes(panes, main);
  if ((main && sameThread(main, newRef)) || visible.some((pane) => sameThread(pane, newRef))) {
    return { panes: visible, result: "duplicate" };
  }
  if (!visible.some((pane) => sameThread(pane, oldRef))) {
    return { panes: visible, result: "missing" };
  }
  return {
    panes: visible.map((pane) => (sameThread(pane, oldRef) ? newRef : pane)),
    result: "replaced",
  };
}

export function removePane(
  panes: readonly ScopedThreadRef[],
  ref: ScopedThreadRef,
): ScopedThreadRef[] {
  return panes.filter((pane) => !sameThread(pane, ref));
}

export function swapWithMain(
  panes: readonly ScopedThreadRef[],
  pane: ScopedThreadRef,
  main: ScopedThreadRef | null,
): ScopedThreadRef[] {
  return main
    ? panes.flatMap((entry) => {
        if (sameThread(entry, pane)) return [main];
        return sameThread(entry, main) ? [] : [entry];
      })
    : removePane(panes, pane);
}

export type SplitDropTarget =
  | { kind: "strip-right" }
  | { kind: "strip-bottom" }
  | { kind: "pane"; pane: ScopedThreadRef };

export type SplitDrop =
  | { kind: "add"; switchToGrid: boolean }
  | { kind: "replace" }
  | { kind: "swap-main" }
  | { kind: "already-open" }
  | { kind: "full" };

export function resolveSplitDrop(input: {
  panes: readonly ScopedThreadRef[];
  main: ScopedThreadRef | null;
  dropped: ScopedThreadRef;
  target: SplitDropTarget;
}): SplitDrop {
  const { main, dropped, target } = input;
  const panes = visiblePanes(input.panes, main);
  if (main && sameThread(main, dropped)) {
    return { kind: target.kind === "pane" ? "swap-main" : "already-open" };
  }
  if (panes.some((pane) => sameThread(pane, dropped))) return { kind: "already-open" };
  if (target.kind === "pane") return { kind: "replace" };
  if (panes.length >= SPLIT_MAX_PANES) return { kind: "full" };
  return { kind: "add", switchToGrid: target.kind === "strip-bottom" };
}

export function visiblePanes(
  panes: readonly ScopedThreadRef[],
  main: ScopedThreadRef | null,
): ScopedThreadRef[] {
  return main ? removePane(panes, main) : [...panes];
}

export function resolveSplitLayout(input: {
  mode: SplitLayoutMode;
  sessions: number;
  width: number;
  height: number;
}): SplitLayout {
  const { mode, sessions, width, height } = input;
  if (sessions <= 1) return "single";
  const fits = {
    columns: width >= sessions * SPLIT_MIN_PANE_WIDTH,
    grid:
      sessions <= SPLIT_MAX_PANES + 1 &&
      width >= (sessions === 2 ? 1 : 2) * SPLIT_MIN_PANE_WIDTH &&
      height >= 2 * SPLIT_MIN_PANE_HEIGHT,
  } satisfies Record<SplitLayoutMode, boolean>;
  const other = mode === "columns" ? "grid" : "columns";
  if (fits[mode]) return mode;
  if (fits[other]) return other;
  return "hidden";
}

export function gridPlacement(
  sessions: 2 | 3 | 4,
): Array<{ column: 1 | 2; row: 1 | 2; columnSpan: 1 | 2 }> {
  if (sessions === 2) {
    return [
      { column: 1, row: 1, columnSpan: 2 },
      { column: 1, row: 2, columnSpan: 2 },
    ];
  }
  const top = [
    { column: 1, row: 1, columnSpan: 1 },
    { column: 2, row: 1, columnSpan: 1 },
  ] as const;
  return sessions === 3
    ? [...top, { column: 1, row: 2, columnSpan: 2 }]
    : [...top, { column: 1, row: 2, columnSpan: 1 }, { column: 2, row: 2, columnSpan: 1 }];
}

export function equalFractions(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, () => 1 / count);
}

export function resizeFractions(
  fractions: readonly number[],
  divider: number,
  deltaPx: number,
  totalPx: number,
  minPx: number,
): number[] {
  const before = fractions[divider];
  const after = fractions[divider + 1];
  if (before === undefined || after === undefined || totalPx <= 0) return [...fractions];
  const pairPx = (before + after) * totalPx;
  if (pairPx < 2 * minPx) return [...fractions];
  const nextBeforePx = Math.min(Math.max(before * totalPx + deltaPx, minPx), pairPx - minPx);
  const nextBefore = nextBeforePx / totalPx;
  const next = [...fractions];
  next[divider] = nextBefore;
  next[divider + 1] = before + after - nextBefore;
  return next;
}
