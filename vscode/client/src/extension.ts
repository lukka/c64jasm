import * as fs from 'fs';
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

type ProjectTemplateId = 'empty' | 'sprites' | 'content-pipe';

type ProjectTemplateOption = vscode.QuickPickItem & {
    templateId: ProjectTemplateId;
};

function createProjectTemplateOptions(): ProjectTemplateOption[] {
    return [
        {
            label: 'Empty project',
            description: 'Create a blank c64jasm starter project',
            templateId: 'empty',
        },
        {
            label: 'Sprites sample',
            description: 'Create a project from the animated sprites sample',
            templateId: 'sprites',
        },
        {
            label: 'Content pipe sample',
            description: 'Create a project from the content-pipe demo',
            templateId: 'content-pipe',
        }
    ];
}

function writeJsonFile(filePath: string, value: unknown) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 4));
}

function ensureCopilotAssets(context: ExtensionContext, targetPath: string) {
    const githubDir = path.join(targetPath, '.github');
    const assetsDir = path.join(context.extensionPath, 'assets');
    copyDirectoryRecursive(assetsDir, githubDir);
}

function ensureProjectConfig(targetPath: string, source: string) {
    const configPath = path.join(targetPath, 'c64jasm.json');

    if (!fs.existsSync(configPath)) {
        writeJsonFile(configPath, {
            source
        });
    }
}

function copyDirectoryRecursive(sourceDir: string, targetDir: string, skipEntries = new Set<string>()) {
    fs.mkdirSync(targetDir, { recursive: true });

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (skipEntries.has(entry.name)) {
            continue;
        }

        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);

        if (entry.isDirectory()) {
            copyDirectoryRecursive(sourcePath, targetPath, skipEntries);
        } else {
            fs.copyFileSync(sourcePath, targetPath);
        }
    }
}


function resolveBundledTemplatePath(context: ExtensionContext, templateId: ProjectTemplateId): string | undefined {
    const candidatePaths = [
        path.join(context.extensionPath, 'project-templates', templateId),
        path.join(context.extensionPath, '..', 'examples', templateId),
    ];

    return candidatePaths.find(candidatePath => fs.existsSync(candidatePath));
}

function createProjectFromSample(context: ExtensionContext, templateId: ProjectTemplateId, targetPath: string) {
    const templatePath = resolveBundledTemplatePath(context, templateId);

    if (!templatePath) {
        throw new Error(`Could not find the bundled "${templateId}" sample.`);
    }

    copyDirectoryRecursive(templatePath, targetPath, new Set(['.c64jasm', 'out']));
    fs.mkdirSync(path.join(targetPath, 'out'), { recursive: true });
    ensureCopilotAssets(context, targetPath);
    ensureProjectConfig(targetPath, templateId === 'sprites' ? 'sprites.asm' : 'src/main.asm');
}

async function promptToOpenCreatedProject(targetPath: string, templateLabel: string) {
    const isCurrentlyOpen = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(targetPath)) !== undefined;

    if (isCurrentlyOpen) {
        vscode.window.showInformationMessage(`${templateLabel} created successfully.`);
        return;
    }

    const choice = await vscode.window.showInformationMessage(
        `${templateLabel} created successfully. Close the current workspace and open '${targetPath}' now?`,
        { modal: true },
        'Open Project',
        'Stay Here'
    );

    if (choice === 'Open Project') {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetPath), false);
    }
}

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
                    name: path.basename(args[0]),
                    shellPath: args[0],
                    shellArgs: args.slice(1),
                });
                C64jasmConfigurationProvider.viceTerminal.value = term;
                term.show(true);
                
                // term.processId doesn't resolve when running non-shell executables (e.g., `x64sc`).
                // We'll notify the debug adapter immediately to unblock execution.
                console.log('SENDING TERMINAL CREATED REQUEST'); 
                e.session.customRequest('c64jasm:terminalCreated', {});
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
        'extension.c64jasm.showC64Runtime', () => {
            web.WebAppPanel.createOrShow(context, true); // Force reveal when explicitly requested
        })
    );

    context.subscriptions.push(vscode.commands.registerCommand(
        'extension.c64jasm.createProject', async () => {
            const template = await vscode.window.showQuickPick(createProjectTemplateOptions(), {
                placeHolder: 'Choose the type of c64jasm project to create'
            });

            if (!template) {
                return;
            }

            const folderUri = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Project Directory'
            });

            if (folderUri && folderUri[0]) {
                const targetPath = folderUri[0].fsPath;
                try {
                    const visibleEntries = fs.readdirSync(targetPath).filter(entryName => entryName !== '.DS_Store');
                    if (visibleEntries.length > 0) {
                        const choice = await vscode.window.showWarningMessage(
                            `The selected directory '${targetPath}' is not empty. Existing files may be overwritten.`,
                            { modal: true },
                            'Continue'
                        );

                        if (choice !== 'Continue') {
                            return;
                        }
                    }

                    createProjectFromSample(context, template.templateId, targetPath);

                    await promptToOpenCreatedProject(targetPath, template.label);
                } catch (e) {
                    vscode.window.showErrorMessage('Failed to create project: ' + e);
                }
            }
        })
    );

    // register a configuration provider for 'c64jasm' debug type
    const provider = new C64jasmConfigurationProvider(context.extensionMode)
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('c64jasm-debug', provider));
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('c64jasm-debug', {
        createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
            return new vscode.DebugAdapterInlineImplementation(new C64jasmDebugSession());
        }
    }));
}

class C64jasmConfigurationProvider implements vscode.DebugConfigurationProvider {
    public static readonly Type: string = 'c64jasm-debug';
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
        config.useEmbeddedCompiler = vscode.workspace.getConfiguration().get("c64jasm-devtools.useEmbeddedCompiler", true);

        const vicePath = vscode.workspace.getConfiguration().get<string>("c64jasm-devtools.vicePath", "x64sc") || "x64sc";
        let viceExists = false;
        if (path.isAbsolute(vicePath)) {
            viceExists = fs.existsSync(vicePath);
        } else {
            try {
                if (process.platform === 'win32') {
                    require('child_process').execSync(`where "${vicePath}"`, { stdio: 'ignore' });
                } else {
                    require('child_process').execSync(`which "${vicePath}"`, { stdio: 'ignore' });
                }
                viceExists = true;
            } catch (e) {
                viceExists = false;
            }
        }

        if (!viceExists) {
            vscode.window.showErrorMessage(
                `VICE executable '${vicePath}' does not exist. Please update the 'c64jasm-devtools.vicePath' setting with the correct path.`,
                "Open Settings"
            ).then(item => {
                if (item === "Open Settings") {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'c64jasm-devtools.vicePath');
                }
            });
            return undefined; // abort launch
        }
        config.vicePath = vicePath;

        return config;
    }

    dispose() {
    }
}

export function activate(context: ExtensionContext) {
    console.log("C64jasm extension activating...");
    activateDebugger(context);

    // Create the Output Channel explicitly so we can share it
    const outputChannel = vscode.window.createOutputChannel('c64jasm extension');
    registerCopilotTools(context, outputChannel);

    // The server is implemented in node
    let serverModule = context.asAbsolutePath(
        path.join('server', 'out', 'server.js')
    );
    // The debug options for the server
    // --inspect=6009: runs the server in Node inspect mode so VS Code can attach to the server for debugging
    let debugOptions = { execArgv: ['--inspect=6009'] };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    let serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
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
        },
        outputChannel: outputChannel
    };

    // Create the language client and start the client.
    client = new LanguageClient(
        'c64jasm-devtools',
        'c64jasm extension',
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
