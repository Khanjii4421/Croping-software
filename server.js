const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const os = require('os');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
// Using child_process as fallback for genuine RAR files on Windows
const { execSync } = require('child_process');

const app = express();
// Enable CORS for all routes (helps avoid network errors when accessed from different origins)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});
const PORT = 5000;

// Middleware
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));
app.use(express.static(path.join(__dirname, 'templates'))); // Serve index.html
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/uploads', express.static(path.join(os.tmpdir(), 'uploads')));
app.use('/processed', express.static(path.join(os.tmpdir(), 'processed')));

// Setup Directories
[path.join(os.tmpdir(), 'uploads'), path.join(os.tmpdir(), 'processed'), path.join(os.tmpdir(), 'temp_crops')].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Multer for File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(os.tmpdir(), 'uploads'));
    },
    filename: (req, file, cb) => {
        // secure filename logic minimal
        cb(null, file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
    }
});
const upload = multer({ storage });

const CROP_SUFFIXES = {
    1: 'R1', 2: 'R2', 3: 'R3', 4: 'R4',
    5: 'L1', 6: 'L2', 7: 'L3', 8: 'L4'
};

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'login.html'));
});

app.get('/reset-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'reset-password.html'));
});

app.post('/upload', upload.array('files[]'), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }

    const outputPathInput = req.body.outputPath;
    let saveDir = path.join(os.tmpdir(), 'processed');
    if (outputPathInput && outputPathInput.trim() !== '') {
        try {
            if (!fs.existsSync(outputPathInput)) {
                fs.mkdirSync(outputPathInput, { recursive: true });
            }
            saveDir = outputPathInput;
        } catch (e) {
            console.error("Path err", e);
        }
    }

    const savedFiles = [];
    let skippedCount = 0;

    for (const f of req.files) {
        if (!f.filename.toLowerCase().endsWith('.gif')) {
            try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (e) { }
            continue;
        }

        const baseName = path.parse(f.filename).name;
        const archiveFilepath = path.join(saveDir, `${baseName}.rar`);

        if (fs.existsSync(archiveFilepath)) {
            // Already processed -> Skip!
            try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (e) { }
            skippedCount++;
        } else {
            savedFiles.push(f.filename);
        }
    }

    res.json({
        message: `Successfully uploaded ${savedFiles.length} GIF files.`,
        files: savedFiles,
        skipped: skippedCount
    });
});



app.post('/finalize', async (req, res) => {
    // Collect all .rar files in the processed folder
    const processedDir = path.join(os.tmpdir(), 'processed');
    const files = fs.readdirSync(processedDir).filter(f => f.endsWith('.rar') && f !== 'MasterArchive.rar');

    if (files.length === 0) {
        return res.status(400).json({ error: 'No processed archives found to combine.' });
    }

    const masterArchivePath = path.join(processedDir, 'MasterArchive.rar');
    const output = fs.createWriteStream(masterArchivePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
        res.json({
            message: 'Master Archive created successfully!',
            archive_url: '/processed/MasterArchive.rar',
            count: files.length
        });
    });

    archive.on('error', (err) => {
        res.status(500).json({ error: err.message });
    });

    archive.pipe(output);
    for (const file of files) {
        archive.file(path.join(processedDir, file), { name: file });
    }
    archive.finalize();
});

app.post('/crop', async (req, res) => {
    const { filename, crop_index, x, y, width, height, outputPath } = req.body;

    if (!filename || !crop_index || width === undefined || height === undefined) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const originalFilepath = path.join(os.tmpdir(), 'uploads', filename);
    if (!fs.existsSync(originalFilepath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    try {
        const baseName = path.parse(filename).name;
        const suffix = CROP_SUFFIXES[crop_index];
        if (!suffix) return res.status(400).json({ error: 'Invalid crop index' });

        const cropFilename = `${baseName}${suffix}.png`;
        const fileTempDir = path.join(os.tmpdir(), 'temp_crops', baseName);

        if (!fs.existsSync(fileTempDir)) {
            fs.mkdirSync(fileTempDir, { recursive: true });
        }

        const cropFilepath = path.join(fileTempDir, cropFilename);

        // Read file into buffer to avoid EPERM file locking issues on windows
        const imageBuffer = fs.readFileSync(originalFilepath);

        const extractWidth = Math.max(1, Math.round(width));
        const extractHeight = Math.max(1, Math.round(height));

        // Perform crop using Sharp with Buffer
        await sharp(imageBuffer, { animated: false }) // Take first frame of GIF
            .extract({
                left: Math.round(x),
                top: Math.round(y),
                width: extractWidth,
                height: extractHeight
            })
            .toFormat('png')
            .toFile(cropFilepath);

        let archiveUrl = null;

        // If it's the 8th crop, create the archive
        let savedTo = null;
        if (crop_index === 8) {
            const archiveFilename = `${baseName}.rar`;
            let archiveFilepath;

            if (outputPath) {
                try {
                    if (!fs.existsSync(outputPath)) {
                        fs.mkdirSync(outputPath, { recursive: true });
                    }
                    archiveFilepath = path.join(outputPath, archiveFilename);
                } catch (e) {
                    console.error("Could not use custom path, falling back", e);
                    archiveFilepath = path.join(os.tmpdir(), 'processed', archiveFilename);
                }
            } else {
                archiveFilepath = path.join(os.tmpdir(), 'processed', archiveFilename);
            }
            savedTo = archiveFilepath;

            const output = fs.createWriteStream(archiveFilepath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            await new Promise((resolve, reject) => {
                output.on('close', resolve);
                archive.on('error', reject);

                archive.pipe(output);
                archive.directory(fileTempDir, false);
                archive.finalize();
            });

            // Cleanup temp directory
            fs.rmSync(fileTempDir, { recursive: true, force: true });
            archiveUrl = outputPath ? null : `/processed/${archiveFilename}`;
        }

        res.json({
            message: 'Crop successful',
            crop_filename: cropFilename,
            archive_url: archiveUrl,
            crop_index: crop_index,
            saved_to: savedTo
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/undo', (req, res) => {
    const { filename, crop_index } = req.body;

    if (!filename || !crop_index) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        const baseName = path.parse(filename).name;
        // In undo, if crop_index we are undoing is N, its suffix is CROP_SUFFIXES[N]
        const suffix = CROP_SUFFIXES[crop_index];
        if (!suffix) return res.status(400).json({ error: 'Invalid crop index' });

        const cropFilename = `${baseName}${suffix}.png`;
        const fileTempDir = path.join(os.tmpdir(), 'temp_crops', baseName);
        const cropFilepath = path.join(fileTempDir, cropFilename);

        if (fs.existsSync(cropFilepath)) {
            fs.unlinkSync(cropFilepath);
        }
        res.json({ message: 'Undo successful', removed: cropFilename });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

module.exports = app;
