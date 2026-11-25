import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { type EnvironmentId, ProjectId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { type ReactNode, StrictMode, use, useRef } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { act, render } from "../../../test/render";
import { useSessionGroupStore } from "../../sessionGroupStore";
import { splitProjectKey } from "../../splitView.logic";
import { useSplitViewStore } from "../../splitViewStore";
import {
  dropThreadContext,
  endThreadContextDrag,
  moveThreadContextDrag,
  threadContextDropTargetProps,
  useThreadContextDrop,
} from "../chat/threadContextDrag";
import { toastManager } from "../ui/toast";
import { SplitViewFrame } from "./SplitViewFrame";
import { SplitViewChromeContext } from "./splitViewChrome";

const chatViewRenders = vi.hoisted(() => new Map<string, number>());
const composerDrops = vi.hoisted(() => [] as Array<{ threadId: string; dropped: string[] }>);

function MockChatView(props: { environmentId: EnvironmentId; threadId: string }) {
  chatViewRenders.set(props.threadId, (chatViewRenders.get(props.threadId) ?? 0) + 1);
  const composerRef = useRef<HTMLFormElement>(null);
  useThreadContextDrop(composerRef, props.environmentId, props.threadId, (refs) =>
    composerDrops.push({ threadId: props.threadId, dropped: refs.map((ref) => ref.threadId) }),
  );
  return (
    <>
      <p data-testid={`pane-${props.threadId}`}>Transcript</p>
      <form
        ref={composerRef}
        data-testid={`composer-${props.threadId}`}
        {...threadContextDropTargetProps()}
      >
        Composer
      </form>
    </>
  );
}

vi.mock(import("../ChatView"), () => ({ default: MockChatView }));
// Threads named "other-…" belong to another project; "gone" has no shell.
vi.mock(import("../../state/entities"), () => ({
  useProject: (ref: { projectId: string } | null) =>
    ref?.projectId === "project-1"
      ? ({
          title: "Alpha",
          projectIcon: { kind: "monogram", text: "AL", color: "blue" },
        } as EnvironmentProject)
      : null,
  useQuietThreadShell: (ref: ScopedThreadRef | null) =>
    ref ? ({ title: `Session ${ref.threadId}` } as EnvironmentThreadShell) : null,
  readThreadShell: (ref: ScopedThreadRef) =>
    ref.threadId === "gone"
      ? null
      : ({
          projectId: ref.threadId.startsWith("other") ? "project-2" : "project-1",
          lineage: {},
          title: `Session ${ref.threadId}`,
        } as EnvironmentThreadShell),
  readProject: (ref: { projectId: string }) =>
    ref.projectId === "project-1" ? ({ title: "Alpha" } as EnvironmentProject) : null,
}));
vi.mock(import("../../state/shell"), () => ({ useEnvironmentShellHasSnapshot: () => true }));

const environmentId = "env-1" as EnvironmentId;
const projectRef = { environmentId, projectId: ProjectId.make("project-1") };
const ref = (id: string) => scopeThreadRef(environmentId, ThreadId.make(id));
const main = ref("main");

async function setup(mode: "columns" | "grid" = "columns", panes = [ref("a"), ref("b")]) {
  chatViewRenders.clear();
  composerDrops.length = 0;
  endThreadContextDrag();
  await page.viewport(1600, 1000);
  useSessionGroupStore.setState({ groups: [] });
  useSplitViewStore.setState({
    panesByProject: { [splitProjectKey(projectRef)]: panes },
    mode,
    columnFractions: {},
    gridFractions: { column: 0.5, row: 0.5 },
    screen: { mainThreadKey: null, projectKey: null, shownPaneKeys: [] },
    pendingCommand: null,
  });
}

function ChromeProbe() {
  return <div data-testid="chrome-probe" data-project-bar={String(use(SplitViewChromeContext))} />;
}

const mainFrame = (
  runMainShellCommand: (command: string) => void = () => {},
  reserveTitlebarControls = false,
  children: ReactNode = <ChromeProbe />,
) => (
  <SplitViewFrame
    mainThreadRef={main}
    projectRef={projectRef}
    rightPanelMaximized={false}
    reserveTitlebarControls={reserveTitlebarControls}
    runMainShellCommand={runMainShellCommand}
    className="flex-1"
    data-testid="main"
  >
    {children}
  </SplitViewFrame>
);

function renderFrame(
  size: { width: number; height: number },
  ui: ReactNode = mainFrame(),
  options: { router?: false } = {},
) {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.width = `${size.width}px`;
  container.style.height = `${size.height}px`;
  return render(ui, { container, ...options });
}

const startDrag = () => act(() => moveThreadContextDrag({ x: 0, y: 0 }, { title: "", count: 1 }));
const dropOn = (element: Element, ids: string[]) => {
  const { left, top, width, height } = element.getBoundingClientRect();
  return dropThreadContext({ x: left + width / 2, y: top + height / 2 }, ids.map(ref));
};
const storedPaneIds = () =>
  (useSplitViewStore.getState().panesByProject[splitProjectKey(projectRef)] ?? []).map(
    (pane) => pane.threadId,
  );

const projectBar = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-split-project-bar]");

const separators = (container: HTMLElement, orientation: "vertical" | "horizontal") =>
  container.querySelectorAll<HTMLElement>(`[role="separator"][aria-orientation="${orientation}"]`);

describe("SplitViewFrame", () => {
  it("renders main and two panes in columns", async () => {
    await setup();
    await using screen = await renderFrame({ width: 1400, height: 900 });

    await expect.element(screen.getByTestId("pane-a")).toBeInTheDocument();
    await expect.element(screen.getByTestId("pane-b")).toBeInTheDocument();
    await expect.element(screen.getByTestId("main")).toBeInTheDocument();
    expect(screen.container.querySelectorAll("[data-split-cell]")).toHaveLength(3);
    expect(separators(screen.container, "vertical")).toHaveLength(2);
    const column = screen.getByTestId("main").element();
    const cell = column.closest("[data-split-cell]")!.getBoundingClientRect();
    expect(column.getBoundingClientRect().width).toBeCloseTo(cell.width, 0);
    expect(column.getBoundingClientRect().height).toBeCloseTo(cell.height, 0);
  });

  it("drag commits column fractions without re-rendering pane chats", async () => {
    await setup();
    await using screen = await renderFrame({ width: 1400, height: 900 });
    await expect.element(screen.getByTestId("pane-b")).toBeInTheDocument();
    const paneRenders = new Map(chatViewRenders);

    // A fresh element re-renders the frame the way every main ChatView render does.
    await screen.rerender(mainFrame());
    const divider = separators(screen.container, "vertical")[0]!;
    const { left, top } = divider.getBoundingClientRect();
    const pointer = { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientY: top + 10 };
    divider.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, clientX: left }));
    divider.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientX: left + 140 }));
    const mainCell = screen
      .getByTestId("main")
      .element()
      .closest<HTMLElement>("[data-split-cell]")!;
    await vi.waitFor(() => expect(Number(mainCell.style.flexGrow)).toBeGreaterThan(1 / 3));
    divider.dispatchEvent(new PointerEvent("pointerup", { ...pointer, clientX: left + 140 }));

    await vi.waitFor(() => expect(useSplitViewStore.getState().columnFractions["3"]).toBeDefined());
    const fractions = useSplitViewStore.getState().columnFractions["3"]!;
    expect(fractions[0]).toBeGreaterThan(1 / 3);
    expect(fractions.reduce((sum, fraction) => sum + fraction, 0)).toBeCloseTo(1);
    expect(chatViewRenders).toEqual(paneRenders);
  });

  it("clicking a pane's transcript keeps focus inside that pane", async () => {
    await setup();
    await using screen = await renderFrame({ width: 1400, height: 900 });

    await userEvent.click(screen.getByTestId("pane-a"));

    expect(document.activeElement?.closest('[data-side-chat-pane="a"]')).not.toBeNull();
  });

  it("grid mode places third session across the bottom row", async () => {
    await setup("grid");
    await using screen = await renderFrame({ width: 1400, height: 900 });

    await expect.element(screen.getByTestId("pane-b")).toBeInTheDocument();
    expect(separators(screen.container, "vertical")).toHaveLength(1);
    expect(separators(screen.container, "horizontal")).toHaveLength(1);
    const bottom = screen
      .getByTestId("pane-b")
      .element()
      .closest<HTMLElement>("[data-split-cell]")!;
    const top = screen.getByTestId("main").element().closest<HTMLElement>("[data-split-cell]")!;
    expect(bottom.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      top.getBoundingClientRect().bottom,
    );
    expect(bottom.getBoundingClientRect().width).toBeCloseTo(1400, 0);
  });

  it("grid mode stacks two sessions with only a row divider", async () => {
    await setup("grid", [ref("a")]);
    await using screen = await renderFrame({ width: 1400, height: 900 });

    await expect.element(screen.getByTestId("pane-a")).toBeInTheDocument();
    expect(separators(screen.container, "vertical")).toHaveLength(0);
    expect(separators(screen.container, "horizontal")).toHaveLength(1);
    const bottom = screen
      .getByTestId("pane-a")
      .element()
      .closest<HTMLElement>("[data-split-cell]")!;
    const top = screen.getByTestId("main").element().closest<HTMLElement>("[data-split-cell]")!;
    expect(bottom.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      top.getBoundingClientRect().bottom,
    );
    expect(top.getBoundingClientRect().width).toBeCloseTo(1400, 0);
    expect(bottom.getBoundingClientRect().width).toBeCloseTo(1400, 0);
  });

  it("shows the project bar only while panes are shown, without remounting the main column", async () => {
    await setup("columns", []);
    await using screen = await renderFrame({ width: 1400, height: 900 });
    const probe = screen.getByTestId("chrome-probe");
    await expect.element(probe).toHaveAttribute("data-project-bar", "false");
    expect(projectBar(screen.container)).toBeNull();
    const column = screen.getByTestId("main").element();
    const probeNode = probe.element();

    await act(() =>
      useSplitViewStore.getState().openPane(splitProjectKey(projectRef), ref("a"), main),
    );
    await expect.element(screen.getByTestId("pane-a")).toBeInTheDocument();
    await expect.element(probe).toHaveAttribute("data-project-bar", "true");
    expect(projectBar(screen.container)?.textContent).toContain("Alpha");
    expect(screen.getByTestId("main").element()).toBe(column);

    await act(() => useSplitViewStore.getState().closePane(splitProjectKey(projectRef), ref("a")));
    await expect.element(probe).toHaveAttribute("data-project-bar", "false");
    expect(projectBar(screen.container)).toBeNull();
    expect(screen.getByTestId("main").element()).toBe(column);
    expect(probe.element()).toBe(probeNode);
  });

  it("puts the layout toggle on the project bar and none on pane bars", async () => {
    await setup();
    await using screen = await renderFrame({ width: 1400, height: 900 });
    await expect.element(screen.getByTestId("pane-b")).toBeInTheDocument();

    const bar = projectBar(screen.container)!;
    expect(bar.querySelector('button[aria-label="Columns"]')).not.toBeNull();
    expect(bar.querySelector('button[aria-label="Grid"]')).not.toBeNull();
    for (const pane of screen.container.querySelectorAll("[data-split-pane]")) {
      expect(
        pane.querySelector('button[aria-label="Columns"], button[aria-label="Grid"]'),
      ).toBeNull();
      const paneBar = pane.querySelector('button[aria-label="Close split pane"]')!.parentElement!;
      expect(paneBar.getBoundingClientRect().height).toBe(bar.getBoundingClientRect().height);
    }
  });

  it("keeps the project bar's toggle and the pane bars clear of the window's titlebar controls", async () => {
    await setup();
    const controls = document.createElement("div");
    controls.dataset.workspaceTitlebarControls = "";
    Object.assign(controls.style, {
      position: "fixed",
      top: "0",
      right: "12px",
      width: "150px",
      height: "52px",
    });
    document.body.append(controls);
    using _controls = { [Symbol.dispose]: () => controls.remove() };
    await using screen = await renderFrame(
      { width: 1600, height: 900 },
      mainFrame(() => {}, true),
    );
    await expect.element(screen.getByTestId("pane-b")).toBeInTheDocument();
    const gridRight = () =>
      projectBar(screen.container)!
        .querySelector('button[aria-label="Grid"]')!
        .getBoundingClientRect().right;
    const rightGap = () =>
      projectBar(screen.container)!.getBoundingClientRect().right - gridRight();

    await vi.waitFor(() =>
      expect(gridRight()).toBeLessThanOrEqual(controls.getBoundingClientRect().left),
    );
    for (const close of screen.container.querySelectorAll(
      '[data-split-pane] button[aria-label="Close split pane"]',
    )) {
      expect(close.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        controls.getBoundingClientRect().bottom,
      );
    }
    const measuredGap = rightGap();

    await screen.rerender(mainFrame(() => {}, false));
    expect(rightGap()).toBeLessThan(30);

    controls.remove();
    await screen.rerender(mainFrame(() => {}, true));
    expect(rightGap()).toBeGreaterThan(100);
    expect(rightGap()).toBeLessThan(measuredGap);
  });

  it("too narrow hides panes with a note", async () => {
    await setup();
    await using screen = await renderFrame({ width: 600, height: 900 });

    await expect
      .element(screen.getByText("Widen the window to see 2 split sessions"))
      .toBeVisible();
    await expect.element(screen.getByTestId("main")).toBeInTheDocument();
    expect(screen.container.querySelector('[data-testid^="pane-"]')).toBeNull();
    expect(projectBar(screen.container)).toBeNull();
  });

  it("a maximized right panel leaves the frame no width and shows no panes", async () => {
    await setup();
    await using screen = await renderFrame(
      { width: 1400, height: 900 },
      <SplitViewFrame
        mainThreadRef={main}
        projectRef={projectRef}
        rightPanelMaximized
        reserveTitlebarControls={false}
        runMainShellCommand={() => {}}
        className="w-0 flex-none"
        data-testid="main"
      >
        <div />
      </SplitViewFrame>,
    );

    await expect.element(screen.getByTestId("main")).toBeInTheDocument();
    expect(screen.container.querySelector("[data-split-view]")!.getBoundingClientRect().width).toBe(
      0,
    );
    expect(screen.container.querySelector('[data-testid^="pane-"]')).toBeNull();
  });

  it("a frame without refs leaves the main frame's screen state alone", async () => {
    await setup();
    const withEmbedded = (embedded: boolean) => (
      <>
        {mainFrame()}
        {embedded ? (
          <SplitViewFrame
            mainThreadRef={null}
            projectRef={null}
            rightPanelMaximized={false}
            reserveTitlebarControls={false}
            runMainShellCommand={() => {}}
          >
            <div />
          </SplitViewFrame>
        ) : null}
      </>
    );
    await using screen = await renderFrame({ width: 1400, height: 900 }, withEmbedded(false));
    const expected = {
      mainThreadKey: scopedThreadKey(main),
      projectKey: splitProjectKey(projectRef),
      shownPaneKeys: [scopedThreadKey(ref("a")), scopedThreadKey(ref("b"))],
    };
    await vi.waitFor(() => expect(useSplitViewStore.getState().screen).toEqual(expected));

    await screen.rerender(withEmbedded(true));
    expect(useSplitViewStore.getState().screen).toEqual(expected);
    await screen.rerender(withEmbedded(false));
    expect(useSplitViewStore.getState().screen).toEqual(expected);
  });

  it("runs a pending command once when its session mounts as main", async () => {
    await setup();
    useSplitViewStore.setState({
      pendingCommand: {
        threadKey: scopedThreadKey(main),
        command: "pnpm test",
        fromThreadKey: scopedThreadKey(ref("old-main")),
      },
    });
    const runMainShellCommand = vi.fn();
    const router = createRouter({
      routeTree: createRootRoute({ component: () => mainFrame(runMainShellCommand) }),
      history: createMemoryHistory(),
    });
    // StrictMode replays mount effects only when it wraps the root, so it goes outside its own router.
    await using _screen = await renderFrame(
      { width: 1400, height: 900 },
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
      { router: false },
    );

    await vi.waitFor(() => expect(runMainShellCommand).toHaveBeenCalledWith("pnpm test"));
    expect(runMainShellCommand).toHaveBeenCalledTimes(1);
    expect(useSplitViewStore.getState().pendingCommand).toBeNull();
  });

  it("shows a drop strip at the right edge while a session is dragged and opens a dropped session", async () => {
    await setup("columns", [ref("a")]);
    await using screen = await renderFrame({ width: 1400, height: 900 });
    await expect.element(screen.getByTestId("pane-a")).toBeInTheDocument();
    expect(screen.container.textContent).not.toContain("Drop to open in split view");

    await startDrag();
    const strip = screen.getByText("Drop to open in split view");
    await expect.element(strip).toBeVisible();
    const frame = screen.container.querySelector("[data-split-view]")!.getBoundingClientRect();
    expect(strip.element().getBoundingClientRect().right).toBeLessThanOrEqual(frame.right);
    expect(strip.element().getBoundingClientRect().right).toBeGreaterThan(frame.right - 20);

    expect(dropOn(strip.element(), ["c", "d", "e"])).toBe(true);
    expect(storedPaneIds()).toEqual(["a", "c", "d"]);
    await expect.element(screen.getByTestId("pane-d")).toBeInTheDocument();
  });

  it("shows a drop strip along the bottom while a session is dragged and opens a dropped session below", async () => {
    await setup("columns", []);
    // Stands in for ThreadTerminalDrawer: same stacking (relative z-45) in the main column's bottom area.
    const terminalDrawer = (
      <div className="flex h-full flex-col">
        <div data-testid="terminal-drawer" className="relative z-45 mt-auto h-48 shrink-0" />
      </div>
    );
    await using screen = await renderFrame(
      { width: 1400, height: 900 },
      mainFrame(() => {}, false, terminalDrawer),
    );
    await expect.element(screen.getByTestId("main")).toBeInTheDocument();
    expect(screen.container.textContent).not.toContain("Drop to open below");
    const column = screen.getByTestId("main").element();
    const renders = new Map(chatViewRenders);

    await startDrag();
    const strip = screen.getByText("Drop to open below");
    await expect.element(strip).toBeVisible();
    const rightStrip = screen.getByText("Drop to open in split view").element();
    const frame = screen.container.querySelector("[data-split-view]")!.getBoundingClientRect();
    const bounds = strip.element().getBoundingClientRect();
    expect(bounds.bottom).toBeLessThanOrEqual(frame.bottom);
    expect(bounds.bottom).toBeGreaterThan(frame.bottom - 20);
    expect(bounds.left).toBeLessThan(frame.left + 20);
    expect(bounds.right).toBeLessThanOrEqual(rightStrip.getBoundingClientRect().left);
    expect(bounds.height).toBeCloseTo(56, 0);
    const drawerBounds = screen.getByTestId("terminal-drawer").element().getBoundingClientRect();
    expect(drawerBounds.top).toBeLessThan(bounds.top);
    expect(drawerBounds.bottom).toBeGreaterThan(bounds.bottom);
    expect(
      strip
        .element()
        .contains(
          document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2),
        ),
    ).toBe(true);
    expect(screen.getByTestId("main").element()).toBe(column);
    expect(chatViewRenders).toEqual(renders);

    expect(dropOn(strip.element(), ["c"])).toBe(true);
    expect(storedPaneIds()).toEqual(["c"]);
    expect(useSplitViewStore.getState().mode).toBe("grid");
    await act(() => endThreadContextDrag());
    await expect.element(screen.getByTestId("pane-c")).toBeInTheDocument();
    const paneCell = screen
      .getByTestId("pane-c")
      .element()
      .closest<HTMLElement>("[data-split-cell]")!;
    const mainCell = screen
      .getByTestId("main")
      .element()
      .closest<HTMLElement>("[data-split-cell]")!;
    expect(paneCell.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      mainCell.getBoundingClientRect().bottom,
    );
  });

  it("a full split view says so on both strips and ignores drops on them", async () => {
    await setup("columns", [ref("a"), ref("b"), ref("c")]);
    await using screen = await renderFrame({ width: 1600, height: 900 });
    await startDrag();

    const strips = screen.getByText("Split view is full. Drop on a pane to replace it.");
    await expect.element(strips.first()).toBeVisible();
    expect(strips.elements()).toHaveLength(2);
    for (const strip of strips.elements()) dropOn(strip, ["d"]);
    expect(storedPaneIds()).toEqual(["a", "b", "c"]);
    expect(useSplitViewStore.getState().mode).toBe("columns");
  });

  it("the main session dropped on a pane swaps with it, like Make main", async () => {
    await setup();
    await using screen = await renderFrame({ width: 1400, height: 900 });
    await expect.element(screen.getByTestId("pane-a")).toBeInTheDocument();
    await startDrag();

    dropOn(screen.getByTestId("pane-a").element(), ["main"]);

    expect(storedPaneIds()).toEqual(["main", "b"]);
    await vi.waitFor(() => expect(screen.router?.state.location.pathname).toBe("/env-1/a"));
  });

  it("a session already on screen dropped on a strip or another pane says so and changes nothing", async () => {
    await setup();
    using toast = vi.spyOn(toastManager, "add");
    await using screen = await renderFrame({ width: 1400, height: 900 });
    await expect.element(screen.getByTestId("pane-a")).toBeInTheDocument();
    await startDrag();

    dropOn(screen.getByText("Drop to open in split view").element(), ["main"]);
    dropOn(screen.getByText("Drop to open below").element(), ["b"]);
    dropOn(screen.getByTestId("pane-a").element(), ["b"]);

    expect(storedPaneIds()).toEqual(["a", "b"]);
    expect(useSplitViewStore.getState().mode).toBe("columns");
    expect(screen.router?.state.location.pathname).toBe("/");
    expect(toast.mock.calls.map(([options]) => options.title)).toEqual([
      "Session main is already open",
      "Session b is already open",
      "Session b is already open",
    ]);
  });

  it("dropping on a pane replaces it, while its composer still takes the drop as context", async () => {
    await setup();
    await using screen = await renderFrame({ width: 1400, height: 900 });
    await expect.element(screen.getByTestId("pane-b")).toBeInTheDocument();
    await startDrag();

    dropOn(screen.getByTestId("composer-b").element(), ["d"]);
    expect(composerDrops).toEqual([{ threadId: "b", dropped: ["d"] }]);
    expect(storedPaneIds()).toEqual(["a", "b"]);

    dropOn(screen.getByTestId("pane-a").element(), ["d", "e"]);
    expect(storedPaneIds()).toEqual(["d", "b"]);
    await expect.element(screen.getByTestId("pane-d")).toBeInTheDocument();
  });

  it("a session from another project shows a toast and changes nothing", async () => {
    await setup();
    using toast = vi.spyOn(toastManager, "add");
    await using screen = await renderFrame({ width: 1400, height: 900 });
    await expect.element(screen.getByTestId("pane-a")).toBeInTheDocument();
    await startDrag();

    dropOn(screen.getByText("Drop to open in split view").element(), ["other-1"]);
    dropOn(screen.getByTestId("pane-a").element(), ["gone"]);

    expect(storedPaneIds()).toEqual(["a", "b"]);
    expect(toast).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Only sessions from Alpha can open here" }),
    );
  });

  it("in a session group, opens that group's sessions from any project and only those", async () => {
    await setup("columns", []);
    useSessionGroupStore.setState({
      groups: [{ id: "g1", name: "Acme", threadKeys: ["env-1:main", "env-1:a", "env-1:other-1"] }],
    });
    // "b" is in the main session's project but not its group, so its pane is hidden.
    useSplitViewStore.setState({ panesByProject: { "group:g1": [ref("a"), ref("b")] } });
    using toast = vi.spyOn(toastManager, "add");
    await using screen = await renderFrame({ width: 1400, height: 900 });
    await expect.element(screen.getByTestId("pane-a")).toBeInTheDocument();
    expect(screen.container.querySelector('[data-testid="pane-b"]')).toBeNull();
    await startDrag();

    dropOn(screen.getByText("Drop to open in split view").element(), ["other-1"]);
    dropOn(screen.getByText("Drop to open in split view").element(), ["c"]);

    await expect.element(screen.getByTestId("pane-other-1")).toBeInTheDocument();
    expect(screen.container.querySelector('[data-testid="pane-c"]')).toBeNull();
    expect(projectBar(screen.container)?.textContent).toContain("Acme");
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Only sessions from the Acme group can open here" }),
    );
  });

  it.each([
    { name: "main session", mainThreadRef: null, frameProjectRef: projectRef },
    { name: "project", mainThreadRef: main, frameProjectRef: null },
  ])("shows no drop strip without a $name", async ({ mainThreadRef, frameProjectRef }) => {
    await setup();
    await using screen = await renderFrame(
      { width: 1400, height: 900 },
      <SplitViewFrame
        mainThreadRef={mainThreadRef}
        projectRef={frameProjectRef}
        rightPanelMaximized={false}
        reserveTitlebarControls={false}
        runMainShellCommand={() => {}}
        data-testid="main"
      >
        <div />
      </SplitViewFrame>,
    );
    await startDrag();

    await expect.element(screen.getByTestId("main")).toBeInTheDocument();
    expect(screen.container.textContent).not.toContain("Drop to open in split view");
    expect(screen.container.textContent).not.toContain("Drop to open below");
  });
});
