# Data Page

## Deskripsi Umum
Data page digunakan untuk melihat data historis sensor, memfilter berdasarkan tanggal, lokasi, dan status, lalu meninjau grafik dan tabel data.

## Komponen
- Filter panel: Date From, Date To, Location, dan Status.
- Tombol Apply Filters dan Reset.
- Grafik Water Level Trends.
- Grafik Rain Intensity.
- Historical Data table.
- Tombol Export CSV dan Export PDF.
- Pagination Previous dan Next.

## Skenario Tampilan
- Normal / default: menampilkan filter, grafik, dan tabel data historis.
- Empty state: ketika belum ada data, tabel menunjukkan 0 entries dan tombol navigasi pagination nonaktif.
- Native alert pop-up: saat export data, browser menampilkan alert dengan teks `Exporting 0 records as CSV...` atau format lain sesuai tombol yang dipilih.

## Screenshot
- `../screenshots/data-normal.png`

## Catatan
- Pop-up export adalah native browser alert, jadi tidak tersimpan sebagai screenshot halaman biasa.
