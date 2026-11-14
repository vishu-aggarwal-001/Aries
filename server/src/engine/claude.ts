export interface Usage { input: number; output: number; cacheWrite: number; cacheRead: number }
export interface Reply { content: any[]; stopReason: string; usage: Usage }
export class ClaudeError extends Error { constructor(public status: number, msg: string) { super(msg); } }

/** USD per million tokens [input, output]. Override with env PRICES='{"model":[in,out]}'. */
export const RATES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5],
  ...(process.env.PRICES ? JSON.parse(process.env.PRICES) : {}),
};

let fake: ((body: any) => any) | null = null;
export const setFakeClaude = (f: ((body: any) => any) | null) => { fake = f; };

export async function send(model: string, system: string, messages: any[], tools: any[], maxTokens = 4096): Promise<Reply> {
  const body = {
    model, max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages, ...(tools.length ? { tools } : {}),
  };
  let json: any;
  if (fake) json = await fake(structuredClone(body));
  else {
    const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new ClaudeError(500, "Server has no ANTHROPIC_API_KEY");
    const res = await fetch((process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com") + "/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(240_000),
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try { json = JSON.parse(text); } catch { json = { error: { message: text.slice(0, 300) } }; }
    if (!res.ok) throw new ClaudeError(res.status, `Claude API ${res.status}: ${json?.error?.message ?? ""}`);
  }
  const u = json.usage ?? {};
  return {
    content: json.content ?? [], stopReason: json.stop_reason ?? "",
    usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 },
  };
}

export function cost(model: string, u: Usage) {
  const [i, o] = RATES[model] ?? [3, 15];
  return ((u.input + u.cacheWrite * 1.25 + u.cacheRead * 0.1) * i + u.output * o) / 1e6;
}
