import { prisma } from "@/lib/prisma";
import { PAYROLL_SOURCE_KEY } from "@/lib/constants";

export async function getPayrollSyncStatus() {
  const source = await prisma.dataSource.findUnique({
    where: { key: PAYROLL_SOURCE_KEY },
    include: {
      payrollSyncState: true,
      syncRuns: { orderBy: { startedAt: "desc" }, take: 1 },
    },
  });
  const state = source?.payrollSyncState ?? null;
  const run = source?.syncRuns[0] ?? null;
  return {
    configured: true,
    status: run?.status ?? "NOT_STARTED",
    revision: state?.revision ?? 0,
    lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
    employeeCount: state?.employeeCount ?? 0,
    aggregateCount: state?.rowCount ?? 0,
    latestPeriod:
      state?.latestYear && state.latestMonth
        ? `${state.latestYear}-${String(state.latestMonth).padStart(2, "0")}`
        : null,
    error: state?.lastError ?? run?.errorMessage ?? null,
  };
}
