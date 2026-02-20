# 🪙 Octra Wallet (Devnet)

This repository contains the source code for Octra Wallet, a web-based digital wallet interface developed independently for interacting with Octra Devnet. The application is designed to provide an intuitive and secure client-side asset management experience.

> [!NOTE]
> **Project Status**: This is a third-party development project and is not directly affiliated with the Octra core development team. It is used exclusively for development and testing purposes on the Devnet network.

---

## Key Features

* Non-Custodial: Private keys and mnemonics are completely controlled by the user and are never sent to any server.
* Vault Encryption: Uses AES to secure wallet data in the browser's local storage, which can only be unlocked with the user's password.
* QR Scanner Integration: Easily send assets by scanning addresses with the device's camera.
* Real-Time Notifications: Equipped with visual and audible indicators for every incoming transaction detected on the network.
* Asset Management: A clean dashboard for automatically monitoring OCT balances and transaction history.

---

## Technology Architecture

This project is built using industry-standard cryptographic libraries to ensure transaction integrity:

* Ethers.js: Used for mnemonic management and key derivation.
* TweetNaCl: Handles secure transaction signing using the Ed25519 algorithm.
* CryptoJS: Used for encrypting sensitive data on local storage (`localStorage`).
* Html5-QRCode: Camera-based QR code scanning library.

### Network Information (Devnet)
* **RPC URL**: `http://165.227.225.79:8080/rpc`
* **Address Format**: Prefix `oct` followed by Base58 encoding
* **Unit**: $1 \text{ OCT} = 1,000,000 \text{ Micro OCT}$

---

## Installation & Usage Guide

This application is portable and can be run without a complex compilation process:

1. **Download Code**: Make sure the `index.html`, `F233rHsgYE.css`, and `F233rHsgYE.js` files are in the same directory.
2. **Run**: Open the `index.html` file using a modern browser (Chrome, Firefox, or Edge).

3. **Setup**:
* Enter a password to create an encrypted vault.
* Create a new wallet or import an existing 12-word mnemonic.
* 4. **Transactions**: Use the "Send" menu to send an OCT or the "Receive" menu to view your public address and QR code.

---

## Security & Privacy

* **Local Storage**: All sensitive data (mnemonics/private keys) is stored encrypted in your browser.
* **Wipe Data**: The "Log Out" feature will permanently delete all vault data from localStorage.
* **Warning**: The developer is not responsible for any loss of assets due to the loss of wallet mnemonics or passwords. **Always back up your mnemonics offline.**

---

## Bahasa Indonesia

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

**Developed with ❤️ by 0xmsr**
