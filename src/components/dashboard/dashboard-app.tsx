"use client";

/* eslint-disable react-hooks/set-state-in-effect -- Эффекты загружают состояние из localStorage и серверного API. */

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

export function DashboardApp() {
  const [state, setState] = useState<PersistedState>(defaultState);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [actualSyncStatus, setActualSyncStatus] =
    useState<MarketingActualSyncStatus | null>(null);
  const [payrollSyncStatus, setPayrollSyncStatus] =
    useState<PayrollSyncStatus | null>(null);
  const [fintabloSyncStatus, setFintabloSyncStatus] =
    useState<FintabloSyncStatus | null>(null);
  const stateRef = useRef(state);
  const actualRevisionRef = useRef(0);
  const payrollRevisionRef = useRef(0);
  const fintabloRevisionRef = useRef(0);
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

  useEffect(() => {
    void loadSyncStatus();
    void loadFintabloSyncStatus();
  }, [loadFintabloSyncStatus, loadSyncStatus]);

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
        if (stateRef.current.section === "marketing") {
          quietRefreshRef.current = "marketing";
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
        if (stateRef.current.section === "cash-flow") {
          quietRefreshRef.current = "cash-flow";
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

  const synchronize = async () => {
    setSyncing(true);
    setToast(null);
    const cashFlowSync = state.section === "cash-flow";
    try {
      const response = await fetch(
        cashFlowSync
          ? "/api/sync/fintablo-cash-flow"
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
              : "Синхронизация завершилась ошибкой."),
        );
      }
      setToast(
        payload.message ??
          (cashFlowSync
            ? "Синхронизация ДДС FinTablo завершена."
            : "Синхронизация завершена."),
      );
      if (cashFlowSync) {
        await loadFintabloSyncStatus();
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
            : "Синхронизация завершилась ошибкой.",
      );
    } finally {
      setSyncing(false);
    }
  };

  const onlyFutureFact =
    state.section !== "marketing" &&
    state.section !== "revenue" &&
    state.section !== "cash-flow" &&
    state.from > "2026-08";
  const dataNotice = [
    data?.meta.notice,
    state.section === "marketing" && data?.meta.lastSyncAt
      ? `Факт обновлён ${formatDateTime(data.meta.lastSyncAt)}.`
      : null,
    state.section === "marketing" && actualSyncStatus?.error
      ? actualSyncStatus.error
      : null,
    state.section === "revenue" && data?.meta.lastSyncAt
      ? `ФОТ обновлён ${formatDateTime(data.meta.lastSyncAt)}.`
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
                : "Маркетинговый план"}
            </span>
            <small>
              {state.section === "cash-flow" ? (
                <>
                  Синхронизация{" "}
                  {formatDateTime(fintabloSyncStatus?.lastSuccessAt)}
                  {" · "}
                  {syncStatusLabels[
                    fintabloSyncStatus?.status ?? "NOT_STARTED"
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
          <button
            type="button"
            className="icon-button sync-button"
            aria-label={
              state.section === "cash-flow"
                ? "Синхронизировать ДДС FinTablo"
                : "Синхронизировать маркетинговый план"
            }
            data-tooltip={
              state.section === "cash-flow"
                ? "Обновить ДДС из FinTablo"
                : "Синхронизировать данные"
            }
            disabled={syncing}
            onClick={() => void synchronize()}
          >
            <SyncIcon spinning={syncing} />
          </button>
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
          text="Факт доступен с января по август 2026 года. План будущих месяцев находится во вкладке «Маркетинг»."
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
        <>
          <KpiGrid kpis={data.kpis} marketing={state.section === "marketing"} />
          <SectionContent section={state.section} data={data} />
        </>
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
