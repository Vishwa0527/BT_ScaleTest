// Plain Node tests for the pure Bluetooth helpers: `npm test`
import assert from 'node:assert/strict';
import {
  parseWeightMeasurement,
  encodeWeightMeasurement,
  toHex,
  parseCustomScale,
} from '../src/bluetooth/parser.js';
import StabilityTracker from '../src/bluetooth/stability.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  ' + name);
}

const TS = { year: 2026, month: 11, day: 9, hours: 14, minutes: 30, seconds: 0 };

test('1) SI weight only', () => {
  const r = parseWeightMeasurement([0x00, 0x60, 0x3b]);
  assert.equal(r.unit, 'kg');
  assert.equal(r.weight, 76);
  assert.equal(r.weightKg, 76);
  assert.equal(r.timestamp, null);
});

test('2) Imperial weight only', () => {
  const r = parseWeightMeasurement([0x01, 0x6c, 0x41]);
  assert.equal(r.unit, 'lb');
  assert.equal(r.weight, 167.48);
  assert.equal(r.weightKg, 75.968);
});

test('3) SI + time stamp', () => {
  const r = parseWeightMeasurement([0x02, 0x60, 0x3b, 0xea, 0x07, 0x0b, 0x09, 0x0e, 0x1e, 0x00]);
  assert.equal(r.weight, 76);
  assert.deepEqual(r.timestamp, TS);
});

test('4) SI + user ID + BMI/height', () => {
  const r = parseWeightMeasurement([0x0c, 0x60, 0x3b, 0x01, 0xf4, 0x00, 0xe6, 0x06]);
  assert.equal(r.userId, 1);
  assert.equal(r.bmi, 24.4);
  assert.equal(r.height, 1.766);
  assert.equal(r.heightUnit, 'm');
});

test('5) Imperial + all fields', () => {
  const r = parseWeightMeasurement([
    0x0f, 0x6c, 0x41, 0xea, 0x07, 0x0b, 0x09, 0x0e, 0x1e, 0x00, 0x02, 0xf4, 0x00, 0xb7, 0x02,
  ]);
  assert.equal(r.weight, 167.48);
  assert.deepEqual(r.timestamp, TS);
  assert.equal(r.userId, 2);
  assert.equal(r.bmi, 24.4);
  assert.equal(r.height, 69.5);
  assert.equal(r.heightUnit, 'in');
  assert.equal(r.extraBytes, 0);
});

test('6) Measurement unsuccessful', () => {
  const r = parseWeightMeasurement([0x00, 0xff, 0xff]);
  assert.equal(r.measurementUnsuccessful, true);
  assert.equal(r.weight, null);
  assert.equal(r.weightKg, null);
});

test('truncated packets throw', () => {
  assert.throws(() => parseWeightMeasurement([0x00, 0x60]), /at least 3 bytes/);
  assert.throws(() => parseWeightMeasurement([0x02, 0x60, 0x3b, 0xea]), /Time Stamp/);
});

test('encode -> parse round trip (kg and lb)', () => {
  const when = new Date(2026, 10, 9, 14, 30, 0);
  const kg = encodeWeightMeasurement({ weight: 76, unit: 'kg', timestamp: when, userId: 1, bmi: 24.4, height: 1.766 });
  assert.equal(toHex(kg), '0E 60 3B EA 07 0B 09 0E 1E 00 01 F4 00 E6 06');
  const r = parseWeightMeasurement(kg);
  assert.equal(r.weight, 76);
  assert.deepEqual(r.timestamp, TS);

  const lb = parseWeightMeasurement(encodeWeightMeasurement({ weight: 167.48, unit: 'lb' }));
  assert.equal(lb.weight, 167.48);
  assert.equal(toHex(encodeWeightMeasurement({ weight: null, unit: 'kg' })), '00 FF FF');
});

test('parseCustomScale template returns null', () => {
  assert.equal(parseCustomScale([0x01, 0x02]), null);
});

test('stability: stable after 2 s within 0.05 kg', () => {
  const s = new StabilityTracker();
  assert.equal(s.update(70.0, 0).stable, false);
  assert.equal(s.update(70.04, 1000).stable, false);
  assert.equal(s.update(69.96, 1999).stable, false);
  const r = s.update(70.03, 2000);
  assert.equal(r.stable, true);
  assert.equal(r.justBecameStable, true);
  assert.equal(s.tick(2500).justBecameStable, false);
  assert.equal(s.update(70.2, 2600).stable, false); // moved > 0.05 -> restart
  assert.equal(s.tick(4599).stable, false);
  assert.equal(s.tick(4600).stable, true); // stable via timer, no new packet
});

console.log('\n' + passed + ' tests passed');
