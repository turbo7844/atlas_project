import { NextResponse } from "next/server";

import { getMarketingActualSyncMetadata } from "@/services/marketing-actual-webhook";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getMarketingActualSyncMetadata(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось получить состояние маркетингового факта." },
      { status: 500 },
    );
  }
}
