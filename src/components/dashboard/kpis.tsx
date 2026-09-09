"use client";

import { formatPercentagePoints, formatValue } from "@/lib/format";
import type { KpiValue } from "@/types/dashboard";

export function KpiGrid({
  kpis,
  marketing = false,
}: {
  kpis: KpiValue[];
  marketing?: boolean;
}) {
  return (
    <section className="kpi-grid" aria-label="Ключевые показатели">
      {kpis.map((kpi, index) => (
        <article
          className="kpi-card reveal"
          key={kpi.key}
          style={{ animationDelay: `${index * 45}ms` }}
        >
          <div className="kpi-heading">
            <span>{kpi.label}</span>
            {kpi.hint ? (
              <span className="info" data-tooltip={kpi.hint} tabIndex={0} aria-label={kpi.hint}>
                i
              </span>
            ) : null}
          </div>
          <div className="kpi-value-row">
            <strong>{formatValue(kpi.value, kpi.format)}</strong>
            <Delta value={kpi.delta} mode={kpi.deltaMode} />
          </div>
          <div className="kpi-foot">
            {marketing ? (
              <>
                <span>План {formatValue(kpi.plan, kpi.format)}</span>
                <span>
                  {kpi.completion === null || kpi.completion === undefined
                    ? "нет сравнения"
                    : `${formatValue(kpi.completion, "percent")} плана`}
                </span>
              </>
            ) : (
              <span>
                {kpi.delta === null || kpi.delta === undefined
                  ? "нет прошлого периода"
                  : "к прошлому периоду"}
              </span>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}

function Delta({
  value,
  mode = "relative",
}: {
  value: number | null | undefined;
  mode?: "relative" | "percentage-points";
}) {
  if (value === null || value === undefined) {
    return <span className="delta neutral">—</span>;
  }
  return (
    <span className={`delta ${value >= 0 ? "positive" : "negative"}`}>
      {value >= 0 ? "+" : "−"}
      {mode === "percentage-points"
        ? formatPercentagePoints(Math.abs(value))
        : formatValue(Math.abs(value), "percent")}
    </span>
  );
}
