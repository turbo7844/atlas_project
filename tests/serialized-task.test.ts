import { describe, expect, it, vi } from "vitest";

import { createSerializedTask } from "@/services/serialized-task";

describe("createSerializedTask", () => {
  it("объединяет изменения во время активного запуска в один повтор", async () => {
    let release: () => void = () => undefined;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const queue = createSerializedTask(task);

    const first = queue.request();
    void queue.request();
    void queue.request();
    expect(task).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(2));
    release();
    await first;
    await queue.stop();
  });
});
