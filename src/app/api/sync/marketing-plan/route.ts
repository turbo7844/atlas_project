import { SyncTrigger } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  getMarketingPlanSyncStatus,
  synchronizeMarketingPlan,
} from "@/services/marketing-plan-sync";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getMarketingPlanSyncStatus());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось получить состояние синхронизации.",
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const result = await synchronizeMarketingPlan(SyncTrigger.MANUAL);
    return NextResponse.json(result, {
      status: result.status === "SKIPPED" ? 202 : 200,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Синхронизация завершилась ошибкой.",
      },
      { status: 502 },
    );
  }
}
