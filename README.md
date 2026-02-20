# 🪙 Octra Wallet (Devnet)

Repositori ini berisi kode sumber untuk **Octra Wallet**, sebuah antarmuka dompet digital berbasis web yang dikembangkan secara mandiri untuk berinteraksi dengan **Octra Devnet**. Aplikasi ini dirancang untuk memberikan pengalaman pengelolaan aset yang intuitif dan aman di sisi pengguna (client-side).

> [!NOTE]  
> **Status Proyek**: Ini adalah proyek pengembangan pihak ketiga (Third-party) dan tidak berafiliasi langsung dengan tim pengembang inti Octra. Digunakan khusus untuk keperluan pengembangan dan pengujian pada jaringan Devnet.

---

## Fitur Unggulan

* **Non-Custodial**: Kunci privat dan mnemonic sepenuhnya dikendalikan oleh pengguna dan tidak pernah dikirim ke server mana pun.
* **Enkripsi Vault**: Menggunakan AES untuk mengamankan data dompet di penyimpanan lokal browser, yang hanya bisa dibuka dengan kata sandi pengguna.
* **Pemindai QR Integrasi**: Memudahkan pengiriman aset dengan memindai alamat melalui kamera perangkat.
* **Notifikasi Real-Time**: Dilengkapi dengan indikator visual dan suara untuk setiap transaksi masuk yang terdeteksi di jaringan.
* **Manajemen Aset**: Dashboard bersih untuk memantau saldo OCT dan riwayat transaksi secara otomatis.

---

## Arsitektur Teknologi

Proyek ini dibangun menggunakan pustaka kriptografi standar industri untuk memastikan integritas transaksi:

* **Ethers.js**: Digunakan untuk manajemen mnemonic dan derivasi kunci.
* **TweetNaCl**: Menangani penandatanganan transaksi secara aman menggunakan algoritma Ed25519.
* **CryptoJS**: Digunakan untuk enkripsi data sensitif pada penyimpanan lokal (`localStorage`).
* **Html5-QRCode**: Library pemindaian kode QR berbasis kamera.

### Informasi Jaringan (Devnet)
* **RPC URL**: `http://165.227.225.79:8080/rpc`
* **Format Alamat**: Prefix `oct` diikuti dengan encoding Base58
* **Satuan**: $1 \text{ OCT} = 1.000.000 \text{ Micro OCT}$

---

## Panduan Instalasi & Penggunaan

Aplikasi ini bersifat portabel dan dapat dijalankan tanpa perlu proses kompilasi yang rumit:

1.  **Unduh Kode**: Pastikan file `index.html`, `F233rHsgYE.css`, dan `F233rHsgYE.js` berada dalam direktori yang sama.
2.  **Jalankan**: Buka file `index.html` menggunakan browser modern (Chrome, Firefox, atau Edge).
3.  **Setup**:
    * Masukkan kata sandi untuk membuat brankas (*vault*) terenkripsi.
    * Buat dompet baru atau impor mnemonic 12 kata yang sudah ada.
4.  **Transaksi**: Gunakan menu "Send" untuk mengirim OCT atau menu "Receive" untuk melihat alamat publik dan kode QR Anda.

---

## Keamanan & Privasi

* **Penyimpanan Lokal**: Semua data sensitif (mnemonic/private key) disimpan dalam bentuk terenkripsi di browser Anda.
* **Hapus Data**: Fitur "Log Out" akan menghapus seluruh data vault dari `localStorage` secara permanen.
* **Peringatan**: Pengembang tidak bertanggung jawab atas kehilangan aset akibat hilangnya mnemonic atau kata sandi dompet. **Selalu cadangkan mnemonic Anda secara offline.**

---

**Developed with ❤️ by Community Developer**
