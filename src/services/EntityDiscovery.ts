import * as vscode from 'vscode';
import * as path from 'path';
import { Metadata, EntityInfo as MJEntityInfo, EntityFieldInfo as MJEntityFieldInfo } from '@memberjunction/core';
import { EntityInfo, EntityFieldInfo } from '../types';
import { OutputChannel } from '../common/OutputChannel';

/**
 * Service for discovering and managing entity information
 * from @memberjunction/core-entities and user's GeneratedEntities
 */
export class EntityDiscovery {
    private static instance: EntityDiscovery;
    private entities: Map<string, EntityInfo> = new Map();
    private initialized: boolean = false;

    private constructor() {}

    public static getInstance(): EntityDiscovery {
        if (!this.instance) {
            this.instance = new EntityDiscovery();
        }
        return this.instance;
    }

    /**
     * Initialize and load all entities
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            OutputChannel.info('Initializing entity discovery...');

            // Initialize MemberJunction metadata
            const md = new Metadata();

            // Load all entities from metadata
            const mjEntities = md.Entities;

            OutputChannel.info(`Found ${mjEntities.length} entities in metadata`);

            // Convert MJ entities to our format
            for (const mjEntity of mjEntities) {
                const entityInfo = this.convertMJEntityToEntityInfo(mjEntity);
                this.entities.set(entityInfo.name, entityInfo);
            }

            this.initialized = true;
            OutputChannel.info('Entity discovery initialized successfully');
        } catch (error) {
            OutputChannel.error('Failed to initialize entity discovery', error as Error);
            throw error;
        }
    }

    /**
     * Convert MJ EntityInfo to our EntityInfo format
     */
    private convertMJEntityToEntityInfo(mjEntity: MJEntityInfo): EntityInfo {
        const fields: EntityFieldInfo[] = mjEntity.Fields.map((mjField: MJEntityFieldInfo) => ({
            id: mjField.ID?.toString() || '',
            name: mjField.Name,
            displayName: mjField.DisplayName || mjField.Name,
            type: mjField.Type,
            length: mjField.Length,
            allowsNull: mjField.AllowsNull,
            isPrimaryKey: mjField.IsPrimaryKey,
            isUnique: mjField.IsUnique,
            relatedEntity: mjField.RelatedEntity || undefined,
            description: mjField.Description || undefined
        }));

        return {
            id: mjEntity.ID?.toString() || '',
            name: mjEntity.Name,
            baseTable: mjEntity.BaseTable,
            baseView: mjEntity.BaseView,
            schemaName: mjEntity.SchemaName,
            description: mjEntity.Description || undefined,
            fields,
            isCore: this.isCoreEntity(mjEntity.Name),
            filePath: this.findEntityFilePath(mjEntity.Name)
        };
    }

    /**
     * Check if an entity is a core entity
     */
    private isCoreEntity(entityName: string): boolean {
        // Core entities are those that come with @memberjunction/core-entities
        // We can check this by looking at common core entity names
        const coreEntities = [
            'Applications',
            'Entities',
            'Entity Fields',
            'User Views',
            'User',
            'Company',
            'Employee',
            'User Roles',
            'Roles',
            'Row Level Security Filters',
            'Audit Log',
            'Authorization',
            'Conversation',
            'Conversation Detail',
            'User Application Entities',
            'Application Entities',
            'Entity Permissions',
            'User View Runs',
            'User View Run Details'
        ];

        return coreEntities.includes(entityName);
    }

    /**
     * Find the file path for an entity's TypeScript class
     */
    private findEntityFilePath(entityName: string): string | undefined {
        // Try to find the entity file in the workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        // Convert entity name to class name (e.g., "Entity Fields" -> "EntityFieldEntity")
        const className = this.entityNameToClassName(entityName);

        // Check in GeneratedEntities (custom entities)
        const customPath = path.join(workspaceRoot, 'packages', 'GeneratedEntities', 'src', `${className}.ts`);

        // For core entities, they would be in @memberjunction/core-entities
        // But we don't need to provide a path for those since they're in node_modules

        return customPath;
    }

    /**
     * Convert entity name to TypeScript class name
     */
    private entityNameToClassName(entityName: string): string {
        // Remove spaces and special characters, capitalize each word
        return entityName
            .split(/[\s_-]+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('') + 'Entity';
    }

    /**
     * Get all entities
     */
    public getAllEntities(): EntityInfo[] {
        return Array.from(this.entities.values());
    }

    /**
     * Get entity by name
     */
    public getEntity(name: string): EntityInfo | undefined {
        return this.entities.get(name);
    }

    /**
     * Get core entities only
     */
    public getCoreEntities(): EntityInfo[] {
        return this.getAllEntities().filter(e => e.isCore);
    }

    /**
     * Get custom entities only
     */
    public getCustomEntities(): EntityInfo[] {
        return this.getAllEntities().filter(e => !e.isCore);
    }

    /**
     * Search entities by name
     */
    public searchEntities(query: string): EntityInfo[] {
        const lowerQuery = query.toLowerCase();
        return this.getAllEntities().filter(e =>
            e.name.toLowerCase().includes(lowerQuery) ||
            e.description?.toLowerCase().includes(lowerQuery)
        );
    }

    /**
     * Refresh entities (reload from metadata)
     */
    public async refresh(): Promise<void> {
        this.entities.clear();
        this.initialized = false;
        await this.initialize();
    }

    /**
     * Check if initialized
     */
    public isInitialized(): boolean {
        return this.initialized;
    }
}
