# Quick Start Guide

## Installation & First Run

### 1. Install Dependencies

```bash
cd /Users/amith/Dropbox/develop/Mac/MJVSCode
npm install
```

### 2. Compile the Extension

```bash
npm run compile
```

### 3. Run in Debug Mode

1. Open the MJVSCode folder in VSCode
2. Press **F5** to start debugging
3. A new "Extension Development Host" window will open
4. In that window, open your MJ workspace (e.g., MJ_FRESH)
5. The extension should activate automatically

### 4. Test the Features

#### Entity Explorer
- Look in the Explorer sidebar for "MemberJunction Entities"
- Expand "Core Entities" and "Custom Entities"
- Click on any entity to view its TypeScript definition

#### IntelliSense
1. Create or open a JSON file in a `metadata/` directory
2. Start typing entity-related properties
3. You should see auto-completion suggestions
4. Hover over entity names to see tooltips

#### Status Bar
- Look at the bottom-left status bar
- You should see: `$(database) MJ: X entities`
- Click it to refresh the entity explorer

#### Validation
1. Open a metadata JSON file
2. Try adding an invalid entity name
3. Check the Problems panel (View → Problems) for warnings

## What Was Built

### Project Structure

```
MJVSCode/
├── src/
│   ├── extension.ts                    # Main entry point & feature registration
│   ├── types/index.ts                  # TypeScript type definitions
│   ├── common/                         # Shared infrastructure
│   │   ├── OutputChannel.ts            # Logging system
│   │   ├── StatusBarManager.ts         # Status bar management
│   │   └── ProgressReporter.ts         # Progress notifications
│   ├── services/                       # Core services
│   │   ├── EntityDiscovery.ts          # Loads entities from MJ packages
│   │   └── SchemaGenerator.ts          # Generates JSON schemas
│   ├── features/                       # Feature modules
│   │   └── metadata-sync/
│   │       └── MetadataSyncFeature.ts  # Phase 1 metadata features
│   └── views/                          # UI components
│       └── EntityExplorer.ts           # Entity tree view
├── schemas/                            # Generated JSON schemas (created at runtime)
├── dist/                               # Compiled output (after npm run compile)
├── .vscode/                            # VSCode debug configuration
├── package.json                        # Extension manifest
├── tsconfig.json                       # TypeScript configuration
├── README.md                           # User documentation
├── DEVELOPMENT.md                      # Developer guide
└── CHANGELOG.md                        # Version history
```

### Phase 1 Features Implemented ✅

1. **Feature Registration System**
   - Extensible architecture for adding new features
   - Clean separation of concerns
   - Shared infrastructure

2. **Entity Discovery Service**
   - Discovers core entities from `@memberjunction/core-entities`
   - Discovers custom entities from `packages/GeneratedEntities`
   - Caches entities for performance
   - File watcher for automatic updates

3. **JSON Schema Generation**
   - Generates schemas from entity definitions
   - Provides IntelliSense for metadata files
   - Field type mapping and validation
   - Related entity suggestions

4. **Entity Explorer View**
   - Tree view in sidebar
   - Categorized by Core/Custom
   - Click to open entity files
   - Right-click for actions
   - Entity info webview panel

5. **Metadata Sync Feature**
   - Real-time validation
   - Hover tooltips for entities
   - Auto-completion in JSON files
   - Problems panel integration
   - Status bar indicator
   - File watching and auto-refresh

6. **Shared Infrastructure**
   - OutputChannel for logging
   - StatusBarManager for UI
   - ProgressReporter for long operations
   - Consistent error handling

## Key Design Decisions

### 1. No CLI Integration (Phase 1)
- **Why**: Phase 1 focuses on local entity definitions only
- **Benefit**: Simpler, faster, no database dependencies
- **Data Source**: File system + installed MJ packages
- **Future**: CLI integration comes in Phase 2+

### 2. Using MJ Metadata Directly
- **How**: Import `@memberjunction/core` and use `Metadata` class
- **Benefit**: Always in sync with installed MJ version
- **Performance**: Entities cached after first load
- **Refresh**: File watchers detect changes automatically

### 3. Feature Pattern
- **Architecture**: Each major feature is a separate class
- **Registration**: Features register themselves in `extension.ts`
- **Configuration**: Each feature can be enabled/disabled
- **Lifecycle**: Proper activate/deactivate handlers

### 4. Separate Repository
- **Why**: Independent versioning from main MJ repo
- **Benefit**: Can release extension updates independently
- **Version**: Starts at 0.1.0 (Phase 1)
- **Publishing**: Can publish to VSCode marketplace separately

## Next Steps

### Immediate (Before Testing in Real Workspace)

1. **Install dependencies in your MJ workspace**
   ```bash
   cd /path/to/MJ_FRESH
   npm install
   ```

2. **Make sure MJ packages are built**
   ```bash
   cd /path/to/MJ_FRESH
   npm run build
   ```

3. **Test in the Extension Development Host**
   - Open MJVSCode in one VSCode window
   - Press F5 to open Extension Development Host
   - In the new window, open your MJ workspace
   - Test all features

### Phase 2 Planning

When Phase 1 is stable, we can add:

1. **CodeGen Integration**
   - Detect when SQL files change
   - Show "Run CodeGen" notification
   - Execute CodeGen from VSCode
   - Show diff preview

2. **Configuration Loading**
   - Read `mj.config.cjs`
   - Database connection info
   - Path configuration

3. **Metadata Sync Commands**
   - Pull from database
   - Push to database
   - Validate before push

## Troubleshooting

### Extension doesn't activate

**Check:**
- Output panel (View → Output → MemberJunction) for errors
- Console in Extension Development Host (Help → Toggle Developer Tools)
- Make sure you opened a workspace with `@memberjunction/core` installed

### Entities not showing

**Solutions:**
1. Check if `@memberjunction/core-entities` is installed
2. Run `npm install` in your MJ workspace
3. Click the refresh button in Entity Explorer
4. Check Output panel for initialization errors

### IntelliSense not working

**Solutions:**
1. Make sure file is in a `metadata/` directory
2. File must have `.json` extension
3. Check if schemas were generated (look in MJVSCode/schemas/)
4. Try reloading VSCode window (Cmd+R / Ctrl+R)

### TypeScript errors

**Solutions:**
```bash
npm run compile
```

Check for compilation errors in the output.

## Development Workflow

### Making Changes

1. Edit TypeScript files in `src/`
2. Run `npm run compile` or `npm run watch`
3. Reload Extension Development Host (Cmd+R / Ctrl+R)
4. Test your changes

### Adding a New Feature

1. Create new class implementing `Feature` interface
2. Add to `features` array in `src/extension.ts`
3. Add configuration in `package.json`
4. Test and debug

### Debugging Tips

- Set breakpoints in `.ts` files (not compiled `.js`)
- Use `OutputChannel.info()` for logging
- Check Debug Console for detailed logs
- Use "Developer: Reload Window" to restart extension

## Questions?

- Review [DEVELOPMENT.md](DEVELOPMENT.md) for detailed development guide
- Check [README.md](README.md) for user-facing documentation
- Look at [vscode-extension-strategy.md](vscode-extension-strategy.md) for the full plan

---

**Ready to go! Press F5 and start testing!** 🚀
