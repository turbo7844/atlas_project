"use client";

import {
  DonutChart,
  FunnelChart,
  GroupedBarChart,
  LineChart,
} from "@/components/dashboard/charts";
import { DashboardTable } from "@/components/dashboard/tables";
import { formatValue } from "@/lib/format";
import type {
  DashboardResponse,
  RevenueRow,
} from "@/types/dashboard";

export function SectionContent({
  section,
  data,
}: {
  section: "marketing" | "revenue" | "cash-flow" | "sales";
  data: DashboardResponse;
}) {
  return (
    <>
      <div className="feature-grid">
        {section === "marketing" ? <MarketingFeatures data={data} /> : null}
        {section === "revenue" ? <RevenueFeatures data={data} /> : null}
        {section === "cash-flow" ? <CashFlowFeatures data={data} /> : null}
        {section === "sales" ? <SalesFeatures data={data} /> : null}
      </div>
      <DashboardTable section={section} data={data} />
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

function MarketingFeatures({ data }: { data: DashboardResponse }) {
  return (
    <>
      <Panel eyebrow="Выполнение" title="План / факт">
        <div className="progress-list">
          {data.kpis.map((kpi, index) => {
            const percent = kpi.completion === null || kpi.completion === undefined
              ? 0
              : Math.min(kpi.completion * 100, 140);
            return (
              <div className="progress-item" key={kpi.key}>
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
        />
      </Panel>
    </>
  );
}

function RevenueFeatures({ data }: { data: DashboardResponse }) {
  const rows = data.rows as RevenueRow[];
  const maxRevenue = Math.max(...rows.map((row) => row.revenue), 1);
  return (
    <>
      <Panel eyebrow="Агрегаты" title="Направления">
        <div className="direction-bars">
          {rows.map((row) => (
            <div key={row.directionId}>
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
            { key: "revenue", label: "Выручка", color: "#1f5b8f", format: "currency" },
            { key: "contractorCost", label: "Подрядчики", color: "#d3a86f", format: "currency" },
            {
              key: "payroll",
              label: "ФОТ",
              color: "#61727f",
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
        />
      </Panel>
    </>
  );
}

function CashFlowFeatures({ data }: { data: DashboardResponse }) {
  return (
    <>
      <Panel eyebrow="Структура" title="Расходы">
        <DonutChart data={data.breakdown ?? []} />
      </Panel>
      <Panel eyebrow="Динамика" title="Расходы по статьям">
        <LineChart
          data={data.series}
          metrics={(data.breakdown ?? []).map((item) => ({
            key: item.key,
            label: item.label,
            format: "currency",
          }))}
          ariaLabel="Динамика расходов по крупнейшим статьям"
        />
      </Panel>
    </>
  );
}

function SalesFeatures({ data }: { data: DashboardResponse }) {
  return (
    <>
      <Panel eyebrow="Конверсия" title="Воронка продаж">
        <FunnelChart data={data.funnel ?? []} />
      </Panel>
      <Panel eyebrow="Динамика" title="Этапы продаж">
        <LineChart
          data={data.series}
          metrics={[
            { key: "leads", label: "Лиды", color: "#1f5b8f" },
            { key: "meetings", label: "Встречи", color: "#4779a2" },
            { key: "proposals", label: "КП", color: "#6f96b8" },
            { key: "contracts", label: "Договоры", color: "#9bb3c7" },
            { key: "payments", label: "Оплаты", color: "#d3a86f" },
          ]}
          ariaLabel="Динамика этапов продаж"
        />
      </Panel>
    </>
  );
}
