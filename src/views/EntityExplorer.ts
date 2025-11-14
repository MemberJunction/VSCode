import * as vscode from 'vscode';
import { EntityDiscovery } from '../services/EntityDiscovery';
import { EntityInfo } from '../types';
import { OutputChannel } from '../common/OutputChannel';

/**
 * Tree item for entity explorer
 */
export class EntityTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly entity?: EntityInfo,
        public readonly isCategory: boolean = false
    ) {
        super(label, collapsibleState);

        if (entity) {
            this.tooltip = this.createTooltip(entity);
            this.description = entity.baseTable;
            this.contextValue = 'entity';

            // Set icon based on whether it's a core or custom entity
            this.iconPath = new vscode.ThemeIcon(
                entity.isCore ? 'symbol-class' : 'symbol-interface'
            );

            // Make it clickable to open entity definition
            if (entity.filePath) {
                this.command = {
                    command: 'memberjunction.openEntity',
                    title: 'Open Entity',
                    arguments: [entity]
                };
            }
        } else if (isCategory) {
            this.contextValue = 'category';
            this.iconPath = new vscode.ThemeIcon('folder');
        }
    }

    private createTooltip(entity: EntityInfo): string {
        const lines: string[] = [
            `**${entity.name}**`,
            '',
            `Table: ${entity.schemaName}.${entity.baseTable}`,
            `View: ${entity.baseView}`,
            `Fields: ${entity.fields.length}`,
            `Type: ${entity.isCore ? 'Core' : 'Custom'}`
        ];

        if (entity.description) {
            lines.push('', entity.description);
        }

        return lines.join('\n');
    }
}

/**
 * Tree data provider for entity explorer
 */
export class EntityExplorerProvider implements vscode.TreeDataProvider<EntityTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<EntityTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private entityDiscovery: EntityDiscovery;

    constructor() {
        this.entityDiscovery = EntityDiscovery.getInstance();
    }

    refresh(): void {
        OutputChannel.info('Refreshing entity explorer...');
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: EntityTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: EntityTreeItem): Promise<EntityTreeItem[]> {
        if (!this.entityDiscovery.isInitialized()) {
            try {
                await this.entityDiscovery.initialize();
            } catch (error) {
                OutputChannel.error('Failed to initialize entity discovery', error as Error);
                return [];
            }
        }

        if (!element) {
            // Root level - show categories
            return [
                new EntityTreeItem(
                    'Core Entities',
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    true
                ),
                new EntityTreeItem(
                    'Custom Entities',
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    true
                )
            ];
        }

        if (element.isCategory) {
            // Get entities for this category
            const entities = element.label === 'Core Entities'
                ? this.entityDiscovery.getCoreEntities()
                : this.entityDiscovery.getCustomEntities();

            // Sort entities by name
            entities.sort((a, b) => a.name.localeCompare(b.name));

            return entities.map(entity =>
                new EntityTreeItem(
                    entity.name,
                    vscode.TreeItemCollapsibleState.None,
                    entity
                )
            );
        }

        return [];
    }
}

/**
 * Manages the entity explorer view
 */
export class EntityExplorer {
    private treeDataProvider: EntityExplorerProvider;
    private treeView: vscode.TreeView<EntityTreeItem>;

    constructor(context: vscode.ExtensionContext) {
        this.treeDataProvider = new EntityExplorerProvider();

        this.treeView = vscode.window.createTreeView('memberjunctionEntityExplorer', {
            treeDataProvider: this.treeDataProvider,
            showCollapseAll: true
        });

        // Register commands
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.refreshEntityExplorer', () => {
                this.refresh();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.openEntity', (entity: EntityInfo) => {
                this.openEntity(entity);
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.showEntityInfo', (entity: EntityInfo) => {
                this.showEntityInfo(entity);
            })
        );

        context.subscriptions.push(this.treeView);

        OutputChannel.info('Entity explorer initialized');
    }

    refresh(): void {
        this.treeDataProvider.refresh();
    }

    private async openEntity(entity: EntityInfo): Promise<void> {
        if (!entity.filePath) {
            vscode.window.showInformationMessage(
                `${entity.name} is a core entity. Source is in @memberjunction/core-entities package.`
            );
            return;
        }

        try {
            const doc = await vscode.workspace.openTextDocument(entity.filePath);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(
                `Could not open entity file: ${entity.filePath}`
            );
            OutputChannel.error('Failed to open entity file', error as Error);
        }
    }

    private showEntityInfo(entity: EntityInfo): void {
        const panel = vscode.window.createWebviewPanel(
            'entityInfo',
            `Entity: ${entity.name}`,
            vscode.ViewColumn.Two,
            {}
        );

        panel.webview.html = this.getEntityInfoHtml(entity);
    }

    private getEntityInfoHtml(entity: EntityInfo): string {
        const fieldsTable = entity.fields.map(field => `
            <tr>
                <td>${field.name}</td>
                <td>${field.displayName}</td>
                <td>${field.type}${field.length ? `(${field.length})` : ''}</td>
                <td>${field.allowsNull ? 'Yes' : 'No'}</td>
                <td>${field.isPrimaryKey ? '🔑' : ''}${field.isUnique ? '⭐' : ''}</td>
                <td>${field.relatedEntity || ''}</td>
            </tr>
        `).join('');

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        padding: 20px;
                    }
                    h1 {
                        color: var(--vscode-textLink-foreground);
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 20px;
                    }
                    th, td {
                        text-align: left;
                        padding: 8px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    th {
                        background-color: var(--vscode-editor-background);
                        font-weight: bold;
                    }
                    .info-section {
                        margin: 20px 0;
                    }
                    .info-label {
                        font-weight: bold;
                        display: inline-block;
                        width: 150px;
                    }
                    .badge {
                        display: inline-block;
                        padding: 2px 8px;
                        border-radius: 3px;
                        background-color: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        font-size: 12px;
                    }
                </style>
            </head>
            <body>
                <h1>${entity.name}</h1>

                <div class="info-section">
                    <div><span class="info-label">Type:</span> <span class="badge">${entity.isCore ? 'Core Entity' : 'Custom Entity'}</span></div>
                    <div><span class="info-label">Base Table:</span> ${entity.schemaName}.${entity.baseTable}</div>
                    <div><span class="info-label">Base View:</span> ${entity.baseView}</div>
                    ${entity.description ? `<div><span class="info-label">Description:</span> ${entity.description}</div>` : ''}
                </div>

                <h2>Fields (${entity.fields.length})</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Display Name</th>
                            <th>Type</th>
                            <th>Nullable</th>
                            <th>Constraints</th>
                            <th>Related Entity</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${fieldsTable}
                    </tbody>
                </table>
            </body>
            </html>
        `;
    }

    dispose(): void {
        this.treeView.dispose();
    }
}
