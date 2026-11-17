import type { JsonSchema, McpTool } from "../types";

export const MCP_GROUPS = [
  "Все инструменты",
  "Задачи",
  "Проекты",
  "Траты",
  "Бюджет",
  "Аналитика",
  "AI и голос",
  "Другие",
] as const;
export type McpGroup = (typeof MCP_GROUPS)[number];

interface ToolInfo {
  title: string;
  group: McpGroup;
  description: string;
  effect: "Чтение" | "Изменение" | "Удаление" | "AI";
}

const TOOL_INFO: Record<string, ToolInfo> = {
  list_tasks: {
    title: "Список задач",
    group: "Задачи",
    effect: "Чтение",
    description:
      "Поиск по тексту, проектам, статусу, приоритету и тегам. Включите all_done для всей истории завершённых задач. limit=null возвращает все совпадения.",
  },
  get_task: {
    title: "Получить задачу",
    group: "Задачи",
    effect: "Чтение",
    description:
      "Все поля задачи, включая оценку трудозатрат, порядок на доске и даты.",
  },
  create_task: {
    title: "Создать задачу",
    group: "Задачи",
    effect: "Изменение",
    description:
      "Запишите задачу с проектом, статусом, дедлайном и оценкой. Если проект пропущен или включён auto_format, AI оформит текст и предложит проект.",
  },
  update_task: {
    title: "Изменить задачу",
    group: "Задачи",
    effect: "Изменение",
    description:
      "Обновите поля, статус и проект. Пустая строка due_date снимает дедлайн, clear_estimate снимает оценку.",
  },
  move_task: {
    title: "Переместить задачу",
    group: "Задачи",
    effect: "Изменение",
    description:
      "Смените колонку и позицию на канбан-доске. sort_order — позиция с единицы. Остальные задачи в колонке сдвигаются автоматически.",
  },
  complete_task: {
    title: "Завершить задачу",
    group: "Задачи",
    effect: "Изменение",
    description:
      "Отметьте задачу выполненной. Дата завершения и учёт времени обновляются сервером.",
  },
  delete_task: {
    title: "Удалить задачу",
    group: "Задачи",
    effect: "Удаление",
    description:
      "Задача исчезнет с доски. Окончательная очистка выполняется через 30 дней.",
  },
  list_projects: {
    title: "Список проектов",
    group: "Проекты",
    effect: "Чтение",
    description:
      "Проекты, цвета, описания и число активных задач. include_archived добавляет архивные проекты.",
  },
  create_project: {
    title: "Создать проект",
    group: "Проекты",
    effect: "Изменение",
    description:
      "Задайте название, описание и цвет. Сервер подбирает свободный цвет из палитры.",
  },
  update_project: {
    title: "Изменить проект",
    group: "Проекты",
    effect: "Изменение",
    description:
      "Переименуйте проект, измените цвет и описание, отправьте в архив или верните из него.",
  },
  delete_project: {
    title: "Удалить проект",
    group: "Проекты",
    effect: "Удаление",
    description:
      "Удаление окончательное. Для проекта с задачами требуется force=true, при этом удаляются его задачи и история измерений. Inbox защищён от удаления.",
  },
  list_expenses: {
    title: "Список трат",
    group: "Траты",
    effect: "Чтение",
    description:
      "Регулярные платежи, желания и покупки. Фильтруйте по тексту, тегам и статусу, включайте приостановленные подписки.",
  },
  get_expense: {
    title: "Получить трату",
    group: "Траты",
    effect: "Чтение",
    description:
      "Цена, расписание, дата покупки, теги и ближайшее списание одной траты.",
  },
  create_expense: {
    title: "Создать трату",
    group: "Траты",
    effect: "Изменение",
    description:
      "Добавьте подписку, желание или покупку. amount_rub задаётся в рублях. Для подписки нужны period и anchor_date, при покупке можно задать purchased_at.",
  },
  update_expense: {
    title: "Изменить трату",
    group: "Траты",
    effect: "Изменение",
    description:
      "Измените сумму, теги и расписание, приостановите подписку через active=false. clear_period снимает период и дату списания при смене типа.",
  },
  move_expense: {
    title: "Переместить трату",
    group: "Траты",
    effect: "Изменение",
    description:
      "Перенос между желаниями и покупками, сортировка внутри колонки. Регулярные траты сортируются в своей колонке.",
  },
  delete_expense: {
    title: "Удалить трату",
    group: "Траты",
    effect: "Удаление",
    description:
      "Трата исчезнет из списков, календаря и сводок. Окончательная очистка выполняется через 30 дней.",
  },
  expenses_summary: {
    title: "Сводка трат",
    group: "Траты",
    effect: "Чтение",
    description:
      "Среднемесячные регулярные расходы, ближайшие списания, сумма желаний и покупки текущего месяца. Суммы в копейках.",
  },
  expense_plan: {
    title: "Календарь и структура трат",
    group: "Траты",
    effect: "Чтение",
    description:
      "План списаний за выбранный месяц и среднемесячная структура по тратам и тегам. Поиск и тег фильтруют обе части плана. Это прогноз по текущим расписаниям. Суммы в копейках, доли могут быть дробными.",
  },
  get_budget: {
    title: "Получить бюджет",
    group: "Бюджет",
    effect: "Чтение",
    description:
      "Зарплата, поступления фриланса, общий доход и пять целей за выбранный месяц. Суммы в копейках. Для нового месяца вернутся нули.",
  },
  save_budget: {
    title: "Сохранить бюджет",
    group: "Бюджет",
    effect: "Изменение",
    description:
      "Замените зарплату и список поступлений за месяц. Все суммы в целых копейках. Повторный вызов сохраняет тот же месяц. Поступления, пропущенные в списке, удаляются.",
  },
  analytics: {
    title: "Статистика времени",
    group: "Аналитика",
    effect: "Чтение",
    description:
      "Фактическое время, калибровка оценок, статистика проектов, застрявшие и работающие задачи. days ограничивает окно ретроспективы.",
  },
  daily_summary: {
    title: "Сводка дня",
    group: "Аналитика",
    effect: "Чтение",
    description:
      "Завершённые за день задачи, работающие и просроченные. Дата по умолчанию — сегодня в часовом поясе сервиса.",
  },
  draft_task: {
    title: "AI-черновик задачи",
    group: "AI и голос",
    effect: "AI",
    description:
      "Оформите текст в черновик задачи. Задача сохраняется отдельным вызовом. Предложенный AI проект может быть создан, как при вводе в портале.",
  },
  draft_expense: {
    title: "AI-черновик траты",
    group: "AI и голос",
    effect: "AI",
    description:
      "Превратите текст в параметры подписки или желания. Результат содержит цену в копейках и признак успешности AI.",
  },
  enhance_task: {
    title: "Улучшить задачу с AI",
    group: "AI и голос",
    effect: "AI",
    description:
      "Получите улучшенный текст и чек-лист существующей задачи. Результат применяется отдельным вызовом update_task.",
  },
  agent_prompt: {
    title: "Промпт для агента",
    group: "AI и голос",
    effect: "AI",
    description: "Сгенерируйте готовое задание для AI-агента на основе задачи.",
  },
  insights: {
    title: "AI-разбор статистики",
    group: "AI и голос",
    effect: "AI",
    description:
      "Запросите комментарий модели к фактической статистике времени. При недоступности AI числовые данные остаются в ответе.",
  },
  transcribe_audio: {
    title: "Распознать речь",
    group: "AI и голос",
    effect: "AI",
    description:
      "Передайте аудио в base64 и получите текст через настроенный Whisper. Действует лимит размера записи из конфигурации сервиса.",
  },
};

export function toolInfo(tool: McpTool): ToolInfo {
  return (
    TOOL_INFO[tool.name] ?? {
      title: tool.name,
      group: "Другие",
      description: tool.description ?? "",
      effect: "Изменение",
    }
  );
}

export function schemaType(schema: JsonSchema): string {
  if (schema.anyOf) return schema.anyOf.map(schemaType).join(" | ");
  if (schema.$ref) return schema.$ref.split("/").at(-1) ?? "object";
  if (schema.type === "array") return `${schemaType(schema.items ?? {})}[]`;
  return schema.type ?? "object";
}

function exampleValue(
  schema: JsonSchema,
  definitions: Record<string, JsonSchema>,
  name: string,
): unknown {
  if (schema.$ref)
    return exampleValue(
      definitions[schema.$ref.split("/").at(-1) ?? ""] ?? {},
      definitions,
      name,
    );
  if (schema.anyOf)
    return exampleValue(
      schema.anyOf.find((choice) => choice.type !== "null") ?? {},
      definitions,
      name,
    );
  if (schema.enum?.length) return schema.enum[0];
  if (schema.default !== undefined && schema.default !== null)
    return schema.default;
  if (name === "month") return "2026-11";
  if (name === "salary") return 10000000;
  if (name === "amount") return 250000;
  if (name === "amount_rub") return 2500;
  if (name === "status") return "todo";
  if (schema.type === "array")
    return schema.items ? [exampleValue(schema.items, definitions, name)] : [];
  if (schema.type === "integer" || schema.type === "number") return 1;
  if (schema.type === "boolean") return false;
  if (schema.type === "object" || schema.properties) {
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [
        key,
        exampleValue(value, definitions, key),
      ]),
    );
  }
  return (
    (
      {
        title: "Новая задача",
        name: "Мой проект",
        text: "Подготовить план на неделю",
        audio_base64: "YQ==",
      } as Record<string, string>
    )[name] ?? "Пример"
  );
}

export function toolExample(tool: McpTool): string {
  const schema = tool.inputSchema;
  const args = Object.fromEntries(
    (schema.required ?? []).map((name) => [
      name,
      exampleValue(schema.properties?.[name] ?? {}, schema.$defs ?? {}, name),
    ]),
  );
  if (tool.name === "move_expense") args.status = "bought";
  return JSON.stringify(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool.name, arguments: args },
    },
    null,
    2,
  );
}

export const PARAMETER_HINTS: Record<string, string> = {
  task_id: "ID задачи",
  expense_id: "ID траты",
  project_id: "ID проекта",
  project_ids: "Фильтр по нескольким проектам",
  project: "Название проекта",
  title: "Заголовок",
  name: "Название",
  description: "Описание, Markdown",
  query: "Поиск по тексту",
  status: "Статус",
  priority: "Приоритет",
  tag: "Фильтр по тегу",
  tags: "Список тегов",
  limit: "Максимум результатов, null — все",
  all_done: "Вся история завершённых задач",
  sort_order: "Позиция в колонке",
  due_date: "Дедлайн YYYY-MM-DD, пустая строка снимает его",
  estimate: "XS, S, M, L или XL",
  clear_estimate: "Снять оценку",
  auto_format: "Оформить задачу с AI",
  include_archived: "Добавить архивные проекты",
  archived: "Архивировать или восстановить проект",
  color: "Цвет #RRGGBB",
  force: "Удалить проект вместе с задачами",
  amount_rub: "Цена в рублях",
  period: "day, month, quarter или year",
  anchor_date: "Дата одного списания YYYY-MM-DD",
  purchased_at: "Дата покупки YYYY-MM-DD",
  active: "Активность подписки",
  include_inactive: "Добавить приостановленные подписки",
  clear_period: "Снять период и дату списания",
  note: "Заметка, Markdown",
  month: "Месяц YYYY-MM",
  salary: "Зарплата в целых копейках",
  freelance: "Поступления — title и amount в копейках",
  date: "Дата YYYY-MM-DD",
  days: "Окно аналитики в днях, от 1 до 3650",
  text: "Исходный текст, до 4000 символов",
  audio_base64: "Аудио в base64",
  filename: "Имя аудиофайла с расширением",
  content_type: "MIME-тип аудио",
};
