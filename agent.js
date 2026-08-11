/* ═══════════════════════════════════════════════════════════════
   AUDIT AGENT  —  agent.js
   Reads:  1) Consolidate Revenue Report (Excel)
           2) Violation Matrix Report (Excel)
   Outputs: Filled Audit Template (.xlsx)
═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── DEFAULT TARIFFS (editable in UI) ── */
  const DEFAULT_TARIFFS = [
    { key: 'car',    label: 'Car',          single: 85,  ret: 130 },
    { key: 'lcv',    label: 'LCV/Mini Bus',  single: 130, ret: 195 },
    { key: 'bus',    label: 'Bus',           single: 255, ret: 385 },
    { key: 'truck',  label: 'Truck',         single: 255, ret: 385 },
    { key: 'mav',    label: 'MAV 3-6 Axl',  single: 415, ret: 625 },
    { key: 'osv',    label: 'OSV',           single: 510, ret: 770 },
  ];

  /* ── CR (Consolidate Revenue) vehicle→key mapping ── */
  // Maps vehicle names from CR report to our internal keys
  const CR_VEHICLE_MAP = {
    'CAR':          'car',
    'LCV':          'lcv',
    'MINI BUS':     'lcv',   // combine with LCV
    'MINIBUS':      'lcv',
    'BUS 2 AXLE':   'bus',
    'BUS 2AXLE':    'bus',
    'BUS':          'bus',
    'TRUCK 2 AXLE': 'truck',
    'TRUCK 2AXLE':  'truck',
    'TRUCK 3 AXLE': 'mav',
    'TRUCK 3AXLE':  'mav',
    'MAV 4 AXLE':   'mav',
    'MAV 4AXLE':    'mav',
    'MAV 5 AXLE':   'mav',
    'MAV 5AXLE':    'mav',
    'MAV 6 AXLE':   'mav',
    'MAV 6AXLE':    'mav',
    'MAV':          'mav',
    'OSV':          'osv',
    'OVERSIZED':    'osv',
  };

  /* ── VM (Violation Matrix) row→key mapping ── */
  const VM_ROW_MAP = {
    'CAR':           'car',
    'LCV/MINIBUS':   'lcv',
    'LCV':           'lcv',
    'MINI BUS':      'lcv',
    'MINIBUS':       'lcv',
    'TRUCK 2 AXLE':  'truck',
    'TRUCK 2AXLE':   'truck',
    'TRUCK 3 AXLE':  'mav',
    'TRUCK 3AXLE':   'mav',
    'BUS 2 AXLE':    'bus',
    'BUS 2AXLE':     'bus',
    'BUS':           'bus',
    'MAV 4 - 6 AXLE':'mav',
    'MAV 4-6 AXLE':  'mav',
    'MAV 4 -6 AXLE': 'mav',
    'MAV 4-6AXL':    'mav',
    'MAV':           'mav',
    'OSV':           'osv',
  };

  /* Non-Tollable categories in VM */
  const NT_ROWS = ['AMBULANCE','AUTO','BIKE','TRACTOR','JCB',
                   'GOVT. VEHICLE','GOVT VEHICLE','GOVT','POLICE',
                   'FORCEFULLY','CONCESSIONAIRE','FAKE TRANSACTION',
                   'PASS MONTHLY/LOCAL','ALREADY PAID FOUND WITH ANOTHER TXN',
                   'ALREADY PAID'];

  /* ── STATE ── */
  let crData = null;   // parsed Consolidate Revenue data
  let vmData = null;   // parsed Violation Matrix data
  let tariffs = DEFAULT_TARIFFS.map(t => ({ ...t }));
  let resultData = null;

  /* ═══════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    renderTariffGrid();
  });

  function bindEvents() {
    const crInput = document.getElementById('agentCRInput');
    const vmInput = document.getElementById('agentVMInput');

    if (crInput) crInput.addEventListener('change', e => handleFile(e.target.files[0], 'cr'));
    if (vmInput) vmInput.addEventListener('change', e => handleFile(e.target.files[0], 'vm'));

    const runBtn = document.getElementById('agentRunBtn');
    if (runBtn) runBtn.addEventListener('click', runAgent);

    const dlBtn = document.getElementById('agentDownloadBtn');
    if (dlBtn) dlBtn.addEventListener('click', downloadTemplate);

    const resetBtn = document.getElementById('agentResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', resetAgent);
  }

  /* ═══════════════════════════════════════════
     TARIFF GRID
  ═══════════════════════════════════════════ */
  function renderTariffGrid() {
    const grid = document.getElementById('agentTariffGrid');
    if (!grid) return;
    grid.innerHTML = tariffs.map(t => `
      <div class="agent-tariff-item">
        <label>${t.label}</label>
        <div style="display:flex;gap:6px;">
          <input type="number" id="tariff_${t.key}_s" value="${t.single}" min="0"
                 placeholder="Single" title="${t.label} Single" style="width:50%">
          <input type="number" id="tariff_${t.key}_r" value="${t.ret}" min="0"
                 placeholder="Return" title="${t.label} Return" style="width:50%">
        </div>
        <div style="font-size:10px;color:#9ca3af;margin-top:2px;">Single / Return</div>
      </div>
    `).join('');
  }

  function readTariffsFromUI() {
    tariffs.forEach(t => {
      const s = document.getElementById(`tariff_${t.key}_s`);
      const r = document.getElementById(`tariff_${t.key}_r`);
      if (s) t.single = parseFloat(s.value) || 0;
      if (r) t.ret    = parseFloat(r.value) || 0;
    });
  }

  function getTariff(key) {
    return tariffs.find(t => t.key === key) || { single: 0, ret: 0 };
  }

  /* ═══════════════════════════════════════════
     FILE HANDLING
  ═══════════════════════════════════════════ */
  function handleFile(file, type) {
    if (!file) return;
    const nameEl  = document.getElementById(type === 'cr' ? 'agentCRFileName'  : 'agentVMFileName');
    const statEl  = document.getElementById(type === 'cr' ? 'agentCRStatus'    : 'agentVMStatus');
    const cardEl  = document.getElementById(type === 'cr' ? 'agentCRCard'      : 'agentVMCard');

    nameEl.textContent = file.name;
    statEl.textContent = 'Reading…';
    statEl.className   = 'agent-file-status';

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        if (type === 'cr') {
          crData = parseCR(wb);
          statEl.textContent = '✓ Parsed successfully';
          statEl.className   = 'agent-file-status ok';
          cardEl.classList.add('ready');
        } else {
          vmData = parseVM(wb);
          statEl.textContent = '✓ Parsed successfully';
          statEl.className   = 'agent-file-status ok';
          cardEl.classList.add('ready');
        }
        checkBothReady();
      } catch (err) {
        statEl.textContent = '✗ Error: ' + err.message;
        statEl.className   = 'agent-file-status err';
        console.error('Agent file parse error:', err);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function checkBothReady() {
    if (crData && vmData) {
      show('agentTariffSection');
      show('agentProcessSection');
      setFooterNote('Both files loaded. Confirm tariffs and click Generate.');
    } else if (crData || vmData) {
      setFooterNote('Upload the second file to continue.');
    }
  }

  /* ═══════════════════════════════════════════
     PARSE CONSOLIDATE REVENUE REPORT
  ═══════════════════════════════════════════ */
  function parseCR(wb) {
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: 0 });

    // Result structure per key:
    // { cash_single_count, cash_return_count, barcode_return_count,
    //   digital_single_count, digital_return_count, etc_count,
    //   cash_single_rev, cash_return_rev, digital_single_rev, etc_rev }
    const result = {};

    // Find the header row — look for "Vehicle Name" cell
    let headerRow = -1;
    let subHeaderRow = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const row = rows[i];
      const rowStr = row.map(c => String(c).trim().toUpperCase()).join('|');
      if (rowStr.includes('VEHICLE NAME')) { headerRow = i; break; }
    }

    // If no explicit header, try to detect by column pattern
    if (headerRow === -1) {
      // Fall back: look for row with NORTH-SOUTH pattern
      for (let i = 0; i < Math.min(rows.length, 25); i++) {
        const rowStr = rows[i].map(c => String(c).trim().toUpperCase()).join('|');
        if (rowStr.includes('NORTH') && rowStr.includes('SOUTH')) {
          subHeaderRow = i;
          headerRow    = Math.max(0, i - 1);
          break;
        }
      }
    }

    // Parse column structure from header rows
    // CR Format: VehicleName | Single(Cash) NS|SN|Total | Single(Digital) NS|SN|Total |
    //            Return(Cash) NS|SN|Total | Return(Digital) NS|SN|Total | FASTAG NS|SN|Total | Total

    // We'll identify columns by reading the top 2 header rows
    const colGroups = detectCRColumns(rows, headerRow, subHeaderRow);

    // Now read data rows
    for (let i = (subHeaderRow > 0 ? subHeaderRow : headerRow) + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.length) continue;

      const vehicleName = String(row[0] || '').trim().toUpperCase();
      if (!vehicleName || vehicleName === 'TOTAL' || vehicleName === '') continue;

      const key = CR_VEHICLE_MAP[vehicleName];
      if (!key) continue; // skip unknown vehicles

      if (!result[key]) result[key] = emptyVehicle();

      // Each vehicle has 2 sub-rows: row[i]=counts, row[i+1]=revenue
      // Detect: if row has mostly small numbers (counts) it's count row
      // The next row has larger numbers (revenue = count × tariff)
      const countRow = row;
      const revRow   = (rows[i + 1] && rows[i + 1][0] === 0 || rows[i + 1] && !String(rows[i + 1][0]).trim())
                       ? rows[i + 1] : null;

      // Extract counts using detected column positions
      if (colGroups.cashSingleTotal   >= 0) result[key].cash_single_count   += n(countRow[colGroups.cashSingleTotal]);
      if (colGroups.cashReturnTotal   >= 0) result[key].cash_return_count   += n(countRow[colGroups.cashReturnTotal]);
      if (colGroups.barcodeReturnTotal >= 0) result[key].barcode_count       += n(countRow[colGroups.barcodeReturnTotal]);
      if (colGroups.digitalSingleTotal >= 0) result[key].digital_single_count += n(countRow[colGroups.digitalSingleTotal]);
      if (colGroups.digitalReturnTotal >= 0) result[key].digital_return_count += n(countRow[colGroups.digitalReturnTotal]);
      if (colGroups.fastagTotal       >= 0) result[key].etc_count            += n(countRow[colGroups.fastagTotal]);

      if (revRow) {
        if (colGroups.cashSingleTotal   >= 0) result[key].cash_single_rev    += n(revRow[colGroups.cashSingleTotal]);
        if (colGroups.cashReturnTotal   >= 0) result[key].cash_return_rev    += n(revRow[colGroups.cashReturnTotal]);
        if (colGroups.digitalSingleTotal >= 0) result[key].digital_single_rev += n(revRow[colGroups.digitalSingleTotal]);
        if (colGroups.fastagTotal       >= 0) result[key].etc_rev            += n(revRow[colGroups.fastagTotal]);
        i++; // skip revenue row
      }
    }

    return result;
  }

  function detectCRColumns(rows, headerRow, subHeaderRow) {
    const cols = {
      cashSingleTotal: -1, cashReturnTotal: -1,
      barcodeReturnTotal: -1,
      digitalSingleTotal: -1, digitalReturnTotal: -1,
      fastagTotal: -1
    };

    // Scan rows 0..subHeaderRow+1 to find column positions
    const allHeaderText = [];
    for (let i = 0; i <= Math.min((subHeaderRow > 0 ? subHeaderRow : headerRow) + 2, rows.length - 1); i++) {
      allHeaderText.push(rows[i].map(c => String(c || '').trim().toUpperCase()));
    }

    // Strategy: scan all header cells for keyword matches, note column index
    // We need to find: SINGLE JOURNEY (CASH) → TOTAL, RETURN JOURNEY (CASH) → TOTAL,
    // SINGLE JOURNEY (DIGITAL) → TOTAL, RETURN JOURNEY (DIGITAL) → TOTAL,
    // FASTAG → TOTAL, RETURN BARCODE / BARCODE RETURN → TOTAL
    let lastGroup = '';
    const groupColStart = {};

    for (let r = 0; r < allHeaderText.length; r++) {
      const row = allHeaderText[r];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (!cell) continue;

        if (cell.includes('SINGLE') && cell.includes('CASH'))    { lastGroup = 'cashSingle';    groupColStart['cashSingle'] = c; }
        if (cell.includes('RETURN') && cell.includes('CASH'))    { lastGroup = 'cashReturn';    groupColStart['cashReturn'] = c; }
        if (cell.includes('BARCODE'))                             { lastGroup = 'barcode';       groupColStart['barcode'] = c; }
        if (cell.includes('SINGLE') && cell.includes('DIGITAL')) { lastGroup = 'digitalSingle'; groupColStart['digitalSingle'] = c; }
        if (cell.includes('DIGITAL') && !cell.includes('SINGLE') && !cell.includes('RETURN')) { lastGroup = 'digitalSingle'; groupColStart['digitalSingle'] = c; }
        if (cell.includes('RETURN') && cell.includes('DIGITAL')) { lastGroup = 'digitalReturn'; groupColStart['digitalReturn'] = c; }
        if (cell.includes('FASTAG') || cell.includes('ETC') || cell.includes('FASTAG JOURNEY')) { lastGroup = 'fastag'; groupColStart['fastag'] = c; }

        // "Total" sub-column inside a group
        if (cell === 'TOTAL' && lastGroup) {
          if (lastGroup === 'cashSingle')    cols.cashSingleTotal    = c;
          if (lastGroup === 'cashReturn')    cols.cashReturnTotal    = c;
          if (lastGroup === 'barcode')       cols.barcodeReturnTotal = c;
          if (lastGroup === 'digitalSingle') cols.digitalSingleTotal = c;
          if (lastGroup === 'digitalReturn') cols.digitalReturnTotal = c;
          if (lastGroup === 'fastag')        cols.fastagTotal        = c;
        }
      }
    }

    // Fallback: if we still haven't found columns, use positional heuristic
    // Typical CR format: col0=VehicleName, then groups of 3 (NS, SN, Total) × 5 journey types + Total
    if (cols.cashSingleTotal === -1) {
      // Try to find "Total" columns by scanning sub-header row
      let totalCount = 0;
      const scanRow = allHeaderText[allHeaderText.length - 1] || [];
      const totalCols = [];
      for (let c = 1; c < scanRow.length; c++) {
        if (scanRow[c] === 'TOTAL') totalCols.push(c);
      }
      // Expected order: CashSingle, [Barcode?], CashReturn, DigitalSingle, DigitalReturn, FASTAG
      if (totalCols.length >= 5) {
        cols.cashSingleTotal    = totalCols[0];
        cols.cashReturnTotal    = totalCols[1];
        cols.digitalSingleTotal = totalCols[2];
        cols.digitalReturnTotal = totalCols[3];
        cols.fastagTotal        = totalCols[4];
      } else if (totalCols.length >= 3) {
        cols.cashSingleTotal    = totalCols[0];
        cols.cashReturnTotal    = totalCols[1];
        cols.fastagTotal        = totalCols[totalCols.length - 1];
        cols.digitalSingleTotal = totalCols[2];
      }
    }

    return cols;
  }

  function emptyVehicle() {
    return {
      cash_single_count: 0, cash_return_count: 0, barcode_count: 0,
      digital_single_count: 0, digital_return_count: 0, etc_count: 0,
      cash_single_rev: 0, cash_return_rev: 0, digital_single_rev: 0, etc_rev: 0,
    };
  }

  /* ═══════════════════════════════════════════
     PARSE VIOLATION MATRIX REPORT
  ═══════════════════════════════════════════ */
  function parseVM(wb) {
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: 0 });

    // Find header row (row with "Actual Class after Validate" or similar)
    let headerRow = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const rowStr = rows[i].map(c => String(c).trim().toUpperCase()).join('|');
      if (rowStr.includes('ACTUAL CLASS') || rowStr.includes('CLASS AS PER SYSTEM')) {
        headerRow = i;
        break;
      }
    }
    if (headerRow === -1) headerRow = 0;

    // Column headers = vehicle classes from system report
    const colHeader = rows[headerRow].map(c => String(c || '').trim().toUpperCase());

    // Map column index to vehicle key
    const colKeyMap = {};
    colHeader.forEach((h, idx) => {
      const k = VM_ROW_MAP[h];
      if (k) colKeyMap[idx] = k;
    });

    // Parse data rows — each row is "Actual Class after Validate"
    const result = {
      // per vehicleKey: { violation: n, exemption: n }
      // Non-tollable: { ambulance, auto, bike, tractor, jcb, govt, police, forcefully, total }
      byClass: {},
      nonTollable: {
        ambulance: 0, auto: 0, bike: 0, tractor: 0,
        jcb: 0, govt: 0, police: 0, forcefully: 0
      },
      // Total per class column (for violation count = total - diagonal)
      columnTotal: {},
      diagonal: {},
      passCount: 0,
    };

    // Find sub-header row with actual counts — look for yellow row (count row)
    // Usually right after headerRow is the "Class as per System Report" count row
    let countHeaderRow = -1;
    for (let i = headerRow; i < Math.min(rows.length, headerRow + 5); i++) {
      const first = String(rows[i][0] || '').trim().toUpperCase();
      if (first === 'ACTUAL CLASS AFTER VALIDATE' || first === '') countHeaderRow = i;
    }

    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.length) continue;
      const actualClass = String(row[0] || '').trim().toUpperCase();
      if (!actualClass || actualClass === '' || actualClass === 'TOTAL') {
        if (actualClass === 'TOTAL') {
          // Store column totals
          row.forEach((val, idx) => { if (colKeyMap[idx]) result.columnTotal[colKeyMap[idx]] = (result.columnTotal[colKeyMap[idx]] || 0) + n(val); });
        }
        continue;
      }

      const rowKey = VM_ROW_MAP[actualClass];

      // Check if it's diagonal (correctly classified)
      if (rowKey) {
        // Sum across all columns for this row → exemption count if it's a non-tollable class
        let rowTotal = 0;
        row.forEach((val, idx) => { if (idx > 0) rowTotal += n(val); });

        // Find diagonal value (same class column)
        let diagVal = 0;
        Object.entries(colKeyMap).forEach(([colIdx, colKey]) => {
          if (colKey === rowKey) diagVal += n(row[colIdx]);
        });
        result.diagonal[rowKey] = (result.diagonal[rowKey] || 0) + diagVal;
      }

      // Non-tollable rows
      if (actualClass === 'AUTO') {
        let tot = 0; row.forEach((v, i2) => { if (i2 > 0) tot += n(v); }); result.nonTollable.auto += tot;
      } else if (actualClass === 'BIKE') {
        let tot = 0; row.forEach((v, i2) => { if (i2 > 0) tot += n(v); }); result.nonTollable.bike += tot;
      } else if (actualClass === 'TRACTOR') {
        let tot = 0; row.forEach((v, i2) => { if (i2 > 0) tot += n(v); }); result.nonTollable.tractor += tot;
      } else if (actualClass === 'AMBULANCE') {
        let tot = 0; row.forEach((v, i2) => { if (i2 > 0) tot += n(v); }); result.nonTollable.ambulance += tot;
      } else if (actualClass === 'JCB') {
        let tot = 0; row.forEach((v, i2) => { if (i2 > 0) tot += n(v); }); result.nonTollable.jcb += tot;
      } else if (actualClass === 'GOVT. VEHICLE' || actualClass === 'GOVT VEHICLE' || actualClass === 'GOVT') {
        let tot = 0; row.forEach((v, i2) => { if (i2 > 0) tot += n(v); }); result.nonTollable.govt += tot;
      } else if (actualClass === 'POLICE') {
        let tot = 0; row.forEach((v, i2) => { if (i2 > 0) tot += n(v); }); result.nonTollable.police += tot;
      } else if (actualClass === 'FORCEFULLY') {
        let tot = 0; row.forEach((v, i2) => { if (i2 > 0) tot += n(v); }); result.nonTollable.forcefully += tot;
      } else if (actualClass.includes('PASS MONTHLY') || actualClass.includes('PASS')) {
        let tot = 0; row.forEach((v, i2) => { if (i2 > 0) tot += n(v); }); result.passCount += tot;
      }

      // Column totals accumulated
      row.forEach((val, idx) => {
        if (colKeyMap[idx] && idx > 0) {
          result.columnTotal[colKeyMap[idx]] = (result.columnTotal[colKeyMap[idx]] || 0) + n(val);
        }
      });
    }

    return result;
  }

  /* ═══════════════════════════════════════════
     MAIN AGENT RUN
  ═══════════════════════════════════════════ */
  function runAgent() {
    readTariffsFromUI();

    const log = document.getElementById('agentLog');
    const bar = document.getElementById('agentProgressBar');
    const prog = document.getElementById('agentProgress');

    log.innerHTML = '';
    prog.style.display = 'block';
    setProgress(bar, 5);
    addLog(log, '▶ Agent starting…', 'ok');

    setTimeout(() => {
      try {
        addLog(log, '📊 Processing Consolidate Revenue Report…');
        setProgress(bar, 30);

        addLog(log, '🔍 Processing Violation Matrix…');
        setProgress(bar, 60);

        const data = buildAuditData();
        resultData = data;

        setProgress(bar, 85);
        addLog(log, '📋 Building preview tables…');
        renderPreview(data);

        setProgress(bar, 100);
        addLog(log, '✅ Done! Preview ready below.', 'ok');

        show('agentPreviewSection');
        document.getElementById('agentRunBtn').disabled = true;
        setFooterNote('Report generated successfully. Download or reset to start over.');

      } catch (err) {
        addLog(log, '✗ Error: ' + err.message, 'err');
        console.error('Agent run error:', err);
      }
    }, 200);
  }

  /* ═══════════════════════════════════════════
     BUILD AUDIT DATA
  ═══════════════════════════════════════════ */
  function buildAuditData() {
    const KEYS = ['car', 'lcv', 'bus', 'truck', 'mav', 'osv'];
    const LABELS = {
      car: 'Car', lcv: 'LCV/Mini Bus', bus: 'Bus',
      truck: 'Truck', mav: 'MAV 3-6 Axl', osv: 'OSV'
    };

    const anomalies = [];
    const rows = [];

    KEYS.forEach(key => {
      const cr = crData[key] || emptyVehicle();
      const tf = getTariff(key);
      const diagCount = vmData.diagonal[key] || 0;
      const colTotal  = vmData.columnTotal[key] || 0;

      // ── Paid Traffic columns ──
      const cash     = cr.cash_single_count;
      const ret      = cr.cash_return_count + cr.digital_return_count;  // Cash Return + Digital Return
      const barcode  = cr.barcode_count;
      const digital  = cr.digital_single_count;
      const etc      = cr.etc_count;
      const pass     = key === 'car' ? vmData.passCount : 0; // Pass attributed to CAR by default (adjust if needed)
      const paidTotal = cash + ret + barcode + digital + etc + pass;

      // ── Violation ──
      // Violation = total column vehicles - diagonal (correctly classified)
      const violation = Math.max(0, colTotal - diagCount);
      const revLossViol = violation * tf.single;

      // Anomaly: check if revenue matches expected
      const expectedCashRev = cash * tf.single;
      const expectedEtcRev  = etc * tf.single;
      if (cr.cash_single_rev > 0 && Math.abs(cr.cash_single_rev - expectedCashRev) > 100) {
        anomalies.push(`${LABELS[key]}: Cash revenue mismatch — Expected ₹${expectedCashRev} but report shows ₹${cr.cash_single_rev}`);
      }

      // ── Exemption ──
      // Exemption count for tollable vehicles = non-tollable that were actually this class
      // (this is captured in the matrix mismatch — simplified: 0 for tollable classes)
      const exemption = 0; // Tollable vehicles don't have standard exemptions
      const revLossExem = exemption * tf.single;

      // ── Totals ──
      const totalUnpaid = violation + exemption;
      const totalLoss   = revLossViol + revLossExem;
      const totalTraffic = paidTotal + totalUnpaid;
      const lossPercent  = totalTraffic > 0 ? Math.round((totalLoss / (totalTraffic * tf.single)) * 100) : 0;

      // Revenue verification
      const totalRevenue = (cash * tf.single) + (ret * tf.ret) + (barcode * tf.ret) +
                           (digital * tf.single) + (etc * tf.single) + (pass * tf.ret);

      rows.push({
        key, label: LABELS[key],
        single: tf.single, ret: tf.ret,
        cash, ret: ret, barcode, digital, etc, pass, paidTotal,
        violation, revLossViol, exemption, revLossExem,
        totalUnpaid, totalLoss, totalTraffic,
        lossPercent, totalRevenue,
      });
    });

    // Non-Tollable row
    const nt = vmData.nonTollable;
    const ntTotal = nt.ambulance + nt.auto + nt.bike + nt.tractor + nt.jcb + nt.govt + nt.police + nt.forcefully;
    rows.push({
      key: 'nt', label: 'Non-Tollable',
      single: 0, ret: 0,
      cash: 0, ret: 0, barcode: 0, digital: 0, etc: 0, pass: 0, paidTotal: 0,
      violation: 0, revLossViol: 0,
      exemption: ntTotal, revLossExem: 0,
      totalUnpaid: ntTotal, totalLoss: 0,
      totalTraffic: ntTotal, lossPercent: 0, totalRevenue: 0,
    });

    // Total Collection Classwise (from CR revenue)
    const tcRows = [];
    const KEYS_TC = ['car', 'lcv', 'bus', 'truck', 'mav'];
    const TC_LABELS = { car: 'Car', lcv: 'LCV/Mini Bus', bus: 'T/B 2 Axl', truck: 'Truck', mav: 'MAV 3-6 Axl' };
    KEYS_TC.forEach(key => {
      const cr = crData[key] || emptyVehicle();
      const tf = getTariff(key);
      tcRows.push({
        label: TC_LABELS[key],
        cash: cr.cash_single_rev,
        ret:  cr.cash_return_rev,
        digital: cr.digital_single_rev,
        etc:  cr.etc_rev,
        total: cr.cash_single_rev + cr.cash_return_rev + cr.digital_single_rev + cr.etc_rev,
      });
    });

    return { rows, nonTollable: vmData.nonTollable, tcRows, anomalies };
  }

  /* ═══════════════════════════════════════════
     RENDER PREVIEW
  ═══════════════════════════════════════════ */
  function renderPreview(data) {
    renderMainTable(data.rows);
    renderNTTable(data.nonTollable);
    renderTCTable(data.tcRows);
    renderSummary(data.rows);
    renderAnomalies(data.anomalies);
  }

  function renderMainTable(rows) {
    const tbody = document.getElementById('agentMainTbody');
    const tfoot = document.getElementById('agentMainTfoot');
    let totals = { cash:0,ret:0,barcode:0,digital:0,etc:0,pass:0,paidTotal:0,
                   violation:0,revLossViol:0,exemption:0,revLossExem:0,
                   totalUnpaid:0,totalLoss:0,totalTraffic:0 };

    tbody.innerHTML = rows.map(r => {
      if (r.key !== 'nt') {
        totals.cash += r.cash; totals.ret += r.ret; totals.barcode += r.barcode;
        totals.digital += r.digital; totals.etc += r.etc; totals.pass += r.pass;
        totals.paidTotal += r.paidTotal; totals.violation += r.violation;
        totals.revLossViol += r.revLossViol; totals.exemption += r.exemption;
        totals.revLossExem += r.revLossExem; totals.totalUnpaid += r.totalUnpaid;
        totals.totalLoss += r.totalLoss; totals.totalTraffic += r.totalTraffic;
      } else {
        totals.exemption += r.exemption; totals.totalUnpaid += r.totalUnpaid;
        totals.totalTraffic += r.totalTraffic;
      }
      const lp = r.key === 'nt' ? '-' : (r.lossPercent + '%');
      return `<tr>
        <td class="cls-name">${r.label}</td>
        <td>${r.single}</td><td>${r.ret}</td>
        <td>${r.cash}</td><td>${r.ret}</td><td>${r.barcode}</td>
        <td>${r.digital}</td><td>${r.etc}</td><td>${r.pass}</td><td><strong>${r.paidTotal}</strong></td>
        <td>${r.violation}</td><td>${fmt(r.revLossViol)}</td>
        <td>${r.exemption}</td><td>${fmt(r.revLossExem)}</td>
        <td style="background:#fef08a;font-weight:800;">${fmt(r.totalLoss)}</td>
        <td><strong>${r.totalTraffic}</strong></td>
        <td style="font-weight:800;color:${r.lossPercent>30?'#dc2626':'#16a34a'}">${lp}</td>
      </tr>`;
    }).join('');

    const totLossPercent = totals.totalTraffic > 0
      ? Math.round((totals.totalLoss / (totals.totalTraffic * 100)) * 100) + '%' : '-';

    tfoot.innerHTML = `<tr>
      <td class="cls-name">Total</td>
      <td></td><td></td>
      <td>${totals.cash}</td><td>${totals.ret}</td><td>${totals.barcode}</td>
      <td>${totals.digital}</td><td>${totals.etc}</td><td>${totals.pass}</td>
      <td>${totals.paidTotal}</td>
      <td>${totals.violation}</td><td>${fmt(totals.revLossViol)}</td>
      <td>${totals.exemption}</td><td>${fmt(totals.revLossExem)}</td>
      <td>${fmt(totals.totalLoss)}</td>
      <td>${totals.totalTraffic}</td><td>-</td>
    </tr>`;
  }

  function renderNTTable(nt) {
    const tbody = document.getElementById('agentNTTbody');
    const tfoot = document.getElementById('agentNTTfoot');
    const items = [
      ['Ambulance', nt.ambulance, nt.ambulance, nt.ambulance * 2],
      ['Auto',      nt.auto,      nt.auto,      nt.auto * 2],
      ['Bike',      0,            nt.bike,      nt.bike],
      ['Tractor',   nt.tractor,   nt.tractor,   nt.tractor * 2],
      ['JCB',       nt.jcb,       nt.jcb,       nt.jcb * 2],
      ['Govt',      nt.govt,      nt.govt,       nt.govt * 2],
      ['Police',    nt.police,    nt.police,     nt.police * 2],
      ['Forcefully',nt.forcefully,0,             nt.forcefully],
    ];
    let tv = 0, te = 0, tt = 0;
    tbody.innerHTML = items.map(([label, viol, exem, tot]) => {
      tv += viol; te += exem; tt += tot;
      return `<tr><td class="cls-name">${label}</td><td>${viol}</td><td>${exem}</td><td><strong>${tot}</strong></td></tr>`;
    }).join('');
    tfoot.innerHTML = `<tr><td class="cls-name">Total</td><td>${tv}</td><td>${te}</td><td>${tt}</td></tr>`;
  }

  function renderTCTable(tcRows) {
    const tbody = document.getElementById('agentTCTbody');
    const tfoot = document.getElementById('agentTCTfoot');
    let tc=0,tr2=0,td2=0,te=0,tt=0;
    tbody.innerHTML = tcRows.map(r => {
      tc+=r.cash; tr2+=r.ret; td2+=r.digital; te+=r.etc; tt+=r.total;
      return `<tr>
        <td class="cls-name">${r.label}</td>
        <td>${fmt(r.cash)}</td><td>${fmt(r.ret)}</td>
        <td>${fmt(r.digital)}</td><td>${fmt(r.etc)}</td>
        <td><strong>${fmt(r.total)}</strong></td>
      </tr>`;
    }).join('');
    tfoot.innerHTML = `<tr><td class="cls-name">Total</td>
      <td>${fmt(tc)}</td><td>${fmt(tr2)}</td><td>${fmt(td2)}</td><td>${fmt(te)}</td>
      <td>${fmt(tt)}</td></tr>`;
  }

  function renderSummary(rows) {
    const bar = document.getElementById('agentSummaryBar');
    const totalTraffic = rows.reduce((s,r) => s + r.totalTraffic, 0);
    const totalPaid    = rows.reduce((s,r) => s + r.paidTotal, 0);
    const totalLoss    = rows.reduce((s,r) => s + r.totalLoss, 0);
    const totalViol    = rows.reduce((s,r) => s + r.violation, 0);
    const lossP        = totalTraffic > 0 ? Math.round((totalViol / totalTraffic) * 100) : 0;

    bar.innerHTML = `
      <span class="agent-chip"><i class="bi bi-car-front-fill"></i> Total Traffic: ${totalTraffic}</span>
      <span class="agent-chip"><i class="bi bi-cash"></i> Paid: ${totalPaid}</span>
      <span class="agent-chip ${lossP > 30 ? 'red' : 'warn'}"><i class="bi bi-exclamation-triangle-fill"></i> Violations: ${totalViol}</span>
      <span class="agent-chip ${lossP > 30 ? 'red' : 'warn'}"><i class="bi bi-graph-down-arrow"></i> Revenue Loss: ₹${fmt(totalLoss)}</span>
    `;
  }

  function renderAnomalies(anomalies) {
    const box  = document.getElementById('agentAnomalyBox');
    const list = document.getElementById('agentAnomalyList');
    if (!anomalies || anomalies.length === 0) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    list.innerHTML = anomalies.map(a => `<li>${a}</li>`).join('');
  }

  /* ═══════════════════════════════════════════
     DOWNLOAD EXCEL TEMPLATE
  ═══════════════════════════════════════════ */
  function downloadTemplate() {
    if (!resultData) return;
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Main Audit Table ──
    const mainHeaders = [
      ['Class','Tariff','','Paid Traffic','','','','','','','Exempted & Violation','','','','','Total Traffic','Loss in %'],
      ['','Single','Return','Cash','Return','Barcode','Digital','ETC','Pass','Total Traffic',
       'Violation','Revenue Loss','Exemption','Revenue Loss','Total Loss','',''],
    ];

    const mainRows = resultData.rows.map(r => [
      r.label, r.single, r.ret,
      r.cash, r.ret, r.barcode, r.digital, r.etc, r.pass, r.paidTotal,
      r.violation, r.revLossViol, r.exemption, r.revLossExem, r.totalLoss,
      r.totalTraffic, r.key === 'nt' ? '-' : (r.lossPercent + '%'),
    ]);

    const mainData = [...mainHeaders, ...mainRows];
    const ws1 = XLSX.utils.aoa_to_sheet(mainData);
    ws1['!cols'] = [{ wch: 15 },...Array(16).fill({ wch: 10 })];
    XLSX.utils.book_append_sheet(wb, ws1, 'Audit Template');

    // ── Sheet 2: Non-Tollable ──
    const ntData = [
      ['Non-Tollable Exemption & Violation'],
      ['Category','Violation','Exemption','Total'],
      ['Ambulance', resultData.nonTollable.ambulance, resultData.nonTollable.ambulance, resultData.nonTollable.ambulance],
      ['Auto',      resultData.nonTollable.auto,      resultData.nonTollable.auto,      resultData.nonTollable.auto],
      ['Bike',      0,                                resultData.nonTollable.bike,      resultData.nonTollable.bike],
      ['Tractor',   resultData.nonTollable.tractor,   resultData.nonTollable.tractor,   resultData.nonTollable.tractor],
      ['JCB',       resultData.nonTollable.jcb,       resultData.nonTollable.jcb,       resultData.nonTollable.jcb],
      ['Govt',      resultData.nonTollable.govt,      resultData.nonTollable.govt,       resultData.nonTollable.govt],
      ['Police',    resultData.nonTollable.police,    resultData.nonTollable.police,     resultData.nonTollable.police],
      ['Forcefully',resultData.nonTollable.forcefully,0,                                resultData.nonTollable.forcefully],
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(ntData);
    XLSX.utils.book_append_sheet(wb, ws2, 'Non-Tollable');

    // ── Sheet 3: Total Collection ──
    const tcHead = [['Total Collection Classwise'],['Class','Cash','Return','Digital','ETC','Total Traffic']];
    const tcRows2 = resultData.tcRows.map(r => [r.label, r.cash, r.ret, r.digital, r.etc, r.total]);
    const ws3 = XLSX.utils.aoa_to_sheet([...tcHead, ...tcRows2]);
    XLSX.utils.book_append_sheet(wb, ws3, 'Total Collection');

    // Download
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Audit_Template_${today}.xlsx`);
    addLog(document.getElementById('agentLog'), `📥 Downloaded: Audit_Template_${today}.xlsx`, 'ok');
  }

  /* ═══════════════════════════════════════════
     RESET
  ═══════════════════════════════════════════ */
  function resetAgent() {
    crData = null; vmData = null; resultData = null;
    tariffs = DEFAULT_TARIFFS.map(t => ({ ...t }));

    ['agentCRCard','agentVMCard'].forEach(id => document.getElementById(id).classList.remove('ready'));
    ['agentCRFileName','agentVMFileName'].forEach(id => { document.getElementById(id).textContent = 'No file chosen'; });
    ['agentCRStatus','agentVMStatus'].forEach(id => { document.getElementById(id).textContent = ''; document.getElementById(id).className = 'agent-file-status'; });
    ['agentCRInput','agentVMInput'].forEach(id => { document.getElementById(id).value = ''; });
    ['agentTariffSection','agentProcessSection','agentPreviewSection'].forEach(id => hide(id));
    document.getElementById('agentLog').innerHTML = '';
    document.getElementById('agentProgress').style.display = 'none';
    document.getElementById('agentProgressBar').style.width = '0%';
    document.getElementById('agentRunBtn').disabled = false;
    document.getElementById('agentAnomalyBox').style.display = 'none';
    document.getElementById('agentSummaryBar').innerHTML = '';
    renderTariffGrid();
    setFooterNote('');
  }

  /* ═══════════════════════════════════════════
     HELPERS
  ═══════════════════════════════════════════ */
  function n(v)    { const x = parseFloat(v); return isNaN(x) ? 0 : x; }
  function fmt(v)  { return Number(v).toLocaleString('en-IN'); }
  function show(id){ const el = document.getElementById(id); if (el) el.style.display = ''; }
  function hide(id){ const el = document.getElementById(id); if (el) el.style.display = 'none'; }
  function setProgress(bar, pct) { if (bar) bar.style.width = pct + '%'; }
  function setFooterNote(txt)    { const el = document.getElementById('agentFooterNote'); if (el) el.textContent = txt; }
  function addLog(el, msg, cls) {
    if (!el) return;
    const span = document.createElement('div');
    span.className = cls ? 'log-' + cls : '';
    span.textContent = msg;
    el.appendChild(span);
  }

})();
