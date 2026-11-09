/**
 * scaleService.js — Web Bluetooth connect / subscribe / disconnect logic.
 *
 * No React here. The App gives it two callbacks:
 *   onData(dataView)  — every notification/indication payload
 *   onDisconnect()    — unexpected disconnects (not ones the user started)
 */
import {
  WEIGHT_SCALE_SERVICE,
  BODY_COMPOSITION_SERVICE,
  WEIGHT_MEASUREMENT_CHAR,
} from './parser.js';

/** Error whose message is already user-friendly. */
export class FriendlyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FriendlyError';
    this.friendly = true;
  }
}

/** Find out whether Web Bluetooth can be used in this browser/context. */
export function getBluetoothSupport() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, message: 'Not running in a browser.' };
  }
  if (!window.isSecureContext) {
    return {
      supported: false,
      message:
        'Web Bluetooth needs a secure context. Open the app at https:// or http://localhost. ' +
        'A plain http:// LAN address such as http://192.168.x.x will not work.',
    };
  }
  if (!navigator.bluetooth) {
    return {
      supported: false,
      message:
        'This browser does not support Web Bluetooth. Use Chrome, Edge or Opera on desktop ' +
        '(Windows, macOS, ChromeOS, Linux) or Chrome on Android. Safari, all iOS browsers ' +
        'and Firefox do not support it. Brave turns it off by default (brave://flags). ' +
        'You can still use Mock Mode.',
    };
  }
  return { supported: true, message: '' };
}

/**
 * Accepts "0x181D", "181d", "0000fff0", a full 128-bit UUID, or a GATT
 * name such as "weight_scale". Returns a value that requestDevice /
 * getPrimaryService accept, or null when the input is empty.
 */
export function normalizeUuid(input, label) {
  const s = (input || '').trim();
  if (!s) return null;
  const hex = s.replace(/^0x/i, '');
  if (/^[0-9a-f]{4}$/i.test(hex) || /^[0-9a-f]{8}$/i.test(hex)) {
    return parseInt(hex, 16);
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return s.toLowerCase();
  }
  if (/^[a-z0-9_.]+$/.test(s)) return s;
  throw new FriendlyError(
    label + ' "' + s + '" is not a valid UUID. Enter a 16-bit hex value (e.g. 0x181D or FFF0) ' +
      'or a full 128-bit UUID (e.g. 0000fff0-0000-1000-8000-00805f9b34fb).'
  );
}

/** Short display form: 0x181D for numeric aliases, otherwise unchanged. */
export function formatUuid(uuid) {
  if (typeof uuid === 'number') {
    const h = uuid.toString(16).toUpperCase();
    return '0x' + ('0000'.slice(h.length) + h);
  }
  return String(uuid);
}

const STAGE_LABELS = {
  request: 'Choosing a device',
  gatt: 'Connecting to the GATT server',
  service: 'Getting the service',
  characteristic: 'Getting the characteristic',
  notify: 'Starting notifications',
};

function tagStage(err, stage) {
  if (err && typeof err === 'object' && !err.stage) {
    try {
      err.stage = stage;
    } catch (e) {
      /* some DOMExceptions are frozen; ignore */
    }
  }
  return err;
}

/** Turn a Web Bluetooth error into a message the user can act on. */
export function friendlyError(err) {
  if (!err) return 'Unknown error.';
  if (err.friendly) return err.message;

  const name = err.name || 'Error';
  const msg = err.message || String(err);
  const stage = err.stage;
  const where = STAGE_LABELS[stage] ? STAGE_LABELS[stage] + ' failed. ' : '';
  const awakeTip =
    'Make sure the scale is awake (step on it), in range, and not connected to another ' +
    'phone or app. Close the vendor app, since most scales accept only one connection.';

  if (/adapter not available|bluetooth adapter/i.test(msg)) {
    return 'Bluetooth is turned off or no Bluetooth adapter was found. Turn on Bluetooth and try again.';
  }

  if (name === 'NotFoundError') {
    if (/cancel/i.test(msg)) {
      return 'Pairing cancelled: no device was selected. Click "Connect Scale" to try again.';
    }
    if (stage === 'service' || /services? matching/i.test(msg)) {
      return (
        'Service not found on this device. ' + msg + ' The scale probably uses a vendor-specific ' +
        'service. Turn on "Accept all devices" and enter its Service UUID (find it with nRF Connect).'
      );
    }
    if (stage === 'characteristic' || /characteristics? matching/i.test(msg)) {
      return (
        'Characteristic not found in this service. ' + msg + ' Check the Characteristic UUID ' +
        'in nRF Connect. Look for the one with the NOTIFY or INDICATE property.'
      );
    }
    return where + 'No matching device: ' + msg;
  }

  if (name === 'SecurityError') {
    if (/blocklist/i.test(msg)) {
      return 'That UUID is on the Web Bluetooth blocklist, so the browser will not allow access to it. ' + msg;
    }
    if (/origin is not allowed|optionalServices/i.test(msg)) {
      return (
        'The browser did not grant access to that service. Enter the Service UUID in the ' +
        'custom field so it is added to optionalServices, then reconnect. (' + msg + ')'
      );
    }
    return (
      'Bluetooth access was blocked (' + msg + '). The page must use HTTPS or localhost, the ' +
      'request must come from a click, and it must not run inside a cross-origin iframe.'
    );
  }

  if (name === 'NetworkError') {
    return where + 'GATT error: ' + msg + ' ' + awakeTip;
  }

  if (name === 'NotSupportedError') {
    return where + 'The device does not support this operation: ' + msg;
  }

  if (name === 'NotAllowedError') {
    return 'Bluetooth permission was denied. Check the site permissions and OS Bluetooth privacy settings. (' + msg + ')';
  }

  if (name === 'InvalidStateError') {
    return where + 'Bluetooth is in an invalid state: ' + msg + ' Try disconnecting and connecting again.';
  }

  if (name === 'TypeError' && /uuid|service name|characteristic name/i.test(msg)) {
    return 'Invalid UUID: ' + msg;
  }

  return where + name + ': ' + msg;
}

export default class ScaleService {
  constructor(callbacks) {
    this.onData = callbacks.onData;
    this.onDisconnect = callbacks.onDisconnect;
    this.device = null;
    this.characteristic = null;
    this.userInitiatedDisconnect = false;

    this._handleValueChanged = this._handleValueChanged.bind(this);
    this._handleGattDisconnected = this._handleGattDisconnected.bind(this);
  }

  isConnected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected);
  }

  /**
   * Must be called directly from a click handler: requestDevice() needs a
   * user gesture. Nothing async runs before it.
   */
  async connect(opts) {
    const customService = normalizeUuid(opts.serviceUuid, 'Service UUID');
    const customChar = normalizeUuid(opts.characteristicUuid, 'Characteristic UUID');
    const serviceUuid = customService != null ? customService : WEIGHT_SCALE_SERVICE;
    const charUuid = customChar != null ? customChar : WEIGHT_MEASUREMENT_CHAR;

    // When acceptAllDevices is used, a service is reachable only if it is
    // listed in optionalServices.
    const optionalServices = [WEIGHT_SCALE_SERVICE, BODY_COMPOSITION_SERVICE];
    if (optionalServices.indexOf(serviceUuid) === -1) optionalServices.push(serviceUuid);

    const requestOptions = opts.acceptAllDevices
      ? { acceptAllDevices: true, optionalServices: optionalServices }
      : { filters: [{ services: [serviceUuid] }], optionalServices: optionalServices };

    let device;
    try {
      device = await navigator.bluetooth.requestDevice(requestOptions);
    } catch (err) {
      throw tagStage(err, 'request');
    }

    this._teardown(); // drop any previous device
    this.device = device;
    this.userInitiatedDisconnect = false;
    device.addEventListener('gattserverdisconnected', this._handleGattDisconnected);

    let stage = 'gatt';
    try {
      const server = await device.gatt.connect();

      stage = 'service';
      const service = await server.getPrimaryService(serviceUuid);

      stage = 'characteristic';
      const characteristic = await service.getCharacteristic(charUuid);

      const props = characteristic.properties;
      if (!props.notify && !props.indicate) {
        const available = ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate']
          .filter(function (p) {
            return props[p];
          })
          .join(', ');
        throw new FriendlyError(
          'Characteristic ' + formatUuid(charUuid) + ' does not support notifications or ' +
            'indications (properties: ' + (available || 'none') + '). Pick the characteristic ' +
            'marked NOTIFY or INDICATE in nRF Connect.'
        );
      }

      stage = 'notify';
      // Add the listener first so the first packet is not missed.
      characteristic.addEventListener('characteristicvaluechanged', this._handleValueChanged);
      await characteristic.startNotifications();
      this.characteristic = characteristic;

      return {
        deviceName: device.name || '(unnamed device)',
        deviceId: device.id,
        serviceUuid: formatUuid(serviceUuid),
        characteristicUuid: formatUuid(charUuid),
        mode: props.indicate && !props.notify ? 'indications' : 'notifications',
      };
    } catch (err) {
      // Stop the disconnect handler from reporting this as an unexpected drop.
      this.userInitiatedDisconnect = true;
      this._teardown();
      throw tagStage(err, stage);
    }
  }

  /** User-initiated disconnect. Safe to call at any time. */
  async disconnect() {
    this.userInitiatedDisconnect = true;
    const ch = this.characteristic;
    if (ch && this.isConnected()) {
      try {
        await ch.stopNotifications();
      } catch (e) {
        /* device may already be gone */
      }
    }
    this._teardown();
  }

  _handleValueChanged(event) {
    // event.target.value is a DataView over this packet's bytes.
    const value = event.target.value;
    if (value && this.onData) this.onData(value);
  }

  _handleGattDisconnected() {
    const expected = this.userInitiatedDisconnect;
    this._teardown();
    if (!expected && this.onDisconnect) this.onDisconnect();
  }

  /** Remove all listeners and close the GATT connection. */
  _teardown() {
    if (this.characteristic) {
      this.characteristic.removeEventListener('characteristicvaluechanged', this._handleValueChanged);
      this.characteristic = null;
    }
    const device = this.device;
    if (device) {
      this.device = null;
      device.removeEventListener('gattserverdisconnected', this._handleGattDisconnected);
      if (device.gatt && device.gatt.connected) {
        try {
          device.gatt.disconnect();
        } catch (e) {
          /* ignore */
        }
      }
    }
  }
}
