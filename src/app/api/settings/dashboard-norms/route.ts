import { NextResponse } from "next/server";

import {
  getDashboardNorms,
  saveDashboardNorms,
} from "@/services/dashboard-norms";

export const dynamic = "force-dynamic";

function positiveNumber(
  payload: Record<string, unknown>,
  key: string,
  label: string,
  maximum: number,
) {
  const value = payload[key];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > maximum
  ) {
    throw new Error(`Поле «${label}» должно быть числом больше нуля.`);
  }
  return value;
}

export async function GET() {
  try {
    return NextResponse.json(await getDashboardNorms());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось загрузить нормативы.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const norms = await saveDashboardNorms({
      roas: positiveNumber(payload, "roas", "ROAS", 1_000),
      cac: positiveNumber(payload, "cac", "CAC", 1_000_000_000),
      grossProfitPerLead: positiveNumber(
        payload,
        "grossProfitPerLead",
        "Валовая прибыль на 1 лида",
        1_000_000_000,
      ),
      cashConversion: positiveNumber(
        payload,
        "cashConversion",
        "Cash Conversion",
        2,
      ),
    });
    return NextResponse.json(norms);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось сохранить нормативы.",
      },
      { status: 400 },
    );
  }
}
