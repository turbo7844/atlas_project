export const DIRECTIONS = [
  { id: "branding", name: "Брендинг" },
  { id: "web-development", name: "Разработка сайтов" },
  { id: "video-content", name: "Видеоконтент" },
  { id: "smm", name: "SMM" },
  { id: "ad-campaigns", name: "Рекламные кампании" },
] as const;

export const DIRECTION_BY_SOURCE_NAME = new Map<string, DirectionId>(
  DIRECTIONS.map((direction) => [direction.name, direction.id]),
);

export const CASH_FLOW_GENERAL_DIRECTION = {
  id: "general",
  name: "Общее",
} as const;

export const CASH_FLOW_DIRECTIONS = [
  ...DIRECTIONS,
  CASH_FLOW_GENERAL_DIRECTION,
] as const;

export const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
] as const;

export type DirectionId = (typeof DIRECTIONS)[number]["id"];
export type CashFlowDirectionId =
  | DirectionId
  | typeof CASH_FLOW_GENERAL_DIRECTION.id;
export type DashboardDirectionId = CashFlowDirectionId;
export type Granularity = "month" | "quarter" | "year";
export type DashboardSection = "marketing" | "revenue" | "cash-flow" | "sales";
