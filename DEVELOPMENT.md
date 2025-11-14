# Development Guide

## Getting Started

### Prerequisites

- Node.js 18+ and npm 9+
- Visual Studio Code 1.85.0+
- TypeScript knowledge
- Familiarity with VSCode extension development

### Initial Setup

1. **Clone and Install**
   ```bash
   git clone https://github.com/MemberJunction/MJVSCode.git
   cd MJVSCode
   npm install
   ```

2. **Compile TypeScript**
   ```bash
   npm run compile
   ```

3. **Open in VSCode**
   ```bash
   code .
   ```

### Development Workflow

#### Running the Extension

1. Press `F5` or select "Run → Start Debugging"
2. A new VSCode window will open with the extension loaded (Extension Development Host)
3. Open a MemberJunction workspace in the new window
4. Test the extension features

#### Watch Mode

For continuous compilation during development:

```bash
npm run watch
```

This will automatically recompile TypeScript files when you save changes.

#### Testing in a Real MJ Workspace

1. Open a separate VSCode window
2. Open your MJ workspace (e.g., MJ_FRESH)
3. In the extension development window, use "Developer: Install Extension from Location..."
4. Select the MJVSCode directory

Alternatively, package and install the VSIX:

```bash
npm run package
code --install-extension memberjunction-vscode-0.1.0.vsix
```

### Project Structure

```
MJVSCode/
├── src/
│   ├── extension.ts              # Main entry point
│   ├── types/
│   │   └── index.ts              # Type definitions
│   ├── common/                   # Shared utilities
│   │   ├── OutputChannel.ts      # Logging
│   │   ├── StatusBarManager.ts   # Status bar management
│   │   └── ProgressReporter.ts   # Progress notifications
│   ├── services/                 # Core services
│   │   ├── EntityDiscovery.ts    # Entity loading from MJ
│   │   └── SchemaGenerator.ts    # JSON schema generation
│   ├── features/                 # Feature modules
│   │   └── metadata-sync/
│   │       └── MetadataSyncFeature.ts
│   └── views/                    # UI components
│       └── EntityExplorer.ts     # Entity tree view
├── schemas/                      # Generated JSON schemas
├── dist/                         # Compiled JavaScript
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript config
└── README.md                     # User documentation
```

### Key Concepts

#### Feature System

Each major feature is implemented as a `Feature` class:

```typescript
export interface Feature {
    name: string;
    enabled(): boolean;
    activate(context: vscode.ExtensionContext): Promise<void>;
    deactivate(): Promise<void>;
    onConfigChange?(config: MJConfig): void;
}
```

Features are registered in [src/extension.ts](src/extension.ts) and activated automatically when the extension loads.

#### Entity Discovery

The `EntityDiscovery` service loads entities from:
- `@memberjunction/core-entities` - Core MJ entities
- `packages/GeneratedEntities/src` - Custom user entities

Entities are cached in memory and refreshed when files change.

#### Schema Generation

The `SchemaGenerator` creates JSON schemas from entity definitions, providing:
- IntelliSense for entity names
- Field type validation
- Relationship suggestions

### Debugging

#### Extension Output

View extension logs:
1. Open Output panel (View → Output)
2. Select "MemberJunction" from the dropdown

#### Debug Console

The Debug Console shows detailed logs when running in debug mode (F5).

#### Breakpoints

1. Set breakpoints in TypeScript source files
2. Press F5 to start debugging
3. Breakpoints will hit when the code executes in the Extension Development Host

### Common Tasks

#### Adding a New Command

1. **Define in package.json**
   ```json
   {
     "contributes": {
       "commands": [{
         "command": "memberjunction.myCommand",
         "title": "MemberJunction: My Command"
       }]
     }
   }
   ```

2. **Register in code**
   ```typescript
   context.subscriptions.push(
     vscode.commands.registerCommand('memberjunction.myCommand', () => {
       // Command implementation
     })
   );
   ```

#### Adding a New Feature

1. Create a new class implementing `Feature` interface
2. Add to the features array in [src/extension.ts](src/extension.ts)
3. Add configuration settings in package.json

#### Adding a New View

1. Define view in package.json `contributes.views`
2. Create a `TreeDataProvider` implementation
3. Register with `vscode.window.createTreeView()`

### Testing

#### Manual Testing Checklist

- [ ] Extension activates in MJ workspace
- [ ] Entity Explorer shows core and custom entities
- [ ] Clicking entity opens TypeScript file
- [ ] Metadata JSON files show IntelliSense
- [ ] Hover over entity names shows tooltip
- [ ] Validation errors appear in Problems panel
- [ ] Status bar shows entity count
- [ ] Configuration changes take effect
- [ ] Extension deactivates cleanly

#### Automated Tests (Coming Soon)

```bash
npm test
```

### Packaging and Distribution

#### Create VSIX Package

```bash
npm run package
```

This creates `memberjunction-vscode-X.X.X.vsix` in the project root.

#### Install VSIX Locally

```bash
code --install-extension memberjunction-vscode-0.1.0.vsix
```

#### Publish to Marketplace (Coming Soon)

```bash
npm run publish
```

Requires:
- VSCode marketplace publisher account
- Personal Access Token (PAT)
- Updated version in package.json

### Code Style

- **Indentation**: 4 spaces
- **Quotes**: Single quotes for strings
- **Semicolons**: Yes
- **Naming**:
  - Classes: PascalCase
  - Functions/variables: camelCase
  - Constants: UPPER_SNAKE_CASE
- **Async**: Use async/await over promises

### Linting

```bash
npm run lint
```

### Performance Considerations

1. **Lazy Loading**: Features only activate when needed
2. **Caching**: Entities are cached after first load
3. **Debouncing**: File watchers use debouncing to avoid excessive updates
4. **Async Operations**: All I/O operations are asynchronous

### Troubleshooting Development Issues

#### Extension not loading in debug mode

- Check the Debug Console for errors
- Verify TypeScript compiled successfully (`npm run compile`)
- Check that package.json `main` field points to correct file

#### Changes not reflected

- Restart the Extension Development Host (Cmd+R / Ctrl+R in the host window)
- Or stop debugging (Shift+F5) and start again (F5)

#### IntelliSense not working

- Check that JSON schemas are generated in `schemas/` directory
- Verify `contributes.jsonValidation` in package.json
- Check file path patterns match your test files

#### Can't find MemberJunction packages

- Run `npm install` to ensure dependencies are present
- Check that you're testing in a proper MJ workspace
- Verify `@memberjunction/core` is in the workspace's node_modules

### Next Steps

#### Phase 2: Code Generation

- Implement `CodeGenFeature`
- Detect SQL file changes
- Show CodeGen status in status bar
- Add command to run CodeGen

#### Phase 3: AI Assistance

- Create AI chat webview panel
- Integrate with MJ AI providers
- Add code actions for AI suggestions

#### Phase 4: Testing & Database

- Implement Test Explorer integration
- Add migration management features

### Resources

- [VSCode Extension API](https://code.visualstudio.com/api)
- [VSCode Extension Samples](https://github.com/microsoft/vscode-extension-samples)
- [MemberJunction Docs](https://docs.memberjunction.org)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/MemberJunction/MJVSCode/issues)
- **MJ Discord**: [Join Discord](https://discord.gg/memberjunction)
- **MJ Docs**: [Documentation](https://docs.memberjunction.org)

---

Happy coding! 🚀
