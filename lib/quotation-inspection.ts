import type { AuthoredQuotation } from "./authored-quotations";
import { airpassEquipmentKitOutputLines } from "./airpass-equipment-kit";
import { AIRPASS_COMPANY } from "./airpass-company";

export const FIELD_SUPPORT_COMPANY = "주식회사 위즈업";
export const FIELD_INSPECTION_NOTICE = "본 확인서는 현장의 제품 작동 및 수량 확인을 위한 자료이며, 계약상 공식 검사·검수 완료나 하자 책임의 확정을 의미하지 않습니다.";

export type FieldInspectionProductLine = {
  name: string;
  specification: string;
  quantity: number;
  unit: string;
};

export type FieldInspectionEquipmentLine = {
  name: string;
  quantity: number;
  unit: string;
};

type InspectionQuotation = Pick<
  AuthoredQuotation,
  "items" | "organization" | "projectTitle" | "quoteNumber" | "updatedByName"
>;

type InspectionItemSource = Pick<
  AuthoredQuotation["items"][number],
  "productId" | "name" | "specification" | "quantity" | "unit" | "equipmentKit" | "supplierVendorName" | "supplyType"
>;

function isConstructionCost(item: Pick<InspectionItemSource, "productId">) {
  return item.productId === "__construction_cost__";
}

export function fieldInspectionProductLines(quote: { items: InspectionItemSource[] }) {
  return quote.items
    .filter((item) => !isConstructionCost(item))
    .map<FieldInspectionProductLine>((item) => ({
      name: item.name,
      specification: item.specification,
      quantity: item.quantity,
      unit: item.unit || "개",
    }));
}

export function fieldInspectionEquipmentLines(quote: { items: InspectionItemSource[] }) {
  return quote.items.flatMap<FieldInspectionEquipmentLine>((item) => (
    item.equipmentKit ? airpassEquipmentKitOutputLines(item.equipmentKit).map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unit: line.unit,
    })) : []
  ));
}

export function fieldInspectionSupplierNames(quote: { items: InspectionItemSource[] }) {
  const names: string[] = [];
  const add = (value: string | undefined) => {
    const name = String(value ?? "").trim();
    if (name && !names.some((current) => current.normalize("NFKC") === name.normalize("NFKC"))) names.push(name);
  };
  quote.items.forEach((item) => {
    if (isConstructionCost(item)) return;
    if (item.equipmentKit) add(AIRPASS_COMPANY.name);
    if (item.supplierVendorName) add(item.supplierVendorName);
    else if (item.supplyType === "direct" && !item.equipmentKit) add(FIELD_SUPPORT_COMPANY);
  });
  return names.length ? names : ["공급사 미등록"];
}

export function fieldInspectionSupplierText(quote: { items: InspectionItemSource[] }) {
  return fieldInspectionSupplierNames(quote).join(" / ");
}

export function fieldInspectionVisitorName(quote: Pick<InspectionQuotation, "updatedByName">) {
  return String(quote.updatedByName ?? "").trim();
}
