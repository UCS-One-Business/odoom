import { browser } from "@web/core/browser/browser";

/**
 * Collects engine events and sends them in batches: every `interval` ms, and
 * whenever flush() is called. A flush sends what was queued when it was asked
 * for; sends never overlap, so the server sees batches in order. A failed send
 * is not retried: the RPC error surfaces in Odoo's error dialog, and later
 * batches still go.
 */
export class EventBatcher {
    constructor(send, { interval = 5000 } = {}) {
        this.send = send;
        this.interval = interval;
        this.queue = [];
        this.pending = Promise.resolve();
        this.timer = null;
    }

    start() {
        this.timer ??= browser.setInterval(() => this.flush(), this.interval);
    }

    stop() {
        browser.clearInterval(this.timer);
        this.timer = null;
    }

    push(event) {
        this.queue.push({ ...event, at: Date.now() });
    }

    flush() {
        const batch = this.queue.splice(0);
        const previous = this.pending.catch(() => {});
        this.pending = previous.then(() => batch.length && this.send(batch));
        return this.pending;
    }
}
