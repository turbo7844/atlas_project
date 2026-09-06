import { SyncTrigger } from "@prisma/client";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { synchronizeMarketingPlan } from "@/services/marketing-plan-sync";
import { synchronizePayroll } from "@/services/payroll-sync";
import { watchPayrollXlsx } from "@/services/payroll-xlsx-source";
import { createSerializedTask } from "@/services/serialized-task";

let active = true;

async function runMarketingPlan() {
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

async function runPayroll() {
  try {
    const result = await synchronizePayroll(SyncTrigger.AUTOMATIC);
    console.info(`[${result.finishedAt}] ${result.message}`);
  } catch (error) {
    console.error(
      "Автоматическая синхронизация ФОТ завершилась ошибкой:",
      error instanceof Error ? error.message : error,
    );
  }
}

async function main() {
  console.info(
    `Фоновая синхронизация запущена с интервалом ${env.syncIntervalMinutes} мин.`,
  );
  await runMarketingPlan();

  const payrollTask = createSerializedTask(runPayroll);
  await payrollTask.request();
  let stopPayrollWatch: () => void = () => undefined;
  try {
    stopPayrollWatch = watchPayrollXlsx(() => {
      if (active) void payrollTask.request();
    });
    console.info("Наблюдение за локальным XLSX с начислениями ФОТ запущено.");
  } catch (error) {
    console.error(
      "Не удалось запустить наблюдение за XLSX с начислениями ФОТ:",
      error instanceof Error ? error.message : error,
    );
  }

  const interval = setInterval(
    () => {
      if (active) void runMarketingPlan();
    },
    env.syncIntervalMinutes * 60_000,
  );

  const stop = async () => {
    active = false;
    clearInterval(interval);
    stopPayrollWatch();
    await payrollTask.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

void main();
