"use client";

import { formatValue } from "@/lib/format";
import type {
  CashFlowRow,
  DashboardResponse,
  MarketingRow,
  RevenueRow,
  SalesRow,
} from "@/types/dashboard";

export function DashboardTable({
  section,
  data,
}: {
  section: "marketing" | "revenue" | "cash-flow" | "sales";
  data: DashboardResponse;
}) {
  if (section === "marketing") {
    return <MarketingTable rows={data.rows as MarketingRow[]} />;
  }
  if (section === "revenue") {
    return <RevenueTable rows={data.rows as RevenueRow[]} />;
  }
  if (section === "cash-flow") {
    return <CashFlowTable rows={data.rows as CashFlowRow[]} />;
  }
  return <SalesTable rows={data.rows as SalesRow[]} />;
}

function TableShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="table-section reveal">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Детализация</span>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="table-scroll">{children}</div>
    </section>
  );
}

function Pair({
  plan,
  actual,
  format,
}: {
  plan: number | null;
  actual: number | null;
  format: "currency" | "integer" | "percent";
}) {
  return (
    <span className="value-pair">
      <span>{formatValue(plan, format)}</span>
      <strong>{formatValue(actual, format)}</strong>
    </span>
  );
}

function MarketingTable({ rows }: { rows: MarketingRow[] }) {
  return (
    <TableShell title="Маркетинг по направлениям">
      <table>
        <thead>
          <tr>
            <th>Направление</th>
            <th>Бюджет <small>план / факт</small></th>
            <th>Посещения <small>план / факт</small></th>
            <th>Лиды <small>план / факт</small></th>
            <th>Конверсия <small>план / факт</small></th>
            <th>CPC <small>план / факт</small></th>
            <th>CPL <small>план / факт</small></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.directionId}>
              <th scope="row">{row.direction}</th>
              <td><Pair plan={row.planBudget} actual={row.actualBudget} format="currency" /></td>
              <td><Pair plan={row.planVisits} actual={row.actualVisits} format="integer" /></td>
              <td><Pair plan={row.planLeads} actual={row.actualLeads} format="integer" /></td>
              <td><Pair plan={row.planConversion} actual={row.actualConversion} format="percent" /></td>
              <td><Pair plan={row.planCpc} actual={row.actualCpc} format="currency" /></td>
              <td><Pair plan={row.planCpl} actual={row.actualCpl} format="currency" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}

function RevenueTable({ rows }: { rows: RevenueRow[] }) {
  return (
    <TableShell title="Экономика направлений">
      <table>
        <thead>
          <tr>
            <th>Направление</th>
            <th>Выручка</th>
            <th>Подрядчики</th>
            <th>ФОТ</th>
            <th>Маржа до ФОТ</th>
            <th>Доля подрядчиков</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.directionId}>
              <th scope="row">{row.direction}</th>
              <td>{formatValue(row.revenue, "currency")}</td>
              <td>{formatValue(row.contractorCost, "currency")}</td>
              <td>
                <span
                  className="payroll-value"
                  tabIndex={0}
                  data-tooltip={`Оклад: ${formatValue(row.payrollSalary, "currency")}; отпускные: ${formatValue(row.payrollVacationPay, "currency")}; премия: ${formatValue(row.payrollBonus, "currency")}; бонус от продаж: ${formatValue(row.payrollSalesBonus, "currency")}`}
                  aria-label={`ФОТ ${formatValue(row.payroll, "currency")}. Оклад ${formatValue(row.payrollSalary, "currency")}, отпускные ${formatValue(row.payrollVacationPay, "currency")}, премия ${formatValue(row.payrollBonus, "currency")}, бонус от продаж ${formatValue(row.payrollSalesBonus, "currency")}`}
                >
                  {formatValue(row.payroll, "currency")}
                </span>
              </td>
              <td>{formatValue(row.margin, "currency")}</td>
              <td>
                <span className={row.overLimit ? "warm-value" : ""}>
                  {formatValue(row.contractorShare, "percent")}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}

function CashFlowTable({ rows }: { rows: CashFlowRow[] }) {
  return (
    <TableShell title="Движение средств по направлениям">
      <table>
        <thead>
          <tr>
            <th>Направление</th>
            <th>Приход</th>
            <th>Расход</th>
            <th>Чистый поток</th>
            <th>Рентабельность</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.directionId}>
              <th scope="row">{row.direction}</th>
              <td>{formatValue(row.income, "currency")}</td>
              <td>{formatValue(row.expense, "currency")}</td>
              <td>{formatValue(row.net, "currency")}</td>
              <td>{formatValue(row.profitability, "percent")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}

function SalesTable({ rows }: { rows: SalesRow[] }) {
  return (
    <TableShell title="Продажи по направлениям">
      <table>
        <thead>
          <tr>
            <th>Направление</th>
            <th>Лиды</th>
            <th>Встречи</th>
            <th>КП</th>
            <th>Договоры</th>
            <th>Оплаты</th>
            <th>Выручка</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.directionId}>
              <th scope="row">{row.direction}</th>
              <td>{formatValue(row.leads, "integer")}</td>
              <td>{formatValue(row.meetings, "integer")}</td>
              <td>{formatValue(row.proposals, "integer")}</td>
              <td>{formatValue(row.contracts, "integer")}</td>
              <td>{formatValue(row.payments, "integer")}</td>
              <td>{formatValue(row.revenue, "currency")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}
