import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type DashboardNormValues = {
  roas: number;
  cac: number;
  grossProfitPerLead: number;
  cashConversion: number;
  updatedAt: string | null;
};

export const DEFAULT_DASHBOARD_NORMS: DashboardNormValues = {
  roas: 12,
  cac: 42_000,
  grossProfitPerLead: 20_000,
  cashConversion: 0.9,
  updatedAt: null,
};

type StoredDashboardNorm = {
  roas: Prisma.Decimal;
  cac: Prisma.Decimal;
  grossProfitPerLead: Prisma.Decimal;
  cashConversion: Prisma.Decimal;
  updatedAt: Date;
};

function serialize(stored: StoredDashboardNorm): DashboardNormValues {
  return {
    roas: stored.roas.toNumber(),
    cac: stored.cac.toNumber(),
    grossProfitPerLead: stored.grossProfitPerLead.toNumber(),
    cashConversion: stored.cashConversion.toNumber(),
    updatedAt: stored.updatedAt.toISOString(),
  };
}

export async function getDashboardNorms(): Promise<DashboardNormValues> {
  const [stored] = await prisma.$queryRaw<StoredDashboardNorm[]>(Prisma.sql`
    SELECT
      "roas",
      "cac",
      "grossProfitPerLead",
      "cashConversion",
      "updatedAt"
    FROM "DashboardNorm"
    WHERE "id" = 'default'
    LIMIT 1
  `);
  return stored ? serialize(stored) : DEFAULT_DASHBOARD_NORMS;
}

export async function saveDashboardNorms(
  values: Omit<DashboardNormValues, "updatedAt">,
): Promise<DashboardNormValues> {
  const roas = new Prisma.Decimal(values.roas.toFixed(2));
  const cac = new Prisma.Decimal(values.cac.toFixed(2));
  const grossProfitPerLead = new Prisma.Decimal(
    values.grossProfitPerLead.toFixed(2),
  );
  const cashConversion = new Prisma.Decimal(
    values.cashConversion.toFixed(6),
  );
  const [stored] = await prisma.$queryRaw<StoredDashboardNorm[]>(Prisma.sql`
    INSERT INTO "DashboardNorm" (
      "id",
      "roas",
      "cac",
      "grossProfitPerLead",
      "cashConversion",
      "updatedAt"
    ) VALUES (
      'default',
      ${roas},
      ${cac},
      ${grossProfitPerLead},
      ${cashConversion},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("id") DO UPDATE SET
      "roas" = EXCLUDED."roas",
      "cac" = EXCLUDED."cac",
      "grossProfitPerLead" = EXCLUDED."grossProfitPerLead",
      "cashConversion" = EXCLUDED."cashConversion",
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING
      "roas",
      "cac",
      "grossProfitPerLead",
      "cashConversion",
      "updatedAt"
  `);
  if (!stored) throw new Error("Нормативы не были сохранены.");
  return serialize(stored);
}
