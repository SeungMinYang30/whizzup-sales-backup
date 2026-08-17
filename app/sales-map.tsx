"use client";

import {
  ChangeEvent,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CampaignImportRow,
  downloadCampaignTemplate,
  parseCampaignFile,
} from "./campaign-xlsx";
import BudgetNameSelector, {
  type BudgetSelection,
} from "./budget-name-selector";
import {
  downloadLocationWorkbook,
  LocationImportRow,
  parseLocationFile,
} from "./location-xlsx";
import { fetchWithInstitutionConfirmation } from "./institution-confirmation";
import {
  canonicalProvinceName,
  clusterMapPoints,
  clusterMapPointsByProvince,
  individualMapPointClusters,
  pointIsInsideMapViewport,
  shouldRenderProvinceClusters,
  type NumericMapViewport,
} from "../lib/map-clustering";
import {
  isCompletedAwardStage,
  normalizeAwardStage,
} from "../lib/sales-taxonomy";
import { institutionAliasKey } from "../lib/institution-names";
import { personDisplayLabel } from "../lib/person-label";
import JointProjectModal, {
  type JointProjectCandidate,
} from "./joint-project-modal";
import JointProjectMemberList from "./joint-project-member-list";
import {
  filterJointProjectGroupsByMember,
  groupJointProjectRows,
  jointProjectGroupMemberIds,
} from "../lib/joint-project-display";

export type SalesMapRecord = {
  id: number;
  activityDate: string;
  businessRound: number;
  region: string;
  organization: string;
  status: string;
  awardStatus: string;
  awardCompany: string;
  awardStage: string;
  awardCompletedDate: string;
  budgetAmount: string;
  budgetType: string;
  budgetGroupId?: number | null;
  executionType: string;
  consortiumCompany: string;
  progressManager: string;
  contactName: string;
  contactPhone: string;
  topic: string;
  summary: string;
  nextAction: string;
  notes: string;
  jointProjectId?: number | null;
  jointProjectName?: string;
  jointProjectSponsor?: string;
  jointProjectRole?: "sponsor" | "site" | "";
  jointProjectBudgetGroupId?: number | null;
  jointProjectBudgetType?: string;
  jointProjectYear?: number | null;
  jointProjectRound?: number | null;
  jointProjectMemberBudgetAmount?: number | null;
};

type MapStatus = "영업 중" | "진행 중" | "완료" | "타업체";
type BudgetQuickFilter =
  | ""
  | "whizzup"
  | "other"
  | "post-award"
  | "complete";

const LEGACY_MAP_SELECTION_STORAGE_KEY = "whizzup-sales-map-selection";

type OrganizationLocation = {
  organization: string;
  region: string;
  address: string;
  roadAddress: string;
  latitude: number;
  longitude: number;
  placeName: string;
  placeId: string;
  updatedAt: string;
};

type OrganizationSummary = {
  organization: string;
  region: string;
  businessRound: number;
  lastActivityDate: string;
  status: MapStatus;
  awardStatus: string;
  awardCompany: string;
  awardStage: string;
  awardCompletedDate: string;
  budgetAmount: string;
  budgetType: string;
  executionType: string;
  consortiumCompany: string;
  progressManager: string;
  contactPhone: string;
  summary: string;
  addressHint: string;
  searchText: string;
  location?: OrganizationLocation;
};

type OfficialSchoolPhone = {
  name: string;
  region: string;
  address: string;
  phone: string;
  schoolCode: string;
  source: string;
};

type MapDeliveryProduct = {
  name: string;
  quantity: number;
};

type MapDeliverySummary = {
  loading: boolean;
  products: MapDeliveryProduct[];
  error: string;
};

type SalesCampaign = {
  id: number;
  name: string;
  notes: string;
  createdByName: string;
  targetCount: number;
  assignedCount: number;
  createdAt: string;
  budgetType: string;
  budgetGroupId: number | null;
  budgetMatchStatus: string;
  budgetMatchMethod: string;
  budgetRequestId: string | null;
  budgetKind: string;
  budgetAmountMode: string;
  selectionDate: string;
  defaultBudgetAmount: number | null;
  sourceFileName: string;
  importSource: string;
};

type SalesCampaignTarget = {
  id: number;
  campaignId: number;
  organization: string;
  region: string;
  address: string;
  phone: string;
  contactName: string;
  notes: string;
  assignedMemberId: number | null;
  assignedMemberName: string;
  budgetAmount: number | null;
  budgetAmountSource: "institution" | "card-default" | "missing";
  schoolLevel: string;
  supplyItems: string;
  reviewNote: string;
  businessRound: number;
  createdActivity: boolean;
  currentActivityDate: string;
  currentStatus: string;
  currentAwardStatus: string;
  currentAwardStage: string;
  currentBudgetType: string;
  currentNextAction: string;
  currentProgressManager: string;
  jointProjectId: number | null;
  jointProjectName: string;
  jointProjectSponsor: string;
  jointProjectRole: "sponsor" | "site" | "";
  jointProjectBudgetGroupId: number | null;
  jointProjectBudgetType: string;
  jointProjectYear: number | null;
  jointProjectRound: number | null;
  jointProjectMemberBudgetAmount: number | null;
};

type CampaignCardMode = "create" | "edit" | null;

type CampaignMember = {
  id: number;
  displayName: string;
  jobTitle: string;
  email: string;
};

type CampaignImportPreview = {
  fileName: string;
  rows: CampaignImportRow[];
  source: "excel" | "pdf" | "manual";
};

type CampaignInstitutionOption = {
  key: string;
  activityId: number;
  organization: string;
  aliases: string[];
  region: string;
  businessRound: number;
  activityDate: string;
  status: string;
  awardStatus: string;
  stageLabel: string;
  budgetType: string;
  progressManager: string;
  contactName: string;
  contactPhone: string;
  searchText: string;
};

function organizationMatchesMapSearch(
  item: OrganizationSummary,
  campaignTarget: SalesCampaignTarget | undefined,
  keyword: string,
) {
  if (!keyword) return true;
  const province = canonicalProvinceName(
    [item.region, item.location?.roadAddress, item.location?.address]
      .filter(Boolean)
      .join(" "),
  );
  return [
    item.organization,
    item.region,
    province?.province ?? "",
    province?.label ?? "",
    item.awardStage,
    item.progressManager,
    item.summary,
    item.searchText,
    item.location?.address ?? "",
    item.location?.roadAddress ?? "",
    campaignTarget?.contactName ?? "",
    campaignTarget?.phone ?? "",
    campaignTarget?.assignedMemberName ?? "",
  ].some((value) => value.toLowerCase().includes(keyword));
}

let campaignRowSequence = 0;

function createCampaignRowId() {
  campaignRowSequence += 1;
  return `campaign-row-${Date.now()}-${campaignRowSequence}`;
}

function institutionSearchText(value: string) {
  return value.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

type CampaignImportRowUpdate = <K extends keyof CampaignImportRow>(
  index: number,
  key: K,
  value: CampaignImportRow[K],
) => void;

function campaignBudgetMatches(
  record: SalesMapRecord,
  budget: BudgetSelection,
) {
  if (
    budget.budgetGroupId &&
    record.budgetGroupId === budget.budgetGroupId
  ) {
    return true;
  }
  const currentBudgetKey = record.budgetType
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko-KR");
  const selectedBudgetKey = budget.budgetType
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko-KR");
  return Boolean(currentBudgetKey && currentBudgetKey === selectedBudgetKey);
}

function campaignBusinessStageLabel(record: SalesMapRecord) {
  if (record.awardStatus === "미정") {
    return `수주 전 · ${record.status}`;
  }
  return `수주 후 · ${record.awardStage || record.status || record.awardStatus}`;
}

function automaticBusinessMatchLabel(
  linkableRecords: SalesMapRecord[],
  budget: BudgetSelection,
) {
  const matches = linkableRecords.filter((record) =>
    campaignBudgetMatches(record, budget),
  );
  if (matches.length === 1) {
    return `기존 ${matches[0].businessRound}차 사업에 연결`;
  }
  if (matches.length > 1) return "같은 예산 기존 사업을 직접 선택";
  return "새 사업으로 등록";
}

type CampaignImportRowEditorProps = {
  row: CampaignImportRow;
  index: number;
  rowId: string;
  latestRecord?: SalesMapRecord;
  linkableRecords: SalesMapRecord[];
  budget: BudgetSelection;
  institutionSuggestions: CampaignInstitutionOption[];
  showInstitutionSuggestions: boolean;
  alreadyInActiveCampaign: boolean;
  onUpdate: CampaignImportRowUpdate;
  onBusinessMatch: (
    index: number,
    value: string,
    linkedOrganization?: string,
  ) => void;
  onSelectInstitution: (
    index: number,
    option: CampaignInstitutionOption,
  ) => void;
  onInstitutionSearch: (rowId: string, query: string | null) => void;
  onRemove: (index: number, rowId: string) => void;
};

const EMPTY_CAMPAIGN_RECORDS: SalesMapRecord[] = [];
const EMPTY_CAMPAIGN_INSTITUTION_SUGGESTIONS: CampaignInstitutionOption[] = [];
const CAMPAIGN_EXISTING_PAGE_SIZE = 50;

const CampaignImportRowEditor = memo(function CampaignImportRowEditor({
  row,
  index,
  rowId,
  latestRecord,
  linkableRecords,
  budget,
  institutionSuggestions,
  showInstitutionSuggestions,
  alreadyInActiveCampaign,
  onUpdate,
  onBusinessMatch,
  onSelectInstitution,
  onInstitutionSearch,
  onRemove,
}: CampaignImportRowEditorProps) {
  const composingRef = useRef(false);
  const selectedRecord = linkableRecords.find(
    (record) => record.id === row.linkedActivityId,
  );
  const selectedValue =
    row.businessMatchMode === "link-current" && row.linkedActivityId
      ? `link:${row.linkedActivityId}`
      : row.businessMatchMode;

  return (
    <div className="campaign-pdf-preview-row">
      <span className="campaign-source-sequence">
        {row.sourceSequence || index + 1}
      </span>
      <div
        className="campaign-institution-entry"
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            onInstitutionSearch(rowId, null);
          }
        }}
      >
        <input
          value={row.organization}
          onFocus={(event) =>
            onInstitutionSearch(rowId, event.currentTarget.value)
          }
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            onInstitutionSearch(rowId, event.currentTarget.value);
          }}
          onChange={(event) => {
            const organization = event.target.value;
            onUpdate(index, "organization", organization);
            if (!composingRef.current) {
              onInstitutionSearch(rowId, organization);
            }
          }}
          aria-label={`${index + 1}번 기관명`}
          aria-autocomplete="list"
          aria-controls={`campaign-institution-options-${rowId}`}
          autoComplete="off"
          required
        />
        {showInstitutionSuggestions && (
          <div
            className="campaign-institution-suggestions"
            id={`campaign-institution-options-${rowId}`}
            role="listbox"
            aria-label="기존 기관 검색 결과"
          >
            {institutionSuggestions.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected={
                  row.confirmedOrganization === option.organization
                }
                key={option.key}
                onClick={() => onSelectInstitution(index, option)}
              >
                <strong>{option.organization}</strong>
                <small>
                  {option.region || "지역 미등록"} · {option.businessRound}차 ·{" "}
                  {option.awardStatus === "미정"
                    ? option.status
                    : option.awardStatus}
                </small>
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        value={row.region}
        onChange={(event) => onUpdate(index, "region", event.target.value)}
        aria-label={`${row.organization} 지원청 또는 지역`}
        placeholder="미입력"
      />
      <input
        value={row.schoolLevel}
        onChange={(event) => onUpdate(index, "schoolLevel", event.target.value)}
        aria-label={`${row.organization} 학교급`}
        placeholder="미입력"
      />
      <textarea
        value={row.supplyItems}
        onChange={(event) => onUpdate(index, "supplyItems", event.target.value)}
        aria-label={`${row.organization} 지원 또는 공급 내용`}
        placeholder="미입력"
        rows={2}
      />
      <input
        value={row.budgetAmount}
        onChange={(event) => onUpdate(index, "budgetAmount", event.target.value)}
        aria-label={`${row.organization} 기관별 예산`}
        placeholder="미입력"
      />
      {alreadyInActiveCampaign ? (
        <span className="campaign-existing-in-list">현재 명단에 등록됨</span>
      ) : row.existingOrganizations.length ? (
        <select
          value={row.confirmedOrganization}
          onChange={(event) =>
            onUpdate(index, "confirmedOrganization", event.target.value)
          }
          aria-label={`${row.organization} 기존 기관 연결`}
        >
          <option value="">신규·별도 기관</option>
          {row.existingOrganizations.map((organization) => (
            <option value={organization} key={organization}>
              기존 {organization}과 연결
            </option>
          ))}
        </select>
      ) : (
        <span className="campaign-new-institution">신규 기관</span>
      )}
      <div className="campaign-business-match">
        <span
          className={`campaign-business-availability ${
            linkableRecords.length ? "is-available" : ""
          }`}
        >
          {linkableRecords.length
            ? `동일 연도 기존 사업 ${linkableRecords.length}건 · 단계와 관계없이 선택 가능`
            : "연결 가능한 동일 연도 기존 사업 없음"}
        </span>
        <select
          value={selectedValue}
          onChange={(event) => {
            const value = event.target.value;
            const linkedActivityId = value.startsWith("link:")
              ? Number(value.slice(5))
              : 0;
            const linkedOrganization = linkableRecords.find(
              (record) => record.id === linkedActivityId,
            )?.organization;
            onBusinessMatch(index, value, linkedOrganization);
          }}
          aria-label={`${row.organization} 사업 연결 방식`}
        >
          <option value="auto">
            자동 · {automaticBusinessMatchLabel(linkableRecords, budget)}
          </option>
          {linkableRecords.map((record) => (
            <option key={record.id} value={`link:${record.id}`}>
              기존 {record.businessRound}차에 연결 ·{" "}
              {campaignBusinessStageLabel(record)}
            </option>
          ))}
          <option value="new">신규 사업으로 등록 · 새 사업 차수 생성</option>
        </select>
        {selectedRecord && (
          <small className="campaign-link-preserve-note">
            기존 예산은 유지하고 이번 카드 예산을 같은 사업 차수에 함께 추가합니다.
          </small>
        )}
        {latestRecord && (
          <small>
            기존 {latestRecord.businessRound}차 ·{" "}
            {latestRecord.budgetType || "예산명 미확인"} ·{" "}
            {latestRecord.awardStatus === "미정"
              ? latestRecord.status
              : latestRecord.awardStatus}
          </small>
        )}
      </div>
      <textarea
        className={row.reviewNote ? "needs-review" : ""}
        value={row.reviewNote}
        onChange={(event) => onUpdate(index, "reviewNote", event.target.value)}
        aria-label={`${row.organization} 확인할 내용`}
        placeholder="확인 사항 없음"
        rows={2}
      />
      <button
        type="button"
        className="campaign-row-remove"
        onClick={() => onRemove(index, rowId)}
        aria-label={`${row.organization} 제외`}
      >
        제외
      </button>
    </div>
  );
});

type LocationBatchDraft = LocationImportRow & {
  region: string;
  roadAddress: string;
  placeName: string;
  placeId: string;
  selected: boolean;
  candidates: KakaoPlace[];
  searching: boolean;
  error: string;
  mapped: boolean;
};

function campaignTargetNotes(row: CampaignImportRow) {
  return [
    row.notes,
    row.schoolLevel && `학교급·기관 구분: ${row.schoolLevel}`,
    row.supplyItems && `지원·공급 내용: ${row.supplyItems}`,
    row.budgetAmount && `기관별 예산: ${row.budgetAmount}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function campaignDateFromText(value: string) {
  const full = value.match(
    /(?:^|[^0-9])(20\d{2})[.\-_/년\s]+(\d{1,2})[.\-_/월\s]+(\d{1,2})(?:일|[^0-9]|$)/,
  );
  const short = value.match(
    /(?:^|[^0-9])(\d{2})[.\-_/]+(\d{1,2})[.\-_/]+(\d{1,2})(?:[^0-9]|$)/,
  );
  const year = full ? Number(full[1]) : short ? 2000 + Number(short[1]) : 0;
  const month = Number(full?.[2] ?? short?.[2] ?? 0);
  const day = Number(full?.[3] ?? short?.[3] ?? 0);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === candidate ? candidate : "";
}

type RouteOrigin = {
  label: string;
  address: string;
  latitude: number;
  longitude: number;
};

type NearbyRadius = 10 | 30;

type KakaoPlace = {
  id: string;
  place_name: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  phone?: string;
  place_url?: string;
};

type KakaoAddressResult = {
  address_name: string;
  x: string;
  y: string;
  address?: { address_name?: string } | null;
  road_address?: { address_name?: string } | null;
};

type KakaoLatLng = {
  getLat(): number;
  getLng(): number;
};

type KakaoBounds = {
  extend(point: KakaoLatLng): void;
  getSouthWest(): KakaoLatLng;
  getNorthEast(): KakaoLatLng;
};

type KakaoMapInstance = {
  relayout(): void;
  setBounds(
    bounds: KakaoBounds,
    paddingTop?: number,
    paddingRight?: number,
    paddingBottom?: number,
    paddingLeft?: number,
  ): void;
  setCenter(point: KakaoLatLng): void;
  setLevel(level: number, options?: { anchor?: KakaoLatLng }): void;
  getCenter(): KakaoLatLng;
  getBounds(): KakaoBounds;
  getLevel(): number;
};

type KakaoOverlay = {
  setMap(map: KakaoMapInstance | null): void;
};

type KakaoPolyline = {
  setMap(map: KakaoMapInstance | null): void;
};

type KakaoMapsApi = {
  load(callback: () => void): void;
  LatLng: new (latitude: number, longitude: number) => KakaoLatLng;
  LatLngBounds: new () => KakaoBounds;
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level: number },
  ) => KakaoMapInstance;
  CustomOverlay: new (options: {
    position: KakaoLatLng;
    content: HTMLElement;
    yAnchor?: number;
    zIndex?: number;
  }) => KakaoOverlay;
  Polyline: new (options: {
    path: KakaoLatLng[];
    strokeWeight: number;
    strokeColor: string;
    strokeOpacity: number;
    strokeStyle: string;
  }) => KakaoPolyline;
  event: {
    addListener(
      target: KakaoMapInstance,
      eventName: "idle",
      listener: () => void,
    ): void;
    removeListener(
      target: KakaoMapInstance,
      eventName: "idle",
      listener: () => void,
    ): void;
  };
  services: {
    Places: new () => {
      keywordSearch(
        query: string,
        callback: (results: KakaoPlace[], status: string) => void,
      ): void;
    };
    Geocoder: new () => {
      addressSearch(
        query: string,
        callback: (results: KakaoAddressResult[], status: string) => void,
      ): void;
    };
    Status: { OK: string };
  };
};

declare global {
  interface Window {
    kakao?: { maps: KakaoMapsApi };
  }
}

type VisibleMapStatus = Exclude<MapStatus, "타업체">;
const statusOrder: Array<"전체" | VisibleMapStatus> = [
  "전체",
  "영업 중",
  "진행 중",
  "완료",
];
const ambiguousOrganizationPattern =
  /(?:외\s*\d+\s*건|등\s*(?:여러\s*)?곳|관련\s*$|[·/&]\s*)/;
const companyRouteOrigin = {
  label: "위즈업 본사",
  address: "경기도 하남시 하남대로 947 하남테크노밸리 U1 CENTER",
};

let kakaoLoader: Promise<KakaoMapsApi> | null = null;

function loadKakaoMaps(javascriptKey: string) {
  if (kakaoLoader) return kakaoLoader;
  kakaoLoader = new Promise<KakaoMapsApi>((resolve, reject) => {
    let settled = false;
    let timeoutId = 0;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      kakaoLoader = null;
      reject(new Error(message));
    };
    const finish = () => {
      if (!window.kakao?.maps) {
        fail("카카오 지도 모듈을 불러오지 못했습니다.");
        return;
      }
      window.kakao.maps.load(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(window.kakao!.maps);
      });
    };
    timeoutId = window.setTimeout(() => {
      fail("카카오 지도 응답이 늦어지고 있습니다. 다시 불러와 주세요.");
    }, 12_000);

    if (window.kakao?.maps) {
      finish();
      return;
    }

    const previous = document.getElementById("whizzup-kakao-map-sdk");
    previous?.remove();
    const script = document.createElement("script");
    script.id = "whizzup-kakao-map-sdk";
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(
      javascriptKey,
    )}&autoload=false&libraries=services`;
    script.onload = finish;
    script.onerror = () => {
      fail("카카오 지도 연결을 확인해 주세요.");
    };
    document.head.appendChild(script);
  });
  return kakaoLoader;
}

function normalizeLocation(row: Record<string, unknown>): OrganizationLocation {
  const value = (camel: string, snake: string) => row[camel] ?? row[snake] ?? "";
  return {
    organization: String(row.organization ?? ""),
    region: String(row.region ?? ""),
    address: String(row.address ?? ""),
    roadAddress: String(value("roadAddress", "road_address")),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    placeName: String(value("placeName", "place_name")),
    placeId: String(value("placeId", "place_id")),
    updatedAt: String(value("updatedAt", "updated_at")),
  };
}

function normalizeCampaign(row: Record<string, unknown>): SalesCampaign {
  const value = (camel: string, snake: string) => row[camel] ?? row[snake] ?? "";
  return {
    id: Number(row.id),
    name: String(row.name ?? ""),
    notes: String(row.notes ?? ""),
    createdByName: String(value("createdByName", "created_by_name")),
    targetCount: Number(value("targetCount", "target_count")),
    assignedCount: Number(value("assignedCount", "assigned_count")),
    createdAt: String(value("createdAt", "created_at")),
    budgetType: String(value("budgetType", "budget_type")),
    budgetGroupId:
      Number(value("budgetGroupId", "budget_group_id")) || null,
    budgetMatchStatus: String(
      value("budgetMatchStatus", "budget_match_status"),
    ),
    budgetMatchMethod: String(
      value("budgetMatchMethod", "budget_match_method"),
    ),
    budgetRequestId:
      String(value("budgetRequestId", "budget_request_id")) || null,
    budgetKind: String(value("budgetKind", "budget_kind")),
    budgetAmountMode: String(
      value("budgetAmountMode", "budget_amount_mode"),
    ),
    selectionDate: String(value("selectionDate", "selection_date")),
    defaultBudgetAmount:
      value("defaultBudgetAmount", "default_budget_amount") === ""
        ? null
        : Number(value("defaultBudgetAmount", "default_budget_amount")),
    sourceFileName: String(value("sourceFileName", "source_file_name")),
    importSource: String(value("importSource", "import_source")),
  };
}

function normalizeNullableAmount(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeCampaignTarget(
  row: Record<string, unknown>,
): SalesCampaignTarget {
  const value = (camel: string, snake: string) => row[camel] ?? row[snake] ?? "";
  const assignedMemberId = Number(
    value("currentAssignedMemberId", "current_assigned_member_id") ||
      value("assignedMemberId", "assigned_member_id"),
  );
  return {
    id: Number(row.id),
    campaignId: Number(value("campaignId", "campaign_id")),
    organization: String(row.organization ?? ""),
    region: String(row.region ?? ""),
    address: String(row.address ?? ""),
    phone: String(
      value("currentPhone", "current_phone") || row.phone || "",
    ),
    contactName: String(
      value("currentContactName", "current_contact_name") ||
        value("contactName", "contact_name"),
    ),
    notes: String(row.notes ?? ""),
    assignedMemberId: assignedMemberId || null,
    assignedMemberName: String(
      value("assignedMemberName", "assigned_member_name"),
    ),
    budgetAmount:
      value("budgetAmount", "budget_amount") === ""
        ? null
        : Number(value("budgetAmount", "budget_amount")),
    budgetAmountSource:
      value("budgetAmountSource", "budget_amount_source") === "institution"
        ? "institution"
        : value("budgetAmountSource", "budget_amount_source") === "card-default"
          ? "card-default"
          : "missing",
    schoolLevel: String(value("schoolLevel", "school_level")),
    supplyItems: String(value("supplyItems", "supply_items")),
    reviewNote: String(value("reviewNote", "review_note")),
    businessRound: Math.max(
      1,
      Number(value("businessRound", "business_round")) || 1,
    ),
    createdActivity:
      Number(value("createdActivity", "created_activity")) === 1,
    currentActivityDate: String(
      value("currentActivityDate", "current_activity_date"),
    ),
    currentStatus: String(value("currentStatus", "current_status")),
    currentAwardStatus: String(
      value("currentAwardStatus", "current_award_status"),
    ),
    currentAwardStage: String(
      value("currentAwardStage", "current_award_stage"),
    ),
    currentBudgetType: String(
      value("currentBudgetType", "current_budget_type"),
    ),
    currentNextAction: String(
      value("currentNextAction", "current_next_action"),
    ),
    currentProgressManager: String(
      value("currentProgressManager", "current_progress_manager"),
    ),
    jointProjectId:
      Number(value("jointProjectId", "joint_project_id")) > 0
        ? Number(value("jointProjectId", "joint_project_id"))
        : null,
    jointProjectName: String(
      value("jointProjectName", "joint_project_name"),
    ),
    jointProjectSponsor: String(
      value("jointProjectSponsor", "joint_project_sponsor"),
    ),
    jointProjectRole:
      String(value("jointProjectRole", "joint_project_role")) === "sponsor"
        ? "sponsor"
        : String(value("jointProjectRole", "joint_project_role")) === "site"
          ? "site"
          : "",
    jointProjectBudgetGroupId:
      Number(value("jointProjectBudgetGroupId", "joint_project_budget_group_id")) > 0
        ? Number(value("jointProjectBudgetGroupId", "joint_project_budget_group_id"))
        : null,
    jointProjectBudgetType: String(
      value("jointProjectBudgetType", "joint_project_budget_type"),
    ),
    jointProjectYear:
      Number(value("jointProjectYear", "joint_project_year")) > 0
        ? Number(value("jointProjectYear", "joint_project_year"))
        : null,
    jointProjectRound:
      Number(value("jointProjectRound", "joint_project_round")) > 0
        ? Number(value("jointProjectRound", "joint_project_round"))
        : null,
    jointProjectMemberBudgetAmount: normalizeNullableAmount(
      value(
        "jointProjectMemberBudgetAmount",
        "joint_project_member_budget_amount",
      ),
    ),
  };
}

function normalizeCampaignMember(
  row: Record<string, unknown>,
): CampaignMember {
  const value = (camel: string, snake: string) => row[camel] ?? row[snake] ?? "";
  return {
    id: Number(row.id),
    displayName: String(value("displayName", "display_name")),
    jobTitle: String(value("jobTitle", "job_title")),
    email: String(row.email ?? ""),
  };
}

function campaignMemberLabel(member: CampaignMember) {
  return personDisplayLabel(member);
}

function resolveMapStatus(record: SalesMapRecord | undefined): MapStatus {
  if (!record || record.awardStatus === "미정") return "영업 중";
  if (record.awardStatus === "타업체 수주") return "타업체";
  if (isCompletedAwardStage(record.awardStage)) return "완료";
  return "진행 중";
}

function formatDate(value: string) {
  if (!value) return "날짜 미정";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${year}.${month}.${day}` : value;
}

function formatWon(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "금액 미입력"
    : `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function jointProjectSiteBudgetTotal(members: SalesCampaignTarget[]) {
  const amounts = members
    .filter((member) => member.jointProjectRole !== "sponsor")
    .flatMap((member) =>
      member.jointProjectMemberBudgetAmount === null ||
      member.jointProjectMemberBudgetAmount === undefined
        ? []
        : [member.jointProjectMemberBudgetAmount],
    );
  return amounts.length > 0
    ? amounts.reduce((sum, amount) => sum + amount, 0)
    : null;
}

function budgetAmountSourceLabel(target: SalesCampaignTarget) {
  if (target.budgetAmountSource === "institution") return "기관 상세 입력";
  if (target.budgetAmountSource === "card-default") return "카드 기본금액";
  return "금액 미입력";
}

function budgetTargetStatus(target: SalesCampaignTarget) {
  if (target.currentAwardStatus === "위즈업 수주") {
    if (isCompletedAwardStage(target.currentAwardStage)) return "완료";
    const awardStage = normalizeAwardStage(
      target.currentAwardStage,
      target.currentAwardStatus,
    );
    return awardStage === "미정" || awardStage === "해당 없음"
      ? "위즈업 선정"
      : "수주 후 진행";
  }
  if (target.currentAwardStatus === "협력사 수주") return "협력사 선정";
  if (target.currentAwardStatus === "타업체 수주") return "타업체 선정";
  return "진행 중";
}

function budgetAwardPriority(status: string) {
  if (status === "위즈업 수주") return 1;
  if (status === "협력사 수주") return 2;
  if (status === "타업체 수주") return 3;
  return 0;
}

function budgetTargetSelection(target: SalesCampaignTarget) {
  if (target.currentAwardStatus === "위즈업 수주") {
    return { kind: "whizzup", label: "위즈업 선정" } as const;
  }
  if (target.currentAwardStatus === "타업체 수주") {
    return { kind: "other", label: "타업체 선정" } as const;
  }
  return null;
}

function localDate() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function callablePhone(value: string) {
  const phone = value.trim();
  if (!phone || /^(?:미등록|미입력|해당\s*없음|-)$/.test(phone)) return "";
  const digits = phone.replace(/[^\d+]/g, "");
  const numericDigits = digits.replace(/\D/g, "");
  if (
    numericDigits.length < 8 ||
    /^0+$/.test(numericDigits) ||
    numericDigits === "01000000000"
  ) {
    return "";
  }
  return digits;
}

function compactOrganizationName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function uniqueLocationQueries(queries: string[]) {
  return queries
    .map((query) =>
      query
        .trim()
        .split(/\s+/)
        .filter((token, index, tokens) => token !== tokens[index - 1])
        .join(" "),
    )
    .filter(
      (query, index, normalized) =>
        query.length >= 2 && normalized.indexOf(query) === index,
    );
}

function organizationLocationVariants(organization: string) {
  const withoutKindergartenSuffix = organization
    .replace(/\s*(?:병설(?:유치원)?|부설(?:유치원)?)\s*$/, "")
    .trim();
  const simplified = withoutKindergartenSuffix
    .replace(/\s+(?:관련.*|[가-힣]+학과|[가-힣]+학부|[가-힣]+부서)$/, "")
    .trim();
  const abbreviatedSchool = simplified.replace(/초등학교/g, "초");

  return uniqueLocationQueries([
    abbreviatedSchool,
    simplified,
    withoutKindergartenSuffix,
    organization,
  ]);
}

function regionLocationVariants(region: string) {
  const normalized = region.trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const tokens = normalized.split(" ");
  const locality = tokens.at(-1) ?? "";
  const localityWithSuffix =
    locality && !/[시군구]$/.test(locality) ? `${locality}시` : locality;
  const provinceWithLocality =
    tokens.length > 1 && localityWithSuffix !== locality
      ? [...tokens.slice(0, -1), localityWithSuffix].join(" ")
      : "";

  return uniqueLocationQueries([
    normalized,
    provinceWithLocality,
    locality,
    localityWithSuffix,
  ]);
}

function automaticLocationQueries(item: OrganizationSummary) {
  const organization = item.organization.trim();
  const organizationVariants = organizationLocationVariants(organization);
  const regionVariants = regionLocationVariants(item.region);
  const combined = regionVariants.flatMap((region) =>
    organizationVariants.map((name) => {
      const locality = (region.split(" ").at(-1) ?? "").replace(/[시군구]$/, "");
      const withoutRepeatedLocality = name
        .split(" ")
        .filter(
          (token, index) =>
            index > 0 || token.replace(/[시군구]$/, "") !== locality,
        )
        .join(" ");
      return `${region} ${withoutRepeatedLocality || name}`;
    }),
  );

  return uniqueLocationQueries([
    item.addressHint,
    ...combined,
    ...organizationVariants,
  ]);
}

function recordAddressHint(record: SalesMapRecord) {
  return (
    record.notes.match(/(?:^|\n)\s*주소\s*:\s*([^\n]+)/u)?.[1]?.trim() ?? ""
  );
}

function locationSearchTerms(value: string) {
  return uniqueLocationQueries(value.split(/[\n,;/]+/));
}

function createLocationBatchDraft(item: OrganizationSummary): LocationBatchDraft {
  const location = item.location;
  return {
    organization: item.organization,
    region: item.region,
    searchTerms: automaticLocationQueries(item).slice(0, 4).join(" / "),
    address: location?.address ?? "",
    roadAddress: location?.roadAddress ?? "",
    latitude: location ? String(location.latitude) : "",
    longitude: location ? String(location.longitude) : "",
    placeName: location?.placeName ?? "",
    placeId: location?.placeId ?? "",
    note: location ? "기존 등록 위치" : "자동 매칭 실패",
    selected: false,
    candidates: [],
    searching: false,
    error: "",
    mapped: Boolean(location),
  };
}

function searchKakaoKeyword(maps: KakaoMapsApi, query: string) {
  return new Promise<KakaoPlace[]>((resolve) => {
    const places = new maps.services.Places();
    places.keywordSearch(query, (results, status) => {
      resolve(status === maps.services.Status.OK ? results : []);
    });
  });
}

async function findAutomaticOrganizationPlace(
  maps: KakaoMapsApi,
  item: OrganizationSummary,
) {
  if (ambiguousOrganizationPattern.test(item.organization)) return null;
  const organizationKey = compactOrganizationName(item.organization);

  if (item.addressHint) {
    const addressResults = await new Promise<KakaoAddressResult[]>((resolve) => {
      const geocoder = new maps.services.Geocoder();
      geocoder.addressSearch(item.addressHint, (found, status) => {
        resolve(status === maps.services.Status.OK ? found : []);
      });
    });
    const address = addressResults[0];
    if (address) {
      return {
        id: `address-${institutionAliasKey(item.organization)}`,
        place_name: item.organization,
        address_name:
          address.address?.address_name || address.address_name || item.addressHint,
        road_address_name: address.road_address?.address_name ?? "",
        x: address.x,
        y: address.y,
      };
    }
  }

  for (const query of automaticLocationQueries(item)) {
    const results = await searchKakaoKeyword(maps, query);
    if (!results.length) continue;
    const queryKey = compactOrganizationName(query);
    const ranked = results
      .map((place, index) => {
        const placeKey = compactOrganizationName(place.place_name);
        const address = `${place.road_address_name} ${place.address_name}`;
        let score = Math.max(0, 10 - index);
        if (placeKey === organizationKey) score += 100;
        else if (
          placeKey.includes(organizationKey) ||
          organizationKey.includes(placeKey)
        ) {
          score += 50;
        }
        if (
          placeKey.includes(queryKey) ||
          queryKey.includes(placeKey)
        ) {
          score += 40;
        }
        if (item.region && address.includes(item.region.split(" ")[0])) {
          score += 20;
        }
        return { place, score };
      })
      .sort((a, b) => b.score - a.score);
    if ((ranked[0]?.score ?? 0) >= 40) return ranked[0].place;
  }
  return null;
}

function haversine(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
) {
  const radius = 6371;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isSchoolOrganization(organization: string) {
  const normalized = organization.replace(/\s+/g, "");
  return /(?:초등학교|중학교|고등학교|특수학교|대학교|유치원|병설|초$|중$|고$)/.test(
    normalized,
  );
}

function summarizeDeliveryProducts(projects: Record<string, unknown>[]) {
  const quantityByProduct = new Map<string, number>();
  projects.forEach((project) => {
    const items = Array.isArray(project.items) ? project.items : [];
    items.forEach((rawItem) => {
      if (!rawItem || typeof rawItem !== "object") return;
      const item = rawItem as Record<string, unknown>;
      const name = String(item.product_name ?? item.productName ?? "").trim();
      if (!name) return;
      const quantity = Math.max(
        0,
        Number(item.installed_qty ?? item.installedQty) || 0,
        Number(item.awarded_qty ?? item.awardedQty) || 0,
        Number(item.proposed_qty ?? item.proposedQty) || 0,
      );
      quantityByProduct.set(
        name,
        (quantityByProduct.get(name) ?? 0) + quantity,
      );
    });
  });
  return [...quantityByProduct.entries()].map(([name, quantity]) => ({
    name,
    quantity,
  }));
}

export default function SalesMapPage({
  active,
  displayMode = "map",
  records,
  recordsReady,
  isOwner,
  canManageCampaigns,
  canEditLocations,
  search,
  onSearchChange,
  onOpenOrganization,
  onRecordsChanged,
  onOpenMapCampaign,
}: {
  active: boolean;
  displayMode?: "map" | "budget";
  records: SalesMapRecord[];
  recordsReady: boolean;
  isOwner: boolean;
  canManageCampaigns: boolean;
  canEditLocations: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenOrganization: (organization: string) => void;
  onRecordsChanged: () => Promise<void>;
  onOpenMapCampaign?: (campaignId: number | "all") => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const campaignFileRef = useRef<HTMLInputElement | null>(null);
  const campaignPdfRef = useRef<HTMLInputElement | null>(null);
  const locationBatchFileRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const sdkRef = useRef<KakaoMapsApi | null>(null);
  const overlaysRef = useRef<KakaoOverlay[]>([]);
  const routeLineRef = useRef<KakaoPolyline | null>(null);
  const autoLocateAttemptedRef = useRef(new Set<string>());
  const autoLocateRunningRef = useRef(false);
  const autoLocateRunRef = useRef(0);
  const eligibleOrganizationsRef = useRef<OrganizationSummary[]>([]);
  const onRecordsChangedRef = useRef(onRecordsChanged);
  const onSearchChangeRef = useRef(onSearchChange);
  const skipNextVisibleBoundsFitRef = useRef(false);
  const previousActiveRef = useRef(active);
  const [javascriptKey, setJavascriptKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [locations, setLocations] = useState<OrganizationLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [sdkReady, setSdkReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [mapLoadAttempt, setMapLoadAttempt] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"전체" | MapStatus>("전체");
  const [locationFilter, setLocationFilter] = useState("전체 위치");
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [isMobileMapLayout, setIsMobileMapLayout] = useState(false);
  const [mapLevel, setMapLevel] = useState(13);
  const [selectedProvince, setSelectedProvince] = useState("");
  const [mapViewport, setMapViewport] =
    useState<NumericMapViewport | null>(null);
  const [campaigns, setCampaigns] = useState<SalesCampaign[]>([]);
  const [campaignTargets, setCampaignTargets] = useState<
    SalesCampaignTarget[]
  >([]);
  const [campaignMembers, setCampaignMembers] = useState<CampaignMember[]>([]);
  const [campaignLoading, setCampaignLoading] = useState(true);
  const [activeCampaignId, setActiveCampaignId] = useState<number | "all">(
    "all",
  );
  const [campaignImport, setCampaignImport] =
    useState<CampaignImportPreview | null>(null);
  const [campaignCardMode, setCampaignCardMode] =
    useState<CampaignCardMode>(null);
  const [campaignName, setCampaignName] = useState("");
  const [campaignNotes, setCampaignNotes] = useState("");
  const [campaignSelectionDate, setCampaignSelectionDate] =
    useState(localDate());
  const [campaignDefaultBudgetAmount, setCampaignDefaultBudgetAmount] =
    useState("");
  const [campaignBudget, setCampaignBudget] = useState<BudgetSelection>({
    budgetType: "",
    budgetOriginalName: "",
    budgetGroupId: null,
    budgetMatchStatus: "unclassified",
    budgetMatchMethod: "legacy",
    budgetRequestId: null,
    budgetKind: "",
    budgetAmountMode: "",
  });
  const [budgetStatusFilter, setBudgetStatusFilter] = useState("");
  const [budgetQuickFilter, setBudgetQuickFilter] =
    useState<BudgetQuickFilter>("");
  const [budgetSelectedTargetIds, setBudgetSelectedTargetIds] = useState<
    number[]
  >([]);
  const [budgetBulkAssigneeId, setBudgetBulkAssigneeId] = useState("");
  const [budgetBulkBusy, setBudgetBulkBusy] = useState("");
  const [jointProjectOpen, setJointProjectOpen] = useState(false);
  const [campaignImporting, setCampaignImporting] = useState(false);
  const [campaignPdfAnalyzing, setCampaignPdfAnalyzing] = useState(false);
  const [campaignDeleteTarget, setCampaignDeleteTarget] =
    useState<SalesCampaign | null>(null);
  const [campaignDeleting, setCampaignDeleting] = useState(false);
  const [campaignExistingOpen, setCampaignExistingOpen] = useState(false);
  const [campaignExistingSearch, setCampaignExistingSearch] = useState("");
  const [campaignExistingSelectedIds, setCampaignExistingSelectedIds] =
    useState<number[]>([]);
  const [campaignExistingPage, setCampaignExistingPage] = useState(1);
  const [campaignExistingAdding, setCampaignExistingAdding] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [routeOrder, setRouteOrder] = useState<string[]>([]);
  const [routeMessage, setRouteMessage] = useState("");
  const [routeStartOpen, setRouteStartOpen] = useState(false);
  const [routeStartInput, setRouteStartInput] = useState("");
  const [routeCalculating, setRouteCalculating] = useState(false);
  const [routeLocating, setRouteLocating] = useState(false);
  const [routeOrigin, setRouteOrigin] = useState<RouteOrigin | null>(null);
  const [nearbyOrigin, setNearbyOrigin] = useState<RouteOrigin | null>(null);
  const [nearbyRadius, setNearbyRadius] = useState<NearbyRadius | null>(null);
  const [nearbyLocating, setNearbyLocating] = useState(false);
  const [nearbyMessage, setNearbyMessage] = useState("");
  const [focusedOrganization, setFocusedOrganization] = useState("");
  const [officialSchoolPhoneByLookup, setOfficialSchoolPhoneByLookup] =
    useState<Record<string, OfficialSchoolPhone | null>>({});
  const [officialSchoolPhoneLoadingKey, setOfficialSchoolPhoneLoadingKey] =
    useState("");
  const [deliverySummaryByBusiness, setDeliverySummaryByBusiness] = useState<
    Record<string, MapDeliverySummary>
  >({});
  const [locatingOrganization, setLocatingOrganization] =
    useState<OrganizationSummary | null>(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<KakaoPlace[]>([]);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationBatchOpen, setLocationBatchOpen] = useState(false);
  const [locationBatchRows, setLocationBatchRows] = useState<
    LocationBatchDraft[]
  >([]);
  const [locationBatchShowMapped, setLocationBatchShowMapped] = useState(false);
  const [locationBatchSaving, setLocationBatchSaving] = useState(false);
  const [locationBatchMessage, setLocationBatchMessage] = useState("");
  const [campaignInstitutionSearch, setCampaignInstitutionSearch] = useState<{
    rowId: string;
    query: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [searchDraft, setSearchDraft] = useState(search);
  const deferredCampaignInstitutionSearch = useDeferredValue(
    campaignInstitutionSearch,
  );
  const campaignInstitutionOptions = useMemo<CampaignInstitutionOption[]>(() => {
    const byKey = new Map<
      string,
      {
        aliases: Set<string>;
        latest: SalesMapRecord;
      }
    >();

    records.forEach((record) => {
      const key = institutionAliasKey(record.organization);
      if (!key) return;
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, {
          aliases: new Set([record.organization]),
          latest: record,
        });
        return;
      }
      current.aliases.add(record.organization);
      if (
        record.activityDate.localeCompare(current.latest.activityDate) > 0 ||
        (record.activityDate === current.latest.activityDate &&
          (record.businessRound > current.latest.businessRound ||
            (record.businessRound === current.latest.businessRound &&
              record.id > current.latest.id)))
      ) {
        current.latest = record;
      }
    });

    return [...byKey.entries()].map(([key, entry]) => {
      const aliases = [...entry.aliases].sort((left, right) =>
        left.localeCompare(right, "ko-KR"),
      );
      const latest = entry.latest;
      return {
        key,
        activityId: latest.id,
        organization: latest.organization,
        aliases,
        region: latest.region,
        businessRound: latest.businessRound,
        activityDate: latest.activityDate,
        status: latest.status,
        awardStatus: latest.awardStatus,
        stageLabel: campaignBusinessStageLabel(latest),
        budgetType: latest.budgetType,
        progressManager: latest.progressManager,
        contactName: latest.contactName,
        contactPhone: latest.contactPhone,
        searchText: [
          ...aliases,
          latest.region,
          latest.budgetType,
          latest.progressManager,
          latest.contactName,
          latest.contactPhone,
        ]
          .map(institutionSearchText)
          .join(" "),
      };
    });
  }, [records]);
  const campaignInstitutionByKey = useMemo(
    () =>
      new Map(
        campaignInstitutionOptions.map((option) => [option.key, option] as const),
      ),
    [campaignInstitutionOptions],
  );
  const campaignLatestRecordByOrganization = useMemo(() => {
    const latestByOrganization = new Map<string, SalesMapRecord>();
    records.forEach((record) => {
      const key = institutionAliasKey(record.organization);
      if (!key) return;
      const current = latestByOrganization.get(key);
      if (
        !current ||
        record.activityDate.localeCompare(current.activityDate) > 0 ||
        (record.activityDate === current.activityDate &&
          (record.businessRound > current.businessRound ||
            (record.businessRound === current.businessRound &&
              record.id > current.id)))
      ) {
        latestByOrganization.set(key, record);
      }
    });
    return latestByOrganization;
  }, [records]);
  const campaignLinkableRecordsByOrganizationYear = useMemo(() => {
    const recordsByOrganizationYear = new Map<
      string,
      Map<number, SalesMapRecord>
    >();
    records.forEach((record) => {
      if (["협력사 수주", "타업체 수주"].includes(record.awardStatus)) return;
      const organizationKey = institutionAliasKey(record.organization);
      const year = record.activityDate.slice(0, 4);
      if (!organizationKey || !year) return;
      const key = `${organizationKey}::${year}`;
      const recordsByRound =
        recordsByOrganizationYear.get(key) ?? new Map<number, SalesMapRecord>();
      const current = recordsByRound.get(record.businessRound);
      if (
        !current ||
        record.activityDate.localeCompare(current.activityDate) > 0 ||
        (record.activityDate === current.activityDate && record.id > current.id)
      ) {
        recordsByRound.set(record.businessRound, record);
      }
      recordsByOrganizationYear.set(key, recordsByRound);
    });
    return new Map(
      [...recordsByOrganizationYear.entries()].map(([key, recordsByRound]) => [
        key,
        [...recordsByRound.values()].sort(
          (left, right) =>
            right.businessRound - left.businessRound ||
            right.activityDate.localeCompare(left.activityDate) ||
            right.id - left.id,
        ),
      ]),
    );
  }, [records]);
  const campaignInstitutionSuggestions = useMemo(() => {
    if (!deferredCampaignInstitutionSearch) return [];
    const query = institutionSearchText(
      deferredCampaignInstitutionSearch.query,
    );
    if (!query) return [];

    return campaignInstitutionOptions
      .map((option) => {
        const displayName = institutionSearchText(option.organization);
        const aliasStartsWith = option.aliases.some((alias) =>
          institutionSearchText(alias).startsWith(query),
        );
        const score = displayName.startsWith(query)
          ? 0
          : aliasStartsWith
            ? 1
            : option.searchText.includes(query) || option.key.includes(query)
              ? 2
              : -1;
        return { option, score };
      })
      .filter(({ score }) => score >= 0)
      .sort(
        (left, right) =>
          left.score - right.score ||
          right.option.activityDate.localeCompare(left.option.activityDate) ||
          left.option.organization.localeCompare(
            right.option.organization,
            "ko-KR",
          ),
      )
      .slice(0, 10)
      .map(({ option }) => option);
  }, [campaignInstitutionOptions, deferredCampaignInstitutionSearch]);

  useEffect(() => {
    window.sessionStorage.removeItem(LEGACY_MAP_SELECTION_STORAGE_KEY);
  }, []);

  useEffect(() => {
    const wasActive = previousActiveRef.current;
    previousActiveRef.current = active;
    if (active === wasActive) return;

    setSelected([]);
    setRouteOrder([]);
    setRouteMessage("");
    setRouteStartOpen(false);
    setRouteStartInput("");
    setRouteOrigin(null);
    setNearbyOrigin(null);
    setNearbyRadius(null);
    setNearbyMessage("");
    setFocusedOrganization("");
    setStatusFilter("전체");
    setLocationFilter("전체 위치");
    setActiveCampaignId("all");
    setMobileView("map");
    skipNextVisibleBoundsFitRef.current = false;
    setSelectedProvince("");
    onSearchChangeRef.current("");

    if (active && mapRef.current && sdkRef.current) {
      const maps = sdkRef.current;
      mapRef.current.setCenter(new maps.LatLng(36.4, 127.8));
      mapRef.current.setLevel(13);
      mapRef.current.relayout();
    }
  }, [active]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const syncMobileLayout = () => setIsMobileMapLayout(media.matches);
    syncMobileLayout();
    media.addEventListener("change", syncMobileLayout);
    return () => media.removeEventListener("change", syncMobileLayout);
  }, []);

  useEffect(() => {
    if (!campaignDeleteTarget || campaignDeleting) return;
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setCampaignDeleteTarget(null);
    };
    document.addEventListener("keydown", closeWithEscape);
    return () => document.removeEventListener("keydown", closeWithEscape);
  }, [campaignDeleteTarget, campaignDeleting]);

  async function loadCampaigns() {
    try {
      setCampaignLoading(true);
      const response = await fetch("/api/map/campaigns", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        campaigns?: Record<string, unknown>[];
        targets?: Record<string, unknown>[];
        members?: Record<string, unknown>[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.error || "영업 카테고리를 불러오지 못했습니다.",
        );
      }
      setCampaigns((payload.campaigns ?? []).map(normalizeCampaign));
      setCampaignTargets(
        (payload.targets ?? []).map(normalizeCampaignTarget),
      );
      setCampaignMembers(
        (payload.members ?? []).map(normalizeCampaignMember),
      );
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "영업 카테고리를 불러오지 못했습니다.",
      );
    } finally {
      setCampaignLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    if (displayMode === "map") {
      setConfigLoading(true);
      setLocationsLoading(true);
      void fetch("/api/map/config", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          javascriptKey?: string;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "지도 설정을 확인하지 못했습니다.");
        return payload.javascriptKey ?? "";
      })
      .then((key) => {
        if (mounted) setJavascriptKey(key);
      })
      .catch((caught: unknown) => {
        if (mounted) {
          setMapError(
            caught instanceof Error
              ? caught.message
              : "지도 설정을 확인하지 못했습니다.",
          );
        }
      })
      .finally(() => {
        if (mounted) setConfigLoading(false);
      });

    void fetch("/api/map/locations", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          locations?: Record<string, unknown>[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "기관 위치를 불러오지 못했습니다.");
        return (payload.locations ?? []).map(normalizeLocation);
      })
      .then((nextLocations) => {
        if (mounted) setLocations(nextLocations);
      })
      .catch((caught: unknown) => {
        if (mounted) {
          setMapError(
            caught instanceof Error
              ? caught.message
              : "기관 위치를 불러오지 못했습니다.",
          );
        }
      })
      .finally(() => {
        if (mounted) setLocationsLoading(false);
      });
    } else {
      setConfigLoading(false);
      setLocationsLoading(false);
    }

    void fetch("/api/map/campaigns", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          campaigns?: Record<string, unknown>[];
          targets?: Record<string, unknown>[];
          members?: Record<string, unknown>[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            payload.error || "영업 카테고리를 불러오지 못했습니다.",
          );
        }
        return {
          campaigns: (payload.campaigns ?? []).map(normalizeCampaign),
          targets: (payload.targets ?? []).map(normalizeCampaignTarget),
          members: (payload.members ?? []).map(normalizeCampaignMember),
        };
      })
      .then((campaignData) => {
        if (!mounted) return;
        setCampaigns(campaignData.campaigns);
        setCampaignTargets(campaignData.targets);
        setCampaignMembers(campaignData.members);
      })
      .catch((caught: unknown) => {
        if (mounted) {
          setNotice(
            caught instanceof Error
              ? caught.message
              : "영업 카테고리를 불러오지 못했습니다.",
          );
        }
      })
      .finally(() => {
        if (mounted) setCampaignLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [displayMode]);

  useEffect(() => {
    if (
      displayMode !== "map" ||
      !active ||
      configLoading ||
      !javascriptKey ||
      !mapContainerRef.current
    ) {
      return;
    }
    let mounted = true;
    setMapError("");
    if (
      mapRef.current &&
      mapHostRef.current &&
      mapHostRef.current !== mapContainerRef.current
    ) {
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
      routeLineRef.current?.setMap(null);
      routeLineRef.current = null;
      mapRef.current = null;
      mapHostRef.current = null;
    }
    if (mapRef.current && sdkRef.current) {
      mapRef.current.relayout();
      setSdkReady(true);
      return;
    }
    setSdkReady(false);
    void loadKakaoMaps(javascriptKey)
      .then((maps) => {
        if (!mounted || !mapContainerRef.current) return;
        sdkRef.current = maps;
        if (!mapRef.current) {
          mapRef.current = new maps.Map(mapContainerRef.current, {
            center: new maps.LatLng(36.4, 127.8),
            level: 13,
          });
          mapHostRef.current = mapContainerRef.current;
        }
        setSdkReady(true);
      })
      .catch((caught: unknown) => {
        if (mounted) {
          setMapError(
            caught instanceof Error
              ? caught.message
              : "카카오 지도 연결을 확인해 주세요.",
          );
        }
      });
    return () => {
      mounted = false;
    };
  }, [
    active,
    configLoading,
    displayMode,
    javascriptKey,
    mapLoadAttempt,
  ]);

  useEffect(() => {
    if (!active || !mapRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      mapRef.current?.relayout();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (!sdkReady || !sdkRef.current || !mapRef.current) return;
    const maps = sdkRef.current;
    const map = mapRef.current;
    const syncViewport = () => {
      const bounds = map.getBounds();
      const southWest = bounds.getSouthWest();
      const northEast = bounds.getNorthEast();
      const nextViewport = {
        south: southWest.getLat(),
        north: northEast.getLat(),
        west: southWest.getLng(),
        east: northEast.getLng(),
        level: map.getLevel(),
      };
      setMapLevel(nextViewport.level);
      setMapViewport((current) => {
        if (
          current &&
          Math.abs(current.south - nextViewport.south) < 0.000001 &&
          Math.abs(current.north - nextViewport.north) < 0.000001 &&
          Math.abs(current.west - nextViewport.west) < 0.000001 &&
          Math.abs(current.east - nextViewport.east) < 0.000001 &&
          current.level === nextViewport.level
        ) {
          return current;
        }
        return nextViewport;
      });
    };

    maps.event.addListener(map, "idle", syncViewport);
    syncViewport();
    return () => maps.event.removeListener(map, "idle", syncViewport);
  }, [sdkReady]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    onRecordsChangedRef.current = onRecordsChanged;
  }, [onRecordsChanged]);

  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  useEffect(() => {
    if (searchDraft === search) return;
    const timer = window.setTimeout(() => {
      onSearchChangeRef.current(searchDraft);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [search, searchDraft]);

  const locationByOrganization = useMemo(
    () =>
      new Map(
        locations.map(
          (location) =>
            [institutionAliasKey(location.organization), location] as const,
        ),
      ),
    [locations],
  );

  const organizations = useMemo(() => {
    const sorted = [...records].sort(
      (a, b) =>
        b.activityDate.localeCompare(a.activityDate) || b.id - a.id,
    );
    const grouped = new Map<string, SalesMapRecord[]>();
    sorted.forEach((record) => {
      if (!record.organization.trim()) return;
      const institutionKey = institutionAliasKey(record.organization);
      if (!institutionKey) return;
      const current = grouped.get(institutionKey) ?? [];
      current.push(record);
      grouped.set(institutionKey, current);
    });
    return [...grouped.entries()]
      .map(([, history]) => {
        const latest = history[0];
        const organization = latest.organization.trim();
        const currentBusinessRound = Math.max(
          ...history.map((record) =>
            Math.max(1, Number(record.businessRound) || 1),
          ),
        );
        const currentBusinessHistory = history.filter(
          (record) =>
            Math.max(1, Number(record.businessRound) || 1) ===
            currentBusinessRound,
        );
        const award =
          currentBusinessHistory.find(
            (record) => record.awardStatus !== "미정",
          ) ?? latest;
        const completedAward =
          currentBusinessHistory.find((record) =>
            Boolean(record.awardCompletedDate.trim()),
          ) ?? award;
        const region =
          history.find((record) => record.region.trim())?.region ?? "";
        const contactPhone =
          history.find((record) => callablePhone(record.contactPhone))
            ?.contactPhone ?? "";
        const addressHint =
          history.map(recordAddressHint).find(Boolean) ?? "";
        return {
          organization,
          region,
          businessRound: currentBusinessRound,
          lastActivityDate: latest.activityDate,
          status: resolveMapStatus(award),
          awardStatus: award.awardStatus,
          awardCompany: award.awardCompany,
          awardStage: award.awardStage,
          awardCompletedDate: completedAward.awardCompletedDate,
          budgetAmount: award.budgetAmount,
          budgetType: award.budgetType,
          executionType: award.executionType,
          consortiumCompany: award.consortiumCompany,
          progressManager: award.progressManager,
          contactPhone,
          addressHint,
          summary:
            latest.nextAction ||
            latest.summary ||
            latest.topic ||
            "최근 내용 미입력",
          searchText: history
            .flatMap((record) => [
              record.contactName,
              record.contactPhone,
              record.progressManager,
              record.topic,
              record.summary,
              record.nextAction,
              record.notes,
              recordAddressHint(record),
            ])
            .filter(Boolean)
            .join(" "),
          location: locationByOrganization.get(
            institutionAliasKey(organization),
          ),
        } satisfies OrganizationSummary;
      })
      .sort((a, b) => a.organization.localeCompare(b.organization, "ko-KR"));
  }, [records, locationByOrganization]);

  const eligibleOrganizations = useMemo(
    () => organizations.filter((item) => item.status !== "타업체"),
    [organizations],
  );

  useEffect(() => {
    eligibleOrganizationsRef.current = eligibleOrganizations;
  }, [eligibleOrganizations]);

  useEffect(() => {
    const maps = sdkRef.current;
    if (
      displayMode !== "map" ||
      !canEditLocations ||
      !recordsReady ||
      !sdkReady ||
      locationsLoading ||
      !maps ||
      autoLocateRunningRef.current
    ) {
      return;
    }
    const pending = eligibleOrganizationsRef.current.filter(
      (item) =>
        !item.location &&
        !autoLocateAttemptedRef.current.has(item.organization),
    );
    if (!pending.length) return;

    let cancelled = false;
    const runId = ++autoLocateRunRef.current;
    autoLocateRunningRef.current = true;
    void (async () => {
      let savedCount = 0;
      for (const item of pending) {
        if (cancelled) break;
        autoLocateAttemptedRef.current.add(item.organization);
        try {
          const place = await findAutomaticOrganizationPlace(maps, item);
          if (cancelled) {
            autoLocateAttemptedRef.current.delete(item.organization);
            break;
          }
          if (!place) continue;
          const response = await fetch("/api/map/locations", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organization: item.organization,
              region: item.region,
              address: place.address_name,
              roadAddress: place.road_address_name,
              latitude: Number(place.y),
              longitude: Number(place.x),
              placeName: place.place_name,
              placeId: place.id,
            }),
          });
          const payload = (await response.json()) as {
            location?: Record<string, unknown>;
          };
          if (cancelled) {
            autoLocateAttemptedRef.current.delete(item.organization);
            break;
          }
          if (!response.ok || !payload.location) continue;
          const saved = normalizeLocation(payload.location);
          setLocations((current) => [
            ...current.filter(
              (location) => location.organization !== saved.organization,
            ),
            saved,
          ]);
          savedCount += 1;
        } catch {
          if (cancelled) {
            autoLocateAttemptedRef.current.delete(item.organization);
            break;
          }
          continue;
        }
      }

      if (autoLocateRunRef.current === runId) {
        autoLocateRunningRef.current = false;
      }
      if (!cancelled && savedCount) {
        await onRecordsChangedRef.current();
        setNotice(
          `${savedCount}개 기관의 위치와 지역을 자동으로 등록했습니다.`,
        );
      }
    })().catch(() => {
      if (autoLocateRunRef.current === runId) {
        autoLocateRunningRef.current = false;
      }
    });

    return () => {
      cancelled = true;
      if (autoLocateRunRef.current === runId) {
        autoLocateRunningRef.current = false;
      }
    };
  }, [canEditLocations, displayMode, locationsLoading, records, recordsReady, sdkReady]);

  const activeCampaign = useMemo(
    () =>
      activeCampaignId === "all"
        ? null
        : campaigns.find((campaign) => campaign.id === activeCampaignId) ??
          null,
    [activeCampaignId, campaigns],
  );
  const activeCampaignTargets = useMemo(
    () =>
      activeCampaignId === "all"
        ? []
        : campaignTargets.filter(
            (target) => target.campaignId === activeCampaignId,
          ),
    [activeCampaignId, campaignTargets],
  );
  const budgetPortfolioSummary = useMemo(() => {
    const uniqueInstitutions = new Set<string>();
    const budgetKeysByInstitution = new Map<string, Set<string>>();
    const campaignById = new Map(
      campaigns.map((campaign) => [campaign.id, campaign] as const),
    );
    campaignTargets.forEach((target) => {
      const institutionKey =
        institutionAliasKey(target.organization) ||
        institutionSearchText(target.organization);
      if (!institutionKey) return;
      uniqueInstitutions.add(institutionKey);
      const campaign = campaignById.get(target.campaignId);
      const budgetKey = campaign?.budgetGroupId
        ? `group:${campaign.budgetGroupId}`
        : `name:${institutionSearchText(campaign?.budgetType || "")}`;
      const current = budgetKeysByInstitution.get(institutionKey) ?? new Set<string>();
      if (budgetKey !== "name:") current.add(budgetKey);
      budgetKeysByInstitution.set(institutionKey, current);
    });
    return {
      uniqueInstitutionCount: uniqueInstitutions.size,
      participationCount: campaignTargets.length,
      multipleBudgetInstitutionCount: [...budgetKeysByInstitution.values()].filter(
        (budgetKeys) => budgetKeys.size > 1,
      ).length,
    };
  }, [campaignTargets, campaigns]);
  const selectedBudgetJointCandidates = useMemo<JointProjectCandidate[]>(
    () =>
      budgetSelectedTargetIds
        .map((id) => activeCampaignTargets.find((target) => target.id === id))
        .filter((target): target is SalesCampaignTarget => Boolean(target))
        .map((target) => ({
          organization: target.organization,
          businessRound: target.businessRound,
          campaignTargetId: target.id,
          budgetAmount: target.budgetAmount,
          budgetType: activeCampaign?.budgetType ?? target.currentBudgetType,
          jointProjectId: target.jointProjectId,
          jointProjectName: target.jointProjectName,
        })),
    [activeCampaign, activeCampaignTargets, budgetSelectedTargetIds],
  );
  const jointProjectSponsorOptions = useMemo<JointProjectCandidate[]>(() => {
    const latest = new Map<string, SalesMapRecord>();
    [...records]
      .sort(
        (left, right) =>
          right.activityDate.localeCompare(left.activityDate) || right.id - left.id,
      )
      .forEach((record) => {
        const key = institutionAliasKey(record.organization);
        if (key && !latest.has(key)) latest.set(key, record);
      });
    return [...latest.values()].map((record) => ({
      organization: record.organization,
      businessRound: Math.max(1, record.businessRound || 1),
      activityId: record.id,
      budgetAmount:
        Number(String(record.budgetAmount).replace(/[^0-9.-]/g, "")) || null,
      budgetType: record.budgetType,
      jointProjectId: record.jointProjectId ?? null,
      jointProjectName: record.jointProjectName ?? "",
    }));
  }, [records]);
  useEffect(() => {
    setBudgetSelectedTargetIds([]);
    setBudgetBulkAssigneeId("");
    setBudgetStatusFilter("");
    setBudgetQuickFilter("");
  }, [activeCampaignId]);
  const activeCampaignOrganizationKeys = useMemo(
    () =>
      new Set(
        activeCampaignTargets
          .map((target) => institutionAliasKey(target.organization))
          .filter(Boolean),
      ),
    [activeCampaignTargets],
  );
  const activeCampaignAddressKeys = useMemo(
    () =>
      new Set(
        activeCampaignTargets
          .map((target) => institutionSearchText(target.address || ""))
          .filter(Boolean),
      ),
    [activeCampaignTargets],
  );
  const campaignImportUsesActiveList = Boolean(
    campaignImport?.source === "excel" &&
      activeCampaign &&
      campaignBudget.budgetGroupId &&
      activeCampaign.budgetGroupId === campaignBudget.budgetGroupId,
  );
  const campaignImportPartition = useMemo(() => {
    const pending: Array<{ row: CampaignImportRow; index: number }> = [];
    const excluded: Array<{ row: CampaignImportRow; index: number }> = [];
    (campaignImport?.rows ?? []).forEach((row, index) => {
      const organizationKeys = [
        row.organization,
        row.confirmedOrganization,
        ...row.existingOrganizations,
      ]
        .map((value) => institutionAliasKey(value))
        .filter(Boolean);
      const addressKey = institutionSearchText(row.address || "");
      const alreadyRegistered =
        campaignImportUsesActiveList &&
        (organizationKeys.some((key) => activeCampaignOrganizationKeys.has(key)) ||
          Boolean(addressKey && activeCampaignAddressKeys.has(addressKey)));
      (alreadyRegistered ? excluded : pending).push({ row, index });
    });
    return { pending, excluded };
  }, [
    activeCampaignAddressKeys,
    activeCampaignOrganizationKeys,
    campaignImport?.rows,
    campaignImportUsesActiveList,
  ]);
  const pendingCampaignImportRows = campaignImportPartition.pending.map(
    ({ row }) => row,
  );
  const campaignExistingOptions = useMemo(() => {
    const query = institutionSearchText(campaignExistingSearch);
    return campaignInstitutionOptions
      .filter(
        (option) => !activeCampaignOrganizationKeys.has(option.key),
      )
      .filter(
        (option) =>
          !query ||
          option.searchText.includes(query) ||
          option.key.includes(query),
      )
      .sort(
        (left, right) =>
          right.activityDate.localeCompare(left.activityDate) ||
          left.organization.localeCompare(right.organization, "ko-KR"),
      );
  }, [
    activeCampaignOrganizationKeys,
    campaignExistingSearch,
    campaignInstitutionOptions,
  ]);
  const campaignExistingPageCount = Math.max(
    1,
    Math.ceil(
      campaignExistingOptions.length / CAMPAIGN_EXISTING_PAGE_SIZE,
    ),
  );
  const safeCampaignExistingPage = Math.min(
    campaignExistingPage,
    campaignExistingPageCount,
  );
  const pagedCampaignExistingOptions = campaignExistingOptions.slice(
    (safeCampaignExistingPage - 1) * CAMPAIGN_EXISTING_PAGE_SIZE,
    safeCampaignExistingPage * CAMPAIGN_EXISTING_PAGE_SIZE,
  );
  const campaignExistingSelectedSet = new Set(
    campaignExistingSelectedIds,
  );
  const campaignExistingAllSelected =
    campaignExistingOptions.length > 0 &&
    campaignExistingOptions.every((option) =>
      campaignExistingSelectedSet.has(option.activityId),
    );
  useEffect(() => {
    if (
      displayMode === "budget" &&
      campaigns.length &&
      (activeCampaignId === "all" ||
        !campaigns.some((campaign) => campaign.id === activeCampaignId))
    ) {
      setActiveCampaignId(campaigns[0].id);
    }
  }, [activeCampaignId, campaigns, displayMode]);
  const activeCampaignOrganizations = useMemo(
    () =>
      activeCampaignId === "all"
        ? null
        : new Set(
            activeCampaignTargets.map((target) => target.organization),
          ),
    [activeCampaignId, activeCampaignTargets],
  );
  const activeCampaignTargetByOrganization = useMemo(
    () =>
      new Map(
        activeCampaignTargets.map(
          (target) => [target.organization, target] as const,
        ),
      ),
    [activeCampaignTargets],
  );
  const eligibleNames = useMemo(
    () => new Set(eligibleOrganizations.map((item) => item.organization)),
    [eligibleOrganizations],
  );
  const activeSelected = useMemo(
    () => selected.filter((organization) => eligibleNames.has(organization)),
    [selected, eligibleNames],
  );
  const activeRouteOrder = useMemo(
    () =>
      routeOrder.filter((organization) =>
        activeSelected.includes(organization),
      ),
    [routeOrder, activeSelected],
  );

  const nearbyDistanceByOrganization = useMemo(() => {
    const distances = new Map<string, number>();
    if (!nearbyOrigin) return distances;
    eligibleOrganizations.forEach((item) => {
      if (!item.location) return;
      distances.set(
        item.organization,
        haversine(nearbyOrigin, item.location),
      );
    });
    return distances;
  }, [eligibleOrganizations, nearbyOrigin]);

  const baseFilteredOrganizations = useMemo(() => {
    const filtered = eligibleOrganizations.filter((item) => {
      if (nearbyOrigin && nearbyRadius) {
        const distance = nearbyDistanceByOrganization.get(item.organization);
        if (
          item.status !== "완료" ||
          !item.location ||
          !isSchoolOrganization(item.organization) ||
          distance === undefined ||
          distance > nearbyRadius
        ) {
          return false;
        }
      }
      if (
        activeCampaignOrganizations &&
        !activeCampaignOrganizations.has(item.organization)
      ) {
        return false;
      }
      if (statusFilter !== "전체" && item.status !== statusFilter) return false;
      if (locationFilter === "위치 등록" && !item.location) return false;
      if (locationFilter === "위치 미등록" && item.location) return false;
      return true;
    });
    if (nearbyOrigin && nearbyRadius) {
      filtered.sort(
        (first, second) =>
          (nearbyDistanceByOrganization.get(first.organization) ?? Infinity) -
          (nearbyDistanceByOrganization.get(second.organization) ?? Infinity),
      );
    }
    return filtered;
  }, [
    eligibleOrganizations,
    activeCampaignOrganizations,
    nearbyDistanceByOrganization,
    nearbyOrigin,
    nearbyRadius,
    statusFilter,
    locationFilter,
  ]);

  const filteredOrganizations = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return baseFilteredOrganizations.filter((item) =>
      organizationMatchesMapSearch(
        item,
        activeCampaignTargetByOrganization.get(item.organization),
        keyword,
      ),
    );
  }, [
    activeCampaignTargetByOrganization,
    baseFilteredOrganizations,
    search,
  ]);

  const draftFilteredOrganizations = useMemo(() => {
    const keyword = searchDraft.trim().toLowerCase();
    return baseFilteredOrganizations.filter((item) =>
      organizationMatchesMapSearch(
        item,
        activeCampaignTargetByOrganization.get(item.organization),
        keyword,
      ),
    );
  }, [
    activeCampaignTargetByOrganization,
    baseFilteredOrganizations,
    searchDraft,
  ]);

  const visibleOrganizations = useMemo(
    () =>
      selectedProvince
        ? filteredOrganizations.filter(
            (item) =>
              canonicalProvinceName(
                [
                  item.region,
                  item.location?.roadAddress,
                  item.location?.address,
                ]
                  .filter(Boolean)
                  .join(" "),
              )?.province === selectedProvince,
          )
        : filteredOrganizations,
    [filteredOrganizations, selectedProvince],
  );

  const visibleMapped = useMemo(
    () => visibleOrganizations.filter((item) => item.location),
    [visibleOrganizations],
  );
  const viewportOrganizations = useMemo(() => {
    if (
      isMobileMapLayout ||
      !sdkReady ||
      !mapViewport ||
      locationFilter === "위치 미등록"
    ) {
      return filteredOrganizations;
    }
    return filteredOrganizations.filter(
      (item) =>
        item.location &&
        pointIsInsideMapViewport(
          item.location.latitude,
          item.location.longitude,
          mapViewport,
        ),
    );
  }, [
    filteredOrganizations,
    isMobileMapLayout,
    locationFilter,
    mapViewport,
    sdkReady,
  ]);
  const hasDraftSearch = Boolean(searchDraft.trim());
  const mapListOrganizations = hasDraftSearch
    ? draftFilteredOrganizations
    : viewportOrganizations;
  const selectionScopeLabel = hasDraftSearch ? "검색 결과" : "현재 목록";
  const selectionCandidates = useMemo(
    () =>
      hasDraftSearch
        ? mapListOrganizations.filter((item) => item.location)
        : mapListOrganizations,
    [hasDraftSearch, mapListOrganizations],
  );
  const mapListMappedCount = mapListOrganizations.filter(
    (item) => item.location,
  ).length;
  const mapListUnmappedCount =
    mapListOrganizations.length - mapListMappedCount;

  const focused = eligibleOrganizations.find(
    (item) => item.organization === focusedOrganization,
  );
  const focusedDeliveryKey = focused
    ? `${institutionAliasKey(focused.organization)}:${focused.businessRound}`
    : "";
  const focusedDeliverySummary = focusedDeliveryKey
    ? deliverySummaryByBusiness[focusedDeliveryKey]
    : undefined;
  const focusedDeliveryOrganization = focused?.organization ?? "";
  const focusedDeliveryBusinessRound = focused?.businessRound ?? 1;
  const focusedProductsAreDelivered = focused?.status === "완료";
  const focusedProductHeading = focused
    ? `${focused.businessRound}차 사업 ${
        focusedProductsAreDelivered ? "납품 제품" : "예정 품목"
      }`
    : "예정 품목";
  const focusedCampaignTarget = focused
    ? activeCampaignTargetByOrganization.get(focused.organization)
    : undefined;
  const focusedDirectPhone =
    [
      focused?.contactPhone ?? "",
      focusedCampaignTarget?.phone ?? "",
    ].find((phone) => callablePhone(phone)) ?? "";
  const focusedSchoolLookupRegion = focused?.region || "";
  const focusedSchoolLookupAddress = focused
    ? focused.location?.roadAddress || focused.location?.address || ""
    : "";
  const focusedSchoolLookupContext = [
    focusedSchoolLookupRegion,
    focusedSchoolLookupAddress,
  ]
    .filter(Boolean)
    .join("|");
  const focusedSchoolLookupKey = focused
    ? `${focused.organization}|${focusedSchoolLookupContext}`
    : "";
  const focusedOfficialSchool = focusedSchoolLookupKey
    ? officialSchoolPhoneByLookup[focusedSchoolLookupKey]
    : undefined;

  useEffect(() => {
    if (!focusedDeliveryOrganization || !focusedDeliveryKey) {
      return;
    }

    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({
      organization: focusedDeliveryOrganization,
      businessRound: String(focusedDeliveryBusinessRound),
    });
    setDeliverySummaryByBusiness((current) => ({
      ...current,
      [focusedDeliveryKey]: {
        loading: true,
        products: [],
        error: "",
      },
    }));

    void fetch(`/api/equipment?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          projects?: Record<string, unknown>[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "납품 제품을 확인하지 못했습니다.");
        }
        if (!active) return;
        setDeliverySummaryByBusiness((current) => ({
          ...current,
          [focusedDeliveryKey]: {
            loading: false,
            products: summarizeDeliveryProducts(payload.projects ?? []),
            error: "",
          },
        }));
      })
      .catch((caught: unknown) => {
        if (
          !active ||
          (caught instanceof DOMException && caught.name === "AbortError")
        ) {
          return;
        }
        setDeliverySummaryByBusiness((current) => ({
          ...current,
          [focusedDeliveryKey]: {
            loading: false,
            products: [],
            error:
              caught instanceof Error
                ? caught.message
                : "납품 제품을 확인하지 못했습니다.",
          },
        }));
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    focusedDeliveryBusinessRound,
    focusedDeliveryKey,
    focusedDeliveryOrganization,
  ]);

  useEffect(() => {
    if (
      !focused ||
      !focusedSchoolLookupKey ||
      callablePhone(focusedDirectPhone) ||
      Object.prototype.hasOwnProperty.call(
        officialSchoolPhoneByLookup,
        focusedSchoolLookupKey,
      )
    ) {
      setOfficialSchoolPhoneLoadingKey((current) =>
        current === focusedSchoolLookupKey ? "" : current,
      );
      return;
    }

    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({
      organization: focused.organization,
      region: focusedSchoolLookupRegion,
      address: focusedSchoolLookupAddress,
    });
    setOfficialSchoolPhoneLoadingKey(focusedSchoolLookupKey);

    void fetch(`/api/school-directory/lookup?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          school?: OfficialSchoolPhone | null;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "학교 대표전화를 확인하지 못했습니다.");
        }
        if (!active) return;
        setOfficialSchoolPhoneByLookup((current) => ({
          ...current,
          [focusedSchoolLookupKey]: payload.school ?? null,
        }));
      })
      .catch((caught: unknown) => {
        if (
          !active ||
          (caught instanceof DOMException && caught.name === "AbortError")
        ) {
          return;
        }
      })
      .finally(() => {
        if (active) {
          setOfficialSchoolPhoneLoadingKey((current) =>
            current === focusedSchoolLookupKey ? "" : current,
          );
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    focused,
    focusedDirectPhone,
    focusedSchoolLookupAddress,
    focusedSchoolLookupContext,
    focusedSchoolLookupKey,
    focusedSchoolLookupRegion,
    officialSchoolPhoneByLookup,
  ]);

  function changeMobileView(view: "map" | "list") {
    setMobileView(view);
  }

  function clearMapSelection() {
    skipNextVisibleBoundsFitRef.current = false;
    setSelectedProvince("");
    setSelected([]);
    setRouteOrder([]);
    setRouteMessage("");
    setRouteStartOpen(false);
    setRouteOrigin(null);
    setFocusedOrganization("");
    onSearchChange("");
  }

  function selectCampaign(campaignId: number | "all") {
    skipNextVisibleBoundsFitRef.current = false;
    setSelectedProvince("");
    setActiveCampaignId(campaignId);
    setNearbyOrigin(null);
    setNearbyRadius(null);
    setNearbyMessage("");
    setSelected([]);
    setRouteOrder([]);
    setRouteMessage("");
    setRouteStartOpen(false);
    setRouteOrigin(null);
    setFocusedOrganization("");
    setStatusFilter("전체");
    setLocationFilter("전체 위치");
    onSearchChange("");
    changeMobileView("list");
  }

  function clearNearbyFilter() {
    skipNextVisibleBoundsFitRef.current = false;
    setSelectedProvince("");
    setNearbyOrigin(null);
    setNearbyRadius(null);
    setNearbyMessage("");
    if (nearbyRadius) {
      setSelected([]);
      setRouteOrder([]);
      setRouteMessage("");
      setRouteStartOpen(false);
      setRouteOrigin(null);
    }
  }

  async function showNearbyInstalledSchools(radius: NearbyRadius) {
    if (!navigator.geolocation) {
      setNearbyMessage("이 기기에서는 현재 위치를 확인할 수 없습니다.");
      return;
    }

    const applyRadius = (origin: RouteOrigin) => {
      const nearbySchools = eligibleOrganizations.filter((item) => {
        if (
          item.status !== "완료" ||
          !item.location ||
          !isSchoolOrganization(item.organization)
        ) {
          return false;
        }
        return haversine(origin, item.location) <= radius;
      });
      const count = nearbySchools.length;

      setNearbyOrigin(origin);
      setNearbyRadius(radius);
      setNearbyMessage(
        count
          ? `내 위치에서 ${radius}km 안의 설치 완료 학교 ${count}곳을 표시합니다.`
          : `내 위치에서 ${radius}km 안에 위치가 등록된 설치 완료 학교가 없습니다.`,
      );
      setActiveCampaignId("all");
      setStatusFilter("전체");
      setLocationFilter("전체 위치");
      onSearchChange("");
      setSelected(nearbySchools.map((item) => item.organization));
      setRouteOrder([]);
      setRouteMessage("");
      setRouteStartOpen(false);
      setRouteOrigin(null);
      setFocusedOrganization("");
      changeMobileView("map");
    };

    if (nearbyOrigin) {
      applyRadius(nearbyOrigin);
      return;
    }

    try {
      setNearbyLocating(true);
      setNearbyMessage("현재 위치를 확인하고 있습니다.");
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 300000,
          }),
      );
      applyRadius({
        label: "내 위치",
        address: "현재 기기 위치",
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch (caught) {
      const error = caught as GeolocationPositionError;
      setNearbyMessage(
        error.code === 1
          ? "현재 위치 권한이 필요합니다. 브라우저의 위치 허용 후 다시 눌러 주세요."
          : "현재 위치를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setNearbyLocating(false);
    }
  }

  function prepareCampaignRows(rows: CampaignImportRow[]) {
    return rows.map((row) => {
      const exact =
        campaignInstitutionByKey.get(institutionAliasKey(row.organization))
          ?.aliases ?? [];
      return {
        ...row,
        clientId: row.clientId || createCampaignRowId(),
        existingOrganizations: row.existingOrganizations.length
          ? row.existingOrganizations
          : exact,
        confirmedOrganization:
          row.confirmedOrganization || (exact.length === 1 ? exact[0] : ""),
        businessMatchMode: row.businessMatchMode || "auto",
        linkedActivityId: row.linkedActivityId ?? null,
        updateLinkedBudget: row.updateLinkedBudget ?? false,
      };
    });
  }

  function emptyCampaignImportRow(): CampaignImportRow {
    return {
      clientId: createCampaignRowId(),
      sourceSequence: "",
      organization: "",
      address: "",
      phone: "",
      contactName: "",
      region: "",
      notes: "",
      assignedMemberName: "",
      schoolLevel: "",
      supplyItems: "",
      budgetAmount: "",
      reviewNote: "",
      existingOrganizations: [],
      confirmedOrganization: "",
      businessMatchMode: "auto",
      linkedActivityId: null,
      updateLinkedBudget: false,
    };
  }

  function beginManualCampaignImport() {
    beginCampaignImport(
      {
        fileName: "수기 입력",
        rows: [emptyCampaignImportRow()],
        source: "manual",
      },
      "",
      "",
      localDate(),
    );
  }

  function beginBudgetCardCreate() {
    beginCampaignImport(
      {
        fileName: "예산카드 직접 등록",
        rows: [],
        source: "manual",
      },
      "",
      "",
      localDate(),
      "create",
    );
  }

  function beginBudgetCardEdit(campaign: SalesCampaign) {
    beginCampaignImport(
      {
        fileName: "예산카드 수정",
        rows: [],
        source: "manual",
      },
      campaign.name,
      campaign.notes,
      campaign.selectionDate,
      "edit",
    );
    setCampaignDefaultBudgetAmount(
      campaign.defaultBudgetAmount === null
        ? ""
        : String(campaign.defaultBudgetAmount),
    );
    setCampaignBudget({
      budgetType: campaign.budgetType,
      budgetOriginalName: campaign.budgetType,
      budgetGroupId: campaign.budgetGroupId,
      budgetMatchStatus: campaign.budgetMatchStatus,
      budgetMatchMethod: campaign.budgetMatchMethod,
      budgetRequestId: campaign.budgetRequestId,
      budgetKind: campaign.budgetKind,
      budgetAmountMode: campaign.budgetAmountMode,
      defaultBudgetAmount: campaign.defaultBudgetAmount,
    });
  }

  function addManualCampaignRow() {
    setCampaignImport((current) =>
      current
        ? {
            ...current,
            rows: [...current.rows, emptyCampaignImportRow()],
          }
        : current,
    );
  }

  const updateCampaignBusinessMatch = useCallback((
    index: number,
    value: string,
    linkedOrganization?: string,
  ) => {
    setCampaignImport((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row, rowIndex) => {
              if (rowIndex !== index) return row;
              if (value.startsWith("link:")) {
                const confirmedOrganization =
                  linkedOrganization || row.confirmedOrganization;
                return {
                  ...row,
                  confirmedOrganization,
                  existingOrganizations:
                    confirmedOrganization &&
                    !row.existingOrganizations.includes(confirmedOrganization)
                      ? [confirmedOrganization, ...row.existingOrganizations]
                      : row.existingOrganizations,
                  businessMatchMode: "link-current",
                  linkedActivityId: Number(value.slice(5)) || null,
                  updateLinkedBudget: false,
                };
              }
              return {
                ...row,
                businessMatchMode: value as CampaignImportRow["businessMatchMode"],
                linkedActivityId: null,
                updateLinkedBudget: false,
              };
            }),
          }
        : current,
    );
  }, []);

  function beginCampaignImport(
    preview: CampaignImportPreview,
    suggestedName: string,
    notes = "",
    selectionDate = "",
    cardMode: CampaignCardMode = null,
  ) {
    setCampaignCardMode(cardMode);
    setCampaignInstitutionSearch(null);
    setCampaignImport({
      ...preview,
      rows: prepareCampaignRows(preview.rows),
    });
    setCampaignName(suggestedName);
    setCampaignNotes(notes);
    setCampaignSelectionDate(
      selectionDate ||
        campaignDateFromText(preview.fileName) ||
        campaignDateFromText(suggestedName) ||
        localDate(),
    );
    setCampaignDefaultBudgetAmount("");
    const suggestedBudget = suggestedName
      .replace(/\b20\d{2}\b/g, "")
      .replace(/선정기관|대상기관|명단|공고/g, "")
      .replace(/\s+/g, " ")
      .trim();
    setCampaignBudget({
      budgetType: suggestedBudget,
      budgetOriginalName: suggestedBudget,
      budgetGroupId: null,
      budgetMatchStatus: "review",
      budgetMatchMethod: "file_title",
      budgetRequestId: null,
      budgetKind: "",
      budgetAmountMode: "",
    });
  }

  async function handleCampaignFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const rows = await parseCampaignFile(file);
      const suggestedName = file.name
          .replace(/\.(xlsx|csv)$/i, "")
          .replace(/^WHIZZUP[_\s-]*/i, "")
          .replace(/[_-]+/g, " ")
          .trim();
      beginCampaignImport(
        { fileName: file.name, rows, source: "excel" },
        suggestedName,
      );
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "엑셀 파일을 읽지 못했습니다.",
      );
    }
  }

  async function handleCampaignPdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || campaignPdfAnalyzing) return;
    try {
      setCampaignPdfAnalyzing(true);
      setNotice("PDF에서 사업명과 기관 목록을 분석하고 있습니다.");
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/map/campaigns/pdf", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        campaignName?: string;
        selectionDate?: string;
        notes?: string;
        rows?: CampaignImportRow[];
        error?: string;
      };
      if (!response.ok || !payload.rows?.length) {
        throw new Error(payload.error || "PDF에서 기관 목록을 찾지 못했습니다.");
      }
      const suggestedName =
        payload.campaignName?.trim() ||
        file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
      beginCampaignImport(
        { fileName: file.name, rows: payload.rows, source: "pdf" },
        suggestedName,
        payload.notes?.trim() || "",
        payload.selectionDate?.trim() || "",
      );
      setNotice("");
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "PDF를 분석하지 못했습니다.",
      );
    } finally {
      setCampaignPdfAnalyzing(false);
    }
  }

  const updateCampaignImportRow = useCallback(<
    K extends keyof CampaignImportRow,
  >(
    index: number,
    key: K,
    value: CampaignImportRow[K],
  ) => {
    setCampaignImport((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row, rowIndex) => {
              if (rowIndex !== index) return row;
              if (key !== "organization") return { ...row, [key]: value };
              const organization = String(value);
              const existingOrganizations =
                campaignInstitutionByKey.get(
                  institutionAliasKey(organization),
                )?.aliases ?? [];
              return {
                ...row,
                organization,
                existingOrganizations,
                confirmedOrganization:
                  existingOrganizations.length === 1
                    ? existingOrganizations[0]
                    : "",
                businessMatchMode: "auto",
                linkedActivityId: null,
                updateLinkedBudget: false,
              };
            }),
          }
        : current,
    );
  }, [campaignInstitutionByKey]);

  const selectCampaignInstitution = useCallback((
    index: number,
    option: CampaignInstitutionOption,
  ) => {
    setCampaignImport((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row, rowIndex) =>
              rowIndex === index
                ? {
                    ...row,
                    organization: option.organization,
                    region: row.region || option.region,
                    existingOrganizations: option.aliases,
                    confirmedOrganization: option.organization,
                    businessMatchMode: "auto",
                    linkedActivityId: null,
                    updateLinkedBudget: false,
                  }
                : row,
            ),
          }
        : current,
    );
    setCampaignInstitutionSearch(null);
  }, []);

  const updateCampaignInstitutionSearch = useCallback((
    rowId: string,
    query: string | null,
  ) => {
    setCampaignInstitutionSearch((current) =>
      query === null
        ? current?.rowId === rowId
          ? null
          : current
        : { rowId, query },
    );
  }, []);

  const removeCampaignImportRow = useCallback((
    index: number,
    rowId: string,
  ) => {
    setCampaignInstitutionSearch((current) =>
      current?.rowId === rowId ? null : current,
    );
    setCampaignImport((current) =>
      current
        ? {
            ...current,
            rows: current.rows.filter((_, rowIndex) => rowIndex !== index),
          }
        : current,
    );
  }, []);

  async function geocodeCampaignRows(rows: CampaignImportRow[]) {
    const maps = sdkRef.current;
    if (!maps) return { saved: 0, unresolved: rows.length };
    let saved = 0;
    let unresolved = 0;
    const pendingRows = rows.filter(
      (row) =>
        !locationByOrganization.has(institutionAliasKey(row.organization)),
    );

    async function saveRowLocation(row: CampaignImportRow) {
      let latitude = 0;
      let longitude = 0;
      let address = row.address;
      let roadAddress = "";
      let placeName = row.organization;
      let placeId = `campaign-${row.organization}`.slice(0, 100);

      if (row.address) {
        const addressResults = await new Promise<KakaoAddressResult[]>((resolve) => {
          const geocoder = new maps.services.Geocoder();
          geocoder.addressSearch(row.address, (found, status) => {
            resolve(status === maps.services.Status.OK ? found : []);
          });
        });
        const result = addressResults[0];
        if (result) {
          latitude = Number(result.y);
          longitude = Number(result.x);
          roadAddress = result.road_address?.address_name ?? "";
          address =
            result.address?.address_name || result.address_name || row.address;
        }
      }

      if (!latitude || !longitude) {
        const queries = [
          [row.region, row.organization].filter(Boolean).join(" "),
          row.organization,
        ].filter((query, index, values) => query && values.indexOf(query) === index);
        let place: KakaoPlace | undefined;
        for (const query of queries) {
          const found = await searchKakaoKeyword(maps, query);
          if (found.length) {
            place = found[0];
            break;
          }
        }
        if (place) {
          latitude = Number(place.y);
          longitude = Number(place.x);
          address = place.address_name || row.address;
          roadAddress = place.road_address_name || "";
          placeName = place.place_name || row.organization;
          placeId = place.id || placeId;
        }
      }

      if (!latitude || !longitude) return false;
      const response = await fetch("/api/map/locations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization: row.organization,
          region: row.region,
          address,
          roadAddress,
          latitude,
          longitude,
          placeName,
          placeId,
        }),
      });
      const payload = (await response.json()) as {
        location?: Record<string, unknown>;
        error?: string;
      };
      if (!response.ok || !payload.location) return false;
      mergeSavedLocation(normalizeLocation(payload.location));
      return true;
    }

    for (let index = 0; index < pendingRows.length; index += 5) {
      const results = await Promise.all(
        pendingRows.slice(index, index + 5).map(saveRowLocation),
      );
      saved += results.filter(Boolean).length;
      unresolved += results.filter((result) => !result).length;
    }
    return { saved, unresolved };
  }

  async function importCampaign() {
    if (!campaignImport || !campaignName.trim() || campaignImporting) return;
    if (!campaignBudget.budgetGroupId) {
      setNotice("관리자가 등록한 활성 표준 예산명을 선택해 주세요.");
      return;
    }
    try {
      setCampaignImporting(true);
      if (campaignCardMode) {
        const editingCampaign =
          campaignCardMode === "edit" ? activeCampaign : null;
        if (campaignCardMode === "edit" && !editingCampaign) {
          throw new Error("수정할 예산카드를 다시 선택해 주세요.");
        }
        const response = await fetch("/api/map/campaigns", {
          method: campaignCardMode === "edit" ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(campaignCardMode === "edit"
              ? {
                  action: "update-campaign",
                  campaignId: editingCampaign?.id,
                }
              : {
                  cardOnly: true,
                  importSource: "manual",
                  sourceFileName: campaignImport.fileName,
                }),
            name: campaignName.trim(),
            notes: campaignNotes.trim(),
            selectionDate: campaignSelectionDate,
            defaultBudgetAmount: campaignDefaultBudgetAmount,
            ...campaignBudget,
            targets: [],
          }),
        });
        const payload = (await response.json()) as {
          campaign?: Record<string, unknown>;
          message?: string;
          error?: string;
        };
        if (!response.ok || !payload.campaign) {
          throw new Error(payload.error || "예산카드를 저장하지 못했습니다.");
        }
        const campaign = normalizeCampaign(payload.campaign);
        setCampaignImport(null);
        setCampaignCardMode(null);
        setCampaignName("");
        setCampaignNotes("");
        setCampaignDefaultBudgetAmount("");
        setActiveCampaignId(campaign.id);
        setNotice(
          payload.message ||
            (campaignCardMode === "edit"
              ? `${campaign.name} 예산카드를 수정했습니다.`
              : `${campaign.name} 예산카드를 만들었습니다. 이제 기존 기관을 추가할 수 있습니다.`),
        );
        await loadCampaigns();
        return;
      }
      const memberByName = new Map(
        campaignMembers.flatMap((member) => [
          [
            member.displayName
              .replace(/\s+/g, "")
              .toLocaleLowerCase("ko-KR"),
            member.id,
          ] as const,
          [member.email.toLocaleLowerCase(), member.id] as const,
        ]),
      );
      const targetRows = pendingCampaignImportRows.map((row) => ({
        ...row,
        notes: campaignTargetNotes(row),
        assignedMemberId:
          memberByName.get(
            row.assignedMemberName
              .replace(/\s+/g, "")
              .toLocaleLowerCase("ko-KR"),
          ) ??
          memberByName.get(row.assignedMemberName.toLocaleLowerCase()) ??
          null,
      }));
      const decisionRows =
        campaignImport.source === "pdf"
          ? pendingCampaignImportRows
          : pendingCampaignImportRows.filter((row) => row.existingOrganizations.length);
      const institutionDecisions = Object.fromEntries(
        decisionRows
          .map((row) => [
            row.organization,
            row.confirmedOrganization
              ? { confirmedOrganization: row.confirmedOrganization }
              : { institutionSeparate: true },
          ]),
      );
      const { response, payload: rawPayload } =
        await fetchWithInstitutionConfirmation("/api/map/campaigns", {
          method: "POST",
          body: {
            name: campaignName.trim(),
            notes: campaignNotes.trim(),
            importSource: campaignImport.source,
            sourceFileName: campaignImport.fileName,
            destinationCampaignId:
              activeCampaign &&
              activeCampaign.budgetGroupId === campaignBudget.budgetGroupId
                ? activeCampaign.id
                : null,
            selectionDate: campaignSelectionDate,
            defaultBudgetAmount: campaignDefaultBudgetAmount,
            ...campaignBudget,
            targets: targetRows,
            institutionDecisions,
          },
        });
      const payload = rawPayload as {
        campaign?: Record<string, unknown>;
        targetCount?: number;
        targets?: CampaignImportRow[];
        skippedExistingCount?: number;
        linkedExistingCount?: number;
        correctedBudgetCount?: number;
        newBusinessCount?: number;
        newInstitutionCount?: number;
        error?: string;
      };
      if (!response.ok || !payload.campaign) {
        throw new Error(payload.error || "영업 카테고리를 등록하지 못했습니다.");
      }
      const campaign = normalizeCampaign(payload.campaign);
      const rowsToMap = Array.isArray(payload.targets)
        ? payload.targets
        : pendingCampaignImportRows;
      const targetCount = payload.targetCount ?? pendingCampaignImportRows.length;
      setCampaignImport(null);
      setCampaignCardMode(null);
      setCampaignName("");
      setCampaignNotes("");
      setCampaignDefaultBudgetAmount("");
      setCampaignBudget({
        budgetType: "",
        budgetOriginalName: "",
        budgetGroupId: null,
        budgetMatchStatus: "unclassified",
        budgetMatchMethod: "legacy",
        budgetRequestId: null,
        budgetKind: "",
        budgetAmountMode: "",
      });
      setActiveCampaignId(campaign.id);
      setSelected([]);
      setRouteOrder([]);
      setStatusFilter("전체");
      setLocationFilter("전체 위치");
      onSearchChange("");
      changeMobileView("list");
      setCampaignImporting(false);
      setNotice(
        `${targetCount}개 기관 추가 완료${payload.skippedExistingCount ? ` · 기존 명단 ${payload.skippedExistingCount}곳 건너뜀` : ""} · 기존 사업 연결 ${payload.linkedExistingCount ?? 0}건 · 예산명 정정 ${payload.correctedBudgetCount ?? 0}건 · 새 사업 ${payload.newBusinessCount ?? 0}건. 지도 위치는 뒤에서 자동으로 찾고 있습니다.`,
      );
      void Promise.allSettled([onRecordsChanged(), loadCampaigns()]);
      void geocodeCampaignRows(rowsToMap)
        .then(async (mapped) => {
          if (mapped.saved) await onRecordsChanged();
          setNotice(
            mapped.unresolved
              ? `${targetCount}개 기관 등록 완료 · 지도 위치 ${mapped.saved}곳 확인 · ${mapped.unresolved}곳은 위치 확인이 필요합니다.`
              : `${targetCount}개 기관과 지도 위치 등록을 완료했습니다.`,
          );
        })
        .catch(() => {
          setNotice(
            `${targetCount}개 기관 등록은 완료했습니다. 지도 위치는 목록에서 다시 확인해 주세요.`,
          );
        });
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "영업 카테고리를 등록하지 못했습니다.",
      );
    } finally {
      setCampaignImporting(false);
    }
  }

  function openExistingCampaignPicker() {
    if (!activeCampaign) {
      setNotice("기관을 추가할 예산 명단을 먼저 선택해 주세요.");
      return;
    }
    setCampaignExistingSearch("");
    setCampaignExistingSelectedIds([]);
    setCampaignExistingPage(1);
    setCampaignExistingOpen(true);
  }

  function toggleExistingCampaignInstitution(
    option: CampaignInstitutionOption,
  ) {
    setCampaignExistingSelectedIds((current) =>
      current.includes(option.activityId)
        ? current.filter((id) => id !== option.activityId)
        : [...current, option.activityId],
    );
  }

  function toggleAllExistingCampaignInstitutions() {
    const resultIds = campaignExistingOptions.map(
      (option) => option.activityId,
    );
    const selected = new Set(campaignExistingSelectedIds);
    const allSelected =
      resultIds.length > 0 && resultIds.every((id) => selected.has(id));
    setCampaignExistingSelectedIds((current) =>
      allSelected
        ? current.filter((id) => !resultIds.includes(id))
        : [...new Set([...current, ...resultIds])],
    );
  }

  async function addExistingCampaignInstitutions() {
    if (
      !activeCampaign ||
      !campaignExistingSelectedIds.length ||
      campaignExistingAdding
    ) {
      return;
    }
    try {
      setCampaignExistingAdding(true);
      const response = await fetch("/api/map/campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: activeCampaign.id,
          activityIds: campaignExistingSelectedIds,
        }),
      });
      const payload = (await response.json()) as {
        addedCount?: number;
        skippedCount?: number;
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "기존 기관을 추가하지 못했습니다.");
      }
      setCampaignExistingOpen(false);
      setCampaignExistingSelectedIds([]);
      setCampaignExistingSearch("");
      setCampaignExistingPage(1);
      await loadCampaigns();
      setNotice(
        payload.message ||
          `${payload.addedCount ?? 0}개 기관을 예산 명단에 추가했습니다.`,
      );
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "기존 기관을 추가하지 못했습니다.",
      );
    } finally {
      setCampaignExistingAdding(false);
    }
  }

  async function updateCampaignAssignee(
    target: SalesCampaignTarget,
    assignedMemberId: number | null,
  ) {
    try {
      setAssignmentSaving(target.id);
      const response = await fetch("/api/map/campaigns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: target.id,
          assignedMemberId,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "영업 담당자를 저장하지 못했습니다.");
      }
      const member = campaignMembers.find(
        (item) => item.id === assignedMemberId,
      );
      setCampaignTargets((current) =>
        current.map((item) =>
          item.id === target.id
            ? {
                ...item,
                assignedMemberId,
                assignedMemberName: member?.displayName ?? "",
              }
            : item,
        ),
      );
      setCampaigns((current) =>
        current.map((campaign) =>
          campaign.id === target.campaignId
            ? {
                ...campaign,
                assignedCount: Math.max(
                  0,
                  campaign.assignedCount +
                    (target.assignedMemberId ? -1 : 0) +
                    (assignedMemberId ? 1 : 0),
                ),
              }
            : campaign,
        ),
      );
      await Promise.all([loadCampaigns(), onRecordsChanged()]);
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "영업 담당자를 저장하지 못했습니다.",
      );
    } finally {
      setAssignmentSaving(null);
    }
  }

  async function runBudgetBulkAction(
    action: "bulk-assign" | "remove-targets",
  ) {
    if (!activeCampaign || !budgetSelectedTargetIds.length || budgetBulkBusy) {
      return;
    }
    if (
      action === "bulk-assign" &&
      !budgetBulkAssigneeId
    ) {
      setNotice("일괄 지정할 진행 담당자를 선택해 주세요.");
      return;
    }
    if (
      action === "remove-targets" &&
      !window.confirm(
        `선택한 ${budgetSelectedTargetIds.length}개 기관을 현재 선정 명단에서 제외할까요?\n\n기관 자체와 지도·영업·수주 기록은 삭제되지 않습니다. 제외한 명단 연결은 30일 동안 복원할 수 있습니다.`,
      )
    ) {
      return;
    }
    try {
      setBudgetBulkBusy(action);
      const response = await fetch("/api/map/campaigns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          campaignId: activeCampaign.id,
          targetIds: budgetSelectedTargetIds,
          assignedMemberId:
            action === "bulk-assign"
              ? budgetBulkAssigneeId === "unassigned"
                ? null
                : Number(budgetBulkAssigneeId)
              : undefined,
        }),
      });
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "선택한 기관을 일괄 처리하지 못했습니다.");
      }
      setBudgetSelectedTargetIds([]);
      setBudgetBulkAssigneeId("");
      await Promise.all([loadCampaigns(), onRecordsChanged()]);
      setNotice(payload.message || "선택한 기관을 일괄 처리했습니다.");
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "선택한 기관을 일괄 처리하지 못했습니다.",
      );
    } finally {
      setBudgetBulkBusy("");
    }
  }

  async function removeCampaign(
    campaign: SalesCampaign,
    deleteRegisteredInstitutions: boolean,
  ) {
    try {
      setCampaignDeleting(true);
      const response = await fetch("/api/map/campaigns", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaign.id,
          deleteRegisteredInstitutions,
        }),
      });
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "영업 카테고리를 삭제하지 못했습니다.");
      }
      setCampaignDeleteTarget(null);
      selectCampaign("all");
      await Promise.all([loadCampaigns(), onRecordsChanged()]);
      setNotice(payload.message || "영업 카테고리를 삭제했습니다.");
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "영업 카테고리를 삭제하지 못했습니다.",
      );
    } finally {
      setCampaignDeleting(false);
    }
  }

  useEffect(() => {
    if (!sdkReady || !sdkRef.current || !mapRef.current) return;
    const maps = sdkRef.current;
    const map = mapRef.current;
    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];
    routeLineRef.current?.setMap(null);
    routeLineRef.current = null;

    const selectedSet = new Set(activeSelected);
    const backgroundPoints = visibleMapped
      .filter((item) => !selectedSet.has(item.organization))
      .map((item) => ({
        latitude: item.location!.latitude,
        longitude: item.location!.longitude,
        item,
      }));
    const provinceMode = shouldRenderProvinceClusters(
      !selectedProvince,
      activeSelected.length,
    );
    const provinceDrilldownMode = Boolean(selectedProvince);
    const clusters = provinceMode
      ? clusterMapPointsByProvince(backgroundPoints, ({ item }) =>
          [
            item.region,
            item.location?.roadAddress,
            item.location?.address,
          ]
            .filter(Boolean)
            .join(" "),
        )
      : provinceDrilldownMode
        ? individualMapPointClusters(backgroundPoints)
        : clusterMapPoints(backgroundPoints, mapLevel);

    clusters.forEach((cluster) => {
      const position = new maps.LatLng(cluster.latitude, cluster.longitude);
      const provinceCluster =
        "provinceLabel" in cluster ? cluster : null;
      const isIndividual =
        !provinceCluster &&
        cluster.points.length === 1 &&
        (provinceDrilldownMode || mapLevel <= 4);
      const marker = document.createElement("button");
      marker.type = "button";

      if (isIndividual) {
        const item = cluster.points[0].item;
        marker.className = `sales-map-marker marker-${item.status.replaceAll(" ", "-")}`;
        marker.textContent = item.organization.slice(0, 1);
        marker.title = `${item.organization} · ${item.status}`;
        marker.addEventListener("click", () =>
          setFocusedOrganization(item.organization),
        );
      } else if (provinceCluster) {
        const count = provinceCluster.points.length;
        marker.className = "sales-map-cluster province-cluster";
        marker.textContent = `${provinceCluster.provinceLabel} ${count.toLocaleString(
          "ko-KR",
        )}`;
        marker.title = `${provinceCluster.province} · ${count.toLocaleString(
          "ko-KR",
        )}곳`;
        marker.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const provinceOrganizations = provinceCluster.points.map(
            ({ item }) => item.organization,
          );
          const provinceBounds = new maps.LatLngBounds();
          provinceCluster.points.forEach(({ latitude, longitude }) => {
            provinceBounds.extend(new maps.LatLng(latitude, longitude));
          });
          skipNextVisibleBoundsFitRef.current = true;
          if (provinceCluster.points.length === 1) {
            map.setCenter(position);
            map.setLevel(5);
          } else {
            map.setBounds(provinceBounds, 48, 48, 48, 48);
          }
          setSelectedProvince(provinceCluster.province);
          onSearchChange(provinceCluster.provinceLabel);
          setSelected(provinceOrganizations);
          setRouteOrder([]);
          setRouteMessage("");
          setRouteStartOpen(false);
          setRouteOrigin(null);
          setFocusedOrganization("");
          changeMobileView("map");
        });
      } else {
        const count = cluster.points.length;
        const densityClass =
          count >= 100
            ? "density-xlarge"
            : count >= 30
              ? "density-large"
              : count >= 8
                ? "density-medium"
                : "density-small";
        marker.className = `sales-map-cluster ${densityClass}`;
        marker.textContent = count.toLocaleString("ko-KR");
        marker.title = `${cluster.points
          .slice(0, 3)
          .map((point) => point.item.organization)
          .join(", ")}${count > 3 ? ` 외 ${count - 3}곳` : ""}`;
        marker.addEventListener("click", () => {
          map.setCenter(position);
          map.setLevel(Math.max(1, map.getLevel() - 2), {
            anchor: position,
          });
        });
      }

      const overlay = new maps.CustomOverlay({
        position,
        content: marker,
        yAnchor: isIndividual ? 1.2 : provinceCluster ? 0.6 : 0.5,
        zIndex: isIndividual ? 4 : provinceCluster ? 5 : 3,
      });
      overlay.setMap(map);
      overlaysRef.current.push(overlay);
    });

    visibleMapped
      .filter((item) => selectedSet.has(item.organization))
      .forEach((item) => {
        const location = item.location!;
        const position = new maps.LatLng(location.latitude, location.longitude);
        const marker = document.createElement("button");
        marker.type = "button";
        marker.className = `sales-map-marker marker-${item.status.replaceAll(
          " ",
          "-",
        )} route-selected-marker`;
        const routeIndex = activeRouteOrder.indexOf(item.organization);
        marker.textContent =
          routeIndex >= 0
            ? String(routeIndex + 1)
            : item.organization.slice(0, 1);
        marker.title = `${item.organization} · 동선 선택`;
        marker.addEventListener("click", () =>
          setFocusedOrganization(item.organization),
        );
        const overlay = new maps.CustomOverlay({
          position,
          content: marker,
          yAnchor: 1.2,
          zIndex: 9,
        });
        overlay.setMap(map);
        overlaysRef.current.push(overlay);
      });

    if (nearbyOrigin && nearbyRadius) {
      const nearbyPosition = new maps.LatLng(
        nearbyOrigin.latitude,
        nearbyOrigin.longitude,
      );
      const nearbyMarker = document.createElement("button");
      nearbyMarker.type = "button";
      nearbyMarker.className = "sales-map-marker nearby-origin-marker";
      nearbyMarker.title = "현재 위치 · 저장되지 않음";
      nearbyMarker.setAttribute("aria-label", "현재 내 위치");
      const nearbyIcon = document.createElement("span");
      nearbyIcon.className = "nearby-origin-icon";
      nearbyIcon.setAttribute("aria-hidden", "true");
      nearbyIcon.textContent = "◎";
      const nearbyLabel = document.createElement("strong");
      nearbyLabel.textContent = "내 위치";
      nearbyMarker.append(nearbyIcon, nearbyLabel);
      const nearbyOverlay = new maps.CustomOverlay({
        position: nearbyPosition,
        content: nearbyMarker,
        yAnchor: 1.2,
        zIndex: 11,
      });
      nearbyOverlay.setMap(map);
      overlaysRef.current.push(nearbyOverlay);
    }

    if (routeOrigin && activeRouteOrder.length) {
      const originPosition = new maps.LatLng(
        routeOrigin.latitude,
        routeOrigin.longitude,
      );
      const originMarker = document.createElement("button");
      originMarker.type = "button";
      originMarker.className = "sales-map-marker route-origin-marker";
      originMarker.textContent = "출발";
      originMarker.title = `${routeOrigin.label} · ${routeOrigin.address}`;
      const originOverlay = new maps.CustomOverlay({
        position: originPosition,
        content: originMarker,
        yAnchor: 1.2,
        zIndex: 10,
      });
      originOverlay.setMap(map);
      overlaysRef.current.push(originOverlay);
    }

    const routePoints = [
      ...(routeOrigin && activeRouteOrder.length
        ? [new maps.LatLng(routeOrigin.latitude, routeOrigin.longitude)]
        : []),
      ...activeRouteOrder
      .map((organization) =>
        locationByOrganization.get(institutionAliasKey(organization)),
      )
      .filter((location): location is OrganizationLocation => Boolean(location))
        .map(
          (location) =>
            new maps.LatLng(location.latitude, location.longitude),
        ),
    ];
    if (routePoints.length > 1) {
      const line = new maps.Polyline({
        path: routePoints,
        strokeWeight: 4,
        strokeColor: "#3738f5",
        strokeOpacity: 0.76,
        strokeStyle: "shortdash",
      });
      line.setMap(map);
      routeLineRef.current = line;
    }
  }, [
    sdkReady,
    visibleMapped,
    activeSelected,
    activeRouteOrder,
    locationByOrganization,
    routeOrigin,
    nearbyOrigin,
    nearbyRadius,
    mapLevel,
    selectedProvince,
  ]);

  useEffect(() => {
    if (!sdkReady || !sdkRef.current || !mapRef.current) return;
    if (skipNextVisibleBoundsFitRef.current) {
      skipNextVisibleBoundsFitRef.current = false;
      return;
    }
    const maps = sdkRef.current;
    const map = mapRef.current;
    const bounds = new maps.LatLngBounds();
    let pointCount = 0;
    const include = (latitude: number, longitude: number) => {
      bounds.extend(new maps.LatLng(latitude, longitude));
      pointCount += 1;
    };

    if (routeOrigin && activeRouteOrder.length) {
      include(routeOrigin.latitude, routeOrigin.longitude);
      activeRouteOrder.forEach((organization) => {
        const location = locationByOrganization.get(
          institutionAliasKey(organization),
        );
        if (location) include(location.latitude, location.longitude);
      });
    } else {
      visibleMapped.forEach((item) =>
        include(item.location!.latitude, item.location!.longitude),
      );
      if (nearbyOrigin && nearbyRadius) {
        include(nearbyOrigin.latitude, nearbyOrigin.longitude);
      }
    }

    if (pointCount === 1) {
      const point =
        routeOrigin && activeRouteOrder.length
          ? new maps.LatLng(routeOrigin.latitude, routeOrigin.longitude)
          : visibleMapped[0]?.location
            ? new maps.LatLng(
                visibleMapped[0].location!.latitude,
                visibleMapped[0].location!.longitude,
              )
            : nearbyOrigin
              ? new maps.LatLng(
                  nearbyOrigin.latitude,
                  nearbyOrigin.longitude,
                )
              : null;
      if (point) {
        map.setCenter(point);
        map.setLevel(5);
      }
    } else if (pointCount > 1) {
      map.setBounds(bounds);
    }
  }, [
    activeRouteOrder,
    locationByOrganization,
    nearbyOrigin,
    nearbyRadius,
    routeOrigin,
    sdkReady,
    visibleMapped,
  ]);

  useEffect(() => {
    if (mobileView !== "map" || !sdkReady || !mapRef.current) return;
    const map = mapRef.current;
    const center = map.getCenter();
    const level = map.getLevel();
    const frame = window.requestAnimationFrame(() => {
      map.relayout();
      map.setCenter(center);
      map.setLevel(level);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mobileView, sdkReady]);

  async function saveMapKey() {
    const value = keyInput.trim();
    if (!value) {
      setMapError("카카오 JavaScript 키를 입력해 주세요.");
      return;
    }
    try {
      setConfigSaving(true);
      const response = await fetch("/api/map/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ javascriptKey: value }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "지도 키를 저장하지 못했습니다.");
      setJavascriptKey(value);
      setKeyInput("");
      setMapError("");
      setNotice("카카오 지도 연결 정보를 저장했습니다.");
    } catch (caught) {
      setMapError(caught instanceof Error ? caught.message : "지도 키를 저장하지 못했습니다.");
    } finally {
      setConfigSaving(false);
    }
  }

  function toggleSelected(organization: string) {
    if (selected.includes(organization)) {
      setRouteOrder((current) =>
        current.filter((item) => item !== organization),
      );
    }
    setSelected((current) =>
      current.includes(organization)
        ? current.filter((item) => item !== organization)
        : [...current, organization],
    );
  }

  function selectCurrentMapList() {
    if (searchDraft !== search) {
      onSearchChangeRef.current(searchDraft);
    }
    if (
      selectionCandidates.length > 200 &&
      !window.confirm(
        `${selectionScopeLabel} ${selectionCandidates.length.toLocaleString("ko-KR")}곳을 모두 선택할까요? 많은 기관을 한꺼번에 표시하면 지도가 잠시 느려질 수 있습니다.`,
      )
    ) {
      return;
    }
    setSelected((current) => [
      ...new Set([
        ...current,
        ...selectionCandidates.map((item) => item.organization),
      ]),
    ]);
    const excludedLocationCount = hasDraftSearch
      ? draftFilteredOrganizations.length - selectionCandidates.length
      : 0;
    if (excludedLocationCount > 0) {
      setNotice(
        `검색 결과를 선택했습니다. 위치 미등록 ${excludedLocationCount.toLocaleString("ko-KR")}곳은 동선에서 제외했습니다.`,
      );
    }
  }

  async function findRouteOrigin(query: string, label?: string) {
    const maps = sdkRef.current;
    if (!maps) throw new Error("지도를 불러온 뒤 다시 시도해 주세요.");
    const searchQuery = query.trim();
    if (!searchQuery) throw new Error("출발지 주소나 장소명을 입력해 주세요.");

    const addressResults = await new Promise<KakaoAddressResult[]>((resolve) => {
      const geocoder = new maps.services.Geocoder();
      geocoder.addressSearch(searchQuery, (results, status) => {
        resolve(status === maps.services.Status.OK ? results : []);
      });
    });
    const addressResult = addressResults[0];
    if (addressResult) {
      return {
        label: label || searchQuery,
        address:
          addressResult.road_address?.address_name ||
          addressResult.address?.address_name ||
          addressResult.address_name ||
          searchQuery,
        latitude: Number(addressResult.y),
        longitude: Number(addressResult.x),
      } satisfies RouteOrigin;
    }

    const keywordResults = await searchKakaoKeyword(maps, searchQuery);
    const place = keywordResults[0];
    if (!place) {
      throw new Error("출발지를 찾지 못했습니다. 주소나 장소명을 다시 확인해 주세요.");
    }
    return {
      label: label || place.place_name || searchQuery,
      address: place.road_address_name || place.address_name || searchQuery,
      latitude: Number(place.y),
      longitude: Number(place.x),
    } satisfies RouteOrigin;
  }

  function applyRouteRecommendation(origin: RouteOrigin) {
    const candidates = eligibleOrganizations.filter(
      (item) => activeSelected.includes(item.organization) && item.location,
    );
    if (candidates.length < 2) {
      setRouteMessage("위치가 등록된 기관을 두 곳 이상 선택해 주세요.");
      return false;
    }

    const remaining = [...candidates];
    const ordered: OrganizationSummary[] = [];
    let cursor = origin;
    while (remaining.length) {
      remaining.sort(
        (a, b) =>
          haversine(cursor, a.location!) - haversine(cursor, b.location!),
      );
      const next = remaining.shift()!;
      ordered.push(next);
      cursor = next.location!;
    }
    setRouteOrigin(origin);
    setRouteOrder(ordered.map((item) => item.organization));
    setRouteMessage(`${origin.label}에서 가까운 순서로 추천했습니다.`);
    setRouteStartOpen(false);
    changeMobileView("map");
    return true;
  }

  async function recommendRoute(startQuery: string, startLabel?: string) {
    try {
      setRouteCalculating(true);
      setRouteMessage("출발지를 확인해 방문 순서를 계산하고 있습니다.");
      const origin = await findRouteOrigin(startQuery, startLabel);
      applyRouteRecommendation(origin);
    } catch (caught) {
      setRouteMessage(
        caught instanceof Error
          ? caught.message
          : "방문 순서를 계산하지 못했습니다.",
      );
    } finally {
      setRouteCalculating(false);
    }
  }

  async function recommendRouteFromCurrentLocation() {
    if (!navigator.geolocation) {
      setRouteMessage("이 브라우저에서는 현재 위치를 사용할 수 없습니다.");
      return;
    }

    try {
      setRouteLocating(true);
      setRouteCalculating(true);
      setRouteMessage("현재 위치를 확인하고 방문 순서를 계산하고 있습니다.");
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 300000,
          }),
      );
      setRouteStartInput("");
      applyRouteRecommendation({
        label: "내 위치",
        address: "현재 기기 위치",
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch (caught) {
      const error = caught as GeolocationPositionError;
      setRouteMessage(
        error.code === 1
          ? "현재 위치 권한이 필요합니다. 브라우저에서 위치를 허용한 뒤 다시 눌러 주세요."
          : "현재 위치를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setRouteLocating(false);
      setRouteCalculating(false);
    }
  }

  async function searchKakaoPlaces(query: string) {
    const maps = sdkRef.current;
    if (!maps) throw new Error("카카오 지도를 먼저 불러와 주세요.");
    const searchQuery = query.trim();
    const keywordSearch = new Promise<KakaoPlace[]>((resolve) => {
      const places = new maps.services.Places();
      places.keywordSearch(searchQuery, (results, status) => {
        resolve(status === maps.services.Status.OK ? results : []);
      });
    });
    const addressSearch = new Promise<KakaoPlace[]>((resolve) => {
      const geocoder = new maps.services.Geocoder();
      geocoder.addressSearch(searchQuery, (results, status) => {
        if (status !== maps.services.Status.OK) {
          resolve([]);
          return;
        }
        resolve(
          results.map((result, index) => ({
            id: `address-${result.x}-${result.y}-${index}`,
            place_name: "주소 검색 결과",
            address_name:
              result.address?.address_name || result.address_name || searchQuery,
            road_address_name: result.road_address?.address_name || "",
            x: result.x,
            y: result.y,
          })),
        );
      });
    });
    const [addressResults, keywordResults] = await Promise.all([
      addressSearch,
      keywordSearch,
    ]);
    const seen = new Set<string>();
    return [...addressResults, ...keywordResults]
      .filter((place) => {
        const key = `${place.x}:${place.y}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 10);
  }

  async function runPlaceSearch(query = locationQuery) {
    if (!query.trim()) {
      setPlaceError("기관명이나 주소를 입력해 주세요.");
      return;
    }
    setPlaceSearching(true);
    setPlaceResults([]);
    setPlaceError("");
    try {
      const results = await searchKakaoPlaces(query);
      if (results.length) {
        setPlaceResults(results);
        return;
      }
      setPlaceResults([]);
      setPlaceError("검색 결과가 없습니다. 기관명 또는 정확한 주소로 다시 검색해 보세요.");
    } catch {
      setPlaceSearching(false);
      setPlaceResults([]);
      setPlaceError("위치 검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPlaceSearching(false);
    }
  }

  function openLocationSearch(item: OrganizationSummary) {
    const query =
      automaticLocationQueries(item)[0] ||
      [item.region, item.organization].filter(Boolean).join(" ");
    setLocatingOrganization(item);
    setLocationQuery(query);
    setPlaceResults([]);
    setPlaceError("");
    window.setTimeout(() => void runPlaceSearch(query), 0);
  }

  async function persistLocation(
    organization: OrganizationSummary,
    place: KakaoPlace,
  ) {
    const response = await fetch("/api/map/locations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization: organization.organization,
        region: organization.region,
        address: place.address_name,
        roadAddress: place.road_address_name,
        latitude: Number(place.y),
        longitude: Number(place.x),
        placeName: place.place_name,
        placeId: place.id,
      }),
    });
    const payload = (await response.json()) as {
      location?: Record<string, unknown>;
      error?: string;
    };
    if (!response.ok || !payload.location) {
      throw new Error(payload.error || "기관 위치를 저장하지 못했습니다.");
    }
    return normalizeLocation(payload.location);
  }

  function mergeSavedLocation(saved: OrganizationLocation) {
    setLocations((current) => [
      ...current.filter(
        (location) => location.organization !== saved.organization,
      ),
      saved,
    ]);
  }

  async function saveLocation(place: KakaoPlace) {
    if (!locatingOrganization) return;
    try {
      setLocationSaving(true);
      const saved = await persistLocation(locatingOrganization, place);
      mergeSavedLocation(saved);
      await onRecordsChanged();
      setFocusedOrganization(saved.organization);
      setLocatingOrganization(null);
      setNotice(`${saved.organization} 위치를 저장했습니다.`);
      changeMobileView("map");
    } catch (caught) {
      setPlaceError(caught instanceof Error ? caught.message : "기관 위치를 저장하지 못했습니다.");
    } finally {
      setLocationSaving(false);
    }
  }

  function updateLocationBatchRow(
    organization: string,
    changes: Partial<LocationBatchDraft>,
  ) {
    setLocationBatchRows((current) =>
      current.map((row) =>
        row.organization === organization ? { ...row, ...changes } : row,
      ),
    );
  }

  function openLocationBatchEditor() {
    setLocationBatchRows(eligibleOrganizations.map(createLocationBatchDraft));
    setLocationBatchShowMapped(false);
    setLocationBatchMessage("");
    setLocationBatchOpen(true);
  }

  function downloadUnmappedLocationFile() {
    const rows = eligibleOrganizations
      .filter((item) => !item.location)
      .map((item) => {
        const draft = createLocationBatchDraft(item);
        return {
          organization: draft.organization,
          searchTerms: draft.searchTerms,
          address: "",
          latitude: "",
          longitude: "",
          note: "자동 매칭 실패",
        } satisfies LocationImportRow;
      });
    if (!rows.length) {
      setLocationBatchMessage("위치가 미등록된 기관이 없습니다.");
      return;
    }
    downloadLocationWorkbook(rows);
    setLocationBatchMessage(`${rows.length}곳의 위치 입력용 엑셀을 내려받았습니다.`);
  }

  async function handleLocationBatchFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = await parseLocationFile(file);
      const exact = new Map(
        eligibleOrganizations.map((item) => [item.organization.trim(), item]),
      );
      const compact = new Map(
        eligibleOrganizations.map((item) => [
          compactOrganizationName(item.organization),
          item,
        ]),
      );
      let unknownCount = 0;
      const importedByOrganization = new Map<string, LocationImportRow>();
      imported.forEach((row) => {
        const matched =
          exact.get(row.organization.trim()) ||
          compact.get(compactOrganizationName(row.organization));
        if (!matched) {
          unknownCount += 1;
          return;
        }
        importedByOrganization.set(matched.organization, row);
      });
      setLocationBatchRows((current) => {
        const base = current.length
          ? current
          : eligibleOrganizations.map(createLocationBatchDraft);
        return base.map((draft) => {
          const row = importedByOrganization.get(draft.organization);
          if (!row) return draft;
          const latitude = row.latitude.trim();
          const longitude = row.longitude.trim();
          const hasCoordinates =
            Number.isFinite(Number(latitude)) &&
            Number.isFinite(Number(longitude)) &&
            latitude !== "" &&
            longitude !== "";
          return {
            ...draft,
            searchTerms: row.searchTerms || draft.searchTerms,
            address: row.address || draft.address,
            roadAddress: row.address || draft.roadAddress,
            latitude,
            longitude,
            note: row.note,
            selected: hasCoordinates || Boolean(row.address),
            candidates: [],
            error: hasCoordinates || Boolean(row.address) || (!latitude && !longitude)
              ? ""
              : "위치 정보를 읽지 못했습니다. 주소로 다시 검색해 주세요.",
          };
        });
      });
      setLocationBatchShowMapped(true);
      setLocationBatchOpen(true);
      setLocationBatchMessage(
        `${file.name}에서 ${importedByOrganization.size}곳을 불러왔습니다.${
          unknownCount ? ` 기관별 관리에 없는 ${unknownCount}곳은 제외했습니다.` : ""
        }`,
      );
    } catch (caught) {
      setLocationBatchMessage(
        caught instanceof Error ? caught.message : "위치 엑셀을 읽지 못했습니다.",
      );
    }
  }

  async function searchLocationBatchRow(
    row: LocationBatchDraft,
    mode: "name" | "address",
  ) {
    const queries =
      mode === "address"
        ? [row.address.trim()]
        : locationSearchTerms(row.searchTerms);
    if (!queries[0]) {
      updateLocationBatchRow(row.organization, {
        error: mode === "address" ? "주소를 입력해 주세요." : "검색 명칭을 입력해 주세요.",
      });
      return;
    }
    updateLocationBatchRow(row.organization, {
      searching: true,
      error: "",
      candidates: [],
    });
    try {
      const seen = new Set<string>();
      const candidates: KakaoPlace[] = [];
      for (const query of queries.slice(0, 6)) {
        const results = await searchKakaoPlaces(query);
        results.forEach((place) => {
          const key = `${place.x}:${place.y}`;
          if (!seen.has(key) && candidates.length < 10) {
            seen.add(key);
            candidates.push(place);
          }
        });
        if (candidates.length >= 10) break;
      }
      updateLocationBatchRow(row.organization, {
        searching: false,
        candidates,
        error: candidates.length
          ? ""
          : "검색 결과가 없습니다. 다른 명칭이나 정확한 주소를 입력해 보세요.",
      });
    } catch (caught) {
      updateLocationBatchRow(row.organization, {
        searching: false,
        candidates: [],
        error: caught instanceof Error ? caught.message : "위치를 검색하지 못했습니다.",
      });
    }
  }

  function chooseLocationBatchCandidate(
    organization: string,
    place: KakaoPlace,
  ) {
    updateLocationBatchRow(organization, {
      address: place.address_name,
      roadAddress: place.road_address_name,
      latitude: place.y,
      longitude: place.x,
      placeName: place.place_name,
      placeId: place.id,
      selected: true,
      candidates: [],
      error: "",
    });
  }

  async function saveLocationBatch() {
    const selectedRows = locationBatchRows.filter((row) => row.selected);
    if (!selectedRows.length) {
      setLocationBatchMessage("저장할 기관을 선택해 주세요.");
      return;
    }
    try {
      setLocationBatchSaving(true);
      const resolvedRows: LocationBatchDraft[] = [];
      for (const [index, row] of selectedRows.entries()) {
        const hasCoordinates =
          row.latitude.trim() !== "" && row.longitude.trim() !== "";
        if (hasCoordinates) {
          const latitude = Number(row.latitude);
          const longitude = Number(row.longitude);
          if (
            !Number.isFinite(latitude) ||
            latitude < -90 ||
            latitude > 90 ||
            !Number.isFinite(longitude) ||
            longitude < -180 ||
            longitude > 180
          ) {
            updateLocationBatchRow(row.organization, {
              error: "저장할 위치 정보가 올바르지 않습니다. 주소로 다시 검색해 주세요.",
            });
            throw new Error(`${row.organization}의 위치를 다시 확인해 주세요.`);
          }
          resolvedRows.push(row);
          continue;
        }
        if (!row.address.trim()) {
          updateLocationBatchRow(row.organization, {
            error: "주소를 입력하거나 검색 결과에서 위치를 선택해 주세요.",
          });
          throw new Error(`${row.organization}의 주소를 입력하거나 위치를 검색해 주세요.`);
        }
        setLocationBatchMessage(
          `입력한 주소의 위치를 확인 중입니다. ${index + 1}/${selectedRows.length}`,
        );
        const places = await searchKakaoPlaces(row.address);
        const place = places[0];
        if (!place) {
          updateLocationBatchRow(row.organization, {
            error: "입력한 주소를 찾지 못했습니다. 주소 검색으로 위치를 확인해 주세요.",
          });
          throw new Error(`${row.organization}의 주소를 지도에서 찾지 못했습니다.`);
        }
        const resolved = {
          ...row,
          address: place.address_name || row.address,
          roadAddress: place.road_address_name,
          latitude: place.y,
          longitude: place.x,
          placeName: place.place_name,
          placeId: place.id,
          error: "",
        };
        updateLocationBatchRow(row.organization, resolved);
        resolvedRows.push(resolved);
      }
      setLocationBatchMessage(`${resolvedRows.length}곳의 위치를 저장하고 있습니다.`);
      const response = await fetch("/api/map/locations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locations: resolvedRows.map((row) => ({
            organization: row.organization,
            region: row.region,
            address: row.address,
            roadAddress: row.roadAddress,
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            placeName: row.placeName || row.organization,
            placeId: row.placeId,
          })),
        }),
      });
      const payload = (await response.json()) as {
        locations?: Record<string, unknown>[];
        savedCount?: number;
        failedCount?: number;
        failures?: Array<{
          organization: string;
          error: string;
        }>;
        error?: string;
      };
      if (!response.ok || !payload.locations) {
        throw new Error(payload.error || "기관 위치를 일괄 저장하지 못했습니다.");
      }
      const savedLocations = payload.locations.map(normalizeLocation);
      const failures = payload.failures || [];
      const failedByOrganization = new Map(
        failures.map((failure) => [
          failure.organization,
          failure.error,
        ]),
      );
      const savedOrganizationKeys = new Set(
        savedLocations.map((location) =>
          institutionAliasKey(location.organization),
        ),
      );
      setLocations((current) => [
        ...current.filter(
          (location) =>
            !savedLocations.some(
              (saved) =>
                institutionAliasKey(saved.organization) ===
                institutionAliasKey(location.organization),
            ),
        ),
        ...savedLocations,
      ]);
      setLocationBatchRows((current) =>
        current.map((row) => {
          const failure = failedByOrganization.get(row.organization);
          if (failure) return { ...row, error: failure };
          if (
            savedOrganizationKeys.has(
              institutionAliasKey(row.organization),
            )
          ) {
            return {
              ...row,
              mapped: true,
              selected: false,
              error: "",
            };
          }
          return row;
        }),
      );
      if (savedLocations.length) await onRecordsChanged();
      const savedCount = payload.savedCount ?? savedLocations.length;
      if (failures.length) {
        const failedNames = failures
          .slice(0, 5)
          .map((failure) => failure.organization)
          .join(", ");
        const message = `${savedCount}곳 저장, ${failures.length}곳 실패했습니다: ${failedNames}${
          failures.length > 5 ? ` 외 ${failures.length - 5}곳` : ""
        }`;
        setLocationBatchMessage(message);
        setNotice(message);
      } else {
        setLocationBatchOpen(false);
        setNotice(`${savedCount}곳의 위치를 일괄 저장했습니다.`);
      }
    } catch (caught) {
      setLocationBatchMessage(
        caught instanceof Error ? caught.message : "기관 위치를 일괄 저장하지 못했습니다.",
      );
    } finally {
      setLocationBatchSaving(false);
    }
  }

  const counts = Object.fromEntries(
    (["영업 중", "진행 중", "완료"] as VisibleMapStatus[]).map(
      (status) => [
        status,
        eligibleOrganizations.filter((item) => item.status === status).length,
      ],
    ),
  ) as Record<VisibleMapStatus, number>;
  const mappedCount = eligibleOrganizations.filter((item) => item.location).length;
  const unmappedCount = eligibleOrganizations.length - mappedCount;
  const visibleLocationBatchRows = locationBatchRows.filter(
    (row) => locationBatchShowMapped || !row.mapped,
  );
  const selectedLocationBatchCount = locationBatchRows.filter(
    (row) => row.selected,
  ).length;
  const showingUnmappedList =
    locationFilter === "위치 미등록" &&
    statusFilter === "전체" &&
    !nearbyRadius &&
    !search.trim();
  const selectedMappedCount = eligibleOrganizations.filter(
    (item) => item.location && activeSelected.includes(item.organization),
  ).length;
  const focusedPhone =
    [
      focusedDirectPhone,
      focusedOfficialSchool?.phone ?? "",
    ].find((phone) => callablePhone(phone)) ?? "";
  const focusedDialPhone = callablePhone(focusedPhone);
  const focusedPhoneLabel =
    focusedPhone &&
    focusedOfficialSchool &&
    focusedPhone === focusedOfficialSchool.phone &&
    !focusedDirectPhone
      ? "학교 대표전화"
      : "전화번호";
  const focusedPhoneLoading =
    Boolean(focusedSchoolLookupKey) &&
    officialSchoolPhoneLoadingKey === focusedSchoolLookupKey;
  const budgetStatuses = [
    "진행 중",
    "위즈업 선정",
    "협력사 선정",
    "타업체 선정",
    "수주 후 진행",
    "완료",
  ];
  const budgetKeyword = search.trim().toLocaleLowerCase("ko-KR");
  const matchesBudgetTargetFilters = (target: SalesCampaignTarget) => {
    if (
      budgetQuickFilter === "whizzup" &&
      target.currentAwardStatus !== "위즈업 수주"
    ) {
      return false;
    }
    if (
      budgetQuickFilter === "other" &&
      target.currentAwardStatus !== "타업체 수주"
    ) {
      return false;
    }
    if (
      budgetQuickFilter === "post-award" &&
      budgetTargetStatus(target) !== "수주 후 진행"
    ) {
      return false;
    }
    if (
      budgetQuickFilter === "complete" &&
      budgetTargetStatus(target) !== "완료"
    ) {
      return false;
    }
    if (
      budgetStatusFilter &&
      budgetTargetStatus(target) !== budgetStatusFilter
    ) {
      return false;
    }
    return true;
  };
  const orderedBudgetTargetGroups = groupJointProjectRows(activeCampaignTargets)
    .filter((group) => group.members.some(matchesBudgetTargetFilters))
    .sort((left, right) => {
      const statusOrder =
        budgetAwardPriority(left.primary.currentAwardStatus) -
        budgetAwardPriority(right.primary.currentAwardStatus);
      if (statusOrder) return statusOrder;
      return (
        right.primary.currentActivityDate.localeCompare(
          left.primary.currentActivityDate,
        ) ||
        right.primary.id - left.primary.id
      );
    });
  const filteredBudgetTargetGroups = filterJointProjectGroupsByMember(
    orderedBudgetTargetGroups,
    budgetKeyword
      ? (target) =>
          [
            target.organization,
            target.region,
            target.assignedMemberName,
            target.currentProgressManager,
            target.contactName,
            target.currentBudgetType,
            target.supplyItems,
          ]
            .join(" ")
            .toLocaleLowerCase("ko-KR")
            .includes(budgetKeyword)
      : undefined,
  );
  const filteredBudgetTargets = filteredBudgetTargetGroups.flatMap(
    (group) => group.members,
  );
  const filteredBudgetTargetIds = jointProjectGroupMemberIds(
    filteredBudgetTargetGroups,
  );
  const budgetSelectedTargetIdSet = new Set(budgetSelectedTargetIds);
  const allFilteredBudgetTargetsSelected =
    filteredBudgetTargetIds.length > 0 &&
    filteredBudgetTargetIds.every((id) => budgetSelectedTargetIdSet.has(id));
  const budgetAssignedCount = activeCampaignTargets.filter(
    (target) => target.assignedMemberId,
  ).length;
  const budgetCompletedCount = activeCampaignTargets.filter(
    (target) => budgetTargetStatus(target) === "완료",
  ).length;
  const budgetPostAwardInProgressCount = activeCampaignTargets.filter(
    (target) => budgetTargetStatus(target) === "수주 후 진행",
  ).length;
  const budgetWhizzupSelectionCount = activeCampaignTargets.filter(
    (target) => target.currentAwardStatus === "위즈업 수주",
  ).length;
  const budgetOtherSelectionCount = activeCampaignTargets.filter(
    (target) => target.currentAwardStatus === "타업체 수주",
  ).length;

  if (displayMode === "map" && configLoading) {
    return (
      <section className="panel sales-map-loading">
        <span className="access-spinner" />
        <strong>영업 지도를 준비하고 있습니다</strong>
      </section>
    );
  }

  if (displayMode === "map" && !javascriptKey) {
    return (
      <section className="panel map-setup-panel">
        <div className="map-setup-copy">
          <span className="section-kicker">KAKAO MAP SETUP</span>
          <h2>카카오 지도 연결을 마무리해 주세요</h2>
          <p>
            카카오 Developers의 플랫폼 키 화면에서 새로 만든
            <strong> JavaScript 키</strong>만 입력합니다. REST API 키는 입력하지
            않습니다.
          </p>
        </div>
        {isOwner ? (
          <div className="map-key-entry">
            <label htmlFor="kakao-javascript-key">카카오 JavaScript 키</label>
            <div>
              <input
                id="kakao-javascript-key"
                type="password"
                autoComplete="off"
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
                placeholder="JavaScript 키 입력"
              />
              <button
                type="button"
                onClick={() => void saveMapKey()}
                disabled={configSaving}
              >
                {configSaving ? "연결 중" : "지도 연결"}
              </button>
            </div>
            <small>
              입력값은 승인된 사이트의 지도 연결에만 사용됩니다.
            </small>
          </div>
        ) : (
          <div className="map-setup-member">
            관리자가 최초 한 번 지도 연결을 완료하면 사용할 수 있습니다.
          </div>
        )}
        {mapError && <p className="map-inline-error">{mapError}</p>}
      </section>
    );
  }

  return (
    <section className="sales-map-page">
      {displayMode === "budget" && (
        <section className="budget-institution-board">
          <header className="budget-board-head">
            <div>
              <span className="section-kicker">BUDGET INSTITUTIONS</span>
              <h2>예산·공고별 기관 명단</h2>
              <p>
                선정기관을 불러와 진행 상태와 담당자를 한 화면에서 관리합니다.
              </p>
            </div>
            <div className="budget-board-actions">
              {activeCampaign && canManageCampaigns && (
                <button
                  type="button"
                  className="campaign-existing-add-button"
                  onClick={openExistingCampaignPicker}
                >
                  기존 기관 추가
                </button>
              )}
              <button
                type="button"
                className="campaign-manual-button"
                onClick={beginBudgetCardCreate}
              >
                예산카드 등록
              </button>
              {activeCampaign && isOwner && (
                <button
                  type="button"
                  className="campaign-card-edit-button"
                  onClick={() => beginBudgetCardEdit(activeCampaign)}
                >
                  예산카드 수정
                </button>
              )}
              <details className="campaign-file-menu">
                <summary>파일 등록</summary>
                <div>
                  <button
                    type="button"
                    className="campaign-pdf-button"
                    onClick={() => campaignPdfRef.current?.click()}
                    disabled={campaignPdfAnalyzing}
                  >
                    {campaignPdfAnalyzing ? "PDF 분석 중" : "PDF로 등록"}
                  </button>
                  <button
                    type="button"
                    className="campaign-import-button"
                    onClick={() => campaignFileRef.current?.click()}
                  >
                    Excel로 등록
                  </button>
                </div>
              </details>
            </div>
          </header>

          <div className="budget-portfolio-summary" aria-label="예산별 기관 전체 통계">
            <div>
              <span>전체 기관</span>
              <strong>{budgetPortfolioSummary.uniqueInstitutionCount}곳</strong>
              <small>학교·기관 중복 제외</small>
            </div>
            <div>
              <span>예산 참여</span>
              <strong>{budgetPortfolioSummary.participationCount}건</strong>
              <small>예산별 기관 연결 기준</small>
            </div>
            <div>
              <span>복수 예산 기관</span>
              <strong>{budgetPortfolioSummary.multipleBudgetInstitutionCount}곳</strong>
              <small>두 개 이상 표준 예산 참여</small>
            </div>
          </div>

          <div className="budget-campaign-tabs" aria-label="예산 명단 선택">
            {campaigns.map((campaign) => (
              <button
                type="button"
                className={activeCampaignId === campaign.id ? "active" : ""}
                key={campaign.id}
                onClick={() => setActiveCampaignId(campaign.id)}
              >
                <strong>{campaign.name}</strong>
                <span>{campaign.targetCount}곳</span>
              </button>
            ))}
            {!campaignLoading && !campaigns.length && (
              <p>등록된 예산별 기관 명단이 없습니다.</p>
            )}
          </div>

          {activeCampaign ? (
            <>
              <div className="budget-campaign-overview">
                <div>
                  <span>표준 예산명</span>
                  <strong>{activeCampaign.budgetType || "확인 필요"}</strong>
                </div>
                <div>
                  <span>선정·공고일</span>
                  <strong>{formatDate(activeCampaign.selectionDate)}</strong>
                </div>
                <div>
                  <span>선정기관</span>
                  <strong>{activeCampaign.targetCount}곳</strong>
                </div>
                <div>
                  <span>담당 배정</span>
                  <strong>{budgetAssignedCount}곳</strong>
                </div>
                <button
                  type="button"
                  className={`budget-selection-summary whizzup ${
                    budgetQuickFilter === "whizzup" ? "active" : ""
                  }`.trim()}
                  aria-pressed={budgetQuickFilter === "whizzup"}
                  onClick={() => {
                    setBudgetStatusFilter("");
                    setBudgetQuickFilter((current) =>
                      current === "whizzup" ? "" : "whizzup",
                    );
                  }}
                >
                  <span>위즈업 선정</span>
                  <strong>{budgetWhizzupSelectionCount}곳</strong>
                  <small>클릭해서 해당 기관만 보기</small>
                </button>
                <button
                  type="button"
                  className={`budget-selection-summary other ${
                    budgetQuickFilter === "other" ? "active" : ""
                  }`.trim()}
                  aria-pressed={budgetQuickFilter === "other"}
                  onClick={() => {
                    setBudgetStatusFilter("");
                    setBudgetQuickFilter((current) =>
                      current === "other" ? "" : "other",
                    );
                  }}
                >
                  <span>타업체 선정</span>
                  <strong>{budgetOtherSelectionCount}곳</strong>
                  <small>클릭해서 해당 기관만 보기</small>
                </button>
                <button
                  type="button"
                  className={`budget-selection-summary post-award ${
                    budgetQuickFilter === "post-award" ? "active" : ""
                  }`.trim()}
                  aria-pressed={budgetQuickFilter === "post-award"}
                  onClick={() => {
                    setBudgetStatusFilter("");
                    setBudgetQuickFilter((current) =>
                      current === "post-award" ? "" : "post-award",
                    );
                  }}
                >
                  <span>수주 후 진행</span>
                  <strong>{budgetPostAwardInProgressCount}곳</strong>
                  <small>클릭해서 진행 기관만 보기</small>
                </button>
                <button
                  type="button"
                  className={`budget-selection-summary complete ${
                    budgetQuickFilter === "complete" ? "active" : ""
                  }`.trim()}
                  aria-pressed={budgetQuickFilter === "complete"}
                  onClick={() => {
                    setBudgetStatusFilter("");
                    setBudgetQuickFilter((current) =>
                      current === "complete" ? "" : "complete",
                    );
                  }}
                >
                  <span>완료</span>
                  <strong>{budgetCompletedCount}곳</strong>
                  <small>클릭해서 완료 기관만 보기</small>
                </button>
              </div>

              <div className="budget-board-toolbar">
                <input
                  type="search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="기관명·지역·담당자 검색"
                  aria-label="예산별 기관 검색"
                />
                <select
                  value={budgetStatusFilter}
                  onChange={(event) => {
                    setBudgetQuickFilter("");
                    setBudgetStatusFilter(event.target.value);
                  }}
                  aria-label="예산별 기관 상태 필터"
                >
                  <option value="">전체 상태</option>
                  {budgetStatuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onOpenMapCampaign?.(activeCampaign.id)}
                >
                  지도에서 보기
                </button>
              </div>

              {isOwner && (
                <div className="budget-bulk-toolbar">
                  <label>
                    <input
                      type="checkbox"
                      checked={allFilteredBudgetTargetsSelected}
                      onChange={() => {
                        const resultIds = filteredBudgetTargetIds;
                        setBudgetSelectedTargetIds((current) =>
                          allFilteredBudgetTargetsSelected
                            ? current.filter((id) => !resultIds.includes(id))
                            : [...new Set([...current, ...resultIds])],
                        );
                      }}
                    />
                    현재 검색 결과 전체 선택
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setBudgetSelectedTargetIds(
                        filteredBudgetTargetGroups
                          .flatMap((group) => group.members)
                          .filter((target) => !target.assignedMemberId)
                          .map((target) => target.id),
                      )
                    }
                  >
                    담당자 미지정만 선택
                  </button>
                  <strong>
                    {budgetSelectedTargetIds.length.toLocaleString("ko-KR")}곳 선택
                  </strong>
                  <button
                    type="button"
                    disabled={!budgetSelectedTargetIds.length}
                    onClick={() => {
                      setBudgetSelectedTargetIds([]);
                      setBudgetBulkAssigneeId("");
                    }}
                  >
                    선택 전체 해제
                  </button>
                  <select
                    value={budgetBulkAssigneeId}
                    onChange={(event) =>
                      setBudgetBulkAssigneeId(event.target.value)
                    }
                    aria-label="일괄 진행 담당자"
                  >
                    <option value="">담당자 선택</option>
                    <option value="unassigned">미지정</option>
                    {campaignMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {campaignMemberLabel(member)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={
                      !budgetSelectedTargetIds.length ||
                      !budgetBulkAssigneeId ||
                      Boolean(budgetBulkBusy)
                    }
                    onClick={() => void runBudgetBulkAction("bulk-assign")}
                  >
                    {budgetBulkBusy === "bulk-assign"
                      ? "담당자 변경 중…"
                      : "담당자 일괄 변경"}
                  </button>
                  <button
                    type="button"
                    className="joint-project-button"
                    disabled={
                      selectedBudgetJointCandidates.length < 2 ||
                      Boolean(budgetBulkBusy)
                    }
                    onClick={() => setJointProjectOpen(true)}
                  >
                    공동사업 연결
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={
                      !budgetSelectedTargetIds.length || Boolean(budgetBulkBusy)
                    }
                    onClick={() => void runBudgetBulkAction("remove-targets")}
                  >
                    {budgetBulkBusy === "remove-targets"
                      ? "명단 제외 중…"
                      : "잘못 등록된 기관 제외"}
                  </button>
                </div>
              )}

              <div className="budget-institution-table-wrap">
                <table
                  className={`budget-institution-table ${
                    isOwner ? "owner-controls" : ""
                  }`.trim()}
                >
                  <thead>
                    <tr>
                      {isOwner && <th>선택</th>}
                      <th>기관</th>
                      <th>기관별 예산·금액</th>
                      <th>진행 상태</th>
                      <th>진행 담당자</th>
                      <th>기관 담당자</th>
                      <th>다음 일정·행동</th>
                      <th>상세</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBudgetTargetGroups.map((group) => {
                      const target = group.primary;
                      const selection = budgetTargetSelection(target);
                      const status = budgetTargetStatus(target);
                      const detailTarget = budgetKeyword
                        ? group.matchingMembers.find(
                            (member) => member.jointProjectRole !== "sponsor",
                          ) ?? group.matchingMembers[0] ?? target
                        : target;
                      return (
                      <tr
                        key={group.key}
                        className={
                          selection
                            ? `budget-selection-row ${selection.kind}`
                            : ""
                        }
                      >
                        {isOwner && (
                          <td className="selection-cell">
                            <input
                              type="checkbox"
                              aria-label={`${target.organization} 선택`}
                              checked={group.members.every((member) => budgetSelectedTargetIdSet.has(member.id))}
                              onChange={() =>
                                setBudgetSelectedTargetIds((current) => {
                                  const memberIds = new Set(group.members.map((member) => member.id));
                                  const selected = group.members.every((member) => current.includes(member.id));
                                  return selected
                                    ? current.filter((id) => !memberIds.has(id))
                                    : [...new Set([...current, ...memberIds])];
                                })
                              }
                            />
                          </td>
                        )}
                        <td>
                          <strong>{group.sponsorOrganization}</strong>
                          {group.projectId && (
                            <>
                              <em className="joint-project-badge sponsor" title={group.projectName}>
                                공동사업 주관 · {group.members.filter((member) => member.jointProjectRole !== "sponsor").length}곳
                              </em>
                              <JointProjectMemberList
                                members={group.members}
                                matchingMembers={group.matchingMembers}
                                searchActive={Boolean(budgetKeyword)}
                                onSelectMember={(member) =>
                                  onOpenOrganization(member.organization)
                                }
                              />
                            </>
                          )}
                          <span>
                            {[target.region, target.schoolLevel]
                              .filter(Boolean)
                              .join(" · ") || "지역 미등록"}
                          </span>
                        </td>
                        <td>
                          <div className="budget-amount-with-source">
                            <span className="budget-amount-name">
                              {activeCampaign.budgetType || "예산명 확인 필요"}
                            </span>
                            <strong>{group.projectId
                              ? formatWon(jointProjectSiteBudgetTotal(group.members))
                              : formatWon(target.budgetAmount)}</strong>
                            {!group.projectId && (
                              <small>{budgetAmountSourceLabel(target)}</small>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="budget-status-stack">
                            {selection && (
                              <span
                                className={`budget-selection-badge ${selection.kind}`}
                              >
                                {selection.label}
                              </span>
                            )}
                            {status !== selection?.label && (
                              <span className="budget-status-badge">
                                {status}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          {isOwner ? (
                            <select
                              value={target.assignedMemberId ?? ""}
                              onChange={(event) =>
                                void updateCampaignAssignee(
                                  target,
                                  Number(event.target.value) || null,
                                )
                              }
                              disabled={assignmentSaving === target.id}
                              aria-label={`${target.organization} 진행 담당자`}
                            >
                              <option value="">미지정</option>
                              {campaignMembers.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {campaignMemberLabel(member)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <strong>
                              {target.assignedMemberName ||
                                target.currentProgressManager ||
                                "미지정"}
                            </strong>
                          )}
                        </td>
                        <td>
                          <strong>
                            {target.contactName || "담당자 미등록"}
                          </strong>
                          <span>{target.phone || "연락처 미등록"}</span>
                        </td>
                        <td>
                          <strong>
                            {target.currentNextAction || "첫 컨택 필요"}
                          </strong>
                          <span>
                            {target.currentActivityDate
                              ? `최근 ${formatDate(target.currentActivityDate)}`
                              : "등록 기록 없음"}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                              onClick={() =>
                                onOpenOrganization(detailTarget.organization)
                              }
                          >
                            상세 보기
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="budget-institution-mobile-list">
                {filteredBudgetTargetGroups.map((group) => {
                  const target = group.primary;
                  const selection = budgetTargetSelection(target);
                  const status = budgetTargetStatus(target);
                  const detailTarget = budgetKeyword
                    ? group.matchingMembers.find(
                        (member) => member.jointProjectRole !== "sponsor",
                      ) ?? group.matchingMembers[0] ?? target
                    : target;
                  return (
                  <article
                    key={group.key}
                    className={
                      selection
                        ? `budget-selection-row ${selection.kind}`
                        : ""
                    }
                  >
                    <header>
                      <div>
                        {isOwner && (
                          <input
                            type="checkbox"
                            aria-label={`${target.organization} 선택`}
                            checked={group.members.every((member) => budgetSelectedTargetIdSet.has(member.id))}
                            onChange={() =>
                              setBudgetSelectedTargetIds((current) => {
                                const memberIds = new Set(group.members.map((member) => member.id));
                                const selected = group.members.every((member) => current.includes(member.id));
                                return selected
                                  ? current.filter((id) => !memberIds.has(id))
                                  : [...new Set([...current, ...memberIds])];
                              })
                            }
                          />
                        )}
                        <strong>{group.sponsorOrganization}</strong>
                        {group.projectId && (
                          <>
                            <em className="joint-project-badge sponsor" title={group.projectName}>
                              공동사업 주관 · {group.members.filter((member) => member.jointProjectRole !== "sponsor").length}곳
                            </em>
                            <JointProjectMemberList
                              members={group.members}
                              matchingMembers={group.matchingMembers}
                              searchActive={Boolean(budgetKeyword)}
                              showBudget={false}
                              onSelectMember={(member) =>
                                onOpenOrganization(member.organization)
                              }
                            />
                          </>
                        )}
                        <span>{target.region || "지역 미등록"}</span>
                      </div>
                      <div className="budget-mobile-status-stack">
                        {selection && (
                          <em
                            className={`budget-selection-badge ${selection.kind}`}
                          >
                            {selection.label}
                          </em>
                        )}
                        {status !== selection?.label && <em>{status}</em>}
                      </div>
                    </header>
                    <dl>
                      <div>
                        <dt>기관별 예산·금액</dt>
                        <dd>
                          <span className="budget-amount-with-source">
                            <span className="budget-amount-name">
                              {activeCampaign.budgetType || "예산명 확인 필요"}
                            </span>
                            <strong>{group.projectId
                              ? formatWon(jointProjectSiteBudgetTotal(group.members))
                              : formatWon(target.budgetAmount)}</strong>
                            {!group.projectId && (
                              <small>{budgetAmountSourceLabel(target)}</small>
                            )}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt>진행 담당자</dt>
                        <dd>
                          {isOwner ? (
                            <select
                              value={target.assignedMemberId ?? ""}
                              onChange={(event) =>
                                void updateCampaignAssignee(
                                  target,
                                  Number(event.target.value) || null,
                                )
                              }
                              disabled={assignmentSaving === target.id}
                              aria-label={`${target.organization} 진행 담당자`}
                            >
                              <option value="">미지정</option>
                              {campaignMembers.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {campaignMemberLabel(member)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            target.assignedMemberName ||
                            target.currentProgressManager ||
                            "미지정"
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>기관 담당자</dt>
                        <dd>
                          {target.contactName || "미등록"}
                          {target.phone ? ` · ${target.phone}` : ""}
                        </dd>
                      </div>
                      <div>
                        <dt>다음 행동</dt>
                        <dd>{target.currentNextAction || "첫 컨택 필요"}</dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      onClick={() => onOpenOrganization(detailTarget.organization)}
                    >
                      기관 상세 보기
                    </button>
                  </article>
                  );
                })}
              </div>

              {!filteredBudgetTargetGroups.length && (
                <div className="empty-state large">
                  현재 조건에 해당하는 기관이 없습니다.
                </div>
              )}
            </>
          ) : (
            <div className="empty-state large">
              PDF 또는 엑셀로 예산별 기관 명단을 등록해 주세요.
            </div>
          )}
        </section>
      )}

      <div
        className="sales-map-view"
        hidden={displayMode !== "map"}
        aria-hidden={displayMode !== "map"}
      >
      <div className="sales-map-summary">
        <div>
          <span>지도 등록</span>
          <strong>{mappedCount}</strong>
          <small>전체 {eligibleOrganizations.length}개 기관</small>
        </div>
        <div className="map-summary-progress">
          <span>진행 중</span>
          <strong>{counts["진행 중"]}</strong>
          <small>계약·설치·일정 조율</small>
        </div>
        <div className="map-summary-complete">
          <span>완료 실적</span>
          <strong>{counts["완료"]}</strong>
          <small>납품 완료</small>
        </div>
        <div className="map-summary-selected">
          <span>{nearbyRadius ? "내 주변" : "동선 선택"}</span>
          <strong>
            {nearbyRadius ? filteredOrganizations.length : activeSelected.length}
          </strong>
          <small>
            {nearbyRadius
              ? `${nearbyRadius}km · 설치 완료 학교`
              : `위치 확인 ${selectedMappedCount}곳`}
          </small>
        </div>
      </div>

      <section className="sales-campaign-panel">
        <header>
          <div>
            <span className="section-kicker">SALES CAMPAIGN</span>
            <h2>영업 카테고리</h2>
            <p>
              예산·사업별 기관을 묶어 지도 동선과 담당자를 함께 관리합니다.
            </p>
          </div>
          <div className="sales-campaign-actions">
            <button
              type="button"
              className="campaign-manual-button"
              onClick={beginManualCampaignImport}
            >
              직접 등록
            </button>
            <button
              type="button"
              className="campaign-pdf-button"
              onClick={() => campaignPdfRef.current?.click()}
              disabled={campaignPdfAnalyzing}
            >
              {campaignPdfAnalyzing ? "PDF 분석 중" : "PDF로 등록"}
            </button>
            <input
              ref={campaignPdfRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => void handleCampaignPdf(event)}
              hidden
            />
            <button
              type="button"
              className="campaign-template-button"
              onClick={downloadCampaignTemplate}
            >
              엑셀 양식 다운로드
            </button>
            <button
              type="button"
              className="campaign-import-button"
              onClick={() => campaignFileRef.current?.click()}
            >
              엑셀 가져오기
            </button>
            <input
              ref={campaignFileRef}
              type="file"
              accept=".xlsx,.csv"
              onChange={(event) => void handleCampaignFile(event)}
              hidden
            />
          </div>
        </header>
        <div className="sales-campaign-tabs" aria-label="영업 카테고리 선택">
          <button
            type="button"
            className={activeCampaignId === "all" ? "active" : ""}
            onClick={() => selectCampaign("all")}
          >
            전체 기관
            <span>{eligibleOrganizations.length}</span>
          </button>
          {campaigns.map((campaign) => (
            <button
              type="button"
              className={activeCampaignId === campaign.id ? "active" : ""}
              key={campaign.id}
              onClick={() => selectCampaign(campaign.id)}
            >
              {campaign.name}
              <span>{campaign.targetCount}</span>
            </button>
          ))}
          {campaignLoading && <em>카테고리 불러오는 중</em>}
        </div>
        {activeCampaign && (
          <div className="sales-campaign-active">
            <div>
              <strong>{activeCampaign.name}</strong>
              <span>
                {activeCampaign.targetCount}개 기관 · 담당자 배정{" "}
                {activeCampaign.assignedCount}곳
              </span>
              {activeCampaign.notes && <p>{activeCampaign.notes}</p>}
            </div>
            {canManageCampaigns && (
              <button
                type="button"
                onClick={() => setCampaignDeleteTarget(activeCampaign)}
              >
                카테고리 삭제
              </button>
            )}
          </div>
        )}
      </section>

      <div className="sales-map-toolbar">
        <div className="map-status-tabs" aria-label="지도 상태 필터">
          {statusOrder.map((status) => (
            <button
              type="button"
              key={status}
              className={statusFilter === status ? "active" : ""}
              onClick={() => {
                clearNearbyFilter();
                setStatusFilter(status);
              }}
            >
              {status}
              {status !== "전체" && <span>{counts[status]}</span>}
            </button>
          ))}
        </div>
        <div className="map-toolbar-actions">
          {canEditLocations && (
            <>
              <button
                type="button"
                className="location-batch-open"
                onClick={openLocationBatchEditor}
              >
                위치 일괄 편집
              </button>
              <input
                ref={locationBatchFileRef}
                type="file"
                accept=".xlsx,.csv"
                onChange={(event) => void handleLocationBatchFile(event)}
                hidden
              />
            </>
          )}
          <button
            type="button"
            className={`auto-locate ${showingUnmappedList ? "active" : ""}`}
            aria-pressed={showingUnmappedList}
            onClick={() => {
              clearNearbyFilter();
              setFocusedOrganization("");
              if (showingUnmappedList) {
                setLocationFilter("전체 위치");
                changeMobileView("list");
                return;
              }
              setStatusFilter("전체");
              setLocationFilter("위치 미등록");
              onSearchChange("");
              changeMobileView("list");
            }}
            disabled={!unmappedCount && !showingUnmappedList}
          >
            {showingUnmappedList
              ? "전체 기관 보기"
              : unmappedCount
                ? `미등록 ${unmappedCount}곳 보기`
                : "위치 등록 완료"}
          </button>
        </div>
      </div>

      <div className="map-nearby-panel">
        <div className="map-nearby-copy">
          <strong>내 주변 설치학교</strong>
          <span>현재 위치를 저장하지 않고 완료 학교만 거리순으로 표시합니다.</span>
        </div>
        <div className="map-nearby-actions" aria-label="내 주변 설치학교 반경">
          {([10, 30] as NearbyRadius[]).map((radius) => (
            <button
              type="button"
              className={nearbyRadius === radius ? "active" : ""}
              aria-pressed={nearbyRadius === radius}
              disabled={nearbyLocating}
              key={radius}
              onClick={() => void showNearbyInstalledSchools(radius)}
            >
              {nearbyLocating ? "위치 확인 중" : `${radius}km`}
            </button>
          ))}
          {nearbyRadius && (
            <button type="button" className="clear" onClick={clearNearbyFilter}>
              해제
            </button>
          )}
        </div>
        {nearbyMessage && <p>{nearbyMessage}</p>}
      </div>

      <div className="map-mobile-view-switch" aria-label="모바일 지도 화면 전환">
        <button
          type="button"
          className={mobileView === "map" ? "active" : ""}
          aria-pressed={mobileView === "map"}
          onClick={() => changeMobileView("map")}
        >
          지도 보기
        </button>
        <button
          type="button"
          className={mobileView === "list" ? "active" : ""}
          aria-pressed={mobileView === "list"}
          onClick={() => changeMobileView("list")}
        >
          목록·동선{" "}
          <span>{mapListOrganizations.length}</span>
        </button>
      </div>

      <div className={`sales-map-layout mobile-view-${mobileView}`}>
        <aside className="sales-map-sidebar">
          <div className="map-list-filters">
            <div className="inline-search">
              <span>⌕</span>
              <input
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="기관명·담당자·주소·주제 검색"
                aria-label="지도 기관명·담당자·주소·주제 검색"
              />
            </div>
          </div>

          <div className="route-planner">
              <div>
                <strong>영업 동선</strong>
                <span>{activeSelected.length}곳 선택 · 카테고리 혼합 가능</span>
              </div>
              <div className="route-actions">
                <button
                  type="button"
                  onClick={selectCurrentMapList}
                  disabled={!selectionCandidates.length}
                >
                  {`${selectionScopeLabel} ${selectionCandidates.length.toLocaleString("ko-KR")}곳 선택`}
                </button>
                <button
                  type="button"
                  onClick={clearMapSelection}
                  disabled={!activeSelected.length}
                >
                  선택 해제
                </button>
                <button
                  type="button"
                  className="route-recommend"
                  onClick={() => {
                    setRouteStartOpen((current) => !current);
                    setRouteMessage("출발지를 선택하거나 직접 입력해 주세요.");
                  }}
                  disabled={selectedMappedCount < 2}
                >
                  방문 순서 추천
                </button>
              </div>
              {routeStartOpen && (
                <form
                  className="route-start-picker"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void recommendRoute(routeStartInput);
                  }}
                >
                  <div className="route-start-heading">
                    <span>출발지 선택</span>
                    <div className="route-start-options">
                      <button
                        type="button"
                        onClick={() => {
                          setRouteStartInput(companyRouteOrigin.address);
                          void recommendRoute(
                            companyRouteOrigin.address,
                            companyRouteOrigin.label,
                          );
                        }}
                        disabled={routeCalculating}
                      >
                        <b aria-hidden="true">🏢</b> 위즈업 본사
                      </button>
                      <button
                        type="button"
                        className="route-current-location"
                        onClick={() => void recommendRouteFromCurrentLocation()}
                        disabled={routeCalculating}
                      >
                        <b aria-hidden="true">◎</b>
                        {routeLocating ? "위치 확인 중" : "내 위치"}
                      </button>
                    </div>
                  </div>
                  <label>
                    <span>다른 출발지</span>
                    <div>
                      <input
                        value={routeStartInput}
                        onChange={(event) =>
                          setRouteStartInput(event.target.value)
                        }
                        placeholder="주소 또는 장소명 입력"
                        autoFocus
                      />
                      <button
                        type="submit"
                        disabled={!routeStartInput.trim() || routeCalculating}
                      >
                        {routeCalculating ? "계산 중" : "이 주소로 추천"}
                      </button>
                    </div>
                  </label>
                  <small>{companyRouteOrigin.address}</small>
                </form>
              )}
              {routeMessage && <p>{routeMessage}</p>}
              {activeRouteOrder.length > 0 && (
                <>
                  {routeOrigin && (
                    <div className="route-origin-summary">
                      <span>출발</span>
                      <strong>{routeOrigin.label}</strong>
                      <small>{routeOrigin.address}</small>
                    </div>
                  )}
                  <ol className="route-order">
                    {activeRouteOrder.map((organization) => (
                      <li key={organization}>
                        <span>{organization}</span>
                        <a
                          href={`https://map.kakao.com/link/to/${encodeURIComponent(
                            organization,
                          )},${locationByOrganization.get(institutionAliasKey(organization))!.latitude},${
                            locationByOrganization.get(institutionAliasKey(organization))!.longitude
                          }`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          길찾기
                        </a>
                      </li>
                    ))}
                  </ol>
                </>
              )}
          </div>

          <div className="map-organization-list">
            <div className="map-viewport-note">
              <strong>
                {hasDraftSearch
                  ? "검색 결과"
                  : isMobileMapLayout
                    ? "현재 조건"
                    : "현재 지도 범위"}{" "}
                {mapListOrganizations.length}곳
              </strong>
              <span>
                {hasDraftSearch
                  ? `위치 등록 ${mapListMappedCount.toLocaleString("ko-KR")}곳 · 미등록 ${mapListUnmappedCount.toLocaleString("ko-KR")}곳 · 지도 이동과 관계없이 검색 결과를 유지합니다.`
                  : isMobileMapLayout
                    ? "지도 이동과 관계없이 선택한 기관을 유지합니다."
                    : "지도를 이동하거나 확대하면 목록도 함께 바뀝니다."}
              </span>
            </div>
            {mapListOrganizations.map((item) => {
              const campaignTarget =
                activeCampaignTargetByOrganization.get(item.organization);
              return (
                <article
                  className={`map-organization-row ${
                    activeSelected.includes(item.organization) ? "selected" : ""
                  }`}
                  key={item.organization}
                >
                  <label className="map-select-check">
                    <input
                      type="checkbox"
                      checked={activeSelected.includes(item.organization)}
                      onChange={() => toggleSelected(item.organization)}
                      disabled={hasDraftSearch && !item.location}
                      title={
                        hasDraftSearch && !item.location
                          ? "위치를 등록한 뒤 동선에 선택할 수 있습니다."
                          : undefined
                      }
                    />
                    <span className="sr-only">{item.organization} 선택</span>
                  </label>
                  <button
                    type="button"
                    className="map-organization-main"
                    onClick={() => {
                      if (item.location) {
                        setFocusedOrganization((current) =>
                          current === item.organization ? "" : item.organization,
                        );
                        if (!isMobileMapLayout) {
                          changeMobileView("map");
                        }
                      }
                    }}
                  >
                    <span className={`map-status-dot status-${item.status.replaceAll(" ", "-")}`} />
                    <span>
                      <strong>{item.organization}</strong>
                      <small>
                        {item.region || "지역 미등록"} · {item.location
                          ? item.location.roadAddress || item.location.address
                          : campaignTarget?.address || "위치 미등록"}
                        {nearbyOrigin &&
                          nearbyDistanceByOrganization.has(item.organization) &&
                          ` · ${nearbyDistanceByOrganization
                            .get(item.organization)!
                            .toFixed(1)}km`}
                      </small>
                    </span>
                  </button>
                  <span className={`map-row-status status-${item.status.replaceAll(" ", "-")}`}>
                    {item.status}
                  </span>
                  {canEditLocations && (
                    <button
                      type="button"
                      className="map-location-button"
                      onClick={() => openLocationSearch(item)}
                    >
                      {item.location ? "위치 변경" : "위치 찾기"}
                    </button>
                  )}
                  {isMobileMapLayout &&
                    focusedOrganization === item.organization &&
                    item.location && (
                      <div className="map-list-contact-card">
                        <div>
                          <span>{focusedPhoneLabel}</span>
                          {focusedDialPhone ? (
                            <a
                              className="map-list-call-button"
                              href={`tel:${focusedDialPhone}`}
                              aria-label={`${item.organization} 전화 걸기`}
                            >
                              {focusedPhone}
                              <strong>전화 걸기</strong>
                            </a>
                          ) : (
                            <span className="map-focus-phone-empty">
                              {focusedPhoneLoading
                                ? "학교 대표전화 확인 중..."
                                : "전화번호 미등록"}
                            </span>
                          )}
                        </div>
                        <dl>
                          <div>
                            <dt>수주 구분</dt>
                            <dd>{item.awardStatus || "미정"}</dd>
                          </div>
                          <div>
                            <dt>현재 상태</dt>
                            <dd>{item.awardStage || "미정"}</dd>
                          </div>
                        </dl>
                        <div className="map-list-contact-actions">
                          <button
                            type="button"
                            onClick={() => onOpenOrganization(item.organization)}
                          >
                            기관 히스토리
                          </button>
                          <a
                            href={`https://map.kakao.com/link/to/${encodeURIComponent(
                              item.organization,
                            )},${item.location.latitude},${item.location.longitude}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            길찾기
                          </a>
                        </div>
                      </div>
                    )}
                  {campaignTarget && (
                    <div className="campaign-target-controls">
                      <div>
                        <span>
                          {campaignTarget.phone
                            ? `☎ ${campaignTarget.phone}`
                            : "전화번호 미입력"}
                        </span>
                        {campaignTarget.contactName && (
                          <small>기관 담당 {campaignTarget.contactName}</small>
                        )}
                      </div>
                      <label>
                        <span>영업 담당자</span>
                        <select
                          value={campaignTarget.assignedMemberId ?? ""}
                          onChange={(event) =>
                            void updateCampaignAssignee(
                              campaignTarget,
                              event.target.value
                                ? Number(event.target.value)
                                : null,
                            )
                          }
                          disabled={assignmentSaving === campaignTarget.id}
                        >
                          <option value="">미지정</option>
                          {campaignMembers.map((member) => (
                            <option key={member.id} value={member.id}>
                              {campaignMemberLabel(member)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </article>
              );
            })}
            {!mapListOrganizations.length && (
              <div className="empty-state large">
                {hasDraftSearch
                  ? "검색 조건과 맞는 등록 기록이 없습니다."
                  : "현재 지도 범위에 조건과 맞는 기관이 없습니다."}
              </div>
            )}
          </div>
        </aside>

        <div className="sales-map-canvas">
          <div ref={mapContainerRef} className="kakao-map-container" />
          {!sdkReady && !mapError && (
            <div className="map-canvas-message">카카오 지도를 불러오는 중입니다.</div>
          )}
          {sdkReady && !mapError && !visibleMapped.length && (
            <div className="map-selection-hint">
              <span>현재 조건에는 위치가 등록된 기관이 없습니다.</span>
              <button type="button" onClick={() => changeMobileView("list")}>
                기관 목록 열기
              </button>
            </div>
          )}
          {sdkReady && !mapError && visibleMapped.length > 0 && (
            <div className="map-viewport-badge">
              클러스터 · 위치 등록{" "}
              {visibleMapped.length.toLocaleString("ko-KR")}곳
            </div>
          )}
          {mapError && (
            <div className="map-canvas-message error">
              <strong>지도를 표시하지 못했습니다.</strong>
              <span>{mapError}</span>
              <button
                type="button"
                onClick={() => {
                  document.getElementById("whizzup-kakao-map-sdk")?.remove();
                  kakaoLoader = null;
                  sdkRef.current = null;
                  mapRef.current = null;
                  mapHostRef.current = null;
                  setMapError("");
                  setSdkReady(false);
                  setMapLoadAttempt((current) => current + 1);
                }}
              >
                지도 다시 불러오기
              </button>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => {
                    setJavascriptKey("");
                    kakaoLoader = null;
                  }}
                >
                  JavaScript 키 다시 입력
                </button>
              )}
            </div>
          )}
          <div className="map-legend">
            {(["영업 중", "진행 중", "완료"] as VisibleMapStatus[]).map(
              (status) => (
                <span key={status}>
                  <i className={`status-${status.replaceAll(" ", "-")}`} />
                  {status}
                </span>
              ),
            )}
          </div>
          {focused?.location && (
            <article className="map-focus-card">
              <button
                type="button"
                className="map-focus-close"
                onClick={() => setFocusedOrganization("")}
                aria-label="지도 기관 정보 닫기"
              >
                ×
              </button>
              <span className={`map-row-status status-${focused.status.replaceAll(" ", "-")}`}>
                {focused.status}
              </span>
              <h3>{focused.organization}</h3>
              <p>{focused.location.roadAddress || focused.location.address}</p>
              <dl>
                <div>
                  <dt>수주 구분</dt>
                  <dd>
                    {focused.awardStatus || "미정"}
                    {focused.awardCompany ? ` · ${focused.awardCompany}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>현재 상태</dt>
                  <dd>{focused.awardStage || "미정"}</dd>
                </div>
                <div>
                  <dt>금액</dt>
                  <dd>{focused.budgetAmount || "미정"}</dd>
                </div>
                <div>
                  <dt>납품 완료일</dt>
                  <dd>
                    {focused.awardCompletedDate
                      ? formatDate(focused.awardCompletedDate)
                      : focused.status === "완료"
                        ? "완료일 미등록"
                        : "납품 전"}
                  </dd>
                </div>
                <div className="map-focus-products">
                  <dt>{focusedProductHeading}</dt>
                  <dd>
                    {focusedDeliverySummary?.loading
                      ? "품목 확인 중..."
                      : focusedDeliverySummary?.error
                        ? "품목 확인 실패"
                        : focusedDeliverySummary?.products.length ? (
                            <ul className="map-focus-product-list">
                              {focusedDeliverySummary.products.map(
                                ({ name, quantity }) => (
                                  <li key={name}>
                                    <span>{name}</span>
                                    {quantity > 0 && (
                                      <strong>{quantity}개</strong>
                                    )}
                                  </li>
                                ),
                              )}
                            </ul>
                          ) : focusedProductsAreDelivered
                            ? "등록된 납품 제품 없음"
                            : "등록된 예정 품목 없음"}
                  </dd>
                </div>
                <div>
                  <dt>{focusedPhoneLabel}</dt>
                  <dd>
                    {focusedDialPhone ? (
                      <a
                        className="map-focus-phone-link"
                        href={`tel:${focusedDialPhone}`}
                        aria-label={`${focused.organization} 전화 걸기`}
                        title={
                          focusedPhoneLabel === "학교 대표전화"
                            ? `${focusedOfficialSchool?.name || focused.organization} 교육청 대표전화`
                            : undefined
                        }
                      >
                        {focusedPhone}
                      </a>
                    ) : (
                      <span className="map-focus-phone-empty">
                        {focusedPhoneLoading
                          ? "학교 대표전화 확인 중..."
                          : "전화번호 미등록"}
                      </span>
                    )}
                  </dd>
                </div>
                {focusedCampaignTarget && (
                  <>
                    <div>
                      <dt>영업 담당자</dt>
                      <dd>
                        {focusedCampaignTarget.assignedMemberName || "미배정"}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              <div className="map-focus-actions">
                <button
                  type="button"
                  onClick={() => onOpenOrganization(focused.organization)}
                >
                  기관 히스토리
                </button>
                <a
                  href={`https://map.kakao.com/link/to/${encodeURIComponent(
                    focused.organization,
                  )},${focused.location.latitude},${focused.location.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  카카오 길찾기
                </a>
                <a
                  href={`https://map.naver.com/p/search/${encodeURIComponent(
                    focused.location.roadAddress ||
                      focused.location.address ||
                      focused.organization,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  네이버 지도
                </a>
              </div>
            </article>
          )}
        </div>
      </div>
      </div>

      {campaignDeleteTarget && (
        <div className="map-location-layer" role="dialog" aria-modal="true">
          <button
            type="button"
            className="map-location-backdrop"
            aria-label="캠페인 삭제 창 닫기"
            onClick={() => {
              if (!campaignDeleting) setCampaignDeleteTarget(null);
            }}
          />
          <section className="map-location-dialog campaign-delete-dialog">
            <header>
              <div>
                <span className="section-kicker">CAMPAIGN DELETE</span>
                <h2>이 캠페인을 어떻게 삭제할까요?</h2>
                <p>{campaignDeleteTarget.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setCampaignDeleteTarget(null)}
                disabled={campaignDeleting}
                aria-label="캠페인 삭제 창 닫기"
              >
                ×
              </button>
            </header>
            <div className="campaign-delete-options">
              <button
                type="button"
                onClick={() => void removeCampaign(campaignDeleteTarget, false)}
                disabled={campaignDeleting}
              >
                <strong>캠페인만 삭제</strong>
                <span>지도 카테고리만 지우고 기관과 기존 영업 기록은 유지합니다.</span>
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void removeCampaign(campaignDeleteTarget, true)}
                disabled={campaignDeleting}
              >
                <strong>캠페인과 등록 기관 함께 삭제</strong>
                <span>
                  이 캠페인이 만든 등록 기록만 지웁니다. 다른 영업 기록이 있는
                  기관은 삭제되지 않습니다.
                </span>
              </button>
            </div>
            <footer>
              <button
                type="button"
                onClick={() => setCampaignDeleteTarget(null)}
                disabled={campaignDeleting}
              >
                취소
              </button>
            </footer>
          </section>
        </div>
      )}

      {campaignExistingOpen && activeCampaign && (
        <div className="map-location-layer" role="dialog" aria-modal="true">
          <button
            type="button"
            className="map-location-backdrop"
            aria-label="기존 기관 추가 닫기"
            onClick={() => {
              if (!campaignExistingAdding) setCampaignExistingOpen(false);
            }}
          />
          <section className="campaign-existing-dialog">
            <header>
              <div>
                <span className="section-kicker">ADD EXISTING INSTITUTIONS</span>
                <h2>기존 기관에서 추가</h2>
                <p>
                  {activeCampaign.name} · 현재 명단{" "}
                  {activeCampaignTargets.length}곳
                </p>
              </div>
              <button
                type="button"
                aria-label="기존 기관 추가 닫기"
                onClick={() => setCampaignExistingOpen(false)}
                disabled={campaignExistingAdding}
              >
                ×
              </button>
            </header>

            <div className="campaign-existing-toolbar">
              <label>
                <span className="sr-only">기존 기관 검색</span>
                <input
                  type="search"
                  value={campaignExistingSearch}
                  onChange={(event) => {
                    setCampaignExistingSearch(event.target.value);
                    setCampaignExistingPage(1);
                  }}
                  placeholder="기관명·지역·예산명·담당자·전화번호 검색"
                  aria-label="추가할 기존 기관 검색"
                  autoFocus
                />
              </label>
              <div>
                <span>
                  추가 가능 {campaignExistingOptions.length}곳 · 선택{" "}
                  {campaignExistingSelectedIds.length}곳
                </span>
                <button
                  type="button"
                  onClick={toggleAllExistingCampaignInstitutions}
                  disabled={!campaignExistingOptions.length}
                >
                  {campaignExistingAllSelected
                    ? "검색 결과 선택 해제"
                    : "검색 결과 전체 선택"}
                </button>
              </div>
            </div>

            <div className="campaign-existing-list">
              {pagedCampaignExistingOptions.map((option) => (
                <label
                  className={
                    campaignExistingSelectedSet.has(option.activityId)
                      ? "selected"
                      : ""
                  }
                  key={option.key}
                >
                  <input
                    type="checkbox"
                    checked={campaignExistingSelectedSet.has(
                      option.activityId,
                    )}
                    onChange={() =>
                      toggleExistingCampaignInstitution(option)
                    }
                  />
                  <span className="campaign-existing-copy">
                    <strong>{option.organization}</strong>
                    <small>
                      {[option.region, `${option.businessRound}차`]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  <span className="campaign-existing-stage">
                    <strong>{option.stageLabel}</strong>
                    <small>
                      {option.budgetType || "예산명 미등록"} · 최근{" "}
                      {formatDate(option.activityDate)}
                    </small>
                  </span>
                  <span className="campaign-existing-contact">
                    <strong>
                      {option.progressManager || "진행 담당자 미지정"}
                    </strong>
                    <small>
                      {[option.contactName, option.contactPhone]
                        .filter(Boolean)
                        .join(" · ") || "기관 담당자 미등록"}
                    </small>
                  </span>
                </label>
              ))}
              {!campaignExistingOptions.length && (
                <div className="empty-state large">
                  검색 조건에 맞는 추가 가능 기관이 없습니다.
                </div>
              )}
            </div>

            {campaignExistingPageCount > 1 && (
              <nav
                className="campaign-existing-pagination"
                aria-label="기존 기관 목록 페이지"
              >
                <button
                  type="button"
                  onClick={() =>
                    setCampaignExistingPage((current) =>
                      Math.max(1, current - 1),
                    )
                  }
                  disabled={safeCampaignExistingPage <= 1}
                >
                  이전
                </button>
                <span>
                  {safeCampaignExistingPage} / {campaignExistingPageCount}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCampaignExistingPage((current) =>
                      Math.min(campaignExistingPageCount, current + 1),
                    )
                  }
                  disabled={
                    safeCampaignExistingPage >= campaignExistingPageCount
                  }
                >
                  다음
                </button>
              </nav>
            )}

            <footer>
              <button
                type="button"
                onClick={() => setCampaignExistingOpen(false)}
                disabled={campaignExistingAdding}
              >
                취소
              </button>
              <button
                type="button"
                className="campaign-existing-submit"
                onClick={() => void addExistingCampaignInstitutions()}
                disabled={
                  !campaignExistingSelectedIds.length ||
                  campaignExistingAdding
                }
              >
                {campaignExistingAdding
                  ? "기관 연결 중"
                  : `${campaignExistingSelectedIds.length}개 기관 추가`}
              </button>
            </footer>
          </section>
        </div>
      )}

      {campaignImport && (
        <div className="map-location-layer" role="dialog" aria-modal="true">
          <button
            type="button"
            className="map-location-backdrop"
            aria-label={campaignCardMode ? "예산카드 편집 닫기" : "영업 카테고리 등록 닫기"}
            onClick={() => undefined}
          />
          <form
            className="campaign-import-dialog campaign-pdf-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              void importCampaign();
            }}
          >
            <header>
              <div>
                <span className="section-kicker">
                  {campaignCardMode
                    ? "BUDGET CARD"
                    : campaignImport.source === "pdf"
                    ? "PDF REVIEW"
                    : campaignImport.source === "manual"
                      ? "MANUAL ENTRY"
                      : "EXCEL IMPORT"}
                </span>
                <h2>
                  {campaignCardMode === "edit"
                    ? "예산카드 수정"
                    : campaignCardMode === "create"
                      ? "예산카드 직접 등록"
                    : campaignImport.source === "pdf"
                    ? "PDF 분석 결과 확인"
                    : campaignImport.source === "manual"
                      ? "기관 직접 등록"
                      : "엑셀 명단 확인"}
                </h2>
                <p>
                  {campaignCardMode === "edit"
                    ? "카드 정보와 기본금액을 수정합니다. 기관별 실제 입력금액은 유지됩니다."
                    : campaignCardMode === "create"
                      ? "카드를 먼저 만든 뒤 기존 기관 추가에서 기관을 연결합니다."
                    : campaignImport.source === "manual"
                    ? `기관을 한 곳씩 입력합니다 · 현재 ${campaignImport.rows.length}곳`
                    : `${campaignImport.fileName} · 기관 ${campaignImport.rows.length}곳`}
                </p>
              </div>
              <button
                type="button"
                aria-label="카테고리 가져오기 닫기"
                onClick={() => {
                  if (
                    !campaignImporting &&
                    window.confirm(
                      campaignCardMode
                        ? "아직 저장하지 않은 예산카드 내용을 닫을까요?"
                        : "아직 저장하지 않은 명단 확인 내용을 닫을까요?",
                    )
                  ) {
                    setCampaignImport(null);
                    setCampaignCardMode(null);
                  }
                }}
                disabled={campaignImporting}
              >
                ×
              </button>
            </header>
            <div className="campaign-import-fields">
              <label>
                <span>{campaignCardMode ? "예산카드 이름" : "명단 이름"}</span>
                <input
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                  placeholder="예: 2026 가상현실스포츠실 선정기관"
                  maxLength={120}
                  required
                />
              </label>
              <label className="campaign-budget-selector-field">
                <span>표준 예산명</span>
                <BudgetNameSelector
                  value={campaignBudget}
                  onChange={setCampaignBudget}
                  onToast={setNotice}
                  disabled={campaignImporting || campaignCardMode === "edit"}
                  standardOnly
                />
              </label>
              <label>
                <span>선정·공고일</span>
                <input
                  type="date"
                  value={campaignSelectionDate}
                  onChange={(event) =>
                    setCampaignSelectionDate(event.target.value)
                  }
                  required
                />
              </label>
              <label>
                <span>공통 기관별 금액</span>
                <input
                  inputMode="numeric"
                  value={campaignDefaultBudgetAmount}
                  onChange={(event) =>
                    setCampaignDefaultBudgetAmount(event.target.value)
                  }
                  placeholder="대부분 같을 때 입력 · 행별 금액 우선"
                />
              </label>
              <label>
                <span>설명·예산 메모</span>
                <input
                  value={campaignNotes}
                  onChange={(event) => setCampaignNotes(event.target.value)}
                  placeholder="예: 2차 추경 스마트교실 대상"
                  maxLength={1000}
                />
              </label>
            </div>
            <div className="campaign-import-guide">
              {campaignCardMode ? (
                <>
                  <strong>
                    {campaignCardMode === "edit" ? "기존 기관 금액 보호" : "카드 먼저 등록"}
                  </strong>{" "}
                  기관 상세의 실제 금액이 우선이며, 미입력 기관만 카드 기본금액을
                  사용합니다. 표준 예산명을 바꾸려면 새 카드를 만들어 주세요.
                </>
              ) : campaignImport.source === "pdf" ? (
                <>
                  <strong>아직 저장되지 않았습니다.</strong> 예산명과 기관별
                  연결 방식을 확인한 뒤 최종 등록해 주세요.
                </>
              ) : campaignImport.source === "manual" ? (
                <>
                  기관명을 입력하면 기존 영업·수주 기록을 바로 확인합니다. 진행
                  중·납품 완료·협력사·타업체 기관도 추가할 수 있으며 기존 상태는
                  자동으로 변경하지 않습니다.
                </>
              ) : (
                <>
                  {activeCampaign &&
                  activeCampaign.budgetGroupId === campaignBudget.budgetGroupId
                    ? `${activeCampaign.name} 명단과 비교합니다. 이미 등록된 기관은 건너뛰고 누락 기관만 추가합니다.`
                    : "기존 기관과 같은 연도 사업을 먼저 확인합니다. 예산명이 이미 다르면 자동으로 덮어쓰지 않고 새 사업으로 등록합니다."}
                </>
              )}
            </div>
            {campaignImportUsesActiveList && (
              <section className="campaign-import-comparison" aria-live="polite">
                <div>
                  <strong>엑셀 {campaignImport.rows.length}곳</strong>
                  <span>현재 명단 제외 {campaignImportPartition.excluded.length}곳</span>
                  <b>추가 대상 {campaignImportPartition.pending.length}곳</b>
                </div>
                {campaignImportPartition.excluded.length > 0 && (
                  <details>
                    <summary>
                      제외된 기존 기관 {campaignImportPartition.excluded.length}곳 확인
                    </summary>
                    <ul>
                      {campaignImportPartition.excluded.map(({ row, index }) => (
                        <li key={row.clientId || `excluded-campaign-row-${index}`}>
                          <span>{row.sourceSequence || index + 1}</span>
                          <strong>{row.confirmedOrganization || row.organization}</strong>
                          <small>{row.region || row.address || "지역 미입력"}</small>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            )}
            {campaignImport.source === "manual" && !campaignCardMode && (
              <div className="campaign-manual-toolbar">
                <span>
                  같은 기관도 다른 예산에는 추가할 수 있습니다. 이 명단 안의
                  중복 기관은 저장할 때 한 곳으로 정리됩니다.
                </span>
                <button type="button" onClick={addManualCampaignRow}>
                  + 기관 한 곳 추가
                </button>
              </div>
            )}
            {campaignImportPartition.pending.length ? (
              <div className="campaign-pdf-preview">
                <div className="campaign-pdf-preview-head">
                  <span>순번</span>
                  <span>기관명</span>
                  <span>지원청·지역</span>
                  <span>학교급</span>
                  <span>지원·공급 내용</span>
                  <span>기관별 예산</span>
                  <span>기존 기관 확인</span>
                  <span>사업 연결</span>
                  <span>확인할 내용</span>
                  <span aria-hidden="true" />
                </div>
                {campaignImportPartition.pending.map(({ row, index }) => {
                  const rowId = row.clientId || `campaign-row-${index}`;
                  const organization =
                    row.confirmedOrganization ||
                    row.existingOrganizations[0] ||
                    row.organization;
                  const organizationKey = institutionAliasKey(organization);
                  const linkableRecords =
                    campaignLinkableRecordsByOrganizationYear.get(
                      `${organizationKey}::${campaignSelectionDate.slice(0, 4)}`,
                    ) ?? EMPTY_CAMPAIGN_RECORDS;
                  const showInstitutionSuggestions =
                    campaignInstitutionSearch?.rowId === rowId &&
                    deferredCampaignInstitutionSearch?.rowId === rowId &&
                    campaignInstitutionSuggestions.length > 0;
                  return (
                    <CampaignImportRowEditor
                      key={rowId}
                      row={row}
                      index={index}
                      rowId={rowId}
                      latestRecord={campaignLatestRecordByOrganization.get(
                        organizationKey,
                      )}
                      linkableRecords={linkableRecords}
                      budget={campaignBudget}
                      institutionSuggestions={
                        showInstitutionSuggestions
                          ? campaignInstitutionSuggestions
                          : EMPTY_CAMPAIGN_INSTITUTION_SUGGESTIONS
                      }
                      showInstitutionSuggestions={showInstitutionSuggestions}
                      alreadyInActiveCampaign={false}
                      onUpdate={updateCampaignImportRow}
                      onBusinessMatch={updateCampaignBusinessMatch}
                      onSelectInstitution={selectCampaignInstitution}
                      onInstitutionSearch={updateCampaignInstitutionSearch}
                      onRemove={removeCampaignImportRow}
                    />
                  );
                })}
              </div>
            ) : campaignImportUsesActiveList ? (
              <div className="campaign-import-no-missing">
                현재 명단에 없는 기관이 없습니다. 기존 기관은 다시 등록되지 않습니다.
              </div>
            ) : null}
            <footer>
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      campaignCardMode
                        ? "아직 저장하지 않은 예산카드 내용을 닫을까요?"
                        : "아직 저장하지 않은 명단 확인 내용을 닫을까요?",
                    )
                  ) {
                    setCampaignImport(null);
                    setCampaignCardMode(null);
                  }
                }}
                disabled={campaignImporting}
              >
                취소
              </button>
              <button
                type="submit"
                className="campaign-import-submit"
                disabled={
                  !campaignName.trim() ||
                  !campaignSelectionDate ||
                  !campaignBudget.budgetType.trim() ||
                  !campaignBudget.budgetGroupId ||
                  (!campaignCardMode && !campaignImportPartition.pending.length) ||
                  campaignImporting
                }
              >
                {campaignImporting
                  ? campaignCardMode
                    ? "예산카드 저장 중"
                    : "기관·위치 등록 중"
                  : campaignCardMode === "edit"
                    ? "예산카드 수정 저장"
                    : campaignCardMode === "create"
                      ? "예산카드 등록"
                  : campaignImportUsesActiveList &&
                      campaignImportPartition.pending.length === 0
                    ? "추가할 누락 기관 없음"
                    : activeCampaign &&
                      activeCampaign.budgetGroupId === campaignBudget.budgetGroupId
                    ? "누락 기관만 현재 명단에 추가"
                    : `${campaignImportPartition.pending.length}개 기관 등록`}
              </button>
            </footer>
          </form>
        </div>
      )}

      {locationBatchOpen && (
        <div className="map-location-layer" role="dialog" aria-modal="true">
          <button
            type="button"
            className="map-location-backdrop"
            aria-label="위치 일괄 편집 닫기"
            onClick={() => {
              if (!locationBatchSaving) setLocationBatchOpen(false);
            }}
          />
          <section className="map-location-dialog map-location-batch-dialog">
            <header>
              <div>
                <span className="section-kicker">BULK PLACE EDITOR</span>
                <h2>기관 위치 일괄 편집</h2>
                <p>
                  기관명은 그대로 두고 검색용 명칭을 여러 개 시도하거나 주소를
                  입력한 뒤 선택한 기관만 한 번에 저장합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLocationBatchOpen(false)}
                disabled={locationBatchSaving}
              >
                ×
              </button>
            </header>
            <div className="map-location-batch-toolbar">
              <button type="button" onClick={downloadUnmappedLocationFile}>
                미매칭 엑셀 다운로드
              </button>
              <button
                type="button"
                onClick={() => locationBatchFileRef.current?.click()}
              >
                엑셀 수정본 가져오기
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={locationBatchShowMapped}
                  onChange={(event) =>
                    setLocationBatchShowMapped(event.target.checked)
                  }
                />
                등록 위치도 함께 보기
              </label>
              <span>
                현재 {visibleLocationBatchRows.length}곳 · 저장 선택 {selectedLocationBatchCount}곳
              </span>
            </div>
            {locationBatchMessage && (
              <p className="map-location-batch-message">{locationBatchMessage}</p>
            )}
            <div className="map-location-batch-list">
              {visibleLocationBatchRows.map((row) => {
                const hasCoordinates =
                  row.latitude.trim() !== "" && row.longitude.trim() !== "";
                return (
                  <article
                    className={`map-location-batch-row ${row.selected ? "selected" : ""}`}
                    key={row.organization}
                  >
                    <div className="map-location-batch-title">
                      <label>
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(event) =>
                            updateLocationBatchRow(row.organization, {
                              selected: event.target.checked,
                              error:
                                event.target.checked && !hasCoordinates
                                  ? "검색 결과를 선택하거나 주소를 입력해 주세요."
                                  : "",
                            })
                          }
                        />
                        <strong>{row.organization}</strong>
                      </label>
                      <span>{row.region || "지역 미등록"}</span>
                      <em className={row.mapped ? "mapped" : "unmapped"}>
                        {row.mapped ? "등록됨" : "미등록"}
                      </em>
                    </div>
                    <div className="map-location-batch-fields">
                      <label className="location-batch-search-name">
                        <span>검색 명칭 · 여러 개는 / 로 구분</span>
                        <div>
                          <input
                            value={row.searchTerms}
                            onChange={(event) =>
                              updateLocationBatchRow(row.organization, {
                                searchTerms: event.target.value,
                              })
                            }
                            placeholder="기관명 / 다른 명칭 / 지역 포함 명칭"
                          />
                          <button
                            type="button"
                            onClick={() => void searchLocationBatchRow(row, "name")}
                            disabled={row.searching}
                          >
                            {row.searching ? "검색 중" : "명칭 검색"}
                          </button>
                        </div>
                      </label>
                      <label className="location-batch-address">
                        <span>주소 직접 입력</span>
                        <div>
                          <input
                            value={row.address}
                            onChange={(event) =>
                              updateLocationBatchRow(row.organization, {
                                address: event.target.value,
                                roadAddress: event.target.value,
                              })
                            }
                            placeholder="도로명 또는 지번 주소"
                          />
                          <button
                            type="button"
                            onClick={() => void searchLocationBatchRow(row, "address")}
                            disabled={row.searching}
                          >
                            주소 검색
                          </button>
                        </div>
                      </label>
                    </div>
                    {row.error && <p className="map-location-batch-error">{row.error}</p>}
                    {row.candidates.length > 0 && (
                      <div className="map-location-batch-candidates">
                        {row.candidates.map((place) => (
                          <button
                            type="button"
                            key={`${row.organization}-${place.id}`}
                            onClick={() =>
                              chooseLocationBatchCandidate(row.organization, place)
                            }
                          >
                            <strong>{place.place_name}</strong>
                            <span>{place.road_address_name || place.address_name}</span>
                            <em>이 위치 선택</em>
                          </button>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
              {!visibleLocationBatchRows.length && (
                <div className="empty-state large">
                  위치가 미등록된 기관이 없습니다. ‘등록 위치도 함께 보기’를 켜면
                  기존 위치도 수정할 수 있습니다.
                </div>
              )}
            </div>
            <footer className="map-location-batch-footer">
              <button
                type="button"
                onClick={() => setLocationBatchOpen(false)}
                disabled={locationBatchSaving}
              >
                취소
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void saveLocationBatch()}
                disabled={!selectedLocationBatchCount || locationBatchSaving}
              >
                {locationBatchSaving
                  ? "일괄 저장 중"
                  : `선택 ${selectedLocationBatchCount}곳 일괄 저장`}
              </button>
            </footer>
          </section>
        </div>
      )}

      {locatingOrganization && (
        <div className="map-location-layer" role="dialog" aria-modal="true">
          <button
            type="button"
            className="map-location-backdrop"
            aria-label="위치 검색 닫기"
            onClick={() => setLocatingOrganization(null)}
          />
          <section className="map-location-dialog">
            <header>
              <div>
                <span className="section-kicker">PLACE SEARCH</span>
                <h2>{locatingOrganization.organization} 위치 확인</h2>
                <p>
                  기관명이나 정확한 주소로 찾은 위치를 한 번 선택하면 다음부터
                  저장된 위치를 사용합니다.
                </p>
              </div>
              <button type="button" onClick={() => setLocatingOrganization(null)}>
                ×
              </button>
            </header>
            <div className="map-place-search">
              <input
                value={locationQuery}
                onChange={(event) => setLocationQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runPlaceSearch();
                }}
                placeholder="학교·기관명 또는 도로명·지번 주소"
              />
              <button type="button" onClick={() => void runPlaceSearch()}>
                검색
              </button>
            </div>
            <div className="map-place-results">
              {placeError && <p className="map-place-error">{placeError}</p>}
              {placeSearching ? (
                <div className="loading-state">
                  <i />
                  <span>카카오에서 기관 위치를 찾는 중입니다</span>
                </div>
              ) : (
                placeResults.map((place) => (
                  <button
                    type="button"
                    key={place.id}
                    onClick={() => void saveLocation(place)}
                    disabled={locationSaving}
                  >
                    <strong>{place.place_name}</strong>
                    <span>{place.road_address_name || place.address_name}</span>
                    {place.road_address_name && (
                      <small>지번 {place.address_name}</small>
                    )}
                    <em>{locationSaving ? "저장 중" : "이 위치 선택"}</em>
                  </button>
                ))
              )}
              {!placeSearching && !placeResults.length && (
                <div className="empty-state large">
                  카카오에서 위치를 찾지 못했습니다. 주소는 위치 미등록 상태로
                  유지됩니다.
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      <JointProjectModal
        open={jointProjectOpen}
        candidates={selectedBudgetJointCandidates}
        availableSponsors={jointProjectSponsorOptions}
        campaignId={activeCampaign?.id ?? null}
        budgetGroupId={activeCampaign?.budgetGroupId ?? null}
        budgetType={activeCampaign?.budgetType ?? ""}
        initialProjectYear={
          Number(activeCampaign?.selectionDate.slice(0, 4)) ||
          new Date().getFullYear()
        }
        onClose={() => setJointProjectOpen(false)}
        onSaved={async () => {
          setBudgetSelectedTargetIds([]);
          await Promise.all([loadCampaigns(), onRecordsChanged()]);
          setNotice("공동사업 관계를 연결했습니다. 선정기관 수와 기존 기록은 그대로 유지됩니다.");
        }}
      />

      {notice && (
        <div className="toast">
          <span>✓</span>
          {notice}
        </div>
      )}
    </section>
  );
}
