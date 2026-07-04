# Capstone Backend (MQTT -> REST & WebSocket)

Quick prototype backend to bridge MQTT topics into a simple HTTP + WebSocket API for the frontend.

Requirements
- Node.js 18+

Install & run

```bash
cd server
npm install
npm start
```

Behavior
- Connects to public broker `mqtt://broker.emqx.io:1883` with client id `mqttx_9c6ac5d1`
- Subscribes to topics: `RAINSENSOR`, `WATERLEVELSENSORKAI`, `WATERLEVELSENSORKRL`
- Stores incoming messages to `server/data/history.json`
- Provides REST endpoints:
  - `GET /api/dashboard/realtime` — latest values
  - `GET /api/data/historical` — historical messages (query params: `topic`, `from`, `to`)
  - `GET /api/data/topics` — list of topics and location
- WebSocket server broadcasts incoming messages to connected clients

Notes
- Payloads are treated as plaintext; numeric strings are converted to Number when possible.
