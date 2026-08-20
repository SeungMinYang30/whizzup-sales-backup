import { ensureCollaborationReady } from "./collaboration";

export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
export const OPENAI_MODEL_OPTIONS = [
  "gpt-5.4-mini",
  "gpt-5.4",
  "gpt-5-mini",
] as const;

type StoredCredential = {
  encrypted_key: string;
  iv: string;
  key_last4: string;
  model: string;
  updated_at: string;
};

function serverConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const model =
    process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  return { apiKey, model };
}

function encryptionSecret() {
  const dedicated = process.env.API_CREDENTIALS_SECRET?.trim() ?? "";
  return dedicated || serverConfig().apiKey;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function credentialEncryptionKey() {
  const secret = encryptionSecret();
  if (!secret) {
    throw new Error(
      "API 키 암호화용 서버 비밀값이 없습니다. 서버의 기존 OpenAI API 키를 먼저 설정해 주세요.",
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`whizzup-openai-credentials:${secret}`),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptApiKey(apiKey: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await credentialEncryptionKey(),
    new TextEncoder().encode(apiKey),
  );
  return {
    encryptedKey: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

async function decryptApiKey(encryptedKey: string, iv: string) {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    await credentialEncryptionKey(),
    base64ToBytes(encryptedKey),
  );
  return new TextDecoder().decode(decrypted);
}

async function readStoredCredential() {
  const d1 = await ensureCollaborationReady();
  return d1
    .prepare(
      `SELECT encrypted_key, iv, key_last4, model, updated_at
       FROM api_credentials
       WHERE id = 1`,
    )
    .first<StoredCredential>();
}

export async function getEffectiveOpenAIConfig() {
  const stored = await readStoredCredential();
  if (stored) {
    const apiKey = await decryptApiKey(stored.encrypted_key, stored.iv);
    return {
      apiKey,
      model: stored.model || DEFAULT_OPENAI_MODEL,
      configured: apiKey.startsWith("sk-"),
      source: "registered" as const,
      keyLast4: stored.key_last4,
      updatedAt: stored.updated_at,
    };
  }
  const server = serverConfig();
  return {
    ...server,
    configured: server.apiKey.startsWith("sk-"),
    source: "server" as const,
    keyLast4: server.apiKey ? server.apiKey.slice(-4) : "",
    updatedAt: "",
  };
}

export async function getOpenAISettingsStatus() {
  const effective = await getEffectiveOpenAIConfig();
  const server = serverConfig();
  return {
    configured: effective.configured,
    source: effective.source,
    keyLast4: effective.keyLast4,
    model: effective.model,
    updatedAt: effective.updatedAt,
    serverFallbackConfigured: server.apiKey.startsWith("sk-"),
    serverFallbackLast4: server.apiKey ? server.apiKey.slice(-4) : "",
  };
}

export async function testOpenAICredential(apiKey: string, model: string) {
  const normalizedKey = apiKey.trim();
  const normalizedModel = model.trim() || DEFAULT_OPENAI_MODEL;
  if (!normalizedKey.startsWith("sk-")) {
    throw new Error("올바른 OpenAI API 키를 입력해 주세요.");
  }
  const response = await fetch(
    `https://api.openai.com/v1/models/${encodeURIComponent(normalizedModel)}`,
    {
      headers: { Authorization: `Bearer ${normalizedKey}` },
    },
  );
  if (!response.ok) {
    let message = "OpenAI API 연결을 확인하지 못했습니다.";
    try {
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (payload.error?.message) message = payload.error.message;
    } catch {
      // Keep the safe fallback message.
    }
    throw new Error(message);
  }
  return { model: normalizedModel, keyLast4: normalizedKey.slice(-4) };
}

export async function saveOpenAICredential(
  apiKey: string,
  model: string,
  memberId: number,
) {
  const tested = await testOpenAICredential(apiKey, model);
  const encrypted = await encryptApiKey(apiKey.trim());
  const d1 = await ensureCollaborationReady();
  await d1
    .prepare(
      `INSERT INTO api_credentials (
         id, encrypted_key, iv, key_last4, model, updated_by, updated_at
       ) VALUES (1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         encrypted_key = excluded.encrypted_key,
         iv = excluded.iv,
         key_last4 = excluded.key_last4,
         model = excluded.model,
         updated_by = excluded.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      encrypted.encryptedKey,
      encrypted.iv,
      tested.keyLast4,
      tested.model,
      memberId,
    )
    .run();
}

export async function revertOpenAICredential() {
  const d1 = await ensureCollaborationReady();
  await d1.prepare("DELETE FROM api_credentials WHERE id = 1").run();
}
