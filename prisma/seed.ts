import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const DIRECTIONS = [
  {
    id: "branding",
    name: "Брендинг",
    averageTicket: 420_000,
    contractorShare: 0.34,
    cpc: 96,
    conversion: 0.025,
    visits: [780, 1100, 1230, 1220, 1010, 1230, 1130, 1110],
  },
  {
    id: "web-development",
    name: "Разработка сайтов",
    averageTicket: 690_000,
    contractorShare: 0.45,
    cpc: 132,
    conversion: 0.031,
    visits: [1280, 1800, 2010, 2000, 1660, 2010, 1840, 1810],
  },
  {
    id: "video-content",
    name: "Видеоконтент",
    averageTicket: 310_000,
    contractorShare: 0.38,
    cpc: 86,
    conversion: 0.028,
    visits: [570, 800, 890, 890, 740, 890, 820, 800],
  },
  {
    id: "smm",
    name: "SMM",
    averageTicket: 240_000,
    contractorShare: 0.36,
    cpc: 71,
    conversion: 0.032,
    visits: [640, 900, 1000, 1000, 830, 1000, 920, 910],
  },
  {
    id: "ad-campaigns",
    name: "Рекламные кампании",
    averageTicket: 360_000,
    contractorShare: 0.42,
    cpc: 111,
    conversion: 0.031,
    visits: [570, 800, 890, 890, 740, 890, 820, 800],
  },
] as const;

const actualFactors = [0.91, 1.04, 0.97, 1.08, 0.93, 1.06, 1.02, 0.98];
const conversionFactors = [1.04, 0.96, 1.08, 1.01, 0.94, 1.06, 0.99, 1.03];
const seasonFactors = [0.92, 0.98, 1.04, 1.08, 0.95, 1.09, 1.03, 1.06];

function money(value: number) {
  return new Prisma.Decimal(value.toFixed(2));
}

async function seed() {
  for (const [index, direction] of DIRECTIONS.entries()) {
    await prisma.direction.upsert({
      where: { id: direction.id },
      update: { name: direction.name, sortOrder: index + 1 },
      create: {
        id: direction.id,
        name: direction.name,
        sortOrder: index + 1,
      },
    });
  }

  await prisma.dataSource.upsert({
    where: { key: "google-marketing-plan" },
    update: {
      name: "Маркетинговый план Google Sheets",
      type: "GOOGLE_SHEETS_CSV",
      enabled: true,
      syncIntervalMinutes: Number(process.env.SYNC_INTERVAL_MINUTES ?? 30),
    },
    create: {
      key: "google-marketing-plan",
      name: "Маркетинговый план Google Sheets",
      type: "GOOGLE_SHEETS_CSV",
      syncIntervalMinutes: Number(process.env.SYNC_INTERVAL_MINUTES ?? 30),
    },
  });

  await prisma.dataSource.upsert({
    where: { key: "google-marketing-actual" },
    update: {
      name: "Маркетинговый факт Google Sheets",
      type: "APPS_SCRIPT_WEBHOOK",
      enabled: true,
      syncIntervalMinutes: 1,
    },
    create: {
      key: "google-marketing-actual",
      name: "Маркетинговый факт Google Sheets",
      type: "APPS_SCRIPT_WEBHOOK",
      syncIntervalMinutes: 1,
    },
  });

  await prisma.dataSource.upsert({
    where: { key: "local-payroll-xlsx" },
    update: {
      name: "Начисления ФОТ из локального XLSX",
      type: "LOCAL_XLSX",
      enabled: true,
      syncIntervalMinutes: 1,
    },
    create: {
      key: "local-payroll-xlsx",
      name: "Начисления ФОТ из локального XLSX",
      type: "LOCAL_XLSX",
      syncIntervalMinutes: 1,
    },
  });

  const fintabloSource = await prisma.dataSource.upsert({
    where: { key: "fintablo-cash-flow" },
    update: {
      name: "Фактический ДДС FinTablo",
      type: "FINTABLO_API",
      enabled: true,
      syncIntervalMinutes: Number(
        process.env.FINTABLO_SYNC_INTERVAL_MINUTES ?? 5,
      ),
    },
    create: {
      key: "fintablo-cash-flow",
      name: "Фактический ДДС FinTablo",
      type: "FINTABLO_API",
      syncIntervalMinutes: Number(
        process.env.FINTABLO_SYNC_INTERVAL_MINUTES ?? 5,
      ),
    },
  });
  await prisma.fintabloCashFlowSyncState.upsert({
    where: { sourceId: fintabloSource.id },
    update: {},
    create: { sourceId: fintabloSource.id },
  });

  for (let month = 1; month <= 8; month += 1) {
    for (const [directionIndex, direction] of DIRECTIONS.entries()) {
      const directionDrift = 1 + (directionIndex - 2) * 0.012;
      const visits = Math.round(
        direction.visits[month - 1] *
          actualFactors[month - 1] *
          directionDrift,
      );
      const leads = Math.max(
        1,
        Math.round(
          visits *
            direction.conversion *
            conversionFactors[month - 1] *
            (1 + directionIndex * 0.006),
        ),
      );
      const meetings = Math.min(leads, Math.round(leads * (0.62 + directionIndex * 0.01)));
      const proposals = Math.min(meetings, Math.round(meetings * 0.72));
      const contracts = Math.min(proposals, Math.round(proposals * (0.49 + directionIndex * 0.012)));
      const payments = Math.min(contracts, Math.max(0, Math.round(contracts * 0.82)));
      const revenue = money(
        payments *
          direction.averageTicket *
          seasonFactors[month - 1] *
          (1 + directionIndex * 0.008),
      );
      const contractorAmount = money(
        revenue.toNumber() *
          (direction.contractorShare + ((month + directionIndex) % 3 - 1) * 0.012),
      );

      await prisma.salesMonthly.upsert({
        where: {
          year_month_directionId: {
            year: 2026,
            month,
            directionId: direction.id,
          },
        },
        update: {
          leads,
          meetings,
          proposals,
          contracts,
          payments,
          revenue,
        },
        create: {
          year: 2026,
          month,
          directionId: direction.id,
          leads,
          meetings,
          proposals,
          contracts,
          payments,
          revenue,
        },
      });

      await prisma.contractorCost.upsert({
        where: {
          year_month_directionId: {
            year: 2026,
            month,
            directionId: direction.id,
          },
        },
        update: { amount: contractorAmount },
        create: {
          year: 2026,
          month,
          directionId: direction.id,
          amount: contractorAmount,
        },
      });

    }
  }

  console.info("Демонстрационные данные Atlas подготовлены.");
}

seed()
  .catch((error) => {
    console.error("Не удалось подготовить демонстрационные данные.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
