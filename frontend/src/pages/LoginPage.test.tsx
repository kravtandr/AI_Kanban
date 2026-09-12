import { expect, it } from "vitest";
import { safeNextPath } from "./LoginPage";

it("rejects external and browser-normalized redirect paths", () => {
  for (const path of ["//evil.test", "/\\evil.test", "https://evil.test", "/\n/evil.test", null]) {
    expect(safeNextPath(path)).toBe("/board");
  }
  expect(safeNextPath("/board?task=42")).toBe("/board?task=42");
});
