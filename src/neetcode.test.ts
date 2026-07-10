import { describe, expect, test } from "bun:test";
import { cppPathsFromTree } from "./neetcode.ts";

describe("cppPathsFromTree", () => {
  test("indexes cpp/<id>-<slug>.cpp blobs by slug", () => {
    const m = cppPathsFromTree([
      { path: "cpp/0252-meeting-rooms.cpp", type: "blob" },
      { path: "cpp/0001-two-sum.cpp", type: "blob" },
    ]);
    expect(m.get("meeting-rooms")).toBe("cpp/0252-meeting-rooms.cpp");
    expect(m.get("two-sum")).toBe("cpp/0001-two-sum.cpp");
  });

  test("ignores non-cpp dirs, non-blobs, and unparetseable names", () => {
    const m = cppPathsFromTree([
      { path: "python/0001-two-sum.py", type: "blob" },
      { path: "cpp", type: "tree" },
      { path: "cpp/README.md", type: "blob" },
      { path: "cpp/0252-meeting-rooms.cpp", type: "tree" }, // wrong type
    ]);
    expect(m.size).toBe(0);
  });

  test("handles multi-hyphen slugs", () => {
    const m = cppPathsFromTree([
      { path: "cpp/0323-number-of-connected-components-in-an-undirected-graph.cpp", type: "blob" },
    ]);
    expect(m.get("number-of-connected-components-in-an-undirected-graph")).toBeDefined();
  });
});
