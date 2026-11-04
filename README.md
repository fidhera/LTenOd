<div align="center">

<p align="center">
  <img src="LTen.png" alt="LTenOd Logo" width="380" style="vertical-align: middle; margin-right: 18px;"/>
  <img src="icon.png" alt="LTenOd Icon" width="115" style="vertical-align: middle;"/>
</p>

<br/>

<!-- Identity & Community -->
[![Built by fidhera](https://img.shields.io/badge/Built%20by-fidhera-E50914?style=for-the-badge&logo=github)](https://github.com/fidhera)
[![Instagram](https://img.shields.io/badge/Instagram-Instagram-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://instagram.com/fidhera)
[![Discord](https://img.shields.io/badge/Discord-Community-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/fHxRMvgj4) 
[![License](https://img.shields.io/badge/License-MIT-F59E0B?style=for-the-badge)](LICENSE)

<br/>

<!-- Core Tech Stack -->
[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Google Gemini API](https://img.shields.io/badge/AI_Engine-Gemini_3.5_Flash-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![OpenAI Compatible](https://img.shields.io/badge/Provider-9Router_/_DeepSeek_/_OpenRouter-00A67E?style=for-the-badge&logo=openai&logoColor=white)](https://openrouter.ai/)

<br/>

**LTenOd** (berasal dari kata *nod* yang bermakna patuh atau mengangguk mengeksekusi instruksi) adalah ekstensi browser Chrome berbasis Manifest V3 yang dirancang untuk membantu mahasiswa menyelesaikan kuis pilihan ganda secara terotomatisasi maupun semi-otomatis pada portal praktikum dan ujian *e-learning* **Universitas Gunadarma** (**Praktikum iLab**, **V-Class**, dan **Praktikum IFLab**).

Sistem ini mengekstraksi teks soal beserta gambar secara langsung dari DOM Moodle, mengirimkannya ke model bahasa besar (LLM) melalui integrasi multi-provider, menandai dan mencentang opsi jawaban yang tepat, lalu melakukan navigasi antar-halaman secara otonom hingga soal terakhir selesai dikerjakan.

---

[Deskripsi](#deskripsi) • [Fitur Utama](#fitur-utama) • [Arsitektur Sistem](#arsitektur-sistem) • [Panduan Pengambilan API Key](#panduan-pengambilan-api-key) • [Panduan Instalasi & Pemakaian](#panduan-instalasi--pemakaian) • [Pemecahan Masalah (Troubleshooting)](#pemecahan-masalah-troubleshooting) • [Struktur Direktori](#struktur-direktori) • [Penulis](#penulis)
</div>

---

## Deskripsi

Kuis daring pada platform praktikum Gunadarma umumnya menerapkan struktur Moodle modular dengan verifikasi integritas urutan pengiriman (*sequence check*). Mahasiswa sering kali menghadapi beberapa kendala teknis saat mengerjakan latihan soal:
1. **Integritas Sesi Kuis Moodle:** Pengiriman formulir ganda (*duplicate dispatch*) atau penggunaan tombol riwayat peramban memicu galat `You have entered data outside the normal sequence`.
2. **Keterbatasan Fleksibilitas AI:** Mayoritas alat bantu hanya terpaku pada satu penyedia AI, sehingga jika kuota habis (*rate limit* HTTP 429), pengguna terhenti total.
3. **Penyelesaian Soal Terakhir:** Pada soal terakhir, tombol navigasi berubah nilai menjadi `Finish attempt ...`. Alat otomasi yang keliru mengeklik tombol ini dapat mengumpulkan kuis tanpa verifikasi akhir, atau sebaliknya berhenti sebelum soal terakhir sempat dicentang.

**LTenOd** menyelesaikan permasalahan tersebut secara terstruktur:
- **Pencegah Galat Urutan Moodle:** Mengunci status navigasi (*isNavigating lock*) dan mendisposisi tepat satu kali klik per halaman kuis guna menjaga integritas sequence Moodle.
- **Auto-Recovery Sesi Error:** Mendeteksi otomatis halaman peringatan fatal Moodle dan mengeklik tombol *Continue* untuk memulihkan sesi ujian tanpa intervensi manual.
- **Arsitektur Multi-Provider Universal:** Mendukung Google Gemini Native serta endpoint standar OpenAI-compatible (9Router, OpenRouter, DeepSeek, Groq, OpenAI, atau Reverse Proxy kustom) dengan deteksi otomatis seluruh katalog model aktif tanpa batas pemotongan (*uncapped model discovery*).
- **Pengamanan Soal Terakhir (Auto-Submit Guard):** Memastikan soal terakhir telah dianalisis dan opsinya dicentang terlebih dahulu di layar, kemudian secara sadar menahan tombol *Finish attempt* agar tidak terkirim otomatis, memberikan kesempatan bagi pengguna untuk memeriksa rekapitulasi nilai.
- **Toleransi Gangguan Jaringan (Autonomous Auto-Retry):** Jika terjadi lonjakan latensi atau *timeout* sementara dari server AI, ekstensi tidak memutus alur otomatis, melainkan mengulang permintaan secara mandiri hingga 2 kali sebelum memberikan laporan diagnostik terperinci.

---

## Fitur Utama

- **Pilihan Mode Eksekusi:**
  - **Otomatis (Auto-Answer - Lepas Tangan):** Membaca soal, memilih opsi yang benar, dan berpindah ke halaman berikutnya secara mandiri dengan rentang jeda waktu yang dapat dikonfigurasi (misal 1–3 detik).
  - **Highlight Saja:** Hanya menandai opsi yang benar dengan kotak hijau lembut dan lencana jawaban, menyerahkan klik akhir ke tangan pengguna.
- **Widget Layar Mengambang (Floating Glass Window):**
  - Antarmuka *Glassmorphism* modern dengan indikator model AI aktif, status eksekusi, serta tombol aksi.
  - Dapat digeser (*draggable*) ke posisi manapun di layar dan diperkecil (*minimize*) dengan tombol minimize.
  - Mode senyap (*stealth mode*) menggunakan pintasan `Alt + H` untuk menyembunyikan atau menampilkan widget seketika.
- **Pencarian Model Real-Time:** Menampung hingga 900+ model dari 9Router atau OpenRouter dengan kotak filter pencarian cepat langsung di popup pengaturan.
- **Uji Koneksi & Latensi:** Mengukur waktu respons (*ping/latency*) API provider secara riil dalam satuan milidetik (ms).
- **Notifikasi Audio Lembut:** Membunyikan nada frekuensi harmonis (Web Audio API) saat seluruh rangkaian kuis berhasil diselesaikan.

---

## Arsitektur Sistem

```text
       [ Halaman Ujian Moodle (Praktikum / V-Class / IFLab) ]
                               │
                               ▼
                   [ scripts/adapters.js ]
            (Deteksi Selektor DOM Berdasarkan Domain)
                               │
                               ▼
                    [ scripts/content.js ]
            (Ekstraksi Pertanyaan, Pilihan, & Gambar)
                               │
                               ▼  chrome.runtime.sendMessage
                   [ scripts/background.js ]
            (Orkestrator API & Service Worker MV3)
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
    [ Jalur Gemini Native ]       [ Jalur OpenAI-Compatible ]
     (Google AI Studio API)        (9Router / OpenRouter / DeepSeek)
               │                               │
               └───────────────┬───────────────┘
                               ▼  (fetchWithTimeout: 20s)
                   [ Respon JSON Terstruktur ]
                               │
                               ▼
                    [ Validasi & Sanitasi ]
                               │
                               ▼
                    [ scripts/content.js ]
               ┌───────────────┴───────────────┐
               │                               │
       (Sukses Respon)                 (Timeout / Error)
               │                               │
               ▼                               ▼
     [ Highlight & Centang ]        [ Cek Retry (< 2x)? ]
               │                          │          │
               ▼                        (Ya)       (Tidak)
   [ Cek: Soal Terakhir? ]                │          │
      │              │                    ▼          ▼
    (Ya)          (Tidak)             [ Retry ] [ Tampilkan ]
      │              │               (Otomatis)  [ Diagnostik ]
      ▼              ▼
[ Guard Aktif ] [ Countdown & Next ]
 (Tahan Submit)
```

---

## Panduan Pengambilan API Key

LTenOd membutuhkan API Key untuk memproses penalaran soal. Anda bebas memilih salah satu dari penyedia berikut:

### 1. Google Gemini (Gratis & Direkomendasikan)
1. Kunjungi portal resmi [Google AI Studio](https://aistudio.google.com/).
2. Masuk menggunakan akun Google Anda.
3. Klik tombol **Get API key** pada panel kiri atas, lalu pilih **Create API key**.
4. Salin kunci API yang diawali dengan `AIzaSy...`.
5. Buka popup **LTenOd**, pilih provider **Google Gemini**, tempelkan API key, lalu klik **Deteksi & Periksa Model**.

### 2. 9Router / Custom API Router
1. Buka dashboard akun [9Router](https://9router.com/) atau penyedia router AI pilihan Anda.
2. Buka menu **API Keys**, buat kunci baru, lalu salin token tersebut.
3. Catat **Base URL** penyedia (contoh: `https://api.9router.com/v1`).
4. Pada popup **LTenOd**, pilih provider **Custom / 9Router / Proxy**, masukkan Base URL dan API Key Anda, lalu klik **Deteksi & Periksa Model** untuk memuat seluruh katalog model yang tersedia.

### 3. OpenRouter
1. Buka [OpenRouter.ai](https://openrouter.ai/) dan lakukan pendaftaran.
2. Masuk ke menu **Keys** (`/keys`) dan klik **Create Key**.
3. Salin token API yang diawali dengan `sk-or-v1-...`.
4. Pada popup **LTenOd**, pilih provider **OpenRouter**, tempelkan kunci Anda, lalu tentukan model aktif (misal `deepseek/deepseek-chat` atau `google/gemini-2.0-flash-001`).

### 4. DeepSeek
1. Kunjungi [DeepSeek Open Platform](https://platform.deepseek.com/).
2. Buat API Key baru di tab **API Keys**.
3. Pada popup **LTenOd**, pilih provider **DeepSeek** dan masukkan API key Anda.

---

## Panduan Instalasi & Pemakaian

### 1. Pemasangan Ekstensi di Google Chrome

1. Unduh atau kloning repositori ini ke komputer lokal Anda:
   ```bash
   git clone https://github.com/fidhera/LTenOd.git
   ```
2. Buka peramban Google Chrome dan navigasikan ke alamat:
   ```text
   chrome://extensions/
   ```
3. Aktifkan toggle **Developer mode** (Mode pengembang) di pojok kanan atas.
4. Klik tombol **Load unpacked** (Muat yang belum dibongkar) di pojok kiri atas.
5. Arahkan dan pilih folder repositori `LTenOd`.
6. Sematkan (*pin*) ikon **LTenOd** pada bilah alat peramban Chrome.

### 2. Konfigurasi Awal
1. Klik ikon **LTenOd** pada toolbar Chrome untuk membuka jendela pengaturan.
2. Tentukan **Penyedia AI (Provider)** yang ingin digunakan.
3. Masukkan **API Key** (dan Base URL jika menggunakan 9Router/Custom).
4. Klik tombol **Deteksi & Periksa Model** untuk memverifikasi sambungan dan memilih model aktif.
5. Tentukan mode eksekusi (**Otomatis** atau **Highlight Saja**).
6. Klik tombol **Simpan Konfigurasi**. Popup akan menutup otomatis dan widget di tab kuis akan langsung aktif.

### 3. Penggunaan pada Halaman Kuis
1. Buka halaman kuis praktikum di [praktikum.gunadarma.ac.id](https://praktikum.gunadarma.ac.id/) atau [v-class.gunadarma.ac.id](https://v-class.gunadarma.ac.id/).
2. Widget mengambang LTenOd akan muncul di pojok kanan bawah.
3. Tekan kombinasi tombol **Alt + S** (atau klik tombol **Mulai Auto-Solve**) untuk memulai pengerjaan otomatis.
4. Gunakan kombinasi tombol **Alt + H** jika sewaktu-waktu ingin menyembunyikan widget dari pandangan.
5. Pada soal terakhir, ekstensi secara otomatis menandai jawaban dan menghentikan navigasi tanpa menekan tombol kumpul, sehingga Anda dapat meninjau kembali kuis sebelum diserahkan.

---

## Pemecahan Masalah (Troubleshooting)

| Pesan Kendala di Widget | Akar Masalah | Tindakan Perbaikan |
| :--- | :--- | :--- |
| **Koneksi Timeout (>20s)** | Server penyedia AI sedang mengalami antrean padat atau sinyal internet lokal tidak stabil. | Ekstensi telah mencoba mengulang otomatis 2x. Jika masih terjadi, buka popup pengaturan dan ganti ke model yang lebih ringan (misal `gemini-3.5-flash-lite`). |
| **Kuota / Token Habis (HTTP 429)** | Saldo token pada akun API provider telah habis atau terkena batas laju harian. | Isi ulang kredit token akun Anda atau beralih sementara ke Google Gemini API (tier gratis). |
| **API Key Tidak Valid (HTTP 401/403)** | Token API yang dimasukkan salah, kedaluwarsa, atau tidak memiliki izin akses model. | Buka popup ekstensi, periksa kembali karakter API Key (pastikan tidak ada spasi di awal/akhir), lalu simpan ulang. |
| **Model Tidak Ditemukan (HTTP 404)** | Nama ID model yang dipilih tidak terdaftar pada endpoint provider yang bersangkutan. | Buka popup ekstensi, klik **Deteksi & Periksa Model**, lalu pilih salah satu model yang muncul pada daftar dropdown. |
| **Outside the normal sequence (Moodle)** | Terjadi upaya navigasi sebelum proses halaman selesai, atau tombol peramban *Back/Forward* tertekan. | LTenOd telah dilengkapi fitur *auto-recovery*. Klik tombol **Continue** yang muncul pada layar atau biarkan ekstensi mengekliknya otomatis dalam 400ms. |

---

## Struktur Direktori

```text
LTenOd/
│
├── popup/
│   ├── popup.html             # Antarmuka panel pengaturan ekstensi (Glassmorphism)
│   ├── popup.css              # Tata gaya dan animasi panel pengaturan
│   └── popup.js               # Logika multi-provider, live model search, & sinkronisasi tab
│
├── scripts/
│   ├── adapters.js            # Selektor DOM portal Moodle (Praktikum, V-Class, IFLab)
│   ├── background.js          # Service worker latar belakang: pemanggil REST API Gemini/OpenAI
│   └── content.js             # Skrip injeksi halaman: ekstraksi soal, widget floating, & auto-navigasi
│
├── styles/
│   └── content.css            # Desain visual widget floating, status bar, & highlight pilihan
│
├── icon.png                   # Ikon ekstensi resolusi tinggi
├── Logo LTen.png              # Aset logo identitas grafis LTen
├── LTen.png                   # Aset logo tampilan dokumentasi
├── manifest.json              # Berkas manifes ekstensi Chrome Manifest V3
├── praktikum-ug-ac-id.html    # Berkas instrumen pengujian simulasi DOM kuis lokal
└── README.md                  # Dokumentasi teknis proyek
```

---

## Penulis
Dikembangkan dan dikelola oleh: [Raffael Fidhera](https://instagram.com/fidhera)
