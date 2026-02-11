import * as vscode from 'vscode';
import * as path from 'path';
import { Feature } from '../../types';
import { MigrationService, MigrationInfo } from '../../services/MigrationService';
import { MigrationExplorerProvider } from '../../providers/MigrationExplorerProvider';
import { StatusBarManager } from '../../common/StatusBarManager';
import { OutputChannel } from '../../common/OutputChannel';
import { CodeGenService } from '../../services/CodeGenService';
import { ConnectionService } from '../../services/ConnectionService';

/**
 * Phase 4 Part 2: Database Migration Management Feature
 *
 * Provides:
 * - Migration Explorer tree view
 * - One-click migration execution
 * - Migration status tracking
 * - SQL preview
 * - File system watching for new migrations
 */
export class MigrationManagerFeature implements Feature {
    name = 'migration-manager';

    private migrationService: MigrationService;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.migrationService = MigrationService.getInstance();
    }

    enabled(): boolean {
        const config = vscode.workspace.getConfiguration('memberjunction');
        return config.get<boolean>('features.migrationManager.enabled', true);
    }

    async activate(context: vscode.ExtensionContext): Promise<void> {
        if (!this.enabled()) {
            OutputChannel.info('Migration Manager feature is disabled');
            return;
        }

        OutputChannel.info('Activating Migration Manager feature...');

        // Initialize migration service
        const initialized = await this.migrationService.initialize();
        if (!initialized) {
            OutputChannel.warn('Migration Manager feature will not be available (not in MJ repository)');
            return;
        }

        // Register tree view
        this.setupTreeView(context);

        // Register commands
        this.registerCommands(context);

        // Set up status bar
        this.setupStatusBar(context);

        // Set up file system watcher
        this.setupFileWatcher(context);

        // Set up event listeners
        this.setupEventListeners(context);

        OutputChannel.info('Migration Manager feature activated');
    }

    async deactivate(): Promise<void> {
        this.fileWatcher?.dispose();
        this.disposables.forEach(d => d.dispose());
        OutputChannel.info('Migration Manager feature deactivated');
    }

    /**
     * Set up tree view
     */
    private setupTreeView(context: vscode.ExtensionContext): void {
        const provider = new MigrationExplorerProvider();

        const view = vscode.window.createTreeView('memberjunction.migrationExplorer', {
            treeDataProvider: provider,
            showCollapseAll: true
        });

        context.subscriptions.push(view);
    }

    /**
     * Register commands
     */
    private registerCommands(context: vscode.ExtensionContext): void {
        // Refresh migrations
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.refreshMigrations', async () => {
                await this.refreshMigrations();
            })
        );

        // Preview migration SQL
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.previewMigrationSQL', async (migration: MigrationInfo) => {
                await this.previewMigrationSQL(migration);
            })
        );

        // Show migration status
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.showMigrationStatus', () => {
                this.showMigrationStatus();
            })
        );

        // Open migrations folder
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.openMigrationsFolder', () => {
                this.openMigrationsFolder();
            })
        );

        // Run migrations
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.runMigrations', async () => {
                await this.runMigrations();
            })
        );
    }

    /**
     * Set up status bar
     */
    private setupStatusBar(_context: vscode.ExtensionContext): void {
        StatusBarManager.register('migrations', {
            alignment: vscode.StatusBarAlignment.Left,
            priority: -100  // Lower priority than CodeGen
        });

        this.updateStatusBar();
    }

    /**
     * Set up file system watcher
     */
    private setupFileWatcher(context: vscode.ExtensionContext): void {
        const mjRoot = this.migrationService.findMJRoot();
        if (!mjRoot) {
            return;
        }

        const config = vscode.workspace.getConfiguration('memberjunction');
        const autoRefresh = config.get<boolean>('migrations.autoRefresh', true);

        if (!autoRefresh) {
            OutputChannel.info('Migration auto-refresh is disabled');
            return;
        }

        const migrationsPath = path.join(mjRoot, 'migrations');
        const sqlPattern = new vscode.RelativePattern(migrationsPath, '**/*.sql');

        this.fileWatcher = vscode.workspace.createFileSystemWatcher(sqlPattern);

        this.fileWatcher.onDidCreate(() => {
            this.onMigrationFileChanged('created');
        });

        this.fileWatcher.onDidChange(() => {
            this.onMigrationFileChanged('modified');
        });

        context.subscriptions.push(this.fileWatcher);

        OutputChannel.info(`Watching for migration changes in ${migrationsPath}`);
    }

    /**
     * Handle migration file changes
     */
    private onMigrationFileChanged(action: 'created' | 'modified'): void {
        OutputChannel.info(`Migration file ${action}, refreshing...`);
        this.refreshMigrations();
    }

    /**
     * Set up event listeners
     */
    private setupEventListeners(_context: vscode.ExtensionContext): void {
        const statusListener = this.migrationService.onStatusChange(() => {
            this.updateStatusBar();
        });
        this.disposables.push(statusListener);
    }

    /**
     * Update status bar
     */
    private updateStatusBar(): void {
        const status = this.migrationService.getStatus();

        if (status.pending > 0) {
            StatusBarManager.updateWithColor(
                'migrations',
                `$(database) ${status.pending} Migration${status.pending > 1 ? 's' : ''}`,
                `${status.pending} pending migration(s)\nClick for options`,
                'memberjunction.showMigrationStatus',
                new vscode.ThemeColor('statusBarItem.warningBackground')
            );
        } else {
            StatusBarManager.update(
                'migrations',
                '$(database) Migrations',
                'All migrations applied\nClick for options',
                'memberjunction.showMigrationStatus'
            );
        }
    }

    /**
     * Refresh migrations
     */
    private async refreshMigrations(): Promise<void> {
        try {
            await this.migrationService.refreshMigrations(true);
            vscode.window.showInformationMessage('Migrations refreshed');
        } catch (error) {
            OutputChannel.error('Failed to refresh migrations', error as Error);
            vscode.window.showErrorMessage(`Failed to refresh migrations: ${(error as Error).message}`);
        }
    }

    /**
     * Run pending migrations
     */
    private async runMigrations(): Promise<void> {
        const status = this.migrationService.getStatus();

        if (status.pending === 0) {
            vscode.window.showInformationMessage('No pending migrations to run');
            return;
        }

        // Get list of pending migrations
        const pending = this.migrationService.getMigrations()
            .filter(m => m.status === 'pending');

        // Show confirmation dialog
        const migrationList = pending
            .slice(0, 5)
            .map(m => `  • ${m.fileName}`)
            .join('\n');

        const moreText = pending.length > 5 ? `\n  ... and ${pending.length - 5} more` : '';

        const config = vscode.workspace.getConfiguration('memberjunction');
        const confirmBeforeRun = config.get<boolean>('migrations.confirmBeforeRun', true);

        let shouldRun = true;
        if (confirmBeforeRun) {
            const choice = await vscode.window.showWarningMessage(
                `Run ${status.pending} Pending Migration${status.pending > 1 ? 's' : ''}?`,
                {
                    modal: true,
                    detail: `This will apply the following migrations to your database:\n\n${migrationList}${moreText}\n\nThis operation cannot be undone.`
                },
                'Run Migrations',
                'Cancel'
            );

            shouldRun = choice === 'Run Migrations';
        }

        if (!shouldRun) {
            return;
        }

        // Execute migrations with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Running Migrations',
                cancellable: false
            },
            async (progress) => {
                progress.report({ message: 'Executing migrations via MJCLI...' });

                OutputChannel.show();

                try {
                    const result = await this.migrationService.executeMigrations();

                    if (result.success) {
                        // Attempt to reconnect if connection failed previously
                        const connectionService = ConnectionService.getInstance();
                        if (!connectionService.isConnected) {
                            OutputChannel.info('Attempting to reconnect to database after migrations...');
                            const reconnected = await connectionService.reconnect();
                            if (reconnected) {
                                OutputChannel.info('Successfully reconnected to database');
                            } else {
                                OutputChannel.warn('Failed to reconnect - you may need to reload VSCode window');
                            }
                        }

                        // Notify CodeGen that schema changes were made
                        const codeGenService = CodeGenService.getInstance();
                        codeGenService.addChange({
                            type: 'migration',
                            filePath: 'database',
                            description: 'Database migrations applied - schema may have changed',
                            timestamp: new Date()
                        });

                        // Refresh migration status to reflect changes
                        await this.migrationService.refreshMigrations(true);

                        vscode.window.showInformationMessage(
                            `Migrations completed successfully in ${(result.duration / 1000).toFixed(1)}s`,
                            'Show Output'
                        ).then(selection => {
                            if (selection === 'Show Output') {
                                OutputChannel.show();
                            }
                        });
                    } else {
                        vscode.window.showErrorMessage(
                            `Migration failed: ${result.message}`,
                            'Show Output'
                        ).then(selection => {
                            if (selection === 'Show Output') {
                                OutputChannel.show();
                            }
                        });
                    }
                } catch (error) {
                    OutputChannel.error('Migration execution failed', error as Error);
                    vscode.window.showErrorMessage(
                        `Migration execution failed: ${(error as Error).message}`,
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
     * Preview migration SQL
     */
    private async previewMigrationSQL(migration: MigrationInfo): Promise<void> {
        try {
            const content = await this.migrationService.readMigrationSQL(migration.filePath);

            const doc = await vscode.workspace.openTextDocument({
                content: content,
                language: 'sql'
            });

            await vscode.window.showTextDocument(doc, {
                preview: true,
                preserveFocus: false
            });

        } catch (error) {
            OutputChannel.error('Failed to preview migration SQL', error as Error);
            vscode.window.showErrorMessage(`Failed to preview SQL: ${(error as Error).message}`);
        }
    }

    /**
     * Show migration status quick pick
     */
    private showMigrationStatus(): void {
        const status = this.migrationService.getStatus();
        const migrations = this.migrationService.getMigrations();

        const items: vscode.QuickPickItem[] = [];

        // Status summary
        items.push({
            label: '$(info) Migration Status',
            description: `${status.pending} pending, ${status.applied} applied`,
            detail: `Total: ${status.total} migrations`
        });

        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });

        // Actions
        items.push({
            label: '$(refresh) Refresh Migrations',
            description: 'Reload migration list from file system'
        });

        items.push({
            label: '$(folder-opened) Open Migrations Folder',
            description: 'Open migrations directory in file explorer'
        });

        if (status.pending > 0) {
            items.push({
                label: '$(play) Run Pending Migrations',
                description: `Execute ${status.pending} pending migration(s)`,
                detail: 'Coming soon'
            });
        }

        items.push({
            label: '$(output) Show Output',
            description: 'View migration logs'
        });

        // Recent migrations
        if (migrations.length > 0) {
            items.push({ label: 'Recent Migrations', kind: vscode.QuickPickItemKind.Separator });

            const recent = migrations.slice(-5).reverse();
            for (const migration of recent) {
                const icon = migration.status === 'applied' ? '$(check)' : '$(circle-outline)';
                items.push({
                    label: `${icon} ${migration.fileName}`,
                    description: migration.status,
                    detail: migration.description
                });
            }
        }

        vscode.window.showQuickPick(items, {
            placeHolder: 'Migration Management',
            title: 'MemberJunction Migrations'
        }).then(selected => {
            if (!selected) return;

            if (selected.label.includes('Refresh')) {
                vscode.commands.executeCommand('memberjunction.refreshMigrations');
            } else if (selected.label.includes('Open Migrations Folder')) {
                vscode.commands.executeCommand('memberjunction.openMigrationsFolder');
            } else if (selected.label.includes('Run Pending')) {
                vscode.commands.executeCommand('memberjunction.runMigrations');
            } else if (selected.label.includes('Output')) {
                OutputChannel.show();
            }
        });
    }

    /**
     * Open migrations folder in file explorer
     */
    private openMigrationsFolder(): void {
        const mjRoot = this.migrationService.findMJRoot();
        if (!mjRoot) {
            vscode.window.showErrorMessage('Could not find MJ repository root');
            return;
        }

        const migrationsPath = path.join(mjRoot, 'migrations');
        const uri = vscode.Uri.file(migrationsPath);
        vscode.commands.executeCommand('revealFileInOS', uri);
    }
}
