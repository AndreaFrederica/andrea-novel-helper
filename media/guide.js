// @ts-nocheck
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();
    const searchInput = document.getElementById('search');
    const categories = document.getElementById('categories');

    // ── Command Buttons ──────────────────────────────

    categories.addEventListener('click', event => {
        const btn = event.target.closest('[data-cmd]');
        if (btn) {
            const cmd = btn.getAttribute('data-cmd');
            if (cmd === 'openAnhSettings') {
                vscode.postMessage({ command: 'openAnhSettings' });
            } else if (cmd === 'openVSCodeSettings') {
                vscode.postMessage({ command: 'openVSCodeSettings' });
            } else {
                vscode.postMessage({ command: 'executeCommand', id: cmd });
            }
        }
    });

    // ── Doc Toggle ───────────────────────────────────

    categories.addEventListener('click', event => {
        const btn = event.target.closest('.doc-toggle');
        if (!btn) return;
        const card = btn.closest('.card');
        if (!card) return;
        const doc = card.querySelector('.card-doc');
        if (!doc) return;
        const isOpen = doc.classList.toggle('open');
        btn.textContent = isOpen ? '收起文档' : '查看文档';
    });

    // ── Search / Filter ──────────────────────────────

    function filterCards() {
        const query = (searchInput.value || '').toLowerCase().trim();
        const cards = categories.querySelectorAll('.card');
        const cats = categories.querySelectorAll('.category');

        cards.forEach(card => {
            if (!query) {
                card.classList.remove('hidden');
                return;
            }
            const text = (card.textContent + ' ' + (card.getAttribute('data-keywords') || '')).toLowerCase();
            card.classList.toggle('hidden', text.indexOf(query) === -1);
        });

        cats.forEach(cat => {
            const visibleCards = cat.querySelectorAll('.card:not(.hidden)');
            cat.style.display = visibleCards.length === 0 ? 'none' : '';
        });
    }

    searchInput.addEventListener('input', filterCards);

    // ── Message Handler ──────────────────────────────

    window.addEventListener('message', event => {
        const msg = event.data || {};
        if (msg.command === 'error') {
            // could show a notice, but keep it simple
        }
    });

    vscode.postMessage({ command: 'ready' });
})();
