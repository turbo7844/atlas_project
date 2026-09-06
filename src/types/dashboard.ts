import type {
  DashboardSection,
  DirectionId,
  Granularity,
} from "@/lib/constants";

export type ValueFormat =
  | "currency"
  | "integer"
  | "percent"
  | "decimal";

export interface DashboardQuery {
  from: string;
  to: string;
  granularity: Granularity;
  directions: DirectionId[];
}

export interface KpiValue {
  key: string;
  label: string;
  value: number | null;
  plan?: number | null;
  delta?: number | null;
  completion?: number | null;
  format: ValueFormat;
  hint?: string;
}

export interface SeriesPoint {
  key: string;
  label: string;
  [metric: string]: string | number | null;
}

export interface DashboardMeta {
  section: DashboardSection;
  from: string;
  to: string;
  granularity: Granularity;
  directions: DirectionId[];
  actualThrough: string | null;
  planThrough: string;
  notice?: string;
  lastSyncAt?: string | null;
}

export interface MarketingRow {
  directionId: DirectionId;
  direction: string;
  planBudget: number | null;
  actualBudget: number | null;
  planVisits: number | null;
  actualVisits: number | null;
  planLeads: number | null;
  actualLeads: number | null;
  planConversion: number | null;
  actualConversion: number | null;
  planCpc: number | null;
  actualCpc: number | null;
  planCpl: number | null;
  actualCpl: number | null;
}

export interface RevenueRow {
  directionId: DirectionId;
  direction: string;
  revenue: number;
  contractorCost: number;
  payroll: number;
  payrollSalary: number;
  payrollVacationPay: number;
  payrollBonus: number;
  payrollSalesBonus: number;
  margin: number;
  contractorShare: number | null;
  overLimit: boolean;
}

export interface CashFlowRow {
  directionId: DirectionId;
  direction: string;
  income: number;
  expense: number;
  net: number;
}

export interface SalesRow {
  directionId: DirectionId;
  direction: string;
  leads: number;
  meetings: number;
  proposals: number;
  contracts: number;
  payments: number;
  revenue: number;
}

export interface DashboardResponse {
  meta: DashboardMeta;
  kpis: KpiValue[];
  series: SeriesPoint[];
  rows: MarketingRow[] | RevenueRow[] | CashFlowRow[] | SalesRow[];
  funnel?: Array<{ key: string; label: string; value: number }>;
  breakdown?: Array<{ key: string; label: string; value: number }>;
  contractorShareLimit?: number;
}
