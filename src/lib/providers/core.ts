// ===== Kalpa provider layer (BYOK). Direct browser calls. =====
export type Role = 'system' | 'user' | 'assistant';
export interface ChatMessage { role: Role; content: string }
export type ProviderKind = 'openai' | 'anthropic' | 'gemini';
export interface ProviderConfig {
  kind: ProviderKind;
  baseUrl: string;            // openai: https://api.openai.com/v1 ; anthropic: https://api.anthropic.com ; gemini: https://generativelanguage.googleapis.com
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  temperature?: number;       // omitted when undefined (reasoning models reject it)
  useProxy?: boolean;         // route through /api/proxy for CORS-blocked hosts
}
export interface StreamEvent { delta?: string; usage?: { input?: number; output?: number }; done?: boolean }

/** Build the fetch() request for a provider. Pure function (easy to test). */
export function buildRequest(cfg: ProviderConfig, messages: ChatMessage[]): { url: string; init: RequestInit } {
  const systemText = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const rest = messages.filter(m => m.role !== 'system');
  const base = cfg.baseUrl.replace(/\/+$/, '');
  if (cfg.kind === 'anthropic') {
    return {
      url: `${base}/v1/messages`,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: cfg.model, max_tokens: cfg.maxOutputTokens, stream: true,
          ...(systemText ? { system: systemText } : {}),
          ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
          messages: rest.map(m => ({ role: m.role, content: m.content })),
        }),
      },
    };
  }
  if (cfg.kind === 'gemini') {
    return {
      url: `${base}/v1beta/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
        body: JSON.stringify({
          ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
          contents: rest.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: cfg.maxOutputTokens, ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}) },
        }),
      },
    };
  }
  // OpenAI-compatible (OpenAI, OpenRouter, Groq, DeepSeek, Together, Mistral, xAI, LM Studio, Ollama...)
  const isOpenAI = /api\.openai\.com/.test(base);
  return {
    url: `${base}/chat/completions`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model, stream: true, stream_options: { include_usage: true },
        [isOpenAI ? 'max_completion_tokens' : 'max_tokens']: cfg.maxOutputTokens,
        ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
        messages,
      }),
    },
  };
}

/** Parse one SSE `data:` JSON payload into a StreamEvent. */
export function parseEvent(kind: ProviderKind, json: any): StreamEvent | null {
  if (kind === 'anthropic') {
    if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') return { delta: json.delta.text };
    if (json.type === 'message_start' && json.message?.usage) return { usage: { input: json.message.usage.input_tokens } };
    if (json.type === 'message_delta' && json.usage) return { usage: { output: json.usage.output_tokens } };
    if (json.type === 'message_stop') return { done: true };
    if (json.type === 'error') throw new Error(json.error?.message || 'Anthropic stream error');
    return null;
  }
  if (kind === 'gemini') {
    if (json.error) throw new Error(json.error.message || 'Gemini error');
    const parts = json.candidates?.[0]?.content?.parts as { text?: string; thought?: boolean }[] | undefined;
    const text = parts?.filter(p => p.text && !p.thought).map(p => p.text).join('') ?? '';
    const u = json.usageMetadata;
    if (!text && !u) return null;
    return { ...(text ? { delta: text } : {}), ...(u ? { usage: { input: u.promptTokenCount, output: u.candidatesTokenCount } } : {}) };
  }
  if (json.error) throw new Error(json.error.message || 'Provider error');
  const d = json.choices?.[0]?.delta?.content;
  const u = json.usage;
  if (!d && !u) return null;
  return { ...(d ? { delta: d } : {}), ...(u ? { usage: { input: u.prompt_tokens, output: u.completion_tokens } } : {}) };
}

/** Read an SSE response body and yield each `data:` payload string. Handles chunk splits and CRLF. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader(); const dec = new TextDecoder(); let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
        if (data) yield data;
      }
    }
    const tail = buf.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
    if (tail) yield tail;
  } finally { reader.releaseLock(); }
}

/** Stream a chat completion. Throws Error with a human-readable message on HTTP errors. */
export async function* streamChat(cfg: ProviderConfig, messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const { url, init } = buildRequest(cfg, messages);
  const res = cfg.useProxy
    ? await fetch('/api/proxy', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, method: init.method, headers: init.headers, body: init.body }) })
    : await fetch(url, { ...init, signal });
  if (!res.ok || !res.body) {
    let detail = ''; try { detail = (await res.text()).slice(0, 400); } catch { /* ignore */ }
    throw new Error(`${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`);
  }
  for await (const data of sseData(res.body)) {
    if (data === '[DONE]') { yield { done: true }; return; }
    let json: any; try { json = JSON.parse(data); } catch { continue; }
    const ev = parseEvent(cfg.kind, json);
    if (ev) yield ev;
  }
}

/** Model listing endpoints (for the "Fetch models" button). */
export function modelsRequest(cfg: Pick<ProviderConfig, 'kind' | 'baseUrl' | 'apiKey'>): { url: string; init: RequestInit } {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  if (cfg.kind === 'anthropic') return { url: `${base}/v1/models?limit=100`, init: { headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } } };
  if (cfg.kind === 'gemini') return { url: `${base}/v1beta/models?pageSize=200`, init: { headers: { 'x-goog-api-key': cfg.apiKey } } };
  return { url: `${base}/models`, init: { headers: { authorization: `Bearer ${cfg.apiKey}` } } };
}
export function parseModels(kind: ProviderKind, json: any): { id: string; inputTokens?: number; outputTokens?: number }[] {
  if (kind === 'gemini') return (json.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m: any) => ({ id: String(m.name).replace(/^models\//, ''), inputTokens: m.inputTokenLimit, outputTokens: m.outputTokenLimit }));
  return (json.data ?? []).map((m: any) => ({ id: m.id }));
}
