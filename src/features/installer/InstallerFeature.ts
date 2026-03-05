import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Feature } from '../../types';
import { InstallerService, InstallerStatus } from '../../services/InstallerService';
import { InstallerPhaseProvider } from '../../providers/InstallerPhaseProvider';
import { StatusBarManager } from '../../common/StatusBarManager';
import { OutputChannel } from '../../common/OutputChannel';

/** Flags corresponding to engine CreatePlanInput + RunOptions. */
interface InstallOptionFlags {
    SkipDB: boolean;
    SkipCodeGen: boolean;
    SkipStart: boolean;
    Fast: boolean;
    NoResume: boolean;
    Verbose: boolean;
}

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

        // 1. Pick target directory
        const targetDir = await this.pickTargetDirectory();
        if (!targetDir) return;

        // 2. Pick version
        const version = await this.pickVersion();
        if (!version) return;

        // 3. Pick install options
        const installOptions = await this.pickInstallOptions();
        if (!installOptions) return;

        // 4. Build summary for confirmation
        const activeFlags = this.summarizeOptions(installOptions);
        const detail = activeFlags.length > 0
            ? `Options: ${activeFlags.join(', ')}`
            : 'All phases will run with default settings.';

        const confirm = await vscode.window.showInformationMessage(
            `Install MemberJunction ${version} to ${targetDir}?`,
            { modal: true, detail },
            'Install',
            'Cancel'
        );
        if (confirm !== 'Install') return;

        // 5. Run with progress
        await this.executeInstall(targetDir, version, installOptions);
    }

    /** Show multi-select QuickPick for install options. */
    private async pickInstallOptions(): Promise<InstallOptionFlags | undefined> {
        const items: (vscode.QuickPickItem & { flag: keyof InstallOptionFlags })[] = [
            {
                label: '$(database) Skip Database Phase',
                description: 'Skip database provisioning (--skip-db)',
                flag: 'SkipDB',
            },
            {
                label: '$(code) Skip CodeGen Phase',
                description: 'Skip code generation (--skip-codegen)',
                flag: 'SkipCodeGen',
            },
            {
                label: '$(beaker) Skip Smoke Test',
                description: 'Skip service start and smoke tests (--skip-start)',
                flag: 'SkipStart',
            },
            {
                label: '$(zap) Fast Mode',
                description: 'Skip smoke test + optimize codegen checks (--fast)',
                flag: 'Fast',
            },
            {
                label: '$(refresh) Fresh Start',
                description: 'Ignore previous checkpoint, start from scratch (--no-resume)',
                flag: 'NoResume',
            },
            {
                label: '$(output) Verbose Logging',
                description: 'Show detailed output for all phases (--verbose)',
                flag: 'Verbose',
            },
        ];

        const picks = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select install options (press Enter with none selected for defaults)',
            title: 'MJ Installer: Options',
            canPickMany: true,
            ignoreFocusOut: true,
        });

        // User pressed Escape — abort entirely
        if (picks === undefined) return undefined;

        // Build flags from selections (empty array = all defaults)
        const flags: InstallOptionFlags = {
            SkipDB: false,
            SkipCodeGen: false,
            SkipStart: false,
            Fast: false,
            NoResume: false,
            Verbose: false,
        };
        for (const pick of picks) {
            flags[pick.flag] = true;
        }
        return flags;
    }

    /** Format active flags into a human-readable list for the confirm dialog. */
    private summarizeOptions(flags: InstallOptionFlags): string[] {
        const summary: string[] = [];
        if (flags.SkipDB) summary.push('Skip DB');
        if (flags.SkipCodeGen) summary.push('Skip CodeGen');
        if (flags.SkipStart) summary.push('Skip Smoke Test');
        if (flags.Fast) summary.push('Fast Mode');
        if (flags.NoResume) summary.push('Fresh Start');
        if (flags.Verbose) summary.push('Verbose');
        return summary;
    }

    /** Execute the install with progress tracking. */
    private async executeInstall(
        targetDir: string,
        version: string,
        flags: InstallOptionFlags
    ): Promise<void> {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Installing MemberJunction ${version}`,
                cancellable: true,
            },
            async (progress, token) => {
                token.onCancellationRequested(() => {
                    this.service.cancel();
                });

                // Subscribe to phase updates for progress messages
                const phaseListener = this.service.onPhaseUpdate(phases => {
                    const running = phases.find(p => p.Status === 'running');
                    const completed = phases.filter(p => p.Status === 'completed').length;
                    const total = phases.length;

                    if (running) {
                        progress.report({
                            message: `(${completed}/${total}) ${running.Description}`,
                        });
                    }
                });

                try {
                    await this.service.install(
                        {
                            Dir: targetDir,
                            Tag: version,
                            SkipDB: flags.SkipDB,
                            SkipCodeGen: flags.SkipCodeGen,
                            SkipStart: flags.SkipStart,
                            Fast: flags.Fast,
                        },
                        {
                            Yes: false,
                            Verbose: flags.Verbose,
                            NoResume: flags.NoResume,
                        }
                    );
                } finally {
                    phaseListener.dispose();
                }
            }
        );
    }

    // -------------------------------------------------------------------
    // Doctor command
    // -------------------------------------------------------------------

    private async runDoctor(): Promise<void> {
        if (this.service.status === 'running') {
            vscode.window.showWarningMessage('An install operation is already in progress.');
            return;
        }

        const targetDir = await this.pickTargetDirectory();
        if (!targetDir) return;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Running MJ Doctor',
                cancellable: false,
            },
            async (progress) => {
                const diagListener = this.service.onDiagnosticUpdate(diagnostics => {
                    progress.report({
                        message: `${diagnostics.length} check(s) completed`,
                    });
                });

                try {
                    await this.service.doctor(targetDir);
                } finally {
                    diagListener.dispose();
                }

                // Show summary
                const diags = this.service.diagnostics;
                const passed = diags.filter(d => d.Status === 'pass').length;
                const failed = diags.filter(d => d.Status === 'fail').length;
                const warned = diags.filter(d => d.Status === 'warn').length;

                vscode.window.showInformationMessage(
                    `MJ Doctor: ${passed} passed, ${warned} warning(s), ${failed} failed`,
                    'Show Details'
                ).then(selection => {
                    if (selection === 'Show Details') {
                        OutputChannel.show();
                    }
                });
            }
        );
    }

    // -------------------------------------------------------------------
    // Resume command
    // -------------------------------------------------------------------

    private async runResume(): Promise<void> {
        if (this.service.status === 'running') {
            vscode.window.showWarningMessage('An install operation is already in progress.');
            return;
        }

        // Look for .mj-install-state.json in workspace folders
        const stateFile = await this.findStateFile();
        if (!stateFile) {
            vscode.window.showWarningMessage(
                'No install checkpoint found. Look for .mj-install-state.json in your project directory.'
            );
            return;
        }

        // Resume() expects the directory containing the state file, not the file itself
        const stateDir = path.dirname(stateFile);

        const confirm = await vscode.window.showInformationMessage(
            `Resume install from checkpoint?`,
            { modal: true, detail: `Directory: ${stateDir}` },
            'Resume',
            'Cancel'
        );
        if (confirm !== 'Resume') return;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Resuming MJ Install',
                cancellable: true,
            },
            async (_progress, token) => {
                token.onCancellationRequested(() => {
                    this.service.cancel();
                });

                await this.service.resume(stateDir);
            }
        );
    }

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    /** Prompt user to select a target directory. */
    private async pickTargetDirectory(): Promise<string | undefined> {
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

        const items: (vscode.QuickPickItem & { path?: string })[] = [
            ...workspaceFolders.map(f => ({
                label: f.name,
                description: f.uri.fsPath,
                path: f.uri.fsPath,
            })),
            {
                label: '$(folder) Browse...',
                description: 'Select a different directory',
            },
        ];

        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select target directory for MJ installation',
            title: 'MJ Installer: Target Directory',
            ignoreFocusOut: true,
        });

        if (!pick) return undefined;

        if (pick.path) return pick.path;

        // Browse for folder
        const folders = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            title: 'Select MJ Installation Directory',
        });

        return folders?.[0]?.fsPath;
    }

    /** Prompt user to select a version, fetching from GitHub. */
    private async pickVersion(): Promise<string | undefined> {
        const versions = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Fetching MJ versions...',
                cancellable: false,
            },
            async () => {
                try {
                    return await this.service.listVersions(false);
                } catch {
                    vscode.window.showErrorMessage('Failed to fetch MJ versions from GitHub.');
                    return null;
                }
            }
        );

        if (!versions || versions.length === 0) {
            vscode.window.showErrorMessage('No MJ versions found.');
            return undefined;
        }

        const items = versions.map(v => ({
            label: v.Tag,
            description: v.ReleaseDate ? v.ReleaseDate.toLocaleDateString() : undefined,
            detail: v.Prerelease ? 'Pre-release' : undefined,
        }));

        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select MemberJunction version to install',
            title: 'MJ Installer: Version',
            ignoreFocusOut: true,
        });

        return pick?.label;
    }

    /** Search workspace folders for .mj-install-state.json */
    private async findStateFile(): Promise<string | undefined> {
        const folders = vscode.workspace.workspaceFolders ?? [];

        for (const folder of folders) {
            const statePath = path.join(folder.uri.fsPath, '.mj-install-state.json');
            if (fs.existsSync(statePath)) {
                return statePath;
            }
        }

        // Also allow user to browse
        const browse = await vscode.window.showInformationMessage(
            'No checkpoint file found in workspace. Browse for one?',
            'Browse',
            'Cancel'
        );

        if (browse !== 'Browse') return undefined;

        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'Install State': ['json'] },
            title: 'Select .mj-install-state.json',
        });

        return files?.[0]?.fsPath;
    }
}
