import type { ConnectorPayload, DataConnector } from "@/connectors/types";
import { env } from "@/lib/env";

export class GoogleMarketingPlanConnector implements DataConnector {
  readonly key = "google-marketing-plan";

  constructor(private readonly url = env.googleMarketingPlanCsvUrl) {}

  async load(): Promise<ConnectorPayload> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch(this.url, {
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "text/csv" },
      });

      if (!response.ok) {
        throw new Error(
          `Google-таблица вернула HTTP ${response.status}.`,
        );
      }

      const raw = await response.text();
      if (!raw.trim()) {
        throw new Error("Google-таблица вернула пустой файл.");
      }

      return { raw, receivedAt: new Date() };
    } finally {
      clearTimeout(timeout);
    }
  }
}
