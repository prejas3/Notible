import Database from "../mcp-server/node_modules/better-sqlite3/lib/index.js";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

const dbPath = process.argv[2] || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "com.notible.app", "notible.db");
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const now = Date.now();
const project = db.prepare("SELECT * FROM objects WHERE type = 'project' AND title = ? ORDER BY updated_at DESC LIMIT 1").get("Premiera Atlas 2026");
if (!project) throw new Error("Najpierw utwórz projekt „Premiera Atlas 2026” w Notible.");

function doc(...blocks) {
  return JSON.stringify({ type: "doc", content: blocks });
}
const paragraph = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const heading = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const bulletList = (...items) => ({ type: "bulletList", content: items.map((text) => ({ type: "listItem", content: [paragraph(text)] })) });
const taskList = (...items) => ({ type: "taskList", content: items.map(([text, checked]) => ({ type: "taskItem", attrs: { checked }, content: [paragraph(text)] })) });

const findObject = db.prepare("SELECT * FROM objects WHERE type = ? AND title = ? LIMIT 1");
const insertObject = db.prepare(`INSERT INTO objects
  (id, type, title, content, props, created_at, updated_at, archived_at, trashed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`);
const updateObject = db.prepare("UPDATE objects SET content = ?, props = ?, updated_at = ? WHERE id = ?");
const insertRelation = db.prepare("INSERT OR IGNORE INTO relations (from_id, to_id, kind) VALUES (?, ?, ?)");

function upsert(type, title, props = {}, content = "{}", parentId = project.id) {
  const existing = findObject.get(type, title);
  const id = existing?.id || randomUUID();
  if (existing) updateObject.run(content, JSON.stringify(props), now, id);
  else insertObject.run(id, type, title, content, JSON.stringify(props), now, now);
  if (parentId) insertRelation.run(id, parentId, "in");
  return id;
}

const seed = db.transaction(() => {
  const projectProps = {
    ...JSON.parse(project.props || "{}"),
    summary: "Lokalna premiera produktu Atlas: od decyzji i planu po realizację, budżet oraz podsumowanie wydania.",
    status: "active",
    priority: "high",
    health: "on-track",
    startDate: "2026-07-01",
    targetDate: "2026-09-30",
    owner: "Marta Zielińska",
    lead: "Jan Kowalski",
    team: "Produkt · Design · Marketing",
    updateCadence: "weekly",
    baseCurrency: "PLN",
    plannedBudget: 120000,
    approvedBudget: 105000,
    openingCash: 160000,
    budgetAlertThreshold: 80,
    financeVisibility: "private",
    _projectUpdates: [
      { id: randomUUID(), ts: Date.now() - 86400000, health: "on-track", note: "Prototyp strony przeszedł testy. W tym tygodniu zamykamy materiały kampanii i uruchamiamy test płatności.", scope: 7, completed: 2, estimate: 49, actual: 21 },
      { id: randomUUID(), ts: Date.now() - 8 * 86400000, health: "at-risk", note: "Dostawa zdjęć produktowych przesunęła się o trzy dni. Zmieniliśmy kolejność prac, aby nie blokować implementacji.", scope: 6, completed: 1, estimate: 42, actual: 12 },
    ],
  };
  updateObject.run(project.content || "{}", JSON.stringify(projectProps), now, project.id);

  const briefId = upsert("note", "Brief projektu — Premiera Atlas 2026", { tags: ["atlas", "strategia", "demo"] }, doc(
    heading(1, "Premiera Atlas 2026"),
    paragraph("Celem jest przygotowanie i przeprowadzenie lokalnej premiery nowego produktu Atlas z kompletną stroną, kampanią i obsługą sprzedaży."),
    heading(2, "Rezultat"),
    bulletList("Gotowa strona premierowa z analityką", "Spójny pakiet materiałów kampanii", "Proces obsługi zamówień i zgłoszeń", "Raport z pierwszych 14 dni sprzedaży"),
    heading(2, "Kryteria sukcesu"),
    taskList(["Konwersja strony co najmniej 4%", false], ["Budżet nieprzekroczony", false], ["Brak błędów krytycznych w dniu premiery", false]),
    heading(2, "Zasada pracy"),
    paragraph("Każda decyzja ma właściciela, termin i powiązanie z konkretnym zadaniem albo kamieniem milowym."),
  ));

  const meetingId = upsert("note", "Notatki ze spotkania — Kick-off Atlas", { tags: ["atlas", "spotkanie"] }, doc(
    heading(1, "Kick-off projektu"),
    paragraph("Uczestnicy: Marta, Jan, Ola, Michał"),
    heading(2, "Decyzje"),
    bulletList("Premiera: 30 września", "Najpierw rynek polski", "Jedna główna wersja strony, bez wariantów regionalnych", "Cotygodniowy update w każdy piątek"),
    heading(2, "Dalsze kroki"),
    taskList(["Jan: zamknąć architekturę strony", true], ["Ola: przygotować moodboard", true], ["Michał: potwierdzić plan mediów", false]),
  ));

  const decisionId = upsert("note", "Decyzja 001 — jedna strona premierowa", { tags: ["atlas", "decyzja"] }, doc(
    heading(1, "Decyzja 001"),
    heading(2, "Kontekst"), paragraph("Rozważaliśmy osobne strony dla trzech segmentów odbiorców."),
    heading(2, "Decyzja"), paragraph("Uruchamiamy jedną stronę z modułami treści dopasowanymi do etapu lejka."),
    heading(2, "Dlaczego"), bulletList("Szybsza realizacja", "Prostsza analityka", "Jedno źródło prawdy dla zespołu"),
    heading(2, "Konsekwencje"), paragraph("Personalizację odkładamy do kolejnego cyklu na podstawie danych z premiery."),
  ));

  const milestonePrototype = upsert("milestone", "Prototyp zatwierdzony", { status: "completed", targetDate: "2026-07-24", owner: "Ola Nowak" });
  const milestoneLaunch = upsert("milestone", "Gotowość do premiery", { status: "in-progress", targetDate: "2026-09-24", owner: "Jan Kowalski" });
  const cycleId = upsert("cycle", "Cykl 03 — przygotowanie kampanii", { status: "active", startDate: "2026-07-13", targetDate: "2026-07-26", capacity: 40 });
  const releaseId = upsert("release", "Atlas 1.0", { status: "ready", targetDate: "2026-09-30", version: "1.0.0" });

  const task1 = upsert("task", "Zatwierdzić architekturę strony", { status: "done", priority: "high", due: "2026-07-10", assignee: "Jan Kowalski", estimate: 5, actualEffort: 4, milestoneId: milestonePrototype, cycleId, releaseId, tags: ["atlas", "www"] });
  const task2 = upsert("task", "Przygotować finalny prototyp strony", { status: "done", priority: "urgent", due: "2026-07-17", assignee: "Ola Nowak", estimate: 8, actualEffort: 9, milestoneId: milestonePrototype, cycleId, releaseId, tags: ["atlas", "design"] });
  const task3 = upsert("task", "Zaimplementować stronę premierową", { status: "in-progress", priority: "urgent", startDate: "2026-07-18", due: "2026-08-14", assignee: "Piotr Wiśniewski", estimate: 16, actualEffort: 6, milestoneId: milestoneLaunch, cycleId, releaseId, tags: ["atlas", "www"] });
  const task4 = upsert("task", "Przygotować pakiet materiałów kampanii", { status: "in-progress", priority: "high", startDate: "2026-07-20", due: "2026-08-21", assignee: "Michał Lewandowski", estimate: 10, actualEffort: 2, milestoneId: milestoneLaunch, cycleId, releaseId, tags: ["atlas", "marketing"] });
  const task5 = upsert("task", "Uruchomić test płatności i analityki", { status: "todo", priority: "high", due: "2026-09-04", assignee: "Anna Król", estimate: 6, actualEffort: 0, milestoneId: milestoneLaunch, releaseId, tags: ["atlas", "qa"] });
  const task6 = upsert("task", "Przygotować raport po 14 dniach", { status: "backlog", priority: "medium", due: "2026-10-14", assignee: "Marta Zielińska", estimate: 4, actualEffort: 0, releaseId, tags: ["atlas", "raport"] });
  const triageTask = upsert("task", "Przejrzeć propozycję hasła kampanii", { status: "triage", priority: "medium", reportedDate: "2026-07-17", due: "2026-07-25", reporter: "Michał Lewandowski", tags: ["atlas", "marketing"] });
  const reminderTask = upsert("task", "Potwierdzić zgodę na wykorzystanie zdjęć", { status: "todo", priority: "high", due: "2026-07-17", reminder: "2026-07-17", assignee: "Marta Zielińska", milestoneId: milestoneLaunch, releaseId, tags: ["atlas", "formalności"] });
  const issueId = upsert("issue", "Formularz zamówienia traci kod rabatowy", { status: "blocked", priority: "urgent", severity: "major", due: "2026-08-07", assignee: "Piotr Wiśniewski", reporter: "Anna Król", estimate: 3, actualEffort: 0, milestoneId: milestoneLaunch, releaseId, tags: ["atlas", "bug"] });

  insertRelation.run(task3, task2, "depends_on");
  insertRelation.run(issueId, task3, "blocks");
  insertRelation.run(briefId, decisionId, "related_to");
  insertRelation.run(meetingId, briefId, "related_to");

  upsert("financial_entry", "Badania użytkowników", { kind: "cost", amount: 8500, currency: "PLN", date: "2026-07-08", category: "Research", vendor: "Insight Lab", recurrence: "none", status: "paid", milestoneId: milestonePrototype });
  upsert("financial_entry", "Produkcja zdjęć produktowych", { kind: "cost", amount: 18000, currency: "PLN", date: "2026-07-15", category: "Content", vendor: "Studio Północ", recurrence: "none", status: "approved", milestoneId: milestoneLaunch, attachment: "umowa-studio-polnoc.pdf" });
  upsert("financial_entry", "Budżet mediowy", { kind: "cost", amount: 24000, currency: "PLN", date: "2026-08-15", category: "Marketing", vendor: "Media Craft", recurrence: "none", status: "planned", milestoneId: milestoneLaunch });
  upsert("financial_entry", "Narzędzia analityczne", { kind: "cost", amount: 650, currency: "PLN", date: "2026-07-01", category: "Software", vendor: "Metric Cloud", recurrence: "monthly", status: "approved" });
  upsert("financial_entry", "Przedsprzedaż partnerska", { kind: "income", amount: 32000, currency: "PLN", date: "2026-07-12", category: "Sprzedaż", vendor: "Partner Retail", recurrence: "none", status: "paid" });
  upsert("time_entry", "Warsztat strategiczny", { date: "2026-07-03", person: "Marta Zielińska", hours: 8, billable: true, billableRate: 260, costRate: 150, currency: "PLN", description: "Cele, zakres i ryzyka" });
  upsert("time_entry", "Projekt interfejsu", { date: "2026-07-16", person: "Ola Nowak", hours: 24, billable: true, billableRate: 220, costRate: 125, currency: "PLN", description: "Prototyp strony premierowej" });
  upsert("time_entry", "Implementacja frontendu", { date: "2026-07-17", person: "Piotr Wiśniewski", hours: 18, billable: true, billableRate: 240, costRate: 140, currency: "PLN", description: "Pierwsza wersja strony" });

  return { projectId: project.id, briefId, meetingId, decisionId, task1, task2, task3, task4, task5, task6, triageTask, reminderTask, issueId };
});

const result = seed();
console.log(JSON.stringify({ dbPath, project: project.title, ...result }, null, 2));
db.close();
