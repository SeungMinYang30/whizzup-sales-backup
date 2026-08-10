import "server-only";

import { createHash } from "node:crypto";
import { getD1 } from "../db";

const CREDENTIAL_FORMAT = "whizzup-member-credentials";
const CREDENTIAL_FORMAT_VERSION = 1;
const MAX_CREDENTIALS = 10_000;

export type StandbyCredential = {
  memberId: number;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  passwordSetAt: string;
  updatedAt: string;
};

export type StandbyCredentialSnapshot = {
  format: typeof CREDENTIAL_FORMAT;
  formatVersion: typeof CREDENTIAL_FORMAT_VERSION;
  createdAt: string;
  checksum: string;
  credentials: StandbyCredential[];
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown, name: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) {
    throw new Error(`Invalid standby credential ${name}`);
  }
  return text;
}

function timestampValue(value: unknown, name: string) {
  const text = textValue(value, name, 64);
  if (!Number.isFinite(Date.parse(text))) {
    throw new Error(`Invalid standby credential ${name}`);
  }
  return text;
}

function canonicalPayload(snapshot: Omit<StandbyCredentialSnapshot, "checksum">) {
  return JSON.stringify({
    format: snapshot.format,
    formatVersion: snapshot.formatVersion,
    createdAt: snapshot.createdAt,
    credentials: snapshot.credentials,
  });
}

function checksum(snapshot: Omit<StandbyCredentialSnapshot, "checksum">) {
  return createHash("sha256").update(canonicalPayload(snapshot)).digest("hex");
}

export async function createStandbyCredentialSnapshot(): Promise<StandbyCredentialSnapshot> {
  const d1 = getD1();
  const result = await d1
    .prepare(`
      SELECT
        c.member_id,
        lower(m.email) AS email,
        c.password_hash,
        c.password_salt,
        c.password_iterations,
        c.password_set_at,
        c.updated_at
      FROM member_credentials c
      JOIN members m ON m.id = c.member_id
      ORDER BY c.member_id
    `)
    .all<{
      member_id: number;
      email: string;
      password_hash: string;
      password_salt: string;
      password_iterations: number;
      password_set_at: string;
      updated_at: string;
    }>();
  const snapshotWithoutChecksum = {
    format: CREDENTIAL_FORMAT,
    formatVersion: CREDENTIAL_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    credentials: result.results.map((row) => ({
      memberId: Number(row.member_id),
      email: String(row.email).trim().toLowerCase(),
      passwordHash: String(row.password_hash),
      passwordSalt: String(row.password_salt),
      passwordIterations: Number(row.password_iterations),
      passwordSetAt: String(row.password_set_at),
      updatedAt: String(row.updated_at),
    })),
  } satisfies Omit<StandbyCredentialSnapshot, "checksum">;
  return {
    ...snapshotWithoutChecksum,
    checksum: checksum(snapshotWithoutChecksum),
  };
}

export function validateStandbyCredentialSnapshot(
  input: unknown,
): StandbyCredentialSnapshot | null {
  if (input === undefined || input === null) return null;
  const source = objectValue(input);
  if (!source) throw new Error("Invalid standby credential snapshot");
  if (source.format !== CREDENTIAL_FORMAT) {
    throw new Error("Unsupported standby credential format");
  }
  if (Number(source.formatVersion) !== CREDENTIAL_FORMAT_VERSION) {
    throw new Error("Unsupported standby credential version");
  }
  const createdAt = timestampValue(source.createdAt, "createdAt");
  const sourceCredentials = Array.isArray(source.credentials)
    ? source.credentials
    : null;
  if (!sourceCredentials || sourceCredentials.length > MAX_CREDENTIALS) {
    throw new Error("Invalid standby credential count");
  }

  const memberIds = new Set<number>();
  const emails = new Set<string>();
  const credentials = sourceCredentials.map((value) => {
    const row = objectValue(value);
    if (!row) throw new Error("Invalid standby credential row");
    const memberId = Number(row.memberId);
    if (!Number.isSafeInteger(memberId) || memberId < 1 || memberIds.has(memberId)) {
      throw new Error("Invalid or duplicate standby credential memberId");
    }
    const email = textValue(row.email, "email", 320).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || emails.has(email)) {
      throw new Error("Invalid or duplicate standby credential email");
    }
    const passwordIterations = Number(row.passwordIterations);
    if (
      !Number.isSafeInteger(passwordIterations) ||
      passwordIterations < 10_000 ||
      passwordIterations > 2_000_000
    ) {
      throw new Error("Invalid standby credential passwordIterations");
    }
    memberIds.add(memberId);
    emails.add(email);
    return {
      memberId,
      email,
      passwordHash: textValue(row.passwordHash, "passwordHash", 512),
      passwordSalt: textValue(row.passwordSalt, "passwordSalt", 512),
      passwordIterations,
      passwordSetAt: timestampValue(row.passwordSetAt, "passwordSetAt"),
      updatedAt: timestampValue(row.updatedAt, "updatedAt"),
    };
  });

  const snapshotWithoutChecksum = {
    format: CREDENTIAL_FORMAT,
    formatVersion: CREDENTIAL_FORMAT_VERSION,
    createdAt,
    credentials,
  } satisfies Omit<StandbyCredentialSnapshot, "checksum">;
  const expectedChecksum = textValue(source.checksum, "checksum", 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedChecksum)) {
    throw new Error("Invalid standby credential checksum");
  }
  if (checksum(snapshotWithoutChecksum) !== expectedChecksum) {
    throw new Error("Standby credential checksum mismatch");
  }
  return { ...snapshotWithoutChecksum, checksum: expectedChecksum };
}

export async function restoreStandbyCredentials(
  snapshot: StandbyCredentialSnapshot,
) {
  const d1 = getD1();
  const members = await d1
    .prepare("SELECT id, lower(email) AS email FROM members ORDER BY id")
    .all<{ id: number; email: string }>();
  const memberEmails = new Map(
    members.results.map((member) => [
      Number(member.id),
      String(member.email).trim().toLowerCase(),
    ]),
  );
  for (const credential of snapshot.credentials) {
    if (memberEmails.get(credential.memberId) !== credential.email) {
      throw new Error("Standby credential does not match the replicated member");
    }
  }

  await d1.transaction(async (transaction) => {
    const memberIds = snapshot.credentials.map((credential) => credential.memberId);
    if (memberIds.length === 0) {
      await transaction.prepare("DELETE FROM member_credentials").run();
    } else {
      const placeholders = memberIds.map(() => "?").join(", ");
      await transaction
        .prepare(
          `DELETE FROM member_credentials WHERE member_id NOT IN (${placeholders})`,
        )
        .bind(...memberIds)
        .run();
    }

    for (const credential of snapshot.credentials) {
      await transaction
        .prepare(`
          INSERT INTO member_credentials (
            member_id, password_hash, password_salt, password_iterations,
            password_set_at, failed_attempts, locked_until, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)
          ON CONFLICT(member_id) DO UPDATE SET
            failed_attempts = CASE
              WHEN member_credentials.password_hash = excluded.password_hash
               AND member_credentials.password_salt = excluded.password_salt
               AND member_credentials.password_iterations = excluded.password_iterations
              THEN member_credentials.failed_attempts ELSE 0 END,
            locked_until = CASE
              WHEN member_credentials.password_hash = excluded.password_hash
               AND member_credentials.password_salt = excluded.password_salt
               AND member_credentials.password_iterations = excluded.password_iterations
              THEN member_credentials.locked_until ELSE NULL END,
            password_hash = excluded.password_hash,
            password_salt = excluded.password_salt,
            password_iterations = excluded.password_iterations,
            password_set_at = excluded.password_set_at,
            updated_at = excluded.updated_at
        `)
        .bind(
          credential.memberId,
          credential.passwordHash,
          credential.passwordSalt,
          credential.passwordIterations,
          credential.passwordSetAt,
          credential.updatedAt,
        )
        .run();
    }
  });

  return {
    count: snapshot.credentials.length,
    checksum: snapshot.checksum,
    createdAt: snapshot.createdAt,
  };
}
