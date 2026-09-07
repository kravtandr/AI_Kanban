import type { QueryClient } from "@tanstack/react-query";

/** Единая точка для каждой мутации трат: список и итоги живут раздельно,
 * и итоги меняет любая правка суммы/статуса/активности (§2.6). */
export function invalidateExpenses(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ["expenses"] });
  queryClient.invalidateQueries({ queryKey: ["expenses-summary"] });
}
