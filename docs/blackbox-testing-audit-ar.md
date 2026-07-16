# Blackbox Testing — Audit AR

Checklist uji manual (blackbox) untuk Audit AR. Dijalankan di **Firebase emulator** (lokal, tanpa kuota) sehingga import/hapus/uji multi-orang bebas dilakukan. 6 skenario inti ada di **A–C**; **including but not limited to** — D & E menambah coverage inti + edge, dan daftar ini boleh terus diperluas (living checklist).

Isi kolom **Hasil**: `Pass` / `Fail` + catatan singkat.

## Setup & Tips
- **App**: http://localhost:3000 · **Emulator UI**: http://127.0.0.1:4000
- **Akun uji** (dari `scripts/seed-emulator.ts`, password semua `password123`):
  - `supervisor@test.com`, `sup2@test.com` — role **supervisor**
  - `fieldA@test.com`, `fieldB@test.com`, `fieldC@test.com` — role **fieldAudit**
- **Multi-orang**: buka tiap akun di **browser/profil/incognito berbeda** agar sesi terpisah.
- **Percepat kadaluarsa lock** (tanpa nunggu 15 mnt): Emulator UI → Firestore → `auditUnits/{id}` → edit `lock.lockedAt` mundur >15 menit. (TTL = 15 menit.)
- **Simulasi airplane mode**: DevTools → Network → **Offline** (atau matikan WiFi). Catatan: app pakai **memory-cache** Firestore (bukan persisten) → **reload saat offline = data hilang**; tanpa reload, sesi jalan dari cache memori.
- **Trigger cron sweep**: `POST /api/audit-ar/cron/expire-locks` header `Authorization: Bearer <CRON_SECRET>`.

---

## A. Concurrency & Draft Lock  *(skenario 1–3)*

| ID | Prasyarat | Langkah | Hasil Diharapkan | Hasil |
|---|---|---|---|---|
| **A1 — Klik unit sama bareng (3–4 org)** *(skenario 1)* | 1 unit `not_started`; 3–4 auditor login di device/browser berbeda, buka detail unit yang sama | Semua klik **"Mulai Audit"** hampir bersamaan | **Tepat 1** dapat lock & masuk form. Sisanya: toast **"Sedang dikerjakan oleh {nama}"** + tombol **"Sedang dikerjakan oleh {nama}"** (disabled). Tak ada 2 orang mengedit unit sama. | |
| **A2 — Upload foto bareng (owner)** *(skenario 2a)* | Auditor pemegang lock ada di form | Pilih **beberapa foto sekaligus** / upload beruntun cepat | Semua foto masuk Drive, `attachments` konsisten (tak dobel/hilang), tiap foto berlabel, progress benar. | |
| **A3 — Upload non-owner / sesi basi** *(skenario 2b)* | Auditor B punya form terbuka tapi lock pindah/expired (expire via Emulator UI) | B coba upload foto | Upload **ditolak** 403 **"Unit not locked by you"**, foto tak masuk. Snapshot lock juga meredirect B: "Kunci draft tidak aktif". | |
| **A4 — Draft pagi, upload sore** *(skenario 3)* | Auditor mulai audit pagi, isi field + upload 1 foto (auto-save) | **(3a)** Tab form dibiarkan terbuka & aktif → upload lagi "jam 3". **(3b)** Tutup form; buka lagi → "Lanjutkan Draft" → upload. Simulasi cepat: expire-kan `lock.lockedAt` via Emulator UI. | **Data draft (field + foto ter-upload) tak pernah hilang.** (3a) heartbeat jaga lock hidup → upload/submit sore sukses. (3b) lock expired, draft tetap → "Lanjutkan Draft" **re-acquire** → sukses. Jika keburu diambil auditor lain → pemilik lama lihat unit sudah dikerjakan/terkirim (data draft-nya tak menimpa). | |

---

## B. Offline & Session Resilience  *(skenario 4–5)*

| ID | Prasyarat | Langkah | Hasil Diharapkan | Hasil |
|---|---|---|---|---|
| **B1 — Airplane mode saat ada draft** *(skenario 4)* | Auditor di form, draft berisi field + ≥1 foto ter-upload; **jangan reload** | Aktifkan Offline. Edit field. Coba upload foto baru. Coba submit. Lalu **online lagi**. | Edit field jalan (cache memori) & auto-save **ter-antri**, sinkron saat online. **Upload foto baru GAGAL** offline → toast error. **Submit GAGAL/menggantung** offline → saat online, jika lock hidup & dimiliki → bisa submit; jika expired/diambil → redirect "Kunci draft tidak aktif". Heartbeat tak terkirim offline (bisa expired jika >15 mnt). | |
| **B2 — Reload saat offline** *(skenario 4 varian)* | Seperti B1, tapi **reload** saat offline | Refresh browser dalam kondisi offline | App **tak bisa memuat data** (memory-cache hilang; tak ada persistent cache) → loading/gagal. Online lagi + reload → draft yang sudah tersimpan muncul kembali. | |
| **B3 — Ditutup paksa saat mengisi** *(skenario 5)* | Auditor isi form, sebagian field terisi, mungkin 1 foto ter-upload | **Force-close** app/browser, buka lagi & login | Draft **persist** → unit tampil **"Lanjutkan Draft"**. Foto **sudah ter-upload** tetap ada; foto **preview lokal (belum upload)** hilang. Edit sejak debounce terakhir (~1–2 dtk) bisa hilang. Buka <15 mnt → lock miliknya masih hidup, lanjut mulus; >15 mnt → re-acquire; jika keburu diambil → unit tampak sudah dikerjakan. | |

---

## C. Review — Reject & Approve  *(skenario 6)*

| ID | Prasyarat | Langkah | Hasil Diharapkan | Hasil |
|---|---|---|---|---|
| **C1 — Approve** | Ada submission `pending` | Supervisor buka detail unit → **Setujui** | Toast **"Audit disetujui"**, status → **approved** (immutable). Auditor lihat "Sudah disetujui", tak bisa edit. | |
| **C2 — Reject (wajib alasan)** | Ada submission `pending` | Supervisor → **Tolak**. Submit tanpa alasan, lalu isi alasan | Tanpa alasan → **"Alasan penolakan wajib diisi"**. Dengan alasan → **"Audit ditolak"**, status → **rejected**. | |
| **C3 — Revisi & kirim ulang** | Unit `rejected` (dari C2) | Auditor buka unit → lihat catatan penolakan → **"Revisi & Kirim Ulang"** → perbaiki → submit | Kembali **pending**, submission **versi bertambah (v2)**, riwayat lama tetap ada, muncul lagi di antrian review. | |
| **C4 — Review bareng 2 supervisor** *(skenario 6, konkuren)* | 1 submission `pending`; 2 supervisor buka bareng | Keduanya klik (approve/reject) hampir bersamaan | **Tepat 1 keputusan menang.** Yang kalah: **"Audit ini sudah direview supervisor lain"**; keputusan pertama tak ketimpa. | |

---

## D. Core Flows

| ID | Area | Langkah | Hasil Diharapkan | Hasil |
|---|---|---|---|---|
| **D1** | Auth & role | Login supervisor vs fieldAudit; user tanpa role | Supervisor: menu Unit/Review/Team/Kategori + bisa hapus. FieldAudit: hanya sisi lapangan, **tak bisa** hapus/akses halaman supervisor. Tanpa role → layar "no workspace". | |
| **D2** | Import "Data Opname" | Supervisor → Import → upload `docs/Rekap...Final.xlsx` | Preview kenali sheet **Data Opname** (abaikan baris kosong), tampil jumlah baru/update + kolom Cluster & Flag. Import isi `cluster`/`pelataranSistem`/`concernFlags`. **Re-import** menimpa master, **pertahankan** status/draft/riwayat. | |
| **D3** | Detail unit | Buka unit hasil import | Urutan **Master Data → Catatan Audit**. Master: Proyek, Cluster, Detail unit, **Pelataran (Data Sistem) Yes/No**, Brand, Tipe Unit (Customer hilang). Catatan Audit: **list flag ringkas** + teks; tanpa flag & catatan → blok tak muncul. | |
| **D4** | Audit happy path | not_started → Mulai Audit → isi Status Hunian, PLT, Kondisi, Tipe, Catatan, **≥3 foto wajib** → Kirim | Validasi jalan. Submit → **pending**, masuk antrian Review. | |
| **D5** | Hapus 1 unit + backup | Hapus unit **belum diaudit** (konfirmasi biasa) & **sudah diaudit** (butuh centang ekstra) | Unit hilang (optimistic). Muncul di **`auditUnitsDeleted/{stamp__id}`**. Unit audited: submission ter-backup di subcollection, **tak muncul lagi** di antrian review. Cepat (<~1–2 dtk). | |
| **D6** | Hapus Semua | **Hapus Semua** → ketik `HAPUS SEMUA` | Wajib frasa persis. Semua ter-backup lalu terhapus; daftar kosong; log `[delete-all]` progres. Restore: `npx tsx scripts/restore-deleted-unit.ts <backupId>`. | |
| **D7** | Export | Supervisor → Export | xlsx berisi kolom baru (Cluster, Pelataran (Data Sistem), Flag Audit) + hasil audit. | |
| **D8** | Paginasi & search | Daftar unit (data banyak) | Render ~50 baris + **"Muat lebih banyak"**. Filter status server-side. Search = **awalan nomor unit**. | |
| **D9** | Kategori | Supervisor → Kategori | Tambah/nonaktif (soft-delete `isActive`) kondisi & tipe bangunan; sinkron di dropdown form. | |
| **D10** | Import — validasi | Excel dengan baris rusak: nomor unit/proyek kosong, nomor unit **duplikat** | Baris invalid ditandai di preview (tak ikut import), duplikat diberi tahu. File/sheet salah → pesan error, tak crash. | |
| **D11** | Konsistensi supervisor | Detail unit + daftar sisi supervisor | Field baru tampil konsisten; kolom Customer hilang; header "N unit terdaftar" pakai count. | |

---

## E. Edge & Negative

| ID | Langkah | Hasil Diharapkan | Hasil |
|---|---|---|---|
| **E1 — Double-tap submit** | Tekan "Kirim" dua kali cepat | **Idempotent**: 1 submission; tap kedua → **"Audit ini sudah terkirim"** (bukan versi ganda). | |
| **E2 — Foto & label** | Submit tanpa foto / foto tanpa label / saat masih upload | "Minimal 1 foto wajib diunggah" / "Pilih atau isi label foto dulu" / "Tunggu foto selesai diunggah". | |
| **E3 — Hapus draft (+ bersih Drive)** | Form/detail → "Hapus Draft" | Draft & lock dibersihkan, status → not_started, **foto draft di Drive ikut terhapus**, **tanpa** redirect "kunci hilang". | |
| **E4 — Takeover setelah expiry** | A pegang lock lalu diam >15 mnt (atau expire via Emulator UI); B "Mulai Audit" | B ambil alih. Form A yang basi → redirect **"Kunci draft tidak aktif. Mulai ulang dari halaman unit."** | |
| **E5 — Cron sweep** | Set `lock.lockedAt` mundur >15 mnt untuk unit `draft` & `rejected`; trigger cron | draft+expired → **not_started**, lock null. rejected+expired → lock dilepas, **tetap rejected**. Lock hidup tak disentuh. | |
| **E6 — PLT "Lainnya"** | PLT = Lainnya, keterangan kosong | "Keterangan PLT / pelataran wajib diisi". | |
| **E7 — Hapus unit yang sedang diaudit** | Auditor pegang draft unit X; supervisor hapus X | Unit terhapus + ter-backup. Sesi auditor: aksi/snapshot berikut gagal anggun (unit tak ada), tak crash. | |
| **E8 — Perubahan role live** | Supervisor ubah role user Y yang sedang login | UI Y update **tanpa login ulang** (onSnapshot + refresh token). | |
| **E9 — Foto besar dikompres** | Upload foto resolusi tinggi | Dikompres di client sebelum upload; ukuran turun, upload sukses, thumbnail tampil. | |
| **E10 — Heartbeat tab background (HP)** | Buka form di HP, kunci layar/pindah app >1 mnt, buka lagi | Saat wake, lock **di-assert ulang** (renew on focus/visibility). Jika keburu expired & diambil → redirect "Kunci draft tidak aktif". | |

---

## Ringkasan
- Total: **A(4) + B(3) + C(4) + D(11) + E(10) = 32 kasus.**
- Prioritas rilis: A1–A4, B1/B3, C1–C4, D4/D5/D6 (paling berdampak).
- Tambah kasus baru di bawah kategori yang sesuai begitu ketemu bug/alur baru.
