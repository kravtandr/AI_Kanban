import { describe, expect, it } from "vitest";
import { formatDue, isOverdue } from "./dates";

describe("isOverdue", () => {
  const today = new Date(2026, 6, 22, 12, 0, 0); // 2026-07-22

  it("false without due date", () => {
    expect(isOverdue(null, "todo", today)).toBe(false);
  });

  it("false for done tasks even when past due", () => {
    expect(isOverdue("2026-07-01", "done", today)).toBe(false);
  });

  it("true when the date has passed", () => {
    expect(isOverdue("2026-07-21", "todo", today)).toBe(true);
  });

  it("false on the due day itself", () => {
    expect(isOverdue("2026-07-22", "todo", today)).toBe(false);
  });

  it("false for future dates", () => {
    expect(isOverdue("2026-08-01", "in_progress", today)).toBe(false);
  });
});

describe("formatDue", () => {
  it("empty for null", () => {
    expect(formatDue(null)).toBe("");
  });

  it("renders day and month", () => {
    expect(formatDue("2026-07-25")).toContain("25");
  });
});
