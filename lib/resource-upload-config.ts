export const RESOURCE_UPLOAD_CHUNK_ALIGNMENT_BYTES = 256 * 1024;
export const RESOURCE_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;
export const RESOURCE_UPLOAD_MAX_RETRIES = 3;
export const RESOURCE_UPLOAD_RETRY_BASE_DELAY_MS = 400;
export const VERCEL_FUNCTION_BODY_LIMIT_BYTES = 4_500_000;

if (RESOURCE_UPLOAD_CHUNK_BYTES % RESOURCE_UPLOAD_CHUNK_ALIGNMENT_BYTES !== 0) {
  throw new Error("Resource upload chunks must use a 256KiB boundary.");
}

if (RESOURCE_UPLOAD_CHUNK_BYTES >= VERCEL_FUNCTION_BODY_LIMIT_BYTES) {
  throw new Error("Resource upload chunks must stay below the Vercel Function body limit.");
}
