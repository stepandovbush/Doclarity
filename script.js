// ============================================================================
// CLEARPATH AI — Professional Document Assistant
// ============================================================================

const BACKEND_URL = 'http://localhost:8000';

const LANG_NAMES = {
    en: 'English', es: 'Spanish', ar: 'Arabic', zh: 'Chinese',
    fr: 'French', de: 'German', it: 'Italian', ja: 'Japanese', hi: 'Hindi',
};

// Labels for the Summary & Recommendations box — keyed by language code
const BOX_LABELS = {
    en: { header:'Summary & Recommendations', summary:'Summary', deadlines:'Deadlines', whatAsked:'What they are asking you to do', whatProvide:'Documents / forms to submit', ifIgnored:'If ignored', recommendations:'Recommendations', appealRights:'Appeal rights', crisis:'CRISIS — Act Immediately', urgent:'Urgent — Act Soon', actionNeeded:'Action Needed' },
    es: { header:'Resumen y Recomendaciones', summary:'Resumen', deadlines:'Plazos', whatAsked:'Lo que le piden que haga', whatProvide:'Documentos / formularios a presentar', ifIgnored:'Si no actúa', recommendations:'Recomendaciones', appealRights:'Derechos de apelación', crisis:'CRISIS — Actúe de inmediato', urgent:'Urgente — Actúe pronto', actionNeeded:'Acción necesaria' },
    ar: { header:'الملخص والتوصيات', summary:'الملخص', deadlines:'المواعيد النهائية', whatAsked:'ما يُطلب منك فعله', whatProvide:'المستندات / النماذج المطلوبة', ifIgnored:'في حال التجاهل', recommendations:'التوصيات', appealRights:'حقوق الاستئناف', crisis:'أزمة — تصرف فوراً', urgent:'عاجل — تصرف قريباً', actionNeeded:'إجراء مطلوب' },
    zh: { header:'摘要与建议', summary:'摘要', deadlines:'截止日期', whatAsked:'他们要求您做的事', whatProvide:'需提交的文件/表格', ifIgnored:'若忽略后果', recommendations:'建议', appealRights:'申诉权利', crisis:'危机 — 立即行动', urgent:'紧急 — 尽快行动', actionNeeded:'需要采取行动' },
    fr: { header:'Résumé et Recommandations', summary:'Résumé', deadlines:'Délais', whatAsked:'Ce qu\'on vous demande de faire', whatProvide:'Documents / formulaires à soumettre', ifIgnored:'Si ignoré', recommendations:'Recommandations', appealRights:'Droits de recours', crisis:'CRISE — Agissez immédiatement', urgent:'Urgent — Agissez bientôt', actionNeeded:'Action requise' },
    de: { header:'Zusammenfassung & Empfehlungen', summary:'Zusammenfassung', deadlines:'Fristen', whatAsked:'Was von Ihnen verlangt wird', whatProvide:'Einzureichende Dokumente / Formulare', ifIgnored:'Konsequenzen bei Nichthandeln', recommendations:'Empfehlungen', appealRights:'Widerspruchsrechte', crisis:'KRISE — Sofort handeln', urgent:'Dringend — Bald handeln', actionNeeded:'Handlungsbedarf' },
    it: { header:'Riepilogo e Raccomandazioni', summary:'Riepilogo', deadlines:'Scadenze', whatAsked:'Cosa ti viene chiesto di fare', whatProvide:'Documenti / moduli da presentare', ifIgnored:'Se ignorato', recommendations:'Raccomandazioni', appealRights:'Diritti di ricorso', crisis:'CRISI — Agisci immediatamente', urgent:'Urgente — Agisci presto', actionNeeded:'Azione necessaria' },
    ja: { header:'概要と推奨事項', summary:'概要', deadlines:'期限', whatAsked:'求められていること', whatProvide:'提出が必要な書類・フォーム', ifIgnored:'無視した場合', recommendations:'推奨事項', appealRights:'異議申し立て権', crisis:'危機 — 直ちに行動してください', urgent:'緊急 — 早急に行動してください', actionNeeded:'対応が必要です' },
};

// Upload pane states: 'idle' | 'file-selected' | 'processing' | 'ready' | 'error'
const UPLOAD_STATE = { IDLE: 'idle', FILE: 'file-selected', PROCESSING: 'processing', READY: 'ready' };

class DoclarityChatbot {
    constructor() {
        this.sessionId = this.generateSessionId();
        this.currentLanguage = 'en';
        this.uploadedFile = null;
        this.analysisResult = null;
        this.documentContent = null;
        this.conversationHistory = [];
        this.documentAnalyzed = false;
        this.documentContext = null;
        this.serverDocumentContext = null;  // PII-scrubbed text returned by server after upload
        this.backendAvailable = null;
        this.uploadState = UPLOAD_STATE.IDLE;
        this.userBackground = {
            origin: null, citizenshipStatus: null,
            employmentStatus: null, familyStatus: null, healthStatus: null,
        };
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupLanguageListener();
        this.setupAgencyTabs();
        this.addInitialBotGreeting();
        this.probeBackend();
        this.setUploadState(UPLOAD_STATE.IDLE);
    }

    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // ── Backend probe ───────────────────────────────────────────────────────

    async probeBackend() {
        try {
            const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(3000) });
            this.backendAvailable = res.ok;
        } catch {
            this.backendAvailable = false;
        }
    }

    // ── Event wiring ────────────────────────────────────────────────────────

    setupEventListeners() {
        const fileUpload = document.getElementById('fileUpload');
        if (fileUpload) fileUpload.addEventListener('change', (e) => this.handleFileUpload(e));

        const chatForm = document.getElementById('chatForm');
        if (chatForm) chatForm.addEventListener('submit', (e) => this.handleChatSubmit(e));

        document.querySelectorAll('.chip').forEach(chip => {
            chip.addEventListener('click', (e) => this.handleQuickAction(e));
        });

        const dropzone = document.querySelector('.dropzone');
        if (dropzone) {
            dropzone.addEventListener('dragover',  (e) => this.handleDragOver(e));
            dropzone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
            dropzone.addEventListener('drop',      (e) => this.handleDrop(e));
        }

        // "Change file" button in file-selected state
        const changeBtn = document.getElementById('dzChangeBtn');
        if (changeBtn) {
            changeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                document.getElementById('fileUpload').click();
            });
        }

        // "Re-scan" button in ready state
        const rescanBtn = document.getElementById('docRescanBtn');
        if (rescanBtn) {
            rescanBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.resetToIdle();
            });
        }
    }

    setupLanguageListener() {
        const sel = document.getElementById('language');
        if (sel) {
            sel.addEventListener('change', async (e) => {
                this.currentLanguage = e.target.value;
                const badge = document.getElementById('languageBadge');
                if (badge) badge.textContent = LANG_NAMES[this.currentLanguage] || 'English';
                this.updateChatGreeting();
                // Keep all produced text on screen — translate it in place across
                // the chat, the upload pane, and the summary & recommendations box.
                await this.translateUI();
            });
        }
    }

    // Translate every already-rendered piece of produced text in place. Originals
    // are captured once so switching back to English restores them exactly.
    async translateUI() {
        const lang = LANG_NAMES[this.currentLanguage] || 'English';
        const isEn = this.currentLanguage === 'en';

        // Collect every translatable element as {el, kind: 'html'|'text'}.
        const targets = [];
        document.querySelectorAll(
            '#messages .bubble, #messages .crisis-banner, #messages .human-resources-panel, #messages .asb-complete-msg'
        ).forEach(node => {
            if (!node.classList.contains('typing-indicator')) targets.push({ el: node, kind: 'html' });
        });
        document.querySelectorAll(
            '#dzIdle .dz-sub, #pStep1 span, #pStep2 span, #pStep3 span, .doc-ready-info strong, #docReadyType'
        ).forEach(el => targets.push({ el, kind: 'text' }));
        const privacyNote = document.querySelector('.privacy-note');
        if (privacyNote) targets.push({ el: privacyNote, kind: 'html' });
        const sbHeader = document.querySelector('#analysisSummaryBox .asb-header span');
        if (sbHeader) targets.push({ el: sbHeader, kind: 'text' });

        // Summary body: translate each child separately (smaller, faster pieces),
        // but keep a whole-body original for a clean English restore.
        const sbBody = document.getElementById('analysisSummaryText');
        if (sbBody && sbBody.innerHTML.trim()) {
            if (!sbBody.dataset.originalHtml) sbBody.dataset.originalHtml = sbBody.innerHTML;
            if (isEn) {
                sbBody.innerHTML = sbBody.dataset.originalHtml;
            } else {
                [...sbBody.children].forEach(child => targets.push({ el: child, kind: 'html' }));
            }
        }

        // Capture originals; on English, restore instantly (no network call).
        const pending = [];
        for (const t of targets) {
            if (t.kind === 'html') {
                if (!t.el.dataset.originalHtml) t.el.dataset.originalHtml = t.el.innerHTML;
                if (isEn) { t.el.innerHTML = t.el.dataset.originalHtml; continue; }
                pending.push({ el: t.el, kind: 'html', src: t.el.dataset.originalHtml });
            } else {
                if (!t.el.dataset.originalText) t.el.dataset.originalText = t.el.textContent;
                if (isEn) { t.el.textContent = t.el.dataset.originalText; continue; }
                pending.push({ el: t.el, kind: 'text', src: t.el.dataset.originalText });
            }
        }
        if (isEn || pending.length === 0) { this.scrollToBottom(); return; }

        // One batched request translates the whole UI at once.
        const out = await this.translateBatch(pending.map(p => p.src), lang);
        if (out && out.length === pending.length) {
            pending.forEach((p, i) => {
                if (!out[i]) return;
                if (p.kind === 'html') p.el.innerHTML = out[i];
                else p.el.textContent = out[i];
            });
        }
        this.scrollToBottom();
    }

    async translateBatch(texts, language) {
        try {
            const res = await fetch(`${BACKEND_URL}/translate_batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ texts, language }),
                signal: AbortSignal.timeout(40000),
            });
            if (!res.ok) return null;
            const data = await res.json();
            return data.texts || null;
        } catch {
            return null;
        }
    }

    async retranslateSummaryBox() {
        if (!this.serverDocumentContext) return;

        const bodyEl = document.getElementById('analysisSummaryText');
        if (!bodyEl) return;
        const prev = bodyEl.innerHTML;
        bodyEl.innerHTML = '<p style="color:var(--gray-400);font-style:italic">Translating…</p>';

        try {
            const res = await fetch(`${BACKEND_URL}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: 'document',
                    content: this.serverDocumentContext,
                    language: LANG_NAMES[this.currentLanguage] || 'English',
                    session_id: this.sessionId,
                }),
                signal: AbortSignal.timeout(90000),
            });

            if (!res.ok) { bodyEl.innerHTML = prev; return; }

            const data = await res.json();
            const updated = {
                ...this.analysisResult,
                summary: data.summary || this.analysisResult.summary,
                deadlines: data.deadlines || this.analysisResult.deadlines,
                requirements: data.required_actions || this.analysisResult.requirements,
                whatTheyAskYouToDo: data.what_they_are_asking_you_to_do || this.analysisResult.whatTheyAskYouToDo,
                whatYouMustProvide: data.what_you_must_provide_or_submit || this.analysisResult.whatYouMustProvide,
                timeline: data.timeline || this.analysisResult.timeline,
                recommendations: data.recommendations || this.analysisResult.recommendations,
                consequencesIfIgnored: data.consequences_if_ignored || this.analysisResult.consequencesIfIgnored,
                appealRights: data.appeal_rights || this.analysisResult.appealRights,
                urgencyLevel: data.urgency_level || this.analysisResult.urgencyLevel,
                urgencyActions: data.urgency_actions || this.analysisResult.urgencyActions,
            };
            this.showAnalysisSummaryBox(updated);
        } catch {
            bodyEl.innerHTML = prev;
        }
    }

    setupAgencyTabs() {
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                const tabName = e.target.getAttribute('data-tab');
                this.switchAgencyTab(tabName, e.target);
            });
        });
    }

    switchAgencyTab(tabName, btn) {
        document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        if (btn) btn.classList.add('active');
        const content = document.getElementById(tabName + '-content');
        if (content) content.classList.add('active');
    }

    // ── Upload state machine ─────────────────────────────────────────────────

    setUploadState(state) {
        this.uploadState = state;
        const dzIdle   = document.getElementById('dzIdle');
        const dzFile   = document.getElementById('dzFile');
        const track    = document.getElementById('processTrack');
        const ready    = document.getElementById('docReadyCard');
        const dropzone = document.getElementById('dropzoneLabel');

        const hide = el => { if (el) el.style.display = 'none'; };
        const show = (el, d = 'flex') => { if (el) el.style.display = d; };

        // Reset all to hidden
        hide(dzIdle); hide(dzFile); hide(track); hide(ready);

        switch (state) {
            case UPLOAD_STATE.IDLE:
                show(dzIdle);
                if (dropzone) dropzone.style.pointerEvents = 'auto';
                break;

            case UPLOAD_STATE.FILE:
                show(dzFile);
                if (dropzone) dropzone.style.pointerEvents = 'auto';
                break;

            case UPLOAD_STATE.PROCESSING:
                show(dzFile);
                show(track);
                if (dropzone) dropzone.style.pointerEvents = 'none';
                this.resetProcessSteps();
                break;

            case UPLOAD_STATE.READY:
                show(dzFile);
                show(ready);
                if (dropzone) dropzone.style.pointerEvents = 'none';
                break;
        }
    }

    resetProcessSteps() {
        ['pStep1','pStep2','pStep3'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.classList.remove('active','done'); }
        });
        document.querySelectorAll('.process-connector').forEach(c => c.classList.remove('done'));
    }

    advanceStep(n) {
        // Mark steps 1..n-1 as done, step n as active
        for (let i = 1; i <= 3; i++) {
            const el = document.getElementById(`pStep${i}`);
            if (!el) continue;
            el.classList.remove('active','done');
            if (i < n) el.classList.add('done');
            else if (i === n) el.classList.add('active');
        }
        // Mark connectors
        const connectors = document.querySelectorAll('.process-connector');
        connectors.forEach((c, idx) => {
            c.classList.toggle('done', idx < n - 1);
        });
    }

    resetToIdle() {
        this.uploadedFile = null;
        this.documentAnalyzed = false;
        this.analysisResult = null;
        this.serverDocumentContext = null;
        const fileInput = document.getElementById('fileUpload');
        if (fileInput) fileInput.value = '';
        this.setUploadState(UPLOAD_STATE.IDLE);
        const box = document.getElementById('analysisSummaryBox');
        if (box) box.style.display = 'none';
        const body = document.getElementById('analysisSummaryText');
        if (body) body.textContent = '';
    }

    setFileDisplay(file) {
        const ext = file.name.split('.').pop().toUpperCase() || 'FILE';
        const badge = document.getElementById('fileTypeBadge');
        const nameEl = document.getElementById('fileName');
        const sizeEl = document.getElementById('fileSize');

        if (badge) {
            badge.textContent = ext;
            const colors = { PDF: '#dc2626', JPG: '#7c3aed', JPEG: '#7c3aed',
                             PNG: '#2563eb', DOCX: '#0369a1', TXT: '#374151', WEBP: '#7c3aed' };
            badge.style.background = colors[ext] || '#374151';
        }
        if (nameEl) nameEl.textContent = file.name;
        if (sizeEl) {
            const kb = file.size / 1024;
            sizeEl.textContent = kb >= 1024 ? `${(kb/1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
        }
    }

    setDocumentReady(docType) {
        const typeEl = document.getElementById('docReadyType');
        if (typeEl) typeEl.textContent = docType || 'Government Document';
        this.setUploadState(UPLOAD_STATE.READY);
    }

    showAnalysisSummaryBox(analysis) {
        const box  = document.getElementById('analysisSummaryBox');
        const body = document.getElementById('analysisSummaryText');
        if (!box || !body) return;

        const L = BOX_LABELS[this.currentLanguage] || BOX_LABELS.en;

        // Update the box header title
        const headerSpan = box.querySelector('.asb-header span');
        if (headerSpan) headerSpan.textContent = L.header;

        const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

        const section = (label, content) =>
            `<div class="asb-section">` +
            `<div class="asb-label">${label}</div>` +
            `<div class="asb-content">${content}</div>` +
            `</div>`;

        const list = items =>
            '<ul class="asb-list">' +
            items.map(i => `<li>${esc(i)}</li>`).join('') +
            '</ul>';

        const checklist = items =>
            '<ul class="asb-checklist">' +
            items.map((i, idx) =>
                `<li><label class="asb-check-item">` +
                `<input type="checkbox" class="asb-checkbox" data-idx="${idx}">` +
                `<span class="asb-check-text">${esc(i)}</span>` +
                `</label></li>`
            ).join('') +
            '</ul>';

        let html = `<div style="font-size:0.73rem;font-weight:600;color:var(--primary-dark);margin-bottom:0.5rem;">Based on this letter, here's what matters most for you right now.</div>`;

        if (analysis.summary) {
            const lvl = (analysis.urgencyLevel || 'low').toLowerCase();
            const urgencyLine = {
                critical: { icon: '🚨', color: '#dd2244', text: 'Critical urgency — this is serious and needs your action immediately, within days. Ignoring it could lead to major consequences.' },
                high:     { icon: '⚠️', color: '#7744cc', text: 'High urgency — act soon, within the next few weeks, to avoid penalties or losing your options.' },
                medium:   { icon: '📋', color: '#0077aa', text: 'Moderate urgency — handle this before the stated deadline, but you have some time.' },
                low:      { icon: '✓',  color: '#1a7a45', text: 'Low urgency — no immediate deadline, but review it when you can.' },
            }[lvl] || null;
            let summaryHtml = `<p>${esc(analysis.summary)}</p>`;
            if (urgencyLine) {
                summaryHtml += `<p style="margin-top:0.4rem;font-weight:600;color:${urgencyLine.color};">${urgencyLine.icon} ${urgencyLine.text}</p>`;
            }
            html += section(L.summary, summaryHtml);
        }

        if (analysis.deadlines && analysis.deadlines.length) {
            html += section(L.deadlines, list(analysis.deadlines));
        }

        if (analysis.whatTheyAskYouToDo && analysis.whatTheyAskYouToDo.length) {
            html += section(L.whatAsked, checklist(analysis.whatTheyAskYouToDo));
        } else if (analysis.requirements && analysis.requirements.length) {
            html += section(L.whatAsked, checklist(analysis.requirements));
        }

        if (analysis.whatYouMustProvide && analysis.whatYouMustProvide.length) {
            html += section(L.whatProvide, checklist(analysis.whatYouMustProvide));
        }

        if (analysis.consequencesIfIgnored) {
            html += section(L.ifIgnored, `<p>${esc(analysis.consequencesIfIgnored)}</p>`);
        }

        if (analysis.recommendations && analysis.recommendations.length) {
            html += section(L.recommendations, list(analysis.recommendations));
        }

        if (analysis.appealRights) {
            html += section(L.appealRights, `<p>${esc(analysis.appealRights)}</p>`);
        }

        const urgLevel = (analysis.urgencyLevel || 'low').toLowerCase();
        if (urgLevel === 'critical' || urgLevel === 'high' || (analysis.urgencyActions && analysis.urgencyActions.length)) {
            const urgClass = urgLevel === 'critical' ? 'asb-urgency-critical' : urgLevel === 'high' ? 'asb-urgency-high' : 'asb-urgency-medium';
            const urgIcon  = urgLevel === 'critical' ? '🚨' : urgLevel === 'high' ? '⚠️' : '📋';
            const urgTitle = urgLevel === 'critical' ? L.crisis : urgLevel === 'high' ? L.urgent : L.actionNeeded;
            let urgContent = `<div class="asb-urgency-badge">${urgIcon} ${urgTitle}</div>`;
            if (analysis.urgencyActions && analysis.urgencyActions.length) {
                urgContent += '<ul class="asb-list">' + analysis.urgencyActions.map(a => `<li>${esc(a)}</li>`).join('') + '</ul>';
            }
            html += `<div class="asb-section ${urgClass}">${urgContent}</div>`;
        }

        if (!html) {
            html = '<p style="color:var(--gray-400);font-style:italic">No summary available.</p>';
        }

        html += `<div style="margin-top:0.6rem;padding:0.45rem 0.6rem;background:#fffbe6;border:1px solid #f5c842;border-radius:5px;font-size:0.68rem;color:#7a5f00;line-height:1.5;">⚠️ <strong>AI Limitation:</strong> Mistranslations or missed deadlines could affect real legal outcomes for you or your family. AI may miss details in low-quality scans or handwritten notes. Always verify exact dates and amounts directly against your original letter before taking action.</div>`;

        body.innerHTML = html;
        box.style.display = 'block';
        body.scrollTop = 0;

        // Listen for all checkboxes checked — show completion message
        const checkboxes = body.querySelectorAll('.asb-checkbox');
        if (checkboxes.length > 0) {
            checkboxes.forEach(cb => {
                cb.addEventListener('change', () => {
                    const all = body.querySelectorAll('.asb-checkbox');
                    const allChecked = Array.from(all).every(c => c.checked);
                    const existing = body.querySelector('.asb-complete-msg');
                    if (allChecked && !existing) {
                        const msg = document.createElement('div');
                        msg.className = 'asb-complete-msg';
                        msg.innerHTML = `✓ You've reviewed everything. You're prepared — now take that first step.`;
                        body.appendChild(msg);
                        msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    } else if (!allChecked && existing) {
                        existing.remove();
                    }
                });
            });
        }

        // Pulse animation and scroll into view
        box.classList.remove('summary-ready');
        void box.offsetWidth; // force reflow to re-trigger animation
        box.classList.add('summary-ready');
        setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }

    // ── File handling ───────────────────────────────────────────────────────

    handleFileUpload(e) {
        const file = (e.target && e.target.files) ? e.target.files[0] : null;
        if (!file) return;
        if (window.security && !window.security.validateFile(file)) {
            this.showUploadError('Invalid file type or size exceeds 10 MB limit.');
            return;
        }
        this.uploadedFile = file;
        this.setFileDisplay(file);
        this.setUploadState(UPLOAD_STATE.FILE);
        // Auto-analyze immediately
        this.analyzeDocument();
    }

    handleDragOver(e) {
        e.preventDefault(); e.stopPropagation();
        const dz = document.getElementById('dropzoneLabel');
        if (dz) dz.classList.add('drag-over');
    }

    handleDragLeave(e) {
        e.preventDefault(); e.stopPropagation();
        const dz = document.getElementById('dropzoneLabel');
        if (dz) dz.classList.remove('drag-over');
    }

    handleDrop(e) {
        e.preventDefault(); e.stopPropagation();
        const dz = document.getElementById('dropzoneLabel');
        if (dz) dz.classList.remove('drag-over');
        if (this.uploadState === UPLOAD_STATE.PROCESSING) return;
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const fileInput = document.getElementById('fileUpload');
            if (fileInput) fileInput.files = files;
            this.handleFileUpload({ target: { files } });
        }
    }

    showUploadError(msg) {
        this.setUploadState(UPLOAD_STATE.IDLE);
        this.addBotMessage(`⚠️ ${msg}`);
    }

    // ── Document analysis ───────────────────────────────────────────────────

    async analyzeDocument() {
        if (!this.uploadedFile) return;

        this.setUploadState(UPLOAD_STATE.PROCESSING);
        this.advanceStep(1);
        await this.delay(400);
        this.advanceStep(2);

        try {
            // Always call the backend — document analysis requires real extraction.
            // backendAvailable tracks chat health only; uploads are always attempted.
            const analysisPromise = this.analyzeWithBackend();
            await this.delay(1800);
            this.advanceStep(3);
            const analysis = await analysisPromise;

            // Mark steps done
            ['pStep1','pStep2','pStep3'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.classList.remove('active'); el.classList.add('done'); }
            });
            document.querySelectorAll('.process-connector').forEach(c => c.classList.add('done'));
            await this.delay(500);

            this.analysisResult = analysis;
            this.documentAnalyzed = true;
            this.setDocumentReady(analysis.documentType);
            this.addDetailedAnalysisToChat(analysis);
            this.showAnalysisSummaryBox(analysis);
            this.showEmergencySupportInChat(analysis);

            // For critical docs, auto-surface human resources in chat immediately
            if ((analysis.urgencyLevel || '').toLowerCase() === 'critical') {
                this.showHumanResources();
            }

        } catch (error) {
            console.error('Document analysis failed:', error);
            this.setUploadState(UPLOAD_STATE.FILE);
            const msg = error.message || 'Document analysis failed.';
            this.addBotMessage(
                `⚠️ Could not analyze this document: ${msg}\n\n` +
                `Please check:\n` +
                `• The file is a clear, readable PDF or image\n` +
                `• The backend server is running at ${BACKEND_URL}\n` +
                `• Try re-uploading or use a higher-quality scan`
            );
        }
    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    async analyzeWithBackend() {
        const formData = new FormData();
        formData.append('file', this.uploadedFile);
        formData.append('language', LANG_NAMES[this.currentLanguage] || 'English');
        formData.append('session_id', this.sessionId);

        const res = await fetch(`${BACKEND_URL}/upload`, {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(180000),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || 'Backend analysis failed');
        }

        const data = await res.json();
        this.backendAvailable = true;

        // Store the full extracted text returned by the server (PII-scrubbed).
        // This is the primary source of truth for all follow-up chat requests.
        if (data.document_context && data.document_context.trim()) {
            this.serverDocumentContext = data.document_context.trim();
        }

        const result = {
            source: 'ai',
            summary: data.summary || '',
            documentType: data.document_type || 'Government Document',
            deadlines: data.deadlines || [],
            requirements: data.required_actions || [],
            whatTheyAskYouToDo: data.what_they_are_asking_you_to_do || [],
            whatYouMustProvide: data.what_you_must_provide_or_submit || [],
            timeline: data.timeline || '',
            recommendations: data.recommendations || [],
            potentialBenefits: (data.potential_benefits || []).map(b => ({ name: '', description: b })),
            consequencesIfIgnored: data.consequences_if_ignored || '',
            appealRights: data.appeal_rights || '',
            piiDetected: data.pii_detected || false,
            urgencyLevel: data.urgency_level || 'low',
            urgencyActions: data.urgency_actions || [],
        };

        // If server didn't return full text, build a structured context from analysis fields
        // so the chatbot always has document knowledge even in degraded conditions.
        if (!this.serverDocumentContext) {
            this.serverDocumentContext = this._buildContextFromAnalysis(result);
        }

        return result;
    }

    // ── Local fallback ───────────────────────────────────────────────────────

    async performLocalAnalysis() {
        const content = this.documentContent || 'Government document requiring attention.';
        this.documentContext = this.extractDocumentContext(content);
        return {
            source: 'local',
            summary: this.generateContextualSummary(content),
            documentType: 'Government Document',
            deadlines: [],
            requirements: this.generateContextualActionsList(content),
            whatTheyAskYouToDo: [],
            whatYouMustProvide: [],
            timeline: this.generateContextualTimeline(content),
            recommendations: [],
            potentialBenefits: this.identifyPotentialBenefits(content),
            consequencesIfIgnored: '',
            appealRights: '',
            piiDetected: false,
        };
    }

    extractDocumentContext(content) {
        return {
            mentionsDeadline:   /deadline|due|submit by|before|expires?/i.test(content),
            mentionsIncome:     /income|salary|wage|earnings|financial/i.test(content),
            mentionsIdentity:   /identity|passport|visa|green card|ssn|social security/i.test(content),
            mentionsAddress:    /address|residence|home|apartment|house|proof of address/i.test(content),
            mentionsEmployment: /employment|job|work|employer/i.test(content),
            mentionsHealth:     /health|medical|doctor|hospital|insurance/i.test(content),
            mentionsHousing:    /housing|rent|lease|landlord|eviction/i.test(content),
            mentionsBenefits:   /benefit|assistance|aid|welfare|medicaid/i.test(content),
        };
    }

    generateContextualSummary(content) {
        let s = 'This is an official government document requiring your attention. ';
        const ctx = this.documentContext;
        if (ctx.mentionsIdentity) s += 'It involves identity or immigration status. ';
        if (ctx.mentionsIncome)   s += 'It requests financial or income information. ';
        if (ctx.mentionsHousing)  s += 'It relates to housing or residency. ';
        s += 'Review all requirements and respond before any stated deadline.';
        return s;
    }

    generateContextualActionsList() {
        return [
            'Read the entire document carefully',
            'Identify the main request and stated deadline',
            'Gather all required supporting documents',
            'Submit your response following the exact format requested',
            'Keep copies of everything you submit',
        ];
    }

    generateContextualTimeline() {
        return 'Most government deadlines are 10–30 days from the letter date. Contact the agency immediately if you cannot meet the deadline to request an extension.';
    }

    identifyPotentialBenefits(content) {
        const ctx = this.documentContext;
        const benefits = [];
        if (ctx.mentionsIncome && ctx.mentionsHealth)
            benefits.push({ name: 'Medicaid', description: 'Based on your income, you may qualify for Medicaid health coverage.' });
        if (ctx.mentionsEmployment)
            benefits.push({ name: 'Unemployment Insurance', description: 'If unemployed or underemployed, you may be eligible for unemployment benefits.' });
        return benefits;
    }

    // ── Chat analysis display ────────────────────────────────────────────────

    addDetailedAnalysisToChat(analysis) {
        const messagesDiv = document.getElementById('messages');
        if (!messagesDiv) return;

        // Crisis banner — injected first for critical/high urgency
        const urgLevel = (analysis.urgencyLevel || '').toLowerCase();
        if (urgLevel === 'critical') {
            const banner = document.createElement('div');
            banner.className = 'crisis-banner';
            banner.innerHTML = `<strong>🚨 URGENT ACTION REQUIRED</strong><span>This document has a critical deadline or serious consequence. Read the steps below carefully and contact a real person for help today.</span>`;
            messagesDiv.appendChild(banner);
        } else if (urgLevel === 'high') {
            const banner = document.createElement('div');
            banner.className = 'crisis-banner';
            banner.style.background = '#7744cc';
            banner.innerHTML = `<strong>⚠️ Action Required Soon</strong><span>This document requires your attention within 30 days. Review the steps below and reach out if you need help.</span>`;
            messagesDiv.appendChild(banner);
        }

        // Intro message
        this.addBotMessage(`Document received and analyzed. Here's a full breakdown:`);

        // Summary card
        if (analysis.summary) {
            const card = this.makeAnalysisCard('acb-blue', '📄 Document Summary', [
                { text: analysis.summary, numbered: false }
            ]);
            messagesDiv.appendChild(card);
        }

        // What they're asking you to do
        if (analysis.whatTheyAskYouToDo && analysis.whatTheyAskYouToDo.length) {
            const card = this.makeAnalysisCard('acb-blue', '📌 What This Document Asks You To Do',
                analysis.whatTheyAskYouToDo.map((a, i) => ({ text: a, num: i + 1 }))
            );
            messagesDiv.appendChild(card);
        }

        // What you must provide
        if (analysis.whatYouMustProvide && analysis.whatYouMustProvide.length) {
            const card = this.makeAnalysisCard('acb-amber', '📂 Documents & Items You Must Provide',
                analysis.whatYouMustProvide.map(item => ({ text: item, bullet: true }))
            );
            messagesDiv.appendChild(card);
        }

        // Deadlines — always show, even if empty
        const deadlineItems = (analysis.deadlines && analysis.deadlines.length)
            ? analysis.deadlines.map(d => ({ text: d, bullet: true }))
            : [{ text: 'No specific deadlines extracted. Check the original document for any dates.', bullet: true }];
        const deadlineCard = this.makeAnalysisCard('acb-red', '⏰ Deadlines & Key Dates', deadlineItems);
        messagesDiv.appendChild(deadlineCard);

        // Required actions / next steps
        const reqItems = (analysis.requirements && analysis.requirements.length)
            ? analysis.requirements.map((r, i) => ({ text: r, num: i + 1 }))
            : null;
        if (reqItems) {
            const card = this.makeAnalysisCard('acb-blue', '✅ Required Next Steps', reqItems);
            messagesDiv.appendChild(card);
        }

        // Timeline
        if (analysis.timeline) {
            const card = this.makeAnalysisCard('acb-purple', '📅 Timeline', [
                { text: analysis.timeline, numbered: false }
            ]);
            messagesDiv.appendChild(card);
        }

        // Recommendations
        if (analysis.recommendations && analysis.recommendations.length) {
            const card = this.makeAnalysisCard('acb-green', '💡 Recommendations',
                analysis.recommendations.map((r, i) => ({ text: r, num: i + 1 }))
            );
            messagesDiv.appendChild(card);
        }

        // Appeal rights
        if (analysis.appealRights) {
            const card = this.makeAnalysisCard('acb-purple', '⚖️ Your Appeal Rights', [
                { text: analysis.appealRights, numbered: false }
            ]);
            messagesDiv.appendChild(card);
        }

        // Potential benefits
        if (analysis.potentialBenefits && analysis.potentialBenefits.length) {
            const card = this.makeAnalysisCard('acb-green', '🎯 Potential Benefits You May Qualify For',
                analysis.potentialBenefits.map(b => ({
                    text: b.name ? `<strong>${b.name}:</strong> ${b.description}` : b.description,
                    bullet: true, html: true
                }))
            );
            messagesDiv.appendChild(card);
        }

        // PII note if detected
        if (analysis.piiDetected) {
            const notice = document.createElement('div');
            notice.className = 'bubble bot';
            notice.style.cssText = 'font-size:0.75rem;color:var(--gray-500);background:#fffbeb;border:1px solid #fde68a;';
            notice.textContent = '🔒 Personal identifiers (SSN, A-number, etc.) were detected and scrubbed before processing. Your data is never stored.';
            messagesDiv.appendChild(notice);
        }

        // Follow-up prompt
        const followup = document.createElement('div');
        followup.className = 'bubble bot';
        followup.textContent = 'Have questions about this document? Ask me anything — deadlines, what forms to fill out, what to say, or what happens if you miss a deadline.';
        messagesDiv.appendChild(followup);

        this.scrollToBottom();
    }

    makeAnalysisCard(colorClass, title, items) {
        const bubble = document.createElement('div');
        bubble.className = `bubble analysis-card-bubble ${colorClass}`;

        const header = document.createElement('div');
        header.className = 'acb-header';
        header.textContent = title;
        bubble.appendChild(header);

        const body = document.createElement('div');
        body.className = 'acb-body';

        if (items.length === 1 && !items[0].num && !items[0].bullet) {
            // Single paragraph — just render inline
            if (items[0].html) {
                body.innerHTML = `<div class="acb-item-text" style="padding:0.1rem 0">${items[0].text}</div>`;
            } else {
                const p = document.createElement('div');
                p.className = 'acb-item-text';
                p.style.padding = '0.1rem 0';
                p.textContent = items[0].text;
                body.appendChild(p);
            }
        } else {
            items.forEach(item => {
                const row = document.createElement('div');
                row.className = 'acb-item';

                const num = document.createElement('div');
                num.className = 'acb-item-num';
                if (item.num) num.textContent = item.num;
                else if (item.bullet) num.textContent = '•';
                row.appendChild(num);

                const text = document.createElement('div');
                text.className = 'acb-item-text';
                if (item.html) text.innerHTML = item.text;
                else text.textContent = item.text;
                row.appendChild(text);

                body.appendChild(row);
            });
        }

        bubble.appendChild(body);
        return bubble;
    }

    // ── Chat ─────────────────────────────────────────────────────────────────

    async handleChatSubmit(e) {
        e.preventDefault();
        const chatInput = document.getElementById('chatInput');
        const message = chatInput.value.trim();
        if (!message) return;

        let sanitized = message;
        if (window.security) sanitized = window.security.validateChatMessage(message);
        if (!sanitized) return;

        this.addUserMessage(sanitized);
        this.conversationHistory.push({ role: 'user', content: sanitized });
        chatInput.value = '';

        this.extractUserBackground(sanitized);
        const typingId = this.showTypingIndicator();

        let response;
        try {
            if (this.backendAvailable !== false) {
                response = await this.chatWithBackend(sanitized);
            }
        } catch (err) {
            console.warn('Backend chat failed:', err);
            this.backendAvailable = false;
        }

        if (!response) response = await this.generateLocalBotResponse(sanitized);

        this.removeTypingIndicator(typingId);
        this.addBotMessage(response);
        this.conversationHistory.push({ role: 'assistant', content: response });
        this.addClarityPrompt();
    }

    // Build a structured text block from analysis fields when full document text isn't available
    _buildContextFromAnalysis(a) {
        if (!a || !a.documentType) return null;
        const lines = [
            `Document Type: ${a.documentType}`,
            a.summary ? `Summary: ${a.summary}` : '',
            a.deadlines?.length    ? `Deadlines:\n${a.deadlines.map(d => '- ' + d).join('\n')}` : '',
            a.requirements?.length ? `Required Actions:\n${a.requirements.map(r => '- ' + r).join('\n')}` : '',
            a.whatTheyAskYouToDo?.length ? `What They Ask You To Do:\n${a.whatTheyAskYouToDo.map(x => '- ' + x).join('\n')}` : '',
            a.whatYouMustProvide?.length  ? `Documents/Forms to Submit:\n${a.whatYouMustProvide.map(x => '- ' + x).join('\n')}` : '',
            a.timeline             ? `Timeline: ${a.timeline}` : '',
            a.consequencesIfIgnored ? `Consequences if Ignored: ${a.consequencesIfIgnored}` : '',
            a.appealRights         ? `Appeal Rights: ${a.appealRights}` : '',
            a.recommendations?.length ? `Recommendations:\n${a.recommendations.map(r => '- ' + r).join('\n')}` : '',
        ];
        return lines.filter(Boolean).join('\n\n');
    }

    async chatWithBackend(message) {
        const body = {
            message,
            language: LANG_NAMES[this.currentLanguage] || 'English',
            session_id: this.sessionId,
        };

        // Always attach document context to every request — this is the only reliable
        // way to ensure the AI has the document data regardless of server session state.
        if (this.serverDocumentContext) {
            body.document_context = this.serverDocumentContext;
        }

        const res = await fetch(`${BACKEND_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-Id': this.sessionId },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || 'Chat API error');
        }

        const data = await res.json();
        this.backendAvailable = true;
        return data.response;
    }

    // ── Fix #2: Emergency support surfaced in chat ───────────────────────────

    showEmergencySupportInChat(analysis) {
        const level = (analysis.urgencyLevel || '').toLowerCase();
        if (level !== 'critical' && level !== 'high') return;

        const docType = (analysis.documentType || '').toLowerCase();
        const agencies = [];

        if (/immigr|uscis|visa|deport|asylum|green card|i-\d/i.test(docType)) {
            agencies.push({ name: 'USCIS (Immigration)', phone: '1-800-375-5283', note: 'Immigration, visas, green cards, deportation' });
            agencies.push({ name: 'Immigration Legal Aid', phone: '1-800-342-3661', note: 'Free immigration legal help' });
        }
        if (/tax|irs|income|refund|w-2|1099/i.test(docType)) {
            agencies.push({ name: 'IRS Helpline', phone: '1-800-829-1040', note: 'Tax questions & payment plans' });
        }
        if (/evict|housing|hud|rent|landlord|lease/i.test(docType)) {
            agencies.push({ name: 'HUD Housing Hotline', phone: '1-800-569-4287', note: 'Eviction help & housing rights' });
        }
        if (/social security|ssa|disability|benefit/i.test(docType)) {
            agencies.push({ name: 'Social Security (SSA)', phone: '1-800-772-1213', note: 'Benefits, SSN, work authorization' });
        }
        if (/medicaid|medicare|health|cms|insurance/i.test(docType)) {
            agencies.push({ name: 'Medicaid / CMS', phone: '1-800-633-4227', note: 'Healthcare & coverage questions' });
        }
        // Always include 211 as universal fallback
        agencies.push({ name: '211 Community Resources', phone: '211', note: 'Local crisis support, food, shelter, legal aid' });

        const messagesDiv = document.getElementById('messages');
        if (!messagesDiv) return;

        const card = document.createElement('div');
        const isCritical = level === 'critical';
        card.className = `bubble bot emergency-support-bubble${isCritical ? '' : ' esb-high'}`;
        card.innerHTML =
            `<div class="esb-header">${isCritical ? '🚨 CRISIS — Speak to a real person now' : '⚠️ Support resources for your situation'}</div>` +
            `<p class="esb-sub">${isCritical ? 'This is urgent. Call one of these free services today:' : 'You can speak with a real person for free:'}</p>` +
            agencies.map(a =>
                `<div class="esb-agency">` +
                `<span class="esb-name">${a.name}</span>` +
                `<a class="esb-phone" href="tel:${a.phone}">${a.phone}</a>` +
                `<span class="esb-note">${a.note}</span>` +
                `</div>`
            ).join('');
        messagesDiv.appendChild(card);
        this.scrollToBottom();
    }

    // ── Fix #4: Confidence signal after bot responses ────────────────────────

    addClarityPrompt() {
        const messagesDiv = document.getElementById('messages');
        if (!messagesDiv) return;

        const prompt = document.createElement('div');
        prompt.className = 'clarity-prompt';
        prompt.innerHTML =
            `<div class="cp-row"><span class="cp-label">Was this clear?</span>` +
            `<button class="cp-btn cp-yes" type="button">✓ Yes, got it</button>` +
            `<button class="cp-btn cp-simplify" type="button">↓ Simplify</button></div>` +
            `<button class="cp-btn cp-human" type="button">🤝 Need human help? Get free support</button>`;

        prompt.querySelector('.cp-yes').addEventListener('click', () => {
            prompt.innerHTML = '<span class="cp-confirmed">👍 Got it — ask another question any time.</span>';
        });

        prompt.querySelector('.cp-simplify').addEventListener('click', () => {
            prompt.remove();
            const chatInput = document.getElementById('chatInput');
            if (chatInput) {
                chatInput.value = 'Can you explain that more simply, step by step?';
                document.getElementById('chatForm')?.requestSubmit();
            }
        });

        prompt.querySelector('.cp-human').addEventListener('click', () => {
            prompt.remove();
            this.showHumanResources();
        });

        messagesDiv.appendChild(prompt);
        this.scrollToBottom();
    }

    showHumanResources() {
        const messagesDiv = document.getElementById('messages');
        if (!messagesDiv) return;

        // Build a combined signal string from docType + summary to improve matching accuracy
        const docType = (this.analysisResult?.documentType || '').toLowerCase();
        const summary = (this.analysisResult?.summary || '').toLowerCase();
        const signal = docType + ' ' + summary;

        const resourceMap = {
            immigration: [
                { name: 'USCIS — Free Info Line', desc: 'Immigration, visas, green cards, citizenship', contact: '1-800-375-5283', url: 'https://www.uscis.gov' },
                { name: 'National Immigration Law Center', desc: 'Free legal guidance for low-income immigrants', contact: null, url: 'https://www.nilc.org' },
                { name: 'DOJ Accredited Representatives', desc: 'Find free or low-cost legal help near you', contact: null, url: 'https://www.justice.gov/eoir/list-of-free-legal-service-providers' },
            ],
            tax: [
                { name: 'IRS Free File & VITA', desc: 'Free tax help for income under $67,000', contact: '1-800-829-1040', url: 'https://www.irs.gov/freefile' },
                { name: 'Taxpayer Advocate Service', desc: 'Free IRS help if you\'re facing hardship', contact: '1-877-777-4778', url: 'https://www.taxpayeradvocate.irs.gov' },
                { name: 'AARP Tax-Aide', desc: 'Free in-person tax prep assistance', contact: null, url: 'https://www.aarp.org/money/taxes/aarp_taxaide' },
            ],
            housing: [
                { name: 'HUD Housing Counseling', desc: 'Free housing advice and eviction prevention', contact: '1-800-569-4287', url: 'https://www.hud.gov/findacounselor' },
                { name: 'National Low Income Housing Coalition', desc: 'Emergency rental assistance resources', contact: null, url: 'https://nlihc.org/rental-assistance' },
                { name: 'Legal Aid Society', desc: 'Free housing legal help for low-income individuals', contact: null, url: 'https://www.lawhelp.org' },
            ],
            healthcare: [
                { name: 'CMS — Medicaid & Medicare Help', desc: 'Free healthcare coverage assistance', contact: '1-800-633-4227', url: 'https://www.cms.gov' },
                { name: 'HealthCare.gov Navigator', desc: 'Free enrollment help for health insurance plans', contact: null, url: 'https://www.healthcare.gov/find-assistance' },
                { name: 'HRSA Free Clinics', desc: 'Find a free or sliding-scale health clinic near you', contact: null, url: 'https://findahealthcenter.hrsa.gov' },
            ],
            education: [
                { name: 'Federal Student Aid (FAFSA Help)', desc: 'Free financial aid assistance', contact: '1-800-433-3243', url: 'https://studentaid.gov' },
                { name: 'Department of Education Ombudsman', desc: 'Free loan dispute resolution', contact: '1-877-557-2575', url: 'https://studentaid.gov/feedback-center' },
                { name: 'NADE — Education Advocacy', desc: 'Support navigating school-related letters', contact: null, url: 'https://www.nadeducation.org' },
            ],
        };

        // Match using combined signal — tax checked before immigration to avoid false defaults
        let resources = null;
        if (/tax|irs|internal revenue|1099|w-2|w2|income tax|refund|filing|audit/.test(signal)) resources = resourceMap.tax;
        else if (/hous|rent|evict|landlord|hud|lease/.test(signal)) resources = resourceMap.housing;
        else if (/health|medical|medicar|medicaid|cms|hospital|discharge/.test(signal)) resources = resourceMap.healthcare;
        else if (/school|educat|student|loan|fafsa/.test(signal)) resources = resourceMap.education;
        else if (/immig|visa|green card|uscis|asylum|citizen|deport/.test(signal)) resources = resourceMap.immigration;
        else resources = resourceMap.immigration;

        const panel = document.createElement('div');
        panel.className = 'human-resources-panel';
        panel.innerHTML = `<div class="hrp-title">🤝 Free Human Support — 3 Resources for You</div>` +
            resources.map(r =>
                `<div class="hrp-card">
                    <strong>${r.name}</strong>
                    <span>${r.desc}</span>
                    ${r.contact ? `<span>📞 ${r.contact}</span>` : ''}
                    <a href="${r.url}" target="_blank" rel="noopener">Visit website →</a>
                </div>`
            ).join('');

        messagesDiv.appendChild(panel);
        this.scrollToBottom();
    }

    // ── Typing indicator ─────────────────────────────────────────────────────

    showTypingIndicator() {
        const messagesDiv = document.getElementById('messages');
        if (!messagesDiv) return null;
        const id = 'typing-' + Date.now();
        const el = document.createElement('div');
        el.className = 'bubble bot typing-indicator';
        el.id = id;
        el.innerHTML = '<span></span><span></span><span></span>';
        messagesDiv.appendChild(el);
        this.scrollToBottom();
        return id;
    }

    removeTypingIndicator(id) {
        if (!id) return;
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    scrollToBottom() {
        const messagesDiv = document.getElementById('messages');
        if (messagesDiv) messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: 'smooth' });
    }

    // ── Greeting ─────────────────────────────────────────────────────────────

    addInitialBotGreeting() {
        const messagesDiv = document.getElementById('messages');
        if (messagesDiv && messagesDiv.children.length === 0) {
            const greeting = document.createElement('div');
            greeting.className = 'bubble bot';
            greeting.textContent = this.getTranslation('bot_greeting');
            messagesDiv.appendChild(greeting);
        }
    }

    // ── Local fallback chat response ─────────────────────────────────────────

    async generateLocalBotResponse(userMessage) {
        const lower = userMessage.toLowerCase();
        let response = '';
        if (this.userBackground.origin) response += `As someone from ${this.userBackground.origin}, `;
        if (/benefit|aid|program|qualify/.test(lower)) return response + this.getTranslation('ai_benefits_response');
        if (/uscis|immigration|visa|green card/.test(lower)) return response + this.getTranslation('ai_uscis_response');
        if (/irs|tax/.test(lower)) return response + this.getTranslation('ai_irs_response');
        if (/social security/.test(lower)) return response + this.getTranslation('ai_social_security_response');
        if (/housing|rent/.test(lower)) return response + this.getTranslation('ai_housing_response');
        if (/school|education/.test(lower)) return response + this.getTranslation('ai_school_response');
        if (/health|medical/.test(lower)) return response + this.getTranslation('ai_health_response');
        if (/deadline|when/.test(lower)) return response + this.getTranslation('ai_deadline_response');
        if (/document|proof/.test(lower)) return response + this.getTranslation('ai_document_response');
        return response + this.getTranslation('ai_default_response');
    }

    extractUserBackground(message) {
        const lower = message.toLowerCase();
        const origins = { mexico:'Mexico', china:'China', india:'India', philippines:'Philippines',
            vietnam:'Vietnam', canada:'Canada', uk:'United Kingdom' };
        for (const [key, val] of Object.entries(origins)) {
            if (lower.includes(key)) { this.userBackground.origin = val; break; }
        }
        if (/citizen/.test(lower)) this.userBackground.citizenshipStatus = 'Citizen';
        else if (/permanent resident|green card/.test(lower)) this.userBackground.citizenshipStatus = 'Permanent Resident';
        else if (/asylum/.test(lower)) this.userBackground.citizenshipStatus = 'Asylum Seeker';
        else if (/visa|work permit/.test(lower)) this.userBackground.citizenshipStatus = 'Visa Holder';
    }

    handleQuickAction(e) {
        const chatInput = document.getElementById('chatInput');
        if (chatInput) { chatInput.value = e.target.textContent; chatInput.focus(); }
    }

    // ── Message display ───────────────────────────────────────────────────────

    addUserMessage(message) {
        const messagesDiv = document.getElementById('messages');
        if (!messagesDiv) return;
        const bubble = document.createElement('div');
        bubble.className = 'bubble user';
        bubble.textContent = message;
        messagesDiv.appendChild(bubble);
        this.scrollToBottom();
    }

    addBotMessage(message) {
        const messagesDiv = document.getElementById('messages');
        if (!messagesDiv) return;
        const bubble = document.createElement('div');
        bubble.className = 'bubble bot';
        bubble.innerHTML = message.replace(/\n/g, '<br>');
        messagesDiv.appendChild(bubble);
        this.scrollToBottom();
    }

    // ── Language ──────────────────────────────────────────────────────────────

    updateChatGreeting() {
        const statusEl = document.getElementById('chatStatus');
        if (statusEl) {
            const ready = {
                en:'Ready to help', es:'Listo para ayudar', ar:'جاهز للمساعدة',
                zh:'准备帮助', fr:'Prêt à aider', de:'Bereit zu helfen',
                it:'Pronto ad aiutare', ja:'お手伝いの準備ができています', hi:'मदद के लिए तैयार',
            };
            statusEl.textContent = ready[this.currentLanguage] || 'Ready to help';
        }
    }

    getTranslation(key) {
        if (window.i18n) return window.i18n.t(key);
        return key;
    }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { window.chatbot = new DoclarityChatbot(); });
} else {
    window.chatbot = new DoclarityChatbot();
}
