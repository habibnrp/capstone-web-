import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Download, Filter, Calendar } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from "recharts";
import { buildChartSeries, fetchHistorical, formatRelativeTime, subscribeToRealtime, toNumber, type MqttEntry } from "../lib/mqttApi";

const LOCATION = "Manggarai";

function toLocalDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type DerivedStatus = "SAFE" | "WARNING" | "CRITICAL";

function deriveStatus(entry: MqttEntry): DerivedStatus {
  const value = toNumber(entry.value, 0);
  if (entry.topic === "RAINSENSOR") {
    if (value >= 12) return "CRITICAL";
    if (value >= 6) return "WARNING";
    return "SAFE";
  }

  if (value >= 70) return "CRITICAL";
  if (value >= 60) return "WARNING";
  return "SAFE";
}

export default function DataPage() {
  const today = toLocalDateString(new Date());
  const weekAgo = toLocalDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [dateFrom, setDateFrom] = useState(weekAgo);
  const [dateTo, setDateTo] = useState(today);
  const [location, setLocation] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [records, setRecords] = useState<MqttEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;

    const load = async () => {
      try {
        setError(null);
        const data = await fetchHistorical();
        if (!cancelled) setRecords(data ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load historical data");
      }
    };

    load();

    // Subscribe to real-time MQTT updates via WebSocket
    ws = subscribeToRealtime((message) => {
      if (cancelled) return;
      
      // Handle different message formats from backend
      const data = message.data ?? message;
      if (data && data.topic) {
        // Add new sensor reading to records (prepend for most recent first)
        setRecords((current) => [data, ...current]);
      }
    });

    return () => {
      cancelled = true;
      if (ws) ws.close();
    };
  }, []);

  const filteredRecords = useMemo(() => {
    return records.filter((entry) => {
      const ts = entry.timestamp.slice(0, 10);
      const entryStatus = deriveStatus(entry).toLowerCase();
      const matchesDate = (!dateFrom || ts >= dateFrom) && (!dateTo || ts <= dateTo);
      const matchesLocation = location === "all" || entry.location === LOCATION;
      const matchesStatus = statusFilter === "all" || entryStatus === statusFilter;
      return matchesDate && matchesLocation && matchesStatus;
    });
  }, [records, dateFrom, dateTo, location, statusFilter]);

  const trendData = useMemo(() => {
    const series = buildChartSeries(records);
    return series.map((item) => ({ time: item.time, KRL: item.KRL ?? null, KAI: item.KAI ?? null }));
  }, [records]);

  const rainData = useMemo(() => {
    const series = buildChartSeries(records);
    return series.map((item) => ({ time: item.time, rain: item.rain ?? 0 }));
  }, [records]);

  const historicalData = useMemo(() => {
    return [...filteredRecords].slice(0, 10).map((entry) => ({
      timestamp: entry.timestamp_display || entry.timestamp,
      topic: entry.topic,
      location: entry.location,
      value: entry.value,
      status: deriveStatus(entry),
    }));
  }, [filteredRecords]);

  // Pagination state
  const [page, setPage] = useState(0);
  const pageSize = 10;

  // Reset to first page when filters change
  useEffect(() => {
    setPage(0);
  }, [filteredRecords.length, dateFrom, dateTo, location, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));

  const pagedHistoricalData = useMemo(() => {
    // ensure newest first by timestamp (descending)
    const sorted = [...filteredRecords].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const start = page * pageSize;
    const pageSlice = sorted.slice(start, start + pageSize);
    return pageSlice.map((entry) => ({
      timestamp: entry.timestamp_display || entry.timestamp,
      topic: entry.topic,
      location: entry.location,
      value: entry.value,
      status: deriveStatus(entry),
    }));
  }, [filteredRecords, page]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "SAFE":
        return "bg-green-100 text-green-700 border-green-200";
      case "WARNING":
        return "bg-yellow-100 text-yellow-700 border-yellow-200";
      case "CRITICAL":
        return "bg-red-100 text-red-700 border-red-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  const handleExport = (format: string) => {
    alert(`Exporting ${filteredRecords.length} records as ${format.toUpperCase()}...`);
  };

  const resetFilters = () => {
    setDateFrom("2026-03-31");
    setDateTo("2026-03-31");
    setLocation("all");
    setStatusFilter("all");
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Filter Section */}
      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="w-5 h-5 text-blue-600" />
            Data Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Date From */}
            <div className="space-y-2">
              <Label htmlFor="dateFrom">Date From</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="dateFrom"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Date To */}
            <div className="space-y-2">
              <Label htmlFor="dateTo">Date To</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="dateTo"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Location Filter */}
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger id="location">
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Locations</SelectItem>
                    <SelectItem value={LOCATION}>{LOCATION} Station</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Status Filter */}
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="safe">Safe</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 mt-4">
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={async () => {
              try {
                setError(null);
                const params: any = {};
                if (dateFrom) params.dateFrom = dateFrom;
                if (dateTo) params.dateTo = dateTo;
                if (location && location !== 'all') params.location = LOCATION;
                const data = await fetchHistorical(params);
                setRecords(data ?? []);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load historical data');
              }
            }}>
              Apply Filters
            </Button>
            <Button variant="outline" onClick={resetFilters}>
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Water Level Trends */}
        <Card className="border-0 shadow-md">
          <CardHeader>
            <CardTitle className="text-lg">Water Level Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="time" stroke="#6b7280" />
                <YAxis stroke="#6b7280" label={{ value: 'cm', angle: -90, position: 'insideLeft' }} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px'
                  }} 
                />
                <Legend />
                <Line type="monotone" dataKey="KRL" stroke="#3b82f6" strokeWidth={2} />
                <Line type="monotone" dataKey="KAI" stroke="#8b5cf6" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Rain Intensity Chart */}
        <Card className="border-0 shadow-md">
          <CardHeader>
            <CardTitle className="text-lg">Rain Intensity</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={rainData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="time" stroke="#6b7280" />
                <YAxis stroke="#6b7280" label={{ value: 'mm/h', angle: -90, position: 'insideLeft' }} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px'
                  }} 
                />
                <Legend />
                <Bar dataKey="rain" fill="#3b82f6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Data Table */}
      <Card className="border-0 shadow-md">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Historical Data</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport("csv")}
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport("pdf")}
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              Export PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                    <TableHead>Topic</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedHistoricalData.map((item, index) => (
                  <TableRow key={index}>
                      <TableCell className="font-medium">{item.timestamp}</TableCell>
                      <TableCell>{item.topic}</TableCell>
                      <TableCell>
                        {typeof item.value === "number" ? item.value : String(item.value)}
                      </TableCell>
                      <TableCell>{item.location}</TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(item.status)} variant="outline">
                          {item.status}
                        </Badge>
                      </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-gray-500">
              {filteredRecords.length === 0
                ? "Showing 0 of 0 entries"
                : `Showing ${page * pageSize + 1}-${Math.min((page + 1) * pageSize, filteredRecords.length)} of ${filteredRecords.length} entries`}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
