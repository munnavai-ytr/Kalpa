import type { ProviderKind } from './core';

export interface OpenRouterCreditInfo {
  limit: number | null;
  usage: number | null;
  limitRemaining: number | null;
  isFreeTier?: boolean;
  checkedAt: number;
}

export function isOpenRouterUrl(baseUrl: string): boolean {
  return /openrouter\.ai/i.test(baseUrl);
}

export async function fetchOpenRouterKeyCredits(
  baseUrl: string,
  apiKey: string,
  useProxy = false
): Promise<OpenRouterCreditInfo | null> {
  if (!apiKey.trim() || !isOpenRouterUrl(baseUrl)) return null;
  const base = baseUrl.replace(/\/+$/, '');
  const endpoints = [`${base}/key`, `${base}/auth/key`];

  for (const url of endpoints) {
    try {
      const headers = { authorization: `Bearer ${apiKey}` };
      const res = useProxy
        ? await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url, method: 'GET', headers }),
          })
        : await fetch(url, { method: 'GET', headers });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data?: {
          limit?: number | null;
          usage?: number | null;
          limit_remaining?: number | null;
          is_free_tier?: boolean;
        };
      };
      if (!json?.data) continue;
      const limit = typeof json.data.limit === 'number' ? json.data.limit : null;
      const usage = typeof json.data.usage === 'number' ? json.data.usage : null;
      const limitRemaining =
        typeof json.data.limit_remaining === 'number'
          ? json.data.limit_remaining
          : limit !== null && usage !== null
            ? Math.max(0, limit - usage)
            : null;
      return {
        limit,
        usage,
        limitRemaining,
        isFreeTier: json.data.is_free_tier,
        checkedAt: Date.now(),
      };
    } catch {
      // ignore — credit check is strictly informational
    }
  }
  return null;
}

export function getProviderKeyPageUrl(
  kind: ProviderKind,
  baseUrl: string
): { label: string; url: string } | null {
  if (/openrouter\.ai/i.test(baseUrl)) {
    return { label: 'OpenRouter keys', url: 'https://openrouter.ai/settings/keys' };
  }
  if (/groq\.com/i.test(baseUrl)) {
    return { label: 'Groq keys', url: 'https://console.groq.com/keys' };
  }
  if (/deepseek\.com/i.test(baseUrl)) {
    return { label: 'DeepSeek keys', url: 'https://platform.deepseek.com/api_keys' };
  }
  if (/together\.xyz/i.test(baseUrl)) {
    return { label: 'Together keys', url: 'https://api.together.ai/settings/api-keys' };
  }
  if (/mistral\.ai/i.test(baseUrl)) {
    return { label: 'Mistral keys', url: 'https://console.mistral.ai/api-keys' };
  }
  if (/x\.ai/i.test(baseUrl)) {
    return { label: 'xAI keys', url: 'https://console.x.ai' };
  }
  if (kind === 'gemini' || /googleapis\.com/i.test(baseUrl)) {
    return { label: 'Google AI Studio keys', url: 'https://aistudio.google.com/apikey' };
  }
  if (kind === 'anthropic' || /anthropic\.com/i.test(baseUrl)) {
    return { label: 'Anthropic keys', url: 'https://console.anthropic.com/settings/keys' };
  }
  if (/api\.openai\.com/i.test(baseUrl)) {
    return { label: 'OpenAI keys', url: 'https://platform.openai.com/api-keys' };
  }
  return null;
}
