import type { Language } from "./theme";

export function calendarLocale(language: Language): string {
  return language === "pl" ? "pl-PL" : "en-US";
}

export function startOfCalendarWeek(value: Date): Date {
  const start = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

export function calendarWeekdayLabels(locale: string): string[] {
  const monday = new Date(Date.UTC(2024, 0, 1));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + index);
    return day.toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" });
  });
}
