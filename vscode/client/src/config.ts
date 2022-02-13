import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function resolveSource(): string | undefined {
    const wsFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
    if (wsFolder) {
        const configFile = path.join(wsFolder.uri.fsPath, "c64jasm.json");
        if (fs.existsSync(configFile)) {
            try {
                const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
                if (config.source) {
                    return path.resolve(wsFolder.uri.fsPath, config.source);
                }
            } catch (e) {
                // ignore
            }
        }
    }
    return undefined;
}

export function resolveDisasm(source: string): string | undefined {
    const wsFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
    if (wsFolder) {
        const sourceName = path.basename(source, path.extname(source));
        const outDisasm = path.join(wsFolder.uri.fsPath, 'out', `${sourceName}.disasm`);
        const buildDisasm = path.join(wsFolder.uri.fsPath, 'build', `${sourceName}.disasm`);
        
        if (fs.existsSync(outDisasm)) {
            return outDisasm;
        } else if (fs.existsSync(buildDisasm)) {
            return buildDisasm;
        }
    }
    return undefined;
}
