export const DOCUMENT_RESOURCE_CATEGORIES = [
  "제안서",
  "매뉴얼",
  "계약·공문",
  "제품자료",
  "교육자료",
  "서식",
  "기타",
] as const;

export const VIDEO_RESOURCE_CATEGORIES = [
  "제품 소개·시연",
  "설치·사용법",
  "현장·납품 사례",
  "회사·홍보",
  "기타",
] as const;

export const RESOURCE_CATEGORIES = [
  ...DOCUMENT_RESOURCE_CATEGORIES,
  ...VIDEO_RESOURCE_CATEGORIES.filter(
    (category) => !(DOCUMENT_RESOURCE_CATEGORIES as readonly string[]).includes(category),
  ),
];

const videoExtensions = new Set([
  "mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "mpeg", "mpg",
]);

export function isVideoResourceFile(fileName: string, mimeType = "") {
  if (mimeType.toLowerCase().startsWith("video/")) return true;
  const extension = fileName.toLowerCase().split(".").pop() || "";
  return videoExtensions.has(extension);
}

export function isResourceCategoryForKind(category: string, isVideo: boolean) {
  const allowed = isVideo
    ? VIDEO_RESOURCE_CATEGORIES
    : DOCUMENT_RESOURCE_CATEGORIES;
  return (allowed as readonly string[]).includes(category);
}

export function resourceCategoryOrder(category: string, isVideo: boolean) {
  const categories = isVideo
    ? VIDEO_RESOURCE_CATEGORIES
    : DOCUMENT_RESOURCE_CATEGORIES;
  const index = (categories as readonly string[]).indexOf(category);
  return index < 0 ? categories.length : index;
}

export function compareResourceLibraryPosts(
  left: { category: string; title: string; id: number },
  right: { category: string; title: string; id: number },
  isVideo: boolean,
) {
  return resourceCategoryOrder(left.category, isVideo)
    - resourceCategoryOrder(right.category, isVideo)
    || left.title.localeCompare(right.title, "ko-KR", {
      numeric: true,
      sensitivity: "base",
    })
    || left.id - right.id;
}
