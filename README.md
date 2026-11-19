# Todly

Aplikasi desktop Windows untuk mengelola task dan agenda harian, lengkap dengan widget desktop yang selalu bisa diakses. Todly berjalan sepenuhnya offline: semua data disimpan di komputer Anda, tanpa akun dan tanpa internet.

## Fitur

### Manajemen task
- Papan Kanban dengan tiga kolom: To Do, In Progress, dan Completed.
- Drag and drop gaya Jira. Urutan kartu di dalam kolom tersimpan permanen.
- Setiap task memiliki prioritas, rencana mulai, deadline, deskripsi, dan catatan.
- Waktu mulai dan waktu selesai tercatat otomatis, dan task yang dibuka kembali tetap menyimpan riwayat penyelesaiannya.
- Task yang melewati deadline ditandai Overdue, dan semua task bisa dicari.

### Agenda dan kalender
- Catat rapat, janji temu, dan kegiatan pribadi lengkap dengan lokasi dan kategori.
- Lihat jadwal dalam tampilan bulan, minggu, atau hari.
- Hubungkan satu agenda dengan satu atau beberapa task. Deadline task ikut tampil di kalender.

### Pengingat
- Notifikasi Windows untuk agenda dan deadline task.
- Tetap aktif saat jendela utama disembunyikan ke system tray, tanpa notifikasi ganda.

### Widget desktop
- Jendela mengambang yang menampilkan task hari ini, prioritas tinggi, agenda terdekat, dan progres.
- Bisa digeser, diubah ukurannya, diatur transparansinya, dan dipasang agar selalu di atas jendela lain.
- Task dapat dicentang selesai langsung dari widget.
- Selalu sinkron dengan aplikasi utama.

### Riwayat
- Telusuri task yang dikerjakan pada bulan atau minggu pilihan Anda.
- Lihat ringkasan jumlah task, persentase tepat waktu, dan grafik penyelesaian per hari.
- Buka rincian tiap task, mulai dari tanggal, lama pengerjaan, catatan, hingga riwayat perubahan statusnya.

### Data dan backup
- Backup otomatis harian dan backup manual ke folder pilihan Anda.
- Pemulihan dari file backup, dengan validasi file dan salinan pengaman sebelum data diganti.

## Tech stack

| Bagian | Teknologi |
|---|---|
| Kerangka desktop | Tauri 2 |
| Backend | Rust |
| Database | SQLite (`rusqlite`) |
| Frontend | React dan TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS |
| State management | Zustand |
| Drag and drop | dnd-kit |
| Ikon | Lucide |

## Menjalankan proyek

**Prasyarat:** Node.js (LTS), Rust (toolchain `stable-msvc`), dan Visual Studio Build Tools dengan beban kerja *Desktop development with C++*.

```bash
npm install
npm run tauri dev
```

Untuk menjalankan tes backend:

```bash
cd src-tauri
cargo test
```

## Membuat installer

```bash
npm run tauri build
```

Installer `.exe` dan `.msi` tersedia di `src-tauri/target/release/bundle/`.

## Struktur proyek

```
src/            Frontend React dan TypeScript
src-tauri/      Backend Rust, skema SQLite, dan konfigurasi Tauri
```

## Rencana pengembangan

- Integrasi Google Calendar
- Dashboard ringkasan
- Tema gelap
- Subtask dan task berulang
