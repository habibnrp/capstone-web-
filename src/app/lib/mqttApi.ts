export type MqttTopic = "RAINSENSOR" | "WATERLEVELSENSORKAI" | "WATERLEVELSENSORKRL";

export type MqttEntry = {
  topic: MqttTopic | string;
  location: string;
  value: number | string;
  raw: string;
  timestamp: string;
};

export type RealtimeResponse = {
  latest: Record<string, MqttEntry | null>;
};

export type HistoricalResponse = MqttEntry[];

export type TopicsResponse = {
  topics: string[];
  location?: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000";
const API_ROOT = API_BASE_URL.replace(/\/$/, "").replace(/\/api$/, "");
const WS_ROOT = WS_URL.replace(/\/$/, "").replace(/\/ws$/, "");

export async function fetchRealtime(): Promise<RealtimeResponse> {
  const response = await fetch(`${API_ROOT}/api/monitoring/realtime/`);
  if (!response.ok) {
    throw new Error(`Failed to load realtime data (${response.status})`);
  }
  return response.json();
}

export async function fetchHistorical(params?: {
  dateFrom?: string;
  dateTo?: string;
  location?: string;
  status?: string;
}): Promise<HistoricalResponse> {
  const queryParams = new URLSearchParams();
  if (params?.dateFrom) queryParams.append('dateFrom', params.dateFrom);
  if (params?.dateTo) queryParams.append('dateTo', params.dateTo);
  if (params?.location) queryParams.append('location', params.location);
  if (params?.status) queryParams.append('status', params.status);

  const url = `${API_ROOT}/api/monitoring/historical/?${queryParams}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load historical data (${response.status})`);
  }
  const body = await response.json();
  // legacy: backend returns { value: [...] } sometimes
  return body?.value ?? body;
}

export async function fetchTopics(): Promise<TopicsResponse> {
  const response = await fetch(`${API_ROOT}/api/monitoring/topics/`);
  if (!response.ok) {
    throw new Error(`Failed to load sensor topics (${response.status})`);
  }
  return response.json();
}

export function subscribeToRealtime(callback: (data: any) => void): WebSocket {
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  const reconnectInterval = 3000; // 3 seconds
  const fallbackUrl = `ws://localhost:3000`;
  const primaryUrl = `${WS_ROOT}/ws/monitoring/`;
  let triedFallback = false;
  let ws: WebSocket;

  const attachHandlers = (socket: WebSocket, useFallback: boolean) => {
    socket.onopen = () => {
      console.log(useFallback ? '✓ Fallback WebSocket connected' : '✓ WebSocket connected to monitoring stream');
      reconnectAttempts = 0;
      socket.send(JSON.stringify({ type: 'subscribe' }));
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'subscription_confirmed') {
          console.log('✓ Subscription confirmed, ready for real-time updates');
          return;
        }

        if ((message.type === 'mqtt_update' || message.type === 'mqtt_message') && message.data) {
          console.log('📨 MQTT Update received:', message.data.topic, '=', message.data.value);
          callback(message.data);
          return;
        }

        if (message.type === 'sensor_data' && message.data) {
          console.log('📊 Sensor data received:', message.data.topic);
          callback(message.data);
          return;
        }

        if (message.topic) {
          console.log('📨 Direct MQTT data received:', message.topic);
          callback(message);
          return;
        }
      } catch (e) {
        console.error('✗ Failed to parse WebSocket message:', e);
      }
    };

    socket.onerror = (error) => {
      console.error(useFallback ? '✗ Fallback WebSocket error:' : '✗ WebSocket error:', error);
      if (!useFallback && !triedFallback) {
        triedFallback = true;
        console.log('Trying fallback WebSocket at', fallbackUrl);
        try {
          ws.close();
        } catch {
          // ignore close errors on failed sockets
        }
        ws = new WebSocket(fallbackUrl);
        attachHandlers(ws, true);
      }
    };

    socket.onclose = () => {
      console.log(useFallback ? '⊘ Fallback WebSocket disconnected, attempting to reconnect...' : '⊘ WebSocket disconnected, attempting to reconnect...');
      attemptReconnect();
    };
  };
  
  const attemptReconnect = () => {
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      console.log(`⟳ WebSocket reconnecting... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
      setTimeout(() => {
        subscribeToRealtime(callback);
      }, reconnectInterval);
    } else {
      console.error('✗ WebSocket: Max reconnection attempts reached');
    }
  };
  
  ws = new WebSocket(primaryUrl);
  attachHandlers(ws, false);

  return ws;
}

export function toNumber(value: number | string | null | undefined, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatRelativeTime(timestamp?: string | null) {
  if (!timestamp) return "-";
  const diffMs = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins === 1) return "1 min ago";
  return `${diffMins} min ago`;
}

export function buildChartSeries(
  entries: MqttEntry[],
  maxPoints = 8,
  granularity: "hour" | "day" = "hour"
) {
  const byBucket = new Map<
    string,
    { time: string; KRL?: number; KAI?: number; rain?: number }
  >();

  entries.forEach((entry) => {
    const date = new Date(entry.timestamp);
    const bucket = Number.isNaN(date.getTime())
      ? entry.timestamp
      : granularity === "day"
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:00`;
    const label = Number.isNaN(date.getTime())
      ? entry.timestamp
      : granularity === "day"
        ? `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`
        : `${String(date.getHours()).padStart(2, "0")}:00`;

    const current = byBucket.get(bucket) ?? { time: label };
    const numericValue = toNumber(entry.value, 0);

    if (entry.topic === "WATERLEVELSENSORKRL") current.KRL = numericValue;
    if (entry.topic === "WATERLEVELSENSORKAI") current.KAI = numericValue;
    if (entry.topic === "RAINSENSOR") current.rain = numericValue;

    byBucket.set(bucket, current);
  });

  return [...byBucket.values()].slice(-maxPoints);
}
