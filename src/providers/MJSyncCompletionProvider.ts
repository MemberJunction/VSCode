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

        OutputChannel.info(`Completion triggered: ${fileName}, line ${position.line}, char ${position.character}`);
        OutputChannel.info(`Before cursor: "${beforeCursor}"`);

        try {
            // Check if this is a .mj-sync.json file
            if (fileName.endsWith('.mj-sync.json')) {
                OutputChannel.info('Providing .mj-sync.json completions');
                return await this.provideSyncConfigCompletions(document, position, beforeCursor);
            }

            // Otherwise, it's an entity record file
            OutputChannel.info('Providing entity record completions');
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
            return entities.map((entity, index) => {
                const item = new vscode.CompletionItem(entity.name, vscode.CompletionItemKind.Class);
                item.detail = `${entity.isCore ? 'Core' : 'Custom'} Entity`;
                item.documentation = new vscode.MarkdownString(
                    `**${entity.name}**\n\n` +
                    `Table: \`${entity.schemaName}.${entity.baseTable}\`\n\n` +
                    `Fields: ${entity.fields.length}\n\n` +
                    `${entity.description || ''}`
                );
                item.insertText = `"${entity.name}"`;
                // Sort MJ completions at the top
                item.sortText = `0_${index.toString().padStart(4, '0')}_${entity.name}`;
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
        OutputChannel.info(`Entity for file: ${entityName || 'NOT FOUND'}`);

        if (!entityName) {
            OutputChannel.warn('No entity found for file - no completions available');
            return [];
        }

        const entity = this.entityDiscovery.getEntity(entityName);
        if (!entity) {
            OutputChannel.warn(`Entity "${entityName}" not found in discovery`);
            return [];
        }

        OutputChannel.info(`Found entity: ${entity.name} with ${entity.fields.length} fields`);

        // Get cursor context to determine which entity's fields we should suggest
        const context = this.getCursorContext(document, position);
        OutputChannel.info(`Cursor context: inFields=${context.inFields}, inRelatedEntities=${context.inRelatedEntities}, relatedEntity=${context.relatedEntityName || 'none'}`);

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

            // Determine if user has started typing a field name
            const { prefix, hasOpenQuote, startPos } = this.getFieldNamePrefix(beforeCursor);
            OutputChannel.info(`Field prefix: "${prefix}", hasOpenQuote: ${hasOpenQuote}, startPos: ${startPos}`);

            return targetEntity.fields.map((field, index) => {
                const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);
                item.detail = `${field.type}${field.length ? `(${field.length})` : ''} - ${targetEntity.name}`;
                item.documentation = new vscode.MarkdownString(
                    `**${field.displayName}**\n\n` +
                    `Entity: \`${targetEntity.name}\`\n\n` +
                    `Type: \`${field.type}\`\n\n` +
                    `Nullable: ${field.allowsNull ? 'Yes' : 'No'}\n\n` +
                    `${field.isPrimaryKey ? '🔑 Primary Key\n\n' : ''}` +
                    `${field.relatedEntity ? `Related Entity: \`${field.relatedEntity}\`\n\n` : ''}` +
                    `${field.description || ''}`
                );

                // Set appropriate insertText based on whether user started with a quote
                if (hasOpenQuote) {
                    // User already typed opening quote, don't include it in insert
                    item.insertText = new vscode.SnippetString(`${field.name}": "\${1:value}"`);
                    // Set range to replace from the opening quote
                    item.range = new vscode.Range(
                        position.line, startPos,
                        position.line, position.character
                    );
                } else {
                    // User hasn't typed quote yet, include full field definition
                    item.insertText = new vscode.SnippetString(`"${field.name}": "\${1:value}"`);
                }

                // Use filterText to help VSCode match when user types partial field name
                // Also include quote prefix so it matches when user types "
                item.filterText = hasOpenQuote ? field.name : `"${field.name}`;

                // Sort MJ completions at the top (before VSCode defaults)
                item.sortText = `0_${index.toString().padStart(4, '0')}_${field.name}`;

                // Preselect first item for convenience
                if (index === 0) {
                    item.preselect = true;
                }

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
     * Properly handles JSON string contents to avoid false bracket matches
     */
    private getCursorContext(document: vscode.TextDocument, position: vscode.Position): CursorContext {
        const context: CursorContext = {
            inFields: false,
            inRelatedEntities: false
        };

        // Get all text from document start to cursor position
        const textToCursor = document.getText(new vscode.Range(
            new vscode.Position(0, 0),
            position
        ));

        // Find all "fields": { positions and track bracket depth
        let inFieldsBlock = false;
        let bracketDepth = 0;
        let fieldsStartDepth = -1;

        // Track if we're in relatedEntities
        let inRelatedEntitiesBlock = false;
        let relatedEntitiesStartDepth = -1;
        let relatedEntityName: string | undefined;

        // Track if we're inside a JSON string (to skip string contents)
        let inString = false;

        // Simple state machine to track JSON structure
        let i = 0;
        while (i < textToCursor.length) {
            const char = textToCursor[i];
            const prevChar = i > 0 ? textToCursor[i - 1] : '';

            // Handle string boundaries (skip string contents)
            if (char === '"' && prevChar !== '\\') {
                inString = !inString;
                i++;
                continue;
            }

            // Skip everything inside strings
            if (inString) {
                i++;
                continue;
            }

            if (char === '{') {
                bracketDepth++;

                // Check what came before this bracket
                const beforeBracket = textToCursor.substring(0, i).trim();

                // Check for "fields":
                if (beforeBracket.endsWith('"fields":') || beforeBracket.match(/"fields"\s*:\s*$/)) {
                    inFieldsBlock = true;
                    fieldsStartDepth = bracketDepth;
                    OutputChannel.info(`Found fields block at depth ${bracketDepth}`);
                }

                // Check for "relatedEntities":
                if (beforeBracket.endsWith('"relatedEntities":') || beforeBracket.match(/"relatedEntities"\s*:\s*$/)) {
                    inRelatedEntitiesBlock = true;
                    relatedEntitiesStartDepth = bracketDepth;
                }

                // Check for entity name in relatedEntities (pattern: "EntityName": {)
                if (inRelatedEntitiesBlock && !relatedEntityName) {
                    const entityMatch = beforeBracket.match(/"([^"]+)"\s*:\s*$/);
                    if (entityMatch) {
                        const possibleEntityName = entityMatch[1];
                        // Entity names often have spaces or colons
                        if (possibleEntityName !== 'fields' && possibleEntityName !== 'relatedEntities') {
                            relatedEntityName = possibleEntityName;
                        }
                    }
                }
            } else if (char === '}') {
                // Check if we're exiting a tracked block
                if (inFieldsBlock && bracketDepth === fieldsStartDepth) {
                    inFieldsBlock = false;
                    fieldsStartDepth = -1;
                }
                if (inRelatedEntitiesBlock && bracketDepth === relatedEntitiesStartDepth) {
                    inRelatedEntitiesBlock = false;
                    relatedEntitiesStartDepth = -1;
                    relatedEntityName = undefined;
                }
                bracketDepth--;
            }

            i++;
        }

        context.inFields = inFieldsBlock;
        context.inRelatedEntities = inRelatedEntitiesBlock;
        if (relatedEntityName) {
            context.relatedEntityName = relatedEntityName;
        }

        OutputChannel.info(`Context detection: inFields=${context.inFields}, depth=${bracketDepth}, fieldsDepth=${fieldsStartDepth}`);

        return context;
    }

    /**
     * Determine what prefix the user has typed for a field name
     * Returns the prefix (without quotes) and whether they started with a quote
     */
    private getFieldNamePrefix(beforeCursor: string): { prefix: string; hasOpenQuote: boolean; startPos: number } {
        // Check if user has started typing a field name (with or without quote)
        const trimmed = beforeCursor.trimEnd();

        // Check for pattern like: `    "Na` (started typing field name with quote)
        const quoteMatch = trimmed.match(/"([^":]*)$/);
        if (quoteMatch) {
            return {
                prefix: quoteMatch[1],
                hasOpenQuote: true,
                startPos: beforeCursor.lastIndexOf('"')
            };
        }

        // Check for pattern at start of value position (after colon and whitespace)
        // This handles the case where we're typing a new field name without quote yet
        if (trimmed.match(/[,{]\s*$/) || trimmed.match(/^\s*$/)) {
            return {
                prefix: '',
                hasOpenQuote: false,
                startPos: beforeCursor.length
            };
        }

        return { prefix: '', hasOpenQuote: false, startPos: beforeCursor.length };
    }
}
