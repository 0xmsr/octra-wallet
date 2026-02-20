const RPC_URL = "/api/rpc";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MICRO_OCT = 1000000;
const STORAGE_KEY = "octra_encrypted_vault";
let pendingTx = null;
let html5QrcodeScanner = null;
let lastBalance = null;
let currentWallet = {
    mnemonic: null,
    privKeyBytes: null,
    publicKeyBase64: null,
    address: null,
    nonce: 0,
    balance: 0
};

async function deriveWalletFromMnemonic(mnemonic, isImporting = true) {
    const password = document.getElementById('wallet-password').value;
    
    if (isImporting && !password) {
        document.getElementById('setup-msg').innerHTML = '<p class="error">Please set a password to encrypt your wallet.</p>';
        return;
    }

    currentWallet.mnemonic = mnemonic;
    try {
        const wallet = ethers.Wallet.fromMnemonic(mnemonic);
        const privKeyBytes = ethers.utils.arrayify(wallet.privateKey).slice(0, 32);
        const keyPair = nacl.sign.keyPair.fromSeed(privKeyBytes);
        const pubBytes = keyPair.publicKey;
        const pubHash = new Uint8Array(sha256.create().update(pubBytes).array());
        const address = "oct" + base58Encode(pubHash);

        currentWallet.privKeyBytes = privKeyBytes;
        currentWallet.publicKeyBase64 = toBase64(pubBytes);
        currentWallet.address = address;

        if (password) {
            const encrypted = CryptoJS.AES.encrypt(mnemonic, password).toString();
            localStorage.setItem(STORAGE_KEY, encrypted);
        }

        generateQRCode(address);
        document.getElementById('ui-addr-short').innerText = address.substring(0, 7) + "..." + address.substring(address.length - 5);
        document.getElementById('full-address').innerText = address;
        document.getElementById('screen-setup').classList.remove('active');
        showScreen('screen-dashboard');
        refreshData();
    } catch (e) {
        document.getElementById('setup-msg').innerHTML = `<p class="error">Error: ${e.message}</p>`;
    }
}

window.addEventListener('load', () => {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
        const pass = prompt("Enter your wallet password to unlock:");
        if (pass) {
            try {
                const bytes = CryptoJS.AES.decrypt(savedData, pass);
                const originalMnemonic = bytes.toString(CryptoJS.enc.Utf8);
                if (originalMnemonic) {
                    deriveWalletFromMnemonic(originalMnemonic, false);
                } else {
                    alert("Incorrect password.");
                }
            } catch (e) {
                alert("Decryption failed.");
            }
        }
    }
});

function sendTransaction() {
    const to = document.getElementById('send-to').value.trim();
    const amountStr = document.getElementById('send-amount').value.trim();
    const amountFloat = parseFloat(amountStr);

    if (!to.startsWith("oct") || isNaN(amountFloat) || amountFloat <= 0) {
        document.getElementById('tx-msg').innerHTML = '<p class="error">Invalid address or amount.</p>';
        return;
    }

    if (amountFloat > currentWallet.balance) {
        document.getElementById('tx-msg').innerHTML = '<p class="error">Insufficient balance.</p>';
        return;
    }

    const fee = amountFloat < 1000 ? 0.001 : 0.03;
    pendingTx = { to, amountStr, amountFloat, fee };
    
    document.getElementById('conf-to').innerText = to.substring(0,12) + "...";
    document.getElementById('conf-amount').innerText = amountStr;
    document.getElementById('conf-fee').innerText = fee;
    document.getElementById('tx-confirmation-modal').classList.remove('hidden');
}

function closeConfirmModal() {
    document.getElementById('tx-confirmation-modal').classList.add('hidden');
    pendingTx = null;
}

async function executeSend() {
    if (!pendingTx) return;
    const { to, amountStr, amountFloat } = pendingTx;
    closeConfirmModal();
    
    const msgBox = document.getElementById('tx-msg');
    const amountRaw = Math.floor(amountFloat * MICRO_OCT).toString();
    const nextNonce = currentWallet.nonce + 1;
    const ouFee = amountFloat < 1000 ? "10000" : "30000";

    msgBox.innerHTML = '<p style="color:#87ceeb;">Processing Transaction...</p>';

    try {
        const signFields = {
            "from": currentWallet.address,
            "to_": to,
            "amount": amountRaw,
            "nonce": nextNonce,
            "ou": ouFee,
            "timestamp": Date.now() / 1000,
            "op_type": "standard"
        };

        const serializedStr = JSON.stringify(signFields, Object.keys(signFields));
        const keyPair = nacl.sign.keyPair.fromSeed(currentWallet.privKeyBytes);
        const signatureBytes = nacl.sign.detached(new TextEncoder().encode(serializedStr), keyPair.secretKey);
        
        const txObj = {
            ...signFields,
            signature: toBase64(signatureBytes),
            public_key: currentWallet.publicKeyBase64
        };

        const result = await rpcCall("octra_submit", [txObj]);
        msgBox.innerHTML = `<p class="success">Success! Hash: ${result.tx_hash.substring(0,15)}...</p>`;
        
        saveHistory({ to, amount: amountStr, date: new Date().toLocaleString(), status: 'Success' });
        
        document.getElementById('send-to').value = '';
        document.getElementById('send-amount').value = '';
        setTimeout(refreshData, 2000);
    } catch (error) {
        msgBox.innerHTML = `<p class="error">Failed: ${error.message}</p>`;
    }
}

function base58Encode(buffer) {
    let hex = Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
    let n = BigInt("0x" + hex);
    let result = [];
    while (n > 0n) {
        let r = Number(n % 58n);
        n = n / 58n;
        result.push(BASE58_ALPHABET[r]);
    }
    for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] !== 0) return "1".repeat(i) + result.reverse().join('');
    }
    return "1".repeat(buffer.length);
}

function toBase64(uint8Array) {
    return btoa(String.fromCharCode.apply(null, uint8Array));
}

function createWallet() {
    const randomWallet = ethers.Wallet.createRandom();
    const mnemonic = randomWallet.mnemonic.phrase;
    
    const box = document.getElementById('mnemonic-display');
    const text = document.getElementById('mnemonic-text');
    box.style.display = 'block';
    text.innerText = mnemonic;

    deriveWalletFromMnemonic(mnemonic);
}

function importWallet() {
    const phrase = document.getElementById('import-mnemonic').value.trim();
    if (!phrase) {
        document.getElementById('setup-msg').innerHTML = `<p class="error">Please enter a mnemonic phrase.</p>`;
        return;
    }
    deriveWalletFromMnemonic(phrase);
}

async function rpcCall(method, params = []) {
    const payload = { jsonrpc: "2.0", method: method, params: params, id: Math.floor(Math.random() * 10000) };
    const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const data = await response.json();
    
    if (data.error) {
        const err = new Error(data.error.message || "Unknown Error");
        err.code = data.error.code;
        throw err;
    }
    return data.result;
}

async function refreshData() {
    const balanceEl = document.getElementById('ui-balance');
    const nonceEl = document.getElementById('ui-nonce');
    const assetBalanceEl = document.getElementById('asset-balance');
    const sendAvailEl = document.getElementById('send-avail');

    try {
        const result = await rpcCall("octra_balance", [currentWallet.address]);
        
        const newBalance = parseFloat(result.balance);
        if (lastBalance !== null && newBalance > lastBalance) {
            const amountReceived = (newBalance - lastBalance).toFixed(6);
            showIncomingNotification(amountReceived);
        }
        lastBalance = newBalance;
        
        currentWallet.balance = result.balance;
        currentWallet.nonce = result.nonce;

        if (balanceEl) balanceEl.innerText = result.balance;
        if (assetBalanceEl) assetBalanceEl.innerText = result.balance;
        if (sendAvailEl) sendAvailEl.innerText = result.balance;
        if (nonceEl) nonceEl.innerText = result.nonce;

    } catch (e) {
        if (e.code === 100 || e.message.includes("sender not found")) {
            currentWallet.balance = "0.000000";
            currentWallet.nonce = 0;
            lastBalance = 0;
            if (balanceEl) balanceEl.innerText = "0.000000";
            if (assetBalanceEl) assetBalanceEl.innerText = "0.000000";
        }
    }
}

function showIncomingNotification(amount) {
    const notif = document.createElement('div');
    notif.className = 'msg-toast';
    notif.style.background = '#87ceeb';
    notif.style.top = '20px';
    notif.innerHTML = `<i class="fa-solid fa-circle-check"></i> Received: +${amount} OCT`;
    
    document.querySelector('.app-wrapper').appendChild(notif);
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
    audio.play().catch(() => {});
    setTimeout(() => {
        notif.remove();
    }, 4000);
}

window.addEventListener('DOMContentLoaded', () => {
    setInterval(() => {
        if (currentWallet.address) {
            refreshData();
        }
    }, 10000); 
});

function exportKeys() {
    const privBase64 = toBase64(nacl.sign.keyPair.fromSeed(currentWallet.privKeyBytes).secretKey);
    alert(`Private Key:\n\n${privBase64}`);
}

function requestFaucet() {
    const msgBox = document.getElementById('tx-msg');
    if(msgBox) {
        msgBox.innerHTML = `
            <div style="background: rgba(88, 166, 255, 0.1); border: 1px solid #58a6ff; padding: 12px; border-radius: 8px; margin-top: 10px;">
                <p style="color: #58a6ff; font-size: 13px; margin: 0 0 8px 0; font-weight: 600;">
                    <i class="fa-solid fa-circle-info"></i> External Faucet
                </p>
                <p style="font-size: 12px; color: #ccc; margin-bottom: 10px; line-height: 1.4;">
                    Please visit the official Octra faucet to claim 10 OCT.
                </p>
                <button onclick="window.open('https://faucet-devnet.octra.com/', '_blank')" 
                        class="btn-primary" 
                        style="width: 100%; padding: 8px; font-size: 12px; background: #238636; border: none;">
                    Open Faucet <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 10px; margin-left: 5px;"></i>
                </button>
            </div>
        `;
    }
    window.open('https://faucet-devnet.octra.com/', '_blank');
}

function revealExportData() {
    document.getElementById('reveal-btn').classList.add('hidden');
    document.getElementById('export-data-container').classList.remove('hidden');
    
    const mnemonicEl = document.getElementById('export-mnemonic');
    if (currentWallet.mnemonic) {
        mnemonicEl.innerText = currentWallet.mnemonic;
        mnemonicEl.style.color = "#fff";
    } else {
        mnemonicEl.innerText = "Not available";
    }
    
    const privBase64 = toBase64(nacl.sign.keyPair.fromSeed(currentWallet.privKeyBytes).secretKey);
    document.getElementById('export-privkey').innerText = privBase64;
}

function logoutWallet() {
    if(confirm("This will clear your local vault. Ensure you have your mnemonic!")) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload(); 
    }
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    if(screenId === 'screen-dashboard') {
        document.querySelectorAll('.nav-item')[0].classList.add('active');
    } else if (screenId === 'screen-history') {
        document.querySelectorAll('.nav-item')[1].classList.add('active');
        loadHistory();
    } else if (screenId === 'screen-settings') {
        document.querySelectorAll('.nav-item')[2].classList.add('active');
    }
    
    if(screenId === 'screen-send') {
        document.getElementById('send-avail').innerText = currentWallet.balance || "0.00";
    }
    
    if(screenId !== 'screen-settings') {
        document.getElementById('export-data-container')?.classList.add('hidden');
        document.getElementById('reveal-btn')?.classList.remove('hidden');
    }

    if(screenId !== 'screen-send' && html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
            document.getElementById('reader').style.display = 'none';
            html5QrcodeScanner = null;
        }).catch(()=>{});
    }
}

function generateQRCode(address) {
    const qrContainer = document.getElementById("qrcode-container");
    qrContainer.innerHTML = ""; 
    
    new QRCode(qrContainer, {
        text: address,
        width: 160,
        height: 160,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}

function copyAddress() {
    const address = currentWallet.address || document.getElementById('full-address').innerText;
    
    if (!address || address === "Loading...") {
        return;
    }

    navigator.clipboard.writeText(address).then(() => {
        const toast = document.getElementById('copy-msg');
        if (toast) {
            toast.classList.remove('hidden');
            setTimeout(() => {
                toast.classList.add('hidden');
            }, 2000);
        } else {
            alert("Address copied: " + address);
        }
    }).catch(err => {});
}

function updateGasFee() {
    const amountStr = document.getElementById('send-amount').value.trim();
    const amountFloat = parseFloat(amountStr) || 0;
    
    const feeMicro = amountFloat < 1000 ? 10000 : 30000; 
    const feeOCT = (feeMicro / MICRO_OCT).toFixed(2);
    
    document.getElementById('send-fee').innerText = feeOCT;
}

function startQRScanner() {
    const reader = document.getElementById('reader');
    
    if (reader.style.display === 'block') {
        if (html5QrcodeScanner) {
            html5QrcodeScanner.stop().then(() => {
                reader.style.display = 'none';
                html5QrcodeScanner = null;
            }).catch(()=>{});
        }
        return;
    }
    
    reader.style.display = 'block';
    html5QrcodeScanner = new Html5Qrcode("reader");
    
    html5QrcodeScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            document.getElementById('send-to').value = decodedText;
            html5QrcodeScanner.stop().then(() => {
                reader.style.display = 'none';
                html5QrcodeScanner = null;
            }).catch(()=>{});
        },
        (error) => {}
    ).catch(err => {
        alert("Camera access failed. Please grant permission.");
        reader.style.display = 'none';
    });
}

function saveHistory(tx) {
    if (!currentWallet.address) return;
    const key = 'octra_history_' + currentWallet.address;
    let history = JSON.parse(localStorage.getItem(key) || '[]');
    history.unshift(tx);
    localStorage.setItem(key, JSON.stringify(history));
}

function loadHistory() {
    const list = document.getElementById('history-list');
    if (!currentWallet.address) return;
    
    const key = 'octra_history_' + currentWallet.address;
    let history = JSON.parse(localStorage.getItem(key) || '[]');
    
    if (history.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:#888; margin-top: 40px;"><i class="fa-solid fa-receipt" style="font-size: 30px; margin-bottom:10px; display:block;"></i>No recent transactions</p>';
        return;
    }

    list.innerHTML = history.map(tx => `
        <div class="asset-item" style="border-bottom: 1px solid #222; padding: 15px 0;">
            <div class="asset-left">
                <div class="asset-icon" style="color: ${tx.status === 'Success' ? '#85ff81' : '#ff7b72'}; background: rgba(20, 241, 149, 0.1);">
                    <i class="fa-solid fa-arrow-up-right-dots"></i>
                </div>
                <div class="asset-info">
                    <strong>Sent OCT</strong>
                    <span style="font-size: 11px; color:#888;">To: ${tx.to.substring(0,6)}...${tx.to.substring(tx.to.length-4)}</span>
                    <span style="font-size: 10px; color:#555;">${tx.date}</span>
                </div>
            </div>
            <div class="asset-right">
                <strong style="color: #fff;">-${tx.amount}</strong>
                <div style="font-size: 10px; color: ${tx.status === 'Success' ? '#85ff81' : '#ff7b72'}; margin-top: 4px;">${tx.status}</div>
            </div>
        </div>
    `).join('');
}

function startAutoRefresh(intervalSeconds = 10) {
    setInterval(() => {
        if (currentWallet.address) {
            refreshData().catch(err => console.error("Auto-refresh error:", err));
        }
    }, intervalSeconds * 1000);
}

window.addEventListener('DOMContentLoaded', () => {
    startAutoRefresh(15);
});
