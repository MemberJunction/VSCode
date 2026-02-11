import * as vscode from 'vscode';
import * as fs from 'fs';
import { Feature } from '../../types';
import { EntityDiscovery } from '../../services/EntityDiscovery';
import { EntityExplorerProvider, EntityTreeItem } from '../../providers/EntityExplorerProvider';
import { ConnectionService } from '../../services/ConnectionService';
import { OutputChannel } from '../../common/OutputChannel';

/**
 * Entity Explorer feature - provides a tree view to browse all MemberJunction entities
 */
export class EntityExplorerFeature implements Feature {
    name = 'Entity Explorer';
    private treeDataProvider: EntityExplorerProvider | undefined;
    private treeView: vscode.TreeView<EntityTreeItem> | undefined;
    private entityDiscovery: EntityDiscovery;
    private connectionService: ConnectionService;
    private statusChangeDisposable: vscode.Disposable | undefined;

    constructor() {
        this.entityDiscovery = EntityDiscovery.getInstance();
        this.connectionService = ConnectionService.getInstance();
    }

    enabled(): boolean {
        const config = vscode.workspace.getConfiguration('memberjunction');
        return config.get('features.entityExplorer.enabled', true);
    }

    async activate(context: vscode.ExtensionContext): Promise<void> {
        OutputChannel.info('Activating Entity Explorer feature...');

        try {
            // Create the tree data provider
            this.treeDataProvider = new EntityExplorerProvider();

            // Create the tree view
            this.treeView = vscode.window.createTreeView('memberjunction.entityExplorer', {
                treeDataProvider: this.treeDataProvider,
                showCollapseAll: true
            });
            context.subscriptions.push(this.treeView);

            // Register commands
            this.registerCommands(context);

            // Listen for connection status changes to refresh the tree
            this.statusChangeDisposable = this.connectionService.onStatusChange((status) => {
                if (status === 'connected') {
                    OutputChannel.info('Connection established, refreshing entity explorer...');
                    this.treeDataProvider?.refresh();
                }
            });
            context.subscriptions.push(this.statusChangeDisposable);

            OutputChannel.info('Entity Explorer feature activated successfully');
        } catch (error) {
            OutputChannel.error('Failed to activate Entity Explorer feature', error as Error);
            throw error;
        }
    }

    async deactivate(): Promise<void> {
        if (this.statusChangeDisposable) {
            this.statusChangeDisposable.dispose();
        }
        OutputChannel.info('Entity Explorer feature deactivated');
    }

    private registerCommands(context: vscode.ExtensionContext): void {
        // Refresh entity explorer
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.refreshEntityExplorer', () => {
                this.refreshEntityExplorer();
            })
        );

        // Search entities
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.searchEntities', async () => {
                await this.searchEntities();
            })
        );

        // Clear search filter
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.clearEntityFilter', () => {
                this.treeDataProvider?.setFilter('');
                vscode.window.showInformationMessage('Entity filter cleared');
            })
        );

        // Open entity file
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.openEntityFile', async (arg: EntityTreeItem | { name: string; filePath?: string }) => {
                // Handle both tree item (from context menu) and entity object (from tree item click)
                const entity = (arg as EntityTreeItem).data?.entity ?? arg;
                await this.openEntityFile(entity as { name: string; filePath?: string });
            })
        );

        // Go to entity (navigate to entity in tree)
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.goToEntity', async (arg: string | EntityTreeItem) => {
                // Handle both string (from tree item click) and tree item (from context menu)
                let entityName: string;
                if (typeof arg === 'string') {
                    entityName = arg;
                } else if ((arg as EntityTreeItem).data?.field?.relatedEntity) {
                    entityName = (arg as EntityTreeItem).data.field!.relatedEntity!;
                } else if ((arg as EntityTreeItem).data?.entity?.name) {
                    entityName = (arg as EntityTreeItem).data.entity!.name;
                } else {
                    vscode.window.showWarningMessage('No entity to navigate to');
                    return;
                }
                await this.goToEntity(entityName);
            })
        );

        // Show entity details
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.showEntityDetails', async (item: EntityTreeItem) => {
                if (item.data.entity) {
                    await this.showEntityDetails(item.data.entity);
                }
            })
        );

        // Copy entity name
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.copyEntityName', (item: EntityTreeItem) => {
                if (item.data.entity) {
                    vscode.env.clipboard.writeText(item.data.entity.name);
                    vscode.window.showInformationMessage(`Copied: ${item.data.entity.name}`);
                }
            })
        );

        // Copy field name
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.copyFieldName', (item: EntityTreeItem) => {
                if (item.data.field) {
                    vscode.env.clipboard.writeText(item.data.field.name);
                    vscode.window.showInformationMessage(`Copied: ${item.data.field.name}`);
                }
            })
        );

        // Toggle core entities visibility
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.toggleCoreEntities', () => {
                this.treeDataProvider?.toggleCoreEntities();
            })
        );

        // Toggle custom entities visibility
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.toggleCustomEntities', () => {
                this.treeDataProvider?.toggleCustomEntities();
            })
        );
    }

    private async refreshEntityExplorer(): Promise<void> {
        OutputChannel.info('Refreshing entity explorer...');

        try {
            // Refresh entity discovery from database
            await this.entityDiscovery.refresh();

            // Refresh the tree view
            this.treeDataProvider?.refresh();

            const entityCount = this.entityDiscovery.getAllEntities().length;
            vscode.window.showInformationMessage(`Entity Explorer refreshed: ${entityCount} entities loaded`);
        } catch (error) {
            OutputChannel.error('Failed to refresh entity explorer', error as Error);
            vscode.window.showErrorMessage(`Failed to refresh: ${(error as Error).message}`);
        }
    }

    private async searchEntities(): Promise<void> {
        const query = await vscode.window.showInputBox({
            prompt: 'Search entities by name, table, or description',
            placeHolder: 'Enter search term...',
            value: ''
        });

        if (query !== undefined) {
            this.treeDataProvider?.setFilter(query);
            if (query) {
                vscode.window.showInformationMessage(`Filtering entities by: "${query}"`);
            }
        }
    }

    private async openEntityFile(entity: { name: string; filePath?: string }): Promise<void> {
        if (!entity.filePath) {
            vscode.window.showWarningMessage(
                `No local file found for entity "${entity.name}". ` +
                'Core entities are in node_modules/@memberjunction/core-entities'
            );
            return;
        }

        if (!fs.existsSync(entity.filePath)) {
            vscode.window.showWarningMessage(
                `Entity file not found: ${entity.filePath}`
            );
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(entity.filePath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            OutputChannel.error('Failed to open entity file', error as Error);
            vscode.window.showErrorMessage(`Failed to open file: ${(error as Error).message}`);
        }
    }

    private async goToEntity(entityName: string): Promise<void> {
        const entity = this.entityDiscovery.getEntity(entityName);

        if (!entity) {
            vscode.window.showWarningMessage(`Entity "${entityName}" not found`);
            return;
        }

        // Show information about the entity
        const action = await vscode.window.showInformationMessage(
            `Entity: ${entity.name}\nTable: ${entity.schemaName}.${entity.baseTable}\nFields: ${entity.fields.length}`,
            'Show Details',
            'Copy Name'
        );

        if (action === 'Show Details') {
            await this.showEntityDetails(entity);
        } else if (action === 'Copy Name') {
            vscode.env.clipboard.writeText(entity.name);
        }
    }

    private async showEntityDetails(entity: {
        name: string;
        schemaName: string;
        baseTable: string;
        baseView: string;
        description?: string;
        fields: Array<{
            name: string;
            displayName: string;
            type: string;
            length?: number;
            allowsNull: boolean;
            isPrimaryKey: boolean;
            relatedEntity?: string;
            description?: string;
        }>;
        isCore: boolean;
    }): Promise<void> {
        // Create a markdown document with entity details
        const content = this.buildEntityDetailsMarkdown(entity);

        // Create a virtual document
        const uri = vscode.Uri.parse(`memberjunction-entity:${entity.name}.md`);

        // Register a text document content provider for our scheme
        const provider = new (class implements vscode.TextDocumentContentProvider {
            provideTextDocumentContent(): string {
                return content;
            }
        })();

        const disposable = vscode.workspace.registerTextDocumentContentProvider('memberjunction-entity', provider);

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document, { preview: true });
        } finally {
            // Clean up after a delay to allow the document to be displayed
            setTimeout(() => disposable.dispose(), 1000);
        }
    }

    private buildEntityDetailsMarkdown(entity: {
        name: string;
        schemaName: string;
        baseTable: string;
        baseView: string;
        description?: string;
        fields: Array<{
            name: string;
            displayName: string;
            type: string;
            length?: number;
            allowsNull: boolean;
            isPrimaryKey: boolean;
            relatedEntity?: string;
            description?: string;
        }>;
        isCore: boolean;
    }): string {
        const lines: string[] = [
            `# ${entity.name}`,
            '',
            `**Type:** ${entity.isCore ? 'Core Entity' : 'Custom Entity'}`,
            `**Schema:** ${entity.schemaName}`,
            `**Table:** ${entity.baseTable}`,
            `**View:** ${entity.baseView}`,
            ''
        ];

        if (entity.description) {
            lines.push(`## Description`, '', entity.description, '');
        }

        lines.push(`## Fields (${entity.fields.length})`, '');
        lines.push('| Name | Display Name | Type | Nullable | PK | Related Entity |');
        lines.push('|------|--------------|------|----------|----|----|');

        for (const field of entity.fields) {
            const typeStr = field.length ? `${field.type}(${field.length})` : field.type;
            lines.push(
                `| ${field.name} | ${field.displayName} | ${typeStr} | ` +
                `${field.allowsNull ? 'Yes' : 'No'} | ${field.isPrimaryKey ? 'Yes' : ''} | ` +
                `${field.relatedEntity || ''} |`
            );
        }

        // Add relationships section
        const relationships = entity.fields.filter(f => f.relatedEntity);
        if (relationships.length > 0) {
            lines.push('', `## Relationships (${relationships.length})`, '');
            for (const rel of relationships) {
                lines.push(`- **${rel.name}** -> ${rel.relatedEntity}`);
            }
        }

        return lines.join('\n');
    }

    onConfigChange(): void {
        // Handle configuration changes if needed
    }
}
