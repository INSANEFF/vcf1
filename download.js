// contact-vcf-by-loyalty.js
// CONTACT VCF BY LOYALTY
// Creates a small UI to upload contact files, track counts, and request a VCF from /api/download
// Requirements implemented:
// - Enable download button only if at least 30 contacts have been uploaded
// - On click, fetch the VCF file from /api/download (POSTs parsed contacts as JSON)
// - Display a message if the maximum of 150 users per file is reached
// - Smooth user feedback and notifications (toasts, spinner, transitions)

(function () {
    // Config
    const MIN_REQUIRED = 30;
    const MAX_ALLOWED = 150;
    const API_ENDPOINT = '/api/download';

    // State
    let totalContacts = 0;
    let contacts = []; // array of individual contact strings (vcards or raw rows)

    // Create UI
    const root = document.createElement('div');
    root.id = 'cvbl-root';
    root.innerHTML = `
        <h3>CONTACT VCF BY LOYALTY</h3>
        <div id="cvbl-controls">
            <div id="cvbl-upload-area" class="cvbl-drop">
                <input id="cvbl-file-input" type="file" multiple />
                <div class="cvbl-drop-inner">
                    <p>Drag & drop contact files here or click to browse</p>
                    <small>Supports .vcf and .csv (other files counted as single contacts)</small>
                </div>
            </div>
            <div id="cvbl-meta">
                <div id="cvbl-count">Contacts: <span id="cvbl-count-num">0</span></div>
                <div id="cvbl-hint">Need at least <strong>${MIN_REQUIRED}</strong> contacts to enable download.</div>
                <div id="cvbl-actions">
                    <button id="cvbl-clear" class="cvbl-btn secondary">Clear</button>
                    <button id="cvbl-download" class="cvbl-btn primary" disabled>Download VCF</button>
                </div>
            </div>
        </div>
        <div id="cvbl-toast-container"></div>
    `;
    // Minimal styles inserted for UX
    const style = document.createElement('style');
    style.textContent = `
        #cvbl-root{font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:700px;padding:14px;border:1px solid #e1e4e8;border-radius:8px;background:#fff}
        #cvbl-root h3{margin:0 0 8px 0;font-size:16px}
        #cvbl-controls{display:flex;gap:12px;align-items:flex-start}
        #cvbl-upload-area{flex:1;border:2px dashed #cfd8dc;border-radius:6px;padding:12px;position:relative;cursor:pointer;transition:background .2s,border-color .15s}
        #cvbl-upload-area.cvbl-dragover{background:#f1f8ff;border-color:#3b82f6}
        #cvbl-upload-area input[type=file]{position:absolute;inset:0;opacity:0;padding:0;margin:0;cursor:pointer}
        .cvbl-drop-inner{pointer-events:none;text-align:center;color:#374151}
        #cvbl-meta{width:260px;display:flex;flex-direction:column;gap:8px}
        #cvbl-count{font-weight:600}
        #cvbl-hint{font-size:12px;color:#6b7280}
        .cvbl-btn{padding:8px 12px;border-radius:6px;border:1px solid transparent;cursor:pointer}
        .cvbl-btn.primary{background:#0b5fff;color:white}
        .cvbl-btn.primary:disabled{opacity:.6;cursor:not-allowed}
        .cvbl-btn.secondary{background:#fff;border-color:#d1d5db;color:#111827}
        #cvbl-toast-container{position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:flex-end}
        .cvbl-toast{background:#111827;color:white;padding:10px 14px;border-radius:8px;box-shadow:0 6px 18px rgba(2,6,23,.2);opacity:0;transform:translateY(10px);transition:opacity .25s,transform .25s}
        .cvbl-toast.show{opacity:1;transform:translateY(0)}
        .cvbl-toast.info{background:#374151}
        .cvbl-toast.success{background:#059669}
        .cvbl-toast.warn{background:#b45309}
        .cvbl-toast.error{background:#b91c1c}
        .cvbl-spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:rgba(255,255,255,1);border-radius:50%;animation:cvbl-spin .8s linear infinite;margin-left:8px}
        @keyframes cvbl-spin{to{transform:rotate(360deg)}}
    `;
    document.head.appendChild(style);
    document.body.appendChild(root);

    // Element refs
    const uploadArea = document.getElementById('cvbl-upload-area');
    const fileInput = document.getElementById('cvbl-file-input');
    const countNum = document.getElementById('cvbl-count-num');
    const hint = document.getElementById('cvbl-hint');
    const downloadBtn = document.getElementById('cvbl-download');
    const clearBtn = document.getElementById('cvbl-clear');
    const toastContainer = document.getElementById('cvbl-toast-container');

    // Helpers: Toast notifications
    function toast(message, type = 'info', timeout = 4000) {
        const t = document.createElement('div');
        t.className = `cvbl-toast ${type}`;
        t.textContent = message;
        toastContainer.appendChild(t);
        // Allow CSS transition
        requestAnimationFrame(() => t.classList.add('show'));
        if (timeout > 0) setTimeout(() => dismissToast(t), timeout);
        return t;
    }
    function dismissToast(el) {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 300);
    }

    // Parsing uploaded files into contact items and counts
    function parseFileToContacts(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
                const text = String(reader.result || '');
                const lower = text.toLowerCase();
                let items = [];
                if (lower.includes('begin:vcard')) {
                    // split on begin markers and re-add BEGIN: to each chunk
                    const chunks = text.split(/BEGIN:VCARD/i).map(s => s.trim()).filter(Boolean);
                    items = chunks.map(c => 'BEGIN:VCARD\r\n' + c); // preserve block
                } else if (file.name.toLowerCase().endsWith('.csv') || text.includes(',')) {
                    // naive CSV: count non-empty lines; treat first line as header if more than 1 line
                    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                    if (lines.length === 0) items = [];
                    else if (lines.length === 1) items = [lines[0]];
                    else {
                        // assume header present: skip first
                        const dataLines = lines.slice(1);
                        items = dataLines;
                    }
                } else {
                    // unknown file: count as single contact (raw)
                    items = [text || file.name || 'unknown'];
                }
                resolve(items);
            };
            reader.onerror = () => resolve([]);
            reader.readAsText(file, 'utf-8');
        });
    }

    // Update UI state when contacts change
    function updateState() {
        countNum.textContent = totalContacts;
        if (totalContacts === 0) {
            hint.textContent = `Need at least ${MIN_REQUIRED} contacts to enable download.`;
            downloadBtn.disabled = true;
            downloadBtn.textContent = 'Download VCF';
        } else if (totalContacts < MIN_REQUIRED) {
            hint.textContent = `Only ${totalContacts} contacts — need ${MIN_REQUIRED - totalContacts} more to enable download.`;
            downloadBtn.disabled = true;
            downloadBtn.textContent = `Download VCF (${totalContacts}/${MIN_REQUIRED})`;
        } else {
            hint.textContent = `Ready: ${totalContacts} contacts (max ${MAX_ALLOWED}).`;
            downloadBtn.disabled = false;
            downloadBtn.textContent = `Download VCF (${totalContacts})`;
        }
        // If reached/over max, show warning and clamp
        if (totalContacts >= MAX_ALLOWED) {
            if (totalContacts > MAX_ALLOWED) {
                // clamp arrays
                contacts = contacts.slice(0, MAX_ALLOWED);
                totalContacts = contacts.length;
            }
            toast(`Maximum of ${MAX_ALLOWED} users per file reached — only first ${MAX_ALLOWED} will be included.`, 'warn', 7000);
            hint.textContent = `Maximum of ${MAX_ALLOWED} contacts allowed.`;
            downloadBtn.textContent = `Download VCF (${totalContacts})`;
        }
    }

    // Add files handler
    async function handleFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        const files = Array.from(fileList);
        // Parse sequentially to avoid huge memory spikes
        for (const f of files) {
            const items = await parseFileToContacts(f);
            if (!items || items.length === 0) continue;
            // If adding would exceed MAX_ALLOWED, trim and notify
            const available = MAX_ALLOWED - totalContacts;
            if (available <= 0) {
                toast(`Cannot add more contacts: already reached ${MAX_ALLOWED}.`, 'warn');
                break;
            }
            if (items.length > available) {
                const keep = items.slice(0, available);
                contacts.push(...keep);
                totalContacts += keep.length;
                toast(`File "${f.name}" partially added: only ${keep.length} of ${items.length} fit before reaching ${MAX_ALLOWED}.`, 'warn', 8000);
                break; // reached max, stop processing further files
            } else {
                contacts.push(...items);
                totalContacts += items.length;
                toast(`Added ${items.length} contacts from "${f.name}".`, 'info');
            }
        }
        updateState();
    }

    // Drag/drop support
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('cvbl-dragover');
    });
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('cvbl-dragover');
    });
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('cvbl-dragover');
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length) handleFiles(dt.files);
    });
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        // reset value so same file can be re-selected later
        fileInput.value = '';
    });

    // Clear handler
    clearBtn.addEventListener('click', () => {
        contacts = [];
        totalContacts = 0;
        updateState();
        toast('Contacts cleared.', 'info', 2000);
    });

    // Download handler: send contacts to API and download returned VCF blob
    downloadBtn.addEventListener('click', async () => {
        if (downloadBtn.disabled) return;
        downloadBtn.disabled = true;
        const spinner = document.createElement('span');
        spinner.className = 'cvbl-spinner';
        downloadBtn.appendChild(spinner);

        try {
            // POST parsed contacts to API; server expected to return VCF blob
            const payload = { contacts: contacts.slice(0, MAX_ALLOWED) };
            const resp = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!resp.ok) {
                const text = await resp.text().catch(() => '');
                throw new Error(text || `Server returned ${resp.status}`);
            }

            const blob = await resp.blob();
            if (!blob || blob.size === 0) throw new Error('Empty file received');

            // Determine filename from content-disposition header if present
            let filename = 'contacts.vcf';
            const cd = resp.headers.get('content-disposition') || '';
            const match = cd.match(/filename\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/i);
            if (match) filename = decodeURIComponent(match[1] || match[2] || filename);

            // Trigger download
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            toast(`VCF downloaded (${totalContacts} contacts).`, 'success', 5000);
        } catch (err) {
            console.error(err);
            toast(`Download failed: ${err.message || err}`, 'error', 7000);
        } finally {
            spinner.remove();
            updateState();
        }
    });

    // Initial state
    updateState();

    // Expose a minimal API on window for testing/debugging
    window.cvbl = {
        getTotal: () => totalContacts,
        getContacts: () => contacts.slice(),
        reset: () => {
            contacts = [];
            totalContacts = 0;
            updateState();
        }
    };
})();