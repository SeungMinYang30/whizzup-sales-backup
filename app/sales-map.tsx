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
import {
  buildOrganizationSearchQuery,
  buildOrganizationSearchQueries,
  compactMapSearchName,
  normalizeInstitutionSearchName,
} from "../lib/map-location-query";

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
};

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

let kakaoLoader: Promise<KakaoMapsApi> | null = null;

function loadKakaoMaps(javascriptKey: string) {
  if (kakaoLoader) return kakaoLoader;
  kakaoLoader = new Promise<KakaoMapsApi>((resolve, reject) => {
    let settled = false;
    let timeout = 0;
    const succeed = (maps: KakaoMapsApi) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(maps);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      kakaoLoader = null;
      reject(error);
    };
    const finish = () => {
      if (!window.kakao?.maps) {
        fail(new Error("카카오 지도 모듈을 불러오지 못했습니다."));
        return;
      }
      window.kakao.maps.load(() => succeed(window.kakao!.maps));
    };
    timeout = window.setTimeout(
      () =>
        fail(
          new Error(
            "카카오 지도 연결 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
          ),
        ),
      12_000,
    );

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
    script.onerror = () => fail(new Error("카카오 지도 연결을 확인해 주세요."));
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

async function readJsonPayload<T>(response: Response, fallback: string) {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const detail = text.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(
      !response.ok && detail
        ? detail
        : `${fallback} (응답 ${response.status})`,
    );
  }
}

async function fetchCampaignData(signal?: AbortSignal) {
  const response = await fetch("/api/map/campaigns", {
    cache: "no-store",
    signal,
  });
  const payload = await readJsonPayload<{
    campaigns?: Record<string, unknown>[];
    targets?: Record<string, unknown>[];
    members?: Record<string, unknown>[];
    error?: string;
  }>(response, "영업 카테고리 응답을 확인하지 못했습니다.");
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

function compactOrganizationName(value: string, region = "") {
  return compactMapSearchName(value, region);
}

function automaticLocationQueries(item: OrganizationSummary) {
  const organization = item.organization.trim();
  const normalizedOrganization =
    normalizeInstitutionSearchName(organization) || organization;
  const simplified = normalizedOrganization
    .replace(/\s+(?:관련.*|[가-힣]+학과|[가-힣]+학부|[가-힣]+부서)$/, "")
    .trim();
  return [
    ...buildOrganizationSearchQueries(item),
    simplified !== normalizedOrganization ? simplified : "",
  ].filter(
    (query, index, queries) =>
      query.length >= 2 && queries.indexOf(query) === index,
  );
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
  const organizationKey = compactOrganizationName(
    item.organization,
    item.region,
  );

  for (const query of automaticLocationQueries(item)) {
    const results = await searchKakaoKeyword(maps, query);
    if (!results.length) continue;
    const queryKey = compactOrganizationName(query, item.region);
    const ranked = results
      .map((place, index) => {
        const placeKey = compactOrganizationName(
          place.place_name,
          item.region,
        );
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

function currentPosition() {
  return new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 },
    );
  });
}

export default function SalesMapPage({
  records,
  isAdmin,
  search,
  onSearchChange,
  onOpenOrganization,
  onRecordsChanged,
}: {
  records: SalesMapRecord[];
  isAdmin: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenOrganization: (organization: string) => void;
  onRecordsChanged: () => Promise<void>;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapLayoutRef = useRef<HTMLDivElement | null>(null);
  const campaignFileRef = useRef<HTMLInputElement | null>(null);
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
  const [locationsFetchSucceeded, setLocationsFetchSucceeded] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkRetry, setSdkRetry] = useState(0);
  const [mapError, setMapError] = useState("");
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
  const [assignmentSaving, setAssignmentSaving] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [routeOrder, setRouteOrder] = useState<string[]>([]);
  const [routeMessage, setRouteMessage] = useState("");
  const [focusedOrganization, setFocusedOrganization] = useState("");
  const [locatingOrganization, setLocatingOrganization] =
    useState<OrganizationSummary | null>(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<KakaoPlace[]>([]);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [locationSaving, setLocationSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function loadCampaigns() {
    try {
      setCampaignLoading(true);
      const campaignData = await fetchCampaignData();
      setCampaigns(campaignData.campaigns);
      setCampaignTargets(campaignData.targets);
      setCampaignMembers(campaignData.members);
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
    const configController = new AbortController();
    const locationsController = new AbortController();
    const campaignController = new AbortController();
    const configTimeout = window.setTimeout(
      () => configController.abort(),
      15_000,
    );
    const locationsTimeout = window.setTimeout(
      () => locationsController.abort(),
      15_000,
    );
    void fetch("/api/map/config", {
      cache: "no-store",
      signal: configController.signal,
    })
      .then(async (response) => {
        const payload = await readJsonPayload<{
          javascriptKey?: string;
          error?: string;
        }>(response, "지도 설정 응답을 확인하지 못했습니다.");
        if (!response.ok) throw new Error(payload.error || "지도 설정을 확인하지 못했습니다.");
        return payload.javascriptKey ?? "";
      })
      .then((key) => {
        if (!active) return;
        setJavascriptKey(key);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setMapError(
          configController.signal.aborted
            ? "지도 설정 확인이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
            : caught instanceof Error
              ? caught.message
              : "지도 설정을 확인하지 못했습니다.",
        );
      })
      .finally(() => {
        window.clearTimeout(configTimeout);
        if (active) setConfigLoading(false);
      });
    void fetch("/api/map/locations", {
      cache: "no-store",
      signal: locationsController.signal,
    })
      .then(async (response) => {
        const payload = await readJsonPayload<{
          locations?: Record<string, unknown>[];
          error?: string;
        }>(response, "기관 위치 응답을 확인하지 못했습니다.");
        if (!response.ok) throw new Error(payload.error || "기관 위치를 불러오지 못했습니다.");
        return (payload.locations ?? []).map(normalizeLocation);
      })
      .then((nextLocations) => {
        if (!active) return;
        setLocations(nextLocations);
        setLocationsFetchSucceeded(true);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setNotice(
          locationsController.signal.aborted
            ? "기관 위치 조회가 지연되어 지도부터 표시했습니다."
            : caught instanceof Error
              ? caught.message
              : "기관 위치를 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        window.clearTimeout(locationsTimeout);
        if (active) setLocationsLoading(false);
      });
    void fetchCampaignData(campaignController.signal)
      .then((campaignData) => {
        if (!active) return;
        setCampaigns(campaignData.campaigns);
        setCampaignTargets(campaignData.targets);
        setCampaignMembers(campaignData.members);
      })
      .catch((caught: unknown) => {
        if (!active || campaignController.signal.aborted) return;
        setNotice(
          caught instanceof Error
            ? caught.message
            : "영업 카테고리를 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (active) setCampaignLoading(false);
      });
    return () => {
      active = false;
      configController.abort();
      locationsController.abort();
      campaignController.abort();
      window.clearTimeout(configTimeout);
      window.clearTimeout(locationsTimeout);
    };
  }, []);

  useEffect(() => {
    if (configLoading || !javascriptKey || !mapContainerRef.current) return;
    let active = true;
    setMapError("");
    void loadKakaoMaps(javascriptKey)
      .then((maps) => {
        if (!active || !mapContainerRef.current) return;
        sdkRef.current = maps;
        mapRef.current = new maps.Map(mapContainerRef.current, {
          center: new maps.LatLng(36.4, 127.8),
          level: 13,
        });
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
  }, [configLoading, javascriptKey, sdkRetry]);

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
      !isAdmin ||
      !sdkReady ||
      locationsLoading ||
      !locationsFetchSucceeded ||
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
  }, [
    isAdmin,
    locationsFetchSucceeded,
    locationsLoading,
    records,
    sdkReady,
  ]);

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

  const filteredOrganizations = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return eligibleOrganizations.filter((item) => {
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
        ![
          item.organization,
          item.region,
          item.awardStage,
          item.summary,
          item.location?.address ?? "",
          item.location?.roadAddress ?? "",
        ].some((value) => value.toLowerCase().includes(keyword))
      ) {
        return false;
      }
      return true;
    });
  }, [
    eligibleOrganizations,
    activeCampaignOrganizations,
    statusFilter,
    regionFilter,
    locationFilter,
    search,
  ]);

  const visibleOrganizations = useMemo(
    () =>
      eligibleOrganizations.filter((item) =>
        activeSelected.includes(item.organization),
      ),
    [eligibleOrganizations, activeSelected],
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
    setSelected([]);
    setRouteOrder([]);
    setRouteMessage("");
    setFocusedOrganization("");
    setStatusFilter("전체");
    setRegionFilter("전체 지역");
    setLocationFilter("전체 위치");
    onSearchChange("");
    changeMobileView("list");
  }

  async function handleCampaignFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const rows = await parseCampaignFile(file);
      setCampaignImport({ fileName: file.name, rows });
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

  async function geocodeCampaignRows(rows: CampaignImportRow[]) {
    const maps = sdkRef.current;
    if (!maps) return { saved: 0, unresolved: rows.length };
    let saved = 0;
    let unresolved = 0;
    for (const row of rows) {
      if (locationByOrganization.has(row.organization)) continue;
      if (!row.address) {
        unresolved += 1;
        continue;
      }
      const results = await new Promise<KakaoAddressResult[]>((resolve) => {
        const geocoder = new maps.services.Geocoder();
        geocoder.addressSearch(row.address, (found, status) => {
          resolve(status === maps.services.Status.OK ? found : []);
        });
      });
      const result = results[0];
      if (!result) {
        unresolved += 1;
        continue;
      }
      const roadAddress = result.road_address?.address_name ?? "";
      const address =
        result.address?.address_name || result.address_name || row.address;
      const response = await fetch("/api/map/locations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization: row.organization,
          region: row.region,
          address,
          roadAddress,
          latitude: Number(result.y),
          longitude: Number(result.x),
          placeName: row.organization,
          placeId: `campaign-${row.organization}`.slice(0, 100),
        }),
      });
      const payload = (await response.json()) as {
        location?: Record<string, unknown>;
        error?: string;
      };
      if (!response.ok || !payload.location) {
        unresolved += 1;
        continue;
      }
      mergeSavedLocation(normalizeLocation(payload.location));
      saved += 1;
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
      const response = await fetch("/api/map/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName.trim(),
          notes: campaignNotes.trim(),
          targets: campaignImport.rows.map((row) => ({
            ...row,
            assignedMemberId:
              memberByName.get(
                row.assignedMemberName
                  .replace(/\s+/g, "")
                  .toLocaleLowerCase("ko-KR"),
              ) ??
              memberByName.get(row.assignedMemberName.toLocaleLowerCase()) ??
              null,
          })),
        }),
      });
      const payload = (await response.json()) as {
        campaign?: Record<string, unknown>;
        targetCount?: number;
        error?: string;
      };
      if (!response.ok || !payload.campaign) {
        throw new Error(payload.error || "영업 카테고리를 등록하지 못했습니다.");
      }
      const campaign = normalizeCampaign(payload.campaign);
      await onRecordsChanged();
      await loadCampaigns();
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
      const mapped = await geocodeCampaignRows(campaignImport.rows);
      if (mapped.saved) await onRecordsChanged();
      setNotice(
        mapped.unresolved
          ? `${payload.targetCount ?? campaignImport.rows.length}개 기관을 등록하고 ${mapped.saved}곳의 위치를 찾았습니다. ${mapped.unresolved}곳은 목록에서 위치를 확인해 주세요.`
          : `${payload.targetCount ?? campaignImport.rows.length}개 기관과 지도 위치를 등록했습니다.`,
      );
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

  async function removeCampaign(campaign: SalesCampaign) {
    if (
      !window.confirm(
        `${campaign.name} 카테고리를 삭제할까요?\n기관별 관리에 추가된 기록은 그대로 유지됩니다.`,
      )
    ) {
      return;
    }
    try {
      const response = await fetch("/api/map/campaigns", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id }),
      });
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "영업 카테고리를 삭제하지 못했습니다.");
      }
      selectCampaign("all");
      await loadCampaigns();
      setNotice(payload.message || "영업 카테고리를 삭제했습니다.");
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "영업 카테고리를 삭제하지 못했습니다.",
      );
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

    const routePoints = activeRouteOrder
      .map((organization) => locationByOrganization.get(organization))
      .filter((location): location is OrganizationLocation => Boolean(location))
      .map((location) => new maps.LatLng(location.latitude, location.longitude));
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

    if (visibleMapped.length === 1) {
      const location = visibleMapped[0].location!;
      map.setCenter(new maps.LatLng(location.latitude, location.longitude));
      map.setLevel(5);
    } else if (visibleMapped.length > 1) {
      map.setBounds(bounds);
    }
  }, [
    sdkReady,
    visibleMapped,
    activeRouteOrder,
    locationByOrganization,
    mobileView,
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

  async function recommendRoute() {
    const candidates = eligibleOrganizations.filter(
      (item) => activeSelected.includes(item.organization) && item.location,
    );
    if (candidates.length < 2) {
      setRouteMessage("위치가 등록된 기관을 두 곳 이상 선택해 주세요.");
      return;
    }
    setRouteMessage("현재 위치를 확인해 방문 순서를 계산하고 있습니다.");
    const userPosition = await currentPosition();
    const remaining = [...candidates];
    const ordered: OrganizationSummary[] = [];
    let cursor =
      userPosition ??
      {
        latitude: remaining[0].location!.latitude,
        longitude: remaining[0].location!.longitude,
      };
    if (!userPosition) ordered.push(remaining.shift()!);
    while (remaining.length) {
      remaining.sort(
        (a, b) =>
          haversine(cursor, a.location!) - haversine(cursor, b.location!),
      );
      const next = remaining.shift()!;
      ordered.push(next);
      cursor = next.location!;
    }
    setRouteOrder(ordered.map((item) => item.organization));
    setRouteMessage(
      userPosition
        ? "현재 위치에서 가까운 순서로 추천했습니다."
        : "첫 번째 선택 기관을 기준으로 가까운 순서로 추천했습니다.",
    );
    changeMobileView("map");
  }

  async function runPlaceSearch(query = locationQuery) {
    const maps = sdkRef.current;
    if (!maps || !query.trim()) {
      setPlaceError("기관명이나 주소를 입력해 주세요.");
      return false;
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
        return true;
      }
      setPlaceResults([]);
      setPlaceError("검색 결과가 없습니다. 기관명 또는 정확한 주소로 다시 검색해 보세요.");
      return false;
    } catch {
      setPlaceSearching(false);
      setPlaceResults([]);
      setPlaceError("위치 검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      return false;
    }
  }

  async function runOrganizationPlaceSearch(item: OrganizationSummary) {
    for (const query of buildOrganizationSearchQueries(item)) {
      setLocationQuery(query);
      if (await runPlaceSearch(query)) return;
    }
  }

  function openLocationSearch(item: OrganizationSummary) {
    const query = buildOrganizationSearchQuery(item);
    setLocatingOrganization(item);
    setLocationQuery(query);
    setPlaceResults([]);
    setPlaceError("");
    window.setTimeout(() => void runOrganizationPlaceSearch(item), 0);
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
  const mappedCountDisplay = locationsLoading
    ? "…"
    : locationsFetchSucceeded
      ? mappedCount
      : "확인 실패";
  const mappedCountDescription = locationsLoading
    ? "저장된 위치를 불러오는 중"
    : locationsFetchSucceeded
      ? `전체 ${eligibleOrganizations.length}개 기관`
      : "저장된 위치 조회 실패";
  const unmappedCount = eligibleOrganizations.length - mappedCount;
  const showingUnmappedList =
    locationFilter === "위치 미등록" &&
    statusFilter === "전체" &&
    regionFilter === "전체 지역" &&
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
        {isAdmin ? (
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
          <strong>{mappedCountDisplay}</strong>
          <small>{mappedCountDescription}</small>
        </div>
        <div className="map-summary-progress">
          <span>진행 중</span>
          <strong>{counts["진행 중"]}</strong>
          <small>계약·설치·일정 조율</small>
        </div>
        <div className="map-summary-complete">
          <span>완료 실적</span>
          <strong>{counts["완료"]}</strong>
          <small>완공</small>
        </div>
        <div className="map-summary-selected">
          <span>동선 선택</span>
          <strong>{activeSelected.length}</strong>
          <small>위치 확인 {selectedMappedCount}곳</small>
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
            <button type="button" onClick={downloadCampaignTemplate}>
              엑셀 양식 다운로드
            </button>
            {isAdmin && (
              <button
                type="button"
                className="campaign-import-button"
                onClick={() => campaignFileRef.current?.click()}
              >
                엑셀 가져오기
              </button>
            )}
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
            {isAdmin && (
              <button
                type="button"
                onClick={() => void removeCampaign(activeCampaign)}
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
              onClick={() => setStatusFilter(status)}
            >
              {status}
              {status !== "전체" && <span>{counts[status]}</span>}
            </button>
          ))}
        </div>
        <div className="map-toolbar-actions">
          {isAdmin && (
            <button
              type="button"
              className={`auto-locate ${showingUnmappedList ? "active" : ""}`}
              aria-pressed={showingUnmappedList}
              onClick={() => {
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
          )}
        </div>
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
          목록·동선 <span>{activeSelected.length}</span>
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
                placeholder="학교·기관·주소 검색"
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
                  }}
                  disabled={!activeSelected.length}
                >
                  선택 해제
                </button>
                <button
                  type="button"
                  className="route-recommend"
                  onClick={() => void recommendRoute()}
                  disabled={selectedMappedCount < 2}
                >
                  방문 순서 추천
                </button>
              </div>
              {routeMessage && <p>{routeMessage}</p>}
              {activeRouteOrder.length > 0 && (
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
                      </small>
                    </span>
                  </button>
                  <span className={`map-row-status status-${item.status.replaceAll(" ", "-")}`}>
                    {item.status}
                  </span>
                  {isAdmin && (
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
          {sdkReady && !mapError && !activeSelected.length && (
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
                  kakaoLoader = null;
                  setMapError("");
                  setSdkReady(false);
                  setSdkRetry((current) => current + 1);
                }}
              >
                다시 시도
              </button>
              {isAdmin && (
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
            className="campaign-import-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              void importCampaign();
            }}
          >
            <header>
              <div>
                <span className="section-kicker">EXCEL IMPORT</span>
                <h2>영업 카테고리 만들기</h2>
                <p>
                  {campaignImport.fileName} · 기관 {campaignImport.rows.length}곳
                </p>
              </div>
              <button
                type="button"
                aria-label="엑셀 가져오기 닫기"
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
              등록하면 모든 기관이 <strong>기관별 관리</strong>에도 자동 추가되고,
              주소가 있는 기관은 카카오 지도에서 위치를 자동으로 찾습니다.
            </div>
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
                disabled={!campaignName.trim() || campaignImporting}
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
                  검색어를 확인한 뒤 다시 검색해 주세요.
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
