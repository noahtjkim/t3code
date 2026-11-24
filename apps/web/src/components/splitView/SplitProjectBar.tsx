import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { Columns2Icon, FolderIcon, LayoutGridIcon } from "lucide-react";
import { memo, useEffect, useState } from "react";

import { isElectron } from "../../env";
import { observeResize } from "../../lib/observeResize";
import { cn } from "../../lib/utils";
import { useSplitViewStore } from "../../splitViewStore";
import { useProject } from "../../state/entities";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";

// Used until the controls are measured: three toggles (6.5rem) offset from the window's right edge.
const TITLEBAR_CONTROLS_RESERVE = "calc(var(--workspace-controls-right) + 7rem)";
const TITLEBAR_CONTROLS_GAP_PX = 8;

function findTitlebarControls() {
  // The thread panel's header toggle carries the same attribute but is positioned inside the header.
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-workspace-titlebar-controls]"),
  ).find((element) => getComputedStyle(element).position === "fixed");
}

/**
 * The bar over the whole split area while panes are shown: the project, the layout toggle and room for
 * the window's fixed panel controls. It takes the main header's titlebar role (height, window drag,
 * collapsed-sidebar inset) because the main header now sits below it.
 */
export const SplitProjectBar = memo(function SplitProjectBar(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** Set when the panes come from a project group, which the bar names instead of the project. */
  readonly groupName: string | null;
  /** The window's fixed top-right controls sit over this bar's right end. */
  readonly reserveTitlebarControls: boolean;
}) {
  const { reserveTitlebarControls } = props;
  const gt = useGT();
  const project = useProject(scopeProjectRef(props.environmentId, props.projectId));
  const [measuredReserve, setMeasuredReserve] = useState<number | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sizes the bar from the window's fixed titlebar controls, which render outside the split view and change width with the panel state
  useEffect(() => {
    if (!reserveTitlebarControls) return;
    const controls = findTitlebarControls();
    if (!controls) return;
    const stop = observeResize(controls, () => {
      const { left, width } = controls.getBoundingClientRect();
      setMeasuredReserve(
        width > 0 ? document.documentElement.clientWidth - left + TITLEBAR_CONTROLS_GAP_PX : null,
      );
    });
    return () => {
      stop();
      setMeasuredReserve(null);
    };
  }, [reserveTitlebarControls]);

  return (
    <div
      data-split-project-bar
      className={cn(
        "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 border-b border-border bg-background [[data-panel-animations=true]_&]:motion-safe:transition-[padding-left] [[data-panel-animations=true]_&]:motion-safe:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:motion-safe:ease-out",
        isElectron
          ? "drag-region px-3 sm:px-5"
          : "pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
      style={
        reserveTitlebarControls
          ? { paddingRight: measuredReserve ?? TITLEBAR_CONTROLS_RESERVE }
          : undefined
      }
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
        {props.groupName !== null ? (
          <>
            <FolderIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{props.groupName}</span>
          </>
        ) : project ? (
          <>
            <ProjectFavicon project={project} className="size-3.5" />
            <span className="min-w-0 truncate">
              {project.isScratch ? gt("No project") : project.title}
            </span>
          </>
        ) : null}
      </div>
      <SplitLayoutToggle />
    </div>
  );
});

/** Subscribes to the layout mode on its own so a mode change re-renders only these buttons. */
function SplitLayoutToggle() {
  const gt = useGT();
  const mode = useSplitViewStore((state) => state.mode);
  const setMode = useSplitViewStore((state) => state.setMode);
  return (
    <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={gt("Columns")}
        aria-pressed={mode === "columns"}
        onClick={() => setMode("columns")}
      >
        <Columns2Icon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={gt("Grid")}
        aria-pressed={mode === "grid"}
        onClick={() => setMode("grid")}
      >
        <LayoutGridIcon />
      </Button>
    </div>
  );
}
