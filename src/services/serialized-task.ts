export function createSerializedTask(task: () => Promise<void>) {
  let pending = false;
  let stopped = false;
  let active: Promise<void> | null = null;

  const drain = async () => {
    while (pending && !stopped) {
      pending = false;
      await task();
    }
  };

  const start = () => {
    if (!active && pending && !stopped) {
      active = drain().finally(() => {
        active = null;
        if (pending && !stopped) void start();
      });
    }
    return active;
  };

  return {
    request() {
      if (stopped) return Promise.resolve();
      pending = true;
      return start() ?? Promise.resolve();
    },
    stop() {
      stopped = true;
      pending = false;
      return active ?? Promise.resolve();
    },
  };
}
