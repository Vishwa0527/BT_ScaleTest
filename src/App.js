import React, { Component } from 'react';
import ConnectionPanel from './components/ConnectionPanel';
import WeightDisplay from './components/WeightDisplay';
import HistoryTable from './components/HistoryTable';
import RawLog from './components/RawLog';
import ScaleService, { getBluetoothSupport, friendlyError } from './bluetooth/scaleService.js';
import MockScale from './bluetooth/mockScale.js';
import StabilityTracker from './bluetooth/stability.js';
import {
  parseWeightMeasurement,
  parseCustomScale,
  toHex,
  describeReading,
  kgToLb,
  round,
} from './bluetooth/parser.js';

const MAX_LOG = 500;
const MAX_HISTORY = 5000;
const TICK_MS = 200;

function appendCapped(list, item, max) {
  const next = list.length >= max ? list.slice(list.length - max + 1) : list.slice();
  next.push(item);
  return next;
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export default class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      btSupport: { supported: true, message: '' },
      adapterAvailable: true,

      status: 'disconnected', // 'disconnected' | 'connecting' | 'connected'
      connectedVia: null, // 'ble' | 'mock'
      deviceName: '',
      subscription: '',

      mockMode: false,
      mockUnit: 'kg',
      acceptAllDevices: false,
      serviceUuid: '',
      characteristicUuid: '',
      parserMode: 'standard',

      current: null, // last parsed reading + receivedAt
      stable: false,
      displayUnit: 'kg',

      history: [],
      stableOnly: false,

      rawLog: [],
      logPaused: false,

      error: '',
      info: '',
    };

    this.nextId = 1;
    this.connectAttempt = 0;
    this.stability = new StabilityTracker({ thresholdKg: 0.05, windowMs: 2000 });
    this.mock = null;

    this.handleBleData = this.handleBleData.bind(this);
    this.handleMockData = this.handleMockData.bind(this);
    this.handleUnexpectedDisconnect = this.handleUnexpectedDisconnect.bind(this);
    this.handleAvailabilityChanged = this.handleAvailabilityChanged.bind(this);
    this.handleFieldChange = this.handleFieldChange.bind(this);
    this.handleConnect = this.handleConnect.bind(this);
    this.handleDisconnect = this.handleDisconnect.bind(this);
    this.tick = this.tick.bind(this);
    this.exportCsv = this.exportCsv.bind(this);

    this.scale = new ScaleService({
      onData: this.handleBleData,
      onDisconnect: this.handleUnexpectedDisconnect,
    });
  }

  // ---------------------------------------------------------------- lifecycle

  componentDidMount() {
    const btSupport = getBluetoothSupport();
    this.setState({ btSupport: btSupport, mockMode: !btSupport.supported });

    if (btSupport.supported) {
      const bt = navigator.bluetooth;
      if (typeof bt.getAvailability === 'function') {
        bt.getAvailability()
          .then((available) => {
            if (!this.unmounted) this.setState({ adapterAvailable: available });
          })
          .catch(() => {});
      }
      if (typeof bt.addEventListener === 'function') {
        bt.addEventListener('availabilitychanged', this.handleAvailabilityChanged);
      }
    }

    this.tickTimer = setInterval(this.tick, TICK_MS);
  }

  componentWillUnmount() {
    this.unmounted = true;
    clearInterval(this.tickTimer);
    if (navigator.bluetooth && typeof navigator.bluetooth.removeEventListener === 'function') {
      navigator.bluetooth.removeEventListener('availabilitychanged', this.handleAvailabilityChanged);
    }
    this.scale.disconnect();
    this.stopMock();
  }

  handleAvailabilityChanged(event) {
    this.setState({ adapterAvailable: !!event.value });
  }

  // ------------------------------------------------------------- connection

  handleFieldChange(name, value) {
    this.setState({ [name]: value });
  }

  handleConnect() {
    const attempt = ++this.connectAttempt;
    this.stability.reset();
    this.setState({ status: 'connecting', error: '', info: '', stable: false });

    let promise;
    if (this.state.mockMode) {
      this.stopMock();
      this.mock = new MockScale({ onData: this.handleMockData, unit: this.state.mockUnit });
      promise = this.mock.connect().then((info) => Object.assign({ via: 'mock' }, info));
    } else {
      // Called directly from the click handler: requestDevice needs a user gesture.
      promise = this.scale
        .connect({
          acceptAllDevices: this.state.acceptAllDevices,
          serviceUuid: this.state.serviceUuid,
          characteristicUuid: this.state.characteristicUuid,
        })
        .then((info) => Object.assign({ via: 'ble' }, info));
    }

    promise.then(
      (info) => {
        if (this.unmounted || attempt !== this.connectAttempt) return;
        this.setState({
          status: 'connected',
          connectedVia: info.via,
          deviceName: info.deviceName,
          subscription:
            'Subscribed to ' + info.mode + ' on ' + info.characteristicUuid + ' (service ' + info.serviceUuid + ')',
          info: info.via === 'ble' ? 'Connected. Step on the scale to start a measurement.' : '',
        });
      },
      (err) => {
        if (this.unmounted || attempt !== this.connectAttempt) return;
        this.setState({ status: 'disconnected', connectedVia: null, error: friendlyError(err) });
      }
    );
  }

  handleDisconnect() {
    this.connectAttempt++; // ignore any connect still in flight
    if (this.state.connectedVia === 'mock' || this.mock) this.stopMock();
    this.scale.disconnect();
    this.stability.reset();
    this.setState({
      status: 'disconnected',
      connectedVia: null,
      stable: false,
      info: 'Disconnected.',
      error: '',
    });
  }

  handleUnexpectedDisconnect() {
    if (this.unmounted) return;
    this.stability.reset();
    this.setState({
      status: 'disconnected',
      connectedVia: null,
      stable: false,
      info: '',
      error:
        'The scale disconnected. Many scales turn Bluetooth off a few seconds after a measurement. ' +
        'Step on the scale and click Connect again.',
    });
  }

  stopMock() {
    if (this.mock) {
      this.mock.disconnect();
      this.mock = null;
    }
  }

  // ------------------------------------------------------------------- data

  handleBleData(dataView) {
    this.handlePacket(dataView, 'ble');
  }

  handleMockData(dataView) {
    this.handlePacket(dataView, 'mock');
  }

  /** Every packet (real or mock) comes through here. */
  handlePacket(dataView, source) {
    if (this.unmounted) return;
    const receivedAt = new Date();

    let reading = null;
    let parseError = '';
    try {
      // Mock packets are always standard 0x2A9D bytes.
      const useCustom = source === 'ble' && this.state.parserMode === 'custom';
      reading = useCustom ? parseCustomScale(dataView) : parseWeightMeasurement(dataView);
    } catch (e) {
      parseError = e.message;
    }

    const logEntry = {
      id: this.nextId++,
      time: receivedAt,
      source: source,
      length: dataView.byteLength,
      hex: toHex(dataView),
      summary: parseError
        ? 'Parse error: ' + parseError
        : reading
        ? describeReading(reading)
        : 'not parsed (parseCustomScale returned null)',
      isError: !!parseError,
    };

    let stab = null;
    if (reading && reading.weightKg != null) {
      stab = this.stability.update(reading.weightKg, receivedAt.getTime());
    }

    this.setState((prev) => {
      const next = {};
      if (!prev.logPaused) next.rawLog = appendCapped(prev.rawLog, logEntry, MAX_LOG);

      if (reading) {
        next.current = Object.assign({}, reading, { receivedAt: receivedAt });
        next.stable = stab ? stab.stable : false;
      }

      if (stab) {
        const shouldLog = prev.stableOnly ? stab.justBecameStable && reading.weightKg > 0 : true;
        if (shouldLog) {
          next.history = appendCapped(prev.history, this.makeHistoryRow(reading, receivedAt, stab.stable), MAX_HISTORY);
        }
      }
      return next;
    });
  }

  /** Runs on a timer: catches stability when the scale stops sending. */
  tick() {
    if (this.state.status !== 'connected' || !this.state.current) return;
    const stab = this.stability.tick(Date.now());
    if (stab.stable === this.state.stable && !stab.justBecameStable) return;

    this.setState((prev) => {
      const next = { stable: stab.stable };
      const cur = prev.current;
      if (stab.justBecameStable && cur && cur.weightKg != null && (!prev.stableOnly || cur.weightKg > 0)) {
        next.history = appendCapped(prev.history, this.makeHistoryRow(cur, new Date(), true), MAX_HISTORY);
      }
      return next;
    });
  }

  makeHistoryRow(reading, time, stable) {
    return {
      id: this.nextId++,
      time: time,
      weightKg: reading.weightKg,
      nativeValue: reading.weight,
      nativeUnit: reading.unit,
      userId: reading.userId,
      stable: stable,
    };
  }

  exportCsv() {
    const header = ['timestamp_iso', 'local_time', 'weight_kg', 'weight_lb', 'native_value', 'native_unit', 'stable', 'user_id'];
    const lines = [header.join(',')];
    this.state.history.forEach((r) => {
      lines.push(
        [
          r.time.toISOString(),
          r.time.toLocaleString(),
          round(r.weightKg, 3),
          round(kgToLb(r.weightKg), 2),
          r.nativeValue,
          r.nativeUnit,
          r.stable ? 'yes' : 'no',
          r.userId,
        ]
          .map(csvCell)
          .join(',')
      );
    });

    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scale-readings-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ----------------------------------------------------------------- render

  render() {
    const s = this.state;
    return (
      <div className="app">
        <header className="app-header">
          <h1>BLE Scale Tester</h1>
          <span className="muted small">Web Bluetooth · Weight Scale 0x181D / Weight Measurement 0x2A9D</span>
        </header>

        {!s.btSupport.supported ? (
          <div className="banner banner-warn">
            <strong>Web Bluetooth unavailable.</strong> {s.btSupport.message}
          </div>
        ) : null}
        {s.btSupport.supported && !s.adapterAvailable ? (
          <div className="banner banner-warn">
            No Bluetooth adapter is available, or Bluetooth is turned off. Turn it on in your OS settings.
          </div>
        ) : null}
        {s.error ? (
          <div className="banner banner-error" role="alert">
            {s.error}
            <button className="link" onClick={() => this.setState({ error: '' })}>
              Dismiss
            </button>
          </div>
        ) : null}
        {s.info ? <div className="banner banner-info">{s.info}</div> : null}

        <div className="grid-top">
          <ConnectionPanel
            status={s.status}
            deviceName={s.deviceName}
            connectedVia={s.connectedVia}
            subscription={s.subscription}
            btSupported={s.btSupport.supported}
            mockMode={s.mockMode}
            mockUnit={s.mockUnit}
            acceptAllDevices={s.acceptAllDevices}
            serviceUuid={s.serviceUuid}
            characteristicUuid={s.characteristicUuid}
            parserMode={s.parserMode}
            onChange={this.handleFieldChange}
            onConnect={this.handleConnect}
            onDisconnect={this.handleDisconnect}
          />
          <WeightDisplay
            reading={s.current}
            stable={s.stable}
            status={s.status}
            displayUnit={s.displayUnit}
            onUnitChange={(u) => this.setState({ displayUnit: u })}
          />
        </div>

        <div className="grid-bottom">
          <HistoryTable
            rows={s.history}
            displayUnit={s.displayUnit}
            stableOnly={s.stableOnly}
            onToggleStableOnly={(v) => this.setState({ stableOnly: v })}
            onClear={() => this.setState({ history: [] })}
            onExport={this.exportCsv}
          />
          <RawLog
            entries={s.rawLog}
            paused={s.logPaused}
            onTogglePause={() => this.setState((p) => ({ logPaused: !p.logPaused }))}
            onClear={() => this.setState({ rawLog: [] })}
          />
        </div>
      </div>
    );
  }
}
