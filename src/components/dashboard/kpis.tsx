"use client";

/* eslint-disable react-hooks/set-state-in-effect -- Числа плавно переходят к новому значению после обновления данных. */

import { useEffect, useRef, useState } from "react";

import {
  formatCompactCurrency,
  formatPercentagePoints,
  formatValue,
} from "@/lib/format";
import type { KpiValue } from "@/types/dashboard";

export function KpiGrid({
  kpis,
  marketing = false,
  activeMetricKey = null,
  onMetricFocus,
}: {
  kpis: KpiValue[];
  marketing?: boolean;
  activeMetricKey?: string | null;
  onMetricFocus?: (key: string | null) => void;
}) {
  return (
    <section className="kpi-grid" aria-label="Ключевые показатели">
      {kpis.map((kpi, index) => (
        <article
          className={`kpi-card reveal focus-target${
            activeMetricKey && activeMetricKey !== kpi.key
              ? " focus-muted"
              : activeMetricKey === kpi.key
                ? " focus-active"
                : ""
          }`}
          key={kpi.key}
          style={{ animationDelay: `${index * 45}ms` }}
          tabIndex={0}
          onPointerEnter={() => onMetricFocus?.(kpi.key)}
          onPointerLeave={() => onMetricFocus?.(null)}
          onFocus={() => onMetricFocus?.(kpi.key)}
          onBlur={() => onMetricFocus?.(null)}
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
            <strong
              title={
                kpi.format === "currency"
                  ? formatValue(kpi.value, "currency")
                  : undefined
              }
            >
              <AnimatedValue value={kpi.value} format={kpi.format} />
            </strong>
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

export function AnimatedValue({
  value,
  format,
}: {
  value: number | null;
  format: KpiValue["format"];
}) {
  const [displayValue, setDisplayValue] = useState<number | null>(
    value === null ? null : 0,
  );
  const latestValue = useRef(displayValue);

  useEffect(() => {
    if (value === null) {
      latestValue.current = null;
      setDisplayValue(null);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      latestValue.current = value;
      setDisplayValue(value);
      return;
    }
    const from = latestValue.current ?? 0;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 620);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + (value - from) * eased;
      latestValue.current = next;
      setDisplayValue(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return format === "currency"
    ? formatCompactCurrency(displayValue)
    : formatValue(displayValue, format);
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
