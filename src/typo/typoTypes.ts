import * as vscode from 'vscode';

export type TypoErrorTuple = [wrong: string, correct: string, offset: number, score?: number];

// External API result for a single sentence
export interface TypoApiResult {
    index?: number; // optional, not used for range mapping
    source: string;
    target: string;
    errors: TypoErrorTuple[];
}

export interface ParagraphTypoError {
    wrong: string;
    correct: string;
    offset: number; // character offset relative to paragraph start
    length: number; // wrong.length in UTF-16 code units
    score?: number;
}

export interface ParagraphScanResult {
    paragraphHash: string;
    scannedAt: number;
    paragraphTextSnapshot: string;
    errors: ParagraphTypoError[];
}

export interface DocumentTypoDB {
    paragraphResults: Map<string, ParagraphScanResult>; // key: paragraphHash
    lastAppliedDocVersion?: number; // for diagnostics application bookkeeping
    lastAccessTs?: number; // for LRU eviction across documents
}

export interface SentencePiece {
    text: string;
    startOffset: number; // in paragraph
    endOffset: number;   // in paragraph (exclusive)
}

export interface ParagraphPiece {
    text: string;
    startOffset: number; // absolute within full document
    endOffset: number;   // absolute within full document (exclusive)
    hash: string;
    sentences: SentencePiece[]; // lazily filled when needed
}

export interface TypoDiagnosticsApplyOptions {
    diagnosticCollection: vscode.DiagnosticCollection;
}
