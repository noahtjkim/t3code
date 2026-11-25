import { requestSessionGroupName } from "./components/SessionGroupNameDialog";
import type { ThreadActionMenuState } from "./components/threadActionMenu.logic";
import { sessionGroupOf } from "./sessionGroups.logic";
import { useSessionGroupStore } from "./sessionGroupStore";

const ADD_PREFIX = "session-group:add:";

/** The thread menu's group entry for these sessions: "Remove from" when one group holds them all. */
export function sessionGroupMenuState(
  threadKeys: readonly string[],
): NonNullable<ThreadActionMenuState["sessionGroups"]> {
  const { groups } = useSessionGroupStore.getState();
  const first = threadKeys[0] === undefined ? null : sessionGroupOf(groups, threadKeys[0]);
  const current =
    first !== null && threadKeys.every((key) => sessionGroupOf(groups, key)?.id === first.id)
      ? { id: first.id, name: first.name }
      : null;
  return { groups: groups.map(({ id, name }) => ({ id, name })), current };
}

/** Runs a `session-group…` menu action on the sessions; false for any other action. */
export async function runSessionGroupAction(
  action: string,
  threadKeys: readonly string[],
): Promise<boolean> {
  const store = useSessionGroupStore.getState();
  if (action === "session-group:remove") {
    store.removeThreads(threadKeys);
    return true;
  }
  if (action === "session-group:new") {
    const name = await requestSessionGroupName({ mode: "create" });
    if (name !== null) useSessionGroupStore.getState().createGroup(name, threadKeys);
    return true;
  }
  if (action.startsWith(ADD_PREFIX)) {
    store.addThreads(action.slice(ADD_PREFIX.length), threadKeys);
    return true;
  }
  return false;
}
