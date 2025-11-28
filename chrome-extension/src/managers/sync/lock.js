export class SyncLock {
  constructor() {
    this.suppressLocalUntil = 0;
  }
  set(durationMs) {
    this.suppressLocalUntil = Date.now() + durationMs;
  }
  isActive() {
    return Date.now() < this.suppressLocalUntil;
  }
}
