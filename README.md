# MemberJunction for Visual Studio Code

Official VSCode extension for [MemberJunction](https://memberjunction.org) - the metadata-driven application development platform.

## Features

### ✨ Current Release

This extension provides comprehensive development tools for MemberJunction:

### 🎯 Phase 1: Metadata Sync & IntelliSense

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

### 🤖 Phase 2: CodeGen Detection & Automation

Automatic code generation workflow enhancements:

#### CodeGen Detection
- **Automatic detection** when CodeGen is needed
- **File watchers** monitor SQL migration changes
- **Smart notifications** alert you to pending changes
- **Background tracking** of schema modifications

#### One-Click Execution
- **Run CodeGen** directly from VSCode
- **Skip database** option for faster iterations
- **Auto-run mode** with configurable delays
- **Progress tracking** with detailed output

#### Change Preview
- **Diff preview** of generated file changes
- **File snapshots** before and after CodeGen
- **Generated files** list and navigation
- **Status tracking** for all CodeGen operations

### 🤖 Phase 3: AI Assistance

AI-powered development assistance using MemberJunction's multi-LLM system:

#### AI Chat Panel
- **Interactive chat interface** for MemberJunction questions
- **Entity-aware conversations** with automatic context
- **Code explanations** and best practices guidance
- **Persistent conversation history** within sessions
- **Beautiful UI** with syntax highlighting and markdown support
- **Multi-LLM Support**: Uses your configured AI provider (OpenAI, Claude, Anthropic, Gemini, Groq, Ollama, etc.)
- **Intelligent Fallback**: Works in placeholder mode when database isn't connected

#### Code Actions
- **"Ask AI to Explain This Code"** - Get detailed explanations of selected code
- **"Ask AI to Improve This Code"** - Receive suggestions for code quality improvements
- **"Ask AI to Fix This"** - Get help identifying and fixing bugs
- **"Ask AI Custom Question"** - Ask anything about selected code
- **Context menu integration** - Right-click on any code selection

#### Entity Explorer Integration
- **"Ask AI About Entity"** context menu on entities
- **Automatic entity context** - AI knows which entity you're working with
- **Field information** included in AI responses
- **Relationship awareness** - AI understands entity connections

#### Context-Aware Suggestions
- **Automatic context detection** from current file and selection
- **Entity metadata** automatically included in prompts
- **Conversation continuity** maintains context across messages
- **Smart suggestions** based on MemberJunction best practices

## Requirements

- VSCode 1.85.0 or higher
- Node.js 18+
- A MemberJunction workspace with:
  - `@memberjunction/core` installed
  - `@memberjunction/core-entities` installed
  - Optional: `packages/GeneratedEntities` for custom entities

### AI Assistance Requirements (Optional)

For full AI capabilities, you'll need:
- **Database Connection**: Connected MemberJunction database
- **AI Configuration**: Configured AI model credentials in `mj.config.cjs`
- **AI Prompts**: At least one AI Prompt defined in your database
- **Supported LLM Providers**: OpenAI, Anthropic (Claude), Google (Gemini), Groq, Mistral, Azure OpenAI, AWS Bedrock, Ollama (local), and more

**Note**: The AI Assistant works in fallback mode without these requirements, providing helpful MemberJunction information and examples.

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

#### Metadata & Entities
- `MemberJunction: Refresh Entity Explorer` - Reload entities from the file system
- `MemberJunction: Validate Metadata File` - Manually validate the current metadata file
- `MemberJunction: Show Entity Information` - Display detailed entity information
- `MemberJunction: Open Entity Definition` - Open an entity's TypeScript file

#### CodeGen
- `MemberJunction: Run CodeGen` - Execute code generation
- `MemberJunction: Run CodeGen (Skip Database)` - Faster CodeGen without DB checks
- `MemberJunction: Preview CodeGen Changes` - See what will be generated
- `MemberJunction: Show CodeGen Status` - View current CodeGen state

#### AI Assistance
- `MemberJunction: Open AI Assistant` - Open the AI chat panel
- `MemberJunction: Ask AI to Generate Code` - Describe code you want to create
- `MemberJunction: Clear AI Chat History` - Reset conversation
- **Code Actions (right-click on selected code):**
  - Ask AI to Explain This Code
  - Ask AI to Improve This Code
  - Ask AI to Fix This
  - Ask AI Custom Question

## Configuration

Configure the extension in VSCode Settings (Cmd+, / Ctrl+,):

```json
{
  // Feature toggles
  "memberjunction.features.metadataSync.enabled": true,
  "memberjunction.features.entityExplorer.enabled": true,
  "memberjunction.features.codegen.enabled": true,
  "memberjunction.features.aiAssistance.enabled": true,

  // Metadata sync settings
  "memberjunction.metadataSync.autoValidate": true,
  "memberjunction.metadataSync.showStatusBar": true,

  // CodeGen settings
  "memberjunction.codegen.autoDetect": true,
  "memberjunction.codegen.autoRun": false,
  "memberjunction.codegen.autoRunDelay": 5000,
  "memberjunction.codegen.autoRunSkipDb": false,

  // AI Assistance settings
  "memberjunction.aiAssistance.autoSuggest": true,
  "memberjunction.aiAssistance.preferredModel": "auto"
}
```

## Setting Up AI Assistance

### 1. Configure AI Models in MemberJunction

Add AI configuration to your `mj.config.cjs`:

```javascript
module.exports = {
  // ... other configuration
  ai: {
    credentials: [
      {
        name: 'OpenAI',
        type: 'OpenAI',
        apiKey: process.env.OPENAI_API_KEY
      },
      // Or use other providers:
      // { name: 'Claude', type: 'Anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
      // { name: 'Gemini', type: 'Google', apiKey: process.env.GOOGLE_API_KEY },
      // { name: 'Groq', type: 'Groq', apiKey: process.env.GROQ_API_KEY }
    ]
  }
};
```

### 2. Create AI Prompt in Database

The extension looks for an AI Prompt with "Code Assistant" or "VSCode" in the name. You can create one in your MemberJunction database:

```sql
-- Example: Create a simple AI Prompt
INSERT INTO [MJ: AI Prompts] (Name, Description, IsActive, Prompt)
VALUES (
  'MemberJunction Code Assistant',
  'AI assistant for MemberJunction development in VSCode',
  1,
  'You are an expert MemberJunction developer assistant...'
);
```

Or use the MemberJunction UI to create the prompt through the AI Prompts entity.

### 3. Connect to Database

Use the command palette:
- `MemberJunction: Connect to Database`

The extension will automatically:
1. Load your `mj.config.cjs` configuration
2. Connect to the database
3. Load available AI Prompts
4. Enable full AI integration

### 4. Choose Your LLM

The AI Assistant uses whatever LLM provider is configured in your MemberJunction setup. MemberJunction supports:

- **OpenAI**: GPT-4, GPT-4 Turbo, GPT-3.5
- **Anthropic**: Claude 3.5 Sonnet, Claude 3 Opus/Sonnet/Haiku
- **Google**: Gemini 1.5 Pro/Flash
- **Groq**: Fast Llama 3.x inference
- **Mistral**: Mistral Large/Medium/Small
- **Azure OpenAI**: Enterprise OpenAI models
- **AWS Bedrock**: Various models via AWS
- **Ollama**: Local models (Llama, Mistral, etc.)
- And more!

The extension respects your `preferredModel` setting when multiple models are available.

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

### ✅ Phase 1: Metadata Sync & IntelliSense (Complete)
- Entity Explorer with core and custom entities
- IntelliSense for metadata JSON files
- Real-time validation and diagnostics
- Status bar integration

### ✅ Phase 2: CodeGen Detection & Automation (Complete)
- Automatic CodeGen detection
- One-click CodeGen execution
- Diff preview of generated files
- Auto-run on SQL file changes

### ✅ Phase 3: AI Assistance (Complete)
- AI chat panel for entity questions
- Code actions ("Ask AI to...")
- Context-aware suggestions
- MemberJunction AI agent integration

### Phase 4: Testing & Database (Future)
- Test explorer integration
- Database migration management
- Test execution and results
- Query builder and data viewer

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
