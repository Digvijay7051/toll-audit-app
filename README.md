# 🚦 Toll Audit Assistant

A browser-based toll audit tracking app — works fully offline, no server needed.

---

## 🌐 Live Deploy on GitHub Pages (Free)

Follow these steps once and your app will be permanently live at a public URL.

### Step 1 — Create a GitHub Account
Go to [github.com](https://github.com) → Sign up (free).

### Step 2 — Create a New Repository
1. Click the **+** icon (top-right) → **New repository**
2. Repository name: `toll-audit-app` (or anything you like)
3. Set visibility to **Public**
4. Do **not** check "Add a README" (we already have one)
5. Click **Create repository**

### Step 3 — Upload Your Files
1. On the empty repository page, click **uploading an existing file**
2. Select **all files** from this folder:
   - `index.html`
   - `app.js`
   - `auth.js`
   - `avatar.js`
   - `backup.js`
   - `data.js`
   - `passlist.js`
   - `style.css`
   - `ui.js`
   - `.nojekyll`
   - `README.md`
3. Click **Commit changes**

### Step 4 — Enable GitHub Pages
1. Go to your repository → **Settings** tab
2. Left sidebar → **Pages**
3. Under **Source**, select:
   - Branch: `main`
   - Folder: `/ (root)`
4. Click **Save**

### Step 5 — Get Your Live URL
After ~60 seconds, GitHub will show:

```
Your site is live at: https://YOUR-USERNAME.github.io/toll-audit-app/
```

✅ Share this URL with anyone — works on mobile, desktop, tablet.

---

## 🔄 How to Update the App Later

1. Open your repository on GitHub
2. Click the file you want to update → pencil icon (Edit)
3. Make changes → **Commit changes**
4. Site updates automatically within 1–2 minutes

Or upload updated files the same way as Step 3.

---

## 📦 Files in This Project

| File | Purpose |
|------|---------|
| `index.html` | Main HTML structure — all screens and modals |
| `app.js` | Core app logic — audit flow, vehicle buttons, save/reset |
| `data.js` | Data layer — localStorage read/write, all data functions |
| `auth.js` | Login / Signup / Session management |
| `ui.js` | UI rendering — categories, history, progress bar |
| `passlist.js` | Monthly pass list — upload, search, edit, Google Sheet sync |
| `backup.js` | Full backup export / import (.json file) |
| `avatar.js` | Profile sticker / photo picker |
| `firebase.js` | Firebase Firestore + Auth integration (cloud sync) |
| `sheets.js` | Google Sheets audit log integration (Submit Audit Log button) |
| `style.css` | Custom styles |
| `.nojekyll` | Tells GitHub Pages to skip Jekyll processing (required) |

---

## 💾 Data Storage

All audit data is saved in the **browser's localStorage** — it is tied to the device and browser where the app is opened.

### To move data between devices:
Use the built-in **Backup / Restore** feature:
- Sidebar → **Backup / Restore** button
- **Export Backup File** → saves a `.json` file
- On the new device, open the app → **Import** that `.json` file

---

## 📋 Features

- ✅ Violation & Exemption audit modes
- ✅ 8 vehicle categories with report count tracking
- ✅ Transaction history with search & filter
- ✅ Export audit data as CSV
- ✅ Monthly pass list (upload Excel/CSV or sync from Google Sheet)
- ✅ Date-wise audit history
- ✅ Screen lock with PIN
- ✅ Night mode
- ✅ Full backup & restore
- ✅ Multi-user login (stored locally)
- ✅ Firebase cloud sync (audit data accessible from any device)
- ✅ Google Sheets audit log (Submit Audit Log button → central spreadsheet)
