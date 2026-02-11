import * as vscode from 'vscode';
import { EntityDiscovery } from '../services/EntityDiscovery';
import { EntityFieldInfo } from '../types';

/**
 * Provides code actions (quick fixes) for MJ Sync diagnostics
 */
export class MJSyncCodeActionProvider implements vscode.CodeActionProvider {
    private entityDiscovery: EntityDiscovery;

    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    constructor() {
        this.entityDiscovery = EntityDiscovery.getInstance();
    }

    provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] | undefined {
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            // Handle missing required fields
            if (diagnostic.message.startsWith('Missing required field')) {
                const fieldActions = this.createAddMissingFieldsActions(document, diagnostic);
                actions.push(...fieldActions);
            }

            // Handle unknown field errors
            if (diagnostic.message.startsWith('Unknown field')) {
                const suggestionActions = this.createFieldSuggestionActions(document, diagnostic);
                actions.push(...suggestionActions);
            }

            // Handle unknown entity errors
            if (diagnostic.message.startsWith('Unknown entity')) {
                const entityActions = this.createEntitySuggestionActions(document, diagnostic);
                actions.push(...entityActions);
            }
        }

        return actions;
    }

    /**
     * Create actions to add missing required fields
     */
    private createAddMissingFieldsActions(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // Parse the missing field names from the diagnostic message
        // Format: "Missing required field(s) in EntityName: field1, field2"
        const match = diagnostic.message.match(/Missing required fields? in (.+): (.+)$/);
        if (!match) {
            return actions;
        }

        const entityName = match[1];
        const fieldNamesStr = match[2];
        const fieldNames = fieldNamesStr.split(', ').map(f => f.trim());

        const entity = this.entityDiscovery.getEntity(entityName);
        if (!entity) {
            return actions;
        }

        // Find the position to insert new fields (after "fields": {)
        const insertPosition = this.findFieldsInsertPosition(document);
        if (!insertPosition) {
            return actions;
        }

        // Create action to add all missing fields at once
        if (fieldNames.length > 0) {
            const addAllAction = new vscode.CodeAction(
                `Add all missing required fields`,
                vscode.CodeActionKind.QuickFix
            );
            addAllAction.diagnostics = [diagnostic];
            addAllAction.isPreferred = true;

            const fieldsToAdd = fieldNames
                .map(name => entity.fields.find(f => f.name === name))
                .filter((f): f is EntityFieldInfo => f !== undefined);

            const insertText = this.generateFieldInsertText(fieldsToAdd, insertPosition.indent);

            addAllAction.edit = new vscode.WorkspaceEdit();
            addAllAction.edit.insert(document.uri, insertPosition.position, insertText);
            actions.push(addAllAction);
        }

        // Create individual actions for each field
        for (const fieldName of fieldNames) {
            const field = entity.fields.find(f => f.name === fieldName);
            if (!field) {
                continue;
            }

            const action = new vscode.CodeAction(
                `Add required field "${fieldName}"`,
                vscode.CodeActionKind.QuickFix
            );
            action.diagnostics = [diagnostic];

            const insertText = this.generateFieldInsertText([field], insertPosition.indent);

            action.edit = new vscode.WorkspaceEdit();
            action.edit.insert(document.uri, insertPosition.position, insertText);
            actions.push(action);
        }

        return actions;
    }

    /**
     * Create actions to suggest similar field names for unknown fields
     */
    private createFieldSuggestionActions(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // Parse the unknown field name from the diagnostic message
        // Format: 'Unknown field "fieldName" in EntityName...'
        const match = diagnostic.message.match(/Unknown field "(.+)" in (.+?)\./);
        if (!match) {
            return actions;
        }

        const unknownFieldName = match[1];
        const entityName = match[2];

        const entity = this.entityDiscovery.getEntity(entityName);
        if (!entity) {
            return actions;
        }

        // Find similar field names using fuzzy matching
        const suggestions = this.findSimilarFieldNames(unknownFieldName, entity.fields);

        for (const suggestion of suggestions.slice(0, 3)) {
            const action = new vscode.CodeAction(
                `Replace with "${suggestion.name}"`,
                vscode.CodeActionKind.QuickFix
            );
            action.diagnostics = [diagnostic];

            // Find the exact range of the field name in the document
            const fieldRange = this.findFieldNameRange(document, unknownFieldName, diagnostic.range);
            if (fieldRange) {
                action.edit = new vscode.WorkspaceEdit();
                action.edit.replace(document.uri, fieldRange, suggestion.name);
                actions.push(action);
            }
        }

        // Add action to remove the unknown field
        const removeAction = new vscode.CodeAction(
            `Remove unknown field "${unknownFieldName}"`,
            vscode.CodeActionKind.QuickFix
        );
        removeAction.diagnostics = [diagnostic];

        const lineRange = this.findFieldLineRange(document, unknownFieldName, diagnostic.range);
        if (lineRange) {
            removeAction.edit = new vscode.WorkspaceEdit();
            removeAction.edit.delete(document.uri, lineRange);
            actions.push(removeAction);
        }

        return actions;
    }

    /**
     * Create actions to suggest similar entity names for unknown entities
     */
    private createEntitySuggestionActions(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // Parse the unknown entity name from the diagnostic message
        const match = diagnostic.message.match(/Unknown (?:entity|related entity|lookup entity): "(.+?)"/);
        if (!match) {
            return actions;
        }

        const unknownEntityName = match[1];

        // Find similar entity names
        const allEntities = this.entityDiscovery.getAllEntities();
        const suggestions = this.findSimilarEntityNames(unknownEntityName, allEntities.map(e => e.name));

        for (const suggestion of suggestions.slice(0, 3)) {
            const action = new vscode.CodeAction(
                `Replace with "${suggestion}"`,
                vscode.CodeActionKind.QuickFix
            );
            action.diagnostics = [diagnostic];

            // Find the exact range of the entity name in the document
            const entityRange = this.findEntityNameRange(document, unknownEntityName, diagnostic.range);
            if (entityRange) {
                action.edit = new vscode.WorkspaceEdit();
                action.edit.replace(document.uri, entityRange, suggestion);
                actions.push(action);
            }
        }

        return actions;
    }

    /**
     * Find the position to insert new fields in the document
     */
    private findFieldsInsertPosition(document: vscode.TextDocument): { position: vscode.Position; indent: string } | null {
        const text = document.getText();

        // Find "fields": { and get position after the opening brace
        const fieldsMatch = text.match(/"fields"\s*:\s*\{/);
        if (!fieldsMatch || fieldsMatch.index === undefined) {
            return null;
        }

        const afterBraceIndex = fieldsMatch.index + fieldsMatch[0].length;
        const afterBracePos = document.positionAt(afterBraceIndex);

        // Determine the indentation level
        const line = document.lineAt(afterBracePos.line);
        const baseIndent = line.text.match(/^\s*/)?.[0] || '';
        const fieldIndent = baseIndent + '    '; // Add one level of indentation

        // Position at the end of the line after "fields": {
        return {
            position: new vscode.Position(afterBracePos.line, line.text.length),
            indent: fieldIndent
        };
    }

    /**
     * Generate the text to insert for new fields
     */
    private generateFieldInsertText(fields: EntityFieldInfo[], indent: string): string {
        const lines: string[] = [];

        for (const field of fields) {
            const defaultValue = this.getDefaultValueForField(field);
            lines.push(`\n${indent}"${field.name}": ${defaultValue},`);
        }

        return lines.join('');
    }

    /**
     * Get a sensible default value for a field based on its type
     */
    private getDefaultValueForField(field: EntityFieldInfo): string {
        const type = field.type.toLowerCase();

        // Check if it's a foreign key (has related entity)
        if (field.relatedEntity) {
            return `"@lookup(${field.relatedEntity}, )"`;
        }

        // Type-based defaults
        if (type.includes('int') || type.includes('decimal') || type.includes('float') || type.includes('money') || type.includes('numeric')) {
            return '0';
        }

        if (type.includes('bit') || type === 'boolean') {
            return 'false';
        }

        if (type.includes('date') || type.includes('time')) {
            return '""';
        }

        if (type.includes('uniqueidentifier') || type === 'guid') {
            return '""';
        }

        // Default to empty string for text types
        return '""';
    }

    /**
     * Find similar field names using Levenshtein distance
     */
    private findSimilarFieldNames(target: string, fields: EntityFieldInfo[]): EntityFieldInfo[] {
        const targetLower = target.toLowerCase();

        return fields
            .map(field => ({
                field,
                distance: this.levenshteinDistance(targetLower, field.name.toLowerCase())
            }))
            .filter(item => item.distance <= Math.max(3, target.length / 2))
            .sort((a, b) => a.distance - b.distance)
            .map(item => item.field);
    }

    /**
     * Find similar entity names using Levenshtein distance
     */
    private findSimilarEntityNames(target: string, entityNames: string[]): string[] {
        const targetLower = target.toLowerCase();

        return entityNames
            .map(name => ({
                name,
                distance: this.levenshteinDistance(targetLower, name.toLowerCase())
            }))
            .filter(item => item.distance <= Math.max(5, target.length / 2))
            .sort((a, b) => a.distance - b.distance)
            .map(item => item.name);
    }

    /**
     * Calculate Levenshtein distance between two strings
     */
    private levenshteinDistance(a: string, b: string): number {
        const matrix: number[][] = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }

    /**
     * Find the range of a field name in the document
     */
    private findFieldNameRange(
        document: vscode.TextDocument,
        fieldName: string,
        nearRange: vscode.Range
    ): vscode.Range | null {
        // Search near the diagnostic range
        const searchStart = Math.max(0, nearRange.start.line - 5);
        const searchEnd = Math.min(document.lineCount - 1, nearRange.end.line + 5);

        for (let i = searchStart; i <= searchEnd; i++) {
            const line = document.lineAt(i);
            const match = line.text.match(new RegExp(`"(${this.escapeRegex(fieldName)})"`));
            if (match && match.index !== undefined) {
                const startCol = match.index + 1; // Skip opening quote
                const endCol = startCol + fieldName.length;
                return new vscode.Range(i, startCol, i, endCol);
            }
        }

        return null;
    }

    /**
     * Find the range of an entire field line (for deletion)
     */
    private findFieldLineRange(
        document: vscode.TextDocument,
        fieldName: string,
        nearRange: vscode.Range
    ): vscode.Range | null {
        const searchStart = Math.max(0, nearRange.start.line - 5);
        const searchEnd = Math.min(document.lineCount - 1, nearRange.end.line + 5);

        for (let i = searchStart; i <= searchEnd; i++) {
            const line = document.lineAt(i);
            if (line.text.includes(`"${fieldName}"`)) {
                // Include the newline in the deletion
                const endLine = i + 1 < document.lineCount ? i + 1 : i;
                const endCol = i + 1 < document.lineCount ? 0 : line.text.length;
                return new vscode.Range(i, 0, endLine, endCol);
            }
        }

        return null;
    }

    /**
     * Find the range of an entity name in the document
     */
    private findEntityNameRange(
        document: vscode.TextDocument,
        entityName: string,
        nearRange: vscode.Range
    ): vscode.Range | null {
        const searchStart = Math.max(0, nearRange.start.line - 2);
        const searchEnd = Math.min(document.lineCount - 1, nearRange.end.line + 2);

        for (let i = searchStart; i <= searchEnd; i++) {
            const line = document.lineAt(i);
            const match = line.text.match(new RegExp(`"(${this.escapeRegex(entityName)})"`));
            if (match && match.index !== undefined) {
                const startCol = match.index + 1; // Skip opening quote
                const endCol = startCol + entityName.length;
                return new vscode.Range(i, startCol, i, endCol);
            }
        }

        return null;
    }

    /**
     * Escape special regex characters in a string
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
