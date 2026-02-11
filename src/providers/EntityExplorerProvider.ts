import * as vscode from 'vscode';
import * as fs from 'fs';
import { EntityDiscovery } from '../services/EntityDiscovery';
import { EntityInfo, EntityFieldInfo } from '../types';

/**
 * Tree item types for the entity explorer
 */
type TreeItemType = 'category' | 'entity' | 'section' | 'field';

/**
 * Data associated with each tree item
 */
interface TreeItemData {
    type: TreeItemType;
    entity?: EntityInfo;
    field?: EntityFieldInfo;
    category?: 'core' | 'custom';
    section?: 'fields' | 'relationships';
}

/**
 * Tree item for the entity explorer
 */
export class EntityTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly data: TreeItemData
    ) {
        super(label, collapsibleState);
        this.setupTreeItem();
    }

    private setupTreeItem(): void {
        switch (this.data.type) {
            case 'category':
                this.setupCategoryItem();
                break;
            case 'entity':
                this.setupEntityItem();
                break;
            case 'section':
                this.setupSectionItem();
                break;
            case 'field':
                this.setupFieldItem();
                break;
        }
    }

    private setupCategoryItem(): void {
        const isCore = this.data.category === 'core';
        this.iconPath = new vscode.ThemeIcon(isCore ? 'library' : 'extensions');
        this.contextValue = 'category';
        this.tooltip = isCore
            ? 'Core MemberJunction entities from @memberjunction/core-entities'
            : 'Custom entities from packages/GeneratedEntities';
    }

    private setupEntityItem(): void {
        const entity = this.data.entity;
        if (!entity) {
            return;
        }

        this.iconPath = new vscode.ThemeIcon('symbol-class');
        this.contextValue = 'entity';
        this.description = `${entity.schemaName}.${entity.baseTable}`;

        // Build tooltip with entity details
        const tooltipLines = [
            `**${entity.name}**`,
            '',
            `Table: \`${entity.schemaName}.${entity.baseTable}\``,
            `View: \`${entity.baseView}\``,
            `Fields: ${entity.fields.length}`,
        ];

        if (entity.description) {
            tooltipLines.push('', entity.description);
        }

        this.tooltip = new vscode.MarkdownString(tooltipLines.join('\n'));

        // Command to show entity details or open file
        if (entity.filePath && fs.existsSync(entity.filePath)) {
            this.command = {
                command: 'memberjunction.openEntityFile',
                title: 'Open Entity File',
                arguments: [entity]
            };
        }
    }

    private setupSectionItem(): void {
        const entity = this.data.entity;
        const section = this.data.section;

        if (section === 'fields') {
            this.iconPath = new vscode.ThemeIcon('symbol-field');
            this.description = entity ? `${entity.fields.length}` : '';
            this.tooltip = 'Entity fields';
        } else if (section === 'relationships') {
            const relationships = entity?.fields.filter(f => f.relatedEntity) || [];
            this.iconPath = new vscode.ThemeIcon('references');
            this.description = `${relationships.length}`;
            this.tooltip = 'Foreign key relationships to other entities';
        }

        this.contextValue = 'section';
    }

    private setupFieldItem(): void {
        const field = this.data.field;
        if (!field) {
            return;
        }

        // Choose icon based on field type
        if (field.isPrimaryKey) {
            this.iconPath = new vscode.ThemeIcon('key');
        } else if (field.relatedEntity) {
            this.iconPath = new vscode.ThemeIcon('link');
        } else {
            this.iconPath = this.getFieldTypeIcon(field.type);
        }

        this.contextValue = 'field';

        // Description shows type and constraints
        const typeDesc = field.length ? `${field.type}(${field.length})` : field.type;
        const constraints: string[] = [];
        if (field.isPrimaryKey) {
            constraints.push('PK');
        }
        if (field.isUnique) {
            constraints.push('UQ');
        }
        if (!field.allowsNull) {
            constraints.push('NOT NULL');
        }

        this.description = constraints.length > 0
            ? `${typeDesc} [${constraints.join(', ')}]`
            : typeDesc;

        // Build tooltip
        const tooltipLines = [
            `**${field.displayName}**`,
            '',
            `Type: \`${typeDesc}\``,
            `Nullable: ${field.allowsNull ? 'Yes' : 'No'}`,
        ];

        if (field.isPrimaryKey) {
            tooltipLines.push('Primary Key: Yes');
        }
        if (field.isUnique) {
            tooltipLines.push('Unique: Yes');
        }
        if (field.relatedEntity) {
            tooltipLines.push(`Related Entity: \`${field.relatedEntity}\``);
        }
        if (field.description) {
            tooltipLines.push('', field.description);
        }

        this.tooltip = new vscode.MarkdownString(tooltipLines.join('\n'));

        // If this is a relationship field, allow clicking to navigate to the related entity
        if (field.relatedEntity) {
            this.command = {
                command: 'memberjunction.goToEntity',
                title: 'Go to Related Entity',
                arguments: [field.relatedEntity]
            };
        }
    }

    private getFieldTypeIcon(type: string): vscode.ThemeIcon {
        const lowerType = type.toLowerCase();

        if (lowerType.includes('int') || lowerType.includes('decimal') || lowerType.includes('float') || lowerType.includes('numeric')) {
            return new vscode.ThemeIcon('symbol-number');
        }
        if (lowerType.includes('char') || lowerType.includes('text') || lowerType.includes('string')) {
            return new vscode.ThemeIcon('symbol-string');
        }
        if (lowerType.includes('date') || lowerType.includes('time')) {
            return new vscode.ThemeIcon('calendar');
        }
        if (lowerType.includes('bool') || lowerType.includes('bit')) {
            return new vscode.ThemeIcon('symbol-boolean');
        }
        if (lowerType.includes('uniqueidentifier') || lowerType.includes('guid')) {
            return new vscode.ThemeIcon('symbol-key');
        }
        if (lowerType.includes('binary') || lowerType.includes('image') || lowerType.includes('varbinary')) {
            return new vscode.ThemeIcon('file-binary');
        }

        return new vscode.ThemeIcon('symbol-field');
    }
}

/**
 * Tree data provider for the entity explorer
 */
export class EntityExplorerProvider implements vscode.TreeDataProvider<EntityTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<EntityTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private entityDiscovery: EntityDiscovery;
    private filterText: string = '';
    private showCoreEntities: boolean = true;
    private showCustomEntities: boolean = true;

    constructor() {
        this.entityDiscovery = EntityDiscovery.getInstance();
    }

    /**
     * Refresh the tree view
     */
    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Set filter text for searching entities
     */
    public setFilter(text: string): void {
        this.filterText = text.toLowerCase();
        this.refresh();
    }

    /**
     * Toggle visibility of core entities
     */
    public toggleCoreEntities(): void {
        this.showCoreEntities = !this.showCoreEntities;
        this.refresh();
    }

    /**
     * Toggle visibility of custom entities
     */
    public toggleCustomEntities(): void {
        this.showCustomEntities = !this.showCustomEntities;
        this.refresh();
    }

    getTreeItem(element: EntityTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: EntityTreeItem): Promise<EntityTreeItem[]> {
        if (!this.entityDiscovery.isInitialized()) {
            return [
                new EntityTreeItem(
                    'Not connected to database',
                    vscode.TreeItemCollapsibleState.None,
                    { type: 'category' }
                )
            ];
        }

        if (!element) {
            // Root level - show categories
            return this.getRootItems();
        }

        switch (element.data.type) {
            case 'category':
                return this.getEntityItems(element.data.category!);
            case 'entity':
                return this.getEntitySections(element.data.entity!);
            case 'section':
                return this.getSectionItems(element.data.entity!, element.data.section!);
            default:
                return [];
        }
    }

    private getRootItems(): EntityTreeItem[] {
        const items: EntityTreeItem[] = [];

        if (this.showCoreEntities) {
            const coreCount = this.getFilteredEntities('core').length;
            items.push(new EntityTreeItem(
                `Core Entities (${coreCount})`,
                vscode.TreeItemCollapsibleState.Collapsed,
                { type: 'category', category: 'core' }
            ));
        }

        if (this.showCustomEntities) {
            const customCount = this.getFilteredEntities('custom').length;
            items.push(new EntityTreeItem(
                `Custom Entities (${customCount})`,
                vscode.TreeItemCollapsibleState.Collapsed,
                { type: 'category', category: 'custom' }
            ));
        }

        return items;
    }

    private getFilteredEntities(category: 'core' | 'custom'): EntityInfo[] {
        let entities = category === 'core'
            ? this.entityDiscovery.getCoreEntities()
            : this.entityDiscovery.getCustomEntities();

        // Apply filter if set
        if (this.filterText) {
            entities = entities.filter(e =>
                e.name.toLowerCase().includes(this.filterText) ||
                e.description?.toLowerCase().includes(this.filterText) ||
                e.baseTable.toLowerCase().includes(this.filterText)
            );
        }

        // Sort alphabetically
        return entities.sort((a, b) => a.name.localeCompare(b.name));
    }

    private getEntityItems(category: 'core' | 'custom'): EntityTreeItem[] {
        const entities = this.getFilteredEntities(category);

        return entities.map(entity => new EntityTreeItem(
            entity.name,
            vscode.TreeItemCollapsibleState.Collapsed,
            { type: 'entity', entity }
        ));
    }

    private getEntitySections(entity: EntityInfo): EntityTreeItem[] {
        const items: EntityTreeItem[] = [];

        // Fields section
        items.push(new EntityTreeItem(
            'Fields',
            vscode.TreeItemCollapsibleState.Collapsed,
            { type: 'section', entity, section: 'fields' }
        ));

        // Relationships section (only if entity has foreign keys)
        const relationships = entity.fields.filter(f => f.relatedEntity);
        if (relationships.length > 0) {
            items.push(new EntityTreeItem(
                'Relationships',
                vscode.TreeItemCollapsibleState.Collapsed,
                { type: 'section', entity, section: 'relationships' }
            ));
        }

        return items;
    }

    private getSectionItems(entity: EntityInfo, section: 'fields' | 'relationships'): EntityTreeItem[] {
        if (section === 'fields') {
            return entity.fields.map(field => new EntityTreeItem(
                field.name,
                vscode.TreeItemCollapsibleState.None,
                { type: 'field', entity, field }
            ));
        }

        if (section === 'relationships') {
            return entity.fields
                .filter(f => f.relatedEntity)
                .map(field => new EntityTreeItem(
                    `${field.name} -> ${field.relatedEntity}`,
                    vscode.TreeItemCollapsibleState.None,
                    { type: 'field', entity, field }
                ));
        }

        return [];
    }

    /**
     * Get parent for tree item (for reveal functionality)
     */
    getParent(_element: EntityTreeItem): vscode.ProviderResult<EntityTreeItem> {
        // Implement if we need reveal functionality
        return null;
    }
}
