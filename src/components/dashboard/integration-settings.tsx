"use client";

import { useEffect, useState, type FormEvent } from "react";

import { PayrollUpload } from "@/components/dashboard/payroll-upload";

type IntegrationStatus = {
  configured: boolean;
  portal: string | null;
};

type ConnectionResult = {
  connected: true;
  persistent: boolean;
  portal: string;
  user: {
    id: string;
    name: string;
  };
  funnelCount: number;
  dealCount: number;
};

type SettingsSection = "integrations" | "norms" | "payroll";

type DashboardNorms = {
  roas: number;
  cac: number;
  grossProfitPerLead: number;
  cashConversion: number;
  updatedAt: string | null;
};

const defaultNorms: DashboardNorms = {
  roas: 12,
  cac: 42_000,
  grossProfitPerLead: 20_000,
  cashConversion: 0.9,
  updatedAt: null,
};

export function IntegrationSettings({
  onDashboardNormsSaved,
  onPayrollImported,
}: {
  onDashboardNormsSaved?: () => void;
  onPayrollImported?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("integrations");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [connection, setConnection] = useState<ConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [norms, setNorms] = useState(defaultNorms);
  const [savingNorms, setSavingNorms] = useState(false);
  const [normError, setNormError] = useState<string | null>(null);
  const [normSaved, setNormSaved] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !checking &&
        !savingNorms &&
        !uploadBusy
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [checking, open, savingNorms, uploadBusy]);

  const showSettings = async () => {
    setOpen(true);
    setConnection(null);
    setError(null);
    setNormError(null);
    setNormSaved(false);
    try {
      const [integrationResponse, normsResponse] = await Promise.all([
        fetch("/api/integrations/bitrix24", { cache: "no-store" }),
        fetch("/api/settings/dashboard-norms", { cache: "no-store" }),
      ]);
      if (integrationResponse.ok) {
        setStatus((await integrationResponse.json()) as IntegrationStatus);
      }
      if (normsResponse.ok) {
        setNorms((await normsResponse.json()) as DashboardNorms);
      }
    } catch {
      setStatus(null);
    }
  };

  const saveNorms = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingNorms(true);
    setNormError(null);
    setNormSaved(false);
    try {
      const response = await fetch("/api/settings/dashboard-norms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roas: norms.roas,
          cac: norms.cac,
          grossProfitPerLead: norms.grossProfitPerLead,
          cashConversion: norms.cashConversion,
        }),
      });
      const payload = (await response.json()) as
        | DashboardNorms
        | { error?: string };
      if (!response.ok || !("roas" in payload)) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "Не удалось сохранить нормативы.",
        );
      }
      setNorms(payload);
      setNormSaved(true);
      onDashboardNormsSaved?.();
    } catch (saveError) {
      setNormError(
        saveError instanceof Error
          ? saveError.message
          : "Не удалось сохранить нормативы.",
      );
    } finally {
      setSavingNorms(false);
    }
  };

  const checkConnection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecking(true);
    setConnection(null);
    setError(null);

    try {
      const response = await fetch("/api/integrations/bitrix24", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : {},
        ),
      });
      const payload = (await response.json()) as
        | ConnectionResult
        | { error?: string };
      if (!response.ok || !("connected" in payload)) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "Проверка связи с Bitrix24 завершилась ошибкой.",
        );
      }

      setConnection(payload);
      setWebhookUrl("");
      if (payload.persistent) {
        setStatus({ configured: true, portal: payload.portal });
      }
    } catch (connectionError) {
      setError(
        connectionError instanceof Error
          ? connectionError.message
          : "Проверка связи с Bitrix24 завершилась ошибкой.",
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="icon-button settings-button"
        aria-label="Открыть настройки"
        aria-haspopup="dialog"
        data-tooltip="Настройки и нормативы"
        onClick={() => void showSettings()}
      >
        <SettingsIcon />
      </button>

      {open ? (
        <div
          className="settings-backdrop"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !checking &&
              !savingNorms &&
              !uploadBusy
            ) {
              setOpen(false);
            }
          }}
        >
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <header className="settings-dialog-header">
              <div>
                <span className="eyebrow">Atlas · Конфигурация</span>
                <h2 id="settings-title">Настройки</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Закрыть настройки"
                disabled={checking || savingNorms || uploadBusy}
                onClick={() => setOpen(false)}
              >
                <CloseIcon />
              </button>
            </header>

            <nav className="settings-section-tabs" aria-label="Разделы настроек">
              <button
                type="button"
                disabled={uploadBusy}
                className={section === "integrations" ? "active" : ""}
                onClick={() => setSection("integrations")}
              >
                Интеграции
              </button>
              <button
                type="button"
                disabled={uploadBusy}
                className={section === "norms" ? "active" : ""}
                onClick={() => setSection("norms")}
              >
                Нормативы
              </button>
              <button
                type="button"
                disabled={uploadBusy}
                className={section === "payroll" ? "active" : ""}
                onClick={() => setSection("payroll")}
              >
                Начисления ФОТ
              </button>
            </nav>

            {section === "integrations" ? (
              <form className="integration-form" onSubmit={checkConnection}>
              <div className="integration-heading">
                <div>
                  <span className="integration-index">01</span>
                  <h3>Bitrix24</h3>
                </div>
                <span
                  className={`integration-state ${
                    status?.configured ? "configured" : ""
                  }`}
                >
                  {status?.configured ? "Настроено" : "Не настроено"}
                </span>
              </div>

              <p className="integration-description">
                Входящий вебхук с правом «CRM» даст Atlas доступ только в
                пределах прав пользователя, который его создал.
              </p>

              {status?.configured ? (
                <p className="configured-portal">
                  Постоянное подключение: {status.portal ?? "URL требует проверки"}
                </p>
              ) : null}

              <label className="settings-field">
                <span>Вебхук Bitrix24</span>
                <input
                  type="password"
                  name="bitrix24-webhook"
                  value={webhookUrl}
                  placeholder="https://портал.bitrix24.ru/rest/1/секрет/"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                />
              </label>

              <p className="settings-note">
                Вставьте базовый URL без имени REST-метода. Значение передаётся
                серверу только для проверки и очищается из формы после успеха.
                Для постоянной работы задайте его в переменной окружения
                <code>BITRIX24_WEBHOOK_URL</code> и перезапустите Atlas.
              </p>

              {connection ? (
                <div className="connection-result success" role="status">
                  <strong>Связь установлена</strong>
                  <span>
                    {connection.portal} · {connection.user.name}
                  </span>
                  <dl>
                    <div>
                      <dt>Воронки</dt>
                      <dd>{connection.funnelCount}</dd>
                    </div>
                    <div>
                      <dt>Сделки</dt>
                      <dd>{connection.dealCount}</dd>
                    </div>
                  </dl>
                  {!connection.persistent ? (
                    <small>
                      Проверка пройдена. Для синхронизации сохраните URL в
                      переменной окружения.
                    </small>
                  ) : null}
                </div>
              ) : null}

              {error ? (
                <div className="connection-result error" role="alert">
                  <strong>Связь не установлена</strong>
                  <span>{error}</span>
                </div>
              ) : null}

              <div className="settings-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={checking}
                  onClick={() => setOpen(false)}
                >
                  Закрыть
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={
                    checking || (!webhookUrl.trim() && !status?.configured)
                  }
                >
                  {checking ? "Проверяем…" : "Проверить связь"}
                </button>
              </div>
              </form>
            ) : section === "norms" ? (
              <form className="integration-form" onSubmit={saveNorms}>
                <div className="integration-heading">
                  <div>
                    <span className="integration-index">02</span>
                    <h3>Нормативы дашборда</h3>
                  </div>
                  <span className="integration-state configured">
                    Стартовые значения
                  </span>
                </div>

                <p className="integration-description">
                  Факт меняется вместе с периодом и направлениями. Для CAC
                  меньше нормы — лучше; для остальных показателей — больше.
                </p>

                <div className="norm-settings-list">
                  <label className="norm-settings-row">
                    <span>
                      <strong>ROAS</strong>
                      <small>Минимальная окупаемость рекламных затрат</small>
                    </span>
                    <span className="norm-input">
                      <input
                        type="number"
                        min="0.1"
                        max="1000"
                        step="0.1"
                        required
                        value={norms.roas}
                        onChange={(event) =>
                          setNorms((current) => ({
                            ...current,
                            roas: event.target.valueAsNumber,
                          }))
                        }
                      />
                      <b>×</b>
                    </span>
                  </label>

                  <label className="norm-settings-row">
                    <span>
                      <strong>CAC</strong>
                      <small>Максимальная стоимость одной полученной оплаты</small>
                    </span>
                    <span className="norm-input">
                      <input
                        type="number"
                        min="1"
                        max="1000000000"
                        step="1"
                        required
                        value={norms.cac}
                        onChange={(event) =>
                          setNorms((current) => ({
                            ...current,
                            cac: event.target.valueAsNumber,
                          }))
                        }
                      />
                      <b>₽</b>
                    </span>
                  </label>

                  <label className="norm-settings-row">
                    <span>
                      <strong>Валовая прибыль на 1 лида</strong>
                      <small>Минимальная прибыль после оплаты подрядчиков</small>
                    </span>
                    <span className="norm-input">
                      <input
                        type="number"
                        min="1"
                        max="1000000000"
                        step="1"
                        required
                        value={norms.grossProfitPerLead}
                        onChange={(event) =>
                          setNorms((current) => ({
                            ...current,
                            grossProfitPerLead: event.target.valueAsNumber,
                          }))
                        }
                      />
                      <b>₽</b>
                    </span>
                  </label>

                  <label className="norm-settings-row">
                    <span>
                      <strong>Cash Conversion</strong>
                      <small>Минимальная доля выручки, поступившая деньгами</small>
                    </span>
                    <span className="norm-input">
                      <input
                        type="number"
                        min="1"
                        max="200"
                        step="1"
                        required
                        value={Number((norms.cashConversion * 100).toFixed(2))}
                        onChange={(event) =>
                          setNorms((current) => ({
                            ...current,
                            cashConversion: event.target.valueAsNumber / 100,
                          }))
                        }
                      />
                      <b>%</b>
                    </span>
                  </label>
                </div>

                <p className="norm-settings-note">
                  Первичная настройка: ROAS 12×, CAC не выше 42 000 ₽, прибыль
                  на лида не ниже 20 000 ₽ и Cash Conversion не ниже 90%.
                </p>

                {normSaved ? (
                  <div className="connection-result success" role="status">
                    <strong>Нормативы сохранены</strong>
                    <span>Значения на вкладке «Дашборды» пересчитаны.</span>
                  </div>
                ) : null}

                {normError ? (
                  <div className="connection-result error" role="alert">
                    <strong>Нормативы не сохранены</strong>
                    <span>{normError}</span>
                  </div>
                ) : null}

                <div className="settings-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={savingNorms}
                    onClick={() => setOpen(false)}
                  >
                    Закрыть
                  </button>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={savingNorms}
                  >
                    {savingNorms ? "Сохраняем…" : "Сохранить нормативы"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="integration-form">
                <div className="integration-heading">
                  <div>
                    <span className="integration-index">03</span>
                    <h3>Загрузка начислений ФОТ</h3>
                  </div>
                  <span className="integration-state configured">XLSX</span>
                </div>

                <p className="integration-description">
                  Загрузите книгу вручную. Atlas добавит новые месяцы, пропустит
                  полные повторы и попросит подтвердить любые расхождения с уже
                  сохранёнными данными.
                </p>

                <PayrollUpload
                  onBusyChange={setUploadBusy}
                  onImported={() => onPayrollImported?.()}
                />

                <div className="settings-actions payroll-close-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={uploadBusy}
                    onClick={() => setOpen(false)}
                  >
                    Закрыть
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="2.5" fill="none" stroke="currentColor" />
      <path
        d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="square"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 3l10 10M13 3L3 13"
        fill="none"
        stroke="currentColor"
        strokeLinecap="square"
      />
    </svg>
  );
}
