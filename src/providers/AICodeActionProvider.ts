import * as vscode from 'vscode';
import { AIService } from '../services/AIService';
import { AIChatPanelProvider } from './AIChatPanelProvider';
import { OutputChannel } from '../common/OutputChannel';

/**
 * Provides code actions for AI assistance
 *
 * Adds context menu items like:
 * - "Ask AI to Explain This Code"
 * - "Ask AI to Generate Code"
 * - "Ask AI to Fix This"
 */
export class AICodeActionProvider implements vscode.CodeActionProvider {
    private aiService: AIService;

    constructor(aiService: AIService, _chatPanelProvider: AIChatPanelProvider) {
        this.aiService = aiService;
        // chatPanelProvider reserved for future use
    }

    /**
     * Provide code actions for the given document and range
     */
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        _context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.CodeAction[] | undefined {
        // Only provide actions if there's a selection
        if (range.isEmpty) {
            return undefined;
        }

        const selectedText = document.getText(range);

        if (!selectedText || selectedText.trim().length === 0) {
            return undefined;
        }

        const actions: vscode.CodeAction[] = [];

        // "Ask AI to Explain This Code" action
        const explainAction = new vscode.CodeAction(
            '$(comment-discussion) Ask AI to Explain This Code',
            vscode.CodeActionKind.Empty
        );
        explainAction.command = {
            command: 'memberjunction.askAIToExplain',
            title: 'Ask AI to Explain',
            arguments: [selectedText, document.languageId]
        };
        actions.push(explainAction);

        // "Ask AI to Improve This Code" action
        const improveAction = new vscode.CodeAction(
            '$(sparkle) Ask AI to Improve This Code',
            vscode.CodeActionKind.RefactorRewrite
        );
        improveAction.command = {
            command: 'memberjunction.askAIToImprove',
            title: 'Ask AI to Improve',
            arguments: [selectedText, document.languageId]
        };
        actions.push(improveAction);

        // "Ask AI to Fix This" action
        const fixAction = new vscode.CodeAction(
            '$(wrench) Ask AI to Fix This',
            vscode.CodeActionKind.QuickFix
        );
        fixAction.command = {
            command: 'memberjunction.askAIToFix',
            title: 'Ask AI to Fix',
            arguments: [selectedText, document.languageId]
        };
        actions.push(fixAction);

        // "Ask AI Custom Question" action
        const customAction = new vscode.CodeAction(
            '$(question) Ask AI Custom Question About This',
            vscode.CodeActionKind.Empty
        );
        customAction.command = {
            command: 'memberjunction.askAICustomQuestion',
            title: 'Ask AI Custom Question',
            arguments: [selectedText, document.languageId]
        };
        actions.push(customAction);

        return actions;
    }

    /**
     * Register commands for code actions
     */
    public registerCommands(context: vscode.ExtensionContext): void {
        // Explain code command
        context.subscriptions.push(
            vscode.commands.registerCommand(
                'memberjunction.askAIToExplain',
                async (code: string, language: string) => {
                    await this.explainCode(code, language);
                }
            )
        );

        // Improve code command
        context.subscriptions.push(
            vscode.commands.registerCommand(
                'memberjunction.askAIToImprove',
                async (code: string, language: string) => {
                    await this.improveCode(code, language);
                }
            )
        );

        // Fix code command
        context.subscriptions.push(
            vscode.commands.registerCommand(
                'memberjunction.askAIToFix',
                async (code: string, language: string) => {
                    await this.fixCode(code, language);
                }
            )
        );

        // Custom question command
        context.subscriptions.push(
            vscode.commands.registerCommand(
                'memberjunction.askAICustomQuestion',
                async (code: string, language: string) => {
                    await this.askCustomQuestion(code, language);
                }
            )
        );

        // Generate code command (from command palette)
        context.subscriptions.push(
            vscode.commands.registerCommand(
                'memberjunction.askAIToGenerate',
                async () => {
                    await this.generateCode();
                }
            )
        );
    }

    /**
     * Explain selected code
     */
    private async explainCode(code: string, language: string): Promise<void> {
        try {
            // Open AI chat panel
            await vscode.commands.executeCommand('memberjunction.aiChatPanel.focus');

            // Send message to AI
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Asking AI to explain code...',
                    cancellable: false
                },
                async () => {
                    await this.aiService.explainCode(code, language);
                }
            );

        } catch (error) {
            OutputChannel.error('Failed to explain code', error as Error);
            vscode.window.showErrorMessage(`Failed to explain code: ${(error as Error).message}`);
        }
    }

    /**
     * Improve selected code
     */
    private async improveCode(code: string, language: string): Promise<void> {
        try {
            // Open AI chat panel
            await vscode.commands.executeCommand('memberjunction.aiChatPanel.focus');

            // Send message to AI
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Asking AI to improve code...',
                    cancellable: false
                },
                async () => {
                    const prompt = `Please analyze this ${language} code and suggest improvements:\n\n\`\`\`${language}\n${code}\n\`\`\`\n\nFocus on:\n- Code quality\n- Performance\n- MemberJunction best practices\n- Type safety`;
                    await this.aiService.sendMessage(prompt);
                }
            );

        } catch (error) {
            OutputChannel.error('Failed to improve code', error as Error);
            vscode.window.showErrorMessage(`Failed to improve code: ${(error as Error).message}`);
        }
    }

    /**
     * Fix selected code
     */
    private async fixCode(code: string, language: string): Promise<void> {
        try {
            // Open AI chat panel
            await vscode.commands.executeCommand('memberjunction.aiChatPanel.focus');

            // Send message to AI
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Asking AI to fix code...',
                    cancellable: false
                },
                async () => {
                    const prompt = `Please analyze this ${language} code and identify any issues or bugs:\n\n\`\`\`${language}\n${code}\n\`\`\`\n\nThen provide a corrected version with explanations of what was wrong.`;
                    await this.aiService.sendMessage(prompt);
                }
            );

        } catch (error) {
            OutputChannel.error('Failed to fix code', error as Error);
            vscode.window.showErrorMessage(`Failed to fix code: ${(error as Error).message}`);
        }
    }

    /**
     * Ask custom question about code
     */
    private async askCustomQuestion(code: string, language: string): Promise<void> {
        try {
            // Prompt user for question
            const question = await vscode.window.showInputBox({
                prompt: 'What would you like to ask about this code?',
                placeHolder: 'e.g., How can I optimize this?',
                ignoreFocusOut: true
            });

            if (!question) {
                return;
            }

            // Open AI chat panel
            await vscode.commands.executeCommand('memberjunction.aiChatPanel.focus');

            // Send message to AI
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Asking AI...',
                    cancellable: false
                },
                async () => {
                    const prompt = `${question}\n\nCode:\n\`\`\`${language}\n${code}\n\`\`\``;
                    await this.aiService.sendMessage(prompt);
                }
            );

        } catch (error) {
            OutputChannel.error('Failed to ask custom question', error as Error);
            vscode.window.showErrorMessage(`Failed to ask question: ${(error as Error).message}`);
        }
    }

    /**
     * Generate code based on description
     */
    private async generateCode(): Promise<void> {
        try {
            // Prompt user for description
            const description = await vscode.window.showInputBox({
                prompt: 'Describe the code you want to generate',
                placeHolder: 'e.g., Create a function that loads all User entities',
                ignoreFocusOut: true,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Please enter a description';
                    }
                    return null;
                }
            });

            if (!description) {
                return;
            }

            // Open AI chat panel
            await vscode.commands.executeCommand('memberjunction.aiChatPanel.focus');

            // Send message to AI
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Generating code...',
                    cancellable: false
                },
                async () => {
                    await this.aiService.generateCode(description);
                }
            );

        } catch (error) {
            OutputChannel.error('Failed to generate code', error as Error);
            vscode.window.showErrorMessage(`Failed to generate code: ${(error as Error).message}`);
        }
    }
}
