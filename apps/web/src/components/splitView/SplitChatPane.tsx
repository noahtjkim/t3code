import { scopeProjectRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { XIcon } from "lucide-react";
import { memo, useRef } from "react";

import { ComposerHandleContext } from "../../composerHandleContext";
import { useDiffPanelStore } from "../../diffPanelStore";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import { useRightPanelStore } from "../../rightPanelStore";
import { useProject, useQuietThreadShell } from "../../state/entities";
import { useEnvironmentShellHasSnapshot } from "../../state/shell";
import ChatView from "../ChatView";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { threadContextDropTargetProps, useThreadContextDrop } from "../chat/threadContextDrag";
import type { ThreadContextDropRef } from "../chat/threadContextDrop.logic";
import { Button } from "../ui/button";

/**
 * One split pane: its title, Make main and Close, over the session's chat.
 * A session dragged from the sidebar onto the pane replaces it; the main session swaps with it.
 * Memoized so the frame's drags, resizes and main-chat renders don't re-render the pane's ChatView;
 * the callbacks take the pane's ref so the frame can pass the same function to every pane.
 */
export const SplitChatPane = memo(function SplitChatPane(props: {
  readonly threadRef: ScopedThreadRef;
  /** Names the session's project; set when the panes can come from several projects. */
  readonly showProject: boolean;
  readonly onMakeMain: (threadRef: ScopedThreadRef, after?: { command?: string }) => void;
  readonly onClose: (threadRef: ScopedThreadRef) => void;
  readonly onDropThreads: (
    threadRef: ScopedThreadRef,
    dropped: ReadonlyArray<ThreadContextDropRef>,
  ) => void;
}) {
  const { threadRef, onMakeMain, onClose, onDropThreads } = props;
  const gt = useGT();
  const paneRef = useRef<HTMLDivElement>(null);
  // The pane's composer is a nested drop target, so a drop there still attaches context.
  useThreadContextDrop(paneRef, threadRef.environmentId, scopedThreadKey(threadRef), (dropped) =>
    onDropThreads(threadRef, dropped),
  );
  const shell = useQuietThreadShell(threadRef);
  const project = useProject(
    props.showProject && shell ? scopeProjectRef(threadRef.environmentId, shell.projectId) : null,
  );
  const snapshotLoaded = useEnvironmentShellHasSnapshot(threadRef.environmentId);
  // A pane's commands run in its own terminal once it is main, so it hosts itself.
  const parentPanel: SideChatParentPanel = {
    hostRef: threadRef,
    openToolDiff: (target) => {
      useDiffPanelStore.getState().selectToolCall(threadRef, target);
      useRightPanelStore.getState().open(threadRef, "diff");
      onMakeMain(threadRef);
    },
    runShellCommand: (command) => onMakeMain(threadRef, { command }),
  };

  // Focusable so a click on the transcript keeps focus in the pane, which the main chat's
  // type-to-focus and paste handlers skip; on <body> they would take the keystrokes.
  return (
    <div
      ref={paneRef}
      data-side-chat-pane={threadRef.threadId}
      data-split-pane
      tabIndex={-1}
      className="relative flex h-full min-h-0 min-w-0 flex-col outline-none data-[thread-context-over]:after:pointer-events-none data-[thread-context-over]:after:absolute data-[thread-context-over]:after:inset-0 data-[thread-context-over]:after:z-30 data-[thread-context-over]:after:bg-primary/10 data-[thread-context-over]:after:ring-2 data-[thread-context-over]:after:ring-inset data-[thread-context-over]:after:ring-primary/70"
      {...threadContextDropTargetProps()}
    >
      <div className="flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 border-b border-border pr-2 pl-3 sm:pl-5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {project ? <span className="text-muted-foreground">{project.title} · </span> : null}
          {shell?.title}
        </span>
        <Button variant="ghost" size="xs" onClick={() => onMakeMain(threadRef)}>
          <T>Make main</T>
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={gt("Close split pane")}
          onClick={() => onClose(threadRef)}
        >
          <XIcon />
        </Button>
      </div>
      {shell === null ? (
        snapshotLoaded ? (
          <p className="p-3 text-xs text-muted-foreground">
            <T>This session is no longer available.</T>
          </p>
        ) : null
      ) : (
        <BackgroundThreadContext value>
          <ComposerHandleContext value={null}>
            <ChatView
              environmentId={threadRef.environmentId}
              threadId={threadRef.threadId}
              routeKind="server"
              embedded={parentPanel}
            />
          </ComposerHandleContext>
        </BackgroundThreadContext>
      )}
    </div>
  );
});
