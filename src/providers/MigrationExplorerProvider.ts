import * as vscode from 'vscode';
import { MigrationService, MigrationInfo } from '../services/MigrationService';
import { OutputChannel } from '../common/OutputChannel';

/**
 * Tree item data types
 */
export interface MigrationTreeItemData {
    type: 'root' | 'category' | 'migration';
    category?: 'versioned' | 'repeatable' | 'baseline' | 'codegen';
    migration?: MigrationInfo;
}

/**
 * Tree item for Migration Explorer
 */
export class MigrationTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly data: MigrationTreeItemData,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);

        // Set context value for menu contributions
        if (data.type === 'migration') {
            this.contextValue = 'migration';
        } else if (data.type === 'category') {
            this.contextValue = 'category';
        }

        // Set icons based on type and status
        this.setIcon();

        // Set tooltip
        this.setTooltip();

        // Set description
        this.setDescription();
    }

    private setIcon(): void {
        if (this.data.type === 'root') {
            this.iconPath = new vscode.ThemeIcon('database');
        } else if (this.data.type === 'category') {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else if (this.data.type === 'migration' && this.data.migration) {
            const migration = this.data.migration;

            // Set icon based on status
            switch (migration.status) {
                case 'applied':
                    this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
                    break;
                case 'failed':
                    this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
                    break;
                case 'pending':
                    this.iconPath = new vscode.ThemeIcon('circle-outline');
                    break;
                default:
                    this.iconPath = new vscode.ThemeIcon('question');
            }
        }
    }

    private setTooltip(): void {
        if (this.data.type === 'migration' && this.data.migration) {
            const migration = this.data.migration;
            const lines: string[] = [];

            lines.push(`**${migration.fileName}**`);
            lines.push('');
            lines.push(`Type: ${migration.type}`);
            lines.push(`Version: ${migration.version}`);
            lines.push(`Status: ${migration.status}`);

            if (migration.installedOn) {
                lines.push(`Installed: ${migration.installedOn.toLocaleString()}`);
            }

            if (migration.executionTime) {
                lines.push(`Execution Time: ${migration.executionTime}ms`);
            }

            lines.push('');
            lines.push('Click to preview SQL');

            this.tooltip = new vscode.MarkdownString(lines.join('\n'));
        } else if (this.data.type === 'category') {
            this.tooltip = `${this.label}`;
        }
    }

    private setDescription(): void {
        if (this.data.type === 'migration' && this.data.migration) {
            const migration = this.data.migration;

            if (migration.status === 'applied' && migration.installedOn) {
                // Show how long ago it was applied
                const now = new Date();
                const diff = now.getTime() - migration.installedOn.getTime();
                const days = Math.floor(diff / (1000 * 60 * 60 * 24));

                if (days === 0) {
                    this.description = 'Applied today';
                } else if (days === 1) {
                    this.description = 'Applied yesterday';
                } else if (days < 7) {
                    this.description = `Applied ${days}d ago`;
                } else if (days < 30) {
                    const weeks = Math.floor(days / 7);
                    this.description = `Applied ${weeks}w ago`;
                } else {
                    const months = Math.floor(days / 30);
                    this.description = `Applied ${months}mo ago`;
                }
            } else {
                this.description = migration.status;
            }
        }
    }
}

/**
 * Tree data provider for Migration Explorer
 */
export class MigrationExplorerProvider implements vscode.TreeDataProvider<MigrationTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<MigrationTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private migrationService: MigrationService;

    constructor() {
        this.migrationService = MigrationService.getInstance();

        // Listen to migration status changes
        this.migrationService.onStatusChange(() => {
            this.refresh();
        });
    }

    /**
     * Refresh the tree view
     */
    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get tree item
     */
    getTreeItem(element: MigrationTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children for tree item
     */
    async getChildren(element?: MigrationTreeItem): Promise<MigrationTreeItem[]> {
        try {
            // Root level - show categories
            if (!element) {
                return this.getRootItems();
            }

            // Category level - show migrations of that type
            if (element.data.type === 'category') {
                return this.getCategoryItems(element.data.category!);
            }

            // Migration items have no children
            return [];

        } catch (error) {
            OutputChannel.error('Failed to get tree items', error as Error);
            return [];
        }
    }

    /**
     * Get root level items (categories)
     */
    private getRootItems(): MigrationTreeItem[] {
        const migrations = this.migrationService.getMigrations();
        const status = this.migrationService.getStatus();

        if (migrations.length === 0) {
            // Show message when no migrations found
            const item = new MigrationTreeItem(
                'No migrations found',
                vscode.TreeItemCollapsibleState.None,
                { type: 'root' }
            );
            item.iconPath = new vscode.ThemeIcon('info');
            return [item];
        }

        const items: MigrationTreeItem[] = [];

        // Group migrations by type
        const byType = migrations.reduce((acc, m) => {
            if (!acc[m.type]) {
                acc[m.type] = [];
            }
            acc[m.type].push(m);
            return acc;
        }, {} as Record<string, MigrationInfo[]>);

        // Create category items
        if (byType.versioned && byType.versioned.length > 0) {
            const pending = byType.versioned.filter(m => m.status === 'pending').length;
            const applied = byType.versioned.filter(m => m.status === 'applied').length;
            const label = `Versioned Migrations (${pending} pending, ${applied} applied)`;

            items.push(new MigrationTreeItem(
                label,
                vscode.TreeItemCollapsibleState.Expanded,
                { type: 'category', category: 'versioned' }
            ));
        }

        if (byType.baseline && byType.baseline.length > 0) {
            items.push(new MigrationTreeItem(
                `Baseline Migration (${byType.baseline.length})`,
                vscode.TreeItemCollapsibleState.Collapsed,
                { type: 'category', category: 'baseline' }
            ));
        }

        if (byType.repeatable && byType.repeatable.length > 0) {
            items.push(new MigrationTreeItem(
                `Repeatable Migrations (${byType.repeatable.length})`,
                vscode.TreeItemCollapsibleState.Collapsed,
                { type: 'category', category: 'repeatable' }
            ));
        }

        if (byType.codegen && byType.codegen.length > 0) {
            items.push(new MigrationTreeItem(
                `CodeGen Migrations (${byType.codegen.length})`,
                vscode.TreeItemCollapsibleState.Collapsed,
                { type: 'category', category: 'codegen' }
            ));
        }

        // Add summary item at top
        const summaryLabel = status.pending > 0
            ? `${status.pending} Pending Migrations`
            : 'All Migrations Applied';

        const summaryItem = new MigrationTreeItem(
            summaryLabel,
            vscode.TreeItemCollapsibleState.None,
            { type: 'root' }
        );
        summaryItem.iconPath = status.pending > 0
            ? new vscode.ThemeIcon('alert', new vscode.ThemeColor('statusBarItem.warningBackground'))
            : new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));

        items.unshift(summaryItem);

        return items;
    }

    /**
     * Get items for a specific category
     */
    private getCategoryItems(category: string): MigrationTreeItem[] {
        const migrations = this.migrationService.getMigrations()
            .filter(m => m.type === category);

        return migrations.map(migration => {
            const item = new MigrationTreeItem(
                migration.fileName,
                vscode.TreeItemCollapsibleState.None,
                { type: 'migration', migration },
                {
                    command: 'memberjunction.previewMigrationSQL',
                    title: 'Preview SQL',
                    arguments: [migration]
                }
            );
            return item;
        });
    }
}
