CREATE TABLE "DashboardNorm" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "roas" DECIMAL(8,2) NOT NULL DEFAULT 12,
    "cac" DECIMAL(16,2) NOT NULL DEFAULT 42000,
    "grossProfitPerLead" DECIMAL(16,2) NOT NULL DEFAULT 20000,
    "cashConversion" DECIMAL(8,6) NOT NULL DEFAULT 0.9,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardNorm_pkey" PRIMARY KEY ("id")
);

INSERT INTO "DashboardNorm" (
    "id",
    "roas",
    "cac",
    "grossProfitPerLead",
    "cashConversion",
    "updatedAt"
) VALUES ('default', 12, 42000, 20000, 0.9, CURRENT_TIMESTAMP);
