import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { register } from "node:module";

register(new URL("./typescript-resolver.mjs", import.meta.url));

const {
  ResourceUploadError,
  resourceUploadErrorMessage,
  uploadResourceFilesSequentially,
} = await import("../lib/resource-upload-client.ts");
const {
  RESOURCE_UPLOAD_CHUNK_ALIGNMENT_BYTES,
  RESOURCE_UPLOAD_CHUNK_BYTES,
  RESOURCE_UPLOAD_MAX_RETRIES,
  VERCEL_FUNCTION_BODY_LIMIT_BYTES,
} = await import("../lib/resource-upload-config.ts");

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeUploadFile(name, size, type = "application/octet-stream", fill = 17) {
  const bytes = Buffer.alloc(size, fill);
  return {
    bytes,
    file: {
      name,
      size,
      type,
      slice(start = 0, end = size, contentType = type) {
        return new Blob([bytes.subarray(start, end)], { type: contentType });
      },
    },
  };
}

function createDriveUploadMock({ failChunkStart, failCount = 0 } = {}) {
  const sessions = [];
  const chunks = [];
  const attempts = new Map();
  const events = [];

  const fetchImpl = async (_input, init = {}) => {
    if (init.method === "POST") {
      const metadata = JSON.parse(init.body);
      const index = sessions.length;
      const session = {
        index,
        metadata,
        uploadUrl: `https://drive.test/session/${index}`,
        completed: false,
      };
      sessions.push(session);
      events.push(`session:${metadata.fileName}`);
      return jsonResponse({ uploadUrl: session.uploadUrl, folderId: "resource-folder" });
    }

    assert.equal(init.method, "PUT");
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(init.headers["Content-Range"]);
    assert.ok(range, "Content-Range must be valid");
    const start = Number(range[1]);
    const end = Number(range[2]);
    const total = Number(range[3]);
    const uploadUrl = init.headers["X-Drive-Upload-Url"];
    const session = sessions.find((candidate) => candidate.uploadUrl === uploadUrl);
    assert.ok(session, "upload session must exist");

    const attemptKey = `${session.index}:${start}`;
    const attempt = (attempts.get(attemptKey) || 0) + 1;
    attempts.set(attemptKey, attempt);
    events.push(`chunk:${session.metadata.fileName}:${start}:${attempt}`);

    if (start === failChunkStart && attempt <= failCount) {
      return jsonResponse({ code: "UPLOAD_FAILED", error: "temporary failure" }, 503);
    }

    const body = Buffer.from(await init.body.arrayBuffer());
    assert.equal(body.length, end - start + 1);
    chunks.push({ sessionIndex: session.index, start, end, total, body });
    const complete = end === total - 1;
    if (complete) {
      session.completed = true;
      events.push(`complete:${session.metadata.fileName}`);
      return jsonResponse({ complete: true, file: { id: `drive-file-${session.index}` } });
    }
    return jsonResponse({ complete: false });
  };

  return { fetchImpl, sessions, chunks, attempts, events };
}

test("resource upload chunk is 3MiB, aligned, and below Vercel's request limit", () => {
  assert.equal(RESOURCE_UPLOAD_CHUNK_BYTES, 3 * 1024 * 1024);
  assert.equal(RESOURCE_UPLOAD_CHUNK_BYTES % RESOURCE_UPLOAD_CHUNK_ALIGNMENT_BYTES, 0);
  assert.ok(RESOURCE_UPLOAD_CHUNK_BYTES < VERCEL_FUNCTION_BODY_LIMIT_BYTES);
  assert.equal(RESOURCE_UPLOAD_MAX_RETRIES, 3);
});

test("small, large, and Korean-named files are reconstructed as one Drive file", async (t) => {
  const cases = [
    ["작은 문서.pdf", 700_000, "application/pdf"],
    ["5MB 이상 발표자료.pptx", 5 * 1024 * 1024 + 123, "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["20MB 이상 제안서.pdf", 20 * 1024 * 1024 + 777, "application/pdf"],
  ];

  for (let index = 0; index < cases.length; index += 1) {
    const [name, size, type] = cases[index];
    await t.test(name, async () => {
      const source = makeUploadFile(name, size, type, 31 + index);
      const mock = createDriveUploadMock();
      const uploaded = await uploadResourceFilesSequentially([source.file], {
        title: "자료 제목",
        category: "manual",
        fetchImpl: mock.fetchImpl,
      });

      assert.deepEqual(uploaded, [{ fileId: "drive-file-0", folderId: "resource-folder", originalName: name }]);
      assert.equal(mock.sessions.length, 1);
      assert.deepEqual(mock.sessions[0].metadata, {
        fileName: name,
        mimeType: type,
        sizeBytes: size,
        title: "자료 제목",
        category: "manual",
      });
      assert.equal(mock.chunks.length, Math.ceil(size / RESOURCE_UPLOAD_CHUNK_BYTES));
      assert.ok(mock.chunks.every((chunk) => chunk.body.length <= RESOURCE_UPLOAD_CHUNK_BYTES));
      for (const chunk of mock.chunks.slice(0, -1)) {
        assert.equal(chunk.body.length, RESOURCE_UPLOAD_CHUNK_BYTES);
        assert.equal(chunk.body.length % RESOURCE_UPLOAD_CHUNK_ALIGNMENT_BYTES, 0);
      }
      const reconstructed = Buffer.concat(
        mock.chunks
          .toSorted((left, right) => left.start - right.start)
          .map((chunk) => chunk.body),
      );
      assert.deepEqual(reconstructed, source.bytes);
      assert.ok(mock.sessions[0].completed);
    });
  }
});

test("multiple selected files upload sequentially and create one Drive file each", async () => {
  const first = makeUploadFile("첫 번째.pdf", 1_100_000, "application/pdf", 41);
  const second = makeUploadFile("두 번째.pptx", 7 * 1024 * 1024, "application/vnd.openxmlformats-officedocument.presentationml.presentation", 42);
  const mock = createDriveUploadMock();

  const uploaded = await uploadResourceFilesSequentially([first.file, second.file], {
    title: "다중 자료",
    category: "proposal",
    fetchImpl: mock.fetchImpl,
  });

  assert.equal(uploaded.length, 2);
  assert.equal(mock.sessions.length, 2);
  assert.ok(mock.events.indexOf("session:두 번째.pptx") > mock.events.indexOf("complete:첫 번째.pdf"));
  assert.equal(mock.sessions.filter((session) => session.completed).length, 2);
});

test("a failed chunk retries three times without resending successful chunks", async () => {
  const source = makeUploadFile("재시도.pdf", 8 * 1024 * 1024, "application/pdf", 73);
  const mock = createDriveUploadMock({
    failChunkStart: RESOURCE_UPLOAD_CHUNK_BYTES,
    failCount: 3,
  });
  const delays = [];

  await uploadResourceFilesSequentially([source.file], {
    title: "재시도 자료",
    category: "other",
    fetchImpl: mock.fetchImpl,
    sleep: async (milliseconds) => delays.push(milliseconds),
  });

  assert.equal(mock.attempts.get("0:0"), 1);
  assert.equal(mock.attempts.get(`0:${RESOURCE_UPLOAD_CHUNK_BYTES}`), 4);
  assert.equal(mock.attempts.get(`0:${RESOURCE_UPLOAD_CHUNK_BYTES * 2}`), 1);
  assert.deepEqual(delays, [400, 800, 1600]);
});

test("Vercel 413 responses are reported as a payload-limit error", async () => {
  const source = makeUploadFile("413.pdf", 1_000_000, "application/pdf");
  let postComplete = false;
  const fetchImpl = async (_input, init = {}) => {
    if (init.method === "POST") {
      postComplete = true;
      return jsonResponse({ uploadUrl: "https://drive.test/session/413", folderId: "resource-folder" });
    }
    return jsonResponse({ code: "VERCEL_PAYLOAD_LIMIT", error: "too large" }, 413);
  };

  await assert.rejects(
    uploadResourceFilesSequentially([source.file], {
      title: "413 재현",
      category: "other",
      fetchImpl,
    }),
    (error) => {
      assert.ok(error instanceof ResourceUploadError);
      assert.equal(error.code, "VERCEL_PAYLOAD_LIMIT");
      assert.match(resourceUploadErrorMessage(error), /Vercel 요청 용량 제한/);
      return true;
    },
  );
  assert.equal(postComplete, true);
});

test("resource library registers DB records only after Drive upload and blocks duplicate submission", async () => {
  const page = await readFile(new URL("../app/resource-library-page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/resources/upload-session/route.ts", import.meta.url), "utf8");

  assert.match(page, /uploadLockRef\.current/);
  assert.match(page, /databaseCommitted/);
  assert.match(page, /attachmentCommitted/);
  assert.match(page, /uploadResourceFilesSequentially[\s\S]*fetch\("\/api\/resources"/);
  assert.match(page, /disabled=\{busy \|\| !configured\}/);
  assert.match(route, /RESOURCE_UPLOAD_CHUNK_BYTES/);
  assert.match(route, /VERCEL_PAYLOAD_LIMIT/);
});
