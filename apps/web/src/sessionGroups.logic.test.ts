import { describe, expect, it } from "vite-plus/test";

import {
  groupThreadsBySessionGroup,
  sanitizeSessionGroups,
  withThreadsInGroup,
  withoutThreads,
  type SessionGroup,
} from "./sessionGroups.logic";

const acme: SessionGroup = { id: "g1", name: "Acme", threadKeys: ["env:a", "env:b"] };
const beta: SessionGroup = { id: "g2", name: "Beta", threadKeys: ["env:c"] };

describe("withThreadsInGroup", () => {
  it("moves a session out of its old group, which stays even when emptied", () => {
    expect(withThreadsInGroup([acme, beta], "g1", ["env:c"])).toEqual([
      { ...acme, threadKeys: ["env:a", "env:b", "env:c"] },
      { ...beta, threadKeys: [] },
    ]);
  });

  it("does not duplicate sessions already in the group", () => {
    expect(withThreadsInGroup([acme], "g1", ["env:a", "env:a"])).toEqual([acme]);
  });

  it("changes nothing for an unknown group", () => {
    expect(withThreadsInGroup([acme, beta], "missing", ["env:c"])).toEqual([acme, beta]);
  });
});

describe("withoutThreads", () => {
  it("removes sessions and keeps the groups", () => {
    expect(withoutThreads([acme, beta], ["env:a", "env:c"])).toEqual([
      { ...acme, threadKeys: ["env:b"] },
      { ...beta, threadKeys: [] },
    ]);
  });
});

describe("sanitizeSessionGroups", () => {
  it("keeps valid groups, empty ones included, and drops malformed and repeated entries", () => {
    expect(
      sanitizeSessionGroups([
        { id: "g1", name: " Acme ", threadKeys: ["env:a", "env:a", 3] },
        { id: "g1", name: "Again", threadKeys: ["env:x"] },
        { id: "g2", name: "", threadKeys: ["env:y"] },
        { id: "g3", name: "Empty", threadKeys: [] },
        { id: "g4", name: "Shares a", threadKeys: ["env:a"] },
        { id: "g5", name: "Repo group", memberKeys: ["env:p"] },
        null,
        "junk",
      ]),
    ).toEqual([
      { id: "g1", name: "Acme", threadKeys: ["env:a"] },
      { id: "g3", name: "Empty", threadKeys: [] },
      { id: "g4", name: "Shares a", threadKeys: [] },
    ]);
    expect(sanitizeSessionGroups({ not: "an array" })).toEqual([]);
  });
});

describe("groupThreadsBySessionGroup", () => {
  it("files threads under their group in input order and leaves the rest ungrouped", () => {
    expect(
      groupThreadsBySessionGroup([acme, beta], ["env:x", "env:b", "env:a", "env:y"], (key) => key),
    ).toEqual({
      groups: [
        { group: acme, threads: ["env:b", "env:a"] },
        { group: beta, threads: [] },
      ],
      ungrouped: ["env:x", "env:y"],
    });
  });
});
