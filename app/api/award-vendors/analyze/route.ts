import { accessErrorResponse, requireApprovedMember } from "../../../../lib/collaboration";
import { AWARD_VENDOR_MAX_FILE_BYTES, ensureAwardVendorsReady, getAwardVendorBucket, type AwardVendorDocumentRow } from "../../../../lib/award-vendors";
import { downloadDriveFile, driveFileIdFromKey, googleDriveStorageErrorResponse } from "../../../../lib/google-drive-storage";
import { getOpenAIConfig } from "../../../../lib/openai-config";

export const dynamic = "force-dynamic";
function idOf(value: unknown) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : 0; }
function clean(value: unknown, max = 500) { return String(value ?? "").trim().slice(0, max); }
type OpenAIResponsePayload = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
  error?: { message?: string };
};
function outputText(payload: OpenAIResponsePayload) { return payload.output_text || (payload.output ?? []).flatMap((output) => output.content ?? []).map((content) => content.text ?? "").join(""); }
function dataUrl(bytes: Uint8Array, contentType: string) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${contentType};base64,${btoa(binary)}`;
}
const properties = Object.fromEntries(["companyName", "businessNumber", "representativeName", "businessType", "businessItem", "address", "phone", "email", "bankName", "accountNumber", "accountHolder", "contactName", "contactTitle", "contactPhone", "contactEmail"].map((key) => [key, { type: "string" }]));
const schema = { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

async function analyzeFile(bytes: Uint8Array, contentType: string, filename: string) {
  const { apiKey, model, configured } = await getOpenAIConfig();
  if (!configured) throw new Error("사이트 AI 연결을 먼저 설정해 주세요.");
  const fileData = dataUrl(bytes, contentType);
  const content = contentType === "application/pdf"
    ? [{ type: "input_file", filename, file_data: fileData }, { type: "input_text", text: "문서에서 업체 정보를 읽어 주세요." }]
    : [{ type: "input_image", image_url: fileData, detail: "high" }, { type: "input_text", text: "이미지에서 업체 정보를 읽어 주세요." }];
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, store: false, reasoning: { effort: "low" }, max_output_tokens: 2500, instructions: `사업자등록증, 통장 사본 또는 명함의 정보를 정확히 추출하세요. 보이지 않는 값은 추측하지 말고 빈 문자열로 반환하세요. 사업자번호와 계좌번호는 문서에 표시된 구분 기호를 유지하세요. 문서 종류에 해당하지 않는 필드는 빈 문자열로 두세요.`, input: [{ role: "user", content }], text: { format: { type: "json_schema", name: "award_vendor_information", strict: true, schema } } }), signal: AbortSignal.timeout(120000) });
  const payload = await response.json() as OpenAIResponsePayload;
  if (!response.ok) {
    const message = response.status === 429 ? "AI 사용량이 많습니다. 잠시 후 다시 시도해 주세요." : "문서 정보를 읽지 못했습니다.";
    throw Object.assign(new Error(message), { status: response.status === 429 ? 429 : 502 });
  }
  const parsed = JSON.parse(outputText(payload));
  return Object.fromEntries(Object.keys(properties).map((key) => [key, clean(parsed[key])]));
}

export async function POST(request: Request) {
  try {
    await requireApprovedMember();
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || !allowedTypes.has(file.type) || file.size < 1 || file.size > AWARD_VENDOR_MAX_FILE_BYTES) {
        return Response.json({ error: "JPG, PNG, WebP, PDF 파일을 12MB 이하로 올려 주세요." }, { status: 400 });
      }
      const extracted = await analyzeFile(new Uint8Array(await file.arrayBuffer()), file.type, file.name.slice(0, 240));
      return Response.json({ extracted });
    }
    const { id: rawId } = await request.json() as { id?: unknown };
    const id = idOf(rawId);
    const d1 = await ensureAwardVendorsReady();
    const document = await d1.prepare("SELECT * FROM award_vendor_documents WHERE id = ?").bind(id).first<AwardVendorDocumentRow>();
    if (!document) return Response.json({ error: "문서를 찾지 못했습니다." }, { status: 404 });
    const driveFileId = driveFileIdFromKey(document.object_key);
    const stored = driveFileId
      ? await downloadDriveFile(driveFileId)
      : await getAwardVendorBucket().get(document.object_key);
    if (!stored) return Response.json({ error: "저장된 문서를 찾지 못했습니다." }, { status: 404 });
    const extracted = await analyzeFile(new Uint8Array(await new Response(stored.body).arrayBuffer()), document.content_type, document.original_name);
    await d1.prepare("UPDATE award_vendor_documents SET extracted_json = ? WHERE id = ?").bind(JSON.stringify(extracted), id).run();
    return Response.json({ extracted });
  } catch (error) {
    const driveErrorResponse = googleDriveStorageErrorResponse(error);
    if (driveErrorResponse) return driveErrorResponse;
    if (error instanceof Error && "status" in error) return Response.json({ error: error.message }, { status: Number((error as Error & { status: number }).status) || 502 });
    if (error instanceof DOMException && error.name === "TimeoutError") return Response.json({ error: "문서 분석 시간이 길어졌습니다. 다시 시도해 주세요." }, { status: 504 });
    if (error instanceof SyntaxError) return Response.json({ error: "문서 분석 결과를 읽지 못했습니다." }, { status: 502 });
    return accessErrorResponse(error);
  }
}
