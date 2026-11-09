import React, { Component } from 'react';
import { kgToLb } from '../bluetooth/parser.js';

const MAX_RENDERED = 300;

export default class HistoryTable extends Component {
  render() {
    const { rows, displayUnit, stableOnly, onToggleStableOnly, onClear, onExport } = this.props;
    // Newest first. Only the most recent rows are rendered; CSV export has all of them.
    const visible = rows.slice(-MAX_RENDERED).reverse();

    return (
      <section className="panel history">
        <div className="panel-header">
          <h2>
            Reading History <span className="muted small">({rows.length})</span>
          </h2>
          <div className="button-row">
            <label className="check inline">
              <input type="checkbox" checked={stableOnly} onChange={(e) => onToggleStableOnly(e.target.checked)} />
              Log stable readings only
            </label>
            <button onClick={onExport} disabled={rows.length === 0}>
              Export CSV
            </button>
            <button onClick={onClear} disabled={rows.length === 0}>
              Clear
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th className="num">Value</th>
                <th>Unit</th>
                <th>Stable</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan="4" className="muted empty">
                    No readings yet.
                  </td>
                </tr>
              ) : (
                visible.map((row) => {
                  const v = displayUnit === 'kg' ? row.weightKg : kgToLb(row.weightKg);
                  return (
                    <tr key={row.id} className={row.stable ? 'row-stable' : ''}>
                      <td>{row.time.toLocaleTimeString()}</td>
                      <td className="num">{v.toFixed(2)}</td>
                      <td>{displayUnit}</td>
                      <td>{row.stable ? 'Yes' : 'No'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {rows.length > MAX_RENDERED ? (
          <p className="muted small">Showing the latest {MAX_RENDERED} rows. Export CSV to get all of them.</p>
        ) : null}
      </section>
    );
  }
}
