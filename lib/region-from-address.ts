const provinceAliases: Record<string, string> = {
  서울특별시: "서울",
  서울: "서울",
  부산광역시: "부산",
  부산: "부산",
  대구광역시: "대구",
  대구: "대구",
  인천광역시: "인천",
  인천: "인천",
  광주광역시: "광주",
  광주: "광주",
  대전광역시: "대전",
  대전: "대전",
  울산광역시: "울산",
  울산: "울산",
  세종특별자치시: "세종",
  세종시: "세종",
  세종: "세종",
  경기도: "경기",
  경기: "경기",
  강원특별자치도: "강원",
  강원도: "강원",
  강원: "강원",
  충청북도: "충북",
  충북: "충북",
  충청남도: "충남",
  충남: "충남",
  전북특별자치도: "전북",
  전라북도: "전북",
  전북: "전북",
  전라남도: "전남",
  전남: "전남",
  경상북도: "경북",
  경북: "경북",
  경상남도: "경남",
  경남: "경남",
  제주특별자치도: "제주",
  제주도: "제주",
  제주: "제주",
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function regionFromAddress(value: unknown) {
  const address = cleanText(value);
  if (!address) return "";

  const parts = address
    .replaceAll(",", " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const province = provinceAliases[parts[0]];
  if (!province) return "";
  if (province === "세종") return province;

  const districtPart = parts
    .slice(1)
    .find((part) => /^[가-힣]+(?:시|군|구)$/.test(part));
  if (!districtPart) return province;

  const district = districtPart.replace(/(?:시|군|구)$/, "");
  if (!district || district === province) return province;
  return `${province} ${district}`;
}
