import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import {
  addPane,
  removePane,
  replacePane,
  swapWithMain,
  type SplitLayoutMode,
} from "./splitView.logic";

export interface SplitViewScreen {
  mainThreadKey: string | null;
  projectKey: string | null;
  shownPaneKeys: string[];
}

/** A shell command from a pane that waits for its session to become the main one. */
export interface SplitPendingCommand {
  threadKey: string;
  command: string;
  /** The main session when the command was queued; navigation is still under way while it is main. */
  fromThreadKey: string;
}

interface GridFractions {
  column: number;
  row: number;
}

interface SplitViewState {
  panesByProject: Record<string, ScopedThreadRef[]>;
  mode: SplitLayoutMode;
  columnFractions: Record<string, number[]>;
  gridFractions: GridFractions;
  screen: SplitViewScreen;
  pendingCommand: SplitPendingCommand | null;
  openPane: (
    projectKey: string,
    ref: ScopedThreadRef,
    main: ScopedThreadRef | null,
  ) => "added" | "duplicate" | "full";
  replacePane: (
    projectKey: string,
    oldRef: ScopedThreadRef,
    newRef: ScopedThreadRef,
    main: ScopedThreadRef | null,
  ) => "replaced" | "duplicate" | "missing";
  closePane: (projectKey: string, ref: ScopedThreadRef) => void;
  dropPaneSet: (key: string) => void;
  makeMain: (projectKey: string, pane: ScopedThreadRef, main: ScopedThreadRef | null) => void;
  setMode: (mode: SplitLayoutMode) => void;
  setColumnFractions: (count: number, fractions: number[]) => void;
  setGridFractions: (fractions: GridFractions) => void;
  setScreen: (screen: SplitViewScreen) => void;
  setPendingCommand: (pendingCommand: SplitPendingCommand | null) => void;
}

const DEFAULT_GRID_FRACTIONS: GridFractions = { column: 0.5, row: 0.5 };

const withProjectPanes = (
  panesByProject: Record<string, ScopedThreadRef[]>,
  projectKey: string,
  panes: ScopedThreadRef[],
): Record<string, ScopedThreadRef[]> => {
  const { [projectKey]: _previous, ...rest } = panesByProject;
  return panes.length > 0 ? { ...rest, [projectKey]: panes } : rest;
};

const isThreadRef = Schema.is(ScopedThreadRef);
const isFraction = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1;

const isColumnFractions = (count: string, fractions: unknown): fractions is number[] =>
  /^[1-9]\d*$/.test(count) &&
  Array.isArray(fractions) &&
  fractions.length === Number(count) &&
  fractions.every((fraction) => typeof fraction === "number" && fraction > 0) &&
  Math.abs(fractions.reduce((sum, fraction) => sum + fraction, 0) - 1) < 1e-6;

const entriesOf = (value: unknown): Array<[string, unknown]> =>
  value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];

export const useSplitViewStore = create<SplitViewState>()(
  persist(
    (set, get) => ({
      panesByProject: {},
      mode: "columns",
      columnFractions: {},
      gridFractions: DEFAULT_GRID_FRACTIONS,
      screen: { mainThreadKey: null, projectKey: null, shownPaneKeys: [] },
      pendingCommand: null,
      openPane: (projectKey, ref, main) => {
        const { panes, result } = addPane(get().panesByProject[projectKey] ?? [], ref, main);
        if (result === "added") {
          set((state) => ({
            panesByProject: withProjectPanes(state.panesByProject, projectKey, panes),
          }));
        }
        return result;
      },
      replacePane: (projectKey, oldRef, newRef, main) => {
        const { panes, result } = replacePane(
          get().panesByProject[projectKey] ?? [],
          oldRef,
          newRef,
          main,
        );
        if (result === "replaced") {
          set((state) => ({
            panesByProject: withProjectPanes(state.panesByProject, projectKey, panes),
          }));
        }
        return result;
      },
      closePane: (projectKey, ref) =>
        set((state) => ({
          panesByProject: withProjectPanes(
            state.panesByProject,
            projectKey,
            removePane(state.panesByProject[projectKey] ?? [], ref),
          ),
        })),
      dropPaneSet: (key) =>
        set((state) => ({ panesByProject: withProjectPanes(state.panesByProject, key, []) })),
      makeMain: (projectKey, pane, main) =>
        set((state) => ({
          panesByProject: withProjectPanes(
            state.panesByProject,
            projectKey,
            swapWithMain(state.panesByProject[projectKey] ?? [], pane, main),
          ),
        })),
      setMode: (mode) => set({ mode }),
      setColumnFractions: (count, fractions) =>
        set((state) => ({
          columnFractions: { ...state.columnFractions, [String(count)]: fractions },
        })),
      setGridFractions: (gridFractions) => set({ gridFractions }),
      setScreen: (screen) => set({ screen }),
      setPendingCommand: (pendingCommand) => set({ pendingCommand }),
    }),
    {
      name: "t3code:split-view:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 1,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        const panesByProject: Record<string, ScopedThreadRef[]> = {};
        for (const [projectKey, panes] of entriesOf(state.panesByProject)) {
          if (!Array.isArray(panes)) continue;
          const valid = panes
            .filter(isThreadRef)
            .reduce<ScopedThreadRef[]>((acc, ref) => addPane(acc, ref, null).panes, []);
          if (valid.length > 0) panesByProject[projectKey] = valid;
        }
        const columnFractions: Record<string, number[]> = {};
        for (const [count, fractions] of entriesOf(state.columnFractions)) {
          if (isColumnFractions(count, fractions)) columnFractions[count] = fractions;
        }
        const grid = state.gridFractions as Partial<GridFractions> | null | undefined;
        return {
          panesByProject,
          mode: state.mode === "grid" ? "grid" : "columns",
          columnFractions,
          gridFractions:
            isFraction(grid?.column) && isFraction(grid?.row)
              ? { column: grid.column, row: grid.row }
              : DEFAULT_GRID_FRACTIONS,
        };
      },
      partialize: ({ panesByProject, mode, columnFractions, gridFractions }) => ({
        panesByProject,
        mode,
        columnFractions,
        gridFractions,
      }),
    },
  ),
);

export function isThreadOnSplitScreen(ref: ScopedThreadRef): boolean {
  return useSplitViewStore.getState().screen.shownPaneKeys.includes(scopedThreadKey(ref));
}
