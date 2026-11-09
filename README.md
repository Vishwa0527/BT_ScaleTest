# BLE Scale Tester

A small React 16.4.2 app (class components only) for testing Bluetooth Low
Energy weighing scales through the browser's Web Bluetooth API.

- Standard Weight Scale service (0x181D) and Weight Measurement characteristic
  (0x2A9D), decoded per the Bluetooth SIG spec
- Custom service and characteristic UUIDs for vendor-specific scales
- Live weight with kg/lb toggle, a stable-reading indicator, history with CSV
  export, and a raw hex packet log
- Mock Mode: a simulated scale that sends genuine 0x2A9D bytes through the same
  parser as real hardware

## Requirements

- Node.js 18 or newer (tested with Node 22)
- A browser with Web Bluetooth: **Chrome, Edge or Opera on desktop**, or
  **Chrome on Android**. Safari, all iOS browsers and Firefox are not supported.
  Brave turns it off by default.
- A secure context: `https://` or `http://localhost`. A LAN address such as
  `http://192.168.1.5:5173` will **not** work.
- Linux only: you may need to enable
  `chrome://flags/#enable-experimental-web-platform-features`.

## Install and run

```bash
cd BT_ScaleTest
npm install          # installs react@16.4.2, react-dom@16.4.2 and vite
npm start            # dev server at http://localhost:5173
```

1. Open **http://localhost:5173** in Chrome or Edge.
2. With no scale at hand, tick **Mock Mode** and click **Connect Mock Scale**.
3. With a real scale, wake it by stepping on it, then click **Connect Scale**
   and choose it in the browser's device picker.
   - If the picker is empty, the scale doesn't advertise 0x181D. Tick **Accept
     all devices**, then enter its custom service and characteristic UUIDs (see
     below).
   - Close the vendor app on your phone first. Most scales accept only one
     connection at a time.

Other scripts:

```bash
npm test             # parser and stability unit tests (plain Node, no browser)
npm run build        # production build in dist/
npm run preview      # serve the build at http://localhost:4173
```

> **Why Vite and not Create React App?** react-scripts versions from the React
> 16.4 era don't run on current Node.js. Vite is set up to use the classic JSX
> transform (`React.createElement`), which works with React 16.4.2. That is why
> every component file does `import React from 'react'`.

## Project layout

```
src/
  App.js                    main container, holds all state
  components/
    ConnectionPanel.js      connect/disconnect, mock toggle, UUID inputs, parser select
    WeightDisplay.js        large live value, kg/lb toggle, stable badge, decoded fields
    HistoryTable.js         reading history, Clear, Export CSV
    RawLog.js               every packet as hex + timestamp (Pause / Copy / Clear)
  bluetooth/
    scaleService.js         requestDevice, GATT connect, notifications, disconnect, friendly errors
    parser.js               pure decode/encode functions with worked byte examples
    mockScale.js            simulator (encodes real 0x2A9D packets)
    stability.js            "stable" detection: within 0.05 kg for 2 s
scripts/test-parser.js      `npm test`
```

## How "stable" works

A reading is **stable** once every value has stayed within ±0.05 kg of an
anchor value for 2 seconds. A value outside that band becomes the new anchor
and restarts the 2-second clock. A 200 ms timer also re-checks stability,
because many scales stop sending packets once the weight settles.

**Log stable readings only** (in the history panel) adds one row per settled
weighing instead of one row per packet.

## Finding a scale's custom UUIDs (nRF Connect)

1. Install **nRF Connect for Mobile** (Android or iOS) from Nordic Semiconductor.
2. Close the scale's own app, or force-stop it, so it can't hold the connection.
3. Step on the scale to wake it, then tap **Scan** in nRF Connect. Identify the
   scale by name (often something like `QN-Scale`, `Chipsea-BLE`, `MI SCALE2`) or
   by watching the RSSI rise as you move the phone closer.
4. Tap **Connect** and look at the services that appear:
   - `Weight Scale` (0x181D), `Body Composition` (0x181B): standard. The app's
     defaults should work.
   - `Unknown Service` with a 16-bit UUID such as `0xFFF0`, `0xFFB0`, `0xFFE0`,
     or a 128-bit UUID: vendor-specific.
5. Expand the service. Find the characteristic marked **NOTIFY** or
   **INDICATE**. That's where weight data arrives. Tap the triple-arrow icon to
   subscribe, then step on the scale and watch the values change.
6. Copy the service UUID and characteristic UUID into the app's custom fields,
   tick **Accept all devices**, and connect.

**Notes**
- Some scales only send data after a *write* to another characteristic (for
  example a "start measurement" or "set time/user" command). If nothing arrives,
  use nRF Connect's logger while the official app is running to see what it
  writes. This app doesn't send writes yet; add a `characteristic.writeValue(...)`
  in `scaleService.js` after `startNotifications()`.
- Some cheap scales never accept a connection. They only *broadcast* weight in
  their advertising packets (manufacturer data). Web Bluetooth GATT can't read
  those. You'd need `watchAdvertisements()` (experimental, behind a Chrome flag)
  or a native app.
- Chrome blocks a few UUIDs (the Web Bluetooth blocklist), and access fails with
  a clear error message.

## Adapting `parser.js` to a proprietary format

1. Connect with your custom UUIDs and set **Parser** to **Custom** in the
   connection panel. Every packet still appears in the **Raw Data Log**.
2. Record a few weighings with known weights, for example nothing, a 5 kg
   dumbbell, then yourself. Use **Copy** to paste the log into a text editor.
3. Look for patterns:
   - **Constant header byte(s)** (for example `AC 02 …`) give the packet type.
     Ignore packet types that don't carry weight.
   - **Weight bytes**: the 2 bytes that change with the load. Try the value as
     uint16 **big-endian** and **little-endian**, and divide by 10, 100 or 200
     until it matches the scale's display.
   - **Stable/final flag**: a byte or bit that flips when the display locks.
   - **Unit bits**: often a field that changes when you switch kg/lb/st on the
     scale.
   - **Checksum**: the last byte is often an XOR or sum of the earlier bytes.
4. Edit `parseCustomScale()` in `src/bluetooth/parser.js`. A commented
   template is already there. Return `makeReading({ unit, weight, ... })` for
   weight packets and `null` for anything else. The rest of the UI (display,
   stability, history, CSV) works unchanged.
5. Add your captured byte arrays and expected results to
   `scripts/test-parser.js` and run `npm test`.
