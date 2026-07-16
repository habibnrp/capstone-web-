import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { CloudRain, Clock3, MapPin, RefreshCcw, ShieldAlert, Droplets } from "lucide-react";

type BmkgForecastItem = {
  datetime: string;
  local_datetime?: string;
  utc_datetime?: string;
  weather_desc?: string;
  weather_desc_en?: string;
  tp?: number;
  hu?: number;
  t?: number;
  ws?: number;
  wd?: string;
  vs_text?: string;
  image?: string;
};

type BmkgForecastResponse = {
  lokasi?: {
    provinsi?: string;
    kotkab?: string;
    kecamatan?: string;
    desa?: string;
  };
  data?: Array<{
    lokasi?: {
      provinsi?: string;
      kotkab?: string;
      kecamatan?: string;
      desa?: string;
    };
    cuaca?: BmkgForecastItem[][];
  }>;
};

type SearchResult = {
  id: string;
  name: string;
  code: string;
  district: string;
  city: string;
  province: string;
};

const DEFAULT_AREA: SearchResult = {
  id: "kemayoran",
  name: "Kemayoran",
  code: "31.71.03.1001",
  district: "Kemayoran",
  city: "Kota Adm. Jakarta Pusat",
  province: "DKI Jakarta",
};

function rainLabel(item?: BmkgForecastItem) {
  if (!item) return "-";
  const desc = item.weather_desc || "";
  const rainMm = Number(item.tp || 0);
  if (rainMm > 0 || /hujan/i.test(desc)) return "Rain";
  if (/berawan/i.test(desc)) return "Cloudy";
  return desc || "-";
}

function rainBadgeClass(item?: BmkgForecastItem) {
  if (!item) return "bg-gray-100 text-gray-700 border-gray-200";
  const desc = item.weather_desc || "";
  const rainMm = Number(item.tp || 0);
  if (rainMm >= 5 || /hujan/i.test(desc)) return "bg-red-100 text-red-700 border-red-200";
  if (rainMm > 0 || /berawan/i.test(desc)) return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-green-100 text-green-700 border-green-200";
}

function formatHour(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

async function fetchForecast(code: string) {
  const response = await fetch(`https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${encodeURIComponent(code)}`);
  if (!response.ok) {
    throw new Error(`BMKG request failed (${response.status})`);
  }
  return response.json() as Promise<BmkgForecastResponse>;
}

export default function PredictionPage() {
  const [selectedArea, setSelectedArea] = useState(DEFAULT_AREA);
  const [forecast, setForecast] = useState<BmkgForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("Kemayoran");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([DEFAULT_AREA]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchForecast(selectedArea.code);
        if (cancelled) return;
        setForecast(data);
        setLastUpdated(new Date().toLocaleString("id-ID"));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load BMKG data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const timer = window.setInterval(load, 30 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedArea.code]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const query = searchQuery.trim();
      if (!query) {
        if (!cancelled) {
          setSearchResults([DEFAULT_AREA]);
          setSearchLoading(false);
          setSearchError(null);
        }
        return;
      }

      try {
        setSearchLoading(true);
        setSearchError(null);
        const response = await fetch(`/api/regions/search?q=${encodeURIComponent(query)}&limit=25`);
        if (!response.ok) {
          throw new Error(`Region search failed (${response.status})`);
        }
        const body = await response.json();
        if (cancelled) return;
        setSearchResults(Array.isArray(body?.results) ? body.results : []);
      } catch (err) {
        if (cancelled) return;
        setSearchResults([]);
        setSearchError(err instanceof Error ? err.message : "Gagal mencari wilayah BMKG");
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  const hourlyForecast = useMemo(() => {
    const block = forecast?.data?.[0]?.cuaca?.[0] ?? [];
    return block.slice(0, 8);
  }, [forecast]);

  const rainSummary = useMemo(() => {
    const values = hourlyForecast.map((item) => Number(item.tp || 0));
    const rainHours = values.filter((value) => value > 0).length;
    const maxRain = values.length > 0 ? Math.max(...values) : 0;
    const nextRain = hourlyForecast.find((item) => Number(item.tp || 0) > 0 || /hujan/i.test(item.weather_desc || ""));
    return { rainHours, maxRain, nextRain };
  }, [hourlyForecast]);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <CloudRain className="h-4 w-4" />
              BMKG Realtime Forecast
            </div>
            <h3 className="mt-2 text-2xl font-semibold text-gray-900">Prediction Wilayah BMKG</h3>
            <p className="mt-2 text-sm text-gray-600">
              Menampilkan prakiraan hujan terbaru BMKG untuk wilayah yang dapat dicari dari seluruh Indonesia.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Sumber data: BMKG Data Terbuka. Aplikasi wajib mencantumkan BMKG sebagai sumber data.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Badge className="bg-blue-100 text-blue-700 border-blue-200 justify-center px-3 py-2" variant="outline">
              <MapPin className="mr-2 h-4 w-4" />
              {selectedArea.district}
            </Badge>
            <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 justify-center px-3 py-2" variant="outline">
              <Droplets className="mr-2 h-4 w-4" />
              {rainSummary.rainHours} jam hujan
            </Badge>
            <Badge className="bg-red-100 text-red-700 border-red-200 justify-center px-3 py-2" variant="outline">
              <ShieldAlert className="mr-2 h-4 w-4" />
              Max hujan {rainSummary.maxRain} mm
            </Badge>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700" htmlFor="search-area">
                Cari wilayah BMKG
              </label>
              <Input
                id="search-area"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Contoh: Gambir, Kemayoran, Jakarta, Surabaya, Bandung"
              />
            </div>
            <Button type="button" variant="outline" onClick={() => setSearchQuery("")}>Bersihkan</Button>
          </div>
          <p className="text-xs text-gray-500">
            Cari nama kelurahan/desa untuk melihat prakiraan BMKG. Hasil pencarian bisa dipakai langsung sebagai kode adm4.
          </p>
          {searchError && (
            <p className="text-sm text-red-600">{searchError}</p>
          )}
          <div className="max-h-72 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
            {searchLoading && (
              <div className="px-3 py-2 text-sm text-gray-500">Mencari wilayah BMKG...</div>
            )}
            {!searchLoading && searchResults.length === 0 && (
              <div className="px-3 py-2 text-sm text-gray-500">Tidak ada wilayah yang cocok.</div>
            )}
            {!searchLoading && searchResults.map((area) => {
              const isSelected = selectedArea.code === area.code;
              return (
                <button
                  key={area.code}
                  type="button"
                  onClick={() => setSelectedArea(area)}
                  className={`mb-2 flex w-full flex-col rounded-md border px-3 py-2 text-left transition ${isSelected ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}
                >
                  <span className="text-sm font-semibold text-gray-900">{area.name}</span>
                  <span className="text-xs text-gray-500">{area.district}, {area.city}, {area.province}</span>
                  <span className="text-xs text-gray-400">adm4 {area.code}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border-0 shadow-md lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Ringkasan Area</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-600">
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Wilayah</p>
              <p className="mt-1 font-medium text-gray-900">{forecast?.lokasi?.desa || selectedArea.name}</p>
              <p className="text-sm text-gray-500">{forecast?.lokasi?.kotkab || selectedArea.city}, {forecast?.lokasi?.provinsi || selectedArea.province}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Update BMKG</p>
              <p className="mt-1 font-medium text-gray-900">{lastUpdated ? formatHour(lastUpdated) : "-"}</p>
              <p className="text-sm text-gray-500">Prakiraan diperbarui berkala dari BMKG</p>
            </div>
            <Button variant="outline" className="w-full gap-2" onClick={() => window.location.reload()} disabled={loading}>
              <RefreshCcw className="h-4 w-4" />
              Refresh data
            </Button>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-blue-600" />
              Prediksi Hujan 24 Jam Terdekat
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Cuaca</TableHead>
                    <TableHead>Hujan</TableHead>
                    <TableHead>Suhu</TableHead>
                    <TableHead>Kelembapan</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-gray-500">
                        Memuat data BMKG...
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && hourlyForecast.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-gray-500">
                        Data prakiraan belum tersedia.
                      </TableCell>
                    </TableRow>
                  )}
                  {hourlyForecast.map((item) => (
                    <TableRow key={item.datetime}>
                      <TableCell className="font-medium">{formatHour(item.local_datetime || item.datetime)}</TableCell>
                      <TableCell>{item.weather_desc || "-"}</TableCell>
                      <TableCell>{Number(item.tp || 0)} mm</TableCell>
                      <TableCell>{item.t ?? "-"} °C</TableCell>
                      <TableCell>{item.hu ?? "-"}%</TableCell>
                      <TableCell>
                        <Badge className={rainBadgeClass(item)} variant="outline">
                          {rainLabel(item)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Interpretasi Cepat</h3>
            <p className="text-sm text-gray-500">Ringkasan ini membantu melihat potensi hujan di Jakarta secara cepat.</p>
          </div>
          <Badge className="bg-blue-100 text-blue-700 border-blue-200" variant="outline">
            {rainSummary.nextRain ? `Hujan berikutnya: ${formatHour(rainSummary.nextRain.local_datetime || rainSummary.nextRain.datetime)}` : "Tidak ada hujan terdekat"}
          </Badge>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Area aktif</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">{selectedArea.name}</p>
            <p className="text-sm text-gray-500">{selectedArea.district}, {selectedArea.city}</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Potensi hujan</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">{rainSummary.rainHours} jam</p>
            <p className="text-sm text-gray-500">Berdasarkan 8 jam prakiraan terdekat</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Maksimum hujan</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">{rainSummary.maxRain} mm</p>
            <p className="text-sm text-gray-500">Semakin besar nilainya, semakin tinggi potensi hujan</p>
          </div>
        </div>
      </section>
    </div>
  );
}