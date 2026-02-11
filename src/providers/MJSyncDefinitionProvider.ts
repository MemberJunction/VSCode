import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EntityDiscovery } from '../services/EntityDiscovery';
import { MetadataRootDiscovery } from '../services/MetadataRootDiscovery';
import { OutputChannel } from '../common/OutputChannel';

/**
 * Provides Go-to-Definition support for MJ Sync files
 * - Ctrl+Click on entity names to go to entity definition
 * - Ctrl+Click on field names to go to field definition
 * - Ctrl+Click on @lookup references to go to referenced entity
 */
export class MJSyncDefinitionProvider implements vscode.DefinitionProvider {
    private entityDiscovery: EntityDiscovery;
    private rootDiscovery: MetadataRootDiscovery;

    constructor() {
        this.entityDiscovery = EntityDiscovery.getInstance();
        this.rootDiscovery = MetadataRootDiscovery.getInstance();
    }

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Definition | vscode.LocationLink[] | null> {
        const line = document.lineAt(position.line).text;

        OutputChannel.info(`[Definition] Checking line: ${line.trim()}`);
        OutputChannel.info(`[Definition] Position: line ${position.line}, char ${position.character}`);

        // Check if we're in an entity reference (e.g., "entity": "Users")
        const entityMatch = this.matchEntityReference(line, position);
        if (entityMatch) {
            OutputChannel.info(`[Definition] Found entity reference: ${entityMatch}`);
            return this.provideEntityDefinition(entityMatch);
        }

        // Check if we're in a @lookup reference
        const lookupMatch = this.matchLookupReference(line, position);
        if (lookupMatch) {
            OutputChannel.info(`[Definition] Found lookup reference: ${lookupMatch.entityName}`);
            return this.provideEntityDefinition(lookupMatch.entityName);
        }

        // Check if we're in a field name
        const fieldMatch = await this.matchFieldReference(document, line, position);
        if (fieldMatch) {
            OutputChannel.info(`[Definition] Found field reference: ${fieldMatch.fieldName} in ${fieldMatch.entityName}`);
            return this.provideFieldDefinition(fieldMatch.entityName, fieldMatch.fieldName);
        }

        OutputChannel.info(`[Definition] No match found`);
        return null;
    }

    /**
     * Match an entity reference like "entity": "Users" or "relatedEntity": "..."
     */
    private matchEntityReference(line: string, position: vscode.Position): string | null {
        // Match patterns like "entity": "EntityName" or "relatedEntity": "EntityName"
        const patterns = [
            /"entity"\s*:\s*"([^"]+)"/,
            /"relatedEntity"\s*:\s*"([^"]+)"/,
            /"lookupEntity"\s*:\s*"([^"]+)"/
        ];

        for (const pattern of patterns) {
            const match = line.match(pattern);
            if (match && match.index !== undefined) {
                // Check if cursor is within the entity name
                const valueStart = line.indexOf(match[1], match.index);
                const valueEnd = valueStart + match[1].length;

                if (position.character >= valueStart && position.character <= valueEnd) {
                    return match[1];
                }
            }
        }

        return null;
    }

    /**
     * Match a @lookup reference like "@lookup(EntityName, FieldName)"
     */
    private matchLookupReference(line: string, position: vscode.Position): { entityName: string; fieldName?: string } | null {
        const pattern = /@lookup\s*\(\s*([^,)]+)(?:\s*,\s*([^)]+))?\s*\)/g;
        let match;

        while ((match = pattern.exec(line)) !== null) {
            const fullMatchStart = match.index;
            const fullMatchEnd = fullMatchStart + match[0].length;

            if (position.character >= fullMatchStart && position.character <= fullMatchEnd) {
                const entityName = match[1].trim();
                const fieldName = match[2]?.trim();

                // Determine if cursor is on entity name or field name
                const entityStart = line.indexOf(match[1], fullMatchStart);
                const entityEnd = entityStart + match[1].length;

                if (position.character >= entityStart && position.character <= entityEnd) {
                    return { entityName };
                }

                if (fieldName && match[2]) {
                    const fieldStart = line.indexOf(match[2], entityEnd);
                    const fieldEnd = fieldStart + match[2].length;

                    if (position.character >= fieldStart && position.character <= fieldEnd) {
                        return { entityName, fieldName };
                    }
                }

                return { entityName };
            }
        }

        return null;
    }

    /**
     * Match a field reference within the fields object
     */
    private async matchFieldReference(
        document: vscode.TextDocument,
        line: string,
        position: vscode.Position
    ): Promise<{ entityName: string; fieldName: string } | null> {
        // Check if this looks like a field definition: "FieldName": value
        const fieldPattern = /^\s*"([^"]+)"\s*:/;
        const match = line.match(fieldPattern);

        if (!match) {
            return null;
        }

        const fieldName = match[1];
        const fieldNameStart = line.indexOf(`"${fieldName}"`);
        const fieldNameEnd = fieldNameStart + fieldName.length + 2; // Include quotes

        // Check if cursor is on the field name
        if (position.character < fieldNameStart || position.character > fieldNameEnd) {
            return null;
        }

        // Get the entity name for this file
        const entityName = await this.rootDiscovery.getEntityNameForFile(document.fileName);
        if (!entityName) {
            return null;
        }

        // Verify this field exists in the entity
        const entity = this.entityDiscovery.getEntity(entityName);
        if (!entity) {
            return null;
        }

        const field = entity.fields.find(f => f.name === fieldName);
        if (!field) {
            return null;
        }

        return { entityName, fieldName };
    }

    /**
     * Provide definition location for an entity
     */
    private async provideEntityDefinition(entityName: string): Promise<vscode.Location | null> {
        OutputChannel.info(`[Definition] Looking up entity: ${entityName}`);

        const entity = this.entityDiscovery.getEntity(entityName);
        if (!entity) {
            OutputChannel.info(`[Definition] Entity not found in discovery`);
            // Show a message if entity not found
            vscode.window.showInformationMessage(`Entity "${entityName}" not found in metadata. Make sure the database is connected.`);
            return null;
        }

        OutputChannel.info(`[Definition] Found entity: ${entity.name}, filePath: ${entity.filePath || 'none'}`);

        // Try to find the entity file
        if (entity.filePath && fs.existsSync(entity.filePath)) {
            OutputChannel.info(`[Definition] Entity file exists, opening...`);
            const uri = vscode.Uri.file(entity.filePath);
            const position = await this.findEntityClassPosition(entity.filePath, entityName);
            return new vscode.Location(uri, position);
        }

        // Try to find in core-entities package
        OutputChannel.info(`[Definition] Trying to find in core-entities...`);
        const coreEntityLocation = await this.findCoreEntityLocation(entityName);
        if (coreEntityLocation) {
            OutputChannel.info(`[Definition] Found in core-entities`);
            return coreEntityLocation;
        }

        OutputChannel.info(`[Definition] No source file found, showing entity info`);
        // If no source file found, show entity details in a message
        const fieldCount = entity.fields.length;
        const pkFields = entity.fields.filter(f => f.isPrimaryKey).map(f => f.name).join(', ') || 'none';
        vscode.window.showInformationMessage(
            `Entity: ${entity.name}\nTable: ${entity.schemaName}.${entity.baseTable}\nFields: ${fieldCount}\nPrimary Key: ${pkFields}`,
            'Show in Explorer'
        ).then(selection => {
            if (selection === 'Show in Explorer') {
                vscode.commands.executeCommand('memberjunction.goToEntity', entityName);
            }
        });

        return null;
    }

    /**
     * Provide definition location for a field
     */
    private async provideFieldDefinition(
        entityName: string,
        fieldName: string
    ): Promise<vscode.Location | null> {
        const entity = this.entityDiscovery.getEntity(entityName);
        if (!entity) {
            return null;
        }

        // Try to find the entity file
        if (entity.filePath && fs.existsSync(entity.filePath)) {
            const uri = vscode.Uri.file(entity.filePath);
            const position = await this.findFieldPosition(entity.filePath, fieldName);
            return new vscode.Location(uri, position);
        }

        // Try to find in core-entities package
        const coreEntityLocation = await this.findCoreEntityFieldLocation(entityName, fieldName);
        if (coreEntityLocation) {
            return coreEntityLocation;
        }

        return null;
    }

    /**
     * Find the position of an entity class in a TypeScript file
     */
    private async findEntityClassPosition(filePath: string, entityName: string): Promise<vscode.Position> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const lines = content.split('\n');

            // Convert entity name to class name (e.g., "Users" -> "UsersEntity" or "UserEntity")
            const classPatterns = [
                new RegExp(`class\\s+${this.entityNameToClassName(entityName)}\\s+extends`),
                new RegExp(`class\\s+${entityName.replace(/\s+/g, '')}Entity\\s+extends`),
                new RegExp(`class\\s+${entityName}\\s+extends`)
            ];

            for (let i = 0; i < lines.length; i++) {
                for (const pattern of classPatterns) {
                    if (pattern.test(lines[i])) {
                        return new vscode.Position(i, 0);
                    }
                }
            }
        } catch {
            // File read error, return start of file
        }

        return new vscode.Position(0, 0);
    }

    /**
     * Find the position of a field getter/property in a TypeScript file
     */
    private async findFieldPosition(filePath: string, fieldName: string): Promise<vscode.Position> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const lines = content.split('\n');

            // Look for getter pattern: get FieldName()
            const getterPattern = new RegExp(`get\\s+${fieldName}\\s*\\(`);

            for (let i = 0; i < lines.length; i++) {
                if (getterPattern.test(lines[i])) {
                    return new vscode.Position(i, 0);
                }
            }

            // Fall back to any mention of the field name
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(fieldName)) {
                    return new vscode.Position(i, 0);
                }
            }
        } catch {
            // File read error
        }

        return new vscode.Position(0, 0);
    }

    /**
     * Find a core entity in the MJCoreEntities package
     */
    private async findCoreEntityLocation(entityName: string): Promise<vscode.Location | null> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return null;
        }

        const possiblePaths = [
            // Check in node_modules
            path.join(workspaceFolders[0].uri.fsPath, 'node_modules', '@memberjunction', 'core-entities', 'src', 'generated', 'entity_subclasses.ts'),
            // Check in local packages (monorepo)
            path.join(workspaceFolders[0].uri.fsPath, 'packages', 'MJCoreEntities', 'src', 'generated', 'entity_subclasses.ts'),
        ];

        for (const filePath of possiblePaths) {
            if (fs.existsSync(filePath)) {
                const position = await this.findEntityClassPosition(filePath, entityName);
                if (position.line > 0) {
                    return new vscode.Location(vscode.Uri.file(filePath), position);
                }
            }
        }

        return null;
    }

    /**
     * Find a field in a core entity
     */
    private async findCoreEntityFieldLocation(
        entityName: string,
        fieldName: string
    ): Promise<vscode.Location | null> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return null;
        }

        const possiblePaths = [
            path.join(workspaceFolders[0].uri.fsPath, 'node_modules', '@memberjunction', 'core-entities', 'src', 'generated', 'entity_subclasses.ts'),
            path.join(workspaceFolders[0].uri.fsPath, 'packages', 'MJCoreEntities', 'src', 'generated', 'entity_subclasses.ts'),
        ];

        for (const filePath of possiblePaths) {
            if (fs.existsSync(filePath)) {
                // First find the entity class, then find the field within it
                const content = await fs.promises.readFile(filePath, 'utf-8');
                const lines = content.split('\n');

                const className = this.entityNameToClassName(entityName);
                let inTargetClass = false;
                let braceCount = 0;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    // Check if we're entering the target class
                    if (line.includes(`class ${className}`) && line.includes('extends')) {
                        inTargetClass = true;
                        braceCount = 0;
                    }

                    if (inTargetClass) {
                        braceCount += (line.match(/\{/g) || []).length;
                        braceCount -= (line.match(/\}/g) || []).length;

                        // Look for the field getter
                        const getterPattern = new RegExp(`get\\s+${fieldName}\\s*\\(`);
                        if (getterPattern.test(line)) {
                            return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(i, 0));
                        }

                        // Exit class when brace count goes to 0
                        if (braceCount <= 0 && i > 0) {
                            inTargetClass = false;
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Convert entity name to TypeScript class name
     */
    private entityNameToClassName(entityName: string): string {
        return entityName
            .split(/[\s_-]+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('') + 'Entity';
    }
}
