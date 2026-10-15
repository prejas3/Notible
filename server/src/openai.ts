import OpenAI from "openai";
import type { Emit, Env, TurnMessage, TurnRequest } from "./types";

function toOpenAIMessages(system: string | undefined, messages: TurnMessage[]) {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.tool_use_id, content: m.content });
      continue;
    }
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const toolCalls = m.content
      .filter((b) => b.type === "tool_use")
      .map((b) => {
        const t = b as { id: string; name: string; input: unknown };
        return { id: t.id, type: "function" as const, function: { name: t.name, arguments: JSON.stringify(t.input) } };
      });
    if (m.role === "assistant" && toolCalls.length) {
      out.push({ role: "assistant", content: text || null, tool_calls: toolCalls });
    } else {
      out.push({ role: m.role, content: text });
    }
  }
  return out;
}

export async function runOpenAI(req: TurnRequest, env: Env, emit: Emit): Promise<void> {
  const model = req.model || env.OPENAI_MODEL;
  if (!model) {
    await emit("error", { message: "No OpenAI model configured. Set OPENAI_MODEL or pass `model`." });
    return;
  }
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const stream = await client.chat.completions.create({
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages: toOpenAIMessages(req.system, req.messages),
    tools: req.tools?.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })),
  });

  // Accumulate streamed tool calls by index; ids/names/args arrive in fragments.
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let stopReason: string | null = null;
  let usage: unknown = null;

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (choice?.delta?.content) await emit("text", { delta: choice.delta.content });
    for (const tc of choice?.delta?.tool_calls ?? []) {
      const cur = calls.get(tc.index) ?? { id: "", name: "", args: "" };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name = tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      calls.set(tc.index, cur);
    }
    if (choice?.finish_reason) stopReason = choice.finish_reason;
    if (chunk.usage) usage = chunk.usage;
  }

  for (const c of calls.values()) {
    let input: unknown = {};
    try { input = c.args ? JSON.parse(c.args) : {}; } catch { input = { _raw: c.args }; }
    await emit("tool_use", { id: c.id, name: c.name, input });
  }
  await emit("done", { stop_reason: stopReason, usage });
}
