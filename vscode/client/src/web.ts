import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";

export class WebAppPanel {

    public static currentPanel: WebAppPanel | undefined;
    public static path: string = "client/out/media/page1/index.html";
    public static readonly viewType = "vscodevuecli:panel";

    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(context: vscode.ExtensionContext) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn : undefined;

        // If we already have a panel, show it.      
        if (WebAppPanel.currentPanel) {
            WebAppPanel.currentPanel.panel.reveal(column);
            return;
        }

        const extUri = vscode.Uri.file(context.extensionPath);
        // Otherwise, create a new panel. 
        const panel = vscode.window.createWebviewPanel(
            WebAppPanel.viewType,
            'Web App Panel',
            column || vscode.ViewColumn.One,
            getWebviewOptions(extUri)
        );

        WebAppPanel.currentPanel = new WebAppPanel(panel, extUri, context);
    }

    public static kill() {
        WebAppPanel.currentPanel?.dispose();
        WebAppPanel.currentPanel = undefined;
    }

    public static revive(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext) {
        WebAppPanel.currentPanel = new WebAppPanel(panel, extensionUri, context);
    }

    private constructor(
        private panel: vscode.WebviewPanel,
        private extensionUri: vscode.Uri,
        private context: vscode.ExtensionContext) {

        // Set the webview's initial html content    
        this._update();

        this.panel.onDidDispose(() => this.dispose(),
            null, this._disposables);

        // Update the content based on view changes 
        this.panel.onDidChangeViewState(
            e => {
                if (this.panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        // Handle messages from the webview  
        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'alert': vscode.window.showErrorMessage(message.text);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        WebAppPanel.currentPanel = undefined;

        // Clean up our resources  
        this.panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _update() {
        //??const webview = this.panel.webview;
        //??this.panel.webview.html = this._getHtmlForWebview(webview);
        this.panel.webview.html = this.getHtmlForView();
    }

    private getHtmlForView(): string {
        const webView = this.panel.webview;
        const templatePath = WebAppPanel.path;
        const resourcePath = path.join(this.context.extensionPath, templatePath);
        const dirPath = path.dirname(resourcePath);
        let html = fs.readFileSync(resourcePath, 'utf-8');

        // /(<link.+?href=(?!http)|<script.+?src=(?!http)|<img.+?src="(?!http)|url\("(?!http))(.+?)[\s|>]/g
        html = html.replace(/(<link.+?href=)(.+?)(\s+rel=stylesheet>)/g, (m, $1, $2, $3) => {
            return `${$1} "${webView.asWebviewUri(vscode.Uri.file(path.join(dirPath, $2))).toString()}" ${$3}`;
        });
        html = html.replace(/(<script.+?src=)(.+?)>/g, (m, $1, $2) => {
            return $1 + '"' + webView.asWebviewUri(vscode.Uri.file(path.join(dirPath, $2))).toString() + '"> ';
        });
        html = html.replace(/(<img.+?src=")(.+?)>"/g, (m, $1, $2) => {
            return $1 + webView.asWebviewUri(vscode.Uri.file(path.join(dirPath, $2))).toString() + '"';
        });

        return html;
    }

    //??
    public _getHtmlForWebview(webview: vscode.Webview) {
        const styleResetUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "media", "reset.css")
        );

        const styleVSCodeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "media", "vscode.css")
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "dist-web", "js/app.js")
        );

        const scriptVendorUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "dist-web",
                "js/chunk-vendors.js")
        );

        const nonce = getNonce();
        const baseUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.extensionUri, 'dist-web')
        ).toString().replace('%22', '');

        return `      
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="utf-8" />
                    <meta name="viewport" content="width=device-width, 
                        initial-scale=1" />
                    <link href="${styleResetUri}" rel="stylesheet">
                    <link href="${styleVSCodeUri}" rel="stylesheet">
                    <title>Web App Panel</title>
                </head>
                <body>
                <h1>HELLO</h1>
                <input hidden data-uri="${baseUri}">
                    <div id="app"></div>  
                    <script type="text/javascript"
                        src="${scriptVendorUri}" nonce="${nonce}"></script>  
                    <script type="text/javascript"
                u        src="${scriptUri}" nonce="${nonce}"></script>
                </body>
                </html> 
            `;
    }
}
function getWebviewOptions(extensionUri: vscode.Uri):
    vscode.WebviewOptions {
    return {
        // Enable javascript in the webview
        enableScripts: true,

        localResourceRoots: [
            // Only allow the webview to access resources in our extension's media directory
            vscode.Uri.joinPath(extensionUri, 'client/out/media'),
            vscode.Uri.joinPath(extensionUri, 'client/out/media/page1/'),
        ]
    };
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/*
export function getWebViewContent(context: vscode.ExtensionContext, templatePath: string) {
    const resourcePath = path.join(context.extensionPath, templatePath);
    const dirPath = path.dirname(resourcePath);
    let html = fs.readFileSync(resourcePath, 'utf-8');
    // vscode不支持直接加载本地资源，需要替换成其专有路径格式，这里只是简单的将样式和JS的路径替换
    // /(<link.+?href=(?!http)|<script.+?src=(?!http)|<img.+?src="(?!http)|url\("(?!http))(.+?)[\s|>]/g
    html = html.replace(/(<link.+?href=(?!http))(.+?)\s/g, (m, $1, $2) => {
        return $1 + '"' + vscode.Uri.file(path.resolve(dirPath, $2)).with({ scheme: 'vscode-resource' }).toString() + '" ';
    });
    html = html.replace(/(<script.+?src=(?!http))(.+?)>/g, (m, $1, $2) => {
        return $1 + '"' + vscode.Uri.file(path.resolve(dirPath, $2)).with({ scheme: 'vscode-resource' }).toString() + '"> ';
    });
    html = html.replace(/(<img.+?src="(?!http)|url\("(?!http))(.+?)"/g, (m, $1, $2) => {
        return $1 + vscode.Uri.file(path.resolve(dirPath, $2)).with({ scheme: 'vscode-resource' }).toString() + '"';
    });
    return html;
}*/