# MetadataSync System - Executive Summary

## What is MetadataSync?

MetadataSync is a MemberJunction system that synchronizes database metadata with local JSON files, enabling developers and users to:
- Edit metadata using their preferred code editors
- Version control metadata changes with Git
- Use CI/CD pipelines for metadata deployment
- Enable offline editing
- Collaborate on metadata changes through pull requests

## Complete File Structure

### Configuration Files (.mj-sync.json)

**Two types of .mj-sync.json files:**

1. **Root-Level (Global Configuration)**
   - Applies to entire project
   - Contains: version, directoryOrder, ignoreDirectories, push settings, sqlLogging, watch settings
   - One per project (usually at metadata root)

2. **Entity-Level (Entity Configuration)**
   - Applies to specific entity directory
   - Contains: entity name, filePattern, defaults, pull configuration
   - One per entity directory

### Data Files (Entity Records)

**Two formats for entity data:**

1. **Single Record File**
   - Contains one entity record as JSON object
   - Structure: `{ "fields": {...}, "primaryKey": {...}, "sync": {...} }`

2. **Array File**
   - Contains multiple entity records as JSON array
   - Each record has same structure as single record file

### Supporting Files

- **.mj-folder.json** - Optional folder-level defaults (cascading)
- **Externalized Files** - Content stored separately (@file: references)
  - Prompts (.md or .txt)
  - Templates (.json)
  - Examples (.json)
  - Any custom format

## Core Concepts

### Metadata Keywords

All dynamic values use @ prefix for special handling:

| Keyword | Example | Purpose |
|---------|---------|---------|
| @file: | @file:prompt.md | Load external file content |
| @lookup: | @lookup:Users.Email=john@example.com | Find entity and use its ID |
| @parent: | @parent:ID | Reference parent entity field |
| @root: | @root:ID | Reference root entity field |
| @env: | @env:API_KEY | Get environment variable |
| @url: | @url:https://example.com/file | Fetch remote URL |
| @template: | @template:standard.json | Load JSON template |
| @include | @include:file.json | Merge external file |

### Record Structure

Every entity record has three main parts:

```json
{
  "fields": {
    // All entity field values
    "Name": "Record Name",
    "Status": "Active",
    "UserID": "@lookup:Users.Email=admin@example.com"
  },
  "primaryKey": {
    // Primary key (usually just ID)
    "ID": "guid-or-auto-generated"
  },
  "sync": {
    // Metadata for change tracking
    "lastModified": "2024-03-15T10:30:00.000Z",
    "checksum": "sha256-hash"
  },
  "relatedEntities": {
    // Nested child records
    "ChildEntity": [
      {
        "fields": {
          "ParentID": "@parent:ID",
          "Name": "Child Record"
        }
      }
    ]
  }
}
```

## Key Properties Explained

### filePattern
Glob pattern for finding entity data files:
- `*.json` - Any .json file
- `.*.json` - Dot-prefixed .json files
- `greeting*.json` - Files starting with "greeting"
- **Not regex** - Use glob syntax, not escaping

### defaults
Default field values applied to all records:
```json
{
  "defaults": {
    "CategoryID": "@lookup:AI Prompt Categories.Name=Examples?create",
    "UserID": "SYSTEM_USER_ID"
  }
}
```

### externalizeFields
Configuration for storing large fields in separate files:
```json
{
  "externalizeFields": [
    {
      "field": "TemplateText",
      "pattern": "@file:templates/{Name}.template.md"
    },
    {
      "field": "OutputExample",
      "pattern": "@file:output/{Name}.example.json"
    }
  ]
}
```

Placeholders in pattern:
- `{Name}` - Entity's Name field
- `{ID}` - Entity's ID
- `{FieldName}` - Any other field from entity

### lookupFields
Convert foreign keys to readable @lookup references:
```json
{
  "lookupFields": {
    "CategoryID": {
      "entity": "AI Prompt Categories",
      "field": "Name"
    },
    "TypeID": {
      "entity": "AI Prompt Types",
      "field": "Name"
    }
  }
}
```

### relatedEntities
Configuration for pulling related child records:
```json
{
  "relatedEntities": {
    "MJ: AI Prompt Models": {
      "entity": "MJ: AI Prompt Models",
      "foreignKey": "PromptID",
      "filter": "Status = 'Active'",
      "lookupFields": {
        "ModelID": {"entity": "AI Models", "field": "Name"}
      }
    }
  }
}
```

## Directory Structure Example

```
metadata/
├── .mj-sync.json                    (root config)
├── prompt-categories/
│   ├── .mj-sync.json                (entity config)
│   └── .prompt-categories.json       (entity data - array)
├── prompts/
│   ├── .mj-sync.json                (entity config)
│   ├── greeting.json                 (entity record - single)
│   ├── greeting.prompt.md            (externalized prompt content)
│   ├── data-analysis.json            (entity record - single)
│   ├── data-analysis.prompt.md       (externalized prompt content)
│   ├── templates/
│   │   ├── standard-settings.json
│   │   └── customer-defaults.json
│   └── output/
│       └── greeting.example.json
└── organizations/
    ├── .mj-sync.json
    └── .organizations.json           (entity data - array)
```

## Configuration Inheritance

Settings cascade down from parent to child:
1. Root-level .mj-sync.json sets global defaults
2. Entity-level .mj-sync.json overrides global settings
3. ignoreDirectories values are cumulative (both apply)
4. More specific settings override general ones

## Common Patterns

### Creating a New Entity Record
```json
{
  "fields": {
    "Name": "New Record",
    "Description": "Description",
    "TypeID": "@lookup:Types.Name=Standard"
  }
}
```
(No primaryKey or sync - they're auto-generated)

### Updating Existing Record
```json
{
  "fields": {
    "Name": "Updated Name"
  },
  "primaryKey": {
    "ID": "existing-guid-here"
  },
  "sync": {
    "lastModified": "2024-03-15T10:30:00.000Z",
    "checksum": "existing-checksum"
  }
}
```

### Record with Related Entities
```json
{
  "fields": {
    "Name": "Parent Record"
  },
  "relatedEntities": {
    "ChildEntity": [
      {
        "fields": {
          "ParentID": "@parent:ID",
          "Name": "Child 1"
        }
      },
      {
        "fields": {
          "ParentID": "@parent:ID",
          "Name": "Child 2"
        }
      }
    ]
  }
}
```

## Source Files Location

| File | Location | Purpose |
|------|----------|---------|
| config.ts | `/MJ/packages/MetadataSync/src/config.ts` | Type definitions |
| metadata-keywords.ts | `/MJ/packages/MetadataSync/src/constants/` | Keyword constants |
| validation.ts | `/MJ/packages/MetadataSync/src/types/` | Validation types |
| Demo configs | `/MJ/packages/MetadataSync/demo/` | Example files |
| Real examples | `/Skip_Brain/metadata/` | Production examples |

## Critical Details for Implementation

1. **filePattern is glob, not regex**
   - Correct: `*.json`, `.*.json`, `greeting*.json`
   - Wrong: `.*\.json`, `\..*\.json`

2. **Metadata keywords always use @ prefix**
   - @file:, @lookup:, @parent:, @root:, @env:, @url:, @template:, @include

3. **Field names are case-sensitive**
   - Match entity definition exactly

4. **primaryKey.ID is optional**
   - Omit for new records (auto-generated)
   - Include for updates (enables dirty detection)

5. **sync object is metadata only**
   - lastModified: ISO 8601 datetime
   - checksum: SHA256 hash for dirty detection
   - Auto-populated during pull

6. **@parent: only in relatedEntities**
   - Cannot be used at top level
   - References parent entity fields

7. **defaults can use metadata keywords**
   - @lookup: references supported in defaults
   - User values override defaults

## Use Cases for VSCode Extension

The extension should provide IntelliSense for:

1. **.mj-sync.json files** (both root and entity level)
   - Property autocomplete
   - Type validation
   - Help text for each property

2. **Entity JSON files**
   - fields, primaryKey, sync, relatedEntities structure
   - Metadata keyword completion
   - Field name suggestions (if entity list available)

3. **Metadata keywords**
   - Keyword completion: @file:, @lookup:, etc.
   - Syntax validation
   - Path/reference suggestions

4. **Patterns and references**
   - filePattern glob validation
   - @lookup: syntax helper
   - @file: path suggestions
   - Placeholder suggestions in externalizeFields patterns

5. **Configuration validation**
   - Required vs optional fields
   - Type checking
   - Cross-reference validation

## Performance Considerations

- Large files with many records should use .backups directory
- Externalized fields improve editor performance
- Array files best for bulk operations
- Single record files better for frequent updates
- directoryOrder prevents dependency issues

## Security Considerations

- @env: exposes environment variables
- @lookup:?create can auto-create records
- UserID fields should validate against actual users
- SQL filter in pull config can expose queries

## Version Information

- Current version: 1.0 (from example files)
- Schema stable across MJ_FRESH and Skip_Brain
- Backward compatible with older configurations
