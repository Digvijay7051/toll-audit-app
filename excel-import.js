/* ==========================================================
   Toll Audit Assistant
   excel-import.js  v10  — Separate Violation / Exemption import

   New UX:
     • Two independent upload panels — one for Violation, one for Exemption
     • Each file is parsed as a SINGLE MODE — no heading detection guesswork
     • Parser scans for first col-header row (≥2 CAR/LCV/… hits) and reads
       all data rows below it — dead simple, no split logic
     • Each mode shows its own review table; user edits and confirms
     • Both modes are merged into one audit bucket on "Confirm & Load"
     • Already Paid rows → select payment mode → counted once, correctly
========================================================== */

/* ─────────────────────────────────────────────────────────
   COLUMN → APP CATEGORY
───────────────────────────────────────────────────────── */
const XL_COL_MAP = {
  "car":              "Car",
  "lcv":              "LCV",
  "lcv/minibus":      "LCV",
  "lcv / minibus":    "LCV",
  "minibus":          "LCV",
  "truck 2 axle":     "Truck 2 Axle",
  "truck2 axle":      "Truck 2 Axle",
  "truck 3 axle":     "Truck 3 Axle",
  "truck3 axle":      "Truck 3 Axle",
  "mav":              "MAV",
  "mav 4-6 axle":     "MAV",
  "mav 4 -6 axle":    "MAV",
  "mav 4 - 6 axle":   "MAV",
  "mav 4–6 axle":     "MAV",
  "mav 4 – 6 axle":   "MAV",
  "mav 4 -6axle":     "MAV",
  "mav4-6axle":       "MAV",
  "auto":             "Auto",
  "tractor":          "Tractor",
  "bus 2 axle":       "Bus 2 Axle",
  "bus2 axle":        "Bus 2 Axle",
};

/* ─────────────────────────────────────────────────────────
   ROW LABEL → APP VEHICLE CLASS
───────────────────────────────────────────────────────── */
const XL_ROW_MAP = {
  "car":                                   "Car",
  "lcv":                                   "LCV",
  "lcv/minibus":                           "LCV",
  "lcv / minibus":                         "LCV",
  "minibus":                               "LCV",
  "truck 2 axle":                          "Truck 2 Axle",
  "truck2 axle":                           "Truck 2 Axle",
  "truck 3 axle":                          "Truck 3 Axle",
  "truck3 axle":                           "Truck 3 Axle",
  "mav":                                   "MAV",
  "mav 4-6 axle":                          "MAV",
  "mav 4 -6 axle":                         "MAV",
  "mav 4 - 6 axle":                        "MAV",
  "mav 4–6 axle":                          "MAV",
  "mav 4 – 6 axle":                        "MAV",
  "mav 4 - 6  axle":                       "MAV",
  "mav4-6axle":                            "MAV",
  "auto":                                  "Auto",
  "tractor":                               "Tractor",
  "bus 2 axle":                            "Bus 2 Axle",
  "bus2 axle":                             "Bus 2 Axle",
  "forcefully":                            "Forcefully",
  "force fully":                           "Forcefully",
  "forceully":                             "Forcefully",
  "fake transaction":                      "Fake Violation",
  "fake violation":                        "Fake Violation",
  "fake exemption":                        "Fake Exemption",
  "bike":                                  "Bike",
  "two wheeler":                           "Bike",
  "2 wheeler":                             "Bike",
  "ambulance":                             "Ambulance",
  "police":                                "Police",
  "govt. vehicle":                         "Government Vehicle",
  "govt vehicle":                          "Government Vehicle",
  "government vehicle":                    "Government Vehicle",
  "govt.vehicle":                          "Government Vehicle",
  "army vehicle":                          "Army Vehicle",
  "army":                                  "Army Vehicle",
  "concessionaire":                        "Concessionaire",
  "jcb":                                   "JCB",
  "pass monthly/local":                    "Has Pass",
  "pass monthly":                          "Has Pass",
  "monthly pass":                          "Has Pass",
  "local pass":                            "Has Pass",
  "has pass":                              "Has Pass",
  "already paid found with another  txn":  "_ALREADY_PAID",
  "already paid found with another txn":   "_ALREADY_PAID",
  "already paid found":                    "_ALREADY_PAID",
  "already paid":                          "_ALREADY_PAID",
};

const XL_CATS = ["Car","LCV","Truck 2 Axle","Truck 3 Axle","MAV","Auto","Tractor","Bus 2 Axle"];

/* ─────────────────────────────────────────────────────────
   NORMALIZE
───────────────────────────────────────────────────────── */
function _normalizeKey(str) {
  return String(str ?? "")
    .toLowerCase()
    .trim()
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\s+/g, " ");
}

/* ─────────────────────────────────────────────────────────
   CORE MATRIX PARSER  (single-mode, no heading detection)
   Scans rows[] for the first col-header row (≥2 COL_MAP hits),
   then reads all data rows below it. Clean and simple.
───────────────────────────────────────────────────────── */
function _parseMatrix(rows) {
  if (!rows || rows.length < 3) return null;

  /* Step 1 — find col-header row */
  let colHeaderIdx = -1, colHeaders = [];
  for (let i = 0; i < rows.length; i++) {
    const norm = rows[i].map(c => _normalizeKey(String(c)));
    const hits = norm.filter(c => !!XL_COL_MAP[c]).length;
    if (hits >= 2) { colHeaderIdx = i; colHeaders = norm; break; }
  }
  if (colHeaderIdx < 0) return null;

  /* Step 2 — map col index → category */
  const colIdxToCat = {};
  colHeaders.forEach((h, ci) => { if (XL_COL_MAP[h]) colIdxToCat[ci] = XL_COL_MAP[h]; });
  const validCols = Object.keys(colIdxToCat).map(Number);
  if (!validCols.length) return null;

  /* Step 3 — report-count row: first row after col-header that has
     numeric values in category columns (the "Actual Class" yellow row) */
  const reportCounts = {};
  let reportRowIdx = -1;

  for (let ri = colHeaderIdx + 1; ri <= Math.min(colHeaderIdx + 5, rows.length - 1); ri++) {
    const row = rows[ri];
    const fc  = _normalizeKey(String(row[0] ?? ""));
    if (row.every(c => String(c).trim() === "")) continue;
    if (fc !== "" && XL_ROW_MAP[fc] !== undefined) break;   /* data rows started */

    const hasNum = validCols.some(ci => {
      const raw = String(row[ci] ?? "").replace(/,/g, "").trim();
      return raw !== "" && !isNaN(Number(raw));
    });
    if (hasNum) {
      reportRowIdx = ri;
      validCols.forEach(ci => {
        const raw = String(row[ci] ?? "").replace(/,/g, "").trim();
        const val = Number(raw);
        if (raw !== "" && !isNaN(val)) reportCounts[colIdxToCat[ci]] = val;
      });
      break;
    }
  }

  /* Step 4 — data rows */
  const vehicleRows = [];
  const dataStart   = (reportRowIdx >= 0 ? reportRowIdx : colHeaderIdx) + 1;

  for (let i = dataStart; i < rows.length; i++) {
    const row  = rows[i];
    const key  = _normalizeKey(String(row[0] ?? ""));
    if (!key) continue;
    if (key === "total" || key.startsWith("total ")) continue;
    if (key.includes("class as per") || key.includes("system report")) continue;
    if (key === "violation" || key === "exemption") continue;

    const appVehicle = XL_ROW_MAP[key];
    if (!appVehicle) continue;

    const counts = {};
    validCols.forEach(ci => {
      const raw = String(row[ci] ?? "").replace(/,/g, "").trim();
      const val = parseInt(raw, 10);
      if (!isNaN(val) && val > 0)
        counts[colIdxToCat[ci]] = (counts[colIdxToCat[ci]] || 0) + val;
    });
    vehicleRows.push({ vehicle: appVehicle, counts });
  }

  return { colHeaderFound: true, reportCounts, vehicleRows };
}

/* ─────────────────────────────────────────────────────────
   PARSE EXCEL FILE  (returns raw matrix, no mode guessing)
───────────────────────────────────────────────────────── */
function _parseExcelFile(file) {
  return new Promise(resolve => {
    if (typeof XLSX === "undefined")
      return resolve({ ok: false, error: "Excel library not loaded. Refresh the page." });

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb   = XLSX.read(e.target.result, { type: "binary", raw: false, cellStyles: false, cellFormula: false, cellDates: false });
        /* Use the first sheet that yields a valid parse */
        for (const name of wb.SheetNames) {
          const rows   = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
          const matrix = _parseMatrix(rows);
          if (matrix && (matrix.colHeaderFound || Object.keys(matrix.reportCounts).length > 0 || matrix.vehicleRows.length > 0))
            return resolve({ ok: true, matrix });
        }
        resolve({ ok: false, error: "Koi valid audit matrix nahi mili. File mein CAR, LCV/MINIBUS column headers hone chahiye." });
      } catch (err) {
        resolve({ ok: false, error: "Excel parse error: " + err.message });
      }
    };
    reader.onerror = () => resolve({ ok: false, error: "File read failed." });
    reader.readAsBinaryString(file);
  });
}

/* ─────────────────────────────────────────────────────────
   PARSE PDF FILE
───────────────────────────────────────────────────────── */
async function _parsePDFFile(file) {
  if (typeof pdfjsLib === "undefined")
    return { ok: false, error: "PDF library not loaded. Refresh the page." };
  try {
    const pdf  = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const allRows = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const content = await (await pdf.getPage(p)).getTextContent();
      const yMap = new Map();
      content.items.forEach(item => {
        const y = Math.round(item.transform[5] / 3) * 3;
        if (!yMap.has(y)) yMap.set(y, []);
        yMap.get(y).push({ x: item.transform[4], text: item.str.trim() });
      });
      Array.from(yMap.keys()).sort((a, b) => b - a).forEach(y => {
        const texts = yMap.get(y).sort((a, b) => a.x - b.x).map(i => i.text).filter(t => t !== "");
        if (texts.length) allRows.push(texts);
      });
    }
    if (!allRows.length)
      return { ok: false, error: "PDF mein koi text nahi mila — text-based PDF use karo." };
    const matrix = _parseMatrix(allRows);
    if (!matrix) return { ok: false, error: "PDF se matrix parse nahi hua. CAR/LCV column headers ensure karo." };
    return { ok: true, matrix };
  } catch (err) {
    return { ok: false, error: "PDF parse error: " + err.message };
  }
}

/* ─────────────────────────────────────────────────────────
   BUILD SINGLE-MODE REVIEW TABLE
───────────────────────────────────────────────────────── */
function _buildModeReviewHtml(modeName, matrix) {
  const rc = matrix.reportCounts || {};

  /* Deduplicate vehicle rows */
  const vehMap = {};
  (matrix.vehicleRows || []).forEach(({ vehicle, counts }) => {
    if (!vehMap[vehicle]) vehMap[vehicle] = {};
    Object.entries(counts || {}).forEach(([cat, n]) => {
      vehMap[vehicle][cat] = (vehMap[vehicle][cat] || 0) + n;
    });
  });

  const normalVehicles = Object.keys(vehMap).filter(v => v !== "_ALREADY_PAID");
  const paidCounts     = vehMap["_ALREADY_PAID"] || {};
  const paidTotal      = Object.values(paidCounts).reduce((a, b) => a + b, 0);

  let html = `
    <div class="xl-table-scroll">
    <table class="xl-review-table" id="xlRevTable_${modeName}">
      <thead>
        <tr>
          <th class="xl-th-vehicle">Actual Vehicle</th>
          ${XL_CATS.map(c => `<th>${c}</th>`).join("")}
          <th>Row Total</th>
        </tr>
        <tr class="xl-report-row">
          <td class="xl-rc-label"><i class="bi bi-clipboard-data-fill"></i> System Report Count</td>
          ${XL_CATS.map(c => `<td>
            <input type="number" class="xl-rc-input" min="0" value="${rc[c] ?? 0}"
              data-mode="${modeName}" data-cat="${c}">
          </td>`).join("")}
          <td class="xl-rc-total">${XL_CATS.reduce((s, c) => s + (rc[c] || 0), 0)}</td>
        </tr>
      </thead>
      <tbody>`;

  normalVehicles.forEach(vehicle => {
    const rowCounts = XL_CATS.map(c => vehMap[vehicle]?.[c] || 0);
    const rowTotal  = rowCounts.reduce((a, b) => a + b, 0);
    if (rowTotal === 0) return;
    html += `<tr data-vehicle="${vehicle}">
      <td class="xl-veh-label">${vehicle}</td>
      ${XL_CATS.map((c, i) => `<td>
        <input type="number" class="xl-cell-input" min="0" value="${rowCounts[i]}"
          data-mode="${modeName}" data-cat="${c}" data-vehicle="${vehicle}">
      </td>`).join("")}
      <td class="xl-row-total">${rowTotal}</td>
    </tr>`;
  });

  html += `</tbody>
      <tfoot>
        <tr class="xl-col-total-row">
          <td>Col Total</td>
          ${XL_CATS.map(c => {
            const sum = normalVehicles.reduce((s, v) => s + (vehMap[v]?.[c] || 0), 0);
            return `<td class="xl-col-total" data-mode="${modeName}" data-cat="${c}">${sum}</td>`;
          }).join("")}
          <td class="xl-col-total-grand" data-mode="${modeName}">
            ${XL_CATS.reduce((s, c) => s + normalVehicles.reduce((ss, v) => ss + (vehMap[v]?.[c] || 0), 0), 0)}
          </td>
        </tr>
      </tfoot>
    </table>
    </div>`;

  /* Already Paid */
  if (paidTotal > 0) {
    html += `
      <div class="xl-paid-section" data-mode="${modeName}">
        <div class="xl-paid-header">
          <i class="bi bi-cash-coin"></i> Already Paid Transactions Found
          <span class="xl-paid-badge">${paidTotal}</span>
        </div>
        <div class="xl-paid-body">
          <p class="xl-paid-hint">Payment mode select karo — woh category mein count hoga.</p>
          ${XL_CATS.filter(c => (paidCounts[c] || 0) > 0).map(c => `
            <div class="xl-paid-row">
              <div class="xl-paid-row-cat">
                <span class="xl-paid-cat-label">${c}</span>
                <span class="xl-paid-cat-count">${paidCounts[c]} transactions</span>
              </div>
              <div class="xl-paid-row-select">
                <select class="xl-paid-mode-select"
                  data-mode="${modeName}" data-cat="${c}" data-count="${paidCounts[c]}">
                  <option value="">-- Select payment mode --</option>
                  <option value="Paid (Cash)">Cash</option>
                  <option value="Paid (ETC)">ETC</option>
                  <option value="Paid (Digital)">Digital</option>
                </select>
              </div>
            </div>`).join("")}
        </div>
      </div>`;
  }

  return html;
}

/* ─────────────────────────────────────────────────────────
   LIVE RECALC
───────────────────────────────────────────────────────── */
function recalcReviewTotals(modeName) {
  const table = document.getElementById(`xlRevTable_${modeName}`);
  if (!table) return;

  table.querySelectorAll("tbody tr").forEach(tr => {
    const tot  = Array.from(tr.querySelectorAll(".xl-cell-input"))
                   .reduce((s, i) => s + (parseInt(i.value, 10) || 0), 0);
    const cell = tr.querySelector(".xl-row-total");
    if (cell) cell.textContent = tot;
  });

  let grand = 0;
  XL_CATS.forEach(cat => {
    let sum = 0;
    table.querySelectorAll(`.xl-cell-input[data-cat="${cat}"]`).forEach(i => {
      sum += parseInt(i.value, 10) || 0;
    });
    grand += sum;
    const cell = table.querySelector(`.xl-col-total[data-cat="${cat}"]`);
    if (cell) cell.textContent = sum;
  });
  const gc = table.querySelector(".xl-col-total-grand");
  if (gc) gc.textContent = grand;

  let rcTot = 0;
  table.querySelectorAll(".xl-rc-input").forEach(i => rcTot += parseInt(i.value, 10) || 0);
  const rcCell = table.querySelector(".xl-rc-total");
  if (rcCell) rcCell.textContent = rcTot;
}

/* ─────────────────────────────────────────────────────────
   COLLECT ONE MODE FROM DOM
   - Real vehicle rows only (no virtual rows)
   - Already-paid counts come ONLY from the selects
───────────────────────────────────────────────────────── */
function _collectMode(modeName) {
  const reportCounts = {};
  const vehicleMap   = {};

  document.querySelectorAll(`.xl-rc-input[data-mode="${modeName}"]`).forEach(inp => {
    reportCounts[inp.dataset.cat] = parseInt(inp.value, 10) || 0;
  });

  /* Real rows only — skip virtual paid rows */
  document.querySelectorAll(`.xl-cell-input[data-mode="${modeName}"]`).forEach(inp => {
    if (inp.closest("tr.xl-paid-virtual-row")) return;
    const val = parseInt(inp.value, 10) || 0;
    if (val > 0) {
      const { cat, vehicle } = inp.dataset;
      if (!vehicleMap[vehicle]) vehicleMap[vehicle] = {};
      vehicleMap[vehicle][cat] = (vehicleMap[vehicle][cat] || 0) + val;
    }
  });

  /* Already-paid: exactly one source — the select values */
  document.querySelectorAll(`.xl-paid-mode-select[data-mode="${modeName}"]`).forEach(sel => {
    const payVehicle = sel.value;
    if (!payVehicle) return;
    const cat   = sel.dataset.cat;
    const count = parseInt(sel.dataset.count, 10) || 0;
    if (count > 0) {
      if (!vehicleMap[payVehicle]) vehicleMap[payVehicle] = {};
      vehicleMap[payVehicle][cat] = (vehicleMap[payVehicle][cat] || 0) + count;
    }
  });

  return {
    reportCounts,
    vehicleRows: Object.entries(vehicleMap).map(([vehicle, counts]) => ({ vehicle, counts }))
  };
}

/* ─────────────────────────────────────────────────────────
   FILL BUCKET
───────────────────────────────────────────────────────── */
function _fillMode(bucket, modeName, matrix) {
  if (!matrix) return;
  const modeData = bucket[modeName];
  if (!modeData) return;

  Object.entries(matrix.reportCounts || {}).forEach(([cat, count]) => {
    if (modeData[cat]) modeData[cat].reportCount = count;
  });

  (matrix.vehicleRows || []).forEach(({ vehicle, counts }) => {
    Object.entries(counts || {}).forEach(([cat, count]) => {
      if (!modeData[cat]) return;
      const cd = modeData[cat];
      for (let n = 0; n < count; n++) {
        cd.transactions.push({
          transactionNo: cd.transactions.length + 1,
          actualVehicle: vehicle,
          comment:       "",
          timestamp:     new Date().toISOString()
        });
        if (typeof cd.vehicleCounts[vehicle] !== "number") cd.vehicleCounts[vehicle] = 0;
        cd.vehicleCounts[vehicle]++;
      }
    });
  });
}

function _fallbackEmptyBucket() {
  const b = { _meta: { resolved: false, resolution: null, resolvedAt: null } };
  ["Violation", "Exemption"].forEach(mode => {
    b[mode] = {};
    XL_CATS.forEach(cat => { b[mode][cat] = { reportCount: 0, transactions: [], vehicleCounts: {} }; });
  });
  return b;
}

/* ─────────────────────────────────────────────────────────
   WIRE INPUTS for one mode panel
───────────────────────────────────────────────────────── */
function _wireModePanel(modeName) {
  const tbl = document.getElementById(`xlRevTable_${modeName}`);
  if (tbl) tbl.addEventListener("input", () => recalcReviewTotals(modeName));
}

/* ─────────────────────────────────────────────────────────
   INIT — runs on DOMContentLoaded
───────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {

  /* ── State: parsed matrix per mode ── */
  const _state = { Violation: null, Exemption: null };

  /* ── DOM refs ── */
  const modal   = document.getElementById("xlImportModal");
  const body    = document.getElementById("xlImportReviewBody");
  const statusEl = document.getElementById("xlImportStatus");
  let bsModal   = null;

  function getModal() {
    if (!bsModal && modal && typeof bootstrap !== "undefined")
      bsModal = new bootstrap.Modal(modal);
    return bsModal;
  }

  /* Open modal on sidebar button */
  const openBtn = document.getElementById("xlImportBtn");
  if (openBtn) openBtn.addEventListener("click", () => {
    _renderPickerUI();
    getModal()?.show();
  });

  /* ── Render the two-panel picker inside modal body ── */
  function _renderPickerUI() {
    body.innerHTML = `
      <div class="xl-two-panel">

        <!-- Violation panel -->
        <div class="xl-mode-panel" id="xlViolationPanel">
          <div class="xl-mode-panel-header xl-mode-header-violation">
            <span class="xl-mode-dot xl-dot-violation"></span>
            <span class="xl-mode-title">Violation</span>
            <span class="xl-mode-status" id="xlViolationStatus">Not loaded</span>
            <button class="xl-mode-upload-btn" id="xlUploadViolationBtn" type="button">
              <i class="bi bi-upload"></i> Upload File
            </button>
          </div>
          <div class="xl-mode-panel-body" id="xlViolationBody">
            <div class="xl-mode-empty">
              <i class="bi bi-file-earmark-bar-graph"></i>
              <p>Violation report file upload karo</p>
              <p class="xl-mode-empty-sub">Excel (.xlsx/.xls) or PDF</p>
            </div>
          </div>
        </div>

        <!-- Exemption panel -->
        <div class="xl-mode-panel" id="xlExemptionPanel">
          <div class="xl-mode-panel-header xl-mode-header-exemption">
            <span class="xl-mode-dot xl-dot-exemption"></span>
            <span class="xl-mode-title">Exemption</span>
            <span class="xl-mode-status" id="xlExemptionStatus">Not loaded</span>
            <button class="xl-mode-upload-btn" id="xlUploadExemptionBtn" type="button">
              <i class="bi bi-upload"></i> Upload File
            </button>
          </div>
          <div class="xl-mode-panel-body" id="xlExemptionBody">
            <div class="xl-mode-empty">
              <i class="bi bi-file-earmark-bar-graph"></i>
              <p>Exemption report file upload karo</p>
              <p class="xl-mode-empty-sub">Excel (.xlsx/.xls) or PDF</p>
            </div>
          </div>
        </div>

      </div>`;

    _wireUploadBtn("Violation");
    _wireUploadBtn("Exemption");
  }

  /* ── Wire one upload button ── */
  function _wireUploadBtn(modeName) {
    const btn = document.getElementById(`xlUpload${modeName}Btn`);
    if (!btn) return;

    /* Create a hidden file input per mode */
    const inp = document.createElement("input");
    inp.type   = "file";
    inp.accept = ".xlsx,.xls,.pdf";
    inp.style  = "display:none";
    document.body.appendChild(inp);

    btn.addEventListener("click", () => inp.click());

    inp.addEventListener("change", async () => {
      const file = inp.files[0];
      if (!file) return;
      inp.value = "";

      const modeBody = document.getElementById(`xl${modeName}Body`);
      const modeStat = document.getElementById(`xl${modeName}Status`);

      modeBody.innerHTML = `<div class="xl-loading">
        <i class="bi bi-hourglass-split"></i> Parsing ${/\.pdf$/i.test(file.name) ? "PDF" : "Excel"}…
      </div>`;
      modeStat.textContent = "Parsing…";
      modeStat.className   = "xl-mode-status";

      const result = /\.pdf$/i.test(file.name)
        ? await _parsePDFFile(file)
        : await _parseExcelFile(file);

      if (!result.ok) {
        modeBody.innerHTML = `<div class="xl-error">
          <i class="bi bi-exclamation-triangle-fill"></i> ${result.error}
        </div>`;
        modeStat.textContent = "Error";
        modeStat.className   = "xl-mode-status xl-status-error";
        _state[modeName]     = null;
        _updateConfirmBtn();
        return;
      }

      _state[modeName] = result.matrix;
      modeBody.innerHTML = _buildModeReviewHtml(modeName, result.matrix);
      _wireModePanel(modeName);

      const total = Object.values(result.matrix.reportCounts || {}).reduce((a, b) => a + b, 0);
      modeStat.innerHTML   = `<i class="bi bi-check-circle-fill" style="color:var(--green)"></i> Loaded (${total} count)`;
      modeStat.className   = "xl-mode-status xl-status-ok";

      _updateConfirmBtn();
    });
  }

  /* ── Enable/disable Confirm button ── */
  function _updateConfirmBtn() {
    const btn = document.getElementById("xlImportConfirmBtn");
    if (!btn) return;
    const hasAny = _state.Violation || _state.Exemption;
    btn.disabled = !hasAny;
    btn.style.opacity = hasAny ? "1" : "0.4";
  }

  /* ── Confirm & Load ── */
  const confirmBtn = document.getElementById("xlImportConfirmBtn");
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = "0.4";

    confirmBtn.addEventListener("click", () => {
      /* Warn if any paid select unset */
      let unset = 0;
      document.querySelectorAll(".xl-paid-mode-select").forEach(s => { if (!s.value) unset++; });
      if (unset > 0 && !confirm(
        `${unset} "Already Paid" row(s) ka payment mode select nahi kiya.\nWoh skip ho jaayenge.\n\nPhir bhi continue karein?`
      )) return;

      const dateKey = (typeof selectedAuditDate !== "undefined" && selectedAuditDate)
        ? selectedAuditDate
        : (typeof getTodayKey === "function" ? getTodayKey() : new Date().toISOString().slice(0, 10));

      const bucket = (typeof createEmptyAuditBucket === "function")
        ? createEmptyAuditBucket()
        : _fallbackEmptyBucket();

      ["Violation", "Exemption"].forEach(mode => {
        if (_state[mode]) _fillMode(bucket, mode, _collectMode(mode));
      });

      auditDataStore[dateKey] = bucket;
      if (typeof saveAuditData      === "function") saveAuditData();
      if (typeof setActiveAuditDate === "function") setActiveAuditDate(dateKey);
      if (typeof refreshUI          === "function") refreshUI();
      if (typeof renderHistoryPanel === "function") renderHistoryPanel();

      getModal()?.hide();

      /* Reset state for next import */
      _state.Violation = null;
      _state.Exemption = null;

      if (typeof showToast === "function") {
        const vT = _state.Violation
          ? Object.values(_state.Violation.reportCounts || {}).reduce((a,b)=>a+b,0) : 0;
        const eT = _state.Exemption
          ? Object.values(_state.Exemption.reportCounts || {}).reduce((a,b)=>a+b,0) : 0;
        showToast("Audit Imported ✓",
          `${dateKey} mein load ho gaya`, "success", 5000);
      }
    });
  }

});
