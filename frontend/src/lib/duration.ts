/** Длительность человеку: «40м», «1ч 30м», «3д 5ч», «—» когда числа нет.
 *
 * Наименьшая единица — минута: секунды в интерфейсе не нужны, а на живом
 * таймере карточки они дёргались бы на каждом тике. Ни одна ISO-метка сюда
 * не приходит и приходить не может — на входе только секунды (§10.1). */
export function fmtDur(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  // Отрицательная разность возможна только при сбое часов; показываем ноль,
  // а не минус — таймер, идущий назад, читается как поломка.
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 60) return `${minutes}м`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}ч ${rest}м` : `${hours}ч`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}д ${restHours}ч` : `${days}д`;
}
