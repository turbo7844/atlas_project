import { describe, expect, it } from "vitest";

import { formatCompactCurrency } from "@/lib/format";

describe("компактное форматирование денег", () => {
  it("показывает миллионы в карточках KPI", () => {
    expect(formatCompactCurrency(109_060_000)).toBe("109,1 млн ₽");
  });

  it("показывает миллиарды без переполнения карточки", () => {
    expect(formatCompactCurrency(1_250_000_000)).toBe("1,3 млрд ₽");
  });
});
