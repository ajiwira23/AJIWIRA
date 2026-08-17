AJI WIRA PORTFOLIO — CLOUDFLARE WORKERS
=======================================

TUJUAN
------
Project ini adalah versi khusus Cloudflare Workers + Static Assets.
API key ElevenLabs TIDAK disimpan di browser/GitHub. API key disimpan
sebagai Secret bernama ELEVENLABS_API_KEY di Worker.

STRUKTUR
--------
src/index.js              = Worker + proxy /api/tts
public/index.html         = website
public/style.css          = tampilan
public/script.js          = audio/UI frontend
public/cyber-minecraft.jpg= aset gambar
wrangler.jsonc            = konfigurasi Worker + assets

PENTING
-------
Jangan taruh API key di script.js, index.html, GitHub, atau ZIP.
Secret yang harus dibuat di Cloudflare:

ELEVENLABS_API_KEY

Nilainya harus API key ElevenLabs baru yang valid, biasanya diawali sk_.

CARA DEPLOY TANPA TERMUX (REKOMENDASI)
--------------------------------------
1. Buat repository GitHub baru.
2. Extract ZIP ini.
3. Upload SELURUH isi folder ke repository (jangan upload ZIP sebagai satu file).
4. Cloudflare Dashboard -> Workers & Pages -> Create -> Worker/Workers.
5. Pilih opsi koneksi repository/GitHub atau Workers Builds.
6. Hubungkan repository tersebut.
7. Pastikan build/deploy menggunakan wrangler.jsonc di root.
8. Deploy.
9. Buka Worker -> Settings -> Variables and Secrets.
10. Tambahkan Secret:
      Name: ELEVENLABS_API_KEY
      Value: sk_...
11. Save dan redeploy jika diminta.

ALTERNATIF DENGAN WRANGLER
--------------------------
Jika suatu saat kamu memakai komputer dengan Wrangler, perintah deploy
mengacu pada wrangler.jsonc. Namun project ini tidak mewajibkan Termux.

TES
---
Website: https://NAMA-WORKER.SUBDOMAIN.workers.dev
API:     https://NAMA-WORKER.SUBDOMAIN.workers.dev/api/tts?text=Halo

Jika Secret belum dipasang, /api/tts mengembalikan 503 dengan pesan yang jelas.
Jika API key invalid, ElevenLabs akan mengembalikan error autentikasi.

AUDIO
-----
- Tidak ada delay narasi 280ms/500ms.
- AudioContext dibuka pada gesture pertama.
- ElevenLabs dipanggil melalui Worker, bukan dari browser dengan API key.
- Cache digunakan agar audio yang sudah pernah dibuat dapat dimainkan lebih cepat.
- Jika ElevenLabs gagal/belum siap, browser memakai suara sistem id-ID sebagai fallback.
- Efek cyborg-clown tetap ringan agar Bahasa Indonesia tetap jelas.

VOICE ID
--------
Voice ID saat ini ada di src/index.js:
  cDtCy1lw43ktxm1uFIWJ

Jika voice tersebut tidak tersedia pada akun ElevenLabs, ganti hanya konstanta
VOICE_ID di src/index.js dengan voice ID milik akunmu.
