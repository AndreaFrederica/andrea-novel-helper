import { updateDecorations } from "../events/updateDecorations";
import { loadRoles } from "../utils/utils";
import * as vscode from 'vscode';

export const refreshRoles = () => {
    loadRoles();
    updateDecorations();
    vscode.window.showInformationMessage('所有库已手动刷新');
};