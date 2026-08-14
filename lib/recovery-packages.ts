import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FullBackup } from "./backup-store";
import {
  RECOVERY_SOURCE_ASSET_PATH,
  RECOVERY_SOURCE_FILE_COUNT,
  RECOVERY_SOURCE_RELEASE,
  RECOVERY_SOURCE_SHA256,
} from "./generated-recovery-source";

function recoverySourceBytes() {
  const relativePath = RECOVERY_SOURCE_ASSET_PATH.replace(/^\/+/, "");
  return new Uint8Array(readFileSync(join(process.cwd(), "public", relativePath)));
}

function safeEmbeddedJson(value: unknown) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function dateStamp(value: string) {
  return value.slice(0, 10).replaceAll("-", "");
}

function emergencyGuide(backup: FullBackup) {
  return [
    "WHIZZUP TM·미팅 영업관리 비상복구 패키지",
    "",
    `생성일시: ${backup.createdAt}`,
    `데이터 무결성 코드: ${backup.checksum}`,
    `소스 파일 수: ${RECOVERY_SOURCE_FILE_COUNT}`,
    `소스 배포 버전: ${RECOVERY_SOURCE_RELEASE}`,
    "",
    "포함 파일",
    "1. WHIZZUP_source.zip",
    "   사이트 화면, 기능, DB 구조, 테스트 및 설정 예시가 들어 있습니다.",
    "2. WHIZZUP_full_backup_*.json",
    "   다운로드 시점의 전체 업무 데이터입니다.",
    "3. MANIFEST.json",
    "   패키지 생성 정보와 데이터 개수를 확인할 수 있습니다.",
    "",
    "다른 호스팅 또는 새 Codex에서 이어가기",
    "1. WHIZZUP_source.zip의 압축을 풉니다.",
    "2. 새 Codex 작업에 소스 폴더와 전체 DB 백업 JSON을 함께 연결합니다.",
    "3. 아래 문장으로 작업을 시작할 수 있습니다.",
    "",
    "   WHIZZUP 사이트 비상복구 패키지입니다. 기존 기능과 화면을 유지하고,",
    "   첨부한 전체 DB 백업을 복원할 수 있게 현재 호스팅 환경에 맞춰 실행해 주세요.",
    "",
    "주의",
    "- 로그인 세션, OAuth 토큰, 비밀키와 서버 환경 비밀값은 포함하지 않습니다.",
    "- 다른 호스팅에서는 ChatGPT 로그인과 D1 DB 연결부를 새 환경에 맞게 바꿔야 합니다.",
    "- 이 패키지에는 개인정보와 영업정보가 포함되므로 안전한 장소에 보관하세요.",
    "",
  ].join("\r\n");
}

export function createEmergencyRecoveryPackage(backup: FullBackup) {
  const stamp = dateStamp(backup.createdAt);
  const dataFilename = `WHIZZUP_full_backup_${stamp}.json`;
  const manifest = {
    format: "whizzup-emergency-recovery",
    formatVersion: 1,
    createdAt: backup.createdAt,
    sourceFileCount: RECOVERY_SOURCE_FILE_COUNT,
    sourceSha256: RECOVERY_SOURCE_SHA256,
    sourceRelease: RECOVERY_SOURCE_RELEASE,
    backupChecksum: backup.checksum,
    counts: backup.counts,
    excludes: backup.security.excludes,
  };
  return zipSync(
    {
      "WHIZZUP_source.zip": recoverySourceBytes(),
      [dataFilename]: strToU8(JSON.stringify(backup, null, 2)),
      "READ_THIS_FIRST.txt": strToU8(emergencyGuide(backup)),
      "MANIFEST.json": strToU8(JSON.stringify(manifest, null, 2)),
    },
    { level: 6 },
  );
}

export function verifyEmergencyRecoveryPackage(
  bytes: Uint8Array,
  expectedBackup: FullBackup,
) {
  const files = unzipSync(bytes);
  const source = files["WHIZZUP_source.zip"];
  const manifestBytes = files["MANIFEST.json"];
  const guide = files["READ_THIS_FIRST.txt"];
  const backupName = Object.keys(files).find(
    (name) => name.startsWith("WHIZZUP_full_backup_") && name.endsWith(".json"),
  );
  if (!source || !manifestBytes || !guide || !backupName) {
    throw new Error("비상복구 패키지의 필수 파일이 누락되었습니다.");
  }
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  if (sourceSha256 !== RECOVERY_SOURCE_SHA256) {
    throw new Error("비상복구 소스 ZIP의 무결성 코드가 일치하지 않습니다.");
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    backupChecksum?: string;
    sourceSha256?: string;
    sourceRelease?: string;
  };
  const embeddedBackup = JSON.parse(strFromU8(files[backupName])) as FullBackup;
  if (
    manifest.backupChecksum !== expectedBackup.checksum ||
    manifest.sourceSha256 !== sourceSha256 ||
    manifest.sourceRelease !== RECOVERY_SOURCE_RELEASE ||
    embeddedBackup.checksum !== expectedBackup.checksum
  ) {
    throw new Error("비상복구 패키지의 생성 정보가 현재 소스 또는 DB와 일치하지 않습니다.");
  }
  return {
    backupChecksum: expectedBackup.checksum,
    sourceSha256,
    sourceRelease: RECOVERY_SOURCE_RELEASE,
    sourceFileCount: RECOVERY_SOURCE_FILE_COUNT,
  };
}

function createOfflineHtml(backup: FullBackup) {
  const embeddedBackup = safeEmbeddedJson(backup);
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WHIZZUP 오프라인 독립판</title>
<style>
:root{color-scheme:light;--ink:#152028;--muted:#66737b;--line:#d9e0e4;--paper:#f5f7f8;--card:#fff;--brand:#165a4a;--brand2:#0f766e;--danger:#b42318;--shadow:0 18px 50px rgba(26,45,53,.09)}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Arial,"Noto Sans KR",sans-serif}.shell{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh}.side{background:#102e29;color:#fff;padding:28px 18px;position:sticky;top:0;height:100vh;overflow:auto}.brand{font-weight:900;font-size:21px;line-height:1.3}.brand small{display:block;margin-top:7px;color:#a7c9c0;font-size:11px;letter-spacing:.12em}.offline-badge{margin:22px 0;padding:10px 12px;border:1px solid #3e6a61;border-radius:10px;color:#d9eee8;font-size:12px}.nav button{display:flex;justify-content:space-between;width:100%;margin:4px 0;padding:11px 12px;border:0;border-radius:9px;background:transparent;color:#dce9e5;text-align:left;cursor:pointer}.nav button.active,.nav button:hover{background:#245147;color:#fff}.nav b{font-size:11px;background:#d9eee8;color:#16463d;padding:2px 7px;border-radius:99px}.main{padding:34px;min-width:0}.top{display:flex;gap:20px;justify-content:space-between;align-items:flex-start;margin-bottom:24px}.top h1{margin:0 0 8px;font-size:28px}.top p{margin:0;color:var(--muted);font-size:13px}.actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}button,.file-label{border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--ink);padding:10px 13px;font-weight:700;font-size:12px;cursor:pointer}.primary{border-color:var(--brand);background:var(--brand);color:#fff}.danger{color:var(--danger)}.file-label input{display:none}.notice{padding:14px 16px;border-radius:11px;background:#eaf5f1;color:#235b4d;font-size:12px;line-height:1.6;margin-bottom:18px}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:20px}.stat{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:17px;box-shadow:var(--shadow)}.stat span{display:block;color:var(--muted);font-size:11px;margin-bottom:8px}.stat strong{font-size:22px}.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden}.toolbar{display:flex;gap:8px;align-items:center;padding:14px;border-bottom:1px solid var(--line)}.toolbar input{flex:1;min-width:180px;border:1px solid var(--line);border-radius:9px;padding:11px 12px}.table-wrap{overflow:auto;max-height:calc(100vh - 310px)}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:10px 11px;border-bottom:1px solid #edf0f2;text-align:left;white-space:nowrap;max-width:340px;overflow:hidden;text-overflow:ellipsis}th{position:sticky;top:0;background:#f8fafb;color:#4a5961;z-index:1}tr:hover td{background:#f7fbfa}.empty{padding:70px 20px;text-align:center;color:var(--muted)}.editor-backdrop{display:none;position:fixed;inset:0;background:rgba(7,25,22,.52);z-index:10;padding:30px}.editor-backdrop.open{display:flex;align-items:center;justify-content:center}.editor{width:min(780px,100%);background:#fff;border-radius:15px;padding:22px;box-shadow:0 30px 90px rgba(0,0,0,.25)}.editor h2{margin:0 0 8px}.editor p{margin:0 0 14px;color:var(--muted);font-size:12px}.editor textarea{width:100%;height:360px;resize:vertical;border:1px solid var(--line);border-radius:10px;padding:13px;font-family:Consolas,monospace;font-size:12px}.editor-actions{display:flex;justify-content:space-between;gap:10px;margin-top:12px}.editor-actions div{display:flex;gap:8px}.status{position:fixed;right:22px;bottom:22px;background:#102e29;color:#fff;padding:11px 15px;border-radius:10px;opacity:0;transform:translateY(8px);transition:.2s;pointer-events:none}.status.show{opacity:1;transform:none}
@media(max-width:850px){.shell{display:block}.side{position:static;height:auto}.nav{display:flex;overflow:auto}.nav button{min-width:150px}.main{padding:20px}.top{display:block}.actions{justify-content:flex-start;margin-top:16px}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}.table-wrap{max-height:none}}
</style>
</head>
<body>
<div class="shell">
  <aside class="side">
    <div class="brand">WHIZZUP<small>TM · 미팅 영업관리</small></div>
    <div class="offline-badge">인터넷 없이 실행 중<br>데이터는 이 컴퓨터에서만 다룹니다.</div>
    <nav class="nav" id="nav"></nav>
  </aside>
  <main class="main">
    <header class="top">
      <div><h1 id="page-title">오프라인 독립판</h1><p id="backup-meta"></p></div>
      <div class="actions">
        <label class="file-label">백업 불러오기<input id="import-file" type="file" accept=".json,application/json"></label>
        <button id="reset-button">내장 원본으로 되돌리기</button>
        <button class="primary" id="export-button">변경본 백업 내보내기</button>
      </div>
    </header>
    <div class="notice">이 독립판에서는 전체 자료의 열람·검색·기본 수정과 JSON 재백업이 가능합니다. ChatGPT 로그인, GPT Actions, 지도 외부검색, 여러 사람의 실시간 공동작업은 인터넷 연결형 사이트에서만 작동합니다. 관계가 연결된 ID를 임의로 바꾸면 온라인 복원 검사를 통과하지 못할 수 있습니다.</div>
    <section class="summary" id="summary"></section>
    <section class="panel">
      <div class="toolbar">
        <input id="search" type="search" placeholder="현재 표 전체에서 검색">
        <button id="add-button">새 행 추가</button>
      </div>
      <div class="table-wrap" id="table-wrap"></div>
    </section>
  </main>
</div>
<div class="editor-backdrop" id="editor-backdrop">
  <div class="editor">
    <h2 id="editor-title">행 수정</h2>
    <p>JSON 값만 수정해 주세요. ID와 연결 항목은 가능한 한 유지하는 것이 안전합니다.</p>
    <textarea id="editor-text"></textarea>
    <div class="editor-actions">
      <button class="danger" id="delete-button">이 행 삭제</button>
      <div><button id="cancel-button">취소</button><button class="primary" id="save-button">저장</button></div>
    </div>
  </div>
</div>
<div class="status" id="status"></div>
<script id="embedded-backup" type="application/json">${embeddedBackup}</script>
<script>
(function(){
  "use strict";
  var original=JSON.parse(document.getElementById("embedded-backup").textContent);
  var storageKey="whizzup-offline-working-copy-v1-"+original.checksum;
  var labels={members:"구성원",activities:"기관 활동 기록",activity_authors:"기록 작성자",activity_assignment_history:"진행 담당자 변경 이력",activity_review_acknowledgements:"내 기록 점검 처리",manager_alert_acknowledgements:"관리자 알림 처리",app_settings:"사이트 설정",organization_locations:"기관 위치",sales_campaigns:"영업 묶음",sales_campaign_targets:"묶음 영업 대상",joint_projects:"공동사업",joint_project_members:"공동사업 기관 연결",joint_project_events:"공동사업 변경 이력",equipment_projects:"수주 사업",equipment_items:"사업 품목",budget_name_groups:"표준 예산명",budget_name_aliases:"예산명 별칭",budget_name_members:"예산명 연결 기록",budget_name_events:"예산명 변경 이력",budget_name_requests:"새 예산명 신청",budget_name_request_records:"예산명 신청 연결 기록"};
  var preferred={members:["id","display_name","email","role","status","is_sales"],activities:["id","activity_date","organization","activity_type","topic","summary","detail_level","detail_summary","detail_key_facts_json","detail_sections_json","raw_input","status","follow_up_date","next_action","contact_role","contact_name","budget_original_name","budget_type","budget_match_status"],activity_authors:["activity_id","created_by_name","created_at"],activity_assignment_history:["id","activity_id","from_manager","to_manager","changed_by_name","created_at"],activity_review_acknowledgements:["member_id","activity_id","issue_signature","snoozed_until","updated_at"],manager_alert_acknowledgements:["member_id","organization","issue_signature","snoozed_until","updated_at"],ai_recommendations:["id","activity_id","organization","meeting_summary","interests_json","recommended_products_json","follow_up_questions_json","recommended_actions_json","applied_products_json","applied_questions_json","applied_actions_json","follow_up_date"],app_settings:["key","value","updated_at"],organization_locations:["organization","region","address","latitude","longitude"],sales_campaigns:["id","name","budget_type","selection_date","notes","updated_at"],sales_campaign_targets:["id","campaign_id","organization","business_round","region","contact_name","phone","budget_amount","assigned_member_id","created_activity"],joint_projects:["id","name","sponsor_organization","campaign_id","budget_type","project_year","joint_round","status","updated_at"],joint_project_members:["id","project_id","organization","business_round","role","budget_amount"],joint_project_events:["id","project_id","action","changed_by_name","created_at"],equipment_projects:["id","organization","name","status","budget_original_name","budget_type","budget_match_status","notes"],equipment_items:["id","project_id","product_name","specification","proposed_qty","awarded_qty","installed_qty","status","execution_type","commission_input_type","commission_rate","consortium_commission_rate","consortium_payment_amount"],budget_name_groups:["id","canonical_name","budget_kind","amount_mode","active","created_by_name","updated_by_name","created_at"],budget_name_aliases:["id","group_id","alias_name","active"],budget_name_members:["id","group_id","entity_type","entity_id","original_name","active"],budget_name_events:["id","group_id","action","changed_by_name","created_at"],budget_name_requests:["id","requested_name","expected_budget_kind","requester_name","status","decision_reason","created_at"],budget_name_request_records:["id","request_id","entity_type","entity_id","organization","original_name"]};
  var state=loadSaved()||clone(original),currentTable="activities",currentIndex=-1,query="";
  var nav=document.getElementById("nav"),wrap=document.getElementById("table-wrap"),search=document.getElementById("search"),backdrop=document.getElementById("editor-backdrop"),editor=document.getElementById("editor-text");
  function clone(value){return JSON.parse(JSON.stringify(value))}
  function loadSaved(){try{var raw=localStorage.getItem(storageKey);return raw?JSON.parse(raw):null}catch(error){return null}}
  function persist(){try{localStorage.setItem(storageKey,JSON.stringify(state))}catch(error){}}
  function escapeHtml(value){return String(value==null?"":value).replace(/[&<>"']/g,function(char){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]})}
  function totalRows(){return Object.keys(state.data).reduce(function(sum,key){return sum+(state.data[key]||[]).length},0)}
  function notify(message){var el=document.getElementById("status");el.textContent=message;el.classList.add("show");setTimeout(function(){el.classList.remove("show")},2200)}
  function renderNav(){nav.innerHTML=Object.keys(labels).map(function(key){return '<button data-table="'+key+'" class="'+(key===currentTable?"active":"")+'"><span>'+labels[key]+'</span><b>'+((state.data[key]||[]).length)+'</b></button>'}).join("");Array.prototype.forEach.call(nav.querySelectorAll("button"),function(button){button.onclick=function(){currentTable=button.getAttribute("data-table");query="";search.value="";render()}})}
  function renderSummary(){var activities=(state.data.activities||[]).length,orgs={};(state.data.activities||[]).forEach(function(row){if(row.organization)orgs[row.organization]=true});document.getElementById("summary").innerHTML='<div class="stat"><span>전체 데이터 행</span><strong>'+totalRows().toLocaleString("ko-KR")+'</strong></div><div class="stat"><span>기관 활동</span><strong>'+activities.toLocaleString("ko-KR")+'</strong></div><div class="stat"><span>등록 기관</span><strong>'+Object.keys(orgs).length.toLocaleString("ko-KR")+'</strong></div><div class="stat"><span>수주 사업</span><strong>'+((state.data.equipment_projects||[]).length).toLocaleString("ko-KR")+'</strong></div>'}
  function columnsFor(rows){var columns=preferred[currentTable]||[];if(!rows.length)return columns;var available=Object.keys(rows[0]);var selected=columns.filter(function(column){return available.indexOf(column)>=0});available.forEach(function(column){if(selected.length<12&&selected.indexOf(column)<0)selected.push(column)});return selected}
  function renderTable(){var rows=state.data[currentTable]||[],filtered=rows.map(function(row,index){return{row:row,index:index}}).filter(function(item){return !query||JSON.stringify(item.row).toLowerCase().indexOf(query)>=0}),columns=columnsFor(rows);document.getElementById("page-title").textContent=labels[currentTable];document.getElementById("backup-meta").textContent="내장 백업 생성: "+new Date(state.createdAt).toLocaleString("ko-KR")+" · "+filtered.length.toLocaleString("ko-KR")+"행 표시";if(!rows.length){wrap.innerHTML='<div class="empty">이 표에는 데이터가 없습니다. ‘새 행 추가’로 직접 입력할 수 있습니다.</div>';return}wrap.innerHTML='<table><thead><tr>'+columns.map(function(column){return"<th>"+escapeHtml(column)+"</th>"}).join("")+'<th>관리</th></tr></thead><tbody>'+filtered.map(function(item){return'<tr>'+columns.map(function(column){return"<td title='"+escapeHtml(item.row[column])+"'>"+escapeHtml(item.row[column])+"</td>"}).join("")+'<td><button data-edit="'+item.index+'">수정</button></td></tr>'}).join("")+"</tbody></table>";Array.prototype.forEach.call(wrap.querySelectorAll("[data-edit]"),function(button){button.onclick=function(){openEditor(Number(button.getAttribute("data-edit")))}})}
  function render(){renderNav();renderSummary();renderTable()}
  function openEditor(index){currentIndex=index;var isNew=index<0,rows=state.data[currentTable]||[];document.getElementById("editor-title").textContent=isNew?"새 행 추가":"행 수정";document.getElementById("delete-button").style.visibility=isNew?"hidden":"visible";editor.value=JSON.stringify(isNew?blankRow(rows):rows[index],null,2);backdrop.classList.add("open");editor.focus()}
  function blankRow(rows){var result={},columns=rows.length?Object.keys(rows[0]):(preferred[currentTable]||[]);columns.forEach(function(column){result[column]=column==="id"?nextId(rows):""});return result}
  function nextId(rows){return rows.reduce(function(max,row){var value=Number(row.id);return Number.isFinite(value)?Math.max(max,value):max},0)+1}
  function closeEditor(){backdrop.classList.remove("open");currentIndex=-1}
  function saveEditor(){try{var value=JSON.parse(editor.value);if(!value||Array.isArray(value)||typeof value!=="object")throw new Error("행은 JSON 객체여야 합니다.");var rows=state.data[currentTable]||(state.data[currentTable]=[]);if(currentIndex<0)rows.push(value);else rows[currentIndex]=value;refreshCounts();persist();closeEditor();render();notify("오프라인 작업본에 저장했습니다.")}catch(error){alert("JSON 형식을 확인해 주세요.\\n"+error.message)}}
  function deleteRow(){if(currentIndex<0||!confirm("이 행을 오프라인 작업본에서 삭제할까요?"))return;state.data[currentTable].splice(currentIndex,1);refreshCounts();persist();closeEditor();render();notify("행을 삭제했습니다.")}
  function refreshCounts(){Object.keys(state.data).forEach(function(key){state.counts[key]=state.data[key].length})}
  function canonical(value){if(Array.isArray(value))return"["+value.map(canonical).join(",")+"]";if(value&&typeof value==="object"){return"{"+Object.keys(value).sort().map(function(key){return JSON.stringify(key)+":"+canonical(value[key])}).join(",")+"}"}return JSON.stringify(value)}
  async function checksumBackup(backup){var unsigned={format:backup.format,formatVersion:backup.formatVersion,schemaVersion:backup.schemaVersion,createdAt:backup.createdAt,source:backup.source,security:backup.security,counts:backup.counts,data:backup.data};var digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical(unsigned)));return Array.prototype.map.call(new Uint8Array(digest),function(value){return value.toString(16).padStart(2,"0")}).join("")}
  async function exportBackup(){try{refreshCounts();state.createdAt=new Date().toISOString();state.checksum=await checksumBackup(state);persist();var blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="WHIZZUP_offline_backup_"+state.createdAt.slice(0,10)+".json";link.click();setTimeout(function(){URL.revokeObjectURL(url)},1000);render();notify("온라인 복원용 백업을 내보냈습니다.")}catch(error){alert("백업 무결성 코드를 만들지 못했습니다. 최신 Chrome 또는 Edge에서 열어 주세요.")}}
  function importBackup(file){var reader=new FileReader();reader.onload=function(){try{var parsed=JSON.parse(String(reader.result));if(parsed.format!=="whizzup-full-backup"||!parsed.data)throw new Error("WHIZZUP 전체 백업 파일이 아닙니다.");state=parsed;currentTable="activities";refreshCounts();persist();render();notify("백업 파일을 불러왔습니다.")}catch(error){alert(error.message)}};reader.readAsText(file)}
  search.oninput=function(){query=search.value.trim().toLowerCase();renderTable()};
  document.getElementById("add-button").onclick=function(){openEditor(-1)};
  document.getElementById("cancel-button").onclick=closeEditor;
  document.getElementById("save-button").onclick=saveEditor;
  document.getElementById("delete-button").onclick=deleteRow;
  document.getElementById("export-button").onclick=exportBackup;
  document.getElementById("reset-button").onclick=function(){if(confirm("오프라인에서 수정한 내용을 지우고 다운로드 당시 데이터로 되돌릴까요?")){state=clone(original);try{localStorage.removeItem(storageKey)}catch(error){}render();notify("내장 원본으로 되돌렸습니다.")}};
  document.getElementById("import-file").onchange=function(event){var file=event.target.files&&event.target.files[0];event.target.value="";if(file)importBackup(file)};
  backdrop.onclick=function(event){if(event.target===backdrop)closeEditor()};
  document.addEventListener("keydown",function(event){if(event.key==="Escape")closeEditor()});
  render();
})();
</script>
</body>
</html>`;
}

function offlineGuide(backup: FullBackup) {
  return [
    "WHIZZUP 오프라인 독립판",
    "",
    "사용 방법",
    "1. ZIP의 압축을 풉니다.",
    "2. WHIZZUP_offline.html을 Chrome 또는 Edge로 엽니다.",
    "3. 왼쪽 메뉴에서 자료를 열람하고, 검색하거나 기본 수정할 수 있습니다.",
    "4. 수정 후 '변경본 백업 내보내기'를 눌러 JSON 파일을 별도로 보관합니다.",
    "",
    "가능한 기능",
    "- 전체 백업 데이터 표별 열람 및 검색",
    "- 행 추가, JSON 방식의 기본 수정 및 삭제",
    "- 기존 전체 DB 백업 불러오기",
    "- 온라인 사이트에서 검사·복원할 수 있는 JSON 백업 내보내기",
    "",
    "인터넷이 필요한 기능",
    "- ChatGPT 로그인과 GPT Actions",
    "- 지도 외부검색",
    "- 여러 사람의 실시간 공동작업",
    "",
    `내장 데이터 생성일시: ${backup.createdAt}`,
    `내장 데이터 무결성 코드: ${backup.checksum}`,
    "",
    "중요: 파일에는 개인정보와 영업정보가 포함됩니다. 외부에 공유하지 마세요.",
    "",
  ].join("\r\n");
}

export function createOfflineStandalonePackage(backup: FullBackup) {
  const stamp = dateStamp(backup.createdAt);
  return zipSync(
    {
      "WHIZZUP_offline.html": strToU8(createOfflineHtml(backup)),
      [`WHIZZUP_full_backup_${stamp}.json`]: strToU8(
        JSON.stringify(backup, null, 2),
      ),
      "오프라인_사용안내.txt": strToU8(offlineGuide(backup)),
    },
    { level: 9 },
  );
}
