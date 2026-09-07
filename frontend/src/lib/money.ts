/** Суммы в API — целые копейки (ADR-0009). Рубли живут только в форме. */

export function parseRub(raw: string): number | null {
  const cleaned = raw.replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

const NBSP = "\u00A0";

export function formatRub(kopecks: number): string {
  const rub = Math.trunc(kopecks / 100);
  const kop = Math.abs(kopecks % 100);
  // toLocaleString в разных версиях ICU отдаёт для разделителя тысяч то
  // U+00A0, то U+202F — приводим оба варианта (и обычный пробел) к единому
  // NBSP, чтобы сумма не переносилась в карточке независимо от рантайма.
  const whole = rub.toLocaleString("ru-RU").replace(/[\s\u00A0\u202F]/g, NBSP);
  return kop === 0 ? `${whole}${NBSP}₽` : `${whole},${String(kop).padStart(2, "0")}${NBSP}₽`;
}

export function kopecksToInput(kopecks: number): string {
  const rub = Math.trunc(kopecks / 100);
  const kop = kopecks % 100;
  return kop === 0 ? String(rub) : `${rub}.${String(kop).padStart(2, "0")}`;
}
