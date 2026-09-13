"use client";

import { useEffect, useState, type FormEvent } from "react";

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

export function IntegrationSettings() {
  const [open, setOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [connection, setConnection] = useState<ConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !checking) setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [checking, open]);

  const showSettings = async () => {
    setOpen(true);
    setConnection(null);
    setError(null);
    try {
      const response = await fetch("/api/integrations/bitrix24", {
        cache: "no-store",
      });
      if (response.ok) {
        setStatus((await response.json()) as IntegrationStatus);
      }
    } catch {
      setStatus(null);
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
        data-tooltip="Настройки интеграций"
        onClick={() => void showSettings()}
      >
        <SettingsIcon />
      </button>

      {open ? (
        <div
          className="settings-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !checking) {
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
                <span className="eyebrow">Atlas · Интеграции</span>
                <h2 id="settings-title">Настройки</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Закрыть настройки"
                disabled={checking}
                onClick={() => setOpen(false)}
              >
                <CloseIcon />
              </button>
            </header>

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

