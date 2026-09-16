import type { CSSProperties } from "react";

import { AnimatedValue } from "@/components/dashboard/kpis";
import {
  formatPercentagePoints,
  formatValue,
} from "@/lib/format";
import type {
  ManagementInputs,
  ManagementMetric,
} from "@/types/dashboard";

function metricValue(metric: ManagementMetric, value = metric.value) {
  const formatted = formatValue(value, metric.format);
  return metric.key === "roas" && formatted !== "—"
    ? `${formatted}×`
    : formatted;
}

function metricPosition(metric: ManagementMetric, value: number | null) {
  if (value === null || metric.scaleMax <= 0) return 0;
  return Math.min(96, Math.max(0, (value / metric.scaleMax) * 100));
}

function deviation(metric: ManagementMetric) {
  if (metric.normDelta === null) return "нет данных";
  const prefix = metric.normDelta >= 0 ? "+" : "−";
  const value = Math.abs(metric.normDelta);
  return metric.normDeltaMode === "percentage-points"
    ? `${prefix}${formatPercentagePoints(value)}`
    : `${prefix}${formatValue(value, "percent")}`;
}

function MetricCard({
  metric,
  index,
  activeMetricKey,
  onMetricFocus,
}: {
  metric: ManagementMetric;
  index: number;
  activeMetricKey: string | null;
  onMetricFocus?: (key: string | null) => void;
}) {
  const attention = metric.normDelta !== null && metric.normDelta < 0;
  const fact = metricPosition(metric, metric.value);
  const norm = metricPosition(metric, metric.norm);
  const style = {
    "--management-fact": `${fact}%`,
    "--management-norm": `${norm}%`,
  } as CSSProperties;
  const muted = Boolean(activeMetricKey && activeMetricKey !== metric.key);
  const active = activeMetricKey === metric.key;

  return (
    <article
      className={`management-card reveal focus-target ${attention ? "attention" : ""}${muted ? " focus-muted" : ""}${active ? " focus-active" : ""}`}
      style={{ ...style, animationDelay: `${index * 45}ms` }}
      tabIndex={0}
      onPointerEnter={() => onMetricFocus?.(metric.key)}
      onPointerLeave={() => onMetricFocus?.(null)}
      onFocus={() => onMetricFocus?.(metric.key)}
      onBlur={() => onMetricFocus?.(null)}
    >
      <div className="management-card-heading">
        <span>{metric.label}</span>
        <span
          className="info"
          data-tooltip={metric.hint}
          tabIndex={0}
          aria-label={metric.hint}
        >
          i
        </span>
      </div>
      <strong className="management-value">
        <AnimatedValue value={metric.value} format={metric.format} />
        {metric.key === "roas" && metric.value !== null ? "×" : null}
      </strong>
      <div className="management-status">
        <span>
          Норма {metric.normDirection === "lower" ? "не выше" : "не ниже"}{" "}
          {metricValue(metric, metric.norm)}
        </span>
        <strong>{deviation(metric)}</strong>
      </div>
      <div className="management-scale" aria-hidden="true">
        <div className="management-track">
          <span className="management-fill" />
        </div>
        <i className="management-norm-marker" />
        {metric.value !== null ? <i className="management-fact-marker" /> : null}
      </div>
      <div className="management-axis">
        <span>0</span>
        <span>{metricValue(metric, metric.scaleMax)}</span>
      </div>
      <div className="management-source">
        <span>Источник</span>
        <strong>{metric.source}</strong>
      </div>
    </article>
  );
}

function FormulaRow({
  name,
  formula,
  values,
}: {
  name: string;
  formula: string;
  values: string;
}) {
  return (
    <div className="management-formula-row">
      <strong>{name}</strong>
      <span>{formula}</span>
      <b>{values}</b>
    </div>
  );
}

export function ManagementDashboard({
  metrics,
  inputs,
  activeMetricKey = null,
  onMetricFocus,
}: {
  metrics: ManagementMetric[];
  inputs: ManagementInputs;
  activeMetricKey?: string | null;
  onMetricFocus?: (key: string | null) => void;
}) {
  return (
    <>
      <section
        className="management-grid"
        aria-label="Управленческие показатели относительно нормативов"
      >
        {metrics.map((metric, index) => (
          <MetricCard
            metric={metric}
            index={index}
            key={metric.key}
            activeMetricKey={activeMetricKey}
            onMetricFocus={onMetricFocus}
          />
        ))}
      </section>

      <div className="management-explanation">
        <section className="management-panel reveal">
          <span className="eyebrow">Методика</span>
          <h2>Как считаются показатели</h2>
          <div className="management-formulas">
            <FormulaRow
              name="ROAS"
              formula="Выручка / рекламный бюджет, факт"
              values={`${formatValue(inputs.revenue, "currency")} / ${formatValue(inputs.marketingBudget, "currency")}`}
            />
            <FormulaRow
              name="CAC"
              formula="Рекламный бюджет, факт / полученные оплаты"
              values={`${formatValue(inputs.marketingBudget, "currency")} / ${formatValue(inputs.payments, "integer")}`}
            />
            <FormulaRow
              name="Прибыль на 1 лида"
              formula="(Выручка − подрядчики) / фактические лиды"
              values={`${formatValue(inputs.grossProfit, "currency")} / ${formatValue(inputs.marketingLeads, "integer")}`}
            />
            <FormulaRow
              name="Cash Conversion"
              formula="(Поступления / 1,22) / выручка × 100%"
              values={`${formatValue(inputs.receiptsWithoutVat, "currency")} / ${formatValue(inputs.revenue, "currency")}`}
            />
          </div>
          <p className="management-vat-note">
            Поступления с НДС: {formatValue(inputs.receiptsWithVat, "currency")}. На
            этой вкладке они приведены к сумме без НДС; вкладка «ДДС» не изменена.
          </p>
        </section>

        <section className="management-panel reveal">
          <span className="eyebrow">Оценка</span>
          <h2>Принцип сравнения</h2>
          <div className="management-principles">
            <div><b>01</b><p><strong>Синий — норма выполнена</strong><span>ROAS, прибыль на лида и Cash Conversion: больше — лучше.</span></p></div>
            <div><b>02</b><p><strong>Тёплый — требуется внимание</strong><span>CAC оценивается наоборот: ниже норматива — лучше.</span></p></div>
            <div><b>03</b><p><strong>Единая точка сравнения</strong><span>Факт меняется с периодом и направлениями, норматив задаётся в настройках.</span></p></div>
          </div>
        </section>
      </div>
    </>
  );
}
