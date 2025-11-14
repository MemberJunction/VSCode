import * as vscode from 'vscode';
import { Feature } from '../../types';
import { EntityDiscovery } from '../../services/EntityDiscovery';
import { MetadataRootDiscovery } from '../../services/MetadataRootDiscovery';
import { MJSyncCompletionProvider } from '../../providers/MJSyncCompletionProvider';
import { MJSyncHoverProvider } from '../../providers/MJSyncHoverProvider';
import { MJSyncDiagnosticProvider } from '../../providers/MJSyncDiagnosticProvider';
import { OutputChannel } from '../../common/OutputChannel';
import { StatusBarManager } from '../../common/StatusBarManager';

/**
 * Metadata Sync feature - Phase 1
 * Provides IntelliSense, validation, and navigation for MetadataSync files
 * Uses dynamic providers based on actual entity definitions
 */
export class MetadataSyncFeature implements Feature {
    name = 'Metadata Sync';
    private diagnosticCollection: vscode.DiagnosticCollection;
    private diagnosticProvider: MJSyncDiagnosticProvider;
    private entityDiscovery: EntityDiscovery;
    private rootDiscovery: MetadataRootDiscovery;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('memberjunction');
        this.diagnosticProvider = new MJSyncDiagnosticProvider(this.diagnosticCollection);
        this.entityDiscovery = EntityDiscovery.getInstance();
        this.rootDiscovery = MetadataRootDiscovery.getInstance();
    }

    enabled(): boolean {
        const config = vscode.workspace.getConfiguration('memberjunction');
        return config.get('features.metadataSync.enabled', true);
    }

    async activate(context: vscode.ExtensionContext): Promise<void> {
        OutputChannel.info('Activating Metadata Sync feature...');

        try {
            // Initialize entity discovery
            await this.entityDiscovery.initialize();

            // Register status bar
            this.registerStatusBar();

            // Register file watchers
            this.registerFileWatchers(context);

            // Register commands
            this.registerCommands(context);

            // Register completion provider for JSON files
            const completionProvider = new MJSyncCompletionProvider();
            context.subscriptions.push(
                vscode.languages.registerCompletionItemProvider(
                    { language: 'json', pattern: '**/*.json' },
                    completionProvider,
                    '"', ':', '@', '.'  // Trigger characters
                )
            );

            // Register hover provider
            const hoverProvider = new MJSyncHoverProvider();
            context.subscriptions.push(
                vscode.languages.registerHoverProvider(
                    { language: 'json', pattern: '**/*.json' },
                    hoverProvider
                )
            );

            // Register validation on save and on open
            if (vscode.workspace.getConfiguration('memberjunction').get('metadataSync.autoValidate', true)) {
                // Validate on save
                context.subscriptions.push(
                    vscode.workspace.onDidSaveTextDocument(doc => {
                        if (this.isMetadataFile(doc)) {
                            this.diagnosticProvider.validateDocument(doc);
                        }
                    })
                );

                // Validate on open
                context.subscriptions.push(
                    vscode.workspace.onDidOpenTextDocument(doc => {
                        if (this.isMetadataFile(doc)) {
                            this.diagnosticProvider.validateDocument(doc);
                        }
                    })
                );

                // Validate on change (debounced)
                let timeout: NodeJS.Timeout | undefined;
                context.subscriptions.push(
                    vscode.workspace.onDidChangeTextDocument(event => {
                        if (this.isMetadataFile(event.document)) {
                            if (timeout) {
                                clearTimeout(timeout);
                            }
                            timeout = setTimeout(() => {
                                this.diagnosticProvider.validateDocument(event.document);
                            }, 500);  // 500ms debounce
                        }
                    })
                );

                // Validate on close
                context.subscriptions.push(
                    vscode.workspace.onDidCloseTextDocument(doc => {
                        this.diagnosticProvider.clear(doc.uri);
                    })
                );
            }

            // Validate currently open metadata files
            this.validateOpenFiles();

            OutputChannel.info('Metadata Sync feature activated successfully (using dynamic providers)');
        } catch (error) {
            OutputChannel.error('Failed to activate Metadata Sync feature', error as Error);
            vscode.window.showErrorMessage('Failed to activate MemberJunction Metadata Sync');
        }
    }

    async deactivate(): Promise<void> {
        this.diagnosticCollection.dispose();
        this.rootDiscovery.clearCache();
        OutputChannel.info('Metadata Sync feature deactivated');
    }

    private registerStatusBar(): void {
        const config = vscode.workspace.getConfiguration('memberjunction');
        if (!config.get('metadataSync.showStatusBar', true)) {
            return;
        }

        StatusBarManager.register('metadata-sync', {
            alignment: vscode.StatusBarAlignment.Left,
            priority: 100
        });

        const entityCount = this.entityDiscovery.getAllEntities().length;
        StatusBarManager.update(
            'metadata-sync',
            `$(database) MJ: ${entityCount} entities`,
            'MemberJunction entities loaded',
            'memberjunction.refreshEntityExplorer'
        );
    }

    private registerFileWatchers(context: vscode.ExtensionContext): void {
        // Watch for changes to entity files
        const entityWatcher = vscode.workspace.createFileSystemWatcher('**/packages/GeneratedEntities/src/**/*.ts');

        entityWatcher.onDidChange(() => {
            OutputChannel.info('Entity files changed, refreshing...');
            this.entityDiscovery.refresh();
        });

        entityWatcher.onDidCreate(() => {
            OutputChannel.info('New entity file created, refreshing...');
            this.entityDiscovery.refresh();
        });

        entityWatcher.onDidDelete(() => {
            OutputChannel.info('Entity file deleted, refreshing...');
            this.entityDiscovery.refresh();
        });

        context.subscriptions.push(entityWatcher);

        // Watch for changes to .mj-sync.json files to invalidate cache
        const syncWatcher = vscode.workspace.createFileSystemWatcher('**/.mj-sync.json');

        syncWatcher.onDidChange((uri) => {
            OutputChannel.info('.mj-sync.json changed, invalidating cache');
            this.rootDiscovery.invalidateCache(uri.fsPath);
        });

        syncWatcher.onDidCreate((uri) => {
            OutputChannel.info('.mj-sync.json created, invalidating cache');
            this.rootDiscovery.invalidateCache(uri.fsPath);
        });

        syncWatcher.onDidDelete((uri) => {
            OutputChannel.info('.mj-sync.json deleted, invalidating cache');
            this.rootDiscovery.invalidateCache(uri.fsPath);
        });

        context.subscriptions.push(syncWatcher);
    }

    private registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.validateMetadata', () => {
                const editor = vscode.window.activeTextEditor;
                if (editor && this.isMetadataFile(editor.document)) {
                    this.diagnosticProvider.validateDocument(editor.document);
                    vscode.window.showInformationMessage('Metadata validation complete');
                } else {
                    vscode.window.showWarningMessage('No metadata file is currently open');
                }
            })
        );
    }

    private isMetadataFile(document: vscode.TextDocument): boolean {
        if (document.languageId !== 'json') {
            return false;
        }

        const fsPath = document.uri.fsPath;

        // Check if it's a .mj-sync.json file or within a metadata directory
        return fsPath.endsWith('.mj-sync.json') ||
               fsPath.includes('/metadata/') ||
               fsPath.includes('\\metadata\\');  // Windows support
    }

    private validateOpenFiles(): void {
        vscode.workspace.textDocuments.forEach(doc => {
            if (this.isMetadataFile(doc)) {
                this.diagnosticProvider.validateDocument(doc);
            }
        });
    }

    onConfigChange(): void {
        // Handle configuration changes
        this.registerStatusBar();
    }
}
