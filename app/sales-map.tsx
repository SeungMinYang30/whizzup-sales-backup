"use client";

import {
  ChangeEvent,
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
import { fetchWithInstitutionConfirmation } from "./institution-confirmation";

export type SalesMapRecord = {
  id: number;
  activityDate: string;
  region: string;
  organization: string;
  status: string;
  awardStatus: string;
  awardStage: string;
  budgetAmount: string;
  budgetType: string;
  executionType: string;
  consortiumCompany: string;
  progressManager: string;
  contactName: string;
  contactPhone: string;
  topic: string;
  summary: string;
  nextAction: string;
};

type MapStatus = "영업 중" | "진행 중" | "완료" | "타업체";

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
  lastActivityDate: string;
  status: MapStatus;
  awardStatus: string;
  awardStage: string;
  budgetAmount: string;
  budgetType: string;
  executionType: string;
  consortiumCompany: string;
  progressManager: string;
  summary: string;
  searchText: string;
  location?: OrganizationLocation;
};

type SalesCampaign = {
  id: number;
  name: string;
  notes: string;
  createdByName: string;
  targetCount: number;
  assignedCount: number;
  createdAt: string;
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
};

type CampaignMember = {
  id: number;
  displayName: string;
  email: string;
};

type CampaignImportPreview = {
  fileName: string;
  rows: CampaignImportRow[];
  source: "excel" | "pdf";
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

type RouteOrigin = {
  label: string;
  address: string;
  latitude: number;
  longitude: number;
};

type NearbyRadius = 30 | 50 | 100;

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
};

type KakaoMapInstance = {
  relayout(): void;
  setBounds(bounds: KakaoBounds): void;
  setCenter(point: KakaoLatLng): void;
  setLevel(level: number): void;
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

const completedStages = new Set(["완공"]);
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
  };
}

function normalizeCampaignTarget(
  row: Record<string, unknown>,
): SalesCampaignTarget {
  const value = (camel: string, snake: string) => row[camel] ?? row[snake] ?? "";
  const assignedMemberId = Number(
    value("assignedMemberId", "assigned_member_id"),
  );
  return {
    id: Number(row.id),
    campaignId: Number(value("campaignId", "campaign_id")),
    organization: String(row.organization ?? ""),
    region: String(row.region ?? ""),
    address: String(row.address ?? ""),
    phone: String(row.phone ?? ""),
    contactName: String(value("contactName", "contact_name")),
    notes: String(row.notes ?? ""),
    assignedMemberId: assignedMemberId || null,
    assignedMemberName: String(
      value("assignedMemberName", "assigned_member_name"),
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
    email: String(row.email ?? ""),
  };
}

function resolveMapStatus(record: SalesMapRecord | undefined): MapStatus {
  if (!record || record.awardStatus === "미정") return "영업 중";
  if (record.awardStatus === "타업체 수주") return "타업체";
  if (completedStages.has(record.awardStage)) return "완료";
  return "진행 중";
}

function formatDate(value: string) {
  if (!value) return "날짜 미정";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${year}.${month}.${day}` : value;
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

  return uniqueLocationQueries([...combined, ...organizationVariants]);
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

export default function SalesMapPage({
  active,
  records,
  isOwner,
  canManageCampaigns,
  canEditLocations,
  search,
  onSearchChange,
  onOpenOrganization,
  onRecordsChanged,
}: {
  active: boolean;
  records: SalesMapRecord[];
  isOwner: boolean;
  canManageCampaigns: boolean;
  canEditLocations: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenOrganization: (organization: string) => void;
  onRecordsChanged: () => Promise<void>;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapLayoutRef = useRef<HTMLDivElement | null>(null);
  const campaignFileRef = useRef<HTMLInputElement | null>(null);
  const campaignPdfRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const sdkRef = useRef<KakaoMapsApi | null>(null);
  const overlaysRef = useRef<KakaoOverlay[]>([]);
  const routeLineRef = useRef<KakaoPolyline | null>(null);
  const autoLocateAttemptedRef = useRef(new Set<string>());
  const autoLocateRunningRef = useRef(false);
  const eligibleOrganizationsRef = useRef<OrganizationSummary[]>([]);
  const onRecordsChangedRef = useRef(onRecordsChanged);
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
  const [regionFilter, setRegionFilter] = useState("전체 지역");
  const [locationFilter, setLocationFilter] = useState("전체 위치");
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
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
  const [campaignName, setCampaignName] = useState("");
  const [campaignNotes, setCampaignNotes] = useState("");
  const [campaignImporting, setCampaignImporting] = useState(false);
  const [campaignPdfAnalyzing, setCampaignPdfAnalyzing] = useState(false);
  const [campaignDeleteTarget, setCampaignDeleteTarget] =
    useState<SalesCampaign | null>(null);
  const [campaignDeleting, setCampaignDeleting] = useState(false);
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
  const [locatingOrganization, setLocatingOrganization] =
    useState<OrganizationSummary | null>(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<KakaoPlace[]>([]);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [locationSaving, setLocationSaving] = useState(false);
  const [notice, setNotice] = useState("");

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
    let active = true;
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
        if (active) setJavascriptKey(key);
      })
      .catch((caught: unknown) => {
        if (active) {
          setMapError(
            caught instanceof Error
              ? caught.message
              : "지도 설정을 확인하지 못했습니다.",
          );
        }
      })
      .finally(() => {
        if (active) setConfigLoading(false);
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
        if (active) setLocations(nextLocations);
      })
      .catch((caught: unknown) => {
        if (active) {
          setMapError(
            caught instanceof Error
              ? caught.message
              : "기관 위치를 불러오지 못했습니다.",
          );
        }
      })
      .finally(() => {
        if (active) setLocationsLoading(false);
      });

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
        if (!active) return;
        setCampaigns(campaignData.campaigns);
        setCampaignTargets(campaignData.targets);
        setCampaignMembers(campaignData.members);
      })
      .catch((caught: unknown) => {
        if (active) {
          setNotice(
            caught instanceof Error
              ? caught.message
              : "영업 카테고리를 불러오지 못했습니다.",
          );
        }
      })
      .finally(() => {
        if (active) setCampaignLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      configLoading ||
      !javascriptKey ||
      !mapContainerRef.current
    ) {
      return;
    }
    let active = true;
    setMapError("");
    if (mapRef.current && sdkRef.current) {
      mapRef.current.relayout();
      setSdkReady(true);
      return;
    }
    setSdkReady(false);
    void loadKakaoMaps(javascriptKey)
      .then((maps) => {
        if (!active || !mapContainerRef.current) return;
        sdkRef.current = maps;
        if (!mapRef.current) {
          mapRef.current = new maps.Map(mapContainerRef.current, {
            center: new maps.LatLng(36.4, 127.8),
            level: 13,
          });
        }
        setSdkReady(true);
      })
      .catch((caught: unknown) => {
        if (active) {
          setMapError(
            caught instanceof Error
              ? caught.message
              : "카카오 지도 연결을 확인해 주세요.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [javascriptKey, configLoading, mapLoadAttempt]);

  useEffect(() => {
    if (!active || !mapRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      mapRef.current?.relayout();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    onRecordsChangedRef.current = onRecordsChanged;
  }, [onRecordsChanged]);

  const locationByOrganization = useMemo(
    () =>
      new Map(
        locations.map((location) => [location.organization, location] as const),
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
      const current = grouped.get(record.organization) ?? [];
      current.push(record);
      grouped.set(record.organization, current);
    });
    return [...grouped.entries()]
      .map(([organization, history]) => {
        const latest = history[0];
        const award =
          history.find((record) => record.awardStatus !== "미정") ?? latest;
        const region =
          history.find((record) => record.region.trim())?.region ?? "";
        return {
          organization,
          region,
          lastActivityDate: latest.activityDate,
          status: resolveMapStatus(award),
          awardStatus: award.awardStatus,
          awardStage: award.awardStage,
          budgetAmount: award.budgetAmount,
          budgetType: award.budgetType,
          executionType: award.executionType,
          consortiumCompany: award.consortiumCompany,
          progressManager: award.progressManager,
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
            ])
            .filter(Boolean)
            .join(" "),
          location: locationByOrganization.get(organization),
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
      !canEditLocations ||
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
    autoLocateRunningRef.current = true;
    pending.forEach((item) =>
      autoLocateAttemptedRef.current.add(item.organization),
    );

    void (async () => {
      let savedCount = 0;
      for (const item of pending) {
        if (cancelled) break;
        try {
          const place = await findAutomaticOrganizationPlace(maps, item);
          if (!place || cancelled) continue;
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
          if (!response.ok || !payload.location || cancelled) continue;
          const saved = normalizeLocation(payload.location);
          setLocations((current) => [
            ...current.filter(
              (location) => location.organization !== saved.organization,
            ),
            saved,
          ]);
          savedCount += 1;
        } catch {
          continue;
        }
      }

      autoLocateRunningRef.current = false;
      if (!cancelled && savedCount) {
        await onRecordsChangedRef.current();
        setNotice(
          `${savedCount}개 기관의 위치와 지역을 자동으로 등록했습니다.`,
        );
      }
    })().catch(() => {
      autoLocateRunningRef.current = false;
    });

    return () => {
      cancelled = true;
      autoLocateRunningRef.current = false;
    };
  }, [canEditLocations, locationsLoading, records, sdkReady]);

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

  const regions = useMemo(
    () =>
      [
        ...new Set(
          eligibleOrganizations.map((item) => item.region).filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b, "ko-KR")),
    [eligibleOrganizations],
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

  const filteredOrganizations = useMemo(() => {
    const keyword = search.trim().toLowerCase();
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
      if (regionFilter !== "전체 지역" && item.region !== regionFilter) return false;
      if (locationFilter === "위치 등록" && !item.location) return false;
      if (locationFilter === "위치 미등록" && item.location) return false;
      if (
        keyword &&
        !(() => {
          const campaignTarget = activeCampaignTargetByOrganization.get(
            item.organization,
          );
          return [
            item.organization,
            item.region,
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
        })()
      ) {
        return false;
      }
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
    activeCampaignTargetByOrganization,
    nearbyDistanceByOrganization,
    nearbyOrigin,
    nearbyRadius,
    statusFilter,
    regionFilter,
    locationFilter,
    search,
  ]);

  const visibleOrganizations = useMemo(
    () =>
      nearbyOrigin && nearbyRadius
        ? filteredOrganizations
        : eligibleOrganizations.filter((item) =>
            activeSelected.includes(item.organization),
          ),
    [
      eligibleOrganizations,
      activeSelected,
      filteredOrganizations,
      nearbyOrigin,
      nearbyRadius,
    ],
  );

  const visibleMapped = useMemo(
    () => visibleOrganizations.filter((item) => item.location),
    [visibleOrganizations],
  );

  const focused = eligibleOrganizations.find(
    (item) => item.organization === focusedOrganization,
  );

  function changeMobileView(view: "map" | "list") {
    setMobileView(view);
    if (window.matchMedia("(max-width: 760px)").matches) {
      window.requestAnimationFrame(() =>
        mapLayoutRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      );
    }
  }

  function selectCampaign(campaignId: number | "all") {
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
    setRegionFilter("전체 지역");
    setLocationFilter("전체 위치");
    onSearchChange("");
    changeMobileView("list");
  }

  function clearNearbyFilter() {
    setNearbyOrigin(null);
    setNearbyRadius(null);
    setNearbyMessage("");
  }

  async function showNearbyInstalledSchools(radius: NearbyRadius) {
    if (!navigator.geolocation) {
      setNearbyMessage("이 기기에서는 현재 위치를 확인할 수 없습니다.");
      return;
    }

    const applyRadius = (origin: RouteOrigin) => {
      const count = eligibleOrganizations.filter((item) => {
        if (
          item.status !== "완료" ||
          !item.location ||
          !isSchoolOrganization(item.organization)
        ) {
          return false;
        }
        return haversine(origin, item.location) <= radius;
      }).length;

      setNearbyOrigin(origin);
      setNearbyRadius(radius);
      setNearbyMessage(
        count
          ? `내 위치에서 ${radius}km 안의 설치 완료 학교 ${count}곳을 표시합니다.`
          : `내 위치에서 ${radius}km 안에 위치가 등록된 설치 완료 학교가 없습니다.`,
      );
      setActiveCampaignId("all");
      setStatusFilter("전체");
      setRegionFilter("전체 지역");
      setLocationFilter("전체 위치");
      onSearchChange("");
      setSelected([]);
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

  async function handleCampaignFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const rows = await parseCampaignFile(file);
      setCampaignImport({ fileName: file.name, rows, source: "excel" });
      setCampaignName(
        file.name
          .replace(/\.(xlsx|csv)$/i, "")
          .replace(/^WHIZZUP[_\s-]*/i, "")
          .replace(/[_-]+/g, " ")
          .trim(),
      );
      setCampaignNotes("");
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
        notes?: string;
        rows?: CampaignImportRow[];
        error?: string;
      };
      if (!response.ok || !payload.rows?.length) {
        throw new Error(payload.error || "PDF에서 기관 목록을 찾지 못했습니다.");
      }
      setCampaignImport({
        fileName: file.name,
        rows: payload.rows,
        source: "pdf",
      });
      setCampaignName(
        payload.campaignName?.trim() ||
          file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim(),
      );
      setCampaignNotes(payload.notes?.trim() || "");
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

  function updateCampaignImportRow(
    index: number,
    key: keyof CampaignImportRow,
    value: string,
  ) {
    setCampaignImport((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row, rowIndex) =>
              rowIndex === index ? { ...row, [key]: value } : row,
            ),
          }
        : current,
    );
  }

  function removeCampaignImportRow(index: number) {
    setCampaignImport((current) =>
      current
        ? {
            ...current,
            rows: current.rows.filter((_, rowIndex) => rowIndex !== index),
          }
        : current,
    );
  }

  async function geocodeCampaignRows(rows: CampaignImportRow[]) {
    const maps = sdkRef.current;
    if (!maps) return { saved: 0, unresolved: rows.length };
    const mapSdk = maps;
    let saved = 0;
    let unresolved = 0;
    const pendingRows = rows.filter(
      (row) => !locationByOrganization.has(row.organization),
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
          const geocoder = new mapSdk.services.Geocoder();
          geocoder.addressSearch(row.address, (found, status) => {
            resolve(status === mapSdk.services.Status.OK ? found : []);
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
          const found = await searchKakaoKeyword(mapSdk, query);
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
    try {
      setCampaignImporting(true);
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
      const targetRows = campaignImport.rows.map((row) => ({
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
          ? campaignImport.rows
          : campaignImport.rows.filter((row) => row.existingOrganizations.length);
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
            targets: targetRows,
            institutionDecisions,
          },
        });
      const payload = rawPayload as {
        campaign?: Record<string, unknown>;
        targetCount?: number;
        targets?: CampaignImportRow[];
        error?: string;
      };
      if (!response.ok || !payload.campaign) {
        throw new Error(payload.error || "영업 카테고리를 등록하지 못했습니다.");
      }
      const campaign = normalizeCampaign(payload.campaign);
      const rowsToMap = payload.targets?.length
        ? payload.targets
        : campaignImport.rows;
      const targetCount = payload.targetCount ?? campaignImport.rows.length;
      setCampaignImport(null);
      setCampaignName("");
      setCampaignNotes("");
      setActiveCampaignId(campaign.id);
      setSelected([]);
      setRouteOrder([]);
      setStatusFilter("전체");
      setRegionFilter("전체 지역");
      setLocationFilter("전체 위치");
      onSearchChange("");
      changeMobileView("list");
      setCampaignImporting(false);
      setNotice(
        `${targetCount}개 기관 등록을 완료했습니다. 지도 위치는 뒤에서 자동으로 찾고 있습니다.`,
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
    if (mobileView === "map") map.relayout();
    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];
    routeLineRef.current?.setMap(null);
    routeLineRef.current = null;

    const bounds = new maps.LatLngBounds();
    visibleMapped.forEach((item) => {
      const location = item.location!;
      const position = new maps.LatLng(location.latitude, location.longitude);
      bounds.extend(position);
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = `sales-map-marker marker-${item.status.replaceAll(" ", "-")}`;
      const routeIndex = activeRouteOrder.indexOf(item.organization);
      marker.textContent = routeIndex >= 0 ? String(routeIndex + 1) : item.organization.slice(0, 1);
      marker.title = `${item.organization} · ${item.status}`;
      marker.addEventListener("click", () => setFocusedOrganization(item.organization));
      const overlay = new maps.CustomOverlay({
        position,
        content: marker,
        yAnchor: 1.2,
        zIndex: routeIndex >= 0 ? 8 : 4,
      });
      overlay.setMap(map);
      overlaysRef.current.push(overlay);
    });

    if (nearbyOrigin && nearbyRadius) {
      const nearbyPosition = new maps.LatLng(
        nearbyOrigin.latitude,
        nearbyOrigin.longitude,
      );
      bounds.extend(nearbyPosition);
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
      bounds.extend(originPosition);
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
      .map((organization) => locationByOrganization.get(organization))
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

    if (
      visibleMapped.length === 1 &&
      !routeOrigin &&
      !(nearbyOrigin && nearbyRadius)
    ) {
      const location = visibleMapped[0].location!;
      map.setCenter(new maps.LatLng(location.latitude, location.longitude));
      map.setLevel(5);
    } else if (
      visibleMapped.length > 0 ||
      (routeOrigin && activeRouteOrder.length) ||
      (nearbyOrigin && nearbyRadius)
    ) {
      map.setBounds(bounds);
    }
  }, [
    sdkReady,
    visibleMapped,
    activeRouteOrder,
    locationByOrganization,
    mobileView,
    routeOrigin,
    nearbyOrigin,
    nearbyRadius,
  ]);

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
      cursor = {
        label: next.organization,
        address:
          next.location!.roadAddress ||
          next.location!.address ||
          next.organization,
        latitude: next.location!.latitude,
        longitude: next.location!.longitude,
      };
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

  async function runPlaceSearch(query = locationQuery) {
    const maps = sdkRef.current;
    if (!maps || !query.trim()) {
      setPlaceError("기관명이나 주소를 입력해 주세요.");
      return;
    }
    const searchQuery = query.trim();
    setPlaceSearching(true);
    setPlaceResults([]);
    setPlaceError("");
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

    try {
      const [addressResults, keywordResults] = await Promise.all([
        addressSearch,
        keywordSearch,
      ]);
      const seen = new Set<string>();
      const results = [...addressResults, ...keywordResults]
        .filter((place) => {
          const key = `${place.x}:${place.y}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 10);
      setPlaceSearching(false);
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
  const showingUnmappedList =
    locationFilter === "위치 미등록" &&
    statusFilter === "전체" &&
    regionFilter === "전체 지역" &&
    !nearbyRadius &&
    !search.trim();
  const selectedMappedCount = eligibleOrganizations.filter(
    (item) => item.location && activeSelected.includes(item.organization),
  ).length;
  const focusedCampaignTarget = focused
    ? activeCampaignTargetByOrganization.get(focused.organization)
    : undefined;

  if (configLoading) {
    return (
      <section className="panel sales-map-loading">
        <span className="access-spinner" />
        <strong>영업 지도를 준비하고 있습니다</strong>
      </section>
    );
  }

  if (!javascriptKey) {
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
          <small>완공·검수·교육 완료</small>
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
            <button type="button" onClick={downloadCampaignTemplate}>
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
              setRegionFilter("전체 지역");
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
          {([30, 50, 100] as NearbyRadius[]).map((radius) => (
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
          <span>
            {nearbyRadius ? filteredOrganizations.length : activeSelected.length}
          </span>
        </button>
      </div>

      <div
        ref={mapLayoutRef}
        className={`sales-map-layout mobile-view-${mobileView}`}
      >
        <aside className="sales-map-sidebar">
          <div className="map-list-filters">
            <div className="inline-search">
              <span>⌕</span>
              <input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="기관명·담당자·주소·주제 검색"
                aria-label="지도 기관명·담당자·주소·주제 검색"
              />
            </div>
            <div>
              <select
                value={regionFilter}
                onChange={(event) => setRegionFilter(event.target.value)}
                aria-label="지도 지역 필터"
              >
                <option>전체 지역</option>
                {regions.map((region) => (
                  <option key={region}>{region}</option>
                ))}
              </select>
              <select
                value={locationFilter}
                onChange={(event) => setLocationFilter(event.target.value)}
                aria-label="지도 위치 등록 필터"
              >
                <option>전체 위치</option>
                <option>위치 등록</option>
                <option>위치 미등록</option>
              </select>
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
                  onClick={() =>
                    setSelected((current) => [
                      ...new Set([
                        ...current,
                        ...filteredOrganizations.map(
                          (item) => item.organization,
                        ),
                      ]),
                    ])
                  }
                  disabled={!filteredOrganizations.length}
                >
                  현재 목록 선택
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelected([]);
                    setRouteOrder([]);
                    setRouteMessage("");
                    setRouteStartOpen(false);
                    setRouteOrigin(null);
                  }}
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
                          )},${locationByOrganization.get(organization)!.latitude},${
                            locationByOrganization.get(organization)!.longitude
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
            {filteredOrganizations.map((item) => {
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
                    />
                    <span className="sr-only">{item.organization} 선택</span>
                  </label>
                  <button
                    type="button"
                    className="map-organization-main"
                    onClick={() => {
                      if (item.location) {
                        setFocusedOrganization(item.organization);
                        changeMobileView("map");
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
                          <option value="">미배정</option>
                          {campaignMembers.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </article>
              );
            })}
            {!filteredOrganizations.length && (
              <div className="empty-state large">조건에 맞는 기관이 없습니다.</div>
            )}
          </div>
        </aside>

        <div className="sales-map-canvas">
          <div ref={mapContainerRef} className="kakao-map-container" />
          {!sdkReady && !mapError && (
            <div className="map-canvas-message">카카오 지도를 불러오는 중입니다.</div>
          )}
          {sdkReady &&
            !mapError &&
            !activeSelected.length &&
            !(nearbyOrigin && nearbyRadius) && (
            <div className="map-selection-hint">
              <span>표시할 기관을 목록에서 체크해 주세요.</span>
              <button type="button" onClick={() => changeMobileView("list")}>
                기관 목록 열기
              </button>
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
                  <dt>현재 상태</dt>
                  <dd>{focused.awardStage || "미정"}</dd>
                </div>
                <div>
                  <dt>사업방식</dt>
                  <dd>
                    {focused.executionType || "미정"}
                    {focused.consortiumCompany
                      ? ` · ${focused.consortiumCompany}`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>금액</dt>
                  <dd>{focused.budgetAmount || "미정"}</dd>
                </div>
                <div>
                  <dt>최근 활동</dt>
                  <dd>{formatDate(focused.lastActivityDate)}</dd>
                </div>
                {focusedCampaignTarget && (
                  <>
                    <div>
                      <dt>기관 전화</dt>
                      <dd>{focusedCampaignTarget.phone || "미입력"}</dd>
                    </div>
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

      {campaignImport && (
        <div className="map-location-layer" role="dialog" aria-modal="true">
          <button
            type="button"
            className="map-location-backdrop"
            aria-label="영업 카테고리 등록 닫기"
            onClick={() => {
              if (!campaignImporting) setCampaignImport(null);
            }}
          />
          <form
            className={`campaign-import-dialog ${
              campaignImport.source === "pdf" ? "campaign-pdf-dialog" : ""
            }`}
            onSubmit={(event) => {
              event.preventDefault();
              void importCampaign();
            }}
          >
            <header>
              <div>
                <span className="section-kicker">
                  {campaignImport.source === "pdf" ? "PDF REVIEW" : "EXCEL IMPORT"}
                </span>
                <h2>
                  {campaignImport.source === "pdf"
                    ? "PDF 분석 결과 확인"
                    : "영업 카테고리 만들기"}
                </h2>
                <p>
                  {campaignImport.fileName} · 기관 {campaignImport.rows.length}곳
                </p>
              </div>
              <button
                type="button"
                aria-label="카테고리 가져오기 닫기"
                onClick={() => setCampaignImport(null)}
                disabled={campaignImporting}
              >
                ×
              </button>
            </header>
            <div className="campaign-import-fields">
              <label>
                <span>카테고리 이름</span>
                <input
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                  placeholder="예: 2026 교육청 추경 영업"
                  maxLength={120}
                  required
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
              {campaignImport.source === "pdf" ? (
                <>
                  <strong>아직 저장되지 않았습니다.</strong> 사업명과 기관별 인식
                  내용을 수정한 뒤 최종 등록해 주세요. 같은 기관은 기존 기록에
                  연결되고, 주소가 있으면 지도 위치를 자동으로 찾습니다.
                </>
              ) : (
                <>
                  등록하면 모든 기관이 <strong>기관별 관리</strong>에도 자동 추가되고,
                  주소가 있는 기관은 카카오 지도에서 위치를 자동으로 찾습니다.
                </>
              )}
            </div>
            {campaignImport.source === "pdf" ? (
              <div className="campaign-pdf-preview">
                <div className="campaign-pdf-preview-head">
                  <span>기관명</span>
                  <span>지원청·지역</span>
                  <span>학교급</span>
                  <span>지원·공급 내용</span>
                  <span>기관별 예산</span>
                  <span>기존 기관 확인</span>
                  <span>확인할 내용</span>
                  <span aria-hidden="true" />
                </div>
                {campaignImport.rows.map((row, index) => (
                  <div className="campaign-pdf-preview-row" key={`${index}-${row.organization}`}>
                    <input
                      value={row.organization}
                      onChange={(event) =>
                        updateCampaignImportRow(index, "organization", event.target.value)
                      }
                      aria-label={`${index + 1}번 기관명`}
                      required
                    />
                    <input
                      value={row.region}
                      onChange={(event) =>
                        updateCampaignImportRow(index, "region", event.target.value)
                      }
                      aria-label={`${row.organization} 지원청 또는 지역`}
                      placeholder="미입력"
                    />
                    <input
                      value={row.schoolLevel}
                      onChange={(event) =>
                        updateCampaignImportRow(index, "schoolLevel", event.target.value)
                      }
                      aria-label={`${row.organization} 학교급`}
                      placeholder="미입력"
                    />
                    <textarea
                      value={row.supplyItems}
                      onChange={(event) =>
                        updateCampaignImportRow(index, "supplyItems", event.target.value)
                      }
                      aria-label={`${row.organization} 지원 또는 공급 내용`}
                      placeholder="미입력"
                      rows={2}
                    />
                    <input
                      value={row.budgetAmount}
                      onChange={(event) =>
                        updateCampaignImportRow(index, "budgetAmount", event.target.value)
                      }
                      aria-label={`${row.organization} 기관별 예산`}
                      placeholder="미입력"
                    />
                    {row.existingOrganizations.length ? (
                      <select
                        value={row.confirmedOrganization}
                        onChange={(event) =>
                          updateCampaignImportRow(
                            index,
                            "confirmedOrganization",
                            event.target.value,
                          )
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
                    <textarea
                      className={row.reviewNote ? "needs-review" : ""}
                      value={row.reviewNote}
                      onChange={(event) =>
                        updateCampaignImportRow(index, "reviewNote", event.target.value)
                      }
                      aria-label={`${row.organization} 확인할 내용`}
                      placeholder="확인 사항 없음"
                      rows={2}
                    />
                    <button
                      type="button"
                      className="campaign-row-remove"
                      onClick={() => removeCampaignImportRow(index)}
                      aria-label={`${row.organization} 제외`}
                    >
                      제외
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="campaign-import-preview">
                <div className="campaign-preview-head">
                  <span>기관명</span>
                  <span>주소</span>
                  <span>전화번호</span>
                  <span>영업 담당자</span>
                </div>
                {campaignImport.rows.slice(0, 7).map((row) => (
                  <div
                    className="campaign-preview-row"
                    key={`${row.organization}-${row.address}`}
                  >
                    <strong>{row.organization}</strong>
                    <span>{row.address || "미입력"}</span>
                    <span>{row.phone || "미입력"}</span>
                    <span>{row.assignedMemberName || "가져온 뒤 배정"}</span>
                  </div>
                ))}
                {campaignImport.rows.length > 7 && (
                  <p>외 {campaignImport.rows.length - 7}개 기관</p>
                )}
              </div>
            )}
            <footer>
              <button
                type="button"
                onClick={() => setCampaignImport(null)}
                disabled={campaignImporting}
              >
                취소
              </button>
              <button
                type="submit"
                className="campaign-import-submit"
                disabled={
                  !campaignName.trim() ||
                  !campaignImport.rows.length ||
                  campaignImporting
                }
              >
                {campaignImporting
                  ? "기관·위치 등록 중"
                  : `${campaignImport.rows.length}개 기관 등록`}
              </button>
            </footer>
          </form>
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

      {notice && (
        <div className="toast">
          <span>✓</span>
          {notice}
        </div>
      )}
    </section>
  );
}
