/** A named set of sessions, from any projects, that the sidebar files together and split view shows together. */
export interface SessionGroup {
  readonly id: string;
  readonly name: string;
  /** `scopedThreadKey` of each session, in the order they joined. */
  readonly threadKeys: readonly string[];
}

/** The sidebar's open/closed state key for a group, stored beside its folders' keys. */
export function sessionGroupExpansionKey(groupId: string): string {
  return `session-group:${groupId}`;
}

export function sessionGroupOf(
  groups: readonly SessionGroup[],
  threadKey: string,
): SessionGroup | null {
  return groups.find((group) => group.threadKeys.includes(threadKey)) ?? null;
}

const groupWithout = (group: SessionGroup, threadKeys: readonly string[]): SessionGroup =>
  group.threadKeys.some((key) => threadKeys.includes(key))
    ? { ...group, threadKeys: group.threadKeys.filter((key) => !threadKeys.includes(key)) }
    : group;

/** Takes the sessions out of every group. Groups stay, even when emptied, until ungrouped. */
export function withoutThreads(
  groups: readonly SessionGroup[],
  threadKeys: readonly string[],
): SessionGroup[] {
  return groups.map((group) => groupWithout(group, threadKeys));
}

/** Moves the sessions into the group; a session belongs to at most one group. */
export function withThreadsInGroup(
  groups: readonly SessionGroup[],
  groupId: string,
  threadKeys: readonly string[],
): SessionGroup[] {
  if (!groups.some((group) => group.id === groupId)) return [...groups];
  return groups.map((group) =>
    group.id === groupId
      ? { ...group, threadKeys: [...new Set([...group.threadKeys, ...threadKeys])] }
      : groupWithout(group, threadKeys),
  );
}

export function sanitizeSessionGroups(value: unknown): SessionGroup[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const groups: SessionGroup[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { id, name, threadKeys } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || seenIds.has(id)) continue;
    if (typeof name !== "string" || name.trim() === "" || !Array.isArray(threadKeys)) continue;
    const unique = [
      ...new Set(
        threadKeys.filter(
          (key): key is string => typeof key === "string" && key !== "" && !seenKeys.has(key),
        ),
      ),
    ];
    for (const key of unique) seenKeys.add(key);
    seenIds.add(id);
    groups.push({ id, name: name.trim(), threadKeys: unique });
  }
  return groups;
}

/** Files threads under their groups, keeping input order; the rest are left ungrouped. */
export function groupThreadsBySessionGroup<T>(
  groups: readonly SessionGroup[],
  threads: readonly T[],
  keyOf: (thread: T) => string,
): { groups: Array<{ group: SessionGroup; threads: T[] }>; ungrouped: T[] } {
  const folders = groups.map((group) => ({ group, threads: [] as T[] }));
  const folderByKey = new Map<string, (typeof folders)[number]>();
  for (const folder of folders) {
    for (const key of folder.group.threadKeys) folderByKey.set(key, folder);
  }
  const ungrouped: T[] = [];
  for (const thread of threads) {
    const folder = folderByKey.get(keyOf(thread));
    if (folder) folder.threads.push(thread);
    else ungrouped.push(thread);
  }
  return { groups: folders, ungrouped };
}
