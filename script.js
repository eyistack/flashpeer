// --- UTILS & HISTORY ---
        function formatBytes(bytes, decimals = 2) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const dm = decimals < 0 ? 0 : decimals;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        }

        async function computeSHA256(arrayBuffer) {
            try {
                const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            } catch (e) {
                return null;
            }
        }

        function playChime() {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc1 = ctx.createOscillator(); const osc2 = ctx.createOscillator(); const gain = ctx.createGain();
                osc1.type = 'sine'; osc2.type = 'sine';
                osc1.frequency.setValueAtTime(523.25, ctx.currentTime);
                osc2.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
                gain.gain.setValueAtTime(0, ctx.currentTime);
                gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1);
                osc1.connect(gain); osc2.connect(gain); gain.connect(ctx.destination);
                osc1.start(ctx.currentTime); osc2.start(ctx.currentTime + 0.1);
                osc1.stop(ctx.currentTime + 1); osc2.stop(ctx.currentTime + 1.1);
            } catch (e) { console.error('Audio failed', e); }
        }

        function saveHistory(name, size, role) {
            try {
                const history = JSON.parse(localStorage.getItem('flashpeer_history') || '[]');
                history.unshift({ name, size, role, date: new Date().toLocaleString() });
                if (history.length > 50) history.pop();
                localStorage.setItem('flashpeer_history', JSON.stringify(history));
            } catch (e) {}
        }

        function renderHistory() {
            const tbody = document.getElementById('history-tbody');
            tbody.innerHTML = '';
            try {
                const history = JSON.parse(localStorage.getItem('flashpeer_history') || '[]');
                if (history.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" class="empty-history">No past transfers found.</td></tr>';
                    return;
                }
                history.forEach(item => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${item.name}">${item.name}</td>
                        <td>${formatBytes(item.size)}</td>
                        <td>${item.role}</td>
                        <td style="color: var(--text-muted);">${item.date}</td>
                    `;
                    tbody.appendChild(tr);
                });
            } catch (e) {
                tbody.innerHTML = '<tr><td colspan="4" class="empty-history">Error loading history.</td></tr>';
            }
        }

        document.getElementById('open-history-btn').addEventListener('click', () => { renderHistory(); document.getElementById('history-modal').style.display = 'flex'; });
        document.getElementById('close-history-btn').addEventListener('click', () => { document.getElementById('history-modal').style.display = 'none'; });

        // --- UI & TAB LOGIC ---
        function switchTab(targetId) {
            document.querySelectorAll('.pill-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            document.querySelector(`[data-target="${targetId}"]`).classList.add('active');
            document.getElementById(targetId).classList.add('active');

            if (targetId === 'send-panel') {
                document.getElementById('sender-files-view').style.display = 'flex';
                document.getElementById('receiver-files-view').style.display = 'none';
            } else {
                document.getElementById('sender-files-view').style.display = 'none';
                document.getElementById('receiver-files-view').style.display = 'flex';
            }
        }
        document.querySelectorAll('.pill-tab').forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.getAttribute('data-target')));
        });

        function setStatus(panel, state, message) {
            const dot = document.getElementById(`${panel}-dot`);
            const text = document.getElementById(`${panel}-status-text`);
            dot.className = 'status-dot';
            if (state) dot.classList.add(state);
            text.textContent = message;
        }

        function formatEta(seconds) {
            if (!isFinite(seconds) || seconds < 0) return '--:--';
            const totalSec = Math.round(seconds);
            if (totalSec <= 0) return '0s';
            if (totalSec < 60) return `${totalSec}s`;
            const mins = Math.floor(totalSec / 60);
            const secs = totalSec % 60;
            if (mins < 60) return `${mins}m ${secs.toString().padStart(2, '0')}s`;
            const hours = Math.floor(mins / 60);
            const remMins = mins % 60;
            return `${hours}h ${remMins}m ${secs.toString().padStart(2, '0')}s`;
        }

        let lastSenderHash = null;
        let lastReceiverHash = null;

        function displaySenderChecksum(hash) {
            if (!hash) return;
            lastSenderHash = hash;
            const card = document.getElementById('send-verification-card');
            const hashEl = document.getElementById('send-checksum-hash');
            if (card && hashEl) {
                hashEl.textContent = `${hash.substring(0, 8)}...${hash.substring(hash.length - 6)}`;
                hashEl.title = `Full SHA-256: ${hash}`;
                card.style.display = 'flex';
            }
        }

        function displayReceiverChecksum(hash, isVerifiedMatch) {
            if (!hash) return;
            lastReceiverHash = hash;
            const card = document.getElementById('receive-verification-card');
            const textEl = document.getElementById('receive-verification-text');
            const hashEl = document.getElementById('receive-checksum-hash');
            if (card && hashEl) {
                hashEl.textContent = `${hash.substring(0, 8)}...${hash.substring(hash.length - 6)}`;
                hashEl.title = `Full SHA-256: ${hash}`;
                if (textEl) {
                    textEl.textContent = isVerifiedMatch ? 'Verified Match (SHA-256)' : 'SHA-256 Checksum';
                }
                card.style.display = 'flex';
            }
        }

        // --- LIVE TRANSFER DIAGNOSTICS TRACKER (1-Second Intervals, Real-Time MB/s, Rolling Throughput ETA) ---
        class TransferDiagnosticsTracker {
            constructor(prefix) {
                this.prefix = prefix;
                this.intervalTimer = null;
                this.totalBytes = 0;
                this.currentBytes = 0;
                this.lastSampleBytes = 0;
                this.lastSampleTime = 0;
                this.startTime = 0;
                this.rollingSpeedSamples = [];
                this.rollingWindowSize = 5;
                this.currentSpeedMBps = 0;
                this.rollingAvgSpeedBps = 0;
                this.title = '';
            }

            start(totalBytes, title = '') {
                this.stop();
                this.totalBytes = totalBytes || 0;
                this.currentBytes = 0;
                this.lastSampleBytes = 0;
                this.startTime = Date.now();
                this.lastSampleTime = this.startTime;
                this.rollingSpeedSamples = [];
                this.currentSpeedMBps = 0;
                this.rollingAvgSpeedBps = 0;
                this.title = title;

                this.renderProgress();
                this.renderDiagnostics();

                // Track byte progress at 1-second intervals
                this.intervalTimer = setInterval(() => {
                    this.sampleInterval();
                }, 1000);
            }

            updateBytes(bytes) {
                this.currentBytes = bytes;
                this.renderProgress();
            }

            sampleInterval() {
                const now = Date.now();
                const elapsedSec = (now - this.lastSampleTime) / 1000;
                if (elapsedSec <= 0) return;

                const deltaBytes = Math.max(0, this.currentBytes - this.lastSampleBytes);
                const instantSpeedBps = deltaBytes / elapsedSec;

                this.lastSampleTime = now;
                this.lastSampleBytes = this.currentBytes;

                // Calculate real-time transfer speed in MB/s (Megabytes per second, 1 MB = 1,048,576 bytes)
                this.currentSpeedMBps = instantSpeedBps / (1024 * 1024);

                // Rolling average window for smooth and accurate ETA estimation
                this.rollingSpeedSamples.push(instantSpeedBps);
                if (this.rollingSpeedSamples.length > this.rollingWindowSize) {
                    this.rollingSpeedSamples.shift();
                }

                const sum = this.rollingSpeedSamples.reduce((a, b) => a + b, 0);
                this.rollingAvgSpeedBps = this.rollingSpeedSamples.length > 0 ? (sum / this.rollingSpeedSamples.length) : 0;

                this.renderDiagnostics();
            }

            renderProgress() {
                const percent = this.totalBytes > 0 
                    ? Math.min(100, Math.floor((this.currentBytes / this.totalBytes) * 100))
                    : (this.currentBytes > 0 ? 100 : 0);

                const bar = document.getElementById(`${this.prefix}-progress-bar`);
                const pct = document.getElementById(`${this.prefix}-percentage`);
                const trans = document.getElementById(`${this.prefix}-transferred`);
                const tit = document.getElementById(`${this.prefix}-progress-title`);

                if (bar) bar.style.width = percent + '%';
                if (pct) pct.textContent = percent + '%';
                if (trans) trans.textContent = `${formatBytes(this.currentBytes)} / ${formatBytes(this.totalBytes)}`;
                if (this.title && tit) tit.textContent = this.title;
            }

            renderDiagnostics() {
                const speedEl = document.getElementById(`${this.prefix}-speed`);
                const etaEl = document.getElementById(`${this.prefix}-eta`);

                // Calculate and display real-time transfer speed in MB/s
                if (speedEl) {
                    speedEl.textContent = `${this.currentSpeedMBps.toFixed(2)} MB/s`;
                }

                // Compute accurate remaining time estimate (ETA in minutes/seconds) based on rolling average throughput
                if (etaEl) {
                    const remainingBytes = Math.max(0, this.totalBytes - this.currentBytes);
                    if (this.currentBytes >= this.totalBytes && this.totalBytes > 0) {
                        etaEl.textContent = 'ETA 0s';
                        etaEl.style.display = 'inline-flex';
                    } else if (this.rollingAvgSpeedBps > 1024 && remainingBytes > 0) {
                        const etaSeconds = remainingBytes / this.rollingAvgSpeedBps;
                        etaEl.textContent = `ETA ${formatEta(etaSeconds)}`;
                        etaEl.style.display = 'inline-flex';
                    } else if (this.currentBytes === 0) {
                        etaEl.textContent = 'ETA --:--';
                        etaEl.style.display = 'inline-flex';
                    } else {
                        etaEl.textContent = 'ETA --:--';
                        etaEl.style.display = 'inline-flex';
                    }
                }
            }

            complete() {
                if (this.intervalTimer) {
                    clearInterval(this.intervalTimer);
                    this.intervalTimer = null;
                }
                this.currentBytes = this.totalBytes;
                this.renderProgress();

                const speedEl = document.getElementById(`${this.prefix}-speed`);
                const etaEl = document.getElementById(`${this.prefix}-eta`);

                if (etaEl) {
                    etaEl.textContent = 'ETA 0s';
                    etaEl.style.display = 'inline-flex';
                }

                if (speedEl && this.startTime) {
                    const totalSec = (Date.now() - this.startTime) / 1000;
                    if (totalSec > 0.1) {
                        const overallAvgMBps = (this.totalBytes / (1024 * 1024)) / totalSec;
                        speedEl.textContent = `${overallAvgMBps.toFixed(2)} MB/s`;
                    }
                }
            }

            stop() {
                if (this.intervalTimer) {
                    clearInterval(this.intervalTimer);
                    this.intervalTimer = null;
                }
            }
        }

        const sendTracker = new TransferDiagnosticsTracker('send');
        const receiveTracker = new TransferDiagnosticsTracker('receive');

        function updateMetrics(prefix, percent, bytesTransferred, totalBytes, startTime, title) {
            const tracker = prefix === 'send' ? sendTracker : receiveTracker;
            if (tracker) {
                if (title) tracker.title = title;
                tracker.totalBytes = totalBytes;
                tracker.updateBytes(bytesTransferred);
            }
        }

        // --- HIGH-PERFORMANCE DISK STORAGE (OPFS) FOR MOBILE STREAMING ---
        let opfsRoot = null;
        let opfsAvailable = false;
        let opfsFileHandle = null;

        async function initOpfs() {
            try {
                if (navigator.storage && navigator.storage.getDirectory) {
                    opfsRoot = await navigator.storage.getDirectory();
                    opfsAvailable = true;
                }
            } catch(e) {
                opfsAvailable = false;
            }
        }
        initOpfs();

        async function getOrCreateOpfsFileStream(fileName) {
            if (!opfsRoot) return null;
            try {
                const safeName = 'fp_' + Date.now() + '_' + fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
                opfsFileHandle = await opfsRoot.getFileHandle(safeName, { create: true });
                return await opfsFileHandle.createWritable();
            } catch(e) {
                console.warn('OPFS createWritable error:', e);
                return null;
            }
        }

        // --- HIGH-THROUGHPUT PIPELINE CONSTANTS & FLOW CONTROL ---
        const CHUNK_SIZE = 65536; // Optimal 64KB chunks (65,536 bytes) to saturate SCTP MTU without fragmentation
        const BACKPRESSURE_HIGH = 1048576; // 1 MB (1,048,576 bytes) pause queueing threshold
        const BACKPRESSURE_LOW = 256 * 1024; // 256 KB (262,144 bytes) bufferedAmountLowThreshold

        let peer = null;
        let activeConnection = null;
        let isPeerConnected = false;
        let stagedFiles = [];
        let currentManifestFiles = [];
        let totalBatchSize = 0;
        let senderPin = '';

        // Helper to await RTCDataChannel 'bufferedamountlow' event
        function waitForBackpressureDrain(dc) {
            if (!dc || dc.bufferedAmount <= BACKPRESSURE_LOW) {
                return Promise.resolve();
            }
            return new Promise((resolve) => {
                let timer = null;
                let poll = null;

                const cleanup = () => {
                    if (timer) clearTimeout(timer);
                    if (poll) clearInterval(poll);
                    if (dc.removeEventListener) {
                        dc.removeEventListener('bufferedamountlow', onDrain);
                    } else if (dc.onbufferedamountlow === onDrain) {
                        dc.onbufferedamountlow = null;
                    }
                };

                const onDrain = () => {
                    cleanup();
                    resolve();
                };

                if (dc.addEventListener) {
                    dc.addEventListener('bufferedamountlow', onDrain, { once: true });
                } else {
                    dc.onbufferedamountlow = onDrain;
                }

                // Safety polling interval to catch edge cases
                poll = setInterval(() => {
                    if (!activeConnection || !activeConnection.open || dc.bufferedAmount <= BACKPRESSURE_LOW) {
                        onDrain();
                    }
                }, 10);

                // Fallback max wait
                timer = setTimeout(() => {
                    onDrain();
                }, 250);
            });
        }

        // --- TRANSFER PROTOCOL HELPERS ---
        function sendControl(conn, obj) {
            if (!conn) return;
            try {
                if (conn.open) {
                    conn.send(JSON.stringify(obj));
                }
            } catch(e) {
                console.warn('sendControl failed:', e);
            }
        }

        function sendRawChunk(conn, buffer) {
            if (!conn || !conn.open) return;
            const dc = conn.dataChannel || conn._dc;
            if (dc && dc.readyState === 'open') {
                dc.send(buffer);
            } else {
                conn.send(buffer);
            }
        }

        // --- 32-BIT INTEGER OVERFLOW SIZE DETECTOR (Fixes Firefox Android SAF >4GB bug) ---
        async function detectTrueFileSize(file) {
            if (!file) return 0;
            const baseSize = file.size;
            const FOUR_GB = 4294967296; // 2^32 bytes

            // Check if file has slice API and baseSize is valid
            if (typeof file.slice === 'function' && baseSize >= 0) {
                let trueSize = baseSize;
                // Probe up to 64GB (16 multipliers of 4GB)
                for (let mult = 1; mult <= 16; mult++) {
                    const candidateOffset = baseSize + (mult * FOUR_GB);
                    try {
                        const probeSlice = file.slice(Math.max(0, candidateOffset - 1024), candidateOffset);
                        if (probeSlice && probeSlice.size > 0) {
                            const testBuf = await probeSlice.arrayBuffer();
                            if (testBuf && testBuf.byteLength > 0) {
                                trueSize = candidateOffset;
                                console.log(`[FlashPeer] Corrected 32-bit overflow: ${baseSize} -> ${trueSize} bytes`);
                                continue;
                            }
                        }
                    } catch (e) {
                        break;
                    }
                    break;
                }
                return trueSize;
            }
            return baseSize;
        }

        // --- WAKE LOCK API (Prevents screen from sleeping during transfers) ---
        let wakeLockSentinel = null;

        async function requestWakeLock() {
            if ('wakeLock' in navigator) {
                try {
                    wakeLockSentinel = await navigator.wakeLock.request('screen');
                    const badge = document.getElementById('wake-lock-badge');
                    if (badge) badge.style.display = 'flex';
                    wakeLockSentinel.addEventListener('release', () => {
                        const b = document.getElementById('wake-lock-badge');
                        if (b) b.style.display = 'none';
                        wakeLockSentinel = null;
                    });
                } catch (err) {
                    console.warn('Wake Lock request skipped or unsupported:', err);
                }
            }
        }

        function releaseWakeLock() {
            if (wakeLockSentinel) {
                wakeLockSentinel.release().catch(() => {});
                wakeLockSentinel = null;
            }
            const badge = document.getElementById('wake-lock-badge');
            if (badge) badge.style.display = 'none';
        }

        // Re-acquire Wake Lock automatically if page visibility changes during active transfer
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !wakeLockSentinel) {
                const sendStats = document.getElementById('send-stats');
                const receiveStats = document.getElementById('receive-stats');
                const isSending = sendStats && sendStats.style.display === 'flex';
                const isReceiving = receiveStats && receiveStats.style.display === 'flex';
                if (isSending || isReceiving) {
                    requestWakeLock();
                }
            }
        });

        // --- SENDER PASSCODE UI TOGGLE ---
        const senderPwdToggle = document.getElementById('sender-pwd-toggle');
        const senderPwdWrap = document.getElementById('sender-pwd-wrap');
        const senderPwdInput = document.getElementById('sender-pwd-input');
        const senderEyeBtn = document.getElementById('sender-eye-btn');
        let isPeerAuthenticated = false;

        function requirePeerPasscodeAuth() {
            if (!activeConnection || !activeConnection.open) return;
            const secret = senderPwdInput ? senderPwdInput.value.trim() : '';
            if (senderPwdToggle && senderPwdToggle.checked && secret.length > 0) {
                isPeerAuthenticated = false;
                document.getElementById('send-btn').disabled = true;
                sendControl(activeConnection, { type: 'auth-required' });
                setStatus('send', 'waiting', 'Passcode protection active. Awaiting recipient verification...');
                updateSenderStatusBox('connecting', 'Recipient must enter the passcode to unlock transfer.');
            } else {
                // No passcode configured or toggle off
                isPeerAuthenticated = true;
                sendControl(activeConnection, { type: 'auth-not-required' });
                setStatus('send', 'connected', 'Peer connected. Ready to transfer.');
                if (stagedFiles.length > 0) document.getElementById('send-btn').disabled = false;
                updateSenderStatusBox();
            }
        }

        if (senderPwdToggle) {
            senderPwdToggle.addEventListener('change', () => {
                if (senderPwdToggle.checked) {
                    senderPwdWrap.style.display = 'block';
                    senderPwdInput.focus();
                } else {
                    senderPwdWrap.style.display = 'none';
                    senderPwdInput.value = '';
                }
                requirePeerPasscodeAuth();
            });
        }

        if (senderPwdInput) {
            // If user types or modifies the password after connection was established
            senderPwdInput.addEventListener('input', () => {
                if (senderPwdToggle && senderPwdToggle.checked) {
                    requirePeerPasscodeAuth();
                }
            });
        }

        if (senderEyeBtn && senderPwdInput) {
            senderEyeBtn.addEventListener('click', () => {
                const isPassword = senderPwdInput.type === 'password';
                senderPwdInput.type = isPassword ? 'text' : 'password';
                senderEyeBtn.style.color = isPassword ? 'var(--text-primary)' : 'var(--text-muted)';
            });
        }

        // --- WebRTC ICE CONFIGURATION (Fast STUN resolution, pre-warmed candidate pool) ---
        const PEER_CONFIG = {
            debug: 0,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun.cloudflare.com:3478' }
                ],
                iceCandidatePoolSize: 10
            }
        };

        // --- SENDER LOGIC ---
        function initSender() {
            senderPin = Math.floor(10000 + Math.random() * 90000).toString();
            peer = new Peer(senderPin, PEER_CONFIG);

            peer.on('open', (id) => {
                document.getElementById('sender-code').textContent = id;
                setStatus('send', 'waiting', 'Waiting for peer to connect...');
                updateSenderStatusBox();
            });

            peer.on('connection', (conn) => {
                if (activeConnection) { conn.close(); return; }
                activeConnection = conn;
                isPeerConnected = true;

                conn.on('open', () => {
                    isPeerConnected = true;

                    const dc = conn.dataChannel || conn._dc;
                    if (dc) {
                        dc.binaryType = 'arraybuffer';
                        try { dc.bufferedAmountLowThreshold = BACKPRESSURE_LOW; } catch(e) {}
                    }

                    // Check if sender configured a transfer passcode
                    const isProtected = senderPwdToggle && senderPwdToggle.checked && senderPwdInput.value.trim().length > 0;
                    if (isProtected) {
                        isPeerAuthenticated = false;
                        document.getElementById('send-btn').disabled = true;
                        sendControl(conn, { type: 'auth-required' });
                        setStatus('send', 'waiting', 'Peer connected. Awaiting passcode verification...');
                        updateSenderStatusBox('connecting', 'Receiver connected. Prompting for passcode...');
                    } else {
                        isPeerAuthenticated = true;
                        sendControl(conn, { type: 'auth-not-required' });
                        setStatus('send', 'connected', 'Peer connected. Ready to transfer.');
                        if (stagedFiles.length > 0) document.getElementById('send-btn').disabled = false;
                        updateSenderStatusBox();
                    }
                });

                conn.on('data', (raw) => {
                    let data = raw;
                    if (typeof raw === 'string') {
                        try { data = JSON.parse(raw); } catch(e) { return; }
                    }
                    if (!data) return;

                    if (data.type === 'auth-verify') {
                        const expectedSecret = (senderPwdInput ? senderPwdInput.value.trim() : '');
                        if (data.secret && data.secret.trim() === expectedSecret) {
                            isPeerAuthenticated = true;
                            sendControl(conn, { type: 'auth-success' });
                            setStatus('send', 'connected', 'Passcode verified! Ready to transfer.');
                            if (stagedFiles.length > 0) document.getElementById('send-btn').disabled = false;
                            updateSenderStatusBox();
                        } else {
                            sendControl(conn, { type: 'auth-fail' });
                            setStatus('send', 'waiting', 'Peer entered incorrect passcode.');
                        }
                    } else if (data.type === 'text-relay') {
                        handleIncomingTextRelay(data.content);
                    } else if (data.type === 'ready') {
                        startSequentialTransfer(0);
                    } else if (data.type === 'file-ack') {
                        startSequentialTransfer(data.index + 1);
                    } else if (data.type === 'rejected') {
                        releaseWakeLock();
                        setStatus('send', 'error', 'Receiver rejected the batch transfer.');
                        document.getElementById('send-btn').disabled = false;
                        document.getElementById('send-stats').style.display = 'none';
                        updateSenderStatusBox('error', 'Receiver rejected the batch transfer.');
                    }
                });

                conn.on('close', () => {
                    releaseWakeLock();
                    stopRouteMonitoring();
                    isPeerConnected = false;
                    isPeerAuthenticated = false;
                    activeConnection = null;
                    setStatus('send', 'waiting', 'Peer disconnected. Waiting...');
                    document.getElementById('send-btn').disabled = true;
                    document.getElementById('send-stats').style.display = 'none';
                    updateSenderStatusBox();
                });
                conn.on('error', () => {
                    releaseWakeLock();
                    stopRouteMonitoring();
                    isPeerConnected = false;
                    isPeerAuthenticated = false;
                    setStatus('send', 'error', 'Connection error.');
                    updateSenderStatusBox('error', 'Connection error occurred.');
                });
            });

            peer.on('error', (err) => {
                if (err.type === 'unavailable-id') {
                    peer.destroy(); setTimeout(initSender, 500);
                } else {
                    setStatus('send', 'error', 'Network error.');
                }
            });
            peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
        }

        // --- FILE & FOLDER STAGING LOGIC ---
        async function addFilesToStaging(files) {
            if (!files || files.length === 0) return;
            const newFiles = Array.from(files);
            
            // Append files while avoiding exact duplicates (matching relative path or name, size, lastModified)
            for (const newFile of newFiles) {
                const trueSize = await detectTrueFileSize(newFile);
                newFile.actualSize = trueSize;
                const newPath = newFile.displayPath || newFile.webkitRelativePath || newFile.name;
                const exists = stagedFiles.some(f => {
                    const fPath = f.displayPath || f.webkitRelativePath || f.name;
                    const fSize = f.actualSize || f.size;
                    return fPath === newPath && fSize === trueSize && f.lastModified === newFile.lastModified;
                });
                if (!exists) {
                    if (!newFile.displayPath) {
                        newFile.displayPath = newFile.webkitRelativePath || newFile.name;
                    }
                    stagedFiles.push(newFile);
                }
            }

            renderStagedFiles();
        }

        function removeStagedFile(index) {
            if (index >= 0 && index < stagedFiles.length) {
                stagedFiles.splice(index, 1);
                renderStagedFiles();
            }
        }

        function clearStagedFiles() {
            stagedFiles = [];
            totalBatchSize = 0;
            document.getElementById('file-input').value = '';
            document.getElementById('folder-input').value = '';
            renderStagedFiles();
        }

        function renderStagedFiles() {
            totalBatchSize = stagedFiles.reduce((acc, file) => acc + (file.actualSize || file.size), 0);

            const listEl = document.getElementById('staged-file-list');
            const headerBar = document.getElementById('staged-header-bar');
            const emptyState = document.getElementById('files-empty-state');
            const sendBtn = document.getElementById('send-btn');

            if (stagedFiles.length === 0) {
                listEl.style.display = 'none';
                listEl.innerHTML = '';
                headerBar.style.display = 'none';
                emptyState.style.display = 'flex';
                sendBtn.disabled = true;
                return;
            }

            emptyState.style.display = 'none';
            headerBar.style.display = 'flex';
            document.getElementById('staged-count-text').textContent = `${stagedFiles.length} file${stagedFiles.length === 1 ? '' : 's'}`;
            document.getElementById('staged-size-text').textContent = formatBytes(totalBatchSize);

            listEl.innerHTML = '';
            stagedFiles.forEach((f, idx) => {
                const item = document.createElement('div');
                item.className = 'file-list-item';
                const isFolderItem = f.displayPath && f.displayPath.includes('/');
                
                const iconSvg = isFolderItem 
                    ? `<svg class="file-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`
                    : `<svg class="file-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;

                const displayName = f.displayPath || f.name;

                item.innerHTML = `
                    <div class="file-item-left">
                        ${iconSvg}
                        <span class="file-name" title="${displayName}">${displayName}</span>
                    </div>
                    <div class="file-item-right">
                        <span class="file-size">${formatBytes(f.actualSize || f.size)}</span>
                        <button class="btn-remove-item" data-index="${idx}" title="Remove file">
                            <svg class="icon" style="width:14px;height:14px;" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                `;
                listEl.appendChild(item);
            });

            listEl.querySelectorAll('.btn-remove-item').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.getAttribute('data-index'), 10);
                    removeStagedFile(idx);
                });
            });

            listEl.style.display = 'flex';

            if (isPeerConnected || (activeConnection && activeConnection.open)) {
                const isProtected = senderPwdToggle && senderPwdToggle.checked && senderPwdInput.value.trim().length > 0;
                sendBtn.disabled = isProtected && !isPeerAuthenticated;
            } else {
                sendBtn.disabled = true;
            }
            updateSenderStatusBox();
        }

        function updateSenderStatusBox(stateOverride, msgOverride) {
            const title = document.getElementById('status-box-title');
            const desc = document.getElementById('status-box-desc');
            const iconWrap = document.getElementById('status-box-icon-wrap');
            if (!title || !desc) return;

            const isConnected = isPeerConnected || (activeConnection && activeConnection.open);

            if (stateOverride === 'transferring') {
                title.textContent = 'Transferring Files...';
                title.style.color = '#38bdf8';
                if (iconWrap) {
                    iconWrap.innerHTML = '<svg class="icon status-box-icon" style="color: #38bdf8;" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>';
                }
                desc.textContent = msgOverride || 'Streaming data directly to peer via WebRTC...';
            } else if (stateOverride === 'completed') {
                title.textContent = 'Transfer Completed';
                title.style.color = 'var(--status-connected)';
                if (iconWrap) {
                    iconWrap.innerHTML = '<svg class="icon status-box-icon" style="color: var(--status-connected);" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
                }
                desc.textContent = msgOverride || 'All files were successfully transferred!';
            } else if (stateOverride === 'error') {
                title.textContent = 'Connection Error';
                title.style.color = 'var(--status-error)';
                if (iconWrap) {
                    iconWrap.innerHTML = '<svg class="icon status-box-icon" style="color: var(--status-error);" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
                }
                desc.textContent = msgOverride || 'A network error occurred. Please refresh or retry.';
            } else if (isConnected) {
                const isProtected = senderPwdToggle && senderPwdToggle.checked && senderPwdInput.value.trim().length > 0;
                if (isProtected && !isPeerAuthenticated) {
                    title.textContent = 'Passcode Verification Required';
                    title.style.color = 'var(--status-waiting)';
                    if (iconWrap) {
                        iconWrap.innerHTML = '<svg class="icon status-box-icon" style="color: var(--status-waiting);" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
                    }
                    desc.textContent = 'Recipient must enter your transfer passcode to unlock files.';
                } else {
                    title.textContent = 'Peer Connected & Ready';
                    title.style.color = 'var(--status-connected)';
                    if (iconWrap) {
                        iconWrap.innerHTML = '<svg class="icon status-box-icon" style="color: var(--status-connected);" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
                    }
                    if (stagedFiles.length > 0) {
                        desc.textContent = `Ready to stream ${stagedFiles.length} item${stagedFiles.length === 1 ? '' : 's'} (${formatBytes(totalBatchSize)}). Click Send to Peer below.`;
                    } else {
                        desc.textContent = 'Peer is connected! Select or drop files & folders on the right to start.';
                    }
                }
            } else {
                title.textContent = 'Ready to Connect';
                title.style.color = 'var(--text-primary)';
                if (iconWrap) {
                    iconWrap.innerHTML = '<svg class="icon status-box-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>';
                }
                if (stagedFiles.length > 0) {
                    desc.textContent = `${stagedFiles.length} item${stagedFiles.length === 1 ? '' : 's'} staged (${formatBytes(totalBatchSize)}). Share room code with recipient to connect.`;
                } else {
                    desc.textContent = 'Share room code with the recipient, then add files or folders to send.';
                }
            }
        }

        // Folder & File input triggers
        const fileInput = document.getElementById('file-input');
        const folderInput = document.getElementById('folder-input');
        const addFilesBox = document.getElementById('add-files-box');
        const addFoldersBox = document.getElementById('add-folders-box');

        addFilesBox.addEventListener('click', () => fileInput.click());
        addFoldersBox.addEventListener('click', () => folderInput.click());

        fileInput.addEventListener('change', (e) => {
            addFilesToStaging(e.target.files);
            fileInput.value = '';
        });

        folderInput.addEventListener('change', (e) => {
            addFilesToStaging(e.target.files);
            folderInput.value = '';
        });

        document.getElementById('clear-files-btn').addEventListener('click', clearStagedFiles);

        // Recursive Drag and Drop Handling for Files and Folders
        async function readEntryRecursively(entry, path, list) {
            if (entry.isFile) {
                try {
                    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
                    file.displayPath = path ? `${path}/${file.name}` : file.name;
                    list.push(file);
                } catch(e) {
                    console.error("Error reading file entry", e);
                }
            } else if (entry.isDirectory) {
                const dirReader = entry.createReader();
                const readBatch = async () => {
                    const entries = await new Promise((resolve, reject) => dirReader.readEntries(resolve, reject));
                    if (entries.length > 0) {
                        for (const child of entries) {
                            await readEntryRecursively(child, path ? `${path}/${entry.name}` : entry.name, list);
                        }
                        await readBatch();
                    }
                };
                await readBatch();
            }
        }

        async function extractFilesFromDropEvent(e) {
            const list = [];
            const items = e.dataTransfer.items;
            if (items && items.length > 0 && items[0].webkitGetAsEntry) {
                const entries = [];
                for (let i = 0; i < items.length; i++) {
                    const entry = items[i].webkitGetAsEntry();
                    if (entry) entries.push(entry);
                }
                for (const entry of entries) {
                    await readEntryRecursively(entry, '', list);
                }
            } else if (e.dataTransfer.files) {
                for (let i = 0; i < e.dataTransfer.files.length; i++) {
                    list.push(e.dataTransfer.files[i]);
                }
            }
            return list;
        }

        const filesCard = document.getElementById('files-card');
        filesCard.addEventListener('dragover', (e) => {
            e.preventDefault();
            filesCard.classList.add('active-drag');
            addFilesBox.classList.add('active-drag');
            addFoldersBox.classList.add('active-drag');
        });
        filesCard.addEventListener('dragleave', (e) => {
            if (!filesCard.contains(e.relatedTarget)) {
                filesCard.classList.remove('active-drag');
                addFilesBox.classList.remove('active-drag');
                addFoldersBox.classList.remove('active-drag');
            }
        });
        filesCard.addEventListener('drop', async (e) => {
            e.preventDefault();
            filesCard.classList.remove('active-drag');
            addFilesBox.classList.remove('active-drag');
            addFoldersBox.classList.remove('active-drag');
            const files = await extractFilesFromDropEvent(e);
            addFilesToStaging(files);
        });

        document.getElementById('copy-code-btn').addEventListener('click', function() {
            if (senderPin) {
                navigator.clipboard.writeText(senderPin);
                const og = this.innerHTML; this.innerHTML = '<svg class="icon" style="width:16px;height:16px;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied';
                setTimeout(() => { this.innerHTML = og; }, 2000);
            }
        });
        document.getElementById('copy-link-btn').addEventListener('click', function() {
            if (senderPin) {
                const url = `${window.location.origin}${window.location.pathname}#${senderPin}`;
                navigator.clipboard.writeText(url);
                const og = this.innerHTML; this.innerHTML = '<svg class="icon" style="width:16px;height:16px;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied';
                setTimeout(() => { this.innerHTML = og; }, 2000);
            }
        });

        // Send Execution Loop
        document.getElementById('send-btn').addEventListener('click', async () => {
            if (!activeConnection || !activeConnection.open || stagedFiles.length === 0) return;
            const isProtected = senderPwdToggle && senderPwdToggle.checked && senderPwdInput.value.trim().length > 0;
            if (isProtected && !isPeerAuthenticated) {
                requirePeerPasscodeAuth();
                return;
            }
            document.getElementById('send-btn').disabled = true;
            setStatus('send', 'transferring', 'Preparing batch manifest...');
            
            // Build manifest (hash files upfront up to 256MB to provide instant checksum)
            currentManifestFiles = [];
            for (let i = 0; i < stagedFiles.length; i++) {
                const f = stagedFiles[i];
                const fSize = f.actualSize || f.size;
                let hash = null;
                if (fSize <= 256 * 1024 * 1024) { // Pre-hash if <= 256MB
                    try { hash = await computeSHA256(await f.arrayBuffer()); } catch(e){}
                }
                const relPath = f.displayPath || f.webkitRelativePath || f.name;
                currentManifestFiles.push({ name: f.name, path: relPath, size: fSize, mimeType: f.type, sha256: hash });
            }

            setStatus('send', 'waiting', 'Waiting for receiver to accept...');
            sendControl(activeConnection, {
                type: 'manifest',
                totalFiles: stagedFiles.length,
                totalSize: totalBatchSize,
                files: currentManifestFiles
            });
        });

        async function startSequentialTransfer(index) {
            requestWakeLock();
            if (index >= stagedFiles.length) {
                releaseWakeLock();
                sendTracker.stop();
                sendControl(activeConnection, { type: 'batch-complete' });
                setStatus('send', 'connected', 'Batch sent successfully! Session remains connected.');
                updateSenderStatusBox('completed', `All ${stagedFiles.length} item${stagedFiles.length === 1 ? '' : 's'} transferred successfully!`);
                playChime();
                const historyName = stagedFiles.length === 1 ? stagedFiles[0].name : `Batch Folder (${stagedFiles.length} items)`;
                saveHistory(historyName, totalBatchSize, 'Sent');
                
                const sendEtaEl = document.getElementById('send-eta');
                if (sendEtaEl) sendEtaEl.textContent = 'ETA 0s';

                const sendMoreWrap = document.getElementById('send-more-btn-wrap');
                if (sendMoreWrap) sendMoreWrap.style.display = 'block';

                const sendBtn = document.getElementById('send-btn');
                if (sendBtn) sendBtn.disabled = true;

                return;
            }

            const currentFile = stagedFiles[index];
            const fileSize = currentFile.actualSize || currentFile.size;
            let offset = 0;
            let isAborted = false;
            const dc = activeConnection.dataChannel || activeConnection._dc;

            const sendMoreWrap = document.getElementById('send-more-btn-wrap');
            if (sendMoreWrap) sendMoreWrap.style.display = 'none';

            // Surface SHA-256 Checksum badge on sender
            const currentHash = (currentManifestFiles && currentManifestFiles[index]) ? currentManifestFiles[index].sha256 : null;
            if (currentHash) {
                displaySenderChecksum(currentHash);
            }

            setStatus('send', 'transferring', `Sending ${index + 1}/${stagedFiles.length}...`);
            updateSenderStatusBox('transferring', `Streaming "${currentFile.displayPath || currentFile.name}" (${index + 1}/${stagedFiles.length})`);
            document.getElementById('send-stats').style.display = 'flex';
            document.getElementById('send-batch-text').textContent = `File ${index + 1} of ${stagedFiles.length}`;

            // Initialize 1-second interval live diagnostics tracker
            sendTracker.start(fileSize, currentFile.displayPath || currentFile.name);

            sendControl(activeConnection, { type: 'file-start', index: index });

            // Pipeline Optimization (Sender Side):
            // 1. Set RTCDataChannel.binaryType = 'arraybuffer'
            // 2. Set dataChannel.bufferedAmountLowThreshold = 256 * 1024 (256 KB)
            if (dc) {
                dc.binaryType = 'arraybuffer';
                try {
                    dc.bufferedAmountLowThreshold = BACKPRESSURE_LOW;
                } catch(e) {}
            }

            // Async chunk loop checking dataChannel.bufferedAmount
            while (offset < fileSize && !isAborted) {
                if (!activeConnection || !activeConnection.open) {
                    isAborted = true;
                    sendTracker.stop();
                    setStatus('send', 'error', 'Transfer failed: Peer disconnected.');
                    return;
                }

                // Strict backpressure control:
                // If bufferedAmount exceeds 1 MB (1048576 bytes), pause queueing and await 'bufferedamountlow' event
                if (dc && dc.bufferedAmount > BACKPRESSURE_HIGH) {
                    await waitForBackpressureDrain(dc);
                    if (!activeConnection || !activeConnection.open || isAborted) {
                        sendTracker.stop();
                        return;
                    }
                }

                // Slice files into optimal 64KB chunks (65,536 bytes) to fully saturate SCTP MTU without fragmentation
                const chunkEnd = Math.min(offset + CHUNK_SIZE, fileSize);
                const chunkSlice = currentFile.slice(offset, chunkEnd);

                let chunkBuffer;
                try {
                    chunkBuffer = await chunkSlice.arrayBuffer();
                } catch (readErr) {
                    console.error('Error reading slice:', readErr);
                    isAborted = true;
                    sendTracker.stop();
                    setStatus('send', 'error', 'Error reading file chunk from disk.');
                    updateSenderStatusBox('error', 'File read error during transfer.');
                    return;
                }

                if (!activeConnection || !activeConnection.open || isAborted) {
                    sendTracker.stop();
                    return;
                }

                try {
                    sendRawChunk(activeConnection, chunkBuffer);
                    offset = chunkEnd;
                    sendTracker.updateBytes(offset);
                } catch (sendErr) {
                    console.warn('Socket buffer full, awaiting drain:', sendErr);
                    await waitForBackpressureDrain(dc);
                }
            }

            // Await socket buffer to drain completely before sending EOF signal
            while (dc && dc.bufferedAmount > 0 && !isAborted && activeConnection && activeConnection.open) {
                await new Promise(r => setTimeout(r, 15));
            }

            if (!isAborted && activeConnection && activeConnection.open) {
                sendTracker.complete();
                const fileHash = (currentManifestFiles && currentManifestFiles[index]) ? currentManifestFiles[index].sha256 : null;
                if (fileHash) {
                    displaySenderChecksum(fileHash);
                }
                sendControl(activeConnection, { type: 'eof', index: index, sha256: fileHash });
            }
        }

        // --- RECEIVER LOGIC ---
        let receivedManifest = null;
        let dirHandle = null;
        let diskFileHandle = null;
        let diskWriter = null;
        let isDirectDiskStreaming = false;
        let fileWriteQueue = Promise.resolve();
        let isCurrentFileFinished = false;
        let receivedChunks = [];
        let bytesReceived = 0;
        let currentFileData = null;
        let currentFileIndex = 0;

        function updateReceiverStatusBox(state, payload) {
            const title = document.getElementById('receive-box-title');
            const desc = document.getElementById('receive-box-desc');
            const iconWrap = document.getElementById('receive-box-icon-wrap');
            if (!title || !desc) return;

            if (state === 'connecting') {
                title.textContent = 'Connecting...';
                title.style.color = 'var(--status-waiting)';
                if (iconWrap) iconWrap.innerHTML = '<svg class="icon status-box-icon" style="color: var(--status-waiting);" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>';
                desc.textContent = `Reaching peer room ${payload}...`;
            } else if (state === 'connected') {
                title.textContent = 'Connected to Sender';
                title.style.color = 'var(--status-connected)';
                if (iconWrap) iconWrap.innerHTML = '<svg class="icon status-box-icon" style="color: var(--status-connected);" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
                desc.textContent = 'Connected! Waiting for sender to select and push files.';
            } else if (state === 'manifest') {
                title.textContent = 'Incoming Transfer';
                title.style.color = '#38bdf8';
                if (iconWrap) iconWrap.innerHTML = '<svg class="icon status-box-icon" style="color: #38bdf8;" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
                desc.textContent = `Sender prepared ${payload.totalFiles} item${payload.totalFiles === 1 ? '' : 's'} (${formatBytes(payload.totalSize)}). Review and accept below.`;
            } else if (state === 'transferring') {
                title.textContent = `Receiving (${payload.current}/${payload.total})`;
                title.style.color = '#38bdf8';
                if (iconWrap) iconWrap.innerHTML = '<svg class="icon status-box-icon" style="color: #38bdf8;" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>';
                desc.textContent = payload.diskMode 
                    ? `Streaming "${payload.name}" direct-to-disk (Zero RAM).` 
                    : `Downloading "${payload.name}" directly peer-to-peer.`;
            } else if (state === 'completed') {
                title.textContent = 'Download Complete';
                title.style.color = 'var(--status-connected)';
                if (iconWrap) iconWrap.innerHTML = '<svg class="icon status-box-icon" style="color: var(--status-connected);" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
                desc.textContent = 'All files have been received and saved successfully!';
            } else if (state === 'error') {
                title.textContent = 'Connection Issue';
                title.style.color = 'var(--status-error)';
                if (iconWrap) iconWrap.innerHTML = '<svg class="icon status-box-icon" style="color: var(--status-error);" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
                desc.textContent = payload || 'A connection error occurred. Check code and try again.';
            } else {
                title.textContent = 'Direct P2P Download';
                title.style.color = 'var(--text-primary)';
                if (iconWrap) iconWrap.innerHTML = '<svg class="icon status-box-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>';
                desc.textContent = 'Enter the 5-digit code shown on the sender\'s screen to establish a direct WebRTC peer connection.';
            }
        }

        const receiveCodeInput = document.getElementById('receive-code-input');
        if (receiveCodeInput) {
            receiveCodeInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
            });
            receiveCodeInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('connect-btn').click();
                }
            });
        }

        document.getElementById('connect-btn').addEventListener('click', () => {
            const targetId = document.getElementById('receive-code-input').value.trim();
            if (!/^\d{5}$/.test(targetId)) { setStatus('receive', 'error', 'Invalid code.'); return; }
            if (peer && targetId === peer.id) { setStatus('receive', 'error', 'Cannot connect to self.'); return; }

            document.getElementById('receive-code-input').disabled = true;
            document.getElementById('connect-btn').disabled = true;
            setStatus('receive', 'waiting', `Connecting to ${targetId}...`);
            updateReceiverStatusBox('connecting', targetId);

            if (!peer || peer.destroyed) peer = new Peer(undefined, PEER_CONFIG);
            if (!peer.id && !peer.disconnected) {
                const onOpen = () => { establishReceiverConnection(targetId); peer.off('open', onOpen); };
                peer.on('open', onOpen);
            } else {
                establishReceiverConnection(targetId);
            }
        });

        function establishReceiverConnection(targetId) {
            const conn = peer.connect(targetId, { reliable: true, serialization: 'raw' });

            conn.on('open', () => {
                activeConnection = conn;
                const dc = conn.dataChannel || conn._dc;
                if (dc) {
                    dc.binaryType = 'arraybuffer';
                    try { dc.bufferedAmountLowThreshold = BACKPRESSURE_LOW; } catch(e) {}
                }
                setStatus('receive', 'connected', 'Connected! Waiting for sender...');
                updateReceiverStatusBox('connected');
            });

            conn.on('data', async (raw) => {
                let isChunk = false;
                let chunkBuffer = null;

                if (raw instanceof ArrayBuffer) {
                    isChunk = true;
                    chunkBuffer = raw;
                } else if (raw && raw.buffer instanceof ArrayBuffer && typeof raw !== 'string' && !raw.type) {
                    isChunk = true;
                    chunkBuffer = raw.buffer;
                } else if (raw && raw.type === 'chunk') {
                    isChunk = true;
                    chunkBuffer = raw.data instanceof ArrayBuffer ? raw.data : (raw.data && raw.data.buffer ? raw.data.buffer : raw.data);
                } else if (raw instanceof Blob) {
                    isChunk = true;
                    chunkBuffer = await raw.arrayBuffer();
                }

                if (isChunk && chunkBuffer) {
                    const chunkLength = chunkBuffer.byteLength;
                    bytesReceived += chunkLength;
                    receiveTracker.updateBytes(bytesReceived);

                    if (isDirectDiskStreaming && diskWriter) {
                        // Direct-to-Disk Streaming:
                        // Pipe incoming binary chunks directly to disk using writer.write(chunk)
                        fileWriteQueue = fileWriteQueue.then(() => diskWriter.write(chunkBuffer)).catch(err => {
                            console.error('Direct-to-disk write error:', err);
                        });
                    } else {
                        // Graceful fallback to an in-memory chunk array/Blob download if browser does not support File System Access API
                        receivedChunks.push(chunkBuffer);
                    }

                    if (!isCurrentFileFinished && currentFileData && bytesReceived >= currentFileData.size) {
                        isCurrentFileFinished = true;
                        handleFileComplete(currentFileIndex);
                    }
                    return;
                }

                let data = raw;
                if (typeof raw === 'string') {
                    try { data = JSON.parse(raw); } catch(e) { return; }
                }
                if (!data) return;

                if (data.type === 'auth-required') {
                    // Sender requires passcode verification
                    document.getElementById('receive-input-section').style.display = 'none';
                    document.getElementById('receive-password-section').style.display = 'flex';
                    setStatus('receive', 'waiting', 'Sender requires a passcode to unlock files.');
                    updateReceiverStatusBox('connecting', 'Passcode protected transfer. Enter passcode above.');
                    
                    const pwdInput = document.getElementById('receive-pwd-input');
                    const unlockBtn = document.getElementById('unlock-pwd-btn');
                    const eyeBtn = document.getElementById('receiver-eye-btn');
                    
                    if (pwdInput) {
                        pwdInput.value = '';
                        pwdInput.focus();
                        pwdInput.onkeydown = (e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                unlockBtn.click();
                            }
                        };
                    }
                    if (eyeBtn && pwdInput) {
                        eyeBtn.onclick = () => {
                            const isPwd = pwdInput.type === 'password';
                            pwdInput.type = isPwd ? 'text' : 'password';
                            eyeBtn.style.color = isPwd ? 'var(--text-primary)' : 'var(--text-muted)';
                        };
                    }
                    if (unlockBtn) {
                        unlockBtn.onclick = () => {
                            const secret = pwdInput ? pwdInput.value.trim() : '';
                            if (!secret) {
                                setStatus('receive', 'error', 'Please enter the passcode.');
                                return;
                            }
                            setStatus('receive', 'waiting', 'Verifying passcode with sender...');
                            sendControl(conn, { type: 'auth-verify', secret: secret });
                        };
                    }
                }
                else if (data.type === 'auth-success') {
                    document.getElementById('receive-password-section').style.display = 'none';
                    setStatus('receive', 'connected', 'Passcode verified! Waiting for file batch...');
                    updateReceiverStatusBox('connected');
                }
                else if (data.type === 'auth-not-required') {
                    document.getElementById('receive-password-section').style.display = 'none';
                    if (!receivedManifest) {
                        document.getElementById('receive-input-section').style.display = 'block';
                        document.getElementById('receive-idle-view').style.display = 'flex';
                    }
                    setStatus('receive', 'connected', 'Connected! Waiting for sender...');
                    updateReceiverStatusBox('connected');
                }
                else if (data.type === 'auth-fail') {
                    setStatus('receive', 'error', 'Incorrect passcode. Please try again.');
                    const pwdInput = document.getElementById('receive-pwd-input');
                    if (pwdInput) {
                        pwdInput.select();
                        pwdInput.focus();
                    }
                }
                else if (data.type === 'manifest') {
                    receivedManifest = data;
                    document.getElementById('receive-input-section').style.display = 'none';
                    document.getElementById('receive-password-section').style.display = 'none';
                    document.getElementById('receive-action-section').style.display = 'flex';
                    
                    document.getElementById('receive-idle-view').style.display = 'none';
                    document.getElementById('receive-batch-content').style.display = 'flex';

                    document.getElementById('incoming-batch-count').textContent = `${data.totalFiles} file${data.totalFiles === 1 ? '' : 's'}`;
                    document.getElementById('incoming-batch-size').textContent = formatBytes(data.totalSize);
                    
                    const listEl = document.getElementById('incoming-file-list');
                    listEl.innerHTML = '';
                    data.files.forEach(f => {
                        const item = document.createElement('div');
                        item.className = 'file-list-item';
                        const isFolderItem = f.path && f.path.includes('/');
                        const iconSvg = isFolderItem 
                            ? `<svg class="file-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`
                            : `<svg class="file-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
                        
                        const displayName = f.path || f.name;
                        item.innerHTML = `
                            <div class="file-item-left">
                                ${iconSvg}
                                <span class="file-name" title="${displayName}">${displayName}</span>
                            </div>
                            <span class="file-size">${formatBytes(f.size)}</span>
                        `;
                        listEl.appendChild(item);
                    });
                    
                    setStatus('receive', 'waiting', 'Review incoming files...');
                    updateReceiverStatusBox('manifest', data);
                } 
                else if (data.type === 'file-start') {
                    requestWakeLock();
                    currentFileIndex = data.index;
                    currentFileData = receivedManifest.files[data.index];
                    bytesReceived = 0;
                    receivedChunks = [];
                    isCurrentFileFinished = false;
                    fileWriteQueue = Promise.resolve();
                    
                    const rCard = document.getElementById('receive-verification-card');
                    if (rCard) rCard.style.display = 'none';
                    document.getElementById('receive-batch-text').textContent = `File ${data.index + 1} of ${receivedManifest.totalFiles}`;
                    
                    // Initialize 1-second interval live diagnostics tracker
                    receiveTracker.start(currentFileData.size, currentFileData.path || currentFileData.name);
                    updateReceiverStatusBox('transferring', { 
                        current: data.index + 1, 
                        total: receivedManifest.totalFiles, 
                        name: currentFileData.path || currentFileData.name,
                        diskMode: isDirectDiskStreaming 
                    });
                    setStatus('receive', 'transferring', `Receiving file ${data.index + 1}/${receivedManifest.totalFiles}...`);

                    // If multi-file directory handle was chosen, create writable stream for this specific file
                    if (dirHandle) {
                        try {
                            diskWriter = await getOrCreateFileStream(dirHandle, currentFileData.path || currentFileData.name, currentFileData.name);
                            isDirectDiskStreaming = true;
                        } catch(e) {
                            console.warn("Failed to create file handle in directory, falling back to memory:", e);
                            diskWriter = null;
                            isDirectDiskStreaming = false;
                        }
                    }
                }
                else if (data.type === 'eof') {
                    if (data.sha256 && currentFileData) {
                        currentFileData.sha256 = data.sha256;
                    }
                    if (!isCurrentFileFinished) {
                        isCurrentFileFinished = true;
                        handleFileComplete(currentFileIndex);
                    }
                }
                else if (data.type === 'batch-complete') {
                    releaseWakeLock();
                    receiveTracker.complete();
                    setStatus('receive', 'connected', 'Batch downloaded successfully! Session remains connected.');
                    updateReceiverStatusBox('completed', 'All files saved. Peer is connected and ready for more transfers.');
                    playChime();
                    const historyName = receivedManifest.totalFiles === 1 ? receivedManifest.files[0].name : `Batch Folder (${receivedManifest.totalFiles} items)`;
                    saveHistory(historyName, receivedManifest.totalSize, 'Received');
                    const etaEl = document.getElementById('receive-eta');
                    if (etaEl) etaEl.textContent = 'ETA 0s';
                }
                else if (data.type === 'text-relay') {
                    handleIncomingTextRelay(data.content);
                }
            });

            conn.on('close', () => {
                releaseWakeLock();
                stopRouteMonitoring();
                activeConnection = null; setStatus('receive', 'waiting', 'Sender disconnected.');
                updateReceiverStatusBox('error', 'Sender disconnected.');
                resetReceiverUI();
            });
            conn.on('error', () => {
                releaseWakeLock();
                stopRouteMonitoring();
                setStatus('receive', 'error', 'Connection error.');
                updateReceiverStatusBox('error', 'Connection error occurred.');
                resetReceiverUI();
            });
        }

        async function getOrCreateFileStream(rootDir, pathStr, fileName) {
            if (!pathStr || !pathStr.includes('/')) {
                const fh = await rootDir.getFileHandle(fileName, { create: true });
                return await fh.createWritable();
            }
            const parts = pathStr.split('/');
            const actualName = parts.pop() || fileName;
            let currentDir = rootDir;
            for (const part of parts) {
                if (part) {
                    currentDir = await currentDir.getDirectoryHandle(part, { create: true });
                }
            }
            const fh = await currentDir.getFileHandle(actualName, { create: true });
            return await fh.createWritable();
        }

        function resetReceiverUI() {
            releaseWakeLock();
            receiveTracker.stop();
            sendTracker.stop();
            document.getElementById('receive-code-input').disabled = false;
            document.getElementById('connect-btn').disabled = false;
            document.getElementById('receive-input-section').style.display = 'block';
            const pwdSection = document.getElementById('receive-password-section');
            if (pwdSection) pwdSection.style.display = 'none';
            document.getElementById('receive-action-section').style.display = 'none';
            document.getElementById('receive-stats').style.display = 'none';
            document.getElementById('receive-idle-view').style.display = 'flex';
            document.getElementById('receive-batch-content').style.display = 'none';
            dirHandle = null;
            diskFileHandle = null;
            diskWriter = null;
            isDirectDiskStreaming = false;
            fileWriteQueue = Promise.resolve();
            receivedChunks = [];
            updateReceiverStatusBox('idle');
        }

        document.getElementById('reject-batch-btn').addEventListener('click', () => {
            releaseWakeLock();
            document.getElementById('receive-action-section').style.display = 'none';
            document.getElementById('receive-input-section').style.display = 'block';
            const pwdSection = document.getElementById('receive-password-section');
            if (pwdSection) pwdSection.style.display = 'none';
            document.getElementById('receive-idle-view').style.display = 'flex';
            document.getElementById('receive-batch-content').style.display = 'none';
            setStatus('receive', 'connected', 'Transfer rejected. Waiting for new batch...');
            updateReceiverStatusBox('connected');
            if (activeConnection && activeConnection.open) {
                sendControl(activeConnection, { type: 'rejected' });
            }
        });

        document.getElementById('accept-batch-btn').addEventListener('click', async () => {
            document.getElementById('receive-action-section').style.display = 'none';
            document.getElementById('receive-stats').style.display = 'flex';
            setStatus('receive', 'transferring', 'Preparing direct-to-disk stream...');

            diskFileHandle = null;
            diskWriter = null;
            isDirectDiskStreaming = false;
            fileWriteQueue = Promise.resolve();

            // Direct-to-Disk Streaming (Receiver Side):
            // 1. Use the File System Access API (window.showSaveFilePicker) when the transfer is accepted.
            // 2. Create a writable stream (fileHandle.createWritable()).
            // 3. Provide a graceful fallback to in-memory chunk array/Blob download if unsupported or cancelled.
            if ('showSaveFilePicker' in window && receivedManifest && receivedManifest.totalFiles === 1) {
                try {
                    const firstFile = receivedManifest.files[0];
                    const suggestedName = firstFile ? (firstFile.path || firstFile.name) : 'download';
                    diskFileHandle = await window.showSaveFilePicker({
                        suggestedName: suggestedName
                    });
                    diskWriter = await diskFileHandle.createWritable();
                    isDirectDiskStreaming = true;
                    console.log('[FlashPeer] Direct-to-Disk zero-RAM stream initialized via showSaveFilePicker');
                } catch (pickerErr) {
                    console.warn('showSaveFilePicker cancelled or error, falling back to in-memory Blob download:', pickerErr);
                    diskFileHandle = null;
                    diskWriter = null;
                    isDirectDiskStreaming = false;
                }
            } else if (receivedManifest && receivedManifest.totalFiles > 1 && 'showDirectoryPicker' in window) {
                try {
                    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                    isDirectDiskStreaming = true;
                    console.log('[FlashPeer] Direct-to-Disk directory streaming enabled via showDirectoryPicker');
                } catch (err) {
                    console.warn('Directory picker cancelled, falling back to in-memory Blobs:', err);
                    dirHandle = null;
                    isDirectDiskStreaming = false;
                }
            } else if ('showSaveFilePicker' in window && receivedManifest) {
                try {
                    const firstFile = receivedManifest.files[0];
                    const suggestedName = firstFile ? (firstFile.path || firstFile.name) : 'download';
                    diskFileHandle = await window.showSaveFilePicker({
                        suggestedName: suggestedName
                    });
                    diskWriter = await diskFileHandle.createWritable();
                    isDirectDiskStreaming = true;
                } catch (pickerErr) {
                    diskFileHandle = null;
                    diskWriter = null;
                    isDirectDiskStreaming = false;
                }
            } else {
                console.log('[FlashPeer] File System Access API not supported in browser; falling back to in-memory Blob download.');
                isDirectDiskStreaming = false;
            }

            sendControl(activeConnection, { type: 'ready' });
        });

        async function handleFileComplete(index) {
            receiveTracker.complete();

            if (isDirectDiskStreaming && diskWriter) {
                // Direct-to-Disk Streaming:
                // Close the stream (writer.close()) strictly on the transfer completion signal
                try {
                    await fileWriteQueue;
                    await diskWriter.close();
                    console.log('[FlashPeer] Direct-to-disk stream closed cleanly on EOF signal.');
                } catch (err) {
                    console.error("Error finalizing direct-to-disk stream:", err);
                }
                diskWriter = null;

                if (currentFileData && currentFileData.sha256) {
                    displayReceiverChecksum(currentFileData.sha256, true);
                }
            } else {
                // Graceful fallback to an in-memory chunk array/Blob download if browser does not support File System Access API
                try {
                    const blob = new Blob(receivedChunks, { type: currentFileData.mimeType || 'application/octet-stream' });
                    let localHash = null;
                    if (blob.size <= 256 * 1024 * 1024) {
                        try {
                            localHash = await computeSHA256(await blob.arrayBuffer());
                        } catch (hashErr) {}
                    }
                    const targetHash = currentFileData.sha256 || localHash;
                    if (targetHash) {
                        const isMatch = (currentFileData.sha256 && localHash) ? (localHash === currentFileData.sha256) : true;
                        displayReceiverChecksum(targetHash, isMatch);
                    }

                    const downloadUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = downloadUrl;
                    a.download = currentFileData.name;
                    a.style.display = 'none';
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => {
                        document.body.removeChild(a);
                        URL.revokeObjectURL(downloadUrl);
                    }, 3000);
                } catch (e) {
                    console.error('Failed to trigger in-memory Blob download fallback:', e);
                }
            }
            receivedChunks = [];
            
            // Acknowledge file completion so sender proceeds to next file
            sendControl(activeConnection, { type: 'file-ack', index: index });
        }

        // --- PERSISTENT SESSION & CHECKSUM ACTIONS ---
        const sendMoreBtn = document.getElementById('send-more-btn');
        if (sendMoreBtn) {
            sendMoreBtn.addEventListener('click', () => {
                clearStagedFiles();
                document.getElementById('send-stats').style.display = 'none';
                const sCard = document.getElementById('send-verification-card');
                if (sCard) sCard.style.display = 'none';
                const sendMoreWrap = document.getElementById('send-more-btn-wrap');
                if (sendMoreWrap) sendMoreWrap.style.display = 'none';
                const sendBtn = document.getElementById('send-btn');
                if (sendBtn) sendBtn.disabled = true;
                setStatus('send', 'connected', 'Peer connected. Ready for next transfer.');
                updateSenderStatusBox();
            });
        }

        const sendCopyHashBtn = document.getElementById('send-copy-hash-btn');
        if (sendCopyHashBtn) {
            sendCopyHashBtn.addEventListener('click', function() {
                if (lastSenderHash) {
                    navigator.clipboard.writeText(lastSenderHash);
                    const originalText = this.innerHTML;
                    this.innerHTML = '<svg class="icon" style="width:11px;height:11px;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied';
                    setTimeout(() => { this.innerHTML = originalText; }, 2000);
                }
            });
        }

        const receiveCopyHashBtn = document.getElementById('receive-copy-hash-btn');
        if (receiveCopyHashBtn) {
            receiveCopyHashBtn.addEventListener('click', function() {
                if (lastReceiverHash) {
                    navigator.clipboard.writeText(lastReceiverHash);
                    const originalText = this.innerHTML;
                    this.innerHTML = '<svg class="icon" style="width:11px;height:11px;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied';
                    setTimeout(() => { this.innerHTML = originalText; }, 2000);
                }
            });
        }

        // --- INSTANT TEXT & CLIPBOARD RELAY ---
        function showRelayToast(message) {
            const toast = document.getElementById('relay-toast');
            if (!toast) return;
            toast.textContent = message;
            toast.classList.add('show');
            clearTimeout(toast._timeout);
            toast._timeout = setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        }

        function handleIncomingTextRelay(content) {
            if (typeof content !== 'string') return;
            playChime();

            const modal = document.getElementById('text-receive-modal');
            const display = document.getElementById('received-text-display');
            const stats = document.getElementById('received-text-stats');
            const urlActions = document.getElementById('received-url-actions');
            const urlLink = document.getElementById('received-url-link');
            const copyBtn = document.getElementById('copy-received-text-btn');

            if (display) display.textContent = content;
            if (stats) stats.textContent = `${content.length} char${content.length === 1 ? '' : 's'}`;

            // Check if string is a URL
            const trimmed = content.trim();
            const isUrl = /^https?:\/\/[^\s]+$/i.test(trimmed);
            if (urlActions && urlLink) {
                if (isUrl) {
                    urlLink.href = trimmed;
                    urlActions.style.display = 'block';
                } else {
                    urlActions.style.display = 'none';
                }
            }

            if (copyBtn) {
                copyBtn.innerHTML = '<svg class="icon" style="width:15px;height:15px;" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy Text';
            }

            if (modal) modal.style.display = 'flex';
            saveHistory(`Text: "${content.slice(0, 24)}${content.length > 24 ? '...' : ''}"`, content.length, 'Received');
        }

        const openTextRelayBtn = document.getElementById('open-text-relay-btn');
        const textSendModal = document.getElementById('text-send-modal');
        const closeTextSendBtn = document.getElementById('close-text-send-btn');
        const cancelTextSendBtn = document.getElementById('cancel-text-send-btn');
        const textRelayInput = document.getElementById('text-relay-input');
        const textRelayCharCount = document.getElementById('text-relay-char-count');
        const sendTextBtn = document.getElementById('send-text-btn');
        const pasteClipboardBtn = document.getElementById('paste-clipboard-btn');
        const textPeerWarning = document.getElementById('text-peer-warning');

        if (openTextRelayBtn) {
            openTextRelayBtn.addEventListener('click', () => {
                const isConnected = isPeerConnected || (activeConnection && activeConnection.open);
                if (textPeerWarning) {
                    textPeerWarning.style.display = isConnected ? 'none' : 'flex';
                }
                if (sendTextBtn) {
                    sendTextBtn.disabled = !isConnected;
                }
                if (textSendModal) textSendModal.style.display = 'flex';
                if (textRelayInput) {
                    textRelayInput.focus();
                }
            });
        }

        function closeTextSendModal() {
            if (textSendModal) textSendModal.style.display = 'none';
        }

        if (closeTextSendBtn) closeTextSendBtn.addEventListener('click', closeTextSendModal);
        if (cancelTextSendBtn) cancelTextSendBtn.addEventListener('click', closeTextSendModal);

        if (textRelayInput) {
            textRelayInput.addEventListener('input', () => {
                const len = textRelayInput.value.length;
                if (textRelayCharCount) textRelayCharCount.textContent = `${len} char${len === 1 ? '' : 's'}`;
            });
        }

        if (pasteClipboardBtn && textRelayInput) {
            pasteClipboardBtn.addEventListener('click', async () => {
                try {
                    const text = await navigator.clipboard.readText();
                    if (text) {
                        textRelayInput.value = text;
                        const len = text.length;
                        if (textRelayCharCount) textRelayCharCount.textContent = `${len} char${len === 1 ? '' : 's'}`;
                        showRelayToast('Pasted from clipboard!');
                    }
                } catch(e) {
                    showRelayToast('Please press Ctrl+V / Cmd+V to paste');
                }
            });
        }

        if (sendTextBtn) {
            sendTextBtn.addEventListener('click', () => {
                const isConnected = isPeerConnected || (activeConnection && activeConnection.open);
                if (!isConnected) {
                    if (textPeerWarning) textPeerWarning.style.display = 'flex';
                    return;
                }
                const content = textRelayInput.value;
                if (!content || !content.trim()) {
                    showRelayToast('Please enter or paste text to send');
                    return;
                }

                sendControl(activeConnection, {
                    type: 'text-relay',
                    content: content,
                    timestamp: Date.now()
                });

                showRelayToast('⚡ Text beamed to connected peer!');
                saveHistory(`Text: "${content.slice(0, 24)}${content.length > 24 ? '...' : ''}"`, content.length, 'Sent');
                textRelayInput.value = '';
                if (textRelayCharCount) textRelayCharCount.textContent = '0 chars';
                closeTextSendModal();
            });
        }

        // Receive Modal Handlers
        const textReceiveModal = document.getElementById('text-receive-modal');
        const closeTextReceiveBtn = document.getElementById('close-text-receive-btn');
        const doneTextReceiveBtn = document.getElementById('done-text-receive-btn');
        const copyReceivedTextBtn = document.getElementById('copy-received-text-btn');

        function closeTextReceiveModal() {
            if (textReceiveModal) textReceiveModal.style.display = 'none';
        }

        if (closeTextReceiveBtn) closeTextReceiveBtn.addEventListener('click', closeTextReceiveModal);
        if (doneTextReceiveBtn) doneTextReceiveBtn.addEventListener('click', closeTextReceiveModal);

        const replyTextBtn = document.getElementById('reply-text-btn');
        if (replyTextBtn) {
            replyTextBtn.addEventListener('click', () => {
                closeTextReceiveModal();
                if (openTextRelayBtn) openTextRelayBtn.click();
            });
        }

        if (copyReceivedTextBtn) {
            copyReceivedTextBtn.addEventListener('click', function() {
                const display = document.getElementById('received-text-display');
                if (display && display.textContent) {
                    navigator.clipboard.writeText(display.textContent);
                    const og = this.innerHTML;
                    this.innerHTML = '<svg class="icon" style="width:15px;height:15px;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
                    showRelayToast('📋 Copied to clipboard!');
                    setTimeout(() => { this.innerHTML = og; }, 2000);
                }
            });
        }

        if (textSendModal) {
            textSendModal.addEventListener('click', (e) => {
                if (e.target === textSendModal) closeTextSendModal();
            });
        }
        if (textReceiveModal) {
            textReceiveModal.addEventListener('click', (e) => {
                if (e.target === textReceiveModal) closeTextReceiveModal();
            });
        }

        // --- BOOT & AUTO-JOIN ---
        window.addEventListener('DOMContentLoaded', () => {
            initSender();
            const hash = window.location.hash.substring(1);
            if (/^\d{5}$/.test(hash)) {
                switchTab('receive-panel');
                document.getElementById('receive-code-input').value = hash;
                document.getElementById('connect-btn').click();
                window.history.replaceState(null, null, ' ');
            }

            // Check if opened via Web Share Target
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('shared') && 'serviceWorker' in navigator) {
                switchTab('send-panel');
                // Clean URL query param without full reload
                const cleanUrl = window.location.pathname + window.location.hash;
                window.history.replaceState(null, null, cleanUrl);

                // Request pending shared files from service worker
                navigator.serviceWorker.ready.then((registration) => {
                    if (registration.active) {
                        registration.active.postMessage({ type: 'GET_SHARED_FILES' });
                    }
                });
            }
        });

        // Handle incoming files shared from system share sheet via Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'SHARED_FILES' && event.data.files && event.data.files.length > 0) {
                    switchTab('send-panel');
                    addFilesToStaging(event.data.files);
                }
            });
        }

        // --- BRAND LINK & NAVIGATION ---
        const brandLink = document.getElementById('brand-link');
        if (brandLink) {
            brandLink.addEventListener('click', (e) => {
                if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
                    if (!window.location.hash) {
                        e.preventDefault();
                        window.location.reload();
                    }
                }
            });
        }

        // --- SERVICE WORKER REGISTRATION ---
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').catch((err) => {
                    console.warn('SW registration failed:', err);
                });
            });
        }
