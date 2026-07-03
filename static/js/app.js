let cropper;
let gifFiles = []; // will store File objects
let currentFileIndex = 0;
let currentCropIndex = 1; // 1 to 8
let currentCrops = []; // Store blobs for current GIF
let outputDirHandle = null;

const CROP_LABELS = {
    1: 'R1', 2: 'R2', 3: 'R3', 4: 'R4',
    5: 'L1', 6: 'L2', 7: 'L3', 8: 'L4'
};
const CROP_SUFFIXES = CROP_LABELS; // just mapping

const UI = {
    folderInput: document.getElementById('folderInput'),
    totalGifs: document.getElementById('totalGifs'),
    completedGifs: document.getElementById('completedGifs'),
    remainingGifs: document.getElementById('remainingGifs'),
    currentFileName: document.getElementById('currentFileName'),
    cropTargetName: document.getElementById('cropTargetName'),
    nextCropLabel: document.getElementById('nextCropLabel'),
    btnCrop: document.getElementById('btnCrop'),
    btnSkip: document.getElementById('btnSkip'),
    image: document.getElementById('image'),
    placeholder: document.querySelector('.placeholder-content'),
    cropStepsContainer: document.querySelector('.crop-steps'),
    downloadLinks: document.getElementById('downloadLinks'),
    downloadCount: document.getElementById('downloadCount'),
    themeToggle: document.getElementById('themeToggle'),
    themeIcon: document.getElementById('themeIcon'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    sidebar: document.querySelector('.sidebar'),
    sidebarToggleIcon: document.getElementById('sidebarToggleIcon'),
    btnUndo: document.getElementById('btnUndo'),
    body: document.body,
    btnFinalize: document.getElementById('btnFinalize'),
    lastCropContainer: document.getElementById('lastCropContainer'),
    lastCropImg: document.getElementById('lastCropImg'),
    selectOutputDirBtn: document.getElementById('selectOutputDirBtn'),
    outputPathDisplay: document.getElementById('outputPathDisplay'),
    resetAppBtn: document.getElementById('resetAppBtn')
};

// Theme Toggle Logic
const savedTheme = localStorage.getItem('theme') || 'light';
if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    UI.themeIcon.classList.remove('fa-sun');
    UI.themeIcon.classList.add('fa-moon');
} else {
    document.body.classList.remove('light-theme');
    UI.themeIcon.classList.remove('fa-moon');
    UI.themeIcon.classList.add('fa-sun');
}

UI.themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    if (document.body.classList.contains('light-theme')) {
        UI.themeIcon.classList.remove('fa-sun');
        UI.themeIcon.classList.add('fa-moon');
        localStorage.setItem('theme', 'light');
    } else {
        UI.themeIcon.classList.remove('fa-moon');
        UI.themeIcon.classList.add('fa-sun');
        localStorage.setItem('theme', 'dark');
    }
});

/* =========================================================================
   INDEXEDDB SESSION PERSISTENCE LOGIC
   ========================================================================= */
const DB_NAME = 'GIFCropperSession';
const DB_VERSION = 1;
const STORE_NAME = 'workspaceData';

let db;

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const tempDb = e.target.result;
            if (!tempDb.objectStoreNames.contains(STORE_NAME)) {
                tempDb.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

function saveSessionState() {
    if (!db) return;
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    // Save current required state
    store.put(gifFiles, 'gifFiles');
    store.put(currentFileIndex, 'currentFileIndex');
    store.put(localStorage.getItem('original_total_gifs'), 'originalTotal');
}

async function loadSessionState() {
    await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);

        const reqFiles = store.get('gifFiles');
        const reqIndex = store.get('currentFileIndex');
        const reqTotal = store.get('originalTotal');

        let loadedFiles = [], loadedIndex = 0, loadedTotal = "0";

        reqFiles.onsuccess = () => loadedFiles = reqFiles.result || [];
        reqIndex.onsuccess = () => loadedIndex = reqIndex.result || 0;
        reqTotal.onsuccess = () => loadedTotal = reqTotal.result || "0";

        transaction.oncomplete = () => {
            if (loadedFiles.length > 0) {
                resolve({
                    files: loadedFiles,
                    index: loadedIndex,
                    total: loadedTotal
                });
            } else {
                resolve(null);
            }
        };
        transaction.onerror = (e) => reject(e.target.error);
    });
}

function clearSessionState() {
    if (!db) return;
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const session = await loadSessionState();
        if (session && session.files.length > 0) {
            Swal.fire({
                title: 'Session Restored',
                text: 'Your previous progress has been recovered successfully! Please re-select your Save Folder if you were using one.',
                icon: 'info',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 5000
            });

            gifFiles = session.files;
            currentFileIndex = session.index;
            localStorage.setItem('original_total_gifs', session.total);

            // Resume UI
            currentCropIndex = 1;
            currentCrops = [];
            dlCount = 0;
            UI.downloadCount.textContent = '0';
            UI.downloadLinks.innerHTML = '';

            updateCounters();
            loadCurrentImage();
        }
    } catch (e) {
        console.error("Failed to restore session from DB", e);
    }
});

// Sidebar Toggle Logic
UI.sidebarToggle.addEventListener('click', () => {
    UI.sidebar.classList.toggle('hidden');
    if (UI.sidebar.classList.contains('hidden')) {
        UI.sidebarToggleIcon.classList.remove('fa-chevron-left');
        UI.sidebarToggleIcon.classList.add('fa-chevron-right');
    } else {
        UI.sidebarToggleIcon.classList.remove('fa-chevron-right');
        UI.sidebarToggleIcon.classList.add('fa-chevron-left');
    }
    setTimeout(() => { if (cropper) cropper.resize(); }, 400);
});

// File System Access Setup
if (UI.selectOutputDirBtn) {
    if ('showDirectoryPicker' in window) {
        UI.selectOutputDirBtn.addEventListener('click', async () => {
            try {
                outputDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                // Check permissions
                if ((await outputDirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                    if ((await outputDirHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
                        throw new Error('Permission not granted');
                    }
                }
                UI.outputPathDisplay.textContent = `Saving to: ${outputDirHandle.name}`;
                UI.outputPathDisplay.style.color = 'var(--primary-color)';
                Toast.fire({ icon: 'success', title: 'Local save folder connected!' });
            } catch (err) {
                console.error("Directory picker error:", err);
                UI.outputPathDisplay.textContent = "Folder selection cancelled or denied";
                UI.outputPathDisplay.style.color = "var(--accent-r)";
            }
        });
    } else {
        UI.selectOutputDirBtn.style.display = 'none';
        UI.outputPathDisplay.textContent = "Your browser does not support automatic local saving. Files will be downloaded normally.";
    }
}

function initCropStepsUI() {
    UI.cropStepsContainer.innerHTML = '';
    for (let i = 1; i <= 8; i++) {
        const div = document.createElement('div');
        div.className = `step-box step-${i}`;
        div.textContent = CROP_LABELS[i];
        UI.cropStepsContainer.appendChild(div);
    }
}
initCropStepsUI();

function updateCropStepsUI() {
    for (let i = 1; i <= 8; i++) {
        const div = document.querySelector(`.step-${i}`);
        if (div) {
            div.className = `step-box step-${i}`;
            if (i < currentCropIndex) {
                div.classList.add(i <= 4 ? 'completed-r' : 'completed-l');
            } else if (i === currentCropIndex) {
                div.classList.add('active');
            }
        }
    }

    if (currentCropIndex <= 8) {
        UI.cropTargetName.innerHTML = `Action: Select &amp; Crop <b>${CROP_LABELS[currentCropIndex]}</b>`;
        UI.nextCropLabel.textContent = CROP_LABELS[currentCropIndex];
    }
    updateUndoButtonState();
}

UI.folderInput.addEventListener('change', async (e) => {
    const allFiles = Array.from(e.target.files);
    let gifs = allFiles.filter(f => f.name.toLowerCase().endsWith('.gif'));

    if (gifs.length === 0) {
        Swal.fire('No GIFs found', 'Please select a folder containing GIF files.', 'warning');
        return;
    }

    // Auto-skip logic for already processed files
    let skippedCount = 0;

    // ALWAYS Check local browser cache history robustly
    const processedHistory = JSON.parse(localStorage.getItem('processed_gifs_history') || '[]');
    const historySet = new Set(processedHistory.map(name => name.toLowerCase()));

    const processedDirNames = new Set();
    if (outputDirHandle) {
        // Read the actual local output folder if connected
        try {
            for await (const entry of outputDirHandle.values()) {
                if (entry.kind === 'file' && (entry.name.toLowerCase().endsWith('.zip') || entry.name.toLowerCase().endsWith('.rar'))) {
                    const base = entry.name.substring(0, entry.name.lastIndexOf('.')).toLowerCase();
                    processedDirNames.add(base);
                }
            }
        } catch (err) {
            console.error("Could not scan output folder", err);
        }
    }

    const filteredGifs = [];
    for (const file of gifs) {
        const baseName = file.name.substring(0, file.name.lastIndexOf('.')).toLowerCase();

        // Skip if either found in LocalStorage memory OR exists in the output Directory
        if (historySet.has(file.name.toLowerCase()) || processedDirNames.has(baseName)) {
            skippedCount++;
        } else {
            filteredGifs.push(file);
        }
    }

    gifFiles = filteredGifs;

    // Persist Original Total for UI consistency
    let originalTotal = parseInt(localStorage.getItem('original_total_gifs') || '0');
    if (skippedCount === 0 || originalTotal === 0 || gifFiles.length + skippedCount > originalTotal) {
        originalTotal = gifFiles.length + skippedCount;
        localStorage.setItem('original_total_gifs', originalTotal.toString());
    }

    // SAVE TO DATABASE INSTANTLY
    saveSessionState();

    let toastMsg = `Loaded ${gifFiles.length} GIFs. Ready to crop.`;
    if (skippedCount > 0) {
        toastMsg = `Browser Memory Remembers! Skipped ${skippedCount} already processed GIFs.`;
    }

    if (gifFiles.length === 0 && skippedCount > 0) {
        Swal.fire('All caught up!', 'All selected GIFs have already been processed.', 'success');
        UI.totalGifs.textContent = 0;
        UI.completedGifs.textContent = 0;
        UI.remainingGifs.textContent = 0;
        return;
    }

    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: toastMsg,
        showConfirmButton: false,
        timer: 4000
    });

    currentFileIndex = 0;
    currentCropIndex = 1;
    currentCrops = [];

    UI.totalGifs.textContent = originalTotal;
    UI.completedGifs.textContent = originalTotal - gifFiles.length;
    UI.remainingGifs.textContent = gifFiles.length;
    UI.downloadLinks.innerHTML = '';
    UI.downloadCount.textContent = '0';
    dlCount = 0;

    loadCurrentImage();
});

let currentObjectUrl = null;

function loadCurrentImage() {
    if (currentFileIndex >= gifFiles.length) {
        Swal.fire({
            title: 'All Done!',
            text: 'You have successfully processed all GIF files.',
            icon: 'success'
        });
        UI.currentFileName.textContent = "All files processed!";
        cleanupCropper();
        UI.image.style.display = 'none';
        UI.placeholder.style.display = 'block';
        UI.placeholder.innerHTML = '<i class="fas fa-check-circle fa-4x mb-3 text-success" style="color:#7ee787;"></i><h2 class="mt-3">All files processed.</h2>';
        UI.btnCrop.disabled = true;
        UI.btnSkip.disabled = true;

        // Clean session memory since job is done!
        clearSessionState();
        localStorage.removeItem('original_total_gifs');

        return;
    }

    const file = gifFiles[currentFileIndex];
    UI.currentFileName.innerHTML = `<i class="fas fa-file-image"></i> ${file.name}`;
    currentCropIndex = 1;
    currentCrops = []; // reset crops for new file
    updateCropStepsUI();

    UI.placeholder.style.display = 'none';
    UI.image.style.display = 'block';
    UI.image.classList.add('fade-in-up');
    setTimeout(() => UI.image.classList.remove('fade-in-up'), 500);

    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(file);
    UI.image.src = currentObjectUrl;

    UI.btnCrop.disabled = false;
    UI.btnSkip.disabled = false;
    updateUndoButtonState();

    // Preload next image to browser cache
    if (currentFileIndex + 1 < gifFiles.length) {
        const nextFile = gifFiles[currentFileIndex + 1];
        const tempImg = new Image();
        const tempUrl = URL.createObjectURL(nextFile);
        tempImg.src = tempUrl;
        tempImg.onload = () => URL.revokeObjectURL(tempUrl);
    }

    if (cropper) {
        cropper.destroy();
    }

    UI.image.onload = () => {
        cropper = new Cropper(UI.image, {
            viewMode: 1,
            dragMode: 'crop',
            responsive: true,
            restore: false,
            guides: true,
            center: true,
            highlight: false,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
            background: false,
            autoCropArea: 0.3
        });
    };
}

function cleanupCropper() {
    if (cropper) {
        cropper.destroy();
        cropper = null;
    }
    if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
    }
}

UI.btnSkip.addEventListener('click', () => {
    currentFileIndex++;
    saveSessionState(); // Update Index in DB
    updateCounters();
    loadCurrentImage();
});

// Undo function
UI.btnUndo.addEventListener('click', () => {
    if (currentCropIndex <= 1 || currentCropIndex > 8) return;

    const targetCropUndo = currentCropIndex - 1;
    UI.btnUndo.disabled = true;

    // Remove from local memory Array
    currentCrops.pop();

    Toast.fire({ icon: 'info', title: `Undid Crop ${CROP_LABELS[targetCropUndo]}` });
    currentCropIndex--;
    updateCropStepsUI();

    // Refresh last crop preview if we still have crops
    if (currentCrops.length > 0) {
        const lastBlob = currentCrops[currentCrops.length - 1].blob;
        UI.lastCropImg.src = URL.createObjectURL(lastBlob);
        UI.lastCropContainer.style.display = 'block';
    } else {
        UI.lastCropContainer.style.display = 'none';
    }

    updateUndoButtonState();
});

function updateUndoButtonState() {
    UI.btnUndo.disabled = (currentCropIndex <= 1 || currentCropIndex > 8);
}

// Ensure the crop coordinates extract a clear image
function getCroppedCanvas(cropperInstance) {
    return cropperInstance.getCroppedCanvas({
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
    });
}

function canvasToBlob(canvas) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

async function performCrop() {
    if (!cropper) return;
    if (currentFileIndex >= gifFiles.length) return;

    UI.btnCrop.disabled = true;

    try {
        const file = gifFiles[currentFileIndex];
        const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
        const suffix = CROP_SUFFIXES[currentCropIndex];
        const cropFilename = `${baseName}${suffix}.png`;

        // Extract PNG blob purely in Browser Memory
        const canvas = getCroppedCanvas(cropper);
        const blob = await canvasToBlob(canvas);

        currentCrops.push({
            filename: cropFilename,
            blob: blob
        });

        Toast.fire({
            icon: 'success',
            title: `Saved Crop ${CROP_LABELS[currentCropIndex]} locally!`,
            position: 'top-end'
        });

        // Last Crop UX Update
        if (currentCropIndex !== 8) {
            UI.lastCropImg.src = URL.createObjectURL(blob);
            UI.lastCropContainer.style.display = 'block';
        } else {
            UI.lastCropContainer.style.display = 'none';

            // Reached 8th crop -> Archive them all immediately
            await createAndSaveArchive(baseName, file.name);

            currentFileIndex++;
            saveSessionState(); // Update DB after successful full process!

            updateCounters();
            loadCurrentImage();
        }

        if (currentCropIndex <= 8) {
            currentCropIndex++;
            updateCropStepsUI();
        }

    } catch (e) {
        console.error("Local Crop Error:", e);
        Swal.fire('Error', 'Failed to generate image crop: ' + e.message, 'error');
    }

    UI.btnCrop.disabled = false;
    updateUndoButtonState();
}

async function createAndSaveArchive(baseName, originalFileName) {
    Swal.fire({
        title: 'Packaging ZIP locally...',
        text: 'Generating archive in browser memory instantly.',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const zip = new JSZip();
        // Add all crops to zip
        for (const crop of currentCrops) {
            zip.file(crop.filename, crop.blob);
        }

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const zipName = `${baseName}.zip`; // using .zip natively 

        let pathMsg = '';

        if (outputDirHandle) {
            // Save directly to user's selected PC folder using File System API
            const fileHandle = await outputDirHandle.getFileHandle(zipName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(zipBlob);
            await writable.close();
            pathMsg = `Saved seamlessly to: ${outputDirHandle.name}/${zipName}`;
        } else {
            // Fallback: standard web download
            const link = document.createElement("a");
            link.href = URL.createObjectURL(zipBlob);
            // By prepending 'done/', supported browsers will create/use a folder named "done" inside the default Downloads directory
            link.download = `done/${zipName}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            pathMsg = 'Downloaded to your "Downloads/done" folder.';
        }

        addDownloadLinkHtml(zipName, outputDirHandle ? true : false);

        // Save to LocalStorage History permanently
        const processedHistory = JSON.parse(localStorage.getItem('processed_gifs_history') || '[]');
        if (originalFileName && !processedHistory.includes(originalFileName)) {
            processedHistory.push(originalFileName);
            localStorage.setItem('processed_gifs_history', JSON.stringify(processedHistory));
        }

        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: pathMsg,
            showConfirmButton: false,
            timer: 4000
        });

    } catch (err) {
        console.error("Zip generation error: ", err);
        Swal.fire('Error', 'Could not create Zip archive locally.', 'error');
    }
}

let dlCount = 0;
function addDownloadLinkHtml(filename, wasSavedDirectly) {
    const a = document.createElement('div'); // Just a visual record now
    a.className = 'download-link';
    a.innerHTML = `<i class="fas ${wasSavedDirectly ? 'fa-folder-check' : 'fa-file-archive'}" style="color:${wasSavedDirectly ? '#7ee787' : '#ffd700'};"></i> ${filename} ${wasSavedDirectly ? '(Saved to PC)' : ''}`;

    UI.downloadLinks.appendChild(a);
    dlCount++;
    UI.downloadCount.textContent = dlCount;
}

UI.btnCrop.addEventListener('click', performCrop);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !UI.btnCrop.disabled && cropper) {
        e.preventDefault();
        performCrop();
    }
    // Ctrl + Z keyboard shortcut for undo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!UI.btnUndo.disabled) {
            e.preventDefault();
            UI.btnUndo.click();
        }
    }
});

let lastTap = 0;
document.addEventListener('touchend', (e) => {
    if (window.innerWidth <= 768) {  // Mobile device check logic
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;
        if (tapLength < 500 && tapLength > 0) {
            if (cropper && !UI.btnCrop.disabled) {
                if (e.target.closest('.cropper-container') || e.target.closest('#image')) {
                    e.preventDefault();
                    performCrop();
                }
            }
        }
        lastTap = currentTime;
    }
});
// For PC double click
document.addEventListener('dblclick', (e) => {
    if (cropper && !UI.btnCrop.disabled) {
        if (e.target.closest('.cropper-container') || e.target.closest('#image')) {
            e.preventDefault();
            performCrop();
        }
    }
});

function updateCounters() {
    const originalTotal = parseInt(localStorage.getItem('original_total_gifs') || gifFiles.length);
    const completedAllTotal = originalTotal - gifFiles.length + currentFileIndex;

    UI.completedGifs.textContent = completedAllTotal;
    UI.remainingGifs.textContent = originalTotal - completedAllTotal;

    // Update global progress bar
    const progressPercent = originalTotal > 0 ? (completedAllTotal / originalTotal) * 100 : 0;
    const bar = document.getElementById('globalProgressBar');
    if (bar) {
        bar.style.width = `${progressPercent}%`;
    }
}

UI.btnFinalize.addEventListener('click', () => {
    // With local saving, Master Archiving might not be simple since we don't store 120 big zips in RAM simultaneously to avoid crashing the browser.
    Swal.fire('Information', 'Since you are running locally directly from Browser to Disk, Master Archive packing is not required! All your individual zips are already on your computer.', 'info');
});

if (UI.resetAppBtn) {
    UI.resetAppBtn.addEventListener('click', () => {
        Swal.fire({
            title: 'Are you sure?',
            text: "This will completely reset the software! All your saved progress, skips, and loaded memory will be cleared.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Yes, reset everything!'
        }).then((result) => {
            if (result.isConfirmed) {
                // Clear all states
                clearSessionState();
                localStorage.removeItem('processed_gifs_history');
                localStorage.removeItem('original_total_gifs');

                Swal.fire({
                    title: 'Resetting!',
                    text: 'Bringing everything back to factory state...',
                    icon: 'success',
                    showConfirmButton: false,
                    timer: 1500
                }).then(() => {
                    window.location.reload();
                });
            }
        });
    });
}

const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true
});
