import { describe, expect, it } from "vitest";
import { fmtDur } from "./duration";

describe("fmtDur", () => {
  it("прочерк вместо числа, когда числа нет", () => {
    expect(fmtDur(null)).toBe("—");
  });

  it("минуты до часа", () => {
    expect(fmtDur(40 * 60)).toBe("40м");
  });

  it("меньше минуты — это ноль минут, а не секунды", () => {
    expect(fmtDur(59)).toBe("0м");
  });

  it("часы с остатком", () => {
    expect(fmtDur(90 * 60)).toBe("1ч 30м");
  });

  it("ровный час без хвоста минут", () => {
    expect(fmtDur(3600)).toBe("1ч");
  });

  it("сутки и больше", () => {
    expect(fmtDur(3 * 86400)).toBe("3д");
  });

  it("сутки с остатком часов", () => {
    expect(fmtDur(3 * 86400 + 5 * 3600)).toBe("3д 5ч");
  });

  it("отрицательное время невозможно показать — часы не идут назад", () => {
    expect(fmtDur(-120)).toBe("0м");
  });

  it("не-число трактуется как отсутствие данных, а не как NaNм", () => {
    expect(fmtDur(Number.NaN)).toBe("—");
  });
});
