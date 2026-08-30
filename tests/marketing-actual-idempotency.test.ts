import { SyncStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncRun: {
    findUnique: vi.fn(),
  },
  dataSource: {
    upsert: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks,
}));

import {
  assertSnapshotRevision,
  processMarketingActualCommand,
} from "@/services/marketing-actual-webhook";

describe("идемпотентность webhook маркетингового факта", () => {
  it("не применяет повторно уже завершённое событие", async () => {
    mocks.syncRun.findUnique.mockResolvedValue({
      status: SyncStatus.SUCCESS,
      rowCount: 1,
      contentHash: "a".repeat(64),
    });

    const result = await processMarketingActualCommand(
      {
        version: 1,
        mode: "patch",
        spreadsheetId: "sheet",
        sheetName: "Факт",
        affectedRows: [],
        rows: [],
      },
      "event-1",
      new Date(),
    );

    expect(result).toMatchObject({
      duplicate: true,
      status: SyncStatus.SUCCESS,
    });
    expect(mocks.dataSource.upsert).not.toHaveBeenCalled();
  });

  it("не позволяет устаревшему снимку затереть более свежий patch", () => {
    expect(() => assertSnapshotRevision(4, 5)).toThrow(
      "Снимок устарел",
    );
    expect(() => assertSnapshotRevision(5, 5)).not.toThrow();
  });
});
