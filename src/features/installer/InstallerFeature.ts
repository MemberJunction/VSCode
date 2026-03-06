import * as vscode from 'vscode';
import { Feature } from '../../types';
import { InstallerService, InstallerStatus, PhaseDisplayState } from '../../services/InstallerService';
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
    /** Handle for the delayed status-bar reset timer; cleared on deactivate. */
    private statusResetTimeout: ReturnType<typeof setTimeout> | undefined;

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

        // Make the installer sidebar visible — decoupled from workspaceInitialized
        // so new users who need the installer can see it before connecting.
        await vscode.commands.executeCommand('setContext', 'memberjunction.installerEnabled', true);

        this.extensionContext = context;
        this.registerCommands(context);
        this.registerTreeView(context);
        this.setupStatusBar();
        this.setupEventListeners();

        OutputChannel.info('Installer feature activated');
    }

    async deactivate(): Promise<void> {
        if (this.statusResetTimeout) {
            clearTimeout(this.statusResetTimeout);
            this.statusResetTimeout = undefined;
        }
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

        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.copyInstallerError', (item: vscode.TreeItem) => {
                if (item.label) {
                    vscode.env.clipboard.writeText(String(item.label));
                    vscode.window.showInformationMessage('Error message copied.');
                }
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.copyInstallerFix', (item: vscode.TreeItem) => {
                if (item.label) {
                    vscode.env.clipboard.writeText(String(item.label));
                    vscode.window.showInformationMessage('Suggested fix copied.');
                }
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

        // Show the current phase name in the status bar during install
        const phaseListener = this.service.onPhaseUpdate((phases: PhaseDisplayState[]) => {
            if (this.service.status === 'running') {
                const runningPhase = phases.find(p => p.Status === 'running');
                if (runningPhase) {
                    StatusBarManager.update(
                        'installer',
                        '$(sync~spin) MJ Installer: ' + runningPhase.Description,
                        'Installation in progress — ' + runningPhase.Description + ' — Click to cancel',
                        'memberjunction.cancelInstall'
                    );
                }
            }
        });
        this.disposables.push(phaseListener);
    }

    /** Schedule an automatic status-bar reset to idle after the given delay. Cancels any pending reset. */
    private scheduleStatusReset(delayMs: number): void {
        if (this.statusResetTimeout) {
            clearTimeout(this.statusResetTimeout);
        }
        this.statusResetTimeout = setTimeout(() => {
            this.statusResetTimeout = undefined;
            const current = this.service.status;
            if (current === 'completed' || current === 'cancelled') {
                this.updateStatusBar('idle');
            }
        }, delayMs);
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
                this.scheduleStatusReset(10000);
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
                this.scheduleStatusReset(5000);
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
