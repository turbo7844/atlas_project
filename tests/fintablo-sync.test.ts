import { Prisma, SyncStatus, SyncTrigger } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hashFintabloSnapshot,
  synchronizeFintabloCashFlow,
} from "@/services/fintablo-sync";
import type { FintabloCashFlowSnapshot } from "@/services/fintablo-client";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn(),
    fintabloCashFlowSyncState: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    fintabloTransaction: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    fintabloCategory: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    fintabloDirection: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    syncRun: { update: vi.fn() },
  };
  const prisma = {
    dataSource: { upsert: vi.fn(), findUnique: vi.fn() },
    fintabloCashFlowSyncState: { upsert: vi.fn() },
    syncRun: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma, transaction };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

const snapshot: FintabloCashFlowSnapshot = {
  categories: [
    {
      externalId: "10",
      parentExternalId: null,
      name: "Продажи",
      group: "income",
      type: "operating",
      pnlType: "income",
      description: null,
      isBuiltIn: false,
      raw: { id: 10, name: "Продажи", group: "income" },
    },
  ],
  directions: [
    {
      externalId: "20",
      parentExternalId: null,
      name: "Брендинг",
      description: null,
      archived: false,
      raw: { id: 20, name: "Брендинг" },
    },
  ],
  transactions: [
    {
      externalId: "30",
      parentExternalId: null,
      categoryExternalId: "10",
      directionExternalId: "20",
      moneybagExternalId: "40",
      moneybag2ExternalId: null,
      group: "income",
      amount: new Prisma.Decimal("123.45"),
      amount2: null,
      description: "Оплата",
      date: new Date("2026-08-07T00:00:00.000Z"),
      timestamp: 1_786_060_800n,
      isPlan: false,
      raw: { id: 30, value: 123.45, customField: "сохранить" },
    },
  ],
  requestIds: ["request-1"],
  receivedAt: new Date("2026-08-08T00:00:00.000Z"),
};

describe("synchronizeFintabloCashFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.dataSource.upsert.mockResolvedValue({ id: "source-fintablo" });
    mocks.prisma.fintabloCashFlowSyncState.upsert.mockResolvedValue({});
    mocks.prisma.syncRun.create.mockResolvedValue({ id: "run-fintablo" });
    mocks.prisma.syncRun.update.mockResolvedValue({});
    mocks.transaction.$queryRaw.mockResolvedValue([{ acquired: true }]);
    mocks.transaction.fintabloCashFlowSyncState.findUniqueOrThrow.mockResolvedValue(
      { contentHash: null },
    );
    mocks.transaction.fintabloCashFlowSyncState.update.mockResolvedValue({
      revision: 1,
    });
    mocks.transaction.fintabloTransaction.deleteMany.mockResolvedValue({
      count: 0,
    });
    mocks.transaction.fintabloTransaction.createMany.mockResolvedValue({
      count: 1,
    });
    mocks.transaction.fintabloCategory.deleteMany.mockResolvedValue({
      count: 0,
    });
    mocks.transaction.fintabloCategory.createMany.mockResolvedValue({
      count: 1,
    });
    mocks.transaction.fintabloDirection.deleteMany.mockResolvedValue({
      count: 0,
    });
    mocks.transaction.fintabloDirection.createMany.mockResolvedValue({
      count: 1,
    });
    mocks.transaction.syncRun.update.mockResolvedValue({});
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (value: typeof mocks.transaction) => unknown) =>
        callback(mocks.transaction),
    );
  });

  it("атомарно заменяет первый нормализованный снимок", async () => {
    const result = await synchronizeFintabloCashFlow(
      SyncTrigger.AUTOMATIC,
      vi.fn(async () => snapshot),
    );

    expect(result).toMatchObject({
      status: SyncStatus.SUCCESS,
      changed: true,
      revision: 1,
      rowCount: 1,
    });
    expect(mocks.transaction.fintabloTransaction.deleteMany).toHaveBeenCalledOnce();
    expect(mocks.transaction.fintabloCategory.createMany).toHaveBeenCalledOnce();
    expect(mocks.transaction.fintabloDirection.createMany).toHaveBeenCalledOnce();
    expect(mocks.transaction.fintabloTransaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            categoryId: "source-fintablo:category:10",
            directionId: "source-fintablo:direction:20",
            amount: new Prisma.Decimal("123.45"),
          }),
        ],
      }),
    );
  });

  it("не заменяет строки и не повышает ревизию при прежнем хеше", async () => {
    mocks.transaction.fintabloCashFlowSyncState.findUniqueOrThrow.mockResolvedValue(
      { contentHash: hashFintabloSnapshot(snapshot) },
    );
    mocks.transaction.fintabloCashFlowSyncState.update.mockResolvedValue({
      revision: 4,
    });

    const result = await synchronizeFintabloCashFlow(
      SyncTrigger.AUTOMATIC,
      vi.fn(async () => snapshot),
    );

    expect(result.changed).toBe(false);
    expect(result.revision).toBe(4);
    expect(mocks.transaction.fintabloTransaction.deleteMany).not.toHaveBeenCalled();
    expect(mocks.transaction.fintabloTransaction.createMany).not.toHaveBeenCalled();
  });

  it("при изменении снимка удаляет исчезнувшую операцию", async () => {
    const removedTransaction = {
      ...snapshot.transactions[0],
      externalId: "31",
      amount: new Prisma.Decimal("5.00"),
      raw: { id: 31, value: 5 },
    };
    const previousSnapshot = {
      ...snapshot,
      transactions: [...snapshot.transactions, removedTransaction],
    };
    mocks.transaction.fintabloCashFlowSyncState.findUniqueOrThrow.mockResolvedValue(
      { contentHash: hashFintabloSnapshot(previousSnapshot) },
    );

    const result = await synchronizeFintabloCashFlow(
      SyncTrigger.AUTOMATIC,
      vi.fn(async () => snapshot),
    );

    expect(result.changed).toBe(true);
    expect(mocks.transaction.fintabloTransaction.deleteMany).toHaveBeenCalledOnce();
    expect(mocks.transaction.fintabloTransaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            externalId: "30",
            amount: new Prisma.Decimal("123.45"),
          }),
        ],
      }),
    );
  });

  it("сохраняет старый снимок и фиксирует русскую ошибку при сбое", async () => {
    await expect(
      synchronizeFintabloCashFlow(
        SyncTrigger.AUTOMATIC,
        vi.fn(async () => {
          throw new Error("FinTablo вернул некорректную дату.");
        }),
      ),
    ).rejects.toThrow("некорректную дату");

    expect(mocks.transaction.fintabloTransaction.deleteMany).not.toHaveBeenCalled();
    expect(mocks.prisma.syncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: SyncStatus.FAILED }),
      }),
    );
    expect(mocks.prisma.fintabloCashFlowSyncState.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          lastError: "FinTablo вернул некорректную дату.",
        }),
      }),
    );
  });

  it("пропускает параллельный запуск до обращения к FinTablo", async () => {
    mocks.transaction.$queryRaw.mockResolvedValue([{ acquired: false }]);
    const loader = vi.fn(async () => snapshot);

    const result = await synchronizeFintabloCashFlow(
      SyncTrigger.MANUAL,
      loader,
    );

    expect(result.status).toBe(SyncStatus.SKIPPED);
    expect(loader).not.toHaveBeenCalled();
    expect(mocks.transaction.fintabloTransaction.deleteMany).not.toHaveBeenCalled();
  });
});
