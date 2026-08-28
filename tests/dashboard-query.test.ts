import { describe, expect, it } from "vitest";

import { parseDashboardQuery } from "@/lib/dashboard-query";

describe("parseDashboardQuery", () => {
  it("возвращает безопасные значения по умолчанию", () => {
    const query = parseDashboardQuery(new URLSearchParams());
    expect(query.from).toBe("2026-01");
    expect(query.to).toBe("2026-08");
    expect(query.granularity).toBe("month");
    expect(query.directions).toHaveLength(5);
  });

  it("поддерживает пустой набор направлений и кварталы", () => {
    const query = parseDashboardQuery(
      new URLSearchParams({
        from: "2026-04",
        to: "2026-06",
        granularity: "quarter",
        directions: "",
      }),
    );
    expect(query.directions).toEqual([]);
    expect(query.granularity).toBe("quarter");
  });

  it("отклоняет обратный период", () => {
    expect(() =>
      parseDashboardQuery(
        new URLSearchParams({ from: "2026-08", to: "2026-02" }),
      ),
    ).toThrow("Период задан неверно");
  });
});
