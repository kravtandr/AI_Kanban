import { expect, it } from "vitest";
import { toolExample } from "./mcpCatalog";

it("составляет допустимый пример для переноса траты", () => {
  const tool = {
    name: "move_expense",
    inputSchema: {
      required: ["expense_id", "status"],
      properties: {
        expense_id: { type: "integer" },
        status: { type: "string" },
      },
    },
  };
  const example = JSON.parse(toolExample(tool));
  expect(["wanted", "bought", "recurring"]).toContain(
    example.params.arguments.status,
  );
});

it("раскрывает вложенную схему и формирует поступления бюджета", () => {
  const tool = {
    name: "save_budget",
    inputSchema: {
      required: ["month", "salary", "freelance"],
      properties: {
        month: { type: "string" },
        salary: { type: "integer" },
        freelance: { type: "array", items: { $ref: "#/$defs/Receipt" } },
      },
      $defs: {
        Receipt: {
          properties: {
            title: { type: "string" },
            amount: { type: "integer" },
          },
        },
      },
    },
  };
  const args = JSON.parse(toolExample(tool)).params.arguments;
  expect(args.freelance[0]).toEqual({ title: "Новая задача", amount: 250000 });
  expect(args.salary).toBe(10000000);
});
