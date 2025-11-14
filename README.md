# MemberJunction for Visual Studio Code

Official VSCode extension for [MemberJunction](https://memberjunction.org) - the metadata-driven application development platform.

## Features

### 🎯 Phase 1: Metadata Sync & IntelliSense

This initial release focuses on enhancing the developer experience when working with MemberJunction entities and metadata:

#### Entity Explorer
- **Browse all entities** in your MemberJunction workspace
- View **core entities** (from `@memberjunction/core-entities`) and **custom entities** (from `packages/GeneratedEntities`)
- Click to open entity TypeScript files
- View detailed entity information including fields, types, and relationships

#### Metadata IntelliSense
- **Auto-completion** for entity names in metadata JSON files
- **Hover tooltips** showing entity details when you hover over entity names
- **Real-time validation** of metadata files
- **JSON Schema** support for metadata files with field suggestions

#### Smart Validation
- Validates entity references in metadata files
- Checks for required fields and proper structure
- Warns about unknown entities or related entities
- Displays errors and warnings in the Problems panel

#### Status Bar Integration
- Shows total number of entities loaded
- Quick access to refresh entities
- Visual indicator of extension status

## Requirements

- VSCode 1.85.0 or higher
- Node.js 18+
- A MemberJunction workspace with:
  - `@memberjunction/core` installed
  - `@memberjunction/core-entities` installed
  - Optional: `packages/GeneratedEntities` for custom entities

## Installation

### From VSIX (Development)
1. Download the `.vsix` file
2. Open VSCode
3. Go to Extensions view (Cmd+Shift+X / Ctrl+Shift+X)
4. Click the "..." menu → "Install from VSIX..."
5. Select the downloaded `.vsix` file

### From Marketplace (Coming Soon)
Search for "MemberJunction" in the VSCode Extensions marketplace.

## Usage

### Entity Explorer

1. Open a MemberJunction workspace
2. Look for the "MemberJunction Entities" view in the Explorer sidebar
3. Browse through Core and Custom entities
4. Click on any entity to open its TypeScript definition
5. Right-click for additional options

### Metadata IntelliSense

1. Open any JSON file in your `metadata/` directory
2. Start typing entity names - you'll see auto-completion suggestions
3. Hover over entity names to see detailed information
4. The extension will validate your metadata in real-time
5. Check the Problems panel for any validation errors

### Commands

Access these commands from the Command Palette (Cmd+Shift+P / Ctrl+Shift+P):

- `MemberJunction: Refresh Entity Explorer` - Reload entities from the file system
- `MemberJunction: Validate Metadata File` - Manually validate the current metadata file
- `MemberJunction: Show Entity Information` - Display detailed entity information
- `MemberJunction: Open Entity Definition` - Open an entity's TypeScript file

## Configuration

Configure the extension in VSCode Settings (Cmd+, / Ctrl+,):

```json
{
  // Enable/disable features
  "memberjunction.features.metadataSync.enabled": true,
  "memberjunction.entityExplorer.enabled": true,

  // Metadata sync settings
  "memberjunction.metadataSync.autoValidate": true,
  "memberjunction.metadataSync.showStatusBar": true
}
```

## Workspace Structure

The extension expects a standard MemberJunction workspace structure:

```
your-workspace/
├── packages/
│   └── GeneratedEntities/
│       └── src/
│           ├── *Entity.ts       # Custom entity classes
│           └── ...
├── metadata/                     # Optional metadata directory
│   └── *.json                   # Entity metadata files
├── mj.config.cjs                # MemberJunction configuration
└── package.json
```

## Troubleshooting

### Extension not activating

Make sure you have a valid MemberJunction workspace with:
- `@memberjunction/core` package installed
- Either `mj.config.js` or `mj.config.cjs` present
- Or a `packages/GeneratedEntities` directory

### Entities not showing

1. Check that `@memberjunction/core-entities` is installed
2. Run `npm install` to ensure all dependencies are present
3. Use "MemberJunction: Refresh Entity Explorer" command
4. Check the Output panel (View → Output → MemberJunction) for errors

### IntelliSense not working

1. Ensure your file is in a `metadata/` directory
2. The file must have a `.json` extension
3. Check that JSON language mode is active (bottom right of editor)
4. Try reloading the VSCode window (Developer: Reload Window)

### View Output Logs

1. Open Output panel: View → Output
2. Select "MemberJunction" from the dropdown
3. Review logs for any errors or warnings

## Roadmap

### Phase 2: Code Generation (Coming Soon)
- Detect when CodeGen is needed
- One-click CodeGen execution
- Diff preview of generated files
- Auto-run on SQL file changes

### Phase 3: AI Assistance (Future)
- AI chat panel for entity questions
- Code actions ("Ask AI to...")
- Context-aware suggestions
- Agent integration

### Phase 4: Testing & Database (Future)
- Test explorer integration
- Database migration management
- Test execution and results

## Contributing

This extension is part of the MemberJunction open-source project.

- Report issues: [GitHub Issues](https://github.com/MemberJunction/MJVSCode/issues)
- Documentation: [MemberJunction Docs](https://docs.memberjunction.org)
- Main repository: [MemberJunction/MJ](https://github.com/MemberJunction/MJ)

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Links

- [MemberJunction Website](https://memberjunction.org)
- [Documentation](https://docs.memberjunction.org)
- [GitHub](https://github.com/MemberJunction/MJ)
- [Discord Community](https://discord.gg/memberjunction)

---

**Built with ❤️ by the MemberJunction team**
