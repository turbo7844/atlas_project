"use client";

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import { MONTHS } from "@/lib/constants";
import {
  PAYROLL_VALUE_FIELDS,
  type PayrollConflictResolution,
  type PayrollImportConfirmation,
  type PayrollImportResponse,
  type PayrollImportSuccess,
  type PayrollValueField,
} from "@/types/payroll-import";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const fieldLabels: Record<PayrollValueField, string> = {
  salary: "Оклад",
  vacationPay: "Отпускные",
  bonus: "Премия",
  salesBonus: "Бонус от продаж",
};

function periodLabel(year: number, month: number) {
  return `${MONTHS[month - 1] ?? month} ${year}`;
}

function periodRange(from: string | null, to: string | null) {
  if (!from || !to) return "периоды не определены";
  const format = (value: string) => {
    const [year, month] = value.split("-").map(Number);
    return periodLabel(year, month);
  };
  return from === to ? format(from) : `${format(from)} — ${format(to)}`;
}

function formatMoney(value: string) {
  return money.format(Number(value));
}

function isImportResponse(value: unknown): value is PayrollImportResponse {
  if (!value || typeof value !== "object") return false;
  const status = (value as Record<string, unknown>).status;
  return status === "needs_confirmation" || status === "imported";
}

export function PayrollUpload({
  onImported,
  onBusyChange,
}: {
  onImported?: (result: PayrollImportSuccess) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confirmation, setConfirmation] =
    useState<PayrollImportConfirmation | null>(null);
  const [decisions, setDecisions] = useState<
    Record<string, PayrollConflictResolution>
  >({});
  const [result, setResult] = useState<PayrollImportSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      onBusyChange?.(false);
    },
    [onBusyChange],
  );

  const updateBusy = (value: boolean) => {
    setBusy(value);
    onBusyChange?.(value);
  };

  const sendFile = async (
    selectedFile: File,
    selectedDecisions: Record<string, PayrollConflictResolution> = {},
  ) => {
    updateBusy(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const conflictByKey = new Map(
        confirmation?.conflicts.map((conflict) => [conflict.key, conflict]),
      );
      const answers = Object.entries(selectedDecisions)
        .map(([key, resolution]) => {
          const conflict = conflictByKey.get(key);
          return conflict
            ? { key, fingerprint: conflict.fingerprint, resolution }
            : null;
        })
        .filter((answer) => answer !== null);
      if (answers.length) {
        formData.append("decisions", JSON.stringify(answers));
      }

      const response = await fetch("/api/import/payroll", {
        method: "POST",
        body: formData,
      });
      const payload: unknown = await response.json();
      if (isImportResponse(payload) && payload.status === "needs_confirmation") {
        setConfirmation(payload);
        setDecisions({});
        return;
      }
      if (
        !response.ok ||
        !isImportResponse(payload) ||
        payload.status !== "imported"
      ) {
        const message =
          payload &&
          typeof payload === "object" &&
          typeof (payload as Record<string, unknown>).error === "string"
            ? String((payload as Record<string, unknown>).error)
            : "Не удалось загрузить файл с начислениями.";
        throw new Error(message);
      }

      setConfirmation(null);
      setDecisions({});
      setResult(payload);
      onImported?.(payload);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Не удалось загрузить файл с начислениями.",
      );
    } finally {
      updateBusy(false);
    }
  };

  const selectFile = (selectedFile: File) => {
    setConfirmation(null);
    setDecisions({});
    setResult(null);
    setError(null);
    if (!selectedFile.name.toLocaleLowerCase("ru-RU").endsWith(".xlsx")) {
      setFile(null);
      setError("Выберите файл в формате .xlsx.");
      return;
    }
    if (selectedFile.size === 0) {
      setFile(null);
      setError("Выбранный файл пуст.");
      return;
    }
    if (selectedFile.size > MAX_FILE_SIZE) {
      setFile(null);
      setError("Размер файла не должен превышать 20 МБ.");
      return;
    }
    setFile(selectedFile);
    void sendFile(selectedFile);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const selectedFile = event.dataTransfer.files[0];
    if (selectedFile) selectFile(selectedFile);
  };

  const openFileDialog = () => {
    if (!busy) inputRef.current?.click();
  };

  const handleDropzoneKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openFileDialog();
  };

  const setAllDecisions = (resolution: PayrollConflictResolution) => {
    if (!confirmation) return;
    setDecisions(
      Object.fromEntries(
        confirmation.conflicts.map((conflict) => [
          conflict.key,
          resolution,
        ]),
      ),
    );
  };

  const answeredCount = confirmation
    ? confirmation.conflicts.filter((conflict) => decisions[conflict.key])
        .length
    : 0;
  const allAnswered =
    confirmation !== null &&
    answeredCount === confirmation.conflicts.length;

  return (
    <div className="payroll-upload">
      <div
        className={`payroll-dropzone${dragging ? " dragging" : ""}${
          busy ? " busy" : ""
        }`}
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-disabled={busy}
        aria-label="Выбрать или перетащить XLSX-файл с начислениями"
        onClick={openFileDialog}
        onKeyDown={handleDropzoneKeyDown}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false);
          }
        }}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={busy}
          onChange={(event) => {
            const selectedFile = event.target.files?.[0];
            event.target.value = "";
            if (selectedFile) selectFile(selectedFile);
          }}
        />
        <UploadIcon />
        <strong>{busy ? "Проверяем файл…" : "Перетащите XLSX сюда"}</strong>
        <span>или нажмите, чтобы выбрать файл · до 20 МБ</span>
        {file ? <small>Выбран: {file.name}</small> : null}
      </div>

      <div className="payroll-format-note">
        <strong>Требования к файлу</strong>
        <span>
          Формат должен совпадать с исходной книгой: ФИО, должность,
          направление и блок из четырёх начислений на каждый месяц. Количество
          месяцев не ограничено. Сам файл не сохраняется — в базу попадают
          только рассчитанные месячные показатели.
        </span>
      </div>

      {error ? (
        <div className="connection-result error" role="alert">
          <strong>Файл не загружен</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {result ? (
        <div className="connection-result success" role="status">
          <strong>{result.message}</strong>
          <span>
            Проверено агрегатов: {result.aggregateCount}. Повторов пропущено:{" "}
            {result.duplicateCount}. Оставлено без изменений: {result.keptCount}.
          </span>
          <dl>
            <div>
              <dt>Добавлено</dt>
              <dd>{result.insertedCount}</dd>
            </div>
            <div>
              <dt>Обновлено</dt>
              <dd>{result.updatedCount}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      {confirmation ? (
        <section
          className="payroll-confirmation"
          aria-labelledby="payroll-confirmation-title"
        >
          <div className="payroll-confirmation-heading">
            <div>
              <span className="integration-index">Проверка расхождений</span>
              <h4 id="payroll-confirmation-title">
                Подтвердите данные за загруженные периоды
              </h4>
            </div>
            <strong>
              {answeredCount} / {confirmation.conflicts.length}
            </strong>
          </div>
          <p>{confirmation.message}</p>

          <dl className="payroll-preview-summary">
            <div>
              <dt>Период</dt>
              <dd>
                {periodRange(
                  confirmation.summary.earliestPeriod,
                  confirmation.summary.latestPeriod,
                )}
              </dd>
            </div>
            <div>
              <dt>Новые строки</dt>
              <dd>{confirmation.summary.newCount}</dd>
            </div>
            <div>
              <dt>Повторы</dt>
              <dd>{confirmation.summary.duplicateCount}</dd>
            </div>
            <div>
              <dt>Расхождения</dt>
              <dd>{confirmation.summary.conflictCount}</dd>
            </div>
          </dl>

          <div className="payroll-bulk-decisions">
            <span>Ответить для всех:</span>
            <button type="button" onClick={() => setAllDecisions("keep")}>
              Оставить текущие
            </button>
            <button type="button" onClick={() => setAllDecisions("replace")}>
              Использовать файл
            </button>
          </div>

          <div className="payroll-conflict-list">
            {confirmation.conflicts.map((conflict, conflictIndex) => (
              <fieldset className="payroll-conflict" key={conflict.key}>
                <legend>
                  {String(conflictIndex + 1).padStart(2, "0")} ·{" "}
                  {periodLabel(conflict.year, conflict.month)} ·{" "}
                  {conflict.directionName}
                </legend>
                <div className="payroll-comparison" role="table">
                  <div className="payroll-comparison-row header" role="row">
                    <span role="columnheader">Начисление</span>
                    <span role="columnheader">Сейчас</span>
                    <span role="columnheader">В файле</span>
                  </div>
                  {PAYROLL_VALUE_FIELDS.map((field) => {
                    const changed = conflict.changedFields.includes(field);
                    return (
                      <div
                        className={`payroll-comparison-row${
                          changed ? " changed" : ""
                        }`}
                        role="row"
                        key={field}
                      >
                        <strong role="cell">{fieldLabels[field]}</strong>
                        <span role="cell">
                          {formatMoney(conflict.existing[field])}
                        </span>
                        <span role="cell">
                          {formatMoney(conflict.incoming[field])}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div
                  className="payroll-conflict-question"
                  role="radiogroup"
                  aria-label={`Решение: ${periodLabel(
                    conflict.year,
                    conflict.month,
                  )}, ${conflict.directionName}`}
                >
                  <span>Какие значения считать корректными?</span>
                  <label
                    className={
                      decisions[conflict.key] === "keep" ? "selected" : ""
                    }
                  >
                    <input
                      type="radio"
                      name={`decision-${conflict.key}`}
                      checked={decisions[conflict.key] === "keep"}
                      onChange={() =>
                        setDecisions((current) => ({
                          ...current,
                          [conflict.key]: "keep",
                        }))
                      }
                    />
                    Оставить сохранённые
                  </label>
                  <label
                    className={
                      decisions[conflict.key] === "replace" ? "selected" : ""
                    }
                  >
                    <input
                      type="radio"
                      name={`decision-${conflict.key}`}
                      checked={decisions[conflict.key] === "replace"}
                      onChange={() =>
                        setDecisions((current) => ({
                          ...current,
                          [conflict.key]: "replace",
                        }))
                      }
                    />
                    Заменить данными файла
                  </label>
                </div>
              </fieldset>
            ))}
          </div>

          <div className="payroll-confirmation-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setConfirmation(null);
                setDecisions({});
              }}
            >
              Отменить
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy || !allAnswered || !file}
              onClick={() => {
                if (file) void sendFile(file, decisions);
              }}
            >
              {busy ? "Сохраняем…" : "Применить решения"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M16 21V5M10 11l6-6 6 6M6 19v7h20v-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
    </svg>
  );
}
