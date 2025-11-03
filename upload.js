// vcf-uploader.js
// Modular script to handle "CONTACT VCF BY LOYALTY" form submissions
// Usage:
// - Ensure HTML has elements with these IDs (or this script will create them):
//   #vcf-form, #vcf-name, #vcf-phone, #vcf-submit, #vcf-message, #vcf-counter, #vcf-download-btn
// - Configure endpoints via VCFUploader.configure({ uploadUrl, countUrl })

(function (global) {
    const STORAGE_KEY_PHONE = 'vcf_uploads_by_phone';
    const STORAGE_KEY_COUNT = 'vcf_current_uploads';

    // Default endpoints (override with configure)
    let config = {
        uploadUrl: '/api/upload', // POST { name, phone }
        countUrl: '/api/uploads/count', // GET -> { count: number } recommended
        pollIntervalMs: 30000
    };

    // Utilities
    function qs(id) {
        return document.getElementById(id);
    }

    function safeParseInt(v, fallback = 0) {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : fallback;
    }

    function normalizePhone(phone) {
        // Basic normalization: remove non-digits, keep leading +
        return (phone || '').toString().trim().replace(/[^\d+]/g, '');
    }

    // Local storage helpers
    function readPhoneMap() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_PHONE);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function writePhoneMap(map) {
        try {
            localStorage.setItem(STORAGE_KEY_PHONE, JSON.stringify(map));
        } catch (e) {
            // ignore
        }
    }

    function getLocalCount() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_COUNT);
            return safeParseInt(raw, 0);
        } catch {
            return 0;
        }
    }

    function setLocalCount(n) {
        try {
            localStorage.setItem(STORAGE_KEY_COUNT, String(n));
        } catch (e) {
            // ignore
        }
    }

    // DOM helpers
    function createFallbackUI() {
        // Create minimal UI if not present
        if (!qs('vcf-form')) {
            const container = document.createElement('div');
            container.id = 'vcf-uploader-container';
            container.innerHTML = `
                <form id="vcf-form" style="margin:8px;padding:8px;border:1px solid #ddd;max-width:420px;">
                    <label style="display:block;margin-bottom:6px;">Name<br><input id="vcf-name" name="name" required style="width:100%"></label>
                    <label style="display:block;margin-bottom:6px;">Phone<br><input id="vcf-phone" name="phone" required style="width:100%"></label>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <button id="vcf-submit" type="submit">Upload VCF</button>
                        <button id="vcf-download-btn" type="button" disabled>Download (locked)</button>
                        <div id="vcf-counter" style="margin-left:auto;font-size:0.9rem;color:#333;">Uploads: 0</div>
                    </div>
                    <div id="vcf-message" style="margin-top:8px;color:green;"></div>
                </form>
            `;
            document.body.appendChild(container);
        } else {
            // Ensure needed elements exist
            if (!qs('vcf-name')) {
                const name = document.createElement('input');
                name.id = 'vcf-name';
                name.name = 'name';
                qs('vcf-form').prepend(name);
            }
            if (!qs('vcf-phone')) {
                const phone = document.createElement('input');
                phone.id = 'vcf-phone';
                phone.name = 'phone';
                qs('vcf-form').prepend(phone);
            }
            if (!qs('vcf-submit')) {
                const btn = document.createElement('button');
                btn.id = 'vcf-submit';
                btn.type = 'submit';
                btn.textContent = 'Upload VCF';
                qs('vcf-form').appendChild(btn);
            }
            if (!qs('vcf-message')) {
                const m = document.createElement('div');
                m.id = 'vcf-message';
                qs('vcf-form').appendChild(m);
            }
            if (!qs('vcf-counter')) {
                const c = document.createElement('div');
                c.id = 'vcf-counter';
                c.textContent = 'Uploads: 0';
                qs('vcf-form').appendChild(c);
            }
            if (!qs('vcf-download-btn')) {
                const d = document.createElement('button');
                d.id = 'vcf-download-btn';
                d.type = 'button';
                d.disabled = true;
                d.textContent = 'Download (locked)';
                qs('vcf-form').appendChild(d);
            }
        }
    }

    function showMessage(text, isError = false) {
        const msg = qs('vcf-message');
        if (!msg) return;
        msg.style.color = isError ? 'crimson' : 'green';
        msg.textContent = text;
        // auto-clear on success after a few seconds
        if (!isError) {
            setTimeout(() => {
                if (msg) msg.textContent = '';
            }, 5000);
        }
    }

    function updateCounterDisplay(count) {
        const counter = qs('vcf-counter');
        if (!counter) return;
        counter.textContent = `Uploads: ${count}`;
    }

    function setDownloadButtonEnabled(enabled) {
        const btn = qs('vcf-download-btn');
        if (!btn) return;
        btn.disabled = !enabled;
        btn.textContent = enabled ? 'Download VCFs' : 'Download (locked)';
    }

    // Backend connectors (can be replaced via configure)
    async function postUpload(payload) {
        // POST JSON to configured uploadUrl. Returns object { success: bool, count?: number, message?: string }
        try {
            const res = await fetch(config.uploadUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const text = await res.text();
                return { success: false, message: text || res.statusText };
            }
            const json = await res.json().catch(() => ({}));
            return { success: true, ...json };
        } catch (err) {
            return { success: false, message: err.message || 'Network error' };
        }
    }

    async function fetchCountFromServer() {
        try {
            const res = await fetch(config.countUrl, { method: 'GET' });
            if (!res.ok) return null;
            const json = await res.json();
            if (json && typeof json.count === 'number') return json.count;
            return null;
        } catch {
            return null;
        }
    }

    // Core logic
    async function handleSubmit(event) {
        event.preventDefault();
        const nameEl = qs('vcf-name');
        const phoneEl = qs('vcf-phone');
        if (!nameEl || !phoneEl) return;

        const name = (nameEl.value || '').trim();
        const phoneRaw = (phoneEl.value || '').trim();
        const phone = normalizePhone(phoneRaw);

        if (!name) {
            showMessage('Name is required.', true);
            return;
        }
        if (!phone) {
            showMessage('Phone is required.', true);
            return;
        }

        // Check local upload count per phone
        const map = readPhoneMap();
        const existing = safeParseInt(map[phone], 0);
        if (existing >= 2) {
            showMessage('This phone number has already uploaded twice. Cannot upload more.', true);
            return;
        }

        // Disable submit to prevent double-click
        const submitBtn = qs('vcf-submit');
        if (submitBtn) submitBtn.disabled = true;

        // Send to backend
        const result = await postUpload({ name, phone });

        if (!result.success) {
            showMessage(result.message || 'Upload failed.', true);
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        // Success: update local tracking
        map[phone] = existing + 1;
        writePhoneMap(map);

        // Update current uploads count
        // Prefer server-provided count if available; otherwise increment local cached count
        const serverCount = typeof result.count === 'number' ? result.count : null;
        let current = serverCount !== null ? result.count : getLocalCount() + 1;
        setLocalCount(current);
        updateCounterDisplay(current);

        showMessage('Upload successful.');

        // Update download button lock status
        setDownloadButtonEnabled(current >= 30);

        if (submitBtn) submitBtn.disabled = false;
        // Optional: clear form fields
        // nameEl.value = '';
        // phoneEl.value = '';
    }

    // Public init
    let pollTimer = null;
    async function refreshCount() {
        // Attempt to fetch from server; fallback to local cached count
        const server = await fetchCountFromServer();
        const current = server !== null ? server : getLocalCount();
        setLocalCount(current);
        updateCounterDisplay(current);
        setDownloadButtonEnabled(current >= 30);
    }

    function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(refreshCount, config.pollIntervalMs);
    }

    function stopPolling() {
        if (!pollTimer) return;
        clearInterval(pollTimer);
        pollTimer = null;
    }

    function configure(opts = {}) {
        config = Object.assign(config, opts);
    }

    function init(opts = {}) {
        configure(opts);
        document.addEventListener('DOMContentLoaded', () => {
            createFallbackUI();
            const form = qs('vcf-form');
            if (form) form.addEventListener('submit', handleSubmit);
            const downloadBtn = qs('vcf-download-btn');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', () => {
                    // Hook for download: replace with actual behavior when ready
                    const count = getLocalCount();
                    if (count < 30) {
                        showMessage('Download locked until at least 30 uploads exist.', true);
                        return;
                    }
                    showMessage('Download starting...');
                    // Placeholder: implement actual download flow
                    // e.g., window.location.href = '/api/download/all-vcfs'
                });
            }

            // Initialize display from server or local
            refreshCount();
            startPolling();
        });
    }

    // Expose API
    const VCFUploader = {
        init,
        configure,
        refreshCount,
        stopPolling,
        readPhoneMap, // useful for diagnostics
        getLocalCount
    };

    // Attach to global
    global.VCFUploader = VCFUploader;

    // Auto-init with defaults (will wait for DOMContentLoaded)
    VCFUploader.init();

})(typeof window !== 'undefined' ? window : this);