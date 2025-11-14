import { EntityInfo } from '../types';
import { EntityDiscovery } from './EntityDiscovery';
import { OutputChannel } from '../common/OutputChannel';

/**
 * Generates JSON schemas for entities to enable IntelliSense
 */
export class SchemaGenerator {
    private static instance: SchemaGenerator;

    private constructor() {}

    public static getInstance(): SchemaGenerator {
        if (!this.instance) {
            this.instance = new SchemaGenerator();
        }
        return this.instance;
    }

    /**
     * Generate a JSON schema for a specific entity
     */
    public generateEntitySchema(entity: EntityInfo): any {
        const properties: any = {};
        const required: string[] = [];

        // Add properties for each field
        for (const field of entity.fields) {
            properties[field.name] = this.generateFieldSchema(field);

            // Mark non-nullable fields as required (except auto-increment primary keys)
            if (!field.allowsNull && !field.isPrimaryKey) {
                required.push(field.name);
            }
        }

        const schema = {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            title: entity.name,
            description: entity.description || `Schema for ${entity.name} entity`,
            properties,
            additionalProperties: false
        };

        if (required.length > 0) {
            (schema as any).required = required;
        }

        return schema;
    }

    /**
     * Generate schema for a single field
     */
    private generateFieldSchema(field: any): any {
        const schema: any = {
            description: field.description || field.displayName
        };

        // Map SQL types to JSON schema types
        const typeMapping: { [key: string]: string } = {
            'nvarchar': 'string',
            'varchar': 'string',
            'char': 'string',
            'nchar': 'string',
            'text': 'string',
            'ntext': 'string',
            'int': 'integer',
            'bigint': 'integer',
            'smallint': 'integer',
            'tinyint': 'integer',
            'decimal': 'number',
            'numeric': 'number',
            'float': 'number',
            'real': 'number',
            'money': 'number',
            'smallmoney': 'number',
            'bit': 'boolean',
            'datetime': 'string',
            'datetime2': 'string',
            'date': 'string',
            'time': 'string',
            'datetimeoffset': 'string',
            'uniqueidentifier': 'string'
        };

        const jsonType = typeMapping[field.type.toLowerCase()] || 'string';
        schema.type = jsonType;

        // Add format hints for specific types
        if (field.type.toLowerCase().includes('date') || field.type.toLowerCase().includes('time')) {
            schema.format = 'date-time';
        }

        if (field.type.toLowerCase() === 'uniqueidentifier') {
            schema.format = 'uuid';
        }

        // Add length constraints for strings
        if (jsonType === 'string' && field.length && field.length > 0) {
            schema.maxLength = field.length;
        }

        // Add related entity information
        if (field.relatedEntity) {
            schema['x-relatedEntity'] = field.relatedEntity;
        }

        // Add metadata
        schema['x-primaryKey'] = field.isPrimaryKey;
        schema['x-unique'] = field.isUnique;

        return schema;
    }

    /**
     * Generate a combined schema for all entities
     */
    public async generateAllEntitiesSchema(): Promise<any> {
        const entityDiscovery = EntityDiscovery.getInstance();
        const entities = entityDiscovery.getAllEntities();

        const definitions: any = {};

        for (const entity of entities) {
            const entityKey = entity.name.replace(/\s+/g, '');
            definitions[entityKey] = this.generateEntitySchema(entity);
        }

        const schema = {
            $schema: 'http://json-schema.org/draft-07/schema#',
            title: 'MemberJunction Entities',
            description: 'Schema definitions for all MemberJunction entities',
            definitions
        };

        OutputChannel.info(`Generated schemas for ${Object.keys(definitions).length} entities`);

        return schema;
    }

    /**
     * Generate schema with entity name suggestions
     */
    public generateMetadataSchema(): any {
        const entityDiscovery = EntityDiscovery.getInstance();
        const entities = entityDiscovery.getAllEntities();

        const entityNames = entities.map(e => e.name);

        const schema = {
            $schema: 'http://json-schema.org/draft-07/schema#',
            title: 'MemberJunction Metadata',
            description: 'Schema for MemberJunction metadata files',
            type: 'object',
            properties: {
                EntityName: {
                    type: 'string',
                    description: 'Name of the entity',
                    enum: entityNames
                },
                SchemaName: {
                    type: 'string',
                    description: 'Database schema name',
                    default: 'dbo'
                },
                BaseTable: {
                    type: 'string',
                    description: 'Name of the base table'
                },
                BaseView: {
                    type: 'string',
                    description: 'Name of the base view'
                },
                Description: {
                    type: 'string',
                    description: 'Description of the entity'
                },
                Fields: {
                    type: 'array',
                    description: 'Array of field definitions',
                    items: {
                        type: 'object',
                        properties: {
                            Name: {
                                type: 'string',
                                description: 'Field name'
                            },
                            DisplayName: {
                                type: 'string',
                                description: 'Display name for the field'
                            },
                            Type: {
                                type: 'string',
                                description: 'SQL data type',
                                enum: [
                                    'nvarchar', 'varchar', 'char', 'nchar', 'text', 'ntext',
                                    'int', 'bigint', 'smallint', 'tinyint',
                                    'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney',
                                    'bit', 'datetime', 'datetime2', 'date', 'time', 'datetimeoffset',
                                    'uniqueidentifier'
                                ]
                            },
                            Length: {
                                type: 'integer',
                                description: 'Maximum length for string types'
                            },
                            AllowsNull: {
                                type: 'boolean',
                                description: 'Whether the field allows null values',
                                default: true
                            },
                            IsPrimaryKey: {
                                type: 'boolean',
                                description: 'Whether this is a primary key field',
                                default: false
                            },
                            IsUnique: {
                                type: 'boolean',
                                description: 'Whether values must be unique',
                                default: false
                            },
                            RelatedEntity: {
                                type: 'string',
                                description: 'Name of related entity for foreign keys',
                                enum: entityNames
                            },
                            Description: {
                                type: 'string',
                                description: 'Field description'
                            }
                        },
                        required: ['Name', 'Type']
                    }
                }
            },
            required: ['EntityName', 'BaseTable']
        };

        return schema;
    }
}
