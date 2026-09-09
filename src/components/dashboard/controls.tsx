"use client";

import { useState } from "react";

import {
  MONTHS,
  type Granularity,
} from "@/lib/constants";

const monthKey = (month: number) => `2026-${String(month).padStart(2, "0")}`;
const monthNumber = (key: string) => Number(key.slice(-2));

export function DirectionFilter<Id extends string>({
  value,
  onChange,
  options,
}: {
  value: Id[];
  onChange: (directions: Id[]) => void;
  options: readonly { id: Id; name: string }[];
}) {
  const toggle = (directionId: Id) => {
    onChange(
      value.includes(directionId)
        ? value.filter((item) => item !== directionId)
        : [...value, directionId],
    );
  };

  return (
    <details className="filter-popover">
      <summary className="filter-button">
        <span>Направления</span>
        <strong>{value.length ? value.length : "—"}</strong>
        <Chevron />
      </summary>
      <div className="popover-panel directions-panel">
        <div className="popover-title">Направления</div>
        <div className="check-list">
          {options.map((direction) => (
            <label key={direction.id}>
              <input
                type="checkbox"
                checked={value.includes(direction.id)}
                onChange={() => toggle(direction.id)}
              />
              <span className="custom-check" aria-hidden="true" />
              {direction.name}
            </label>
          ))}
        </div>
        <div className="popover-actions">
          <button type="button" onClick={() => onChange(options.map((item) => item.id))}>
            Выбрать все
          </button>
          <button type="button" onClick={() => onChange([])}>
            Сбросить все
          </button>
        </div>
      </div>
    </details>
  );
}

function periodLabel(from: string, to: string) {
  const start = monthNumber(from);
  const end = monthNumber(to);
  return start === end
    ? `${MONTHS[start - 1]} 2026`
    : `${MONTHS[start - 1].slice(0, 3)} — ${MONTHS[end - 1].slice(0, 3)} 2026`;
}

export function PeriodPicker({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (period: { from: string; to: string }) => void;
}) {
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [anchor, setAnchor] = useState(monthNumber(from));

  const chooseMonth = (month: number) => {
    if (!selectingEnd) {
      setAnchor(month);
      setSelectingEnd(true);
      onChange({ from: monthKey(month), to: monthKey(month) });
      return;
    }

    const start = Math.min(anchor, month);
    const end = Math.max(anchor, month);
    onChange({ from: monthKey(start), to: monthKey(end) });
    setSelectingEnd(false);
  };

  const shift = (direction: -1 | 1) => {
    const start = monthNumber(from);
    const end = monthNumber(to);
    const length = end - start + 1;
    const nextStart = start + direction * length;
    const nextEnd = end + direction * length;
    if (nextStart < 1 || nextEnd > 12) return;
    onChange({ from: monthKey(nextStart), to: monthKey(nextEnd) });
  };

  const quick = (start: number, end: number) => {
    setSelectingEnd(false);
    onChange({ from: monthKey(start), to: monthKey(end) });
  };

  return (
    <div className="period-control">
      <button
        type="button"
        className="icon-button period-arrow"
        aria-label="Предыдущий период"
        data-tooltip="Предыдущий период"
        onClick={() => shift(-1)}
        disabled={monthNumber(from) - (monthNumber(to) - monthNumber(from) + 1) < 1}
      >
        <Arrow direction="left" />
      </button>
      <details className="filter-popover period-popover">
        <summary className="filter-button period-button">
          <span>{periodLabel(from, to)}</span>
          <Calendar />
        </summary>
        <div className="popover-panel calendar-panel">
          <div className="quick-periods">
            <button type="button" onClick={() => quick(8, 8)}>Этот месяц</button>
            <button type="button" onClick={() => quick(7, 7)}>Прошлый месяц</button>
            <button type="button" onClick={() => quick(7, 9)}>Этот квартал</button>
            <button type="button" onClick={() => quick(4, 6)}>Прошлый квартал</button>
            <button type="button" onClick={() => quick(1, 12)}>Этот год</button>
            <button type="button" onClick={() => quick(1, 12)}>Всё время</button>
          </div>
          <div className="calendar-content">
            <div className="year-row">
              <button type="button" disabled aria-label="Предыдущий год"><Arrow direction="left" /></button>
              <strong>2026</strong>
              <button type="button" disabled aria-label="Следующий год"><Arrow direction="right" /></button>
            </div>
            <p className="calendar-hint">
              {selectingEnd ? "Выберите конец периода" : "Выберите начало периода"}
            </p>
            <div className="month-grid">
              {MONTHS.map((month, index) => {
                const number = index + 1;
                const selected =
                  number >= monthNumber(from) && number <= monthNumber(to);
                return (
                  <button
                    type="button"
                    key={month}
                    className={selected ? "selected" : ""}
                    onClick={() => chooseMonth(number)}
                  >
                    {month.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            <p className="plan-range-note">
              План доступен по декабрь, факт — по последнюю принятую дату.
            </p>
          </div>
        </div>
      </details>
      <button
        type="button"
        className="icon-button period-arrow"
        aria-label="Следующий период"
        data-tooltip="Следующий период"
        onClick={() => shift(1)}
        disabled={monthNumber(to) + (monthNumber(to) - monthNumber(from) + 1) > 12}
      >
        <Arrow direction="right" />
      </button>
    </div>
  );
}

export function GranularityControl({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (value: Granularity) => void;
}) {
  const options: Array<{ value: Granularity; label: string }> = [
    { value: "month", label: "Месяцы" },
    { value: "quarter", label: "Кварталы" },
    { value: "year", label: "Годы" },
  ];
  return (
    <div className="segmented" aria-label="Группировка данных">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? "active" : ""}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SyncIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className={spinning ? "spinning" : ""}
      aria-hidden="true"
    >
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M6.1 8.5A7 7 0 0 1 18.8 7L20 12" />
      <path d="M17.9 15.5A7 7 0 0 1 5.2 17L4 12" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function Arrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" aria-hidden="true">
      {direction === "left" ? <path d="m12 5-5 5 5 5" /> : <path d="m8 5 5 5-5 5" />}
    </svg>
  );
}

function Calendar() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="3" y="4.5" width="14" height="12.5" />
      <path d="M6.5 2.5v4M13.5 2.5v4M3 8.5h14" />
    </svg>
  );
}
