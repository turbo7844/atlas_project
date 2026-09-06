import { NextResponse } from "next/server";

import { getPayrollSyncStatus } from "@/services/payroll-sync";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getPayrollSyncStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось получить состояние синхронизации ФОТ." },
      { status: 500 },
    );
  }
}
