/**
 * The locale for dates, from the app's language (Core mirrors it onto
 * <html lang>), not from Windows: on a Polish Windows the English app showed
 * Polish month names (R4 T9). Same mapping as CalendarMonthView's calLocale.
 */
export function appLocale(): string {
  const lang = typeof document !== "undefined" ? document.documentElement.lang?.toLowerCase() ?? "" : "";
  return lang.startsWith("pl") ? "pl-PL" : "en-GB";
}
