import { useEffect, useMemo, useState } from "react";
import { Badge } from "../components/ui/badge";
import { AlertTriangle, CheckCircle, Clock3 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import {
  fetchRealtime,
  fetchTopics,
  formatRelativeTime,
  subscribeToRealtime,
  toNumber,
  type MqttEntry,
} from "../lib/mqttApi";

const SENSOR_LABELS: Record<string, string> = {
  RAINSENSOR: "Rain Sensor",
  WATERLEVELSENSORKAI: "Water Level Sensor KAI",
  WATERLEVELSENSORKRL: "Water Level Sensor KRL",
};

const SENSOR_UNITS: Record<string, string> = {
  RAINSENSOR: "mm/h",
  WATERLEVELSENSORKAI: "cm",
  WATERLEVELSENSORKRL: "cm",
};

const DEFAULT_LOCATION = "Manggarai Station";

function formatSensorLabel(topic: string) {
  return SENSOR_LABELS[topic] ?? topic.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

export default function Dashboard() {
  const [latest, setLatest] = useState<Record<string, MqttEntry | null>>({
    RAINSENSOR: null,
    WATERLEVELSENSORKAI: null,
    WATERLEVELSENSORKRL: null,
  });
  const [registeredTopics, setRegisteredTopics] = useState<string[]>([]);
  const [registeredLocation, setRegisteredLocation] = useState(DEFAULT_LOCATION);
  const [lastRealtimeAt, setLastRealtimeAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;

    const loadData = async () => {
      try {
        setError(null);
        const [realtime, topics] = await Promise.all([fetchRealtime(), fetchTopics()]);
        if (cancelled) return;
        setLatest(realtime.latest ?? {
          RAINSENSOR: null,
          WATERLEVELSENSORKAI: null,
          WATERLEVELSENSORKRL: null,
        });
        setRegisteredTopics(topics.topics ?? []);
        setRegisteredLocation(topics.location || DEFAULT_LOCATION);
        const timestamps = Object.values(realtime.latest ?? {})
          .map((entry) => (entry?.timestamp ? new Date(entry.timestamp).getTime() : 0))
          .filter((value) => Number.isFinite(value) && value > 0);
        setLastRealtimeAt(timestamps.length > 0 ? Math.max(...timestamps) : null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load dashboard data");
      }
    };

    loadData();

    // Subscribe to real-time MQTT updates via WebSocket
    ws = subscribeToRealtime((message) => {
      if (cancelled) return;
      
      // Handle different message formats from backend
      const data = message.data ?? message;
      if (data && data.topic) {
        // Update latest sensor reading
        const nextTimestamp = data.timestamp ? new Date(data.timestamp).getTime() : Date.now();
        setLastRealtimeAt(Number.isFinite(nextTimestamp) ? nextTimestamp : Date.now());
        setLatest((current) => ({
          ...current,
          [data.topic]: data,
        }));
      }
    });

    return () => {
      cancelled = true;
      if (ws) ws.close();
    };
  }, []);

  const staleThresholdMs = 2 * 60 * 1000;
  const isStale = !lastRealtimeAt || Date.now() - lastRealtimeAt > staleThresholdMs;

  const activeSensors = useMemo(() => {
    const topics = registeredTopics.length > 0 ? registeredTopics : Object.keys(latest);
    return topics.map((topic) => {
      const entry = latest[topic];
      if (!entry) return null;
      const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : null;
      const active = !isStale && timestamp !== null;
      return {
        topic,
        label: formatSensorLabel(topic),
        location: entry.location || registeredLocation,
        value: toNumber(entry.value, 0),
        unit: SENSOR_UNITS[topic] ?? "",
        lastUpdate: formatRelativeTime(entry.timestamp),
        status: active ? "Aktif" : "Tidak Aktif",
        raw: entry.raw,
      };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item && item.status === "Aktif"));
  }, [latest, isStale, registeredLocation]);

  const registeredSensors = useMemo(() => {
    const topics = registeredTopics.length > 0 ? registeredTopics : Object.keys(latest);
    return topics.map((topic) => {
      const entry = latest[topic];
      const hasValue = !!entry;
      return {
        topic,
        label: formatSensorLabel(topic),
        location: entry?.location || registeredLocation,
        status: hasValue && !isStale ? "Aktif" : "Terdaftar",
        condition: hasValue && !isStale ? "Mengirim data" : "Menunggu data",
        lastUpdate: entry ? formatRelativeTime(entry.timestamp) : "-",
      };
    });
  }, [latest, registeredTopics, registeredLocation, isStale]);

  const connectionState = isStale ? "Terputus" : "Aktif";
  const connectionBadgeClass = isStale
    ? "bg-gray-100 text-gray-700 border-gray-200"
    : "bg-green-100 text-green-700 border-green-200";

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Aktif":
        return "bg-green-100 text-green-700 border-green-200";
      case "Terdaftar":
        return "bg-blue-100 text-blue-700 border-blue-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  const getActivityColor = (status: string) => {
    switch (status) {
      case "Aktif":
        return "bg-green-100 text-green-700 border-green-200";
      case "Tidak Aktif":
        return "bg-yellow-100 text-yellow-700 border-yellow-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  const latestUpdateLabel = lastRealtimeAt ? formatRelativeTime(new Date(lastRealtimeAt).toISOString()) : "-";

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Dashboard Sensor</h3>
            <p className="text-sm text-gray-500">
              Menampilkan sensor yang sedang aktif dan daftar sensor yang terdaftar tanpa chart.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock3 className="h-4 w-4 text-blue-600" />
            Pembaruan terakhir: {latestUpdateLabel}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Badge className={connectionBadgeClass} variant="outline">
            Status koneksi: {connectionState}
          </Badge>
          <Badge className="bg-blue-100 text-blue-700 border-blue-200" variant="outline">
            Lokasi: {registeredLocation}
          </Badge>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Sensor Aktif</h3>
            <p className="text-sm text-gray-500">Sensor yang sedang mengirim data realtime ke sistem.</p>
          </div>
          <Badge className="bg-green-100 text-green-700 border-green-200" variant="outline">
            {activeSensors.length} aktif
          </Badge>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sensor</TableHead>
                <TableHead>Lokasi</TableHead>
                <TableHead>Nilai Terakhir</TableHead>
                <TableHead>Update Terakhir</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeSensors.length > 0 ? (
                activeSensors.map((sensor) => (
                  <TableRow key={sensor.topic}>
                    <TableCell className="font-medium text-gray-900">{sensor.label}</TableCell>
                    <TableCell>{sensor.location}</TableCell>
                    <TableCell>
                      {sensor.value} {sensor.unit}
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">{sensor.lastUpdate}</TableCell>
                    <TableCell>
                      <Badge className={getActivityColor(sensor.status)} variant="outline">
                        <span className="inline-flex items-center gap-2">
                          <CheckCircle className="h-3.5 w-3.5" />
                          {sensor.status}
                        </span>
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-gray-500">
                    Belum ada sensor aktif.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Sensor Terdaftar</h3>
            <p className="text-sm text-gray-500">Daftar sensor yang sudah didaftarkan pada sistem.</p>
          </div>
          <Badge className="bg-blue-100 text-blue-700 border-blue-200" variant="outline">
            {registeredSensors.length} terdaftar
          </Badge>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sensor</TableHead>
                <TableHead>Lokasi</TableHead>
                <TableHead>Kondisi</TableHead>
                <TableHead>Status Pendaftaran</TableHead>
                <TableHead>Update</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registeredSensors.map((sensor) => (
                <TableRow key={sensor.topic}>
                  <TableCell className="font-medium text-gray-900">{sensor.label}</TableCell>
                  <TableCell>{sensor.location}</TableCell>
                  <TableCell>{sensor.condition}</TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(sensor.status)} variant="outline">
                      {sensor.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-gray-500">{sensor.lastUpdate}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {isStale && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          <span className="inline-flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            Dashboard tidak menerima data realtime terbaru, sehingga status sensor mungkin belum diperbarui.
          </span>
        </div>
      )}
    </div>
  );
}
