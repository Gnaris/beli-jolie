import { describe, it, expect, vi, afterEach } from "vitest";
import { emitProductEvent, subscribeProductEvents } from "@/lib/product-events";

describe("product-events", () => {
  afterEach(() => {
    // Clean up global listeners by removing them
    const GLOBAL_KEY = "__bj_product_event_listeners__";
    const g = globalThis as unknown as Record<string, Set<unknown>>;
    if (g[GLOBAL_KEY]) g[GLOBAL_KEY].clear();
  });

  it("emits PRODUCT_CREATED events to listeners", () => {
    const listener = vi.fn();
    const unsub = subscribeProductEvents(listener);

    emitProductEvent({ type: "PRODUCT_CREATED", productId: "test-123" });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0];
    expect(event.type).toBe("PRODUCT_CREATED");
    expect(event.productId).toBe("test-123");
    expect(typeof event.timestamp).toBe("number");

    unsub();
  });

  it("unsubscribe stops receiving events", () => {
    const listener = vi.fn();
    const unsub = subscribeProductEvents(listener);

    emitProductEvent({ type: "PRODUCT_ONLINE", productId: "p1" });
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    emitProductEvent({ type: "PRODUCT_CREATED", productId: "p2" });
    expect(listener).toHaveBeenCalledTimes(1); // still 1
  });

  it("supports multiple listeners", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = subscribeProductEvents(listener1);
    const unsub2 = subscribeProductEvents(listener2);

    emitProductEvent({ type: "PRODUCT_CREATED", productId: "multi" });

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });

  it("handles listener errors gracefully", () => {
    const badListener = vi.fn(() => { throw new Error("boom"); });
    const goodListener = vi.fn();
    const unsub1 = subscribeProductEvents(badListener);
    const unsub2 = subscribeProductEvents(goodListener);

    // Should not throw even though badListener throws
    expect(() => {
      emitProductEvent({ type: "PRODUCT_CREATED", productId: "err" });
    }).not.toThrow();

    expect(goodListener).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });

  it("emits IMPORT_PROGRESS events with metadata", () => {
    const listener = vi.fn();
    const unsub = subscribeProductEvents(listener);

    emitProductEvent({
      type: "IMPORT_PROGRESS",
      productId: "job-1",
      importProgress: {
        jobId: "job-1",
        processed: 5,
        total: 10,
        success: 4,
        errors: 1,
        status: "PROCESSING",
      },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0];
    expect(event.type).toBe("IMPORT_PROGRESS");
    expect(event.importProgress?.processed).toBe(5);
    expect(event.importProgress?.total).toBe(10);
    expect(event.importProgress?.status).toBe("PROCESSING");

    unsub();
  });

  it("includes all ProductEventType values", () => {
    const listener = vi.fn();
    const unsub = subscribeProductEvents(listener);

    const types = [
      "PRODUCT_ONLINE",
      "PRODUCT_UPDATED",
      "PRODUCT_OFFLINE",
      "STOCK_CHANGED",
      "BESTSELLER_CHANGED",
      "PRODUCT_CREATED",
      "IMPORT_PROGRESS",
    ] as const;

    for (const type of types) {
      emitProductEvent({ type, productId: `p-${type}` });
    }

    expect(listener).toHaveBeenCalledTimes(types.length);
    unsub();
  });
});
