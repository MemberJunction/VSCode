# MetadataSync Documentation Index

Complete analysis of the MemberJunction MetadataSync system file structure and schema for VSCode extension implementation.

## Documents Created

### 1. MetadataSync-Summary.md (Executive Overview)
**Start here** - High-level overview of the entire system
- What MetadataSync does
- Complete file structure overview
- Core concepts and metadata keywords
- Key properties with examples
- Common patterns
- Critical implementation details
- Use cases for VSCode extension

**Best for**: Understanding the big picture, quick reference

**File**: `/Users/amith/Dropbox/develop/Mac/MJVSCode/METADATASYNC-SUMMARY.md`

### 2. MetadataSync-Structure-Analysis.md (Detailed Reference)
**Comprehensive documentation** - In-depth technical details
- Directory structure visualization
- All 6 file types explained:
  - Root-level .mj-sync.json (global config)
  - Entity-level .mj-sync.json (entity config)
  - .mj-folder.json (folder defaults)
  - Single entity records
  - Array of entity records
  - Externalized field files
- 8 metadata keywords detailed:
  - @file:, @lookup:, @parent:, @root:, @env:, @url:, @template:, @include
- Field structure details (fields, primaryKey, sync, relatedEntities)
- filePattern behavior and glob syntax
- 6 entity record structure variations
- Real-world examples
- Type definitions summary
- Key patterns and conventions

**Best for**: Deep understanding, implementation reference, schema design

**File**: `/Users/amith/Dropbox/develop/Mac/MJVSCode/MetadataSync-Structure-Analysis.md`

### 3. METADATASYNC-FILE-REFERENCE.md (Source Locations & Quick Ref)
**Practical guide** - Where to find files and quick lookup tables
- Key source files locations:
  - config.ts (type definitions)
  - metadata-keywords.ts (keyword constants)
  - validation.ts (validation types)
  - config-manager.ts (configuration management)
- Example file locations (demo, Skip_Brain)
- Configuration schema quick reference
- Metadata keywords reference table
- Key configuration properties explained
- Common usage patterns
- File locations summary
- How to use for VSCode extension
- Important notes and gotchas

**Best for**: Finding specific files, quick property lookup, implementation guide

**File**: `/Users/amith/Dropbox/develop/Mac/MJVSCode/METADATASYNC-FILE-REFERENCE.md`

## Quick Navigation

### By Task

**Understanding the System**
1. Read: METADATASYNC-SUMMARY.md
2. Reference: MetadataSync-Structure-Analysis.md

**Implementing IntelliSense**
1. Reference: METADATASYNC-FILE-REFERENCE.md
2. Deep dive: MetadataSync-Structure-Analysis.md
3. Source files: Locations in METADATASYNC-FILE-REFERENCE.md

**Creating JSON Schemas**
1. Quick ref: METADATASYNC-SUMMARY.md (Record Structure section)
2. Details: MetadataSync-Structure-Analysis.md (Field Structure Details section)
3. Full types: METADATASYNC-FILE-REFERENCE.md (Configuration Schema section)

**Validating Metadata Keywords**
1. Overview: METADATASYNC-SUMMARY.md (Core Concepts section)
2. Details: MetadataSync-Structure-Analysis.md (Metadata Keywords System section)
3. Quick table: METADATASYNC-FILE-REFERENCE.md (Metadata Keywords Reference)

**Understanding filePattern**
1. Quick explanation: METADATASYNC-SUMMARY.md (filePattern section)
2. Detailed rules: MetadataSync-Structure-Analysis.md (filePattern Behavior section)
3. Examples: Both documents

### By Document Type

**Configuration Files (.mj-sync.json)**
- Root-level: MetadataSync-Structure-Analysis.md (section 1)
- Entity-level: MetadataSync-Structure-Analysis.md (section 2)
- Schema: METADATASYNC-FILE-REFERENCE.md

**Entity Records (Data Files)**
- Single record: MetadataSync-Structure-Analysis.md (section 4)
- Array format: MetadataSync-Structure-Analysis.md (section 5)
- Structure: METADATASYNC-SUMMARY.md (Record Structure section)
- Variations: MetadataSync-Structure-Analysis.md (variations section)

**Externalized Files**
- Overview: METADATASYNC-SUMMARY.md
- Detailed: MetadataSync-Structure-Analysis.md (section 6)
- With examples: MetadataSync-Structure-Analysis.md (Real-World Examples section)

**Metadata Keywords**
- All 8 keywords: MetadataSync-Structure-Analysis.md (Metadata Keywords System)
- Quick table: METADATASYNC-FILE-REFERENCE.md
- Examples: METADATASYNC-SUMMARY.md

## Key Concepts Across Documents

### Metadata Keywords

All keywords support dynamic value resolution:

| Keyword | Summary | Full Details |
|---------|---------|--------------|
| @file: | External file content | MetadataSync-Structure-Analysis.md |
| @lookup: | Entity record lookup | MetadataSync-Structure-Analysis.md |
| @parent: | Parent entity reference | MetadataSync-Structure-Analysis.md |
| @root: | Root entity reference | MetadataSync-Structure-Analysis.md |
| @env: | Environment variable | MetadataSync-Structure-Analysis.md |
| @url: | Remote URL fetch | MetadataSync-Structure-Analysis.md |
| @template: | JSON template merge | MetadataSync-Structure-Analysis.md |
| @include | File merge directive | MetadataSync-Structure-Analysis.md |

### Record Structure

Standard format across all entity records:

```json
{
  "fields": {},           // Required - entity field values
  "primaryKey": {},       // Optional - auto-generated if omitted
  "sync": {},             // Optional - metadata for change tracking
  "relatedEntities": {}   // Optional - nested child records
}
```

See each document for different aspects:
- Overview: METADATASYNC-SUMMARY.md
- Complete structure: MetadataSync-Structure-Analysis.md
- Variations: MetadataSync-Structure-Analysis.md

### Configuration Inheritance

Cascade pattern:
1. Root .mj-sync.json (global defaults)
2. Entity .mj-sync.json (overrides)
3. .mj-folder.json (cascading folder defaults)

Details in: MetadataSync-Structure-Analysis.md (Key Patterns section)

### File Patterns (Glob)

Important: **NOT regex**, use glob syntax

Valid: `*.json`, `.*.json`, `greeting*.json`
Invalid: `.*\.json`, `\..*\.json`

Reference: METADATASYNC-FILE-REFERENCE.md, METADATASYNC-SUMMARY.md

## Implementation Checklist

For VSCode extension, support:

Core Features:
- [ ] Recognize .mj-sync.json files (root and entity level)
- [ ] Validate global SyncConfig schema
- [ ] Validate EntityConfig schema
- [ ] IntelliSense for configuration properties

Entity Files:
- [ ] Recognize entity JSON files matching filePattern
- [ ] Validate entity record structure (fields/primaryKey/sync)
- [ ] Support both single record and array formats
- [ ] Handle relatedEntities nesting

Metadata Keywords:
- [ ] Complete @file:, @lookup:, @parent:, @root:, @env:, @url:, @template:, @include
- [ ] Provide syntax help for each keyword type
- [ ] Validate keyword usage context

Advanced Features:
- [ ] filePattern glob validation
- [ ] externalizeFields pattern validation with placeholders
- [ ] lookupFields entity reference validation
- [ ] @lookup: multi-field syntax support
- [ ] @template: array and merge support
- [ ] Cross-file reference checking

## Source File Locations

All absolute paths:

Type Definitions:
- `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/src/config.ts`

Keyword Constants:
- `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/src/constants/metadata-keywords.ts`

Validation:
- `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/src/types/validation.ts`

Examples:
- `/Users/amith/Dropbox/develop/Mac/MJ/packages/MetadataSync/demo/`
- `/Users/amith/Dropbox/develop/Mac/Skip_Brain/metadata/`

## Critical Implementation Notes

1. **filePattern is glob, NOT regex**
   - Use glob library or minimatch
   - Don't use regex escaping

2. **Metadata keywords use @ prefix consistently**
   - All 8 keywords: @file:, @lookup:, @parent:, @root:, @env:, @url:, @template:, @include
   - Recognize @ + keyword pattern

3. **primaryKey.ID is optional**
   - Auto-generated if omitted
   - Required for dirty detection

4. **sync object is metadata only**
   - lastModified: ISO 8601
   - checksum: SHA256 hash
   - Auto-populated during pull

5. **Field names are case-sensitive**
   - Must match entity definition exactly
   - No fuzzy matching

6. **@parent: only in relatedEntities**
   - Context validation needed
   - Cannot use at top level

7. **Configuration inheritance is cumulative**
   - ignoreDirectories values add together
   - Later settings override earlier

## Examples in Each Document

METADATASYNC-SUMMARY.md:
- 3+ configuration examples
- Record structure with all parts
- Common patterns (create, update, related)

MetadataSync-Structure-Analysis.md:
- Root config example
- Entity config example with full pull
- 6 record structure variations
- 3 real-world complex examples
- Detailed keyword examples

METADATASYNC-FILE-REFERENCE.md:
- Schema quick references
- Metadata keyword table
- Configuration property explanations
- File location table

## Document Statistics

| Document | Size | Lines | Content |
|----------|------|-------|---------|
| METADATASYNC-SUMMARY.md | 8.7K | 227 | Executive overview, patterns |
| MetadataSync-Structure-Analysis.md | 23K | 832 | Complete technical details |
| METADATASYNC-FILE-REFERENCE.md | 8.7K | 227 | Quick reference, locations |
| **Total** | **40K** | **1,286** | **Comprehensive documentation** |

## How to Use These Documents

1. **First time?** Start with METADATASYNC-SUMMARY.md
2. **Need details?** Go to MetadataSync-Structure-Analysis.md
3. **Looking for something?** Check METADATASYNC-FILE-REFERENCE.md
4. **Need to find source files?** METADATASYNC-FILE-REFERENCE.md
5. **Implementing feature?** Use all three documents as reference

## Related Files in Your Project

- `/Users/amith/Dropbox/develop/Mac/MJVSCode/vscode-extension-strategy.md` - Extension architecture
- `/Users/amith/Dropbox/develop/Mac/CLAUDE.md` - Project context (MJ & Skip_Brain)

All documents are in: `/Users/amith/Dropbox/develop/Mac/MJVSCode/`
