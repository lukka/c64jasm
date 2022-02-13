import * as path from 'path';
import * as vscode from 'vscode';
import { workspace, ExtensionContext } from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';

import { C64jasmDebugSession } from './c64jasmDebug';
import { registerCopilotTools } from './copilotTools';
import * as web from './web'
import { MutableDisposable } from './utils';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

function activateDebugger(context: ExtensionContext) {
    vscode.debug.onDidReceiveDebugSessionCustomEvent(async e => {
        if (!(e.session?.type === C64jasmConfigurationProvider.Type)) {
            return;
        }

        web.WebAppPanel.createOrShow(context);

        if (e.event === 'message') {
            const bodyObj = typeof e.body === 'object' && e.body !== null ? e.body : {};
            const type = bodyObj.type || 'info';
            let text = bodyObj.text || bodyObj.message;
            if (!text) {
                text = typeof e.body === 'string' ? e.body : JSON.stringify(e.body);
            }

            if (type === 'error') {
                await vscode.window.showErrorMessage(text);
            } else if (type === 'warning') {
                await vscode.window.showWarningMessage(text);
            } else {
                await vscode.window.showInformationMessage(text);
            }
        }
        if (e.event === 'c64jasm:manageTerminal') {
            const { action, args } = e.body;
            if (action === 'create') {
                const term = vscode.window.createTerminal({
                    name: 'x64sc',
                    shellPath: args[0],
                    shellArgs: args.slice(1),
                });
                C64jasmConfigurationProvider.viceTerminal.value = term;
                term.show(true);
                term.processId.then(pid => {
                    e.session.customRequest('c64jasm:terminalCreated', { processId: pid });
                }, err => {
                    e.session.customRequest('c64jasm:terminalCreated', { error: String(err) });
                });
            } else if (action === 'dispose') {
                C64jasmConfigurationProvider.viceTerminal.dispose();
            }
        }
    });

    context.subscriptions.push(vscode.commands.registerCommand(
        'extension.c64jasm.getProgramName', _config => {
            return vscode.window.showInputBox({
                placeHolder: "Please enter the name of your .asm source file in the workspace folder",
                value: "out/main.prg"
            });
        })
    );

    context.subscriptions.push(vscode.commands.registerCommand(
        'extension.c64jasm.showC64Inspector', () => {
            web.WebAppPanel.createOrShow(context, true); // Force reveal when explicitly requested
        })
    );

    context.subscriptions.push(vscode.commands.registerCommand(
        'extension.c64jasm.createProject', async () => {
            const folderUri = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Project Directory'
            });

            if (folderUri && folderUri[0]) {
                const targetPath = folderUri[0].fsPath;
                try {
                    const fs = require('fs');
                    const srcDir = path.join(targetPath, 'src');
                    const outDir = path.join(targetPath, 'out');
                    const vscodeDir = path.join(targetPath, '.vscode');
                    const githubDir = path.join(targetPath, '.github');
                    const agentsDir = path.join(githubDir, 'agents');

                    fs.mkdirSync(srcDir, { recursive: true });
                    fs.mkdirSync(outDir, { recursive: true });
                    fs.mkdirSync(vscodeDir, { recursive: true });
                    fs.mkdirSync(agentsDir, { recursive: true });

                    // c64jasm.json
                    fs.writeFileSync(path.join(targetPath, 'c64jasm.json'), JSON.stringify({
                        "source": "src/main.asm"
                    }, null, 4));

                    // .vscode/tasks.json
                    fs.writeFileSync(path.join(vscodeDir, 'tasks.json'), JSON.stringify({
                        "version": "2.0.0",
                        "tasks": [
                            {
                                "label": "build-c64jasm",
                                "type": "shell",
                                "command": "c64jasm ./src/main.asm --out ./out/main.prg --disasm ./out/main.disasm",
                                "problemMatcher": "$c64jasm",
                                "group": {
                                    "kind": "build",
                                    "isDefault": true
                                }
                            }
                        ]
                    }, null, 4));

                    // .vscode/launch.json
                    fs.writeFileSync(path.join(vscodeDir, 'launch.json'), JSON.stringify({
                        "version": "0.2.0",
                        "configurations": [
                            {
                                "type": "c64jasm",
                                "request": "launch",
                                "name": "c64jasm debugger",
                                "program": "${workspaceFolder}/out/main.prg",
                                "stopOnEntry": true,
                                "trace": true,
                                "preLaunchTask": "build-c64jasm"
                            }
                        ]
                    }, null, 4));

                    // .github/agents/c64-runtime-inspector.agent.md
                    const agentContent = `# C64 Runtime Inspector Agent

Specialist agent for C64 assembly development with c64jasm. Use this agent to understand the runtime behavior of the code.

## System Tools
- Read memory
- Evaluate expressions
- View registers
`;
                    fs.writeFileSync(path.join(agentsDir, 'c64-runtime-inspector.agent.md'), agentContent);

                    // src/c64.asm
                    const c64asmContent = `!filescope c64
!macro basic_start(addr) {
* = $801
    !byte $0c, $08, $00, $00, $9e
    !for d in [10000, 1000, 100, 10, 1] {
        !if (addr >= d) {
            !byte $30 + (addr/d)%10
        }
    }
    !byte 0, 0, 0
}
`;
                    fs.writeFileSync(path.join(srcDir, 'c64.asm'), c64asmContent);

                    // src/text.js
                    const textjsContent = `function asc2int(asc) {
  return asc.charCodeAt(0)
}

function convertAsciiToScreencode(asc) {
    if (asc.length !== 1) {
        return null
    }
    if (asc >= 'a' && asc <= 'z') {
        return asc2int(asc) - asc2int('a') + 1
    }
    if (asc == 'ä') {
        return 1;
    }
    if (asc == 'ö') {
        return asc2int('o') - asc2int('a') + 1
    }
    if (asc >= 'A' && asc <= 'Z') {
        return asc2int(asc) - asc2int('A') + 0x41
    }
    if (asc >= '0' && asc <= '9') {
        return asc2int(asc) - asc2int('0') + 0x30
    }
    const otherChars = {
        '@': 0,
        ' ': 0x20,
        '!': 0x21,
        '"': 0x22,
        '#': 0x23,
        '$': 0x24,
        '%': 0x25,
        '&': 0x26,
        '(': 0x28,
        ')': 0x29,
        '*': 0x2a,
        '+': 0x2b,
        ',': 0x2c,
        '-': 0x2d,
        '.': 0x2e,
        '/': 0x2f,
        ':': 0x3a,
        ';': 0x3b,
        '<': 0x3c,
        '=': 0x3d,
        '>': 0x3e,
        '?': 0x3f
    }
    if (asc in otherChars) {
        return otherChars[asc]
    }
    return null
}

module.exports = ({}, str) => {
    const arr = [];
    const s = str.toLowerCase();
    for (let c in s) {
        arr.push(convertAsciiToScreencode(s[c]));
    }
    return arr
}
`;
                    fs.writeFileSync(path.join(srcDir, 'text.js'), textjsContent);

                    // src/main.asm
                    const mainasmContent = `!include "c64.asm"
!use "./text" as text

+c64::basic_start(entry)

* = $1000 ; Relocate code to $1000

entry:
    ; clear screen
    ldx #0
    lda #32
clear_loop:
    sta $0400,x
    sta $0500,x
    sta $0600,x
    sta $0700,x
    inx
    bne clear_loop

    ldx #0
print_loop:
    lda c64text,x
    beq done
    sta $0400,x
    inx
    jmp print_loop

done:
    jmp done

c64text:
!byte text("Hello C64jasm!"), 0
`;
                    fs.writeFileSync(path.join(srcDir, 'main.asm'), mainasmContent);
                    
                    vscode.window.showInformationMessage('C64jasm project created successfully!');
                } catch (e) {
                    vscode.window.showErrorMessage('Failed to create project: ' + e);
                }
            }
        })
    );

    // register a configuration provider for 'c64jasm' debug type
    const provider = new C64jasmConfigurationProvider(context.extensionMode)
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('c64jasm', provider));
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('c64jasm', {
        createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
            return new vscode.DebugAdapterInlineImplementation(new C64jasmDebugSession());
        }
    }));
}

class C64jasmConfigurationProvider implements vscode.DebugConfigurationProvider {
    public static readonly Type: string = 'c64jasm';
    public static viceTerminal = new MutableDisposable<vscode.Terminal>();
    private _extensionMode: vscode.ExtensionMode;

    constructor(extensionMode: vscode.ExtensionMode) {
        this._extensionMode = extensionMode;
    }

    /**
     * Massage a debug configuration just before a debug session is being launched,
     * e.g. add all missing attributes to the debug configuration.
     */
    resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {

        // if launch.json is missing or empty
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'asm') {
                config.type = C64jasmConfigurationProvider.Type;
                config.name = 'Launch';
                config.request = 'launch';
                config.program = '${file}';
                config.stopOnEntry = true;
            }
        }

        if (!config.program) {
            return vscode.window.showWarningMessage("Cannot find a program to debug").then((_): undefined => {
                return undefined;	// abort launch
            });
        }

        // Pass extension mode and vicePath to debug session via config
        config.extensionMode = this._extensionMode;
        config.vicePath = vscode.workspace.getConfiguration().get("c64jasm-client.vicePath", "x64");
        config.useEmbeddedCompiler = vscode.workspace.getConfiguration().get("c64jasm-client.useEmbeddedCompiler", true);

        return config;
    }

    dispose() {
    }
}

export function activate(context: ExtensionContext) {
    console.log("C64jasm extension activating...");
    activateDebugger(context);
    registerCopilotTools(context);
    // The server is implemented in node
    let serverModule = context.asAbsolutePath(
        path.join('server', 'out', 'server.js')
    );
    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
    let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    let serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc, options: debugOptions },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    // Options to control the language client
    let clientOptions: LanguageClientOptions = {
        // Register the server for plain text documents
        documentSelector: [{ scheme: 'file', language: 'asm' }],
        synchronize: {
            // Notify the server about file changes to '.clientrc files contained in the workspace
            fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
        }
    };

    // Create the language client and start the client.
    client = new LanguageClient(
        'c64jasm-client',
        'C64jasm language and debug support',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    const clientDisposable = client.start();

    // Push the disposable to the context's subscriptions so that the 
    // client can be deactivated on extension deactivation
    context.subscriptions.push(clientDisposable);
}

export function deactivate(): Thenable<void> {
    // TODO need something to deactivate the debugger?

    if (!client) {
        return Promise.resolve();
    }

    console.log("Extension (c64jasm) has been deactivated.");
    return client.stop();
}
