export class EventDebouncer {
  constructor(delayMs = 200) {
    this.delayMs = delayMs;
    this.timer = null;
    this.events = new Set();
  }
  add(eventType) {
    this.events.add(eventType);
  }
  schedule(fn) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const events = this.events;
      this.events = new Set();
      this.timer = null;
      fn(events);
    }, this.delayMs);
  }
  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.events.clear();
  }
}
