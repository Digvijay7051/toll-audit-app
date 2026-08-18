/* ==========================================================
   Toll Audit Assistant
   excel-import.js  v7

   Excel / PDF Report Upload → Auto-Audit → Review/Edit → Inject
   ──────────────────────────────────────────────────────────
   Excel layout (single sheet or two sheets):
     Row: "Violation"                         ← mode heading
     Row: "Class as per System Report"        ← merged sub-header (skip)
     Row: CAR | LCV/MINIBUS | … | Total       ← col headers
     Row: "Actual Class after Validate" | 131 ← report counts (yellow)
     Row: CAR | 122 | …                       ← data rows
     Row: Total | 131 | …                     ← skip
     (blank rows)
     Row: "Exemption"                         ← next mode heading
     … (same structure)

   v7 fixes:
     - _isValidParse: now uses colHeaderFound flag — accepts a
       structurally-correct block even if all counts are 0 (fixes
       Violation-not-loading when SheetJS misreads merged-cell numbers)
     - _parseMatrix: returns colHeaderFound:true when col-header row
       was successfully located
     - _splitByHeadings: bidirectional cap (v6 fix retained)
     - Strategy 3: combined AND guard (v6 fix retained)
     - PDF import (v6 feature retained)
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
  /* "Already Paid" rows */
  "already paid found with another  txn":  "_ALREADY_PAID",
  "already paid found with another txn":   "_ALREADY_PAID",
  "already paid found":                    "_ALREADY_PAID",
  "already paid":                          "_ALREADY_PAID",
};

/* App report categories */
const XL_CATS = ["Car","LCV","Truck 2 Axle","Truck 3 Axle","MAV","Auto","Tractor","Bus 2 Axle"];

/* ─────────────────────────────────────────────────────────
   NORMALIZE HELPER
───────────────────────────────────────────────────────── */
function _normalizeKey(str) {
  return String(str ?? "")
    .toLowerCase()
    .trim()
    .replace(/\u2013|\u2014/g, "-")   /* en-dash, em-dash → hyphen */
    .replace(/\s+/g, " ");
}

/* ─────────────────────────────────────────────────────────
   DEBUG LOGGER — in browser console: XL_DEBUG = true
───────────────────────────────────────────────────────── */
/* global XL_DEBUG */
if (typeof window !== "undefined" && typeof window.XL_DEBUG === "undefined") {
  window.XL_DEBUG = false;
}
function _dbg(...a) { if (window.XL_DEBUG) console.log("[XLImport]", ...a); }

/* ─────────────────────────────────────────────────────────
   PARSE EXCEL FILE
───────────────────────────────────────────────────────── */
function parseAuditExcel(file) {
  return new Promise(resolve => {
    if (typeof XLSX === "undefined") {
      return resolve({ ok: false, error: "Excel library not loaded. Refresh the page." });
    }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, {
          type: "binary",
          raw: false,
          cellStyles: false,
          cellFormula: false,
          cellDates: false
        });
        /* Store raw rows for diagnostics (XL_DEBUG mode) */
        window._xlLastRawRows = {};
        wb.SheetNames.forEach(n => {
          window._xlLastRawRows[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" });
        });
        resolve(_extractBothModes(wb));
      } catch (err) {
        resolve({ ok: false, error: "Excel parse error: " + err.message });
      }
    };
    reader.onerror = () => resolve({ ok: false, error: "File read failed." });
    reader.readAsBinaryString(file);
  });
}

/* ─────────────────────────────────────────────────────────
   EXTRACT VIOLATION + EXEMPTION MATRICES
───────────────────────────────────────────────────────── */
function _isValidParse(m) {
  if (!m) return false;
  if (m.colHeaderFound) return true;
  const hasRC = Object.values(m.reportCounts || {}).some(v => v > 0);
  const hasVR = (m.vehicleRows || []).some(r => Object.values(r.counts || {}).some(v => v > 0));
  return hasRC || hasVR;
}

/* ─────────────────────────────────────────────────────────
   DIAGNOSTIC — shows raw parsed data in browser console
   AND as a collapsible panel in the review modal.
   Enabled by appending ?xldiag=1 to the page URL, OR by
   setting window.XL_DEBUG = true in DevTools console.
───────────────────────────────────────────────────────── */
function _buildDiagHtml(violation, exemption, rawRows) {
  const urlDiag = typeof location !== "undefined" && location.search.includes("xldiag=1");
  if (!urlDiag && !window.XL_DEBUG) return "";

  function modeSection(label, matrix) {
    if (!matrix) return `<b>${label}:</b> null<br>`;
    const rows = (matrix.vehicleRows || []).map(r =>
      `  ${r.vehicle}: ${JSON.stringify(r.counts)}`).join("<br>");
    const rc = JSON.stringify(matrix.reportCounts || {});
    return `<b>${label} reportCounts:</b> ${rc}<br>
            <b>${label} vehicleRows (${matrix.vehicleRows?.length}):</b><br>${rows}<br>`;
  }

  const sheetDump = rawRows ? Object.entries(rawRows).map(([name, rows]) =>
    `<b>Sheet "${name}" (${rows.length} rows):</b><br>` +
    rows.slice(0, 60).map((r, i) =>
      `[${i}] ${r.map(c => String(c).slice(0,20)).join(" | ")}`
    ).join("<br>")
  ).join("<hr>") : "(no raw rows)";

  return `<details style="margin:10px 0;border:1px solid #f59e0b;border-radius:4px;background:#1a1200;padding:8px 12px;">
    <summary style="cursor:pointer;color:#f59e0b;font-family:monospace;font-size:11px;font-weight:700;">
      🔍 DIAGNOSTIC — Raw Parse Output (xldiag mode)
    </summary>
    <div style="font-family:monospace;font-size:11px;line-height:1.7;color:#e5e7eb;margin-top:8px;">
      ${modeSection("Violation", violation)}
      <hr style="border-color:#333">
      ${modeSection("Exemption", exemption)}
      <hr style="border-color:#333">
      ${sheetDump}
    </div>
  </details>`;
}

function _extractBothModes(wb) {
  let violation = null;
  let exemption = null;

  const toRows = s => XLSX.utils.sheet_to_json(s, { header: 1, defval: "" });

  /* ── Strategy 1: sheets named exactly "violation" / "exemption" ── */
  wb.SheetNames.forEach(name => {
    const n = _normalizeKey(name);
    if (n === "violation" && !_isValidParse(violation))
      violation = _parseMatrix(toRows(wb.Sheets[name]), "Violation");
    if (n === "exemption" && !_isValidParse(exemption))
      exemption = _parseMatrix(toRows(wb.Sheets[name]), "Exemption");
  });

  /* ── Strategy 2: sheet name contains "violation" / "exemption" ── */
  if (!_isValidParse(violation) || !_isValidParse(exemption)) {
    wb.SheetNames.forEach(name => {
      const n = _normalizeKey(name);
      if (n.includes("violation") && !_isValidParse(violation))
        violation = _parseMatrix(toRows(wb.Sheets[name]), "Violation");
      if (n.includes("exemption") && !_isValidParse(exemption))
        exemption = _parseMatrix(toRows(wb.Sheets[name]), "Exemption");
    });
  }

  /* ── Strategy 3 (MAIN): one sheet has BOTH modes stacked ──
     Only runs when at least one mode is still missing.
     Never overwrites a mode already found by strategies 1/2. */
  if (!_isValidParse(violation) || !_isValidParse(exemption)) {
    wb.SheetNames.forEach(name => {
      if (_isValidParse(violation) && _isValidParse(exemption)) return;

      const rows = toRows(wb.Sheets[name]);
      _dbg("Strategy3 scanning sheet:", name, "totalRows:", rows.length);
      const { vBlock, eBlock } = _splitByHeadings(rows);
      _dbg("  vBlock:", vBlock.length, "eBlock:", eBlock.length);

      if (!_isValidParse(violation) && vBlock.length > 3) {
        const vParsed = _parseMatrix(vBlock, "Violation");
        if (_isValidParse(vParsed)) {
          violation = vParsed;
          _dbg("  → violation set from vBlock");
        }
      }
      if (!_isValidParse(exemption) && eBlock.length > 3) {
        const eParsed = _parseMatrix(eBlock, "Exemption");
        if (_isValidParse(eParsed)) {
          exemption = eParsed;
          _dbg("  → exemption set from eBlock");
        }
      }
    });
  }

  _dbg("Final → V:", violation, "E:", exemption);

  if (!violation && !exemption) {
    return {
      ok: false,
      error: "Koi valid audit matrix nahi mila. Excel mein 'Violation' aur 'Exemption' headings honi chahiye, aur column headers (CAR, LCV/MINIBUS…) bhi."
    };
  }

  return { ok: true, violation: violation || null, exemption: exemption || null };
}

/* ─────────────────────────────────────────────────────────
   SPLIT ROWS INTO VIOLATION BLOCK + EXEMPTION BLOCK
   Key insight: the heading row's FIRST non-empty cell is
   exactly the mode word ("violation" / "exemption").
   Col-header rows never start with these words.
───────────────────────────────────────────────────────── */
function _splitByHeadings(rows) {
  let vStart = -1, eStart = -1;

  rows.forEach((row, i) => {
    const first = row.map(c => _normalizeKey(String(c))).find(c => c !== "");
    if (!first) return;

    const isV = first === "violation" ||
                (first.startsWith("violation") && first.length < 25);
    const isE = first === "exemption" ||
                (first.startsWith("exemption") && first.length < 25);

    if (isV && vStart === -1) { vStart = i; _dbg("vStart=", i, first); }
    if (isE && eStart === -1) { eStart = i; _dbg("eStart=", i, first); }
  });

  _dbg("splitByHeadings → vStart:", vStart, "eStart:", eStart);

  /* Cap each block so it doesn't bleed into the other mode's section.
     Handles both orderings: V-then-E and E-then-V. */
  let vBlock = [], eBlock = [];

  if (vStart >= 0) {
    const vEnd = (eStart >= 0 && eStart > vStart) ? eStart : undefined;
    vBlock = rows.slice(vStart, vEnd);
  }

  if (eStart >= 0) {
    const eEnd = (vStart >= 0 && vStart > eStart) ? vStart : undefined;
    eBlock = rows.slice(eStart, eEnd);
  }

  _dbg("splitByHeadings → vBlock:", vBlock.length, "eBlock:", eBlock.length);
  return { vBlock, eBlock };
}

/* ─────────────────────────────────────────────────────────
   CORE MATRIX PARSER
   1. Find col-header row (≥2 XL_COL_MAP matches)
   2. Find report-counts row (row right after col-headers)
   3. Collect data rows until "Total"
   Returns colHeaderFound:true when the structure is detected,
   so _isValidParse accepts it even if all counts are 0.
───────────────────────────────────────────────────────── */
function _parseMatrix(rows, lbl) {
  if (!rows || rows.length < 3) return null;

  /* ── Step 1: col-header row ── */
  let colHeaderIdx = -1, colHeaders = [];
  for (let i = 0; i < rows.length; i++) {
    const norm  = rows[i].map(c => _normalizeKey(String(c)));
    const hits  = norm.filter(c => !!XL_COL_MAP[c]).length;
    _dbg(`[${lbl}] row ${i} colHits=${hits}`, norm.slice(0, 12));
    if (hits >= 2) { colHeaderIdx = i; colHeaders = norm; break; }
  }
  if (colHeaderIdx < 0) { _dbg(`[${lbl}] no colHeader`); return null; }

  /* ── Step 2: col index → category ── */
  const colIdxToCat = {};
  colHeaders.forEach((h, ci) => { if (XL_COL_MAP[h]) colIdxToCat[ci] = XL_COL_MAP[h]; });
  const validCols = Object.keys(colIdxToCat).map(Number);
  _dbg(`[${lbl}] validCols`, validCols);
  if (!validCols.length) return null;

  /* ── Step 3: report-counts row ("Actual Class after Validate") ──
     Rules:
       - Scan rows right after col-header row (up to 5 rows ahead)
       - Skip completely blank rows
       - Stop if we hit a known vehicle label (data rows started)
       - The first row that has ANY numeric value in a category column
         is the report-count row (covers blank label + "Actual Class..." label)
       - Accept 0 as a valid count (e.g. Truck 2 Axle = 0 in violation)
  */
  const reportCounts = {};
  let reportRowIdx   = -1;

  for (let ri = colHeaderIdx + 1; ri <= Math.min(colHeaderIdx + 5, rows.length - 1); ri++) {
    const row  = rows[ri];
    const fc   = _normalizeKey(String(row[0] ?? ""));

    if (row.every(c => String(c).trim() === "")) continue;
    if (fc !== "" && XL_ROW_MAP[fc] !== undefined) break;

    const hasNumericVal = validCols.some(ci => {
      const raw = String(row[ci] ?? "").replace(/,/g, "").trim();
      return raw !== "" && !isNaN(Number(raw));
    });

    _dbg(`[${lbl}] reportRow ri=${ri} fc="${fc}" hasNumericVal=${hasNumericVal}`,
         validCols.map(ci => `col${ci}="${row[ci]}"`).join(" "));

    if (hasNumericVal) {
      reportRowIdx = ri;
      validCols.forEach(ci => {
        const raw = String(row[ci] ?? "").replace(/,/g, "").trim();
        const val = Number(raw);
        if (raw !== "" && !isNaN(val)) reportCounts[colIdxToCat[ci]] = val;
      });
      _dbg(`[${lbl}] reportCounts`, reportCounts);
      break;
    }
  }

  /* ── Step 4: data rows ── */
  const vehicleRows = [];
  const dataStart   = (reportRowIdx >= 0 ? reportRowIdx : colHeaderIdx) + 1;

  for (let i = dataStart; i < rows.length; i++) {
    const row  = rows[i];
    const lbl2 = _normalizeKey(String(row[0] ?? ""));

    if (!lbl2) continue;
    if (lbl2 === "total" || lbl2.startsWith("total ")) continue;
    if (lbl2.includes("class as per") || lbl2.includes("system report")) continue;
    if (lbl2 === "violation" || lbl2 === "exemption") continue;

    const appVehicle = XL_ROW_MAP[lbl2];
    if (!appVehicle) { _dbg(`[${lbl}] unknown row: "${lbl2}"`); continue; }

    const counts = {};
    validCols.forEach(ci => {
      const raw = String(row[ci] ?? "").replace(/,/g, "").trim();
      const val = parseInt(raw, 10);
      if (!isNaN(val) && val > 0) counts[colIdxToCat[ci]] = (counts[colIdxToCat[ci]] || 0) + val;
    });

    vehicleRows.push({ vehicle: appVehicle, counts });
    _dbg(`[${lbl}] row ${i} "${appVehicle}"`, counts);
  }

  _dbg(`[${lbl}] done — rc:`, reportCounts, "rows:", vehicleRows.length);
  /* colHeaderFound:true tells _isValidParse this block has a valid structure */
  return { colHeaderFound: true, reportCounts, vehicleRows };
}

/* ─────────────────────────────────────────────────────────
   BUILD REVIEW HTML  (tab-based layout)
───────────────────────────────────────────────────────── */
function buildImportReviewHtml(violation, exemption) {

  function modeTabContent(modeName, matrix) {
    if (!matrix) {
      return `<p style="padding:24px 0;text-align:center;color:var(--text-faint);font-size:13px;">
        <i class="bi bi-info-circle me-1"></i> Is mode ka koi data nahi mila.
      </p>`;
    }

    const rc = matrix.reportCounts || {};

    /* Build vehicle map — deduplicate same vehicle */
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
            <td class="xl-rc-label">
              <i class="bi bi-clipboard-data-fill"></i> System Report Count
            </td>
            ${XL_CATS.map(c => `<td>
              <input type="number" class="xl-rc-input" min="0" value="${rc[c] ?? 0}"
                data-mode="${modeName}" data-cat="${c}">
            </td>`).join("")}
            <td class="xl-rc-total">${XL_CATS.reduce((s, c) => s + (rc[c] || 0), 0)}</td>
          </tr>
        </thead>
        <tbody>`;

    normalVehicles.forEach(vehicle => {
      const rowCounts = XL_CATS.map(c => (vehMap[vehicle]?.[c]) || 0);
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

    /* ── Col Total row ── */
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

    /* ── Already Paid section ── */
    if (paidTotal > 0) {
      html += `
        <div class="xl-paid-section" data-mode="${modeName}">
          <div class="xl-paid-header">
            <i class="bi bi-cash-coin"></i>
            Already Paid Transactions Found
            <span class="xl-paid-badge">${paidTotal}</span>
          </div>
          <div class="xl-paid-body">
            <p class="xl-paid-hint">
              Payment mode select karo — woh transactions usi category mein add ho jaayenge aur Col Total update ho jaayega.
            </p>
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

  /* ── Tab wrapper ── */
  const vCount = violation
    ? Object.values(violation.reportCounts || {}).reduce((a, b) => a + b, 0)
    : 0;
  const eCount = exemption
    ? Object.values(exemption.reportCounts || {}).reduce((a, b) => a + b, 0)
    : 0;

  return `
    ${_buildDiagHtml(violation, exemption, window._xlLastRawRows)}
    <ul class="xl-tab-nav" id="xlTabNav">
      <li class="xl-tab-item">
        <button class="xl-tab-btn xl-tab-active" data-tab="Violation">
          <span class="xl-tab-dot xl-dot-violation"></span>
          Violation
          <span class="xl-tab-count">${vCount}</span>
        </button>
      </li>
      <li class="xl-tab-item">
        <button class="xl-tab-btn" data-tab="Exemption">
          <span class="xl-tab-dot xl-dot-exemption"></span>
          Exemption
          <span class="xl-tab-count">${eCount}</span>
        </button>
      </li>
    </ul>
    <div class="xl-tab-pane" id="xlPane_Violation">
      ${modeTabContent("Violation", violation)}
    </div>
    <div class="xl-tab-pane xl-tab-pane-hidden" id="xlPane_Exemption">
      ${modeTabContent("Exemption", exemption)}
    </div>`;
}

/* ─────────────────────────────────────────────────────────
   WIRE TAB SWITCHING
───────────────────────────────────────────────────────── */
function _wireTabSwitching() {
  document.querySelectorAll(".xl-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll(".xl-tab-btn").forEach(b => b.classList.remove("xl-tab-active"));
      btn.classList.add("xl-tab-active");
      document.querySelectorAll(".xl-tab-pane").forEach(p => p.classList.add("xl-tab-pane-hidden"));
      const pane = document.getElementById(`xlPane_${tab}`);
      if (pane) pane.classList.remove("xl-tab-pane-hidden");
    });
  });
}

/* ─────────────────────────────────────────────────────────
   LIVE RECALC — row totals, col totals, grand total
   Called on input change AND on paid-mode select change
───────────────────────────────────────────────────────── */
function recalcReviewTotals(modeName) {
  const table = document.getElementById(`xlRevTable_${modeName}`);
  if (!table) return;

  /* Row totals */
  table.querySelectorAll("tbody tr").forEach(tr => {
    const inputs = tr.querySelectorAll(".xl-cell-input");
    const tot    = Array.from(inputs).reduce((s, i) => s + (parseInt(i.value, 10) || 0), 0);
    const cell   = tr.querySelector(".xl-row-total");
    if (cell) cell.textContent = tot;
  });

  /* Col totals (data rows only, not paid rows — paid rows are virtual) */
  let grandTotal = 0;
  XL_CATS.forEach(cat => {
    let colSum = 0;
    table.querySelectorAll(`.xl-cell-input[data-cat="${cat}"]`).forEach(inp => {
      colSum += parseInt(inp.value, 10) || 0;
    });
    grandTotal += colSum;
    const cell = table.querySelector(`.xl-col-total[data-cat="${cat}"]`);
    if (cell) cell.textContent = colSum;
  });

  /* Grand col total */
  const grand = table.querySelector(".xl-col-total-grand");
  if (grand) grand.textContent = grandTotal;

  /* Report-count row total */
  let rcTot = 0;
  table.querySelectorAll(".xl-rc-input").forEach(i => rcTot += parseInt(i.value, 10) || 0);
  const rcCell = table.querySelector(".xl-rc-total");
  if (rcCell) rcCell.textContent = rcTot;
}

/* ─────────────────────────────────────────────────────────
   COLLECT EDITED MATRICES FROM DOM
   Two sources, kept strictly separate:
   1. xl-cell-input on NON-virtual rows → real vehicle counts
   2. xl-paid-mode-select → already-paid counts (by payment mode)
   Virtual rows (.xl-paid-virtual-row) are EXCLUDED from source 1
   to prevent any double-count.
───────────────────────────────────────────────────────── */
function collectEditedMatrices() {
  const result = { violation: null, exemption: null };

  ["Violation", "Exemption"].forEach(modeName => {
    const reportCounts = {};
    const vehicleMap   = {};

    /* Source 0 — report count row */
    document.querySelectorAll(`.xl-rc-input[data-mode="${modeName}"]`).forEach(inp => {
      reportCounts[inp.dataset.cat] = parseInt(inp.value, 10) || 0;
    });

    /* Source 1 — real (non-virtual) vehicle rows only */
    document.querySelectorAll(`.xl-cell-input[data-mode="${modeName}"]`).forEach(inp => {
      /* Skip inputs that live inside a virtual paid row */
      if (inp.closest("tr.xl-paid-virtual-row")) return;
      const val = parseInt(inp.value, 10) || 0;
      if (val > 0) {
        const { cat, vehicle } = inp.dataset;
        if (!vehicleMap[vehicle]) vehicleMap[vehicle] = {};
        vehicleMap[vehicle][cat] = (vehicleMap[vehicle][cat] || 0) + val;
      }
    });

    /* Source 2 — already-paid selects (payment mode chosen by user) */
    document.querySelectorAll(`.xl-paid-mode-select[data-mode="${modeName}"]`).forEach(sel => {
      const payVehicle = sel.value;   /* e.g. "Paid (ETC)" — empty = skipped */
      if (!payVehicle) return;
      const cat   = sel.dataset.cat;
      const count = parseInt(sel.dataset.count, 10) || 0;
      if (count > 0) {
        if (!vehicleMap[payVehicle]) vehicleMap[payVehicle] = {};
        vehicleMap[payVehicle][cat] = (vehicleMap[payVehicle][cat] || 0) + count;
      }
    });

    result[modeName.toLowerCase()] = {
      reportCounts,
      vehicleRows: Object.entries(vehicleMap).map(([vehicle, counts]) => ({ vehicle, counts }))
    };
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
  ["Violation", "Exemption"].forEach(mode => {
    b[mode] = {};
    XL_CATS.forEach(cat => { b[mode][cat] = { reportCount: 0, transactions: [], vehicleCounts: {} }; });
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

/* ─────────────────────────────────────────────────────────
   VALIDATE — warn if any paid select is unset
───────────────────────────────────────────────────────── */
function _validateBeforeConfirm() {
  let unset = 0;
  document.querySelectorAll(".xl-paid-mode-select").forEach(s => { if (!s.value) unset++; });
  if (unset > 0) {
    return confirm(
      `${unset} "Already Paid" row(s) ka payment mode select nahi kiya.\n` +
      "Woh transactions skip ho jaayenge.\n\nPhir bhi continue karein?"
    );
  }
  return true;
}

/* ─────────────────────────────────────────────────────────
   PDF IMPORT
   Uses pdf.js (loaded globally as pdfjsLib).
   Extracts text with positions, bins into rows, feeds the
   same _splitByHeadings + _parseMatrix pipeline as Excel.
───────────────────────────────────────────────────────── */
async function parseAuditPDF(file) {
  if (typeof pdfjsLib === "undefined") {
    return { ok: false, error: "PDF library not loaded. Refresh the page." };
  }
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const allRows = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();

      /* Group text items by y-position (±3px tolerance) */
      const yMap = new Map();
      content.items.forEach(item => {
        const y = Math.round(item.transform[5] / 3) * 3;
        if (!yMap.has(y)) yMap.set(y, []);
        yMap.get(y).push({ x: item.transform[4], text: item.str.trim() });
      });

      /* Sort y descending (PDF y=0 is at bottom, rows top-to-bottom = descending) */
      Array.from(yMap.keys())
        .sort((a, b) => b - a)
        .forEach(y => {
          const texts = yMap.get(y)
            .sort((a, b) => a.x - b.x)
            .map(i => i.text)
            .filter(t => t !== "");
          if (texts.length > 0) allRows.push(texts);
        });
    }

    if (allRows.length === 0) {
      return { ok: false, error: "PDF mein koi text nahi mila. Scanned/image PDF supported nahi hai — text-based PDF use karo." };
    }

    _dbg("PDF rows extracted:", allRows.length);

    const { vBlock, eBlock } = _splitByHeadings(allRows);
    _dbg("PDF vBlock:", vBlock.length, "eBlock:", eBlock.length);

    let violation = null, exemption = null;

    if (vBlock.length > 3) violation = _parseMatrix(vBlock, "Violation");
    if (eBlock.length > 3) exemption = _parseMatrix(eBlock, "Exemption");

    /* Fallback: entire doc as single Violation matrix */
    if (!_isValidParse(violation) && !_isValidParse(exemption)) {
      const v = _parseMatrix(allRows, "Violation");
      if (_isValidParse(v)) violation = v;
    }

    if (!violation && !exemption) {
      return {
        ok: false,
        error: "PDF se audit matrix parse nahi hua. Ensure karo ki 'Violation'/'Exemption' headings aur CAR/LCV column headers clearly hain PDF mein."
      };
    }

    return { ok: true, violation: violation || null, exemption: exemption || null, source: "pdf" };
  } catch (err) {
    return { ok: false, error: "PDF parse error: " + err.message };
  }
}

/* ─────────────────────────────────────────────────────────
   SHARED REVIEW WIRING (Excel + PDF)
───────────────────────────────────────────────────────── */
function _showReview(parsed, modal, reviewBody, statusEl) {
  modal._xlParsed = parsed;

  /* Show PDF badge in modal title when source is PDF */
  const titleEl = document.getElementById("xlImportModalLabel");
  if (titleEl) {
    if (parsed.source === "pdf") {
      titleEl.innerHTML = `Import Audit Report <span class="xl-source-badge"><i class="bi bi-filetype-pdf"></i> PDF</span>`;
    } else {
      titleEl.textContent = "Import Audit Report";
    }
  }

  if (reviewBody) reviewBody.innerHTML = buildImportReviewHtml(parsed.violation, parsed.exemption);

  _wireTabSwitching();

  ["Violation", "Exemption"].forEach(m => {
    const tbl = document.getElementById(`xlRevTable_${m}`);
    if (tbl) tbl.addEventListener("input", () => recalcReviewTotals(m));
  });

  document.querySelectorAll(".xl-paid-mode-select").forEach(sel => {
    sel.addEventListener("change", () => {
      const m = sel.dataset.mode;
      _applyPaidToTable(m);
      recalcReviewTotals(m);
    });
  });

  if (statusEl) statusEl.textContent = "";
}

/* ─────────────────────────────────────────────────────────
   INIT
───────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {

  const importBtn = document.getElementById("xlImportBtn");
  const fileInput = document.getElementById("xlImportFileInput");
  const modal     = document.getElementById("xlImportModal");
  let   bsModal   = null;

  function getModal() {
    if (!bsModal && modal && typeof bootstrap !== "undefined") {
      bsModal = new bootstrap.Modal(modal);
    }
    return bsModal;
  }

  if (importBtn) importBtn.addEventListener("click", () => fileInput?.click());

  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;

      const reviewBody = document.getElementById("xlImportReviewBody");
      const statusEl   = document.getElementById("xlImportStatus");
      const isPDF      = /\.pdf$/i.test(file.name);

      if (reviewBody)
        reviewBody.innerHTML = `<div class="xl-loading"><i class="bi bi-hourglass-split"></i> ${isPDF ? "PDF" : "Excel"} parse ho raha hai…</div>`;
      if (statusEl) statusEl.textContent = "";
      getModal()?.show();

      const parsed = isPDF ? await parseAuditPDF(file) : await parseAuditExcel(file);
      fileInput.value = "";

      if (!parsed.ok) {
        if (reviewBody)
          reviewBody.innerHTML = `<div class="xl-error"><i class="bi bi-exclamation-triangle-fill"></i> ${parsed.error}</div>`;
        return;
      }

      _showReview(parsed, modal, reviewBody, statusEl);
    });
  }

  /* ── Confirm & Load ── */
  const confirmBtn = document.getElementById("xlImportConfirmBtn");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      if (!_validateBeforeConfirm()) return;

      const dateKey = (typeof selectedAuditDate !== "undefined" && selectedAuditDate)
        ? selectedAuditDate
        : (typeof getTodayKey === "function" ? getTodayKey() : new Date().toISOString().slice(0, 10));

      const edited = collectEditedMatrices();
      const bucket = matrixToBucket(edited.violation, edited.exemption);

      auditDataStore[dateKey] = bucket;
      if (typeof saveAuditData    === "function") saveAuditData();
      if (typeof setActiveAuditDate === "function") setActiveAuditDate(dateKey);
      if (typeof refreshUI          === "function") refreshUI();
      if (typeof renderHistoryPanel === "function") renderHistoryPanel();

      getModal()?.hide();

      if (typeof showToast === "function") {
        const vT = Object.values(edited.violation?.reportCounts || {}).reduce((a,b)=>a+b,0);
        const eT = Object.values(edited.exemption?.reportCounts || {}).reduce((a,b)=>a+b,0);
        showToast("Audit Imported ✓",
          `Violation: ${vT} | Exemption: ${eT} — ${dateKey} mein load ho gaya`,
          "success", 6000);
      }
    });
  }
});

/* ─────────────────────────────────────────────────────────
   APPLY PAID ROWS BACK INTO TABLE
   When a paid-mode select changes, we add/update a virtual
   row in the tbody for that paid vehicle so Col Total updates.
───────────────────────────────────────────────────────── */
function _applyPaidToTable(modeName) {
  const table = document.getElementById(`xlRevTable_${modeName}`);
  if (!table) return;

  /* Remove existing virtual paid rows */
  table.querySelectorAll("tr.xl-paid-virtual-row").forEach(r => r.remove());

  /* Re-add based on current select values */
  document.querySelectorAll(`.xl-paid-mode-select[data-mode="${modeName}"]`).forEach(sel => {
    const payVehicle = sel.value;
    if (!payVehicle) return;
    const cat   = sel.dataset.cat;
    const count = parseInt(sel.dataset.count, 10) || 0;
    if (!count) return;

    /* Find or create a virtual row for this payVehicle */
    let vRow = table.querySelector(`tbody tr[data-vehicle="${payVehicle}"]`);
    if (!vRow) {
      /* Insert a new virtual row */
      const tbody = table.querySelector("tbody");
      const tr    = document.createElement("tr");
      tr.className = "xl-paid-virtual-row";
      tr.dataset.vehicle = payVehicle;
      let inner = `<td class="xl-veh-label xl-paid-veh-label">${payVehicle} <span class="xl-paid-tag">Paid</span></td>`;
      XL_CATS.forEach(c => {
        inner += `<td><input type="number" class="xl-cell-input" min="0" value="0"
          data-mode="${modeName}" data-cat="${c}" data-vehicle="${payVehicle}"></td>`;
      });
      inner += `<td class="xl-row-total">0</td>`;
      tr.innerHTML = inner;
      tbody.appendChild(tr);
      vRow = tr;
    }

    /* Update that category's input */
    const inp = vRow.querySelector(`.xl-cell-input[data-cat="${cat}"]`);
    if (inp) inp.value = count;
  });
}
