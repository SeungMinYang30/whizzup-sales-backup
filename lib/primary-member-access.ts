const DEFAULT_PRIMARY_ORIGIN = "https://whizzup.kr";
const FETCH_TIMEOUT_MS = 15_000;

type PrimaryMemberRow = Record<string, unknown>;

function serverValue(name: string) {
  return String(process.env[name] ?? "").trim();
}

function primaryOrigin() {
  return (serverValue("PRIMARY_SITE_ORIGIN") || DEFAULT_PRIMARY_ORIGIN).replace(
    /\/+$/,
    "",
  );
}

export async function fetchApprovedPrimaryMember(email: string) {
  const exportSecret = serverValue("PRIMARY_EXPORT_SECRET");
  if (!exportSecret) return null;

  const response = await fetch(`${primaryOrigin()}/api/standby-export`, {
    headers: {
      Authorization: `Bearer ${exportSecret}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;

  const backup = (await response.json()) as {
    source?: { application?: string };
    data?: { members?: PrimaryMemberRow[] };
  };
  if (backup.source?.application !== "WHIZZUP Sales Hub") return null;

  const normalizedEmail = email.trim().toLowerCase();
  return (
    backup.data?.members?.find(
      (member) =>
        String(member.email ?? "").trim().toLowerCase() === normalizedEmail &&
        String(member.status ?? "") === "approved",
    ) ?? null
  );
}
