<div align="center">

<p align="center">
  <img src="assets/images/logo.png" alt="LTenOd Logo" width="380" style="vertical-align: middle; margin-right: 18px;"/>
  <img src="assets/icons/icon.png" alt="LTenOd Icon" width="115" style="vertical-align: middle;"/>
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
[![Google Gemini API](https://img.shields.io/badge/AI_Engine-Gemini_2.5_Flash-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![OpenAI Compatible](https://img.shields.io/badge/Provider-9Router_/_DeepSeek_/_OpenRouter-00A67E?style=for-the-badge&logo=openai&logoColor=white)](https://openrouter.ai/)

<br/>

**LTenOd** (berasal dari kata *nod* yang bermakna patuh atau mengangguk mengeksekusi instruksi) adalah ekstensi browser Chrome berbasis Manifest V3 yang dirancang untuk membantu mahasiswa menyelesaikan kuis pilihan ganda maupun tugas koding secara otomatis dan semi-otomatis pada portal praktikum dan ujian *e-learning* **Universitas Gunadarma** (**Praktikum iLab**, **V-Class**, dan **Praktikum IFLab**).

Sistem ini mengekstraksi teks soal, contoh test case, dan gambar langsung dari DOM Moodle, mengirimkannya ke model bahasa besar (LLM) melalui integrasi multi-provider, mengisi atau menandai jawaban, mengevaluasi hasil secara mandiri, lalu melakukan navigasi antar-halaman secara otonom hingga seluruh soal selesai dikerjakan.

---

[Deskripsi](#deskripsi) • [Demo Penggunaan](#demo-penggunaan) • [Rincian Pembaruan Fitur](#rincian-pembaruan-fitur) • [Fitur Utama](#fitur-utama) • [Arsitektur Sistem](#arsitektur-sistem) • [Panduan Pengambilan API Key](#panduan-pengambilan-api-key) • [Panduan Instalasi & Pemakaian](#panduan-instalasi--pemakaian) • [Pemecahan Masalah (Troubleshooting)](#pemecahan-masalah-troubleshooting) • [Struktur Direktori](#struktur-direktori) • [Penulis](#penulis)
</div>

---

## Deskripsi

Kuis daring pada platform praktikum Gunadarma umumnya menerapkan struktur Moodle modular dengan verifikasi urutan pengiriman (*sequence check*). Mahasiswa sering kali menghadapi beberapa kendala teknis saat mengerjakan latihan soal:
1. **Integritas Sesi Kuis Moodle:** Pengiriman formulir ganda (*duplicate dispatch*) atau penggunaan tombol riwayat peramban memicu galat `You have entered data outside the normal sequence`.
2. **Keterbatasan Fleksibilitas AI:** Mayoritas alat bantu hanya terpaku pada satu penyedia AI, sehingga jika kuota habis (*rate limit* HTTP 429), pengguna terhenti total.
3. **Penyelesaian Soal Terakhir:** Pada soal terakhir, tombol navigasi berubah nilai menjadi `Finish attempt ...`. Alat otomasi yang keliru mengeklik tombol ini dapat mengumpulkan kuis tanpa verifikasi akhir, atau sebaliknya berhenti sebelum soal terakhir sempat dicentang.
4. **Variasi Format Soal (Kuis Interaktif & Koding):** Selain kuis standar, terdapat soal interaktif dengan kesempatan mencoba ulang (*tries remaining*) serta soal koding berbasis Moodle CodeRunner yang memerlukan evaluasi test case (*Expected vs Got*).

LTenOd menyelesaikan permasalahan tersebut secara terstruktur melalui arsitektur multi-provider, auto-retry koneksi, deteksi status interaktif, penanganan editor koding Ace, dan guard navigasi halaman.

---

## Demo Penggunaan

Berikut rekaman demonstrasi pengujian LTenOd pada portal resmi Universitas Gunadarma:

### 1. Praktikum Gunadarma (iLab: Kuis Pilihan Ganda & Soal Koding CodeRunner)

<video src="assets/videos/demo-praktikum.mp4" controls width="100%"></video>

> [!NOTE]
> Jika pemutar video di atas tidak berjalan di peramban Anda, Anda dapat membuka atau mengunduh berkas video secara langsung melalui [assets/videos/demo-praktikum.mp4](assets/videos/demo-praktikum.mp4).

### 2. V-Class Gunadarma (Kuis Perkuliahan & Ujian Daring)

<video src="assets/videos/demo-vclass.mp4" controls width="100%"></video>

> [!NOTE]
> Jika pemutar video di atas tidak berjalan di peramban Anda, Anda dapat membuka atau mengunduh berkas video secara langsung melalui [assets/videos/demo-vclass.mp4](assets/videos/demo-vclass.mp4).

---

## Rincian Pembaruan Fitur

Berikut ringkasan perubahan teknis dan fungsional yang telah diimplementasikan:

1. **Sinkronisasi Popup Pengaturan dan Floating Widget**
   - Saat pengguna menekan tombol **Simpan Konfigurasi** pada popup, jendela popup otomatis tertutup dan widget melayang di kanan bawah tab kuis langsung aktif tanpa perlu memuat ulang halaman secara manual.
   - Menghilangkan latensi startup awal, sehingga mode otomatis dapat langsung dijalankan seketika setelah setup API selesai.

2. **Koneksi Cepat dan Autonomous Auto-Retry**
   - Mengatasi kendala timeout berulang pada koneksi jaringan atau latensi antrean server AI.
   - Jika permintaan mengalami lonjakan latensi atau timeout (>20 detik), sistem menjalankan auto-retry otomatis di latar belakang tanpa memutus alur kerja otomatis.
   - Menampilkan kartu diagnostik kesalahan yang spesifik jika terjadi kendala permanen (seperti HTTP 429 untuk kuota habis, HTTP 401/403 untuk API key tidak valid, HTTP 404 untuk model tidak ditemukan, atau HTTP 500/503 untuk gangguan server).

3. **Penghapusan Fitur Jeda Ragu**
   - Mode otomatis beroperasi penuh tanpa interupsi keraguan buatan, mengeksekusi jawaban langsung berdasarkan interval jeda acak yang dikonfigurasi pengguna.

4. **Dukungan Penuh Soal Pemrograman (CodeRunner)**
   - Mengekstrak instruksi soal, batasan aturan pemrograman, dan contoh test case dari tabel Moodle.
   - Menginjeksi kode solusi AI secara sinkron ke dalam Textarea Moodle dan editor Ace (`window.ace`).
   - Memicu tombol **Check** secara otomatis untuk menguji kode terhadap rangkaian test case bawaan sistem praktikum.

5. **Auto-Click "Show differences" pada Evaluasi Koding**
   - Ketika hasil evaluasi koding menunjukkan test case yang belum sesuai, ekstensi secara otomatis mengeklik tombol **Show differences** (`input[name$="-diffbutton"]`).
   - Perbandingan teks antara *Expected Output* dan *Got Output* dibuka secara otomatis, lalu dikirimkan kembali ke AI untuk dianalisa penyebab perbedaannya.

6. **Auto-Click "Reset answer" Sebelum Injeksi Solusi Perbaikan**
   - Saat melakukan perbaikan kode yang salah, ekstensi memicu tombol **Reset answer** (`input.answer_reset_btn`) untuk mengosongkan editor.
   - Panggilan konfirmasi dialog bawaan Moodle dibungkus secara aman di konteks halaman (`window.confirm = () => true`) agar dialog modal browser tidak menghentikan proses otomatis.
   - Setelah editor bersih, kode perbaikan yang lengkap disuntikkan kembali ke dalam Ace Editor.

7. **Sistem Pembelajaran Eliminasi Opsi (Interactive Quiz Memory)**
   - Pada kuis pilihan ganda yang memiliki kesempatan mengulang (*Try again / Tries remaining*), opsi yang terbukti salah otomatis disimpan ke dalam memori eliminasi sesi (`sessionStorage`).
   - Ekstensi mengeklik tombol **Try again**, lalu menginstruksikan AI untuk memilih jawaban dari sisa opsi yang belum pernah dieliminasi.

8. **Strict Guard Tombol "Next page"**
   - Tombol *Next page* dilarang diklik jika masih terdapat test case koding yang berstatus gagal (*incorrect*).
   - Tombol *Next page* dilarang diklik jika tombol *Try again* pada kuis interaktif masih aktif.
   - Halaman baru hanya akan dibuka apabila kuis telah berstatus *Correct* (100% lolos semua test case) atau batas kesempatan mencoba telah habis.

9. **Pengamanan Soal Terakhir (Auto-Submit Guard)**
   - Pada soal terakhir (atau saat tombol berubah menjadi *Finish attempt*), opsi jawaban dicentang terlebih dahulu di layar.
   - Ekstensi secara sadar menahan tombol *Finish attempt* agar mahasiswa dapat memeriksa kembali rekapitulasi jawaban sebelum kuis dikumpulkan secara manual.

---

## Fitur Utama

- **Mode Eksekusi:**
  - **Otomatis (Lepas Tangan):** Membaca soal, memilih opsi atau mengisi kode, menjalankan check, dan berpindah ke halaman berikutnya secara mandiri.
  - **Highlight Saja:** Menandai opsi jawaban yang benar dengan bingkai hijau lembut dan lencana jawaban, menyerahkan klik akhir ke tangan pengguna.
- **Widget Layar Mengambang (Floating Window):**
  - Antarmuka visual dengan indikator provider dan model aktif, status eksekusi, serta tombol kendali.
  - Dapat digeser (*draggable*) ke posisi manapun di layar dan diperkecil (*minimize*).
  - Mode sembunyi instan menggunakan pintasan keyboard `Alt + H`.
  - Mulai atau hentikan pengerjaan kuis menggunakan pintasan keyboard `Alt + S`.
- **Pencarian Model Real-Time:** Menampung hingga 900+ model dari 9Router atau OpenRouter dengan kotak filter pencarian cepat langsung di popup pengaturan.
- **Uji Koneksi dan Latensi:** Mengukur waktu respons (*ping/latency*) endpoint API secara riil dalam satuan milidetik (ms).
- **Notifikasi Audio:** Membunyikan nada Web Audio API saat seluruh rangkaian kuis berhasil diselesaikan.

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
            (Ekstraksi Soal, Pilihan, Gambar, & CodeRunner)
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
                               ▼  (fetchWithTimeout: 20s/35s)
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
   [ Centang Opsi / Injeksi Code ]    [ Cek Retry (< 2x)? ]
               │                          │          │
               ▼                        (Ya)       (Tidak)
   [ Cek Status: Check / Next ]           │          │
      │                     │             ▼          ▼
   (Koding)             (Pilihan)     [ Retry ]  [ Tampilkan ]
      │                     │        (Otomatis)  [ Diagnostik ]
      ▼                     ▼
 [ Auto-Diff / Reset ] [ Guard Soal Terakhir ]
```

---

## Panduan Pengambilan API Key

LTenOd membutuhkan API Key untuk memproses penalaran soal. Anda dapat memilih salah satu penyedia berikut:

### 1. Google Gemini (Tier Gratis Tersedia)
1. Kunjungi portal resmi [Google AI Studio](https://aistudio.google.com/).
2. Masuk menggunakan akun Google Anda.
3. Buka menu **Get API key**, lalu pilih **Create API key**.
4. Salin token API yang diawali dengan `AIzaSy...`.
5. Buka popup **LTenOd**, pilih provider **Google Gemini**, tempelkan API key, lalu klik **Deteksi & Periksa Model**.

### 2. 9Router / Custom API Router
1. Buka dashboard akun [9Router](https://9router.com/) atau penyedia router AI pilihan Anda.
2. Buka menu **API Keys**, buat kunci baru, lalu salin token tersebut.
3. Catat **Base URL** penyedia (contoh: `https://api.9router.com/v1`).
4. Pada popup **LTenOd**, pilih provider **Custom / 9Router / Proxy**, masukkan Base URL dan API Key, lalu klik **Deteksi & Periksa Model** untuk memuat daftar model yang aktif.

### 3. OpenRouter
1. Buka [OpenRouter.ai](https://openrouter.ai/) dan masuk ke akun Anda.
2. Buka menu **Keys** (`/keys`) dan klik **Create Key**.
3. Salin token API yang diawali dengan `sk-or-v1-...`.
4. Pada popup **LTenOd**, pilih provider **OpenRouter**, tempelkan kunci Anda, lalu tentukan model aktif (misal `deepseek/deepseek-chat` atau `google/gemini-2.5-flash`).

### 4. DeepSeek
1. Kunjungi [DeepSeek Open Platform](https://platform.deepseek.com/).
2. Buat API Key baru pada tab **API Keys**.
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
3. Masukkan **API Key** (serta Base URL jika menggunakan 9Router atau Reverse Proxy).
4. Klik tombol **Deteksi & Periksa Model** untuk memverifikasi sambungan dan memilih model aktif.
5. Tentukan mode eksekusi (**Otomatis** atau **Highlight Saja**).
6. Klik tombol **Simpan Konfigurasi**. Popup akan menutup otomatis dan widget di tab kuis akan langsung aktif.

### 3. Penggunaan pada Halaman Kuis
1. Buka halaman kuis praktikum di [praktikum.gunadarma.ac.id](https://praktikum.gunadarma.ac.id/) atau [v-class.gunadarma.ac.id](https://v-class.gunadarma.ac.id/).
2. Widget mengambang LTenOd akan muncul di pojok kanan bawah layar.
3. Tekan kombinasi tombol **Alt + S** (atau klik tombol **Mulai Auto-Solve**) untuk memulai pengerjaan kuis.
4. Gunakan kombinasi tombol **Alt + H** jika sewaktu-waktu ingin menyembunyikan widget dari tampilan.
5. Pada soal terakhir, ekstensi secara otomatis menandai jawaban dan menahan tombol pengumpulan agar Anda dapat meninjau kuis sebelum diserahkan.

---

## Pemecahan Masalah (Troubleshooting)

| Pesan Kendala di Widget | Akar Masalah | Tindakan Perbaikan |
| :--- | :--- | :--- |
| **Koneksi Timeout (>20s)** | Server penyedia AI sedang mengalami antrean padat atau sinyal internet lokal tidak stabil. | Ekstensi telah mencoba mengulang otomatis 2 kali. Jika masih terjadi, buka popup pengaturan dan ganti ke model yang lebih ringan (misal `gemini-2.5-flash` atau `gemini-2.5-flash-lite`). |
| **Kuota / Token Habis (HTTP 429)** | Saldo token pada akun API provider telah habis atau terkena batas kuota harian. | Isi ulang kredit token akun Anda atau beralih sementara ke Google Gemini API (tier gratis). |
| **API Key Tidak Valid (HTTP 401/403)** | Token API yang dimasukkan keliru, kedaluwarsa, atau tidak memiliki izin akses model. | Buka popup ekstensi, periksa kembali karakter API Key (pastikan tidak ada spasi di awal atau akhir), lalu simpan ulang. |
| **Model Tidak Ditemukan (HTTP 404)** | Nama ID model yang dipilih tidak terdaftar pada endpoint provider yang bersangkutan. | Buka popup ekstensi, klik **Deteksi & Periksa Model**, lalu pilih salah satu model yang muncul pada daftar dropdown. |
| **Outside the normal sequence (Moodle)** | Terjadi upaya navigasi sebelum proses halaman selesai, atau tombol peramban *Back/Forward* tertekan. | LTenOd telah dilengkapi fitur *auto-recovery*. Klik tombol **Continue** yang muncul pada layar atau biarkan ekstensi mengekliknya otomatis dalam 400ms. |

---

## Struktur Direktori

```text
LTenOd/
├── assets/
│   ├── icons/
│   │   └── icon.png                           # Ikon ekstensi resolusi tinggi
│   ├── images/
│   │   └── logo.png                           # Logo identitas visual LTenOd
│   └── videos/
│       ├── demo-praktikum.mp4                 # Video demonstrasi portal Praktikum Gunadarma
│       └── demo-vclass.mp4                    # Video demonstrasi portal V-Class Gunadarma
│
├── mock-pages/                                # Berkas pengujian simulasi DOM kuis lokal
│   ├── praktikum-correct.html                 # Simulasi hasil kuis berstatus benar
│   ├── praktikum-incorrect.html               # Simulasi hasil kuis berstatus salah
│   ├── praktikum-tryagain.html                # Simulasi kuis interaktif dengan tombol try again
│   ├── praktikum-ug-ac-id.html                # Simulasi halaman kuis standar praktikum
│   ├── praktikum-ug-ngoding.html              # Simulasi soal koding CodeRunner
│   ├── praktikum-ug-ngoding-incorrect.html    # Simulasi koding dengan kegagalan test case
│   └── vclass-ac-id.html                      # Simulasi halaman kuis V-Class
│
├── popup/
│   ├── popup.html                             # Antarmuka panel pengaturan ekstensi
│   ├── popup.css                              # Tata gaya visual panel pengaturan
│   └── popup.js                               # Logika multi-provider, live search, & sinkronisasi tab
│
├── scripts/
│   ├── adapters.js                            # Selektor DOM portal Moodle (Praktikum, V-Class, IFLab)
│   ├── background.js                          # Service worker: pemanggil REST API Gemini dan OpenAI
│   └── content.js                             # Skrip injeksi halaman: ekstraksi soal, widget, & auto-navigasi
│
├── styles/
│   └── content.css                            # Desain visual widget floating, status bar, & highlight
│
├── .gitattributes                             # Konfigurasi pelacakan Git LFS untuk video
├── .gitignore                                 # Berkas yang dikecualikan dari repositori
├── manifest.json                              # Berkas manifes ekstensi Chrome Manifest V3
└── README.md                                  # Dokumentasi teknis proyek
```

---

## Penulis
Dikembangkan dan dikelola oleh: [Raffael Fidhera](https://instagram.com/fidhera)
