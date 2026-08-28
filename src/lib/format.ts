import type { ValueFormat } from "@/types/dashboard";

const integer = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});

const decimal = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

export function formatValue(
  value: number | null | undefined,
  format: ValueFormat,
) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  switch (format) {
    case "currency":
      return currency.format(value).replace("₽", "₽");
    case "integer":
      return integer.format(value);
    case "percent":
      return `${decimal.format(value * 100)}%`;
    case "decimal":
      return decimal.format(value);
  }
}

export function formatCompactCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) >= 1_000_000) {
    return `${decimal.format(value / 1_000_000)} млн ₽`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${decimal.format(value / 1_000)} тыс. ₽`;
  }
  return currency.format(value);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "ещё не выполнялась";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Astrakhan",
  }).format(new Date(value));
}
