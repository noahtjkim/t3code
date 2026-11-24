import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  nestFoldersInGroups,
  projectGroupOfRefs,
  sanitizeProjectGroups,
  withProjectsInGroup,
  withoutProjects,
  type ProjectGroup,
} from "./projectGroups.logic";

const acme: ProjectGroup = { id: "g1", name: "Acme", memberKeys: ["env:a", "env:b"] };
const beta: ProjectGroup = { id: "g2", name: "Beta", memberKeys: ["env:c"] };

describe("projectGroupOfRefs", () => {
  it("finds the group of any of a folder's projects", () => {
    const env = "env" as EnvironmentId;
    expect(
      projectGroupOfRefs(
        [acme, beta],
        [
          { environmentId: env, projectId: "x" },
          { environmentId: env, projectId: "c" },
        ],
      ),
    ).toBe(beta);
    expect(projectGroupOfRefs([acme, beta], [{ environmentId: env, projectId: "x" }])).toBeNull();
  });
});

describe("withProjectsInGroup", () => {
  it("moves a project out of its old group, dropping the group it empties", () => {
    expect(withProjectsInGroup([acme, beta], "g1", ["env:c"])).toEqual([
      { ...acme, memberKeys: ["env:a", "env:b", "env:c"] },
    ]);
  });

  it("does not duplicate members already in the group", () => {
    expect(withProjectsInGroup([acme], "g1", ["env:a", "env:a"])).toEqual([acme]);
  });

  it("changes nothing for an unknown group", () => {
    expect(withProjectsInGroup([acme, beta], "missing", ["env:c"])).toEqual([acme, beta]);
  });
});

describe("withoutProjects", () => {
  it("removes members and drops groups left empty", () => {
    expect(withoutProjects([acme, beta], ["env:a", "env:c"])).toEqual([
      { ...acme, memberKeys: ["env:b"] },
    ]);
  });
});

describe("sanitizeProjectGroups", () => {
  it("keeps valid groups and drops malformed, empty and repeated entries", () => {
    expect(
      sanitizeProjectGroups([
        { id: "g1", name: " Acme ", memberKeys: ["env:a", "env:a", 3] },
        { id: "g1", name: "Again", memberKeys: ["env:x"] },
        { id: "g2", name: "", memberKeys: ["env:y"] },
        { id: "g3", name: "Empty", memberKeys: [] },
        { id: "g4", name: "Shares a", memberKeys: ["env:a"] },
        null,
        "junk",
      ]),
    ).toEqual([{ id: "g1", name: "Acme", memberKeys: ["env:a"] }]);
    expect(sanitizeProjectGroups({ not: "an array" })).toEqual([]);
  });
});

describe("nestFoldersInGroups", () => {
  it("places a group at its first folder's slot and keeps members in order", () => {
    const groupOf = (folder: string) =>
      folder.startsWith("a") ? acme : folder.startsWith("c") ? beta : null;
    expect(nestFoldersInGroups(["x", "a1", "y", "a2", "c1"], groupOf)).toEqual([
      { kind: "folder", folder: "x" },
      { kind: "group", group: acme, folders: ["a1", "a2"] },
      { kind: "folder", folder: "y" },
      { kind: "group", group: beta, folders: ["c1"] },
    ]);
  });
});
