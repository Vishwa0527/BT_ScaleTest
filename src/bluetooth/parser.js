/**
 * parser.js — pure functions for decoding (and encoding) BLE scale packets.
 *
 * No React, no browser APIs: everything here works on DataView / byte arrays,
 * so it can be unit-tested in Node (`npm test`) and reused by the mock scale.
 *
 * ---------------------------------------------------------------------------
 * Bluetooth SIG "Weight Measurement" characteristic (0x2A9D)
 * ---------------------------------------------------------------------------
 *   Byte 0      Flags
 *                 bit 0  Measurement units: 0 = SI (kg, m), 1 = Imperial (lb, in)
 *                 bit 1  Time Stamp present
 *                 bit 2  User ID present
 *                 bit 3  BMI and Height present
 *                 bit 4-7 reserved
 *   Byte 1-2    Weight, uint16 little-endian
 *                 SI:       resolution 0.005 kg
 *                 Imperial: resolution 0.01 lb
 *                 0xFFFF = "measurement unsuccessful"
 *   [7 bytes]   Time Stamp (if bit 1): year uint16 LE, month, day, hours, minutes, seconds
 *   [1 byte]    User ID (if bit 2): uint8, 0xFF = unknown user
 *   [2 bytes]   BMI (if bit 3): uint16 LE, resolution 0.1
 *   [2 bytes]   Height (if bit 3): uint16 LE, SI 0.001 m / Imperial 0.1 in
 *
 * ---------------------------------------------------------------------------
 * Worked examples (these are also asserted in scripts/test-parser.js)
 * ---------------------------------------------------------------------------
 *
 * 1) SI, weight only
 *    [0x00, 0x60, 0x3B]
 *    flags 0x00 -> kg; weight 0x3B60 = 15200 * 0.005 = 76.000 kg
 *
 * 2) Imperial, weight only
 *    [0x01, 0x6C, 0x41]
 *    flags 0x01 -> lb; weight 0x416C = 16748 * 0.01 = 167.48 lb (~75.968 kg)
 *
 * 3) SI + time stamp
 *    [0x02, 0x60, 0x3B, 0xEA, 0x07, 0x0B, 0x09, 0x0E, 0x1E, 0x00]
 *    76.000 kg, time stamp 2026-11-09 14:30:00 (0x07EA = 2026)
 *
 * 4) SI + user ID + BMI/height
 *    [0x0C, 0x60, 0x3B, 0x01, 0xF4, 0x00, 0xE6, 0x06]
 *    76.000 kg, user 1, BMI 0x00F4 = 244 * 0.1 = 24.4, height 0x06E6 = 1766 * 0.001 = 1.766 m
 *
 * 5) Imperial + every optional field
 *    [0x0F, 0x6C, 0x41, 0xEA, 0x07, 0x0B, 0x09, 0x0E, 0x1E, 0x00, 0x02, 0xF4, 0x00, 0xB7, 0x02]
 *    167.48 lb, 2026-11-09 14:30:00, user 2, BMI 24.4, height 0x02B7 = 695 * 0.1 = 69.5 in
 *
 * 6) Measurement unsuccessful
 *    [0x00, 0xFF, 0xFF]
 *    weight = null, measurementUnsuccessful = true
 */

export const WEIGHT_SCALE_SERVICE = 0x181d;
export const BODY_COMPOSITION_SERVICE = 0x181b;
export const WEIGHT_MEASUREMENT_CHAR = 0x2a9d;

export const KG_PER_LB = 0.45359237;

const FLAG_IMPERIAL = 0x01;
const FLAG_TIMESTAMP = 0x02;
const FLAG_USER_ID = 0x04;
const FLAG_BMI_HEIGHT = 0x08;

const RES_KG = 0.005;
const RES_LB = 0.01;
const WEIGHT_UNSUCCESSFUL = 0xffff;
const USER_ID_UNKNOWN = 0xff;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function round(value, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

export function kgToLb(kg) {
  return kg / KG_PER_LB;
}

export function lbToKg(lb) {
  return lb * KG_PER_LB;
}

/** Convert a weight between 'kg' and 'lb'. */
export function convertWeight(value, fromUnit, toUnit) {
  if (value == null || fromUnit === toUnit) return value;
  return fromUnit === 'kg' ? kgToLb(value) : lbToKg(value);
}

/** Accepts DataView | ArrayBuffer | TypedArray | number[] and returns a DataView. */
export function toDataView(input) {
  if (input instanceof DataView) return input;
  if (input instanceof ArrayBuffer) return new DataView(input);
  if (ArrayBuffer.isView(input)) {
    return new DataView(input.buffer, input.byteOffset, input.byteLength);
  }
  if (Array.isArray(input)) return new DataView(Uint8Array.from(input).buffer);
  throw new TypeError('Expected DataView, ArrayBuffer, TypedArray or byte array');
}

/** "02 60 3B" style hex dump. */
export function toHex(input) {
  const dv = toDataView(input);
  const parts = [];
  for (let i = 0; i < dv.byteLength; i++) {
    parts.push(('0' + dv.getUint8(i).toString(16)).slice(-2).toUpperCase());
  }
  return parts.join(' ');
}

/** Plain array of byte values, handy for logging / custom parsers. */
export function toBytes(input) {
  const dv = toDataView(input);
  const out = [];
  for (let i = 0; i < dv.byteLength; i++) out.push(dv.getUint8(i));
  return out;
}

function requireBytes(dv, offset, count, field) {
  if (dv.byteLength < offset + count) {
    throw new Error(
      field + ' flagged as present but packet is too short (' +
        dv.byteLength + ' bytes, need ' + (offset + count) + ')'
    );
  }
}

/**
 * Build a reading object with the same shape parseWeightMeasurement returns.
 * Use this from parseCustomScale so the rest of the app works unchanged.
 */
export function makeReading(fields) {
  const unit = fields.unit === 'lb' ? 'lb' : 'kg';
  const weight = fields.weight == null ? null : fields.weight;
  return {
    format: fields.format || 'custom',
    flags: fields.flags == null ? null : fields.flags,
    unit: unit,
    rawWeight: fields.rawWeight == null ? null : fields.rawWeight,
    weight: weight,
    weightKg: weight == null ? null : round(unit === 'kg' ? weight : lbToKg(weight), 3),
    measurementUnsuccessful: !!fields.measurementUnsuccessful,
    timestamp: fields.timestamp || null,
    userId: fields.userId == null ? null : fields.userId,
    userIdUnknown: !!fields.userIdUnknown,
    bmi: fields.bmi == null ? null : fields.bmi,
    height: fields.height == null ? null : fields.height,
    heightUnit: fields.heightUnit || (unit === 'kg' ? 'm' : 'in'),
    extraBytes: fields.extraBytes || 0,
  };
}

// ---------------------------------------------------------------------------
// Standard Weight Measurement (0x2A9D)
// ---------------------------------------------------------------------------

/**
 * Parse a Weight Measurement packet.
 * @param {DataView|ArrayBuffer|Uint8Array|number[]} input
 * @returns reading object (see makeReading) — throws Error on malformed data.
 */
export function parseWeightMeasurement(input) {
  const dv = toDataView(input);
  if (dv.byteLength < 3) {
    throw new Error('Weight Measurement needs at least 3 bytes, got ' + dv.byteLength);
  }

  let offset = 0;
  const flags = dv.getUint8(offset);
  offset += 1;

  const imperial = (flags & FLAG_IMPERIAL) !== 0;
  const unit = imperial ? 'lb' : 'kg';

  const rawWeight = dv.getUint16(offset, true);
  offset += 2;

  const unsuccessful = rawWeight === WEIGHT_UNSUCCESSFUL;
  let weight = null;
  if (!unsuccessful) {
    weight = imperial ? round(rawWeight * RES_LB, 2) : round(rawWeight * RES_KG, 3);
  }

  let timestamp = null;
  if (flags & FLAG_TIMESTAMP) {
    requireBytes(dv, offset, 7, 'Time Stamp');
    timestamp = {
      year: dv.getUint16(offset, true), // 0 = unknown
      month: dv.getUint8(offset + 2), // 1-12, 0 = unknown
      day: dv.getUint8(offset + 3), // 1-31, 0 = unknown
      hours: dv.getUint8(offset + 4),
      minutes: dv.getUint8(offset + 5),
      seconds: dv.getUint8(offset + 6),
    };
    offset += 7;
  }

  let userId = null;
  if (flags & FLAG_USER_ID) {
    requireBytes(dv, offset, 1, 'User ID');
    userId = dv.getUint8(offset);
    offset += 1;
  }

  let bmi = null;
  let height = null;
  if (flags & FLAG_BMI_HEIGHT) {
    requireBytes(dv, offset, 4, 'BMI and Height');
    bmi = round(dv.getUint16(offset, true) * 0.1, 1);
    const rawHeight = dv.getUint16(offset + 2, true);
    height = imperial ? round(rawHeight * 0.1, 1) : round(rawHeight * 0.001, 3);
    offset += 4;
  }

  return makeReading({
    format: 'weight-measurement',
    flags: flags,
    unit: unit,
    rawWeight: rawWeight,
    weight: weight,
    measurementUnsuccessful: unsuccessful,
    timestamp: timestamp,
    userId: userId,
    userIdUnknown: userId === USER_ID_UNKNOWN,
    bmi: bmi,
    height: height,
    heightUnit: imperial ? 'in' : 'm',
    extraBytes: dv.byteLength - offset,
  });
}

/**
 * Encode a Weight Measurement packet (inverse of parseWeightMeasurement).
 * Used by the mock scale so simulated data travels through the real parser.
 *
 * @param {object} m
 * @param {number|null} m.weight   in m.unit; null -> 0xFFFF (unsuccessful)
 * @param {'kg'|'lb'}   m.unit
 * @param {Date}        [m.timestamp]
 * @param {number}      [m.userId]  0-255
 * @param {number}      [m.bmi]
 * @param {number}      [m.height]  metres (kg) or inches (lb); requires bmi
 * @returns {Uint8Array}
 */
export function encodeWeightMeasurement(m) {
  const imperial = m.unit === 'lb';
  let flags = imperial ? FLAG_IMPERIAL : 0;
  if (m.timestamp) flags |= FLAG_TIMESTAMP;
  if (m.userId != null) flags |= FLAG_USER_ID;
  if (m.bmi != null && m.height != null) flags |= FLAG_BMI_HEIGHT;

  const bytes = [flags];
  const pushU16 = function (v) {
    const n = Math.max(0, Math.min(0xffff, Math.round(v)));
    bytes.push(n & 0xff, (n >> 8) & 0xff);
  };

  if (m.weight == null) {
    pushU16(WEIGHT_UNSUCCESSFUL);
  } else {
    const raw = Math.round(m.weight / (imperial ? RES_LB : RES_KG));
    pushU16(Math.max(0, Math.min(0xfffe, raw)));
  }

  if (flags & FLAG_TIMESTAMP) {
    const t = m.timestamp;
    pushU16(t.getFullYear());
    bytes.push(t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds());
  }
  if (flags & FLAG_USER_ID) bytes.push(m.userId & 0xff);
  if (flags & FLAG_BMI_HEIGHT) {
    pushU16(m.bmi * 10);
    pushU16(imperial ? m.height * 10 : m.height * 1000);
  }
  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------------------
// Proprietary / vendor formats
// ---------------------------------------------------------------------------

/**
 * Template for a vendor-specific scale format. Selected in the UI with
 * "Parser: Custom". Return a reading built with makeReading(...), or null if
 * this packet is not a weight packet (it will still appear in the raw log).
 *
 * How to adapt:
 *   1. Connect with your custom service/characteristic UUIDs.
 *   2. Step on and off the scale and watch the Raw Data Log.
 *   3. Find the bytes that change with weight. Try uint16 big- AND
 *      little-endian, then divide by 10, 100 or 200 until it matches
 *      the scale's own display.
 *   4. Look for a constant header byte (packet type), a "stable/final"
 *      flag bit, and a trailing checksum (often XOR or sum of bytes).
 *
 * The commented code below is a HYPOTHETICAL example, not a real vendor
 * format:
 *   [0xAC, type, wHi, wLo, status, ..., checksum]
 *   type 0x02 = weight packet, weight = uint16 BE / 100 kg,
 *   status bit 0 = final (stable) reading.
 */
export function parseCustomScale(input) {
  const dv = toDataView(input);

  // --- Example (uncomment and edit) -------------------------------------
  // if (dv.byteLength < 5 || dv.getUint8(0) !== 0xac || dv.getUint8(1) !== 0x02) {
  //   return null; // not a weight packet
  // }
  // const raw = dv.getUint16(2, false); // big-endian
  // const reading = makeReading({
  //   format: 'custom',
  //   unit: 'kg',
  //   rawWeight: raw,
  //   weight: round(raw / 100, 2),
  // });
  // reading.vendorFinal = (dv.getUint8(4) & 0x01) !== 0;
  // return reading;
  // ----------------------------------------------------------------------

  void dv;
  return null;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function formatTimestamp(ts) {
  if (!ts) return '';
  const p = function (n) {
    return ('0' + n).slice(-2);
  };
  const year = ts.year === 0 ? '????' : String(ts.year);
  const month = ts.month === 0 ? '??' : p(ts.month);
  const day = ts.day === 0 ? '??' : p(ts.day);
  return year + '-' + month + '-' + day + ' ' + p(ts.hours) + ':' + p(ts.minutes) + ':' + p(ts.seconds);
}

/** One-line summary of a parsed reading for the raw log. */
export function describeReading(r) {
  if (!r) return '';
  if (r.measurementUnsuccessful) return 'Measurement unsuccessful (0xFFFF)';
  const parts = [r.weight + ' ' + r.unit];
  if (r.timestamp) parts.push('ts ' + formatTimestamp(r.timestamp));
  if (r.userId != null) parts.push('user ' + (r.userIdUnknown ? 'unknown' : r.userId));
  if (r.bmi != null) parts.push('BMI ' + r.bmi);
  if (r.height != null) parts.push('height ' + r.height + ' ' + r.heightUnit);
  if (r.extraBytes) parts.push(r.extraBytes + ' extra byte(s)');
  if (r.flags != null) parts.push('flags 0x' + ('0' + r.flags.toString(16)).slice(-2).toUpperCase());
  return parts.join(', ');
}
