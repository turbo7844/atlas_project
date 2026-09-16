import type { DirectionId } from "@/lib/constants";

export const PAYROLL_VALUE_FIELDS = [
  "salary",
  "vacationPay",
  "bonus",
  "salesBonus",
] as const;

export type PayrollValueField = (typeof PAYROLL_VALUE_FIELDS)[number];
export type PayrollValues = Record<PayrollValueField, string>;
export type PayrollConflictResolution = "keep" | "replace";

export interface PayrollImportDecision {
  key: string;
  fingerprint: string;
  resolution: PayrollConflictResolution;
}

export interface PayrollImportConflict {
  key: string;
  fingerprint: string;
  year: number;
  month: number;
  directionId: DirectionId;
  directionName: string;
  existing: PayrollValues;
  incoming: PayrollValues;
  changedFields: PayrollValueField[];
}

export interface PayrollImportSummary {
  periodCount: number;
  aggregateCount: number;
  employeeCount: number;
  newCount: number;
  duplicateCount: number;
  conflictCount: number;
  earliestPeriod: string | null;
  latestPeriod: string | null;
}

export interface PayrollImportConfirmation {
  status: "needs_confirmation";
  fileHash: string;
  summary: PayrollImportSummary;
  conflicts: PayrollImportConflict[];
  message: string;
}

export interface PayrollImportSuccess {
  status: "imported";
  changed: boolean;
  revision: number;
  insertedCount: number;
  updatedCount: number;
  duplicateCount: number;
  keptCount: number;
  employeeCount: number;
  aggregateCount: number;
  finishedAt: string;
  message: string;
}

export type PayrollImportResponse =
  | PayrollImportConfirmation
  | PayrollImportSuccess;
