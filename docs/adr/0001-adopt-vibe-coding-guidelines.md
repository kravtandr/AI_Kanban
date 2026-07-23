# ADR-0001: Принятие vibe-coding-guidelines как процесса разработки

- **Статус**: accepted
- **Дата**: 2026-07-22

## Контекст

Проект разрабатывается преимущественно AI-агентами; нужен единый проверяемый workflow:
правила агентов, quality gates, ADR, деплой-ранбук.

## Решение

Принят референс [vibe-coding-guidelines](https://github.com/kravtandr/vibe-coding-guidelines).

Provenance:
- **Локатор**: https://github.com/kravtandr/vibe-coding-guidelines
- **Immutable revision**: `2ff8d73878e839a5eafe65369cf8f29fd326a204` (main на дату установки)
- **Версия референса**: v0.1.0
- **Использованные шаблоны**: templates/AGENTS.md, AGENTS-GUIDE.md, DEPLOYMENT.md, templates/adr/0000-template.md
- **Дата установки**: 2026-07-22

Установленные артефакты принадлежат проекту (bootstrap одноразовый, без автосинхронизации).
Агент-целевая поверхность: Claude Code — читает `AGENTS.md` нативно, адаптеры не требуются.

## Альтернативы

Без формального процесса — отклонено: непроверяемые изменения агентов накапливают дефекты.

## Последствия

- Единый `AGENTS.md`, матрица гейтов в нём же; команды продублированы в Makefile/pre-commit/CI.
- ADR обязательны по триггерам из шаблона.
- Деплой только по DEPLOYMENT.md в статусе READY.
- Обновление гайдлайнов — по процедуре Updating Previous Installations (сравнение трёх версий,
  минимальный merge, конфликты не решаются перезаписью).
