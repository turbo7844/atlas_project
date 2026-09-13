import { SyncTrigger } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  getBitrixSalesSyncStatus,
  synchronizeBitrixSales,
} from "@/services/bitrix24-sales-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getBitrixSalesSyncStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось получить состояние синхронизации Bitrix24." },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const result = await synchronizeBitrixSales(SyncTrigger.MANUAL);
    return NextResponse.json(result, {
      status: result.status === "SKIPPED" ? 202 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Синхронизация Bitrix24 завершилась ошибкой.",
      },
      { status: 502 },
    );
  }
}

