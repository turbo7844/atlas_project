ALTER TABLE "CashFlowEntry" RENAME TO "LegacyCashFlowEntry";
ALTER TYPE "CashFlowKind" RENAME TO "LegacyCashFlowKind";

CREATE TABLE "FintabloCategory" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "parentExternalId" TEXT,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "type" TEXT,
    "pnlType" TEXT,
    "description" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB NOT NULL,
    CONSTRAINT "FintabloCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FintabloDirection" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "parentExternalId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB NOT NULL,
    CONSTRAINT "FintabloDirection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FintabloTransaction" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "parentExternalId" TEXT,
    "categoryId" TEXT,
    "categoryExternalId" TEXT,
    "directionId" TEXT,
    "directionExternalId" TEXT,
    "moneybagExternalId" TEXT NOT NULL,
    "moneybag2ExternalId" TEXT,
    "group" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "amount2" DECIMAL(18,2),
    "description" TEXT,
    "date" DATE NOT NULL,
    "timestamp" BIGINT,
    "isPlan" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB NOT NULL,
    CONSTRAINT "FintabloTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FintabloCashFlowSyncState" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "maxDate" DATE,
    "lastRequestId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FintabloCashFlowSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FintabloCategory_sourceId_externalId_key" ON "FintabloCategory"("sourceId", "externalId");
CREATE INDEX "FintabloCategory_sourceId_group_idx" ON "FintabloCategory"("sourceId", "group");
CREATE UNIQUE INDEX "FintabloDirection_sourceId_externalId_key" ON "FintabloDirection"("sourceId", "externalId");
CREATE INDEX "FintabloDirection_sourceId_name_idx" ON "FintabloDirection"("sourceId", "name");
CREATE UNIQUE INDEX "FintabloTransaction_sourceId_externalId_key" ON "FintabloTransaction"("sourceId", "externalId");
CREATE INDEX "FintabloTransaction_sourceId_date_idx" ON "FintabloTransaction"("sourceId", "date");
CREATE INDEX "FintabloTransaction_sourceId_group_date_idx" ON "FintabloTransaction"("sourceId", "group", "date");
CREATE INDEX "FintabloTransaction_categoryId_idx" ON "FintabloTransaction"("categoryId");
CREATE INDEX "FintabloTransaction_directionId_idx" ON "FintabloTransaction"("directionId");
CREATE INDEX "FintabloTransaction_parentExternalId_idx" ON "FintabloTransaction"("parentExternalId");
CREATE UNIQUE INDEX "FintabloCashFlowSyncState_sourceId_key" ON "FintabloCashFlowSyncState"("sourceId");

ALTER TABLE "FintabloCategory" ADD CONSTRAINT "FintabloCategory_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FintabloDirection" ADD CONSTRAINT "FintabloDirection_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FintabloTransaction" ADD CONSTRAINT "FintabloTransaction_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FintabloTransaction" ADD CONSTRAINT "FintabloTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FintabloCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FintabloTransaction" ADD CONSTRAINT "FintabloTransaction_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "FintabloDirection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FintabloCashFlowSyncState" ADD CONSTRAINT "FintabloCashFlowSyncState_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
