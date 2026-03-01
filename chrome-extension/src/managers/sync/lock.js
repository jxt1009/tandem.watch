export class SyncLock {
  constructor() {
    this.suppressLocalUntil = 0;
  }
  set(durationMs) {
    this.suppressLocalUntil = Date.now() + durationMs;
  }
  clear() {
    this.suppressLocalUntil = 0;
  }
  isActive() {
    return Date.now() < this.suppressLocalUntil;
  }
}
