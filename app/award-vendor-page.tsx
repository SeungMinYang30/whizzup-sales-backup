"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

type DocumentType = "business_registration" | "bankbook" | "business_card";
type VendorDocument = { id: number; documentType: DocumentType; originalName: string; url: string; createdAt: string };
type Vendor = VendorDraft & { id: number; documents: VendorDocument[]; updatedAt: string };
type VendorDraft = {
  companyName: string; businessNumber: string; representativeName: string; businessType: string; businessItem: string;
  address: string; phone: string; email: string; bankName: string; accountNumber: string; accountHolder: string;
  contactName: string; contactTitle: string; contactPhone: string; contactEmail: string; notes: string;
};
const emptyDraft: VendorDraft = { companyName: "", businessNumber: "", representativeName: "", businessType: "", businessItem: "", address: "", phone: "", email: "", bankName: "", accountNumber: "", accountHolder: "", contactName: "", contactTitle: "", contactPhone: "", contactEmail: "", notes: "" };
const documentLabels: Record<DocumentType, string> = { business_registration: "사업자등록증", bankbook: "통장 사본", business_card: "명함" };
const documentHints: Record<DocumentType, string> = { business_registration: "업체명·사업자번호·대표자·주소·업태·종목", bankbook: "은행·계좌번호·예금주", business_card: "담당자·직함·연락처·이메일" };
const VENDOR_PAGE_SIZE = 30;

export default function AwardVendorPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<VendorDraft>(emptyDraft);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<DocumentType | null>(null);
  const [message, setMessage] = useState("");
  const selected = vendors.find((vendor) => vendor.id === selectedId) ?? null;
  const filtered = useMemo(() => vendors.filter((vendor) => `${vendor.companyName} ${vendor.businessNumber} ${vendor.contactName} ${vendor.phone}`.toLowerCase().includes(search.trim().toLowerCase())), [vendors, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / VENDOR_PAGE_SIZE));
  const pageVendors = useMemo(() => {
    const offset = (page - 1) * VENDOR_PAGE_SIZE;
    return filtered.slice(offset, offset + VENDOR_PAGE_SIZE);
  }, [filtered, page]);

  async function load(preferredId?: number) {
    const response = await fetch("/api/award-vendors", { cache: "no-store" });
    const payload = await response.json() as { vendors?: Vendor[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "업체 목록을 불러오지 못했습니다.");
    const next = payload.vendors ?? [];
    setVendors(next);
    const id = preferredId ?? selectedId ?? next[0]?.id ?? null;
    const vendor = next.find((item) => item.id === id) ?? null;
    setSelectedId(vendor?.id ?? null);
    setDraft(vendor ? { ...emptyDraft, ...vendor } : emptyDraft);
  }
  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, []);
  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);
  function choose(vendor: Vendor) { setSelectedId(vendor.id); setDraft({ ...emptyDraft, ...vendor }); setMessage(""); }
  function change(field: keyof VendorDraft, value: string) { setDraft((current) => ({ ...current, [field]: value })); }
  function newVendor() { setSelectedId(null); setDraft(emptyDraft); setMessage("사업자등록증·통장 사본·명함을 먼저 올리거나 업체 정보를 직접 입력해 주세요."); }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.companyName.trim()) { setMessage("업체명을 입력해 주세요."); return; }
    try {
      setBusy(true); setMessage("");
      const response = await fetch("/api/award-vendors", { method: selectedId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selectedId ? { id: selectedId, ...draft } : draft) });
      const payload = await response.json() as { vendor?: Vendor; error?: string };
      if (!response.ok || !payload.vendor) throw new Error(payload.error || "업체 정보를 저장하지 못했습니다.");
      await load(payload.vendor.id);
      setMessage("업체 정보를 저장했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "저장하지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function upload(type: DocumentType, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    let activeVendorId = selectedId;
    try {
      setUploading(type); setMessage(`${documentLabels[type]}을 올리고 정보를 읽는 중입니다.`);
      let extracted: Partial<VendorDraft> = {};
      if (!activeVendorId) {
        const analyzeForm = new FormData(); analyzeForm.set("file", file);
        const analyzeResponse = await fetch("/api/award-vendors/analyze", { method: "POST", body: analyzeForm });
        const analyzePayload = await analyzeResponse.json() as { extracted?: Partial<VendorDraft>; error?: string };
        if (!analyzeResponse.ok) throw new Error(analyzePayload.error || "문서 정보를 읽지 못했습니다.");
        extracted = analyzePayload.extracted ?? {};
        const fallbackCompanyName = file.name.replace(/\.[^.]+$/, "").trim().slice(0, 120) || "새 협력사";
        const createDraft = { ...draft, ...Object.fromEntries(Object.entries(extracted).filter(([, value]) => String(value ?? "").trim())), companyName: String(extracted.companyName || draft.companyName || fallbackCompanyName).trim() };
        const createResponse = await fetch("/api/award-vendors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(createDraft) });
        const createPayload = await createResponse.json() as { vendor?: Vendor; error?: string };
        if (!createResponse.ok || !createPayload.vendor) throw new Error(createPayload.error || "업체 초안을 만들지 못했습니다.");
        activeVendorId = createPayload.vendor.id;
        setSelectedId(activeVendorId);
      }
      const form = new FormData(); form.set("vendorId", String(activeVendorId)); form.set("documentType", type); form.set("file", file);
      const uploadResponse = await fetch("/api/award-vendors/documents", { method: "POST", body: form });
      const uploadPayload = await uploadResponse.json() as { document?: VendorDocument; error?: string };
      if (!uploadResponse.ok || !uploadPayload.document) throw new Error(uploadPayload.error || "문서를 올리지 못했습니다.");
      if (!Object.keys(extracted).length) {
        const analyzeResponse = await fetch("/api/award-vendors/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: uploadPayload.document.id }) });
        const analyzePayload = await analyzeResponse.json() as { extracted?: Partial<VendorDraft>; error?: string };
        if (!analyzeResponse.ok) throw new Error(analyzePayload.error || "문서 정보를 읽지 못했습니다.");
        extracted = analyzePayload.extracted ?? {};
      }
      await load(activeVendorId);
      setDraft((current) => ({ ...current, ...Object.fromEntries(Object.entries(extracted).filter(([, value]) => String(value ?? "").trim())) }));
      setMessage("문서에서 읽은 정보를 입력했습니다. 확인·수정 후 ‘업체 정보 저장’을 눌러 주세요.");
    } catch (error) { if (activeVendorId) await load(activeVendorId).catch(() => undefined); setMessage(error instanceof Error ? error.message : "문서를 처리하지 못했습니다."); }
    finally { setUploading(null); }
  }

  async function removeDocument(id: number) {
    if (!window.confirm("이 첨부 문서를 삭제할까요?")) return;
    const response = await fetch("/api/award-vendors/documents", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { setMessage(payload.error || "문서를 삭제하지 못했습니다."); return; }
    if (selectedId) await load(selectedId);
    setMessage("첨부 문서를 삭제했습니다.");
  }

  const field = (key: keyof VendorDraft, label: string, placeholder = "") => <label><span>{label}</span><input value={draft[key]} onChange={(event) => change(key, event.target.value)} placeholder={placeholder} /></label>;
  return (
    <section className="award-vendor-page">
      <aside className="award-vendor-directory">
        <header><div><strong>등록 업체</strong><span>{vendors.length}곳</span></div><button type="button" onClick={newVendor}>+ 새 업체</button></header>
        <input className="award-vendor-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="업체명·사업자번호·담당자 검색" />
        <div className="award-vendor-list">
          {pageVendors.map((vendor) => <button type="button" className={selectedId === vendor.id ? "active" : ""} key={vendor.id} onClick={() => choose(vendor)}><strong>{vendor.companyName}</strong><span>{vendor.businessNumber || "사업자번호 미등록"}</span><small>{vendor.contactName || vendor.phone || "담당자 정보 미등록"}</small></button>)}
          {!filtered.length && <p>등록된 업체가 없습니다.</p>}
        </div>
        {filtered.length > 0 && <nav className="award-vendor-pagination" aria-label="협력사 목록 페이지"><button type="button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>이전</button><span>{page} / {pageCount}<small>총 {filtered.length}곳</small></span><button type="button" disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>다음</button></nav>}
      </aside>
      <form className="award-vendor-editor" onSubmit={save}>
        <header><div><span className="section-kicker">PARTNER VENDOR</span><h2>{selectedId ? draft.companyName || "업체 정보" : "새 협력사 등록"}</h2><p>문서를 올리면 내용을 자동 입력하며, 모든 항목은 직접 수정할 수 있습니다.</p></div><button className="primary-button" disabled={busy}>{busy ? "저장 중…" : "업체 정보 저장"}</button></header>
        {message && <div className="award-vendor-message" role="status">{message}</div>}
        <section className="award-vendor-documents"><div className="award-vendor-section-heading"><strong>업체 문서</strong><span>JPG·PNG·WebP·PDF, 파일당 12MB 이하</span></div><div className="award-vendor-document-grid">
          {(Object.keys(documentLabels) as DocumentType[]).map((type) => { const docs = selected?.documents.filter((doc) => doc.documentType === type) ?? []; return <article key={type}><div><b>{documentLabels[type]}</b><span>{documentHints[type]}</span></div>{docs.map((doc) => <div className="award-vendor-file" key={doc.id}><a href={doc.url} target="_blank" rel="noreferrer">{doc.originalName}</a><button type="button" onClick={() => void removeDocument(doc.id)}>삭제</button></div>)}<label><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={uploading !== null} onChange={(event) => void upload(type, event)} /><span>{uploading === type ? "정보 읽는 중…" : docs.length ? "파일 추가·교체" : "파일 선택"}</span></label></article>; })}
        </div></section>
        <section className="award-vendor-fields"><div className="award-vendor-section-heading"><strong>사업자 정보</strong><span>사업자등록증에서 자동 입력</span></div><div className="award-vendor-form-grid">{field("companyName", "업체명 *", "주식회사 위즈업")}{field("businessNumber", "사업자등록번호", "000-00-00000")}{field("representativeName", "대표자")}{field("phone", "대표 전화")}{field("businessType", "업태")}{field("businessItem", "종목")}<label className="wide"><span>주소</span><input value={draft.address} onChange={(event) => change("address", event.target.value)} /></label>{field("email", "대표 이메일")}</div></section>
        <section className="award-vendor-fields"><div className="award-vendor-section-heading"><strong>정산 계좌</strong><span>통장 사본에서 자동 입력</span></div><div className="award-vendor-form-grid three">{field("bankName", "은행")}{field("accountNumber", "계좌번호")}{field("accountHolder", "예금주")}</div></section>
        <section className="award-vendor-fields"><div className="award-vendor-section-heading"><strong>담당자 정보</strong><span>명함에서 자동 입력</span></div><div className="award-vendor-form-grid">{field("contactName", "담당자")}{field("contactTitle", "직함")}{field("contactPhone", "연락처")}{field("contactEmail", "이메일")}</div></section>
        <section className="award-vendor-fields"><div className="award-vendor-section-heading"><strong>참고 사항</strong></div><textarea value={draft.notes} onChange={(event) => change("notes", event.target.value)} placeholder="계약·정산·연락 시 참고할 내용을 입력하세요." /></section>
      </form>
    </section>
  );
}
