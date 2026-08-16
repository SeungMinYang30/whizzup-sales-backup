"use client";

import { useState } from "react";

type Result = {
  dryRun: boolean;
  quotations: number;
  files: number;
  moved: number;
  renamed: number;
  removedFolders: number;
  failures: Array<{ quotationId: number; kind: string; error: string }>;
  folder: string;
  error?: string;
};

export default function QuotationDriveReorganizePage() {
  const [running, setRunning] = useState<"dry" | "apply" | "">("");
  const [result, setResult] = useState<Result | null>(null);

  async function run(dryRun: boolean) {
    setRunning(dryRun ? "dry" : "apply");
    setResult(null);
    try {
      const response = await fetch("/api/quotations/files/reorganize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const payload = await response.json().catch(() => ({})) as Result;
      if (!response.ok && response.status !== 207) {
        throw new Error(payload.error || "견적서 파일 정리를 완료하지 못했습니다.");
      }
      setResult(payload);
    } catch (error) {
      setResult({
        dryRun,
        quotations: 0,
        files: 0,
        moved: 0,
        renamed: 0,
        removedFolders: 0,
        failures: [],
        folder: "",
        error: error instanceof Error ? error.message : "견적서 파일 정리를 완료하지 못했습니다.",
      });
    } finally {
      setRunning("");
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: "48px auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1>견적서 Drive 정리</h1>
      <p>기존 파일 ID를 유지한 채 기관자료 보기_견적서 폴더로 이동하고 표준 파일명으로 바꿉니다.</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "24px 0" }}>
        <button disabled={Boolean(running)} onClick={() => void run(true)}>
          {running === "dry" ? "확인 중…" : "변경 대상 미리보기"}
        </button>
        <button disabled={Boolean(running)} onClick={() => void run(false)}>
          {running === "apply" ? "정리 중…" : "실제 이동·이름 변경"}
        </button>
      </div>
      {result && (
        <section aria-live="polite" style={{ border: "1px solid #dbe3f0", borderRadius: 12, padding: 20 }}>
          {result.error ? (
            <p role="alert" style={{ color: "#b42318" }}>{result.error}</p>
          ) : (
            <>
              <strong>{result.dryRun ? "미리보기 완료" : "정리 완료"}</strong>
              <p>견적 {result.quotations}건 · 파일 {result.files}개 · 이동 {result.moved}개 · 이름 변경 {result.renamed}개 · 빈 폴더 삭제 {result.removedFolders}개</p>
              <p>대상 폴더: {result.folder}</p>
              {result.failures.length > 0 && (
                <p role="alert" style={{ color: "#b42318" }}>실패 {result.failures.length}개가 있어 상세 로그 확인이 필요합니다.</p>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}
