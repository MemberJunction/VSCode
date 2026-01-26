import * as vscode from 'vscode';
import { AIService, ChatMessage } from '../services/AIService';
import { OutputChannel } from '../common/OutputChannel';
import { EntityInfo } from '../types';

/**
 * Webview provider for the AI Chat Panel
 *
 * Provides an interactive chat interface for:
 * - Asking questions about entities
 * - Getting code suggestions
 * - Entity-aware conversations
 */
export class AIChatPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'memberjunction.aiChatPanel';

    private view?: vscode.WebviewView;
    private aiService: AIService;

    constructor(
        private readonly extensionUri: vscode.Uri,
        aiService: AIService
    ) {
        this.aiService = aiService;
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
    private async handleMessage(data: any): Promise<void> {
        switch (data.type) {
            case 'sendMessage':
                await this.handleUserMessage(data.message);
                break;

            case 'clearHistory':
                this.clearConversation();
                break;

            case 'requestHistory':
                this.sendConversationHistory();
                break;

            case 'ready':
                // Webview is ready, send initial state
                this.sendConversationHistory();
                break;
        }
    }

    /**
     * Handle user message from the webview
     */
    private async handleUserMessage(message: string): Promise<void> {
        try {
            // Show user message immediately
            this.sendMessage({
                role: 'user',
                content: message,
                timestamp: new Date()
            });

            // Show typing indicator
            if (this.view) {
                this.view.webview.postMessage({
                    type: 'setTyping',
                    isTyping: true
                });
            }

            // Get AI response
            const response = await this.aiService.sendMessage(message);

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
        body {
            padding: 0;
            margin: 0;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }

        .container {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        .context-banner {
            padding: 8px 12px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            font-size: 11px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: none;
        }

        .context-banner.active {
            display: block;
        }

        .context-banner .entity-name {
            font-weight: bold;
        }

        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .message {
            display: flex;
            flex-direction: column;
            max-width: 85%;
            padding: 8px 12px;
            border-radius: 6px;
            word-wrap: break-word;
        }

        .message.user {
            align-self: flex-end;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .message.assistant {
            align-self: flex-start;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
        }

        .message-content {
            line-height: 1.5;
        }

        .message-content pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 8px 0;
        }

        .message-content code {
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
        }

        .message-timestamp {
            font-size: 10px;
            opacity: 0.6;
            margin-top: 4px;
        }

        .typing-indicator {
            align-self: flex-start;
            padding: 8px 12px;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            display: none;
        }

        .typing-indicator.active {
            display: block;
        }

        .typing-indicator .dot {
            display: inline-block;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background-color: var(--vscode-foreground);
            margin: 0 2px;
            opacity: 0.6;
            animation: typing 1.4s infinite;
        }

        .typing-indicator .dot:nth-child(2) {
            animation-delay: 0.2s;
        }

        .typing-indicator .dot:nth-child(3) {
            animation-delay: 0.4s;
        }

        @keyframes typing {
            0%, 60%, 100% { opacity: 0.6; transform: translateY(0); }
            30% { opacity: 1; transform: translateY(-4px); }
        }

        .input-area {
            padding: 12px;
            border-top: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-editor-background);
        }

        .input-row {
            display: flex;
            gap: 8px;
        }

        #messageInput {
            flex: 1;
            padding: 8px 12px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-family: inherit;
            font-size: inherit;
            resize: none;
            min-height: 36px;
            max-height: 120px;
        }

        #messageInput:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        button {
            padding: 8px 16px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: inherit;
            font-size: inherit;
        }

        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }

        .action-button {
            padding: 4px 8px;
            font-size: 11px;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .action-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            opacity: 0.6;
            padding: 24px;
            text-align: center;
        }

        .empty-state h3 {
            margin-top: 16px;
            margin-bottom: 8px;
        }

        .empty-state p {
            font-size: 12px;
            line-height: 1.5;
        }
    </style>
</head>
<body>
    <div class="container">
        <div id="contextBanner" class="context-banner">
            Context: <span class="entity-name" id="contextEntity"></span>
        </div>

        <div class="messages" id="messages">
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                <h3>MemberJunction AI Assistant</h3>
                <p>Ask me anything about MemberJunction entities, code patterns, or best practices.</p>
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
                    placeholder="Ask me about entities, code, or MemberJunction..."
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

            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + message.role;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';

            // Simple markdown-like rendering
            let content = message.content;
            content = content.replace(/\`\`\`(\\w+)?\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>');
            content = content.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
            content = content.replace(/\\n/g, '<br>');

            contentDiv.innerHTML = content;

            const timestampDiv = document.createElement('div');
            timestampDiv.className = 'message-timestamp';
            timestampDiv.textContent = new Date(message.timestamp).toLocaleTimeString();

            messageDiv.appendChild(contentDiv);
            messageDiv.appendChild(timestampDiv);
            messagesContainer.appendChild(messageDiv);

            // Scroll to bottom
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function setTyping(isTyping) {
            typingIndicator.classList.toggle('active', isTyping);
            if (isTyping) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        }

        function setHistory(messages) {
            messagesContainer.innerHTML = '';
            if (messages.length === 0) {
                messagesContainer.innerHTML = '' +
                    '<div class="empty-state">' +
                        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                            '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>' +
                        '</svg>' +
                        '<h3>MemberJunction AI Assistant</h3>' +
                        '<p>Ask me anything about MemberJunction entities, code patterns, or best practices.</p>' +
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

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'addMessage':
                    addMessage(message.message);
                    break;
                case 'setTyping':
                    setTyping(message.isTyping);
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
                case 'error':
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
