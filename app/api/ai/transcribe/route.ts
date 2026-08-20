import {
  accessErrorResponse,
  requireMemberPermission,
} from "../../../../lib/collaboration";
import { getOpenAIConfig } from "../../../../lib/openai-config";

export const dynamic = "force-dynamic";

const maxAudioBytes = 15 * 1024 * 1024;
const allowedAudioTypes = new Set([
  "audio/flac",
  "audio/m4a",
  "audio/mp3",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "video/mp4",
  "video/webm",
]);

function safeAudioName(file: File) {
  const fallbackExtension = file.type.includes("mp4") ? "mp4" : "webm";
  const suppliedName = file.name.trim().replace(/[^a-zA-Z0-9._-]/g, "");
  return suppliedName || `whizzup-voice.${fallbackExtension}`;
}

export async function POST(request: Request) {
  try {
    await requireMemberPermission("ai:voice");

    const requestData = await request.formData();
    const audio = requestData.get("audio");
    if (!(audio instanceof File) || audio.size < 500) {
      return Response.json(
        { error: "녹음된 음성이 너무 짧거나 비어 있습니다." },
        { status: 400 },
      );
    }
    if (audio.size > maxAudioBytes) {
      return Response.json(
        { error: "음성 녹음은 한 번에 15MB 이하로 입력해 주세요." },
        { status: 413 },
      );
    }
    if (audio.type && !allowedAudioTypes.has(audio.type.split(";")[0])) {
      return Response.json(
        { error: "현재 휴대폰의 음성 파일 형식을 지원하지 않습니다." },
        { status: 415 },
      );
    }

    const { apiKey, configured } = await getOpenAIConfig();
    if (!configured) {
      return Response.json(
        { error: "사이트 AI 연결 준비 중입니다. 관리자에게 확인해 주세요." },
        { status: 503 },
      );
    }

    const openAiData = new FormData();
    openAiData.append("file", audio, safeAudioName(audio));
    openAiData.append("model", "gpt-4o-mini-transcribe");
    openAiData.append("language", "ko");
    openAiData.append("response_format", "json");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: openAiData,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = (await response.json().catch(() => ({}))) as {
      text?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      return Response.json(
        {
          error:
            payload.error?.message ||
            "음성을 글자로 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: response.status },
      );
    }

    const text = payload.text?.trim();
    if (!text) {
      return Response.json(
        { error: "음성에서 변환할 내용을 찾지 못했습니다." },
        { status: 422 },
      );
    }
    const compactText = text.replace(/[\s.,!?'"’“”]/g, "");
    if (
      compactText.length <= 20 &&
      ["위즈업영업기록입니다", "위즈업의영업기록입니다"].includes(compactText)
    ) {
      return Response.json({ text: "", discarded: true });
    }
    return Response.json({ text });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return Response.json(
        { error: "음성 변환 시간이 길어졌습니다. 다시 시도해 주세요." },
        { status: 504 },
      );
    }
    return accessErrorResponse(error);
  }
}
