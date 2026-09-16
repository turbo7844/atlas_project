"use client";

import {
  DonutChart,
  FunnelChart,
  GroupedBarChart,
  LineChart,
  type ChartInteractionProps,
} from "@/components/dashboard/charts";
import { DashboardTable } from "@/components/dashboard/tables";
import { formatValue } from "@/lib/format";
import type { DashboardSection } from "@/lib/constants";
import type {
  DashboardResponse,
  RevenueRow,
} from "@/types/dashboard";

export function SectionContent({
  section,
  data,
  exporting,
  onExport,
  ...interaction
}: {
  section: DashboardSection;
  data: DashboardResponse;
  exporting: boolean;
  onExport: () => void;
} & ChartInteractionProps) {
  if (section === "dashboards") return null;

  return (
    <>
      <div className="feature-grid">
        {section === "marketing" ? <MarketingFeatures data={data} interaction={interaction} /> : null}
        {section === "revenue" ? <RevenueFeatures data={data} interaction={interaction} /> : null}
        {section === "cash-flow" ? <CashFlowFeatures data={data} interaction={interaction} /> : null}
        {section === "sales" ? <SalesFeatures data={data} interaction={interaction} /> : null}
      </div>
      <DashboardTable
        section={section}
        data={data}
        exporting={exporting}
        onExport={onExport}
      />
    </>
  );
}

function Panel({
  eyebrow,
  title,
  children,
  className = "",
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`feature-panel reveal ${className}`}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function focusClass(activeKey: string | null | undefined, ownKey: string) {
  if (!activeKey) return "";
  return activeKey === ownKey ? " focus-active" : " focus-muted";
}

function MarketingFeatures({
  data,
  interaction,
}: {
  data: DashboardResponse;
  interaction: ChartInteractionProps;
}) {
  return (
    <>
      <Panel eyebrow="Выполнение" title="План / факт">
        <div className="progress-list">
          {data.kpis.map((kpi, index) => {
            const percent = kpi.completion === null || kpi.completion === undefined
              ? 0
              : Math.min(kpi.completion * 100, 140);
            return (
              <div
                className={`progress-item focus-target${focusClass(interaction.activeMetricKey, kpi.key)}`}
                key={kpi.key}
                onPointerEnter={() => interaction.onMetricFocus?.(kpi.key)}
                onPointerLeave={() => interaction.onMetricFocus?.(null)}
              >
                <div>
                  <span>{kpi.label}</span>
                  <strong>
                    {kpi.completion === null || kpi.completion === undefined
                      ? "—"
                      : formatValue(kpi.completion, "percent")}
                  </strong>
                </div>
                <div className="progress-track">
                  <span
                    className="progress-fill"
                    style={{
                      width: `${Math.min(percent, 100)}%`,
                      animationDelay: `${index * 60}ms`,
                    }}
                  />
                  <i />
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel eyebrow="Динамика" title="Рекламный бюджет">
        <GroupedBarChart
          data={data.series}
          primaryKey="planBudget"
          secondaryKey="actualBudget"
          primaryLabel="План"
          secondaryLabel="Факт"
          focusKey="budget"
          {...interaction}
        />
      </Panel>
    </>
  );
}

function RevenueFeatures({
  data,
  interaction,
}: {
  data: DashboardResponse;
  interaction: ChartInteractionProps;
}) {
  const rows = data.rows as RevenueRow[];
  const maxRevenue = Math.max(...rows.map((row) => row.revenue), 1);
  return (
    <>
      <Panel eyebrow="Агрегаты" title="Направления">
        <div className="direction-bars">
          {rows.map((row) => (
            <div
              className={`focus-target${focusClass(interaction.activeMetricKey, "revenue")}`}
              key={row.directionId}
              onPointerEnter={() => interaction.onMetricFocus?.("revenue")}
              onPointerLeave={() => interaction.onMetricFocus?.(null)}
            >
              <div>
                <span>{row.direction}</span>
                <strong>{formatValue(row.revenue, "currency")}</strong>
              </div>
              <div className="direction-track">
                <span style={{ width: `${(row.revenue / maxRevenue) * 100}%` }} />
              </div>
              <small className={row.overLimit ? "warm-value" : ""}>
                Подрядчики {formatValue(row.contractorShare, "percent")}
              </small>
            </div>
          ))}
        </div>
        <p className="panel-note">
          Тёплая подсветка появляется выше нормы{" "}
          {formatValue(data.contractorShareLimit, "percent")}.
        </p>
      </Panel>
      <Panel eyebrow="Динамика" title="Выручка, ФОТ и подрядчики">
        <LineChart
          data={data.series}
          metrics={[
            { key: "revenue", label: "Выручка", color: "var(--chart-1)", format: "currency" },
            { key: "contractorCost", focusKey: "contractors", label: "Подрядчики", color: "var(--chart-4)", format: "currency" },
            {
              key: "payroll",
              label: "ФОТ",
              color: "var(--chart-5)",
              format: "currency",
              details: [
                { key: "payrollSalary", label: "Оклад", format: "currency" },
                { key: "payrollVacationPay", label: "Отпускные", format: "currency" },
                { key: "payrollBonus", label: "Премия", format: "currency" },
                { key: "payrollSalesBonus", label: "Бонус от продаж", format: "currency" },
              ],
            },
          ]}
          ariaLabel="Динамика выручки, ФОТ и оплаты подрядчиков"
          {...interaction}
        />
      </Panel>
    </>
  );
}

function CashFlowFeatures({
  data,
  interaction,
}: {
  data: DashboardResponse;
  interaction: ChartInteractionProps;
}) {
  return (
    <>
      <Panel eyebrow="Структура" title="Расходы">
        <DonutChart
          data={data.breakdown ?? []}
          activeMetricKey={interaction.activeMetricKey}
          onMetricFocus={interaction.onMetricFocus}
        />
      </Panel>
      <Panel eyebrow="Динамика" title="Расходы по статьям">
        <LineChart
          data={data.series}
          metrics={(data.breakdown ?? []).map((item) => ({
            key: item.key,
            label: item.label,
            focusKey: "expense",
            format: "currency",
          }))}
          ariaLabel="Динамика расходов по крупнейшим статьям"
          {...interaction}
        />
      </Panel>
    </>
  );
}

function SalesFeatures({
  data,
  interaction,
}: {
  data: DashboardResponse;
  interaction: ChartInteractionProps;
}) {
  return (
    <>
      <Panel eyebrow="Конверсия" title="Воронка продаж">
        <FunnelChart
          data={data.funnel ?? []}
          activeMetricKey={interaction.activeMetricKey}
          onMetricFocus={interaction.onMetricFocus}
        />
      </Panel>
      <Panel eyebrow="Динамика" title="Этапы продаж">
        <LineChart
          data={data.series}
          metrics={[
            { key: "leads", label: "Лиды", color: "var(--chart-1)" },
            { key: "meetings", focusKey: "leads", label: "Встречи", color: "var(--chart-2)" },
            { key: "proposals", focusKey: "contracts", label: "КП", color: "var(--chart-3)" },
            { key: "contracts", label: "Договоры", color: "var(--chart-5)" },
            { key: "payments", label: "Оплаты", color: "var(--chart-4)" },
          ]}
          ariaLabel="Динамика этапов продаж"
          {...interaction}
        />
      </Panel>
    </>
  );
}
