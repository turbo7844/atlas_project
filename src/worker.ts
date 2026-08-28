import { SyncTrigger } from "@prisma/client";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { synchronizeMarketingPlan } from "@/services/marketing-plan-sync";

let active = true;

async function run() {
  try {
    const result = await synchronizeMarketingPlan(SyncTrigger.AUTOMATIC);
    console.info(`[${result.finishedAt}] ${result.message}`);
  } catch (error) {
    console.error(
      "Автоматическая синхронизация завершилась ошибкой:",
      error instanceof Error ? error.message : error,
    );
  }
}

async function main() {
  console.info(
    `Фоновая синхронизация запущена с интервалом ${env.syncIntervalMinutes} мин.`,
  );
  await run();

  const interval = setInterval(
    () => {
      if (active) void run();
    },
    env.syncIntervalMinutes * 60_000,
  );

  const stop = async () => {
    active = false;
    clearInterval(interval);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

void main();
