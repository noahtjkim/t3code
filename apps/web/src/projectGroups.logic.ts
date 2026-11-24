import type { EnvironmentId } from "@t3tools/contracts";

/** A named set of projects the sidebar nests together and split view treats as one. */
export interface ProjectGroup {
  readonly id: string;
  readonly name: string;
  /** `${environmentId}:${projectId}` keys, so a sidebar grouping-mode change keeps membership. */
  readonly memberKeys: readonly string[];
}

export function projectMemberKey(ref: {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
}): string {
  return `${ref.environmentId}:${ref.projectId}`;
}

/** The sidebar's open/closed state key for a group, stored beside its folders' keys. */
export function projectGroupExpansionKey(groupId: string): string {
  return `project-group:${groupId}`;
}

export function projectGroupOf(
  groups: readonly ProjectGroup[],
  memberKey: string,
): ProjectGroup | null {
  return groups.find((group) => group.memberKeys.includes(memberKey)) ?? null;
}

/** A sidebar folder can merge several projects; it is in the group any of them is in. */
export function projectGroupOfRefs(
  groups: readonly ProjectGroup[],
  refs: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly projectId: string }>,
): ProjectGroup | null {
  for (const ref of refs) {
    const group = projectGroupOf(groups, projectMemberKey(ref));
    if (group) return group;
  }
  return null;
}

/** Removes the keys from every group, dropping groups left empty. */
export function withoutProjects(
  groups: readonly ProjectGroup[],
  keys: readonly string[],
): ProjectGroup[] {
  return groups.flatMap((group) => {
    const memberKeys = group.memberKeys.filter((key) => !keys.includes(key));
    if (memberKeys.length === group.memberKeys.length) return [group];
    return memberKeys.length > 0 ? [{ ...group, memberKeys }] : [];
  });
}

/** Moves the keys into the group; a project belongs to at most one group. */
export function withProjectsInGroup(
  groups: readonly ProjectGroup[],
  groupId: string,
  keys: readonly string[],
): ProjectGroup[] {
  if (!groups.some((group) => group.id === groupId)) return [...groups];
  return groups.flatMap((group) => {
    if (group.id === groupId) {
      return [{ ...group, memberKeys: [...new Set([...group.memberKeys, ...keys])] }];
    }
    const memberKeys = group.memberKeys.filter((key) => !keys.includes(key));
    if (memberKeys.length === group.memberKeys.length) return [group];
    return memberKeys.length > 0 ? [{ ...group, memberKeys }] : [];
  });
}

export function sanitizeProjectGroups(value: unknown): ProjectGroup[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const groups: ProjectGroup[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { id, name, memberKeys } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || seenIds.has(id)) continue;
    if (typeof name !== "string" || name.trim() === "" || !Array.isArray(memberKeys)) continue;
    const unique = [
      ...new Set(
        memberKeys.filter(
          (key): key is string => typeof key === "string" && key !== "" && !seenKeys.has(key),
        ),
      ),
    ];
    if (unique.length === 0) continue;
    for (const key of unique) seenKeys.add(key);
    seenIds.add(id);
    groups.push({ id, name: name.trim(), memberKeys: unique });
  }
  return groups;
}

export type NestedFolderItem<F> =
  | { readonly kind: "folder"; readonly folder: F }
  | { readonly kind: "group"; readonly group: ProjectGroup; readonly folders: readonly F[] };

/** Folds grouped folders under their group, placed where the group's first folder would sit. */
export function nestFoldersInGroups<F>(
  folders: readonly F[],
  groupOf: (folder: F) => ProjectGroup | null,
): NestedFolderItem<F>[] {
  type GroupItem = { kind: "group"; group: ProjectGroup; folders: F[] };
  const items: Array<{ kind: "folder"; folder: F } | GroupItem> = [];
  const groupItems = new Map<string, GroupItem>();
  for (const folder of folders) {
    const group = groupOf(folder);
    if (group === null) {
      items.push({ kind: "folder", folder });
      continue;
    }
    const existing = groupItems.get(group.id);
    if (existing) {
      existing.folders.push(folder);
      continue;
    }
    const item = { kind: "group" as const, group, folders: [folder] };
    groupItems.set(group.id, item);
    items.push(item);
  }
  return items;
}
