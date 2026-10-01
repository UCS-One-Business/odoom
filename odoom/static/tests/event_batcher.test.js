import { describe, expect, test } from "@odoo/hoot";
import { tick } from "@odoo/hoot-dom";
import { Deferred, advanceTime } from "@odoo/hoot-mock";
import { EventBatcher } from "@odoom/engine/event_batcher";

describe.current.tags("headless");

test("sends queued events on the interval, never an empty batch", async () => {
    const batches = [];
    const batcher = new EventBatcher(async (events) => batches.push(events), { interval: 5000 });
    batcher.start();
    batcher.push({ monster: "imp" });
    batcher.push({ monster: "demon" });
    expect(batches).toHaveLength(0);
    await advanceTime(5000);
    expect(batches).toHaveLength(1);
    expect(batches[0].map((event) => event.monster)).toEqual(["imp", "demon"]);
    await advanceTime(5000);
    expect(batches).toHaveLength(1);
    batcher.stop();
});

test("a flush sends what was queued, and batches never overlap", async () => {
    const batches = [];
    const gate = new Deferred();
    const batcher = new EventBatcher(async (events) => {
        batches.push(events);
        if (batches.length === 1) {
            await gate;
        }
    });
    batcher.push({ monster: "imp" });
    batcher.push({ monster: "demon" });
    const first = batcher.flush();
    batcher.push({ monster: "baron" });
    const second = batcher.flush();
    await tick();
    expect(batches).toHaveLength(1);
    gate.resolve();
    await first;
    await second;
    expect(batches.map((batch) => batch.map((event) => event.monster))).toEqual([
        ["imp", "demon"],
        ["baron"],
    ]);
});

test("a failed send does not block later batches", async () => {
    const sent = [];
    const batcher = new EventBatcher(async (events) => {
        if (events[0].monster === "bad") {
            throw new Error("rejected");
        }
        sent.push(events);
    });
    batcher.push({ monster: "bad" });
    await expect(batcher.flush()).rejects.toThrow("rejected");
    batcher.push({ monster: "imp" });
    await batcher.flush();
    expect(sent).toHaveLength(1);
});
