# MQTT Data Ingestion Flow

## Alur Data (MQTTX → Database)

```
MQTTX (MQTT Client)
   ↓
MQTT Broker (broker.emqx.io)
   ↓
Node.js Server (port 3000) - Subscribe to topics
   ↓
   ├─→ Save to history.json (local file)
   ├─→ Broadcast via WebSocket
   └─→ Send POST to Django API → /api/monitoring/ingest/
      ↓
      Django Backend (port 8000)
      ↓
      PostgreSQL Database (flood_monitoring)
      ↓
      Data tersimpan di table: monitoring_sensorreading
```

## Cara Testing dengan MQTTX

### 1. Buka MQTTX Client
- Download dari: https://mqttx.app/
- Atau gunakan online: https://www.emqx.com/en/mqtt/mqtt-client-tools

### 2. Setup Connection
```
Name: flood-monitoring
Broker: broker.emqx.io
Port: 1883
Protocol: mqtt://
Client ID: mqttx_test_[random]
```

### 3. Publish Data ke 3 Topics

**Topic 1: RAINSENSOR** (Rain intensity in mm/h, range 0-15)
```
Topic: RAINSENSOR
Payload: 5.25
Repeat: Manual or Set Interval
```

**Topic 2: WATERLEVELSENSORKAI** (Water level in cm, range 40-85)
```
Topic: WATERLEVELSENSORKAI
Payload: 62.5
```

**Topic 3: WATERLEVELSENSORKRL** (Water level in cm, range 35-80)
```
Topic: WATERLEVELSENSORKRL
Payload: 58.3
```

## Verification Steps

### 1. Check Node.js Server Logs
```
Watch terminal showing "📨 Received RAINSENSOR 5.25" 
And "✓ Sent to Django: RAINSENSOR 5.25"
```

### 2. Check Django API
```bash
# Get latest realtime data
curl http://localhost:8000/api/monitoring/realtime/

# Get historical data
curl "http://localhost:8000/api/monitoring/historical/?limit=10"
```

### 3. Check Frontend (http://localhost:5173)
- Go to Dashboard → See latest values in cards
- Go to Data → Set date filter → See new readings in table

### 4. Check Database (pgAdmin 4)
```sql
SELECT * FROM monitoring_sensorreading 
ORDER BY timestamp DESC 
LIMIT 10;
```

## Troubleshooting

### Data tidak masuk ke database?
1. **Cek Node.js server running:**
   ```
   ps aux | grep "node index.js"
   ```
   
2. **Cek Django API accessible:**
   ```
   curl http://localhost:8000/api/monitoring/ingest/ -X POST -H "Content-Type: application/json" -d '{"topic":"TEST","value":"99","location":"Test","raw":"99","timestamp":"2026-05-20T10:00:00Z"}'
   ```

3. **Cek MQTT broker connection:**
   - Look at Node.js logs for "Connected to MQTT broker"
   
4. **Cek subscriber settings:**
   - Make sure MQTTX uses same MQTT broker (broker.emqx.io:1883)
   - Cek topics yang di-publish sesuai dengan TOPICS config

## Environment Variables

Jika ingin override defaults, set di Node.js:
```
DJANGO_API_URL=http://localhost:8000/api/monitoring/ingest/
PORT=3000
```

## Files Modified
- `server/index.js` - Added sendToDjango() function
- `server/package.json` - Added axios dependency
- `django-backend/apps/monitoring/views.py` - Added ingest() endpoint
- `django-backend/apps/monitoring/urls.py` - Added ingest route
