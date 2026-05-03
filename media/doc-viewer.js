// @ts-nocheck
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();
    const searchInput = document.getElementById('search');
    const navTree = document.getElementById('navTree');
    const docTitle = document.getElementById('docTitle');
    const docContent = document.getElementById('docContent');
    const backBtn = document.getElementById('backBtn');
    const releaseDocsBtn = document.getElementById('releaseDocsBtn');
    const modeToggle = document.getElementById('modeToggle');

    const docsData = window.__DOCS_DATA__ || {};
    const persistedState = vscode.getState() || {};
    let currentDocId = persistedState.currentDocId || null;

    // ── Mode Toggle ──────────────────────────────────

    let currentMode = persistedState.currentMode || 'beginner';

    function persistState() {
        vscode.setState({
            currentDocId,
            currentMode,
            search: searchInput.value || ''
        });
    }

    function applyMode(mode) {
        currentMode = mode || 'beginner';
        docContent.classList.remove('mode-beginner', 'mode-pro');
        docContent.classList.add('mode-' + currentMode);
        modeToggle.querySelectorAll('.mode-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-mode') === currentMode);
        });
        persistState();
    }

    modeToggle.addEventListener('click', event => {
        const btn = event.target.closest('.mode-btn');
        if (!btn) return;
        const mode = btn.getAttribute('data-mode');
        if (!mode || mode === currentMode) return;
        applyMode(mode);
    });

    // ── Build Navigation ─────────────────────────────

    function buildNav() {
        const categories = {};
        for (const [id, doc] of Object.entries(docsData)) {
            if (!categories[doc.categoryId]) {
                categories[doc.categoryId] = {
                    title: doc.category,
                    items: []
                };
            }
            categories[doc.categoryId].items.push({ id, title: doc.title });
        }

        navTree.innerHTML = '';
        for (const [catId, cat] of Object.entries(categories)) {
            const catDiv = document.createElement('div');
            catDiv.className = 'nav-category';
            catDiv.dataset.category = catId;

            const titleDiv = document.createElement('div');
            titleDiv.className = 'nav-category-title';
            titleDiv.textContent = cat.title;
            catDiv.appendChild(titleDiv);

            for (const item of cat.items) {
                const navItem = document.createElement('div');
                navItem.className = 'nav-item';
                navItem.dataset.id = item.id;
                navItem.textContent = item.title;
                navItem.addEventListener('click', () => loadDoc(item.id));
                catDiv.appendChild(navItem);
            }

            navTree.appendChild(catDiv);
        }
    }

    // ── Load Document ────────────────────────────────

    function loadDoc(docId) {
        const doc = docsData[docId];
        if (!doc) { return; }

        currentDocId = docId;
        docTitle.textContent = doc.title;
        docContent.innerHTML = doc.html;
        docContent.classList.add('mode-' + currentMode);
        backBtn.style.display = '';
        releaseDocsBtn.style.display = '';

        // Update active nav item
        navTree.querySelectorAll('.nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === docId);
        });

        // Scroll to top
        docContent.scrollTop = 0;
        persistState();
    }

    // ── Search / Filter ──────────────────────────────

    function filterNav() {
        const query = (searchInput.value || '').toLowerCase().trim();
        const items = navTree.querySelectorAll('.nav-item');
        const cats = navTree.querySelectorAll('.nav-category');

        items.forEach(item => {
            const id = item.dataset.id;
            const doc = docsData[id];
            const text = (doc.title + ' ' + id).toLowerCase();
            item.classList.toggle('hidden', query && text.indexOf(query) === -1);
        });

        cats.forEach(cat => {
            const visibleItems = cat.querySelectorAll('.nav-item:not(.hidden)');
            cat.style.display = visibleItems.length === 0 && query ? 'none' : '';
        });
    }

    searchInput.addEventListener('input', filterNav);
    searchInput.addEventListener('input', persistState);

    // ── Back Button ──────────────────────────────────

    backBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'openGuide' });
    });

    // ── Release Docs Button ──────────────────────────

    releaseDocsBtn.addEventListener('click', () => {
        if (!currentDocId) return;
        vscode.postMessage({ command: 'releaseDocs', docId: currentDocId });
    });

    // ── Message Handler ──────────────────────────────

    window.addEventListener('message', event => {
        const msg = event.data || {};
        if (msg.command === 'loadDoc' && msg.docId) {
            loadDoc(msg.docId);
        }
    });

    // ── Init ─────────────────────────────────────────

    buildNav();
    applyMode(currentMode);
    if (persistedState.search) {
        searchInput.value = persistedState.search;
        filterNav();
    }

    // Load initial doc from URL hash or first doc
    const initialDocId = window.__INITIAL_DOC_ID__ || currentDocId;
    if (initialDocId && docsData[initialDocId]) {
        loadDoc(initialDocId);
    }

    vscode.postMessage({ command: 'ready' });
})();
