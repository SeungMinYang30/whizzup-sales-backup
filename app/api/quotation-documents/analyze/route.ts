import {
  accessErrorResponse,
  requirePrimaryOwner,
} from "../../../../lib/collaboration";
import { getOpenAIConfig } from "../../../../lib/openai-config";
import {
  ensureQuotationDocumentsReady,
  getQuotationBucket,
  type QuotationDocumentRow,
} from "../../../../lib/quotation-documents";
import {
  downloadDriveFile,
  driveFileIdFromKey,
  googleDriveStorageErrorResponse,
} from "../../../../lib/google-drive-storage";
import {
  hasProcurementSignal,
  procurementNumbersFromText,
} from "../../../../lib/procurement-product";

export const dynamic = "force-dynamic";

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ text?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

const quotationAnalysisSchema = {
  type: "object",
  properties: {
    quoteAmount: { type: "number" },
    constructionAmount: { type: "number" },
    actualConstructionCost: { type: "number" },
    items: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        properties: {
          productName: { type: "string" },
          specification: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          unitPrice: { type: "number" },
          amount: { type: "number" },
          procurementNumber: { type: "string" },
          isProcurement: { type: "boolean" },
          confidence: {
            type: "string",
            enum: ["높음", "보통", "확인 필요"],
          },
          reviewNote: { type: "string" },
        },
        required: [
          "productName",
          "specification",
          "quantity",
          "unit",
          "unitPrice",
          "amount",
          "procurementNumber",
          "isProcurement",
          "confidence",
          "reviewNote",
        ],
        additionalProperties: false,
      },
    },
  },
  required: [
    "quoteAmount",
    "constructionAmount",
    "actualConstructionCost",
    "items",
  ],
  additionalProperties: false,
};

function extractOutputText(payload: OpenAIResponse) {
  if (payload.output_text) return payload.output_text;
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((item) => item.text ?? "")
    .filter(Boolean)
    .join("\n");
}

function bytesToDataUrl(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:application/pdf;base64,${btoa(binary)}`;
}

function finiteNumber(value: unknown, min = -100_000_000_000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(Math.min(100_000_000_000, Math.max(min, parsed)));
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export async function POST(request: Request) {
  try {
    await requirePrimaryOwner();
    const payload = (await request.json()) as { id?: unknown };
    const id = Number(payload.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return Response.json(
        { error: "분석할 견적서를 확인해 주세요." },
        { status: 400 },
      );
    }

    const d1 = await ensureQuotationDocumentsReady();
    const document = await d1
      .prepare("SELECT * FROM quotation_documents WHERE id = ? LIMIT 1")
      .bind(id)
      .first<QuotationDocumentRow>();
    if (!document) {
      return Response.json(
        { error: "견적서를 찾지 못했습니다." },
        { status: 404 },
      );
    }

    const driveFileId = driveFileIdFromKey(document.original_key);
    const stored = driveFileId
      ? await downloadDriveFile(driveFileId)
      : await getQuotationBucket().get(document.original_key);
    if (!stored) {
      return Response.json({ error: "저장된 PDF 파일을 찾지 못했습니다." }, { status: 404 });
    }

    const { apiKey, model, configured } = await getOpenAIConfig();
    if (!configured) {
      return Response.json(
        { error: "관리자 메뉴에서 사이트 AI 연결을 먼저 설정해 주세요." },
        { status: 503 },
      );
    }

    const fileData = bytesToDataUrl(
      new Uint8Array(await new Response(stored.body).arrayBuffer()),
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
        reasoning: { effort: "low" },
        max_output_tokens: 16_000,
        instructions: `당신은 위즈업 견적서 품목 추출 도우미입니다.
PDF의 견적 표에서 실제 품목 행만 구조화하세요. 표 머리글, 소계, 합계, 부가세, 업체 정보는 품목으로 만들지 마세요.
productName에는 품목명, specification에는 모델·규격·제조사·조달번호 외 상세 규격을 적으세요.
quantity에는 수량, unit에는 대·개·식·세트 등 단위를 적고 단위가 없으면 "개"를 사용하세요.
unitPrice는 품목 1개의 단가, amount는 해당 행의 공급가 또는 금액입니다. 단가가 없고 금액과 수량만 있으면 금액을 수량으로 나눠 단가를 계산하세요.
할인·차감 행은 음수 금액을 유지하세요. 숫자를 읽을 수 없거나 문서에 없으면 0으로 두고 추측하지 마세요.
조달번호나 G2B 식별번호가 있으면 procurementNumber에 적고 isProcurement을 true로 두세요.
공사비·시공비·설치공사비는 일반 품목으로 만들지 말고 constructionAmount에 견적 공사비를 적으세요.
실공사비·원가가 문서에 명시된 경우에만 actualConstructionCost에 적고, 없으면 0으로 두세요.
quoteAmount에는 문서의 최종 견적 합계 금액을 적으세요.
행과 열 연결이 명확하면 confidence는 높음, 일부 확인이 필요하면 보통, 이름·수량·단가 중 하나라도 불확실하면 확인 필요로 두고 reviewNote에 확인할 내용을 적으세요.
같은 품목이 서로 다른 행으로 실제 반복된 경우 임의로 합치지 마세요.`,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_file",
                filename: document.original_name.slice(0, 180),
                file_data: fileData,
                detail: "high",
              },
              {
                type: "input_text",
                text: "이 견적서에서 품목·수량·단가·공사비를 저장 전 검토용으로 추출해 주세요.",
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "whizzup_quotation_items",
            description: "견적서 PDF 품목 자동입력 검토 자료",
            strict: true,
            schema: quotationAnalysisSchema,
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
        { error: "견적서에서 품목을 분석하지 못했습니다. 다시 시도해 주세요." },
        { status: 502 },
      );
    }

    const parsed = JSON.parse(extractOutputText(responsePayload)) as {
      quoteAmount?: unknown;
      constructionAmount?: unknown;
      actualConstructionCost?: unknown;
      items?: Array<Record<string, unknown>>;
    };
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
      .slice(0, 100)
      .map((item, index) => {
        const productName = cleanText(item.productName, 180);
        const specification = cleanText(item.specification, 500);
        const explicitProcurementNumber = cleanText(
          item.procurementNumber,
          120,
        );
        const procurementNumber =
          explicitProcurementNumber ||
          procurementNumbersFromText(productName, specification)[0] ||
          "";
        return {
          id: `pdf-${id}-${index + 1}`,
          productName,
          specification,
          quantity: Math.max(1, finiteNumber(item.quantity, 0) || 1),
          unit: cleanText(item.unit, 20) || "개",
          unitPrice: finiteNumber(item.unitPrice),
          amount: finiteNumber(item.amount),
          procurementNumber,
          isProcurement:
            Boolean(item.isProcurement) ||
            hasProcurementSignal(
              productName,
              specification,
              explicitProcurementNumber,
            ),
          confidence: ["높음", "보통", "확인 필요"].includes(
            String(item.confidence),
          )
            ? String(item.confidence)
            : "확인 필요",
          reviewNote: cleanText(item.reviewNote, 500),
        };
      })
      .filter((item) => item.productName);

    return Response.json({
      analysis: {
        documentId: id,
        documentName: document.original_name,
        quoteAmount: finiteNumber(parsed.quoteAmount),
        constructionAmount: finiteNumber(parsed.constructionAmount),
        actualConstructionCost: finiteNumber(parsed.actualConstructionCost),
        items,
      },
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
        { error: "AI 분석 결과를 읽지 못했습니다. 다시 시도해 주세요." },
        { status: 502 },
      );
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return Response.json(
        { error: "견적서 분석 시간이 길어졌습니다. 다시 시도해 주세요." },
        { status: 504 },
      );
    }
    return googleDriveStorageErrorResponse(error) ?? accessErrorResponse(error);
  }
}
