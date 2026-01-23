import * as vscode from 'vscode';

/**
 * Base interface for extension features
 */
export interface Feature {
    /** Unique name for the feature */
    name: string;

    /** Check if the feature is enabled in settings */
    enabled(): boolean;

    /** Activate the feature */
    activate(context: vscode.ExtensionContext): Promise<void>;

    /** Deactivate the feature */
    deactivate(): Promise<void>;

    /** Optional: React to configuration changes */
    onConfigChange?(config: MJConfig): void;
}

/**
 * MemberJunction configuration
 */
export interface MJConfig {
    dbHost?: string;
    dbPort?: number;
    dbName?: string;
    dbUsername?: string;
    dbPassword?: string;
    metadataPath?: string;
    generatedEntitiesPath?: string;
    [key: string]: any;
}

/**
 * Entity information from MemberJunction
 */
export interface EntityInfo {
    id: string;
    name: string;
    baseTable: string;
    baseView: string;
    schemaName: string;
    description?: string;
    fields: EntityFieldInfo[];
    isCore: boolean;
    filePath?: string;
}

/**
 * Entity field information
 */
export interface EntityFieldInfo {
    id: string;
    name: string;
    displayName: string;
    type: string;
    length?: number;
    allowsNull: boolean;
    isPrimaryKey: boolean;
    isUnique: boolean;
    relatedEntity?: string;
    description?: string;
    /** Default value for the field (if any) */
    defaultValue?: string;
    /** Whether the field auto-increments (identity column) */
    autoIncrement: boolean;
    /** Whether the field is computed/virtual */
    isVirtual: boolean;
    /** Whether the field is read-only */
    readOnly: boolean;
}

/**
 * Validation result for metadata
 */
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

export interface ValidationError {
    message: string;
    line?: number;
    column?: number;
    path?: string;
}

export interface ValidationWarning {
    message: string;
    line?: number;
    column?: number;
    path?: string;
}
