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
import { flushSync } from "react-dom";

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
import {
  buildLiveKpis,
  buildLiveManagementInputs,
  buildLiveManagementMetrics,
} from "@/lib/atlas-live";
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
  const shellRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<PersistedState>(defaultState);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
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
  const [theme, setTheme] = useState<"day" | "night">("day");
  const [presentationMode, setPresentationMode] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [livePlaying, setLivePlaying] = useState(false);
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const [activeMetricKey, setActiveMetricKey] = useState<string | null>(null);
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
      if (localStorage.getItem("atlas-dashboard-theme") === "night") {
        setTheme("night");
      }
    } catch {
      localStorage.removeItem("atlas-dashboard-filters");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.atlasTheme = theme;
    localStorage.setItem("atlas-dashboard-theme", theme);
    return () => {
      delete document.documentElement.dataset.atlasTheme;
    };
  }, [theme]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) setPresentationMode(false);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
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

  const seriesLength = data?.series.length ?? 0;
  const safeActivePoint =
    activePointIndex === null || seriesLength === 0
      ? null
      : Math.min(activePointIndex, seriesLength - 1);
  const livePoint =
    liveMode && safeActivePoint !== null
      ? (data?.series[safeActivePoint] ?? null)
      : null;
  const previousLivePoint =
    livePoint && safeActivePoint !== null && safeActivePoint > 0
      ? (data?.series[safeActivePoint - 1] ?? null)
      : null;
  const visibleKpis =
    data && livePoint
      ? buildLiveKpis(
          state.section,
          data.kpis,
          livePoint,
          previousLivePoint,
        )
      : (data?.kpis ?? []);
  const activePointLabel =
    safeActivePoint === null
      ? "Обзор"
      : String(
          data?.series[safeActivePoint]?.label ?? "Обзор",
        );

  useEffect(() => {
    if (!liveMode || !livePlaying || seriesLength < 2) return;
    const interval = window.setInterval(() => {
      setActivePointIndex((current) =>
        current === null ? 0 : (current + 1) % seriesLength,
      );
    }, 1_350);
    return () => window.clearInterval(interval);
  }, [liveMode, livePlaying, seriesLength]);

  useEffect(() => {
    setActivePointIndex((current) =>
      current === null || seriesLength === 0
        ? liveMode && seriesLength > 0
          ? 0
          : null
        : Math.min(current, seriesLength - 1),
    );
  }, [liveMode, seriesLength, state.section]);

  useEffect(() => {
    setActiveMetricKey(null);
  }, [state.section]);

  const changeTheme = (
    nextTheme: "day" | "night",
    origin?: HTMLElement,
  ) => {
    if (nextTheme === theme) return;
    const rect = origin?.getBoundingClientRect();
    document.documentElement.style.setProperty(
      "--theme-origin-x",
      `${rect ? rect.left + rect.width / 2 : window.innerWidth / 2}px`,
    );
    document.documentElement.style.setProperty(
      "--theme-origin-y",
      `${rect ? rect.top + rect.height / 2 : window.innerHeight / 2}px`,
    );
    const transitionDocument = document as Document & {
      startViewTransition?: (update: () => void) => unknown;
    };
    if (
      transitionDocument.startViewTransition &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      transitionDocument.startViewTransition(() => {
        flushSync(() => setTheme(nextTheme));
      });
      return;
    }
    setTheme(nextTheme);
  };

  const togglePresentation = async () => {
    if (presentationMode) {
      setPresentationMode(false);
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => undefined);
      }
      return;
    }
    setPresentationMode(true);
    await shellRef.current?.requestFullscreen().catch(() => undefined);
  };

  const startAtlasLive = async (origin: HTMLElement) => {
    if (liveMode) {
      setLiveMode(false);
      setLivePlaying(false);
      setActivePointIndex(null);
      return;
    }
    changeTheme("night", origin);
    setLiveMode(true);
    setLivePlaying(true);
    setActivePointIndex(0);
    if (!presentationMode) await togglePresentation();
  };

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

  const exportTable = async () => {
    if (!data || state.section === "dashboards") return;

    const section = state.section;
    const params = new URLSearchParams({
      from: state.from,
      to: state.to,
      granularity: state.granularity,
      directions: currentDirections.join(","),
    });
    setExporting(true);
    setToast(null);

    try {
      const response = await fetch(
        `/api/export/dashboard/${section}?${params}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          payload.error ?? "Не удалось сформировать Excel-файл.",
        );
      }

      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `atlas-${section}-${state.from}_${state.to}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setToast("Таблица выгружена в Excel.");
    } catch (exportError) {
      setToast(
        exportError instanceof Error
          ? exportError.message
          : "Не удалось сформировать Excel-файл.",
      );
    } finally {
      setExporting(false);
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
    <main
      className={`dashboard-shell${presentationMode ? " presentation-mode" : ""}${liveMode ? " atlas-live-active" : ""}`}
      data-theme={theme}
      ref={shellRef}
    >
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
          <div className="atlas-view-actions" aria-label="Режимы отображения">
            <button
              type="button"
              className="icon-button"
              aria-label={
                theme === "day"
                  ? "Включить ночную тему"
                  : "Включить светлую тему"
              }
              data-tooltip={theme === "day" ? "Ночная тема" : "Светлая тема"}
              onClick={(event) =>
                changeTheme(
                  theme === "day" ? "night" : "day",
                  event.currentTarget,
                )
              }
            >
              <ThemeIcon night={theme === "night"} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={
                presentationMode
                  ? "Выйти из режима презентации"
                  : "Открыть режим презентации"
              }
              data-tooltip={
                presentationMode ? "Выйти из презентации" : "Режим презентации"
              }
              aria-pressed={presentationMode}
              onClick={() => void togglePresentation()}
            >
              <PresentationIcon active={presentationMode} />
            </button>
            <button
              type="button"
              className={`live-launch-button${liveMode ? " active" : ""}`}
              aria-label={liveMode ? "Завершить Atlas Live" : "Запустить Atlas Live"}
              aria-pressed={liveMode}
              disabled={!data || seriesLength === 0}
              onClick={(event) => void startAtlasLive(event.currentTarget)}
            >
              <PlayIcon playing={liveMode && livePlaying} />
              <span>Atlas Live</span>
            </button>
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
                onPayrollImported={() => {
                  void fetch("/api/sync/payroll", { cache: "no-store" })
                    .then(async (response) => {
                      if (!response.ok) return;
                      const status =
                        (await response.json()) as PayrollSyncStatus;
                      setPayrollSyncStatus(status);
                      payrollRevisionRef.current = status.revision;
                    })
                    .catch(() => undefined);
                  if (stateRef.current.section === "revenue") {
                    setRefreshToken((value) => value + 1);
                  }
                }}
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

      <div
        className={`dashboard-stage${activeMetricKey ? " has-metric-focus" : ""}`}
        key={`${state.section}-${state.from}-${state.to}-${state.granularity}-${refreshToken}`}
      >
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
            metrics={
              livePoint
                ? buildLiveManagementMetrics(
                    data.managementMetrics,
                    livePoint,
                  )
                : data.managementMetrics
            }
            inputs={
              livePoint
                ? buildLiveManagementInputs(data.managementInputs, livePoint)
                : data.managementInputs
            }
            activeMetricKey={activeMetricKey}
            onMetricFocus={setActiveMetricKey}
          />
        ) : (
          <>
            <KpiGrid
              kpis={visibleKpis}
              marketing={state.section === "marketing"}
              activeMetricKey={activeMetricKey}
              onMetricFocus={setActiveMetricKey}
            />
            <SectionContent
              section={state.section}
              data={data}
              exporting={exporting}
              activePointIndex={safeActivePoint}
              activeMetricKey={activeMetricKey}
              lockCursor={liveMode}
              onExport={() => void exportTable()}
              onPointChange={setActivePointIndex}
              onMetricFocus={setActiveMetricKey}
            />
          </>
        )
      ) : null}
      </div>

      {liveMode && seriesLength > 0 ? (
        <aside className="atlas-live-console" aria-label="Управление Atlas Live">
          <div className="atlas-live-status">
            <span>Atlas Live</span>
            <strong>{activePointLabel}</strong>
          </div>
          <button
            type="button"
            className="atlas-live-control"
            aria-label="Предыдущий период"
            onClick={() => {
              setLivePlaying(false);
              setActivePointIndex((current) =>
                current === null ? 0 : (current - 1 + seriesLength) % seriesLength,
              );
            }}
          >
            <StepIcon direction="previous" />
          </button>
          <button
            type="button"
            className="atlas-live-control primary"
            aria-label={livePlaying ? "Приостановить" : "Продолжить"}
            onClick={() => setLivePlaying((current) => !current)}
          >
            <PlayIcon playing={livePlaying} />
          </button>
          <button
            type="button"
            className="atlas-live-control"
            aria-label="Следующий период"
            onClick={() => {
              setLivePlaying(false);
              setActivePointIndex((current) =>
                current === null ? 0 : (current + 1) % seriesLength,
              );
            }}
          >
            <StepIcon direction="next" />
          </button>
          <label
            className="atlas-live-timeline"
            style={{
              "--live-progress": `${
                seriesLength <= 1
                  ? 100
                  : ((safeActivePoint ?? 0) / (seriesLength - 1)) * 100
              }%`,
            } as React.CSSProperties}
          >
            <span className="visually-hidden">Период Atlas Live</span>
            <input
              type="range"
              min="0"
              max={Math.max(seriesLength - 1, 0)}
              value={safeActivePoint ?? 0}
              onChange={(event) => {
                setLivePlaying(false);
                setActivePointIndex(Number(event.target.value));
              }}
            />
          </label>
          <span className="atlas-live-counter">
            {String((safeActivePoint ?? 0) + 1).padStart(2, "0")} /{" "}
            {String(seriesLength).padStart(2, "0")}
          </span>
          <button
            type="button"
            className="atlas-live-close"
            aria-label="Завершить Atlas Live"
            onClick={() => {
              setLiveMode(false);
              setLivePlaying(false);
              setActivePointIndex(null);
            }}
          >
            Завершить
          </button>
        </aside>
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

function ThemeIcon({ night }: { night: boolean }) {
  return night ? (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M19.5 15.2A8 8 0 0 1 8.8 4.5 8 8 0 1 0 19.5 15.2Z" />
    </svg>
  );
}

function PresentationIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      {active ? (
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      ) : (
        <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
      )}
    </svg>
  );
}

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" fill="currentColor" aria-hidden="true">
      {playing ? (
        <path d="M5 4h3v12H5zM12 4h3v12h-3z" />
      ) : (
        <path d="m6 4 10 6-10 6z" />
      )}
    </svg>
  );
}

function StepIcon({ direction }: { direction: "previous" | "next" }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
      {direction === "previous" ? (
        <path d="M4 4h2v12H4zm3 6 9-6v12z" />
      ) : (
        <path d="M14 4h2v12h-2zm-1 6-9 6V4z" />
      )}
    </svg>
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
