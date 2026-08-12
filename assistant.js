/* ══════════════════════════════════════════════════════════════
   Toll Audit — Smart Assistant  (Tier 1: LLM-Powered)
   assistant.js

   Architecture
   ─────────────
   • Rule-based LOCAL tools: remember/forget/pass/status — instant.
   • Two AI providers supported: OpenAI (paid) or Gemini (FREE).
   • Provider selected in ⚙️ settings — each stores its own key.
   • System prompt: live audit context + pass list + memories.
   • Function Calling: model calls searchPass, getAuditStatus,
     saveMemory, deleteMemory, getMemories, clearChat as needed.
   • No key? Silent local fallback — app always works.
   • Keys stored only in localStorage — never sent anywhere else.
══════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    /* ═══════════════════════════════════════════════
       SECTION 1 — PERSISTENT MEMORY
    ═══════════════════════════════════════════════ */
    const MEM_KEY  = 'tollAssistantMemory';
    const CHAT_KEY = 'tollAssistantChat';
    const AIKEY_KEY = 'tollAssistantAIKey';

    function loadMemory()      { try { return JSON.parse(localStorage.getItem(MEM_KEY))  || []; } catch (_) { return []; } }
    function saveMemory(arr)   { localStorage.setItem(MEM_KEY,  JSON.stringify(arr.slice(-200))); }
    function loadChatHistory() { try { return JSON.parse(localStorage.getItem(CHAT_KEY)) || []; } catch (_) { return []; } }
    function saveChatHistory(a){ localStorage.setItem(CHAT_KEY, JSON.stringify(a.slice(-120))); }

    let userMemories = loadMemory();
    let chatHistory  = loadChatHistory();

    function addMemory(text) {
        const id = Date.now();
        userMemories.push({ id, text: text.trim(), ts: new Date().toLocaleString('en-IN') });
        saveMemory(userMemories);
        return id;
    }
    function deleteMemory(id) {
        userMemories = userMemories.filter(m => m.id !== id);
        saveMemory(userMemories);
    }
    function memoriesToText() {
        if (!userMemories.length) return 'Koi saved memory nahi hai abhi.';
        return `🧠 Saved memories (${userMemories.length}):\n` +
            userMemories.map((m, i) => `${i + 1}. ${m.text}\n   📅 ${m.ts}`).join('\n\n');
    }

    /* ═══════════════════════════════════════════════
       SECTION 2 — AI KEY STORE + PROVIDER
       provider: 'openai' | 'gemini' | 'groq'
    ═══════════════════════════════════════════════ */
    const PROVIDER_KEY    = 'tollAssistantProvider';
    const GEMINI_KEY_KEY  = 'tollAssistantGeminiKey';
    const GROQ_KEY_KEY    = 'tollAssistantGroqKey';

    /* OpenAI */
    function getAIKey()      { return localStorage.getItem(AIKEY_KEY) || ''; }
    function setAIKey(k)     { localStorage.setItem(AIKEY_KEY, k.trim()); }
    function clearAIKey()    { localStorage.removeItem(AIKEY_KEY); }

    /* Gemini */
    function getGeminiKey()  { return localStorage.getItem(GEMINI_KEY_KEY) || ''; }
    function setGeminiKey(k) { localStorage.setItem(GEMINI_KEY_KEY, k.trim()); }
    function clearGeminiKey(){ localStorage.removeItem(GEMINI_KEY_KEY); }

    /* Groq */
    function getGroqKey()    { return localStorage.getItem(GROQ_KEY_KEY) || ''; }
    function setGroqKey(k)   { localStorage.setItem(GROQ_KEY_KEY, k.trim()); }
    function clearGroqKey()  { localStorage.removeItem(GROQ_KEY_KEY); }

    /* Active provider — default groq (user has the key already) */
    function getProvider()   { return localStorage.getItem(PROVIDER_KEY) || 'groq'; }
    function setProvider(p)  { localStorage.setItem(PROVIDER_KEY, p); }

    /* Generic "has any key" */
    function hasAIKey() {
        const p = getProvider();
        if (p === 'gemini') return !!getGeminiKey();
        if (p === 'groq')   return !!getGroqKey();
        return !!getAIKey();
    }

    /* ═══════════════════════════════════════════════
       SECTION 3 — PASS LIST INDEX
       Event-driven rebuild: listens for passListChanged
       custom DOM events dispatched from data.js patches.
       Also polls every 5s as a safety net.
    ═══════════════════════════════════════════════ */
    let _passIndex = [];

    function rebuildPassIndex() {
        _passIndex = [];
        if (typeof monthlyPassList !== 'undefined' && Array.isArray(monthlyPassList)) {
            _passIndex = monthlyPassList.map(r => ({ number: r.number, record: r }));
        }
    }

    /* Patch global replacePassList/clearPassList to fire a custom DOM event
       so the assistant index stays perfectly in sync without polling lag */
    function patchPassListFunctions() {
        if (typeof replacePassList === 'function' && !replacePassList._patched) {
            const orig = replacePassList;
            window.replacePassList = function(records) {
                const result = orig.call(this, records);
                rebuildPassIndex();
                updateStatusLine();
                document.dispatchEvent(new CustomEvent('passListChanged', {
                    detail: { count: _passIndex.length, action: 'replace' }
                }));
                return result;
            };
            window.replacePassList._patched = true;
        }
        if (typeof clearPassList === 'function' && !clearPassList._patched) {
            const orig = clearPassList;
            window.clearPassList = function() {
                const result = orig.call(this);
                rebuildPassIndex();
                updateStatusLine();
                document.dispatchEvent(new CustomEvent('passListChanged', {
                    detail: { count: 0, action: 'clear' }
                }));
                return result;
            };
            window.clearPassList._patched = true;
        }
    }

    function watchPassList() {
        rebuildPassIndex();
        /* Patch immediately and retry until functions are available */
        patchPassListFunctions();
        setTimeout(patchPassListFunctions, 1500);
        setTimeout(patchPassListFunctions, 4000);

        let lastCount = _passIndex.length;
        setInterval(() => {
            if (typeof monthlyPassList !== 'undefined') {
                const cur = monthlyPassList.length;
                if (cur !== lastCount) {
                    lastCount = cur;
                    rebuildPassIndex();
                    updateStatusLine();
                }
            }
            /* Re-patch if needed (e.g. if data.js loaded late) */
            patchPassListFunctions();
        }, 5000);
    }

    /* prefix-first fuzzy search, max 6 results */
    function searchPassLocal(query) {
        if (!query || query.length < 2) return [];
        const q = query.toUpperCase().replace(/[\s\-]+/g, '');
        const pre = [], mid = [];
        _passIndex.forEach(item => {
            const n = item.number.toUpperCase().replace(/[\s\-]+/g, '');
            if (n.startsWith(q)) pre.push(item);
            else if (n.includes(q)) mid.push(item);
        });
        return [...pre, ...mid].slice(0, 6);
    }

    function passRecordSummary(rec) {
        const expired = typeof isPassExpired === 'function' ? isPassExpired(rec.validTill) : null;
        const status  = expired === true ? '🔴 EXPIRED' : expired === false ? '🟢 ACTIVE' : '⚪ Unknown';
        const days    = typeof remainingDays === 'function' ? remainingDays(rec.validTill) : null;
        let txt = `🚗 ${rec.number}  ${status}`;
        if (rec.vehicleClass) txt += `\nClass: ${rec.vehicleClass}`;
        if (rec.validTill)    txt += `\nValid till: ${rec.validTill}`;
        if (days !== null)    txt += `\n${days < 0 ? Math.abs(days) + ' days ago (expired)' : days + ' days left'}`;
        if (rec.amount)       txt += `\nAmount: ₹${rec.amount}`;
        if (rec.mobileNo)     txt += `\nMobile: ${rec.mobileNo}`;
        return txt;
    }

    /* ═══════════════════════════════════════════════
       SECTION 4b — APP ACTION TRACKER
       Watches key app events and stores them so the
       assistant knows what happened recently.
    ═══════════════════════════════════════════════ */
    const APP_EVENTS_KEY = 'tollAssistantAppEvents';
    let _appEvents = [];

    function loadAppEvents() {
        try { _appEvents = JSON.parse(localStorage.getItem(APP_EVENTS_KEY)) || []; } catch (_) { _appEvents = []; }
    }
    function saveAppEvents() {
        localStorage.setItem(APP_EVENTS_KEY, JSON.stringify(_appEvents.slice(-50)));
    }
    function recordAppEvent(type, detail) {
        _appEvents.push({
            type, detail,
            ts: new Date().toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
        });
        saveAppEvents();
    }
    function recentAppEventsText() {
        if (!_appEvents.length) return 'No recent app events.';
        return _appEvents.slice(-10).map(e => `[${e.ts}] ${e.type}: ${e.detail}`).join('\n');
    }

    function setupAppActionTracker() {
        /* Track pass list changes via passListChanged event */
        document.addEventListener('passListChanged', e => {
            const { count, action } = e.detail || {};
            if (action === 'replace') recordAppEvent('PassList Updated', `${count} vehicles loaded`);
            else if (action === 'clear') recordAppEvent('PassList Cleared', 'All pass records removed');
        });
        /* Track audit date changes */
        const auditDateEl = document.getElementById('activeAuditDate');
        if (auditDateEl) {
            new MutationObserver(() => {
                const d = auditDateEl.textContent?.trim();
                if (d && d !== '—') recordAppEvent('Audit Date', d);
            }).observe(auditDateEl, { childList: true, characterData: true, subtree: true });
        }
        /* Track category changes */
        const catEl = document.getElementById('currentCategory');
        if (catEl) {
            new MutationObserver(() => {
                const c = catEl.textContent?.trim();
                if (c) recordAppEvent('Category', c);
            }).observe(catEl, { childList: true, characterData: true, subtree: true });
        }
        /* Track report count increases */
        const reportEl = document.getElementById('reportCount');
        let lastReport = 0;
        if (reportEl) {
            new MutationObserver(() => {
                const n = parseInt(reportEl.textContent) || 0;
                if (n > lastReport) {
                    recordAppEvent('Report Added', `Total: ${n}`);
                    lastReport = n;
                }
            }).observe(reportEl, { childList: true, characterData: true, subtree: true });
        }
    }

    /* ═══════════════════════════════════════════════
       SECTION 4 — APP CONTEXT SNAPSHOT
    ═══════════════════════════════════════════════ */
    function getAppContext() {
        const ctx = {};
        try {
            ctx.auditDate   = (document.getElementById('activeAuditDate') || {}).textContent?.trim() || '—';
            ctx.mode        = (document.querySelector('.mode-pill.active input') || {}).value || (document.querySelector('.mode-pill.active') || {}).textContent?.trim() || '—';
            ctx.category    = (document.getElementById('currentCategory') || {}).textContent?.trim() || '—';
            ctx.checked     = (document.getElementById('checkedCount') || {}).textContent?.trim() || '0';
            ctx.remaining   = (document.getElementById('remainingCount') || {}).textContent?.trim() || '0';
            ctx.reportCount = (document.getElementById('reportCount') || {}).textContent?.trim() || '0';
            ctx.totalTxn    = (document.getElementById('heroTotalTxn') || {}).textContent?.trim() || '0';
            ctx.passCount   = typeof getPassListCount === 'function' ? getPassListCount() : _passIndex.length;
            /* Recent transactions (last 5 vehicle types from history) */
            const txnEls = document.querySelectorAll('.th-feed .txn-item .txn-vehicle, .th-feed [data-vehicle]');
            ctx.recentTxns = txnEls.length
                ? Array.from(txnEls).slice(0, 5).map(el => el.textContent?.trim()).filter(Boolean).join(', ')
                : 'none';
        } catch (_) {}
        return ctx;
    }

    /* Rich pass-list summary for system prompt (top 10 by class) */
    function passListSummaryForPrompt() {
        if (!_passIndex.length) return 'Pass list: empty (not loaded yet).';
        const classCount = {};
        let expiredCount = 0;
        _passIndex.forEach(item => {
            const cls = item.record.vehicleClass || 'Unknown';
            classCount[cls] = (classCount[cls] || 0) + 1;
            if (typeof isPassExpired === 'function' && isPassExpired(item.record.validTill) === true) expiredCount++;
        });
        const breakdown = Object.entries(classCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([k, v]) => `${k}:${v}`)
            .join(', ');
        return `Pass list: ${_passIndex.length} vehicles (${expiredCount} expired). Breakdown — ${breakdown}.`;
    }

    /* ═══════════════════════════════════════════════
       SECTION 5 — OPENAI FUNCTION DEFINITIONS
       These are sent to GPT so it can call our tools.
    ═══════════════════════════════════════════════ */
    const AI_TOOLS = [
        {
            type: 'function',
            function: {
                name: 'searchPass',
                description: 'Search the monthly vehicle pass list by vehicle number or partial number. Use when user asks about a specific vehicle or vehicle number.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Vehicle number or partial number to search, e.g. "DL9SBA3104" or "DL9SBA"' }
                    },
                    required: ['query']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'getAuditStatus',
                description: 'Get the current live audit status: checked count, remaining, report count, date, mode, category, total transactions.',
                parameters: { type: 'object', properties: {} }
            }
        },
        {
            type: 'function',
            function: {
                name: 'saveMemory',
                description: 'Save something to persistent memory so the user can recall it later. Use when user says "remember", "yaad rakh", "note", "save this".',
                parameters: {
                    type: 'object',
                    properties: {
                        text: { type: 'string', description: 'The text/note to remember.' }
                    },
                    required: ['text']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'getMemories',
                description: 'Retrieve all saved memories/notes for the user.',
                parameters: { type: 'object', properties: {} }
            }
        },
        {
            type: 'function',
            function: {
                name: 'deleteMemory',
                description: 'Delete a saved memory that contains the given keyword.',
                parameters: {
                    type: 'object',
                    properties: {
                        keyword: { type: 'string', description: 'Keyword to match against saved memories.' }
                    },
                    required: ['keyword']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'clearChat',
                description: 'Clear all chat history when user asks to clear or reset the conversation.',
                parameters: { type: 'object', properties: {} }
            }
        },
        {
            type: 'function',
            function: {
                name: 'getExpiredPasses',
                description: 'Get the full list of all expired vehicle passes from the pass list. Use when user asks for expired passes, "expire ho gayi", "expired list", "kaunse expire hain", "4 expire", etc.',
                parameters: { type: 'object', properties: {} }
            }
        },
        {
            type: 'function',
            function: {
                name: 'getActivePasses',
                description: 'Get the full list of all currently active (non-expired) vehicle passes. Use when user asks for active passes, valid passes, "active list", "valid kaunse hain".',
                parameters: { type: 'object', properties: {} }
            }
        },
        {
            type: 'function',
            function: {
                name: 'getPassesByClass',
                description: 'Get all passes filtered by vehicle class, e.g. "Car", "LCV", "Truck 2 Axle". Use when user asks about passes for a specific vehicle type.',
                parameters: {
                    type: 'object',
                    properties: {
                        vehicleClass: { type: 'string', description: 'Vehicle class name, e.g. "Car", "LCV", "Truck 2 Axle", "MAV", "Bus 2 Axle"' }
                    },
                    required: ['vehicleClass']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'getPassListSummary',
                description: 'Get a full summary of the pass list: total count, expired count, active count, and breakdown by vehicle class. Use for overview/summary questions.',
                parameters: { type: 'object', properties: {} }
            }
        }
    ];

    /* Execute a function call from GPT */
    function executeTool(name, args) {
        switch (name) {

            case 'searchPass': {
                const q = (args.query || '').trim();
                if (!q) return 'No query provided.';
                /* Exact match first */
                if (typeof getPassRecord === 'function') {
                    const exact = getPassRecord(q);
                    if (exact) return passRecordSummary(exact);
                }
                /* Fuzzy */
                const hits = searchPassLocal(q);
                if (!hits.length) return `No pass records found matching "${q}".`;
                if (hits.length === 1) return passRecordSummary(hits[0].record);
                return `Found ${hits.length} matches for "${q}":\n` +
                    hits.map(h => {
                        const exp = typeof isPassExpired === 'function' ? isPassExpired(h.record.validTill) : null;
                        const tag = exp === true ? '🔴 EXPIRED' : '🟢 ACTIVE';
                        return `• ${h.number} ${tag}${h.record.vehicleClass ? ' — ' + h.record.vehicleClass : ''}`;
                    }).join('\n') +
                    '\n\nAsk me for full details of any specific number.';
            }

            case 'getAuditStatus': {
                const c = getAppContext();
                return `📊 Audit Status:\n` +
                    `Date: ${c.auditDate}\n` +
                    `Mode: ${c.mode} | Category: ${c.category}\n` +
                    `Checked: ${c.checked} | Remaining: ${c.remaining}\n` +
                    `Report Count: ${c.reportCount} | Total Txns: ${c.totalTxn}\n` +
                    `Pass List: ${c.passCount} vehicles\n` +
                    `Recent: ${c.recentTxns}`;
            }

            case 'saveMemory': {
                const text = (args.text || '').trim();
                if (!text) return 'Nothing to save.';
                addMemory(text);
                return `✅ Saved to memory: "${text}"`;
            }

            case 'getMemories': {
                return memoriesToText();
            }

            case 'deleteMemory': {
                const kw = (args.keyword || '').trim().toLowerCase();
                const match = userMemories.find(m => m.text.toLowerCase().includes(kw));
                if (!match) return `No memory found containing "${kw}".`;
                deleteMemory(match.id);
                return `🗑️ Deleted memory: "${match.text}"`;
            }

            case 'clearChat': {
                chatHistory = [];
                saveChatHistory(chatHistory);
                setTimeout(() => renderMessages(), 50);
                return 'Chat cleared.';
            }

            case 'getExpiredPasses': {
                if (!_passIndex.length) return 'Pass list abhi load nahi hui hai.';
                const expired = _passIndex.filter(item =>
                    typeof isPassExpired === 'function' && isPassExpired(item.record.validTill) === true
                );
                if (!expired.length) return '✅ Koi bhi pass expire nahi hua hai! Sab active hain.';
                const lines = expired.map(item => {
                    const r = item.record;
                    const days = typeof remainingDays === 'function' ? remainingDays(r.validTill) : null;
                    let line = `🔴 ${r.number}`;
                    if (r.vehicleClass) line += `  |  ${r.vehicleClass}`;
                    if (r.validTill)    line += `  |  Expired: ${r.validTill}`;
                    if (days !== null)  line += `  |  ${Math.abs(days)} days ago`;
                    if (r.amount)       line += `  |  ₹${r.amount}`;
                    return line;
                });
                return `🔴 Expired Passes (${expired.length} total):\n\n${lines.join('\n')}`;
            }

            case 'getActivePasses': {
                if (!_passIndex.length) return 'Pass list abhi load nahi hui hai.';
                const active = _passIndex.filter(item =>
                    typeof isPassExpired === 'function' && isPassExpired(item.record.validTill) !== true
                );
                if (!active.length) return '⚠️ Koi bhi active pass nahi hai!';
                const lines = active.map(item => {
                    const r = item.record;
                    const days = typeof remainingDays === 'function' ? remainingDays(r.validTill) : null;
                    let line = `🟢 ${r.number}`;
                    if (r.vehicleClass) line += `  |  ${r.vehicleClass}`;
                    if (r.validTill)    line += `  |  Valid till: ${r.validTill}`;
                    if (days !== null)  line += `  |  ${days} days left`;
                    return line;
                });
                return `🟢 Active Passes (${active.length} total):\n\n${lines.join('\n')}`;
            }

            case 'getPassesByClass': {
                const cls = (args.vehicleClass || '').trim().toLowerCase();
                if (!cls) return 'Vehicle class batao, e.g. "Car", "LCV", "Truck 2 Axle".';
                if (!_passIndex.length) return 'Pass list abhi load nahi hui hai.';
                const matches = _passIndex.filter(item =>
                    (item.record.vehicleClass || '').toLowerCase().includes(cls)
                );
                if (!matches.length) return `"${args.vehicleClass}" class ke koi passes nahi mile.`;
                const lines = matches.map(item => {
                    const r = item.record;
                    const exp = typeof isPassExpired === 'function' ? isPassExpired(r.validTill) : null;
                    const tag = exp === true ? '🔴 EXPIRED' : '🟢 ACTIVE';
                    let line = `${tag} ${r.number}`;
                    if (r.validTill) line += `  |  ${r.validTill}`;
                    if (r.amount)    line += `  |  ₹${r.amount}`;
                    return line;
                });
                return `${args.vehicleClass} passes (${matches.length}):\n\n${lines.join('\n')}`;
            }

            case 'getPassListSummary': {
                if (!_passIndex.length) return 'Pass list abhi load nahi hui hai.';
                const classCount = {};
                let expiredCount = 0, activeCount = 0;
                _passIndex.forEach(item => {
                    const cls = item.record.vehicleClass || 'Unknown';
                    classCount[cls] = (classCount[cls] || 0) + 1;
                    if (typeof isPassExpired === 'function' && isPassExpired(item.record.validTill) === true) {
                        expiredCount++;
                    } else {
                        activeCount++;
                    }
                });
                const breakdown = Object.entries(classCount)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => `  • ${k}: ${v}`)
                    .join('\n');
                return `📋 Pass List Summary:\n\nTotal: ${_passIndex.length}\n🟢 Active: ${activeCount}\n🔴 Expired: ${expiredCount}\n\nBy Class:\n${breakdown}`;
            }

            default:
                return `Unknown tool: ${name}`;
        }
    }

    /* ═══════════════════════════════════════════════
       SECTION 6 — OPENAI API CALL
    ═══════════════════════════════════════════════ */

    /* Build the system prompt fresh every call */
    function buildSystemPrompt() {
        const c   = getAppContext();
        const mem = userMemories.length
            ? userMemories.map((m, i) => `${i + 1}. ${m.text} (saved: ${m.ts})`).join('\n')
            : 'None saved yet.';
        return `You are "Audit Assistant", an intelligent AI assistant built into the Toll Audit App used at Rodwal Toll Plaza, India.

LIVE APP CONTEXT (real-time):
- Audit Date: ${c.auditDate}
- Mode: ${c.mode}  |  Current Category: ${c.category}
- Checked: ${c.checked}  |  Remaining: ${c.remaining}
- Report Count: ${c.reportCount}  |  Total Transactions: ${c.totalTxn}
- ${passListSummaryForPrompt()}
- Recent Transactions: ${c.recentTxns}

USER'S SAVED MEMORIES:
${mem}

IMPORTANT RULES:
1. Always reply in the same language the user writes in — Hindi, English, or Hinglish mix.
2. For vehicle pass lookups, ALWAYS use the searchPass tool — never guess.
3. For any audit stats question, use getAuditStatus tool to get real-time data.
4. When user says "remember", "yaad rakh", "note this" — use saveMemory tool.
5. Be concise and practical. This is a field tool used by toll auditors.
6. Vehicle numbers follow Indian format: 2 letters + 2 digits + letters + digits (e.g. DL9SBA3104, HR26BR1234).
7. You know about: vehicle passes, toll audit, exemptions, violations, Has Pass category, Paid/Cash/ETC/Digital payment types, vehicle classes (Car, LCV, Truck 2 Axle, Truck 3 Axle, MAV, Auto, Tractor, Bus 2 Axle, etc.).
8. Never make up pass record data — always use the tool.
9. You can remember ANYTHING the user asks — toll-related or general. Be a helpful personal assistant too.

RECENT APP EVENTS:
${recentAppEventsText()}`;
    }

    async function callOpenAI(userText) {
        const key = getAIKey();
        if (!key) throw new Error('NO_KEY');

        /* Build message history for context (last 14 messages = 7 turns) */
        const historyMsgs = chatHistory.slice(-14).map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.text
        }));

        const messages = [
            { role: 'system', content: buildSystemPrompt() },
            ...historyMsgs,
            { role: 'user', content: userText }
        ];

        let response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages,
                tools: AI_TOOLS,
                tool_choice: 'auto',
                max_tokens: 600,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${response.status}`);
        }

        let data = await response.json();
        let choice = data.choices[0];

        /* ── Handle tool calls (possibly chained) ── */
        while (choice.finish_reason === 'tool_calls' || choice.message?.tool_calls?.length) {
            const toolCalls = choice.message.tool_calls;
            const toolResults = toolCalls.map(tc => {
                const args = JSON.parse(tc.function.arguments || '{}');
                const result = executeTool(tc.function.name, args);
                return {
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: String(result)
                };
            });

            /* Send tool results back to GPT for final answer */
            messages.push(choice.message);               /* assistant message with tool_calls */
            messages.push(...toolResults);               /* tool result messages */

            response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages,
                    tools: AI_TOOLS,
                    tool_choice: 'auto',
                    max_tokens: 600,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error?.message || `HTTP ${response.status}`);
            }

            data   = await response.json();
            choice = data.choices[0];
            /* break if no more tool calls */
            if (!choice.message?.tool_calls?.length) break;
        }

        return (choice.message?.content || '').trim();
    }

    /* ═══════════════════════════════════════════════
       SECTION 6b — GEMINI API CALL (FREE TIER)
       Model: gemini-1.5-flash  — 1500 req/day free
    ═══════════════════════════════════════════════ */

    /* Gemini uses a different tool/function format */
    const GEMINI_TOOLS = [{
        functionDeclarations: AI_TOOLS.map(t => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters
        }))
    }];

    async function callGemini(userText) {
        const key = getGeminiKey();
        if (!key) throw new Error('NO_KEY');

        const systemPrompt = buildSystemPrompt();

        /* Gemini uses 'contents' array; system prompt goes as first user turn */
        const contents = [];

        /* Inject last 12 history messages */
        const hist = chatHistory.slice(-12);
        hist.forEach(m => {
            contents.push({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.text }]
            });
        });

        /* Current user message */
        contents.push({ role: 'user', parts: [{ text: userText }] });

        const body = {
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
            tools: GEMINI_TOOLS,
            generationConfig: { maxOutputTokens: 600, temperature: 0.7 }
        };

        const MODEL = 'gemini-1.5-flash';
        const url   = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

        let resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const e = await resp.json().catch(() => ({}));
            throw new Error(e.error?.message || `HTTP ${resp.status}`);
        }

        let data = await resp.json();

        /* Handle function calls — Gemini returns them in parts */
        let safety = 0;
        while (safety++ < 5) {
            const candidate = data.candidates?.[0];
            if (!candidate) break;

            const parts = candidate.content?.parts || [];
            const fnCalls = parts.filter(p => p.functionCall);

            if (!fnCalls.length) break;  /* No more tool calls — done */

            /* Execute each tool call */
            const fnResponses = fnCalls.map(p => {
                const result = executeTool(p.functionCall.name, p.functionCall.args || {});
                return {
                    functionResponse: {
                        name: p.functionCall.name,
                        response: { result: String(result) }
                    }
                };
            });

            /* Append model response + tool results to conversation */
            contents.push({ role: 'model', parts });
            contents.push({ role: 'user',  parts: fnResponses });

            /* Re-call Gemini with tool results */
            resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...body, contents })
            });

            if (!resp.ok) {
                const e = await resp.json().catch(() => ({}));
                throw new Error(e.error?.message || `HTTP ${resp.status}`);
            }
            data = await resp.json();
        }

        /* Extract final text */
        const textPart = data.candidates?.[0]?.content?.parts?.find(p => p.text);
        return (textPart?.text || '').trim();
    }

    /* ═══════════════════════════════════════════════
       SECTION 6c — GROQ API CALL (FREE)
       Model: llama-3.3-70b-versatile
       No function-calling — instead we pre-resolve
       any data queries and inject them into the
       system prompt so the model just answers text.
    ═══════════════════════════════════════════════ */
    async function callGroq(userText) {
        const key = getGroqKey();
        if (!key) throw new Error('NO_KEY');

        /* Pre-resolve data the model might need */
        const extraData = resolveGroqContext(userText);

        const systemPrompt = buildSystemPrompt()
            + (extraData ? `\n\nPRE-FETCHED DATA FOR THIS QUERY:\n${extraData}` : '');

        const historyMsgs = chatHistory.slice(-12).map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.text
        }));

        const messages = [
            { role: 'system', content: systemPrompt },
            ...historyMsgs,
            { role: 'user', content: userText }
        ];

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages,
                max_tokens: 700,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return (data.choices[0]?.message?.content || '').trim();
    }

    /* Pre-resolve data queries before sending to Groq.
       Extracts ALL vehicle numbers (bulk supported),
       status queries and memory queries upfront. */
    function resolveGroqContext(userText) {
        const parts = [];

        /* ALL vehicle numbers — matchAll for bulk support */
        const VEH_RE = /[A-Z]{2}[\s\-]?\d{1,2}[\s\-]?[A-Z]{0,3}[\s\-]?\d{1,4}/gi;
        const allMatches = [...userText.matchAll(VEH_RE)];
        const seen = new Set();

        if (allMatches.length > 0) {
            const results = [];
            allMatches.forEach(m => {
                const num = m[0].toUpperCase().replace(/[\s\-]+/g, '');
                if (seen.has(num)) return;
                seen.add(num);
                const result = executeTool('searchPass', { query: num });
                results.push(`• ${result}`);
            });
            parts.push(`Pass lookup results (${seen.size} vehicles):\n` + results.join('\n\n'));
        }

        /* Status query */
        const statusRe = /status|kitna|kitne|checked|remaining|progress|aaj|today|count|total/i;
        if (statusRe.test(userText)) {
            parts.push(executeTool('getAuditStatus', {}));
        }

        /* Memory query */
        const memRe = /yaad|remember|memory|memories|note/i;
        if (memRe.test(userText) && !userText.match(/^(remember|yaad rakh)/i)) {
            parts.push(executeTool('getMemories', {}));
        }

        /* Expired passes query */
        const expRe = /expir|expire|expired|khatam|pass.*band|band.*pass/i;
        if (expRe.test(userText)) {
            parts.push(executeTool('getExpiredPasses', {}));
        }

        /* Active passes query */
        const actRe = /active.*pass|valid.*pass|pass.*active|pass.*valid/i;
        if (actRe.test(userText)) {
            parts.push(executeTool('getActivePasses', {}));
        }

        /* Pass list summary */
        const sumRe = /summary|kitne.*type|class.*wise|breakdown/i;
        if (sumRe.test(userText)) {
            parts.push(executeTool('getPassListSummary', {}));
        }

        /* App events query */
        const eventsRe = /app.*event|event.*kya|recent.*event|kya.*hua|kya.*hue|history|tracker/i;
        if (eventsRe.test(userText)) {
            parts.push(`Recent App Events:\n${recentAppEventsText()}`);
        }

        return parts.join('\n\n');
    }

    /* ═══════════════════════════════════════════════
       SECTION 7 — LOCAL FALLBACK ENGINE
       Used when: no API key, or API error
    ═══════════════════════════════════════════════ */
    const REMEMBER_RE   = /^(remember|yaad\s*rakh|note|save)\s*[:—\-]?\s*/i;
    const FORGET_RE     = /^(forget|bhool|delete memory|remove memory|hatao)\s*/i;
    const MEMORY_RE     = /memories|yaad|stored|saved|kya yaad|what.*remember/i;
    const STATUS_RE     = /status|kitna|kitne|how\s*many|count|total|progress|aaj|today|current|checked|remaining/i;
    const HELP_RE       = /^(help|kya\s*kar|guide|feature|kya\s*karta|what.*do)/i;
    const CLEAR_RE      = /clear\s*chat|chat\s*clear|history\s*clear|chat\s*reset/i;
    const PASS_RE       = /pass|vehicle|gadi|gaadi|number\s*plate/i;
    const EXPIRED_RE    = /expir|expire|expired|khatam.*pass|pass.*khatam|band.*pass|pass.*band|expire.*list|expired.*pass|pass.*expire/i;
    const ACTIVE_RE     = /active.*pass|valid.*pass|pass.*active|pass.*valid|active.*list|valid.*list/i;
    const SUMMARY_RE    = /pass.*summary|summary.*pass|kitne.*type|class.*wise|breakdown|pass.*total.*class/i;

    function localFallback(raw) {
        const msg = raw.trim();

        if (CLEAR_RE.test(msg)) {
            chatHistory = []; saveChatHistory(chatHistory);
            return '🗑️ Chat history cleared!';
        }
        if (REMEMBER_RE.test(msg)) {
            const content = msg.replace(REMEMBER_RE, '').trim();
            if (!content) return 'Kya yaad rakhun? Bolo — "remember: CCTV lane 3"';
            addMemory(content);
            return `✅ Yaad kar liya: "${content}"`;
        }
        if (FORGET_RE.test(msg)) {
            const q = msg.replace(FORGET_RE, '').trim().toLowerCase();
            if (!q) return memoriesToText() || 'Koi memory nahi hai.';
            const match = userMemories.find(m => m.text.toLowerCase().includes(q));
            if (match) { deleteMemory(match.id); return `🗑️ Deleted: "${match.text}"`; }
            return `"${q}" se match koi memory nahi mili.`;
        }
        if (MEMORY_RE.test(msg)) return memoriesToText();

        /* Expired / active / summary pass queries — 100% local, no LLM needed */
        if (EXPIRED_RE.test(msg)) return executeTool('getExpiredPasses', {});
        if (ACTIVE_RE.test(msg))  return executeTool('getActivePasses', {});
        if (SUMMARY_RE.test(msg)) return executeTool('getPassListSummary', {});

        if (HELP_RE.test(msg)) {
            return `Main ye kaam kar sakta hoon:\n\n🔍 Vehicle pass check — koi bhi number type karo (DL9SBA...)\n📊 Status — "aaj kitne checked?"\n🧠 Memory — "remember: shift 2pm se"\n🗂️ Memories — "kya yaad hai?"\n📋 Events — "recent app events kya hue?"\n💬 Clear — "clear chat"\n\n💡 Tip: ⚙️ se Groq/Gemini FREE key lagao full AI ke liye!`;
        }
        if (STATUS_RE.test(msg)) {
            const c = getAppContext();
            return `📊 Status:\n📅 ${c.auditDate}\n🚦 ${c.mode} | ${c.category}\n✅ Checked: ${c.checked} | ⏳ Remaining: ${c.remaining}\n📋 Report: ${c.reportCount} | Txns: ${c.totalTxn}\n🎫 Passes: ${c.passCount}`;
        }
        /* Vehicle number query */
        const numMatch = msg.match(/[A-Z]{2}[\s\-]?\d{1,2}[\s\-]?[A-Z]{0,3}[\s\-]?\d{1,4}/i);
        if (numMatch) {
            const num = numMatch[0].toUpperCase().replace(/[\s\-]+/g, '');
            if (typeof getPassRecord === 'function') {
                const rec = getPassRecord(num);
                if (rec) return passRecordSummary(rec);
            }
            const hits = searchPassLocal(num);
            if (hits.length === 1) return passRecordSummary(hits[0].record);
            if (hits.length > 1) {
                return `"${num}" ke liye ${hits.length} matches:\n` +
                    hits.map(h => `• ${h.number}${h.record.vehicleClass ? ' — ' + h.record.vehicleClass : ''}`).join('\n') +
                    '\n\nPoora number type karo ya full number dalo.';
            }
            return `❌ "${num}" pass list mein nahi mila.`;
        }
        if (PASS_RE.test(msg)) {
            const c = getAppContext();
            return `🎫 Pass list mein ${c.passCount} vehicles hain.`;
        }
        /* App events query */
        const APP_EV_RE = /app.*event|kya.*hua|kya.*hue|recent.*event|tracker|history/i;
        if (APP_EV_RE.test(msg)) return recentAppEventsText();

        const greet = /^(hi|hello|hii|hey|hy|namaste|namaskar|kya\s*hal|kaise|good)/i;
        if (greet.test(msg)) {
            const c = getAppContext();
            return `Namaste! 👋\nAaj ${c.auditDate} — ${c.checked} checked, ${c.remaining} remaining.\n\n${_passIndex.length ? `🎫 ${_passIndex.length} passes loaded.` : '💡 AI mode ke liye ⚙️ se key set karo!'}`;
        }
        return `Samajh nahi aaya. Try karo:\n• Vehicle number type karo\n• "status batao"\n• "remember: kuch bhi"\n• "help"\n\n💡 FREE AI ke liye ⚙️ se Groq/Gemini key lagao!`;
    }

    /* ═══════════════════════════════════════════════
       SECTION 8 — MESSAGE DISPATCH
       Local tools first → correct provider → fallback

       IMPORTANT: Vehicle number lookups are ALWAYS
       handled locally — never sent to LLM for data.
       LLM only formats/explains, never invents data.
    ═══════════════════════════════════════════════ */

    /* Detect if message is PURELY a vehicle number query
       (bulk or single) — no open-ended question attached */
    function isPureVehicleQuery(msg) {
        /* Strip all vehicle numbers and spaces/punctuation */
        const stripped = msg
            .replace(/[A-Z]{2}[\s\-]?\d{1,2}[\s\-]?[A-Z]{0,3}[\s\-]?\d{1,4}/gi, '')
            .replace(/[\s,;|\/\n\r]+/g, '')
            .trim();
        /* If nothing meaningful left → pure vehicle query */
        return stripped.length < 8;
    }

    /* Handle bulk/single vehicle lookup with 100% local data */
    function handleVehicleQuery(msg) {
        const VEH_RE = /[A-Z]{2}[\s\-]?\d{1,2}[\s\-]?[A-Z]{0,3}[\s\-]?\d{1,4}/gi;
        const allMatches = [...msg.matchAll(VEH_RE)];
        const seen = new Set();
        const found = [], notFound = [];

        allMatches.forEach(m => {
            const num = m[0].toUpperCase().replace(/[\s\-]+/g, '');
            if (seen.has(num)) return;
            seen.add(num);

            /* Exact lookup from actual pass list */
            const rec = typeof getPassRecord === 'function' ? getPassRecord(num) : null;
            if (rec) {
                const exp    = typeof isPassExpired === 'function' ? isPassExpired(rec.validTill) : null;
                const status = exp === true ? '🔴 EXPIRED' : '🟢 ACTIVE';
                const days   = typeof remainingDays === 'function' ? remainingDays(rec.validTill) : null;
                let line = `${status} ${rec.number}`;
                if (rec.vehicleClass) line += `  |  ${rec.vehicleClass}`;
                if (rec.validTill)    line += `  |  Valid: ${rec.validTill}`;
                if (days !== null)    line += `  |  ${days < 0 ? Math.abs(days)+' days ago' : days+' days left'}`;
                if (rec.amount)       line += `  |  ₹${rec.amount}`;
                found.push(line);
            } else {
                /* Also try fuzzy search for partials */
                const hits = searchPassLocal(num);
                if (hits.length === 1) {
                    const r   = hits[0].record;
                    const exp = typeof isPassExpired === 'function' ? isPassExpired(r.validTill) : null;
                    const tag = exp === true ? '🔴 EXPIRED' : '🟢 ACTIVE';
                    found.push(`${tag} ${r.number} (matched "${num}")  |  ${r.vehicleClass || ''}  |  ${r.validTill || ''}`);
                } else if (hits.length > 1) {
                    notFound.push(`⚠️ ${num} — ${hits.length} partial matches: ${hits.map(h=>h.number).join(', ')}`);
                } else {
                    notFound.push(`❌ ${num} — not in pass list`);
                }
            }
        });

        if (seen.size === 0) return null;

        let reply = `🔍 Pass check — ${seen.size} vehicle${seen.size > 1 ? 's' : ''}:\n\n`;
        if (found.length)    reply += found.join('\n') + '\n';
        if (notFound.length) reply += '\n' + notFound.join('\n');
        reply += `\n\n📋 Found: ${found.length} | Not found: ${notFound.length}`;
        return reply;
    }

    async function dispatch(raw) {
        const msg = raw.trim();

        /* Always-local — zero cost, instant */
        if (CLEAR_RE.test(msg))    return localFallback(raw);
        if (REMEMBER_RE.test(msg)) return localFallback(raw);
        if (FORGET_RE.test(msg))   return localFallback(raw);
        if (MEMORY_RE.test(msg))   return localFallback(raw);

        /* Pass list queries — always local, 100% accurate, no hallucination */
        if (EXPIRED_RE.test(msg))  return executeTool('getExpiredPasses', {});
        if (ACTIVE_RE.test(msg))   return executeTool('getActivePasses', {});
        if (SUMMARY_RE.test(msg))  return executeTool('getPassListSummary', {});

        /* Pure vehicle query → always local, never LLM
           This prevents ANY hallucination on pass data */
        if (isPureVehicleQuery(msg)) {
            const result = handleVehicleQuery(msg);
            if (result) return result;
        }

        /* No key → pure local */
        if (!hasAIKey()) return localFallback(raw);

        /* Route to selected provider */
        const provider = getProvider();
        try {
            if (provider === 'gemini') return await callGemini(raw);
            if (provider === 'groq')   return await callGroq(raw);
            return await callOpenAI(raw);
        } catch (err) {
            if (err.message === 'NO_KEY') return localFallback(raw);
            console.warn(`[Assistant] ${provider} error:`, err.message);
            const m = err.message;
            if (m.includes('401') || m.includes('403') || m.includes('API_KEY_INVALID') || m.includes('Incorrect API key')) {
                return `❌ API key galat hai.\n\n⚙️ → sahi key paste karo.\n\n` + localFallback(raw);
            }
            if (m.includes('429') || m.includes('RESOURCE_EXHAUSTED')) {
                return `⏳ Rate limit — thoda wait karo (free tier limit hit).\n\n` + localFallback(raw);
            }
            return `⚠️ AI unavailable: ${m.slice(0, 80)}\n\n` + localFallback(raw);
        }
    }

    /* ═══════════════════════════════════════════════
       SECTION 9 — PASS-CHECK AUTOCOMPLETE
    ═══════════════════════════════════════════════ */
    let acTimer = null;

    function setupPassAutocomplete() {
        const inp = document.getElementById('passCheckInput');
        if (!inp) return;

        const vpBar = inp.closest('.vp-bar') || inp.closest('.vp-search-wrap') || inp.parentElement;
        vpBar.style.position = 'relative';

        const dropdown = document.createElement('div');
        dropdown.id = 'passAcDropdown';
        dropdown.className = 'pass-ac-dropdown';
        vpBar.appendChild(dropdown);

        function positionDropdown() {
            const inpRect = inp.getBoundingClientRect();
            const barRect = vpBar.getBoundingClientRect();
            dropdown.style.left  = (inpRect.left - barRect.left) + 'px';
            dropdown.style.right = 'auto';
            dropdown.style.width = inpRect.width + 'px';
            dropdown.style.top   = (inpRect.bottom - barRect.top + 4) + 'px';
        }

        function showSuggestions(val) {
            const hits = searchPassLocal(val);
            if (!hits.length) { dropdown.style.display = 'none'; return; }
            dropdown.innerHTML = hits.map(h => {
                const isValid = typeof isPassExpired === 'function'
                    ? isPassExpired(h.record.validTill) !== true : true;
                return `<div class="pass-ac-item" tabindex="0" data-num="${h.number}">
                    <span class="pass-ac-num">${highlight(h.number, val)}</span>
                    <span class="pass-ac-badge ${isValid ? 'pass-ac-badge-ok' : 'pass-ac-badge-exp'}">
                        ${isValid ? 'Active' : 'Expired'}
                    </span>
                    ${h.record.vehicleClass ? `<span class="pass-ac-cls">${h.record.vehicleClass}</span>` : ''}
                </div>`;
            }).join('');
            positionDropdown();
            dropdown.style.display = 'block';
            dropdown.querySelectorAll('.pass-ac-item').forEach(el => {
                el.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    inp.value = this.dataset.num;
                    dropdown.style.display = 'none';
                    const btn = document.getElementById('passCheckBtn');
                    if (btn) btn.click();
                });
            });
        }

        inp.addEventListener('input', function () {
            clearTimeout(acTimer);
            acTimer = setTimeout(() => showSuggestions(this.value.trim()), 120);
        });
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { dropdown.style.display = 'none'; return; }
            if (e.key === 'ArrowDown') {
                const first = dropdown.querySelector('.pass-ac-item');
                if (first) { first.focus(); e.preventDefault(); }
            }
        });
        dropdown.addEventListener('keydown', function (e) {
            const items = [...dropdown.querySelectorAll('.pass-ac-item')];
            const idx = items.indexOf(document.activeElement);
            if (e.key === 'ArrowDown' && idx < items.length - 1) { items[idx + 1].focus(); e.preventDefault(); }
            if (e.key === 'ArrowUp') { if (idx > 0) items[idx - 1].focus(); else inp.focus(); e.preventDefault(); }
            if (e.key === 'Enter' && idx >= 0) items[idx].dispatchEvent(new MouseEvent('mousedown'));
        });
        document.addEventListener('click', e => {
            if (!dropdown.contains(e.target) && e.target !== inp) dropdown.style.display = 'none';
        });
    }

    function setupEditAutocomplete() {
        const inp = document.getElementById('passEditSearchInput');
        if (!inp) return;
        const outerWrap = document.createElement('div');
        outerWrap.style.cssText = 'position:relative;flex:1;min-width:200px;';
        inp.parentNode.insertBefore(outerWrap, inp);
        outerWrap.appendChild(inp);
        inp.style.width = '100%';
        const dropdown = document.createElement('div');
        dropdown.id = 'passEditAcDropdown';
        dropdown.className = 'pass-ac-dropdown';
        outerWrap.appendChild(dropdown);
        inp.addEventListener('input', function () {
            clearTimeout(acTimer);
            const val = this.value.trim();
            acTimer = setTimeout(() => {
                const hits = searchPassLocal(val);
                if (!hits.length) { dropdown.style.display = 'none'; return; }
                dropdown.innerHTML = hits.map(h =>
                    `<div class="pass-ac-item" tabindex="0" data-num="${h.number}">
                        <span class="pass-ac-num">${highlight(h.number, val)}</span>
                        ${h.record.vehicleClass ? `<span class="pass-ac-cls">${h.record.vehicleClass}</span>` : ''}
                    </div>`
                ).join('');
                dropdown.style.display = 'block';
                dropdown.querySelectorAll('.pass-ac-item').forEach(el => {
                    el.addEventListener('mousedown', function (e) {
                        e.preventDefault();
                        inp.value = this.dataset.num;
                        dropdown.style.display = 'none';
                        const btn = document.getElementById('passEditSearchBtn');
                        if (btn) btn.click();
                    });
                });
            }, 120);
        });
        document.addEventListener('click', e => {
            if (!dropdown.contains(e.target) && e.target !== inp) dropdown.style.display = 'none';
        });
    }

    function highlight(str, query) {
        const q = query.toUpperCase().replace(/[\s\-]+/g, '');
        const s = str.toUpperCase().replace(/[\s\-]+/g, '');
        const idx = s.indexOf(q);
        if (idx < 0) return str;
        return str.slice(0, idx) +
            `<mark class="pass-ac-hl">${str.slice(idx, idx + q.length)}</mark>` +
            str.slice(idx + q.length);
    }

    /* ═══════════════════════════════════════════════
       SECTION 10 — SETTINGS PANEL
    ═══════════════════════════════════════════════ */
    let settingsOpen = false;

    function buildSettingsPanel() {
        const panel = document.createElement('div');
        panel.id = 'asstSettingsPanel';
        panel.className = 'asst-settings-panel asst-settings-hidden';
        panel.innerHTML = `
            <div class="asst-settings-header">
                <span class="asst-settings-title">⚙️ AI Settings</span>
                <button class="asst-action-btn asst-close-btn" id="asstSettingsClose" title="Close">✕</button>
            </div>
            <div class="asst-settings-body">

                <!-- Provider selector -->
                <div class="asst-settings-section">
                    <div class="asst-settings-label">🤖 AI Provider</div>
                    <div class="asst-provider-tabs">
                        <button class="asst-provider-tab" id="asstTabGroq" data-p="groq">
                            <span class="asst-provider-icon">⚡</span>
                            <span>Groq</span>
                            <span class="asst-provider-tag free">FREE</span>
                        </button>
                        <button class="asst-provider-tab" id="asstTabGemini" data-p="gemini">
                            <span class="asst-provider-icon">✦</span>
                            <span>Gemini</span>
                            <span class="asst-provider-tag free">FREE</span>
                        </button>
                        <button class="asst-provider-tab" id="asstTabOpenAI" data-p="openai">
                            <span class="asst-provider-icon">⊕</span>
                            <span>OpenAI</span>
                            <span class="asst-provider-tag paid">Paid</span>
                        </button>
                    </div>
                </div>

                <!-- Groq key section -->
                <div class="asst-settings-section" id="asstGroqSection">
                    <div class="asst-settings-label">
                        ⚡ Groq API Key
                        <a href="https://console.groq.com/keys" target="_blank" class="asst-settings-link">Get free key →</a>
                    </div>
                    <div class="asst-settings-desc">
                        <strong style="color:#16a34a">FREE — Unlimited (fair use).</strong> No credit card needed.<br>
                        Model: <strong>llama-3.3-70b-versatile</strong> · Ultra fast responses.
                    </div>
                    <div class="asst-key-row">
                        <input type="password" id="asstGroqKeyInput" class="asst-key-input"
                               placeholder="gsk_..." autocomplete="off" spellcheck="false">
                        <button class="asst-key-toggle" id="asstGroqKeyToggle" title="Show/hide">👁️</button>
                    </div>
                    <div class="asst-key-actions">
                        <button class="asst-key-save-btn" id="asstGroqKeySave">✅ Save & Activate</button>
                        <button class="asst-key-clear-btn" id="asstGroqKeyClear">🗑️ Remove</button>
                    </div>
                    <div class="asst-key-status" id="asstGroqKeyStatus"></div>
                </div>

                <!-- Gemini key section -->
                <div class="asst-settings-section" id="asstGeminiSection" style="display:none;">
                    <div class="asst-settings-label">
                        ✦ Gemini API Key
                        <a href="https://aistudio.google.com/apikey" target="_blank" class="asst-settings-link">Get free key →</a>
                    </div>
                    <div class="asst-settings-desc">
                        <strong style="color:#16a34a">FREE — 1500 requests/day.</strong> No credit card needed.<br>
                        Model: <strong>gemini-1.5-flash</strong> · Key sirf browser mein rahegi.
                    </div>
                    <div class="asst-key-row">
                        <input type="password" id="asstGeminiKeyInput" class="asst-key-input"
                               placeholder="AIza..." autocomplete="off" spellcheck="false">
                        <button class="asst-key-toggle" id="asstGeminiKeyToggle" title="Show/hide">👁️</button>
                    </div>
                    <div class="asst-key-actions">
                        <button class="asst-key-save-btn" id="asstGeminiKeySave">✅ Save & Activate</button>
                        <button class="asst-key-clear-btn" id="asstGeminiKeyClear">🗑️ Remove</button>
                    </div>
                    <div class="asst-key-status" id="asstGeminiKeyStatus"></div>
                </div>

                <!-- OpenAI key section -->
                <div class="asst-settings-section" id="asstOpenAISection" style="display:none;">
                    <div class="asst-settings-label">
                        ⊕ OpenAI API Key
                        <a href="https://platform.openai.com/api-keys" target="_blank" class="asst-settings-link">Get key →</a>
                    </div>
                    <div class="asst-settings-desc">
                        Model: <strong>gpt-4o-mini</strong> (~₹1 per 1000 messages)<br>
                        Key sirf aapke browser mein save hogi.
                    </div>
                    <div class="asst-key-row">
                        <input type="password" id="asstKeyInput" class="asst-key-input"
                               placeholder="sk-..." autocomplete="off" spellcheck="false">
                        <button class="asst-key-toggle" id="asstKeyToggle" title="Show/hide">👁️</button>
                    </div>
                    <div class="asst-key-actions">
                        <button class="asst-key-save-btn" id="asstKeySave">✅ Save & Activate</button>
                        <button class="asst-key-clear-btn" id="asstKeyClear">🗑️ Remove</button>
                    </div>
                    <div class="asst-key-status" id="asstKeyStatus"></div>
                </div>

                <!-- Memories -->
                <div class="asst-settings-section">
                    <div class="asst-settings-label">🧠 Saved Memories</div>
                    <div class="asst-settings-desc" id="asstSettingsMemCount">Loading…</div>
                    <button class="asst-key-clear-btn" id="asstClearAllMem" style="margin-top:6px;">🗑️ Clear All Memories</button>
                </div>

                <!-- About -->
                <div class="asst-settings-section">
                    <div class="asst-settings-label">ℹ️ About</div>
                    <div class="asst-settings-desc">
                        Toll Audit Smart Assistant v2<br>
                        Pass list: <span id="asstSettingsPassCount">—</span> vehicles loaded
                    </div>
                </div>

            </div>
        `;
        document.body.appendChild(panel);
        wireSettingsEvents();
    }

    function wireSettingsEvents() {
        document.getElementById('asstSettingsClose').addEventListener('click', closeSettings);

        /* ── Provider tab switching ── */
        function activateProviderTab(p) {
            setProvider(p);
            document.getElementById('asstGroqSection').style.display   = p === 'groq'   ? '' : 'none';
            document.getElementById('asstGeminiSection').style.display = p === 'gemini' ? '' : 'none';
            document.getElementById('asstOpenAISection').style.display = p === 'openai' ? '' : 'none';
            document.getElementById('asstTabGroq').classList.toggle('active',   p === 'groq');
            document.getElementById('asstTabGemini').classList.toggle('active', p === 'gemini');
            document.getElementById('asstTabOpenAI').classList.toggle('active', p === 'openai');
        }

        document.getElementById('asstTabGroq').addEventListener('click',   () => activateProviderTab('groq'));
        document.getElementById('asstTabGemini').addEventListener('click', () => activateProviderTab('gemini'));
        document.getElementById('asstTabOpenAI').addEventListener('click', () => activateProviderTab('openai'));

        /* Restore saved provider */
        activateProviderTab(getProvider());

        /* Pre-fill saved keys */
        const groqInp   = document.getElementById('asstGroqKeyInput');
        const geminiInp = document.getElementById('asstGeminiKeyInput');
        const openaiInp = document.getElementById('asstKeyInput');
        if (getGroqKey())   groqInp.value   = getGroqKey();
        if (getGeminiKey()) geminiInp.value = getGeminiKey();
        if (getAIKey())     openaiInp.value = getAIKey();

        /* Show/hide toggles */
        document.getElementById('asstGroqKeyToggle').addEventListener('click', () => {
            groqInp.type = groqInp.type === 'password' ? 'text' : 'password';
        });
        document.getElementById('asstGeminiKeyToggle').addEventListener('click', () => {
            geminiInp.type = geminiInp.type === 'password' ? 'text' : 'password';
        });
        document.getElementById('asstKeyToggle').addEventListener('click', () => {
            openaiInp.type = openaiInp.type === 'password' ? 'text' : 'password';
        });

        /* ── Save Groq key ── */
        const groqStatus = document.getElementById('asstGroqKeyStatus');
        document.getElementById('asstGroqKeySave').addEventListener('click', async () => {
            const k = groqInp.value.trim();
            if (!k) { groqStatus.textContent = '⚠️ Key empty hai.'; groqStatus.className = 'asst-key-status err'; return; }
            if (!k.startsWith('gsk_')) { groqStatus.textContent = '⚠️ Groq key "gsk_" se shuru honi chahiye.'; groqStatus.className = 'asst-key-status err'; return; }
            groqStatus.textContent = '🔄 Verifying…'; groqStatus.className = 'asst-key-status';
            try {
                const resp = await fetch('https://api.groq.com/openai/v1/models', {
                    headers: { 'Authorization': `Bearer ${k}` }
                });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                setGroqKey(k);
                setProvider('groq');
                groqStatus.textContent = '✅ Saved! Groq AI mode active.'; groqStatus.className = 'asst-key-status ok';
                updateStatusLine();
                setTimeout(() => {
                    appendBotMsg('🎉 Groq AI mode ON! Ab main Llama 3.1 se powered hoon.\n\nFREE aur ultra-fast! Kuch bhi poochho — Hindi, English, Hinglish!', false);
                    if (!chatOpen) { unreadCount++; updateBadge(); }
                }, 200);
            } catch (e) {
                groqStatus.textContent = `❌ ${e.message}`; groqStatus.className = 'asst-key-status err';
            }
        });
        document.getElementById('asstGroqKeyClear').addEventListener('click', () => {
            clearGroqKey(); groqInp.value = '';
            groqStatus.textContent = 'Key removed.'; groqStatus.className = 'asst-key-status';
            updateStatusLine();
        });

        /* ── Save Gemini key ── */
        const geminiStatus = document.getElementById('asstGeminiKeyStatus');
        document.getElementById('asstGeminiKeySave').addEventListener('click', async () => {
            const k = geminiInp.value.trim();
            if (!k) { geminiStatus.textContent = '⚠️ Key empty hai.'; geminiStatus.className = 'asst-key-status err'; return; }
            if (!k.startsWith('AIza')) { geminiStatus.textContent = '⚠️ Gemini key "AIza" se shuru honi chahiye.'; geminiStatus.className = 'asst-key-status err'; return; }
            geminiStatus.textContent = '🔄 Verifying…'; geminiStatus.className = 'asst-key-status';
            try {
                const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${k}`;
                const resp = await fetch(testUrl);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                setGeminiKey(k);
                setProvider('gemini');
                geminiStatus.textContent = '✅ Saved! Gemini AI mode active.'; geminiStatus.className = 'asst-key-status ok';
                updateStatusLine();
                setTimeout(() => {
                    appendBotMsg('🎉 Gemini AI mode ON! Ab main Google Gemini Flash se powered hoon.\n\nFREE — 1500 requests/day. Kuch bhi poochho — Hindi, English, Hinglish!', false);
                    if (!chatOpen) { unreadCount++; updateBadge(); }
                }, 200);
            } catch (e) {
                geminiStatus.textContent = `❌ ${e.message}`; geminiStatus.className = 'asst-key-status err';
            }
        });
        document.getElementById('asstGeminiKeyClear').addEventListener('click', () => {
            clearGeminiKey(); geminiInp.value = '';
            geminiStatus.textContent = 'Key removed.'; geminiStatus.className = 'asst-key-status';
            updateStatusLine();
        });

        /* ── Save OpenAI key ── */
        const openaiStatus = document.getElementById('asstKeyStatus');
        document.getElementById('asstKeySave').addEventListener('click', async () => {
            const k = openaiInp.value.trim();
            if (!k) { openaiStatus.textContent = '⚠️ Key empty hai.'; openaiStatus.className = 'asst-key-status err'; return; }
            if (!k.startsWith('sk-')) { openaiStatus.textContent = '⚠️ OpenAI key "sk-" se shuru honi chahiye.'; openaiStatus.className = 'asst-key-status err'; return; }
            openaiStatus.textContent = '🔄 Verifying…'; openaiStatus.className = 'asst-key-status';
            try {
                const resp = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${k}` } });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                setAIKey(k);
                setProvider('openai');
                openaiStatus.textContent = '✅ Saved! OpenAI mode active.'; openaiStatus.className = 'asst-key-status ok';
                updateStatusLine();
                setTimeout(() => {
                    appendBotMsg('🎉 OpenAI mode ON! GPT-4o mini se powered hoon ab.', false);
                    if (!chatOpen) { unreadCount++; updateBadge(); }
                }, 200);
            } catch (e) {
                openaiStatus.textContent = `❌ ${e.message}`; openaiStatus.className = 'asst-key-status err';
            }
        });
        document.getElementById('asstKeyClear').addEventListener('click', () => {
            clearAIKey(); openaiInp.value = '';
            openaiStatus.textContent = 'Key removed.'; openaiStatus.className = 'asst-key-status';
            updateStatusLine();
        });

        /* ── Clear all memories ── */
        document.getElementById('asstClearAllMem').addEventListener('click', () => {
            if (!confirm('Sari memories delete karni hain?')) return;
            userMemories = []; saveMemory(userMemories); refreshSettingsInfo();
        });
    }

    function refreshSettingsInfo() {
        const mc = document.getElementById('asstSettingsMemCount');
        const pc = document.getElementById('asstSettingsPassCount');
        if (mc) mc.textContent = `${userMemories.length} memories saved.`;
        if (pc) pc.textContent = _passIndex.length;
    }

    function openSettings() {
        settingsOpen = true;
        const p = document.getElementById('asstSettingsPanel');
        if (p) {
            p.classList.remove('asst-settings-hidden');
            p.classList.add('asst-settings-open');
            refreshSettingsInfo();
        }
    }
    function closeSettings() {
        settingsOpen = false;
        const p = document.getElementById('asstSettingsPanel');
        if (p) { p.classList.remove('asst-settings-open'); p.classList.add('asst-settings-hidden'); }
    }

    /* ═══════════════════════════════════════════════
       SECTION 11 — CHAT PANEL UI
    ═══════════════════════════════════════════════ */
    let uiReady = false, chatOpen = false, unreadCount = 0;

    function buildUI() {
        if (uiReady) return;
        uiReady = true;

        /* ── Floating bubble (pill FAB) ── */
        const bubble = document.createElement('div');
        bubble.id = 'assistantBubble';
        bubble.className = 'asst-bubble';
        bubble.innerHTML = `
            <div class="asst-bubble-icon-wrap">
                <svg viewBox="0 0 24 24" fill="none" width="17" height="17">
                    <path d="M12 2C6.48 2 2 5.92 2 10.75c0 2.52 1.26 4.78 3.25 6.31L4.5 21l4.07-2.04A11.1 11.1 0 0 0 12 19.5c5.52 0 10-3.92 10-8.75S17.52 2 12 2Z"
                          fill="rgba(255,255,255,0.22)" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                    <circle cx="8.5"  cy="10.75" r="1.1" fill="currentColor"/>
                    <circle cx="12"   cy="10.75" r="1.1" fill="currentColor"/>
                    <circle cx="15.5" cy="10.75" r="1.1" fill="currentColor"/>
                </svg>
            </div>
            <div class="asst-bubble-label">
                <span class="asst-bubble-label-main">AI Assistant</span>
                <span class="asst-bubble-label-sub" id="asstBubbleSub">Ask me anything</span>
            </div>
            <span class="asst-badge" id="asstBadge" style="display:none;">0</span>
        `;
        document.body.appendChild(bubble);
        bubble.addEventListener('click', togglePanel);

        /* ── Chat panel ── */
        const panel = document.createElement('div');
        panel.id = 'assistantPanel';
        panel.className = 'asst-panel asst-panel-hidden';
        panel.innerHTML = `
            <div class="asst-header">
                <div class="asst-header-left">
                    <div class="asst-header-avatar" id="asstAvatarDot">
                        <svg viewBox="0 0 24 24" fill="none" width="17" height="17">
                            <circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.8"/>
                            <path d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6"
                                  stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                        </svg>
                    </div>
                    <div>
                        <div class="asst-header-name">Audit Assistant</div>
                        <div class="asst-header-sub" id="asstStatusLine">Initializing…</div>
                    </div>
                </div>
                <div class="asst-header-actions">
                    <button class="asst-action-btn" id="asstMemBtn"      title="Saved memories">🧠</button>
                    <button class="asst-action-btn" id="asstSettingsBtn" title="AI Settings">⚙️</button>
                    <button class="asst-action-btn" id="asstClearBtn"    title="Clear chat">🗑️</button>
                    <button class="asst-action-btn asst-close-btn" id="asstCloseBtn" title="Close">✕</button>
                </div>
            </div>
            <div class="asst-messages" id="asstMessages"></div>
            <div class="asst-input-area">
                <input type="text" id="asstInput" class="asst-input"
                       placeholder="Kuch bhi poochho…" autocomplete="off" spellcheck="false">
                <button class="asst-send-btn" id="asstSendBtn" title="Send">
                    <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                        <path d="M22 2L11 13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                        <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
                    </svg>
                </button>
            </div>
        `;
        document.body.appendChild(panel);

        buildSettingsPanel();

        /* Wire panel events */
        document.getElementById('asstCloseBtn').addEventListener('click', closePanel);
        document.getElementById('asstSendBtn').addEventListener('click', sendMsg);
        document.getElementById('asstInput').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
        });
        document.getElementById('asstClearBtn').addEventListener('click', () => {
            chatHistory = []; saveChatHistory(chatHistory); renderMessages();
        });
        document.getElementById('asstMemBtn').addEventListener('click', () => {
            appendBotMsg(memoriesToText(), false);
        });
        document.getElementById('asstSettingsBtn').addEventListener('click', () => {
            settingsOpen ? closeSettings() : openSettings();
        });

        renderMessages();
        updateStatusLine();
    }

    function togglePanel() { chatOpen ? closePanel() : openPanel(); }

    function openPanel() {
        chatOpen = true;
        closeSettings();
        const p = document.getElementById('assistantPanel');
        p.classList.remove('asst-panel-hidden');
        p.classList.add('asst-panel-open');
        unreadCount = 0; updateBadge();
        setTimeout(() => {
            const m = document.getElementById('asstMessages');
            if (m) m.scrollTop = m.scrollHeight;
            const inp = document.getElementById('asstInput');
            if (inp) inp.focus();
        }, 120);
    }

    function closePanel() {
        chatOpen = false;
        closeSettings();
        const p = document.getElementById('assistantPanel');
        if (p) { p.classList.remove('asst-panel-open'); p.classList.add('asst-panel-hidden'); }
    }

    function updateBadge() {
        const b = document.getElementById('asstBadge');
        if (!b) return;
        if (unreadCount > 0 && !chatOpen) {
            b.textContent = unreadCount > 9 ? '9+' : unreadCount;
            b.style.display = 'flex';
        } else {
            b.style.display = 'none';
        }
    }

    function updateStatusLine() {
        const el    = document.getElementById('asstStatusLine');
        const subEl = document.getElementById('asstBubbleSub');
        if (!el) return;
        const cnt      = _passIndex.length;
        const active   = hasAIKey();
        const provider = getProvider();
        const avatar   = document.getElementById('asstAvatarDot');
        if (active) {
            const lbl = provider === 'gemini' ? '✦ Gemini'
                      : provider === 'groq'   ? '⚡ Groq'
                      : '⊕ GPT-4o';
            el.textContent = cnt > 0 ? `${lbl} · ${cnt} passes` : `${lbl} · AI Active`;
            el.style.color = '#86efac';
            if (subEl) subEl.textContent = cnt > 0 ? `${cnt} passes · ${lbl}` : `${lbl} · Ask anything`;
            if (avatar) avatar.style.background =
                  provider === 'gemini' ? 'linear-gradient(135deg,#1a73e8,#0d47a1)'
                : provider === 'groq'   ? 'linear-gradient(135deg,#f97316,#ea580c)'
                : 'linear-gradient(135deg,#7c3aed,#4f46e5)';
        } else {
            el.textContent = cnt > 0 ? `Local · ${cnt} passes` : 'Local · Add key for AI';
            el.style.color = '#6ee7b7';
            if (subEl) subEl.textContent = cnt > 0 ? `${cnt} passes loaded` : 'Ask me anything';
            if (avatar) avatar.style.background = 'linear-gradient(135deg,#16a34a,#15803d)';
        }
    }

    /* ═══════════════════════════════════════════════
       SECTION 12 — MESSAGE RENDERING
    ═══════════════════════════════════════════════ */
    function renderMessages() {
        const container = document.getElementById('asstMessages');
        if (!container) return;
        if (!chatHistory.length) {
            const ai = hasAIKey();
            const prov = getProvider();
            const provIcon  = prov === 'groq' ? '⚡' : prov === 'gemini' ? '✦' : '⊕';
            const provLabel = prov === 'groq' ? 'Groq Llama 3' : prov === 'gemini' ? 'Gemini Flash' : 'GPT-4o mini';
            const cnt = _passIndex.length;
            container.innerHTML = `
                <div class="asst-welcome">
                    <div class="asst-welcome-icon">${ai ? provIcon : '👋'}</div>
                    <div class="asst-welcome-title">${ai ? `${provLabel} Active!` : 'Namaste!'}</div>
                    <div class="asst-welcome-sub">
                        ${ai
                            ? `Main <strong>${provLabel}</strong> se powered hoon.<br>Kuch bhi Hindi/English/Hinglish mein poochho!`
                            : 'Main aapka Audit Assistant hoon.<br>⚙️ se Groq/Gemini key lagao FREE AI ke liye!'}
                        ${cnt > 0 ? `<br><span class="asst-pass-count-badge">🎫 ${cnt} passes loaded</span>` : ''}
                    </div>
                    <div class="asst-quick-btns">
                        <button class="asst-quick-btn" data-q="aaj ka status batao">📊 Status</button>
                        <button class="asst-quick-btn" data-q="kya yaad hai?">🧠 Memories</button>
                        <button class="asst-quick-btn" data-q="help">❓ Help</button>
                        <button class="asst-quick-btn" data-q="recent app events kya hue?">📋 Events</button>
                        ${ai ? '<button class="asst-quick-btn" data-q="pass list mein kitne expire ho rahe hain?">⚠️ Expiry</button>' : ''}
                    </div>
                </div>`;
            container.querySelectorAll('.asst-quick-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const inp = document.getElementById('asstInput');
                    if (inp) { inp.value = btn.dataset.q; sendMsg(); }
                });
            });
            return;
        }

        container.innerHTML = chatHistory.map(m => msgBubbleHTML(m)).join('');
        /* Re-wire suggestion buttons from history */
        container.querySelectorAll('.asst-pass-suggest-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const inp = document.getElementById('asstInput');
                if (inp) { inp.value = this.dataset.num; sendMsg(); }
            });
        });
        container.scrollTop = container.scrollHeight;
    }

    function msgBubbleHTML(m) {
        const isUser = m.role === 'user';
        const text   = escHtml(m.text || '');
        const time   = m.time || '';
        const aiTag  = (!isUser && m.ai) ? '<span class="asst-ai-tag">AI</span>' : '';
        return `<div class="asst-msg ${isUser ? 'asst-msg-user' : 'asst-msg-bot'}">
            <div class="asst-msg-text">${aiTag}${text}</div>
            <div class="asst-msg-time">${time}</div>
        </div>`;
    }

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
    }

    function appendBotMsg(text, persist, extra) {
        const msg = {
            role: 'bot', text,
            time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
            ai: extra?.ai || false
        };
        if (persist !== false) { chatHistory.push(msg); saveChatHistory(chatHistory); }
        renderMessages();
        if (!chatOpen) { unreadCount++; updateBadge(); }
    }

    /* ═══════════════════════════════════════════════
       SECTION 13 — SEND / TYPING
    ═══════════════════════════════════════════════ */
    let typingEl = null;

    function showTyping() {
        removeTyping();
        const c = document.getElementById('asstMessages');
        if (!c) return;
        typingEl = document.createElement('div');
        typingEl.className = 'asst-msg asst-msg-bot asst-typing-wrap';
        typingEl.innerHTML = `<div class="asst-typing"><span></span><span></span><span></span></div>`;
        c.appendChild(typingEl);
        c.scrollTop = c.scrollHeight;
    }
    function removeTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

    async function sendMsg() {
        const inp = document.getElementById('asstInput');
        if (!inp) return;
        const raw = inp.value.trim();
        if (!raw) return;
        inp.value = '';
        inp.disabled = true;
        const sendBtn = document.getElementById('asstSendBtn');
        if (sendBtn) sendBtn.disabled = true;

        /* Push user msg to history */
        const userMsg = {
            role: 'user', text: raw,
            time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        };
        chatHistory.push(userMsg);
        saveChatHistory(chatHistory);
        renderMessages();
        showTyping();

        try {
            const replyText = await dispatch(raw);
            removeTyping();
            const isAI = hasAIKey() && !REMEMBER_RE.test(raw) && !FORGET_RE.test(raw) && !MEMORY_RE.test(raw) && !CLEAR_RE.test(raw);
            const botMsg = {
                role: 'bot', text: replyText, ai: isAI,
                time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
            };
            chatHistory.push(botMsg);
            saveChatHistory(chatHistory);
            renderMessages();
            if (!chatOpen) { unreadCount++; updateBadge(); }
            updateStatusLine();
        } catch (e) {
            removeTyping();
            appendBotMsg(`⚠️ Error: ${e.message}`, true);
        } finally {
            inp.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
            inp.focus();
        }
    }

    /* ═══════════════════════════════════════════════
       SECTION 13b — IN-CHAT INPUT AUTOCOMPLETE
       As user types a vehicle number in the chat input,
       show a small floating suggestion row above the input.
    ═══════════════════════════════════════════════ */
    function setupChatInputAutocomplete() {
        const inputArea = document.querySelector('.asst-input-area');
        const inp       = document.getElementById('asstInput');
        if (!inputArea || !inp) return;

        const row = document.createElement('div');
        row.id = 'asstChatAcRow';
        row.className = 'asst-chat-ac-row';
        row.style.display = 'none';
        inputArea.parentNode.insertBefore(row, inputArea);

        let acT = null;
        function hideRow() { row.style.display = 'none'; row.innerHTML = ''; }

        inp.addEventListener('input', function () {
            clearTimeout(acT);
            const val = this.value.trim();
            /* Only trigger when input looks like a partial vehicle number */
            const VEH_PARTIAL = /[A-Z]{2}[\s\-]?\d{0,2}/i;
            if (!val || val.length < 3 || !VEH_PARTIAL.test(val)) { hideRow(); return; }
            acT = setTimeout(() => {
                const hits = searchPassLocal(val);
                if (!hits.length) { hideRow(); return; }
                row.innerHTML = hits.slice(0, 4).map(h => {
                    const exp = typeof isPassExpired === 'function' ? isPassExpired(h.record.validTill) : null;
                    const tag = exp === true ? '🔴' : '🟢';
                    const cls = h.record.vehicleClass ? ` — ${h.record.vehicleClass}` : '';
                    return `<button class="asst-chat-ac-chip" data-num="${h.number}" title="${h.number}${cls}">
                        ${tag} <strong>${h.number}</strong>${cls ? `<span>${cls}</span>` : ''}
                    </button>`;
                }).join('');
                row.style.display = 'flex';
                row.querySelectorAll('.asst-chat-ac-chip').forEach(chip => {
                    chip.addEventListener('mousedown', function (e) {
                        e.preventDefault();
                        inp.value = this.dataset.num;
                        hideRow();
                        inp.focus();
                        /* Auto-send after a brief moment */
                        setTimeout(() => sendMsg(), 80);
                    });
                });
            }, 100);
        });

        inp.addEventListener('keydown', e => { if (e.key === 'Escape') hideRow(); });
        document.addEventListener('click', e => {
            if (!row.contains(e.target) && e.target !== inp) hideRow();
        });
    }

    /* ═══════════════════════════════════════════════
       SECTION 14 — INIT
       Bubble is hidden until user is logged in.
       We watch the #mainApp element's display via
       MutationObserver — no changes to auth.js needed.
    ═══════════════════════════════════════════════ */

    function showAssistant() {
        const b = document.getElementById('assistantBubble');
        if (b) { b.style.display = ''; b.style.visibility = 'visible'; }
    }
    function hideAssistant() {
        const b = document.getElementById('assistantBubble');
        if (b) { b.style.display = 'none'; }
        /* Also close the panel if open */
        closePanel();
    }

    /* Watch #mainApp visibility — show/hide assistant accordingly */
    function watchAuthState() {
        const mainApp = document.getElementById('mainApp');
        if (!mainApp) {
            /* DOM not ready yet, retry */
            setTimeout(watchAuthState, 300);
            return;
        }

        function syncVisibility() {
            const visible = mainApp.style.display !== 'none' && mainApp.style.display !== '';
            if (visible) showAssistant();
            else hideAssistant();
        }

        /* Observe style attribute changes on #mainApp */
        new MutationObserver(syncVisibility)
            .observe(mainApp, { attributes: true, attributeFilter: ['style'] });

        /* Run once immediately in case user is already logged in */
        syncVisibility();
    }

    function init() {
        loadAppEvents();
        watchPassList();
        buildUI();

        /* Hide bubble immediately — only show after login */
        const b = document.getElementById('assistantBubble');
        if (b) b.style.display = 'none';

        setupPassAutocomplete();
        setupEditAutocomplete();
        setupChatInputAutocomplete();
        setupAppActionTracker();
        updateStatusLine();
        setInterval(updateStatusLine, 6000);

        /* Start watching auth state */
        watchAuthState();

        /* Announce pass list events in chat */
        document.addEventListener('passListChanged', e => {
            const { count, action } = e.detail || {};
            const msg = action === 'replace'
                ? `📋 Pass list updated! ${count} vehicles loaded. Index rebuilt — autocomplete ready.`
                : `🗑️ Pass list cleared. 0 vehicles in index.`;
            appendBotMsg(msg, false);
            if (!chatOpen) { unreadCount++; updateBadge(); }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 200);
    }

})();
