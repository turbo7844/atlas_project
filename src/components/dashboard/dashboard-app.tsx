"use client";

/* eslint-disable react-hooks/set-state-in-effect -- Эффекты загружают состояние из localStorage и серверного API. */

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  DirectionFilter,
  GranularityControl,
  PeriodPicker,
  SyncIcon,
} from "@/components/dashboard/controls";
import { KpiGrid } from "@/components/dashboard/kpis";
import { IntegrationSettings } from "@/components/dashboard/integration-settings";
import { ManagementDashboard } from "@/components/dashboard/management-dashboard";
import { SectionContent } from "@/components/dashboard/section-content";
import {
  CASH_FLOW_DIRECTIONS,
  DIRECTIONS,
  type CashFlowDirectionId,
  type DashboardSection,
  type DirectionId,
  type Granularity,
} from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import type { DashboardResponse } from "@/types/dashboard";

const tabs: Array<{
  id: DashboardSection;
  label: string;
  title: string;
  description: string;
}> = [
  {
    id: "marketing",
    label: "Маркетинг",
    title: "Маркетинг",
    description: "План и факт привлечения по направлениям",
  },
  {
    id: "revenue",
    label: "Выручка и ФОТ",
    title: "Выручка и ФОТ",
    description: "Доход, начисления команды, подрядчики и маржинальность до ФОТ",
  },
  {
    id: "cash-flow",
    label: "ДДС",
    title: "Движение денежных средств",
    description: "Приходы, расходы и чистый поток",
  },
  {
    id: "sales",
    label: "Продажи",
    title: "Продажи",
    description: "Воронка и динамика коммерческих этапов",
  },
  {
    id: "dashboards",
    label: "Дашборды",
    title: "Дашборды",
    description:
      "Эффективность маркетинга, продаж и превращения выручки в деньги",
  },
];

type PersistedState = {
  section: DashboardSection;
  directions: DirectionId[];
  cashFlowDirections: CashFlowDirectionId[];
  from: string;
  to: string;
  granularity: Granularity;
};

type SyncStatus = {
  lastRun: {
    status: string;
    finishedAt: string | null;
    errorMessage: string | null;
  } | null;
  snapshot: {
    createdAt: string;
    rowCount: number;
  } | null;
};

type MarketingActualSyncStatus = {
  configured: boolean;
  lastSuccessAt: string | null;
  rowCount: number;
  maxDate: string | null;
  revision: number;
  error: string | null;
};

type PayrollSyncStatus = {
  configured: boolean;
  status: string;
  lastSuccessAt: string | null;
  employeeCount: number;
  aggregateCount: number;
  latestPeriod: string | null;
  revision: number;
  error: string | null;
};

type FintabloSyncStatus = {
  configured: boolean;
  status: string;
  lastSuccessAt: string | null;
  rowCount: number;
  maxDate: string | null;
  revision: number;
  error: string | null;
};

type BitrixSyncStatus = {
  configured: boolean;
  status: string;
  revision: number;
  lastSuccessAt: string | null;
  dealCount: number;
  funnelCount: number;
  ignoredDealCount: number;
  minDate: string | null;
  maxDate: string | null;
  maxRevenueDate: string | null;
  error: string | null;
};

const defaultState: PersistedState = {
  section: "marketing",
  directions: DIRECTIONS.map((direction) => direction.id),
  cashFlowDirections: CASH_FLOW_DIRECTIONS.map(
    (direction) => direction.id,
  ),
  from: "2026-01",
  to: "2026-08",
  granularity: "month",
};

const syncStatusLabels: Record<string, string> = {
  NOT_STARTED: "ещё не запускалась",
  RUNNING: "выполняется",
  SUCCESS: "успешно",
  FAILED: "ошибка",
  SKIPPED: "уже выполняется",
};

const directionIds = new Set(DIRECTIONS.map((direction) => direction.id));
const cashFlowDirectionIds = new Set(
  CASH_FLOW_DIRECTIONS.map((direction) => direction.id),
);

function restoreState(value: string): PersistedState {
  const saved = JSON.parse(value) as Partial<PersistedState>;
  const directions = Array.isArray(saved.directions)
    ? saved.directions.filter((id): id is DirectionId =>
        directionIds.has(id as DirectionId),
      )
    : defaultState.directions;
  const cashFlowDirections = Array.isArray(saved.cashFlowDirections)
    ? saved.cashFlowDirections.filter((id): id is CashFlowDirectionId =>
        cashFlowDirectionIds.has(id as CashFlowDirectionId),
      )
    : defaultState.cashFlowDirections;
  return {
    ...defaultState,
    ...saved,
    directions,
    cashFlowDirections,
  };
}

export function DashboardApp({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<PersistedState>(defaultState);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [actualSyncStatus, setActualSyncStatus] =
    useState<MarketingActualSyncStatus | null>(null);
  const [payrollSyncStatus, setPayrollSyncStatus] =
    useState<PayrollSyncStatus | null>(null);
  const [fintabloSyncStatus, setFintabloSyncStatus] =
    useState<FintabloSyncStatus | null>(null);
  const [bitrixSyncStatus, setBitrixSyncStatus] =
    useState<BitrixSyncStatus | null>(null);
  const stateRef = useRef(state);
  const actualRevisionRef = useRef(0);
  const payrollRevisionRef = useRef(0);
  const fintabloRevisionRef = useRef(0);
  const bitrixRevisionRef = useRef(0);
  const quietRefreshRef = useRef<DashboardSection | null>(null);
  const currentDirections =
    state.section === "cash-flow"
      ? state.cashFlowDirections
      : state.directions;
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("atlas-dashboard-filters");
      if (saved) {
        setState(restoreState(saved));
      }
    } catch {
      localStorage.removeItem("atlas-dashboard-filters");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      localStorage.setItem("atlas-dashboard-filters", JSON.stringify(state));
    }
  }, [ready, state]);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 4_000);
    return () => clearTimeout(timeout);
  }, [toast]);

  const loadSyncStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/sync/marketing-plan", {
        cache: "no-store",
      });
      if (response.ok) {
        setSyncStatus((await response.json()) as SyncStatus);
      }
    } catch {
      // Состояние синхронизации не мешает работе уже загруженного дашборда.
    }
  }, []);

  const loadFintabloSyncStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/sync/fintablo-cash-flow", {
        cache: "no-store",
      });
      if (response.ok) {
        const status = (await response.json()) as FintabloSyncStatus;
        setFintabloSyncStatus(status);
        fintabloRevisionRef.current = status.revision;
      }
    } catch {
      // Последний успешный снимок остаётся доступен при ошибке статуса.
    }
  }, []);

  const loadBitrixSyncStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/sync/bitrix24-sales", {
        cache: "no-store",
      });
      if (response.ok) {
        const status = (await response.json()) as BitrixSyncStatus;
        setBitrixSyncStatus(status);
        bitrixRevisionRef.current = status.revision;
      }
    } catch {
      // Последний успешный снимок остаётся доступен при ошибке статуса.
    }
  }, []);

  useEffect(() => {
    void loadSyncStatus();
    void loadFintabloSyncStatus();
    void loadBitrixSyncStatus();
  }, [loadBitrixSyncStatus, loadFintabloSyncStatus, loadSyncStatus]);

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    let events: EventSource | null = null;
    const handleUpdate = (event: MessageEvent<string>) => {
      try {
        const status = JSON.parse(event.data) as MarketingActualSyncStatus;
        setActualSyncStatus(status);
        if (status.revision <= actualRevisionRef.current) return;
        actualRevisionRef.current = status.revision;
        if (
          stateRef.current.section === "marketing" ||
          stateRef.current.section === "dashboards"
        ) {
          quietRefreshRef.current = stateRef.current.section;
          setRefreshToken((value) => value + 1);
        }
      } catch {
        // Повреждённое SSE-событие будет исправлено следующей ревизией.
      }
    };

    fetch("/api/sync/marketing-actual", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Не удалось получить состояние маркетингового факта.");
        }
        return (await response.json()) as MarketingActualSyncStatus;
      })
      .then((status) => {
        if (cancelled) return;
        setActualSyncStatus(status);
        actualRevisionRef.current = status.revision;
        events = new EventSource(
          `/api/updates/marketing-actual?revision=${status.revision}`,
        );
        events.addEventListener("marketing-actual", handleUpdate);
      })
      .catch(() => {
        if (cancelled) return;
        events = new EventSource("/api/updates/marketing-actual?revision=0");
        events.addEventListener("marketing-actual", handleUpdate);
      });

    return () => {
      cancelled = true;
      events?.close();
    };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    let events: EventSource | null = null;
    const handleUpdate = (event: MessageEvent<string>) => {
      try {
        const status = JSON.parse(event.data) as BitrixSyncStatus;
        setBitrixSyncStatus(status);
        if (status.revision <= bitrixRevisionRef.current) return;
        bitrixRevisionRef.current = status.revision;
        if (
          stateRef.current.section === "sales" ||
          stateRef.current.section === "revenue" ||
          stateRef.current.section === "dashboards"
        ) {
          quietRefreshRef.current = stateRef.current.section;
          setRefreshToken((value) => value + 1);
        }
      } catch {
        // Повреждённое SSE-событие будет исправлено следующей проверкой.
      }
    };

    fetch("/api/sync/bitrix24-sales", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Не удалось получить состояние синхронизации Bitrix24.");
        }
        return (await response.json()) as BitrixSyncStatus;
      })
      .then((status) => {
        if (cancelled) return;
        setBitrixSyncStatus(status);
        bitrixRevisionRef.current = status.revision;
        events = new EventSource(
          `/api/updates/bitrix24-sales?revision=${status.revision}`,
        );
        events.addEventListener("bitrix24-sales", handleUpdate);
      })
      .catch(() => {
        if (cancelled) return;
        events = new EventSource("/api/updates/bitrix24-sales?revision=0");
        events.addEventListener("bitrix24-sales", handleUpdate);
      });

    return () => {
      cancelled = true;
      events?.close();
    };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    let events: EventSource | null = null;
    const handleUpdate = (event: MessageEvent<string>) => {
      try {
        const status = JSON.parse(event.data) as PayrollSyncStatus;
        setPayrollSyncStatus(status);
        if (status.revision <= payrollRevisionRef.current) return;
        payrollRevisionRef.current = status.revision;
        if (stateRef.current.section === "revenue") {
          quietRefreshRef.current = "revenue";
          setRefreshToken((value) => value + 1);
        }
      } catch {
        // Повреждённое SSE-событие будет исправлено следующей проверкой.
      }
    };

    fetch("/api/sync/payroll", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Не удалось получить состояние синхронизации ФОТ.");
        }
        return (await response.json()) as PayrollSyncStatus;
      })
      .then((status) => {
        if (cancelled) return;
        setPayrollSyncStatus(status);
        payrollRevisionRef.current = status.revision;
        events = new EventSource(
          `/api/updates/payroll?revision=${status.revision}`,
        );
        events.addEventListener("payroll", handleUpdate);
      })
      .catch(() => {
        if (cancelled) return;
        events = new EventSource("/api/updates/payroll?revision=0");
        events.addEventListener("payroll", handleUpdate);
      });

    return () => {
      cancelled = true;
      events?.close();
    };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    let events: EventSource | null = null;
    const handleUpdate = (event: MessageEvent<string>) => {
      try {
        const status = JSON.parse(event.data) as FintabloSyncStatus;
        setFintabloSyncStatus(status);
        if (status.revision <= fintabloRevisionRef.current) return;
        fintabloRevisionRef.current = status.revision;
        if (
          stateRef.current.section === "cash-flow" ||
          stateRef.current.section === "dashboards"
        ) {
          quietRefreshRef.current = stateRef.current.section;
          setRefreshToken((value) => value + 1);
        }
      } catch {
        // Повреждённое SSE-событие будет исправлено следующей проверкой.
      }
    };

    fetch("/api/sync/fintablo-cash-flow", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            "Не удалось получить состояние синхронизации ДДС FinTablo.",
          );
        }
        return (await response.json()) as FintabloSyncStatus;
      })
      .then((status) => {
        if (cancelled) return;
        setFintabloSyncStatus(status);
        fintabloRevisionRef.current = status.revision;
        events = new EventSource(
          `/api/updates/fintablo-cash-flow?revision=${status.revision}`,
        );
        events.addEventListener("fintablo-cash-flow", handleUpdate);
      })
      .catch(() => {
        if (cancelled) return;
        events = new EventSource(
          "/api/updates/fintablo-cash-flow?revision=0",
        );
        events.addEventListener("fintablo-cash-flow", handleUpdate);
      });

    return () => {
      cancelled = true;
      events?.close();
    };
  }, [ready]);

  useEffect(() => {
    if (!ready || currentDirections.length === 0) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      from: state.from,
      to: state.to,
      granularity: state.granularity,
      directions: currentDirections.join(","),
    });
    const quiet = quietRefreshRef.current === state.section;
    quietRefreshRef.current = null;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }

    fetch(`/api/dashboard/${state.section}?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as
          | DashboardResponse
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            "error" in payload && payload.error
              ? payload.error
              : "Не удалось загрузить данные.",
          );
        }
        setData(payload as DashboardResponse);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof Error && requestError.name === "AbortError") {
          return;
        }
        if (!quiet) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Не удалось загрузить данные.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && !quiet) setLoading(false);
      });

    return () => controller.abort();
  }, [currentDirections, ready, refreshToken, state]);

  const currentTab = useMemo(
    () => tabs.find((tab) => tab.id === state.section) ?? tabs[0],
    [state.section],
  );

  const update = <Key extends keyof PersistedState>(
    key: Key,
    value: PersistedState[Key],
  ) => setState((current) => ({ ...current, [key]: value }));

  const logout = async () => {
    setLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      router.replace("/login");
      router.refresh();
    } catch {
      setToast("Не удалось выйти из системы. Повторите попытку.");
      setLoggingOut(false);
    }
  };

  const synchronize = async () => {
    setSyncing(true);
    setToast(null);
    const cashFlowSync = state.section === "cash-flow";
    const bitrixSync =
      state.section === "sales" || state.section === "revenue";
    const dashboardSync = state.section === "dashboards";
    try {
      if (dashboardSync) {
        const responses = await Promise.all([
          fetch("/api/sync/bitrix24-sales", { method: "POST" }),
          fetch("/api/sync/fintablo-cash-flow", { method: "POST" }),
        ]);
        const payloads = (await Promise.all(
          responses.map((response) => response.json()),
        )) as Array<{ message?: string; error?: string }>;
        const failedIndex = responses.findIndex(
          (response) => !response.ok && response.status !== 202,
        );
        if (failedIndex >= 0) {
          throw new Error(
            payloads[failedIndex]?.error ??
              "Обновление источников дашборда завершилось ошибкой.",
          );
        }
        await Promise.all([
          loadBitrixSyncStatus(),
          loadFintabloSyncStatus(),
        ]);
        setToast("Обновление источников дашборда запущено.");
        setRefreshToken((value) => value + 1);
        return;
      }
      const response = await fetch(
        cashFlowSync
          ? "/api/sync/fintablo-cash-flow"
          : bitrixSync
            ? "/api/sync/bitrix24-sales"
          : "/api/sync/marketing-plan",
        {
        method: "POST",
        },
      );
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok && response.status !== 202) {
        throw new Error(
          payload.error ??
            (cashFlowSync
              ? "Синхронизация ДДС FinTablo завершилась ошибкой."
              : bitrixSync
                ? "Синхронизация Bitrix24 завершилась ошибкой."
              : "Синхронизация завершилась ошибкой."),
        );
      }
      setToast(
        payload.message ??
          (cashFlowSync
            ? "Синхронизация ДДС FinTablo завершена."
            : bitrixSync
              ? "Синхронизация Bitrix24 завершена."
            : "Синхронизация завершена."),
      );
      if (cashFlowSync) {
        await loadFintabloSyncStatus();
      } else if (bitrixSync) {
        await loadBitrixSyncStatus();
      } else {
        await loadSyncStatus();
      }
      setRefreshToken((value) => value + 1);
    } catch (syncError) {
      setToast(
        syncError instanceof Error
          ? syncError.message
          : cashFlowSync
            ? "Синхронизация ДДС FinTablo завершилась ошибкой."
            : dashboardSync
              ? "Обновление источников дашборда завершилось ошибкой."
              : bitrixSync
              ? "Синхронизация Bitrix24 завершилась ошибкой."
            : "Синхронизация завершилась ошибкой.",
      );
    } finally {
      setSyncing(false);
    }
  };

  const bitrixSalesThrough = bitrixSyncStatus?.maxDate?.slice(0, 7);
  const onlyFutureFact =
    state.section === "sales" &&
    Boolean(bitrixSalesThrough) &&
    state.from > bitrixSalesThrough!;
  const dataNotice = [
    data?.meta.notice,
    state.section === "marketing" && data?.meta.lastSyncAt
      ? `Факт обновлён ${formatDateTime(data.meta.lastSyncAt)}.`
      : null,
    state.section === "marketing" && actualSyncStatus?.error
      ? actualSyncStatus.error
      : null,
    state.section === "revenue" && bitrixSyncStatus?.lastSuccessAt
      ? `Выручка Bitrix24 обновлена ${formatDateTime(bitrixSyncStatus.lastSuccessAt)}.`
      : null,
    state.section === "revenue" && payrollSyncStatus?.lastSuccessAt
      ? `ФОТ обновлён ${formatDateTime(payrollSyncStatus.lastSuccessAt)}.`
      : null,
    state.section === "revenue" && payrollSyncStatus?.error
      ? payrollSyncStatus.error
      : null,
    state.section === "cash-flow" && data?.meta.lastSyncAt
      ? `ДДС FinTablo обновлён ${formatDateTime(data.meta.lastSyncAt)}.`
      : null,
    state.section === "cash-flow" && fintabloSyncStatus?.error
      ? fintabloSyncStatus.error
      : null,
    state.section === "sales" && bitrixSyncStatus?.lastSuccessAt
      ? `Bitrix24 обновлён ${formatDateTime(bitrixSyncStatus.lastSuccessAt)}.`
      : null,
    (state.section === "sales" || state.section === "revenue") &&
    bitrixSyncStatus?.error
      ? bitrixSyncStatus.error
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className="dashboard-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">A</span>
          <div>
            <strong>ATLAS</strong>
            <small>Управленческий дашборд</small>
          </div>
        </div>
        <div className="sync-area">
          <div className="sync-copy">
            <span>
              {state.section === "cash-flow"
                ? "ДДС FinTablo"
                : state.section === "dashboards"
                  ? "Сводные данные"
                : state.section === "sales"
                  ? "Продажи Bitrix24"
                  : state.section === "revenue"
                    ? "Выручка Bitrix24"
                : "Маркетинговый план"}
            </span>
            <small>
              {state.section === "dashboards" ? (
                <>Обновлено {formatDateTime(data?.meta.lastSyncAt)}</>
              ) : state.section === "cash-flow" ? (
                <>
                  Синхронизация{" "}
                  {formatDateTime(fintabloSyncStatus?.lastSuccessAt)}
                  {" · "}
                  {syncStatusLabels[
                    fintabloSyncStatus?.status ?? "NOT_STARTED"
                  ] ?? "неизвестный статус"}
                </>
              ) : state.section === "sales" || state.section === "revenue" ? (
                <>
                  Синхронизация{" "}
                  {formatDateTime(bitrixSyncStatus?.lastSuccessAt)}
                  {" · "}
                  {syncStatusLabels[
                    bitrixSyncStatus?.status ?? "NOT_STARTED"
                  ] ?? "неизвестный статус"}
                </>
              ) : (
                <>
                  Синхронизация{" "}
                  {formatDateTime(
                    syncStatus?.snapshot?.createdAt ??
                      syncStatus?.lastRun?.finishedAt,
                  )}
                </>
              )}
            </small>
          </div>
          {isAdmin ? (
            <>
              <button
                type="button"
                className="icon-button sync-button"
                aria-label={
                  state.section === "cash-flow"
                    ? "Синхронизировать ДДС FinTablo"
                    : state.section === "dashboards"
                      ? "Обновить источники дашборда"
                    : state.section === "sales" ||
                        state.section === "revenue"
                      ? "Синхронизировать продажи Bitrix24"
                    : "Синхронизировать маркетинговый план"
                }
                data-tooltip={
                  state.section === "cash-flow"
                    ? "Обновить ДДС из FinTablo"
                    : state.section === "dashboards"
                      ? "Обновить данные Bitrix24 и FinTablo"
                    : state.section === "sales" ||
                        state.section === "revenue"
                      ? "Обновить данные из Bitrix24"
                    : "Синхронизировать данные"
                }
                disabled={syncing}
                onClick={() => void synchronize()}
              >
                <SyncIcon spinning={syncing} />
              </button>
              <IntegrationSettings
                onDashboardNormsSaved={() =>
                  setRefreshToken((value) => value + 1)
                }
              />
            </>
          ) : null}
          <div className="account-area">
            <span>{isAdmin ? "Администратор" : "Пользователь"}</span>
            <button
              className="logout-button"
              disabled={loggingOut}
              onClick={() => void logout()}
              type="button"
            >
              {loggingOut ? "Выходим…" : "Выйти"}
            </button>
          </div>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Разделы дашборда">
        {tabs.map((tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={state.section === tab.id}
            className={state.section === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => update("section", tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="toolbar" aria-label="Фильтры дашборда">
        {state.section === "cash-flow" ? (
          <DirectionFilter
            value={state.cashFlowDirections}
            options={CASH_FLOW_DIRECTIONS}
            onChange={(cashFlowDirections) =>
              update("cashFlowDirections", cashFlowDirections)
            }
          />
        ) : (
          <DirectionFilter
            value={state.directions}
            options={DIRECTIONS}
            onChange={(directions) => update("directions", directions)}
          />
        )}
        <PeriodPicker
          from={state.from}
          to={state.to}
          onChange={(period) =>
            setState((current) => ({ ...current, ...period }))
          }
        />
        <GranularityControl
          value={state.granularity}
          onChange={(granularity) => update("granularity", granularity)}
        />
      </section>

      <section className="page-intro reveal">
        <div>
          <span className="eyebrow">Atlas · 2026</span>
          <h1>{currentTab.title}</h1>
          <p>{currentTab.description}</p>
        </div>
        {dataNotice ? <p className="data-notice">{dataNotice}</p> : null}
      </section>

      {currentDirections.length === 0 ? (
        <EmptyState
          title="Выберите хотя бы одно направление"
          text="Данные появятся после выбора направления в фильтре."
        />
      ) : onlyFutureFact ? (
        <EmptyState
          title="Фактических данных за этот период ещё нет"
          text={`Воронка доступна по ${bitrixSalesThrough}. Выручка по оплаченным сделкам может быть доступна позднее во вкладке «Выручка и ФОТ».`}
        />
      ) : loading ? (
        <LoadingState />
      ) : error ? (
        <EmptyState
          title="Не удалось загрузить данные"
          text={error}
          action={
            <button type="button" onClick={() => setRefreshToken((value) => value + 1)}>
              Повторить
            </button>
          }
        />
      ) : data ? (
        state.section === "dashboards" &&
        data.managementMetrics &&
        data.managementInputs ? (
          <ManagementDashboard
            metrics={data.managementMetrics}
            inputs={data.managementInputs}
          />
        ) : (
          <>
            <KpiGrid kpis={data.kpis} marketing={state.section === "marketing"} />
            <SectionContent section={state.section} data={data} />
          </>
        )
      ) : null}

      <footer className="app-footer">
        <span>Atlas</span>
        <span>Данные обновляются из подключённых источников</span>
      </footer>

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </main>
  );
}

function LoadingState() {
  return (
    <div className="loading-state" aria-label="Загрузка данных">
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="empty-state">
      <span className="empty-symbol" aria-hidden="true">A</span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </section>
  );
}
