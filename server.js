const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const archiver = require('archiver');
const AdmZip  = require('adm-zip');
const { createExtractorFromData } = require('node-unrar-js');

const app  = express();
const PORT = 5000;

// ── Directories ──────────────────────────────────────────────
const UPLOADS_DIR   = path.join(os.tmpdir(), 'gif_cropper_uploads');
const EXTRACTED_DIR = path.join(os.tmpdir(), 'gif_cropper_extracted');
const PROCESSED_DIR = path.join(os.tmpdir(), 'gif_cropper_processed');
[UPLOADS_DIR, EXTRACTED_DIR, PROCESSED_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Middleware ───────────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));
app.use(express.static(path.join(__dirname, 'templates')));
app.use('/static',    express.static(path.join(__dirname, 'static')));
app.use('/extracted', express.static(EXTRACTED_DIR));
app.use('/processed', express.static(PROCESSED_DIR));

// ── Multer ───────────────────────────────────────────────────
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOADS_DIR),
        filename:    (req, file, cb) => cb(null, file.originalname.replace(/[^a-zA-Z0-9._\-]/g, '_'))
    })
});

// ── Routes ───────────────────────────────────────────────────
app.get('/',               (req, res) => res.sendFile(path.join(__dirname, 'templates', 'index.html')));
app.get('/login',          (req, res) => res.redirect('/'));
app.get('/reset-password', (req, res) => res.redirect('/'));

// ── POST /api/extract ────────────────────────────────────────
// Receives one archive file (zip or rar).
// Extracts image files, returns them sorted as an ordered array.
app.post('/api/extract', upload.single('archive'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No archive uploaded.' });

    const archivePath = req.file.path;
    const baseName    = path.parse(req.file.filename).name;
    const destDir     = path.join(EXTRACTED_DIR, baseName);

    // Clean previous extraction
    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });

    try {
        const ext = path.extname(req.file.originalname).toLowerCase();

        if (ext === '.zip') {
            const zip = new AdmZip(archivePath);
            zip.extractAllTo(destDir, /*overwrite=*/true);

        } else if (ext === '.rar') {
            const buf = Uint8Array.from(fs.readFileSync(archivePath)).buffer;

            // Load WASM binary manually to ensure it is bundled and loaded correctly on serverless/Vercel environments
            let wasmBinary = undefined;
            try {
                const wasmPath = path.join(process.cwd(), 'node_modules', 'node-unrar-js', 'dist', 'js', 'unrar.wasm');
                if (fs.existsSync(wasmPath)) {
                    wasmBinary = fs.readFileSync(wasmPath);
                }
            } catch (wasmErr) {
                console.error('[extract] Failed to read unrar.wasm manually:', wasmErr);
            }

            const extractor = await createExtractorFromData({ data: buf, wasmBinary });
            const extracted = extractor.extract();
            for (const file of extracted.files) {
                if (file.fileHeader.flags.directory || !file.extraction) continue;
                const outPath = path.join(destDir, path.basename(file.fileHeader.name));
                fs.writeFileSync(outPath, Buffer.from(file.extraction));
            }
        } else {
            return res.status(400).json({ error: 'Unsupported format. Use .zip or .rar' });
        }

        // Remove uploaded archive (free space)
        try { fs.unlinkSync(archivePath); } catch (_) {}

        // Collect image files and sort naturally
        const IMAGE_EXTS = ['.gif', '.png', '.jpg', '.jpeg', '.webp', '.bmp'];
        const files = fs.readdirSync(destDir)
            .filter(f => IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

        if (files.length === 0)
            return res.status(400).json({ error: 'No image files found inside the archive.' });

        const fileList = files.map(filename => {
            const filePath = path.join(destDir, filename);
            const fileBuf = fs.readFileSync(filePath);
            const extname = path.extname(filename).toLowerCase();
            let mimeType = 'image/png';
            if (extname === '.gif') mimeType = 'image/gif';
            else if (extname === '.jpg' || extname === '.jpeg') mimeType = 'image/jpeg';
            else if (extname === '.webp') mimeType = 'image/webp';
            else if (extname === '.bmp') mimeType = 'image/bmp';

            const base64Data = fileBuf.toString('base64');
            return {
                url: `data:${mimeType};base64,${base64Data}`,
                filename
            };
        });

        res.json({
            baseName,
            files: fileList
        });

    } catch (err) {
        console.error('[extract] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
module.exports = app;
