import * as vscode from 'vscode';
import { Feature, MJConfig } from '../../types';
import { AIService } from '../../services/AIService';
import { AIChatPanelProvider } from '../../providers/AIChatPanelProvider';
import { AICodeActionProvider } from '../../providers/AICodeActionProvider';
import { StatusBarManager } from '../../common/StatusBarManager';
import { OutputChannel } from '../../common/OutputChannel';
import { ConnectionService } from '../../services/ConnectionService';

/**
 * Phase 3: AI Assistance Feature
 *
 * Provides:
 * - AI chat panel for entity questions
 * - Code actions ("Ask AI to...")
 * - Context-aware suggestions
 * - Integration with MemberJunction AI agents
 */
export class AIAssistanceFeature implements Feature {
    name = 'ai-assistance';

    private aiService: AIService;
    private connectionService: ConnectionService;
    private chatPanelProvider: AIChatPanelProvider | undefined;
    private codeActionProvider: AICodeActionProvider | undefined;
    private disposables: vscode.Disposable[] = [];
    private statusBarItem: vscode.StatusBarItem | undefined;
    private connectionStatusDisposable: vscode.Disposable | undefined;

    constructor() {
        this.aiService = AIService.getInstance();
        this.connectionService = ConnectionService.getInstance();
    }

    enabled(): boolean {
        const config = vscode.workspace.getConfiguration('memberjunction');
        return config.get<boolean>('features.aiAssistance.enabled', true);
    }

    async activate(context: vscode.ExtensionContext): Promise<void> {
        if (!this.enabled()) {
            OutputChannel.info('AI Assistance feature is disabled');
            return;
        }

        OutputChannel.info('Activating AI Assistance feature...');

        try {
            // Initialize AI Service
            const initialized = await this.aiService.initialize();

            if (!initialized) {
                vscode.window.showWarningMessage(
                    'AI Assistance feature could not be fully initialized. Some features may be limited.',
                    'View Output'
                ).then(selection => {
                    if (selection === 'View Output') {
                        OutputChannel.show();
                    }
                });
            }

            // Register chat panel provider
            this.chatPanelProvider = new AIChatPanelProvider(
                context.extensionUri,
                this.aiService
            );
            context.subscriptions.push(
                vscode.window.registerWebviewViewProvider(
                    AIChatPanelProvider.viewType,
                    this.chatPanelProvider
                )
            );

            // Register code action provider
            this.codeActionProvider = new AICodeActionProvider(
                this.aiService,
                this.chatPanelProvider
            );
            context.subscriptions.push(
                vscode.languages.registerCodeActionsProvider(
                    { scheme: 'file', language: '*' },
                    this.codeActionProvider,
                    {
                        providedCodeActionKinds: [
                            vscode.CodeActionKind.Empty,
                            vscode.CodeActionKind.QuickFix,
                            vscode.CodeActionKind.RefactorRewrite
                        ]
                    }
                )
            );

            // Register code action commands
            this.codeActionProvider.registerCommands(context);

            // Register commands
            this.registerCommands(context);

            // Set up status bar
            this.setupStatusBar(context);

            // Set up entity explorer integration
            this.setupEntityExplorerIntegration(context);

            // Listen for connection status changes to re-initialize AI when database connects
            this.setupConnectionListener(context);

            OutputChannel.info('AI Assistance feature activated');

        } catch (error) {
            OutputChannel.error('Failed to activate AI Assistance feature', error as Error);
            throw error;
        }
    }

    async deactivate(): Promise<void> {
        this.aiService.dispose();
        this.statusBarItem?.dispose();
        this.connectionStatusDisposable?.dispose();
        this.disposables.forEach(d => d.dispose());
        OutputChannel.info('AI Assistance feature deactivated');
    }

    /**
     * Register AI assistance commands
     */
    private registerCommands(context: vscode.ExtensionContext): void {
        // Open AI Chat command
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.openAIChat', async () => {
                await vscode.commands.executeCommand('memberjunction.aiChatPanel.focus');
            })
        );

        // Ask AI about entity command
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.askAIAboutEntity', async (entity) => {
                if (!entity) {
                    vscode.window.showErrorMessage('No entity selected');
                    return;
                }

                // Set entity context
                if (this.chatPanelProvider) {
                    this.chatPanelProvider.setEntityContext(entity);
                }

                // Open chat panel
                await vscode.commands.executeCommand('memberjunction.aiChatPanel.focus');

                // Prompt for question
                const question = await vscode.window.showInputBox({
                    prompt: `Ask a question about the "${entity.name}" entity`,
                    placeHolder: 'e.g., How do I query this entity?',
                    ignoreFocusOut: true
                });

                if (question) {
                    await this.aiService.askAboutEntity(entity, question);
                }
            })
        );

        // Clear AI chat history command
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.clearAIChat', () => {
                if (this.chatPanelProvider) {
                    this.chatPanelProvider.clearConversation();
                    vscode.window.showInformationMessage('AI chat history cleared');
                }
            })
        );

        // List available AI agents command
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.listAIAgents', async () => {
                try {
                    const agents = await this.aiService.listAgents(true);

                    if (agents.length === 0) {
                        vscode.window.showInformationMessage('No AI agents found. Connect to database and ensure agents are configured.');
                        return;
                    }

                    // Show quick pick to select an agent
                    const items = [
                        { label: '$(comment-discussion) Prompt Mode', description: 'Use direct AI prompts', agentId: null },
                        { label: '', kind: vscode.QuickPickItemKind.Separator },
                        ...agents.map(a => ({
                            label: `$(robot) ${a.name}`,
                            description: a.description || '',
                            detail: `Status: ${a.status}`,
                            agentId: a.id
                        }))
                    ];

                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Select AI mode or agent',
                        title: 'AI Agents'
                    });

                    if (selected) {
                        const selectedItem = selected as { agentId: string | null };
                        if (selectedItem.agentId === null) {
                            this.aiService.setActiveAgent(null);
                            vscode.window.showInformationMessage('Switched to Prompt mode');
                        } else {
                            const agent = agents.find(a => a.id === selectedItem.agentId);
                            if (agent) {
                                this.aiService.setActiveAgent(agent);
                                vscode.window.showInformationMessage(`Selected agent: ${agent.name}`);
                            }
                        }

                        // Refresh the chat panel
                        if (this.chatPanelProvider) {
                            await this.chatPanelProvider.refreshAgents();
                        }
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to list agents: ${(error as Error).message}`);
                }
            })
        );

        // Refresh AI agents command
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.refreshAIAgents', async () => {
                try {
                    if (this.chatPanelProvider) {
                        await this.chatPanelProvider.refreshAgents();
                        vscode.window.showInformationMessage('AI agents refreshed');
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to refresh agents: ${(error as Error).message}`);
                }
            })
        );
    }

    /**
     * Set up status bar for AI assistance
     */
    private setupStatusBar(_context: vscode.ExtensionContext): void {
        StatusBarManager.register('ai-assistance', {
            alignment: vscode.StatusBarAlignment.Left,
            priority: -100
        });

        // Set initial status based on current AI mode
        this.updateStatusBarForAIMode();
    }

    /**
     * Set up integration with Entity Explorer
     */
    private setupEntityExplorerIntegration(_context: vscode.ExtensionContext): void {
        // Listen for entity selection changes
        // This would be implemented if EntityExplorer emits selection events

        // Add context menu item to Entity Explorer for "Ask AI About Entity"
        // This is handled through package.json menus configuration
    }

    /**
     * Set up listener for connection status changes
     */
    private setupConnectionListener(_context: vscode.ExtensionContext): void {
        this.connectionStatusDisposable = this.connectionService.onStatusChange(async (status) => {
            OutputChannel.info(`Connection status changed to: ${status}`);

            if (status === 'connected') {
                OutputChannel.info('Database connected - reinitializing AI Service with real AI...');

                // Reinitialize AI Service now that database is connected
                const wasRealAI = this.aiService.isRealAIAvailable();
                await this.aiService.initialize(true); // Force re-initialization
                const isNowRealAI = this.aiService.isRealAIAvailable();

                if (!wasRealAI && isNowRealAI) {
                    vscode.window.showInformationMessage(
                        '✨ AI Assistant upgraded to Real AI mode with your configured LLM!',
                        'Open Chat'
                    ).then(selection => {
                        if (selection === 'Open Chat') {
                            vscode.commands.executeCommand('memberjunction.openAIChat');
                        }
                    });
                }

                // Refresh available agents
                if (this.chatPanelProvider) {
                    await this.chatPanelProvider.refreshAgents();
                }

                // Update status bar to reflect real AI availability
                this.updateStatusBarForAIMode();
            } else if (status === 'disconnected' || status === 'error') {
                OutputChannel.info('Database disconnected - AI Service will use fallback mode');
                this.updateStatusBarForAIMode();
            }
        });
    }

    /**
     * Update status bar based on AI mode
     */
    private updateStatusBarForAIMode(): void {
        const isRealAI = this.aiService.isRealAIAvailable();
        const tooltip = isRealAI
            ? 'AI Assistant (Real AI with LLM) - Click to open chat'
            : 'AI Assistant (Fallback mode) - Connect to database for full AI features';

        StatusBarManager.update(
            'ai-assistance',
            isRealAI ? '$(sparkle) AI Assistant' : '$(comment-discussion) AI Assistant',
            tooltip,
            'memberjunction.openAIChat'
        );
    }

    /**
     * React to configuration changes
     */
    onConfigChange(_config: MJConfig): void {
        const enabled = this.enabled();

        if (!enabled && this.statusBarItem) {
            this.statusBarItem.hide();
        } else if (enabled && this.statusBarItem) {
            this.statusBarItem.show();
        }
    }
}
