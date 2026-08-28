import { SyncTrigger } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { synchronizeMarketingPlan } from "@/services/marketing-plan-sync";

async function main() {
  try {
    const result = await synchronizeMarketingPlan(SyncTrigger.COMMAND);
    console.info(result.message);
    console.info(
      `Строк: ${result.rowCount}. Изменения: ${result.changed ? "да" : "нет"}.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Неизвестная ошибка синхронизации.",
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
