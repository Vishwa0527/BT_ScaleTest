import React, { Component } from 'react';
import { kgToLb, formatTimestamp } from '../bluetooth/parser.js';

export default class WeightDisplay extends Component {
  constructor(props) {
    super(props);
    this.state = { packetCount: 0, lastReceivedAt: null };
  }

  // Count packets by watching for a new receivedAt in props.
  static getDerivedStateFromProps(props, state) {
    const r = props.reading;
    const t = r && r.receivedAt ? r.receivedAt.getTime() : null;
    if (t === state.lastReceivedAt) return null;
    return { lastReceivedAt: t, packetCount: t === null ? 0 : state.packetCount + 1 };
  }

  render() {
    const { reading, displayUnit, stable, status, onUnitChange } = this.props;
    const hasWeight = reading && reading.weightKg != null;
    const value = hasWeight ? (displayUnit === 'kg' ? reading.weightKg : kgToLb(reading.weightKg)) : null;

    let badge;
    if (!hasWeight) badge = <span className="badge badge-idle">No data</span>;
    else if (stable) badge = <span className="badge badge-stable">● Stable</span>;
    else badge = <span className="badge badge-measuring">Measuring…</span>;

    return (
      <section className="panel weight-display">
        <div className="weight-header">
          <h2>Live Weight</h2>
          <div className="segmented" role="group" aria-label="Display unit">
            <button className={displayUnit === 'kg' ? 'active' : ''} onClick={() => onUnitChange('kg')}>
              kg
            </button>
            <button className={displayUnit === 'lb' ? 'active' : ''} onClick={() => onUnitChange('lb')}>
              lb
            </button>
          </div>
        </div>

        <div className={'weight-value' + (stable && hasWeight ? ' is-stable' : '')}>
          {reading && reading.measurementUnsuccessful ? (
            <span className="weight-error">Measurement unsuccessful</span>
          ) : (
            <span>
              {value === null ? '--.--' : value.toFixed(2)}
              <span className="weight-unit">{displayUnit}</span>
            </span>
          )}
        </div>

        <div className="weight-badges">
          {badge}
          {status !== 'connected' && reading ? <span className="badge badge-idle">Last value (disconnected)</span> : null}
        </div>

        {reading ? (
          <dl className="details">
            <dt>Scale reports</dt>
            <dd>
              {reading.weight == null ? '—' : reading.weight + ' ' + reading.unit}
              {reading.rawWeight != null ? (
                <span className="muted"> (raw {reading.rawWeight})</span>
              ) : null}
            </dd>
            {reading.userId != null ? <dt>User ID</dt> : null}
            {reading.userId != null ? <dd>{reading.userIdUnknown ? 'unknown (0xFF)' : reading.userId}</dd> : null}
            {reading.bmi != null ? <dt>BMI</dt> : null}
            {reading.bmi != null ? <dd>{reading.bmi}</dd> : null}
            {reading.height != null ? <dt>Height</dt> : null}
            {reading.height != null ? <dd>{reading.height + ' ' + reading.heightUnit}</dd> : null}
            {reading.timestamp ? <dt>Scale time</dt> : null}
            {reading.timestamp ? <dd>{formatTimestamp(reading.timestamp)}</dd> : null}
            <dt>Received</dt>
            <dd>
              {reading.receivedAt.toLocaleTimeString()} · {this.state.packetCount} packet
              {this.state.packetCount === 1 ? '' : 's'}
            </dd>
          </dl>
        ) : (
          <p className="muted">Connect a scale (or turn on Mock Mode) and step on it.</p>
        )}
      </section>
    );
  }
}
