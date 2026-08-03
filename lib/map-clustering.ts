export type MapPoint<T> = {
  latitude: number;
  longitude: number;
  item: T;
};

export type MapPointCluster<T> = {
  key: string;
  latitude: number;
  longitude: number;
  points: MapPoint<T>[];
};

export type ProvinceMapPointCluster<T> = MapPointCluster<T> & {
  province: string;
  provinceLabel: string;
};

export type NumericMapViewport = {
  south: number;
  north: number;
  west: number;
  east: number;
  level: number;
};

export const KOREA_PROVINCES = [
  ["서울특별시", "서울"],
  ["부산광역시", "부산"],
  ["대구광역시", "대구"],
  ["인천광역시", "인천"],
  ["광주광역시", "광주"],
  ["대전광역시", "대전"],
  ["울산광역시", "울산"],
  ["세종특별자치시", "세종"],
  ["경기도", "경기"],
  ["강원특별자치도", "강원"],
  ["충청북도", "충북"],
  ["충청남도", "충남"],
  ["전북특별자치도", "전북"],
  ["전라남도", "전남"],
  ["경상북도", "경북"],
  ["경상남도", "경남"],
  ["제주특별자치도", "제주"],
] as const;

const PROVINCE_ALIASES: Array<{
  province: string;
  label: string;
  aliases: string[];
}> = [
  { province: "서울특별시", label: "서울", aliases: ["서울특별시", "서울"] },
  { province: "부산광역시", label: "부산", aliases: ["부산광역시", "부산"] },
  { province: "대구광역시", label: "대구", aliases: ["대구광역시", "대구"] },
  { province: "인천광역시", label: "인천", aliases: ["인천광역시", "인천"] },
  { province: "광주광역시", label: "광주", aliases: ["광주광역시", "광주"] },
  { province: "대전광역시", label: "대전", aliases: ["대전광역시", "대전"] },
  { province: "울산광역시", label: "울산", aliases: ["울산광역시", "울산"] },
  {
    province: "세종특별자치시",
    label: "세종",
    aliases: ["세종특별자치시", "세종시", "세종"],
  },
  { province: "경기도", label: "경기", aliases: ["경기도", "경기"] },
  {
    province: "강원특별자치도",
    label: "강원",
    aliases: ["강원특별자치도", "강원도", "강원"],
  },
  { province: "충청북도", label: "충북", aliases: ["충청북도", "충북"] },
  { province: "충청남도", label: "충남", aliases: ["충청남도", "충남"] },
  {
    province: "전북특별자치도",
    label: "전북",
    aliases: ["전북특별자치도", "전라북도", "전북"],
  },
  { province: "전라남도", label: "전남", aliases: ["전라남도", "전남"] },
  { province: "경상북도", label: "경북", aliases: ["경상북도", "경북"] },
  { province: "경상남도", label: "경남", aliases: ["경상남도", "경남"] },
  {
    province: "제주특별자치도",
    label: "제주",
    aliases: ["제주특별자치도", "제주도", "제주"],
  },
];

export function canonicalProvinceName(value: string) {
  const tokens = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  for (const token of tokens) {
    const resolved = PROVINCE_ALIASES.find(({ aliases }) =>
      aliases.some((alias) => token.startsWith(alias)),
    );
    if (resolved) return resolved;
  }
  return null;
}

export function shouldRenderProvinceClusters(
  provinceModeEnabled: boolean,
  selectedInstitutionCount: number,
) {
  return provinceModeEnabled && selectedInstitutionCount === 0;
}

export function individualMapPointClusters<T>(
  points: MapPoint<T>[],
): MapPointCluster<T>[] {
  return points.map((point, index) => ({
    key: `point-${index}-${point.latitude}-${point.longitude}`,
    latitude: point.latitude,
    longitude: point.longitude,
    points: [point],
  }));
}

export function clusterMapPointsByProvince<T>(
  points: MapPoint<T>[],
  provinceSource: (point: MapPoint<T>) => string,
): ProvinceMapPointCluster<T>[] {
  const buckets = new Map<
    string,
    {
      province: string;
      provinceLabel: string;
      latitudeTotal: number;
      longitudeTotal: number;
      points: MapPoint<T>[];
    }
  >();

  points.forEach((point) => {
    const resolved = canonicalProvinceName(provinceSource(point));
    const province = resolved?.province ?? "지역 미확인";
    const provinceLabel = resolved?.label ?? "지역 확인";
    const bucket = buckets.get(province) ?? {
      province,
      provinceLabel,
      latitudeTotal: 0,
      longitudeTotal: 0,
      points: [],
    };
    bucket.latitudeTotal += point.latitude;
    bucket.longitudeTotal += point.longitude;
    bucket.points.push(point);
    buckets.set(province, bucket);
  });

  return Array.from(buckets, ([key, bucket]) => ({
    key: `province-${key}`,
    province: bucket.province,
    provinceLabel: bucket.provinceLabel,
    latitude: bucket.latitudeTotal / bucket.points.length,
    longitude: bucket.longitudeTotal / bucket.points.length,
    points: bucket.points,
  })).sort((left, right) => {
    const leftIndex = KOREA_PROVINCES.findIndex(
      ([province]) => province === left.province,
    );
    const rightIndex = KOREA_PROVINCES.findIndex(
      ([province]) => province === right.province,
    );
    return (
      (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) -
      (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
    );
  });
}

export function pointIsInsideMapViewport(
  latitude: number,
  longitude: number,
  viewport: NumericMapViewport | null,
) {
  if (!viewport) return true;
  const latitudeVisible =
    latitude >= viewport.south && latitude <= viewport.north;
  const longitudeVisible =
    viewport.west <= viewport.east
      ? longitude >= viewport.west && longitude <= viewport.east
      : longitude >= viewport.west || longitude <= viewport.east;
  return latitudeVisible && longitudeVisible;
}

function clusterCellSize(level: number, densityMode: boolean) {
  const normalizedLevel = Math.max(level, 4);
  const base = densityMode ? 0.006 : 0.012;
  return base * 2 ** (normalizedLevel - 4);
}

/**
 * 카카오 지도 레벨을 기준으로 가까운 기관을 격자 단위로 묶습니다.
 * 충분히 확대된 일반 지도에서는 개별 기관을 그대로 돌려줍니다.
 */
export function clusterMapPoints<T>(
  points: MapPoint<T>[],
  level: number,
  densityMode = false,
): MapPointCluster<T>[] {
  if (!densityMode && level <= 4) {
    return individualMapPointClusters(points);
  }

  const cellSize = clusterCellSize(level, densityMode);
  const buckets = new Map<
    string,
    {
      latitudeTotal: number;
      longitudeTotal: number;
      points: MapPoint<T>[];
    }
  >();

  points.forEach((point) => {
    const latitudeCell = Math.floor(point.latitude / cellSize);
    const longitudeCell = Math.floor(point.longitude / cellSize);
    const key = `${latitudeCell}:${longitudeCell}`;
    const bucket = buckets.get(key) ?? {
      latitudeTotal: 0,
      longitudeTotal: 0,
      points: [],
    };
    bucket.latitudeTotal += point.latitude;
    bucket.longitudeTotal += point.longitude;
    bucket.points.push(point);
    buckets.set(key, bucket);
  });

  return Array.from(buckets, ([key, bucket]) => ({
    key,
    latitude: bucket.latitudeTotal / bucket.points.length,
    longitude: bucket.longitudeTotal / bucket.points.length,
    points: bucket.points,
  }));
}
