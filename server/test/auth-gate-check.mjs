// Runnable check for the /v1/agent/turn and /v1/auth/register gates.
// No HTTP, no provider calls — just the pure decision functions.
// node --experimental-strip-types server/test/auth-gate-check.mjs
import assert from "node:assert/strict";
import { agentTurnAllowed, registrationAllowed } from "../src/auth-gate.ts";

// --- /v1/agent/turn --------------------------------------------------------
const noOptIn = {};
const optIn = { NOTIBLE_AI_ALLOW_SESSIONS: "1" };

// unauthenticated: always denied
assert.equal(agentTurnAllowed({ hasSession: false, hasLegacySecret: false }, noOptIn), false, "unauthenticated denied");
assert.equal(agentTurnAllowed({ hasSession: false, hasLegacySecret: false }, optIn), false, "opt-in does not admit the unauthenticated");

// ordinary account session: denied by default, allowed only on explicit opt-in
assert.equal(agentTurnAllowed({ hasSession: true, hasLegacySecret: false }, noOptIn), false, "session denied by default");
assert.equal(agentTurnAllowed({ hasSession: true, hasLegacySecret: false }, { NOTIBLE_AI_ALLOW_SESSIONS: "true" }), false, "only the exact string \"1\" opts in");
assert.equal(agentTurnAllowed({ hasSession: true, hasLegacySecret: false }, optIn), true, "session allowed after opt-in");

// legacy shared secret: always allowed, opt-in irrelevant
assert.equal(agentTurnAllowed({ hasSession: false, hasLegacySecret: true }, noOptIn), true, "legacy shared secret allowed");
assert.equal(agentTurnAllowed({ hasSession: true, hasLegacySecret: true }, noOptIn), true, "legacy secret allowed even with a session");

// --- /v1/auth/register ---------------------------------------------------
assert.equal(registrationAllowed({}), true, "registration open by default");
assert.equal(registrationAllowed({ NOTIBLE_DISABLE_REGISTRATION: "0" }), true, "\"0\" keeps registration open");
assert.equal(registrationAllowed({ NOTIBLE_DISABLE_REGISTRATION: "1" }), false, "\"1\" closes registration");

console.log("server auth-gate check: OK");
