const { create, verify, doc } = require("../lib.cjs");
const code = (language, value) => ({ type: "codeBlock", attrs: { language }, content: [{ type: "text", text: value }] });
module.exports = { name: "code-mermaid-compare", async run(ctx) {
  const blocks = [
    code("sql", "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL);\nCREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), total NUMERIC NOT NULL);\nSELECT c.name, SUM(o.total) AS spent FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.id, c.name ORDER BY spent DESC;"),
    code("python", "class Invoice:\n    def __init__(self, total: float) -> None:\n        self.total = total\n\ndef with_tax(invoice: Invoice, rate: float = 0.23) -> float:\n    return round(invoice.total * (1 + rate), 2)"),
    code("json", '{"valid":true,"items":[1,2,3]}'),
    code("json", '{\n  "workspace": {\n    "name": "Demo",\n    "features": ["notes", "tasks"]\n  }\n}'),
    code("javascript", "export const total = (items) => items.reduce((sum, item) => sum + item.price, 0);"),
    code("typescript", "type Task = { title: string; done: boolean };\nexport function open(tasks: Task[]): Task[] { return tasks.filter((task) => !task.done); }"),
    code("bash", "set -euo pipefail\nprintf '%s\\n' \"demo ready\"\nfind . -maxdepth 1 -type f -print"),
    code("powershell", "$ErrorActionPreference = 'Stop'\nGet-ChildItem -File | Sort-Object Name | Select-Object Name, Length"),
    code("text", "zeta  \n\tindented\nalpha\nduplicate\nduplicate\nBeta"),
    code("mermaid", "flowchart LR\n  Capture --> Organize --> Review"),
    code("mermaid", "sequenceDiagram\n  User->>Notible: Create note\n  Notible-->>Plugin: object.created"),
    code("mermaid", "gantt\n  title Demo release\n  dateFormat YYYY-MM-DD\n  Build :done, 2026-10-01, 3d\n  Test :active, 2026-10-04, 5d"),
    // compare = earlier snippet, a line of only =====, newer snippet (editor-extensions.ts help text).
    code("compare", "def total(items):\n    return sum(items)\n=====\ndef total(items, tax=0.23):\n    return round(sum(items) * (1 + tax), 2)"),
  ];
  const note = await create(ctx, { type: "note", title: "Demo · code, Mermaid and compare", content: doc(...blocks), props: { tags: ["demo", "code"] } });
  await verify(ctx, [note.id]);
} };
