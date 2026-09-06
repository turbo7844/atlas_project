CREATE TABLE "PayrollMonthly" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "directionId" TEXT NOT NULL,
  "salary" DECIMAL(16,2) NOT NULL,
  "vacationPay" DECIMAL(16,2) NOT NULL,
  "bonus" DECIMAL(16,2) NOT NULL,
  "salesBonus" DECIMAL(16,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollMonthly_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollMonthly_sourceId_year_month_directionId_key"
  ON "PayrollMonthly"("sourceId", "year", "month", "directionId");
CREATE INDEX "PayrollMonthly_year_month_idx"
  ON "PayrollMonthly"("year", "month");
CREATE INDEX "PayrollMonthly_directionId_year_month_idx"
  ON "PayrollMonthly"("directionId", "year", "month");

CREATE TABLE "PayrollSyncState" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "contentHash" TEXT,
  "lastSuccessAt" TIMESTAMP(3),
  "employeeCount" INTEGER NOT NULL DEFAULT 0,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "latestYear" INTEGER,
  "latestMonth" INTEGER,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollSyncState_sourceId_key"
  ON "PayrollSyncState"("sourceId");

ALTER TABLE "PayrollMonthly"
  ADD CONSTRAINT "PayrollMonthly_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollMonthly"
  ADD CONSTRAINT "PayrollMonthly_directionId_fkey"
  FOREIGN KEY ("directionId") REFERENCES "Direction"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PayrollSyncState"
  ADD CONSTRAINT "PayrollSyncState_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
