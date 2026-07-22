import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../../../lib/collaboration";
import {
  canonicalInstitutionName,
  findSimilarInstitutionNames,
  institutionAliasKey,
  preferFullInstitutionName,
} from "../../../../../lib/institution-names";
import { getOpenAIConfig } from "../../../../../lib/openai-config";
import { clean, ensureRecordsReady } from "../../../../../lib/records-store";

export const dynamic = "force-dynamic";

const MAX_PDF_BYTES = 12 * 1024 * 1024;

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

const pdfCampaignSchema = {
  type: "object",
  properties: {
    campaignName: { type: "string" },
    notes: { type: "string" },
    rows: {
      type: "array",
      maxItems: 500,
      items: {
        type: "object",
        properties: {
          organization: { type: "string" },
          address: { type: "string" },
          phone: { type: "string" },
          contactName: { type: "string" },
          region: { type: "string" },
          schoolLevel: { type: "string" },
          supplyItems: { type: "string" },
          budgetAmount: { type: "string" },
          notes: { type: "string" },
          reviewNote: { type: "string" },
        },
        required: [
          "organization",
          "address",
          "phone",
          "contactName",
          "region",
          "schoolLevel",
          "supplyItems",
          "budgetAmount",
          "notes",
          "reviewNote",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["campaignName", "notes", "rows"],
  additionalProperties: false,
};

function bytesToDataUrl(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:application/pdf;base64,${btoa(binary)}`;
}

function extractOutputText(payload: OpenAIResponse) {
  if (payload.output_text) return payload.output_text;
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((item) => item.text ?? "")
    .filter(Boolean)
    .join("\n");
}

export async function POST(request: Request) {
  try {
    await requireApprovedMember();
    const formData = await request.formData();
    const uploaded = formData.get("file");
    if (!(uploaded instanceof File)) {
      return Response.json({ error: "분석할 PDF 파일을 선택해 주세요." }, { status: 400 });
    }
    if (
      uploaded.type !== "application/pdf" &&
      !uploaded.name.toLocaleLowerCase().endsWith(".pdf")
    ) {
      return Response.json({ error: "PDF 파일만 분석할 수 있습니다." }, { status: 400 });
    }
    if (!uploaded.size || uploaded.size > MAX_PDF_BYTES) {
      return Response.json(
        { error: "PDF는 12MB 이하 파일만 분석할 수 있습니다." },
        { status: 400 },
      );
    }

    const { apiKey, model, configured } = await getOpenAIConfig();
    if (!configured) {
      return Response.json(
        { error: "관리자 메뉴에서 사이트 AI 연결을 먼저 설정해 주세요." },
        { status: 503 },
      );
    }

    const fileData = bytesToDataUrl(
      new Uint8Array(await uploaded.arrayBuffer()),
    );
    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "none" },
        max_output_tokens: 24_000,
        instructions: `당신은 위즈업의 신규 예산·사업 대상기관 PDF 정리 도우미입니다.
PDF의 제목, 표 머리글, 각 행을 함께 읽고 영업 카테고리와 기관 목록을 구조화하세요.
campaignName에는 문서에서 확인되는 공식 사업명·예산명을 짧게 적고, 연도도 문서에 있으면 포함하세요.
notes에는 총예산, 선정 차수, 공고기관 등 전체 사업에 공통인 정보만 간결하게 적으세요.
rows에는 실제 선정·지원 대상 기관만 한 기관당 한 행으로 작성하고 표 제목, 합계, 교육청, 페이지 머리글은 기관으로 만들지 마세요.
organization은 문서에 적힌 기관명을 유지하되 초·중·고 같은 명백한 학교 축약은 정식 명칭으로 풀어 쓰세요.
region에는 지원청·관할·시군구·지역 중 문서에서 확인되는 가장 구체적인 값을 적으세요.
schoolLevel에는 초등학교, 중학교, 고등학교, 유치원, 특수학교, 기관 등 확인 가능한 구분을 적으세요.
supplyItems에는 선정 유형, 구축형태, 지원 품목처럼 기관별로 배정된 내용을 원문에 가깝게 적으세요.
budgetAmount에는 기관별 금액이 있을 때 단위를 포함해 적으세요.
주소, 전화번호, 담당자, 금액 등 문서에 없는 값은 추측하지 말고 빈 문자열로 두세요.
글자가 흐리거나 표의 열 연결이 불확실하거나 기관명이 잘렸다면 reviewNote에 사용자가 확인할 내용을 구체적으로 적으세요. 확실하면 빈 문자열로 두세요.
같은 기관이 여러 페이지에 반복되면 하나로 합치고 서로 다른 기관은 합치지 마세요.`,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_file",
                filename: uploaded.name.slice(0, 180),
                file_data: fileData,
                detail: "high",
              },
              {
                type: "input_text",
                text: "이 PDF에서 사업명과 대상 기관을 빠짐없이 추출해 저장 전 검토용 자료로 정리해 주세요.",
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "whizzup_pdf_campaign",
            description: "영업 카테고리 PDF 저장 전 검토 자료",
            strict: true,
            schema: pdfCampaignSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const responsePayload = (await openAIResponse.json()) as OpenAIResponse;
    if (!openAIResponse.ok) {
      if (openAIResponse.status === 429) {
        return Response.json(
          { error: "AI 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요." },
          { status: 429 },
        );
      }
      return Response.json(
        { error: "PDF를 분석하지 못했습니다. 파일을 확인한 뒤 다시 시도해 주세요." },
        { status: 502 },
      );
    }

    const parsed = JSON.parse(extractOutputText(responsePayload)) as {
      campaignName?: unknown;
      notes?: unknown;
      rows?: Array<Record<string, unknown>>;
    };
    const d1 = await ensureRecordsReady();
    const organizations = await d1
      .prepare("SELECT DISTINCT organization FROM activities WHERE organization <> ''")
      .all<{ organization: string }>();
    const existing = organizations.results
      .map((row) => clean(row.organization))
      .filter(Boolean);

    const rows = [
      ...new Map(
        (Array.isArray(parsed.rows) ? parsed.rows : [])
          .map((row) => {
            const organization = canonicalInstitutionName(row.organization).slice(0, 120);
            const exact = existing.filter(
              (value) => institutionAliasKey(value) === institutionAliasKey(organization),
            );
            const similar = exact.length
              ? []
              : findSimilarInstitutionNames(organization, existing, 3);
            const candidates = exact.length
              ? [preferFullInstitutionName(...exact)]
              : similar;
            return {
              organization,
              address: clean(row.address).slice(0, 500),
              phone: clean(row.phone).slice(0, 100),
              contactName: clean(row.contactName).slice(0, 120),
              region: clean(row.region).slice(0, 120),
              schoolLevel: clean(row.schoolLevel).slice(0, 80),
              supplyItems: clean(row.supplyItems).slice(0, 500),
              budgetAmount: clean(row.budgetAmount).slice(0, 120),
              notes: clean(row.notes).slice(0, 1000),
              reviewNote: clean(row.reviewNote).slice(0, 500),
              assignedMemberName: "",
              existingOrganizations: candidates,
              confirmedOrganization: exact.length ? candidates[0] : "",
            };
          })
          .filter((row) => row.organization)
          .map((row) => [institutionAliasKey(row.organization), row]),
      ).values(),
    ].slice(0, 500);

    if (!rows.length) {
      return Response.json(
        { error: "PDF에서 등록할 기관명을 찾지 못했습니다." },
        { status: 422 },
      );
    }

    return Response.json({
      campaignName: clean(parsed.campaignName).slice(0, 120),
      notes: clean(parsed.notes).slice(0, 1000),
      rows,
      model,
      usage: {
        inputTokens: Number(responsePayload.usage?.input_tokens ?? 0),
        outputTokens: Number(responsePayload.usage?.output_tokens ?? 0),
        totalTokens: Number(responsePayload.usage?.total_tokens ?? 0),
      },
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "PDF 분석 결과를 읽지 못했습니다. 다시 시도해 주세요." },
        { status: 502 },
      );
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return Response.json(
        { error: "PDF 분석 시간이 길어졌습니다. 다시 시도해 주세요." },
        { status: 504 },
      );
    }
    return accessErrorResponse(error);
  }
}
