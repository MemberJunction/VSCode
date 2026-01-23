import * as vscode from 'vscode';
import { EntityDiscovery } from '../services/EntityDiscovery';
import { MetadataRootDiscovery } from '../services/MetadataRootDiscovery';
import { OutputChannel } from '../common/OutputChannel';
import { EntityInfo, EntityFieldInfo } from '../types';

/**
 * Provides real-time validation diagnostics for metadata files
 */
export class MJSyncDiagnosticProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private entityDiscovery: EntityDiscovery;
    private rootDiscovery: MetadataRootDiscovery;

    constructor(diagnosticCollection: vscode.DiagnosticCollection) {
        this.diagnosticCollection = diagnosticCollection;
        this.entityDiscovery = EntityDiscovery.getInstance();
        this.rootDiscovery = MetadataRootDiscovery.getInstance();
    }

    public async validateDocument(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== 'json') {
            return;
        }

        const fileName = document.fileName;

        try {
            if (fileName.endsWith('.mj-sync.json')) {
                await this.validateSyncConfig(document);
            } else {
                await this.validateEntityRecord(document);
            }
        } catch (error) {
            OutputChannel.error('Error validating document', error as Error);
        }
    }

    private async validateSyncConfig(document: vscode.TextDocument): Promise<void> {
        const diagnostics: vscode.Diagnostic[] = [];

        try {
            const text = document.getText();
            const config = JSON.parse(text);

            // Validate entity name if present
            if (config.entity) {
                const entity = this.entityDiscovery.getEntity(config.entity);
                if (!entity) {
                    // Find the position of the entity value
                    const entityLine = this.findPropertyLine(document, 'entity');
                    if (entityLine !== -1) {
                        diagnostics.push(new vscode.Diagnostic(
                            new vscode.Range(entityLine, 0, entityLine, 999),
                            `Unknown entity: "${config.entity}". Entity not found in metadata.`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }
            }

            // Validate lookupFields entity references
            if (config.pull?.lookupFields) {
                for (const [fieldName, lookupConfig] of Object.entries(config.pull.lookupFields)) {
                    const lookup = lookupConfig as any;
                    if (lookup.entity) {
                        const entity = this.entityDiscovery.getEntity(lookup.entity);
                        if (!entity) {
                            diagnostics.push(new vscode.Diagnostic(
                                new vscode.Range(0, 0, 0, 999),
                                `Unknown lookup entity: "${lookup.entity}" for field "${fieldName}"`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                }
            }

            // Validate relatedEntities
            if (config.pull?.relatedEntities) {
                for (const [key, relatedConfig] of Object.entries(config.pull.relatedEntities)) {
                    const related = relatedConfig as any;
                    if (related.entity) {
                        const entity = this.entityDiscovery.getEntity(related.entity);
                        if (!entity) {
                            diagnostics.push(new vscode.Diagnostic(
                                new vscode.Range(0, 0, 0, 999),
                                `Unknown related entity: "${related.entity}" for "${key}"`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                }
            }

        } catch (error) {
            // JSON parse error
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 1),
                `Invalid JSON: ${(error as Error).message}`,
                vscode.DiagnosticSeverity.Error
            ));
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private async validateEntityRecord(document: vscode.TextDocument): Promise<void> {
        const diagnostics: vscode.Diagnostic[] = [];

        // Get entity name for this file
        const entityName = await this.rootDiscovery.getEntityNameForFile(document.fileName);

        if (!entityName) {
            // No entity config found - might not be in a metadata directory
            this.diagnosticCollection.set(document.uri, []);
            return;
        }

        const entity = this.entityDiscovery.getEntity(entityName);
        if (!entity) {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 1),
                `Entity "${entityName}" not found in metadata. Cannot validate fields.`,
                vscode.DiagnosticSeverity.Warning
            ));
            this.diagnosticCollection.set(document.uri, diagnostics);
            return;
        }

        try {
            const text = document.getText();
            const parsed = JSON.parse(text);

            // Support both array format and single-object format
            const records = Array.isArray(parsed) ? parsed : [parsed];

            // Validate each record
            for (let i = 0; i < records.length; i++) {
                const record = records[i];

                // Check if record has fields property
                if (!record.fields) {
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(0, 0, 0, 1),
                        Array.isArray(parsed)
                            ? `Record at index ${i} is missing required "fields" property`
                            : 'Record is missing required "fields" property',
                        vscode.DiagnosticSeverity.Error
                    ));
                    continue;
                }

                // Validate parent entity field names
                await this.validateFieldsInRecord(document, record.fields, entity, entityName, diagnostics);

                // Validate related entities
                if (record.relatedEntities) {
                    for (const [relatedEntityKey, relatedRecords] of Object.entries(record.relatedEntities)) {
                        const relatedData = relatedRecords as unknown;

                        // Determine the related entity name
                        let relatedEntityName = relatedEntityKey;

                        // If the related records have an entity property, use that
                        if (Array.isArray(relatedData) && relatedData.length > 0 && (relatedData[0] as Record<string, unknown>).entity) {
                            relatedEntityName = (relatedData[0] as Record<string, unknown>).entity as string;
                        }

                        const relatedEntity = this.entityDiscovery.getEntity(relatedEntityName);
                        if (!relatedEntity) {
                            // Unknown related entity - add diagnostic
                            const lineNum = this.findLineWithText(document, `"${relatedEntityKey}"`);
                            if (lineNum !== -1) {
                                const line = document.lineAt(lineNum);
                                const keyIndex = line.text.indexOf(`"${relatedEntityKey}"`);
                                const range = new vscode.Range(
                                    lineNum, keyIndex,
                                    lineNum, keyIndex + relatedEntityKey.length + 2
                                );
                                diagnostics.push(new vscode.Diagnostic(
                                    range,
                                    `Unknown related entity: "${relatedEntityName}". Entity not found in metadata.`,
                                    vscode.DiagnosticSeverity.Warning
                                ));
                            }
                            continue;
                        }

                        // Validate fields in each related record
                        if (Array.isArray(relatedData)) {
                            for (const relatedRecord of relatedData) {
                                const rec = relatedRecord as Record<string, unknown>;
                                if (rec.fields) {
                                    await this.validateFieldsInRecord(
                                        document,
                                        rec.fields as Record<string, unknown>,
                                        relatedEntity,
                                        relatedEntityName,
                                        diagnostics
                                    );
                                }
                            }
                        }
                    }
                }
            }

        } catch (error) {
            // JSON parse error
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 1),
                `Invalid JSON: ${(error as Error).message}`,
                vscode.DiagnosticSeverity.Error
            ));
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Validate fields within a record against entity definition
     */
    private async validateFieldsInRecord(
        document: vscode.TextDocument,
        fields: Record<string, unknown>,
        entity: EntityInfo,
        entityName: string,
        diagnostics: vscode.Diagnostic[]
    ): Promise<void> {
        const providedFieldNames = new Set(Object.keys(fields));

        // Check for unknown fields
        for (const fieldName of providedFieldNames) {
            const fieldValue = fields[fieldName];

            // Skip metadata keywords
            if (typeof fieldValue === 'string' && fieldValue.startsWith('@')) {
                continue;
            }

            // Check if field exists in entity
            const field = entity.fields.find((f: EntityFieldInfo) => f.name === fieldName);
            if (!field) {
                // Find the line where this field name appears
                const lineNum = this.findFieldNameLine(document, fieldName);
                if (lineNum !== -1) {
                    const line = document.lineAt(lineNum);
                    const fieldNameIndex = line.text.indexOf(`"${fieldName}"`);

                    if (fieldNameIndex !== -1) {
                        const range = new vscode.Range(
                            lineNum, fieldNameIndex,
                            lineNum, fieldNameIndex + fieldName.length + 2
                        );

                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            `Unknown field "${fieldName}" in ${entityName}. This field does not exist in the entity definition.`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                } else {
                    // Fallback to generic range if we can't find the exact line
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(0, 0, 0, 1),
                        `Unknown field "${fieldName}" in ${entityName}. This field does not exist in the entity definition.`,
                        vscode.DiagnosticSeverity.Error
                    ));
                }
            }
        }

        // Check for missing required fields
        const requiredFields = this.getRequiredFields(entity);
        const missingRequiredFields = requiredFields.filter(f => !providedFieldNames.has(f.name));

        if (missingRequiredFields.length > 0) {
            // Find the "fields" line to place the diagnostic near
            const fieldsLine = this.findPropertyLine(document, 'fields');
            const range = fieldsLine !== -1
                ? new vscode.Range(fieldsLine, 0, fieldsLine, 999)
                : new vscode.Range(0, 0, 0, 1);

            const fieldNames = missingRequiredFields.map(f => f.name).join(', ');
            diagnostics.push(new vscode.Diagnostic(
                range,
                `Missing required field${missingRequiredFields.length > 1 ? 's' : ''} in ${entityName}: ${fieldNames}`,
                vscode.DiagnosticSeverity.Warning
            ));
        }
    }

    /**
     * Get fields that are required (must be provided in the record)
     * A field is required if:
     * - It doesn't allow null
     * - It doesn't have a default value
     * - It's not auto-increment
     * - It's not virtual/computed
     * - It's not read-only
     * - It's not a primary key (usually auto-generated)
     */
    private getRequiredFields(entity: EntityInfo): EntityFieldInfo[] {
        return entity.fields.filter(field => {
            // Skip if field allows null
            if (field.allowsNull) {
                return false;
            }

            // Skip if field has a default value
            if (field.defaultValue !== undefined && field.defaultValue !== null) {
                return false;
            }

            // Skip auto-increment fields (identity columns)
            if (field.autoIncrement) {
                return false;
            }

            // Skip virtual/computed fields
            if (field.isVirtual) {
                return false;
            }

            // Skip read-only fields
            if (field.readOnly) {
                return false;
            }

            // Skip primary key fields (usually auto-generated or provided via @lookup)
            if (field.isPrimaryKey) {
                return false;
            }

            // Skip common system fields that are typically auto-managed
            const systemFields = [
                '__mj_CreatedAt',
                '__mj_UpdatedAt',
                'CreatedAt',
                'UpdatedAt',
                '__mj_DeletedAt'
            ];
            if (systemFields.includes(field.name)) {
                return false;
            }

            return true;
        });
    }

    /**
     * Find the line number where a field name appears
     */
    private findFieldNameLine(document: vscode.TextDocument, fieldName: string): number {
        const searchPattern = `"${fieldName}"`;

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            if (line.includes(searchPattern)) {
                return i;
            }
        }

        return -1;
    }

    /**
     * Find the line number where specific text appears
     */
    private findLineWithText(document: vscode.TextDocument, searchText: string): number {
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            if (line.includes(searchText)) {
                return i;
            }
        }
        return -1;
    }

    private findPropertyLine(document: vscode.TextDocument, propertyName: string): number {
        const regex = new RegExp(`"${propertyName}"\\s*:`);
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            if (regex.test(line)) {
                return i;
            }
        }
        return -1;
    }

    public clear(uri: vscode.Uri): void {
        this.diagnosticCollection.delete(uri);
    }

    public clearAll(): void {
        this.diagnosticCollection.clear();
    }
}
