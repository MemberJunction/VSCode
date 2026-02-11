import { EntityInfo } from '../types';
import { EntityDiscovery } from './EntityDiscovery';

/**
 * Generates JSON schemas specifically for .mj-sync.json files and entity record files
 */
export class MJSyncSchemaGenerator {
    private static instance: MJSyncSchemaGenerator;

    private constructor() {}

    public static getInstance(): MJSyncSchemaGenerator {
        if (!this.instance) {
            this.instance = new MJSyncSchemaGenerator();
        }
        return this.instance;
    }

    /**
     * Generate schema for root-level .mj-sync.json
     */
    public generateRootSyncSchema(): Record<string, unknown> {
        // EntityDiscovery not needed for root config, but keeping for consistency
        // const entityDiscovery = EntityDiscovery.getInstance();
        // const entities = entityDiscovery.getAllEntities();

        return {
            $schema: 'http://json-schema.org/draft-07/schema#',
            title: 'MemberJunction Root Sync Configuration',
            description: 'Root-level .mj-sync.json configuration file',
            type: 'object',
            properties: {
                version: {
                    type: 'string',
                    description: 'Configuration version',
                    default: '1.0.0',
                    pattern: '^\\d+\\.\\d+\\.\\d+$'
                },
                push: {
                    type: 'object',
                    description: 'Push configuration',
                    properties: {
                        autoCreateMissingRecords: {
                            type: 'boolean',
                            description: 'Automatically create records that don\'t exist in the database',
                            default: true
                        }
                    }
                },
                pull: {
                    type: 'object',
                    description: 'Pull configuration',
                    properties: {
                        createNewFileIfNotFound: {
                            type: 'boolean',
                            description: 'Create new file if entity record not found locally'
                        },
                        updateExistingRecords: {
                            type: 'boolean',
                            description: 'Update existing records during pull'
                        }
                    }
                },
                directoryOrder: {
                    type: 'array',
                    description: 'Processing order for subdirectories during sync operations',
                    items: {
                        type: 'string'
                    }
                },
                ignoreDirectories: {
                    type: 'array',
                    description: 'Directories to ignore during sync',
                    items: {
                        type: 'string'
                    }
                },
                sqlLogging: {
                    type: 'object',
                    description: 'SQL logging configuration',
                    properties: {
                        enabled: {
                            type: 'boolean',
                            description: 'Enable SQL logging',
                            default: false
                        },
                        outputDirectory: {
                            type: 'string',
                            description: 'Directory for SQL log files',
                            default: './sql_logging'
                        },
                        filterPatterns: {
                            type: 'array',
                            description: 'Glob patterns for filtering SQL statements',
                            items: {
                                type: 'string'
                            }
                        },
                        filterType: {
                            type: 'string',
                            description: 'How to apply filter patterns',
                            enum: ['include', 'exclude'],
                            default: 'exclude'
                        },
                        formatAsMigration: {
                            type: 'boolean',
                            description: 'Format SQL logs as migration scripts',
                            default: false
                        }
                    }
                }
            },
            required: ['version']
        };
    }

    /**
     * Generate schema for entity-level .mj-sync.json
     */
    public generateEntitySyncSchema(): Record<string, unknown> {
        const entityDiscovery = EntityDiscovery.getInstance();
        const entities = entityDiscovery.getAllEntities();
        const entityNames = entities.map(e => e.name);

        return {
            $schema: 'http://json-schema.org/draft-07/schema#',
            title: 'MemberJunction Entity Sync Configuration',
            description: 'Entity-level .mj-sync.json configuration file',
            type: 'object',
            properties: {
                entity: {
                    type: 'string',
                    description: 'Name of the entity this directory represents',
                    enum: entityNames
                },
                filePattern: {
                    type: 'string',
                    description: 'Glob pattern for matching entity record files (e.g., "**/.*.json", "*.json")',
                    default: '**/.*.json'
                },
                defaults: {
                    type: 'object',
                    description: 'Default field values for new records (supports @lookup: syntax)',
                    additionalProperties: true
                },
                ignoreDirectories: {
                    type: 'array',
                    description: 'Subdirectories to ignore during sync',
                    items: {
                        type: 'string'
                    }
                },
                push: {
                    type: 'object',
                    description: 'Push-specific configuration',
                    properties: {
                        autoCreateMissingRecords: {
                            type: 'boolean',
                            description: 'Auto-create records that don\'t exist'
                        },
                        validateBeforePush: {
                            type: 'boolean',
                            description: 'Validate records before pushing'
                        }
                    }
                },
                pull: {
                    type: 'object',
                    description: 'Pull-specific configuration',
                    properties: {
                        createNewFileIfNotFound: {
                            type: 'boolean',
                            description: 'Create new file if record not found locally'
                        },
                        newFileName: {
                            type: 'string',
                            description: 'File name pattern for new files (e.g., ".records.json")'
                        },
                        appendRecordsToExistingFile: {
                            type: 'boolean',
                            description: 'Append to existing file rather than create new'
                        },
                        updateExistingRecords: {
                            type: 'boolean',
                            description: 'Update existing records during pull'
                        },
                        ignoreNullFields: {
                            type: 'boolean',
                            description: 'Don\'t include null fields in pulled records'
                        },
                        ignoreVirtualFields: {
                            type: 'boolean',
                            description: 'Don\'t include virtual/computed fields'
                        },
                        preserveFields: {
                            type: 'array',
                            description: 'Fields to preserve from local files (don\'t overwrite)',
                            items: {
                                type: 'string'
                            }
                        },
                        excludeFields: {
                            type: 'array',
                            description: 'Fields to exclude from pulled records',
                            items: {
                                type: 'string'
                            }
                        },
                        mergeStrategy: {
                            type: 'string',
                            description: 'How to merge pulled data with local files',
                            enum: ['merge', 'replace', 'append']
                        },
                        backupBeforeUpdate: {
                            type: 'boolean',
                            description: 'Create backup before updating files'
                        },
                        backupDirectory: {
                            type: 'string',
                            description: 'Directory for backups',
                            default: '.backups'
                        },
                        filter: {
                            type: 'string',
                            description: 'SQL WHERE clause to filter records during pull'
                        },
                        externalizeFields: {
                            type: 'array',
                            description: 'Fields to externalize to separate files using @file: syntax',
                            items: {
                                type: 'object',
                                properties: {
                                    field: {
                                        type: 'string',
                                        description: 'Field name to externalize'
                                    },
                                    pattern: {
                                        type: 'string',
                                        description: 'File path pattern (e.g., "@file:templates/{Name}.md")'
                                    }
                                },
                                required: ['field', 'pattern']
                            }
                        },
                        lookupFields: {
                            type: 'object',
                            description: 'Field lookup configurations for related entities',
                            additionalProperties: {
                                type: 'object',
                                properties: {
                                    entity: {
                                        type: 'string',
                                        description: 'Related entity name',
                                        enum: entityNames
                                    },
                                    field: {
                                        type: 'string',
                                        description: 'Field to display (e.g., "Name")'
                                    }
                                },
                                required: ['entity', 'field']
                            }
                        },
                        relatedEntities: {
                            type: 'object',
                            description: 'Configuration for pulling related child entities',
                            additionalProperties: {
                                type: 'object',
                                properties: {
                                    entity: {
                                        type: 'string',
                                        description: 'Related entity name',
                                        enum: entityNames
                                    },
                                    foreignKey: {
                                        type: 'string',
                                        description: 'Foreign key field in related entity'
                                    },
                                    filter: {
                                        type: 'string',
                                        description: 'Additional filter for related records'
                                    },
                                    lookupFields: {
                                        type: 'object',
                                        description: 'Lookup configurations for related entity fields',
                                        additionalProperties: {
                                            type: 'object',
                                            properties: {
                                                entity: {
                                                    type: 'string',
                                                    enum: entityNames
                                                },
                                                field: {
                                                    type: 'string'
                                                }
                                            }
                                        }
                                    }
                                },
                                required: ['entity', 'foreignKey']
                            }
                        }
                    }
                }
            },
            required: ['entity', 'filePattern']
        };
    }

    /**
     * Generate schema for entity record files (the actual data files)
     */
    public generateEntityRecordSchema(entityName?: string): Record<string, unknown> {
        const entityDiscovery = EntityDiscovery.getInstance();
        let entity: EntityInfo | undefined;

        if (entityName) {
            entity = entityDiscovery.getEntity(entityName);
        }

        // Entity names for future use in validation
        // const entityNames = entityDiscovery.getAllEntities().map(e => e.name);

        // Build field properties if we have a specific entity
        const fieldProperties: Record<string, unknown> = {};
        if (entity) {
            for (const field of entity.fields) {
                fieldProperties[field.name] = {
                    description: field.description || field.displayName,
                    // Allow metadata keywords (strings starting with @)
                    oneOf: [
                        this.getFieldTypeSchema(field.type),
                        {
                            type: 'string',
                            pattern: '^@(lookup|file|parent|root|env|url|template|include):',
                            description: 'Metadata keyword (@lookup:, @file:, @parent:, etc.)'
                        }
                    ]
                };
            }
        }

        return {
            $schema: 'http://json-schema.org/draft-07/schema#',
            title: entity ? `${entity.name} Records` : 'Entity Records',
            description: 'Array of entity records with fields, primaryKey, sync, and relatedEntities',
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    fields: {
                        type: 'object',
                        description: 'Entity field values (supports metadata keywords like @lookup:, @file:)',
                        properties: entity ? fieldProperties : {},
                        additionalProperties: true,
                        required: entity ? entity.fields.filter(f => !f.allowsNull && !f.isPrimaryKey).map(f => f.name) : []
                    },
                    primaryKey: {
                        type: 'object',
                        description: 'Primary key values (usually just ID)',
                        properties: {
                            ID: {
                                type: 'string',
                                description: 'Record ID (UUID format)',
                                pattern: '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'
                            }
                        },
                        additionalProperties: true
                    },
                    sync: {
                        type: 'object',
                        description: 'Sync metadata (auto-generated by MetadataSync)',
                        properties: {
                            lastModified: {
                                type: 'string',
                                description: 'Last modification timestamp',
                                format: 'date-time'
                            },
                            checksum: {
                                type: 'string',
                                description: 'SHA256 checksum of record data'
                            }
                        }
                    },
                    relatedEntities: {
                        type: 'object',
                        description: 'Child/related entity records',
                        additionalProperties: {
                            type: 'array',
                            items: {
                                $ref: '#/items'  // Recursive reference
                            }
                        }
                    }
                },
                required: ['fields']
            }
        };
    }

    /**
     * Helper to get JSON schema type from SQL type
     */
    private getFieldTypeSchema(sqlType: string): Record<string, unknown> {
        const type = sqlType.toLowerCase();

        if (type.includes('int') || type.includes('numeric') || type.includes('decimal')) {
            return { type: 'number' };
        } else if (type.includes('bit')) {
            return { type: 'boolean' };
        } else if (type.includes('date') || type.includes('time')) {
            return { type: 'string', format: 'date-time' };
        } else {
            return { type: 'string' };
        }
    }
}
