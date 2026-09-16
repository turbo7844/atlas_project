"use client";

import type { PointerEvent } from "react";

import { formatCompactCurrency, formatValue } from "@/lib/format";
import type { SeriesPoint, ValueFormat } from "@/types/dashboard";

const palette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

export interface ChartInteractionProps {
  activePointIndex?: number | null;
  activeMetricKey?: string | null;
  lockCursor?: boolean;
  onPointChange?: (index: number | null) => void;
  onMetricFocus?: (key: string | null) => void;
}

function focusClass(activeKey: string | null | undefined, ownKey: string) {
  if (!activeKey) return "";
  return activeKey === ownKey ? " focus-active" : " focus-muted";
}

function pointerIndex(
  event: PointerEvent<SVGSVGElement>,
  length: number,
  viewBoxWidth: number,
  left: number,
  right: number,
) {
  if (length <= 1) return 0;
  const bounds = event.currentTarget.getBoundingClientRect();
  const position = ((event.clientX - bounds.left) / bounds.width) * viewBoxWidth;
  const ratio = Math.min(1, Math.max(0, (position - left) / (right - left)));
  return Math.round(ratio * (length - 1));
}

export function GroupedBarChart({
  data,
  primaryKey,
  secondaryKey,
  primaryLabel,
  secondaryLabel,
  focusKey = "budget",
  activePointIndex = null,
  activeMetricKey = null,
  lockCursor = false,
  onPointChange,
  onMetricFocus,
}: {
  data: SeriesPoint[];
  primaryKey: string;
  secondaryKey: string;
  primaryLabel: string;
  secondaryLabel: string;
  focusKey?: string;
} & ChartInteractionProps) {
  const values = data.flatMap((point) => [
    Number(point[primaryKey] ?? 0),
    Number(point[secondaryKey] ?? 0),
  ]);
  const max = Math.max(...values, 1);
  const width = 760;
  const height = 250;
  const chartTop = 24;
  const chartBottom = 205;
  const groupWidth = (width - 48) / Math.max(data.length, 1);
  const barWidth = Math.min(22, groupWidth * 0.3);
  const safeActiveIndex =
    activePointIndex === null || data.length === 0
      ? null
      : Math.min(activePointIndex, data.length - 1);
  const activePoint =
    safeActiveIndex === null ? null : data[safeActiveIndex];
  const activeX =
    safeActiveIndex === null
      ? null
      : 42 + groupWidth * safeActiveIndex + groupWidth / 2;

  return (
    <div className={`chart-wrap focus-target${focusClass(activeMetricKey, focusKey)}`}>
      <div className="chart-legend" aria-hidden="true">
        <span
          onPointerEnter={() => onMetricFocus?.(focusKey)}
          onPointerLeave={() => onMetricFocus?.(null)}
        ><i style={{ background: "var(--chart-plan)" }} />{primaryLabel}</span>
        <span
          onPointerEnter={() => onMetricFocus?.(focusKey)}
          onPointerLeave={() => onMetricFocus?.(null)}
        ><i style={{ background: "var(--chart-fact)" }} />{secondaryLabel}</span>
      </div>
      {activePoint ? (
        <div className="chart-point-readout" aria-live="polite">
          <strong>{String(activePoint.label)}</strong>
          <span>{primaryLabel}: {formatCompactCurrency(Number(activePoint[primaryKey] ?? 0))}</span>
          <span>{secondaryLabel}: {formatCompactCurrency(Number(activePoint[secondaryKey] ?? 0))}</span>
        </div>
      ) : null}
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${primaryLabel} и ${secondaryLabel} по периодам`}
        onPointerMove={(event) =>
          onPointChange?.(
            pointerIndex(
              event,
              data.length,
              width,
              42 + groupWidth / 2,
              42 + groupWidth * Math.max(data.length - 1, 0) + groupWidth / 2,
            ),
          )
        }
        onPointerLeave={() => {
          if (!lockCursor) onPointChange?.(null);
        }}
      >
        {[0, 0.5, 1].map((mark) => {
          const y = chartBottom - (chartBottom - chartTop) * mark;
          return <line key={mark} x1="36" x2="752" y1={y} y2={y} className="chart-grid" />;
        })}
        {data.map((point, index) => {
          const center = 42 + groupWidth * index + groupWidth / 2;
          const primary = Number(point[primaryKey] ?? 0);
          const secondary =
            point[secondaryKey] === null ? null : Number(point[secondaryKey] ?? 0);
          const primaryHeight = (primary / max) * (chartBottom - chartTop);
          const secondaryHeight =
            secondary === null ? 0 : (secondary / max) * (chartBottom - chartTop);
          return (
            <g key={point.key} className="chart-enter" style={{ animationDelay: `${index * 45}ms` }}>
              <title>
                {`${point.label}: ${primaryLabel} ${formatCompactCurrency(primary)}, ${secondaryLabel} ${formatCompactCurrency(secondary)}`}
              </title>
              <rect
                x={center - barWidth - 2}
                y={chartBottom - primaryHeight}
                width={barWidth}
                height={primaryHeight}
                fill="var(--chart-plan)"
              />
              {secondary !== null ? (
                <rect
                  x={center + 2}
                  y={chartBottom - secondaryHeight}
                  width={barWidth}
                  height={secondaryHeight}
                  fill="var(--chart-fact)"
                />
              ) : null}
              <text x={center} y="230" textAnchor="middle" className="chart-label">
                {String(point.label)}
              </text>
            </g>
          );
        })}
        {activeX !== null ? (
          <line
            x1={activeX}
            x2={activeX}
            y1={chartTop}
            y2={chartBottom}
            className="chart-crosshair"
          />
        ) : null}
      </svg>
    </div>
  );
}

export interface LineMetric {
  key: string;
  label: string;
  focusKey?: string;
  color?: string;
  format?: ValueFormat;
  details?: Array<{
    key: string;
    label: string;
    format?: ValueFormat;
  }>;
}

export function LineChart({
  data,
  metrics,
  ariaLabel,
  activePointIndex = null,
  activeMetricKey = null,
  lockCursor = false,
  onPointChange,
  onMetricFocus,
}: {
  data: SeriesPoint[];
  metrics: LineMetric[];
  ariaLabel: string;
} & ChartInteractionProps) {
  const width = 760;
  const height = 250;
  const left = 30;
  const right = 744;
  const top = 26;
  const bottom = 200;
  const allValues = data.flatMap((point) =>
    metrics.map((metric) => Number(point[metric.key] ?? 0)),
  );
  const max = Math.max(...allValues, 1);
  const x = (index: number) =>
    data.length <= 1
      ? (left + right) / 2
      : left + (index / (data.length - 1)) * (right - left);
  const y = (value: number) => bottom - (value / max) * (bottom - top);
  const safeActiveIndex =
    activePointIndex === null || data.length === 0
      ? null
      : Math.min(activePointIndex, data.length - 1);
  const activePoint =
    safeActiveIndex === null ? null : data[safeActiveIndex];
  const activeX = safeActiveIndex === null ? null : x(safeActiveIndex);

  return (
    <div className="chart-wrap">
      <div className="chart-legend" aria-hidden="true">
        {metrics.map((metric, index) => {
          const metricFocusKey = metric.focusKey ?? metric.key;
          return (
          <span
            key={metric.key}
            className={`focus-target${focusClass(activeMetricKey, metricFocusKey)}`}
            onPointerEnter={() => onMetricFocus?.(metricFocusKey)}
            onPointerLeave={() => onMetricFocus?.(null)}
          >
            <i style={{ background: metric.color ?? palette[index] }} />
            {metric.label}
          </span>
          );
        })}
      </div>
      {activePoint ? (
        <div className="chart-point-readout" aria-live="polite">
          <strong>{String(activePoint.label)}</strong>
          {metrics.map((metric) => (
            <span key={metric.key}>
              {metric.label}:{" "}
              {formatValue(
                Number(activePoint[metric.key] ?? 0),
                metric.format ?? "integer",
              )}
            </span>
          ))}
        </div>
      ) : null}
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(event) =>
          onPointChange?.(pointerIndex(event, data.length, width, left, right))
        }
        onPointerLeave={() => {
          if (!lockCursor) onPointChange?.(null);
        }}
      >
        {[0, 0.5, 1].map((mark) => {
          const lineY = bottom - (bottom - top) * mark;
          return <line key={mark} x1={left} x2={right} y1={lineY} y2={lineY} className="chart-grid" />;
        })}
        {metrics.map((metric, metricIndex) => {
          const color = metric.color ?? palette[metricIndex];
          const metricFocusKey = metric.focusKey ?? metric.key;
          const points = data
            .map((point, index) => `${x(index)},${y(Number(point[metric.key] ?? 0))}`)
            .join(" ");
          return (
            <g
              key={metric.key}
              className={`chart-series focus-target${focusClass(activeMetricKey, metricFocusKey)}`}
              onPointerEnter={() => onMetricFocus?.(metricFocusKey)}
              onPointerLeave={() => onMetricFocus?.(null)}
            >
              <polyline points={points} fill="none" stroke={color} className="chart-line" />
              {data.map((point, index) => {
                const value = Number(point[metric.key] ?? 0);
                const details = metric.details
                  ?.map(
                    (detail) =>
                      `${detail.label}: ${formatValue(
                        Number(point[detail.key] ?? 0),
                        detail.format ?? "integer",
                      )}`,
                  )
                  .join("; ");
                return (
                  <circle
                    key={point.key}
                    cx={x(index)}
                    cy={y(value)}
                    r={safeActiveIndex === index ? "5.5" : "3.5"}
                    fill={color}
                  >
                    <title>
                      {`${point.label}, ${metric.label}: ${formatValue(value, metric.format ?? "integer")}${details ? `. ${details}` : ""}`}
                    </title>
                  </circle>
                );
              })}
            </g>
          );
        })}
        {activeX !== null ? (
          <line
            x1={activeX}
            x2={activeX}
            y1={top}
            y2={bottom}
            className="chart-crosshair"
          />
        ) : null}
        {data.map((point, index) => (
          <text key={point.key} x={x(index)} y="229" textAnchor="middle" className="chart-label">
            {String(point.label)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function DonutChart({
  data,
  activeMetricKey = null,
  onMetricFocus,
}: {
  data: Array<{ key: string; label: string; value: number }>;
} & Pick<ChartInteractionProps, "activeMetricKey" | "onMetricFocus">) {
  const total = data.reduce((result, item) => result + item.value, 0);
  const radius = 74;
  const circumference = 2 * Math.PI * radius;
  const segments = data.map((item, index) => {
    const previousValue = data
      .slice(0, index)
      .reduce((result, previous) => result + previous.value, 0);
    const part = total ? item.value / total : 0;
    return {
      ...item,
      dash: part * circumference,
      offset: total ? (previousValue / total) * circumference : 0,
    };
  });

  return (
    <div
      className={`donut-layout focus-target${focusClass(activeMetricKey, "expense")}`}
      onPointerEnter={() => onMetricFocus?.("expense")}
      onPointerLeave={() => onMetricFocus?.(null)}
    >
      <svg viewBox="0 0 220 220" className="donut" role="img" aria-label="Структура расходов">
        <circle cx="110" cy="110" r={radius} fill="none" stroke="var(--paper-deep)" strokeWidth="28" />
        {segments.map((item, index) => {
          return (
            <circle
              key={item.key}
              cx="110"
              cy="110"
              r={radius}
              fill="none"
              stroke={palette[index % palette.length]}
              strokeWidth="28"
              strokeDasharray={`${item.dash} ${circumference - item.dash}`}
              strokeDashoffset={-item.offset}
              transform="rotate(-90 110 110)"
              className="donut-segment"
            >
              <title>{`${item.label}: ${formatCompactCurrency(item.value)}`}</title>
            </circle>
          );
        })}
        <text x="110" y="105" textAnchor="middle" className="donut-caption">Расходы</text>
        <text x="110" y="127" textAnchor="middle" className="donut-total">
          {formatCompactCurrency(total)}
        </text>
      </svg>
      <div className="donut-legend">
        {data.map((item, index) => (
          <div key={item.key}>
            <i style={{ background: palette[index % palette.length] }} />
            <span>{item.label}</span>
            <strong>{total ? formatValue(item.value / total, "percent") : "—"}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FunnelChart({
  data,
  activeMetricKey = null,
  onMetricFocus,
}: {
  data: Array<{ key: string; label: string; value: number }>;
} & Pick<ChartInteractionProps, "activeMetricKey" | "onMetricFocus">) {
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <svg viewBox="0 0 620 310" className="funnel" role="img" aria-label="Воронка продаж">
      {data.map((item, index) => {
        const currentWidth = 520 * Math.max(item.value / max, 0.16);
        const next = data[index + 1];
        const nextWidth = next ? 520 * Math.max(next.value / max, 0.16) : currentWidth * 0.82;
        const x1 = 310 - currentWidth / 2;
        const x2 = 310 + currentWidth / 2;
        const nextX1 = 310 - nextWidth / 2;
        const nextX2 = 310 + nextWidth / 2;
        const top = 16 + index * 56;
        return (
          <g
            key={item.key}
            className={`funnel-step focus-target${focusClass(activeMetricKey, item.key)}`}
            style={{ animationDelay: `${index * 70}ms` }}
            onPointerEnter={() => onMetricFocus?.(item.key)}
            onPointerLeave={() => onMetricFocus?.(null)}
          >
            <polygon
              points={`${x1},${top} ${x2},${top} ${nextX2},${top + 45} ${nextX1},${top + 45}`}
              fill={palette[index]}
              opacity={0.94 - index * 0.08}
            />
            <text x="310" y={top + 20} textAnchor="middle" className="funnel-label">
              {item.label}
            </text>
            <text x="310" y={top + 37} textAnchor="middle" className="funnel-value">
              {formatValue(item.value, "integer")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
