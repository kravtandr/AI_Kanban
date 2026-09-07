import { describe, expect, it } from "vitest";
import { formatRub, kopecksToInput, parseRub } from "./money";

describe("parseRub", () => {
  it("разбирает целые, дробные с точкой и запятой, пробелы", () => {
    expect(parseRub("899")).toBe(89900);
    expect(parseRub("12.5")).toBe(1250);
    expect(parseRub("1 234,50")).toBe(123450);
    expect(parseRub(" 0 ")).toBe(0);
  });
  it("мусор и отрицательные — null", () => {
    expect(parseRub("")).toBeNull();
    expect(parseRub("abc")).toBeNull();
    expect(parseRub("-5")).toBeNull();
    expect(parseRub("1.2.3")).toBeNull();
  });
});

describe("formatRub", () => {
  // Ожидания сравниваются с неразрывным пробелом U+00A0 (ruling задачи), а
  // не обычным: только так сумма не переносится от «₽» в карточке. Пишем
  // явный escape, а не вставляем невидимый символ в файл.
  it("копейки → рубли без хвоста .00, с копейками когда есть", () => {
    expect(formatRub(89900)).toBe("899\u00A0₽");
    expect(formatRub(123450)).toBe("1\u00A0234,50\u00A0₽");
    expect(formatRub(0)).toBe("0\u00A0₽");
  });
});

describe("kopecksToInput", () => {
  it("целая сумма — без дробной части", () => {
    expect(kopecksToInput(89900)).toBe("899");
    expect(kopecksToInput(0)).toBe("0");
  });
  it("копейки — дробная часть через точку, без разделителя тысяч", () => {
    expect(kopecksToInput(123450)).toBe("1234.50");
  });
});
