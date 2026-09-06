import { createHash } from "node:crypto";

import { SyncStatus, SyncTrigger } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizePayrollAggregates } from "@/services/payroll-xlsx-parser";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn(),
    payrollSyncState: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    payrollMonthly: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    syncRun: { update: vi.fn() },
  };
  const prisma = {
    dataSource: { upsert: vi.fn(), findUnique: vi.fn() },
    payrollSyncState: { upsert: vi.fn() },
    syncRun: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma, transaction };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { synchronizePayroll } from "@/services/payroll-sync";

const parsed = {
  employeeCount: 2,
  latestPeriod: { year: 2026, month: 4 },
  aggregates: [
    {
      year: 2026,
      month: 4,
      directionId: "branding" as const,
      salary: "100.00",
      vacationPay: "20.00",
      bonus: "30.00",
      salesBonus: "40.00",
    },
  ],
};

describe("synchronizePayroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.dataSource.upsert.mockResolvedValue({ id: "source-payroll" });
    mocks.prisma.payrollSyncState.upsert.mockResolvedValue({});
    mocks.prisma.syncRun.create.mockResolvedValue({ id: "run-payroll" });
    mocks.prisma.syncRun.update.mockResolvedValue({});
    mocks.transaction.$queryRaw.mockResolvedValue([{ acquired: true }]);
    mocks.transaction.payrollSyncState.findUniqueOrThrow.mockResolvedValue({
      contentHash: null,
    });
    mocks.transaction.payrollSyncState.update.mockResolvedValue({ revision: 1 });
    mocks.transaction.payrollMonthly.deleteMany.mockResolvedValue({ count: 0 });
    mocks.transaction.payrollMonthly.createMany.mockResolvedValue({ count: 1 });
    mocks.transaction.syncRun.update.mockResolvedValue({});
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof mocks.transaction) => unknown) =>
        callback(mocks.transaction),
    );
  });

  it("атомарно заменяет агрегаты при первой загрузке", async () => {
    const result = await synchronizePayroll(
      SyncTrigger.AUTOMATIC,
      vi.fn(async () => parsed),
    );

    expect(result).toMatchObject({
      status: SyncStatus.SUCCESS,
      changed: true,
      revision: 1,
      employeeCount: 2,
      rowCount: 1,
    });
    expect(mocks.transaction.payrollMonthly.deleteMany).toHaveBeenCalledOnce();
    expect(mocks.transaction.payrollMonthly.createMany).toHaveBeenCalledOnce();
    expect(mocks.transaction.payrollSyncState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revision: { increment: 1 } }),
      }),
    );
  });

  it("не заменяет строки и не повышает ревизию при прежнем хеше", async () => {
    const hash = createHash("sha256")
      .update(JSON.stringify(normalizePayrollAggregates(parsed.aggregates)))
      .digest("hex");
    mocks.transaction.payrollSyncState.findUniqueOrThrow.mockResolvedValue({
      contentHash: hash,
    });
    mocks.transaction.payrollSyncState.update.mockResolvedValue({ revision: 4 });

    const result = await synchronizePayroll(
      SyncTrigger.AUTOMATIC,
      vi.fn(async () => parsed),
    );

    expect(result.changed).toBe(false);
    expect(result.revision).toBe(4);
    expect(mocks.transaction.payrollMonthly.deleteMany).not.toHaveBeenCalled();
    expect(mocks.transaction.payrollMonthly.createMany).not.toHaveBeenCalled();
    expect(mocks.transaction.payrollSyncState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ revision: expect.anything() }),
      }),
    );
  });

  it("сохраняет старые агрегаты и русскую ошибку при сбое", async () => {
    await expect(
      synchronizePayroll(
        SyncTrigger.AUTOMATIC,
        vi.fn(async () => {
          throw new Error("Некорректная сумма в строке 7, столбце 12.");
        }),
      ),
    ).rejects.toThrow("Некорректная сумма");

    expect(mocks.transaction.payrollMonthly.deleteMany).not.toHaveBeenCalled();
    expect(mocks.prisma.syncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: SyncStatus.FAILED }),
      }),
    );
    expect(mocks.prisma.payrollSyncState.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: { lastError: "Некорректная сумма в строке 7, столбце 12." },
      }),
    );
  });

  it("пропускает параллельный запуск до чтения книги", async () => {
    mocks.transaction.$queryRaw.mockResolvedValue([{ acquired: false }]);
    const loader = vi.fn(async () => parsed);

    const result = await synchronizePayroll(SyncTrigger.AUTOMATIC, loader);

    expect(result.status).toBe(SyncStatus.SKIPPED);
    expect(loader).not.toHaveBeenCalled();
    expect(mocks.transaction.payrollMonthly.deleteMany).not.toHaveBeenCalled();
  });
});
