/**
 * StabilityTracker — decides when a weight reading is "stable".
 *
 * Rule: a value is stable once readings have stayed within ±thresholdKg of an
 * anchor value for at least windowMs. Any reading outside the band moves the
 * anchor and restarts the clock.
 *
 * update() is called for every new reading. tick() is called on a timer,
 * because many scales stop sending once the value settles, and stability
 * still has to be detected then.
 */
export default class StabilityTracker {
  constructor(options) {
    const opts = options || {};
    this.thresholdKg = opts.thresholdKg != null ? opts.thresholdKg : 0.05;
    this.windowMs = opts.windowMs != null ? opts.windowMs : 2000;
    this.reset();
  }

  reset() {
    this.anchorKg = null;
    this.since = null;
    this.stable = false;
  }

  update(kg, nowMs) {
    if (this.anchorKg === null || Math.abs(kg - this.anchorKg) > this.thresholdKg) {
      this.anchorKg = kg;
      this.since = nowMs;
    }
    return this._evaluate(nowMs);
  }

  tick(nowMs) {
    if (this.anchorKg === null) return { stable: false, justBecameStable: false };
    return this._evaluate(nowMs);
  }

  _evaluate(nowMs) {
    const stable = nowMs - this.since >= this.windowMs;
    const justBecameStable = stable && !this.stable;
    this.stable = stable;
    return { stable: stable, justBecameStable: justBecameStable };
  }
}
