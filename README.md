# FlashPeer

FlashPeer is a fast, end-to-end encrypted peer-to-peer file and text transfer web application that runs directly in the browser. It allows two devices to transfer files of any size directly to each other without uploading anything to cloud servers or third-party storage.

***Live Site:*** [https://flashpeer.pages.dev/](https://flashpeer.pages.dev/))

---

> ### ⚠️ Project Disclaimer
> **This is strictly a non-commercial, educational hobby project.** 
> **All application architecture, user interface design, logic, and source code in this repository were completely generated using Artificial Intelligence (AI).** It is maintained solely for learning, personal experimentation, and prototyping purposes.

---

## Core Capabilities & Features

### 1. Direct Browser-to-Browser P2P Transfers
- All transfers travel directly between peers over WebRTC data channels.
- Files never touch an intermediate storage server, database, or cloud bucket.
- Unlimited file sizes with zero cloud bandwidth caps.

### 2. End-to-End Encryption
- All data streams are encrypted at the transport layer using WebRTC DTLS (Datagram Transport Layer Security) with AES-GCM encryption.
- Direct peer connections ensure eavesdroppers, network operators, and signaling servers cannot inspect or intercept payloads.

### 3. Zero-RAM Direct-to-Disk Streaming
- Uses the modern File System Access API (`window.showSaveFilePicker`) on supported browsers (Chrome, Edge, Brave, Opera).
- Incoming data chunks are piped directly to disk through a writable stream as they arrive.
- Transfers gigabytes of data without buffering in browser memory, eliminating memory leaks and browser tab crashes.
- Automatically falls back to in-memory Blob assembly and direct download for browsers that do not support disk streaming (Firefox, Safari).

### 4. High-Throughput SCTP Backpressure Control
- Files are sliced into optimal 64 KB (`65,536 bytes`) chunks to match SCTP MTU envelopes without packet fragmentation penalties.
- Adaptive backpressure engine monitors data channel buffer levels, pausing transmission if outbound queues exceed 1 MB and resuming immediately on the low-watermark threshold (256 KB) to prevent packet loss.

### 5. Instant Text and Link Relay
- Integrated modal for sending formatted text, raw notes, or URLs instantly between devices.
- Direct one-click URL opening and copy-to-clipboard functionality.

### 6. Seamless Device Pairing
- Instant 6-character room codes for quick manual entry.
- Dynamic QR code generation for camera pairing between mobile devices and desktop computers.
- Shareable direct connection URLs.

### 7. Real-Time Diagnostics & Progress Engine
- Continuous 1-second sampling diagnostics displaying live transfer speeds in Megabytes per second (MB/s).
- Accurate time remaining (ETA) calculations based on rolling average throughput.
- Live progress percentages, byte counters, and transfer status indicators.

### 8. Mobile Screen Wake Lock
- Utilizes the Screen Wake Lock API during active transfers.
- Keeps mobile and tablet displays active while transfers are underway to prevent operating systems from suspending network tasks or throttling background Wi-Fi.

### 9. Progressive Web App (PWA) & Offline Shell
- Includes a service worker (`sw.js`) and Web App Manifests for installation as a standalone app on iOS, Android, and Desktop.
- Static application shell loads instantly and functions offline.

### 10. Dedicated Documentation Pages
- Integrated sub-routes for FAQ (`/FAQ`), Privacy Policy (`/PrivacyPolicy`), and Terms of Service (`/TermsOfService`).
- Includes edge-routing configuration (`_redirects`) for clean URLs on hosts like Cloudflare Pages.

---

## How It Works

1. **Signaling**: Devices exchange ephemeral WebRTC session descriptions (SDP) and ICE candidates using an open PeerJS signaling broker.
2. **Direct Connection**: Once the peer-to-peer handshake completes, the signaling channel is bypassed.
3. **Data Channel Streaming**: Raw binary ArrayBuffers travel directly between the two browser runtimes over encrypted SCTP channels.
4. **Disk Writing**: On the receiver side, chunks are written asynchronously to the user's selected file path on the local filesystem.

---

## Browser Compatibility
- **Direct-to-Disk Zero-RAM Streaming:** Chrome 86+, Edge 86+, Brave, Opera (Desktop & Android with File System Access API).
- **WebRTC P2P Transfer & In-Memory Fallback:** Chrome, Firefox, Safari, Edge, Android Chrome, iOS Safari 15+.
- **Screen Wake Lock:** Chrome, Edge, Safari 16.4+.
