import * as vscode from 'vscode';
import { Feature } from '../../types';
import { InstallerService, InstallerStatus } from '../../services/InstallerService';
import { InstallerPhaseProvider } from '../../providers/InstallerPhaseProvider';
import { InstallerWizardPanel } from '../../providers/InstallerWizardPanel';
import { StatusBarManager } from '../../common/StatusBarManager';
import { OutputChannel } from '../../common/OutputChannel';

/**
 * Installer Feature — integrates the headless MJInstaller engine into VSCode.
 *
 * Provides commands for:
 * - `memberjunction.install` — full interactive install flow
 * - `memberjunction.installDoctor` — run diagnostics on an existing install
 * - `memberjunction.installResume` — resume a partially completed install
 * - `memberjunction.showInstallLog` — focus the output channel
 * - `memberjunction.cancelInstall` — cancel a running install
 */
export class InstallerFeature implements Feature {
    name = 'installer';

    private service: InstallerService;
    private phaseProvider: InstallerPhaseProvider | undefined;
    private disposables: vscode.Disposable[] = [];
    private extensionContext: vscode.ExtensionContext | undefined;

    constructor() {
        this.service = InstallerService.getInstance();
    }

    enabled(): boolean {
        const config = vscode.workspace.getConfiguration('memberjunction');
        return config.get<boolean>('features.installer.enabled', true);
    }

    async activate(context: vscode.ExtensionContext): Promise<void> {
        if (!this.enabled()) {
            OutputChannel.info('Installer feature is disabled');
            return;
        }

        OutputChannel.info('Activating Installer feature...');

        this.extensionContext = context;
        this.registerCommands(context);
        this.registerTreeView(context);
        this.setupStatusBar();
        this.setupEventListeners();

        OutputChannel.info('Installer feature activated');
    }

    async deactivate(): Promise<void> {
        this.phaseProvider?.dispose();
        this.disposables.forEach(d => d.dispose());
        OutputChannel.info('Installer feature deactivated');
    }

    // -------------------------------------------------------------------
    // Command registration
    // -------------------------------------------------------------------

    private registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.install', () => this.runInstall())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.installDoctor', () => this.runDoctor())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.installResume', () => this.runResume())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.showInstallLog', () => {
                OutputChannel.show();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.cancelInstall', () => {
                this.service.cancel();
            })
        );
    }

    // -------------------------------------------------------------------
    // TreeView
    // -------------------------------------------------------------------

    private registerTreeView(context: vscode.ExtensionContext): void {
        this.phaseProvider = new InstallerPhaseProvider();

        const treeView = vscode.window.createTreeView('memberjunction.installerPhases', {
            treeDataProvider: this.phaseProvider,
            showCollapseAll: true,
        });

        context.subscriptions.push(treeView);
    }

    // -------------------------------------------------------------------
    // Status bar
    // -------------------------------------------------------------------

    private setupStatusBar(): void {
        StatusBarManager.register('installer', {
            alignment: vscode.StatusBarAlignment.Left,
            priority: -100,
        });

        this.updateStatusBar(this.service.status);
    }

    private setupEventListeners(): void {
        const statusListener = this.service.onStatusChange(status => {
            this.updateStatusBar(status);
        });
        this.disposables.push(statusListener);
    }

    private updateStatusBar(status: InstallerStatus): void {
        switch (status) {
            case 'idle':
                StatusBarManager.update(
                    'installer',
                    '$(package) MJ Installer',
                    'MemberJunction Installer — Click for options',
                    'memberjunction.install'
                );
                break;
            case 'planning':
                StatusBarManager.update(
                    'installer',
                    '$(sync~spin) MJ Installer: Planning...',
                    'Creating install plan',
                    undefined
                );
                break;
            case 'running':
                StatusBarManager.update(
                    'installer',
                    '$(sync~spin) MJ Installer: Running...',
                    'Installation in progress — Click to cancel',
                    'memberjunction.cancelInstall'
                );
                break;
            case 'completed':
                StatusBarManager.update(
                    'installer',
                    '$(check) MJ Installer: Complete',
                    'Installation completed successfully',
                    'memberjunction.showInstallLog'
                );
                // Reset to idle after a delay
                setTimeout(() => {
                    if (this.service.status === 'completed') {
                        this.updateStatusBar('idle');
                    }
                }, 10000);
                break;
            case 'failed':
                StatusBarManager.updateWithColor(
                    'installer',
                    '$(error) MJ Installer: Failed',
                    'Installation failed — Click for details',
                    'memberjunction.showInstallLog',
                    new vscode.ThemeColor('statusBarItem.errorBackground')
                );
                break;
            case 'cancelled':
                StatusBarManager.update(
                    'installer',
                    '$(circle-slash) MJ Installer: Cancelled',
                    'Installation was cancelled',
                    'memberjunction.install'
                );
                setTimeout(() => {
                    if (this.service.status === 'cancelled') {
                        this.updateStatusBar('idle');
                    }
                }, 5000);
                break;
        }
    }

    // -------------------------------------------------------------------
    // Install command
    // -------------------------------------------------------------------

    private async runInstall(): Promise<void> {
        if (this.service.status === 'running' || this.service.status === 'planning') {
            vscode.window.showWarningMessage('An install operation is already in progress.');
            return;
        }

        if (this.extensionContext) {
            InstallerWizardPanel.CreateOrShow(this.extensionContext.extensionUri, 'install');
        }
    }

    // -------------------------------------------------------------------
    // Doctor command
    // -------------------------------------------------------------------

    private async runDoctor(): Promise<void> {
        if (this.service.status === 'running') {
            vscode.window.showWarningMessage('An install operation is already in progress.');
            return;
        }

        if (this.extensionContext) {
            InstallerWizardPanel.CreateOrShow(this.extensionContext.extensionUri, 'doctor');
        }
    }

    // -------------------------------------------------------------------
    // Resume command
    // -------------------------------------------------------------------

    private async runResume(): Promise<void> {
        if (this.service.status === 'running') {
            vscode.window.showWarningMessage('An install operation is already in progress.');
            return;
        }

        if (this.extensionContext) {
            InstallerWizardPanel.CreateOrShow(this.extensionContext.extensionUri, 'resume');
        }
    }

}
