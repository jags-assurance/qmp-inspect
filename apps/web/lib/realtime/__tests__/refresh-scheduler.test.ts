import { describe, it, expect } from "vitest";
import { createRefreshScheduler } from "../refresh-scheduler";

/** A deterministic clock + timer so the tests never sleep. */
function harness(opts: { debounceMs?: number; maxWaitMs?: number; minIntervalMs?: number } = {}) {
  let busy = false;
  let t = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let visible = true;
  let refreshes = 0;
  const scheduler = createRefreshScheduler({
    ...opts,
    refresh: () => {
      refreshes += 1;
    },
    isVisible: () => visible,
    isBusy: () => busy,
    now: () => t,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h) => {
      timers.delete(h as number);
    },
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      t = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    t = end;
  };
  return {
    scheduler,
    advance,
    setBusy: (b: boolean) => {
      busy = b;
    },
    setVisible: (v: boolean) => {
      visible = v;
    },
    refreshes: () => refreshes,
  };
}

describe("createRefreshScheduler", () => {
  it("coalesces a burst of events into one trailing refresh", () => {
    const h = harness({ debounceMs: 1000, maxWaitMs: 60_000 });
    for (let i = 0; i < 50; i++) {
      h.scheduler.notify();
      h.advance(100);
    }
    expect(h.refreshes()).toBe(0);
    h.advance(1000);
    expect(h.refreshes()).toBe(1);
  });

  it("does not refresh without events", () => {
    const h = harness();
    h.advance(60_000);
    expect(h.refreshes()).toBe(0);
  });

  it("caps the wait so a continuous stream still refreshes periodically", () => {
    const h = harness({ debounceMs: 1000, maxWaitMs: 3000 });
    // An event every 500ms for 10s would starve a pure trailing debounce forever.
    for (let i = 0; i < 20; i++) {
      h.scheduler.notify();
      h.advance(500);
    }
    expect(h.refreshes()).toBeGreaterThanOrEqual(2);
    expect(h.refreshes()).toBeLessThanOrEqual(4);
  });

  it("holds events while hidden and refreshes once when the tab becomes visible", () => {
    const h = harness({ debounceMs: 500 });
    h.setVisible(false);
    h.scheduler.notify();
    h.scheduler.notify();
    h.advance(10_000);
    expect(h.refreshes()).toBe(0);
    h.setVisible(true);
    h.scheduler.visibilityChanged();
    expect(h.refreshes()).toBe(1);
    h.scheduler.visibilityChanged();
    expect(h.refreshes()).toBe(1);
  });

  it("a tab hidden while a refresh is pending defers it to when it is visible again", () => {
    const h = harness({ debounceMs: 500 });
    h.scheduler.notify();
    h.setVisible(false);
    h.advance(500);
    expect(h.refreshes()).toBe(0);
    h.setVisible(true);
    h.scheduler.visibilityChanged();
    expect(h.refreshes()).toBe(1);
  });

  it("dispose cancels a pending refresh", () => {
    const h = harness({ debounceMs: 500 });
    h.scheduler.notify();
    h.scheduler.dispose();
    h.advance(5000);
    expect(h.refreshes()).toBe(0);
    h.scheduler.notify();
    h.advance(5000);
    expect(h.refreshes()).toBe(0);
  });

  it("rate-limits refreshes to one per minIntervalMs even for a continuous stream", () => {
    const h = harness({ debounceMs: 500, maxWaitMs: 1000, minIntervalMs: 10_000 });
    // An event every 250ms for 60s.
    for (let i = 0; i < 240; i++) {
      h.scheduler.notify();
      h.advance(250);
    }
    // 60s / 10s = at most 6 (+1 for the first), never one per maxWait (which would be ~60).
    expect(h.refreshes()).toBeGreaterThanOrEqual(5);
    expect(h.refreshes()).toBeLessThanOrEqual(7);
  });

  it("does not delay the first refresh by the minimum interval", () => {
    const h = harness({ debounceMs: 500, minIntervalMs: 10_000 });
    h.scheduler.notify();
    h.advance(500);
    expect(h.refreshes()).toBe(1);
  });

  it("holds a refresh while the previous one is still in flight and runs it afterwards", () => {
    const h = harness({ debounceMs: 500 });
    h.setBusy(true);
    h.scheduler.notify();
    h.advance(20_000);
    expect(h.refreshes()).toBe(0);
    h.setBusy(false);
    h.advance(500);
    expect(h.refreshes()).toBe(1);
  });
});
