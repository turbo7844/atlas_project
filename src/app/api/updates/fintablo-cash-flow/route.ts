import { getFintabloCashFlowSyncStatus } from "@/services/fintablo-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();

export async function GET(request: Request) {
  const requestedRevision = Number.parseInt(
    new URL(request.url).searchParams.get("revision") ?? "0",
    10,
  );
  let lastRevision = Number.isFinite(requestedRevision)
    ? Math.max(0, requestedRevision)
    : 0;
  let lastSignature = "";
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: string) => {
        if (!closed) controller.enqueue(encoder.encode(value));
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          // Соединение уже закрыто браузером или прокси.
        }
      };
      const poll = async () => {
        if (polling || closed) return;
        polling = true;
        try {
          const status = await getFintabloCashFlowSyncStatus();
          const signature = JSON.stringify(status);
          if (status.revision > lastRevision || signature !== lastSignature) {
            lastRevision = Math.max(lastRevision, status.revision);
            lastSignature = signature;
            send(`event: fintablo-cash-flow\ndata: ${signature}\n\n`);
          }
        } catch {
          send(
            `event: error\ndata: ${JSON.stringify({
              error: "Не удалось проверить обновление ДДС FinTablo.",
            })}\n\n`,
          );
        } finally {
          polling = false;
        }
      };

      send(": соединение с обновлениями ДДС FinTablo Atlas установлено\n\n");
      void poll();
      pollTimer = setInterval(() => void poll(), 1_000);
      heartbeatTimer = setInterval(
        () => send(`: пульс ${Date.now()}\n\n`),
        15_000,
      );
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
