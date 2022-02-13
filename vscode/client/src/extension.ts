import * as path from 'path';
import * as vscode from 'vscode';
import { workspace, ExtensionContext } from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';

import { C64jasmDebugSession } from './c64jasmDebug';
import * as Net from 'net';
import * as web from './web'

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

const LANGUAGE_SERVER_ENABLED = true;

/*
 * Set the following compile time flag to true if the
 * debug adapter should run inside the extension host.
 * Please note: the test suite does no longer work in this mode.
 */
const EMBED_DEBUG_ADAPTER = true;

let client: LanguageClient;

function activateDebugger(context: ExtensionContext) {
    vscode.debug.onDidReceiveDebugSessionCustomEvent(async e => {
        if (!(e.session?.type === C64jasmConfigurationProvider.Type)) {
            return;
        }

        web.WebAppPanel.createOrShow(context);

        if (e.event === 'message') {
            const { type, text } = typeof e.body === 'object' && e.body !== null
                ? e.body
                : { type: 'error', text: String(e.body) };

            if (type === 'error') {
                await vscode.window.showErrorMessage(text);
            } else if (type === 'warning') {
                await vscode.window.showWarningMessage(text);
            } else {
                await vscode.window.showInformationMessage(text);
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
        'extension.c64jasm.showC64State', () => {
            web.WebAppPanel.createOrShow(context, true); // Force reveal when explicitly requested
        })
    );

    // register a configuration provider for 'c64jasm' debug type
    const provider = new C64jasmConfigurationProvider(context.extensionMode)
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('c64jasm', provider));
    context.subscriptions.push(provider);
}

class C64jasmConfigurationProvider implements vscode.DebugConfigurationProvider {
    public static readonly Type: string = 'c64jasm';
    private _server?: Net.Server;
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

        // Pass extension mode to debug session via config
        config.extensionMode = this._extensionMode;

        if (EMBED_DEBUG_ADAPTER) {
            // start port listener on launch of first debug session
            if (!this._server) {

                // start listening on a random port
                this._server = Net.createServer(socket => {
                    try {
                        const session = new C64jasmDebugSession();
                        session.setRunAsServer(true);
                        session.start(<NodeJS.ReadableStream>socket, socket);
                    } catch (e) {
                        vscode.window.showErrorMessage((e as Error).message);
                        socket.end();
                    }
                }).listen(0);
            }

            // make VS Code connect to debug server instead of launching debug adapter
            config.debugServer = (this._server.address() as Net.AddressInfo).port;
        }

        return config;
    }

    dispose() {
        if (this._server) {
            this._server.close();
        }
    }
}

export function activate(context: ExtensionContext) {
    console.log("C64jasm extension activating...");
    activateDebugger(context);
    if (!LANGUAGE_SERVER_ENABLED) {
        console.log("Language server disabled.");
        return;
    }
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
