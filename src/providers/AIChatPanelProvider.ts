import * as vscode from 'vscode';
import { AIService, ChatMessage } from '../services/AIService';
import { OutputChannel } from '../common/OutputChannel';
import { EntityInfo, AgentInfo, AgentProgressEvent } from '../types';

/**
 * Webview provider for the AI Chat Panel
 *
 * Provides an interactive chat interface for:
 * - Asking questions about entities
 * - Getting code suggestions
 * - Entity-aware conversations
 * - AI Agent execution
 */
export class AIChatPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'memberjunction.aiChatPanel';

    private view?: vscode.WebviewView;
    private aiService: AIService;
    private availableAgents: AgentInfo[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        aiService: AIService
    ) {
        this.aiService = aiService;
        // Set up progress callback for agent execution
        this.aiService.setAgentProgressCallback((event) => this.handleAgentProgress(event));
    }

    /**
     * Resolve the webview view
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            await this.handleMessage(data);
        });

        // Send initial conversation history
        this.sendConversationHistory();
    }

    /**
     * Send a message from the extension to the chat
     */
    public sendMessage(message: ChatMessage): void {
        if (this.view) {
            this.view.webview.postMessage({
                type: 'addMessage',
                message: {
                    role: message.role,
                    content: message.content,
                    timestamp: message.timestamp.toISOString(),
                    entityContext: message.entityContext
                }
            });
        }
    }

    /**
     * Set entity context and notify the webview
     */
    public setEntityContext(entity: EntityInfo | null): void {
        this.aiService.setEntityContext(entity);

        if (this.view) {
            this.view.webview.postMessage({
                type: 'setContext',
                entity: entity ? {
                    name: entity.name,
                    description: entity.description,
                    baseTable: entity.baseTable
                } : null
            });
        }
    }

    /**
     * Clear the conversation
     */
    public clearConversation(): void {
        this.aiService.clearConversation();

        if (this.view) {
            this.view.webview.postMessage({
                type: 'clearMessages'
            });
        }
    }

    /**
     * Handle messages from the webview
     */
    private async handleMessage(data: unknown): Promise<void> {
        const msg = data as { type: string; message?: string; agentId?: string | null };
        switch (msg.type) {
            case 'sendMessage':
                await this.handleUserMessage(msg.message || '');
                break;

            case 'clearHistory':
                this.clearConversation();
                break;

            case 'requestHistory':
                this.sendConversationHistory();
                break;

            case 'ready':
                // Webview is ready, send initial state
                await this.refreshAgents();
                this.sendConversationHistory();
                break;

            case 'selectAgent':
                this.handleAgentSelection(msg.agentId ?? null);
                break;

            case 'refreshAgents':
                await this.refreshAgents();
                break;
        }
    }

    /**
     * Handle user message from the webview
     */
    private async handleUserMessage(message: string): Promise<void> {
        console.log('[AIChatPanel] handleUserMessage called:', message);

        try {
            const activeAgent = this.aiService.getActiveAgent();
            console.log('[AIChatPanel] Active agent:', activeAgent?.name);
            console.log('[AIChatPanel] Execution mode:', this.aiService.getExecutionMode());

            // Show user message immediately
            this.sendMessage({
                role: 'user',
                content: message,
                timestamp: new Date(),
                agentName: activeAgent?.name
            });

            // Show typing indicator
            if (this.view) {
                this.view.webview.postMessage({
                    type: 'setTyping',
                    isTyping: true,
                    agentName: activeAgent?.name
                });
            }

            // Get response using appropriate mode (prompt or agent)
            console.log('[AIChatPanel] Calling sendMessageWithMode...');
            const response = await this.aiService.sendMessageWithMode(message);
            console.log('[AIChatPanel] Response received:', response?.content?.substring(0, 100));

            // Hide typing indicator
            if (this.view) {
                this.view.webview.postMessage({
                    type: 'setTyping',
                    isTyping: false
                });
            }

            // The response is already added to history, just send it to UI
            this.sendMessage(response);

        } catch (error) {
            OutputChannel.error('Failed to process AI message', error as Error);

            if (this.view) {
                this.view.webview.postMessage({
                    type: 'setTyping',
                    isTyping: false
                });

                this.view.webview.postMessage({
                    type: 'error',
                    message: `Error: ${(error as Error).message}`
                });
            }
        }
    }

    /**
     * Send conversation history to the webview
     */
    private sendConversationHistory(): void {
        if (this.view) {
            const history = this.aiService.getConversationHistory()
                .filter(m => m.role !== 'system') // Don't show system messages
                .map(m => ({
                    role: m.role,
                    content: m.content,
                    timestamp: m.timestamp.toISOString(),
                    entityContext: m.entityContext
                }));

            this.view.webview.postMessage({
                type: 'setHistory',
                messages: history
            });

            // Send current entity context
            const entityContext = this.aiService.getEntityContext();
            this.view.webview.postMessage({
                type: 'setContext',
                entity: entityContext ? {
                    name: entityContext.name,
                    description: entityContext.description,
                    baseTable: entityContext.baseTable
                } : null
            });

            // Send agent info
            this.sendAgentState();
        }
    }

    // ========== Agent Integration Methods ==========

    /**
     * Load and send available agents to the webview
     */
    public async refreshAgents(): Promise<void> {
        try {
            this.availableAgents = await this.aiService.listAgents(true);
            this.sendAgentState();
        } catch (error) {
            OutputChannel.error('Failed to refresh agents', error as Error);
        }
    }

    /**
     * Send current agent state to webview
     */
    private sendAgentState(): void {
        if (this.view) {
            const activeAgent = this.aiService.getActiveAgent();
            const mode = this.aiService.getExecutionMode();

            // Filter agents to only show Sage and Claude-based agents
            const filteredAgents = this.availableAgents.filter(a => {
                const nameLower = a.name.toLowerCase();
                return nameLower === 'sage' || nameLower.includes('claude');
            });

            this.view.webview.postMessage({
                type: 'setAgentState',
                agents: filteredAgents.map(a => ({
                    id: a.id,
                    name: a.name,
                    description: a.description
                })),
                activeAgent: activeAgent ? {
                    id: activeAgent.id,
                    name: activeAgent.name,
                    description: activeAgent.description
                } : null,
                mode: mode
            });
        }
    }

    /**
     * Handle agent selection from webview
     */
    private handleAgentSelection(agentId: string | null): void {
        if (agentId === null || agentId === '') {
            // Clear agent, switch to prompt mode
            this.aiService.setActiveAgent(null);
            OutputChannel.info('Switched to prompt mode');
        } else {
            // Find and set the agent
            const agent = this.availableAgents.find(a => a.id === agentId);
            if (agent) {
                this.aiService.setActiveAgent(agent);
                OutputChannel.info(`Selected agent: ${agent.name}`);
            }
        }
        this.sendAgentState();
    }

    /**
     * Handle agent progress events
     */
    private handleAgentProgress(event: AgentProgressEvent): void {
        if (this.view) {
            this.view.webview.postMessage({
                type: 'agentProgress',
                step: event.step,
                message: event.message,
                percentage: event.percentage
            });
        }
    }

    /**
     * Get the HTML content for the webview
     */
    private getHtmlForWebview(_webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Assistant</title>
    <style>
        * {
            box-sizing: border-box;
        }

        body {
            padding: 0;
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            overflow: hidden;
        }

        .container {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        /* Modern Context Banner */
        .context-banner {
            padding: 12px 20px;
            background: linear-gradient(135deg,
                var(--vscode-badge-background) 0%,
                color-mix(in srgb, var(--vscode-badge-background) 90%, transparent) 100%);
            color: var(--vscode-badge-foreground);
            font-size: 12px;
            font-weight: 500;
            border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 50%, transparent);
            backdrop-filter: blur(10px);
            display: none;
            align-items: center;
            gap: 8px;
            animation: slideDown 0.3s ease-out;
        }

        .context-banner.active {
            display: flex;
        }

        .context-banner::before {
            content: '✨';
            font-size: 14px;
        }

        .context-banner .entity-name {
            font-weight: 600;
            color: var(--vscode-badge-foreground);
        }

        @keyframes slideDown {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        /* Messages Container */
        .messages {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 24px 20px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            scroll-behavior: smooth;
        }

        .messages::-webkit-scrollbar {
            width: 8px;
        }

        .messages::-webkit-scrollbar-track {
            background: transparent;
        }

        .messages::-webkit-scrollbar-thumb {
            background: color-mix(in srgb, var(--vscode-scrollbarSlider-background) 60%, transparent);
            border-radius: 4px;
        }

        .messages::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }

        /* Modern Message Bubbles */
        .message {
            display: flex;
            flex-direction: column;
            max-width: 80%;
            padding: 14px 18px;
            border-radius: 18px;
            word-wrap: break-word;
            animation: messageSlideIn 0.3s ease-out;
            position: relative;
            box-shadow: 0 2px 8px color-mix(in srgb, var(--vscode-widget-shadow) 15%, transparent);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .message:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px color-mix(in srgb, var(--vscode-widget-shadow) 20%, transparent);
        }

        @keyframes messageSlideIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .message.user {
            align-self: flex-end;
            background: linear-gradient(135deg,
                var(--vscode-button-background) 0%,
                color-mix(in srgb, var(--vscode-button-background) 85%, #000) 100%);
            color: var(--vscode-button-foreground);
            border-bottom-right-radius: 6px;
        }

        .message.assistant {
            align-self: flex-start;
            background: var(--vscode-input-background);
            border: 1px solid color-mix(in srgb, var(--vscode-input-border) 40%, transparent);
            border-bottom-left-radius: 6px;
        }

        .message-content {
            line-height: 1.6;
            letter-spacing: 0.01em;
        }

        .message-content h1,
        .message-content h2,
        .message-content h3 {
            margin: 12px 0 8px;
            line-height: 1.3;
            font-weight: 600;
        }

        .message-content h1 {
            font-size: 1.4em;
            border-bottom: 2px solid color-mix(in srgb, var(--vscode-foreground) 20%, transparent);
            padding-bottom: 6px;
        }

        .message-content h2 {
            font-size: 1.2em;
            border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 15%, transparent);
            padding-bottom: 4px;
        }

        .message-content h3 {
            font-size: 1.1em;
        }

        .message-content ul,
        .message-content ol {
            margin: 8px 0;
            padding-left: 24px;
        }

        .message-content li {
            margin: 4px 0;
        }

        .message-content a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
            border-bottom: 1px solid transparent;
            transition: border-color 0.2s ease;
        }

        .message-content a:hover {
            border-bottom-color: var(--vscode-textLink-foreground);
        }

        .message-content strong {
            font-weight: 600;
        }

        .message-content em {
            font-style: italic;
        }

        .message-content del {
            opacity: 0.6;
        }

        .message-content pre {
            background: color-mix(in srgb, var(--vscode-textCodeBlock-background) 80%, transparent);
            padding: 12px 14px;
            border-radius: 10px;
            overflow-x: auto;
            margin: 10px 0;
            border-left: 3px solid var(--vscode-button-background);
            font-size: 0.9em;
        }

        .message-content code {
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
            font-size: 0.9em;
            background: color-mix(in srgb, var(--vscode-textCodeBlock-background) 50%, transparent);
            padding: 2px 6px;
            border-radius: 4px;
        }

        .message-content pre code {
            background: none;
            padding: 0;
        }

        .message-timestamp {
            font-size: 10px;
            opacity: 0.5;
            margin-top: 6px;
            font-weight: 500;
            letter-spacing: 0.02em;
        }

        /* Enhanced Typing Indicator */
        .typing-indicator {
            align-self: flex-start;
            padding: 14px 18px;
            background: var(--vscode-input-background);
            border: 1px solid color-mix(in srgb, var(--vscode-input-border) 40%, transparent);
            border-radius: 18px;
            border-bottom-left-radius: 6px;
            display: none;
            box-shadow: 0 2px 8px color-mix(in srgb, var(--vscode-widget-shadow) 15%, transparent);
        }

        .typing-indicator.active {
            display: flex;
            gap: 4px;
            animation: messageSlideIn 0.3s ease-out;
        }

        .typing-indicator .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--vscode-foreground);
            opacity: 0.4;
            animation: typingBounce 1.4s infinite ease-in-out;
        }

        .typing-indicator .dot:nth-child(1) { animation-delay: 0s; }
        .typing-indicator .dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-indicator .dot:nth-child(3) { animation-delay: 0.4s; }

        @keyframes typingBounce {
            0%, 60%, 100% {
                opacity: 0.4;
                transform: translateY(0) scale(1);
            }
            30% {
                opacity: 1;
                transform: translateY(-6px) scale(1.1);
            }
        }

        /* Modern Input Area */
        .input-area {
            padding: 16px 20px 20px;
            background: var(--vscode-editor-background);
            border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 30%, transparent);
            backdrop-filter: blur(10px);
        }

        .input-row {
            display: flex;
            gap: 10px;
            align-items: center;
            background: var(--vscode-input-background);
            border: 1.5px solid var(--vscode-input-border);
            border-radius: 24px;
            padding: 4px 4px 4px 18px;
            transition: all 0.2s ease;
        }

        .input-row:focus-within {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-focusBorder) 15%, transparent);
        }

        #messageInput {
            flex: 1;
            padding: 10px 0;
            background: transparent;
            color: var(--vscode-input-foreground);
            border: none;
            font-family: inherit;
            font-size: 13px;
            resize: none;
            min-height: 24px;
            max-height: 120px;
            outline: none;
            line-height: 1.5;
        }

        #messageInput::placeholder {
            color: color-mix(in srgb, var(--vscode-input-foreground) 50%, transparent);
        }

        /* Modern Send Button */
        #sendButton {
            padding: 10px 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 20px;
            cursor: pointer;
            font-family: inherit;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.2s ease;
            box-shadow: 0 2px 6px color-mix(in srgb, var(--vscode-button-background) 30%, transparent);
            white-space: nowrap;
        }

        #sendButton:hover {
            background: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px color-mix(in srgb, var(--vscode-button-background) 40%, transparent);
        }

        #sendButton:active {
            transform: translateY(0);
        }

        #sendButton:disabled {
            opacity: 0.4;
            cursor: not-allowed;
            transform: none;
        }

        /* Action Buttons */
        .actions {
            display: flex;
            gap: 8px;
            margin-top: 10px;
            justify-content: flex-end;
        }

        .action-button {
            padding: 6px 12px;
            font-size: 11px;
            background: transparent;
            color: color-mix(in srgb, var(--vscode-foreground) 70%, transparent);
            border: none;
            border-radius: 12px;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.2s ease;
            letter-spacing: 0.02em;
        }

        .action-button:hover {
            background: color-mix(in srgb, var(--vscode-button-secondaryBackground) 50%, transparent);
            color: var(--vscode-foreground);
            transform: translateY(-1px);
        }

        /* Agent Selector */
        .agent-selector {
            padding: 8px 16px;
            background: var(--vscode-editor-background);
            border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 30%, transparent);
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
        }

        .agent-selector-label {
            color: color-mix(in srgb, var(--vscode-foreground) 70%, transparent);
            font-weight: 500;
        }

        .agent-dropdown {
            flex: 1;
            padding: 6px 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
            outline: none;
            transition: border-color 0.2s ease;
        }

        .agent-dropdown:focus {
            border-color: var(--vscode-focusBorder);
        }

        .agent-dropdown:hover {
            border-color: var(--vscode-focusBorder);
        }

        .agent-mode-badge {
            padding: 3px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .agent-mode-badge.prompt {
            background: color-mix(in srgb, var(--vscode-charts-blue) 20%, transparent);
            color: var(--vscode-charts-blue);
        }

        .agent-mode-badge.agent {
            background: color-mix(in srgb, var(--vscode-charts-green) 20%, transparent);
            color: var(--vscode-charts-green);
        }

        .agent-progress {
            padding: 8px 16px;
            background: color-mix(in srgb, var(--vscode-charts-green) 10%, transparent);
            border-bottom: 1px solid color-mix(in srgb, var(--vscode-charts-green) 30%, transparent);
            font-size: 11px;
            color: var(--vscode-foreground);
            display: none;
            align-items: center;
            gap: 8px;
        }

        .agent-progress.active {
            display: flex;
        }

        .agent-progress-spinner {
            width: 12px;
            height: 12px;
            border: 2px solid color-mix(in srgb, var(--vscode-charts-green) 30%, transparent);
            border-top-color: var(--vscode-charts-green);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* Modern Empty State */
        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            padding: 40px 24px;
            text-align: center;
            animation: fadeIn 0.5s ease-out;
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: scale(0.95);
            }
            to {
                opacity: 1;
                transform: scale(1);
            }
        }

        .empty-state-icon {
            width: 64px;
            height: 64px;
            background: linear-gradient(135deg,
                var(--vscode-button-background) 0%,
                color-mix(in srgb, var(--vscode-button-background) 70%, transparent) 100%);
            border-radius: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
            box-shadow: 0 8px 24px color-mix(in srgb, var(--vscode-button-background) 25%, transparent);
        }

        .empty-state-icon svg {
            width: 32px;
            height: 32px;
            stroke: var(--vscode-button-foreground);
        }

        .empty-state h3 {
            margin: 0 0 8px;
            font-size: 18px;
            font-weight: 600;
            color: var(--vscode-foreground);
            letter-spacing: -0.02em;
        }

        .empty-state p {
            font-size: 13px;
            line-height: 1.6;
            color: color-mix(in srgb, var(--vscode-foreground) 65%, transparent);
            max-width: 300px;
            margin: 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div id="contextBanner" class="context-banner">
            Context: <span class="entity-name" id="contextEntity"></span>
        </div>

        <div class="agent-selector" id="agentSelector">
            <span class="agent-selector-label">Mode:</span>
            <select class="agent-dropdown" id="agentDropdown">
                <option value="">Prompt (Direct AI)</option>
            </select>
            <span class="agent-mode-badge prompt" id="modeBadge">Prompt</span>
        </div>

        <div class="agent-progress" id="agentProgress">
            <div class="agent-progress-spinner"></div>
            <span id="agentProgressText">Processing...</span>
        </div>

        <div class="messages" id="messages">
            <div class="empty-state">
                <div class="empty-state-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                </div>
                <h3>AI Assistant</h3>
                <p>Ask me anything about MemberJunction entities, code patterns, or best practices. I'm here to help!</p>
            </div>
        </div>

        <div class="typing-indicator" id="typingIndicator">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
        </div>

        <div class="input-area">
            <div class="input-row">
                <textarea
                    id="messageInput"
                    placeholder="Questions about MJ?"
                    rows="1"
                ></textarea>
                <button id="sendButton">Send</button>
            </div>
            <div class="actions">
                <button class="action-button" id="clearButton">Clear History</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const messagesContainer = document.getElementById('messages');
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        const clearButton = document.getElementById('clearButton');
        const typingIndicator = document.getElementById('typingIndicator');
        const contextBanner = document.getElementById('contextBanner');
        const contextEntity = document.getElementById('contextEntity');
        const agentDropdown = document.getElementById('agentDropdown');
        const modeBadge = document.getElementById('modeBadge');
        const agentProgress = document.getElementById('agentProgress');
        const agentProgressText = document.getElementById('agentProgressText');

        // Agent selection handler
        agentDropdown.addEventListener('change', (e) => {
            const agentId = e.target.value;
            vscode.postMessage({
                type: 'selectAgent',
                agentId: agentId || null
            });
        });

        // Auto-resize textarea
        messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = messageInput.scrollHeight + 'px';
        });

        // Send message on button click
        sendButton.addEventListener('click', sendMessage);

        // Send message on Enter (Shift+Enter for new line)
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Clear history
        clearButton.addEventListener('click', () => {
            vscode.postMessage({ type: 'clearHistory' });
        });

        function sendMessage() {
            const message = messageInput.value.trim();
            if (message) {
                vscode.postMessage({
                    type: 'sendMessage',
                    message: message
                });
                messageInput.value = '';
                messageInput.style.height = 'auto';
            }
        }

        function addMessage(message) {
            // Remove empty state if present
            const emptyState = messagesContainer.querySelector('.empty-state');
            if (emptyState) {
                emptyState.remove();
            }

            // Check if user was already scrolled AT the very bottom (within 10px - essentially at bottom)
            const isAtBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 10;

            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + message.role;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';

            // Enhanced markdown rendering
            let content = message.content;

            // Code blocks (must be first to protect code from other replacements)
            content = content.replace(/\`\`\`(\\w+)?\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>');

            // Headers (must be before line breaks)
            content = content.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
            content = content.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
            content = content.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

            // Bold
            content = content.replace(/\\*\\*([^\\*]+)\\*\\*/g, '<strong>$1</strong>');
            content = content.replace(/__([^_]+)__/g, '<strong>$1</strong>');

            // Italic
            content = content.replace(/\\*([^\\*]+)\\*/g, '<em>$1</em>');
            content = content.replace(/_([^_]+)_/g, '<em>$1</em>');

            // Strikethrough
            content = content.replace(/~~([^~]+)~~/g, '<del>$1</del>');

            // Unordered lists
            content = content.replace(/^[\\-\\*] (.*?)$/gm, '<li>$1</li>');
            content = content.replace(/(<li>.*?<\\/li>)/s, '<ul>$1</ul>');

            // Links
            content = content.replace(/\\[([^\\]]+)\\]\\(([^\\)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');

            // Inline code (after other formatting)
            content = content.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

            // Line breaks (must be last)
            content = content.replace(/\\n/g, '<br>');

            contentDiv.innerHTML = content;

            const timestampDiv = document.createElement('div');
            timestampDiv.className = 'message-timestamp';
            timestampDiv.textContent = new Date(message.timestamp).toLocaleTimeString();

            messageDiv.appendChild(contentDiv);
            messageDiv.appendChild(timestampDiv);
            messagesContainer.appendChild(messageDiv);

            // Only auto-scroll for user's own messages (so they see what they sent)
            // Never auto-scroll for assistant messages - let user control their reading position
            if (message.role === 'user') {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        }

        function setTyping(isTyping) {
            typingIndicator.classList.toggle('active', isTyping);
            // Don't auto-scroll on typing indicator - let user control their position
        }

        function setHistory(messages) {
            messagesContainer.innerHTML = '';
            if (messages.length === 0) {
                messagesContainer.innerHTML = '' +
                    '<div class="empty-state">' +
                        '<div class="empty-state-icon">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                                '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>' +
                            '</svg>' +
                        '</div>' +
                        '<h3>AI Assistant</h3>' +
                        '<p>Ask me anything about MemberJunction entities, code patterns, or best practices. I' + String.fromCharCode(39) + 'm here to help!</p>' +
                    '</div>';
            } else {
                messages.forEach(addMessage);
            }
        }

        function setContext(entity) {
            if (entity) {
                contextBanner.classList.add('active');
                contextEntity.textContent = entity.name;
            } else {
                contextBanner.classList.remove('active');
            }
        }

        // Agent state handling
        function setAgentState(data) {
            // Update dropdown options
            const currentValue = agentDropdown.value;
            agentDropdown.innerHTML = '<option value="">Prompt (Direct AI)</option>';

            if (data.agents && data.agents.length > 0) {
                const optgroup = document.createElement('optgroup');
                optgroup.label = 'AI Agents';

                data.agents.forEach(agent => {
                    const option = document.createElement('option');
                    option.value = agent.id;
                    option.textContent = agent.name;
                    if (agent.description) {
                        option.title = agent.description;
                    }
                    optgroup.appendChild(option);
                });

                agentDropdown.appendChild(optgroup);
            }

            // Set selected value
            if (data.activeAgent) {
                agentDropdown.value = data.activeAgent.id;
            } else {
                agentDropdown.value = '';
            }

            // Update mode badge
            updateModeBadge(data.mode);
        }

        function updateModeBadge(mode) {
            modeBadge.classList.remove('prompt', 'agent');
            if (mode === 'agent') {
                modeBadge.classList.add('agent');
                modeBadge.textContent = 'Agent';
            } else {
                modeBadge.classList.add('prompt');
                modeBadge.textContent = 'Prompt';
            }
        }

        function showAgentProgress(step, message) {
            agentProgress.classList.add('active');
            agentProgressText.textContent = step + ': ' + message;
        }

        function hideAgentProgress() {
            agentProgress.classList.remove('active');
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'addMessage':
                    addMessage(message.message);
                    hideAgentProgress();
                    break;
                case 'setTyping':
                    setTyping(message.isTyping);
                    if (!message.isTyping) {
                        hideAgentProgress();
                    }
                    break;
                case 'clearMessages':
                    setHistory([]);
                    break;
                case 'setHistory':
                    setHistory(message.messages);
                    break;
                case 'setContext':
                    setContext(message.entity);
                    break;
                case 'setAgentState':
                    setAgentState(message);
                    break;
                case 'agentProgress':
                    showAgentProgress(message.step, message.message);
                    break;
                case 'error':
                    hideAgentProgress();
                    addMessage({
                        role: 'assistant',
                        content: message.message,
                        timestamp: new Date().toISOString()
                    });
                    break;
            }
        });

        // Request initial history when loaded
        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
    }
}
