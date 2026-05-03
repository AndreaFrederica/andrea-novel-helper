// @ts-nocheck
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();
    const searchInput = document.getElementById('search');
    const categories = document.getElementById('categories');

    // ── Command Buttons ──────────────────────────────

    document.getElementById('wikiBtn').addEventListener('click', () => {
        vscode.postMessage({ command: 'openExternal', url: 'https://wiki.sirrus.cc/AndreaNovelHelper/' });
    });

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

    // ── Doc Buttons ──────────────────────────────────

    categories.addEventListener('click', event => {
        const btn = event.target.closest('[data-doc-id]');
        if (!btn) return;
        const docId = btn.getAttribute('data-doc-id');
        if (docId) {
            vscode.postMessage({ command: 'showGuideDoc', docId });
        }
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
