import { createHash } from "node:crypto";

import { SyncStatus, SyncTrigger } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn(),
    marketingPlanSnapshot: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    syncRun: {
      update: vi.fn(),
    },
  };
  const prisma = {
    dataSource: {
      upsert: vi.fn(),
    },
    syncRun: {
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { prisma, transaction };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

const parsedRows = Array.from({ length: 60 }, (_, index) => ({
  year: 2026,
  month: Math.floor(index / 5) + 1,
  directionId: "branding" as const,
  visits: 1_000,
  leads: 25,
  budget: 100_000,
  conversion: 0.025,
  cpc: 100,
  cpl: 4_000,
}));
const normalizedRows = [{ source: "stable-plan" }];

vi.mock("@/services/marketing-plan-parser", () => ({
  parseMarketingPlanCsv: vi.fn(() => parsedRows),
  normalizePlanRows: vi.fn(() => normalizedRows),
}));

import { synchronizeMarketingPlan } from "@/services/marketing-plan-sync";

const connector = {
  key: "google-marketing-plan",
  load: vi.fn(async () => ({ raw: "csv", receivedAt: new Date() })),
};

describe("synchronizeMarketingPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.dataSource.upsert.mockResolvedValue({
      id: "source-1",
    });
    mocks.prisma.syncRun.create.mockResolvedValue({
      id: "run-1",
    });
    mocks.prisma.syncRun.update.mockResolvedValue({});
    mocks.transaction.$queryRaw.mockResolvedValue([{ acquired: true }]);
    mocks.transaction.marketingPlanSnapshot.findFirst.mockResolvedValue(null);
    mocks.transaction.marketingPlanSnapshot.create.mockResolvedValue({});
    mocks.transaction.syncRun.update.mockResolvedValue({});
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof mocks.transaction) => unknown) =>
        callback(mocks.transaction),
    );
    connector.load.mockResolvedValue({
      raw: "csv",
      receivedAt: new Date(),
    });
  });

  it("создаёт новый снимок при изменившемся содержимом", async () => {
    const result = await synchronizeMarketingPlan(
      SyncTrigger.MANUAL,
      connector,
    );

    expect(result.status).toBe(SyncStatus.SUCCESS);
    expect(result.changed).toBe(true);
    expect(result.rowCount).toBe(60);
    expect(
      mocks.transaction.marketingPlanSnapshot.create,
    ).toHaveBeenCalledOnce();
    expect(mocks.transaction.syncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SyncStatus.SUCCESS,
          changed: true,
        }),
      }),
    );
  });

  it("не создаёт лишнюю версию при том же хеше", async () => {
    const expectedHash = createHash("sha256")
      .update(JSON.stringify(normalizedRows))
      .digest("hex");
    mocks.transaction.marketingPlanSnapshot.findFirst.mockResolvedValue({
      contentHash: expectedHash,
    });

    const result = await synchronizeMarketingPlan(
      SyncTrigger.AUTOMATIC,
      connector,
    );

    expect(result.changed).toBe(false);
    expect(
      mocks.transaction.marketingPlanSnapshot.create,
    ).not.toHaveBeenCalled();
  });

  it("пропускает параллельный запуск до загрузки источника", async () => {
    mocks.transaction.$queryRaw.mockResolvedValue([{ acquired: false }]);

    const result = await synchronizeMarketingPlan(
      SyncTrigger.MANUAL,
      connector,
    );

    expect(result.status).toBe(SyncStatus.SKIPPED);
    expect(connector.load).not.toHaveBeenCalled();
    expect(
      mocks.transaction.marketingPlanSnapshot.create,
    ).not.toHaveBeenCalled();
  });

  it("фиксирует ошибку и не заменяет успешный снимок", async () => {
    connector.load.mockRejectedValue(new Error("Источник недоступен."));

    await expect(
      synchronizeMarketingPlan(SyncTrigger.AUTOMATIC, connector),
    ).rejects.toThrow("Источник недоступен.");
    expect(mocks.prisma.syncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SyncStatus.FAILED,
          changed: false,
        }),
      }),
    );
    expect(
      mocks.transaction.marketingPlanSnapshot.create,
    ).not.toHaveBeenCalled();
  });
});
