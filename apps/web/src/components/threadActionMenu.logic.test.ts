import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadActionMenuItems,
  threadActionRequiresOperate,
  type ThreadActionMenuState,
} from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive and turning into a project while the thread is running", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      isRunning: true,
      canTurnIntoProject: true,
    });
    expect(items.find((item) => item.id === "archive")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "turn-into-project")?.disabled).toBe(true);
  });

  it("disables only rename where no inline title editor exists", () => {
    const items = buildThreadActionMenuItems({ ...baseState, canRename: false });
    expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(["rename"]);
  });

  it("offers split view only when available and disables it once full", () => {
    const find = (splitView?: "available" | "full") =>
      buildThreadActionMenuItems({ ...baseState, ...(splitView ? { splitView } : {}) }).find(
        (item) => item.id === "open-in-split-view",
      );
    expect(find(undefined)).toBeUndefined();
    expect(find("available")).toMatchObject({
      label: "Open in split view",
      icon: "columns-2",
    });
    expect(find("available")?.disabled).toBeFalsy();
    expect(find("full")).toMatchObject({
      label: "Split view is full",
      icon: "columns-2",
      disabled: true,
    });
    expect(threadActionRequiresOperate("open-in-split-view")).toBe(false);
    expect(
      buildThreadActionMenuItems({ ...baseState, canOperate: false, splitView: "available" }).find(
        (item) => item.id === "open-in-split-view",
      )?.disabled,
    ).toBeFalsy();
  });

  it("offers adding to a group, or removing from the current one, even read-only", () => {
    const groups = [{ id: "g1", name: "Acme" }];
    const groupItem = (current: { id: string; name: string } | null) =>
      buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        sessionGroups: { groups, current },
      }).find((item) => item.id.startsWith("session-group"));
    expect(groupItem(null)).toMatchObject({
      id: "session-group",
      label: "Add to group",
      children: [
        { id: "session-group:add:g1", label: "Acme" },
        { id: "session-group:new", label: "New group…", separatorBefore: true },
      ],
    });
    expect(groupItem(null)?.disabled).toBeFalsy();
    expect(groupItem(groups[0]!)).toMatchObject({
      id: "session-group:remove",
      label: "Remove from Acme",
    });
    expect(groupItem(groups[0]!)?.disabled).toBeFalsy();
  });
});
