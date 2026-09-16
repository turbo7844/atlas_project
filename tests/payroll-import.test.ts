import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn(),
    payrollMonthly: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
    },
    payrollSyncState: { update: vi.fn() },
    syncRun: { create: vi.fn() },
  };
  const prisma = {
    dataSource: { upsert: vi.fn() },
    payrollSyncState: { upsert: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma, transaction };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import {
  importPayrollWorkbook,
  planPayrollImport,
} from "@/services/payroll-import";
import type { PayrollAggregate } from "@/services/payroll-xlsx-parser";

function aggregate(
  overrides: Partial<PayrollAggregate> = {},
): PayrollAggregate {
  return {
    year: 2026,
    month: 4,
    directionId: "branding",
    salary: "100.00",
    vacationPay: "20.00",
    bonus: "30.00",
    salesBonus: "40.00",
    ...overrides,
  };
}

function existing(overrides: Record<string, unknown> = {}) {
  return {
    year: 2026,
    month: 4,
    directionId: "branding",
    salary: new Prisma.Decimal(100),
    vacationPay: new Prisma.Decimal(20),
    bonus: new Prisma.Decimal(30),
    salesBonus: new Prisma.Decimal(40),
    ...overrides,
  };
}

describe("импорт зарплатного XLSX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.dataSource.upsert.mockResolvedValue({ id: "payroll-source" });
    mocks.prisma.payrollSyncState.upsert.mockResolvedValue({});
    mocks.transaction.$queryRaw.mockResolvedValue([{ acquired: true }]);
    mocks.transaction.payrollMonthly.createMany.mockResolvedValue({ count: 1 });
    mocks.transaction.payrollMonthly.update.mockResolvedValue({});
    mocks.transaction.payrollSyncState.update.mockResolvedValue({ revision: 3 });
    mocks.transaction.syncRun.create.mockResolvedValue({});
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof mocks.transaction) => unknown) =>
        callback(mocks.transaction),
    );
  });

  it("отделяет новые строки, полные повторы и расхождения", () => {
    const plan = planPayrollImport(
      [
        aggregate(),
        aggregate({
          directionId: "smm",
          salary: "200.00",
          vacationPay: "0.00",
        }),
        aggregate({
          month: 5,
          directionId: "video-content",
          salary: "300.00",
        }),
      ],
      [
        existing(),
        existing({
          directionId: "smm",
          salary: new Prisma.Decimal(150),
          vacationPay: new Prisma.Decimal(0),
        }),
      ],
      7,
    );

    expect(plan.summary).toMatchObject({
      periodCount: 2,
      aggregateCount: 3,
      employeeCount: 7,
      newCount: 1,
      duplicateCount: 1,
      conflictCount: 1,
      earliestPeriod: "2026-04",
      latestPeriod: "2026-05",
    });
    expect(plan.conflicts[0]).toMatchObject({
      key: "2026-04-smm",
      directionName: "SMM",
      changedFields: ["salary"],
      existing: { salary: "150.00" },
      incoming: { salary: "200.00" },
    });
  });

  it("не делает частичных записей, пока не получены все ответы", async () => {
    mocks.transaction.payrollMonthly.findMany.mockResolvedValue([
      existing({ salary: new Prisma.Decimal(90) }),
    ]);

    const result = await importPayrollWorkbook({
      parsed: {
        aggregates: [
          aggregate(),
          aggregate({ month: 5, directionId: "smm" }),
        ],
        employeeCount: 2,
        latestPeriod: { year: 2026, month: 5 },
      },
      fileHash: "file-hash",
    });

    expect(result.status).toBe("needs_confirmation");
    expect(mocks.transaction.payrollMonthly.createMany).not.toHaveBeenCalled();
    expect(mocks.transaction.payrollMonthly.update).not.toHaveBeenCalled();
    expect(mocks.transaction.payrollSyncState.update).not.toHaveBeenCalled();
  });

  it("повторяет опрос, если сохранённые значения изменились после просмотра", async () => {
    const shown = existing({ salary: new Prisma.Decimal(90) });
    const changedLater = existing({ salary: new Prisma.Decimal(95) });
    const preview = planPayrollImport([aggregate()], [shown], 1);
    mocks.transaction.payrollMonthly.findMany.mockResolvedValue([changedLater]);

    const result = await importPayrollWorkbook({
      parsed: {
        aggregates: [aggregate()],
        employeeCount: 1,
        latestPeriod: { year: 2026, month: 4 },
      },
      fileHash: "file-hash",
      decisions: [
        {
          key: "2026-04-branding",
          fingerprint: preview.conflicts[0].fingerprint,
          resolution: "replace",
        },
      ],
    });

    expect(result).toMatchObject({
      status: "needs_confirmation",
      conflicts: [
        expect.objectContaining({
          existing: expect.objectContaining({ salary: "95.00" }),
        }),
      ],
    });
    expect(mocks.transaction.payrollMonthly.update).not.toHaveBeenCalled();
    expect(mocks.transaction.payrollSyncState.update).not.toHaveBeenCalled();
  });

  it("добавляет новые строки и заменяет только подтверждённые расхождения", async () => {
    const current = existing({ salary: new Prisma.Decimal(90) });
    const added = existing({
      month: 5,
      directionId: "smm",
      salary: new Prisma.Decimal(50),
      vacationPay: new Prisma.Decimal(0),
      bonus: new Prisma.Decimal(0),
      salesBonus: new Prisma.Decimal(0),
    });
    const replaced = existing();
    const preview = planPayrollImport(
      [
        aggregate(),
        aggregate({
          month: 5,
          directionId: "smm",
          salary: "50.00",
          vacationPay: "0.00",
          bonus: "0.00",
          salesBonus: "0.00",
        }),
      ],
      [current],
      2,
    );
    mocks.transaction.payrollMonthly.findMany
      .mockResolvedValueOnce([current])
      .mockResolvedValueOnce([replaced, added]);

    const result = await importPayrollWorkbook({
      parsed: {
        aggregates: [
          aggregate(),
          aggregate({
            month: 5,
            directionId: "smm",
            salary: "50.00",
            vacationPay: "0.00",
            bonus: "0.00",
            salesBonus: "0.00",
          }),
        ],
        employeeCount: 2,
        latestPeriod: { year: 2026, month: 5 },
      },
      fileHash: "file-hash",
      decisions: [
        {
          key: "2026-04-branding",
          fingerprint: preview.conflicts[0].fingerprint,
          resolution: "replace",
        },
      ],
    });

    expect(result).toMatchObject({
      status: "imported",
      changed: true,
      revision: 3,
      insertedCount: 1,
      updatedCount: 1,
      duplicateCount: 0,
      keptCount: 0,
    });
    expect(mocks.transaction.payrollMonthly.createMany).toHaveBeenCalledOnce();
    expect(mocks.transaction.payrollMonthly.update).toHaveBeenCalledOnce();
    expect(mocks.transaction.payrollSyncState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revision: { increment: 1 } }),
      }),
    );
  });

  it("не повышает ревизию при повторной загрузке идентичного файла", async () => {
    const row = existing();
    mocks.transaction.payrollMonthly.findMany
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([row]);

    const result = await importPayrollWorkbook({
      parsed: {
        aggregates: [aggregate()],
        employeeCount: 1,
        latestPeriod: { year: 2026, month: 4 },
      },
      fileHash: "same-file-hash",
    });

    expect(result).toMatchObject({
      status: "imported",
      changed: false,
      insertedCount: 0,
      updatedCount: 0,
      duplicateCount: 1,
    });
    expect(mocks.transaction.payrollMonthly.createMany).not.toHaveBeenCalled();
    expect(mocks.transaction.payrollMonthly.update).not.toHaveBeenCalled();
    expect(mocks.transaction.payrollSyncState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ revision: expect.anything() }),
      }),
    );
  });
});
