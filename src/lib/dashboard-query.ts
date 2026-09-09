import {
  CASH_FLOW_DIRECTIONS,
  DIRECTIONS,
  type DashboardDirectionId,
  type DashboardSection,
  type Granularity,
} from "@/lib/constants";
import type { DashboardQuery } from "@/types/dashboard";

const monthPattern = /^2026-(0[1-9]|1[0-2])$/;
const sections = new Set<DashboardSection>([
  "marketing",
  "revenue",
  "cash-flow",
  "sales",
]);
const granularities = new Set<Granularity>(["month", "quarter", "year"]);
const validDirectionIds = new Set<string>(
  DIRECTIONS.map((direction) => direction.id),
);
const validCashFlowDirectionIds = new Set<string>(
  CASH_FLOW_DIRECTIONS.map((direction) => direction.id),
);

export function isDashboardSection(value: string): value is DashboardSection {
  return sections.has(value as DashboardSection);
}

export function parseDashboardQuery(
  searchParams: URLSearchParams,
  section: DashboardSection = "marketing",
): DashboardQuery {
  const from = searchParams.get("from") ?? "2026-01";
  const to = searchParams.get("to") ?? "2026-08";
  if (!monthPattern.test(from) || !monthPattern.test(to) || from > to) {
    throw new Error("Период задан неверно.");
  }

  const granularityRaw = searchParams.get("granularity") ?? "month";
  if (!granularities.has(granularityRaw as Granularity)) {
    throw new Error("Неизвестный режим группировки.");
  }

  const directionsRaw = searchParams.get("directions");
  const directionOptions =
    section === "cash-flow" ? CASH_FLOW_DIRECTIONS : DIRECTIONS;
  const sectionDirectionIds =
    section === "cash-flow"
      ? validCashFlowDirectionIds
      : validDirectionIds;
  const directions = directionsRaw !== null
    ? directionsRaw
        .split(",")
        .filter((direction): direction is DashboardDirectionId =>
          sectionDirectionIds.has(direction),
        )
    : directionOptions.map((direction) => direction.id);

  return {
    from,
    to,
    granularity: granularityRaw as Granularity,
    directions,
  };
}
