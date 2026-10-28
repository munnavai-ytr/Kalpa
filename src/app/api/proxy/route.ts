import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

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
const PING_INTERVAL_MS = 10_000;
const INITIAL_HEADER_RACE_MS = 9_500;

function pipeWithSseKeepalive(
  upstreamBody: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const reader = upstreamBody.getReader();
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let lastByteAt = Date.now();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      pingTimer = setInterval(() => {
        if (Date.now() - lastByteAt >= PING_INTERVAL_MS - 500) {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'));
            lastByteAt = Date.now();
          } catch {
            if (pingTimer) clearInterval(pingTimer);
          }
        }
      }, PING_INTERVAL_MS);
    },
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          if (pingTimer) clearInterval(pingTimer);
          reader.releaseLock();
          controller.close();
          return;
        }
        if (value && value.byteLength > 0) {
          lastByteAt = Date.now();
          controller.enqueue(value);
        }
      } catch (err) {
        if (pingTimer) clearInterval(pingTimer);
        reader.releaseLock();
        controller.error(err);
      }
    },
    cancel(reason) {
      if (pingTimer) clearInterval(pingTimer);
      reader.releaseLock();
      return upstreamBody.cancel(reason);
    },
  });
}

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

  const isLikelyStream =
    method === 'POST' &&
    (parsedUrl.searchParams.get('alt') === 'sse' ||
      (typeof upstreamBody === 'string' && upstreamBody.includes('"stream":true')));

  const upstreamPromise = fetch(parsedUrl.toString(), {
    method,
    headers: forwardHeaders,
    body: upstreamBody,
  });

  if (!isLikelyStream) {
    try {
      const upstream = await upstreamPromise;
      const resHeaders = new Headers();
      const ct = upstream.headers.get('content-type');
      if (ct) resHeaders.set('content-type', ct);
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

  // Race initial upstream headers against 9.5s so fast HTTP errors (401/402/429) preserve status code,
  // while slow reasoning cold-starts immediately flush SSE ': ping\n\n' keepalive bytes.
  const raceResult = await Promise.race([
    upstreamPromise.then((res) => ({ kind: 'ready' as const, res })),
    new Promise<{ kind: 'slow' }>((resolve) =>
      setTimeout(() => resolve({ kind: 'slow' }), INITIAL_HEADER_RACE_MS)
    ),
  ]).catch(() => ({ kind: 'failed' as const }));

  if (raceResult.kind === 'failed') {
    return new Response('Upstream request failed', { status: 502 });
  }

  if (raceResult.kind === 'ready') {
    const upstream = raceResult.res;
    const resHeaders = new Headers();
    const ct = upstream.headers.get('content-type');
    if (ct) resHeaders.set('content-type', ct);
    resHeaders.set('cache-control', 'no-store');

    if (!upstream.ok || !upstream.body || !(ct || '').includes('text/event-stream')) {
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: resHeaders,
      });
    }

    return new Response(pipeWithSseKeepalive(upstream.body), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: resHeaders,
    });
  }

  // Slow cold-start (>9.5s before headers): stream SSE ': ping\n\n' while waiting for upstream
  const encoder = new TextEncoder();
  const slowStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(': ping\n\n'));
      const timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(timer);
        }
      }, PING_INTERVAL_MS);

      try {
        const upstream = await upstreamPromise;
        if (!upstream.ok || !upstream.body) {
          let errBody = '';
          try {
            errBody = await upstream.text();
          } catch {
            // ignore
          }
          clearInterval(timer);
          const errPayload = JSON.stringify({
            error: { code: upstream.status, message: errBody || upstream.statusText },
          });
          controller.enqueue(encoder.encode(`data: ${errPayload}\n\n`));
          controller.close();
          return;
        }

        const reader = upstream.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) controller.enqueue(value);
        }
        reader.releaseLock();
        clearInterval(timer);
        controller.close();
      } catch {
        clearInterval(timer);
        const errPayload = JSON.stringify({
          error: { code: 502, message: 'Upstream stream connection failed' },
        });
        controller.enqueue(encoder.encode(`data: ${errPayload}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(slowStream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
