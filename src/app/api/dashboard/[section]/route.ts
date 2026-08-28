import { NextResponse } from "next/server";

import {
  isDashboardSection,
  parseDashboardQuery,
} from "@/lib/dashboard-query";
import { getDashboard } from "@/services/dashboard";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ section: string }> },
) {
  try {
    const { section } = await context.params;
    if (!isDashboardSection(section)) {
      return NextResponse.json(
        { error: "Раздел дашборда не найден." },
        { status: 404 },
      );
    }

    const query = parseDashboardQuery(new URL(request.url).searchParams);
    const dashboard = await getDashboard(section, query);
    return NextResponse.json(dashboard);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось загрузить данные дашборда.",
      },
      { status: 400 },
    );
  }
}
