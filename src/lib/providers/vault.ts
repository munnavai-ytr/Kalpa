import { deleteSetting, getSetting, resetKalpaDB, setSetting } from '@/lib/vfs/db';

export type VaultMode = 'memory' | 'device' | 'encrypted';

export interface EncryptedEnvelope {
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
  iterations: number;
}

export interface SecretBundle {
  keysByProfileId: Record<string, string>;
  e2bApiKey?: string;
  githubToken?: string;
}

const VAULT_MODE_KEY = 'vault_mode';
const VAULT_PLAIN_KEY = 'vault_plain_secrets';
const VAULT_ENC_KEY = 'vault_encrypted_secrets';
const PBKDF2_ITERATIONS = 150000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptSecrets(bundle: SecretBundle, passphrase: string): Promise<EncryptedEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext
  );
  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iterations: PBKDF2_ITERATIONS,
  };
}

export async function decryptSecrets(envelope: EncryptedEnvelope, passphrase: string): Promise<SecretBundle> {
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const key = await deriveAesKey(passphrase, salt, envelope.iterations || PBKDF2_ITERATIONS);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource
  );
  const json = new TextDecoder().decode(decrypted);
  return JSON.parse(json) as SecretBundle;
}

export async function loadVaultState(): Promise<{
  mode: VaultMode;
  locked: boolean;
  secrets: SecretBundle;
}> {
  const mode = (await getSetting<VaultMode>(VAULT_MODE_KEY)) ?? 'device';
  if (mode === 'memory') {
    return { mode: 'memory', locked: false, secrets: { keysByProfileId: {} } };
  }
  if (mode === 'encrypted') {
    const env = await getSetting<EncryptedEnvelope>(VAULT_ENC_KEY);
    if (env) {
      return { mode: 'encrypted', locked: true, secrets: { keysByProfileId: {} } };
    }
    return { mode: 'encrypted', locked: false, secrets: { keysByProfileId: {} } };
  }
  const plain = await getSetting<SecretBundle>(VAULT_PLAIN_KEY);
  return {
    mode: 'device',
    locked: false,
    secrets: plain ?? { keysByProfileId: {} },
  };
}

export async function persistVaultSecrets(
  mode: VaultMode,
  secrets: SecretBundle,
  passphrase?: string
): Promise<void> {
  await setSetting(VAULT_MODE_KEY, mode);
  if (mode === 'memory') {
    await deleteSetting(VAULT_PLAIN_KEY);
    await deleteSetting(VAULT_ENC_KEY);
    return;
  }
  if (mode === 'device') {
    await deleteSetting(VAULT_ENC_KEY);
    await setSetting(VAULT_PLAIN_KEY, secrets);
    return;
  }
  if (!passphrase) {
    throw new Error('Passphrase is required for encrypted key storage');
  }
  await deleteSetting(VAULT_PLAIN_KEY);
  const env = await encryptSecrets(secrets, passphrase);
  await setSetting(VAULT_ENC_KEY, env);
}

export async function unlockEncryptedVault(passphrase: string): Promise<SecretBundle> {
  const env = await getSetting<EncryptedEnvelope>(VAULT_ENC_KEY);
  if (!env) return { keysByProfileId: {} };
  return decryptSecrets(env, passphrase);
}

export async function wipeAllBrowserData(): Promise<void> {
  await resetKalpaDB();
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.clear();
  }
}
