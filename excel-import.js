/* ==========================================================
   Toll Audit Assistant
   excel-import.js  v2

   Excel Report Upload → Auto-Audit → Review/Edit → Inject
   ──────────────────────────────────────────────────────────
   Handles the matrix format:
     Row: "Violation" or "Exemption" heading
     Row: "Class as per System Report"  (merged header, ignored)
     Row: CAR | LCV/MINIBUS | Truck 2 Axle | … | Total   ← col headers
     Row: "Actual Class after Validate" | 131 | 6 | …     ← report counts (yellow)
     Row: CAR | 122 | | …                                  ← data rows
     …
     Row: Total | 131 | 6 | …                              ← skip
========================================================== */

/* ─────────────────────────────────────────────────────────
   COLUMN → APP CATEGORY   (text matching, case-insensitive)
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
  "auto":                                  "Auto",
  "tractor":                               "Tractor",
  "bus 2 axle":                            "Bus 2 Axle",
  "bus2 axle":                             "Bus 2 Axle",
  "forcefully":                            "Forcefully",
  "force fully":                           "Forcefully",
  "fake transaction":                      "Fake Violation",
  "fake violation":                        "Fake Violation",
  "fake exemption":                        "Fake Exemption",
  "bike":                                  "Bike",
  "ambulance":                             "Ambulance",
  "police":                                "Police",
  "govt. vehicle":                         "Government Vehicle",
  "govt vehicle":                          "Government Vehicle",
  "government vehicle":                    "Government Vehicle",
  "army vehicle":                          "Army Vehicle",
  "concessionaire":                        "Concessionaire",
  "jcb":                                   "JCB",
  "pass monthly/local":                    "Has Pass",
  "pass monthly":                          "Has Pass",
  "monthly pass":                          "Has Pass",
  /* "Already Paid" rows — stored specially, asked payment mode at review step */
  "already paid found with another  txn":  "_ALREADY_PAID",
  "already paid found with another txn":   "_ALREADY_PAID",
  "already paid":                          "_ALREADY_PAID",
};

/* REPORT_CATEGORIES in the app */
const XL_CATS = ["Car","LCV","Truck 2 Axle","Truck 3 Axle","MAV","Auto","Tractor","Bus 2 Axle"];

/* Payment mode options for "Already Paid" dialog */
const XL_PAID_VEHICLES = ["Paid (Cash)", "Paid (ETC)", "Paid (Digital)"];

/* ─────────────────────────────────────────────────────────
   NORMALIZE HELPER
───────────────────────────────────────────────────────── */
function _normalizeKey(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/\u2013|\u2014/g, "-")   // en-dash, em-dash → hyphen
    .replace(/\s+/g, " ");
}

/* ─────────────────────────────────────────────────────────
   PARSE EXCEL FILE
───────────────────────────────────────────────────────── */
function parseAuditExcel(file) {
  return new Promise((resolve) => {
    if (typeof XLSX === "undefined") {
      return resolve({ ok: false, error: "Excel library not loaded. Refresh the page." });
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb     = XLSX.read(e.target.result, { type: "binary" });
        const result = _extractBothModes(wb);
        resolve(result);
      } catch (err) {
        resolve({ ok: false, error: "Excel parse error: " + err.message });
      }
    };
    reader.onerror = () => resolve({ ok: false, error: "File read failed." });
    reader.readAsBinaryString(file);
  });
}

/* ── Try every strategy to find Violation + Exemption ── */
function _extractBothModes(wb) {
  let violation = null;
  let exemption = null;

  /* Strategy 1: sheets explicitly named "Violation" / "Exemption" */
  wb.SheetNames.forEach(name => {
    const norm = _normalizeKey(name);
    if (norm.includes("violation") && !violation) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
      violation = _parseMatrix(rows);
    }
    if (norm.includes("exemption") && !exemption) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
      exemption = _parseMatrix(rows);
    }
  });

  /* Strategy 2: all sheets stacked — scan every sheet for both headings */
  wb.SheetNames.forEach(name => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    const { vBlock, eBlock } = _splitByHeadings(rows);
    if (!violation && vBlock.length > 2) violation = _parseMatrix(vBlock);
    if (!exemption && eBlock.length > 2) exemption = _parseMatrix(eBlock);
  });

  /* Strategy 3: first sheet = Violation, second = Exemption (fallback) */
  if (!violation && wb.SheetNames[0]) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
    violation = _parseMatrix(rows);
  }
  if (!exemption && wb.SheetNames[1]) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[1]], { header: 1, defval: "" });
    exemption = _parseMatrix(rows);
  }

  if (!violation && !exemption) {
    return { ok: false, error: "Koi valid audit matrix nahi mila Excel mein. Check karein ki sheet mein 'Violation' / 'Exemption' heading ho aur column headers (CAR, LCV…) ho." };
  }
  return { ok: true, violation, exemption };
}

/* ── Split flat row array into Violation block and Exemption block ── */
function _splitByHeadings(rows) {
  let vStart = -1, eStart = -1;
  rows.forEach((row, i) => {
    /* Check any cell in the row for the heading word */
    const rowText = row.map(c => _normalizeKey(String(c))).join(" ");
    if (rowText.includes("violation") && vStart === -1 && !rowText.includes("exemption")) vStart = i;
    if (rowText.includes("exemption") && eStart === -1) eStart = i;
  });
  const vEnd    = eStart >= 0 && eStart > vStart ? eStart : undefined;
  const vBlock  = vStart >= 0 ? rows.slice(vStart, vEnd) : [];
  const eBlock  = eStart >= 0 ? rows.slice(eStart) : [];
  return { vBlock, eBlock };
}

/* ─────────────────────────────────────────────────────────
   CORE PARSER
   Finds the column-header row (CAR / LCV…), then:
     - row immediately after = report counts ("Actual Class after Validate")
     - rows after that      = actual vehicle data
───────────────────────────────────────────────────────── */
function _parseMatrix(rows) {
  if (!rows || rows.length < 3) return null;

  /* ── Step 1: find column-header row ── */
  let colHeaderIdx = -1;
  let colHeaders   = [];

  for (let i = 0; i < rows.length; i++) {
    const norm = rows[i].map(c => _normalizeKey(String(c)));
    const matchCount = norm.filter(c => !!XL_COL_MAP[c]).length;
    if (matchCount >= 2) {   /* at least 2 category columns found = confident match */
      colHeaderIdx = i;
      colHeaders   = norm;
      break;
    }
  }
  if (colHeaderIdx < 0) return null;

  /* ── Step 2: map column index → REPORT_CATEGORIES ── */
  const colIdxToCat = {};
  colHeaders.forEach((h, idx) => {
    if (XL_COL_MAP[h]) colIdxToCat[idx] = XL_COL_MAP[h];
  });
  const validCols = Object.keys(colIdxToCat).map(Number);
  if (validCols.length === 0) return null;

  /* ── Step 3: find report-counts row ──
     It immediately follows the col-header row, and its first cell is
     either blank OR "Actual Class after Validate" (any variation).
     We scan up to 3 rows ahead to be robust. */
  let reportCounts = {};
  let reportRowIdx = -1;

  for (let ri = colHeaderIdx + 1; ri <= Math.min(colHeaderIdx + 3, rows.length - 1); ri++) {
    const row       = rows[ri];
    const firstCell = _normalizeKey(String(row[0] || ""));
    const isLabelRow = firstCell === "" ||
                       firstCell.includes("actual") ||
                       firstCell.includes("validate") ||
                       firstCell.includes("class after");

    /* Also accept if the row has numbers in the category columns */
    const hasNumbers = validCols.some(ci => {
      const v = parseFloat(String(row[ci] || "").replace(/,/g,""));
      return !isNaN(v) && v > 0;
    });

    if (isLabelRow || (hasNumbers && firstCell !== "total")) {
      reportRowIdx = ri;
      validCols.forEach(ci => {
        const cat = colIdxToCat[ci];
        const raw = String(row[ci] || "").replace(/,/g, "");
        const val = parseInt(raw, 10) || 0;
        if (val > 0) reportCounts[cat] = val;
      });
      break;
    }
  }

  /* ── Step 4: data rows ── */
  const vehicleRows = [];
  const dataStart   = (reportRowIdx >= 0 ? reportRowIdx : colHeaderIdx) + 1;

  for (let i = dataStart; i < rows.length; i++) {
    const row    = rows[i];
    const label  = _normalizeKey(String(row[0] || ""));

    if (!label) continue;
    if (label === "total" || label.startsWith("total")) continue;
    if (label.includes("class as per") || label.includes("system report")) continue;

    const appVehicle = XL_ROW_MAP[label];
    if (!appVehicle) continue;

    const counts = {};
    validCols.forEach(ci => {
      const cat = colIdxToCat[ci];
      const raw = String(row[ci] || "").replace(/,/g, "");
      const val = parseInt(raw, 10) || 0;
      if (val > 0) counts[cat] = (counts[cat] || 0) + val;
    });

    if (Object.values(counts).some(v => v > 0)) {
      vehicleRows.push({ vehicle: appVehicle, counts });
    }
  }

  return { reportCounts, vehicleRows };
}

/* ─────────────────────────────────────────────────────────
   BUILD REVIEW HTML
   Colors are purely for UI clarity (not from Excel colors).
   Violation = red-ish label, Exemption = green-ish label.
   "Already Paid" rows get a special payment-mode selector.
───────────────────────────────────────────────────────── */
function buildImportReviewHtml(violation, exemption) {

  function modeTable(modeName, matrix) {
    if (!matrix) {
      return `<div class="xl-mode-block">
        <div class="xl-mode-label xl-mode-${modeName.toLowerCase()}">${modeName}</div>
        <p class="xl-import-empty" style="padding:16px 0;font-size:13px;color:var(--text-faint);">
          <i class="bi bi-info-circle"></i> Is mode ka koi data nahi mila.
        </p>
      </div>`;
    }

    const rc  = matrix.reportCounts || {};
    /* vehicleRows indexed by vehicle name → { cat: count } */
    const vehMap = {};
    (matrix.vehicleRows || []).forEach(({ vehicle, counts }) => {
      if (!vehMap[vehicle]) vehMap[vehicle] = {};
      Object.entries(counts).forEach(([cat, n]) => {
        vehMap[vehicle][cat] = (vehMap[vehicle][cat] || 0) + n;
      });
    });

    const allVehicles = Object.keys(vehMap);
    /* Separate already-paid rows from normal rows */
    const normalVehicles = allVehicles.filter(v => v !== "_ALREADY_PAID");
    const hasPaidRow     = !!vehMap["_ALREADY_PAID"];
    const paidCounts     = vehMap["_ALREADY_PAID"] || {};
    const paidTotal      = Object.values(paidCounts).reduce((a,b)=>a+b,0);

    let html = `
      <div class="xl-mode-block">
        <div class="xl-mode-label xl-mode-${modeName.toLowerCase()}">${modeName}</div>`;

    /* ── Main matrix table ── */
    html += `
        <div class="xl-table-scroll">
        <table class="xl-review-table" id="xlRevTable_${modeName}">
          <thead>
            <tr>
              <th>Actual Vehicle</th>
              ${XL_CATS.map(c => `<th>${c}</th>`).join("")}
              <th>Row Total</th>
            </tr>
            <tr class="xl-report-row">
              <td class="xl-rc-label">
                <i class="bi bi-clipboard-data-fill" style="margin-right:5px;"></i>
                System Report Count
              </td>
              ${XL_CATS.map(c => `<td>
                <input type="number" class="xl-rc-input" min="0" value="${rc[c] || 0}"
                  data-mode="${modeName}" data-cat="${c}">
              </td>`).join("")}
              <td class="xl-rc-total">${XL_CATS.reduce((s,c)=>s+(rc[c]||0),0)}</td>
            </tr>
          </thead>
          <tbody>`;

    normalVehicles.forEach(vehicle => {
      const rowCounts = XL_CATS.map(c => (vehMap[vehicle] && vehMap[vehicle][c]) || 0);
      const rowTotal  = rowCounts.reduce((a,b)=>a+b,0);
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

    html += `
          </tbody>
          <tfoot>
            <tr class="xl-col-total-row">
              <td>Col Total</td>
              ${XL_CATS.map(c => {
                const sum = normalVehicles.reduce((s,v) => s + ((vehMap[v]||{})[c]||0), 0);
                return `<td class="xl-col-total" data-mode="${modeName}" data-cat="${c}">${sum}</td>`;
              }).join("")}
              <td></td>
            </tr>
          </tfoot>
        </table>
        </div>`;

    /* ── Already Paid section ── */
    if (hasPaidRow && paidTotal > 0) {
      html += `
        <div class="xl-paid-section" data-mode="${modeName}">
          <div class="xl-paid-header">
            <i class="bi bi-cash-coin"></i>
            Already Paid Transactions Found
            <span class="xl-paid-badge">${paidTotal}</span>
          </div>
          <div class="xl-paid-body">
            <p class="xl-paid-hint">
              Kuch transactions "Already Paid" category mein hain.
              Har category ke liye payment mode select karo — woh transactions usi mode mein add ho jaayenge.
            </p>
            ${XL_CATS.filter(c => (paidCounts[c]||0) > 0).map(c => `
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

    html += `</div>`;
    return html;
  }

  return modeTable("Violation", violation) + modeTable("Exemption", exemption);
}

/* ─────────────────────────────────────────────────────────
   COLLECT EDITED MATRICES FROM DOM
───────────────────────────────────────────────────────── */
function collectEditedMatrices() {
  const result = { violation: null, exemption: null };

  ["Violation", "Exemption"].forEach(modeName => {
    const reportCounts = {};
    const vehicleMap   = {};

    /* Fixed report counts */
    document.querySelectorAll(`.xl-rc-input[data-mode="${modeName}"]`).forEach(inp => {
      reportCounts[inp.dataset.cat] = parseInt(inp.value, 10) || 0;
    });

    /* Cell counts */
    document.querySelectorAll(`.xl-cell-input[data-mode="${modeName}"]`).forEach(inp => {
      const val = parseInt(inp.value, 10) || 0;
      if (val > 0) {
        const { cat, vehicle } = inp.dataset;
        if (!vehicleMap[vehicle]) vehicleMap[vehicle] = {};
        vehicleMap[vehicle][cat] = (vehicleMap[vehicle][cat] || 0) + val;
      }
    });

    /* Already-paid selects — add to corresponding paid-vehicle type */
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

    const vehicleRows = Object.entries(vehicleMap).map(([vehicle, counts]) => ({ vehicle, counts }));
    result[modeName.toLowerCase()] = { reportCounts, vehicleRows };
  });

  return result;
}

/* ─────────────────────────────────────────────────────────
   CONVERT MATRICES → AUDIT BUCKET
───────────────────────────────────────────────────────── */
function matrixToBucket(violation, exemption) {
  const bucket = (typeof createEmptyAuditBucket === "function")
    ? createEmptyAuditBucket()
    : _fallbackEmptyBucket();

  _fillMode(bucket, "Violation", violation);
  _fillMode(bucket, "Exemption", exemption);
  return bucket;
}

function _fallbackEmptyBucket() {
  const b = { _meta: { resolved: false, resolution: null, resolvedAt: null } };
  ["Violation","Exemption"].forEach(mode => {
    b[mode] = {};
    XL_CATS.forEach(cat => {
      b[mode][cat] = { reportCount: 0, transactions: [], vehicleCounts: {} };
    });
  });
  return b;
}

function _fillMode(bucket, modeName, matrix) {
  if (!matrix) return;
  const modeData = bucket[modeName];
  if (!modeData) return;

  Object.entries(matrix.reportCounts || {}).forEach(([cat, count]) => {
    if (modeData[cat]) modeData[cat].reportCount = count;
  });

  matrix.vehicleRows.forEach(({ vehicle, counts }) => {
    Object.entries(counts).forEach(([cat, count]) => {
      if (!modeData[cat]) return;
      const catData = modeData[cat];
      for (let n = 0; n < count; n++) {
        catData.transactions.push({
          transactionNo: catData.transactions.length + 1,
          actualVehicle: vehicle,
          comment:       "",
          timestamp:     new Date().toISOString()
        });
        if (typeof catData.vehicleCounts[vehicle] !== "number") catData.vehicleCounts[vehicle] = 0;
        catData.vehicleCounts[vehicle]++;
      }
    });
  });
}

/* ─────────────────────────────────────────────────────────
   LIVE RECALC — row & col totals
───────────────────────────────────────────────────────── */
function recalcReviewTotals(modeName) {
  const table = document.getElementById(`xlRevTable_${modeName}`);
  if (!table) return;

  /* Row totals */
  table.querySelectorAll("tbody tr").forEach(tr => {
    const inputs = tr.querySelectorAll(".xl-cell-input");
    const total  = Array.from(inputs).reduce((s, inp) => s + (parseInt(inp.value,10)||0), 0);
    const cell   = tr.querySelector(".xl-row-total");
    if (cell) cell.textContent = total;
  });

  /* Col totals */
  XL_CATS.forEach(cat => {
    let colSum = 0;
    table.querySelectorAll(`.xl-cell-input[data-cat="${cat}"]`).forEach(inp => {
      colSum += parseInt(inp.value,10) || 0;
    });
    const colCell = table.querySelector(`.xl-col-total[data-cat="${cat}"]`);
    if (colCell) colCell.textContent = colSum;
  });

  /* Report-count row total */
  let rcTotal = 0;
  table.querySelectorAll(".xl-rc-input").forEach(inp => rcTotal += parseInt(inp.value,10)||0);
  const rcTotalCell = table.querySelector(".xl-rc-total");
  if (rcTotalCell) rcTotalCell.textContent = rcTotal;
}

/* ─────────────────────────────────────────────────────────
   VALIDATE before confirm — warn if paid selects are empty
───────────────────────────────────────────────────────── */
function _validateBeforeConfirm() {
  const empties = document.querySelectorAll(".xl-paid-mode-select");
  let unset = 0;
  empties.forEach(s => { if (!s.value) unset++; });
  if (unset > 0) {
    return confirm(
      `${unset} "Already Paid" row(s) ka payment mode select nahi kiya.\n\n` +
      "Woh transactions skip ho jayenge.\n\nPhir bhi continue karein?"
    );
  }
  return true;
}

/* ─────────────────────────────────────────────────────────
   INIT
───────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {

  const importBtn = document.getElementById("xlImportBtn");
  const fileInput = document.getElementById("xlImportFileInput");
  const modal     = document.getElementById("xlImportModal");
  let   bsModal   = null;

  /* Lazy-init Bootstrap modal only after library loads */
  function getModal() {
    if (!bsModal && modal && typeof bootstrap !== "undefined") {
      bsModal = new bootstrap.Modal(modal);
    }
    return bsModal;
  }

  if (importBtn) {
    importBtn.addEventListener("click", () => {
      if (fileInput) fileInput.click();
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;

      const reviewBody = document.getElementById("xlImportReviewBody");
      const statusEl   = document.getElementById("xlImportStatus");
      if (reviewBody) reviewBody.innerHTML = `<div class="xl-loading"><i class="bi bi-hourglass-split"></i> Excel parse ho raha hai…</div>`;
      if (statusEl)   statusEl.textContent = "";
      getModal()?.show();

      const parsed = await parseAuditExcel(file);
      fileInput.value = "";

      if (!parsed.ok) {
        if (reviewBody) reviewBody.innerHTML = `<div class="xl-error"><i class="bi bi-exclamation-triangle-fill"></i> ${parsed.error}</div>`;
        return;
      }

      modal._xlParsed = parsed;
      if (reviewBody) reviewBody.innerHTML = buildImportReviewHtml(parsed.violation, parsed.exemption);

      /* Wire live recalc */
      ["Violation","Exemption"].forEach(m => {
        const tbl = document.getElementById(`xlRevTable_${m}`);
        if (tbl) tbl.addEventListener("input", () => recalcReviewTotals(m));
      });

      if (statusEl) statusEl.textContent = "";
    });
  }

  /* Confirm & Load */
  const confirmBtn = document.getElementById("xlImportConfirmBtn");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      if (!_validateBeforeConfirm()) return;

      const dateKey = selectedAuditDate || getTodayKey();
      const edited  = collectEditedMatrices();
      const bucket  = matrixToBucket(edited.violation, edited.exemption);

      auditDataStore[dateKey] = bucket;
      saveAuditData();
      setActiveAuditDate(dateKey);

      if (typeof refreshUI          === "function") refreshUI();
      if (typeof renderHistoryPanel === "function") renderHistoryPanel();

      getModal()?.hide();

      if (typeof showToast === "function") {
        const vTotal = Object.values(edited.violation?.reportCounts || {}).reduce((a,b)=>a+b,0);
        const eTotal = Object.values(edited.exemption?.reportCounts || {}).reduce((a,b)=>a+b,0);
        showToast("Audit Imported ✓",
          `Violation: ${vTotal} | Exemption: ${eTotal} — ${dateKey} mein load ho gaya`,
          "success", 6000);
      }
    });
  }

});
