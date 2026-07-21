import { getD1 } from "../db";
import {
  canonicalInstitutionName,
  institutionAliasKey,
  officialSchoolSearchTerms,
} from "./institution-names";

type D1Database = ReturnType<typeof getD1>;

type StoredSchoolCredential = {
  encrypted_key: string;
  iv: string;
  key_last4: string;
  updated_at: string;
};

type NeisSchoolRow = {
  ATPT_OFCDC_SC_CODE?: string;
  SD_SCHUL_CODE?: string;
  SCHUL_NM?: string;
  SCHUL_KND_SC_NM?: string;
  LCTN_SC_NM?: string;
  ORG_RDNMA?: string;
  ORG_TELNO?: string;
  COEDU_SC_NM?: string;
};

export type OfficialSchoolCandidate = {
  officeCode: string;
  schoolCode: string;
  name: string;
  kind: string;
  region: string;
  address: string;
  phone: string;
  coeducation: string;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS school_directory_credentials (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     encrypted_key TEXT NOT NULL,
     iv TEXT NOT NULL,
     key_last4 TEXT NOT NULL,
     updated_by BIGINT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS official_school_cache (
     cache_key TEXT PRIMARY KEY,
     query_name TEXT NOT NULL,
     region TEXT NOT NULL DEFAULT '',
     results_json TEXT NOT NULL DEFAULT '[]',
     fetched_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  "CREATE INDEX IF NOT EXISTS official_school_cache_fetched_idx ON official_school_cache (fetched_at)",
] as const;

let readyPromise: Promise<D1Database> | null = null;

export async function ensureSchoolDirectoryReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const d1 = getD1();
      await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
      return d1;
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

function serverApiKey() {
  return process.env.NEIS_API_KEY?.trim() ?? "";
}

function encryptionSecret() {
  return (
    process.env.API_CREDENTIALS_SECRET?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    ""
  );
}

function bytesToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function encryptionKey() {
  const secret = encryptionSecret();
  if (!secret) {
    throw new Error("API 키 암호화용 서버 비밀값이 없습니다.");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`whizzup-school-directory:${secret}`),
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
    await encryptionKey(),
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
    await encryptionKey(),
    base64ToBytes(encryptedKey),
  );
  return new TextDecoder().decode(decrypted);
}

async function storedCredential(d1: D1Database) {
  return d1
    .prepare(
      `SELECT encrypted_key, iv, key_last4, updated_at
       FROM school_directory_credentials WHERE id = 1`,
    )
    .first<StoredSchoolCredential>();
}

async function effectiveApiKey(d1: D1Database) {
  const stored = await storedCredential(d1);
  if (stored) {
    return {
      apiKey: await decryptApiKey(stored.encrypted_key, stored.iv),
      source: "registered" as const,
      keyLast4: stored.key_last4,
      updatedAt: stored.updated_at,
    };
  }
  const apiKey = serverApiKey();
  return {
    apiKey,
    source: apiKey ? ("server" as const) : ("none" as const),
    keyLast4: apiKey.slice(-4),
    updatedAt: "",
  };
}

function parseSchoolRows(payload: unknown): OfficialSchoolCandidate[] {
  if (!payload || typeof payload !== "object") return [];
  const groups = (payload as { schoolInfo?: unknown }).schoolInfo;
  if (!Array.isArray(groups)) return [];
  const rowGroup = groups.find(
    (group) =>
      group &&
      typeof group === "object" &&
      Array.isArray((group as { row?: unknown }).row),
  ) as { row?: NeisSchoolRow[] } | undefined;
  return (rowGroup?.row ?? [])
    .map((row) => ({
      officeCode: String(row.ATPT_OFCDC_SC_CODE ?? "").trim(),
      schoolCode: String(row.SD_SCHUL_CODE ?? "").trim(),
      name: String(row.SCHUL_NM ?? "").trim(),
      kind: String(row.SCHUL_KND_SC_NM ?? "").trim(),
      region: String(row.LCTN_SC_NM ?? "").trim(),
      address: String(row.ORG_RDNMA ?? "").trim(),
      phone: String(row.ORG_TELNO ?? "").trim(),
      coeducation: String(row.COEDU_SC_NM ?? "").trim(),
    }))
    .filter((row) => row.name && row.schoolCode);
}

async function requestSchools(apiKey: string, queryName: string) {
  const url = new URL("https://open.neis.go.kr/hub/schoolInfo");
  url.searchParams.set("KEY", apiKey);
  url.searchParams.set("Type", "json");
  url.searchParams.set("pIndex", "1");
  url.searchParams.set("pSize", "20");
  if (queryName) url.searchParams.set("SCHUL_NM", queryName);
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error("나이스 학교정보에 연결하지 못했습니다.");
  return parseSchoolRows(await response.json());
}

export async function testSchoolDirectoryCredential(apiKey: string) {
  const normalized = apiKey.trim();
  if (normalized.length < 8) {
    throw new Error("나이스 인증키를 다시 확인해 주세요.");
  }
  await requestSchools(normalized, "");
  return { keyLast4: normalized.slice(-4) };
}

export async function getSchoolDirectorySettingsStatus() {
  const d1 = await ensureSchoolDirectoryReady();
  const effective = await effectiveApiKey(d1);
  const fallback = serverApiKey();
  return {
    configured: Boolean(effective.apiKey),
    source: effective.source,
    keyLast4: effective.keyLast4,
    updatedAt: effective.updatedAt,
    serverFallbackConfigured: Boolean(fallback),
    serverFallbackLast4: fallback.slice(-4),
  };
}

export async function saveSchoolDirectoryCredential(
  apiKey: string,
  memberId: number,
) {
  const tested = await testSchoolDirectoryCredential(apiKey);
  const encrypted = await encryptApiKey(apiKey.trim());
  const d1 = await ensureSchoolDirectoryReady();
  await d1
    .prepare(
      `INSERT INTO school_directory_credentials (
         id, encrypted_key, iv, key_last4, updated_by, updated_at
       ) VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         encrypted_key = excluded.encrypted_key,
         iv = excluded.iv,
         key_last4 = excluded.key_last4,
         updated_by = excluded.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(encrypted.encryptedKey, encrypted.iv, tested.keyLast4, memberId)
    .run();
}

export async function revertSchoolDirectoryCredential() {
  const d1 = await ensureSchoolDirectoryReady();
  await d1.prepare("DELETE FROM school_directory_credentials WHERE id = 1").run();
}

function comparable(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "")
    .replace(/특별자치도|특별자치시|광역시|특별시|자치도|자치시|도|시|군|구/g, "");
}

function looksLikeSchool(value: unknown) {
  const name = String(value ?? "").replace(/\s+/g, "");
  return /(?:초등학교|중학교|고등학교|초교|중교|고교|초중학교|중고등학교|여중|남중|여고|남고|외고|과고|예고|체고|공고|상고|여상|초|중|고)$/.test(
    name,
  );
}

function matchesRegion(candidate: OfficialSchoolCandidate, region: string) {
  const requested = comparable(region);
  if (!requested) return true;
  const source = comparable(`${candidate.region} ${candidate.address}`);
  return (
    requested.length >= 2 &&
    (source.includes(requested) || requested.includes(source))
  );
}

async function cachedSearch(
  d1: D1Database,
  apiKey: string,
  queryName: string,
  region: string,
) {
  const cacheKey = `${institutionAliasKey(queryName)}|${comparable(region)}`;
  const cached = await d1
    .prepare(
      `SELECT results_json
       FROM official_school_cache
       WHERE cache_key = ?
         AND fetched_at >= (CURRENT_TIMESTAMP - INTERVAL '30 days')`,
    )
    .bind(cacheKey)
    .first<{ results_json: string }>();
  if (cached) {
    try {
      return JSON.parse(cached.results_json) as OfficialSchoolCandidate[];
    } catch {
      // Refresh malformed cache entries.
    }
  }
  const results = (await requestSchools(apiKey, queryName)).filter((candidate) =>
    matchesRegion(candidate, region),
  );
  await d1
    .prepare(
      `INSERT INTO official_school_cache (
         cache_key, query_name, region, results_json, fetched_at
       ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(cache_key) DO UPDATE SET
         query_name = excluded.query_name,
         region = excluded.region,
         results_json = excluded.results_json,
         fetched_at = CURRENT_TIMESTAMP`,
    )
    .bind(cacheKey, queryName, region, JSON.stringify(results.slice(0, 20)))
    .run();
  return results;
}

export async function resolveOfficialSchoolName(
  requestedValue: unknown,
  regionValue: unknown,
) {
  if (!looksLikeSchool(requestedValue)) return null;
  const d1 = await ensureSchoolDirectoryReady();
  const { apiKey } = await effectiveApiKey(d1);
  if (!apiKey) return null;
  const requested = canonicalInstitutionName(requestedValue);
  const region = String(regionValue ?? "").trim();
  const candidates = new Map<string, OfficialSchoolCandidate>();
  try {
    for (const queryName of officialSchoolSearchTerms(requestedValue)) {
      const rows = await cachedSearch(d1, apiKey, queryName, region);
      rows.forEach((row) => candidates.set(row.schoolCode, row));
      if (candidates.size === 1) break;
    }
  } catch {
    // Official lookup must never block saving a sales record.
    return null;
  }
  const rows = [...candidates.values()];
  const exact = rows.filter(
    (row) => institutionAliasKey(row.name) === institutionAliasKey(requested),
  );
  if (exact.length === 1) return exact[0];
  return rows.length === 1 ? rows[0] : null;
}
