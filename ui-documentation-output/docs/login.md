# Login Page

## Deskripsi Umum
Halaman Login adalah entry point untuk pengguna masuk ke aplikasi. Menyediakan dua mode: `Sign In` dan `Sign Up` (multi-step dengan OTP).

## Komponen
- Logo dan judul: ikon dan judul aplikasi di bagian atas card.
- Mode toggle: tombol `Sign In` / `Sign Up` untuk berganti mode.
- Form input:
  - `Email` (dengan ikon)
  - `Password` (dengan ikon)
  - `Confirm Password` (hanya di mode signup, details step)
  - `OTP` (hanya di mode signup, otp step)
- Pesan status: `errorMsg` dan `successMsg` ditampilkan sebagai banner berwarna di atas form.
- Tombol utama: `Sign In` atau `Send OTP` / `Verify & Create Account` bergantung pada mode.
- Link: `Forgot password?` (placeholder, mengarah ke `#`).
- Footer: copyright.

## Alur dan Skenario
- Sign In:
  - Validasi client: email dan password wajib; bila kosong, menampilkan banner error `Email and password are required`.
  - Submit: mengirim POST ke `/api/monitoring/login/`; jika sukses, menyimpan `token` dan `user` ke `localStorage` lalu redirect ke `/dashboard`.
  - Gagal login: menampilkan banner merah dengan pesan dari backend atau `Login failed`.

- Sign Up:
  - Details step: validasi email harus berakhiran `@kai.id`, password minimal 6 karakter, dan password harus match.
  - Jika valid, request signup endpoint yang mengirim OTP ke email; tampilkan `OTP sent to your email...`.
  - OTP step: verifikasi kode lewat `/api/monitoring/signup/verify-otp/`; jika sukses, tampilkan pesan sukses dan kembali ke mode Sign In.

## Validasi / Error
- Semua validasi ditampilkan inline sebagai banner (bukan native alert).
- Pesan yang mungkin muncul:
  - `Email and password are required`
  - `Email is required`
  - `Email must end with @kai.id`
  - `Password must be at least 6 characters`
  - `Passwords do not match`
  - `OTP is required`
  - Backend errors returned in response bodies

## Screenshot
- `../screenshots/login.png`

## Catatan
- OTP flow dan pendaftaran memerlukan backend yang berjalan dan alamat email yang valid untuk menerima kode.
- Tombol `Forgot password?` belum diimplementasikan (hanya placeholder).
