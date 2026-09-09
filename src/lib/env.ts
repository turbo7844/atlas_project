const integer = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const decimal = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  googleMarketingPlanCsvUrl:
    process.env.GOOGLE_MARKETING_PLAN_CSV_URL ||
    "https://docs.google.com/spreadsheets/d/1ln0TpUcOkMdJkZ0ALwtEsLmaWMV7flFYs332Hu_ap2w/export?format=csv",
  marketingPlanYear: integer(process.env.MARKETING_PLAN_YEAR, 2026),
  syncIntervalMinutes: Math.max(
    1,
    integer(process.env.SYNC_INTERVAL_MINUTES, 30),
  ),
  contractorShareLimit: decimal(
    process.env.CONTRACTOR_SHARE_LIMIT,
    0.4,
  ),
  timezone: process.env.APP_TIMEZONE || "Europe/Astrakhan",
  marketingActualWebhookSecret:
    process.env.MARKETING_ACTUAL_WEBHOOK_SECRET ?? "",
  marketingActualSpreadsheetId:
    process.env.MARKETING_ACTUAL_SPREADSHEET_ID ?? "",
  marketingActualSheetName:
    process.env.MARKETING_ACTUAL_SHEET_NAME ?? "",
  payrollXlsxDirectory: process.env.PAYROLL_XLSX_DIRECTORY ?? "",
  payrollXlsxFilename: process.env.PAYROLL_XLSX_FILENAME ?? "",
  fintabloApiKey: process.env.FINTABLO_API_KEY ?? "",
  fintabloApiBaseUrl:
    process.env.FINTABLO_API_BASE_URL ?? "https://api.fintablo.ru",
  fintabloSyncIntervalMinutes: Math.max(
    1,
    integer(process.env.FINTABLO_SYNC_INTERVAL_MINUTES, 5),
  ),
};
