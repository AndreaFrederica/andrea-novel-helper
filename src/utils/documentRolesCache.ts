import * as vscode from 'vscode';
import { Role } from '../extension';

// docUri -> (Role -> ranges)
const docRoleRanges = new Map<string, Map<Role, vscode.Range[]>>();

export function updateDocumentRoleOccurrences(doc: vscode.TextDocument, roleToRanges: Map<Role, vscode.Range[]>) {
    docRoleRanges.set(doc.uri.toString(), roleToRanges);
}

export function getDocumentRoleOccurrences(doc: vscode.TextDocument): Map<Role, vscode.Range[]> | undefined {
    return docRoleRanges.get(doc.uri.toString());
}

export function clearDocumentRoleOccurrences(doc: vscode.TextDocument) {
    docRoleRanges.delete(doc.uri.toString());
}

export function clearAllDocumentRoleOccurrences() {
    docRoleRanges.clear();
}
