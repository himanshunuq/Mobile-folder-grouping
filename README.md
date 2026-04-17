# 🤖 AI File Organizer — Android via ADB + Google Gemini

A Node.js CLI tool that connects to your Android phone via ADB, reads files from `/sdcard/Download/`, classifies them using **Google Gemini 1.5 Flash**, and moves them into organized category folders — all without ever deleting your originals unless a move succeeds.

---

## 📁 Project Structure

```
file-organizer/
├── index.js          # CLI entry point
├── adb.js            # ADB device & file operations
├── extractor.js      # Content extraction (PDF, DOCX, XLSX, TXT, images)
├── classifier.js     # Google Gemini AI classification
├── organizer.js      # Core orchestration loop
├── logger.js         # JSON log + console.table summary
├── .env              # GEMINI_API_KEY (never commit this)
└── package.json
```

---

## ✅ Prerequisites

### 1. Node.js 18+
```bash
node --version   # must be v18.0.0 or higher
```
Download from [nodejs.org](https://nodejs.org) if needed.

### 2. ADB (Android Debug Bridge)
Install via your package manager:

| Platform | Command |
|----------|---------|
| macOS    | `brew install android-platform-tools` |
| Ubuntu   | `sudo apt install adb` |
| Windows  | Install [Android SDK Platform Tools](https://developer.android.com/studio/releases/platform-tools) |

Verify:
```bash
adb version
```

### 3. Enable USB Debugging on your Android phone
1. Go to **Settings → About Phone** and tap **Build Number** 7 times to enable Developer Options.
2. Go to **Settings → Developer Options** and toggle **USB Debugging ON**.
3. Connect your phone via USB and accept the "Allow USB Debugging" prompt.

Verify your device is detected:
```bash
adb devices
# Should show: <serial>   device
```

---

## 🚀 Setup

### 1. Install dependencies
```bash
cd file-organizer
npm install
```

### 2. Set your Gemini API Key
Edit `.env` and replace the placeholder:
```
GEMINI_API_KEY=your_actual_key_here
```

Get a free API key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).

---

## 🏃 Running

### Step 1 — Dry Run (always try this first!)
```bash
npm run dry
# or: node index.js --dry-run
```

In dry-run mode, files are classified but **never moved**. Use this to preview what Gemini would do before committing to changes.

### Step 2 — Live Run
```bash
npm start
# or: node index.js
```

Files with confidence ≥ 0.7 are moved to:
```
/sdcard/Download/Organized/<category>/
```

### Optional Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Classify only, do not move any files |
| `--folder <path>` | Use a custom source folder instead of `/sdcard/Download` |

**Example with custom folder:**
```bash
node index.js --folder /sdcard/Documents --dry-run
```

---

## 📊 Output

After each run, the tool produces:

- **`classification_log.json`** — Full record of every file processed
- **Console table** — Summary printed at the end of the run

Sample console output:
```
╔══════════════════════════════════════╗
║   🤖  AI File Organizer via ADB      ║
╚══════════════════════════════════════╝
Mode   : DRY-RUN (no files moved)

📱  Connected device: RF8M123WXYZ
📂  Found 12 file(s) to process.
🔍  DRY-RUN mode — no files will be moved.

⏳  Processing: JavaNotes.pdf
   🏷️  Category: java (confidence: 0.92)
   🔍  [DRY-RUN] Would move → Organized/java/

📊  Classification Summary:
...

✅  Stats:
   Moved        : 0
   Skipped (dry): 12
   Unclassified : 0
   Unsupported  : 0
   Errors       : 0
```

---

## 🗂️ Supported Categories

Gemini classifies files into one of these categories:

`java` · `python` · `react` · `cpp` · `javascript` · `interview` · `math` · `physics` · `chemistry` · `history` · `general_study` · `unknown`

---

## 📄 Supported File Types

| Extension | Extraction Method |
|-----------|-------------------|
| `.pdf`    | `pdf-parse` (first 600 words) |
| `.docx`   | `mammoth` (first 600 words) |
| `.xlsx` / `.xls` | `xlsx` (all cells as CSV) |
| `.txt`    | `fs.readFileSync` (first 600 words) |
| `.jpg` / `.jpeg` / `.png` | base64 → Gemini Vision |
| Others    | Skipped, logged as `unsupported` |

---

## 🛡️ Safety Rules

- ✅ **Originals are never deleted** unless the push to `Organized/` succeeds first
- ✅ Files below **0.7 confidence** are left in place and logged as `unclassified`
- ✅ Temp folder (`./temp/`) is **always cleaned** after every run, even on errors
- ✅ All errors are caught and logged — a single failing file won't stop the run

---

## 🔧 Troubleshooting

| Problem | Solution |
|---------|----------|
| `No ADB device found` | Run `adb devices`, check cable & USB Debugging |
| `GEMINI_API_KEY is not set` | Check your `.env` file |
| `Gemini returned non-JSON` | Retry; Gemini occasionally misbehaves — it's caught and logged |
| `pdf-parse` import errors | Some PDF files may be password-protected or malformed |
| Permission denied on `/sdcard/` | Ensure USB Debugging is ON and authorization accepted |

---

## 📦 Dependencies

| Package | Purpose |
|---------|---------|
| `@devicefarmer/adbkit` | ADB protocol implementation |
| `@google/generative-ai` | Gemini AI SDK |
| `pdf-parse` | PDF text extraction |
| `mammoth` | DOCX text extraction |
| `xlsx` | Excel file reading |
| `dotenv` | Environment variable loading |
