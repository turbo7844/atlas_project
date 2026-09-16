import { NextResponse } from "next/server";

import {
  isDashboardSection,
  parseDashboardQuery,
} from "@/lib/dashboard-query";
import {
  buildDashboardWorkbook,
  dashboardExportFilename,
} from "@/services/dashboard-xlsx-export";
import { getDashboard } from "@/services/dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ section: string }> },
) {
  try {
    const { section } = await context.params;
    if (!isDashboardSection(section) || section === "dashboards") {
      return NextResponse.json(
        { error: "Для этого раздела экспорт таблицы недоступен." },
        { status: 404 },
      );
    }

    const query = parseDashboardQuery(
      new URL(request.url).searchParams,
      section,
    );
    const dashboard = await getDashboard(section, query);
    const workbook = buildDashboardWorkbook(section, dashboard);
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = dashboardExportFilename(
      section,
      dashboard.meta.from,
      dashboard.meta.to,
    );

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось сформировать Excel-файл.",
      },
      { status: 400 },
    );
  }
}
