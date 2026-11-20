import { type KeyboardEvent, type PointerEvent, useRef } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";

const KEYBOARD_STEP_PX = 16;

const KEY_DIRECTIONS: Record<"vertical" | "horizontal", Partial<Record<string, number>>> = {
  vertical: { ArrowLeft: -1, ArrowRight: 1 },
  horizontal: { ArrowUp: -1, ArrowDown: 1 },
};

interface ActiveDrag {
  readonly target: HTMLElement;
  readonly pointerId: number;
  readonly axis: "clientX" | "clientY";
  readonly start: number;
  reported: number;
  pending: number;
  frame: number | null;
  readonly onBlur: () => void;
}

interface Props {
  orientation: "vertical" | "horizontal";
  /** Cumulative distance in px from where the drag started along the divider's axis. */
  onDrag: (deltaPx: number) => void;
  onCommit: () => void;
  onReset: () => void;
  label: string;
}

export function SplitDivider({ orientation, onDrag, onCommit, onReset, label }: Props) {
  const vertical = orientation === "vertical";
  const active = useRef<ActiveDrag | null>(null);
  const reportDrag = useStableCallback(onDrag);
  const reportCommit = useStableCallback(onCommit);

  const report = (drag: ActiveDrag) => {
    if (drag.pending === drag.reported) return;
    drag.reported = drag.pending;
    reportDrag(drag.pending - drag.start);
  };

  const release = useStableCallback(() => {
    const drag = active.current;
    if (!drag) return null;
    // Releasing capture can synchronously dispatch lostpointercapture.
    active.current = null;
    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    window.removeEventListener("blur", drag.onBlur);
    try {
      if (drag.target.hasPointerCapture(drag.pointerId)) {
        drag.target.releasePointerCapture(drag.pointerId);
      }
    } catch {}
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    return drag;
  });

  const finish = useStableCallback((position?: number) => {
    const drag = release();
    if (!drag) return;
    if (position !== undefined) drag.pending = position;
    report(drag);
    reportCommit();
  });

  const ref = useStableCallback((node: HTMLDivElement | null) =>
    node === null ? undefined : () => void release(),
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || active.current) return;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    const axis = vertical ? "clientX" : "clientY";
    const start = event[axis];
    // Leaving the window mid-drag keeps what was dragged so far.
    const onBlur = () => finish();
    window.addEventListener("blur", onBlur);
    active.current = {
      target,
      pointerId: event.pointerId,
      axis,
      start,
      reported: start,
      pending: start,
      frame: null,
      onBlur,
    };
    document.body.style.cursor = vertical ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = active.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.pending = event[drag.axis];
    if (drag.frame !== null) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = null;
      report(drag);
    });
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>, usePosition: boolean) => {
    const drag = active.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    finish(usePosition ? event[drag.axis] : undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const direction = KEY_DIRECTIONS[orientation][event.key];
    if (direction === undefined) return;
    event.preventDefault();
    onDrag(direction * KEYBOARD_STEP_PX);
    onCommit();
  };

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={0}
      className={cn(
        "group relative shrink-0 touch-none select-none outline-none",
        vertical ? "h-full w-1.5 cursor-col-resize" : "h-1.5 w-full cursor-row-resize",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => onPointerEnd(event, true)}
      onPointerCancel={(event) => onPointerEnd(event, false)}
      onLostPointerCapture={(event) => onPointerEnd(event, false)}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bg-border transition-colors duration-150 group-hover:bg-primary/60 group-focus-visible:bg-primary/60 group-active:bg-primary/60",
          vertical
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2",
        )}
      />
    </div>
  );
}
