/**
 * mockScale.js — simulated BLE weighing scale.
 *
 * Every simulated packet is encoded as genuine Weight Measurement (0x2A9D)
 * bytes and handed to the app as a DataView, so it goes through the same
 * parser, raw log and stability logic as real hardware.
 *
 * Cycle (repeats until disconnect):
 *   1. "step on"   — ramps up, then fluctuates around a random target weight
 *                    with shrinking noise (3–5 s). Packets carry weight only.
 *   2. "stable"    — sends the exact target for 6 s. Packets also carry a
 *                    time stamp, user ID, BMI and height, so every flag path
 *                    is exercised.
 *   3. "step off"  — sends 0 for 2 s, then a new person steps on.
 */
import { encodeWeightMeasurement, toDataView, round, kgToLb } from './parser.js';

const HEIGHT_M = 1.75;
const HEIGHT_IN = 68.9;

export default class MockScale {
  constructor(options) {
    this.onData = options.onData;
    this.unit = options.unit === 'lb' ? 'lb' : 'kg';
    this.intervalMs = options.intervalMs || 250;
    this.timer = null;
    this.connectTimer = null;
    this._emit = this._emit.bind(this);
  }

  /** Simulates a short connection delay; resolves like ScaleService.connect. */
  connect() {
    const self = this;
    return new Promise(function (resolve) {
      self.connectTimer = setTimeout(function () {
        self.connectTimer = null;
        self._startCycle();
        self.timer = setInterval(self._emit, self.intervalMs);
        resolve({
          deviceName: 'Mock Scale (simulated)',
          serviceUuid: '0x181D',
          characteristicUuid: '0x2A9D',
          mode: 'notifications',
        });
      }, 600);
    });
  }

  disconnect() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.timer) clearInterval(this.timer);
    this.connectTimer = null;
    this.timer = null;
  }

  _startCycle() {
    this.targetKg = round(45 + Math.random() * 65, 2); // 45–110 kg
    this.userId = 1 + Math.floor(Math.random() * 4);
    this.settleMs = 3000 + Math.random() * 2000;
    this.phase = 'settling';
    this.phaseStart = Date.now();
  }

  _emit() {
    const now = Date.now();
    const elapsed = now - this.phaseStart;
    let kg;
    let full = false;

    if (this.phase === 'settling') {
      if (elapsed >= this.settleMs) {
        this.phase = 'stable';
        this.phaseStart = now;
        kg = this.targetKg;
        full = true;
      } else {
        const p = elapsed / this.settleMs;
        if (p < 0.15) {
          kg = this.targetKg * (p / 0.15); // stepping on
        } else {
          const amplitude = 2.0 * (1 - p) + 0.03; // noise shrinks over time
          kg = this.targetKg + (Math.random() * 2 - 1) * amplitude;
        }
      }
    } else if (this.phase === 'stable') {
      kg = this.targetKg;
      full = true;
      if (elapsed >= 6000) {
        this.phase = 'off';
        this.phaseStart = now;
        kg = 0;
        full = false;
      }
    } else {
      kg = 0;
      if (elapsed >= 2000) this._startCycle();
    }

    kg = Math.max(0, kg);
    const imperial = this.unit === 'lb';
    const packet = { unit: this.unit, weight: imperial ? kgToLb(kg) : kg };
    if (full) {
      packet.timestamp = new Date(now);
      packet.userId = this.userId;
      packet.bmi = round(kg / (HEIGHT_M * HEIGHT_M), 1);
      packet.height = imperial ? HEIGHT_IN : HEIGHT_M;
    }

    if (this.onData) this.onData(toDataView(encodeWeightMeasurement(packet)));
  }
}
