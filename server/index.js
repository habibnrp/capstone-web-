const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const mqtt = require('mqtt');
const axios = require('axios');
const wilayah = require('wilayah-indonesia');

const PORT = process.env.PORT || 3000;
const DJANGO_API = process.env.DJANGO_API_URL || 'http://localhost:8000/api/monitoring/ingest/';
const DJANGO_HISTORICAL_API = process.env.DJANGO_HISTORICAL_API_URL || 'http://localhost:8000/api/monitoring/historical/';

// Single-location name (can be adjusted later)
const LOCATION = 'Manggarai';

// Topics (from user): RAINSENSOR, WATERLEVELSENSORKAI, WATERLEVELSENSORKRL
const MQTT_BROKER = 'mqtt://broker.emqx.io:1883';
const MQTT_CLIENT_ID = 'mqttx_9c6ac5d1';
const TOPICS = ['RAINSENSOR', 'WATERLEVELSENSORKAI', 'WATERLEVELSENSORKRL'];
const ADC_MAX = 4095;

function getTopicScale(topic) {
  const normalizedTopic = String(topic || '').toUpperCase();
  if (normalizedTopic.includes('KRL')) {
    return { min: 0, max: 10, unit: 'cm', invert: false };
  }
  if (normalizedTopic.includes('KAI')) {
    return { min: 8, max: 15, unit: 'cm', invert: false };
  }
  if (normalizedTopic.includes('RAIN')) {
    return { min: 0, max: 50, unit: 'mm', invert: true };
  }
  return { min: null, max: null, unit: '', invert: false };
}

function convertAdcToPhysical(topic, payload) {
  const numericValue = Number(payload);
  if (!Number.isFinite(numericValue)) {
    return { value: payload, raw: payload, unit: '' };
  }

  const scale = getTopicScale(topic);
  if (scale.max === null || scale.min === null) {
    return { value: numericValue, raw: payload, unit: '' };
  }

  const clampedAdc = Math.min(Math.max(numericValue, 0), ADC_MAX);
  const ratio = clampedAdc / ADC_MAX;
  const effectiveRatio = scale.invert ? 1 - ratio : ratio;
  const converted = scale.min + (effectiveRatio * (scale.max - scale.min));
  return {
    value: Number(converted.toFixed(2)),
    raw: payload,
    unit: scale.unit,
  };
}

// In-memory store for latest values and history
const latest = {
  RAINSENSOR: null,
  WATERLEVELSENSORKAI: null,
  WATERLEVELSENSORKRL: null,
};
const history = [];
const lastAcceptedAtByTopic = new Map();
const INGEST_INTERVAL_MS = 60 * 1000;

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
  const now = Date.now();

  const normalizedTopic = String(topic || '').toUpperCase();
  const lastAcceptedAt = lastAcceptedAtByTopic.get(normalizedTopic) || 0;
  if (now - lastAcceptedAt < INGEST_INTERVAL_MS) {
    console.log('⏭️ Skipped MQTT message due to 1 minute throttle:', normalizedTopic, payload);
    return;
  }
  lastAcceptedAtByTopic.set(normalizedTopic, now);

  // Convert ADC raw values to physical units per topic.
  const converted = convertAdcToPhysical(topic, payload);

  const entry = {
    topic,
    location: LOCATION,
    value: converted.value,
    raw: payload,
    timestamp: ts,
    unit: converted.unit,
  };

  // update latest
  latest[topic] = entry;
  history.push(entry);

  // Send to Django backend to save to database
  sendToDjango(entry);

  // broadcast to websocket clients (use type 'mqtt_update' for frontend compatibility)
  broadcast({ type: 'mqtt_update', data: entry });
  console.log('📨 Received', topic, payload, '=>', entry.value, entry.unit || '');
});

// REST endpoints
app.get('/api/dashboard/realtime', (req, res) => {
  res.json({ latest });
});

app.get('/api/data/historical', async (req, res) => {
  try {
    const response = await axios.get(DJANGO_HISTORICAL_API, {
      params: req.query,
      timeout: 5000,
    });
    res.json(response.data);
  } catch (err) {
    console.warn('Failed to load historical data from Django', err.message);
    res.status(502).json({ error: 'failed to load historical data' });
  }
});

app.get('/api/data/topics', (req, res) => {
  res.json({ topics: TOPICS, location: LOCATION });
});

app.get('/api/regions/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit || 25), 50);

  if (!query) {
    return res.json({ results: [] });
  }

  try {
    const results = await wilayah(query, 'kelurahan');
    const mapped = (Array.isArray(results) ? results : [])
      .slice(0, limit)
      .map((item) => ({
        id: `${item.kode.id_provinsi}-${item.kode.id_kota}-${item.kode.id_kecamatan}-${item.kode.id_kelurahan}`,
        code: [
          String(item.kode.id_provinsi).padStart(2, '0'),
          String(item.kode.id_kota).padStart(2, '0'),
          String(item.kode.id_kecamatan).padStart(2, '0'),
          String(item.kode.id_kelurahan).padStart(4, '0'),
        ].join('.'),
        name: item.kelurahan,
        district: item.kecamatan,
        city: item.kota,
        province: item.provinsi,
      }));
    return res.json({ results: mapped });
  } catch (err) {
    console.warn('Region search failed', err.message);
    return res.status(500).json({ error: 'failed to search regions' });
  }
});

// WebSocket ping
wss.on('connection', (ws) => {
  console.log('WS client connected');
  ws.send(JSON.stringify({ type: 'welcome', data: { latest } }));
});

server.listen(PORT, () => {
  console.log(`Backend server listening on http://localhost:${PORT}`);
});
