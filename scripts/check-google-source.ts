import { env } from "@/lib/env";
import { parseMarketingPlanCsv } from "@/services/marketing-plan-parser";

async function main() {
  const response = await fetch(env.googleMarketingPlanCsvUrl, {
    headers: { Accept: "text/csv" },
  });

  if (!response.ok) {
    throw new Error(`Публичный источник вернул HTTP ${response.status}.`);
  }

  const rows = parseMarketingPlanCsv(
    await response.text(),
    env.marketingPlanYear,
  );

  console.info(`Публичный источник проверен: ${rows.length} строк.`);
}

void main();
