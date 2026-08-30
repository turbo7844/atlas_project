ALTER TYPE "SyncTrigger" ADD VALUE 'WEBHOOK';

CREATE TYPE "MarketingActualSyncMode" AS ENUM (
  'PATCH',
  'SNAPSHOT_OFFER',
  'SNAPSHOT_CHUNK',
  'SNAPSHOT_COMMIT'
);

CREATE TYPE "MarketingActualSnapshotStatus" AS ENUM (
  'OFFERED',
  'COMMITTED',
  'REJECTED'
);

ALTER TABLE "SyncRun"
  ADD COLUMN "externalEventId" TEXT,
  ADD COLUMN "syncMode" "MarketingActualSyncMode";

CREATE UNIQUE INDEX "SyncRun_externalEventId_key"
  ON "SyncRun"("externalEventId");

-- До этой миграции MarketingActual заполнялся только демонстрационным seed.
DELETE FROM "MarketingActual";

DROP INDEX "MarketingActual_year_month_directionId_key";
DROP INDEX "MarketingActual_year_month_idx";

ALTER TABLE "MarketingActual"
  DROP COLUMN "year",
  DROP COLUMN "month",
  ADD COLUMN "date" DATE NOT NULL,
  ADD COLUMN "spreadsheetId" TEXT NOT NULL,
  ADD COLUMN "sheetName" TEXT NOT NULL,
  ADD COLUMN "sourceRow" INTEGER NOT NULL,
  ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "MarketingActual_date_directionId_key"
  ON "MarketingActual"("date", "directionId");
CREATE UNIQUE INDEX "MarketingActual_spreadsheetId_sheetName_sourceRow_key"
  ON "MarketingActual"("spreadsheetId", "sheetName", "sourceRow");
CREATE INDEX "MarketingActual_date_idx" ON "MarketingActual"("date");
CREATE INDEX "MarketingActual_spreadsheetId_sheetName_idx"
  ON "MarketingActual"("spreadsheetId", "sheetName");

CREATE TABLE "MarketingActualSyncState" (
  "id" TEXT NOT NULL,
  "spreadsheetId" TEXT NOT NULL,
  "sheetName" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "contentHash" TEXT,
  "lastSuccessAt" TIMESTAMP(3),
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "maxDate" DATE,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingActualSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingActualSyncState_spreadsheetId_sheetName_key"
  ON "MarketingActualSyncState"("spreadsheetId", "sheetName");

CREATE TABLE "MarketingActualSnapshotSession" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "stateId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "chunkCount" INTEGER NOT NULL,
  "headers" JSONB NOT NULL,
  "baseRevision" INTEGER NOT NULL,
  "status" "MarketingActualSnapshotStatus" NOT NULL DEFAULT 'OFFERED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "committedAt" TIMESTAMP(3),
  CONSTRAINT "MarketingActualSnapshotSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingActualSnapshotSession_snapshotId_key"
  ON "MarketingActualSnapshotSession"("snapshotId");
CREATE INDEX "MarketingActualSnapshotSession_stateId_createdAt_idx"
  ON "MarketingActualSnapshotSession"("stateId", "createdAt");
CREATE INDEX "MarketingActualSnapshotSession_status_expiresAt_idx"
  ON "MarketingActualSnapshotSession"("status", "expiresAt");

CREATE TABLE "MarketingActualSnapshotChunk" (
  "sessionId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingActualSnapshotChunk_pkey" PRIMARY KEY ("sessionId", "chunkIndex")
);

ALTER TABLE "MarketingActualSnapshotSession"
  ADD CONSTRAINT "MarketingActualSnapshotSession_stateId_fkey"
  FOREIGN KEY ("stateId") REFERENCES "MarketingActualSyncState"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketingActualSnapshotChunk"
  ADD CONSTRAINT "MarketingActualSnapshotChunk_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "MarketingActualSnapshotSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
