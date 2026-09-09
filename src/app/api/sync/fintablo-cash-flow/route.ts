import { SyncTrigger } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  getFintabloCashFlowSyncStatus,
  synchronizeFintabloCashFlow,
} from "@/services/fintablo-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getFintabloCashFlowSyncStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Не удалось получить состояние синхронизации ДДС FinTablo.",
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const result = await synchronizeFintabloCashFlow(SyncTrigger.MANUAL);
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
            : "Синхронизация ДДС FinTablo завершилась ошибкой.",
      },
      { status: 502 },
    );
  }
}
