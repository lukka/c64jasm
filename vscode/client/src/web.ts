// @ts-strict-ignore
import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";

// Doc source: https://stackoverflow.com/questions/56830928/calling-vscode-extension-for-data-from-webview

export class WebAppPanel {

    public static currentPanel: WebAppPanel | null;
    public static path: string = "client/out/media/page1/index.html";
    public static readonly viewType = "vscodevuecli:panel";
    public static memoryRequestHandler: ((start: number, end: number, bankId: number) => Promise<string>) | null = null;
    public static memorySetHandler: ((address: number, value: number) => Promise<void>) | null = null;
    public static registerSetHandler: ((register: string, value: number) => Promise<void>) | null = null;

    private _disposables: vscode.Disposable[] = [];
    public get webview(): vscode.Webview {
        return this.panel.webview;
    };

    public static createOrShow(context: vscode.ExtensionContext, forceReveal: boolean = false): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn : undefined;

        // If panel already exists, only reveal it if explicitly requested
        if (WebAppPanel.currentPanel) {
            if (forceReveal) {
                WebAppPanel.currentPanel.panel.reveal(column);
            }
            return;
        }

        const extUri = vscode.Uri.file(context.extensionPath);
        // Otherwise, create a new panel. 
        const panel = vscode.window.createWebviewPanel(
            WebAppPanel.viewType,
            'C64 Debugger',
            column || vscode.ViewColumn.One,
            WebAppPanel.getWebviewOptions(extUri)
        );

        WebAppPanel.currentPanel = new WebAppPanel(panel, context);
    }

    public static kill() {
        WebAppPanel.currentPanel?.dispose();
        WebAppPanel.currentPanel = null;
    }

    public static revive(
        panel: vscode.WebviewPanel,
        context: vscode.ExtensionContext) {
        WebAppPanel.currentPanel = new WebAppPanel(panel, context);
    }

    private constructor(
        private panel: vscode.WebviewPanel,
        private context: vscode.ExtensionContext) {

        // Update the HTML content.
        this.update();

        this.panel.onDidDispose(() => this.dispose(),
            null, this._disposables);

        // Update the HTML content.
        this.panel.onDidChangeViewState(
            e => {
                if (this.panel.visible) {
                    this.update();
                }
            },
            null,
            this._disposables
        );

        // Handle messages from the webview  
        this.panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'alert': 
                        vscode.window.showErrorMessage(message.text);
                        return;
                    case 'getMemory':
                        if (WebAppPanel.memoryRequestHandler) {
                            try {
                                const memory = await WebAppPanel.memoryRequestHandler(
                                    message.start,
                                    message.end,
                                    message.bankId || 0
                                );
                                this.panel.webview.postMessage({ 
                                    memory: memory,
                                    tag: message.tag // Pass through the tag for sprite/VIC data
                                });
                            } catch (err) {
                                console.error(`Failed to fetch memory: ${err}`);
                            }
                        }
                        return;
                    case 'setMemory':
                        if (WebAppPanel.memorySetHandler) {
                            try {
                                await WebAppPanel.memorySetHandler(
                                    message.address,
                                    message.value
                                );
                            } catch (err) {
                                console.error(`Failed to set memory: ${err}`);
                                vscode.window.showErrorMessage(`Failed to set memory at $${message.address.toString(16)}: ${err}`);
                            }
                        }
                        return;
                    case 'setRegister':
                        if (WebAppPanel.registerSetHandler) {
                            try {
                                await WebAppPanel.registerSetHandler(
                                    message.register,
                                    message.value
                                );
                            } catch (err) {
                                console.error(`Failed to set register: ${err}`);
                                vscode.window.showErrorMessage(`Failed to set register ${message.register}: ${err}`);
                            }
                        }
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        WebAppPanel.currentPanel = null;

        // Clean up our resources  
        this.panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async update() {
        //??const webview = this.panel.webview;
        //??this.panel.webview.html = this._getHtmlForWebview(webview);
        this.panel.webview.html = this.getHtmlForView();
    }

    private html: string;
    private getHtmlForView(): string {
        if (!this.html) {
            const webView = this.panel.webview;
            const templatePath = WebAppPanel.path;
            const resourcePath = path.join(this.context.extensionPath, templatePath);
            const dirPath = path.dirname(resourcePath);
            let html = fs.readFileSync(resourcePath, 'utf-8');

            html = html.replace(/(<link.+?href=)(.+?)(\s+rel=stylesheet>)/g, (m, $1, $2, $3) => {
                return `${$1} "${webView.asWebviewUri(vscode.Uri.file(path.join(dirPath, $2))).toString()}" ${$3}`;
            });
            html = html.replace(/(<script.+?src=)(.+?)>/g, (m, $1, $2) => {
                return $1 + '"' + webView.asWebviewUri(vscode.Uri.file(path.join(dirPath, $2))).toString() + '"> ';
            });
            html = html.replace(/(<img.+?src=")(.+?)>"/g, (m, $1, $2) => {
                return $1 + webView.asWebviewUri(vscode.Uri.file(path.join(dirPath, $2))).toString() + '"';
            });
            this.html = html;
        }

        return this.html;
    }


    private static getWebviewOptions(extensionUri: vscode.Uri):
        vscode.WebviewOptions & vscode.WebviewPanelOptions {
        return {
            // Enable javascript in the webview
            enableScripts: true,

            // Retain content when hidden to prevent reset on tab moves
            retainContextWhenHidden: true,

            localResourceRoots: [
                // Only allow the webview to access resources in our extension's media directory
                vscode.Uri.joinPath(extensionUri, 'client/out/media'),
                vscode.Uri.joinPath(extensionUri, 'client/out/media/page1/'),
            ]
        };
    }
}
