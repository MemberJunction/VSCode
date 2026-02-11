import * as vscode from "vscode";
import { Feature } from "../../types";
import { EntityDiscovery } from "../../services/EntityDiscovery";
import { MetadataRootDiscovery } from "../../services/MetadataRootDiscovery";
import {
  ConnectionService,
  ConnectionStatus,
} from "../../services/ConnectionService";
import { MJSyncCompletionProvider } from "../../providers/MJSyncCompletionProvider";
import { MJSyncHoverProvider } from "../../providers/MJSyncHoverProvider";
import { MJSyncDiagnosticProvider } from "../../providers/MJSyncDiagnosticProvider";
import { MJSyncCodeActionProvider } from "../../providers/MJSyncCodeActionProvider";
import { MJSyncDefinitionProvider } from "../../providers/MJSyncDefinitionProvider";
import { OutputChannel } from "../../common/OutputChannel";
import { StatusBarManager } from "../../common/StatusBarManager";

/**
 * Metadata Sync feature - Phase 1
 * Provides IntelliSense, validation, and navigation for MetadataSync files
 * Uses dynamic providers based on actual entity definitions loaded from database
 */
export class MetadataSyncFeature implements Feature {
  name = "Metadata Sync";
  private diagnosticCollection: vscode.DiagnosticCollection;
  private diagnosticProvider: MJSyncDiagnosticProvider;
  private entityDiscovery: EntityDiscovery;
  private rootDiscovery: MetadataRootDiscovery;
  private connectionService: ConnectionService;
  private statusChangeDisposable: vscode.Disposable | undefined;

  constructor() {
    this.diagnosticCollection =
      vscode.languages.createDiagnosticCollection("memberjunction");
    this.diagnosticProvider = new MJSyncDiagnosticProvider(
      this.diagnosticCollection,
    );
    this.entityDiscovery = EntityDiscovery.getInstance();
    this.rootDiscovery = MetadataRootDiscovery.getInstance();
    this.connectionService = ConnectionService.getInstance();
  }

  enabled(): boolean {
    const config = vscode.workspace.getConfiguration("memberjunction");
    return config.get("features.metadataSync.enabled", true);
  }

  async activate(context: vscode.ExtensionContext): Promise<void> {
    OutputChannel.info("Activating Metadata Sync feature...");

    try {
      // Register status bar first (shows connecting status)
      this.registerStatusBar();

      // Listen for connection status changes
      this.statusChangeDisposable = this.connectionService.onStatusChange(
        (status) => this.updateStatusBar(status),
      );
      context.subscriptions.push(this.statusChangeDisposable);

      // Register commands (including connect/reconnect)
      this.registerCommands(context);

      // Attempt to connect and initialize entity discovery
      await this.initializeConnection();

      // Register file watchers
      this.registerFileWatchers(context);

      // Register completion provider for JSON files
      // Use just language selector (not pattern) to ensure we catch all JSON files
      const completionProvider = new MJSyncCompletionProvider();
      const completionDisposable =
        vscode.languages.registerCompletionItemProvider(
          { language: "json" },
          completionProvider,
          '"',
          ":",
          "@",
          ".",
          ",",
          "{",
          "\n", // Trigger characters - include comma and newline for field lists
        );
      context.subscriptions.push(completionDisposable);
      OutputChannel.info("Completion provider registered for JSON files");

      // Register hover provider
      const hoverProvider = new MJSyncHoverProvider();
      context.subscriptions.push(
        vscode.languages.registerHoverProvider(
          { language: "json", pattern: "**/*.json" },
          hoverProvider,
        ),
      );

      // Register code action provider (quick fixes)
      const codeActionProvider = new MJSyncCodeActionProvider();
      context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
          { language: "json", pattern: "**/*.json" },
          codeActionProvider,
          {
            providedCodeActionKinds:
              MJSyncCodeActionProvider.providedCodeActionKinds,
          },
        ),
      );
      OutputChannel.info("Code action provider registered for JSON files");

      // Register definition provider (go-to-definition)
      const definitionProvider = new MJSyncDefinitionProvider();
      context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
          { language: "json", pattern: "**/*.json" },
          definitionProvider,
        ),
      );
      OutputChannel.info("Definition provider registered for JSON files");

      // Register validation on save and on open
      if (
        vscode.workspace
          .getConfiguration("memberjunction")
          .get("metadataSync.autoValidate", true)
      ) {
        // Validate on save
        context.subscriptions.push(
          vscode.workspace.onDidSaveTextDocument((doc) => {
            if (this.isMetadataFile(doc)) {
              this.diagnosticProvider.validateDocument(doc);
            }
          }),
        );

        // Validate on open
        context.subscriptions.push(
          vscode.workspace.onDidOpenTextDocument((doc) => {
            if (this.isMetadataFile(doc)) {
              this.diagnosticProvider.validateDocument(doc);
            }
          }),
        );

        // Validate on change (debounced)
        let timeout: NodeJS.Timeout | undefined;
        context.subscriptions.push(
          vscode.workspace.onDidChangeTextDocument((event) => {
            if (this.isMetadataFile(event.document)) {
              if (timeout) {
                clearTimeout(timeout);
              }
              timeout = setTimeout(() => {
                this.diagnosticProvider.validateDocument(event.document);
              }, 500); // 500ms debounce
            }
          }),
        );

        // Validate on close
        context.subscriptions.push(
          vscode.workspace.onDidCloseTextDocument((doc) => {
            this.diagnosticProvider.clear(doc.uri);
          }),
        );
      }

      // Validate currently open metadata files
      this.validateOpenFiles();

      OutputChannel.info(
        "Metadata Sync feature activated successfully (using dynamic providers)",
      );
    } catch (error) {
      OutputChannel.error(
        "Failed to activate Metadata Sync feature",
        error as Error,
      );
      vscode.window.showErrorMessage(
        "Failed to activate MemberJunction Metadata Sync",
      );
    }
  }

  async deactivate(): Promise<void> {
    // Disconnect from database
    await this.connectionService.disconnect();

    // Clean up resources
    this.diagnosticCollection.dispose();
    this.rootDiscovery.clearCache();

    if (this.statusChangeDisposable) {
      this.statusChangeDisposable.dispose();
    }

    OutputChannel.info("Metadata Sync feature deactivated");
  }

  private registerStatusBar(): void {
    const config = vscode.workspace.getConfiguration("memberjunction");
    if (!config.get("metadataSync.showStatusBar", true)) {
      return;
    }

    StatusBarManager.register("metadata-sync", {
      alignment: vscode.StatusBarAlignment.Left,
      priority: 100,
    });

    // Initial status
    this.updateStatusBar(this.connectionService.status);
  }

  /**
   * Update status bar based on connection status
   */
  private updateStatusBar(status: ConnectionStatus): void {
    switch (status) {
      case "disconnected":
        StatusBarManager.updateWithMarkdown(
          "metadata-sync",
          "$(debug-disconnect) MJ: Disconnected",
          this.createDisconnectedTooltip(),
          "memberjunction.connect",
        );
        break;

      case "connecting":
        StatusBarManager.update(
          "metadata-sync",
          "$(sync~spin) MJ: Connecting...",
          "Connecting to MemberJunction database...",
          undefined,
        );
        break;

      case "connected":
        StatusBarManager.updateWithMarkdown(
          "metadata-sync",
          this.createConnectedStatusText(),
          this.createConnectedTooltip(),
          "memberjunction.refreshEntityExplorer",
        );
        break;

      case "error":
        // eslint-disable-next-line no-case-declarations
        const error = this.connectionService.error;
        StatusBarManager.updateWithColor(
          "metadata-sync",
          "$(error) MJ: Error",
          `${error?.message || "Connection failed"} - Click to retry`,
          "memberjunction.connect",
          new vscode.ThemeColor("statusBarItem.errorBackground"),
        );
        break;
    }
  }

  /**
   * Create status text showing entity count
   */
  private createConnectedStatusText(): string {
    const entityCount = this.entityDiscovery.getAllEntities().length;
    return `$(database) MJ: ${entityCount} entities`;
  }

  /**
   * Create rich tooltip for connected state
   */
  private createConnectedTooltip(): vscode.MarkdownString {
    const allEntities = this.entityDiscovery.getAllEntities();
    const coreEntities = this.entityDiscovery.getCoreEntities();
    const customEntities = this.entityDiscovery.getCustomEntities();

    const tooltip = new vscode.MarkdownString();
    tooltip.isTrusted = true;
    tooltip.supportHtml = true;

    tooltip.appendMarkdown("### $(database) MemberJunction Connected\n\n");
    tooltip.appendMarkdown(`**Total Entities:** ${allEntities.length}\n\n`);
    tooltip.appendMarkdown(`- Core Entities: ${coreEntities.length}\n`);
    tooltip.appendMarkdown(`- Custom Entities: ${customEntities.length}\n\n`);
    tooltip.appendMarkdown("---\n\n");
    tooltip.appendMarkdown(
      "$(refresh) [Refresh Entities](command:memberjunction.refreshEntityExplorer)\n\n",
    );
    tooltip.appendMarkdown(
      "$(list-tree) [Show Entity Explorer](command:memberjunction.focusEntityExplorer)\n\n",
    );
    tooltip.appendMarkdown(
      "$(debug-disconnect) [Disconnect](command:memberjunction.disconnect)",
    );

    return tooltip;
  }

  /**
   * Create rich tooltip for disconnected state
   */
  private createDisconnectedTooltip(): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString();
    tooltip.isTrusted = true;
    tooltip.supportHtml = true;

    tooltip.appendMarkdown(
      "### $(debug-disconnect) MemberJunction Disconnected\n\n",
    );
    tooltip.appendMarkdown("Not connected to a MemberJunction database.\n\n");
    tooltip.appendMarkdown(
      "IntelliSense features are limited until connected.\n\n",
    );
    tooltip.appendMarkdown("---\n\n");
    tooltip.appendMarkdown(
      "$(plug) [Connect to Database](command:memberjunction.connect)\n\n",
    );
    tooltip.appendMarkdown(
      "$(question) [Connection Help](command:memberjunction.showConnectionHelp)",
    );

    return tooltip;
  }

  /**
   * Initialize connection to MemberJunction database
   */
  private async initializeConnection(): Promise<void> {
    OutputChannel.info("Connecting to MemberJunction database...");

    const connected = await this.connectionService.connect();

    if (connected) {
      // Now initialize entity discovery with real metadata
      await this.entityDiscovery.initialize();
      OutputChannel.info("Entity discovery initialized with database metadata");

      // Update status bar with actual entity count (after entities are loaded)
      this.updateStatusBar("connected");
    } else {
      const error = this.connectionService.error;
      OutputChannel.warn(`Connection failed: ${error?.message}`);
      vscode.window
        .showWarningMessage(
          `MemberJunction: ${error?.message || "Could not connect to database"}. ` +
            "IntelliSense will be limited until connected.",
          "Retry",
          "Configure",
        )
        .then((selection: string | undefined) => {
          if (selection === "Retry") {
            vscode.commands.executeCommand("memberjunction.connect");
          } else if (selection === "Configure") {
            vscode.commands.executeCommand("memberjunction.showConnectionHelp");
          }
        });
    }
  }

  private registerFileWatchers(context: vscode.ExtensionContext): void {
    // Watch for changes to entity files
    const entityWatcher = vscode.workspace.createFileSystemWatcher(
      "**/packages/GeneratedEntities/src/**/*.ts",
    );

    entityWatcher.onDidChange(() => {
      OutputChannel.info("Entity files changed, refreshing...");
      this.entityDiscovery.refresh();
    });

    entityWatcher.onDidCreate(() => {
      OutputChannel.info("New entity file created, refreshing...");
      this.entityDiscovery.refresh();
    });

    entityWatcher.onDidDelete(() => {
      OutputChannel.info("Entity file deleted, refreshing...");
      this.entityDiscovery.refresh();
    });

    context.subscriptions.push(entityWatcher);

    // Watch for changes to .mj-sync.json files to invalidate cache
    const syncWatcher =
      vscode.workspace.createFileSystemWatcher("**/.mj-sync.json");

    syncWatcher.onDidChange((uri) => {
      OutputChannel.info(
        ".mj-sync.json changed, invalidating cache and re-validating",
      );
      this.onSyncConfigChanged(uri);
    });

    syncWatcher.onDidCreate((uri) => {
      OutputChannel.info(
        ".mj-sync.json created, invalidating cache and re-validating",
      );
      this.onSyncConfigChanged(uri);
    });

    syncWatcher.onDidDelete((uri) => {
      OutputChannel.info(
        ".mj-sync.json deleted, invalidating cache and re-validating",
      );
      this.onSyncConfigChanged(uri);
    });

    context.subscriptions.push(syncWatcher);
  }

  private registerCommands(context: vscode.ExtensionContext): void {
    // Validate metadata command
    context.subscriptions.push(
      vscode.commands.registerCommand("memberjunction.validateMetadata", () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && this.isMetadataFile(editor.document)) {
          this.diagnosticProvider.validateDocument(editor.document);
          vscode.window.showInformationMessage("Metadata validation complete");
        } else {
          vscode.window.showWarningMessage(
            "No metadata file is currently open",
          );
        }
      }),
    );

    // Connect command
    context.subscriptions.push(
      vscode.commands.registerCommand("memberjunction.connect", async () => {
        await this.initializeConnection();
      }),
    );

    // Reconnect command
    context.subscriptions.push(
      vscode.commands.registerCommand("memberjunction.reconnect", async () => {
        await this.connectionService.reconnect();
        if (this.connectionService.isConnected) {
          await this.entityDiscovery.refresh();
          vscode.window.showInformationMessage("Reconnected to MemberJunction");
        }
      }),
    );

    // Connection help command
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "memberjunction.showConnectionHelp",
        () => {
          const helpMessage = `
To connect to MemberJunction, create a mj.config.cjs file in your workspace root:

module.exports = {
    dbHost: 'localhost',
    dbDatabase: 'YourMJDatabase',
    dbUsername: 'sa',
    dbPassword: 'YourPassword',
    dbTrustServerCertificate: 'Y'
};

Or set environment variables: DB_HOST, DB_DATABASE, DB_USERNAME, DB_PASSWORD
                `.trim();

          vscode.window
            .showInformationMessage(
              "MemberJunction Connection Help",
              { modal: true, detail: helpMessage },
              "Open Documentation",
            )
            .then((selection: string | undefined) => {
              if (selection === "Open Documentation") {
                vscode.env.openExternal(
                  vscode.Uri.parse("https://docs.memberjunction.org"),
                );
              }
            });
        },
      ),
    );

    // Disconnect command
    context.subscriptions.push(
      vscode.commands.registerCommand("memberjunction.disconnect", async () => {
        await this.connectionService.disconnect();
        vscode.window.showInformationMessage(
          "Disconnected from MemberJunction",
        );
      }),
    );

    // Focus entity explorer command
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "memberjunction.focusEntityExplorer",
        () => {
          // Focus the entity explorer view directly
          vscode.commands.executeCommand("memberjunction.entityExplorer.focus");
        },
      ),
    );
  }

  private isMetadataFile(document: vscode.TextDocument): boolean {
    if (document.languageId !== "json") {
      return false;
    }

    const fsPath = document.uri.fsPath;

    // Check if it's a .mj-sync.json file
    if (fsPath.endsWith(".mj-sync.json")) {
      return true;
    }

    // Check if there's a .mj-sync.json in the same directory (indicates entity record file)
    // Use the rootDiscovery service to check for entity association
    const entityName = this.rootDiscovery.getEntityNameForFileSync(fsPath);
    if (entityName) {
      return true;
    }

    // Fallback: check if within a metadata directory pattern
    return fsPath.includes("/metadata/") || fsPath.includes("\\metadata\\"); // Windows support
  }

  private validateOpenFiles(): void {
    vscode.workspace.textDocuments.forEach((doc) => {
      if (this.isMetadataFile(doc)) {
        this.diagnosticProvider.validateDocument(doc);
      }
    });
  }

  onConfigChange(): void {
    // Handle configuration changes
    this.registerStatusBar();
  }

  /**
   * Handle .mj-sync.json file changes
   * Invalidates cache and re-validates affected documents
   */
  private onSyncConfigChanged(uri: vscode.Uri): void {
    // Get the directory containing the .mj-sync.json file
    const dirPath = uri.fsPath.replace(/[/\\]\.mj-sync\.json$/, "");

    // Invalidate the cache for this directory
    this.rootDiscovery.invalidateCache(dirPath);

    // Re-validate all open documents that might be affected
    // (documents in this directory or subdirectories)
    vscode.workspace.textDocuments.forEach((doc) => {
      if (doc.uri.fsPath.startsWith(dirPath) && this.isMetadataFile(doc)) {
        this.diagnosticProvider.validateDocument(doc);
      }
    });
  }
}
