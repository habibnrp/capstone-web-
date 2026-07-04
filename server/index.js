const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const PORT = process.env.PORT || 3000;
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
const DJANGO_API = process.env.DJANGO_API_URL || 'http://localhost:8000/api/monitoring/ingest/';

// Single-location name (can be adjusted later)
const LOCATION = 'Manggarai';

// Topics (from user): RAINSENSOR, WATERLEVELSENSORKAI, WATERLEVELSENSORKRL
const MQTT_BROKER = 'mqtt://broker.emqx.io:1883';
const MQTT_CLIENT_ID = 'mqttx_9c6ac5d1';
const TOPICS = ['RAINSENSOR', 'WATERLEVELSENSORKAI', 'WATERLEVELSENSORKRL'];

// In-memory store for latest values and history
const latest = {
  RAINSENSOR: null,
  WATERLEVELSENSORKAI: null,
  WATERLEVELSENSORKRL: null,
};
const history = [];

// ensure data dir and history file
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}
if (fs.existsSync(HISTORY_FILE)) {
  try {
    const existing = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    if (Array.isArray(existing)) history.push(...existing);
  } catch (err) {
    console.warn('Failed reading history file, starting fresh');
  }
} else {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Broadcast helper
function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

// Send to Django backend
async function sendToDjango(entry) {
  try {
    await axios.post(DJANGO_API, entry, { timeout: 5000 });
    console.log('✓ Sent to Django:', entry.topic, entry.value);
  } catch (err) {
    console.warn('⚠ Failed to send to Django:', err.message);
  }
}

// MQTT client
const mqttClient = mqtt.connect(MQTT_BROKER, { clientId: MQTT_CLIENT_ID });

mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker', MQTT_BROKER);
  mqttClient.subscribe(TOPICS, (err) => {
    if (err) console.error('Subscribe error', err);
    else console.log('Subscribed to topics', TOPICS);
  });
});

mqttClient.on('error', (err) => {
  console.error('MQTT error', err.message);
});

mqttClient.on('message', (topic, message) => {
  const payload = message.toString();
  const ts = new Date().toISOString();

  // Try to parse number, otherwise keep raw
  const value = isNaN(Number(payload)) ? payload : Number(payload);

  const entry = {
    topic,
    location: LOCATION,
    value,
    raw: payload,
    timestamp: ts,
  };

  // update latest
  latest[topic] = entry;
  history.push(entry);

  // persist (overwrite)
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    console.warn('Failed to write history', err.message);
  }

  // Send to Django backend to save to database
  sendToDjango(entry);

  // broadcast to websocket clients (use type 'mqtt_update' for frontend compatibility)
  broadcast({ type: 'mqtt_update', data: entry });
  console.log('📨 Received', topic, payload);
});

// REST endpoints
app.get('/api/dashboard/realtime', (req, res) => {
  res.json({ latest });
});

app.get('/api/data/historical', (req, res) => {
  // optional filters: topic, from, to
  const { topic, from, to } = req.query;
  let result = history.slice();
  if (topic) result = result.filter((r) => r.topic === topic);
  if (from) result = result.filter((r) => r.timestamp >= from);
  if (to) result = result.filter((r) => r.timestamp <= to);
  res.json(result);
});

app.get('/api/data/topics', (req, res) => {
  res.json({ topics: TOPICS, location: LOCATION });
});

// WebSocket ping
wss.on('connection', (ws) => {
  console.log('WS client connected');
  ws.send(JSON.stringify({ type: 'welcome', data: { latest } }));
});

server.listen(PORT, () => {
  console.log(`Backend server listening on http://localhost:${PORT}`);
});
