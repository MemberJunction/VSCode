import * as vscode from 'vscode';
import { EntityDiscovery } from '../services/EntityDiscovery';
import { MetadataRootDiscovery } from '../services/MetadataRootDiscovery';
import { OutputChannel } from '../common/OutputChannel';

/**
 * Context information about where the cursor is in the JSON structure
 */
interface CursorContext {
    inFields: boolean;
    inRelatedEntities: boolean;
    relatedEntityName?: string;
}

/**
 * Provides IntelliSense completions for .mj-sync.json and entity record files
 */
export class MJSyncCompletionProvider implements vscode.CompletionItemProvider {
    private entityDiscovery: EntityDiscovery;
    private rootDiscovery: MetadataRootDiscovery;

    constructor() {
        this.entityDiscovery = EntityDiscovery.getInstance();
        this.rootDiscovery = MetadataRootDiscovery.getInstance();
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.CompletionItem[]> {
        const fileName = document.fileName;
        const lineText = document.lineAt(position.line).text;
        const beforeCursor = lineText.substring(0, position.character);

        try {
            // Check if this is a .mj-sync.json file
            if (fileName.endsWith('.mj-sync.json')) {
                return await this.provideSyncConfigCompletions(document, position, beforeCursor);
            }

            // Otherwise, it's an entity record file
            return await this.provideEntityRecordCompletions(document, position, beforeCursor);
        } catch (error) {
            OutputChannel.error('Error providing completions', error as Error);
            return [];
        }
    }

    /**
     * Provide completions for .mj-sync.json files
     */
    private async provideSyncConfigCompletions(
        _document: vscode.TextDocument,
        _position: vscode.Position,
        beforeCursor: string
    ): Promise<vscode.CompletionItem[]> {
        const completions: vscode.CompletionItem[] = [];

        // Check if completing entity name
        if (beforeCursor.includes('"entity"') || beforeCursor.includes('entity')) {
            const entities = this.entityDiscovery.getAllEntities();
            return entities.map(entity => {
                const item = new vscode.CompletionItem(entity.name, vscode.CompletionItemKind.Class);
                item.detail = `${entity.isCore ? 'Core' : 'Custom'} Entity`;
                item.documentation = new vscode.MarkdownString(
                    `**${entity.name}**\n\n` +
                    `Table: \`${entity.schemaName}.${entity.baseTable}\`\n\n` +
                    `Fields: ${entity.fields.length}\n\n` +
                    `${entity.description || ''}`
                );
                item.insertText = `"${entity.name}"`;
                return item;
            });
        }

        // Check if completing in lookupFields entity reference
        if (beforeCursor.includes('lookupFields') && (beforeCursor.includes('"entity"') || beforeCursor.match(/"entity"\s*:\s*$/))) {
            const entities = this.entityDiscovery.getAllEntities();
            return entities.map(entity => {
                const item = new vscode.CompletionItem(entity.name, vscode.CompletionItemKind.Reference);
                item.detail = 'Lookup Entity';
                item.insertText = `"${entity.name}"`;
                return item;
            });
        }

        return completions;
    }

    /**
     * Provide completions for entity record files
     */
    private async provideEntityRecordCompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
        beforeCursor: string
    ): Promise<vscode.CompletionItem[]> {
        // Get entity name for this file
        const entityName = await this.rootDiscovery.getEntityNameForFile(document.fileName);

        if (!entityName) {
            return [];
        }

        const entity = this.entityDiscovery.getEntity(entityName);
        if (!entity) {
            return [];
        }

        // Get cursor context to determine which entity's fields we should suggest
        const context = this.getCursorContext(document, position);

        // Check if we're in a "fields" object
        if (context.inFields) {
            let targetEntity = entity;

            // If we're in relatedEntities, find the related entity
            if (context.inRelatedEntities && context.relatedEntityName) {
                const relatedEntity = this.entityDiscovery.getEntity(context.relatedEntityName);
                if (relatedEntity) {
                    targetEntity = relatedEntity;
                }
            }

            return targetEntity.fields.map(field => {
                const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);
                item.detail = field.type + (field.length ? `(${field.length})` : '');
                item.documentation = new vscode.MarkdownString(
                    `**${field.displayName}**\n\n` +
                    `Entity: \`${targetEntity.name}\`\n\n` +
                    `Type: \`${field.type}\`\n\n` +
                    `Nullable: ${field.allowsNull ? 'Yes' : 'No'}\n\n` +
                    `${field.isPrimaryKey ? '🔑 Primary Key\n\n' : ''}` +
                    `${field.relatedEntity ? `Related Entity: \`${field.relatedEntity}\`\n\n` : ''}` +
                    `${field.description || ''}`
                );

                // Add snippet for metadata keyword option
                item.insertText = new vscode.SnippetString(`"${field.name}": "\${1:value}"`);

                return item;
            });
        }

        // Check if completing a @lookup: keyword
        if (beforeCursor.match(/@lookup:\s*$/)) {
            // Suggest entity names for @lookup:
            const entities = this.entityDiscovery.getAllEntities();
            return entities.map(entity => {
                const item = new vscode.CompletionItem(entity.name, vscode.CompletionItemKind.Reference);
                item.detail = 'Lookup Entity';
                item.insertText = `${entity.name}.`;
                item.command = {
                    command: 'editor.action.triggerSuggest',
                    title: 'Trigger Suggest'
                };
                return item;
            });
        }

        // Check if completing field name after @lookup:EntityName.
        const lookupMatch = beforeCursor.match(/@lookup:([^.]+)\.$/);
        if (lookupMatch) {
            const lookupEntityName = lookupMatch[1];
            const lookupEntity = this.entityDiscovery.getEntity(lookupEntityName);
            if (lookupEntity) {
                return lookupEntity.fields.map(field => {
                    const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);
                    item.detail = field.type;
                    item.documentation = field.description;
                    return item;
                });
            }
        }

        // Check if completing @parent: keyword
        if (beforeCursor.match(/@parent:\s*$/)) {
            // Suggest fields from parent entity
            return entity.fields.map(field => {
                const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);
                item.detail = 'Parent Field Reference';
                item.insertText = field.name;
                return item;
            });
        }

        return [];
    }

    /**
     * Get context information about cursor position in JSON structure
     * Determines if we're in fields, and if so, which entity's fields
     */
    private getCursorContext(document: vscode.TextDocument, position: vscode.Position): CursorContext {
        const context: CursorContext = {
            inFields: false,
            inRelatedEntities: false
        };

        let bracketCount = 0;
        let inFieldsDepth = -1;
        let relatedEntityName: string | undefined;

        // Scan backwards from cursor to determine context
        for (let lineNum = position.line; lineNum >= 0; lineNum--) {
            const line = document.lineAt(lineNum).text;
            const searchText = lineNum === position.line
                ? line.substring(0, position.character)
                : line;

            // Scan backwards through the line
            for (let i = searchText.length - 1; i >= 0; i--) {
                const char = searchText[i];

                if (char === '}') {
                    bracketCount++;
                } else if (char === '{') {
                    bracketCount--;

                    // Check if this opening bracket belongs to something we care about
                    if (bracketCount < 0) {
                        const beforeBracket = searchText.substring(0, i).trim();

                        // Check if we just exited a "fields" object
                        if (beforeBracket.endsWith('"fields":') || beforeBracket.endsWith('"fields" :')) {
                            if (inFieldsDepth === -1) {
                                // We're inside the fields object
                                context.inFields = true;
                                inFieldsDepth = bracketCount;
                            }
                        }

                        // Check if we're in a relatedEntities section
                        // Look for pattern like "EntityName": {
                        const entityMatch = beforeBracket.match(/"([^"]+)"\s*:\s*$/);
                        if (entityMatch && !relatedEntityName) {
                            // Check if this is inside relatedEntities by looking further back
                            const textBeforeEntity = document.getText(new vscode.Range(
                                new vscode.Position(Math.max(0, lineNum - 20), 0),
                                new vscode.Position(lineNum, i)
                            ));

                            if (textBeforeEntity.includes('"relatedEntities"')) {
                                // Try to find the entity name by looking for patterns
                                const possibleEntityName = entityMatch[1];

                                // Check if this looks like a related entity key (not a field name)
                                if (possibleEntityName.includes(':') || possibleEntityName.includes(' ')) {
                                    // Likely an entity name (e.g., "Action Params", "MJ: AI Prompt Models")
                                    relatedEntityName = possibleEntityName;
                                    context.inRelatedEntities = true;
                                }
                            }
                        }
                    }

                    // Reset bracket count at each level
                    if (bracketCount < 0) {
                        bracketCount = 0;
                    }
                }
            }

            // If we found fields and went back far enough, we can stop
            if (context.inFields && lineNum < position.line - 50) {
                break;
            }
        }

        if (relatedEntityName) {
            context.relatedEntityName = relatedEntityName;
        }

        return context;
    }
}
