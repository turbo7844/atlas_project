CREATE TABLE "BitrixSalesSyncState" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "contentHash" TEXT,
  "lastSuccessAt" TIMESTAMP(3),
  "dealCount" INTEGER NOT NULL DEFAULT 0,
  "funnelCount" INTEGER NOT NULL DEFAULT 0,
  "ignoredDealCount" INTEGER NOT NULL DEFAULT 0,
  "minDealDate" DATE,
  "maxDealDate" DATE,
  "maxRevenueDate" DATE,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BitrixSalesSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BitrixSalesSyncState_sourceId_key"
  ON "BitrixSalesSyncState"("sourceId");

ALTER TABLE "BitrixSalesSyncState"
  ADD CONSTRAINT "BitrixSalesSyncState_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
