import type { QueryClient } from "@tanstack/react-query";

/** Инвалидирует все три запроса доски разом: tasks, projects, analytics.
 *
 * Единая точка вызова для КАЖДОЙ мутации, способной изменить статус или
 * проект задачи (создание, patch, move, удаление). До этой функции
 * analytics инвалидировали только staleTime (30с) на BoardPage, и ни одна
 * мутация её не трогала — драг в In Progress не поднимал живой таймер, а
 * драг работающей карточки в Done оставлял её тикать в чужой колонке, пока
 * вкладка остаётся в фокусе (FR-4.7, §12.1). staleTime помечает данные
 * несвежими, но сам по себе не запускает refetch.
 */
export function invalidateBoard(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ["tasks"] });
  queryClient.invalidateQueries({ queryKey: ["projects"] });
  queryClient.invalidateQueries({ queryKey: ["analytics"] });
}
