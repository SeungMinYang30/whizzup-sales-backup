import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../../lib/collaboration";
import { getOpenAIConfig } from "../../../../lib/openai-config";
import {
  hasProcurementSignal,
  procurementNumbersFromText,
} from "../../../../lib/procurement-product";

export const dynamic = "force-dynamic";

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

const schema = {
  type: "object",
  properties: {
    quoteAmount: { type: "number" },
    constructionAmount: { type: "number" },
    discountAmount: { type: "number" },
    extraAmount: { type: "number" },
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
          note: { type: "string" },
          procurement: { type: "boolean" },
          procurementChannel: { type: "string" },
          procurementNumber: { type: "string" },
          procurementFeeRate: {
            type: "number",
            description: "문서에 적힌 퍼센트 숫자입니다. 0.54%는 0.54로 입력합니다.",
          },
          confidence: { type: "string", enum: ["높음", "보통", "확인 필요"] },
          reviewNote: { type: "string" },
        },
        required: [
          "productName", "specification", "quantity", "unit", "unitPrice", "amount",
          "note", "procurement", "procurementChannel", "procurementNumber",
          "procurementFeeRate", "confidence", "reviewNote",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["quoteAmount", "constructionAmount", "discountAmount", "extraAmount", "items"],
  additionalProperties: false,
};

function outputText(payload: OpenAIResponse) {
  if (payload.output_text) return payload.output_text;
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((item) => item.text ?? "")
    .filter(Boolean)
    .join("\n");
}

function normalizeExtractedProcurementFeeRate(value: unknown) {
  let rate = Math.max(0, Number(value) || 0);
  if (!rate) return 0;
  // 외부 문서는 0.54%를 0.54 또는 드물게 54로 반환할 수 있습니다.
  // 내부 견적 계산은 소수 비율(0.0054)을 사용하므로 두 표기를 모두 정규화합니다.
  if (rate > 1) rate /= 100;
  if (rate > 0.05) rate /= 100;
  return Math.min(0.05, rate);
}

function dataUrl(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  }
  return `data:application/pdf;base64,${btoa(binary)}`;
}

function money(value: unknown, min = -100_000_000_000) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.round(Math.min(100_000_000_000, Math.max(min, parsed)))
    : 0;
}

function text(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

export async function POST(request: Request) {
  try {
    await requireApprovedMember();
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || !file.name.toLocaleLowerCase().endsWith(".pdf")) {
      return Response.json({ error: "분석할 PDF 견적서를 선택해 주세요." }, { status: 400 });
    }
    if (file.size < 1 || file.size > 20 * 1024 * 1024) {
      return Response.json({ error: "PDF 견적서는 20MB 이하 파일만 분석할 수 있습니다." }, { status: 400 });
    }
    if (await file.slice(0, 5).text() !== "%PDF-") {
      return Response.json({ error: "올바른 PDF 파일이 아닙니다." }, { status: 400 });
    }
    const { apiKey, model, configured } = await getOpenAIConfig();
    if (!configured) {
      return Response.json({ error: "사이트 AI 연결을 먼저 설정해 주세요." }, { status: 503 });
    }
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "low" },
        max_output_tokens: 16_000,
        instructions: `당신은 관공서 제출용 외부 견적서 분석 도우미입니다.
문서에 실제로 적힌 값만 추출하고 내부 수수료율·마진율·공급업체를 추측하지 마세요.
품목 행에서 품명, 규격·모델명, 수량, 단위, 단가, 행 금액, 비고를 추출하세요.
조달·나라장터·G2B·S2B·학교장터·디지털서비스몰 표시가 있으면 조달 여부, 채널, 물품식별번호 또는 조달번호, 문서에 명시된 조달수수료율을 추출하세요. procurementFeeRate는 퍼센트 숫자로 적으세요. 예를 들어 0.54%는 0.54이며, 문서에 수수료율이 없으면 0입니다.
설치비·시공비·공사비는 일반 품목으로 만들지 말고 constructionAmount에 합산하세요.
할인·차감은 discountAmount, 운송비·추가비용은 extraAmount에 각각 양수로 적으세요.
quoteAmount는 문서의 최종 견적금액입니다. 표 머리글, 소계, 공급가, 부가세, 합계는 품목으로 만들지 마세요.
같은 품목이 여러 행이면 임의로 합치지 마세요. 읽을 수 없는 값은 0 또는 빈 문자열로 두고 reviewNote에 확인 내용을 적으세요.`,
        input: [{
          role: "user",
          content: [
            { type: "input_file", filename: file.name.slice(0, 180), file_data: dataUrl(new Uint8Array(await file.arrayBuffer())), detail: "high" },
            { type: "input_text", text: "이 외부 견적서를 현재 견적 초안으로 불러오기 전에 검토할 수 있도록 구조화해 주세요." },
          ],
        }],
        text: { format: { type: "json_schema", name: "whizzup_external_quotation_import", strict: true, schema } },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const payload = await response.json() as OpenAIResponse;
    if (!response.ok) {
      return Response.json(
        { error: response.status === 429 ? "AI 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요." : "외부 견적서를 분석하지 못했습니다." },
        { status: response.status === 429 ? 429 : 502 },
      );
    }
    const parsed = JSON.parse(outputText(payload)) as Record<string, unknown>;
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
      .slice(0, 100)
      .flatMap((raw, index) => {
        if (!raw || typeof raw !== "object") return [];
        const item = raw as Record<string, unknown>;
        const productName = text(item.productName, 180);
        if (!productName) return [];
        const specification = text(item.specification, 500);
        const explicitNumber = text(item.procurementNumber, 120);
        const procurementNumber = explicitNumber || procurementNumbersFromText(productName, specification, text(item.note, 500))[0] || "";
        const quantity = Math.max(1, money(item.quantity, 0) || 1);
        const amount = money(item.amount);
        const unitPrice = money(item.unitPrice) || (amount ? Math.round(amount / quantity) : 0);
        const procurement = Boolean(item.procurement) || hasProcurementSignal(productName, specification, text(item.note, 500), explicitNumber);
        return [{
          id: `pdf-${index + 1}`,
          productName,
          specification,
          quantity,
          unit: text(item.unit, 20) || "개",
          unitPrice,
          amount: amount || unitPrice * quantity,
          note: text(item.note, 500),
          procurement,
          procurementChannel: procurement ? text(item.procurementChannel, 40) || "G2B" : "",
          procurementNumber: procurement ? procurementNumber : "",
          procurementFeeRate: procurement ? normalizeExtractedProcurementFeeRate(item.procurementFeeRate) : 0,
          confidence: ["높음", "보통", "확인 필요"].includes(String(item.confidence)) ? String(item.confidence) : "확인 필요",
          reviewNote: text(item.reviewNote, 500),
        }];
      });
    return Response.json({ analysis: {
      sourceName: file.name,
      sourceType: "pdf",
      quoteAmount: money(parsed.quoteAmount),
      constructionAmount: money(parsed.constructionAmount),
      discountAmount: Math.max(0, money(parsed.discountAmount)),
      extraAmount: Math.max(0, money(parsed.extraAmount)),
      items,
    } });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: "AI 분석 결과를 읽지 못했습니다. 다시 분석해 주세요." }, { status: 502 });
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return Response.json({ error: "견적서 분석 시간이 길어졌습니다. 다시 시도해 주세요." }, { status: 504 });
    }
    return accessErrorResponse(error);
  }
}
