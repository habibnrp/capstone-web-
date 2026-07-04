# Dashboard Page

## Deskripsi Umum
Dashboard adalah halaman utama untuk memantau kondisi banjir secara real-time. Halaman ini menampilkan ringkasan sensor, grafik tren, tabel monitoring, dan daftar alert terbaru.

## Komponen
- Sidebar navigasi: Dashboard, Data, Admin Panel, dan Logout.
- Top bar: judul halaman, deskripsi sistem, dan info pengguna aktif.
- Summary cards: Water Level KRL, Water Level KAI, Rain Intensity, dan Flood Status.
- Grafik Water Level Trends: tren ketinggian air dari waktu ke waktu.
- Grafik Rain Intensity: tren intensitas hujan dari waktu ke waktu.
- Real-Time Monitoring table: ringkasan lokasi, status hujan, level air, status sistem, dan waktu update.
- Recent Alerts: notifikasi kondisi terbaru.

## Skenario Tampilan
- Normal / default: dashboard tampil dengan data dan grafik standar.
- No data: kartu menampilkan badge No data bila sensor belum mengirim nilai.
- Terputus: Flood Status berubah menjadi TERPUTUS jika tidak ada pembaruan realtime.
- Error loading: banner merah tampil jika data historis gagal dimuat.

## Screenshot
- `../screenshots/dashboard-normal.png`

## Catatan
- Pada implementasi sekarang, Dashboard tidak memiliki modal pop-up bawaan.
