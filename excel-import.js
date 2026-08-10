/* ==========================================================
   Toll Audit Assistant
   excel-import.js

   Excel Report Upload → Auto-Audit → Review/Edit → Inject
   ──────────────────────────────────────────────────────────
   Reads the user's audit Excel (Violation + Exemption matrix
   format) and converts it into the app's auditDataStore
   bucket so the audit appears as if done manually.

   Excel format expected:
     Sheet 1 (or named "Violation") OR both sections in one sheet:
       Row with "Violation" heading → followed by matrix
       Row with "Exemption" heading → followed by matrix

     Matrix structure:
       Header row (yellow): CAR | LCV/MINIBUS | Truck 2 Axle | ... (system report classes)
       Row above headers: "Actual Class after Validate" label row
       Data rows: actual vehicle name | count per system-class column
========================================================== */

/* ─────────────────────────────────────────────────────────
   COLUMN → APP CATEGORY MAPPING
   Maps Excel column header text → REPORT_CATEGORIES key
───────────────────────────────────────────────────────── */
const XL_COL_MAP = {
  "car":            "Car",
  "lcv":            "LCV",
  "lcv/minibus":    "LCV",
  "minibus":        "LCV",
  "truck 2 axle":   "Truck 2 Axle",
  "truck2axle":     "Truck 2 Axle",
  "truck 3 axle":   "Truck 3 Axle",
  "truck3axle":     "Truck 3 Axle",
  "mav":            "MAV",
  "mav 4-6 axle":   "MAV",
  "mav 4 -6 axle":  "MAV",
  "mav 4–6 axle":   "MAV",
  "mav 4 – 6 axle": "MAV",
  "auto":           "Auto",
  "tractor":        "Tractor",
  "bus 2 axle":     "Bus 2 Axle",
  "bus2axle":       "Bus 2 Axle",
};

/* ─────────────────────────────────────────────────────────
   ROW LABEL → APP VEHICLE CLASS MAPPING
   Maps Excel row label → VEHICLE_CLASSES key
───────────────────────────────────────────────────────── */
const XL_ROW_MAP = {
  "car":                     "Car",
  "lcv":                     "LCV",
  "lcv/minibus":             "LCV",
  "minibus":                 "LCV",
  "truck 2 axle":            "Truck 2 Axle",
  "truck2axle":              "Truck 2 Axle",
  "truck 3 axle":            "Truck 3 Axle",
  "truck3axle":              "Truck 3 Axle",
  "mav":                     "MAV",
  "mav 4-6 axle":            "MAV",
  "mav 4 -6 axle":           "MAV",
  "mav 4–6 axle":            "MAV",
  "mav 4 – 6 axle":          "MAV",
  "auto":                    "Auto",
  "tractor":                 "Tractor",
  "bus 2 axle":              "Bus 2 Axle",
  "bus2axle":                "Bus 2 Axle",
  "forcefully":              "Forcefully",
  "force fully":             "Forcefully",
  "fake transaction":        "Fake Violation",
  "fake violation":          "Fake Violation",
  "fake exemption":          "Fake Exemption",
  "bike":                    "Bike",
  "ambulance":               "Ambulance",
  "police":                  "Police",
  "govt. vehicle":           "Government Vehicle",
  "govt vehicle":            "Government Vehicle",
  "government vehicle":      "Government Vehicle",
  "army vehicle":            "Army Vehicle",
  "concessionaire":          "Concessionaire",
  "jcb":                     "JCB",
  "pass monthly/local":      "Has Pass",
  "pass monthly":            "Has Pass",
  "monthly pass":            "Has Pass",
  "already paid found with another  txn": "Paid (Cash)",
  "already paid found with another txn":  "Paid (Cash)",
  "already paid":            "Paid (Cash)",
};

function _normalizeKey(str) {
  return String(str || "").toLowerCase().trim()
    .replace(/\s+/g, " ")
    .replace(/–/g, "-");
}

/* ─────────────────────────────────────────────────────────
   PARSE EXCEL FILE
   Returns: { ok, error, violation: matrix, exemption: matrix }
   matrix = { reportCounts: {Cat: N}, rows: [{vehicle, counts:{Cat:N}}] }
───────────────────────────────────────────────────────── */
function parseAuditExcel(file) {
  return new Promise((resolve) => {
    if (typeof XLSX === "undefined") {
      return resolve({ ok: false, error: "Excel library not loaded. Refresh the page." });
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb  = XLSX.read(e.target.result, { type: "binary" });
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

/* Try to find Violation and Exemption matrices in the workbook */
function _extractBothModes(wb) {
  let violation = null;
  let exemption = null;

  /* Strategy 1: separate sheets named "Violation" / "Exemption" */
  wb.SheetNames.forEach(name => {
    const norm = _normalizeKey(name);
    const data = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    if (norm === "violation" && !violation)  violation = _parseMatrix(data);
    if (norm === "exemption" && !exemption)  exemption = _parseMatrix(data);
  });

  /* Strategy 2: first sheet contains both, separated by "Violation" / "Exemption" heading rows */
  if (!violation || !exemption) {
    const sheet0 = wb.Sheets[wb.SheetNames[0]];
    const allRows = XLSX.utils.sheet_to_json(sheet0, { header: 1, defval: "" });
    const { vBlock, eBlock } = _splitByHeadings(allRows);
    if (!violation && vBlock.length) violation = _parseMatrix(vBlock);
    if (!exemption && eBlock.length) exemption = _parseMatrix(eBlock);
  }

  /* Fallback: treat first sheet as Violation, second as Exemption */
  if (!violation && wb.SheetNames[0]) {
    const d = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, defval:"" });
    violation = _parseMatrix(d);
  }
  if (!exemption && wb.SheetNames[1]) {
    const d = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[1]], { header:1, defval:"" });
    exemption = _parseMatrix(d);
  }

  if (!violation && !exemption) {
    return { ok: false, error: "Koi valid audit matrix nahi mila Excel mein." };
  }
  return { ok: true, violation, exemption };
}

/* Split a flat array of rows into Violation block and Exemption block */
function _splitByHeadings(rows) {
  let vStart = -1, eStart = -1;
  rows.forEach((row, i) => {
    const first = _normalizeKey(String(row[0] || "") + String(row[1] || "") + String(row[2] || ""));
    if (first.includes("violation") && vStart === -1) vStart = i;
    if (first.includes("exemption") && eStart === -1) eStart = i;
  });
  const vBlock = vStart >= 0 ? rows.slice(vStart, eStart >= 0 && eStart > vStart ? eStart : undefined) : [];
  const eBlock = eStart >= 0 ? rows.slice(eStart) : [];
  return { vBlock, eBlock };
}

/* Parse one matrix block into { reportCounts, vehicleRows } */
function _parseMatrix(rows) {
  if (!rows || rows.length < 3) return null;

  /* Find the column-header row (contains "CAR" or "LCV" etc.) */
  let colHeaderIdx = -1;
  let colHeaders   = [];

  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i];
    const norm = row.map(c => _normalizeKey(String(c)));
    if (norm.some(c => XL_COL_MAP[c])) {
      colHeaderIdx = i;
      colHeaders   = norm;
      break;
    }
  }
  if (colHeaderIdx < 0) return null;

  /* Map column index → REPORT_CATEGORIES key */
  const colIndexToCategory = {};
  colHeaders.forEach((h, idx) => {
    if (XL_COL_MAP[h]) colIndexToCategory[idx] = XL_COL_MAP[h];
  });

  const validCols = Object.keys(colIndexToCategory).map(Number);
  if (validCols.length === 0) return null;

  /* Report counts row — immediately before or after the col header row
     Look for the row where the values in category columns are numbers > 0 */
  let reportCounts = {};
  const rptRowIdx  = colHeaderIdx + 1;   /* yellow row is typically right after headers */
  if (rptRowIdx < rows.length) {
    const rptRow = rows[rptRowIdx];
    const firstCell = _normalizeKey(String(rptRow[0] || ""));
    /* If first cell is "actual class after validate" or blank, it's the yellow report row */
    if (firstCell === "" || firstCell.includes("actual") || firstCell.includes("validate")) {
      validCols.forEach(ci => {
        const cat = colIndexToCategory[ci];
        const val = parseInt(rptRow[ci], 10) || 0;
        if (!reportCounts[cat] || val > reportCounts[cat]) reportCounts[cat] = val;
      });
    }
  }
  /* If still empty, try row before col headers */
  if (Object.keys(reportCounts).length === 0 && colHeaderIdx > 0) {
    const rptRow2 = rows[colHeaderIdx - 1];
    validCols.forEach(ci => {
      const cat = colIndexToCategory[ci];
      const val = parseInt(rptRow2[ci], 10) || 0;
      if (!reportCounts[cat] || val > reportCounts[cat]) reportCounts[cat] = val;
    });
  }

  /* Data rows — everything after the report-count row until "Total" */
  const vehicleRows = [];
  const dataStart   = rptRowIdx + 1;

  for (let i = dataStart; i < rows.length; i++) {
    const row    = rows[i];
    const label  = _normalizeKey(String(row[0] || ""));
    if (!label || label === "total" || label.includes("class as per")) continue;

    const appVehicle = XL_ROW_MAP[label];
    if (!appVehicle) continue;   /* skip unmapped rows */

    const counts = {};
    validCols.forEach(ci => {
      const cat = colIndexToCategory[ci];
      const val = parseInt(row[ci], 10) || 0;
      if (val > 0) counts[cat] = (counts[cat] || 0) + val;
    });
    if (Object.values(counts).some(v => v > 0)) {
      vehicleRows.push({ vehicle: appVehicle, counts });
    }
  }

  return { reportCounts, vehicleRows };
}

/* ─────────────────────────────────────────────────────────
   CONVERT PARSED MATRIX → AUDIT BUCKET
   Injects into auditDataStore for the selected date.
   Each cell value = that many transactions of that vehicle
   type in that (mode, category) slot.
───────────────────────────────────────────────────────── */
function matrixToBucket(violation, exemption, dateKey) {
  const bucket = (typeof createEmptyAuditBucket === "function")
    ? createEmptyAuditBucket()
    : _fallbackEmptyBucket();

  _fillMode(bucket, "Violation", violation);
  _fillMode(bucket, "Exemption", exemption);
  return bucket;
}

function _fallbackEmptyBucket() {
  const bucket = { _meta: { resolved: false, resolution: null, resolvedAt: null } };
  ["Violation", "Exemption"].forEach(mode => {
    bucket[mode] = {};
    ["Car","LCV","Truck 2 Axle","Truck 3 Axle","MAV","Auto","Tractor","Bus 2 Axle"].forEach(cat => {
      bucket[mode][cat] = { reportCount: 0, transactions: [], vehicleCounts: {} };
    });
  });
  return bucket;
}

function _fillMode(bucket, modeName, matrix) {
  if (!matrix) return;
  const modeData = bucket[modeName];
  if (!modeData) return;

  /* Set reportCounts */
  Object.entries(matrix.reportCounts || {}).forEach(([cat, count]) => {
    if (modeData[cat]) modeData[cat].reportCount = count;
  });

  /* Build transactions from vehicleRows */
  matrix.vehicleRows.forEach(({ vehicle, counts }) => {
    Object.entries(counts).forEach(([cat, count]) => {
      if (!modeData[cat]) return;
      const catData = modeData[cat];
      for (let n = 0; n < count; n++) {
        const txnNo = catData.transactions.length + 1;
        catData.transactions.push({
          transactionNo: txnNo,
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
   BUILD REVIEW HTML
   Shows a confirmation table the user can check before saving.
───────────────────────────────────────────────────────── */
function buildImportReviewHtml(violation, exemption) {
  const CATS = ["Car","LCV","Truck 2 Axle","Truck 3 Axle","MAV","Auto","Tractor","Bus 2 Axle"];

  function modeTable(modeName, matrix) {
    if (!matrix) return `<p class="xl-import-empty">No ${modeName} data found.</p>`;

    const rc  = matrix.reportCounts || {};
    const veh = {};
    (matrix.vehicleRows || []).forEach(({ vehicle, counts }) => {
      Object.entries(counts).forEach(([cat, n]) => {
        if (!veh[cat]) veh[cat] = {};
        veh[cat][vehicle] = (veh[cat][vehicle] || 0) + n;
      });
    });

    /* Collect all vehicles that appear */
    const allVehicles = [...new Set((matrix.vehicleRows || []).map(r => r.vehicle))];

    let html = `
      <div class="xl-mode-block">
        <div class="xl-mode-label xl-mode-${modeName.toLowerCase()}">${modeName}</div>
        <div class="xl-table-scroll">
        <table class="xl-review-table" id="xlRevTable_${modeName}">
          <thead>
            <tr>
              <th>Actual Vehicle</th>
              ${CATS.map(c => `<th>${c}</th>`).join("")}
              <th>Row Total</th>
            </tr>
            <tr class="xl-report-row">
              <td class="xl-rc-label">System Report Count</td>
              ${CATS.map(c => `<td class="xl-rc-cell" data-mode="${modeName}" data-cat="${c}">
                <input type="number" class="xl-rc-input" min="0" value="${rc[c] || 0}"
                  data-mode="${modeName}" data-cat="${c}">
              </td>`).join("")}
              <td class="xl-rc-total">${CATS.reduce((s,c) => s + (rc[c]||0), 0)}</td>
            </tr>
          </thead>
          <tbody>`;

    allVehicles.forEach(vehicle => {
      const rowCounts = CATS.map(c => (veh[c] && veh[c][vehicle]) || 0);
      const rowTotal  = rowCounts.reduce((a,b) => a+b, 0);
      if (rowTotal === 0) return;
      html += `<tr data-vehicle="${vehicle}">
        <td class="xl-veh-label">${vehicle}</td>
        ${CATS.map((c, i) => `<td>
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
              ${CATS.map(c => `<td class="xl-col-total" data-mode="${modeName}" data-cat="${c}">
                ${Object.values(veh[c]||{}).reduce((a,b)=>a+b,0)}
              </td>`).join("")}
              <td></td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>`;
    return html;
  }

  return modeTable("Violation", violation) + modeTable("Exemption", exemption);
}

/* ─────────────────────────────────────────────────────────
   COLLECT EDITED DATA FROM REVIEW TABLE
   Returns updated { violation, exemption } matrices from DOM.
───────────────────────────────────────────────────────── */
function collectEditedMatrices() {
  const CATS = ["Car","LCV","Truck 2 Axle","Truck 3 Axle","MAV","Auto","Tractor","Bus 2 Axle"];
  const result = { violation: null, exemption: null };

  ["Violation", "Exemption"].forEach(modeName => {
    const reportCounts = {};
    const vehicleMap   = {};

    /* Collect report counts */
    document.querySelectorAll(`.xl-rc-input[data-mode="${modeName}"]`).forEach(inp => {
      const cat = inp.dataset.cat;
      reportCounts[cat] = parseInt(inp.value, 10) || 0;
    });

    /* Collect vehicle counts per cell */
    document.querySelectorAll(`.xl-cell-input[data-mode="${modeName}"]`).forEach(inp => {
      const cat     = inp.dataset.cat;
      const vehicle = inp.dataset.vehicle;
      const val     = parseInt(inp.value, 10) || 0;
      if (val > 0) {
        if (!vehicleMap[vehicle]) vehicleMap[vehicle] = {};
        vehicleMap[vehicle][cat] = (vehicleMap[vehicle][cat] || 0) + val;
      }
    });

    const vehicleRows = Object.entries(vehicleMap).map(([vehicle, counts]) => ({ vehicle, counts }));

    result[modeName.toLowerCase()] = { reportCounts, vehicleRows };
  });

  return result;
}

/* ─────────────────────────────────────────────────────────
   RECALCULATE ROW & COLUMN TOTALS IN REVIEW TABLE
───────────────────────────────────────────────────────── */
function recalcReviewTotals(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;

  /* Row totals */
  table.querySelectorAll("tbody tr").forEach(tr => {
    const inputs = tr.querySelectorAll(".xl-cell-input");
    const total  = Array.from(inputs).reduce((s, inp) => s + (parseInt(inp.value,10)||0), 0);
    const cell   = tr.querySelector(".xl-row-total");
    if (cell) cell.textContent = total;
  });

  /* Col totals */
  const CATS = ["Car","LCV","Truck 2 Axle","Truck 3 Axle","MAV","Auto","Tractor","Bus 2 Axle"];
  const mode = tableId.replace("xlRevTable_", "");
  CATS.forEach(cat => {
    let colSum = 0;
    table.querySelectorAll(`.xl-cell-input[data-cat="${cat}"]`).forEach(inp => {
      colSum += parseInt(inp.value,10) || 0;
    });
    const colCell = table.querySelector(`.xl-col-total[data-cat="${cat}"]`);
    if (colCell) colCell.textContent = colSum;
  });

  /* Report count row total */
  let rcTotal = 0;
  table.querySelectorAll(".xl-rc-input").forEach(inp => rcTotal += parseInt(inp.value,10)||0);
  const rcTotalCell = table.querySelector(".xl-rc-total");
  if (rcTotalCell) rcTotalCell.textContent = rcTotal;
}

/* ─────────────────────────────────────────────────────────
   INIT — wire up the Import button in the sidebar
───────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {

  const importBtn = document.getElementById("xlImportBtn");
  const fileInput = document.getElementById("xlImportFileInput");
  const modal     = document.getElementById("xlImportModal");
  const bsModal   = modal ? new bootstrap.Modal(modal) : null;

  if (importBtn) {
    importBtn.addEventListener("click", () => {
      if (fileInput) fileInput.click();
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;

      /* Show loading */
      const reviewBody  = document.getElementById("xlImportReviewBody");
      const statusEl    = document.getElementById("xlImportStatus");
      if (reviewBody) reviewBody.innerHTML = `<div class="xl-loading"><i class="bi bi-hourglass-split"></i> Parsing Excel…</div>`;
      if (statusEl)   statusEl.textContent = "";
      if (bsModal)    bsModal.show();

      const parsed = await parseAuditExcel(file);
      fileInput.value = "";   /* reset so same file can be re-uploaded */

      if (!parsed.ok) {
        if (reviewBody) reviewBody.innerHTML = `<div class="xl-error"><i class="bi bi-exclamation-triangle-fill"></i> ${parsed.error}</div>`;
        return;
      }

      /* Store parsed result on the modal element for later use */
      modal._xlParsed = parsed;
      if (reviewBody) reviewBody.innerHTML = buildImportReviewHtml(parsed.violation, parsed.exemption);

      /* Wire up live recalc on every input change */
      ["Violation","Exemption"].forEach(m => {
        const tbl = document.getElementById(`xlRevTable_${m}`);
        if (tbl) tbl.addEventListener("input", () => recalcReviewTotals(`xlRevTable_${m}`));
      });

      if (statusEl) statusEl.textContent = "";
    });
  }

  /* Confirm & Save button */
  const confirmBtn = document.getElementById("xlImportConfirmBtn");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      const dateKey = selectedAuditDate || getTodayKey();
      const edited  = collectEditedMatrices();
      const bucket  = matrixToBucket(edited.violation, edited.exemption, dateKey);

      /* Inject into auditDataStore */
      auditDataStore[dateKey] = bucket;
      saveAuditData();
      setActiveAuditDate(dateKey);

      /* Refresh app UI */
      if (typeof refreshUI === "function") refreshUI();
      if (typeof renderHistoryPanel === "function") renderHistoryPanel();

      if (bsModal) bsModal.hide();

      /* Toast */
      if (typeof showToast === "function") {
        const vTotal = Object.values(edited.violation?.reportCounts || {}).reduce((a,b)=>a+b,0);
        const eTotal = Object.values(edited.exemption?.reportCounts || {}).reduce((a,b)=>a+b,0);
        showToast("Audit Imported ✓",
          `${vTotal} violations + ${eTotal} exemptions loaded for ${dateKey}`,
          "success", 5000);
      }
    });
  }

});
