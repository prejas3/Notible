import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { devInvoke, isDevMockActive } from "./dev-mock-invoke.ts";

/** Same invoke switch Core's data adapter uses — dev host vs. real Tauri. */
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return isDevMockActive() ? devInvoke<T>(cmd, args ?? {}) : tauriInvoke<T>(cmd, args);
}

export type CalendarProvider = "google" | "outlook";

export interface CalendarSource {
  id: string;
  name: string;
  primary?: boolean;
  color?: string;
}

export interface ExternalCalendarEvent {
  id: string;
  provider: CalendarProvider;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
}

export interface CalendarConnectionStatus {
  provider: CalendarProvider;
  configured: boolean;
  connected: boolean;
}

/**
 * Core-internal bridge to the Rust calendar-OAuth commands. Not part of the
 * public plugin API: `plugins/builtin/*` may import `src/core/*`, a
 * third-party plugin bundle cannot import `src/` at all, so importing this
 * module IS the "builtin only" gate. Every call is additionally refused by
 * Rust unless the user turned on "Let plugins read your calendars".
 */
export const calendarStatus = (provider: CalendarProvider) =>
  invoke<CalendarConnectionStatus>("calendar_oauth_status", { provider });

export const calendarConnect = (provider: CalendarProvider) =>
  invoke<{ provider: CalendarProvider; connected: boolean }>("calendar_connect", { provider });

export const calendarDisconnect = (provider: CalendarProvider) =>
  invoke<void>("calendar_disconnect", { provider });

export const calendarListSources = (provider: CalendarProvider) =>
  invoke<CalendarSource[]>("calendar_list_sources", { provider });

export const calendarReadRange = (input: {
  provider: CalendarProvider;
  calendarIds: string[];
  from: string;
  to: string;
}) =>
  invoke<ExternalCalendarEvent[]>("calendar_sync_project", {
    provider: input.provider,
    calendarIds: input.calendarIds,
    timeMin: input.from,
    timeMax: input.to,
  });

export const calendarSharingStatus = () => invoke<boolean>("calendar_sharing_status");

export const setCalendarSharing = (allowed: boolean) =>
  invoke<boolean>("set_calendar_sharing", { allowed });
