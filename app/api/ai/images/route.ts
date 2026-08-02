import {
  accessErrorResponse,
  requireMemberPermission,
} from "../../../../lib/collaboration";
import { getOpenAIConfig } from "../../../../lib/openai-config";

export const dynamic = "force-dynamic";

const maximumImageCount = 5;
const maximumImageBytes = 10 * 1024 * 1024;
const supportedImageTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type OpenAIImageResponse = {
  output_text?: string;
  error?: { message?: string };
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function extractImageAnalysis(payload: OpenAIImageResponse) {
  if (payload.output_text?.trim()) return payload.output_text.trim();
  for (const item of payload.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "refusal" && part.refusal) {
        throw new Error("해당 사진은 AI가 정리할 수 없습니다.");
      }
      if (part.type === "output_text" && part.text?.trim()) {
        return part.text.trim();
      }
    }
  }
  throw new Error("사진에서 정리할 내용을 찾지 못했습니다.");
}

export async function POST(request: Request) {
  try {
    await requireMemberPermission("ai:images");
    const requestData = await request.formData();
    const images = requestData
      .getAll("images")
      .filter((entry): entry is File => entry instanceof File);

    if (!images.length || images.length > maximumImageCount) {
      return Response.json(
        { error: "사진은 한 번에 1장부터 5장까지 분석할 수 있습니다." },
        { status: 400 },
      );
    }
    if (
      images.some(
        (image) =>
          !supportedImageTypes.has(image.type) ||
          image.size < 100 ||
          image.size > maximumImageBytes,
      )
    ) {
      return Response.json(
        {
          error:
            "JPG·PNG·WEBP·GIF 사진을 한 장당 10MB 이하로 올려 주세요.",
        },
        { status: 415 },
      );
    }

    const { apiKey, model, configured } = await getOpenAIConfig();
    if (!configured) {
      return Response.json(
        { error: "사이트 AI 연결 준비 중입니다. 관리자에게 확인해 주세요." },
        { status: 503 },
      );
    }

    const imageContent = await Promise.all(
      images.map(async (image) => ({
        type: "input_image" as const,
        image_url: `data:${image.type};base64,${bytesToBase64(
          new Uint8Array(await image.arrayBuffer()),
        )}`,
        detail: "high" as const,
      })),
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          store: false,
          reasoning: { effort: "none" },
          max_output_tokens: 4_000,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `첨부된 사진을 위즈업 영업 기록 입력용 텍스트로 정리하세요.
사진이 여러 장이면 같은 업무의 연속 화면인지 먼저 판단하고 중복 문장은 한 번만 적으세요.
학교·기관명, 담당자와 직책, 연락처와 메일, 활동 날짜, 예산명과 금액, 제품·사업명, 일정, 요청사항, 상담·진행 내용을 보이는 그대로 추출하세요.
확인되지 않는 값은 추측하거나 만들어내지 말고 생략하세요.
여러 기관이 있으면 [기관명] 제목으로 나눠 쓰고, 표·메신저·메모·견적 화면의 의미가 유지되도록 자연스러운 한국어 문장으로 정리하세요.
AI 의견이나 추천 대응은 넣지 말고, 사용자가 바로 영업 기록 입력창에서 확인·수정할 수 있는 내용만 출력하세요.`,
                },
                ...imageContent,
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = (await response.json().catch(() => ({}))) as OpenAIImageResponse;
    if (!response.ok) {
      return Response.json(
        {
          error:
            payload.error?.message ||
            "사진을 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: response.status },
      );
    }
    return Response.json({ text: extractImageAnalysis(payload), model });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return Response.json(
        { error: "사진 분석 시간이 길어졌습니다. 다시 시도해 주세요." },
        { status: 504 },
      );
    }
    if (error instanceof Error && error.message.includes("사진")) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    return accessErrorResponse(error);
  }
}
