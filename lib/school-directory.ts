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

type StoredSchoolRow = {
  office_code: string;
  school_code: string;
  name: string;
  kind: string;
  region: string;
  address: string;
  phone: string;
  coeducation: string;
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

type SchoolDirectorySyncState = {
  total_count: number;
  directory_count: number;
  linked_count: number;
  last_page: number;
  last_synced_at: string;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS school_directory_credentials (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     encrypted_key TEXT NOT NULL,
     iv TEXT NOT NULL,
     key_last4 TEXT NOT NULL,
     updated_by INTEGER,
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS official_school_cache (
     cache_key TEXT PRIMARY KEY,
     query_name TEXT NOT NULL,
     region TEXT NOT NULL DEFAULT '',
     results_json TEXT NOT NULL DEFAULT '[]',
     fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  "CREATE INDEX IF NOT EXISTS official_school_cache_fetched_idx ON official_school_cache (fetched_at)",
  `CREATE TABLE IF NOT EXISTS official_school_directory (
     school_code TEXT PRIMARY KEY,
     office_code TEXT NOT NULL DEFAULT '',
     name TEXT NOT NULL,
     name_key TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT '',
     region TEXT NOT NULL DEFAULT '',
     region_key TEXT NOT NULL DEFAULT '',
     address TEXT NOT NULL DEFAULT '',
     address_key TEXT NOT NULL DEFAULT '',
     phone TEXT NOT NULL DEFAULT '',
     coeducation TEXT NOT NULL DEFAULT '',
     fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  "CREATE INDEX IF NOT EXISTS official_school_directory_name_idx ON official_school_directory (name_key, region_key)",
  "CREATE INDEX IF NOT EXISTS official_school_directory_region_idx ON official_school_directory (region_key, name_key)",
  `CREATE TABLE IF NOT EXISTS organization_school_links (
     link_key TEXT PRIMARY KEY,
     organization TEXT NOT NULL,
     organization_key TEXT NOT NULL,
     context_key TEXT NOT NULL DEFAULT '',
     school_code TEXT NOT NULL,
     match_source TEXT NOT NULL DEFAULT 'official-directory',
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  "CREATE INDEX IF NOT EXISTS organization_school_links_org_idx ON organization_school_links (organization_key, context_key)",
  "CREATE INDEX IF NOT EXISTS organization_school_links_school_idx ON organization_school_links (school_code)",
  `CREATE TABLE IF NOT EXISTS official_school_sync_state (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     total_count INTEGER NOT NULL DEFAULT 0,
     last_page INTEGER NOT NULL DEFAULT 0,
     last_synced_at TEXT NOT NULL DEFAULT '',
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
] as const;

let readyPromise: Promise<D1Database> | null = null;

export async function ensureSchoolDirectoryReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const d1 = getD1();
      await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
      return d1;
    })();
  }
  return readyPromise;
}

function runtimeEnvironment() {
  return process.env as Record<string, unknown>;
}

function serverApiKey() {
  const value = runtimeEnvironment().NEIS_API_KEY;
  return typeof value === "string" ? value.trim() : "";
}

function encryptionSecret() {
  const runtime = runtimeEnvironment();
  const dedicated =
    typeof runtime.API_CREDENTIALS_SECRET === "string"
      ? runtime.API_CREDENTIALS_SECRET.trim()
      : "";
  const openAI =
    typeof runtime.OPENAI_API_KEY === "string"
      ? runtime.OPENAI_API_KEY.trim()
      : "";
  return dedicated || openAI;
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

async function encryptionKey() {
  const secret = encryptionSecret();
  if (!secret) {
    throw new Error("API 암호화용 서버 비밀값이 없습니다.");
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

function comparable(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function looksLikeSchool(value: unknown) {
  const name = String(value ?? "").normalize("NFKC").replace(/\s+/g, "");
  return /(?:학교|초|중|고|유치원)$/.test(name);
}

function schoolFromStored(row: StoredSchoolRow): OfficialSchoolCandidate {
  return {
    officeCode: row.office_code,
    schoolCode: row.school_code,
    name: row.name,
    kind: row.kind,
    region: row.region,
    address: row.address,
    phone: row.phone,
    coeducation: row.coeducation,
  };
}

function parseSchoolPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return { rows: [] as OfficialSchoolCandidate[], totalCount: 0 };
  }
  const groups = (payload as { schoolInfo?: unknown }).schoolInfo;
  if (!Array.isArray(groups)) {
    return { rows: [] as OfficialSchoolCandidate[], totalCount: 0 };
  }
  let totalCount = 0;
  const headGroup = groups.find(
    (group) =>
      group &&
      typeof group === "object" &&
      Array.isArray((group as { head?: unknown }).head),
  ) as { head?: Array<{ list_total_count?: number | string }> } | undefined;
  for (const item of headGroup?.head ?? []) {
    const count = Number(item?.list_total_count ?? 0);
    if (Number.isFinite(count) && count > 0) totalCount = count;
  }
  const rowGroup = groups.find(
    (group) =>
      group &&
      typeof group === "object" &&
      Array.isArray((group as { row?: unknown }).row),
  ) as { row?: NeisSchoolRow[] } | undefined;
  const rows = (rowGroup?.row ?? [])
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
  return { rows, totalCount: totalCount || rows.length };
}

async function requestSchools(
  apiKey: string,
  queryName: string,
  page = 1,
  pageSize = 50,
) {
  const url = new URL("https://open.neis.go.kr/hub/schoolInfo");
  url.searchParams.set("KEY", apiKey);
  url.searchParams.set("Type", "json");
  url.searchParams.set("pIndex", String(page));
  url.searchParams.set("pSize", String(pageSize));
  if (queryName) url.searchParams.set("SCHUL_NM", queryName);
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(queryName ? 8_000 : 15_000),
  });
  if (!response.ok) {
    throw new Error("나이스 학교정보에 연결하지 못했습니다.");
  }
  return parseSchoolPayload(await response.json());
}

async function upsertDirectoryRows(
  d1: D1Database,
  rows: OfficialSchoolCandidate[],
) {
  const uniqueRows = [
    ...new Map(rows.map((row) => [row.schoolCode, row])).values(),
  ];
  for (let offset = 0; offset < uniqueRows.length; offset += 50) {
    const batch = uniqueRows.slice(offset, offset + 50).map((row) =>
      d1
        .prepare(
          `INSERT INTO official_school_directory (
             school_code, office_code, name, name_key, kind, region,
             region_key, address, address_key, phone, coeducation,
             fetched_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(school_code) DO UPDATE SET
             office_code = excluded.office_code,
             name = excluded.name,
             name_key = excluded.name_key,
             kind = excluded.kind,
             region = excluded.region,
             region_key = excluded.region_key,
             address = excluded.address,
             address_key = excluded.address_key,
             phone = CASE
               WHEN excluded.phone <> '' THEN excluded.phone
               ELSE official_school_directory.phone
             END,
             coeducation = excluded.coeducation,
             fetched_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          row.schoolCode,
          row.officeCode,
          row.name,
          institutionAliasKey(row.name),
          row.kind,
          row.region,
          comparable(row.region),
          row.address,
          comparable(row.address),
          row.phone,
          row.coeducation,
        ),
    );
    if (batch.length) await d1.batch(batch);
  }
}

function locationTokens(value: unknown) {
  const tokens = new Set<string>();
  String(value ?? "")
    .normalize("NFKC")
    .split(/[\s,()[\]{}]+/)
    .map((token) => comparable(token))
    .filter((token) => token.length >= 2)
    .forEach((token) => {
      tokens.add(token);
      const base = token.replace(
        /(?:특별자치도|특별자치시|광역시|특별시|시|군|구|읍|면|동|리)$/u,
        "",
      );
      if (base.length >= 2) tokens.add(base);
    });
  return [...tokens];
}

function locationScore(
  candidate: OfficialSchoolCandidate,
  regionValue: unknown,
  addressValue: unknown,
) {
  const requestedRegion = comparable(regionValue);
  const requestedAddress = comparable(addressValue);
  const candidateRegion = comparable(candidate.region);
  const candidateAddress = comparable(candidate.address);
  const source = `${candidateRegion}${candidateAddress}`;
  let score = 0;
  if (requestedRegion && requestedRegion === candidateRegion) score += 10;
  if (requestedAddress && requestedAddress === candidateAddress) score += 20;
  locationTokens(regionValue).forEach((token) => {
    if (source.includes(token)) score += 3;
  });
  locationTokens(addressValue).forEach((token) => {
    if (source.includes(token)) score += 2;
  });
  return score;
}

function chooseSafeCandidate(
  candidates: OfficialSchoolCandidate[],
  requestedValue: unknown,
  regionValue: unknown,
  addressValue: unknown,
) {
  const acceptedNameKeys = new Set(
    officialSchoolSearchTerms(requestedValue).map((name) =>
      institutionAliasKey(name),
    ),
  );
  const exact = candidates.filter((candidate) =>
    acceptedNameKeys.has(institutionAliasKey(candidate.name)),
  );
  if (exact.length === 1) return exact[0];
  if (exact.length < 2) return null;
  const ranked = exact
    .map((candidate) => ({
      candidate,
      score: locationScore(candidate, regionValue, addressValue),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.schoolCode.localeCompare(right.candidate.schoolCode),
    );
  const best = ranked[0];
  const runnerUp = ranked[1];
  return best && best.score >= 3 && best.score - (runnerUp?.score ?? 0) >= 2
    ? best.candidate
    : null;
}

function contextKey(regionValue: unknown, addressValue: unknown) {
  return `${comparable(regionValue)}|${comparable(addressValue)}`.slice(0, 600);
}

function organizationLinkKey(
  organization: unknown,
  regionValue: unknown,
  addressValue: unknown,
) {
  return `${institutionAliasKey(organization)}|${contextKey(
    regionValue,
    addressValue,
  )}`;
}

async function linkedSchool(
  d1: D1Database,
  organization: unknown,
  regionValue: unknown,
  addressValue: unknown,
) {
  const row = await d1
    .prepare(
      `SELECT d.office_code, d.school_code, d.name, d.kind, d.region,
              d.address, d.phone, d.coeducation
       FROM organization_school_links l
       JOIN official_school_directory d ON d.school_code = l.school_code
       WHERE l.link_key = ?`,
    )
    .bind(organizationLinkKey(organization, regionValue, addressValue))
    .first<StoredSchoolRow>();
  return row ? schoolFromStored(row) : null;
}

async function rememberSchoolLink(
  d1: D1Database,
  organization: unknown,
  regionValue: unknown,
  addressValue: unknown,
  school: OfficialSchoolCandidate,
  source: string,
) {
  const organizationName = canonicalInstitutionName(organization);
  await d1
    .prepare(
      `INSERT INTO organization_school_links (
         link_key, organization, organization_key, context_key, school_code,
         match_source, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(link_key) DO UPDATE SET
         organization = excluded.organization,
         organization_key = excluded.organization_key,
         context_key = excluded.context_key,
         school_code = excluded.school_code,
         match_source = excluded.match_source,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      organizationLinkKey(organizationName, regionValue, addressValue),
      organizationName,
      institutionAliasKey(organizationName),
      contextKey(regionValue, addressValue),
      school.schoolCode,
      source,
    )
    .run();
}

async function localCandidates(
  d1: D1Database,
  requestedValue: unknown,
): Promise<OfficialSchoolCandidate[]> {
  const nameKeys = [
    ...new Set(
      officialSchoolSearchTerms(requestedValue)
        .map((name) => institutionAliasKey(name))
        .filter(Boolean),
    ),
  ];
  if (!nameKeys.length) return [];
  const placeholders = nameKeys.map(() => "?").join(", ");
  const rows = await d1
    .prepare(
      `SELECT office_code, school_code, name, kind, region, address, phone, coeducation
       FROM official_school_directory
       WHERE name_key IN (${placeholders})
       ORDER BY region, name, school_code
       LIMIT 50`,
    )
    .bind(...nameKeys)
    .all<StoredSchoolRow>();
  return (rows.results ?? []).map(schoolFromStored);
}

async function cachedSearch(
  d1: D1Database,
  apiKey: string,
  queryName: string,
  regionValue: unknown,
  addressValue: unknown,
) {
  const cacheKey = `v2|${institutionAliasKey(queryName)}|${contextKey(
    regionValue,
    addressValue,
  )}`;
  const cached = await d1
    .prepare(
      `SELECT results_json
       FROM official_school_cache
       WHERE cache_key = ?
         AND fetched_at >= DATETIME('now', '-30 day')`,
    )
    .bind(cacheKey)
    .first<{ results_json: string }>();
  if (cached) {
    try {
      const rows = JSON.parse(cached.results_json) as OfficialSchoolCandidate[];
      if (rows.length) return rows;
    } catch {
      // Refresh malformed cache entries.
    }
  }
  const response = await requestSchools(apiKey, queryName, 1, 50);
  await upsertDirectoryRows(d1, response.rows);
  if (response.rows.length) {
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
      .bind(
        cacheKey,
        queryName,
        String(regionValue ?? ""),
        JSON.stringify(response.rows.slice(0, 50)),
      )
      .run();
  }
  return response.rows;
}

export async function testSchoolDirectoryCredential(apiKey: string) {
  const normalized = apiKey.trim();
  if (normalized.length < 8) {
    throw new Error("나이스 인증키를 다시 확인해 주세요.");
  }
  await requestSchools(normalized, "", 1, 1);
  return { keyLast4: normalized.slice(-4) };
}

async function directoryStatus(d1: D1Database) {
  const state = await d1
    .prepare(
      `SELECT
         COALESCE(s.total_count, 0) AS total_count,
         COALESCE(s.last_page, 0) AS last_page,
         COALESCE(s.last_synced_at, '') AS last_synced_at,
         (SELECT COUNT(*) FROM official_school_directory) AS directory_count,
         (SELECT COUNT(*) FROM organization_school_links) AS linked_count
       FROM (SELECT 1 AS id) base
       LEFT JOIN official_school_sync_state s ON s.id = base.id`,
    )
    .first<SchoolDirectorySyncState>();
  return {
    totalCount: Number(state?.total_count ?? 0),
    directoryCount: Number(state?.directory_count ?? 0),
    linkedCount: Number(state?.linked_count ?? 0),
    lastPage: Number(state?.last_page ?? 0),
    lastSyncedAt: String(state?.last_synced_at ?? ""),
  };
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
    ...(await directoryStatus(d1)),
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

export async function syncOfficialSchoolDirectoryPage(
  pageValue: unknown,
  pageSizeValue: unknown = 500,
) {
  const page = Math.max(1, Math.min(100, Number(pageValue) || 1));
  const pageSize = Math.max(100, Math.min(1000, Number(pageSizeValue) || 500));
  const d1 = await ensureSchoolDirectoryReady();
  const { apiKey } = await effectiveApiKey(d1);
  if (!apiKey) throw new Error("나이스 학교정보 API 연결이 필요합니다.");
  const response = await requestSchools(apiKey, "", page, pageSize);
  await upsertDirectoryRows(d1, response.rows);
  const totalCount = Math.max(response.totalCount, response.rows.length);
  const processed = Math.min(page * pageSize, totalCount);
  const done = response.rows.length < pageSize || processed >= totalCount;
  await d1
    .prepare(
      `INSERT INTO official_school_sync_state (
         id, total_count, last_page, last_synced_at, updated_at
       ) VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         total_count = excluded.total_count,
         last_page = excluded.last_page,
         last_synced_at = excluded.last_synced_at,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      totalCount,
      page,
      done ? new Date().toISOString() : "",
    )
    .run();
  if (page === 1) {
    await d1
      .prepare(
        `DELETE FROM official_school_cache
         WHERE results_json = '[]' OR cache_key NOT LIKE 'v2|%'`,
      )
      .run();
  }
  return {
    ok: true,
    page,
    nextPage: done ? null : page + 1,
    pageSize,
    received: response.rows.length,
    processed,
    done,
    ...(await directoryStatus(d1)),
  };
}

async function resolveFromLocalDirectory(
  d1: D1Database,
  requestedValue: unknown,
  regionValue: unknown,
  addressValue: unknown,
  remember = true,
) {
  const candidates = await localCandidates(d1, requestedValue);
  const selected = chooseSafeCandidate(
    candidates,
    requestedValue,
    regionValue,
    addressValue,
  );
  if (selected && remember) {
    await rememberSchoolLink(
      d1,
      requestedValue,
      regionValue,
      addressValue,
      selected,
      "official-directory",
    );
  }
  return selected;
}

export async function backfillOrganizationSchoolLinks(
  afterValue: unknown,
  limitValue: unknown = 100,
) {
  const d1 = await ensureSchoolDirectoryReady();
  const after = String(afterValue ?? "").slice(0, 200);
  const limit = Math.max(20, Math.min(200, Number(limitValue) || 100));
  const rows = await d1
    .prepare(
      `SELECT organization, region, address, road_address
       FROM organization_locations
       WHERE organization > ?
       ORDER BY organization
       LIMIT ?`,
    )
    .bind(after, limit)
    .all<{
      organization: string;
      region: string;
      address: string;
      road_address: string;
    }>();
  let matched = 0;
  let ambiguous = 0;
  let ignored = 0;
  for (const row of rows.results ?? []) {
    if (!looksLikeSchool(row.organization)) {
      ignored += 1;
      continue;
    }
    const selected = await resolveFromLocalDirectory(
      d1,
      row.organization,
      row.region,
      row.road_address || row.address,
      true,
    );
    if (selected) matched += 1;
    else ambiguous += 1;
  }
  const sourceRows = rows.results ?? [];
  const nextCursor = sourceRows.at(-1)?.organization ?? "";
  return {
    ok: true,
    scanned: sourceRows.length,
    matched,
    ambiguous,
    ignored,
    nextCursor: sourceRows.length < limit ? null : nextCursor,
    done: sourceRows.length < limit,
    ...(await directoryStatus(d1)),
  };
}

export async function resolveOfficialSchoolName(
  requestedValue: unknown,
  regionValue: unknown,
  addressValue: unknown = "",
) {
  if (!looksLikeSchool(requestedValue)) return null;
  const d1 = await ensureSchoolDirectoryReady();
  const linked = await linkedSchool(
    d1,
    requestedValue,
    regionValue,
    addressValue,
  );
  if (linked) return linked;
  const local = await resolveFromLocalDirectory(
    d1,
    requestedValue,
    regionValue,
    addressValue,
    true,
  );
  if (local) return local;
  const { apiKey } = await effectiveApiKey(d1);
  if (!apiKey) return null;
  const candidates = new Map<string, OfficialSchoolCandidate>();
  try {
    for (const queryName of officialSchoolSearchTerms(requestedValue)) {
      const rows = await cachedSearch(
        d1,
        apiKey,
        queryName,
        regionValue,
        addressValue,
      );
      rows.forEach((row) => candidates.set(row.schoolCode, row));
    }
  } catch {
    return null;
  }
  const selected = chooseSafeCandidate(
    [...candidates.values()],
    requestedValue,
    regionValue,
    addressValue,
  );
  if (selected) {
    await rememberSchoolLink(
      d1,
      requestedValue,
      regionValue,
      addressValue,
      selected,
      "official-api",
    );
  }
  return selected;
}

export async function findOfficialSchoolCandidates(
  requestedValue: unknown,
  regionValue: unknown,
  addressValue: unknown = "",
) {
  if (!looksLikeSchool(requestedValue)) return [];
  const d1 = await ensureSchoolDirectoryReady();
  const local = await localCandidates(d1, requestedValue);
  if (local.length) {
    return local
      .sort(
        (left: OfficialSchoolCandidate, right: OfficialSchoolCandidate) =>
          locationScore(right, regionValue, addressValue) -
            locationScore(left, regionValue, addressValue) ||
          left.region.localeCompare(right.region, "ko-KR") ||
          left.name.localeCompare(right.name, "ko-KR"),
      )
      .slice(0, 10);
  }
  const { apiKey } = await effectiveApiKey(d1);
  if (!apiKey) return [];
  const candidates = new Map<string, OfficialSchoolCandidate>();
  try {
    for (const queryName of officialSchoolSearchTerms(requestedValue)) {
      const rows = await cachedSearch(
        d1,
        apiKey,
        queryName,
        regionValue,
        addressValue,
      );
      rows.forEach((row) => candidates.set(row.schoolCode, row));
    }
  } catch {
    return [];
  }
  return [...candidates.values()]
    .sort(
      (left: OfficialSchoolCandidate, right: OfficialSchoolCandidate) =>
        locationScore(right, regionValue, addressValue) -
          locationScore(left, regionValue, addressValue) ||
        left.region.localeCompare(right.region, "ko-KR") ||
        left.name.localeCompare(right.name, "ko-KR"),
    )
    .slice(0, 10);
}
