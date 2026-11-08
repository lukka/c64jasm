import * as vscode from 'vscode';
import { startMcpHttpServer } from './mcpHttpServer';
import { VSCodeToolBackend } from './vscodeToolBackend';

type Endpoint = Awaited<ReturnType<typeof startMcpHttpServer>>;

export class McpIntegration implements vscode.Disposable {
    private endpoint: Promise<Endpoint> | undefined;
    private readonly backend: VSCodeToolBackend;
    private readonly changed = new vscode.EventEmitter<void>();
    private readonly subscriptions: vscode.Disposable[] = [];
    private disposed = false;
    private generation = 0;
    private closing: Promise<void> | undefined;

    constructor(context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {
        this.backend = new VSCodeToolBackend(output);
        const version = String(context.extension.packageJSON.version);
        const definition = (endpoint: Endpoint) => new vscode.McpHttpServerDefinition('c64jasm', vscode.Uri.parse(endpoint.url), {}, version);
        this.subscriptions.push(
            vscode.lm.registerMcpServerDefinitionProvider('c64jasm', {
                onDidChangeMcpServerDefinitions: this.changed.event,
                provideMcpServerDefinitions: async () => {
                    if (!this.enabled() || this.settings().get('disableCopilotIntegration', false)) return [];
                    return [definition(await this.ensureEndpoint(version))];
                },
                resolveMcpServerDefinition: async () => {
                    if (!this.enabled() || this.settings().get('disableCopilotIntegration', false)) return undefined;
                    const endpoint = await this.ensureEndpoint(version);
                    const server = definition(endpoint);
                    server.headers = { Authorization: `Bearer ${endpoint.token}` };
                    return server;
                }
            }),
            vscode.commands.registerCommand('c64jasm-devtools.copyMcpConnection', async () => {
                if (vscode.env.remoteName) {
                    void vscode.window.showWarningMessage('The MCP endpoint runs in the remote extension host. Automatic forwarding is not supported; use the standalone stdio MCP server in that environment.');
                    return;
                }
                if (!this.enabled()) {
                    void vscode.window.showWarningMessage('MCP requires a trusted workspace and c64jasm-devtools.enableMcp enabled.');
                    return;
                }
                if (!this.settings().get('allowExternalMcpClients', false)) {
                    void vscode.window.showWarningMessage('Enable c64jasm-devtools.allowExternalMcpClients before sharing this window’s debugger with an external MCP client.');
                    return;
                }
                const choice = await vscode.window.showWarningMessage('Copy credentials that grant control of this window’s C64 debugger? They expire when the extension reloads or MCP settings change.', { modal: true }, 'Copy connection details');
                if (choice !== 'Copy connection details' || !this.settings().get('allowExternalMcpClients', false)) return;
                const endpoint = await this.ensureEndpoint(version);
                if (!this.enabled() || !this.settings().get('allowExternalMcpClients', false)) return;
                await vscode.env.clipboard.writeText(JSON.stringify({
                    name: 'c64jasm', transport: 'streamable-http', url: endpoint.url,
                    headers: { Authorization: `Bearer ${endpoint.token}` },
                    workspaceFolders: vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [],
                    expires: 'On extension reload, workspace change, or MCP configuration change. Keep this VS Code window open.'
                }, null, 2));
                void vscode.window.showInformationMessage('MCP connection details copied. Treat the bearer token as a secret; do not save it in tracked files.');
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (['enableMcp', 'allowExternalMcpClients', 'disableCopilotIntegration'].some(key => event.affectsConfiguration(`c64jasm-devtools.${key}`))) this.reset();
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.reset()),
            vscode.workspace.onDidGrantWorkspaceTrust(() => this.reset())
        );
        context.subscriptions.push(this);
    }

    private settings(): vscode.WorkspaceConfiguration { return vscode.workspace.getConfiguration('c64jasm-devtools'); }

    private enabled(): boolean {
        return !this.disposed && vscode.workspace.isTrusted && !vscode.env.remoteName && this.settings().get('enableMcp', true);
    }

    private ensureEndpoint(version: string): Promise<Endpoint> {
        if (!this.enabled()) return Promise.reject(new Error('MCP is disabled, the workspace is untrusted, or the extension host is remote.'));
        if (!this.endpoint) {
            const generation = this.generation;
            this.endpoint = startMcpHttpServer(this.backend, {
                version, onError: () => this.output.appendLine('MCP HTTP request failed; no connection credentials were logged.')
            }).then(async endpoint => {
                if (generation !== this.generation || !this.enabled()) {
                    await endpoint.close();
                    throw new Error('MCP configuration changed while the endpoint was starting. Retry the connection.');
                }
                this.output.appendLine('C64 MCP HTTP endpoint ready for this VS Code window.');
                return endpoint;
            }).catch(error => {
                if (generation === this.generation) this.endpoint = undefined;
                throw error;
            });
        }
        return this.endpoint;
    }

    private reset(): void {
        this.generation++;
        const endpoint = this.endpoint;
        this.endpoint = undefined;
        if (endpoint) void endpoint.then(server => server.close()).catch(() => {});
        this.changed.fire();
    }

    close(): Promise<void> {
        if (!this.closing) {
            this.disposed = true;
            this.backend.dispose();
            for (const subscription of this.subscriptions) subscription.dispose();
            const endpoint = this.endpoint;
            this.endpoint = undefined;
            this.generation++;
            this.changed.dispose();
            this.closing = endpoint ? endpoint.then(server => server.close()).catch(() => {}) : Promise.resolve();
        }
        return this.closing;
    }

    dispose(): void { void this.close(); }
}
