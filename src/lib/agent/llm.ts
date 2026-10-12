import "server-only";

// Any OpenAI-compatible chat endpoint: Ollama, vLLM, LM Studio, llama.cpp server,
// OpenRouter, Together, Groq… so the helpers can run on open-source models.

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_BASE_URL && process.env.AI_MODEL);
}

export async function chat(messages: ChatMessage[], tools: ToolSpec[], signal: AbortSignal): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  const base = process.env.AI_BASE_URL!.replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(process.env.AI_API_KEY ? { Authorization: `Bearer ${process.env.AI_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL,
      messages,
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
      temperature: 0.3,
      max_tokens: 1500,
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`model request failed (${res.status}) ${detail}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content: string | null; tool_calls?: ToolCall[] } }[] };
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error("model returned no message");
  return message;
}
