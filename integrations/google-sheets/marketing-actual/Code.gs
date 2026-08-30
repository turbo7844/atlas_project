var ATLAS_HEADERS = [
  "Дата",
  "Направление",
  "Посещения",
  "Лиды",
  "Рекламный бюджет, ₽",
  "Конверсия Лид/Посещение",
  "CPC, ₽",
  "CPL, ₽"
];
var ATLAS_MAX_ROWS = 10000;
var ATLAS_CHUNK_ROWS = 500;
var ATLAS_HANDLER_NAMES = [
  "atlasOnEdit",
  "atlasOnChange",
  "atlasMinuteCheck"
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Atlas")
    .addItem("Настроить подключение", "configureAtlasConnection")
    .addItem("Установить синхронизацию", "installAtlasSync")
    .addItem("Отправить все данные", "sendAllAtlasData")
    .addItem("Проверить подключение", "checkAtlasConnection")
    .addSeparator()
    .addItem("Удалить триггеры Atlas", "removeAtlasTriggers")
    .addToUi();
}

function configureAtlasConnection() {
  try {
    var config = atlasPromptConfig_();
    SpreadsheetApp.getUi().alert(
      "Подключение Atlas настроено для листа «" + config.sheetName + "»."
    );
  } catch (error) {
    atlasReportError_("Не удалось настроить подключение Atlas", error, true);
  }
}

function installAtlasSync() {
  try {
    atlasConfigOrPrompt_();
    removeAtlasTriggers_();
    var spreadsheet = SpreadsheetApp.getActive();
    ScriptApp.newTrigger("atlasOnEdit")
      .forSpreadsheet(spreadsheet)
      .onEdit()
      .create();
    ScriptApp.newTrigger("atlasOnChange")
      .forSpreadsheet(spreadsheet)
      .onChange()
      .create();
    ScriptApp.newTrigger("atlasMinuteCheck")
      .timeBased()
      .everyMinutes(1)
      .create();
    sendFullSnapshot_();
    SpreadsheetApp.getUi().alert(
      "Синхронизация Atlas установлена. Первичный снимок отправлен."
    );
  } catch (error) {
    atlasReportError_("Не удалось установить синхронизацию", error, true);
  }
}

function atlasConfigOrPrompt_() {
  try {
    return atlasConfig_();
  } catch (error) {
    return atlasPromptConfig_();
  }
}

function atlasPromptConfig_() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    "Настройка Atlas",
    "Вставьте одноразовый код подключения, подготовленный на компьютере с Atlas.",
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) {
    throw new Error("Настройка отменена.");
  }

  var token = String(response.getResponseText() || "").trim();
  var payload;
  try {
    var bytes = Utilities.base64DecodeWebSafe(token);
    payload = JSON.parse(Utilities.newBlob(bytes).getDataAsString("UTF-8"));
  } catch (error) {
    throw new Error("Код подключения имеет неверный формат.");
  }

  var endpoint = String(payload.endpoint || "").trim().replace(/\/$/, "");
  var secret = String(payload.secret || "").trim();
  var spreadsheetId = String(payload.spreadsheetId || "").trim();
  var sheetId = Number(payload.sheetId);
  var spreadsheet = SpreadsheetApp.getActive();

  if (!/^https:\/\//.test(endpoint)) {
    throw new Error("В коде подключения отсутствует корректный HTTPS-адрес Atlas.");
  }
  if (secret.length < 32) {
    throw new Error("В коде подключения отсутствует корректный секрет Atlas.");
  }
  if (spreadsheet.getId() !== spreadsheetId) {
    throw new Error("Код подключения предназначен для другой таблицы.");
  }
  if (!isFinite(sheetId)) {
    throw new Error("В коде подключения отсутствует идентификатор листа.");
  }

  var targetSheet = null;
  spreadsheet.getSheets().some(function (sheet) {
    if (sheet.getSheetId() === sheetId) {
      targetSheet = sheet;
      return true;
    }
    return false;
  });
  if (!targetSheet) {
    throw new Error("Нужный лист не найден в таблице.");
  }

  PropertiesService.getScriptProperties().setProperties(
    {
      ATLAS_ENDPOINT_URL: endpoint,
      ATLAS_WEBHOOK_SECRET: secret,
      ATLAS_SHEET_NAME: targetSheet.getName()
    },
    false
  );
  return atlasConfig_();
}

function removeAtlasTriggers() {
  removeAtlasTriggers_();
  SpreadsheetApp.getUi().alert("Триггеры Atlas удалены.");
}

function removeAtlasTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (ATLAS_HANDLER_NAMES.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function sendAllAtlasData() {
  try {
    atlasWithLock_(function () {
      sendFullSnapshot_();
    });
    SpreadsheetApp.getUi().alert("Все данные отправлены в Atlas.");
  } catch (error) {
    atlasReportError_("Не удалось отправить все данные", error, true);
  }
}

function checkAtlasConnection() {
  try {
    atlasWithLock_(function () {
      var context = atlasContext_();
      atlasRequest_({
        version: 1,
        mode: "patch",
        spreadsheetId: context.spreadsheetId,
        sheetName: context.sheetName,
        affectedRows: [],
        rows: []
      });
    });
    SpreadsheetApp.getUi().alert("Подключение к Atlas работает.");
  } catch (error) {
    atlasReportError_("Не удалось проверить подключение", error, true);
  }
}

function atlasOnEdit(event) {
  try {
    atlasWithLock_(function () {
      if (!event || !event.range) return;
      var context = atlasContext_(event.source);
      var sheet = event.range.getSheet();
      if (sheet.getName() !== context.sheetName) return;
      var lastRow = event.range.getRow() + event.range.getNumRows() - 1;
      if (lastRow > ATLAS_MAX_ROWS + 1) {
        throw new Error("Изменение выходит за предел 10 000 строк данных.");
      }
      sendFullSnapshot_(event.source);
    });
  } catch (error) {
    atlasReportError_("Не удалось отправить изменение строки", error, false);
  }
}

function atlasOnChange(event) {
  try {
    var structuralChanges = [
      "INSERT_ROW",
      "REMOVE_ROW",
      "INSERT_COLUMN",
      "REMOVE_COLUMN",
      "OTHER"
    ];
    if (
      event &&
      event.changeType &&
      structuralChanges.indexOf(event.changeType) === -1
    ) {
      return;
    }
    atlasWithLock_(function () {
      sendFullSnapshot_(event && event.source);
    });
  } catch (error) {
    atlasReportError_("Не удалось сверить структуру таблицы", error, false);
  }
}

function atlasMinuteCheck() {
  try {
    atlasWithLock_(function () {
      var snapshot = readFullSnapshot_();
      var hash = atlasHashRows_(snapshot.rows);
      var previousHash = PropertiesService.getScriptProperties().getProperty(
        "ATLAS_LAST_HASH"
      );
      if (hash !== previousHash) {
        sendPreparedSnapshot_(snapshot, hash);
      }
    });
  } catch (error) {
    atlasReportError_("Минутная сверка Atlas завершилась ошибкой", error, false);
  }
}

function atlasWithLock_(callback) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error("Другой обработчик Atlas ещё выполняется.");
  }
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function atlasConfig_() {
  var properties = PropertiesService.getScriptProperties();
  var endpoint = String(properties.getProperty("ATLAS_ENDPOINT_URL") || "").trim();
  var secret = String(properties.getProperty("ATLAS_WEBHOOK_SECRET") || "").trim();
  var sheetName = String(properties.getProperty("ATLAS_SHEET_NAME") || "").trim();
  if (!/^https:\/\//.test(endpoint)) {
    throw new Error("ATLAS_ENDPOINT_URL должен быть публичным HTTPS-адресом.");
  }
  if (!secret) {
    throw new Error("Не задано свойство ATLAS_WEBHOOK_SECRET.");
  }
  if (!sheetName) {
    throw new Error("Не задано свойство ATLAS_SHEET_NAME.");
  }
  return {
    endpoint: endpoint.replace(/\/$/, ""),
    secret: secret,
    sheetName: sheetName
  };
}

function atlasContext_(spreadsheet) {
  var book = spreadsheet || SpreadsheetApp.getActive();
  var config = atlasConfig_();
  var sheet = book.getSheetByName(config.sheetName);
  if (!sheet) {
    throw new Error("Лист «" + config.sheetName + "» не найден.");
  }
  return {
    spreadsheet: book,
    spreadsheetId: book.getId(),
    sheetName: config.sheetName,
    sheet: sheet,
    config: config
  };
}

function atlasReportError_(prefix, error, showDialog) {
  var message = prefix + ": " + (error && error.message ? error.message : error);
  console.error(message);
  if (showDialog) {
    SpreadsheetApp.getUi().alert(message);
  }
}

function atlasHeaderMap_(headers) {
  var indexes = {};
  ATLAS_HEADERS.forEach(function (header) {
    var matches = [];
    headers.forEach(function (value, index) {
      if (String(value || "").trim() === header) matches.push(index);
    });
    if (matches.length !== 1) {
      throw new Error(
        "Столбец «" + header + "» должен присутствовать в первой строке один раз."
      );
    }
    indexes[header] = matches[0];
  });
  return indexes;
}

function atlasRowIsEmpty_(values, indexes) {
  return ATLAS_HEADERS.every(function (header) {
    var value = values[indexes[header]];
    return value === null || value === undefined || String(value).trim() === "";
  });
}

function atlasDate_(value, rowNumber, timezone) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    if (isNaN(value.getTime())) {
      throw new Error("Строка " + rowNumber + ": дата задана неверно.");
    }
    return Utilities.formatDate(value, timezone, "yyyy-MM-dd");
  }
  var text = String(value || "").trim();
  var iso = text.match(/^(2026)-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/);
  if (iso) return iso[0];
  var russian = text.match(/^([0-2]\d|3[01])\.(0[1-9]|1[0-2])\.(2026)$/);
  if (russian) {
    return russian[3] + "-" + russian[2] + "-" + russian[1];
  }
  throw new Error(
    "Строка " + rowNumber + ": дата должна относиться к 2026 году."
  );
}

function atlasNumber_(value, label, rowNumber, allowEmpty, percent) {
  if (
    allowEmpty &&
    (value === null || value === undefined || String(value).trim() === "")
  ) {
    return null;
  }
  if (typeof value === "number") {
    if (isFinite(value)) return value;
  } else {
    var source = String(value || "");
    var normalized = source
      .replace(/[\s\u00a0\u202f₽%]/g, "")
      .replace(",", ".");
    var parsed = Number(normalized);
    if (normalized && isFinite(parsed)) {
      return percent && source.indexOf("%") !== -1 ? parsed / 100 : parsed;
    }
  }
  throw new Error(
    "Строка " + rowNumber + ": поле «" + label + "» содержит неверное число."
  );
}

function atlasRowFromValues_(values, indexes, rowNumber, timezone) {
  if (atlasRowIsEmpty_(values, indexes)) return null;
  return {
    sourceRow: rowNumber,
    date: atlasDate_(values[indexes["Дата"]], rowNumber, timezone),
    direction: String(values[indexes["Направление"]] || "").trim(),
    visits: atlasNumber_(
      values[indexes["Посещения"]],
      "Посещения",
      rowNumber,
      false,
      false
    ),
    leads: atlasNumber_(
      values[indexes["Лиды"]],
      "Лиды",
      rowNumber,
      false,
      false
    ),
    budget: atlasNumber_(
      values[indexes["Рекламный бюджет, ₽"]],
      "Рекламный бюджет, ₽",
      rowNumber,
      false,
      false
    ),
    conversion: atlasNumber_(
      values[indexes["Конверсия Лид/Посещение"]],
      "Конверсия Лид/Посещение",
      rowNumber,
      true,
      true
    ),
    cpc: atlasNumber_(
      values[indexes["CPC, ₽"]],
      "CPC, ₽",
      rowNumber,
      true,
      false
    ),
    cpl: atlasNumber_(
      values[indexes["CPL, ₽"]],
      "CPL, ₽",
      rowNumber,
      true,
      false
    ),
    sourceUpdatedAt: new Date().toISOString()
  };
}

function atlasAggregateRows_(rows) {
  var groups = {};
  rows.forEach(function (row) {
    var key = JSON.stringify([row.date, row.direction]);
    if (!groups[key]) {
      groups[key] = {
        sourceRow: row.sourceRow,
        date: row.date,
        direction: row.direction,
        visits: 0,
        leads: 0,
        budget: 0,
        sourceUpdatedAt: row.sourceUpdatedAt
      };
    }
    var group = groups[key];
    group.sourceRow = Math.min(group.sourceRow, row.sourceRow);
    group.visits += Number(row.visits);
    group.leads += Number(row.leads);
    group.budget += Number(row.budget);
    if (row.sourceUpdatedAt > group.sourceUpdatedAt) {
      group.sourceUpdatedAt = row.sourceUpdatedAt;
    }
  });

  return Object.keys(groups)
    .map(function (key) {
      var group = groups[key];
      var budget = Number(group.budget.toFixed(2));
      return {
        sourceRow: group.sourceRow,
        date: group.date,
        direction: group.direction,
        visits: group.visits,
        leads: group.leads,
        budget: budget,
        conversion:
          group.visits === 0
            ? null
            : Number((group.leads / group.visits).toFixed(6)),
        cpc:
          group.visits === 0
            ? null
            : Number((budget / group.visits).toFixed(2)),
        cpl:
          group.leads === 0
            ? null
            : Number((budget / group.leads).toFixed(2)),
        sourceUpdatedAt: group.sourceUpdatedAt
      };
    })
    .sort(function (left, right) {
      return left.sourceRow - right.sourceRow;
    });
}

function readFullSnapshot_(spreadsheet) {
  var context = atlasContext_(spreadsheet);
  var lastRow = context.sheet.getLastRow();
  if (lastRow > ATLAS_MAX_ROWS + 1) {
    throw new Error("Лист содержит более 10 000 строк данных.");
  }
  var lastColumn = Math.max(context.sheet.getLastColumn(), ATLAS_HEADERS.length);
  var values = context.sheet
    .getRange(1, 1, Math.max(lastRow, 1), lastColumn)
    .getValues();
  var headers = values[0] || [];
  var indexes = atlasHeaderMap_(headers);
  var timezone = context.spreadsheet.getSpreadsheetTimeZone();
  var rows = [];
  for (var index = 1; index < values.length; index += 1) {
    var row = atlasRowFromValues_(
      values[index],
      indexes,
      index + 1,
      timezone
    );
    if (row) rows.push(row);
  }
  return {
    context: context,
    headers: ATLAS_HEADERS.slice(),
    rows: atlasAggregateRows_(rows)
  };
}

function readSelectedRows_(sheet, affectedRows) {
  if (!affectedRows.length) return [];
  var context = atlasContext_(sheet.getParent());
  var lastColumn = Math.max(sheet.getLastColumn(), ATLAS_HEADERS.length);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var indexes = atlasHeaderMap_(headers);
  var firstRow = affectedRows[0];
  var lastRow = affectedRows[affectedRows.length - 1];
  var values = sheet
    .getRange(firstRow, 1, lastRow - firstRow + 1, lastColumn)
    .getValues();
  var selected = {};
  affectedRows.forEach(function (row) {
    selected[row] = true;
  });
  var timezone = context.spreadsheet.getSpreadsheetTimeZone();
  var rows = [];
  values.forEach(function (valuesRow, index) {
    var rowNumber = firstRow + index;
    if (!selected[rowNumber]) return;
    var row = atlasRowFromValues_(valuesRow, indexes, rowNumber, timezone);
    if (row) rows.push(row);
  });
  return rows;
}

function atlasCanonicalRows_(rows) {
  return rows
    .slice()
    .sort(function (left, right) {
      return left.sourceRow - right.sourceRow;
    })
    .map(function (row) {
      var visits = Number(row.visits);
      var leads = Number(row.leads);
      var budget = Number(row.budget);
      return {
        sourceRow: row.sourceRow,
        date: row.date,
        direction: row.direction,
        visits: visits,
        leads: leads,
        budget: budget.toFixed(2),
        conversion: visits === 0 ? "" : (leads / visits).toFixed(6),
        cpc: visits === 0 ? "" : (budget / visits).toFixed(2),
        cpl: leads === 0 ? "" : (budget / leads).toFixed(2)
      };
    });
}

function atlasBytesToHex_(bytes) {
  return bytes
    .map(function (value) {
      var normalized = value < 0 ? value + 256 : value;
      return ("0" + normalized.toString(16)).slice(-2);
    })
    .join("");
}

function atlasHashRows_(rows) {
  var canonical = JSON.stringify(atlasCanonicalRows_(rows));
  return atlasBytesToHex_(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      canonical,
      Utilities.Charset.UTF_8
    )
  );
}

function atlasWebhookUrl_(endpoint) {
  var path = "/api/integrations/google-sheets/marketing-actual";
  return endpoint.slice(-path.length) === path ? endpoint : endpoint + path;
}

function atlasSignature_(secret, timestamp, eventId, rawBody) {
  return atlasBytesToHex_(
    Utilities.computeHmacSha256Signature(
      timestamp + "\n" + eventId + "\n" + rawBody,
      secret,
      Utilities.Charset.UTF_8
    )
  );
}

function atlasResponseMessage_(response) {
  try {
    var payload = JSON.parse(response.getContentText());
    return payload.error || payload.message || "Atlas отклонил запрос.";
  } catch (error) {
    return "Atlas отклонил запрос.";
  }
}

function atlasRequest_(payload) {
  var config = atlasConfig_();
  var rawBody = JSON.stringify(payload);
  var eventId = Utilities.getUuid();
  var delays = [0, 500, 1500, 3000];
  var lastError = null;

  for (var attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) Utilities.sleep(delays[attempt]);
    var timestamp = String(Math.floor(Date.now() / 1000));
    var signature = atlasSignature_(
      config.secret,
      timestamp,
      eventId,
      rawBody
    );
    var response;
    try {
      response = UrlFetchApp.fetch(atlasWebhookUrl_(config.endpoint), {
        method: "post",
        contentType: "application/json; charset=utf-8",
        payload: rawBody,
        headers: {
          "X-Atlas-Timestamp": timestamp,
          "X-Atlas-Event-Id": eventId,
          "X-Atlas-Signature": signature,
          "X-Pinggy-No-Screen": "1"
        },
        muteHttpExceptions: true
      });
    } catch (error) {
      lastError = error;
      continue;
    }
    var status = response.getResponseCode();
    if (status >= 200 && status < 300) {
      var content = response.getContentText();
      return content ? JSON.parse(content) : {};
    }
    lastError = new Error(atlasResponseMessage_(response));
    if (status !== 429 && status < 500) {
      throw lastError;
    }
  }
  throw lastError || new Error("Atlas не ответил после нескольких попыток.");
}

function sendFullSnapshot_(spreadsheet) {
  var snapshot = readFullSnapshot_(spreadsheet);
  var hash = atlasHashRows_(snapshot.rows);
  return sendPreparedSnapshot_(snapshot, hash);
}

function sendPreparedSnapshot_(snapshot, hash) {
  var context = snapshot.context;
  var chunkCount = Math.ceil(snapshot.rows.length / ATLAS_CHUNK_ROWS);
  var offer = atlasRequest_({
    version: 1,
    mode: "snapshot.offer",
    spreadsheetId: context.spreadsheetId,
    sheetName: context.sheetName,
    snapshotId: Utilities.getUuid(),
    contentHash: hash,
    rowCount: snapshot.rows.length,
    chunkCount: chunkCount,
    headers: snapshot.headers
  });
  if (offer.action === "skip") {
    PropertiesService.getScriptProperties().setProperty(
      "ATLAS_LAST_HASH",
      offer.contentHash || hash
    );
    return offer;
  }
  if (!offer.sessionId) {
    throw new Error("Atlas не вернул идентификатор сессии снимка.");
  }

  for (var chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    var start = chunkIndex * ATLAS_CHUNK_ROWS;
    atlasRequest_({
      version: 1,
      mode: "snapshot.chunk",
      spreadsheetId: context.spreadsheetId,
      sheetName: context.sheetName,
      sessionId: offer.sessionId,
      chunkIndex: chunkIndex,
      rows: snapshot.rows.slice(start, start + ATLAS_CHUNK_ROWS)
    });
  }

  var committed = atlasRequest_({
    version: 1,
    mode: "snapshot.commit",
    spreadsheetId: context.spreadsheetId,
    sheetName: context.sheetName,
    sessionId: offer.sessionId
  });
  PropertiesService.getScriptProperties().setProperty(
    "ATLAS_LAST_HASH",
    committed.contentHash || hash
  );
  return committed;
}
