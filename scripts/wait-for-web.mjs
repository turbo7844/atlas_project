const url = process.env.ATLAS_HEALTH_URL ?? "http://web:3000/api/health";
const attempts = 45;

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    if (response.ok) {
      console.info("Веб-приложение готово, запускается фоновая синхронизация.");
      process.exit(0);
    }
  } catch {
    // Веб-приложение ещё применяет миграции или запускается.
  }

  if (attempt < attempts) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

console.error("Веб-приложение не стало доступно за 90 секунд.");
process.exit(1);
