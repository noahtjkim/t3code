import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";
import {
  sanitizeSessionGroups,
  withThreadsInGroup,
  withoutThreads,
  type SessionGroup,
} from "./sessionGroups.logic";
import { groupPaneSetKey } from "./splitView.logic";
import { useSplitViewStore } from "./splitViewStore";

interface SessionGroupState {
  groups: readonly SessionGroup[];
  /** Creates a group holding the sessions and returns its id. */
  createGroup: (name: string, threadKeys: readonly string[]) => string;
  addThreads: (groupId: string, threadKeys: readonly string[]) => void;
  removeThreads: (threadKeys: readonly string[]) => void;
  renameGroup: (groupId: string, name: string) => void;
  ungroup: (groupId: string) => void;
}

// Sessions that leave a group leave its split panes, which would otherwise count toward the limit.
const closeGroupPanes = (groupIds: readonly string[], threadKeys: readonly string[]) => {
  const split = useSplitViewStore.getState();
  for (const groupId of groupIds) {
    const paneSetKey = groupPaneSetKey(groupId);
    for (const pane of split.panesByProject[paneSetKey] ?? []) {
      if (threadKeys.includes(`${pane.environmentId}:${pane.threadId}`)) {
        split.closePane(paneSetKey, pane);
      }
    }
  }
};

const groupIdsHolding = (groups: readonly SessionGroup[], threadKeys: readonly string[]) =>
  groups
    .filter((group) => group.threadKeys.some((key) => threadKeys.includes(key)))
    .map((group) => group.id);

export const useSessionGroupStore = create<SessionGroupState>()(
  persist(
    (set, get) => ({
      groups: [],
      createGroup: (name, threadKeys) => {
        const id = randomUUID();
        const left = groupIdsHolding(get().groups, threadKeys);
        set((state) => ({
          groups: [
            ...withoutThreads(state.groups, threadKeys),
            { id, name: name.trim(), threadKeys: [...new Set(threadKeys)] },
          ],
        }));
        closeGroupPanes(left, threadKeys);
        return id;
      },
      addThreads: (groupId, threadKeys) => {
        if (!get().groups.some((group) => group.id === groupId)) return;
        const left = groupIdsHolding(get().groups, threadKeys).filter((id) => id !== groupId);
        set((state) => ({ groups: withThreadsInGroup(state.groups, groupId, threadKeys) }));
        closeGroupPanes(left, threadKeys);
      },
      removeThreads: (threadKeys) => {
        const left = groupIdsHolding(get().groups, threadKeys);
        set((state) => ({ groups: withoutThreads(state.groups, threadKeys) }));
        closeGroupPanes(left, threadKeys);
      },
      renameGroup: (groupId, name) =>
        set((state) => ({
          groups: state.groups.map((group) =>
            group.id === groupId ? { ...group, name: name.trim() } : group,
          ),
        })),
      ungroup: (groupId) => {
        set((state) => ({ groups: state.groups.filter((group) => group.id !== groupId) }));
        useSplitViewStore.getState().dropPaneSet(groupPaneSetKey(groupId));
      },
    }),
    {
      name: "t3code:session-groups:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 1,
      // Sanitized on every load, not only on version changes, since storage is user-editable.
      merge: (persisted, current) => ({
        ...current,
        groups: sanitizeSessionGroups((persisted as { groups?: unknown } | null)?.groups),
      }),
      partialize: ({ groups }) => ({ groups }),
    },
  ),
);
