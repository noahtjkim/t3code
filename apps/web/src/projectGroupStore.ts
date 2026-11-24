import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";
import {
  projectMemberKey,
  sanitizeProjectGroups,
  withProjectsInGroup,
  withoutProjects,
  type ProjectGroup,
} from "./projectGroups.logic";
import { groupPaneSetKey } from "./splitView.logic";
import { useSplitViewStore } from "./splitViewStore";
import { readThreadShell } from "./state/entities";

interface ProjectGroupState {
  groups: readonly ProjectGroup[];
  /** Creates a group holding the projects and returns its id. */
  createGroup: (name: string, memberKeys: readonly string[]) => string;
  addProjects: (groupId: string, memberKeys: readonly string[]) => void;
  removeProjects: (memberKeys: readonly string[]) => void;
  renameGroup: (groupId: string, name: string) => void;
  ungroup: (groupId: string) => void;
}

// A project joining a group brings its open split panes along.
const adoptProjectPanes = (groupId: string, memberKeys: readonly string[]) => {
  const split = useSplitViewStore.getState();
  for (const key of memberKeys) split.adoptPaneSet(key, groupPaneSetKey(groupId));
};

export const useProjectGroupStore = create<ProjectGroupState>()(
  persist(
    (set, get) => ({
      groups: [],
      createGroup: (name, memberKeys) => {
        const id = randomUUID();
        set((state) => ({
          groups: [
            ...withoutProjects(state.groups, memberKeys),
            { id, name: name.trim(), memberKeys: [...new Set(memberKeys)] },
          ],
        }));
        adoptProjectPanes(id, memberKeys);
        return id;
      },
      addProjects: (groupId, memberKeys) => {
        if (!get().groups.some((group) => group.id === groupId)) return;
        set((state) => ({ groups: withProjectsInGroup(state.groups, groupId, memberKeys) }));
        adoptProjectPanes(groupId, memberKeys);
      },
      removeProjects: (memberKeys) => {
        const left = get().groups.filter((group) =>
          group.memberKeys.some((key) => memberKeys.includes(key)),
        );
        set((state) => ({ groups: withoutProjects(state.groups, memberKeys) }));
        // Their sessions leave the group's panes, which would otherwise count toward the limit.
        const split = useSplitViewStore.getState();
        for (const group of left) {
          const paneSetKey = groupPaneSetKey(group.id);
          for (const pane of split.panesByProject[paneSetKey] ?? []) {
            const shell = readThreadShell(pane);
            if (
              shell !== null &&
              memberKeys.includes(
                projectMemberKey({ environmentId: pane.environmentId, projectId: shell.projectId }),
              )
            ) {
              split.closePane(paneSetKey, pane);
            }
          }
        }
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
      name: "t3code:project-groups:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 1,
      // Sanitized on every load, not only on version changes, since storage is user-editable.
      merge: (persisted, current) => ({
        ...current,
        groups: sanitizeProjectGroups((persisted as { groups?: unknown } | null)?.groups),
      }),
      partialize: ({ groups }) => ({ groups }),
    },
  ),
);
