CREATE TYPE "SyncTrigger" AS ENUM ('AUTOMATIC', 'MANUAL', 'COMMAND');
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');
CREATE TYPE "CashFlowKind" AS ENUM ('INCOME', 'EXPENSE');

CREATE TABLE "Direction" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "Direction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataSource" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SyncRun" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "trigger" "SyncTrigger" NOT NULL,
  "status" "SyncStatus" NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "rowCount" INTEGER,
  "changed" BOOLEAN,
  "contentHash" TEXT,
  "errorMessage" TEXT,
  CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingPlanSnapshot" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "rawPayload" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingPlanSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingPlanValue" (
  "snapshotId" TEXT NOT NULL,
  "directionId" TEXT NOT NULL,
  "month" INTEGER NOT NULL,
  "visits" INTEGER NOT NULL,
  "leads" INTEGER NOT NULL,
  "budget" DECIMAL(14,2) NOT NULL,
  "conversion" DECIMAL(10,6) NOT NULL,
  "cpc" DECIMAL(12,2) NOT NULL,
  "cpl" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "MarketingPlanValue_pkey" PRIMARY KEY ("snapshotId", "directionId", "month")
);

CREATE TABLE "MarketingActual" (
  "id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "directionId" TEXT NOT NULL,
  "visits" INTEGER NOT NULL,
  "leads" INTEGER NOT NULL,
  "budget" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "MarketingActual_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesMonthly" (
  "id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "directionId" TEXT NOT NULL,
  "leads" INTEGER NOT NULL,
  "meetings" INTEGER NOT NULL,
  "proposals" INTEGER NOT NULL,
  "contracts" INTEGER NOT NULL,
  "payments" INTEGER NOT NULL,
  "revenue" DECIMAL(16,2) NOT NULL,
  CONSTRAINT "SalesMonthly_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractorCost" (
  "id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "directionId" TEXT NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  CONSTRAINT "ContractorCost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashFlowEntry" (
  "id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "directionId" TEXT NOT NULL,
  "kind" "CashFlowKind" NOT NULL,
  "category" TEXT NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  CONSTRAINT "CashFlowEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Direction_name_key" ON "Direction"("name");
CREATE UNIQUE INDEX "Direction_sortOrder_key" ON "Direction"("sortOrder");
CREATE UNIQUE INDEX "DataSource_key_key" ON "DataSource"("key");
CREATE INDEX "SyncRun_sourceId_startedAt_idx" ON "SyncRun"("sourceId", "startedAt");
CREATE UNIQUE INDEX "MarketingPlanSnapshot_syncRunId_key" ON "MarketingPlanSnapshot"("syncRunId");
CREATE INDEX "MarketingPlanSnapshot_sourceId_createdAt_idx" ON "MarketingPlanSnapshot"("sourceId", "createdAt");
CREATE INDEX "MarketingPlanSnapshot_year_idx" ON "MarketingPlanSnapshot"("year");
CREATE INDEX "MarketingPlanValue_directionId_month_idx" ON "MarketingPlanValue"("directionId", "month");
CREATE UNIQUE INDEX "MarketingActual_year_month_directionId_key" ON "MarketingActual"("year", "month", "directionId");
CREATE INDEX "MarketingActual_year_month_idx" ON "MarketingActual"("year", "month");
CREATE UNIQUE INDEX "SalesMonthly_year_month_directionId_key" ON "SalesMonthly"("year", "month", "directionId");
CREATE INDEX "SalesMonthly_year_month_idx" ON "SalesMonthly"("year", "month");
CREATE UNIQUE INDEX "ContractorCost_year_month_directionId_key" ON "ContractorCost"("year", "month", "directionId");
CREATE INDEX "ContractorCost_year_month_idx" ON "ContractorCost"("year", "month");
CREATE UNIQUE INDEX "CashFlowEntry_year_month_directionId_kind_category_key" ON "CashFlowEntry"("year", "month", "directionId", "kind", "category");
CREATE INDEX "CashFlowEntry_year_month_idx" ON "CashFlowEntry"("year", "month");

ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingPlanSnapshot" ADD CONSTRAINT "MarketingPlanSnapshot_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingPlanSnapshot" ADD CONSTRAINT "MarketingPlanSnapshot_syncRunId_fkey"
  FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingPlanValue" ADD CONSTRAINT "MarketingPlanValue_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "MarketingPlanSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingPlanValue" ADD CONSTRAINT "MarketingPlanValue_directionId_fkey"
  FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingActual" ADD CONSTRAINT "MarketingActual_directionId_fkey"
  FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesMonthly" ADD CONSTRAINT "SalesMonthly_directionId_fkey"
  FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractorCost" ADD CONSTRAINT "ContractorCost_directionId_fkey"
  FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashFlowEntry" ADD CONSTRAINT "CashFlowEntry_directionId_fkey"
  FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
