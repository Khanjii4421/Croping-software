// ============================================================
//  GIF / Archive Cropper  –  app.js
// ============================================================

// ── State ────────────────────────────────────────────────────
let cropper          = null;
let currentObjectUrl = null;

// Direct-GIF mode (legacy)
let gifFiles        = [];
let currentFileIndex = 0;

// Archive mode
let archiveFiles         = [];   // File objects for the archives
let currentArchiveIndex  = 0;
let archiveStepMap       = {};   // { stepIndex: { url, filename } }
let archiveBaseName      = '';
let archiveMode          = false;
let uploadedFolderName   = '';

// Common
let currentCropIndex = 1;        // 1–8
let currentCrops     = [];       // [ { filename, blob } ]
let dlCount          = 0;
let outputDirHandle  = null;
let currentLoadedImageSrc = null;

// User's preferred order: L1, L2, L3, L4, then R1, R2, R3, R4
const CROP_LABELS   = { 
    1: 'L1', 2: 'L2', 3: 'L3', 4: 'L4', 
    5: 'R1', 6: 'R2', 7: 'R3', 8: 'R4' 
};
const CROP_SUFFIXES = CROP_LABELS;

// ── UI References ────────────────────────────────────────────
const UI = {
    folderInput:        document.getElementById('folderInput'),
    totalGifs:          document.getElementById('totalGifs'),
    completedGifs:      document.getElementById('completedGifs'),
    remainingGifs:      document.getElementById('remainingGifs'),
    currentFileName:    document.getElementById('currentFileName'),
    cropTargetName:     document.getElementById('cropTargetName'),
    nextCropLabel:      document.getElementById('nextCropLabel'),
    btnCrop:            document.getElementById('btnCrop'),
    btnSkip:            document.getElementById('btnSkip'),
    image:              document.getElementById('image'),
    placeholder:        document.querySelector('.placeholder-content'),
    cropStepsContainer: document.querySelector('.crop-steps'),
    downloadLinks:      document.getElementById('downloadLinks'),
    downloadCount:      document.getElementById('downloadCount'),
    themeToggle:        document.getElementById('themeToggle'),
    themeIcon:          document.getElementById('themeIcon'),
    sidebarToggle:      document.getElementById('sidebarToggle'),
    sidebar:            document.querySelector('.sidebar'),
    sidebarToggleIcon:  document.getElementById('sidebarToggleIcon'),
    btnUndo:            document.getElementById('btnUndo'),
    body:               document.body,
    btnFinalize:        document.getElementById('btnFinalize'),
    lastCropContainer:  document.getElementById('lastCropContainer'),
    lastCropImg:        document.getElementById('lastCropImg'),
    selectOutputDirBtn: document.getElementById('selectOutputDirBtn'),
    outputPathDisplay:  document.getElementById('outputPathDisplay'),
    resetAppBtn:        document.getElementById('resetAppBtn'),
    oldMethodCheckbox:  document.getElementById('oldMethodCheckbox')
};

// ── Toast Helper ──────────────────────────────────────────────
const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true
});

// ── Theme ─────────────────────────────────────────────────────
(function applyTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    if (saved === 'light') {
        document.body.classList.add('light-theme');
        UI.themeIcon.classList.replace('fa-sun', 'fa-moon');
    } else {
        document.body.classList.remove('light-theme');
        UI.themeIcon.classList.replace('fa-moon', 'fa-sun');
    }
})();

UI.themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    if (document.body.classList.contains('light-theme')) {
        UI.themeIcon.classList.replace('fa-sun',  'fa-moon');
        localStorage.setItem('theme', 'light');
    } else {
        UI.themeIcon.classList.replace('fa-moon', 'fa-sun');
        localStorage.setItem('theme', 'dark');
    }
});

// ── Sidebar Toggle ────────────────────────────────────────────
UI.sidebarToggle.addEventListener('click', () => {
    UI.sidebar.classList.toggle('hidden');
    const icon = UI.sidebarToggleIcon;
    if (UI.sidebar.classList.contains('hidden')) {
        icon.classList.replace('fa-chevron-left',  'fa-chevron-right');
    } else {
        icon.classList.replace('fa-chevron-right', 'fa-chevron-left');
    }
    setTimeout(() => { if (cropper) cropper.resize(); }, 400);
});

// ── IndexedDB Session Persistence ─────────────────────────────
const DB_NAME   = 'GIFCropperSession';
const DB_VERSION = 1;
const STORE_NAME = 'workspaceData';
let db;

function openDatabase() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME);
        };
        req.onsuccess = e => { db = e.target.result; resolve(db); };
        req.onerror   = e => reject(e.target.error);
    });
}

function saveSessionState() {
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const s  = tx.objectStore(STORE_NAME);
    s.put(gifFiles,        'gifFiles');
    s.put(currentFileIndex,'currentFileIndex');
    s.put(localStorage.getItem('original_total_gifs'), 'originalTotal');
}

async function loadSessionState() {
    await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const s  = tx.objectStore(STORE_NAME);
        const r1 = s.get('gifFiles');
        const r2 = s.get('currentFileIndex');
        const r3 = s.get('originalTotal');
        let loadedFiles = [], loadedIndex = 0, loadedTotal = '0';
        r1.onsuccess = () => loadedFiles = r1.result || [];
        r2.onsuccess = () => loadedIndex = r2.result || 0;
        r3.onsuccess = () => loadedTotal = r3.result || '0';
        tx.oncomplete = () => resolve(loadedFiles.length > 0 ? { files: loadedFiles, index: loadedIndex, total: loadedTotal } : null);
        tx.onerror    = e  => reject(e.target.error);
    });
}

function clearSessionState() {
    if (!db) return;
    db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear();
}

// Restore session on load (direct-gif mode only)
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const session = await loadSessionState();
        if (session && session.files.length > 0) {
            Toast.fire({ icon: 'info', title: 'Session Restored! Re-select Save Folder if you used one.' });
            gifFiles        = session.files;
            currentFileIndex = session.index;
            localStorage.setItem('original_total_gifs', session.total);
            archiveMode      = false;
            currentCropIndex = 1;
            currentCrops     = [];
            dlCount          = 0;
            UI.downloadCount.textContent = '0';
            UI.downloadLinks.innerHTML   = '';
            updateCounters();
            loadCurrentImage();
        }
    } catch (e) { console.error('Failed to restore session', e); }
});

// ── Output Directory Picker ───────────────────────────────────
if (UI.selectOutputDirBtn) {
    if ('showDirectoryPicker' in window) {
        UI.selectOutputDirBtn.addEventListener('click', async () => {
            try {
                outputDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                if ((await outputDirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                    if ((await outputDirHandle.requestPermission({ mode: 'readwrite' })) !== 'granted')
                        throw new Error('Permission not granted');
                }
                UI.outputPathDisplay.textContent = `Saving to: ${outputDirHandle.name}`;
                UI.outputPathDisplay.style.color  = 'var(--primary-color)';
                Toast.fire({ icon: 'success', title: 'Local save folder connected!' });
            } catch (err) {
                console.error('Dir picker error:', err);
                UI.outputPathDisplay.textContent = 'Folder selection cancelled or denied';
                UI.outputPathDisplay.style.color  = 'var(--accent-r)';
            }
        });
    } else {
        UI.selectOutputDirBtn.style.display = 'none';
        UI.outputPathDisplay.textContent = 'Your browser does not support automatic local saving.';
    }
}

// ── Old Method Checkbox Toggle ────────────────────────────────
if (UI.oldMethodCheckbox) {
    UI.oldMethodCheckbox.addEventListener('change', () => {
        const isOldMethod = UI.oldMethodCheckbox.checked;
        const uploadLabel = document.querySelector('label[for="folderInput"]');
        if (isOldMethod) {
            UI.folderInput.removeAttribute('webkitdirectory');
            UI.folderInput.removeAttribute('directory');
            if (uploadLabel) {
                uploadLabel.innerHTML = '<i class="fas fa-file-upload"></i> Upload Files';
            }
        } else {
            UI.folderInput.setAttribute('webkitdirectory', '');
            UI.folderInput.setAttribute('directory', '');
            if (uploadLabel) {
                uploadLabel.innerHTML = '<i class="fas fa-folder-open"></i> Upload Folder';
            }
        }
        UI.folderInput.value = '';
    });
}

// ── Crop-Steps UI ─────────────────────────────────────────────
function initCropStepsUI() {
    UI.cropStepsContainer.innerHTML = '';
    for (let i = 1; i <= 8; i++) {
        const div = document.createElement('div');
        div.className  = `step-box step-${i}`;
        div.textContent = CROP_LABELS[i];
        UI.cropStepsContainer.appendChild(div);
    }
}
initCropStepsUI();

function updateCropStepsUI() {
    for (let i = 1; i <= 8; i++) {
        const div = document.querySelector(`.step-${i}`);
        if (!div) continue;
        div.className = `step-box step-${i}`;

        if (archiveMode) {
            // Dim steps that have no image in this archive
            if (!archiveStepMap[i]) {
                div.classList.add('step-unavailable');
                continue;
            }
        }

        if (i < currentCropIndex) {
            // Steps 1-4 (L1-L4) completed-l (green). Steps 5-8 (R1-R4) completed-r (red)
            div.classList.add(i <= 4 ? 'completed-l' : 'completed-r');
        } else if (i === currentCropIndex) {
            div.classList.add('active');
        }
    }

    if (currentCropIndex <= 8) {
        UI.cropTargetName.innerHTML = `Action: Select &amp; Crop <b>${CROP_LABELS[currentCropIndex]}</b>`;
        UI.nextCropLabel.textContent = CROP_LABELS[currentCropIndex];
    }
    updateUndoButtonState();
}

// ── File Input Handler ────────────────────────────────────────
UI.folderInput.addEventListener('change', async (e) => {
    const allFiles = Array.from(e.target.files);
    const isOldMethod = UI.oldMethodCheckbox && UI.oldMethodCheckbox.checked;
    
    const archives = allFiles.filter(f => /\.(zip|rar)$/i.test(f.name));
    const validImages = isOldMethod 
        ? allFiles.filter(f => /\.(gif|png|jpe?g|webp|bmp)$/i.test(f.name))
        : allFiles.filter(f => f.name.toLowerCase().endsWith('.gif'));

    if (allFiles.length > 0 && allFiles[0].webkitRelativePath) {
        uploadedFolderName = allFiles[0].webkitRelativePath.split('/')[0];
    } else {
        uploadedFolderName = isOldMethod ? 'Selected Files' : 'Workspace';
    }

    if (archives.length > 0 && !isOldMethod) {
        // ── ARCHIVE MODE ──
        archiveMode          = true;
        archiveFiles         = archives;
        currentArchiveIndex  = 0;
        archiveStepMap       = {};
        currentCropIndex     = 1;
        currentCrops         = [];
        dlCount              = 0;
        UI.downloadCount.textContent = '0';
        UI.downloadLinks.innerHTML   = '';
        updateCounters();
        Toast.fire({ icon: 'info', title: `Loaded ${archives.length} archive(s). Extracting first…` });
        loadCurrentImage();

    } else if (validImages.length > 0) {
        // ── DIRECT GIF MODE ──
        archiveMode = false;

        const processedHistory = JSON.parse(localStorage.getItem('processed_gifs_history') || '[]');
        const historySet       = new Set(processedHistory.map(n => n.toLowerCase()));
        const processedDirNames = new Set();

        if (outputDirHandle) {
            try {
                for await (const entry of outputDirHandle.values()) {
                    if (entry.kind === 'file' && /\.(zip|rar)$/i.test(entry.name)) {
                        processedDirNames.add(entry.name.replace(/\.[^.]+$/, '').toLowerCase());
                    }
                }
            } catch (err) { console.error('Could not scan output folder', err); }
        }

        let skippedCount = 0;
        const filteredGifs = [];
        for (const file of validImages) {
            const base = file.name.replace(/\.[^.]+$/, '').toLowerCase();
            if (historySet.has(file.name.toLowerCase()) || processedDirNames.has(base)) {
                skippedCount++;
            } else {
                filteredGifs.push(file);
            }
        }

        gifFiles        = filteredGifs;
        currentFileIndex = 0;

        let originalTotal = parseInt(localStorage.getItem('original_total_gifs') || '0');
        if (skippedCount === 0 || originalTotal === 0 || gifFiles.length + skippedCount > originalTotal) {
            originalTotal = gifFiles.length + skippedCount;
            localStorage.setItem('original_total_gifs', originalTotal.toString());
        }
        saveSessionState();

        if (gifFiles.length === 0 && skippedCount > 0) {
            Swal.fire('All caught up!', 'All files already processed.', 'success');
            UI.totalGifs.textContent = 0;
            UI.completedGifs.textContent = 0;
            UI.remainingGifs.textContent = 0;
            return;
        }

        Toast.fire({ icon: 'success', title: skippedCount > 0 ? `Skipped ${skippedCount} already-processed files.` : `Loaded ${gifFiles.length} files.` });

        currentCropIndex = 1;
        currentCrops     = [];
        dlCount          = 0;
        UI.downloadLinks.innerHTML   = '';
        UI.downloadCount.textContent = '0';
        updateCounters();
        loadCurrentImage();

    } else {
        Swal.fire('No files found', isOldMethod ? 'Please select valid image files.' : 'Please select a folder containing GIF files or ZIP/RAR archives.', 'warning');
    }
});

// ── Archive Mode: Extract on Server ───────────────────────────
async function extractAndLoadArchive(file) {
    UI.currentFileName.innerHTML = `<i class="fas fa-folder-open"></i> ${uploadedFolderName} &nbsp;&raquo;&nbsp; <i class="fas fa-file-archive"></i> ${file.name} (extracting…)`;
    UI.btnCrop.disabled = true;
    UI.btnSkip.disabled = true;

    const formData = new FormData();
    formData.append('archive', file);

    try {
        const resp = await fetch('/api/extract', { method: 'POST', body: formData });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Extraction failed');

        archiveBaseName = data.baseName;

        // Map files to steps
        const files = data.files;
        archiveStepMap = {};

        const findFile = (searchStr) => {
            return files.find(f => f.filename.toLowerCase().includes(searchStr.toLowerCase()));
        };

        const fileL1 = findFile('l1');
        const fileL2 = findFile('l2');
        const fileR1 = findFile('r1');
        const fileR2 = findFile('r2');

        // Association Logic:
        // L1 uses L1.gif (Step 1)
        // L2, L3, L4 use L2.gif (Steps 2, 3, 4)
        // R1 uses R1.gif (Step 5)
        // R2, R3, R4 use R2.gif (Steps 6, 7, 8)
        archiveStepMap[1] = fileL1;
        archiveStepMap[2] = fileL2;
        archiveStepMap[3] = fileL2;
        archiveStepMap[4] = fileL2;
        archiveStepMap[5] = fileR1;
        archiveStepMap[6] = fileR2;
        archiveStepMap[7] = fileR2;
        archiveStepMap[8] = fileR2;

        // Fallback for sequential files if named differently
        if (!fileL1 && !fileL2 && !fileR1 && !fileR2) {
            archiveStepMap[1] = files[0] || null;
            archiveStepMap[2] = files[1] || null;
            archiveStepMap[3] = files[1] || null;
            archiveStepMap[4] = files[1] || null;
            archiveStepMap[5] = files[2] || null;
            archiveStepMap[6] = files[3] || null;
            archiveStepMap[7] = files[3] || null;
            archiveStepMap[8] = files[3] || null;
        }

        const firstStep = findNextStep(1);
        if (firstStep === null) {
            Swal.fire('Empty Archive', 'No compatible image files found inside this archive.', 'warning');
            currentArchiveIndex++;
            archiveStepMap = {};
            loadCurrentImage();
            return;
        }

        currentCropIndex = firstStep;
        currentCrops     = [];
        UI.lastCropContainer.style.display = 'none';
        loadCurrentImage();

    } catch (err) {
        Swal.fire('Extraction Error', err.message, 'error');
        UI.btnSkip.disabled = false;
    }
}

// Find next step index >= startFrom that has an image
function findNextStep(startFrom) {
    for (let i = startFrom; i <= 8; i++) {
        if (!archiveMode || archiveStepMap[i]) return i;
    }
    return null;
}

// ── Helper to update top header and status counters ───────────
function updateUIForCurrentImage(file, stepEntry) {
    if (archiveMode) {
        const innerFileName = stepEntry ? stepEntry.filename : '';
        UI.currentFileName.innerHTML = `<i class="fas fa-folder-open"></i> ${uploadedFolderName} &nbsp;&raquo;&nbsp; <i class="fas fa-file-archive"></i> ${file.name} &nbsp;&raquo;&nbsp; <span style="color: var(--primary-color); font-weight: 600;">${innerFileName}</span>`;
    } else {
        UI.currentFileName.innerHTML = `<i class="fas fa-folder-open"></i> ${uploadedFolderName} &nbsp;&raquo;&nbsp; <i class="fas fa-file-image"></i> ${file.name}`;
    }
    UI.btnCrop.disabled = false;
    UI.btnSkip.disabled = false;
    updateCropStepsUI();
}

// ── Load Current Image ────────────────────────────────────────
function loadCurrentImage() {
    let targetSrc = null;
    let stepEntry = null;
    let file = null;

    if (archiveMode) {
        if (currentArchiveIndex >= archiveFiles.length) {
            cleanupCropper();
            Swal.fire('All Done!', 'All archives have been processed.', 'success');
            UI.currentFileName.textContent = 'All archives processed!';
            UI.placeholder.style.display   = 'block';
            UI.image.style.display         = 'none';
            UI.btnCrop.disabled            = true;
            UI.btnSkip.disabled            = true;
            clearSessionState();
            return;
        }

        file = archiveFiles[currentArchiveIndex];
        
        if (!archiveStepMap || Object.keys(archiveStepMap).length === 0) {
            extractAndLoadArchive(file);
            return;
        }

        stepEntry = archiveStepMap[currentCropIndex];
        if (!stepEntry) {
            const nextStep = findNextStep(currentCropIndex + 1);
            if (nextStep !== null) {
                currentCropIndex = nextStep;
                loadCurrentImage();
            } else {
                finalizeArchive();
            }
            return;
        }
        targetSrc = stepEntry.url;

    } else {
        if (currentFileIndex >= gifFiles.length) {
            cleanupCropper();
            Swal.fire('All Done!', 'All GIF files have been processed.', 'success');
            UI.currentFileName.textContent = 'All files processed!';
            UI.placeholder.style.display   = 'block';
            UI.image.style.display         = 'none';
            UI.btnCrop.disabled            = true;
            UI.btnSkip.disabled            = true;
            clearSessionState();
            localStorage.removeItem('original_total_gifs');
            return;
        }

        file = gifFiles[currentFileIndex];
        targetSrc = 'file_' + currentFileIndex;
    }

    // Check if the image source is the same and cropper is already active
    if (cropper && currentLoadedImageSrc === targetSrc) {
        updateUIForCurrentImage(file, stepEntry);
        return;
    }

    // Image changed — destroy old cropper, set new src
    cleanupCropper();
    currentLoadedImageSrc = targetSrc;
    updateUIForCurrentImage(file, stepEntry);

    if (archiveMode) {
        UI.placeholder.style.display = 'none';
        UI.image.style.display       = 'block';
        UI.image.src                 = stepEntry.url;
    } else {
        UI.placeholder.style.display = 'none';
        UI.image.style.display       = 'block';

        // Use preloaded ObjectURL if available, otherwise create new one
        if (_nextObjectUrl && _nextFileIndex === currentFileIndex) {
            currentObjectUrl = _nextObjectUrl;
            _nextObjectUrl   = null;
            _nextFileIndex   = -1;
        } else {
            if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
            currentObjectUrl = URL.createObjectURL(file);
        }
        UI.image.src = currentObjectUrl;
    }

    UI.image.onload = () => {
        if (currentLoadedImageSrc !== targetSrc) return;
        // Use requestAnimationFrame so browser paints the image first, then init cropper
        requestAnimationFrame(() => {
            cropper = new Cropper(UI.image, {
                viewMode:                 1,
                dragMode:                 'crop',
                responsive:               true,
                restore:                  false,
                guides:                   true,
                center:                   true,
                highlight:                false,
                cropBoxMovable:           true,
                cropBoxResizable:         true,
                toggleDragModeOnDblclick: false,
                background:               false,
                autoCropArea:             0.3,
                checkOrientation:         false,
                movable:                  true,
                zoomable:                 true
            });
        });
    };
}

// ── Cleanup ───────────────────────────────────────────────────
function cleanupCropper() {
    if (cropper) { cropper.destroy(); cropper = null; }
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    currentLoadedImageSrc = null;
}

// ── Skip Button ───────────────────────────────────────────────
UI.btnSkip.addEventListener('click', () => {
    if (archiveMode) {
        currentArchiveIndex++;
        archiveStepMap   = {};
        currentCropIndex = 1;
        currentCrops     = [];
        updateCounters();
        loadCurrentImage();
    } else {
        currentFileIndex++;
        currentCropIndex = 1;
        currentCrops     = [];
        saveSessionState();
        updateCounters();
        loadCurrentImage();
    }
});

// ── Undo Button ───────────────────────────────────────────────
UI.btnUndo.addEventListener('click', () => {
    if (currentCrops.length === 0) return;
    UI.btnUndo.disabled = true;

    currentCrops.pop();

    let prevStep = currentCropIndex - 1;
    while (prevStep >= 1 && archiveMode && !archiveStepMap[prevStep]) {
        prevStep--;
    }

    if (prevStep < 1) {
        prevStep = findNextStep(1) || 1;
    }

    currentCropIndex = prevStep;
    Toast.fire({ icon: 'info', title: `Undid Crop to ${CROP_LABELS[currentCropIndex]}` });

    if (currentCrops.length > 0) {
        UI.lastCropImg.src = URL.createObjectURL(currentCrops[currentCrops.length - 1].blob);
        UI.lastCropContainer.style.display = 'block';
    } else {
        UI.lastCropContainer.style.display = 'none';
    }

    loadCurrentImage();
});

function updateUndoButtonState() {
    UI.btnUndo.disabled = (currentCrops.length === 0);
}

// ── Crop Helpers ──────────────────────────────────────────────
function getCroppedCanvas(c) {
    return c.getCroppedCanvas({ imageSmoothingEnabled: true });
}

function canvasToBlob(canvas) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// ── Preload next file's ObjectURL in background ───────────────
let _nextObjectUrl = null;
let _nextFileIndex = -1;

function preloadNextImage() {
    if (archiveMode) return; // archive mode uses data URLs, no preload needed
    const nextIdx = currentFileIndex + 1;
    if (nextIdx >= gifFiles.length) return;
    if (_nextFileIndex === nextIdx) return; // already preloaded
    // Revoke previous preload
    if (_nextObjectUrl) { URL.revokeObjectURL(_nextObjectUrl); _nextObjectUrl = null; }
    _nextObjectUrl = URL.createObjectURL(gifFiles[nextIdx]);
    _nextFileIndex = nextIdx;
    // Trigger browser to start decoding
    const preImg = new Image();
    preImg.src = _nextObjectUrl;
}

// ── Perform Crop ──────────────────────────────────────────────
async function performCrop() {
    if (!cropper) return;

    UI.btnCrop.disabled = true;

    try {
        const label        = CROP_LABELS[currentCropIndex];
        const baseName     = archiveMode ? archiveBaseName : gifFiles[currentFileIndex].name.replace(/\.[^.]+$/, '');
        const cropFilename = `${baseName}${label}.png`;

        // Get canvas SYNCHRONOUSLY — this is instant
        const canvas = getCroppedCanvas(cropper);

        const nextStep   = findNextStep(currentCropIndex + 1);
        const isLastCrop = (nextStep === null);

        if (isLastCrop) {
            // ── LAST CROP (R4): Load next file IMMEDIATELY, encode blob in background ──
            const cropsSnap = currentCrops.slice();
            const baseSnap  = baseName;
            const origSnap  = archiveMode ? archiveFiles[currentArchiveIndex].name : gifFiles[currentFileIndex].name;

            UI.lastCropContainer.style.display = 'none';

            // Advance state & show next file RIGHT NOW (before blob is ready)
            if (archiveMode) {
                currentArchiveIndex++;
                archiveStepMap   = {};
                currentCropIndex = 1;
                currentCrops     = [];
                updateCounters();
                loadCurrentImage();
            } else {
                currentFileIndex++;
                currentCropIndex = 1;
                currentCrops     = [];
                saveSessionState();
                updateCounters();
                loadCurrentImage();
            }

            // Encode blob + build archive in background, UI is already on next file
            canvas.toBlob(blob => {
                cropsSnap.push({ filename: cropFilename, blob });
                setTimeout(() => createAndSaveArchive(baseSnap, origSnap, cropsSnap), 0);
            }, 'image/png');

        } else {
            // ── NORMAL CROP (L1-R3): encode blob then show next step ──
            const blob = await canvasToBlob(canvas);
            currentCrops.push({ filename: cropFilename, blob });

            if (UI.lastCropImg) {
                UI.lastCropImg.src = URL.createObjectURL(blob);
                UI.lastCropContainer.style.display = 'block';
            }

            // Start preloading next file early (on step 7 = R3)
            if (currentCropIndex >= 7) preloadNextImage();

            currentCropIndex = nextStep;
            loadCurrentImage();
        }

    } catch (err) {
        console.error('Crop error:', err);
        Swal.fire('Error', 'Failed to crop: ' + err.message, 'error');
    }

    UI.btnCrop.disabled = false;
    updateUndoButtonState();
}

// ── Finalize Current Archive ──────────────────────────────────
function finalizeArchive() {
    const baseName     = archiveMode ? archiveBaseName : gifFiles[currentFileIndex].name.replace(/\.[^.]+$/, '');
    const originalName = archiveMode ? archiveFiles[currentArchiveIndex].name : gifFiles[currentFileIndex].name;
    const cropsSnapshot = currentCrops.slice(); // snapshot before reset

    UI.lastCropContainer.style.display = 'none';

    // ── Immediately advance to next file (ZERO delay) ──
    if (archiveMode) {
        currentArchiveIndex++;
        archiveStepMap   = {};
        currentCropIndex = 1;
        currentCrops     = [];
        updateCounters();
        loadCurrentImage();
    } else {
        currentFileIndex++;
        currentCropIndex = 1;
        currentCrops     = [];
        saveSessionState();
        updateCounters();
        loadCurrentImage();
    }

    // ── Package & save archive in background (non-blocking) ──
    setTimeout(() => createAndSaveArchive(baseName, originalName, cropsSnapshot), 0);
}

// ── Package & Save Archive (runs in background, never blocks UI) ──
async function createAndSaveArchive(baseName, originalFileName, cropsSnapshot) {
    const isOldMethod = UI.oldMethodCheckbox && UI.oldMethodCheckbox.checked;
    const crops = cropsSnapshot || currentCrops;

    try {
        const zip = new JSZip();
        for (const crop of crops) zip.file(crop.filename, crop.blob);
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        const zipName = isOldMethod ? `${baseName}.rar` : `${baseName}.zip`;

        let pathMsg = '';

        if (outputDirHandle) {
            const fh       = await outputDirHandle.getFileHandle(zipName, { create: true });
            const writable = await fh.createWritable();
            await writable.write(zipBlob);
            await writable.close();
            pathMsg = `Saved: ${zipName}`;
        } else {
            const link = document.createElement('a');
            link.href     = URL.createObjectURL(zipBlob);
            link.download = isOldMethod ? zipName : `done/${zipName}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
            pathMsg = `Downloaded ${zipName}`;
        }

        addDownloadLinkHtml(zipName, !!outputDirHandle);

        if (originalFileName) {
            const history = JSON.parse(localStorage.getItem('processed_gifs_history') || '[]');
            if (!history.includes(originalFileName)) {
                history.push(originalFileName);
                localStorage.setItem('processed_gifs_history', JSON.stringify(history));
            }
        }

        Toast.fire({ icon: 'success', title: pathMsg });

    } catch (err) {
        console.error('Archive error:', err);
    }
}

function addDownloadLinkHtml(filename, wasSavedDirectly) {
    const div = document.createElement('div');
    div.className = 'download-link';
    div.innerHTML = `<i class="fas ${wasSavedDirectly ? 'fa-folder-check' : 'fa-file-archive'}" style="color:${wasSavedDirectly ? '#7ee787' : '#ffd700'};"></i> ${filename} ${wasSavedDirectly ? '(Saved to PC)' : ''}`;
    UI.downloadLinks.appendChild(div);
    dlCount++;
    UI.downloadCount.textContent = dlCount;
}

// ── Crop Button / Keypresses ──────────────────────────────────
UI.btnCrop.addEventListener('click', performCrop);

document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !UI.btnCrop.disabled && cropper) {
        e.preventDefault();
        performCrop();
    }
});

document.addEventListener('dblclick', e => {
    if (cropper && !UI.btnCrop.disabled) {
        if (e.target.closest('.cropper-container') || e.target.closest('#image')) {
            e.preventDefault();
            performCrop();
        }
    }
});

let lastTap = 0;
document.addEventListener('touchend', e => {
    if (window.innerWidth <= 768) {
        const now = Date.now();
        if (now - lastTap < 500 && now - lastTap > 0) {
            if (cropper && !UI.btnCrop.disabled) {
                if (e.target.closest('.cropper-container') || e.target.closest('#image')) {
                    e.preventDefault();
                    performCrop();
                }
            }
        }
        lastTap = now;
    }
});

// ── Finalize Button ───────────────────────────────────────────
UI.btnFinalize.addEventListener('click', () => {
    Swal.fire('Information', 'Since you are running locally, Master Archive packing is not required. All individual ZIPs are already on your computer.', 'info');
});

// ── Reset Button ──────────────────────────────────────────────
if (UI.resetAppBtn) {
    UI.resetAppBtn.addEventListener('click', () => {
        Swal.fire({
            title: 'Are you sure?',
            text: 'This will reset all progress and memory.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonColor: '#3085d6',
            confirmButtonText: 'Yes, reset!'
        }).then(result => {
            if (result.isConfirmed) {
                clearSessionState();
                localStorage.removeItem('processed_gifs_history');
                localStorage.removeItem('original_total_gifs');
                Swal.fire({ title: 'Resetting!', icon: 'success', showConfirmButton: false, timer: 1500 })
                    .then(() => window.location.reload());
            }
        });
    });
}

// ── Counters ──────────────────────────────────────────────────
function updateCounters() {
    if (archiveMode) {
        const total = archiveFiles.length;
        const completed = currentArchiveIndex;
        UI.completedGifs.textContent = completed;
        UI.remainingGifs.textContent = total - completed;
        UI.totalGifs.textContent = total;
    } else {
        const total     = parseInt(localStorage.getItem('original_total_gifs') || gifFiles.length);
        const completed = total - gifFiles.length + currentFileIndex;
        UI.completedGifs.textContent = completed;
        UI.remainingGifs.textContent = total - completed;
        UI.totalGifs.textContent = total;
    }
}
