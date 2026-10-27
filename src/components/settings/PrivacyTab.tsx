import React from 'react';
import { Card } from '@/components/ui/Card';

export function PrivacyTab() {
  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <h3 className="text-sm font-semibold text-kalpa-text">Your Keys Stay in Your Browser</h3>
        <p className="text-sm text-kalpa-muted leading-relaxed">
          Kalpa has no user accounts, no cloud database, and no analytics telemetry. Your API keys
          live exclusively in your browser memory or local IndexedDB (optionally encrypted with
          WebCrypto PBKDF2 + AES-GCM). Keys are never logged to the console or persisted on any
          server.
        </p>
        <p className="text-sm text-kalpa-muted leading-relaxed">
          If you enable <strong>Use proxy</strong> on a provider profile to work around browser CORS
          restrictions, requests are forwarded statelessly through <code className="font-mono text-xs">/api/proxy</code>{' '}
          directly to the allow-listed provider host and forgotten immediately.
        </p>
      </Card>

      <Card className="space-y-3">
        <h3 className="text-sm font-semibold text-kalpa-text">
          Third-Party Hosts Contacted by the Instant Engine
        </h3>
        <div className="space-y-2.5 text-sm text-kalpa-muted">
          <p>
            <strong className="text-kalpa-text font-mono text-xs">codesandbox.io</strong> — Sandpack
            static client bundler and npm package CDN when previewing React, Vue, Svelte, Solid,
            Angular, or Next-Lite projects.
          </p>
          <p>
            <strong className="text-kalpa-text font-mono text-xs">cdn.tailwindcss.com</strong> —
            Tailwind Play CDN script injected inside Sandpack previews so utility classes work
            without a build server.
          </p>
          <p>
            <strong className="text-kalpa-text font-mono text-xs">cdn.jsdelivr.net</strong> — Pinned
            Pyodide v0.26.4 WebAssembly runtime and pure-Python wheels when running Python code.
          </p>
          <p>
            <strong className="text-kalpa-text font-mono text-xs">Your chosen AI provider</strong> —
            Direct HTTPS requests to the Base URL configured in your active provider profile (e.g.
            OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, or your local Ollama/LM Studio
            server).
          </p>
        </div>
      </Card>
    </div>
  );
}
