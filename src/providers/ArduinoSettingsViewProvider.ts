import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { listPorts, listBoards, validateArduinoCli } from '../utils/arduinoCli';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ArduinoSettingsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'arduino-panda-settings';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'getInitialData':
                    await this._updateSettings();
                    break;
                case 'getCliPath':
                    const config = vscode.workspace.getConfiguration('arduino-panda');
                    const cliPath = config.get<string>('cliPath');
                    webviewView.webview.postMessage({
                        type: 'updateCliPath',
                        path: cliPath
                    });
                    break;
                case 'cliPathChanged':
                    await vscode.workspace.getConfiguration('arduino-panda').update('cliPath', data.value, true);
                    break;
                case 'portSelected':
                    await vscode.workspace.getConfiguration('arduino-panda').update('port', data.value, true);
                    break;
                case 'boardSelected':
                    await vscode.workspace.getConfiguration('arduino-panda').update('board', data.value, true);
                    break;
                case 'browseCli':
                    const result = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        filters: {
                            'Executable': ['exe', '*']
                        },
                        title: 'Select Arduino CLI Executable'
                    });
                    if (result && result[0]) {
                        const path = result[0].fsPath;
                        await vscode.workspace.getConfiguration('arduino-panda').update('cliPath', path, true);
                        webviewView.webview.postMessage({
                            type: 'updateCliPath',
                            path: path
                        });
                    }
                    break;
                case 'validateCli':
                    try {
                        if (await validateArduinoCli()) {
                            vscode.window.showInformationMessage('Arduino CLI validated successfully');
                        }
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to validate Arduino CLI: ${error}`);
                    }
                    break;
                case 'refreshPorts':
                    await this._updatePorts();
                    break;
                case 'refreshBoards':
                    await this._updateBoards();
                    break;
                case 'getConfiguration':
                    const value = vscode.workspace.getConfiguration('arduino-panda').get(data.key);
                    this._view?.webview.postMessage({
                        type: 'configuration',
                        key: data.key,
                        value: value
                    });
                    break;
                case 'updateConfiguration':
                    await vscode.workspace.getConfiguration('arduino-panda').update(
                        data.key,
                        data.value,
                        vscode.ConfigurationTarget.Global
                    );
                    break;
            }
        });
    }

    private async _updateSettings() {
        if (!this._view) return;

        const config = vscode.workspace.getConfiguration('arduino-panda');
        const currentPort = config.get<string>('port');
        const currentBoard = config.get<string>('board');

        try {
            const ports = await listPorts();
            const boards = await listBoards();

            this._view.webview.postMessage({
                type: 'updateSettings',
                ports: ports,
                boards: boards,
                currentPort: currentPort,
                currentBoard: currentBoard
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update settings: ${error}`);
        }
    }

    private async _updatePorts() {
        if (!this._view) return;

        try {
            const ports = await listPorts();
            this._view.webview.postMessage({
                type: 'updatePorts',
                ports: ports
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh ports: ${error}`);
        }
    }

    private async _updateBoards() {
        if (!this._view) return;

        try {
            const boards = await listBoards();
            this._view.webview.postMessage({
                type: 'updateBoards',
                boards: boards
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh boards: ${error}`);
        }
    }

    private _getHtmlForWebview() {
        const htmlPath = path.join(this._extensionUri.fsPath, 'src', 'webview', 'settings.html');
        let html = fs.readFileSync(htmlPath, 'utf-8');
        return html;
    }
} 