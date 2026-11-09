import React, { Component } from 'react';

const STATUS_LABEL = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
};

export default class ConnectionPanel extends Component {
  constructor(props) {
    super(props);
    this.handleInput = this.handleInput.bind(this);
    this.handleCheckbox = this.handleCheckbox.bind(this);
  }

  handleInput(e) {
    this.props.onChange(e.target.name, e.target.value);
  }

  handleCheckbox(e) {
    this.props.onChange(e.target.name, e.target.checked);
  }

  render() {
    const p = this.props;
    const idle = p.status === 'disconnected';
    const bleBlocked = !p.mockMode && !p.btSupported;

    return (
      <section className="panel connection-panel">
        <h2>Connection</h2>

        <div className="status-row">
          <span className={'status-dot status-' + p.status} />
          <strong>{STATUS_LABEL[p.status]}</strong>
          {p.deviceName && p.status !== 'disconnected' ? (
            <span className="device-name">
              {p.deviceName}
              {p.connectedVia === 'mock' ? ' · mock' : ''}
            </span>
          ) : null}
        </div>
        {p.subscription && p.status === 'connected' ? (
          <div className="muted small">{p.subscription}</div>
        ) : null}

        <div className="button-row">
          {p.status === 'disconnected' ? (
            <button className="primary" onClick={p.onConnect} disabled={bleBlocked}>
              {p.mockMode ? 'Connect Mock Scale' : 'Connect Scale'}
            </button>
          ) : (
            <button onClick={p.onDisconnect}>
              {p.status === 'connecting' ? 'Cancel' : 'Disconnect'}
            </button>
          )}
        </div>

        <fieldset disabled={!idle}>
          <label className="check">
            <input type="checkbox" name="mockMode" checked={p.mockMode} onChange={this.handleCheckbox} />
            Mock Mode (simulated scale, no hardware needed)
          </label>

          {p.mockMode ? (
            <label className="field">
              <span>Mock scale units</span>
              <select name="mockUnit" value={p.mockUnit} onChange={this.handleInput}>
                <option value="kg">SI (kg) — flags bit 0 = 0</option>
                <option value="lb">Imperial (lb) — flags bit 0 = 1</option>
              </select>
            </label>
          ) : (
            <div>
              <label className="check">
                <input
                  type="checkbox"
                  name="acceptAllDevices"
                  checked={p.acceptAllDevices}
                  onChange={this.handleCheckbox}
                />
                Accept all devices (for scales with proprietary services)
              </label>

              <label className="field">
                <span>Custom Service UUID</span>
                <input
                  type="text"
                  name="serviceUuid"
                  value={p.serviceUuid}
                  onChange={this.handleInput}
                  placeholder="default 0x181D (Weight Scale)"
                  spellCheck="false"
                  autoComplete="off"
                />
              </label>

              <label className="field">
                <span>Custom Characteristic UUID</span>
                <input
                  type="text"
                  name="characteristicUuid"
                  value={p.characteristicUuid}
                  onChange={this.handleInput}
                  placeholder="default 0x2A9D (Weight Measurement)"
                  spellCheck="false"
                  autoComplete="off"
                />
              </label>

              <p className="muted small">
                Accepts 16-bit (<code>0xFFF0</code>, <code>fff0</code>) or 128-bit UUIDs (
                <code>0000fff0-0000-1000-8000-00805f9b34fb</code>). Leave empty to use the standard
                Weight Scale service. 0x181D and 0x181B are always requested as optional services.
              </p>
            </div>
          )}
        </fieldset>

        {!p.mockMode ? (
          <label className="field">
            <span>Parser</span>
            <select name="parserMode" value={p.parserMode} onChange={this.handleInput}>
              <option value="standard">Standard Weight Measurement (0x2A9D)</option>
              <option value="custom">Custom — parseCustomScale() in parser.js</option>
            </select>
          </label>
        ) : null}
      </section>
    );
  }
}
