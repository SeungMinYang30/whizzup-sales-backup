import { accessErrorResponse, requireApprovedMember } from "../../../../lib/collaboration";
import { clean, ensureRecordsReady } from "../../../../lib/records-store";
import { institutionConfirmationResponse } from "../../../../lib/institution-names";
import { createActivityRecord, PUT as updateRecord } from "../route";

export const dynamic = "force-dynamic";

const MAX_BATCH_SIZE = 50;
const CONCURRENCY = 5;

type BulkRecordItem = {
  clientKey?: unknown;
  method?: unknown;
  body?: unknown;
};

async function readResponsePayload(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return { error: "서버 응답을 확인하지 못했습니다." };
  }
}

async function findExistingGoogleSheetRecordId(
  body: Record<string, unknown>,
) {
  const sourceChat = clean(body.sourceChat);
  if (!sourceChat.startsWith("구글 시트 연동|")) return 0;
  const d1 = await ensureRecordsReady();
  const existing = await d1
    .prepare(
      `SELECT id
       FROM activities
       WHERE source_chat = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .bind(sourceChat)
    .first<{ id: number }>();
  return Number(existing?.id) || 0;
}

async function processItem(
  item: BulkRecordItem,
  index: number,
  member: Awaited<ReturnType<typeof requireApprovedMember>>,
) {
  const clientKey = clean(item.clientKey) || String(index + 1);
  const body =
    item.body && typeof item.body === "object" && !Array.isArray(item.body)
      ? ({ ...(item.body as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const requestedMethod = clean(item.method).toUpperCase();

  try {
    let method = requestedMethod === "PUT" ? "PUT" : "POST";
    if (method === "POST") {
      const existingId = await findExistingGoogleSheetRecordId(body);
      if (existingId) {
        method = "PUT";
        body.id = existingId;
      }
    }
    if (method === "POST") {
      const record = await createActivityRecord(body, member);
      return {
        clientKey,
        status: 201,
        payload: { record },
      };
    }
    const request = new Request("http://internal/api/records", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const response = await updateRecord(request);
    return {
      clientKey,
      status: response.status,
      payload: await readResponsePayload(response),
    };
  } catch (error) {
    const confirmation = institutionConfirmationResponse(error);
    if (confirmation) {
      return {
        clientKey,
        status: confirmation.status,
        payload: await readResponsePayload(confirmation),
      };
    }
    return {
      clientKey,
      status: 500,
      payload: {
        error:
          error instanceof Error
            ? error.message
            : "기록을 저장하지 못했습니다.",
      },
    };
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as { items?: unknown };
    if (!Array.isArray(payload.items) || !payload.items.length) {
      return Response.json(
        { error: "저장할 기록이 없습니다." },
        { status: 400 },
      );
    }
    if (payload.items.length > MAX_BATCH_SIZE) {
      return Response.json(
        { error: `한 번에 최대 ${MAX_BATCH_SIZE}건까지 저장할 수 있습니다.` },
        { status: 400 },
      );
    }

    const items = payload.items as BulkRecordItem[];
    const results: Awaited<ReturnType<typeof processItem>>[] = [];
    for (let start = 0; start < items.length; start += CONCURRENCY) {
      const group = items.slice(start, start + CONCURRENCY);
      results.push(
        ...(await Promise.all(
          group.map((item, groupIndex) =>
            processItem(item, start + groupIndex, member),
          ),
        )),
      );
    }

    return Response.json({ results });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
