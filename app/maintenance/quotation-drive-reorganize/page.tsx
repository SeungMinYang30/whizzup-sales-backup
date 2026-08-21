"use client";

import { useState } from "react";

type Result = {
  dryRun: boolean;
  quotations: number;
  files: number;
  moved: number;
  renamed: number;
  mirrored: number;
  checked: number;
  referenceDocuments: number;
  referenceFiles: number;
  removedFolders: number;
  failures: Array<{ quotationId: number; kind: string; error: string }>;
  folder: string;
  nextAfterId?: number;
  done?: boolean;
  error?: string;
};

export default function QuotationDriveReorganizePage() {
  const [running, setRunning] = useState<"dry" | "apply" | "">("");
  const [result, setResult] = useState<Result | null>(null);

  async function run(dryRun: boolean) {
    setRunning(dryRun ? "dry" : "apply");
    setResult(null);
    try {
      const total: Result = {
        dryRun,
        quotations: 0,
        files: 0,
        moved: 0,
        renamed: 0,
        mirrored: 0,
        checked: 0,
        referenceDocuments: 0,
        referenceFiles: 0,
        removedFolders: 0,
        failures: [],
        folder: "",
      };
      for (const endpoint of [
        "/api/quotations/files/reorganize",
        "/api/quotation-documents/reorganize",
      ]) {
        let afterId = 0;
        for (let batch = 0; batch < 1_000; batch += 1) {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dryRun, afterId }),
          });
          const payload = await response.json().catch(() => ({})) as Result;
          if (!response.ok && response.status !== 207) {
            throw new Error(payload.error || "견적서 파일 정리를 완료하지 못했습니다.");
          }
          total.quotations += payload.quotations || 0;
          total.referenceDocuments += payload.referenceDocuments || 0;
          total.files += payload.files || 0;
          total.referenceFiles += payload.referenceFiles || 0;
          total.moved += payload.moved || 0;
          total.renamed += payload.renamed || 0;
          total.mirrored += payload.mirrored || 0;
          total.checked += payload.checked || 0;
          total.removedFolders += payload.removedFolders || 0;
          total.failures.push(...(payload.failures || []));
          total.folder = total.folder || payload.folder;
          setResult({ ...total });
          if (payload.done) break;
          const nextAfterId = Math.max(0, Number(payload.nextAfterId) || 0);
          if (nextAfterId <= afterId) throw new Error("견적서 파일 정리 위치를 이어가지 못했습니다.");
          afterId = nextAfterId;
        }
      }
      setResult({ ...total });
    } catch (error) {
      setResult({
        dryRun,
        quotations: 0,
        files: 0,
        moved: 0,
        renamed: 0,
        mirrored: 0,
        checked: 0,
        referenceDocuments: 0,
        referenceFiles: 0,
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
      <p>기존 파일 ID와 견적 수정일을 유지한 채 지역/기관/견적서/사업 차수/연도 폴더로 정리하고, 견적서 전체 폴더의 동기화 사본은 그대로 유지합니다.</p>
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
              <p>최종 견적 {result.quotations}건 · 외부 참고 {result.referenceDocuments}건 · 점검 파일 {result.checked}개 · 이동 {result.moved}개 · 이름 변경 {result.renamed}개 · 전체 폴더 동기화 {result.mirrored}개 · 빈 폴더 삭제 {result.removedFolders}개</p>
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
