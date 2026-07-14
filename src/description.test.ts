import { expect, test, describe } from "bun:test";
import { descriptionBodyFromMarkdown } from "./description.ts";

describe("descriptionBodyFromMarkdown", () => {
  test("strips the packaged header (title + metadata bullets)", () => {
    const md = [
      "# 1. Two Sum",
      "",
      "- **Difficulty:** Easy",
      "- **URL:** https://leetcode.com/problems/two-sum/",
      "- **Lists:** citadel, meta",
      "",
      "Given an array of integers nums…",
      "",
      "Example 1:",
    ].join("\n");
    expect(descriptionBodyFromMarkdown(md)).toBe(
      "Given an array of integers nums…\n\nExample 1:",
    );
  });

  test("works without a Lists bullet", () => {
    const md = [
      "# 42. Trapping Rain Water",
      "",
      "- **Difficulty:** Hard",
      "- **URL:** https://leetcode.com/problems/trapping-rain-water/",
      "",
      "Given n non-negative integers…",
    ].join("\n");
    expect(descriptionBodyFromMarkdown(md)).toBe("Given n non-negative integers…");
  });

  test("unrecognised shape is returned untouched (never loses content)", () => {
    const plain = "just some text\nwith no header";
    expect(descriptionBodyFromMarkdown(plain)).toBe(plain);
  });

  test("a heading with no metadata block keeps the body", () => {
    const md = "# 5. Something\n\nThe statement body.";
    expect(descriptionBodyFromMarkdown(md)).toBe("The statement body.");
  });
});
