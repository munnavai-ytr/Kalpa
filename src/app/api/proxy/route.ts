import { NextRequest } from 'next/server';

export const runtime = 'edge';

const ALLOWED_HOSTS = new Set([
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'openrouter.ai',
  'api.groq.com',
  'api.deepseek.com',
  'api.together.xyz',
  'api.mistral.ai',
  'api.x.ai',
]);

const STRIPPED_HEADERS = new Set([
  'cookie',
  'host',
  'origin',
  'referer',
  'connection',
  'content-length',
]);

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

export async function POST(req: NextRequest): Promise<Response> {
  const declaredLen = Number(req.headers.get('content-length') || '0');
  if (declaredLen > MAX_BODY_BYTES) {
    return new Response('Request payload exceeds 2 MB limit', { status: 400 });
  }

  let rawText: string;
  try {
    rawText = await req.text();
  } catch {
    return new Response('Invalid request body', { status: 400 });
  }

  if (new TextEncoder().encode(rawText).byteLength > MAX_BODY_BYTES) {
    return new Response('Request payload exceeds 2 MB limit', { status: 400 });
  }

  let payload: {
    url?: unknown;
    method?: unknown;
    headers?: Record<string, string>;
    body?: unknown;
  };
  try {
    payload = JSON.parse(rawText);
  } catch {
    return new Response('Expected JSON payload', { status: 400 });
  }

  if (typeof payload.url !== 'string' || !payload.url) {
    return new Response('Missing target URL', { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(payload.url);
  } catch {
    return new Response('Malformed target URL', { status: 400 });
  }

  if (parsedUrl.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsedUrl.hostname)) {
    return new Response('Target host is not permitted by proxy allow-list', { status: 400 });
  }

  const method =
    typeof payload.method === 'string' && /^(GET|POST)$/i.test(payload.method)
      ? payload.method.toUpperCase()
      : 'POST';

  const forwardHeaders = new Headers();
  if (payload.headers && typeof payload.headers === 'object') {
    for (const [k, v] of Object.entries(payload.headers)) {
      if (typeof v === 'string' && !STRIPPED_HEADERS.has(k.toLowerCase())) {
        forwardHeaders.set(k, v);
      }
    }
  }

  const upstreamBody =
    method === 'GET'
      ? undefined
      : typeof payload.body === 'string'
        ? payload.body
        : payload.body !== undefined
          ? JSON.stringify(payload.body)
          : undefined;

  try {
    const upstream = await fetch(parsedUrl.toString(), {
      method,
      headers: forwardHeaders,
      body: upstreamBody,
    });

    const resHeaders = new Headers();
    const contentType = upstream.headers.get('content-type');
    if (contentType) resHeaders.set('content-type', contentType);
    resHeaders.set('cache-control', 'no-store');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: resHeaders,
    });
  } catch {
    return new Response('Upstream request failed', { status: 502 });
  }
}
