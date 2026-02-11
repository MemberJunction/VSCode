import * as vscode from 'vscode';
import * as path from 'path';
import { Feature } from '../../types';
import { CodeGenService, CodeGenStatus, CodeGenChange } from '../../services/CodeGenService';
import { StatusBarManager } from '../../common/StatusBarManager';
import { OutputChannel } from '../../common/OutputChannel';

/**
 * Phase 2: Code Generation Feature
 *
 * Provides:
 * - Detection of when CodeGen is needed (SQL migrations, schema changes)
 * - One-click CodeGen execution
 * - Diff preview of generated files
 * - Auto-notification on SQL file changes
 */
export class CodeGenFeature implements Feature {
    name = 'codegen';

    private codeGenService: CodeGenService;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private statusBarItem: vscode.StatusBarItem | undefined;
    private disposables: vscode.Disposable[] = [];
    private autoRunTimer: NodeJS.Timeout | undefined;
    private autoRunCountdown: number = 0;
    private countdownInterval: NodeJS.Timeout | undefined;

    constructor() {
        this.codeGenService = CodeGenService.getInstance();
    }

    enabled(): boolean {
        const config = vscode.workspace.getConfiguration('memberjunction');
        return config.get<boolean>('features.codegen.enabled', true);
    }

    async activate(context: vscode.ExtensionContext): Promise<void> {
        if (!this.enabled()) {
            OutputChannel.info('CodeGen feature is disabled');
            return;
        }

        OutputChannel.info('Activating CodeGen feature...');

        // Register commands
        this.registerCommands(context);

        // Set up file watchers
        this.setupFileWatchers(context);

        // Set up status bar
        this.setupStatusBar(context);

        // Listen to CodeGen service events
        this.setupEventListeners(context);

        OutputChannel.info('CodeGen feature activated');
    }

    async deactivate(): Promise<void> {
        this.fileWatcher?.dispose();
        this.statusBarItem?.dispose();
        this.disposables.forEach(d => d.dispose());
        OutputChannel.info('CodeGen feature deactivated');
    }

    /**
     * Register CodeGen commands
     */
    private registerCommands(context: vscode.ExtensionContext): void {
        // Run CodeGen command
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.runCodeGen', async () => {
                await this.runCodeGen();
            })
        );

        // Run CodeGen with skipDb flag
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.runCodeGenSkipDb', async () => {
                await this.runCodeGen({ skipDb: true });
            })
        );

        // Preview CodeGen changes (dry run simulation)
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.previewCodeGen', async () => {
                await this.previewCodeGenChanges();
            })
        );

        // Clear pending changes
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.clearCodeGenChanges', () => {
                this.codeGenService.clearChanges();
                vscode.window.showInformationMessage('CodeGen pending changes cleared');
            })
        );

        // Show CodeGen status
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.showCodeGenStatus', () => {
                this.showCodeGenStatus();
            })
        );

        // Cancel auto-run
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.cancelAutoRun', () => {
                this.cancelAutoRun();
                vscode.window.showInformationMessage('CodeGen auto-run cancelled');
            })
        );
    }

    /**
     * Set up file watchers to detect changes that require CodeGen
     */
    private setupFileWatchers(context: vscode.ExtensionContext): void {
        const mjRoot = this.codeGenService.findMJRoot();

        if (!mjRoot) {
            OutputChannel.info('MJ repository not found, file watching disabled');
            return;
        }

        // Watch for SQL migration files
        const migrationsPath = this.codeGenService.getMigrationsPath(mjRoot);
        const sqlPattern = new vscode.RelativePattern(migrationsPath, '**/*.sql');

        this.fileWatcher = vscode.workspace.createFileSystemWatcher(sqlPattern);

        this.fileWatcher.onDidCreate((uri) => {
            this.onMigrationFileChanged(uri, 'created');
        });

        this.fileWatcher.onDidChange((uri) => {
            this.onMigrationFileChanged(uri, 'modified');
        });

        context.subscriptions.push(this.fileWatcher);

        OutputChannel.info(`Watching for SQL migrations in ${migrationsPath}`);
    }

    /**
     * Handle migration file changes
     */
    private onMigrationFileChanged(uri: vscode.Uri, action: 'created' | 'modified'): void {
        const fileName = path.basename(uri.fsPath);

        // Ignore CodeGen output files
        if (fileName.startsWith('CodeGen_Run_')) {
            return;
        }

        const change: CodeGenChange = {
            type: 'migration',
            filePath: uri.fsPath,
            description: `Migration file ${action}: ${fileName}`,
            timestamp: new Date()
        };

        this.codeGenService.addChange(change);

        // Check if auto-run is enabled
        const config = vscode.workspace.getConfiguration('memberjunction');
        const autoRunEnabled = config.get<boolean>('codegen.autoRun', false);

        if (autoRunEnabled) {
            this.scheduleAutoRun();
        }
        // Status bar will update automatically via event listeners
    }

    /**
     * Schedule auto-run of CodeGen with debouncing
     */
    private scheduleAutoRun(): void {
        const config = vscode.workspace.getConfiguration('memberjunction');
        const delay = config.get<number>('codegen.autoRunDelay', 5000);

        // Clear existing timer (debounce)
        if (this.autoRunTimer) {
            clearTimeout(this.autoRunTimer);
        }
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }

        // Start countdown
        this.autoRunCountdown = Math.ceil(delay / 1000);
        this.updateAutoRunStatus();

        // Update countdown every second
        this.countdownInterval = setInterval(() => {
            this.autoRunCountdown--;
            if (this.autoRunCountdown > 0) {
                this.updateAutoRunStatus();
            }
        }, 1000);

        // Schedule the auto-run
        this.autoRunTimer = setTimeout(async () => {
            if (this.countdownInterval) {
                clearInterval(this.countdownInterval);
                this.countdownInterval = undefined;
            }

            await this.executeAutoRun();
        }, delay);

        OutputChannel.info(`Auto-run scheduled in ${delay / 1000}s`);
    }

    /**
     * Cancel scheduled auto-run
     */
    private cancelAutoRun(): void {
        if (this.autoRunTimer) {
            clearTimeout(this.autoRunTimer);
            this.autoRunTimer = undefined;
        }
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = undefined;
        }
        this.autoRunCountdown = 0;
        this.updateStatusBar(this.codeGenService.status);
    }

    /**
     * Update status bar with auto-run countdown
     */
    private updateAutoRunStatus(): void {
        const changes = this.codeGenService.pendingChanges;
        StatusBarManager.updateWithColor(
            'codegen',
            `$(clock) CodeGen in ${this.autoRunCountdown}s...`,
            `Auto-running CodeGen in ${this.autoRunCountdown} seconds\n${changes.length} change(s) detected\n\nClick to cancel`,
            'memberjunction.cancelAutoRun',
            new vscode.ThemeColor('statusBarItem.warningBackground')
        );
    }

    /**
     * Execute the auto-run
     */
    private async executeAutoRun(): Promise<void> {
        const config = vscode.workspace.getConfiguration('memberjunction');
        const skipDb = config.get<boolean>('codegen.autoRunSkipDb', false);

        OutputChannel.info(`Auto-running CodeGen${skipDb ? ' (skip database)' : ''}...`);

        // Show progress notification
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Auto-running CodeGen',
                cancellable: false
            },
            async (progress) => {
                progress.report({ message: 'Starting code generation...' });

                const result = await this.codeGenService.runCodeGen({ skipDb });

                if (result.success) {
                    const fileCount = result.generatedFiles.length;
                    vscode.window.showInformationMessage(
                        `CodeGen auto-completed in ${(result.duration / 1000).toFixed(1)}s. ${fileCount} file(s) updated.`
                    );
                } else {
                    vscode.window.showErrorMessage(
                        `CodeGen auto-run failed: ${result.message}`,
                        'Show Output'
                    ).then(selection => {
                        if (selection === 'Show Output') {
                            OutputChannel.show();
                        }
                    });
                }
            }
        );
    }

    /**
     * Set up status bar for CodeGen
     */
    private setupStatusBar(_context: vscode.ExtensionContext): void {
        StatusBarManager.register('codegen', {
            alignment: vscode.StatusBarAlignment.Left,
            priority: -99  // Lower priority than metadata-sync
        });

        this.updateStatusBar(this.codeGenService.status);
    }

    /**
     * Set up event listeners for CodeGen service
     */
    private setupEventListeners(_context: vscode.ExtensionContext): void {
        // Status change listener
        const statusListener = this.codeGenService.onStatusChange((status) => {
            this.updateStatusBar(status);
        });
        this.disposables.push(statusListener);

        // Changes detected listener
        const changesListener = this.codeGenService.onChangesDetected(() => {
            this.updateStatusBar(this.codeGenService.status);
        });
        this.disposables.push(changesListener);
    }

    /**
     * Update status bar based on CodeGen status
     */
    private updateStatusBar(status: CodeGenStatus): void {
        const changes = this.codeGenService.pendingChanges;

        switch (status) {
            case 'idle':
                StatusBarManager.update(
                    'codegen',
                    '$(code) CodeGen',
                    'No pending changes - Click for options',
                    'memberjunction.showCodeGenStatus'
                );
                break;

            case 'needed':
                StatusBarManager.updateWithColor(
                    'codegen',
                    `$(alert) CodeGen: ${changes.length} change(s)`,
                    this.createChangesTooltip(changes),
                    'memberjunction.showCodeGenStatus',
                    new vscode.ThemeColor('statusBarItem.warningBackground')
                );
                break;

            case 'running':
                StatusBarManager.update(
                    'codegen',
                    '$(sync~spin) CodeGen Running...',
                    'Code generation in progress',
                    undefined
                );
                break;

            case 'completed':
                StatusBarManager.update(
                    'codegen',
                    '$(check) CodeGen Complete',
                    'Code generation completed successfully',
                    'memberjunction.showCodeGenStatus'
                );
                // Reset to idle after a delay
                setTimeout(() => {
                    if (this.codeGenService.status === 'completed') {
                        this.updateStatusBar('idle');
                    }
                }, 5000);
                break;

            case 'error':
                StatusBarManager.updateWithColor(
                    'codegen',
                    '$(error) CodeGen Error',
                    'Code generation failed - Click for details',
                    'memberjunction.showCodeGenStatus',
                    new vscode.ThemeColor('statusBarItem.errorBackground')
                );
                break;
        }
    }

    /**
     * Create tooltip text for pending changes
     */
    private createChangesTooltip(changes: CodeGenChange[]): string {
        const lines = ['CodeGen may be needed:', ''];

        for (const change of changes.slice(0, 5)) {
            lines.push(`• ${change.description}`);
        }

        if (changes.length > 5) {
            lines.push(`  ... and ${changes.length - 5} more`);
        }

        lines.push('', 'Click for options');

        return lines.join('\n');
    }

    /**
     * Run CodeGen
     */
    private async runCodeGen(options: { skipDb?: boolean } = {}): Promise<void> {
        const mjRoot = this.codeGenService.findMJRoot();

        if (!mjRoot) {
            vscode.window.showErrorMessage(
                'Could not find MemberJunction repository. Make sure mj.config.cjs exists in your workspace or a sibling directory.'
            );
            return;
        }

        // Confirm with user
        const confirm = await vscode.window.showInformationMessage(
            `Run CodeGen${options.skipDb ? ' (skip database)' : ''}?`,
            { modal: true, detail: `This will regenerate code in ${mjRoot}` },
            'Run',
            'Cancel'
        );

        if (confirm !== 'Run') {
            return;
        }

        // Show progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Running CodeGen',
                cancellable: false
            },
            async (progress) => {
                progress.report({ message: 'Starting code generation...' });

                const result = await this.codeGenService.runCodeGen(options);

                if (result.success) {
                    const fileCount = result.generatedFiles.length;
                    vscode.window.showInformationMessage(
                        `CodeGen completed in ${(result.duration / 1000).toFixed(1)}s. ${fileCount} file(s) updated.`,
                        'Show Output'
                    ).then(selection => {
                        if (selection === 'Show Output') {
                            OutputChannel.show();
                        }
                    });
                } else {
                    vscode.window.showErrorMessage(
                        `CodeGen failed: ${result.message}`,
                        'Show Output'
                    ).then(selection => {
                        if (selection === 'Show Output') {
                            OutputChannel.show();
                        }
                    });
                }
            }
        );
    }

    /**
     * Preview CodeGen changes (shows what files would be modified)
     */
    private async previewCodeGenChanges(): Promise<void> {
        const mjRoot = this.codeGenService.findMJRoot();

        if (!mjRoot) {
            vscode.window.showErrorMessage('Could not find MemberJunction repository.');
            return;
        }

        // Take snapshot of current state
        const beforeSnapshots = await this.codeGenService.snapshotGeneratedFiles(mjRoot);

        // Show information about what would be checked
        const generatedPaths = this.codeGenService.getGeneratedFilePaths(mjRoot);

        const items = generatedPaths.map(p => ({
            label: path.basename(p),
            description: path.dirname(p).replace(mjRoot, ''),
            detail: 'Generated file'
        }));

        const action = await vscode.window.showQuickPick(
            [
                { label: '$(play) Run CodeGen and Show Diff', description: 'Execute CodeGen then show changes', action: 'run' },
                { label: '$(file-code) View Generated Files', description: 'See current generated file locations', action: 'view' },
                ...items.map(i => ({ ...i, action: 'open' as const }))
            ],
            {
                placeHolder: 'CodeGen Preview Options',
                title: 'Preview CodeGen Changes'
            }
        );

        if (!action) {
            return;
        }

        if (action.action === 'run') {
            // Run CodeGen and then show diff
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Running CodeGen for Preview',
                    cancellable: false
                },
                async () => {
                    const result = await this.codeGenService.runCodeGen();

                    if (result.success) {
                        await this.codeGenService.showDiffPreview(beforeSnapshots, mjRoot);
                    } else {
                        vscode.window.showErrorMessage(`CodeGen failed: ${result.message}`);
                    }
                }
            );
        } else if (action.action === 'open' && 'description' in action) {
            // Open the specific file
            const filePath = generatedPaths.find(p => p.includes(action.label));
            if (filePath) {
                const doc = await vscode.workspace.openTextDocument(filePath);
                await vscode.window.showTextDocument(doc);
            }
        }
    }

    /**
     * Show CodeGen status quick pick
     */
    private showCodeGenStatus(): void {
        const changes = this.codeGenService.pendingChanges;
        const status = this.codeGenService.status;

        const items: vscode.QuickPickItem[] = [
            {
                label: '$(play) Run CodeGen',
                description: 'Full code generation',
                detail: 'Regenerate all TypeScript entities, SQL, Angular, and GraphQL code'
            },
            {
                label: '$(debug-step-over) Run CodeGen (Skip DB)',
                description: 'Skip database operations',
                detail: 'Faster regeneration, skips database schema checks'
            },
            {
                label: '$(diff) Preview Changes',
                description: 'Run CodeGen and show diff',
                detail: 'See what files will be modified'
            }
        ];

        if (changes.length > 0) {
            items.push({
                label: '$(clear-all) Clear Pending Changes',
                description: `${changes.length} change(s) pending`,
                detail: 'Dismiss pending change notifications'
            });
        }

        items.push({
            label: '$(output) Show Output',
            description: 'View CodeGen logs',
            detail: 'Open the MemberJunction output channel'
        });

        vscode.window.showQuickPick(items, {
            placeHolder: `CodeGen Status: ${status}`,
            title: 'MemberJunction Code Generation'
        }).then(selected => {
            if (!selected) return;

            if (selected.label.includes('Run CodeGen (Skip DB)')) {
                vscode.commands.executeCommand('memberjunction.runCodeGenSkipDb');
            } else if (selected.label.includes('Run CodeGen')) {
                vscode.commands.executeCommand('memberjunction.runCodeGen');
            } else if (selected.label.includes('Preview')) {
                vscode.commands.executeCommand('memberjunction.previewCodeGen');
            } else if (selected.label.includes('Clear')) {
                vscode.commands.executeCommand('memberjunction.clearCodeGenChanges');
            } else if (selected.label.includes('Output')) {
                OutputChannel.show();
            }
        });
    }
}
