import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
  use,
  useEffect,
  useRef,
  useState,
} from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useStableCallback } from "../../hooks/useStableCallback";
import { observeResize } from "../../lib/observeResize";
import { cn } from "../../lib/utils";
import {
  SPLIT_MIN_PANE_HEIGHT,
  SPLIT_MIN_PANE_WIDTH,
  equalFractions,
  gridPlacement,
  resizeFractions,
  resolveSplitDrop,
  resolveSplitLayout,
  SPLIT_MAX_PANES,
  type SplitDropTarget,
  splitPaneSetKey,
  splitProjectKey,
  visiblePanes,
} from "../../splitView.logic";
import { projectGroupOf } from "../../projectGroups.logic";
import { useProjectGroupStore } from "../../projectGroupStore";
import { useSplitViewStore } from "../../splitViewStore";
import { readProject, readThreadShell } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import {
  threadContextDropTargetProps,
  useThreadContextDragGhost,
  useThreadContextDrop,
} from "../chat/threadContextDrag";
import type { ThreadContextDropRef } from "../chat/threadContextDrop.logic";
import { toastManager } from "../ui/toast";
import { SplitChatPane } from "./SplitChatPane";
import { SplitDivider } from "./SplitDivider";
import { SplitProjectBar } from "./SplitProjectBar";
import { SplitViewChromeContext } from "./splitViewChrome";

type LiveSizes =
  | { kind: "columns"; fractions: number[] }
  | { kind: "grid"; column: number; row: number };

const DIVIDER_HALF_PX = 3;

// Below the project bar the main header is off the window's titlebar, so it drops the collapsed sidebar's inset.
const BELOW_PROJECT_BAR_STYLE = {
  "--workspace-titlebar-content-left": "var(--workspace-gutter-start)",
} as CSSProperties;

/**
 * The main chat column plus the project's split panes, under a project bar while panes are shown. The
 * column is the div rendered here from the remaining props, and it always sits in the same first cell,
 * so opening, closing or re-laying out panes never remounts it.
 */
export function SplitViewFrame({
  mainThreadRef,
  projectRef,
  rightPanelMaximized,
  reserveTitlebarControls,
  runMainShellCommand: runMainShellCommandProp,
  children,
  ...columnProps
}: Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  readonly mainThreadRef: ScopedThreadRef | null;
  readonly projectRef: { environmentId: EnvironmentId; projectId: ProjectId } | null;
  readonly rightPanelMaximized: boolean;
  /** The window's fixed top-right controls sit over this frame's top-right corner, on the project bar. */
  readonly reserveTitlebarControls: boolean;
  readonly runMainShellCommand: (command: string) => void;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const groups = useProjectGroupStore((state) => state.groups);
  // Sessions of every project in the main session's group share this pane set.
  const projectKey = projectRef ? splitPaneSetKey(groups, projectRef) : null;
  const groupName = projectRef
    ? (projectGroupOf(groups, splitProjectKey(projectRef))?.name ?? null)
    : null;
  const inPaneSet = (ref: ScopedThreadRef) => {
    const shell = readThreadShell(ref);
    // An unloaded shell stays listed; its pane shows the session as unavailable.
    return (
      shell === null ||
      splitPaneSetKey(groups, { environmentId: ref.environmentId, projectId: shell.projectId }) ===
        projectKey
    );
  };
  const mainKey = mainThreadRef ? scopedThreadKey(mainThreadRef) : null;
  const storedPanes = useSplitViewStore((state) =>
    projectKey === null ? undefined : state.panesByProject[projectKey],
  );
  const mode = useSplitViewStore((state) => state.mode);
  const columnFractions = useSplitViewStore((state) => state.columnFractions);
  const gridFractions = useSplitViewStore((state) => state.gridFractions);
  const queuedCommand = useSplitViewStore((state) => state.pendingCommand);
  const isNarrow = useMediaQuery("(max-width: 767px)");
  const background = use(BackgroundThreadContext);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [live, setLive] = useState<LiveSizes | null>(null);
  const liveRef = useRef<LiveSizes | null>(null);
  const cellsRef = useRef<HTMLDivElement>(null);
  const runMainShellCommand = useStableCallback(runMainShellCommandProp);

  // Measures the whole frame, project bar included, so showing the bar can't change the layout that shows it.
  const containerRef = useStableCallback((node: HTMLDivElement | null) =>
    node === null
      ? undefined
      : observeResize(node, (entries) => {
          const rect = entries.at(-1)?.contentRect;
          if (rect) setSize({ width: rect.width, height: rect.height });
        }),
  );

  const panes =
    projectKey === null ? [] : visiblePanes(storedPanes ?? [], mainThreadRef).filter(inPaneSet);
  const sessions = panes.length + 1;
  const hiddenByConditions =
    projectKey === null || mainThreadRef === null || rightPanelMaximized || isNarrow || background;
  // Until the first measurement the frame shows the main chat alone, not the too-narrow note.
  const layout =
    hiddenByConditions || size === null
      ? "single"
      : resolveSplitLayout({ mode, sessions, width: size.width, height: size.height });
  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const shownPanes = layout === "columns" || layout === "grid" ? panes : [];
  const projectBarShown = shownPanes.length > 0 && projectRef !== null;
  const shownKeys = shownPanes.map(scopedThreadKey).join("\n");

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes what is on screen for the sidebar menu and alert coordinator, which read it outside React
  useEffect(() => {
    // Embedded ChatViews mount frames with no refs; they must not overwrite the main frame's state.
    if (mainKey === null && projectKey === null) return;
    useSplitViewStore.getState().setScreen({
      mainThreadKey: mainKey,
      projectKey,
      shownPaneKeys: shownKeys === "" ? [] : shownKeys.split("\n"),
    });
    return () => {
      const { screen, setScreen } = useSplitViewStore.getState();
      if (screen.mainThreadKey !== mainKey || screen.projectKey !== projectKey) return;
      setScreen({ mainThreadKey: null, projectKey: null, shownPaneKeys: [] });
    };
  }, [mainKey, projectKey, shownKeys]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the command after navigation made the pane's session the main one, so it lands in that session's terminal
  useEffect(() => {
    if (queuedCommand === null || mainKey === null) return;
    // Reads the store, not the render's value, so a replayed effect or a second frame can't run it again.
    const { pendingCommand, setPendingCommand } = useSplitViewStore.getState();
    if (pendingCommand === null || mainKey === pendingCommand.fromThreadKey) return;
    setPendingCommand(null);
    if (pendingCommand.threadKey === mainKey) runMainShellCommand(pendingCommand.command);
  }, [mainKey, queuedCommand, runMainShellCommand]);

  const makeMain = useStableCallback((pane: ScopedThreadRef, after?: { command?: string }) => {
    if (projectKey === null || mainKey === null || mainThreadRef === null) return;
    const store = useSplitViewStore.getState();
    store.makeMain(projectKey, pane, mainThreadRef);
    if (after?.command !== undefined) {
      store.setPendingCommand({
        threadKey: scopedThreadKey(pane),
        command: after.command,
        fromThreadKey: mainKey,
      });
    }
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(pane) });
  });
  const closePane = useStableCallback((pane: ScopedThreadRef) => {
    if (projectKey !== null) useSplitViewStore.getState().closePane(projectKey, pane);
  });

  /** On a strip, opens dropped sessions as panes until full; on a pane, the first that can replaces or swaps with it. */
  const dropThreads = useStableCallback(
    (target: SplitDropTarget, dropped: ReadonlyArray<ThreadContextDropRef>) => {
      if (projectKey === null || projectRef === null) return;
      let foreign = false;
      const candidates = dropped.flatMap((ref) => {
        const shell = readThreadShell(ref);
        if (
          shell === null ||
          splitPaneSetKey(groups, {
            environmentId: ref.environmentId,
            projectId: shell.projectId,
          }) !== projectKey
        ) {
          foreign = true;
          return [];
        }
        // Side chats belong to their parent's panel, as in the sidebar menu.
        return shell.lineage.sideChat === true
          ? []
          : [{ ref: scopeThreadRef(ref.environmentId, ref.threadId), title: shell.title.trim() }];
      });
      if (foreign) {
        toastManager.add({
          type: "warning",
          title:
            groupName !== null
              ? gt("Only sessions from the {group} group can open here", { group: groupName })
              : gt("Only sessions from {project} can open here", {
                  project: readProject(projectRef)?.title ?? gt("this project"),
                }),
        });
      }
      for (const { ref, title } of candidates) {
        const store = useSplitViewStore.getState();
        const drop = resolveSplitDrop({
          panes: store.panesByProject[projectKey] ?? [],
          main: mainThreadRef,
          dropped: ref,
          target,
        });
        if (drop.kind === "full") return;
        if (drop.kind === "already-open") {
          toastManager.add({
            type: "info",
            title: gt("{title} is already open", { title: title || gt("This session") }),
          });
          continue;
        }
        if (drop.kind === "add") {
          store.openPane(projectKey, ref, mainThreadRef);
          if (drop.switchToGrid) store.setMode("grid");
          continue;
        }
        if (target.kind === "pane") {
          if (drop.kind === "swap-main") makeMain(target.pane);
          else store.replacePane(projectKey, target.pane, ref, mainThreadRef);
        }
        return;
      }
    },
  );
  const dropOnPane = useStableCallback(
    (pane: ScopedThreadRef, dropped: ReadonlyArray<ThreadContextDropRef>) =>
      dropThreads({ kind: "pane", pane }, dropped),
  );

  const updateLive = (next: LiveSizes) => {
    liveRef.current = next;
    setLive(next);
  };
  // A click without movement also commits; only a drag that moved has sizes to store.
  const commitLive = () => {
    const next = liveRef.current;
    liveRef.current = null;
    setLive(null);
    if (next === null) return;
    const store = useSplitViewStore.getState();
    if (next.kind === "columns") store.setColumnFractions(next.fractions.length, next.fractions);
    else store.setGridFractions({ column: next.column, row: next.row });
  };

  const storedColumns = columnFractions[String(sessions)];
  const baseColumns = storedColumns?.length === sessions ? storedColumns : equalFractions(sessions);
  const columns = live?.kind === "columns" ? live.fractions : baseColumns;
  const grid = live?.kind === "grid" ? live : gridFractions;
  const dividerLabel = gt("Resize split panes");

  const cellStyle = (index: number): CSSProperties => {
    if (layout === "columns") {
      return { order: index * 2, flexBasis: 0, flexGrow: columns[index] ?? 1 };
    }
    if (layout === "grid") {
      const place = gridPlacement(sessions === 2 || sessions === 3 ? sessions : 4)[index];
      return place
        ? { gridColumn: `${place.column} / span ${place.columnSpan}`, gridRow: place.row }
        : {};
    }
    return { flexGrow: 1 };
  };

  const columnDividers =
    layout === "columns"
      ? panes.map((pane, index) => (
          <div
            key={`divider-${scopedThreadKey(pane)}`}
            className="flex shrink-0"
            style={{ order: index * 2 + 1 }}
          >
            <SplitDivider
              orientation="vertical"
              label={dividerLabel}
              onDrag={(delta) =>
                updateLive({
                  kind: "columns",
                  fractions: resizeFractions(
                    baseColumns,
                    index,
                    delta,
                    width,
                    SPLIT_MIN_PANE_WIDTH,
                  ),
                })
              }
              onCommit={commitLive}
              onReset={() =>
                useSplitViewStore.getState().setColumnFractions(sessions, equalFractions(sessions))
              }
            />
          </div>
        ))
      : null;

  const gridDividers =
    layout === "grid" ? (
      <>
        {sessions >= 3 ? (
          <div
            className="absolute top-0 z-10 flex"
            style={{
              left: `calc(${grid.column * 100}% - ${DIVIDER_HALF_PX}px)`,
              height: sessions === 3 ? `${grid.row * 100}%` : "100%",
            }}
          >
            <SplitDivider
              orientation="vertical"
              label={dividerLabel}
              onDrag={(delta) => {
                const column =
                  resizeFractions(
                    [gridFractions.column, 1 - gridFractions.column],
                    0,
                    delta,
                    width,
                    SPLIT_MIN_PANE_WIDTH,
                  )[0] ?? grid.column;
                updateLive({ kind: "grid", column, row: gridFractions.row });
              }}
              onCommit={commitLive}
              onReset={() =>
                useSplitViewStore
                  .getState()
                  .setGridFractions({ column: 0.5, row: gridFractions.row })
              }
            />
          </div>
        ) : null}
        <div
          className="absolute inset-x-0 z-10 flex"
          style={{ top: `calc(${grid.row * 100}% - ${DIVIDER_HALF_PX}px)` }}
        >
          <SplitDivider
            orientation="horizontal"
            label={dividerLabel}
            onDrag={(delta) => {
              const row =
                resizeFractions(
                  [gridFractions.row, 1 - gridFractions.row],
                  0,
                  delta,
                  cellsRef.current?.clientHeight ?? height,
                  SPLIT_MIN_PANE_HEIGHT,
                )[0] ?? grid.row;
              updateLive({ kind: "grid", column: gridFractions.column, row });
            }}
            onCommit={commitLive}
            onReset={() =>
              useSplitViewStore
                .getState()
                .setGridFractions({ column: gridFractions.column, row: 0.5 })
            }
          />
        </div>
      </>
    ) : null;

  const containerStyle: CSSProperties | undefined =
    layout === "grid"
      ? {
          display: "grid",
          gridTemplateColumns: `minmax(0, ${grid.column}fr) minmax(0, ${1 - grid.column}fr)`,
          gridTemplateRows: `minmax(0, ${grid.row}fr) minmax(0, ${1 - grid.row}fr)`,
        }
      : undefined;

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex min-h-0 min-w-0 flex-col",
        // The chat column is maximized away; the wrapper must not claim space beside the panel.
        rightPanelMaximized ? "w-0 flex-none" : "flex-1",
      )}
      data-split-view
    >
      {projectBarShown ? (
        <SplitProjectBar
          environmentId={projectRef.environmentId}
          projectId={projectRef.projectId}
          groupName={groupName}
          reserveTitlebarControls={reserveTitlebarControls}
        />
      ) : null}
      <div ref={cellsRef} className="relative flex min-h-0 min-w-0 flex-1" style={containerStyle}>
        <div
          data-split-cell="main"
          className="flex min-h-0 min-w-0 flex-col"
          style={projectBarShown ? { ...cellStyle(0), ...BELOW_PROJECT_BAR_STYLE } : cellStyle(0)}
        >
          {layout === "hidden" ? (
            <div className="shrink-0 border-b border-border px-3 py-1 text-xs text-muted-foreground">
              {gt(
                "{count, plural, one {Widen the window to see {count} split session} other {Widen the window to see {count} split sessions}}",
                { count: panes.length },
              )}
            </div>
          ) : null}
          <div {...columnProps}>
            <SplitViewChromeContext value={projectBarShown}>{children}</SplitViewChromeContext>
          </div>
        </div>
        {shownPanes.map((pane, index) => (
          <div
            key={scopedThreadKey(pane)}
            data-split-cell="pane"
            className="flex min-h-0 min-w-0 flex-col"
            style={cellStyle(index + 1)}
          >
            <SplitChatPane
              threadRef={pane}
              showProject={groupName !== null}
              onMakeMain={makeMain}
              onClose={closePane}
              onDropThreads={dropOnPane}
            />
          </div>
        ))}
        {columnDividers}
        {gridDividers}
        {hiddenByConditions || projectRef === null ? null : (
          <SplitDropStrip
            environmentId={projectRef.environmentId}
            full={panes.length >= SPLIT_MAX_PANES}
            onDrop={dropThreads}
          />
        )}
      </div>
    </div>
  );
}

interface SplitDropStripProps {
  readonly environmentId: EnvironmentId;
  readonly full: boolean;
  readonly onDrop: (target: SplitDropTarget, dropped: ReadonlyArray<ThreadContextDropRef>) => void;
}

/**
 * Shown at the frame's right and bottom edges while a session is dragged from the sidebar; a drop opens
 * it as a pane, below in Grid from the bottom strip. Reads the drag ghost here, not in the frame,
 * because it changes on every pointer move.
 */
function SplitDropStrip(props: SplitDropStripProps) {
  return useThreadContextDragGhost() === null ? null : (
    <>
      <SplitDropStripTarget {...props} kind="strip-right" />
      <SplitDropStripTarget {...props} kind="strip-bottom" />
    </>
  );
}

function SplitDropStripTarget(
  props: SplitDropStripProps & { readonly kind: "strip-right" | "strip-bottom" },
) {
  const gt = useGT();
  const stripRef = useRef<HTMLDivElement>(null);
  useThreadContextDrop(stripRef, props.environmentId, `split-drop-${props.kind}`, (dropped) =>
    props.onDrop({ kind: props.kind }, dropped),
  );
  return (
    <div
      ref={stripRef}
      className={cn(
        // z-45 ties the main column's terminal drawer and wins on DOM order; sheets sit at --z-sheet (46).
        "absolute z-45 flex items-center justify-center rounded-lg border-2 border-dashed border-border bg-background/90 p-3 text-center text-xs text-muted-foreground",
        // The bottom strip ends a gap short of the right strip's w-30 plus its right-2 inset.
        props.kind === "strip-right" ? "inset-y-2 right-2 w-30" : "bottom-2 left-2 right-34 h-14",
        !props.full &&
          "data-[thread-context-over]:border-primary data-[thread-context-over]:bg-accent data-[thread-context-over]:text-foreground",
      )}
      // Still a target when full, so a session already on screen dropped here gets its toast.
      {...threadContextDropTargetProps()}
    >
      {props.full
        ? gt("Split view is full. Drop on a pane to replace it.")
        : props.kind === "strip-right"
          ? gt("Drop to open in split view")
          : gt("Drop to open below")}
    </div>
  );
}
