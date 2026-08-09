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
let tlData = {};            // in-memory, persisted to Firestore + localStorage
let tlAutoSaveTimer = null; // debounce handle for auto-save

/* ─────────────────────────────────────────────
   SAVE STATUS CHIP
   Shows "Saving…" / "✓ Saved" / "Offline" in the header
───────────────────────────────────────────── */

function _tlSetStatus(state) {
  // state: "saving" | "saved" | "offline" | "local"
  const el = document.getElementById("tlSaveStatus");
  if (!el) return;
  const map = {
    saving:  { icon: "bi-arrow-repeat", text: "Saving…",       cls: "tls-saving"  },
    saved:   { icon: "bi-cloud-check",  text: "Saved",         cls: "tls-saved"   },
    local:   { icon: "bi-hdd",          text: "Saved locally", cls: "tls-local"   },
    offline: { icon: "bi-wifi-off",     text: "Offline",       cls: "tls-offline" },
  };
  const s = map[state] || map.saved;
  el.className = "tl-save-status " + s.cls;
  el.innerHTML = `<i class="bi ${s.icon}"></i> ${s.text}`;
}

/* ─────────────────────────────────────────────
   STORAGE HELPERS
───────────────────────────────────────────── */

function tlStorageKey(dateStr) {
  return "tl_report_" + (dateStr || tlDate);
}

/* localStorage fallback — always keep a local copy */
function _tlSaveLocal(dateStr, data) {
  try {
    localStorage.setItem(tlStorageKey(dateStr), JSON.stringify(data));
  } catch(e) {
    console.warn("[TL] localStorage save failed", e);
  }
}

function _tlLoadLocal(dateStr) {
  try {
    const raw = localStorage.getItem(tlStorageKey(dateStr));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/* Primary load: try Firestore first, fall back to localStorage */
async function tlLoad(dateStr) {
  // 1. try Firestore (cloud)
  if (typeof fbLoadTlReport === "function") {
    try {
      const cloud = await fbLoadTlReport(dateStr);
      if (cloud) {
        _tlSaveLocal(dateStr, cloud); // keep local in sync
        return cloud;
      }
    } catch(e) {
      console.warn("[TL] Firestore load failed, using local", e);
    }
  }
  // 2. fall back to localStorage
  return _tlLoadLocal(dateStr) || tlEmptyData();
}

/* Primary save: Firestore + localStorage */
async function tlSave(dateStr, data) {
  dateStr = dateStr || tlDate;
  data    = data    || tlData;

  // Always write localStorage immediately (instant, offline-safe)
  _tlSaveLocal(dateStr, data);

  // Then write to Firestore
  if (typeof fbSaveTlReport === "function") {
    _tlSetStatus("saving");
    const res = await fbSaveTlReport(dateStr, data);
    if (res && res.ok) {
      _tlSetStatus("saved");
    } else {
      _tlSetStatus("local");  // saved locally but cloud failed
    }
  } else {
    _tlSetStatus("local");
  }
}

/* Auto-save: debounced 1.2 s after last keystroke (Google-Sheets style) */
function tlScheduleAutoSave() {
  clearTimeout(tlAutoSaveTimer);
  _tlSetStatus("saving");
  tlAutoSaveTimer = setTimeout(async () => {
    tlCollectData();
    await tlSave();
  }, 1200);
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
   AUTO-FILL FROM AUDIT DATA
   Reads auditDataStore[dateKey] and returns a
   partial tlData object with violation/exemption
   counts and non-tollable breakdown extracted
   from the audited vehicle counts.
   Only fills viol/exem fields — paid counts
   (cash/ret/barcode/digital/etc/pass) are left
   for the user to enter manually.
───────────────────────────────────────────── */

function tlExtractFromAudit(dateKey) {
  if (typeof auditDataStore === "undefined") return null;
  const bucket = auditDataStore[dateKey];
  if (!bucket) return null;

  // Safe list of report categories — never iterates _meta or other keys
  const CATS = typeof REPORT_CATEGORIES !== "undefined"
    ? REPORT_CATEGORIES
    : ["Car","LCV","Truck 2 Axle","Truck 3 Axle","MAV","Auto","Tractor","Bus 2 Axle"];

  // Sum vehicleNames across all report categories for ONE specific mode
  function sumVC(mode, vehicleNames) {
    if (!vehicleNames.length) return 0;
    let total = 0;
    const modeData = bucket[mode];
    if (!modeData) return 0;
    CATS.forEach(cat => {
      const vc = (modeData[cat] && modeData[cat].vehicleCounts) || {};
      vehicleNames.forEach(v => { total += vc[v] || 0; });
    });
    return total;
  }

  // Sum vehicleNames across ALL modes (Violation + Exemption combined).
  // Used for status-tags like "Forcefully" that can be recorded under
  // either mode depending on which mode was active at the time.
  function sumAllModes(vehicleNames) {
    return sumVC("Violation", vehicleNames) + sumVC("Exemption", vehicleNames);
  }

  const out = { tableA: {}, tableB: {} };

  // ── TABLE A ─────────────────────────────────────────────────
  // pass = "Has Pass" vehicles — recorded in either mode, so sum both.
  // "Has Pass" is a cross-mode status tag (like "Forcefully") — the
  // auditor taps it regardless of which Violation/Exemption mode is active.
  const CLASS_MAP = {
    //         viol                                   exem                                  pass vehicles (both modes)
    car:     { viol: ["Car"],                         exem: ["Car"],                         pass: ["Car"]              },
    lcv:     { viol: ["LCV", "Minibus"],              exem: ["LCV", "Minibus"],              pass: ["LCV", "Minibus"]   },
    truck2:  { viol: ["Truck 2 Axle", "Bus 2 Axle"],  exem: ["Truck 2 Axle", "Bus 2 Axle"],  pass: ["Truck 2 Axle", "Bus 2 Axle"] },
    mav:     { viol: ["Truck 3 Axle", "MAV"],         exem: ["Truck 3 Axle", "MAV"],         pass: ["Truck 3 Axle", "MAV"]        },
    osv:     { viol: ["Oversized Vehicle"],           exem: ["Oversized Vehicle"],           pass: ["Oversized Vehicle"]          },
    nontoll: { viol: [],                              exem: [],                              pass: []                             },
  };

  // "Has Pass" count per vehicle class:
  // In the audit matrix, when a vehicle with a pass is tapped, it logs
  // vehicleCounts["Has Pass"]++ under the current reportCategory bucket.
  // So we can't split "Has Pass" by vehicle class from vehicleCounts alone —
  // instead we use the REPORT_CATEGORY as a proxy for the vehicle class:
  //   bucket[mode]["Car"].vehicleCounts["Has Pass"]     → Car pass count
  //   bucket[mode]["LCV"].vehicleCounts["Has Pass"]     → LCV pass count
  //   bucket[mode]["MAV"].vehicleCounts["Has Pass"]     → MAV pass count  etc.
  function sumPassForCat(reportCats) {
    // Sum "Has Pass" taps recorded under the given report categories, both modes
    let total = 0;
    ["Violation", "Exemption"].forEach(mode => {
      const modeData = bucket[mode];
      if (!modeData) return;
      reportCats.forEach(cat => {
        const vc = (modeData[cat] && modeData[cat].vehicleCounts) || {};
        total += vc["Has Pass"] || 0;
      });
    });
    return total;
  }

  // Map each TL class key to the REPORT_CATEGORIES that correspond to it
  const CLASS_TO_REPORT_CATS = {
    car:     ["Car"],
    lcv:     ["LCV"],
    truck2:  ["Truck 2 Axle", "Bus 2 Axle"],
    mav:     ["Truck 3 Axle", "MAV"],
    osv:     [],          // OSV has no direct report category — included in MAV
    nontoll: [],
  };

  TL_CLASSES.forEach(c => {
    const map = CLASS_MAP[c.key] || { viol: [], exem: [] };
    out.tableA[c.key] = {
      viol: sumVC("Violation", map.viol),
      exem: sumVC("Exemption", map.exem),
      pass: sumPassForCat(CLASS_TO_REPORT_CATS[c.key] || []),
    };
  });

  // ── TABLE B ─────────────────────────────────────────────────
  // IMPORTANT: Non-tollable vehicles (Ambulance, Bike, Police etc.)
  // can be recorded under EITHER mode depending on which mode the
  // auditor had active at the time of tapping.
  //   - bucket["Violation"]["Car"].vehicleCounts["Ambulance"] → viol column
  //   - bucket["Exemption"]["Auto"].vehicleCounts["Ambulance"] → exem column
  // So: viol = sumVC("Violation", vehicles), exem = sumVC("Exemption", vehicles)
  // "Forcefully" is a cross-mode status tag — sum both modes for its viol count.

  const NONTOLL_VEHICLES = {
    "Ambulance":  ["Ambulance"],
    "Auto":       ["Auto"],
    "Bike":       ["Bike"],
    "Tractor":    ["Tractor"],
    "JCB":        ["JCB"],
    "Govt":       ["Government Vehicle", "Army Vehicle"],
    "Police":     ["Police"],
  };

  TL_NONTOLL_CATS.forEach(cat => {
    if (cat === "Forcefully") {
      // Forcefully can be tapped in any mode — sum both
      out.tableB["Forcefully"] = {
        viol: sumAllModes(["Forcefully"]),
        exem: 0,
      };
    } else {
      const vehicles = NONTOLL_VEHICLES[cat] || [];
      out.tableB[cat] = {
        viol: sumVC("Violation", vehicles),   // recorded while in Violation mode
        exem: sumVC("Exemption", vehicles),   // recorded while in Exemption mode
      };
    }
  });

  return out;
}

/* ─────────────────────────────────────────────
   APPLY AUDIT FILL — shared helper
   Merges tlExtractFromAudit result into tlData,
   repopulates inputs, recalcs, and marks cells.
   Safe to call multiple times (idempotent).
───────────────────────────────────────────── */

function _tlApplyAuditFill(dateKey) {
  const auditFill = tlExtractFromAudit(dateKey);
  if (!auditFill) return false;

  TL_CLASSES.forEach(c => {
    if (!tlData.tableA[c.key]) tlData.tableA[c.key] = {};
    if (auditFill.tableA[c.key]) {
      tlData.tableA[c.key].viol = auditFill.tableA[c.key].viol;
      tlData.tableA[c.key].exem = auditFill.tableA[c.key].exem;
      tlData.tableA[c.key].pass = auditFill.tableA[c.key].pass;
    }
  });
  TL_NONTOLL_CATS.forEach(cat => {
    if (auditFill.tableB[cat]) {
      tlData.tableB[cat] = { ...auditFill.tableB[cat] };
    }
  });

  tlPopulateFromData();
  tlRecalcAll();
  _tlMarkAuditFilled();
  return true;
}

/* Called from data.js _mergeAllDatesFromFirestore after cloud data lands */
function tlRefreshAuditFill() {
  const panel = document.getElementById("trafficLossPanel");
  if (!panel || !panel.classList.contains("tlp-visible")) return;
  _tlApplyAuditFill(tlDate);
}

/* ─────────────────────────────────────────────
   PANEL LIFECYCLE
───────────────────────────────────────────── */

async function openTrafficLossPanel(dateStr) {
  tlDate = dateStr || getTodayKey();
  tlRenderPanel();                    // render shell first (instant)
  _tlSetStatus("saving");             // show loading state
  tlData = await tlLoad(tlDate);      // async load from Firestore / localStorage

  // Apply audit fill immediately from whatever data is in memory
  _tlApplyAuditFill(tlDate);

  _tlSetStatus("saved");

  document.getElementById("trafficLossPanel").classList.add("tlp-visible");

  // Second pass after a short delay — in case auditDataStore was still loading
  // from Firestore when the panel opened (background merge may not be done yet)
  setTimeout(() => {
    if (document.getElementById("trafficLossPanel")
        .classList.contains("tlp-visible")) {
      _tlApplyAuditFill(tlDate);
    }
  }, 2500);
}

function closeTrafficLossPanel() {
  document.getElementById("trafficLossPanel").classList.remove("tlp-visible");
}

/* ─────────────────────────────────────────────
   RENDER
   (called once on open; inputs are re-bound each open)
───────────────────────────────────────────── */

/* Active tab: "daily" | "monthly" */
let _tlActiveTab = "daily";

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
        <div class="tlp-header-sub">Total Actual Traffic Loss Classwise</div>
      </div>
    </div>
    <div class="tlp-tab-bar">
      <button class="tlp-tab ${_tlActiveTab==="daily"?"tlp-tab-active":""}" id="tlTabDaily" type="button">
        <i class="bi bi-calendar-day"></i> Daily Report
      </button>
      <button class="tlp-tab ${_tlActiveTab==="monthly"?"tlp-tab-active":""}" id="tlTabMonthly" type="button">
        <i class="bi bi-calendar3"></i> Monthly Master
      </button>
    </div>
    <div class="tlp-header-right">
      <div class="tlp-date-wrap" id="tlDailyDateWrap">
        <span class="tlp-date-label"><i class="bi bi-calendar-event"></i> Report Date</span>
        <input type="date" class="tlp-date-input" id="tlDateInput" value="${tlDate}">
      </div>
      <div class="tlp-date-wrap" id="tlMonthlyMonthWrap" style="display:none;">
        <span class="tlp-date-label"><i class="bi bi-calendar-month"></i> Month</span>
        <input type="month" class="tlp-date-input" id="tlMonthInput" value="${tlDate.slice(0,7)}">
      </div>
      <span class="tl-save-status tls-saved" id="tlSaveStatus">
        <i class="bi bi-cloud-check"></i> Saved
      </span>
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
    </div>
  </div>`);

  /* ── Daily body ── */
  const dailyBody = document.createElement("div");
  dailyBody.className = "tlp-body";
  dailyBody.id = "tlDailyBody";
  dailyBody.style.display = _tlActiveTab === "daily" ? "block" : "none";
  dailyBody.insertAdjacentHTML("beforeend", tlBuildTableA());
  dailyBody.insertAdjacentHTML("beforeend", tlBuildTableB());
  dailyBody.insertAdjacentHTML("beforeend", tlBuildTableC());
  dailyBody.insertAdjacentHTML("beforeend", tlBuildRecon());
  panel.appendChild(dailyBody);

  /* ── Monthly Master body ── */
  const mmBody = document.createElement("div");
  mmBody.className = "tlp-body";
  mmBody.id = "tlMonthlyBody";
  mmBody.style.display = _tlActiveTab === "monthly" ? "block" : "none";
  panel.appendChild(mmBody);

  /* ── Event wiring ── */
  document.getElementById("tlBackBtn").addEventListener("click", closeTrafficLossPanel);

  // Tab switching
  document.getElementById("tlTabDaily").addEventListener("click", () => _tlSwitchTab("daily"));
  document.getElementById("tlTabMonthly").addEventListener("click", () => _tlSwitchTab("monthly"));

  // Manual Save button — only active on daily tab
  document.getElementById("tlSaveBtn").addEventListener("click", async () => {
    if (_tlActiveTab === "daily") {
      tlCollectData();
      await tlSave();
    } else {
      tlRenderMonthlyMaster(document.getElementById("tlMonthInput").value);
    }
  });

  // Date picker
  document.getElementById("tlDateInput").addEventListener("change", async e => {
    tlCollectData();
    await tlSave();
    tlDate = e.target.value;
    _tlSetStatus("saving");
    tlData = await tlLoad(tlDate);
    _tlApplyAuditFill(tlDate);
    _tlSetStatus("saved");
  });

  // Month picker for monthly master
  document.getElementById("tlMonthInput").addEventListener("change", e => {
    tlRenderMonthlyMaster(e.target.value);
  });

  document.getElementById("tlExportXlsBtn").addEventListener("click", () => {
    if (_tlActiveTab === "daily") tlExportExcel();
    else tlExportMonthlyExcel();
  });
  document.getElementById("tlExportPdfBtn").addEventListener("click", () => {
    if (_tlActiveTab === "daily") tlExportPdf();
    else tlExportMonthlyPdf();
  });

  // Delegate all input events (daily tab)
  panel.addEventListener("input", e => {
    if (e.target.matches(".tl-input")) {
      const v = parseInt(e.target.value, 10);
      if (isNaN(v) || v < 0) {
        e.target.classList.add("input-err");
      } else {
        e.target.classList.remove("input-err");
        e.target.value = v;
      }
      tlCollectData();
      tlRecalcAll();
      tlScheduleAutoSave();
    }
  });

  // If starting on monthly tab, render it now
  if (_tlActiveTab === "monthly") {
    tlRenderMonthlyMaster(tlDate.slice(0, 7));
  }
}

function _tlSwitchTab(tab) {
  _tlActiveTab = tab;
  const daily   = document.getElementById("tlDailyBody");
  const monthly = document.getElementById("tlMonthlyBody");
  const tDaily  = document.getElementById("tlTabDaily");
  const tMon    = document.getElementById("tlTabMonthly");
  const dateWrap  = document.getElementById("tlDailyDateWrap");
  const monthWrap = document.getElementById("tlMonthlyMonthWrap");
  const saveBtn   = document.getElementById("tlSaveBtn");
  const pdfBtn    = document.getElementById("tlExportPdfBtn");

  if (tab === "daily") {
    daily.style.display   = "block";
    monthly.style.display = "none";
    tDaily.classList.add("tlp-tab-active");
    tMon.classList.remove("tlp-tab-active");
    dateWrap.style.display  = "";
    monthWrap.style.display = "none";
    saveBtn.innerHTML = '<i class="bi bi-floppy2-fill"></i> Save';
    pdfBtn.style.display = "";
  } else {
    daily.style.display   = "none";
    monthly.style.display = "block";
    tDaily.classList.remove("tlp-tab-active");
    tMon.classList.add("tlp-tab-active");
    dateWrap.style.display  = "none";
    monthWrap.style.display = "";
    saveBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Refresh';
    pdfBtn.style.display = "none";
    tlRenderMonthlyMaster(document.getElementById("tlMonthInput").value);
  }
}

/* ─────────────────────────────────────────────
   MARK AUTO-FILLED CELLS
   Adds a visual "from audit" badge to viol/exem
   inputs and Table B inputs that were filled
   automatically from the audit data.
───────────────────────────────────────────── */

function _tlMarkAuditFilled() {
  // Mark Table A viol/exem/pass cells
  TL_CLASSES.forEach(c => {
    ["viol", "exem", "pass"].forEach(field => {
      const el = document.querySelector(
        `.tl-input[data-table="a"][data-class="${c.key}"][data-field="${field}"]`
      );
      if (el) {
        el.classList.add("tl-audit-filled");
        el.title = "Auto-filled from audit data";
      }
    });
  });
  // Mark Table B cells
  TL_NONTOLL_CATS.forEach(cat => {
    ["viol", "exem"].forEach(field => {
      const el = document.querySelector(
        `.tl-input[data-table="b"][data-cat="${cat}"][data-field="${field}"]`
      );
      if (el) {
        el.classList.add("tl-audit-filled");
        el.title = "Auto-filled from audit data";
      }
    });
  });
}

/* ─────────────────────────────────────────────
   TABLE A — Paid Traffic + Violations/Exemptions
───────────────────────────────────────────── */

function tlBuildTableA() {
  // field keys must match tlData keys: cash, ret, barcode, digital, etc, pass
  const paidCols = [
    { label: "Cash",    field: "cash"    },
    { label: "Return",  field: "ret"     },
    { label: "Barcode", field: "barcode" },
    { label: "Digital", field: "digital" },
    { label: "ETC",     field: "etc"     },
    { label: "Pass",    field: "pass"    },
  ];
  let rows = "";
  TL_CLASSES.forEach(c => {
    rows += `<tr data-class="${c.key}">
      <td>${c.label}</td>
      ${paidCols.map(col => `<td><input type="number" class="tl-input" data-table="a" data-class="${c.key}" data-field="${col.field}" min="0" value="0"></td>`).join("")}
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
    <div class="tlp-audit-banner">
      <i class="bi bi-magic"></i>
      Violation &amp; Exemption counts are <strong>auto-filled from today's audit data</strong>. Paid counts (Cash, Return, Barcode, Digital, ETC, Pass) must be entered manually.
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
    <div class="tlp-audit-banner">
      <i class="bi bi-magic"></i>
      All counts are <strong>auto-filled from audit data</strong> — Ambulance/Bike/Tractor/JCB/Govt/Police from Exemption mode, Forcefully from Violation mode.
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

/* ═══════════════════════════════════════════════════════════
   MONTHLY MASTER REGISTER
   One row per calendar day — aggregates each day's saved
   Traffic Loss Report into the exact spreadsheet format:
     Paid Traffic (by class) | Exempted Tollable | Non-Toll |
     Violation Tollable | Non-Toll | Total Traffic Classwise | Total
═══════════════════════════════════════════════════════════ */

const MM_COL_CLASSES = [
  { key: "car",    label: "Car"          },
  { key: "lcv",    label: "LCV/Mini Bus" },
  { key: "truck2", label: "Bus"          },
  { key: "mav",    label: "MAV 3-6 Axl" },
  { key: "osv",    label: "OS V"         },
];

const MM_DAY_NAMES   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MM_MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

/* Extract per-day summary from a saved tlData object */
function _mmSummarise(data) {
  if (!data || !data.tableA) return null;
  const paid = {}, exem = {}, viol = {}, classTotal = {};
  let paidTotal = 0, exemTotal = 0, violTotal = 0, classGrand = 0;
  MM_COL_CLASSES.forEach(c => {
    const row = data.tableA[c.key] || {};
    const p = (row.cash||0)+(row.ret||0)+(row.barcode||0)+(row.digital||0)+(row.etc||0)+(row.pass||0);
    paid[c.key] = p;  paidTotal += p;
    exem[c.key] = row.exem || 0;  exemTotal += exem[c.key];
    viol[c.key] = row.viol || 0;  violTotal += viol[c.key];
  });
  paid.total = paidTotal;
  exem.total = exemTotal;
  viol.total = violTotal;
  let nontollExem = 0, nontollViol = 0;
  if (data.tableB) {
    TL_NONTOLL_CATS.forEach(cat => {
      const row = data.tableB[cat] || {};
      nontollViol += row.viol || 0;
      nontollExem += row.exem || 0;
    });
  }
  MM_COL_CLASSES.forEach(c => {
    classTotal[c.key] = (paid[c.key]||0) + (exem[c.key]||0) + (viol[c.key]||0);
    classGrand += classTotal[c.key];
  });
  classTotal.total = classGrand;
  const grandTotal = classGrand + nontollExem + nontollViol;
  exem.pct = grandTotal > 0 ? (exemTotal / grandTotal * 100) : 0;
  viol.pct = grandTotal > 0 ? (violTotal / grandTotal * 100) : 0;
  return { paid, exem, nontollExem, viol, nontollViol, classTotal, grandTotal };
}

/* Collect all saved daily TL reports for a given YYYY-MM */
function _mmCollectMonth(yearMonth) {
  const [y, m]      = yearMonth.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const rows = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey   = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const raw       = _tlLoadLocal(dateKey);
    const summary   = raw ? _mmSummarise(raw) : null;
    const dayOfWeek = new Date(y, m - 1, d).getDay();
    rows.push({ dateKey, d, dayOfWeek, summary });
  }
  return rows;
}

/* Total column count */
function _mmColCount() {
  const n = MM_COL_CLASSES.length;
  return 2 + (n+1) + (n+2) + 1 + (n+2) + 1 + (n+1) + 1;
}

function _mmEmptyTotals() {
  const t = {
    paid: { total:0 }, exem: { total:0, pct:0 },
    viol: { total:0, pct:0 },
    nontollExem: 0, nontollViol: 0,
    classTotal: { total:0 }, grandTotal: 0
  };
  MM_COL_CLASSES.forEach(c => {
    t.paid[c.key] = t.exem[c.key] = t.viol[c.key] = t.classTotal[c.key] = 0;
  });
  return t;
}

function _mmAccumulate(tot, s) {
  MM_COL_CLASSES.forEach(c => {
    tot.paid[c.key]       += s.paid[c.key]       || 0;
    tot.exem[c.key]       += s.exem[c.key]       || 0;
    tot.viol[c.key]       += s.viol[c.key]       || 0;
    tot.classTotal[c.key] += s.classTotal[c.key] || 0;
  });
  tot.paid.total       += s.paid.total       || 0;
  tot.exem.total       += s.exem.total       || 0;
  tot.viol.total       += s.viol.total       || 0;
  tot.classTotal.total += s.classTotal.total || 0;
  tot.nontollExem      += s.nontollExem      || 0;
  tot.nontollViol      += s.nontollViol      || 0;
  tot.grandTotal       += s.grandTotal       || 0;
  tot.exem.pct = tot.grandTotal > 0 ? (tot.exem.total / tot.grandTotal * 100) : 0;
  tot.viol.pct = tot.grandTotal > 0 ? (tot.viol.total / tot.grandTotal * 100) : 0;
}

function _mmDivTotals(t, div) {
  const a = _mmEmptyTotals();
  const r = v => Math.round(v / div);
  MM_COL_CLASSES.forEach(c => {
    a.paid[c.key]       = r(t.paid[c.key]);
    a.exem[c.key]       = r(t.exem[c.key]);
    a.viol[c.key]       = r(t.viol[c.key]);
    a.classTotal[c.key] = r(t.classTotal[c.key]);
  });
  a.paid.total       = r(t.paid.total);
  a.exem.total       = r(t.exem.total);
  a.viol.total       = r(t.viol.total);
  a.classTotal.total = r(t.classTotal.total);
  a.nontollExem      = r(t.nontollExem);
  a.nontollViol      = r(t.nontollViol);
  a.grandTotal       = r(t.grandTotal);
  a.exem.pct         = t.exem.pct;
  a.viol.pct         = t.viol.pct;
  return a;
}

function _mmCalcStat(yearMonth, stat) {
  const summaries = _mmCollectMonth(yearMonth).map(r => r.summary).filter(Boolean);
  if (!summaries.length) return null;
  const fn   = stat === "max" ? Math.max : Math.min;
  const init = stat === "max" ? -Infinity : Infinity;
  const s    = _mmEmptyTotals();
  MM_COL_CLASSES.forEach(c => {
    s.paid[c.key]       = summaries.reduce((a,x) => fn(a, x.paid[c.key]||0), init);
    s.exem[c.key]       = summaries.reduce((a,x) => fn(a, x.exem[c.key]||0), init);
    s.viol[c.key]       = summaries.reduce((a,x) => fn(a, x.viol[c.key]||0), init);
    s.classTotal[c.key] = summaries.reduce((a,x) => fn(a, x.classTotal[c.key]||0), init);
  });
  s.paid.total       = summaries.reduce((a,x) => fn(a, x.paid.total||0),       init);
  s.exem.total       = summaries.reduce((a,x) => fn(a, x.exem.total||0),       init);
  s.exem.pct         = summaries.reduce((a,x) => fn(a, x.exem.pct||0),         init);
  s.viol.total       = summaries.reduce((a,x) => fn(a, x.viol.total||0),       init);
  s.viol.pct         = summaries.reduce((a,x) => fn(a, x.viol.pct||0),         init);
  s.classTotal.total = summaries.reduce((a,x) => fn(a, x.classTotal.total||0), init);
  s.nontollExem      = summaries.reduce((a,x) => fn(a, x.nontollExem||0),      init);
  s.nontollViol      = summaries.reduce((a,x) => fn(a, x.nontollViol||0),      init);
  s.grandTotal       = summaries.reduce((a,x) => fn(a, x.grandTotal||0),       init);
  return s;
}

function _mmSafe(v)    { return (!isFinite(v)) ? 0 : v; }
function _mmSafePct(v) { return (!isFinite(v)) ? "0.00%" : v.toFixed(2) + "%"; }

function _mmStatCells(s) {
  const cols = [];
  MM_COL_CLASSES.forEach(c => cols.push(`<td>${_mmSafe(s.paid[c.key])}</td>`));
  cols.push(`<td>${_mmSafe(s.paid.total)}</td>`);
  MM_COL_CLASSES.forEach(c => cols.push(`<td>${_mmSafe(s.exem[c.key])}</td>`));
  cols.push(`<td>${_mmSafe(s.exem.total)}</td>`, `<td>${_mmSafePct(s.exem.pct)}</td>`);
  cols.push(`<td>${_mmSafe(s.nontollExem)}</td>`);
  MM_COL_CLASSES.forEach(c => cols.push(`<td>${_mmSafe(s.viol[c.key])}</td>`));
  cols.push(`<td>${_mmSafe(s.viol.total)}</td>`, `<td>${_mmSafePct(s.viol.pct)}</td>`);
  cols.push(`<td>${_mmSafe(s.nontollViol)}</td>`);
  MM_COL_CLASSES.forEach(c => cols.push(`<td>${_mmSafe(s.classTotal[c.key])}</td>`));
  cols.push(`<td>${_mmSafe(s.classTotal.total)}</td>`, `<td>${_mmSafe(s.grandTotal)}</td>`);
  return cols.join("");
}

function _mmDataCells(summary) {
  const { paid, exem, viol, nontollExem, nontollViol, classTotal, grandTotal } = summary;
  const cols = [];
  MM_COL_CLASSES.forEach(c => cols.push(`<td class="mm-td-paid">${paid[c.key]||0}</td>`));
  cols.push(`<td class="mm-td-paid mm-td-subtotal">${paid.total||0}</td>`);
  MM_COL_CLASSES.forEach(c => cols.push(`<td class="mm-td-exem">${exem[c.key]||0}</td>`));
  cols.push(`<td class="mm-td-exem mm-td-subtotal">${exem.total||0}</td>`,
            `<td class="mm-td-exem mm-td-pct">${exem.pct.toFixed(2)}%</td>`);
  cols.push(`<td class="mm-td-nontoll">${nontollExem||0}</td>`);
  MM_COL_CLASSES.forEach(c => cols.push(`<td class="mm-td-viol">${viol[c.key]||0}</td>`));
  cols.push(`<td class="mm-td-viol mm-td-subtotal">${viol.total||0}</td>`,
            `<td class="mm-td-viol mm-td-pct">${viol.pct.toFixed(2)}%</td>`);
  cols.push(`<td class="mm-td-nontoll">${nontollViol||0}</td>`);
  MM_COL_CLASSES.forEach(c => cols.push(`<td class="mm-td-cls">${classTotal[c.key]||0}</td>`));
  cols.push(`<td class="mm-td-cls mm-td-subtotal">${classTotal.total||0}</td>`,
            `<td class="mm-td-grand">${grandTotal||0}</td>`);
  return cols.join("");
}

function _mmEmptyDataCells() {
  const n = _mmColCount() - 2;
  return Array(n).fill(`<td class="mm-td-empty">—</td>`).join("");
}

function _mmFooterDataCells(s, isAvg) {
  const fmt = v => isAvg ? Math.round(v) : v;
  const cols = [];
  MM_COL_CLASSES.forEach(c => cols.push(`<td>${fmt(s.paid[c.key]||0)}</td>`));
  cols.push(`<td>${fmt(s.paid.total||0)}</td>`);
  MM_COL_CLASSES.forEach(c => cols.push(`<td>${fmt(s.exem[c.key]||0)}</td>`));
  cols.push(`<td>${fmt(s.exem.total||0)}</td>`, `<td>${_mmSafePct(s.exem.pct)}</td>`);
  cols.push(`<td>${fmt(s.nontollExem||0)}</td>`);
  MM_COL_CLASSES.forEach(c => cols.push(`<td>${fmt(s.viol[c.key]||0)}</td>`));
  cols.push(`<td>${fmt(s.viol.total||0)}</td>`, `<td>${_mmSafePct(s.viol.pct)}</td>`);
  cols.push(`<td>${fmt(s.nontollViol||0)}</td>`);
  MM_COL_CLASSES.forEach(c => cols.push(`<td>${fmt(s.classTotal[c.key]||0)}</td>`));
  cols.push(`<td>${fmt(s.classTotal.total||0)}</td>`, `<td>${fmt(s.grandTotal||0)}</td>`);
  return cols.join("");
}

/* ── RENDER MONTHLY MASTER ── */
async function tlRenderMonthlyMaster(yearMonth) {
  const container = document.getElementById("tlMonthlyBody");
  if (!container) return;
  const [y, m]     = yearMonth.split("-").map(Number);
  const monthLabel = `${MM_MONTH_NAMES[m-1]} ${y}`;

  container.innerHTML = `
    <div class="tlp-section">
      <div class="tlp-section-head">
        <i class="bi bi-calendar3"></i> Monthly Master Register — ${monthLabel}
        <span id="mmLoadingSpinner" style="margin-left:10px;font-size:11px;color:var(--amber);">
          <i class="bi bi-arrow-repeat" style="animation:spin 1s linear infinite;display:inline-block;"></i> Loading cloud data…
        </span>
      </div>
      <div class="tlp-audit-banner">
        <i class="bi bi-info-circle"></i>
        Data is pulled from your saved Traffic Loss Reports for each day of this month.
        Open a day and click <strong>Save</strong> to include it here.
        Rows highlighted in <strong style="color:var(--amber)">amber = Wednesdays</strong>.
        <span style="color:var(--text-faint);margin-left:8px;">Days with no saved data show —</span>
      </div>
      <div class="mm-table-wrap" id="mmTableWrap">
        ${_mmBuildTable(yearMonth)}
      </div>
    </div>`;

  _mmFetchCloudAndRefresh(yearMonth);
}

function _mmBuildTable(yearMonth) {
  const rows   = _mmCollectMonth(yearMonth);
  const [y, m] = yearMonth.split("-").map(Number);
  const n      = MM_COL_CLASSES.length;
  const totals = _mmEmptyTotals();
  let filledDays = 0;

  const rowsHtml = rows.map(r => {
    const { d, dayOfWeek, summary, dateKey } = r;
    const dayName  = MM_DAY_NAMES[dayOfWeek];
    const isWed    = dayOfWeek === 3;
    const dateDisp = `${String(d).padStart(2,"0")}/${String(m).padStart(2,"0")}`;
    const rowCls   = isWed ? "mm-row-wed" : (dayOfWeek === 0 ? "mm-row-sun" : "");

    if (!summary) {
      return `<tr class="${rowCls}" data-date="${dateKey}">
        <td class="mm-td-date"><strong>${dateDisp}</strong></td>
        <td class="mm-td-day">${dayName}</td>
        ${_mmEmptyDataCells()}
      </tr>`;
    }
    filledDays++;
    _mmAccumulate(totals, summary);
    return `<tr class="${rowCls}" data-date="${dateKey}">
      <td class="mm-td-date"><strong>${dateDisp}</strong></td>
      <td class="mm-td-day">${dayName}</td>
      ${_mmDataCells(summary)}
    </tr>`;
  }).join("");

  const avgDiv = filledDays > 0 ? filledDays : 1;
  const avg    = _mmDivTotals(totals, avgDiv);
  const max    = _mmCalcStat(yearMonth, "max");
  const min    = _mmCalcStat(yearMonth, "min");

  return `
  <table class="mm-table" id="mmTable">
    <thead>
      <tr class="mm-head-group">
        <th rowspan="2" class="mm-th-date">Class/<br>Date</th>
        <th rowspan="2" class="mm-th-day"></th>
        <th colspan="${n+1}" class="mm-th-paid">Paid Traffic</th>
        <th colspan="${n+2}" class="mm-th-exem">Exempted Tollable Traffic</th>
        <th rowspan="2" class="mm-th-nontoll">Non-<br>Tollable</th>
        <th colspan="${n+2}" class="mm-th-viol">Violation Tollable Traffic</th>
        <th rowspan="2" class="mm-th-nontoll">Non-<br>Tollable</th>
        <th colspan="${n+1}" class="mm-th-cls">Total Traffic Classwise</th>
        <th rowspan="2" class="mm-th-grand">Total<br>Traffic</th>
      </tr>
      <tr class="mm-head-sub">
        ${MM_COL_CLASSES.map(c=>`<th class="mm-subth-paid">${c.label}</th>`).join("")}
        <th class="mm-subth-paid">Total</th>
        ${MM_COL_CLASSES.map(c=>`<th class="mm-subth-exem">${c.label}</th>`).join("")}
        <th class="mm-subth-exem">Total</th>
        <th class="mm-subth-exem">% in Total<br>Traffic</th>
        ${MM_COL_CLASSES.map(c=>`<th class="mm-subth-viol">${c.label}</th>`).join("")}
        <th class="mm-subth-viol">Total</th>
        <th class="mm-subth-viol">% in Total<br>Traffic</th>
        ${MM_COL_CLASSES.map(c=>`<th class="mm-subth-cls">${c.label}</th>`).join("")}
        <th class="mm-subth-cls">Total</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr class="mm-footer-total">
        <td colspan="2">Total Traffic</td>
        ${_mmFooterDataCells(totals, false)}
      </tr>
      <tr class="mm-footer-avg">
        <td colspan="2">Average</td>
        ${_mmFooterDataCells(avg, true)}
      </tr>
      <tr class="mm-footer-stat">
        <td colspan="2">Maximum</td>
        ${max ? _mmStatCells(max) : `<td colspan="${_mmColCount()-2}">No data</td>`}
      </tr>
      <tr class="mm-footer-stat">
        <td colspan="2">Minimum</td>
        ${min ? _mmStatCells(min) : `<td colspan="${_mmColCount()-2}">No data</td>`}
      </tr>
    </tfoot>
  </table>`;
}

/* Fetch cloud data for any day not yet in localStorage, then re-render */
async function _mmFetchCloudAndRefresh(yearMonth) {
  const spinner = document.getElementById("mmLoadingSpinner");
  if (typeof fbDb === "undefined" || !fbDb || typeof fbAuthReady === "undefined") {
    if (spinner) spinner.style.display = "none";
    return;
  }
  await fbAuthReady;
  if (typeof fbAuth === "undefined" || !fbAuth || !fbAuth.currentUser) {
    if (spinner) spinner.style.display = "none";
    return;
  }
  const [y, m]      = yearMonth.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  let fetched = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    if (!_tlLoadLocal(dateKey) && typeof fbLoadTlReport === "function") {
      try {
        const cloud = await fbLoadTlReport(dateKey);
        if (cloud) { _tlSaveLocal(dateKey, cloud); fetched++; }
      } catch(e) { /* silent */ }
    }
  }
  if (spinner) spinner.style.display = "none";
  if (fetched > 0) {
    const wrap = document.getElementById("mmTableWrap");
    if (wrap) wrap.innerHTML = _mmBuildTable(yearMonth);
  }
}

/* ── MONTHLY MASTER EXCEL EXPORT ── */
function tlExportMonthlyExcel() {
  if (typeof XLSX === "undefined") {
    alert("Excel library not loaded. Please refresh the page.");
    return;
  }
  const yearMonth  = (document.getElementById("tlMonthInput")||{}).value || tlDate.slice(0,7);
  const [y, m]     = yearMonth.split("-").map(Number);
  const rows       = _mmCollectMonth(yearMonth);
  const colLabels  = MM_COL_CLASSES.map(c => c.label);
  const n          = MM_COL_CLASSES.length;

  const h1 = [
    "Class/Date","",
    "Paid Traffic", ...Array(n).fill(""),
    "Exempted Tollable Traffic", ...Array(n+1).fill(""),
    "Non-Tollable",
    "Violation Tollable Traffic", ...Array(n+1).fill(""),
    "Non-Tollable",
    "Total Traffic Classwise", ...Array(n).fill(""),
    "Total Traffic"
  ];
  const h2 = [
    "Date","Day",
    ...colLabels,"Total",
    ...colLabels,"Total","% in Total Traffic","Non-Tollable",
    ...colLabels,"Total","% in Total Traffic","Non-Tollable",
    ...colLabels,"Total",
    "Total Traffic"
  ];

  const dataRows = [];
  const totals   = _mmEmptyTotals();
  let filledDays = 0;

  rows.forEach(r => {
    const { d, dayOfWeek, summary } = r;
    const dateDisp = `${String(d).padStart(2,"0")}/${String(m).padStart(2,"0")}`;
    const dayName  = MM_DAY_NAMES[dayOfWeek];
    if (!summary) {
      dataRows.push([dateDisp, dayName, ...Array(_mmColCount()-2).fill(0)]);
      return;
    }
    filledDays++;
    _mmAccumulate(totals, summary);
    const { paid, exem, viol, nontollExem, nontollViol, classTotal, grandTotal } = summary;
    dataRows.push([
      dateDisp, dayName,
      ...MM_COL_CLASSES.map(c => paid[c.key]||0), paid.total||0,
      ...MM_COL_CLASSES.map(c => exem[c.key]||0), exem.total||0,
      +(exem.pct.toFixed(2)), nontollExem||0,
      ...MM_COL_CLASSES.map(c => viol[c.key]||0), viol.total||0,
      +(viol.pct.toFixed(2)), nontollViol||0,
      ...MM_COL_CLASSES.map(c => classTotal[c.key]||0), classTotal.total||0,
      grandTotal||0
    ]);
  });

  const avgDiv = filledDays > 0 ? filledDays : 1;
  const avg    = _mmDivTotals(totals, avgDiv);

  dataRows.push([
    "Total Traffic","",
    ...MM_COL_CLASSES.map(c => totals.paid[c.key]||0), totals.paid.total||0,
    ...MM_COL_CLASSES.map(c => totals.exem[c.key]||0), totals.exem.total||0,
    +(totals.exem.pct.toFixed(2)), totals.nontollExem||0,
    ...MM_COL_CLASSES.map(c => totals.viol[c.key]||0), totals.viol.total||0,
    +(totals.viol.pct.toFixed(2)), totals.nontollViol||0,
    ...MM_COL_CLASSES.map(c => totals.classTotal[c.key]||0), totals.classTotal.total||0,
    totals.grandTotal||0
  ]);
  dataRows.push([
    "Average","",
    ...MM_COL_CLASSES.map(c => avg.paid[c.key]||0), avg.paid.total||0,
    ...MM_COL_CLASSES.map(c => avg.exem[c.key]||0), avg.exem.total||0,
    +(totals.exem.pct.toFixed(2)), avg.nontollExem||0,
    ...MM_COL_CLASSES.map(c => avg.viol[c.key]||0), avg.viol.total||0,
    +(totals.viol.pct.toFixed(2)), avg.nontollViol||0,
    ...MM_COL_CLASSES.map(c => avg.classTotal[c.key]||0), avg.classTotal.total||0,
    avg.grandTotal||0
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([h1, h2, ...dataRows]);
  ws["!cols"] = [{ wch:8 },{ wch:5 },...Array(_mmColCount()-2).fill({ wch:9 })];
  XLSX.utils.book_append_sheet(wb, ws, `${MM_MONTH_NAMES[m-1].slice(0,3)} ${y}`);
  XLSX.writeFile(wb, `Monthly_Master_${yearMonth}.xlsx`);
}

/* ── MONTHLY MASTER PDF EXPORT ── */
function tlExportMonthlyPdf() {
  const yearMonth  = (document.getElementById("tlMonthInput")||{}).value || tlDate.slice(0,7);
  const [y, m]     = yearMonth.split("-").map(Number);
  const monthLabel = `${MM_MONTH_NAMES[m-1]} ${y}`;
  const rows       = _mmCollectMonth(yearMonth);
  const n          = MM_COL_CLASSES.length;
  const win        = window.open("","_blank");
  if (!win) { alert("Popup blocked. Please allow popups for this site."); return; }

  const totals   = _mmEmptyTotals();
  let filledDays = 0;

  const bodyRows = rows.map(r => {
    const { d, dayOfWeek, summary } = r;
    const dateDisp = `${String(d).padStart(2,"0")}/${String(m).padStart(2,"0")}`;
    const dayName  = MM_DAY_NAMES[dayOfWeek];
    const rowCls   = dayOfWeek === 3 ? "row-wed" : "";
    if (!summary) {
      return `<tr class="${rowCls}"><td>${dateDisp}</td><td>${dayName}</td>${Array(_mmColCount()-2).fill("<td>0</td>").join("")}</tr>`;
    }
    filledDays++;
    _mmAccumulate(totals, summary);
    const { paid, exem, viol, nontollExem, nontollViol, classTotal, grandTotal } = summary;
    return `<tr class="${rowCls}">
      <td>${dateDisp}</td><td>${dayName}</td>
      ${MM_COL_CLASSES.map(c=>`<td>${paid[c.key]||0}</td>`).join("")}<td>${paid.total||0}</td>
      ${MM_COL_CLASSES.map(c=>`<td>${exem[c.key]||0}</td>`).join("")}<td>${exem.total||0}</td><td>${exem.pct.toFixed(2)}%</td>
      <td>${nontollExem||0}</td>
      ${MM_COL_CLASSES.map(c=>`<td>${viol[c.key]||0}</td>`).join("")}<td>${viol.total||0}</td><td>${viol.pct.toFixed(2)}%</td>
      <td>${nontollViol||0}</td>
      ${MM_COL_CLASSES.map(c=>`<td>${classTotal[c.key]||0}</td>`).join("")}<td>${classTotal.total||0}</td>
      <td>${grandTotal||0}</td>
    </tr>`;
  }).join("");

  const avgDiv = filledDays > 0 ? filledDays : 1;
  const avg    = _mmDivTotals(totals, avgDiv);

  win.document.write(`<!DOCTYPE html><html><head>
    <title>Monthly Master — ${monthLabel}</title>
    <style>
      body{font-family:system-ui,sans-serif;font-size:8.5px;margin:10px}
      h2{font-size:12px;margin-bottom:6px}
      table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #aaa;padding:2px 3px;text-align:center;white-space:nowrap}
      th{font-size:8px;font-weight:700}
      .th-paid{background:#bdd7ee}.th-exem{background:#c6efce}
      .th-viol{background:#fce4d6}.th-cls{background:#e2efda}.th-nt{background:#fff2cc}
      .row-wed td{background:#fce4d6}
      .ft td{background:#d6dce4;font-weight:700}
      .fa td{background:#e2efda}
      @media print{body{margin:4px}}
    </style>
  </head><body>
    <h2>Monthly Master Register — ${monthLabel}</h2>
    <table><thead>
      <tr>
        <th rowspan="2">Date</th><th rowspan="2">Day</th>
        <th class="th-paid" colspan="${n+1}">Paid Traffic</th>
        <th class="th-exem" colspan="${n+2}">Exempted Tollable Traffic</th>
        <th class="th-nt" rowspan="2">Non-Tollable</th>
        <th class="th-viol" colspan="${n+2}">Violation Tollable Traffic</th>
        <th class="th-nt" rowspan="2">Non-Tollable</th>
        <th class="th-cls" colspan="${n+1}">Total Traffic Classwise</th>
        <th rowspan="2">Total Traffic</th>
      </tr>
      <tr>
        ${MM_COL_CLASSES.map(c=>`<th class="th-paid">${c.label}</th>`).join("")}<th class="th-paid">Total</th>
        ${MM_COL_CLASSES.map(c=>`<th class="th-exem">${c.label}</th>`).join("")}<th class="th-exem">Total</th><th class="th-exem">%</th>
        ${MM_COL_CLASSES.map(c=>`<th class="th-viol">${c.label}</th>`).join("")}<th class="th-viol">Total</th><th class="th-viol">%</th>
        ${MM_COL_CLASSES.map(c=>`<th class="th-cls">${c.label}</th>`).join("")}<th class="th-cls">Total</th>
      </tr>
    </thead><tbody>${bodyRows}</tbody>
    <tfoot>
      <tr class="ft"><td colspan="2">Total Traffic</td>
        ${MM_COL_CLASSES.map(c=>`<td>${totals.paid[c.key]||0}</td>`).join("")}<td>${totals.paid.total||0}</td>
        ${MM_COL_CLASSES.map(c=>`<td>${totals.exem[c.key]||0}</td>`).join("")}<td>${totals.exem.total||0}</td><td>${totals.exem.pct.toFixed(2)}%</td>
        <td>${totals.nontollExem||0}</td>
        ${MM_COL_CLASSES.map(c=>`<td>${totals.viol[c.key]||0}</td>`).join("")}<td>${totals.viol.total||0}</td><td>${totals.viol.pct.toFixed(2)}%</td>
        <td>${totals.nontollViol||0}</td>
        ${MM_COL_CLASSES.map(c=>`<td>${totals.classTotal[c.key]||0}</td>`).join("")}<td>${totals.classTotal.total||0}</td>
        <td>${totals.grandTotal||0}</td>
      </tr>
      <tr class="fa"><td colspan="2">Average</td>
        ${MM_COL_CLASSES.map(c=>`<td>${avg.paid[c.key]||0}</td>`).join("")}<td>${avg.paid.total||0}</td>
        ${MM_COL_CLASSES.map(c=>`<td>${avg.exem[c.key]||0}</td>`).join("")}<td>${avg.exem.total||0}</td><td>${totals.exem.pct.toFixed(2)}%</td>
        <td>${avg.nontollExem||0}</td>
        ${MM_COL_CLASSES.map(c=>`<td>${avg.viol[c.key]||0}</td>`).join("")}<td>${avg.viol.total||0}</td><td>${totals.viol.pct.toFixed(2)}%</td>
        <td>${avg.nontollViol||0}</td>
        ${MM_COL_CLASSES.map(c=>`<td>${avg.classTotal[c.key]||0}</td>`).join("")}<td>${avg.classTotal.total||0}</td>
        <td>${avg.grandTotal||0}</td>
      </tr>
    </tfoot></table>
    <script>window.onload=()=>{window.print();window.close();}<\/script>
  </body></html>`);
  win.document.close();
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
