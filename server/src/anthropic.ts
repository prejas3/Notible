import Anthropic from "@anthropic-ai/sdk";
import type { Emit, Env, TurnMessage, TurnRequest } from "./types";

const DEFAULT_MODEL = "claude-opus-4-8";

function toAnthropicMessages(messages: TurnMessage[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === "tool") {
      return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.tool_use_id, content: m.content, is_error: m.is_error }],
      };
    }
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    const content = m.content.map((b) =>
      b.type === "text"
        ? { type: "text" as const, text: b.text }
        : { type: "tool_use" as const, id: b.id, name: b.name, input: b.input as Record<string, unknown> },
    );
    return { role: m.role, content };
  });
}

export async function runClaude(req: TurnRequest, env: Env, emit: Emit): Promise<void> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const stream = client.messages.stream({
    model: req.model || DEFAULT_MODEL,
    max_tokens: 32000,
    thinking: { type: "enabled", budget_tokens: 4096 }, // forward text + tool_use only
    system: req.system,
    messages: toAnthropicMessages(req.messages),
    tools: req.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema })),
  });

  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      await emit("text", { delta: ev.delta.text });
    }
  }

  const final = await stream.finalMessage();
  for (const block of final.content) {
    if (block.type === "tool_use") {
      await emit("tool_use", { id: block.id, name: block.name, input: block.input });
    }
  }
  await emit("done", { stop_reason: final.stop_reason, usage: final.usage });
}
