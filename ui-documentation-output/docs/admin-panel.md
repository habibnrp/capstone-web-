# Admin Panel

## Deskripsi Umum
Admin Panel digunakan untuk memantau status server, koneksi MQTT, status jaringan, dan mengelola data administrasi seperti user, settings, sensors, serta logs.

## Komponen
- System status cards: Server Status, MQTT Connection, dan Network Status.
- Tabs: User Management, System Settings, Sensors, dan Logs.
- User list table: daftar user dengan aksi Edit, Delete, dan Make Admin.
- Add User modal: form input nama, email, dan password.
- Tombol aksi lain yang terlihat di implementasi seperti calibrate sensor, save settings, dan send test Telegram.

## Skenario Tampilan
- Normal / default: menampilkan status sistem dan tabel user.
- Add User modal: muncul saat tombol Add User diklik.
- Validasi input: browser alert menampilkan `Name and email required` jika form dikirim kosong.
- Error states lain: beberapa aksi memiliki alert gagal seperti save, configure, calibrate, atau send test Telegram bila request backend gagal.

## Screenshot
- `../screenshots/admin-normal.png`
- `../screenshots/admin-add-user-modal.png`

## Catatan
- Alert validasi pada halaman ini adalah native browser alert, bukan modal kustom.
