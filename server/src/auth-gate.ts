// Pure authorisation decisions for the Worker, kept out of the request
// handlers so they can be unit-tested without HTTP or provider calls.
// Exercised by server/test/auth-gate-check.mjs.

/** `POST /v1/auth/register` is open unless the operator turns it off. */
export function registrationAllowed(env: { NOTIBLE_DISABLE_REGISTRATION?: string }): boolean {
  return env.NOTIBLE_DISABLE_REGISTRATION !== "1";
}

export interface AgentTurnAuth {
  /** A valid account session token was presented. */
  hasSession: boolean;
  /** The request carried the shared NOTIBLE_APP_SECRET bearer. */
  hasLegacySecret: boolean;
}

/**
 * Who may call `POST /v1/agent/turn` (the server-key model proxy):
 *  - the shared-secret holder always (the local AI-only workflow);
 *  - an ordinary account session only when the operator opts in with
 *    `NOTIBLE_AI_ALLOW_SESSIONS=1`;
 *  - nobody otherwise (including unauthenticated callers).
 */
export function agentTurnAllowed(
  auth: AgentTurnAuth,
  env: { NOTIBLE_AI_ALLOW_SESSIONS?: string },
): boolean {
  if (auth.hasLegacySecret) return true;
  if (!auth.hasSession) return false;
  return env.NOTIBLE_AI_ALLOW_SESSIONS === "1";
}
