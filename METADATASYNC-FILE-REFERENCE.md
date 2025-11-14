# MetadataSync File Reference Guide

## Key Source Files

### Configuration Type Definitions
Location: `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/src/config.ts`
- Defines `SyncConfig` interface (global configuration)
- Defines `EntityConfig` interface (entity-level configuration)
- Defines `RelatedEntityConfig` interface
- Defines `FolderConfig` interface
- Load functions: `loadMJConfig()`, `loadSyncConfig()`, `loadEntityConfig()`, `loadFolderConfig()`

### Metadata Keywords
Location: `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/src/constants/metadata-keywords.ts`
- Defines all metadata keyword constants: @file:, @lookup:, @parent:, @root:, @env:, @url:, @template:, @include
- Helper functions: `isMetadataKeyword()`, `getMetadataKeywordType()`, `extractKeywordValue()`, `createKeywordReference()`
- Keyword categories: `CONTEXT_DEPENDENT_KEYWORDS`, `EXTERNAL_REFERENCE_KEYWORDS`, `LOOKUP_KEYWORDS`, `RUNTIME_KEYWORDS`

### Validation Types
Location: `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/src/types/validation.ts`
- `ValidationResult` interface
- `ValidationError` and `ValidationWarning` interfaces
- `ParsedReference` interface for metadata keyword parsing

### Configuration Manager
Location: `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/src/lib/config-manager.ts`
- Singleton pattern for managing MJ configuration
- `loadMJConfig()` method
- Caches configuration across application lifetime

## Example Files

### Root-Level Global Configuration
Location: `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/demo/.mj-sync.json`
Location: `/Users/amith/Dropbox/develop/Mac/Skip_Brain/metadata/.mj-sync.json`
Contents: Global settings, push/pull config, directoryOrder, sqlLogging, watch settings

### Entity-Level Configuration
Location: `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/demo/ai-prompts/.mj-sync.json`
Location: `/Users/amith/Dropbox/develop/Mac/Skip_Brain/metadata/prompts/.mj-sync.json`
Contents: Entity name, filePattern, pull configuration, externalizeFields, lookupFields, relatedEntities

### Simple Entity Record (Single)
Location: `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/demo/ai-prompts/greeting.json`
Location: `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/demo/ai-prompts/data-analysis.json`
Contents: fields, primaryKey, sync, relatedEntities

### Entity Record with Metadata Keywords
Location: `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/demo/ai-prompts/multi-template-example.json`
Contents: @template array, @file: references, related entities with @lookup and @parent

### Entity Record with Complete Metadata
Location: `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/demo/ai-prompts/.field-management-example.json`
Contents: fields, primaryKey, sync (with checksum), example of field preservation

### Multiple Records in Single File
Location: `/Users/amith/Dropbox/develop/Mac/Skip_Brain/metadata/organizations/.organizations.json`
Contents: Array of entity records, each with fields/primaryKey/sync structure

### Externalized File (Referenced by @file:)
Location: `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/demo/ai-prompts/greeting.prompt.md`
Contents: Text/markdown content referenced by @file: keyword in entity JSON

## Configuration Schema Quick Reference

### Global .mj-sync.json
```
{
  "version": string,
  "filePattern": string?,
  "directoryOrder": string[]?,
  "ignoreDirectories": string[]?,
  "push": { ... }?,
  "sqlLogging": { ... }?,
  "watch": { ... }?,
  "userRoleValidation": { ... }?
}
```

### Entity-Level .mj-sync.json
```
{
  "entity": string,
  "filePattern": string?,
  "defaults": Record<string, any>?,
  "ignoreDirectories": string[]?,
  "pull": { ... }?
}
```

### Entity Record
```
{
  "fields": Record<string, any>,           // Required
  "primaryKey": { ID: string }?,           // Optional, auto-gen if omitted
  "sync": { lastModified: string, checksum: string }?,
  "relatedEntities": Record<string, any[]>?
}
```

### Entity Record Array
```
[
  { "fields": {...}, "primaryKey": {...}, "sync": {...} },
  { "fields": {...}, "primaryKey": {...}, "sync": {...} }
]
```

## Metadata Keywords Reference

| Keyword | Syntax | Purpose | Context |
|---------|--------|---------|---------|
| @file: | @file:path/to/file | Load external file | Any field |
| @lookup: | @lookup:Entity.Field=Value | Lookup entity by field | Foreign keys |
| @parent: | @parent:FieldName | Parent entity field | Related entities only |
| @root: | @root:FieldName | Root entity field | Nested entities only |
| @env: | @env:VAR_NAME | Environment variable | Any field |
| @url: | @url:https://... | Fetch remote URL | Any field |
| @template: | @template:path.json or [@template:[...]] | Load/merge template | Fields or values |
| @include | @include or @include.prop | Merge external file | Objects/arrays |

## Key Configuration Properties

### filePattern
- Glob pattern for finding entity files
- Location: Root-level or entity-level .mj-sync.json
- Examples: `"*.json"`, `".*.json"`, `"*.prompt.md"`
- NOT a regex: Use glob syntax, not regex escaping

### defaults
- Default field values for all records
- Can use metadata keywords like @lookup:
- Merged into every record in entity
- User values override defaults

### externalizeFields
- Configuration for pulling fields to separate files
- Array format with field and pattern
- Pattern supports placeholders: {Name}, {ID}, {FieldName}
- Example: `@file:templates/{Name}.template.md`

### lookupFields
- Convert foreign key IDs to @lookup references
- Map field names to lookup configurations
- Each lookup specifies entity and field to match on
- Enables readable version control representations

### relatedEntities
- Configuration for pulling related child records
- Supports recursive patterns for self-referencing entities
- Nested support for deep hierarchies
- Child records use @parent:FieldName for parent references

### preserveFields
- Fields that should NOT be overwritten during pull updates
- Allows local customization to persist
- Example: user-edited prompts or notes

### mergeStrategy
- How to handle updates: 'overwrite', 'merge', or 'skip'
- Determines conflict resolution behavior

## Common Usage Patterns

### Single Record File (Create)
- No primaryKey
- All required fields present
- Use @lookup: for foreign keys
- Optional sync metadata

### Array File (Bulk Operations)
- Array of entity objects
- Each has fields/primaryKey/sync
- Useful for multiple related records
- One logical file per entity type

### Nested/Related Entities
- Parent has fields, primaryKey, sync
- relatedEntities object contains related entity arrays
- Each related entity uses @parent:ID or @parent:FieldName
- Complete nested structure in single JSON file

### Template-Based Configuration
- Use @template to load shared JSON templates
- @template array for multiple template merges
- Reduces duplication in similar records
- Values can be overridden after template

### Externalized Content
- Large text fields stored separately
- @file: keyword references them in JSON
- Enables syntax highlighting for prompts/templates
- Specified in pull config externalizeFields

## File Locations Summary

**Primary Source**: `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/`
- Type definitions: `src/config.ts`
- Keywords: `src/constants/metadata-keywords.ts`
- Examples: `demo/` (AI Prompts, delete example, templates)

**Usage Examples**: `/Users/amith/Dropbox/develop/Mac/Skip_Brain/metadata/`
- Real-world configurations for: prompts, agents, actions, organizations, contacts, etc.
- Actual entity data files showing field structures

**VSCode Extension Target**: `/Users/amith/Dropbox/develop/Mac/MJVSCode/`
- For implementing JSON schema and IntelliSense

## How to Use This for VSCode Extension

1. **For .mj-sync.json validation**: Use SyncConfig and EntityConfig types as base
2. **For metadata keyword completion**: Reference METADATA_KEYWORDS constant
3. **For field value IntelliSense**: Recognize metadata keyword patterns
4. **For entity file structure**: Use entity record structure with fields/primaryKey/sync
5. **For pattern references**: Understand @file:, @lookup:, @parent:, @template: patterns
6. **For glob patterns**: Implement glob pattern matching, not regex
7. **For configuration inheritance**: Handle cumulative ignoreDirectories, cascading defaults

## Important Notes

1. All configuration and entity files are JSON (no comments in actual files)
2. filePattern is glob syntax, NOT regex
3. primaryKey.ID can be auto-generated (omit it for new records)
4. Metadata keywords use @ prefix consistently
5. Field names are case-sensitive
6. @parent: only valid in relatedEntities
7. sync object is metadata only (lastModified, checksum for dirty detection)
