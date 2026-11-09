import React, { Component } from 'react';

function formatTime(d) {
  const p = (n, w) => ('000' + n).slice(-(w || 2));
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
}

export default class RawLog extends Component {
  constructor(props) {
    super(props);
    this.state = { autoScroll: true, copied: false };
    this.listRef = React.createRef();
    this.copy = this.copy.bind(this);
  }

  componentDidMount() {
    this.scrollToBottom();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.entries !== this.props.entries && this.state.autoScroll) {
      this.scrollToBottom();
    }
  }

  componentWillUnmount() {
    clearTimeout(this.copiedTimer);
  }

  scrollToBottom() {
    const node = this.listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }

  copy() {
    const text = this.props.entries
      .map((e) => formatTime(e.time) + '\t' + e.source + '\t' + e.hex + '\t' + e.summary)
      .join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this.setState({ copied: true });
        clearTimeout(this.copiedTimer);
        this.copiedTimer = setTimeout(() => this.setState({ copied: false }), 1500);
      });
    }
  }

  render() {
    const { entries, paused, onTogglePause, onClear } = this.props;
    return (
      <section className="panel raw-log">
        <div className="panel-header">
          <h2>
            Raw Data Log <span className="muted small">({entries.length})</span>
          </h2>
          <div className="button-row">
            <label className="check inline">
              <input
                type="checkbox"
                checked={this.state.autoScroll}
                onChange={(e) => this.setState({ autoScroll: e.target.checked })}
              />
              Auto-scroll
            </label>
            <button onClick={onTogglePause}>{paused ? 'Resume' : 'Pause'}</button>
            <button onClick={this.copy} disabled={entries.length === 0}>
              {this.state.copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={onClear} disabled={entries.length === 0}>
              Clear
            </button>
          </div>
        </div>

        <div className="log" ref={this.listRef}>
          {entries.length === 0 ? (
            <div className="muted">Incoming packets will appear here as hex bytes.</div>
          ) : (
            entries.map((e) => (
              <div key={e.id} className={'log-line' + (e.isError ? ' log-error' : '')}>
                <span className="log-time">{formatTime(e.time)}</span>
                <span className={'log-src log-src-' + e.source}>{e.source.toUpperCase()}</span>
                <span className="log-len">{e.length}B</span>
                <span className="log-hex">{e.hex}</span>
                <span className="log-summary">{e.summary}</span>
              </div>
            ))
          )}
        </div>
        {paused ? <p className="muted small">Logging is paused. New packets are still parsed but not logged.</p> : null}
      </section>
    );
  }
}
