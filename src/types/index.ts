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
    [key: string]: unknown;
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

/**
 * AI Agent information for the extension
 */
export interface AgentInfo {
    id: string;
    name: string;
    description?: string;
    status: 'Active' | 'Disabled' | 'Pending';
    agentType?: string;
}

/**
 * Agent execution options
 */
export interface AgentExecutionOptions {
    verbose?: boolean;
    timeout?: number;
    conversationMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Agent execution result for display
 */
export interface AgentExecutionResult {
    success: boolean;
    agentName: string;
    message?: string;
    error?: string;
    duration?: number;
    payload?: unknown;
}

/**
 * Agent progress event for UI updates
 */
export interface AgentProgressEvent {
    step: string;
    message: string;
    percentage?: number;
    metadata?: Record<string, unknown>;
}
