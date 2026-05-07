const NETWORKS = {
    devnet: {
        name:    "Devnet",
        rpc:     "http://165.227.225.79:8080/rpc",
        explorer:"https://devnet.octrascan.io",
        faucet:  "https://faucet-devnet.octra.com/"
    },
    mainnet: {
        name:    "Mainnet Alpha",
        rpc:     "https://octra.network/rpc",
        explorer:"https://octrascan.io",
        faucet:  null
    }
};
let activeNetwork = localStorage.getItem('octra_network') || 'devnet';
let RPC_URL       = NETWORKS[activeNetwork].rpc;
let EXPLORER_BASE_DYNAMIC = NETWORKS[activeNetwork].explorer;

function switchNetwork(net) {
    if (!NETWORKS[net]) return;
    activeNetwork = net;
    RPC_URL       = NETWORKS[net].rpc;
    EXPLORER_BASE_DYNAMIC = NETWORKS[net].explorer;
    localStorage.setItem('octra_network', net);
    
    const badge = document.getElementById('network-badge-text');
    if (badge) badge.textContent = NETWORKS[net].name;
    const dot = document.getElementById('network-dot');
    if (dot) dot.style.background = net === 'mainnet' ? '#4ade80' : '#87ceeb';
    
    window._explorerBase = NETWORKS[net].explorer;
    
    if (currentWallet.address) refreshData();
}

function getCurrentExplorer() { return EXPLORER_BASE_DYNAMIC; }

const SCANNER_RPC = {
    devnet:  "https://devnet.octrascan.io/rpc",
    mainnet: "https://octrascan.io/rpc"
};
function getScannerRpc() { return SCANNER_RPC[activeNetwork] || SCANNER_RPC.devnet; }

async function scannerRpcCall(method, params = []) {
    const payload = { jsonrpc: "2.0", method, params, id: Math.floor(Math.random() * 10000) };
    const resp    = await fetch(getScannerRpc(), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload)
    });
    const data = await resp.json();
    if (data.error) {
        const err = new Error(data.error.message || "Unknown Error");
        err.code  = data.error.code;
        throw err;
    }
    return data.result;
}

const BASE58_ALPHABET  = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MICRO_OCT        = 1_000_000;
const VAULT_KEY        = "octra_vault_v2";          
const HISTORY_PREFIX   = "octra_history_";

let pendingTx          = null;
let html5QrcodeScanner = null;
let lastBalance        = null;

let currentWallet = {
    index: 0,              
    name: "Account 1",
    mnemonic: null,
    privKeyBytes: null,
    publicKeyBase64: null,
    address: null,
    nonce: 0,
    balance: 0
};

let vault = null;
let vaultPassword = null;

async function mnemonicToSeed(mnemonic, passphrase = "") {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(mnemonic.normalize("NFKD")),
        { name: "PBKDF2" }, false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: enc.encode(("mnemonic" + passphrase).normalize("NFKD")),
            iterations: 2048,
            hash: "SHA-512"
        },
        keyMaterial, 512
    );
    return new Uint8Array(bits); 
}

async function walletFromMnemonic(mnemonic) {
    const seed = await mnemonicToSeed(mnemonic); 

    
    const enc = new TextEncoder();
    const hmacKey = await crypto.subtle.importKey(
        "raw", enc.encode("Octra seed"),
        { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
    );
    const hmacResult = await crypto.subtle.sign("HMAC", hmacKey, seed);
    const masterKey  = new Uint8Array(hmacResult); 

    const privKeyBytes = masterKey.slice(0, 32); 
    const keyPair = nacl.sign.keyPair.fromSeed(privKeyBytes);
    const pubHash = new Uint8Array(sha256.create().update(keyPair.publicKey).array());
    const address = "oct" + base58Encode(pubHash);
    return {
        privKeyBytes,
        publicKeyBase64: toBase64(keyPair.publicKey),
        address
    };
}

// Kang Kode 0xmsr
// Not Official Wallet for testing doang

function encryptVault(vaultObj, password) {
    return CryptoJS.AES.encrypt(JSON.stringify(vaultObj), password).toString();
}

function decryptVault(ciphertext, password) {
    const bytes = CryptoJS.AES.decrypt(ciphertext, password);
    const plain = bytes.toString(CryptoJS.enc.Utf8);
    if (!plain) throw new Error("Bad password");
    return JSON.parse(plain);
}

function persistVault() {
    localStorage.setItem(VAULT_KEY, encryptVault(vault, vaultPassword));
}

async function activateWallet(index) {
    const entry = vault.wallets[index];
    const derived = await walletFromMnemonic(entry.mnemonic);
    currentWallet = {
        index,
        name: entry.name,
        mnemonic: entry.mnemonic,
        ...derived,
        nonce: 0,
        balance: 0
    };
    lastBalance = null;

    
    document.getElementById('ui-addr-short').innerText =
        currentWallet.address.substring(0, 7) + "…" + currentWallet.address.slice(-5);
    document.getElementById('full-address').innerText = currentWallet.address;
    generateQRCode(currentWallet.address);
    renderWalletSelector();
    showScreen('screen-dashboard');
    const currentScreen = document.querySelector('.screen.active')?.id;
    if (currentScreen !== 'screen-dashboard') {
        showScreen('screen-dashboard');
    }
    
    refreshData();
}

function renderWalletSelector() {
    const container = document.getElementById('wallet-selector-bar');
    if (!container || !vault) return;
    container.innerHTML = `
        <div class="wallet-selector-container">
            <select id="wallet-select" onchange="onWalletSwitch(this.value)">
                ${vault.wallets.map((w, i) => `
                    <option value="${i}" ${i === currentWallet.index ? 'selected' : ''}>
                        ${w.name}
                    </option>`).join('')}
            </select>
            <div style="display:flex; gap:8px; margin-top:10px;">
                <button class="btn-small" style="flex:1;" onclick="showScreen('screen-add-wallet')">
                    <i class="fa-solid fa-plus"></i> Add
                </button>
                <button class="btn-small" style="flex:1;" onclick="showRenameModal()">
                    <i class="fa-solid fa-pen"></i> Rename
                </button>
                <button class="btn-small" style="flex:1; color:#ff7b72;" onclick="removeCurrentWallet()">
                    <i class="fa-solid fa-trash"></i> Remove
                </button>
            </div>
        </div>`;
}

async function onWalletSwitch(indexStr) {
    await activateWallet(parseInt(indexStr));
    
    showScreen('screen-dashboard'); 
}

async function addNewWallet() {
    const mode = document.querySelector('input[name="add-mode"]:checked').value;
    const nameInput = document.getElementById('new-wallet-name').value.trim() ||
                      `Account ${vault.wallets.length + 1}`;
    const msgEl = document.getElementById('add-wallet-msg');

    let mnemonic;
    if (mode === 'create') {
        const rw = ethers.Wallet.createRandom();
        mnemonic = rw.mnemonic.phrase;
        
        document.getElementById('new-mnemonic-display').style.display = 'block';
        document.getElementById('new-mnemonic-text').innerText = mnemonic;
    } else {
        mnemonic = document.getElementById('import-mnemonic-new').value.trim();
        if (!mnemonic) {
            msgEl.innerHTML = '<p class="error">Enter a mnemonic phrase.</p>';
            return;
        }
    }

    try {
        vault.wallets.push({ name: nameInput, mnemonic });
        persistVault();
        await activateWallet(vault.wallets.length - 1);
    } catch (e) {
        vault.wallets.pop();
        msgEl.innerHTML = `<p class="error">${e.message}</p>`;
    }
}

function removeCurrentWallet() {
    if (vault.wallets.length <= 1) {
        
        showInfoModal("Cannot remove the last wallet. Use Log Out to clear everything.");
        return;
    }
    document.getElementById('remove-wallet-modal').classList.remove('hidden');
    document.getElementById('remove-wallet-name-label').textContent = currentWallet.name;
    document.getElementById('remove-wallet-pass').value = '';
    document.getElementById('remove-wallet-msg').textContent = '';
}

function confirmRemoveWallet() {
    const pass = document.getElementById('remove-wallet-pass').value;
    const msg  = document.getElementById('remove-wallet-msg');
    if (!pass) { msg.textContent = 'Enter password to confirm.'; msg.style.color='#f87171'; return; }
    const saved = localStorage.getItem(VAULT_KEY);
    try { decryptVault(saved, pass); } catch {
        msg.textContent = 'Wrong password.';
        msg.style.color = '#f87171';
        document.getElementById('remove-wallet-pass').value = '';
        return;
    }
    document.getElementById('remove-wallet-modal').classList.add('hidden');
    vault.wallets.splice(currentWallet.index, 1);
    persistVault();
    activateWallet(0);
}

function cancelRemoveWallet() {
    document.getElementById('remove-wallet-modal').classList.add('hidden');
}

function showInfoModal(msg) {
    document.getElementById('info-modal-text').textContent = msg;
    document.getElementById('info-modal').classList.remove('hidden');
}

function showRenameModal() {
    const name = prompt("New name for this wallet:", currentWallet.name);
    if (!name) return;
    vault.wallets[currentWallet.index].name = name;
    currentWallet.name = name;
    persistVault();
    renderWalletSelector();
}

async function createWallet() {
    const password = document.getElementById('wallet-password').value;
    if (!password) {
        document.getElementById('setup-msg').innerHTML = '<p class="error">Set a password first.</p>';
        return;
    }
    const rw = ethers.Wallet.createRandom();
    const mnemonic = rw.mnemonic.phrase;

    const box  = document.getElementById('mnemonic-display');
    const text = document.getElementById('mnemonic-text');
    if (box && text) { box.style.display = 'block'; text.innerText = mnemonic; }

    await _initVaultAndLoad([{ name: "Account 1", mnemonic }], password);
}

async function importWallet() {
    const phrase   = document.getElementById('import-mnemonic').value.trim();
    const password = document.getElementById('wallet-password').value;
    if (!phrase) {
        document.getElementById('setup-msg').innerHTML = '<p class="error">Enter a mnemonic phrase.</p>';
        return;
    }
    if (!password) {
        document.getElementById('setup-msg').innerHTML = '<p class="error">Set a password first.</p>';
        return;
    }
    await _initVaultAndLoad([{ name: "Account 1", mnemonic: phrase }], password);
}

async function _initVaultAndLoad(wallets, password) {
    vaultPassword = password;
    vault = { wallets };
    try {
        persistVault();
        sessionStorage.setItem('octra_session_pw', password);
        await activateWallet(0);
    } catch (e) {
        document.getElementById('setup-msg').innerHTML = `<p class="error">${e.message}</p>`;
    }
}

let _unlockAttempts = 0;
let _unlockLockedUntil = 0;

function tryUnlockVault() {
    const passEl = document.getElementById('unlock-password');
    const msgEl  = document.getElementById('unlock-msg');
    const pass   = passEl.value;

    
    const now = Date.now();
    if (now < _unlockLockedUntil) {
        const secs = Math.ceil((_unlockLockedUntil - now) / 1000);
        msgEl.innerHTML = `<p class="error"><i class="fa-solid fa-clock"></i> Too many attempts. Wait ${secs}s.</p>`;
        return;
    }

    if (!pass) {
        msgEl.innerHTML = '<p class="error">Enter your password.</p>'; return;
    }

    const saved = localStorage.getItem(VAULT_KEY);
    if (!saved) { showScreen('screen-setup'); return; }

    try {
        vault = decryptVault(saved, pass);
        vaultPassword = pass;
        sessionStorage.setItem('octra_session_pw', pass);
        _unlockAttempts = 0;
        passEl.value = '';
        activateWallet(vault.wallets.length - 1);
    } catch {
        _unlockAttempts++;
        passEl.value = '';
        if (_unlockAttempts >= 3) {
            _unlockLockedUntil = Date.now() + 30000;
            _unlockAttempts = 0;
            msgEl.innerHTML = '<p class="error"><i class="fa-solid fa-lock"></i> Too many wrong attempts. Locked for 30 seconds.</p>';
        } else {
            const left = 3 - _unlockAttempts;
            msgEl.innerHTML = `<p class="error">Wrong password. ${left} attempt${left>1?'s':''} left.</p>`;
        }
    }
}

window.addEventListener('load', () => {
    const saved = localStorage.getItem(VAULT_KEY);
    if (saved) {
        const sessionPw = sessionStorage.getItem('octra_session_pw');
        if (sessionPw) {
            try {
                vault = decryptVault(saved, sessionPw);
                vaultPassword = sessionPw;
                activateWallet(vault.wallets.length - 1);
                return;
            } catch (_) {
                sessionStorage.removeItem('octra_session_pw');
            }
        }
        showScreen('screen-setup');
        document.getElementById('lock-modal-password').value = '';
        document.getElementById('lock-modal-msg').textContent = '';
        document.getElementById('lock-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('lock-modal-password').focus(), 100);
    } else {
        showScreen('screen-setup');
    }
});

let encryptEnabled = false;

function toggleEncrypt() {
    encryptEnabled = !encryptEnabled;
    const knob    = document.getElementById('encrypt-knob');
    const toggle  = document.getElementById('encrypt-toggle');
    const icon    = document.getElementById('encrypt-icon');
    const note    = document.getElementById('encrypt-note');
    const msgArea = document.getElementById('send-message');
    if (encryptEnabled) {
        knob.style.left       = '18px';
        knob.style.background = '#87ceeb';
        toggle.style.background = 'rgba(135,206,235,.2)';
        toggle.style.borderColor = '#87ceeb';
        icon.className  = 'fa-solid fa-lock';
        icon.style.color = '#87ceeb';
        note.style.display = 'block';
        msgArea.style.borderColor = '#87ceeb';
        msgArea.placeholder = 'Message to encrypt (only recipient can read)…';
    } else {
        knob.style.left       = '2px';
        knob.style.background = '#555';
        toggle.style.background = '#2a2a2a';
        toggle.style.borderColor = '#333';
        icon.className  = 'fa-solid fa-unlock';
        icon.style.color = '#555';
        note.style.display = 'none';
        msgArea.style.borderColor = '#333';
        msgArea.placeholder = 'Optional plain text message…';
    }
}

function getBoxKeyPair() {
    return nacl.box.keyPair.fromSecretKey(currentWallet.privKeyBytes);
}

async function fetchRecipientPubKey(address) {
    
    try {
        const res = await rpcCall("octra_getPublicKey", [address]);
        if (res && res.public_key) return res.public_key;
    } catch(_) {}
    
    try {
        const res = await rpcCall("octra_balance", [address]);
        if (res && res.public_key) return res.public_key;
    } catch(_) {}
    return null;
}

async function encryptMessage(plaintext, recipientPubKeyB64) {
    
    
    const recipientPubBytes = Uint8Array.from(atob(recipientPubKeyB64), c => c.charCodeAt(0));
    if (recipientPubBytes.length !== 32) throw new Error("Invalid recipient public key length");

    const senderBoxKP  = getBoxKeyPair();
    const nonce        = nacl.randomBytes(nacl.box.nonceLength);   
    const msgBytes     = new TextEncoder().encode(plaintext);
    const ciphertext   = nacl.box(msgBytes, nonce, recipientPubBytes, senderBoxKP.secretKey);

    
    const packed = new Uint8Array(32 + 24 + ciphertext.length);
    packed.set(senderBoxKP.publicKey, 0);
    packed.set(nonce, 32);
    packed.set(ciphertext, 56);
    return toBase64(packed);
}

function decryptMessage(encryptedDataB64) {
    const packed         = Uint8Array.from(atob(encryptedDataB64), c => c.charCodeAt(0));
    if (packed.length < 72) throw new Error("Encrypted data too short");  
    const senderPubKey   = packed.slice(0, 32);
    const nonce          = packed.slice(32, 56);
    const ciphertext     = packed.slice(56);
    const recipientBoxKP = getBoxKeyPair();
    const decrypted      = nacl.box.open(ciphertext, nonce, senderPubKey, recipientBoxKP.secretKey);
    if (!decrypted) throw new Error("Decryption failed — wrong key or tampered data");
    return new TextDecoder().decode(decrypted);
}

function decryptTxMessage(encB64, rowId) {
    const el = document.getElementById(rowId);
    if (!el) return;
    try {
        const plain = decryptMessage(encB64);
        el.innerHTML = `
            <div style="background:rgba(74,222,128,.07);border:1px solid rgba(74,222,128,.2);
                        border-radius:6px;padding:6px 10px;margin-top:4px;">
                <span style="font-size:9px;color:#4ade80;font-weight:600;display:block;margin-bottom:2px;">
                    <i class="fa-solid fa-lock-open"></i> Decrypted Message
                </span>
                <span style="font-size:12px;color:#e0e0e0;word-break:break-word;">${plain}</span>
            </div>`;
    } catch(e) {
        el.innerHTML = `<span style="font-size:11px;color:#f87171;">
            <i class="fa-solid fa-triangle-exclamation"></i> ${e.message}</span>`;
    }
}

function signChallenge(challenge) {
    const keyPair  = nacl.sign.keyPair.fromSeed(currentWallet.privKeyBytes);
    const msgBytes = new TextEncoder().encode(challenge);
    const sigBytes = nacl.sign.detached(msgBytes, keyPair.secretKey);
    return toBase64(sigBytes);
}

function switchEncTab(tab) {
    const isEnc = tab === 'encrypt';
    document.getElementById('enc-panel-encrypt').style.display = isEnc ? 'block' : 'none';
    document.getElementById('enc-panel-decrypt').style.display = isEnc ? 'none'  : 'block';

    const btnEnc = document.getElementById('enc-tab-encrypt');
    const btnDec = document.getElementById('enc-tab-decrypt');
    btnEnc.style.background  = isEnc ? 'rgba(167,139,250,.15)' : 'transparent';
    btnEnc.style.borderColor = isEnc ? '#a78bfa' : '#333';
    btnEnc.style.color       = isEnc ? '#a78bfa' : '#555';
    btnDec.style.background  = isEnc ? 'transparent' : 'rgba(74,222,128,.12)';
    btnDec.style.borderColor = isEnc ? '#333' : '#4ade80';
    btnDec.style.color       = isEnc ? '#555' : '#4ade80';
}

function updateEncFee() {
    const amt  = parseFloat(document.getElementById('enc-amount')?.value || 0);
    const ouEl = document.getElementById('enc-ou-fee');
    if (ouEl) ouEl.innerText = amt >= 1000 ? '30000' : '10000';
}

async function submitShieldTx(opType, amountFloat, msgElId) {
    const msgEl     = document.getElementById(msgElId);
    const amountRaw = Math.floor(amountFloat * MICRO_OCT).toString();
    const nextNonce = currentWallet.nonce + 1;
    const ouFee     = amountFloat >= 1000 ? "30000" : "10000";

    msgEl.innerHTML = `<p style="color:#87ceeb;font-size:12px;">
        <i class="fa-solid fa-spinner fa-spin"></i> Submitting ${opType}…</p>`;

    try {
        
        const timestamp = parseFloat((Date.now() / 1000).toFixed(3));
        const keyPair   = nacl.sign.keyPair.fromSeed(currentWallet.privKeyBytes);
        
        
        
        

        const BURN_ADDR = "oct" + "1".repeat(44); 

        
        const shieldCandidates = [
            ["from","to_","amount","nonce","op_type","ou","timestamp"],
            ["from","to_","amount","nonce","ou","op_type","timestamp"],
            ["from","to_","amount","nonce","ou","timestamp","op_type"],
            ["from","to_","amount","ou","nonce","op_type","timestamp"],
            ["from","amount","to_","nonce","op_type","ou","timestamp"],
        ];

        let result = null, lastErr = null;
        for (const keys of shieldCandidates) {
            const obj = {
                from:     currentWallet.address,
                to_:      BURN_ADDR,
                amount:   amountRaw,
                nonce:    nextNonce,
                op_type:  opType,
                ou:       ouFee,
                timestamp,
            };
            
            const ordered = {};
            keys.forEach(k => { ordered[k] = obj[k]; });

            const ser = JSON.stringify(ordered, keys);
            const sig = toBase64(nacl.sign.detached(new TextEncoder().encode(ser), keyPair.secretKey));
            const txObj = { ...ordered, signature: sig, public_key: currentWallet.publicKeyBase64 };

            console.log("[OctraWallet] shield TRY order=" + keys.join(",") + "\n  ser=" + ser + "\n  txObj=" + JSON.stringify(txObj));

            try {
                result = await rpcCall("octra_submit", [txObj]);
                console.log("[OctraWallet] SHIELD SUCCESS order=" + keys.join(","));
                break;
            } catch(e) {
                lastErr = e;
                console.warn("[OctraWallet] shield FAIL order=" + keys.join(",") + " code=" + e.code + " err=" + e.message);
                if (e.code !== 101 && e.code !== 108 && e.code !== 105 && e.code !== 109) throw e;
            }
        }
        if (!result) throw lastErr;

        if (result.status === "accepted" || result.tx_hash) {
            const isEnc = opType === "EncryptBalance";
            const color = isEnc ? "#a78bfa" : "#4ade80";
            const icon  = isEnc ? "🔒" : "🔓";
            msgEl.innerHTML = `
                <div style="background:rgba(74,222,128,.07);border:1px solid rgba(74,222,128,.2);
                            border-radius:8px;padding:10px;margin-top:4px;">
                    <div style="font-size:12px;font-weight:600;color:${color};margin-bottom:4px;">
                        ${icon} ${opType} Accepted
                    </div>
                    <div style="font-size:10px;color:#666;">
                        Hash: <span style="color:#aaa;font-family:monospace;">
                        ${(result.tx_hash||'').substring(0,22)}…</span>
                    </div>
                    <div style="font-size:10px;color:#555;margin-top:2px;">
                        Nonce: ${result.nonce||nextNonce} · OU cost: ${result.ou_cost||ouFee}
                    </div>
                </div>`;
            currentWallet.nonce = nextNonce;
            setTimeout(() => loadEncBalanceScreen(), 2500);
            setTimeout(() => refreshData(), 3000);
        } else {
            throw new Error(result.message || result.error || JSON.stringify(result));
        }
    } catch(e) {
        msgEl.innerHTML = `
            <div style="background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.2);
                        border-radius:8px;padding:10px;margin-top:4px;">
                <span style="font-size:12px;color:#f87171;">
                    <i class="fa-solid fa-triangle-exclamation"></i> Failed: ${e.message}
                </span>
            </div>`;
    }
}

async function executeEncryptBalance() {
    const amountFloat = parseFloat(document.getElementById('enc-amount')?.value || '');
    const msgEl       = document.getElementById('enc-msg');
    if (isNaN(amountFloat) || amountFloat <= 0) {
        msgEl.innerHTML = `<p style="color:#f87171;font-size:12px;">Enter a valid amount.</p>`; return;
    }
    if (amountFloat > parseFloat(currentWallet.balance || 0)) {
        msgEl.innerHTML = `<p style="color:#f87171;font-size:12px;">Insufficient public balance.</p>`; return;
    }
    await submitShieldTx("EncryptBalance", amountFloat, "enc-msg");
}

async function executeDecryptBalance() {
    const amountFloat = parseFloat(document.getElementById('dec-amount')?.value || '');
    const msgEl       = document.getElementById('dec-msg');
    if (isNaN(amountFloat) || amountFloat <= 0) {
        msgEl.innerHTML = `<p style="color:#f87171;font-size:12px;">Enter a valid amount.</p>`; return;
    }
    await submitShieldTx("DecryptBalance", amountFloat, "dec-msg");
}

async function loadEncryptedBalance() {
    if (!currentWallet.address) return;

    
    const pubEl   = document.getElementById('enc-pub-balance');
    const availEl = document.getElementById('enc-avail');
    if (pubEl)   pubEl.innerText   = currentWallet.balance || '—';
    if (availEl) availEl.innerText = currentWallet.balance || '—';

    
    let hasEncBalance = false, decryptAllowance = null;
    try {
        const acct        = await rpcCall("octra_balance", [currentWallet.address]);
        hasEncBalance     = acct.has_encrypted_balance || false;
        decryptAllowance  = acct.decrypt_allowance     || null;
        currentWallet.balance = acct.balance;
        if (pubEl)   pubEl.innerText   = acct.balance;
        if (availEl) availEl.innerText = acct.balance;
    } catch(_) {}

    
    const allowEl = document.getElementById('dec-allowance');
    if (allowEl) allowEl.innerText = decryptAllowance
        ? `${(parseInt(decryptAllowance)/MICRO_OCT).toFixed(6)} OCT`
        : '—';

    
    let cipherData = null, cipherType = '—', authOk = false;
    try {
        const sig = signChallenge(`octra_encryptedBalance|${currentWallet.address}`);
        const res = await rpcCall("octra_getEncryptedBalanceAuth",
            [currentWallet.address, sig, currentWallet.publicKeyBase64]);
        cipherData = res.cipher || res.encrypted_balance || null;
        cipherType = res.cipher_type || 'pvac_fhe';
        authOk = true;
        hasEncBalance = hasEncBalance || !!cipherData;
    } catch(_) {}

    if (!cipherData) {
        try {
            const res  = await rpcCall("octra_getEncryptedBalance", [currentWallet.address]);
            cipherData = res.cipher || res.encrypted_balance || null;
            cipherType = res.cipher_type || 'unknown';
            hasEncBalance = hasEncBalance || !!cipherData;
        } catch(_) {}
    }

    
    const privBal    = document.getElementById('enc-priv-balance');
    const privStatus = document.getElementById('enc-priv-status');
    if (privBal) privBal.innerText = hasEncBalance ? '****' : '0';
    if (privStatus) {
        privStatus.innerHTML = hasEncBalance
            ? `<i class="fa-solid fa-lock" style="color:#a78bfa;font-size:11px;"></i>
               <span style="font-size:10px;color:#a78bfa;margin-left:4px;">Shielded · ${cipherType}</span>`
            : `<i class="fa-solid fa-lock-open" style="color:#333;font-size:11px;"></i>
               <span style="font-size:10px;color:#444;margin-left:4px;">No private balance</span>`;
    }

    
    const encStatusEl = document.getElementById('asset-enc-status');
    if (encStatusEl) {
        if (hasEncBalance) {
            encStatusEl.innerHTML = `<i class="fa-solid fa-lock" style="font-size:11px;"></i> Active`;
            encStatusEl.style.color = '#a78bfa';
        } else {
            encStatusEl.innerText  = '—';
            encStatusEl.style.color = '#444';
        }
    }

    
    const statusEl  = document.getElementById('enc-status');
    const container = document.getElementById('enc-balance-container');
    if (statusEl) statusEl.innerHTML = hasEncBalance
        ? `<span style="color:#a78bfa;">${authOk ? '🔏 signed' : '🔒'} ${cipherType}</span>`
        : `<span style="color:#444;">No cipher</span>`;

    if (container) {
        container.innerHTML = cipherData
            ? `<div style="color:#333;word-break:break-all;line-height:1.5;">${cipherData.substring(0,200)}…
               <button onclick="navigator.clipboard.writeText(\`${cipherData.replace(/`/g,"'")}\`)
                   .then(()=>this.innerText='✓ Copied')"
                   style="display:block;margin-top:8px;background:#1a1a1a;border:1px solid #333;
                   color:#666;font-size:10px;padding:4px 10px;border-radius:6px;cursor:pointer;width:auto;">
                   Copy cipher</button></div>`
            : `<span style="color:#2a2a2a;">No cipher data.</span>`;
    }
}

async function loadEncBalanceScreen() {
    await loadEncryptedBalance();

    
    const fheEl = document.getElementById('fhe-pubkey-status');
    if (!fheEl) return;
    let found = false;
    for (const m of ["octra_getPvacPubkey","octra_pvac_pubkey","octra_getFhePubkey"]) {
        try {
            const r = await rpcCall(m, [currentWallet.address]);
            if (r && (r.pvac_pubkey || r.pubkey_blob || r.pubkey)) {
                const sz = r.pubkey_size ? ` (${(r.pubkey_size/1024).toFixed(0)}KB)` : '';
                fheEl.innerHTML = `<span style="color:#4ade80;">FHE key: ✓${sz}</span>`;
                found = true; break;
            }
        } catch(_) {}
    }
    if (!found) fheEl.innerHTML = `<span style="color:#444;">FHE key: not registered</span>`;
}

function sendTransaction() {
    const to          = document.getElementById('send-to').value.trim();
    const amountStr   = document.getElementById('send-amount').value.trim();
    const amountFloat = parseFloat(amountStr);
    const message     = document.getElementById('send-message').value.trim();

    if (!to.startsWith("oct") || to.length !== 47 || isNaN(amountFloat) || amountFloat <= 0) {
        document.getElementById('tx-msg').innerHTML = '<p class="error">Invalid address or amount.</p>';
        return;
    }
    if (to === currentWallet.address) {
        document.getElementById('tx-msg').innerHTML = '<p class="error">Cannot send to yourself.</p>';
        return;
    }
    if (amountFloat > parseFloat(currentWallet.balance || 0)) {
        document.getElementById('tx-msg').innerHTML = '<p class="error">Insufficient balance.</p>';
        return;
    }

    const fee = amountFloat < 1000 ? 0.001 : 0.03;
    pendingTx = { to, amountStr, amountFloat, fee, message, encrypt: encryptEnabled };

    document.getElementById('conf-to').innerText     = to.substring(0, 12) + "...";
    document.getElementById('conf-amount').innerText = amountStr;
    document.getElementById('conf-fee').innerText    = fee;

    
    const msgRow = document.getElementById('conf-message-row');
    if (message) {
        document.getElementById('conf-message-label').innerText = encryptEnabled ? '🔒 Encrypted Message:' : '💬 Message:';
        document.getElementById('conf-message').innerText = encryptEnabled ? `"${message}" (will be encrypted)` : message;
        msgRow.style.display = 'block';
    } else {
        msgRow.style.display = 'none';
    }

    document.getElementById('tx-confirmation-modal').classList.remove('hidden');
}

function closeConfirmModal() {
    document.getElementById('tx-confirmation-modal').classList.add('hidden');
    pendingTx = null;
}

async function executeSend() {
    if (!pendingTx) return;
    const { to, amountStr, amountFloat, message, encrypt } = pendingTx;
    closeConfirmModal();

    const msgBox    = document.getElementById('tx-msg');
    const amountRaw = Math.floor(amountFloat * MICRO_OCT).toString();
    const nextNonce = currentWallet.nonce + 1;
    const ouFee     = amountFloat < 1000 ? "10000" : "30000";

    msgBox.innerHTML = '<p style="color:#87ceeb;"><i class="fa-solid fa-spinner fa-spin"></i> Processing…</p>';

    
    let encryptedData = null;
    let plainMessage  = message || null;

    if (encrypt && message) {
        msgBox.innerHTML = '<p style="color:#87ceeb;"><i class="fa-solid fa-spinner fa-spin"></i> Fetching recipient key…</p>';
        const recipientPubB64 = await fetchRecipientPubKey(to);
        if (!recipientPubB64) {
            msgBox.innerHTML = '<p class="error">Cannot encrypt: recipient has no public key on-chain yet (needs at least 1 confirmed tx).</p>';
            return;
        }
        try {
            encryptedData = await encryptMessage(message, recipientPubB64);
            plainMessage  = null;  
            msgBox.innerHTML = '<p style="color:#87ceeb;"><i class="fa-solid fa-spinner fa-spin"></i> Sending encrypted tx…</p>';
        } catch(e) {
            msgBox.innerHTML = `<p class="error">Encryption failed: ${e.message}</p>`;
            return;
        }
    }

    try {
        
        
        
        const timestamp = parseFloat((Date.now() / 1000).toFixed(3));

        const keyPair  = nacl.sign.keyPair.fromSeed(currentWallet.privKeyBytes);

        
        const signOrdered = (orderedKeys, fields) => {
            const obj = {};
            orderedKeys.forEach(k => { obj[k] = fields[k]; });
            const s = JSON.stringify(obj, orderedKeys);
            console.log("[OctraWallet] trying serialized:", s);
            const sig = nacl.sign.detached(new TextEncoder().encode(s), keyPair.secretKey);
            return { sig: toBase64(sig), serialized: s };
        };

        
        const base = {
            from:      currentWallet.address,
            to_:       to,
            amount:    amountRaw,
            nonce:     nextNonce,
            ou:        ouFee,
            timestamp: timestamp,
        };

        
        const candidates = [
            
            { keys: ["from","to_","amount","nonce","op_type","ou","timestamp"], op: "standard" },
            { keys: ["from","to_","amount","nonce","ou","timestamp","op_type"], op: "standard" },
            { keys: ["from","to_","amount","nonce","ou","op_type","timestamp"], op: "standard" },
            
            { keys: ["from","to_","amount","nonce","op_type","ou","timestamp"], op: "Transfer" },
            { keys: ["from","to_","amount","nonce","ou","timestamp","op_type"], op: "Transfer" },
        ];

        let result = null;
        let lastErr = null;
        for (const { keys, op } of candidates) {
            const fields = { ...base, op_type: op };
            const { sig, serialized: ser } = signOrdered(keys, fields);

            const txObj = {};
            keys.forEach(k => { txObj[k] = fields[k]; });
            txObj["signature"]  = sig;
            txObj["public_key"] = currentWallet.publicKeyBase64;
            if (plainMessage)  txObj["message"]        = plainMessage;
            if (encryptedData) txObj["encrypted_data"] = encryptedData;

            try {
                result = await rpcCall("octra_submit", [txObj]);
                console.log("[OctraWallet] SUCCESS with op_type=" + op + " order=" + keys.join(","));
                console.log("[OctraWallet] winning serialized:", ser);
                break;
            } catch (e) {
                lastErr = e;
                console.warn("[OctraWallet] FAIL op_type=" + op + " order=" + keys.slice(0,4).join(",") + "… err:", e.message);
                if (e.code !== 101) throw e; 
            }
        }
        if (!result) throw lastErr;
        const encIcon = encryptedData ? ' 🔒' : (plainMessage ? ' 💬' : '');
        msgBox.innerHTML = `<p class="success">✓ Accepted${encIcon} Hash: ${(result.tx_hash||'').substring(0,15)}…</p>`;
        currentWallet.nonce = nextNonce;
        saveHistory({
            type: 'sent', to, counterparty: to,
            amount: amountStr, date: new Date().toLocaleString(),
            status: 'Success', hash: result.tx_hash || null,
            message: plainMessage, hasEncrypted: !!encryptedData
        });
        document.getElementById('send-to').value      = '';
        document.getElementById('send-amount').value  = '';
        document.getElementById('send-message').value = '';
        if (encryptEnabled) toggleEncrypt();
        setTimeout(refreshData, 2000);
    } catch (error) {
        msgBox.innerHTML = `<p class="error">Failed: ${error.message}</p>`;
    }
}

async function rpcCall(method, params = []) {
    const payload = { jsonrpc: "2.0", method, params, id: Math.floor(Math.random() * 10000) };
    const resp    = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (data.error) {
        const err = new Error(data.error.message || "Unknown Error");
        err.code  = data.error.code;
        throw err;
    }
    return data.result;
}

async function refreshData() {
    const balanceEl     = document.getElementById('ui-balance');
    const assetBalEl    = document.getElementById('asset-balance');
    const sendAvailEl   = document.getElementById('send-avail');
    const walletNameEl  = document.getElementById('ui-wallet-name');

    if (walletNameEl) walletNameEl.innerText = currentWallet.name;

    try {
        const result     = await rpcCall("octra_balance", [currentWallet.address]);

        
        console.log("[OctraWallet] octra_balance response:", JSON.stringify(result));

        const newBalance = parseFloat(result.balance);

        if (lastBalance !== null && newBalance > lastBalance) {
            const diff = (newBalance - lastBalance).toFixed(6);
            showIncomingNotification(diff);
            
            
        }
        lastBalance = newBalance;

        currentWallet.balance = result.balance;
        currentWallet.nonce   = result.nonce;

        if (balanceEl)   balanceEl.innerText  = result.balance;
        if (assetBalEl)  assetBalEl.innerText = result.balance;
        if (sendAvailEl) sendAvailEl.innerText = result.balance;

        
        const encStatusEl = document.getElementById('asset-enc-status');
        if (encStatusEl) {
            if (result.has_encrypted_balance) {
                encStatusEl.innerHTML = `<i class="fa-solid fa-lock" style="font-size:11px;"></i> Active`;
                encStatusEl.style.color = '#a78bfa';
            } else {
                encStatusEl.innerText = '—';
                encStatusEl.style.color = '#444';
            }
        }

        
        const embeddedTxs = result.transactions || result.txs || result.history || result.data;
        if (Array.isArray(embeddedTxs) && embeddedTxs.length) {
            console.log("[OctraWallet] embedded txs in balance response:", embeddedTxs.length);
        }
    } catch (e) {
        if (e.code === 100 || e.message.includes("sender not found")) {
            currentWallet.balance = "0.000000";
            currentWallet.nonce   = 0;
            lastBalance = 0;
            if (balanceEl)   balanceEl.innerText  = "0.000000";
            if (assetBalEl)  assetBalEl.innerText = "0.000000";
        }
    }
}

function base58Encode(buffer) {
    let n = BigInt("0x" + Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join(''));
    let result = [];
    while (n > 0n) { let r = Number(n % 58n); n = n / 58n; result.push(BASE58_ALPHABET[r]); }
    let leadingZeros = 0;
    for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] !== 0) break;
        leadingZeros++;
    }
    return "1".repeat(leadingZeros) + result.reverse().join('');
}

function toBase64(uint8) {
    let binary = '';
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
    return btoa(binary);
}

function showIncomingNotification(amount) {
    const n = document.createElement('div');
    n.className = 'msg-toast';
    n.style.cssText = 'background:#87ceeb;top:20px;';
    n.innerHTML = `<i class="fa-solid fa-circle-check"></i> Received: +${amount} OCT`;
    document.querySelector('.app-wrapper').appendChild(n);
    new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3').play().catch(() => {});
    setTimeout(() => n.remove(), 4000);
}

function generateQRCode(address) {
    const c = document.getElementById("qrcode-container");
    c.innerHTML = "";
    new QRCode(c, { text: address, width: 160, height: 160, correctLevel: QRCode.CorrectLevel.H });
}

function copyAddress() {
    const addr = currentWallet.address;
    if (!addr) return;
    navigator.clipboard.writeText(addr).then(() => {
        const t = document.getElementById('copy-msg');
        if (t) { t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 2000); }
    }).catch(() => {});
}

function updateGasFee() {
    const v = parseFloat(document.getElementById('send-amount').value) || 0;
    document.getElementById('send-fee').innerText = ((v < 1000 ? 10000 : 30000) / MICRO_OCT).toFixed(2);
}

function requestFaucet() {
    const mb = document.getElementById('tx-msg');
    if (mb) mb.innerHTML = `
        <div style="background:rgba(88,166,255,.1);border:1px solid #58a6ff;padding:12px;border-radius:8px;margin-top:10px;">
            <p style="color:#58a6ff;font-size:13px;margin:0 0 8px;font-weight:600;"><i class="fa-solid fa-circle-info"></i> External Faucet</p>
            <p style="font-size:12px;color:#ccc;margin-bottom:10px;">Visit the official Octra faucet to claim 10 OCT.</p>
            <button onclick="window.open(NETWORKS[activeNetwork].faucet || '#','_blank')" class="btn-primary"
                style="width:100%;padding:8px;font-size:12px;background:#238636;border:none;">
                Open Faucet <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px;margin-left:5px;"></i>
            </button>
        </div>`;
    const faucetUrl = NETWORKS[activeNetwork].faucet;
    if (!faucetUrl) {
        if (mb) mb.innerHTML = '<p style="color:#f87171;font-size:13px;"><i class="fa-solid fa-triangle-exclamation"></i> No faucet available on Mainnet.</p>';
        return;
    }
    window.open(faucetUrl, '_blank');
}

function revealExportData() {
    
    const passEl = document.getElementById('reveal-confirm-pass');
    const msgEl  = document.getElementById('reveal-confirm-msg');
    if (!passEl) return;
    const pass = passEl.value.trim();
    if (!pass) { msgEl.textContent = 'Enter your wallet password first.'; msgEl.style.color='#f87171'; return; }
    
    const saved = localStorage.getItem(VAULT_KEY);
    try {
        decryptVault(saved, pass); 
    } catch {
        msgEl.textContent = 'Wrong password.';
        msgEl.style.color = '#f87171';
        passEl.value = '';
        return;
    }
    passEl.value = '';
    msgEl.textContent = '';
    document.getElementById('reveal-confirm-row').style.display = 'none';
    document.getElementById('reveal-btn').classList.add('hidden');
    document.getElementById('export-data-container').classList.remove('hidden');
    const el = document.getElementById('export-mnemonic');
    el.innerText = currentWallet.mnemonic || "Not available";
    el.style.color = "#fff";
    const kp = nacl.sign.keyPair.fromSeed(currentWallet.privKeyBytes);
    document.getElementById('export-privkey').innerText = toBase64(kp.secretKey);
    document.getElementById('export-algo-info').innerText =
        `Algorithm: Ed25519 | Derivation: BIP39 PBKDF2-HMAC-SHA512 + HMAC("Octra seed")`;
    
    setTimeout(() => {
        document.getElementById('export-data-container')?.classList.add('hidden');
        document.getElementById('reveal-btn')?.classList.remove('hidden');
        document.getElementById('reveal-confirm-row').style.display = 'block';
    }, 60000);
}

function exportAtrcoSession() {
    const pass = document.getElementById('session-export-pass').value.trim();
    if (!pass) { alert('Enter a session password first.'); return; }
    if (!currentWallet.address) { alert('No wallet loaded.'); return; }

    const entry = vault.wallets[currentWallet.index];
    const payload = {
        v:       1,                                    
        address: currentWallet.address,
        pubkey:  currentWallet.publicKeyBase64,
        name:    currentWallet.name || 'Account',
        
        enc:     CryptoJS.AES.encrypt(entry.mnemonic, pass).toString(),
        ts:      Date.now()
    };

    const cipher  = CryptoJS.AES.encrypt(JSON.stringify(payload), pass).toString();
    const b64     = btoa(cipher);
    const token   = 'atrco:' + b64;

    document.getElementById('atrco-string').textContent = token;
    document.getElementById('atrco-output').style.display = 'block';
}

function copyAtrcoSession() {
    const txt = document.getElementById('atrco-string').textContent;
    navigator.clipboard.writeText(txt).then(() => {
        const el = document.getElementById('atrco-string');
        el.style.color = '#3fb950';
        setTimeout(() => el.style.color = '#87ceeb', 1500);
    });
}

function logoutWallet() {
    
    document.getElementById('logout-modal').classList.remove('hidden');
}

function confirmLogout() {
    const typed = document.getElementById('logout-confirm-input').value.trim();
    if (typed !== 'DELETE') {
        document.getElementById('logout-confirm-msg').textContent = 'Type DELETE (all caps) to confirm.';
        return;
    }
    
    sessionStorage.removeItem('octra_session_pw');
    localStorage.removeItem(VAULT_KEY);
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith(HISTORY_PREFIX)) localStorage.removeItem(k);
    });
    location.reload();
}

function cancelLogout() {
    document.getElementById('logout-modal').classList.add('hidden');
    document.getElementById('logout-confirm-input').value = '';
    document.getElementById('logout-confirm-msg').textContent = '';
}

function explorerTxUrl(hash)   { return `${getCurrentExplorer()}/tx.html?hash=${hash}`; }
function explorerAddrUrl(addr) { return `${getCurrentExplorer()}/address.html?addr=${addr}`; }
function openExplorer(url)     { window.open(url, '_blank', 'noopener,noreferrer'); }

function saveHistory(tx) {
    if (!currentWallet.address) return;
    const key = HISTORY_PREFIX + currentWallet.address;
    const h = JSON.parse(localStorage.getItem(key) || '[]');
    if (tx.hash && h.some(t => t.hash === tx.hash)) return; 
    h.unshift(tx);
    if (h.length > 200) h.length = 200;
    localStorage.setItem(key, JSON.stringify(h));
}

async function fetchOnChainHistory(address, limit = 25, offset = 0) {
    window._octraRpcDebug = {};

    
    try {
        const res = await scannerRpcCall("octra_transactionsByAddress", [address, limit, offset]);
        window._octraRpcDebug["octra_transactionsByAddress"] = `✓ scanner`;

        
        const txList = Array.isArray(res) ? res
                     : (res && Array.isArray(res.transactions)) ? res.transactions
                     : (res && Array.isArray(res.data)) ? res.data
                     : null;

        if (txList) {
            window._octraRpcDebug["_count"] = txList.length;
            if (txList.length) console.log("[OctraWallet] scanner tx sample:", JSON.stringify(txList[0]));
            return txList.map(tx => normaliseTx(tx, address));
        }
    } catch(e) {
        window._octraRpcDebug["octra_transactionsByAddress"] = `✗ ${e.message}`;
        console.warn("[OctraWallet] Scanner RPC failed:", e.message);
    }

    
    try {
        const res = await rpcCall("octra_getAddressTransactions", [address, limit, offset]);
        if (res && Array.isArray(res.transactions)) {
            window._octraRpcDebug["octra_getAddressTransactions"] = `✓ ${res.transactions.length} txs (node)`;
            const txs = [...res.transactions, ...(res.rejected || [])];
            return txs.map(tx => normaliseTx(tx, address));
        }
        if (Array.isArray(res)) {
            window._octraRpcDebug["octra_getAddressTransactions"] = `✓ ${res.length} (array, node)`;
            return res.map(tx => normaliseTx(tx, address));
        }
    } catch(e) {
        window._octraRpcDebug["octra_getAddressTransactions"] = `✗ ${e.message}`;
    }

    
    try {
        const res2 = await rpcCall("octra_transactions", [address]);
        if (Array.isArray(res2)) {
            window._octraRpcDebug["octra_transactions"] = `✓ ${res2.length}`;
            return res2.map(tx => normaliseTx(tx, address));
        }
    } catch(e2) {
        window._octraRpcDebug["octra_transactions"] = `✗ ${e2.message}`;
    }

    return [];
}

function normaliseTx(tx, address) {
    const hash = tx.tx_hash || tx.hash || tx._hash || null;

    if (tx._noDetail) {
        return { type:'unknown', counterparty:'', amount:'0.000000',
                 date: tx._epoch ? `Epoch ${tx._epoch}` : '—',
                 status:'Success', hash, source:'chain', _raw: tx };
    }

    const fromAddr     = tx.from || tx.sender || "";
    const toAddr       = tx.to_  || tx.to     || tx.recipient || "";
    const isSender     = fromAddr === address;
    const counterparty = isSender ? toAddr : fromAddr;

    
    let amount;
    const amtStr = String(tx.amount || tx.amount_raw || 0);
    if (amtStr.includes('.')) {
        amount = parseFloat(amtStr).toFixed(6);                  
    } else {
        amount = (parseInt(amtStr, 10) / MICRO_OCT).toFixed(6);  
    }

    let date = '—';
    if (tx.timestamp) {
        date = new Date(tx.timestamp > 1e12 ? tx.timestamp : tx.timestamp * 1000).toLocaleString();
    } else if (tx._epoch || tx.epoch) {
        date = `Epoch ${tx._epoch || tx.epoch}`;
    }

    const rawSt  = (tx.status || "").toLowerCase();
    const status = rawSt === "failed" ? "Failed" : rawSt === "pending" ? "Pending" : "Success";

    return {
        type:           isSender ? "sent" : "received",
        counterparty,   amount,   date,   status,   hash,
        message:        tx.message        || null,
        encrypted_data: tx.encrypted_data || null,
        source:         "chain",
        _raw:           tx
    };
}

function mergeHistory(local, onChain) {
    const seen = new Set();
    const out  = [];
    const push = tx => {
        const k = tx.hash || `${tx.date}|${tx.amount}|${tx.counterparty || ''}`;
        if (!seen.has(k)) { seen.add(k); out.push(tx); }
    };
    onChain.forEach(push);
    local.forEach(push);
    return out;
}

function copyHash(hash) {
    navigator.clipboard.writeText(hash).then(() => {
        
        const el = document.getElementById('hash-' + hash.substring(0, 10));
        if (el) {
            const orig = el.innerHTML;
            el.innerHTML = '<i class="fa-solid fa-check" style="color:#85ff81;margin-right:3px;"></i>Copied!';
            el.style.color = '#85ff81';
            setTimeout(() => { el.innerHTML = orig; el.style.color = ''; }, 1500);
        }
    }).catch(() => {});
}

function renderTxRow(tx) {
    const isReceived  = tx.type === "received";

    
    const accentColor = isReceived ? '#4ade80' : '#87ceeb';
    const iconClass   = isReceived ? 'fa-arrow-down-left' : 'fa-arrow-up-right';
    const iconBg      = isReceived ? 'rgba(74,222,128,.10)' : 'rgba(135,206,235,.08)';
    const iconBorder  = isReceived ? 'rgba(74,222,128,.30)' : 'rgba(135,206,235,.20)';
    const amountColor = isReceived ? '#4ade80'  : '#f8f8f8';
    const amountBg    = isReceived ? 'rgba(74,222,128,.08)' : 'transparent';
    const sign        = isReceived ? '+' : '−';
    const statusColor = tx.status === 'Success' ? '#4ade80'
                      : tx.status === 'Pending'  ? '#fbbf24' : '#f87171';

    
    const cp      = tx.counterparty || tx.to || '—';
    const cpShort = cp.length > 16
        ? cp.substring(0, 9) + '…' + cp.slice(-5)
        : cp;

    
    const badge = tx.source === 'chain'
        ? `<span style="font-size:9px;color:#87ceeb;background:rgba(135,206,235,.1);
                        padding:1px 6px;border-radius:20px;font-weight:600;letter-spacing:.3px;">
               CHAIN
           </span>` : '';

    
    const rawMsg  = tx.message || null;
    const encData = tx.encrypted_data || null;
    const hasEnc  = tx.hasEncrypted || !!encData;
    const decId   = tx.hash ? 'dec-' + tx.hash.substring(0, 12) : null;

    let msgBlock = '';
    if (rawMsg) {
        msgBlock = `
            <div style="background:rgba(255,255,255,.04);border:1px solid #2a2a2a;border-radius:6px;
                        padding:5px 8px;margin-top:5px;">
                <span style="font-size:9px;color:#888;font-weight:600;display:block;margin-bottom:1px;">
                    <i class="fa-solid fa-message"></i> Message
                </span>
                <span style="font-size:12px;color:#ccc;word-break:break-word;">${rawMsg}</span>
            </div>`;
    } else if (encData && !isReceived) {
        
        msgBlock = `
            <div style="display:inline-flex;align-items:center;gap:4px;margin-top:5px;
                        background:rgba(135,206,235,.06);border:1px solid rgba(135,206,235,.15);
                        padding:3px 8px;border-radius:6px;">
                <i class="fa-solid fa-lock" style="color:#87ceeb;font-size:10px;"></i>
                <span style="font-size:10px;color:#87ceeb;">Encrypted message sent</span>
            </div>`;
    } else if (encData && isReceived && decId) {
        
        msgBlock = `
            <div style="margin-top:5px;">
                <button onclick="decryptTxMessage('${encData}','${decId}')"
                        style="background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.25);
                               color:#4ade80;font-size:10px;padding:4px 10px;border-radius:6px;
                               cursor:pointer;width:auto;display:inline-flex;align-items:center;
                               gap:5px;font-weight:600;">
                    <i class="fa-solid fa-lock-open"></i> Decrypt Message
                </button>
                <div id="${decId}" style="margin-top:4px;"></div>
            </div>`;
    } else if (hasEnc && isReceived) {
        msgBlock = `
            <div style="display:inline-flex;align-items:center;gap:4px;margin-top:5px;
                        background:rgba(74,222,128,.06);border:1px solid rgba(74,222,128,.15);
                        padding:3px 8px;border-radius:6px;">
                <i class="fa-solid fa-lock" style="color:#4ade80;font-size:10px;"></i>
                <span style="font-size:10px;color:#4ade80;">Contains encrypted message</span>
            </div>`;
    }
    const hashId = tx.hash ? 'hash-' + tx.hash.substring(0, 10) : '';
    const hashRow = tx.hash ? `
        <div style="display:flex;align-items:center;gap:6px;margin-top:5px;flex-wrap:wrap;">
            <span id="${hashId}"
                  onclick="copyHash('${tx.hash}')"
                  title="Click to copy full hash"
                  style="font-size:9.5px;color:#666;font-family:monospace;cursor:pointer;
                         background:#1a1a1a;padding:2px 7px;border-radius:4px;
                         border:1px solid #2a2a2a;transition:.15s;
                         display:inline-flex;align-items:center;gap:4px;user-select:none;"
                  onmouseover="this.style.color='#87ceeb';this.style.borderColor='#87ceeb44'"
                  onmouseout="this.style.color='#666';this.style.borderColor='#2a2a2a'">
                <i class="fa-regular fa-copy" style="font-size:8px;"></i>
                ${tx.hash.substring(0, 8)}…${tx.hash.slice(-6)}
            </span>
            <a href="${explorerTxUrl(tx.hash)}" target="_blank" rel="noopener noreferrer"
               title="View on OctraScan"
               style="font-size:9.5px;color:#87ceeb;background:rgba(135,206,235,.08);
                      padding:2px 7px;border-radius:4px;border:1px solid rgba(135,206,235,.2);
                      text-decoration:none;display:inline-flex;align-items:center;gap:3px;
                      transition:.15s;font-weight:600;"
               onmouseover="this.style.background='rgba(135,206,235,.18)'"
               onmouseout="this.style.background='rgba(135,206,235,.08)'">
                <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:8px;"></i>
                Explorer
            </a>
        </div>` : `<div style="font-size:9px;color:#333;margin-top:4px;font-style:italic;">no hash</div>`;

    
    const amountBlock = `
        <div style="background:${amountBg};border-radius:8px;padding:${isReceived?'5px 8px':'0'};
                    text-align:right;display:inline-block;min-width:90px;">
            <div style="font-size:17px;font-weight:800;color:${amountColor};
                        letter-spacing:-.3px;line-height:1.1;">
                ${sign}${tx.amount}
            </div>
            <div style="font-size:10px;color:${isReceived?'#4ade8099':'#555'};font-weight:500;margin-top:1px;">OCT</div>
        </div>`;

    return `
        <div style="border-bottom:1px solid #161616;padding:14px 0;transition:.15s;"
             onmouseover="this.style.background='#0d0d0d'"
             onmouseout="this.style.background='transparent'">
            <div style="display:flex;align-items:flex-start;gap:12px;">

                <!-- icon -->
                <div style="width:40px;height:40px;border-radius:50%;background:${iconBg};
                            border:1px solid ${iconBorder};display:flex;align-items:center;
                            justify-content:center;color:${accentColor};flex-shrink:0;margin-top:2px;
                            font-size:15px;">
                    <i class="fa-solid ${iconClass}"></i>
                </div>

                <!-- left: label + meta -->
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap;">
                        <strong style="font-size:14px;color:${accentColor};">
                            ${isReceived ? '⬇ Received' : '⬆ Sent'}
                        </strong>
                        ${badge}
                        <span style="font-size:10px;color:${statusColor};font-weight:600;">${tx.status}</span>
                    </div>
                    <div style="font-size:11px;color:#777;overflow:hidden;text-overflow:ellipsis;
                                white-space:nowrap;max-width:170px;" title="${cp}">
                        ${isReceived ? '📤 From' : '📥 To'}: <span style="color:#aaa;">${cpShort}</span>
                    </div>
                    <div style="font-size:10px;color:#444;margin-top:2px;">${tx.date}</div>
                    ${hashRow}
                    ${msgBlock}
                </div>

                <!-- right: amount -->
                <div style="flex-shrink:0;margin-top:2px;">
                    ${amountBlock}
                </div>

            </div>
        </div>`;
}

async function loadHistory() {
    const list = document.getElementById('history-list');
    if (!currentWallet.address) return;

    list.innerHTML = `<div style="text-align:center;color:#888;padding:40px 0;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size:26px;display:block;margin-bottom:12px;color:#87ceeb;"></i>
        Loading transactions…</div>`;

    const addrUrl    = explorerAddrUrl(currentWallet.address);
    const headerHtml = `
        <div style="display:flex;justify-content:space-between;align-items:center;
                    margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #222;">
            <span style="font-size:13px;font-weight:600;color:#ccc;">
                <i class="fa-solid fa-clock-rotate-left" style="color:#87ceeb;margin-right:6px;"></i>Transactions
            </span>
            <button onclick="openExplorer('${addrUrl}')"
                    style="background:rgba(135,206,235,.1);border:1px solid rgba(135,206,235,.3);
                           color:#87ceeb;font-size:11px;padding:5px 10px;border-radius:8px;
                           cursor:pointer;width:auto;display:flex;align-items:center;gap:5px;font-weight:600;">
                <i class="fa-solid fa-up-right-from-square"></i> OctraScan
            </button>
        </div>`;

    const allLocal = JSON.parse(localStorage.getItem(HISTORY_PREFIX + currentWallet.address) || '[]');
    
    const localTxs = allLocal.filter(tx => tx.hash || tx.type === 'sent');
    let onChainTxs = [], fetchError = null, rawSample = null;
    try {
        onChainTxs = await fetchOnChainHistory(currentWallet.address);
        if (onChainTxs.length) rawSample = onChainTxs[0]._raw;
        for (const tx of onChainTxs) saveHistory(tx);
    } catch(e) { fetchError = e.message; }

    const merged = mergeHistory(localTxs, onChainTxs);

    
    const rpcDebug = window._octraRpcDebug || {};
    const rpcRows  = Object.entries(rpcDebug).map(([m, v]) =>
        `<tr>
            <td style="color:#666;padding:2px 6px 2px 0;font-family:monospace;">${m}</td>
            <td style="color:${v.startsWith('✓')?'#4ade80':'#f87171'};padding:2px 0;">${v}</td>
        </tr>`).join('');
    const rawBlock = rawSample
        ? `<pre style="color:#87ceeb;margin:8px 0 0;overflow-x:auto;white-space:pre-wrap;
                       word-break:break-all;font-size:9px;line-height:1.5;">${
               JSON.stringify(rawSample, null, 2)}</pre>` : '';
    const debugPanel = `
        <details style="margin-bottom:10px;background:#0a0a0a;border:1px solid #1e1e1e;
                        border-radius:8px;padding:8px 10px;">
            <summary style="cursor:pointer;color:#444;font-size:10px;font-weight:600;
                            list-style:none;display:flex;align-items:center;gap:6px;">
                <i class="fa-solid fa-bug" style="color:#555;"></i>
                RPC debug · ${onChainTxs.length} on-chain · scanner: ${getScannerRpc().replace("https://","")}
                ${fetchError ? `<span style="color:#f87171;">(err: ${fetchError})</span>` : ''}
            </summary>
            <table style="width:100%;margin-top:8px;font-size:9.5px;border-collapse:collapse;">
                ${rpcRows}
            </table>
            ${rawBlock}
        </details>`;

    if (!merged.length) {
        list.innerHTML = headerHtml + debugPanel + `
            <div style="text-align:center;color:#888;padding:30px 0;">
                <i class="fa-solid fa-receipt" style="font-size:32px;display:block;margin-bottom:12px;color:#333;"></i>
                No transactions yet
                ${fetchError ? `<p style="font-size:11px;color:#555;margin-top:8px;">On-chain error: ${fetchError}</p>` : ''}
                <button onclick="openExplorer('${addrUrl}')"
                        style="margin-top:16px;background:rgba(135,206,235,.1);border:1px solid rgba(135,206,235,.3);
                               color:#87ceeb;font-size:12px;padding:8px 16px;border-radius:10px;cursor:pointer;width:auto;">
                    <i class="fa-solid fa-up-right-from-square"></i> View on OctraScan
                </button>
            </div>`;
        return;
    }

    const metaLine = onChainTxs.length
        ? `<p style="font-size:10px;color:#555;text-align:right;margin:0 0 6px;">
               <i class="fa-solid fa-link" style="color:#87ceeb;margin-right:3px;"></i>
               ${onChainTxs.length} on-chain · ${merged.length} total</p>`
        : fetchError
            ? `<p style="font-size:10px;color:#f1c40f;text-align:right;margin:0 0 6px;">
                   <i class="fa-solid fa-triangle-exclamation"></i> Showing cached only</p>` : '';

    list.innerHTML = headerHtml + metaLine + debugPanel + merged.map(renderTxRow).join('');
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (id === 'screen-dashboard') { document.querySelectorAll('.nav-item')[0].classList.add('active'); renderWalletSelector(); }
    else if (id === 'screen-history')     { document.querySelectorAll('.nav-item')[1].classList.add('active'); loadHistory().catch(()=>{}); }
    else if (id === 'screen-nft')         { document.querySelectorAll('.nav-item')[2].classList.add('active'); nftRefreshState().catch(() => {}); }
    else if (id === 'screen-settings')    { document.querySelectorAll('.nav-item')[3].classList.add('active'); }
    else if (id === 'screen-enc-balance') { loadEncBalanceScreen().catch(()=>{}); }
    if (id === 'screen-send') document.getElementById('send-avail').innerText = currentWallet.balance || "0.00";
    if (id !== 'screen-settings') {
        document.getElementById('export-data-container')?.classList.add('hidden');
        document.getElementById('reveal-btn')?.classList.remove('hidden');
    }
    if (id !== 'screen-send' && html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
            document.getElementById('reader').style.display = 'none';
            html5QrcodeScanner = null;
        }).catch(() => {});
    }
    
    if (id === 'screen-add-wallet') {
        document.getElementById('add-wallet-msg').innerHTML = '';
        document.getElementById('new-wallet-name').value = '';
        document.getElementById('import-mnemonic-new').value = '';
        document.getElementById('new-mnemonic-display').style.display = 'none';
    }
}

function startQRScanner() {
    const reader = document.getElementById('reader');
    if (reader.style.display === 'block') {
        html5QrcodeScanner?.stop().then(() => { reader.style.display = 'none'; html5QrcodeScanner = null; }).catch(() => {});
        return;
    }
    reader.style.display = 'block';
    html5QrcodeScanner = new Html5Qrcode("reader");
    html5QrcodeScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (text) => {
            document.getElementById('send-to').value = text;
            html5QrcodeScanner.stop().then(() => { reader.style.display = 'none'; html5QrcodeScanner = null; }).catch(() => {});
        },
        () => {}
    ).catch(() => { alert("Camera access failed."); reader.style.display = 'none'; });
}

const nftState = {
    name:            "SpectrumNFT",
    symbol:          "SPEC",
    totalSupply:     0,
    tokens:          {},   
    balances:        {},   
    approvals:       {},   
    operatorApprovals: {} 
};
let nftOpApproved = true; 

const NFT_CONTRACT_ADDR = null; 

function nftMsg(elId, html) {
    const el = document.getElementById(elId);
    if (el) el.innerHTML = html;
}

function nftSpinner(elId) {
    nftMsg(elId, `<p style="color:#87ceeb;font-size:12px;">
        <i class="fa-solid fa-spinner fa-spin"></i> Processing…</p>`);
}

function nftSuccess(elId, text) {
    nftMsg(elId, `<div style="background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.2);
        border-radius:8px;padding:10px;margin-top:4px;font-size:12px;color:#4ade80;">
        <i class="fa-solid fa-circle-check" style="margin-right:5px;"></i>${text}</div>`);
}

function nftError(elId, text) {
    nftMsg(elId, `<div style="background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.2);
        border-radius:8px;padding:10px;margin-top:4px;font-size:12px;color:#f87171;">
        <i class="fa-solid fa-triangle-exclamation" style="margin-right:5px;"></i>${text}</div>`);
}

function nftRequireWallet(elId) {
    if (!currentWallet.address) {
        nftError(elId, "Unlock your wallet first.");
        return false;
    }
    return true;
}

function nftShortAddr(addr) {
    if (!addr || addr.length < 10) return addr || "—";
    return addr.slice(0, 8) + "…" + addr.slice(-5);
}

async function nftBuildAndSubmit(method, params, msgElId) {
    if (!currentWallet.address) throw new Error("Wallet not unlocked.");
    nftSpinner(msgElId);

    const amountRaw  = "0";
    const nextNonce  = currentWallet.nonce + 1;
    const ouFee      = "10000";
    const timestamp  = parseFloat((Date.now() / 1000).toFixed(3));
    const keyPair    = nacl.sign.keyPair.fromSeed(currentWallet.privKeyBytes);
    const contractAddr = NFT_CONTRACT_ADDR || "oct" + "1".repeat(44); 

    const contractPayload = JSON.stringify({ contract: contractAddr, method, params });

    
    const candidates = [
        ["from","to_","amount","nonce","op_type","ou","timestamp","data"],
        ["from","to_","amount","nonce","op_type","ou","data","timestamp"],
        ["from","to_","amount","nonce","ou","op_type","timestamp","data"],
        ["from","to_","amount","nonce","op_type","data","ou","timestamp"],
        ["from","to_","amount","nonce","ou","timestamp","op_type","data"],
    ];

    const base = {
        from:     currentWallet.address,
        to_:      contractAddr,
        amount:   amountRaw,
        nonce:    nextNonce,
        op_type:  "ContractCall",
        ou:       ouFee,
        timestamp,
        data:     contractPayload,
    };

    let result = null, lastErr = null;
    for (const keys of candidates) {
        const ordered = {};
        keys.forEach(k => { if (base[k] !== undefined) ordered[k] = base[k]; });
        const ser = JSON.stringify(ordered, Object.keys(ordered));
        const sig = toBase64(nacl.sign.detached(new TextEncoder().encode(ser), keyPair.secretKey));
        const txObj = { ...ordered, signature: sig, public_key: currentWallet.publicKeyBase64 };

        console.log("[SpectrumNFT] TRY", method, "order=" + keys.join(","));
        try {
            result = await rpcCall("octra_submit", [txObj]);
            console.log("[SpectrumNFT] SUCCESS", method, result);
            currentWallet.nonce = nextNonce;
            break;
        } catch(e) {
            lastErr = e;
            console.warn("[SpectrumNFT] FAIL", method, e.message);
            
            if (e.code !== 101 && e.code !== 108 && e.code !== 105) throw e;
        }
    }
    if (!result) throw lastErr;
    return result;
}

async function nftCallView(method, params) {
    
    try {
        const contractAddr = NFT_CONTRACT_ADDR || "oct" + "1".repeat(44);
        return await rpcCall("octra_callContract", [{ contract: contractAddr, method, params }]);
    } catch(e) {
        
        return null;
    }
}

async function nftRefreshState() {
    document.getElementById('nft-stat-supply').innerHTML =
        `<i class="fa-solid fa-spinner fa-spin" style="font-size:14px;"></i>`;

    
    let supply = nftState.totalSupply;
    let balance = currentWallet.address ? (nftState.balances[currentWallet.address] || 0) : 0;
    let name = nftState.name, symbol = nftState.symbol;

    try {
        const r = await nftCallView("total_supply", []);
        if (r !== null && r !== undefined) supply = r;
    } catch(_) {}
    try {
        if (currentWallet.address) {
            const r = await nftCallView("balance_of", [currentWallet.address]);
            if (r !== null && r !== undefined) balance = r;
        }
    } catch(_) {}
    try {
        const rn = await nftCallView("get_name", []);
        if (rn) name = rn;
        const rs = await nftCallView("get_symbol", []);
        if (rs) symbol = rs;
    } catch(_) {}

    document.getElementById('nft-stat-supply').textContent = supply;
    document.getElementById('nft-stat-balance').textContent = balance;
    document.getElementById('nft-contract-name').textContent = name;
    document.getElementById('nft-contract-symbol').textContent = `[${symbol}]`;
    document.getElementById('nft-contract-addr').textContent =
        NFT_CONTRACT_ADDR ? nftShortAddr(NFT_CONTRACT_ADDR) : "Local (not deployed)";
}

async function nftMint() {
    if (!nftRequireWallet('nft-mint-msg')) return;

    const to         = document.getElementById('nft-mint-to').value.trim() || currentWallet.address;
    const collection = document.getElementById('nft-mint-collection').value.trim();
    const uri        = document.getElementById('nft-mint-uri').value.trim();
    const royalty    = parseInt(document.getElementById('nft-mint-royalty').value) || 0;

    if (!collection) return nftError('nft-mint-msg', "Collection name is required.");
    if (!uri)        return nftError('nft-mint-msg', "Metadata URI is required.");
    if (royalty < 0 || royalty > 1000) return nftError('nft-mint-msg', "Royalty must be 0–1000 BPS.");

    nftSpinner('nft-mint-msg');

    
    const id = nftState.totalSupply;
    nftState.tokens[id] = {
        owner: to, creator: currentWallet.address,
        collection, metadata_uri: uri,
        royalty_bps: royalty, minted_epoch: Date.now()
    };
    nftState.balances[to] = (nftState.balances[to] || 0) + 1;
    nftState.totalSupply++;

    
    if (NFT_CONTRACT_ADDR) {
        try {
            const res = await nftBuildAndSubmit("mint", [to, collection, uri, royalty], 'nft-mint-msg');
            nftSuccess('nft-mint-msg',
                `✦ Minted! Token #${id}<br>
                 <span style="font-size:10px;color:#aaa;">Hash: ${(res.tx_hash||'').slice(0,18)}…</span>`);
        } catch(e) {
            nftError('nft-mint-msg', `On-chain failed: ${e.message} (local state updated)`);
        }
    } else {
        
        await new Promise(r => setTimeout(r, 600));
        nftSuccess('nft-mint-msg',
            `✦ Minted locally! Token #${id}<br>
             <span style="font-size:10px;color:#aaa;">Collection: ${collection} · Royalty: ${royalty} BPS</span>`);
    }

    nftRefreshState();
}

async function nftQuery() {
    if (!nftRequireWallet('nft-query-result')) return;

    const id = parseInt(document.getElementById('nft-query-id').value);
    if (isNaN(id) || id < 0) {
        document.getElementById('nft-query-result').style.display = 'block';
        document.getElementById('nft-query-result').innerHTML =
            `<span style="color:#f87171;font-size:12px;">Invalid token ID.</span>`;
        return;
    }

    const resultEl = document.getElementById('nft-query-result');
    resultEl.style.display = 'block';
    resultEl.innerHTML = `<span style="color:#87ceeb;font-size:12px;">
        <i class="fa-solid fa-spinner fa-spin"></i> Querying…</span>`;

    let token = nftState.tokens[id] || null;
    let approved = nftState.approvals[id] || null;

    
    if (NFT_CONTRACT_ADDR) {
        try {
            const r = await nftCallView("get_owner", [id]);
            if (r && !token) token = { owner: r };
            if (r && token)  token.owner = r;
        } catch(_) {}
        try {
            const r = await nftCallView("get_collection", [id]);
            if (r && token) token.collection = r;
        } catch(_) {}
        try {
            const r = await nftCallView("get_creator", [id]);
            if (r && token) token.creator = r;
        } catch(_) {}
        try {
            const r = await nftCallView("get_token_uri", [id]);
            if (r && token) token.metadata_uri = r;
        } catch(_) {}
        try {
            const r = await nftCallView("get_royalty", [id]);
            if (r !== null && token) token.royalty_bps = r;
        } catch(_) {}
        try {
            approved = await nftCallView("get_approved", [id]);
        } catch(_) {}
    }

    if (!token) {
        resultEl.innerHTML = `<span style="color:#f87171;font-size:12px;">
            Token #${id} not found.</span>`;
        return;
    }

    const rows = [
        ["Token ID",    `#${id}`],
        ["Owner",       nftShortAddr(token.owner)],
        ["Creator",     nftShortAddr(token.creator || '—')],
        ["Collection",  token.collection || '—'],
        ["Metadata URI",token.metadata_uri || '—'],
        ["Royalty",     token.royalty_bps !== undefined ? `${token.royalty_bps} BPS (${(token.royalty_bps/100).toFixed(1)}%)` : '—'],
        ["Approved",    nftShortAddr(approved || '—')],
    ];

    resultEl.innerHTML = rows.map(([k,v]) => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;
                    border-bottom:1px solid #1a1a1a;font-size:11px;">
            <span style="color:#555;">${k}</span>
            <span style="color:#ccc;text-align:right;max-width:160px;word-break:break-all;">${v}</span>
        </div>`).join('');
}

async function nftBalanceOf() {
    const addr = document.getElementById('nft-balance-addr').value.trim() || currentWallet.address;
    const resEl = document.getElementById('nft-balance-result');
    if (!addr) { resEl.innerHTML = `<span style="color:#f87171;">Enter an address.</span>`; return; }

    let bal = nftState.balances[addr] || 0;
    if (NFT_CONTRACT_ADDR) {
        try {
            const r = await nftCallView("balance_of", [addr]);
            if (r !== null) bal = r;
        } catch(_) {}
    }
    resEl.innerHTML = `<span style="color:#87ceeb;font-weight:700;">${bal}</span>
        <span style="color:#555;"> token(s) owned by </span>
        <span style="color:#888;font-family:monospace;font-size:11px;">${nftShortAddr(addr)}</span>`;
}

async function nftTransfer() {
    if (!nftRequireWallet('nft-transfer-msg')) return;

    const to = document.getElementById('nft-trans-to').value.trim();
    const id = parseInt(document.getElementById('nft-trans-id').value);

    if (!to.startsWith("oct")) return nftError('nft-transfer-msg', "Invalid recipient address.");
    if (isNaN(id) || id < 0)   return nftError('nft-transfer-msg', "Invalid token ID.");

    const token = nftState.tokens[id];
    if (token && token.owner !== currentWallet.address)
        return nftError('nft-transfer-msg', "You do not own this token.");

    nftSpinner('nft-transfer-msg');

    
    if (token) {
        nftState.balances[token.owner] = Math.max(0, (nftState.balances[token.owner] || 1) - 1);
        nftState.balances[to] = (nftState.balances[to] || 0) + 1;
        nftState.approvals[id] = token.owner;
        nftState.tokens[id].owner = to;
    }

    if (NFT_CONTRACT_ADDR) {
        try {
            const res = await nftBuildAndSubmit("transfer", [to, id], 'nft-transfer-msg');
            nftSuccess('nft-transfer-msg',
                `→ Token #${id} transferred!<br>
                 <span style="font-size:10px;color:#aaa;">To: ${nftShortAddr(to)} · Hash: ${(res.tx_hash||'').slice(0,16)}…</span>`);
        } catch(e) {
            nftError('nft-transfer-msg', `On-chain failed: ${e.message}`);
        }
    } else {
        await new Promise(r => setTimeout(r, 500));
        nftSuccess('nft-transfer-msg', `→ Token #${id} transferred to ${nftShortAddr(to)} (local)`);
    }
    nftRefreshState();
}

async function nftApprove() {
    if (!nftRequireWallet('nft-transfer-msg')) return;
    const addr = document.getElementById('nft-approve-addr').value.trim();
    const id   = parseInt(document.getElementById('nft-approve-id').value);

    if (!addr.startsWith("oct")) return nftError('nft-transfer-msg', "Invalid address.");
    if (isNaN(id) || id < 0)     return nftError('nft-transfer-msg', "Invalid token ID.");

    const token = nftState.tokens[id];
    if (token && token.owner !== currentWallet.address)
        return nftError('nft-transfer-msg', "You do not own this token.");

    nftState.approvals[id] = addr;

    if (NFT_CONTRACT_ADDR) {
        try {
            const res = await nftBuildAndSubmit("approve", [addr, id], 'nft-transfer-msg');
            nftSuccess('nft-transfer-msg',
                `✓ Approved ${nftShortAddr(addr)} for #${id}<br>
                 <span style="font-size:10px;color:#aaa;">Hash: ${(res.tx_hash||'').slice(0,16)}…</span>`);
        } catch(e) {
            nftError('nft-transfer-msg', `On-chain failed: ${e.message}`);
        }
    } else {
        await new Promise(r => setTimeout(r, 400));
        nftSuccess('nft-transfer-msg', `✓ Approved ${nftShortAddr(addr)} for token #${id} (local)`);
    }
}

function nftOpToggle(yes) {
    nftOpApproved = yes;
    document.getElementById('nft-op-yes').style.background = yes ? 'rgba(74,222,128,.25)' : 'transparent';
    document.getElementById('nft-op-yes').style.borderColor = yes ? '#4ade80' : '#333';
    document.getElementById('nft-op-yes').style.color = yes ? '#4ade80' : '#555';
    document.getElementById('nft-op-no').style.background = !yes ? 'rgba(248,113,113,.15)' : 'transparent';
    document.getElementById('nft-op-no').style.borderColor = !yes ? '#f87171' : '#333';
    document.getElementById('nft-op-no').style.color = !yes ? '#f87171' : '#555';
}

async function nftSetOperator() {
    if (!nftRequireWallet('nft-transfer-msg')) return;
    const op = document.getElementById('nft-op-addr').value.trim();
    if (!op.startsWith("oct")) return nftError('nft-transfer-msg', "Invalid operator address.");
    if (op === currentWallet.address) return nftError('nft-transfer-msg', "Cannot set self as operator.");

    if (!nftState.operatorApprovals[currentWallet.address])
        nftState.operatorApprovals[currentWallet.address] = {};
    nftState.operatorApprovals[currentWallet.address][op] = nftOpApproved ? 1 : 0;

    if (NFT_CONTRACT_ADDR) {
        try {
            const res = await nftBuildAndSubmit("set_operator", [op, nftOpApproved ? 1 : 0], 'nft-transfer-msg');
            nftSuccess('nft-transfer-msg',
                `⊕ Operator ${nftShortAddr(op)} ${nftOpApproved ? 'approved' : 'revoked'}<br>
                 <span style="font-size:10px;color:#aaa;">Hash: ${(res.tx_hash||'').slice(0,16)}…</span>`);
        } catch(e) {
            nftError('nft-transfer-msg', `On-chain failed: ${e.message}`);
        }
    } else {
        await new Promise(r => setTimeout(r, 400));
        nftSuccess('nft-transfer-msg', `⊕ Operator ${nftShortAddr(op)} ${nftOpApproved ? 'approved' : 'revoked'} (local)`);
    }
}

function nftSignMessage() {
    if (!nftRequireWallet('nft-sign-out')) return;

    const msg  = document.getElementById('nft-sign-msg').value.trim();
    if (!msg)  { document.getElementById('nft-sign-out').style.display='block';
                 document.getElementById('nft-sign-out').innerHTML='<span style="color:#f87171;">Enter a message.</span>'; return; }

    const msgBytes = new TextEncoder().encode(msg);
    const keyPair  = nacl.sign.keyPair.fromSeed(currentWallet.privKeyBytes);
    const sigBytes = nacl.sign.detached(msgBytes, keyPair.secretKey);
    const sigB64   = toBase64(sigBytes);
    const pubB64   = currentWallet.publicKeyBase64;

    const out = document.getElementById('nft-sign-out');
    out.style.display = 'block';
    out.innerHTML = `
        <div style="margin-bottom:8px;color:#666;font-size:9px;letter-spacing:.5px;font-weight:700;">
            ✎ ED25519 SIGNATURE</div>
        <div style="margin-bottom:4px;">
            <span style="color:#555;">MSG: </span><span style="color:#ccc;">${msg.slice(0,60)}${msg.length>60?'…':''}</span>
        </div>
        <div style="margin-bottom:4px;">
            <span style="color:#555;">SIG: </span><span style="color:#f59e0b;font-size:9px;">${sigB64}</span>
        </div>
        <div style="margin-bottom:8px;">
            <span style="color:#555;">PUB: </span><span style="color:#87ceeb;font-size:9px;">${pubB64}</span>
        </div>
        <button onclick="navigator.clipboard.writeText('${sigB64}').then(()=>this.innerText='✓ Copied')"
                style="background:#1a1a1a;border:1px solid #333;color:#888;font-size:10px;padding:4px 10px;
                       border-radius:6px;cursor:pointer;width:auto;font-family:'Inter',sans-serif;">
                Copy Signature
        </button>`;
}

function nftSignAction() {
    if (!nftRequireWallet('nft-action-out')) return;

    const tokenId = parseInt(document.getElementById('nft-action-token').value);
    const action  = document.getElementById('nft-action-type').value;
    if (isNaN(tokenId)) {
        document.getElementById('nft-action-out').style.display='block';
        document.getElementById('nft-action-out').innerHTML='<span style="color:#f87171;">Enter a valid token ID.</span>';
        return;
    }

    const payload = JSON.stringify({
        action,
        token_id:   tokenId,
        signer:     currentWallet.address,
        public_key: currentWallet.publicKeyBase64,
        nonce:      (currentWallet.nonce || 0) + 1,
        timestamp:  Math.floor(Date.now() / 1000),
    });

    const keyPair  = nacl.sign.keyPair.fromSeed(currentWallet.privKeyBytes);
    const sigBytes = nacl.sign.detached(new TextEncoder().encode(payload), keyPair.secretKey);
    const sigB64   = toBase64(sigBytes);

    const out = document.getElementById('nft-action-out');
    out.style.display = 'block';
    out.innerHTML = `
        <div style="margin-bottom:8px;color:#666;font-size:9px;letter-spacing:.5px;font-weight:700;">
            ✎ NFT ACTION AUTHORIZATION</div>
        <div style="margin-bottom:4px;">
            <span style="color:#555;">ACTION: </span><span style="color:#ccc;">${action} · Token #${tokenId}</span>
        </div>
        <div style="margin-bottom:4px;">
            <span style="color:#555;">SIGNER: </span><span style="color:#87ceeb;font-size:9px;">${nftShortAddr(currentWallet.address)}</span>
        </div>
        <div style="margin-bottom:4px;word-break:break-all;">
            <span style="color:#555;">SIG: </span><span style="color:#f59e0b;font-size:9px;">${sigB64}</span>
        </div>
        <div style="margin-bottom:8px;word-break:break-all;">
            <span style="color:#555;">PAYLOAD: </span><span style="color:#333;font-size:9px;">${payload}</span>
        </div>
        <button onclick="navigator.clipboard.writeText('${sigB64}').then(()=>this.innerText='✓ Copied')"
                style="background:#1a1a1a;border:1px solid #333;color:#888;font-size:10px;padding:4px 10px;
                       border-radius:6px;cursor:pointer;width:auto;font-family:'Inter',sans-serif;">
                Copy Signature
        </button>`;
}

function nftVerifySig() {
    const msg    = document.getElementById('nft-verify-msg').value.trim();
    const sigB64 = document.getElementById('nft-verify-sig').value.trim();
    const pubB64 = document.getElementById('nft-verify-pubkey').value.trim() || currentWallet.publicKeyBase64;
    const out    = document.getElementById('nft-verify-out');

    if (!msg || !sigB64) {
        out.innerHTML = `<span style="color:#f87171;font-size:12px;">Message and signature are required.</span>`; return;
    }
    if (!pubB64) {
        out.innerHTML = `<span style="color:#f87171;font-size:12px;">Public key required (or unlock wallet).</span>`; return;
    }

    try {
        const msgBytes = new TextEncoder().encode(msg);
        const sigBytes = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
        const pubBytes = Uint8Array.from(atob(pubB64), c => c.charCodeAt(0));

        if (sigBytes.length !== 64)  throw new Error("Signature must be 64 bytes.");
        if (pubBytes.length !== 32)  throw new Error("Public key must be 32 bytes.");

        const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes);

        out.innerHTML = valid
            ? `<div style="background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.25);
                           border-radius:8px;padding:10px;font-size:12px;color:#4ade80;">
                   <i class="fa-solid fa-circle-check" style="margin-right:5px;"></i>
                   <strong>Signature VALID</strong><br>
                   <span style="font-size:10px;color:#888;margin-top:4px;display:block;">
                       Verified with Ed25519 · signer: ${nftShortAddr(
                           "oct" + (() => {
                               try { const h = new Uint8Array(sha256.create().update(pubBytes).array());
                                     return base58Encode(h); } catch(_) { return "…"; }
                           })()
                       )}
                   </span>
               </div>`
            : `<div style="background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.2);
                           border-radius:8px;padding:10px;font-size:12px;color:#f87171;">
                   <i class="fa-solid fa-xmark-circle" style="margin-right:5px;"></i>
                   <strong>Signature INVALID</strong>
               </div>`;
    } catch(e) {
        out.innerHTML = `<span style="color:#f87171;font-size:12px;">
            <i class="fa-solid fa-triangle-exclamation"></i> Error: ${e.message}</span>`;
    }
}

function nftSwitchTab(btn, panelId) {
    document.querySelectorAll('.nft-tab').forEach(b => {
        b.style.background = 'transparent';
        b.style.color = '#555';
    });
    document.querySelectorAll('.nft-tab-panel').forEach(p => p.style.display = 'none');
    btn.style.background = '#87ceeb';
    btn.style.color = '#000';
    document.getElementById(panelId).style.display = 'block';
}

function nftSubTab(btn, panelId) {
    const parent = btn.closest('#nft-tab-transfer');
    parent.querySelectorAll('.nft-sub').forEach(b => {
        b.style.background = 'transparent';
        b.style.borderColor = '#333';
        b.style.color = '#555';
    });
    parent.querySelectorAll('[id^="nft-sub-"]').forEach(p => p.style.display = 'none');
    btn.style.background = 'rgba(135,206,235,.15)';
    btn.style.borderColor = 'rgba(135,206,235,.3)';
    btn.style.color = '#87ceeb';
    document.getElementById(panelId).style.display = 'block';
}

function nftSignSubTab(btn, panelId) {
    const parent = btn.closest('#nft-tab-sign');
    parent.querySelectorAll('.nft-sign-sub').forEach(b => {
        b.style.background = 'transparent';
        b.style.borderColor = '#333';
        b.style.color = '#555';
    });
    parent.querySelectorAll('[id^="nft-signsub-"]').forEach(p => p.style.display = 'none');
    btn.style.background = 'rgba(245,158,11,.15)';
    btn.style.borderColor = 'rgba(245,158,11,.3)';
    btn.style.color = '#f59e0b';
    document.getElementById(panelId).style.display = 'block';
}

const AUTO_LOCK_MS = 5 * 60 * 1000; 
let _autoLockTimer = null;

function resetAutoLockTimer() {
    clearTimeout(_autoLockTimer);
    if (!currentWallet.address) return;
    _autoLockTimer = setTimeout(() => {
        lockWallet();
    }, AUTO_LOCK_MS);
}

function lockWallet() {
    if (!currentWallet.address) return;
    sessionStorage.removeItem('octra_session_pw');
    currentWallet.privKeyBytes    = null;
    currentWallet.mnemonic        = null;
    currentWallet.address         = null;
    currentWallet.publicKeyBase64 = null;
    vault         = null;
    vaultPassword = null;
    lastBalance   = null;
    document.getElementById('lock-modal-password').value = '';
    document.getElementById('lock-modal-msg').textContent = '';
    document.getElementById('lock-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('lock-modal-password').focus(), 100);
}

function unlockFromModal() {
    const passEl = document.getElementById('lock-modal-password');
    const msgEl  = document.getElementById('lock-modal-msg');
    const pass   = passEl.value;
    if (!pass) { msgEl.textContent = 'Enter your password.'; return; }
    const saved = localStorage.getItem(VAULT_KEY);
    if (!saved) { document.getElementById('lock-modal').classList.add('hidden'); showScreen('screen-setup'); return; }
    try {
        vault = decryptVault(saved, pass);
        vaultPassword = pass;
        sessionStorage.setItem('octra_session_pw', pass);
        passEl.value = '';
        msgEl.textContent = '';
        document.getElementById('lock-modal').classList.add('hidden');
        activateWallet(vault.wallets.length - 1);
    } catch {
        passEl.value = '';
        msgEl.textContent = 'Wrong password.';
    }
}

['click','keydown','touchstart','mousemove'].forEach(ev => {
    document.addEventListener(ev, resetAutoLockTimer, { passive: true });
});

window.addEventListener('DOMContentLoaded', () => {
    setInterval(() => { if (currentWallet.address) refreshData(); }, 15000);
});

async function fetchRecommendedFee() {
    try {
        const res = await rpcCall("octra_recommendedFee", []);
        if (res && (res.fee || res.recommended_fee || res.slow || res.standard)) {
            return {
                slow:     res.slow     || res.fee || res.recommended_fee || 10000,
                standard: res.standard || res.fee || res.recommended_fee || 10000,
                fast:     res.fast     || res.fee || res.recommended_fee || 30000,
            };
        }
    } catch(_) {}
    return { slow: 10000, standard: 10000, fast: 30000 };
}

async function loadFeeRecommendation() {
    const el = document.getElementById('fee-rec-display');
    if (!el) return;
    el.innerHTML = '<span style="color:#555;font-size:11px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading fees…</span>';
    const fees = await fetchRecommendedFee();
    el.innerHTML = `
        <div style="display:flex;gap:8px;margin-top:6px;">
            <div style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:8px;text-align:center;">
                <div style="font-size:9px;color:#555;font-weight:600;margin-bottom:3px;">SLOW</div>
                <div style="font-size:13px;color:#888;font-weight:700;">${(fees.slow/1e6).toFixed(4)}</div>
                <div style="font-size:9px;color:#444;">OCT</div>
            </div>
            <div style="flex:1;background:rgba(135,206,235,.06);border:1px solid rgba(135,206,235,.2);border-radius:10px;padding:8px;text-align:center;">
                <div style="font-size:9px;color:#87ceeb;font-weight:600;margin-bottom:3px;">STANDARD</div>
                <div style="font-size:13px;color:#87ceeb;font-weight:700;">${(fees.standard/1e6).toFixed(4)}</div>
                <div style="font-size:9px;color:#87ceeb88;">OCT</div>
            </div>
            <div style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:8px;text-align:center;">
                <div style="font-size:9px;color:#4ade80;font-weight:600;margin-bottom:3px;">FAST</div>
                <div style="font-size:13px;color:#4ade80;font-weight:700;">${(fees.fast/1e6).toFixed(4)}</div>
                <div style="font-size:9px;color:#4ade8088;">OCT</div>
            </div>
        </div>`;
}

async function sendStealth() {
    const to        = document.getElementById('stealth-to').value.trim();
    const amtStr    = document.getElementById('stealth-amount').value.trim();
    const amtFloat  = parseFloat(amtStr);
    const msgEl     = document.getElementById('stealth-msg');

    if (!to.startsWith("oct") || to.length !== 47) {
        msgEl.innerHTML = '<p class="error">Invalid recipient address.</p>'; return;
    }
    if (isNaN(amtFloat) || amtFloat <= 0) {
        msgEl.innerHTML = '<p class="error">Invalid amount.</p>'; return;
    }
    if (amtFloat > parseFloat(currentWallet.balance || 0)) {
        msgEl.innerHTML = '<p class="error">Insufficient balance.</p>'; return;
    }

    msgEl.innerHTML = '<p style="color:#87ceeb;font-size:12px;"><i class="fa-solid fa-spinner fa-spin"></i> Fetching recipient key…</p>';

    
    const recipientPubB64 = await fetchRecipientPubKey(to);
    if (!recipientPubB64) {
        msgEl.innerHTML = '<p class="error">Recipient has no registered public key on-chain. They need at least 1 confirmed tx first.</p>';
        return;
    }

    msgEl.innerHTML = '<p style="color:#87ceeb;font-size:12px;"><i class="fa-solid fa-spinner fa-spin"></i> Generating stealth address…</p>';

    try {
        
        const ephemeralKP = nacl.box.keyPair();

        
        const recipientPubBytes = Uint8Array.from(atob(recipientPubB64), c => c.charCodeAt(0));

        
        const sharedSecret = nacl.scalarMult(ephemeralKP.secretKey, recipientPubBytes);

        
        const stealthSeedHash = sha256.create().update(sharedSecret).array();
        const stealthSeed     = new Uint8Array(stealthSeedHash);
        const stealthKP       = nacl.sign.keyPair.fromSeed(stealthSeed);
        const stealthPubHash  = new Uint8Array(sha256.create().update(stealthKP.publicKey).array());
        const stealthAddress  = "oct" + base58Encode(stealthPubHash);

        
        const ephemeralPubB64 = toBase64(ephemeralKP.publicKey);
        const stealthMeta     = JSON.stringify({ stealth: true, eph: ephemeralPubB64 });

        
        document.getElementById('stealth-confirm-to').textContent    = stealthAddress.slice(0,16)+'…';
        document.getElementById('stealth-confirm-eph').textContent   = ephemeralPubB64.slice(0,20)+'…';
        document.getElementById('stealth-confirm-amount').textContent = amtStr + ' OCT';
        document.getElementById('stealth-confirm-box').style.display = 'block';

        
        window._pendingStealthTx = {
            stealthAddress, amtFloat, amtStr, stealthMeta, recipientOriginal: to
        };

        msgEl.innerHTML = '<p style="color:#87ceeb;font-size:12px;"><i class="fa-solid fa-circle-info"></i> Stealth address generated. Confirm to send.</p>';
    } catch(e) {
        msgEl.innerHTML = `<p class="error">Stealth generation failed: ${e.message}</p>`;
    }
}

async function confirmStealthSend() {
    const st = window._pendingStealthTx;
    if (!st) return;
    const msgEl = document.getElementById('stealth-msg');
    document.getElementById('stealth-confirm-box').style.display = 'none';

    msgEl.innerHTML = '<p style="color:#87ceeb;font-size:12px;"><i class="fa-solid fa-spinner fa-spin"></i> Sending stealth tx…</p>';

    const { stealthAddress, amtFloat, amtStr, stealthMeta } = st;
    const amountRaw = Math.floor(amtFloat * MICRO_OCT).toString();
    const nextNonce = currentWallet.nonce + 1;
    const ouFee     = amtFloat < 1000 ? "10000" : "30000";
    const timestamp = parseFloat((Date.now() / 1000).toFixed(3));
    const keyPair   = nacl.sign.keyPair.fromSeed(currentWallet.privKeyBytes);

    const candidates = [
        { keys: ["from","to_","amount","nonce","op_type","ou","timestamp"], op: "standard" },
        { keys: ["from","to_","amount","nonce","ou","timestamp","op_type"], op: "standard" },
    ];

    const base = {
        from: currentWallet.address, to_: stealthAddress,
        amount: amountRaw, nonce: nextNonce, ou: ouFee, timestamp,
    };

    let result = null, lastErr = null;
    for (const { keys, op } of candidates) {
        const fields = { ...base, op_type: op };
        const ordered = {};
        keys.forEach(k => { ordered[k] = fields[k]; });
        const ser = JSON.stringify(ordered, keys);
        const sig = toBase64(nacl.sign.detached(new TextEncoder().encode(ser), keyPair.secretKey));
        const txObj = { ...ordered, signature: sig, public_key: currentWallet.publicKeyBase64, message: stealthMeta };
        try {
            result = await rpcCall("octra_submit", [txObj]);
            break;
        } catch(e) {
            lastErr = e;
            if (e.code !== 101) throw e;
        }
    }
    if (!result) throw lastErr;

    msgEl.innerHTML = `<div style="background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.2);
        border-radius:8px;padding:12px;margin-top:6px;">
        <div style="color:#4ade80;font-size:13px;font-weight:700;margin-bottom:6px;">
            <i class="fa-solid fa-eye-slash"></i> Stealth Tx Accepted
        </div>
        <div style="font-size:11px;color:#666;">Hash: <span style="color:#aaa;font-family:monospace;">${(result.tx_hash||'').slice(0,22)}…</span></div>
        <div style="font-size:11px;color:#555;margin-top:3px;">Stealth addr: <span style="color:#aaa;font-family:monospace;">${stealthAddress.slice(0,14)}…</span></div>
    </div>`;
    currentWallet.nonce = nextNonce;
    window._pendingStealthTx = null;
    setTimeout(refreshData, 2500);
}

async function loadNetworkStats() {
    const container = document.getElementById('network-stats-container');
    if (!container) return;
    container.innerHTML = `<div style="text-align:center;padding:20px;color:#555;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size:20px;"></i>
        <p style="font-size:12px;margin-top:8px;">Fetching node info…</p></div>`;

    const stats = {};
    const methods = [
        ["octra_getNetworkInfo",   []],
        ["octra_networkStatus",    []],
        ["octra_getNodeInfo",      []],
        ["octra_getBlockchainInfo",[]],
        ["octra_getEpoch",         []],
        ["octra_getPendingCount",  []],
    ];

    for (const [method, params] of methods) {
        try {
            const r = await rpcCall(method, params);
            stats[method] = r;
        } catch(e) {
            stats[method] = null;
        }
    }

    
    const merged = Object.assign({}, ...Object.values(stats).filter(Boolean));
    const epoch          = merged.epoch     || merged.current_epoch    || '—';
    const blockHeight    = merged.height    || merged.block_height     || merged.blocks || '—';
    const nodeVersion    = merged.version   || merged.node_version     || '—';
    const networkId      = merged.network   || merged.network_id       || activeNetwork;
    const txPoolSize     = merged.pending   || merged.mempool_size     || merged.tx_pool_size || '—';
    const validators     = merged.validators|| merged.validator_count  || '—';
    const tps            = merged.tps       || merged.transactions_per_second || '—';

    const netColor = activeNetwork === 'mainnet' ? '#4ade80' : '#87ceeb';

    container.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
            <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:12px;">
                <div style="font-size:9px;color:#555;font-weight:600;margin-bottom:4px;">NETWORK</div>
                <div style="font-size:14px;font-weight:700;color:${netColor};">${NETWORKS[activeNetwork].name}</div>
            </div>
            <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:12px;">
                <div style="font-size:9px;color:#555;font-weight:600;margin-bottom:4px;">EPOCH</div>
                <div style="font-size:14px;font-weight:700;color:#fff;">${epoch}</div>
            </div>
            <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:12px;">
                <div style="font-size:9px;color:#555;font-weight:600;margin-bottom:4px;">BLOCK HEIGHT</div>
                <div style="font-size:14px;font-weight:700;color:#fff;">${blockHeight}</div>
            </div>
            <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:12px;">
                <div style="font-size:9px;color:#555;font-weight:600;margin-bottom:4px;">TX POOL</div>
                <div style="font-size:14px;font-weight:700;color:#fff;">${txPoolSize}</div>
            </div>
            <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:12px;">
                <div style="font-size:9px;color:#555;font-weight:600;margin-bottom:4px;">VALIDATORS</div>
                <div style="font-size:14px;font-weight:700;color:#fff;">${validators}</div>
            </div>
            <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:12px;">
                <div style="font-size:9px;color:#555;font-weight:600;margin-bottom:4px;">NODE VERSION</div>
                <div style="font-size:12px;font-weight:700;color:#fff;">${nodeVersion}</div>
            </div>
        </div>
        <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:12px;margin-bottom:10px;">
            <div style="font-size:9px;color:#555;font-weight:600;margin-bottom:6px;">RPC ENDPOINT</div>
            <div style="font-size:11px;color:#87ceeb;font-family:monospace;word-break:break-all;">${RPC_URL}</div>
        </div>
        <details style="background:#111;border:1px solid #1a1a1a;border-radius:10px;padding:8px 12px;">
            <summary style="cursor:pointer;color:#444;font-size:10px;font-weight:600;">
                <i class="fa-solid fa-bug" style="margin-right:4px;"></i>Raw RPC Responses
            </summary>
            <pre style="color:#87ceeb;font-size:9px;margin:8px 0 0;overflow-x:auto;white-space:pre-wrap;word-break:break-all;">${JSON.stringify(stats, null, 2)}</pre>
        </details>`;

    
    await loadFeeRecommendation();
}

async function lookupAddress() {
    const addr  = document.getElementById('lookup-addr').value.trim();
    const resEl = document.getElementById('lookup-result');
    if (!addr.startsWith('oct') || addr.length < 40) {
        resEl.innerHTML = '<p class="error">Enter a valid oct… address.</p>'; return;
    }
    resEl.innerHTML = '<p style="color:#87ceeb;font-size:12px;"><i class="fa-solid fa-spinner fa-spin"></i> Fetching…</p>';
    try {
        const data = await rpcCall("octra_balance", [addr]);
        const pubKey = data.public_key || '—';
        const nonce  = data.nonce || 0;
        const hasEnc = data.has_encrypted_balance || false;
        resEl.innerHTML = `
            <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:14px;margin-top:6px;">
                <div style="margin-bottom:8px;">
                    <div style="font-size:9px;color:#555;font-weight:600;margin-bottom:2px;">ADDRESS</div>
                    <div style="font-size:11px;color:#87ceeb;font-family:monospace;word-break:break-all;">${addr}</div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                    <div>
                        <div style="font-size:9px;color:#555;font-weight:600;margin-bottom:2px;">BALANCE</div>
                        <div style="font-size:16px;font-weight:700;color:#fff;">${data.balance || '0'} OCT</div>
                    </div>
                    <div>
                        <div style="font-size:9px;color:#555;font-weight:600;margin-bottom:2px;">NONCE</div>
                        <div style="font-size:16px;font-weight:700;color:#fff;">${nonce}</div>
                    </div>
                </div>
                <div style="margin-bottom:8px;">
                    <div style="font-size:9px;color:#555;font-weight:600;margin-bottom:2px;">PUBLIC KEY</div>
                    <div style="font-size:10px;color:#888;font-family:monospace;word-break:break-all;">${pubKey.length > 30 ? pubKey.slice(0,30)+'…' : pubKey}</div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <span style="font-size:11px;color:${hasEnc?'#a78bfa':'#333'};">
                        <i class="fa-solid fa-${hasEnc?'lock':'lock-open'}"></i>
                        ${hasEnc ? 'Has encrypted balance' : 'No encrypted balance'}
                    </span>
                </div>
                <a href="${explorerAddrUrl(addr)}" target="_blank" rel="noopener noreferrer"
                   style="display:flex;align-items:center;gap:5px;margin-top:10px;background:rgba(135,206,235,.1);
                          border:1px solid rgba(135,206,235,.3);color:#87ceeb;font-size:11px;padding:7px 12px;
                          border-radius:8px;text-decoration:none;font-weight:600;width:fit-content;">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> View on Explorer
                </a>
            </div>`;
    } catch(e) {
        resEl.innerHTML = `<p class="error">${e.message || 'Address not found.'}</p>`;
    }
}

const _origShowScreen = showScreen;
showScreen = function(id) {
    _origShowScreen(id);
    if (id === 'screen-stealth')  {  }
    if (id === 'screen-network')  { loadNetworkStats().catch(()=>{}); }
    if (id === 'screen-lookup')   {  }
};

function applyCustomRpc() {
    const url = document.getElementById('custom-rpc-input').value.trim();
    if (!url.startsWith('http')) {
        alert('Invalid RPC URL. Must start with http:// or https://'); return;
    }
    RPC_URL = url;
    EXPLORER_BASE_DYNAMIC = NETWORKS[activeNetwork].explorer;
    document.getElementById('custom-rpc-status').textContent = '✓ Custom RPC applied: ' + url;
    if (currentWallet.address) refreshData();
}

function resetRpc() {
    RPC_URL = NETWORKS[activeNetwork].rpc;
    document.getElementById('custom-rpc-input').value = '';
    document.getElementById('custom-rpc-status').textContent = 'Reset to default: ' + RPC_URL;
}
