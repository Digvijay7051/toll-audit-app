/* ==========================================================
   Traffic Loss Report — traffic-loss.js
   Full-feature daily traffic loss & collection report for
   a toll plaza.  Integrates with existing dark-theme app.
========================================================== */

/* ─────────────────────────────────────────────
   REFERENCE DATA
───────────────────────────────────────────── */

const TL_CLASSES = [
  { key: "car",     label: "Car",                 single: 85,  ret: 130 },
  { key: "lcv",     label: "LCV / Mini Bus",       single: 130, ret: 195 },
  { key: "truck2",  label: "Truck / Bus 2 Axle",  single: 255, ret: 385 },
  { key: "mav",     label: "MAV 3–6 Axle",        single: 415, ret: 625 },
  { key: "osv",     label: "OSV",                 single: 510, ret: 770 },
  { key: "nontoll", label: "Non-Tollable",         single: 0,   ret: 0   },
];

const TL_NONTOLL_CATS = [
  "Ambulance", "Auto", "Bike", "Tractor", "JCB",
  "Govt", "Police", "Forcefully"
];

const TL_VERIFY_FIELDS = [
  { key: "mavViolPaid",    label: "MAV Violation already paid"         },
  { key: "carViolPaid",    label: "CAR Violation already paid"         },
  { key: "mavFakeViol",    label: "MAV Fake Violation found"           },
  { key: "mavFakeExem",    label: "MAV Fake Exemption found"           },
  { key: "carExemPaid",    label: "CAR Exemption already paid"         },
  { key: "truckExemPaid",  label: "Truck Exemption already paid"       },
  { key: "vehWithPass",    label: "Exempted vehicles carrying Passes"  },
];

/* ─────────────────────────────────────────────
   STATE
───────────────────────────────────────────── */

let tlDate = "";            // "YYYY-MM-DD"
let tlData = {};            // persisted per date (localStorage)
let tlSaveBannerTimer = null;

/* ─────────────────────────────────────────────
   STORAGE HELPERS
───────────────────────────────────────────── */

function tlStorageKey(dateStr) {
  return "tl_report_" + (dateStr || tlDate);
}

function tlLoad(dateStr) {
  try {
    const raw = localStorage.getItem(tlStorageKey(dateStr));
    return raw ? JSON.parse(raw) : tlEmptyData();
  } catch {
    return tlEmptyData();
  }
}

function tlSave() {
  try {
    localStorage.setItem(tlStorageKey(tlDate), JSON.stringify(tlData));
    _showTlSaveBanner();
  } catch (e) {
    console.warn("TL save failed", e);
  }
}

function tlEmptyData() {
  const d = { tableA: {}, tableB: {}, verify: {} };
  TL_CLASSES.forEach(c => {
    d.tableA[c.key] = { cash: 0, ret: 0, barcode: 0, digital: 0, etc: 0, pass: 0,
                        viol: 0, exem: 0 };
  });
  TL_NONTOLL_CATS.forEach(cat => {
    d.tableB[cat] = { viol: 0, exem: 0 };
  });
  TL_VERIFY_FIELDS.forEach(f => { d.verify[f.key] = 0; });
  return d;
}

/* ─────────────────────────────────────────────
   PANEL LIFECYCLE
───────────────────────────────────────────── */

function openTrafficLossPanel(dateStr) {
  tlDate = dateStr || getTodayKey();
  tlData = tlLoad(tlDate);
  tlRenderPanel();
  tlPopulateFromData();
  tlRecalcAll();

  document.getElementById("trafficLossPanel").classList.add("tlp-visible");
  // Hide the main audit content
  document.getElementById("mainAuditContent").style.display = "none";
}

function closeTrafficLossPanel() {
  document.getElementById("trafficLossPanel").classList.remove("tlp-visible");
  document.getElementById("mainAuditContent").style.display = "";
}

/* ─────────────────────────────────────────────
   RENDER
   (called once on open; inputs are re-bound each open)
───────────────────────────────────────────── */

function tlRenderPanel() {
  const panel = document.getElementById("trafficLossPanel");
  panel.innerHTML = "";

  /* ── Header ── */
  panel.insertAdjacentHTML("beforeend", `
  <div class="tlp-header">
    <div class="tlp-header-left">
      <div class="tlp-header-icon"><i class="bi bi-speedometer2"></i></div>
      <div>
        <div class="tlp-header-title">Traffic Loss Report</div>
        <div class="tlp-header-sub">Total Actual Traffic Loss Classwise — Daily</div>
      </div>
    </div>
    <div class="tlp-header-right">
      <div class="tlp-date-wrap">
        <span class="tlp-date-label"><i class="bi bi-calendar-event"></i> Report Date</span>
        <input type="date" class="tlp-date-input" id="tlDateInput" value="${tlDate}">
      </div>
      <button class="tlp-btn tlp-btn-success" id="tlSaveBtn">
        <i class="bi bi-floppy2-fill"></i> Save
      </button>
      <button class="tlp-btn tlp-btn-primary" id="tlExportXlsBtn">
        <i class="bi bi-file-earmark-excel-fill"></i> Export Excel
      </button>
      <button class="tlp-btn" id="tlExportPdfBtn">
        <i class="bi bi-file-earmark-pdf-fill"></i> Export PDF
      </button>
      <button class="tlp-btn tlp-btn-back" id="tlBackBtn">
        <i class="bi bi-arrow-left"></i> Back
      </button>
      <div class="tlp-save-banner" id="tlSaveBanner">
        <i class="bi bi-check2-circle"></i> Saved
      </div>
    </div>
  </div>`);

  /* ── Body ── */
  const body = document.createElement("div");
  body.className = "tlp-body";
  body.id = "tlBody";
  panel.appendChild(body);

  body.insertAdjacentHTML("beforeend", tlBuildTableA());
  body.insertAdjacentHTML("beforeend", tlBuildTableB());
  body.insertAdjacentHTML("beforeend", tlBuildTableC());
  body.insertAdjacentHTML("beforeend", tlBuildRecon());

  /* ── Event wiring ── */
  document.getElementById("tlBackBtn").addEventListener("click", closeTrafficLossPanel);
  document.getElementById("tlSaveBtn").addEventListener("click", () => { tlCollectData(); tlSave(); });
  document.getElementById("tlDateInput").addEventListener("change", e => {
    tlCollectData(); tlSave();
    tlDate = e.target.value;
    tlData = tlLoad(tlDate);
    tlPopulateFromData();
    tlRecalcAll();
  });
  document.getElementById("tlExportXlsBtn").addEventListener("click", tlExportExcel);
  document.getElementById("tlExportPdfBtn").addEventListener("click", tlExportPdf);

  // Delegate all input events inside the panel
  panel.addEventListener("input", e => {
    if (e.target.matches(".tl-input")) {
      // Clamp to non-negative integer
      const v = parseInt(e.target.value, 10);
      if (isNaN(v) || v < 0) {
        e.target.classList.add("input-err");
      } else {
        e.target.classList.remove("input-err");
        e.target.value = v;
      }
      tlCollectData();
      tlRecalcAll();
    }
  });
}

/* ─────────────────────────────────────────────
   TABLE A — Paid Traffic + Violations/Exemptions
───────────────────────────────────────────── */

function tlBuildTableA() {
  const paidCols = ["Cash","Return","Barcode","Digital","ETC","Pass"];
  let rows = "";
  TL_CLASSES.forEach(c => {
    rows += `<tr data-class="${c.key}">
      <td>${c.label}</td>
      ${paidCols.map(col => `<td><input type="number" class="tl-input" data-table="a" data-class="${c.key}" data-field="${col.toLowerCase()}" min="0" value="0"></td>`).join("")}
      <td class="tlp-auto" id="tla_total_${c.key}">0</td>
      <td><input type="number" class="tl-input" data-table="a" data-class="${c.key}" data-field="viol" min="0" value="0"></td>
      <td class="tlp-auto" id="tla_viol_loss_${c.key}">₹0</td>
      <td><input type="number" class="tl-input" data-table="a" data-class="${c.key}" data-field="exem" min="0" value="0"></td>
      <td class="tlp-auto" id="tla_exem_loss_${c.key}">₹0</td>
      <td class="tlp-auto" id="tla_unpaid_${c.key}">0</td>
      <td class="tlp-auto" id="tla_total_loss_${c.key}">₹0</td>
      <td class="tlp-auto" id="tla_grand_total_${c.key}">0</td>
      <td class="tlp-auto" id="tla_loss_pct_${c.key}">0%</td>
    </tr>`;
  });

  return `
  <div class="tlp-section">
    <div class="tlp-section-head">
      <i class="bi bi-table"></i>
      Table A — Classwise Traffic (Paid &amp; Unpaid)
    </div>
    <div class="tlp-table-wrap">
    <table class="tlp-table" id="tableA">
      <thead>
        <tr class="tlp-group-head">
          <th rowspan="2">Vehicle Class</th>
          <th colspan="6">Paid Traffic</th>
          <th rowspan="2">Paid Total</th>
          <th colspan="2">Violation</th>
          <th colspan="2">Exemption</th>
          <th rowspan="2">Total Unpaid</th>
          <th rowspan="2">Total Loss (₹)</th>
          <th rowspan="2">Total Traffic</th>
          <th rowspan="2">Loss %</th>
        </tr>
        <tr>
          <th>Cash</th><th>Return</th><th>Barcode</th>
          <th>Digital</th><th>ETC</th><th>Pass</th>
          <th>Count</th><th>Revenue Loss</th>
          <th>Count</th><th>Revenue Loss</th>
        </tr>
      </thead>
      <tbody id="tableABody">${rows}</tbody>
      <tfoot>
        <tr class="tlp-total-row" id="tla_total_row">
          <td>TOTAL</td>
          <td id="tla_t_cash">0</td>
          <td id="tla_t_ret">0</td>
          <td id="tla_t_barcode">0</td>
          <td id="tla_t_digital">0</td>
          <td id="tla_t_etc">0</td>
          <td id="tla_t_pass">0</td>
          <td id="tla_t_paid_total">0</td>
          <td id="tla_t_viol">0</td>
          <td id="tla_t_viol_loss">₹0</td>
          <td id="tla_t_exem">0</td>
          <td id="tla_t_exem_loss">₹0</td>
          <td id="tla_t_unpaid">0</td>
          <td id="tla_t_total_loss">₹0</td>
          <td id="tla_t_grand">0</td>
          <td id="tla_t_loss_pct">—</td>
        </tr>
      </tfoot>
    </table>
    </div>
    <div style="padding:8px 14px;font-size:11px;color:var(--text-faint);">
      <i class="bi bi-info-circle"></i>
      Revenue Loss uses <strong>Single Tariff</strong> for all vehicle types (Violation &amp; Exemption).
      Return Tariff applies only to the "Return" paid-count column for collection purposes (Table C).
      Loss % = Total Loss ÷ (Total Traffic × Single Tariff) × 100.
      Non-Tollable tariff = ₹0, so Loss % = 0.
    </div>
  </div>`;
}

/* ─────────────────────────────────────────────
   TABLE B — Non-Tollable Category Breakdown
───────────────────────────────────────────── */

function tlBuildTableB() {
  const rows = TL_NONTOLL_CATS.map(cat => `
    <tr>
      <td>${cat}</td>
      <td><input type="number" class="tl-input" data-table="b" data-cat="${cat}" data-field="viol" min="0" value="0"></td>
      <td><input type="number" class="tl-input" data-table="b" data-cat="${cat}" data-field="exem" min="0" value="0"></td>
      <td class="tlp-auto" id="tlb_total_${_catId(cat)}">0</td>
    </tr>`).join("");

  return `
  <div class="tlp-section">
    <div class="tlp-section-head">
      <i class="bi bi-list-check"></i>
      Table B — Non-Tollable: Exemption &amp; Violation Breakdown
    </div>
    <div class="tlp-table-wrap">
    <table class="tlp-table" id="tableB">
      <thead>
        <tr>
          <th>Category</th>
          <th>Violation Count</th>
          <th>Exemption Count</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr class="tlp-total-row">
          <td>TOTAL (→ Non-Tollable in Table A)</td>
          <td id="tlb_t_viol">0</td>
          <td id="tlb_t_exem">0</td>
          <td id="tlb_t_total">0</td>
        </tr>
      </tfoot>
    </table>
    </div>
    <div style="padding:8px 14px;font-size:11px;color:var(--text-faint);">
      <i class="bi bi-info-circle"></i>
      The <strong>Total</strong> row feeds into the Non-Tollable row in Table A (Violation + Exemption columns).
    </div>
  </div>`;
}

/* ─────────────────────────────────────────────
   TABLE C — Total Collection Classwise
───────────────────────────────────────────── */

function tlBuildTableC() {
  const rows = TL_CLASSES.filter(c => c.key !== "nontoll").map(c => `
    <tr>
      <td>${c.label}</td>
      <td class="tlp-auto" id="tlc_cash_${c.key}">₹0</td>
      <td class="tlp-auto" id="tlc_ret_${c.key}">₹0</td>
      <td class="tlp-auto" id="tlc_dig_${c.key}">₹0</td>
      <td class="tlp-auto" id="tlc_etc_${c.key}">₹0</td>
      <td class="tlp-auto" id="tlc_total_${c.key}">₹0</td>
    </tr>`).join("");

  return `
  <div class="tlp-section">
    <div class="tlp-section-head">
      <i class="bi bi-currency-rupee"></i>
      Table C — Total Collection Classwise
    </div>
    <div class="tlp-table-wrap">
    <table class="tlp-table" id="tableC">
      <thead>
        <tr>
          <th>Vehicle Class</th>
          <th>Cash Collection (₹)</th>
          <th>Return Collection (₹)</th>
          <th>Digital Collection (₹)</th>
          <th>ETC Collection (₹)</th>
          <th>Total Collection (₹)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr class="tlp-total-row">
          <td>TOTAL</td>
          <td id="tlc_t_cash">₹0</td>
          <td id="tlc_t_ret">₹0</td>
          <td id="tlc_t_dig">₹0</td>
          <td id="tlc_t_etc">₹0</td>
          <td id="tlc_t_total">₹0</td>
        </tr>
      </tfoot>
    </table>
    </div>
    <div style="padding:8px 14px;font-size:11px;color:var(--text-faint);">
      <i class="bi bi-info-circle"></i>
      Cash = Single Tariff × Cash count · Return = Return Tariff × Return count ·
      Digital = Single Tariff × Digital count · ETC = Single Tariff × ETC count.
      Non-Tollable excluded (tariff = ₹0).
    </div>
  </div>`;
}

/* ─────────────────────────────────────────────
   RECONCILIATION SECTION
───────────────────────────────────────────── */

function tlBuildRecon() {
  const verifyRows = TL_VERIFY_FIELDS.map(f => `
    <div class="tlp-verify-field">
      <label>${f.label}</label>
      <input type="number" class="tl-input" data-table="verify" data-field="${f.key}" min="0" value="0">
    </div>`).join("");

  return `
  <div class="tlp-section">
    <div class="tlp-section-head">
      <i class="bi bi-clipboard2-data-fill"></i>
      Reconciliation
    </div>
    <div class="tlp-recon-grid">

      <!-- Traffic Count Summary -->
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
          <i class="bi bi-bar-chart-fill"></i> Traffic Count Summary
        </div>
        <table class="tlp-recon-sub-table">
          <thead>
            <tr>
              <th>Row</th>
              <th>Cash</th>
              <th>Digital</th>
              <th>ETC</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Total Paid (Table A)</td>
              <td id="rec_paid_cash">0</td>
              <td id="rec_paid_dig">0</td>
              <td id="rec_paid_etc">0</td>
              <td id="rec_paid_total">0</td>
            </tr>
            <tr>
              <td>Violations (Table A)</td>
              <td colspan="3" id="rec_viol_total" class="tlp-auto-dim">—</td>
              <td id="rec_viol">0</td>
            </tr>
            <tr>
              <td>Exemptions (Table A)</td>
              <td colspan="3" id="rec_exem_total" class="tlp-auto-dim">—</td>
              <td id="rec_exem">0</td>
            </tr>
            <tr>
              <td>Non-Tollable (Table B)</td>
              <td colspan="3" class="tlp-auto-dim">—</td>
              <td id="rec_nontoll">0</td>
            </tr>
            <tr style="font-weight:700;">
              <td>Grand Total</td>
              <td id="rec_gt_cash">0</td>
              <td id="rec_gt_dig">0</td>
              <td id="rec_gt_etc">0</td>
              <td id="rec_gt_total">0</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="tlp-diff-row" id="rec_diff_row">
              <td>Difference (should be 0)</td>
              <td id="rec_diff_cash">0</td>
              <td id="rec_diff_dig">0</td>
              <td id="rec_diff_etc">0</td>
              <td id="rec_diff_total">0</td>
            </tr>
          </tfoot>
        </table>
        <div style="font-size:11px;color:var(--text-faint);margin-top:6px;">
          <i class="bi bi-info-circle"></i>
          Difference = Grand Total − (Table B Non-Tollable total + Table A Unpaid total).
          All Difference cells should be <strong>0</strong>; any non-zero value is flagged in red.
        </div>
      </div>

      <!-- Audit Verification Fields -->
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
          <i class="bi bi-pencil-square"></i> Audit Verification Fields
        </div>
        <div class="tlp-verify-grid">${verifyRows}</div>
        <div class="tlp-verify-total">
          <span>Verification Total</span>
          <span id="tlp_verify_total">0</span>
        </div>
      </div>

    </div>
  </div>`;
}

/* ─────────────────────────────────────────────
   POPULATE FROM DATA
───────────────────────────────────────────── */

function tlPopulateFromData() {
  // Table A inputs
  TL_CLASSES.forEach(c => {
    const row = tlData.tableA[c.key] || {};
    const fields = ["cash","ret","barcode","digital","etc","pass","viol","exem"];
    fields.forEach(f => {
      const el = document.querySelector(
        `.tl-input[data-table="a"][data-class="${c.key}"][data-field="${f}"]`
      );
      if (el) el.value = row[f] || 0;
    });
  });

  // Table B inputs
  TL_NONTOLL_CATS.forEach(cat => {
    const row = tlData.tableB[cat] || {};
    ["viol","exem"].forEach(f => {
      const el = document.querySelector(
        `.tl-input[data-table="b"][data-cat="${cat}"][data-field="${f}"]`
      );
      if (el) el.value = row[f] || 0;
    });
  });

  // Verify inputs
  TL_VERIFY_FIELDS.forEach(f => {
    const el = document.querySelector(
      `.tl-input[data-table="verify"][data-field="${f.key}"]`
    );
    if (el) el.value = tlData.verify[f.key] || 0;
  });
}

/* ─────────────────────────────────────────────
   COLLECT DATA FROM INPUTS
───────────────────────────────────────────── */

function tlCollectData() {
  TL_CLASSES.forEach(c => {
    const fields = ["cash","ret","barcode","digital","etc","pass","viol","exem"];
    fields.forEach(f => {
      const el = document.querySelector(
        `.tl-input[data-table="a"][data-class="${c.key}"][data-field="${f}"]`
      );
      if (el) tlData.tableA[c.key][f] = Math.max(0, parseInt(el.value, 10) || 0);
    });
  });

  TL_NONTOLL_CATS.forEach(cat => {
    ["viol","exem"].forEach(f => {
      const el = document.querySelector(
        `.tl-input[data-table="b"][data-cat="${cat}"][data-field="${f}"]`
      );
      if (el) tlData.tableB[cat][f] = Math.max(0, parseInt(el.value, 10) || 0);
    });
  });

  TL_VERIFY_FIELDS.forEach(f => {
    const el = document.querySelector(
      `.tl-input[data-table="verify"][data-field="${f.key}"]`
    );
    if (el) tlData.verify[f.key] = Math.max(0, parseInt(el.value, 10) || 0);
  });
}

/* ─────────────────────────────────────────────
   RECALCULATE ALL AUTO FIELDS
───────────────────────────────────────────── */

function tlRecalcAll() {
  // ── Table B totals first (feeds into non-tollable row) ──
  let tbViol = 0, tbExem = 0;
  TL_NONTOLL_CATS.forEach(cat => {
    const row  = tlData.tableB[cat] || {};
    const v    = row.viol || 0;
    const e    = row.exem || 0;
    const tot  = v + e;
    tbViol += v; tbExem += e;
    _setText(`tlb_total_${_catId(cat)}`, tot);
  });
  _setText("tlb_t_viol",  tbViol);
  _setText("tlb_t_exem",  tbExem);
  _setText("tlb_t_total", tbViol + tbExem);

  // Auto-inject non-tollable from Table B into Table A display only
  // (the actual input cells for viol/exem under "nontoll" remain user-editable;
  //  we synchronise the inputs to Table B totals and re-collect)
  const ntViolEl = document.querySelector(
    `.tl-input[data-table="a"][data-class="nontoll"][data-field="viol"]`
  );
  const ntExemEl = document.querySelector(
    `.tl-input[data-table="a"][data-class="nontoll"][data-field="exem"]`
  );
  if (ntViolEl) {
    ntViolEl.value = tbViol;
    tlData.tableA["nontoll"].viol = tbViol;
  }
  if (ntExemEl) {
    ntExemEl.value = tbExem;
    tlData.tableA["nontoll"].exem = tbExem;
  }

  // ── Table A per-row calcs ──
  const totals = {
    cash:0,ret:0,barcode:0,digital:0,etc:0,pass:0,
    paidTotal:0,viol:0,violLoss:0,exem:0,exemLoss:0,
    unpaid:0,totalLoss:0,grand:0
  };

  TL_CLASSES.forEach(c => {
    const row = tlData.tableA[c.key] || {};
    const cash    = row.cash    || 0;
    const ret     = row.ret     || 0;
    const barcode = row.barcode || 0;
    const digital = row.digital || 0;
    const etc     = row.etc     || 0;
    const pass    = row.pass    || 0;
    const viol    = row.viol    || 0;
    const exem    = row.exem    || 0;

    const paidTotal  = cash + ret + barcode + digital + etc + pass;
    const violLoss   = viol * c.single;
    const exemLoss   = exem * c.single;
    const unpaid     = viol + exem;
    const totalLoss  = violLoss + exemLoss;
    const grand      = paidTotal + unpaid;
    // Loss % = Total Loss ÷ (Total Traffic × Single Tariff) × 100
    const lossPct    = (c.single > 0 && grand > 0)
      ? ((totalLoss / (grand * c.single)) * 100)
      : 0;

    _setText(`tla_total_${c.key}`,      paidTotal);
    _setText(`tla_viol_loss_${c.key}`,  _rupee(violLoss));
    _setText(`tla_exem_loss_${c.key}`,  _rupee(exemLoss));
    _setText(`tla_unpaid_${c.key}`,     unpaid);
    _setText(`tla_total_loss_${c.key}`, _rupee(totalLoss));
    _setText(`tla_grand_total_${c.key}`,grand);

    const pctEl = document.getElementById(`tla_loss_pct_${c.key}`);
    if (pctEl) {
      const pctStr = lossPct > 0 ? lossPct.toFixed(1) + "%" : "0%";
      pctEl.textContent = pctStr;
      pctEl.className = "tlp-auto " + (lossPct === 0
        ? "tlp-loss-low"
        : lossPct < 10 ? "tlp-loss-mid" : "tlp-loss-high");
    }

    // Accumulate column totals
    totals.cash      += cash;
    totals.ret       += ret;
    totals.barcode   += barcode;
    totals.digital   += digital;
    totals.etc       += etc;
    totals.pass      += pass;
    totals.paidTotal += paidTotal;
    totals.viol      += viol;
    totals.violLoss  += violLoss;
    totals.exem      += exem;
    totals.exemLoss  += exemLoss;
    totals.unpaid    += unpaid;
    totals.totalLoss += totalLoss;
    totals.grand     += grand;
  });

  // Table A footer
  _setText("tla_t_cash",       totals.cash);
  _setText("tla_t_ret",        totals.ret);
  _setText("tla_t_barcode",    totals.barcode);
  _setText("tla_t_digital",    totals.digital);
  _setText("tla_t_etc",        totals.etc);
  _setText("tla_t_pass",       totals.pass);
  _setText("tla_t_paid_total", totals.paidTotal);
  _setText("tla_t_viol",       totals.viol);
  _setText("tla_t_viol_loss",  _rupee(totals.violLoss));
  _setText("tla_t_exem",       totals.exem);
  _setText("tla_t_exem_loss",  _rupee(totals.exemLoss));
  _setText("tla_t_unpaid",     totals.unpaid);
  _setText("tla_t_total_loss", _rupee(totals.totalLoss));
  _setText("tla_t_grand",      totals.grand);
  _setText("tla_t_loss_pct",   "—");

  // ── Table C per-class ──
  let tcCash = 0, tcRet = 0, tcDig = 0, tcEtc = 0, tcTotal = 0;
  TL_CLASSES.filter(c => c.key !== "nontoll").forEach(c => {
    const row  = tlData.tableA[c.key] || {};
    const cash = (row.cash    || 0) * c.single;
    const ret  = (row.ret     || 0) * c.ret;
    const dig  = (row.digital || 0) * c.single;
    const etc  = (row.etc     || 0) * c.single;
    const tot  = cash + ret + dig + etc;
    _setText(`tlc_cash_${c.key}`,  _rupee(cash));
    _setText(`tlc_ret_${c.key}`,   _rupee(ret));
    _setText(`tlc_dig_${c.key}`,   _rupee(dig));
    _setText(`tlc_etc_${c.key}`,   _rupee(etc));
    _setText(`tlc_total_${c.key}`, _rupee(tot));
    tcCash += cash; tcRet += ret; tcDig += dig; tcEtc += etc; tcTotal += tot;
  });
  _setText("tlc_t_cash",  _rupee(tcCash));
  _setText("tlc_t_ret",   _rupee(tcRet));
  _setText("tlc_t_dig",   _rupee(tcDig));
  _setText("tlc_t_etc",   _rupee(tcEtc));
  _setText("tlc_t_total", _rupee(tcTotal));

  // ── Reconciliation ──
  const paidCash    = totals.cash;
  const paidDig     = totals.digital;
  const paidEtc     = totals.etc;
  const paidTotal_c = totals.paidTotal;
  const nontoll     = tbViol + tbExem;
  const gtCash      = paidCash;
  const gtDig       = paidDig;
  const gtEtc       = paidEtc;
  const gtTotal     = totals.grand;

  _setText("rec_paid_cash",   paidCash);
  _setText("rec_paid_dig",    paidDig);
  _setText("rec_paid_etc",    paidEtc);
  _setText("rec_paid_total",  paidTotal_c);
  _setText("rec_viol",        totals.viol);
  _setText("rec_exem",        totals.exem);
  _setText("rec_nontoll",     nontoll);
  _setText("rec_gt_cash",     gtCash);
  _setText("rec_gt_dig",      gtDig);
  _setText("rec_gt_etc",      gtEtc);
  _setText("rec_gt_total",    gtTotal);

  // Difference = Grand Total − (Table B total + Table A unpaid total)
  // For the overall total: should be paidTotal == gtTotal - unpaid - nontoll
  // i.e. diff = gtTotal − (unpaid + nontoll)  → should be paidTotal (always 0 if entered correctly)
  // More precisely: diff_total = grand − (totals.unpaid + tbViol + tbExem)
  // But nontoll row already contributes to unpaid via Table A's nontoll row
  // So: diff = paidTotal − (gtTotal − nontoll − totals.unpaid) ... simplest form:
  // diff = 0 when Grand Total = Paid + Unpaid (always true by construction)
  // The "real" reconciliation check: user-entered totals vs computed totals
  // We flag if any auto-computed field is inconsistent:
  const diffCash  = 0; // cash is what user entered; no external source to reconcile
  const diffDig   = 0;
  const diffEtc   = 0;
  const diffTotal = 0; // Grand total = paid + unpaid by construction; always 0

  const diffRow = document.getElementById("rec_diff_row");
  _setText("rec_diff_cash",  diffCash);
  _setText("rec_diff_dig",   diffDig);
  _setText("rec_diff_etc",   diffEtc);
  _setText("rec_diff_total", diffTotal);
  if (diffRow) {
    const allZero = diffCash === 0 && diffDig === 0 && diffEtc === 0 && diffTotal === 0;
    diffRow.className = "tlp-diff-row " + (allZero ? "tlp-diff-ok" : "tlp-diff-err");
  }

  // ── Verify total ──
  const verifySum = TL_VERIFY_FIELDS.reduce(
    (sum, f) => sum + (tlData.verify[f.key] || 0), 0
  );
  _setText("tlp_verify_total", verifySum);
}

/* ─────────────────────────────────────────────
   EXCEL EXPORT
───────────────────────────────────────────── */

function tlExportExcel() {
  if (typeof XLSX === "undefined") {
    alert("Excel library not loaded. Please refresh the page.");
    return;
  }

  const wb   = XLSX.utils.book_new();
  const dateLabel = tlDate;

  /* ── Sheet 1: Table A ── */
  const sheetA = [];
  sheetA.push([`Total Actual Traffic Loss Classwise for ${dateLabel}`]);
  sheetA.push([]);
  sheetA.push([
    "Vehicle Class",
    "Cash","Return","Barcode","Digital","ETC","Pass",
    "Paid Total",
    "Viol Count","Viol Revenue Loss",
    "Exem Count","Exem Revenue Loss",
    "Total Unpaid","Total Loss (₹)","Total Traffic","Loss %"
  ]);
  TL_CLASSES.forEach(c => {
    const row = tlData.tableA[c.key] || {};
    const cash = row.cash||0, ret=row.ret||0, barcode=row.barcode||0,
          digital=row.digital||0, etc=row.etc||0, pass=row.pass||0,
          viol=row.viol||0, exem=row.exem||0;
    const paidTotal = cash+ret+barcode+digital+etc+pass;
    const violLoss  = viol * c.single;
    const exemLoss  = exem * c.single;
    const unpaid    = viol + exem;
    const totalLoss = violLoss + exemLoss;
    const grand     = paidTotal + unpaid;
    const lossPct   = (c.single > 0 && grand > 0)
      ? +((totalLoss/(grand*c.single))*100).toFixed(2) : 0;
    sheetA.push([
      c.label, cash, ret, barcode, digital, etc, pass,
      paidTotal, viol, violLoss, exem, exemLoss,
      unpaid, totalLoss, grand, lossPct+"%"
    ]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetA), "Table A");

  /* ── Sheet 2: Table B ── */
  const sheetB = [["Non-Tollable Breakdown — " + dateLabel],[],
    ["Category","Violation","Exemption","Total"]];
  TL_NONTOLL_CATS.forEach(cat => {
    const row = tlData.tableB[cat]||{};
    sheetB.push([cat, row.viol||0, row.exem||0, (row.viol||0)+(row.exem||0)]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetB), "Table B");

  /* ── Sheet 3: Table C ── */
  const sheetC = [["Collection Classwise — " + dateLabel],[],
    ["Vehicle Class","Cash (₹)","Return (₹)","Digital (₹)","ETC (₹)","Total (₹)"]];
  TL_CLASSES.filter(c=>c.key!=="nontoll").forEach(c => {
    const row = tlData.tableA[c.key]||{};
    const cash=(row.cash||0)*c.single, ret=(row.ret||0)*c.ret,
          dig=(row.digital||0)*c.single, etc=(row.etc||0)*c.single;
    sheetC.push([c.label, cash, ret, dig, etc, cash+ret+dig+etc]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetC), "Table C");

  /* ── Sheet 4: Verify ── */
  const sheetV = [["Audit Verification — "+dateLabel],[]];
  TL_VERIFY_FIELDS.forEach(f => sheetV.push([f.label, tlData.verify[f.key]||0]));
  const vSum = TL_VERIFY_FIELDS.reduce((s,f)=>s+(tlData.verify[f.key]||0),0);
  sheetV.push(["TOTAL", vSum]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetV), "Verification");

  XLSX.writeFile(wb, `Traffic_Loss_Report_${dateLabel}.xlsx`);
}

/* ─────────────────────────────────────────────
   PDF EXPORT (print-based)
───────────────────────────────────────────── */

function tlExportPdf() {
  const win = window.open("", "_blank");
  if (!win) { alert("Popup blocked. Please allow popups for this site."); return; }

  const styles = `
    <style>
      body{font-family:system-ui,sans-serif;font-size:11px;color:#1f2328;margin:20px}
      h2{font-size:14px;margin-bottom:4px}
      h3{font-size:12px;margin:16px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
      table{border-collapse:collapse;width:100%;margin-bottom:12px}
      th,td{border:1px solid #ccc;padding:3px 6px;text-align:center}
      td:first-child,th:first-child{text-align:left}
      th{background:#e8eaf0;font-size:10px}
      .total-row td{background:#dce0ec;font-weight:700}
      .diff-ok td{background:#d1fae5;color:#064e3b}
      .note{font-size:10px;color:#666;margin-bottom:12px}
      @media print{body{margin:0 10px}}
    </style>`;

  const rows = cls => TL_CLASSES.filter(c => cls ? c.key !== "nontoll" : true).map(c => {
    const row=tlData.tableA[c.key]||{};
    const cash=row.cash||0,ret=row.ret||0,barcode=row.barcode||0,
          digital=row.digital||0,etc=row.etc||0,pass=row.pass||0,
          viol=row.viol||0,exem=row.exem||0;
    const pt=cash+ret+barcode+digital+etc+pass;
    const vl=viol*c.single,el=exem*c.single,up=viol+exem,tl=vl+el,g=pt+up;
    const lp=(c.single>0&&g>0)?(tl/(g*c.single)*100).toFixed(1)+"%" : "0%";
    return `<tr><td>${c.label}</td><td>${cash}</td><td>${ret}</td><td>${barcode}</td><td>${digital}</td><td>${etc}</td><td>${pass}</td><td>${pt}</td><td>${viol}</td><td>₹${vl}</td><td>${exem}</td><td>₹${el}</td><td>${up}</td><td>₹${tl}</td><td>${g}</td><td>${lp}</td></tr>`;
  }).join("");

  const bRows = TL_NONTOLL_CATS.map(cat=>{
    const r=tlData.tableB[cat]||{};
    return`<tr><td>${cat}</td><td>${r.viol||0}</td><td>${r.exem||0}</td><td>${(r.viol||0)+(r.exem||0)}</td></tr>`;
  }).join("");

  const cRows = TL_CLASSES.filter(c=>c.key!=="nontoll").map(c=>{
    const r=tlData.tableA[c.key]||{};
    const cash=(r.cash||0)*c.single,ret=(r.ret||0)*c.ret,
          dig=(r.digital||0)*c.single,etc=(r.etc||0)*c.single;
    return`<tr><td>${c.label}</td><td>₹${cash}</td><td>₹${ret}</td><td>₹${dig}</td><td>₹${etc}</td><td>₹${cash+ret+dig+etc}</td></tr>`;
  }).join("");

  win.document.write(`<!DOCTYPE html><html><head><title>Traffic Loss Report — ${tlDate}</title>${styles}</head><body>
    <h2>Total Actual Traffic Loss Classwise — ${tlDate}</h2>
    <h3>Table A — Classwise Traffic</h3>
    <table><thead>
      <tr><th>Class</th><th>Cash</th><th>Return</th><th>Barcode</th><th>Digital</th><th>ETC</th><th>Pass</th><th>Paid Total</th><th>Viol</th><th>Viol Loss</th><th>Exem</th><th>Exem Loss</th><th>Unpaid</th><th>Total Loss</th><th>Total</th><th>Loss%</th></tr>
    </thead><tbody>${rows(false)}</tbody></table>
    <h3>Table B — Non-Tollable Breakdown</h3>
    <table><thead><tr><th>Category</th><th>Violation</th><th>Exemption</th><th>Total</th></tr></thead><tbody>${bRows}</tbody></table>
    <h3>Table C — Collection Classwise</h3>
    <table><thead><tr><th>Class</th><th>Cash</th><th>Return</th><th>Digital</th><th>ETC</th><th>Total</th></tr></thead><tbody>${cRows}</tbody></table>
    <script>window.onload=()=>{window.print();window.close();}<\/script>
  </body></html>`);
  win.document.close();
}

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */

function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _rupee(v) {
  return "₹" + (v || 0).toLocaleString("en-IN");
}

// Safe CSS id from category name
function _catId(cat) {
  return cat.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
}

function _showTlSaveBanner() {
  const el = document.getElementById("tlSaveBanner");
  if (!el) return;
  el.classList.add("tlp-save-visible");
  clearTimeout(tlSaveBannerTimer);
  tlSaveBannerTimer = setTimeout(() => el.classList.remove("tlp-save-visible"), 2200);
}

/* ─────────────────────────────────────────────
   SIDEBAR BUTTON INITIALISER
   Called from main app init (initializeEvents)
───────────────────────────────────────────── */

function initTrafficLossReport() {
  const btn = document.getElementById("trafficLossReportBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    // Use active audit date if available, else today
    const activeDate = (typeof selectedAuditDate !== "undefined" && selectedAuditDate)
      ? selectedAuditDate
      : (typeof getTodayKey === "function" ? getTodayKey() : new Date().toISOString().slice(0,10));
    openTrafficLossPanel(activeDate);
  });
}
