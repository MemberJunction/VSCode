# MetadataSync Complete File Structure and Schema Analysis

## Overview
MetadataSync is a MemberJunction system for synchronizing database metadata with local JSON files. It enables developers to edit, version-control, and deploy MJ metadata using their preferred editors and git workflows.

## Directory Structure

### Main Package Location
```
/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/
├── src/
│   ├── config.ts                 # Configuration type definitions (SyncConfig, EntityConfig, etc.)
│   ├── types/
│   │   └── validation.ts         # Validation types and interfaces
│   ├── constants/
│   │   └── metadata-keywords.ts  # Metadata keyword definitions and utilities
│   ├── lib/
│   │   ├── config-manager.ts     # Configuration management singleton
│   │   └── sync-engine.ts        # Core sync logic
│   └── services/                 # Service implementations
├── demo/                         # Example configurations and data
│   ├── .mj-sync.json            # Root sync configuration
│   ├── ai-prompts/              # Entity directory
│   │   ├── .mj-sync.json        # Entity-specific config
│   │   ├── greeting.json         # Entity record (single)
│   │   ├── greeting.prompt.md    # Externalized file
│   │   ├── multi-template-example.json
│   │   ├── data-analysis.json
│   │   └── all-prompts.json     # Array of entity records
│   ├── delete-example/
│   │   └── .mj-sync.json
│   └── templates/               # Shared template files
│       ├── standard-ai-models.json
│       └── standard-prompt-settings.json
└── examples/
    └── user-role-validation/
        ├── .mj-sync.json
        ├── actions/
        │   ├── .mj-sync.json
        │   └── test-action.json
```

## File Types

### 1. Root-Level .mj-sync.json (Global Configuration)
**Location**: Typically at project root or entity parent directory
**Contains**: Global sync settings that apply to all subdirectories

**Key Properties**:
- `version`: Version of the sync configuration format (e.g., "1.0.0")
- `filePattern`: Optional glob pattern for finding data files
- `directoryOrder`: Array specifying the order to process subdirectories (handles dependencies)
- `ignoreDirectories`: Directories to skip during processing (cumulative with parent settings)
- `push`: Global push configuration
  - `validateBeforePush`: Validate records before pushing
  - `requireConfirmation`: Require user confirmation
  - `autoCreateMissingRecords`: Auto-create records when primaryKey exists but record not found
  - `alwaysPush`: Force all records to database regardless of dirty state
- `sqlLogging`: SQL logging configuration (root-level only)
  - `enabled`: Enable SQL logging
  - `outputDirectory`: Directory for SQL logs
  - `formatAsMigration`: Format as migration files
  - `filterPatterns`: Patterns to filter SQL statements
  - `filterType`: 'exclude' or 'include'
- `watch`: Watch mode configuration
  - `debounceMs`: Debounce milliseconds for file change detection
  - `ignorePatterns`: File patterns to ignore
- `userRoleValidation`: User role validation configuration
  - `enabled`: Enable validation
  - `allowedRoles`: List of allowed role names
  - `allowUsersWithoutRoles`: Allow users without roles

**Example**:
```json
{
  "version": "1.0.0",
  "push": {
    "autoCreateMissingRecords": true,
    "validateBeforePush": true,
    "requireConfirmation": false,
    "alwaysPush": false
  },
  "directoryOrder": [
    "ai-configurations",
    "action-categories",
    "prompt-categories",
    "actions",
    "prompts",
    "agents",
    "organizations"
  ],
  "watch": {
    "debounceMs": 1000,
    "ignorePatterns": ["*.tmp", "*.bak", ".DS_Store"]
  },
  "sqlLogging": {
    "enabled": true,
    "outputDirectory": "./sql_logging",
    "filterPatterns": ["*spCreateAIPromptRun*"],
    "filterType": "exclude",
    "formatAsMigration": false
  }
}
```

### 2. Entity-Level .mj-sync.json (Entity Configuration)
**Location**: In directories containing entity records
**Contains**: Configuration specific to a single entity type

**Key Properties**:
- `entity`: Name of the entity this directory contains (e.g., "AI Prompts")
- `filePattern`: Glob pattern for finding data files (e.g., "*.json", ".*.json")
- `defaults`: Default field values applied to all records
- `ignoreDirectories`: Directories to ignore (cumulative with parent)
- `pull`: Pull-specific configuration
  - `filePattern`: Pattern for existing files to update
  - `createNewFileIfNotFound`: Create new files for new records
  - `newFileName`: Filename for new records
  - `appendRecordsToExistingFile`: Append new records to single file
  - `updateExistingRecords`: Update existing records
  - `preserveFields`: Fields to never overwrite
  - `mergeStrategy`: 'overwrite' | 'merge' | 'skip'
  - `backupBeforeUpdate`: Create backups before updating
  - `backupDirectory`: Backup directory name
  - `filter`: SQL WHERE clause for selective pulling
  - `externalizeFields`: Fields to save to separate files
  - `excludeFields`: Fields to exclude from pull
  - `lookupFields`: Foreign key fields to convert to @lookup references
  - `relatedEntities`: Configuration for pulling related entities
  - `ignoreNullFields`: Ignore null values during pull
  - `ignoreVirtualFields`: Ignore virtual fields during pull

**Example**:
```json
{
  "entity": "AI Prompts",
  "filePattern": "*.json",
  "defaults": {
    "CategoryID": "@lookup:AI Prompt Categories.Name=Examples?create&Description=Example category"
  },
  "ignoreDirectories": ["output", "templates"],
  "pull": {
    "filePattern": "*.json",
    "createNewFileIfNotFound": true,
    "newFileName": ".all-new.json",
    "appendRecordsToExistingFile": true,
    "updateExistingRecords": true,
    "preserveFields": ["Prompt", "Notes"],
    "mergeStrategy": "merge",
    "backupBeforeUpdate": true,
    "backupDirectory": ".backups",
    "filter": "CategoryID IN (SELECT ID FROM [__mj].vwAIPromptCategories WHERE Name = 'Examples')",
    "externalizeFields": [
      {
        "field": "Prompt",
        "pattern": "@file:{Name}.prompt.md"
      },
      {
        "field": "OutputExample",
        "pattern": "@file:output/{Name}.example.json"
      }
    ],
    "excludeFields": ["TemplateID", "InternalMetrics"],
    "lookupFields": {
      "CategoryID": {
        "entity": "AI Prompt Categories",
        "field": "Name"
      },
      "TypeID": {
        "entity": "AI Prompt Types",
        "field": "Name"
      }
    },
    "relatedEntities": {
      "MJ: AI Prompt Models": {
        "entity": "MJ: AI Prompt Models",
        "foreignKey": "PromptID",
        "filter": "Status = 'Active'",
        "lookupFields": {
          "ModelID": {
            "entity": "AI Models",
            "field": "Name"
          }
        }
      }
    }
  }
}
```

### 3. Optional .mj-folder.json (Folder-Level Defaults)
**Location**: In directories that need cascading defaults
**Contains**: Default values that apply to folder and subfolders

**Properties**:
- `defaults`: Field values to apply to all entities in this folder and subfolders

### 4. Entity JSON Files (Single Record)
**Format**: Single JSON object
**Contains**: A single entity record with its data and metadata

**Structure**:
```json
{
  "fields": {
    "Name": "Entity Name",
    "Description": "Description text",
    "TypeID": "@lookup:Types.Name=Chat",
    "TemplateText": "@file:template.md",
    "Status": "Active",
    "UserID": "GUID or @lookup reference"
  },
  "primaryKey": {
    "ID": "existing-guid-or-auto-generated"
  },
  "sync": {
    "lastModified": "2024-03-15T10:30:00.000Z",
    "checksum": "sha256-hash-of-field-values"
  },
  "relatedEntities": {
    "RelatedEntityName": [
      {
        "fields": {
          "ParentID": "@parent:ID",
          "Name": "Related record 1"
        },
        "primaryKey": {
          "ID": "guid"
        },
        "sync": {
          "lastModified": "2024-03-15T10:30:00.000Z",
          "checksum": "hash"
        }
      }
    ]
  }
}
```

### 5. Entity JSON Files (Multiple Records)
**Format**: Array of JSON objects
**Contains**: Multiple entity records in a single file

**Structure**:
```json
[
  {
    "fields": {
      "Name": "Record 1",
      "Description": "First record"
    },
    "primaryKey": {
      "ID": "guid-1"
    },
    "sync": {
      "lastModified": "2024-03-15T10:30:00.000Z",
      "checksum": "hash-1"
    }
  },
  {
    "fields": {
      "Name": "Record 2",
      "Description": "Second record"
    },
    "primaryKey": {
      "ID": "guid-2"
    },
    "sync": {
      "lastModified": "2024-03-15T10:31:00.000Z",
      "checksum": "hash-2"
    }
  }
]
```

### 6. Externalized Field Files
**Location**: Referenced by @file: keywords in entity JSON
**Format**: Text, Markdown, JSON, or other formats
**Usage**: Store large text fields separately for better readability in editors

**Example File Name Pattern**:
- `{Name}.prompt.md` - Prompt text
- `{Name}.example.json` - Output examples
- `templates/{Name}.template.md` - Template content
- `output/{Name}.example.json` - Example output

## Metadata Keywords System

All metadata keywords use @ prefix and enable dynamic value resolution.

### 1. @file: - External File Reference
**Purpose**: Load content from an external file
**Location**: Relative to the JSON metadata file
**Syntax**: `"@file:path/to/file.ext"`

**Examples**:
```json
{
  "Prompt": "@file:greeting.prompt.md",
  "TemplateText": "@file:./shared/common-prompt.md",
  "Content": "@file:../templates/standard-header.md"
}
```

### 2. @lookup: - Entity Lookup Reference
**Purpose**: Find an entity record and use its ID
**Syntax**: `"@lookup:EntityName.Field=Value[&Field2=Value2][?create][&DefaultField=Value]"`
**Features**:
- Single-field lookup: `@lookup:Types.Name=Chat`
- Multi-field lookup: `@lookup:Users.Email=test@example.com&Department=Sales`
- Auto-create: `@lookup:Categories.Name=New?create`
- With defaults: `@lookup:Categories.Name=New?create&Description=My description`

**Examples**:
```json
{
  "TypeID": "@lookup:AI Prompt Types.Name=Chat",
  "CategoryID": "@lookup:AI Prompt Categories.Name=Examples?create",
  "CategoryID": "@lookup:Categories.Name=Sales?create&Description=Sales prompts",
  "UserID": "@lookup:Users.Email=john@example.com"
}
```

### 3. @parent: - Parent Record Reference
**Purpose**: Reference a field from the immediate parent entity
**Valid Only**: In nested/related entities within relatedEntities
**Syntax**: `"@parent:FieldName"`

**Examples**:
```json
{
  "relatedEntities": {
    "MJ: AI Prompt Models": [
      {
        "fields": {
          "PromptID": "@parent:ID",
          "Name": "Model configuration"
        }
      }
    ]
  }
}
```

### 4. @root: - Root Record Reference
**Purpose**: Reference a field from the top-level entity (for deeply nested structures)
**Valid Only**: In nested/related entities
**Syntax**: `"@root:FieldName"`

### 5. @env: - Environment Variable Reference
**Purpose**: Get value from environment variable
**Syntax**: `"@env:VARIABLE_NAME"`

**Examples**:
```json
{
  "ApiKey": "@env:API_KEY",
  "Environment": "@env:NODE_ENV"
}
```

### 6. @url: - URL Content Reference
**Purpose**: Fetch content from a remote URL
**Syntax**: `"@url:https://example.com/path"`

**Examples**:
```json
{
  "Content": "@url:https://example.com/prompts/greeting.md",
  "Template": "@url:https://raw.githubusercontent.com/company/prompts/main/customer.md"
}
```

### 7. @template: - Template File Reference
**Purpose**: Load and merge JSON template file
**Syntax**: `"@template:path/to/template.json"` or as array for multiple templates
**Features**: Can be used in field values or as @template array for multiple merges

**Examples**:
```json
{
  "fields": {
    "@template": [
      "../templates/standard-prompt-settings.json",
      "../templates/customer-service-defaults.json"
    ],
    "Name": "Override template value"
  },
  "relatedEntities": {
    "MJ: AI Prompt Models": "@template:../templates/standard-ai-models.json"
  }
}
```

### 8. @include - Include Directive
**Purpose**: Merge content from external file into parent structure
**Used In**: Objects and arrays (not a field value)
**Syntax**: `{ "@include": "file.json" }` or `{ "@include.propertyName": {...} }`

## Field Structure Details

### fields Object
Contains all the actual entity field values. Field names must match entity definition exactly (case-sensitive).

**Common Field Patterns**:
```json
"fields": {
  "ID": "guid-or-empty",          // Auto-generated if not provided
  "Name": "Required field",        // Almost always required
  "Description": "Optional text",  // Often optional
  "UserID": "user-guid",           // Creator/owner reference
  "Status": "Active",              // May not exist on all entities
  "TypeID": "@lookup:...",         // Foreign key with lookup
  "CategoryID": "@lookup:...",     // Foreign key reference
  "IsActive": true,                // Boolean field
  "Priority": 1,                   // Numeric field
  "Notes": "Optional notes",       // Text field
  "CreatedDate": "2024-01-15T10:30:00Z",  // DateTime field
}
```

### primaryKey Object
Contains the entity's primary key field(s). Usually just ID.

**Structure**:
```json
"primaryKey": {
  "ID": "existing-guid-or-auto-generated"
}
```

**When to Include**:
- Include if updating existing record
- Omit if creating new record (will be auto-generated)
- Essential for dirty detection and change tracking

### sync Object
Metadata about the record's sync state. Used to detect changes and avoid unnecessary updates.

**Structure**:
```json
"sync": {
  "lastModified": "ISO8601-datetime",
  "checksum": "SHA256-hash-of-field-values"
}
```

**Fields**:
- `lastModified`: ISO 8601 timestamp of last database modification
- `checksum`: SHA256 hash used to detect if fields have changed

**Update Behavior**:
- Automatically updated during pull operations
- Used during push to detect dirty records
- Compared to calculate diff for updates

### relatedEntities Object
Contains nested array(s) of related entity records with foreign key relationships.

**Structure**:
```json
"relatedEntities": {
  "RelatedEntityName": [
    {
      "fields": {...},
      "primaryKey": {...},
      "sync": {...}
    }
  ]
}
```

**Key Features**:
- Each related entity is a complete record with fields/primaryKey/sync
- Uses `@parent:FieldName` to reference parent entity fields
- Supports recursive patterns for self-referencing entities
- Nested related entities supported for deep hierarchies

## filePattern Behavior

### Entity-Level filePattern
**Purpose**: Glob pattern for finding entity data files
**Location**: In entity .mj-sync.json under entity-level or pull.filePattern

**Common Patterns**:
- `"*.json"` - Matches any .json file (greeting.json, data-analysis.json)
- `".*.json"` - Matches dot-prefixed .json files (.all.json, .field-management-example.json)
- `"data-*.json"` - Matches files starting with "data-"
- `"*.prompt.md"` - Matches externalized prompt files

**Examples**:
```json
{
  "entity": "AI Prompts",
  "filePattern": "*.json",          // All .json files in this directory
  "pull": {
    "filePattern": "*.json"         // Override for pull operation
  }
}
```

**How It's Used**:
- Push operations: Find local files to upload to database
- Pull operations: Find existing files to update or append to
- Watch operations: Monitor matching files for changes

### Glob Pattern Syntax
- `*` matches any characters in a filename (not across directories)
- `**` matches any characters including directory separators
- `?` matches a single character
- `[abc]` matches character class
- `{a,b}` matches alternatives

**Examples**:
- `*.json` - Any file ending in .json
- `.*.json` - Dot-prefixed .json files
- `greeting*.json` - greeting.json, greeting-v2.json, etc.
- `data-analysis.json` - Exact filename
- `**/*.json` - Any .json in any subdirectory

## Entity Record Structure Variations

### Simple Single Record
Minimal entity with just required fields:
```json
{
  "fields": {
    "Name": "Simple Record",
    "UserID": "@lookup:Users.Email=admin@example.com"
  }
}
```

### Record with primaryKey (Existing Record)
When updating existing records:
```json
{
  "fields": {
    "Name": "Updated Name",
    "Status": "Active"
  },
  "primaryKey": {
    "ID": "12345678-1234-1234-1234-123456789012"
  }
}
```

### Record with Externalized Fields
Large text content stored in separate files:
```json
{
  "fields": {
    "Name": "Greeting Prompt",
    "TemplateText": "@file:greeting.prompt.md",
    "OutputExample": "@file:output/greeting.example.json"
  }
}
```

### Record with Template Merge
Using templates to reduce duplication:
```json
{
  "fields": {
    "@template": [
      "../templates/standard-prompt-settings.json",
      "../templates/customer-service-defaults.json"
    ],
    "Name": "Customer Service Bot",
    "Temperature": 0.9
  }
}
```

### Record with Related Entities
Parent record with nested child records:
```json
{
  "fields": {
    "Name": "Parent Record",
    "Type": "Category"
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

### Complex Record with Everything
Full structure with all components:
```json
{
  "fields": {
    "Name": "Complex Record",
    "Description": "Full featured record",
    "TypeID": "@lookup:Types.Name=Advanced",
    "TemplateText": "@file:complex.prompt.md",
    "UserID": "@lookup:Users.Email=owner@example.com",
    "Status": "Active"
  },
  "primaryKey": {
    "ID": "existing-guid"
  },
  "sync": {
    "lastModified": "2024-03-15T10:30:00.000Z",
    "checksum": "abc123..."
  },
  "relatedEntities": {
    "RelatedType": [
      {
        "fields": {
          "ParentID": "@parent:ID",
          "Name": "Nested record"
        }
      }
    ]
  }
}
```

## Real-World Examples

### Pull Configuration with Externalized Fields
From Skip Brain metadata/prompts:
```json
{
  "entity": "AI Prompts",
  "filePattern": "*.json",
  "pull": {
    "createNewFileIfNotFound": true,
    "newFileName": ".prompts.json",
    "appendRecordsToExistingFile": true,
    "updateExistingRecords": true,
    "preserveFields": ["TemplateText", "OutputExample"],
    "externalizeFields": [
      {
        "field": "TemplateText",
        "pattern": "@file:templates/{Name}.template.md"
      },
      {
        "field": "OutputExample",
        "pattern": "@file:output/{Name}.example.json"
      }
    ],
    "lookupFields": {
      "CategoryID": {
        "entity": "AI Prompt Categories",
        "field": "Name"
      },
      "TypeID": {
        "entity": "AI Prompt Types",
        "field": "Name"
      }
    },
    "relatedEntities": {
      "MJ: AI Prompt Models": {
        "entity": "MJ: AI Prompt Models",
        "foreignKey": "PromptID",
        "lookupFields": {
          "ModelID": {
            "entity": "AI Models",
            "field": "Name"
          }
        }
      }
    }
  }
}
```

### Entity Record with Nested Related Entities
```json
{
  "fields": {
    "Name": "Data Analysis Prompt",
    "Description": "Analyzes multiple data sources",
    "TypeID": "@lookup:AI Prompt Types.Name=Analysis",
    "CategoryID": "@lookup:AI Prompt Categories.Name=Data Analytics?create&Description=Data analysis prompts",
    "TemplateText": "@file:data-analysis.prompt.md",
    "Status": "Active"
  },
  "relatedEntities": {
    "MJ: AI Prompt Models": [
      {
        "fields": {
          "PromptID": "@parent:ID",
          "ModelID": "@lookup:AI Models.Name=GPT 4.1",
          "VendorID": "@lookup:MJ: AI Vendors.Name=OpenAI",
          "Priority": 1,
          "Status": "Active",
          "MaxTokens": 4096,
          "Temperature": 0.7
        }
      },
      {
        "fields": {
          "PromptID": "@parent:ID",
          "ModelID": "@lookup:AI Models.Name=Claude 4 Sonnet",
          "VendorID": "@lookup:MJ: AI Vendors.Name=Anthropic",
          "Priority": 2,
          "Status": "Active",
          "MaxTokens": 4000,
          "Temperature": 0.6
        }
      }
    ]
  }
}
```

### Array of Records in Single File
From Skip Brain organizations:
```json
[
  {
    "fields": {
      "Name": "Blue Cypress",
      "Description": "Blue Cypress",
      "WebsiteURL": "www.bluecypress.io"
    },
    "primaryKey": {
      "ID": "F8DF0AAF-2625-4AB6-8496-B4BEFF749F91"
    },
    "sync": {
      "lastModified": "2025-10-02T16:05:47.045Z",
      "checksum": "42fa689dfd0b38a48086a24393925ee917faedf9ea71bccdcc825a3cb48520cc"
    }
  },
  {
    "fields": {
      "Name": "Missouri State Teachers Association",
      "Description": "MSTA",
      "WebsiteURL": "msta.org"
    },
    "primaryKey": {
      "ID": "AEAD93D6-32A2-4C15-9B05-8E6C95FAB525"
    },
    "sync": {
      "lastModified": "2025-10-02T16:05:47.056Z",
      "checksum": "b05fe91df876504ec55d07f12340e63d3bb218596af1d940734ca1959a6597b1"
    }
  }
]
```

## Type Definitions Summary

### SyncConfig (Global)
- version: string
- filePattern?: string
- directoryOrder?: string[]
- ignoreDirectories?: string[]
- push?: { validateBeforePush?, requireConfirmation?, autoCreateMissingRecords?, alwaysPush? }
- sqlLogging?: { enabled?, outputDirectory?, formatAsMigration?, filterPatterns?, filterType? }
- watch?: { debounceMs?, ignorePatterns? }
- userRoleValidation?: { enabled?, allowedRoles?, allowUsersWithoutRoles? }

### EntityConfig (Entity-Level)
- entity: string
- filePattern?: string
- defaults?: Record<string, any>
- ignoreDirectories?: string[]
- pull?: { (see config.ts for full definition) }

### Entity Record Structure
- fields: Record<string, any> (Required)
- primaryKey?: { ID: string }
- sync?: { lastModified: string, checksum: string }
- relatedEntities?: Record<string, EntityRecord | EntityRecord[]>

## Key Patterns

### Cumulative Configuration
- ignoreDirectories values cascade down: child + parent patterns are both applied
- Later override earlier: entity-level config overrides root-level

### Default Field Injection
- defaults in .mj-sync.json are merged into every record
- Defaults can use metadata keywords like @lookup:
- User-provided values override defaults

### Sync Metadata Tracking
- lastModified: ISO 8601 timestamp
- checksum: Used for dirty detection
- Automatically populated during pull
- Compared during push to detect changes

### File Naming Conventions
- `.mj-sync.json` - Configuration files (dot-prefixed)
- Entity files follow filePattern: `*.json`, `.*.json`, etc.
- Externalized content follows pattern: `templates/{Name}.template.md`
- Backup directory: `.backups/` (dot-prefixed)

## Important Notes for VSCode Extension

1. **filePattern** is a glob pattern, NOT regex
   - Use `*.json` not `".*\.json"`
   - Use `.*.json` not `"\\..*\\.json"`

2. **Metadata keywords** all use @ prefix:
   - @file:, @lookup:, @parent:, @root:, @env:, @url:, @template:, @include

3. **Entity field names** are case-sensitive
   - Match exact entity definition names
   - Use IDE IntelliSense to discover

4. **primaryKey.ID** is the primary key
   - Auto-generated if omitted
   - Required for updates/dirty detection

5. **Nested relatedEntities** use @parent: references
   - @parent:ID references the parent entity's ID
   - Can reference any parent field

6. **Related entity configuration** controls:
   - How to find related records
   - Which fields to externalize
   - How to convert foreign keys to lookups
   - Support for recursive patterns
