import { AIPromptRunner } from '@memberjunction/ai-prompts';
import { AIPromptParams, AIPromptEntityExtended } from '@memberjunction/ai-core-plus';
import { ChatMessage as MJChatMessage } from '@memberjunction/ai';
import { RunView, UserInfo } from '@memberjunction/core';
import { EntityInfo, AgentInfo, AgentProgressEvent } from '../types';
import { OutputChannel } from '../common/OutputChannel';
import { ConnectionService } from './ConnectionService';
import { AgentService } from './AgentService';

/**
 * Message in the AI chat conversation
 */
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    entityContext?: string;
    agentName?: string; // Track which agent was used (if any)
}

/**
 * AI execution mode
 */
export type AIExecutionMode = 'prompt' | 'agent';

/**
 * AI Service for integrating MemberJunction AI capabilities
 *
 * Provides:
 * - Entity-aware AI chat using MemberJunction AI system
 * - Code generation assistance
 * - Context-aware suggestions
 * - Integration with configured LLM providers (OpenAI, Claude, Gemini, etc.)
 */
export class AIService {
    private static instance: AIService | null = null;
    private conversationHistory: ChatMessage[] = [];
    private currentEntityContext: EntityInfo | null = null;
    private initialized: boolean = false;
    private aiPrompt: AIPromptEntityExtended | null = null;
    private contextUser: UserInfo | null = null;
    private useRealAI: boolean = false;

    // Agent integration
    private agentService: AgentService;
    private activeAgent: AgentInfo | null = null;
    private executionMode: AIExecutionMode = 'prompt';
    private onAgentProgressCallback: ((event: AgentProgressEvent) => void) | null = null;

    private constructor() {
        this.agentService = AgentService.getInstance();
    }

    /**
     * Get singleton instance
     */
    static getInstance(): AIService {
        if (!AIService.instance) {
            AIService.instance = new AIService();
        }
        return AIService.instance;
    }

    /**
     * Initialize the AI service
     * Can be called multiple times to re-initialize (e.g., when database connection changes)
     */
    async initialize(force: boolean = false): Promise<boolean> {
        if (this.initialized && !force) {
            return true;
        }

        try {
            OutputChannel.info(this.initialized ? 'Re-initializing AI Service...' : 'Initializing AI Service...');

            // Reset state if re-initializing
            if (this.initialized) {
                this.useRealAI = false;
                this.aiPrompt = null;
                this.contextUser = null;
            }

            // Check if database is connected
            const connectionService = ConnectionService.getInstance();
            const isConnected = connectionService.isConnected;

            if (isConnected) {
                // Get user context
                this.contextUser = connectionService.systemUser || null;

                if (this.contextUser) {
                    // Try to load the AI Prompt for code assistance
                    await this.loadAIPrompt();

                    if (this.aiPrompt) {
                        this.useRealAI = true;
                        OutputChannel.info('AI Service initialized with real AI integration');
                    } else {
                        OutputChannel.info('AI Prompt not found, using fallback mode');
                    }
                } else {
                    OutputChannel.info('No user context available, using fallback mode');
                }
            } else {
                OutputChannel.info('Database not connected, using fallback mode');
            }

            // Add system message to start conversation if not already initialized
            if (!this.initialized) {
                this.conversationHistory.push({
                    role: 'system',
                    content: this.getSystemPrompt(),
                    timestamp: new Date()
                });
            }

            this.initialized = true;
            OutputChannel.info(`AI Service initialized successfully (Mode: ${this.useRealAI ? 'Real AI' : 'Fallback'})`);
            return true;
        } catch (error) {
            OutputChannel.error('Failed to initialize AI Service', error as Error);
            // Initialize in fallback mode
            this.useRealAI = false;
            this.initialized = true;
            return true;
        }
    }

    /**
     * Load the AI Prompt for code assistance from database
     */
    private async loadAIPrompt(): Promise<void> {
        try {
            const rv = new RunView();

            // Search for "MemberJunction Code Assistant" prompt or similar
            OutputChannel.info(`Searching for AI Prompt with entity: 'AI Prompts'`);
            const result = await rv.RunView<AIPromptEntityExtended>({
                EntityName: 'AI Prompts',
                ExtraFilter: `Name LIKE '%Code%Assistant%' OR Name LIKE '%VSCode%'`,
                OrderBy: 'Name',
                ResultType: 'entity_object'
            }, this.contextUser || undefined);

            OutputChannel.info(`RunView result - Success: ${result.Success}, Results count: ${result.Results?.length || 0}`);
            if (!result.Success) {
                OutputChannel.warn(`RunView failed: ${result.ErrorMessage || 'Unknown error'}`);
            }

            if (result.Success && result.Results && result.Results.length > 0) {
                this.aiPrompt = result.Results[0];
                OutputChannel.info(`Loaded AI Prompt: ${this.aiPrompt.Name}`);
            } else {
                // Try to find any general-purpose prompt
                OutputChannel.info(`Trying fallback query for any active AI Prompt`);
                const fallbackResult = await rv.RunView<AIPromptEntityExtended>({
                    EntityName: 'AI Prompts',
                    ExtraFilter: `Status='Active'`,
                    OrderBy: 'Name',
                    MaxRows: 1,
                    ResultType: 'entity_object'
                }, this.contextUser || undefined);

                OutputChannel.info(`Fallback result - Success: ${fallbackResult.Success}, Results count: ${fallbackResult.Results?.length || 0}`);
                if (!fallbackResult.Success) {
                    OutputChannel.warn(`Fallback RunView failed: ${fallbackResult.ErrorMessage || 'Unknown error'}`);
                }

                if (fallbackResult.Success && fallbackResult.Results && fallbackResult.Results.length > 0) {
                    this.aiPrompt = fallbackResult.Results[0];
                    OutputChannel.info(`Using fallback AI Prompt: ${this.aiPrompt.Name}`);
                } else {
                    OutputChannel.warn('No AI Prompts found in database');
                }
            }
        } catch (error) {
            OutputChannel.error('Failed to load AI Prompt', error as Error);
            this.aiPrompt = null;
        }
    }

    /**
     * Set the current entity context for AI interactions
     */
    setEntityContext(entity: EntityInfo | null): void {
        this.currentEntityContext = entity;
        if (entity) {
            OutputChannel.info(`AI context set to entity: ${entity.name}`);
        }
    }

    /**
     * Get the current entity context
     */
    getEntityContext(): EntityInfo | null {
        return this.currentEntityContext;
    }

    /**
     * Send a message to the AI and get a response
     */
    async sendMessage(userMessage: string, includeHistory: boolean = true): Promise<ChatMessage> {
        if (!this.initialized) {
            throw new Error('AI Service not initialized. Call initialize() first.');
        }

        try {
            // Add user message to history
            const userChatMessage: ChatMessage = {
                role: 'user',
                content: userMessage,
                timestamp: new Date(),
                entityContext: this.currentEntityContext?.name
            };
            this.conversationHistory.push(userChatMessage);

            // Build context for the AI
            const context = await this.buildContext();

            let responseText: string;

            if (this.useRealAI && this.aiPrompt && this.contextUser) {
                // Use real AI integration
                responseText = await this.executeAIPrompt(userMessage, context, includeHistory);
            } else {
                // Use fallback placeholder
                responseText = this.generatePlaceholderResponse(userMessage, context);
            }

            // Add assistant response to history
            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: responseText,
                timestamp: new Date(),
                entityContext: this.currentEntityContext?.name
            };
            this.conversationHistory.push(assistantMessage);

            return assistantMessage;

        } catch (error) {
            OutputChannel.error('Failed to send message to AI', error as Error);

            // Return error message
            const errorMessage: ChatMessage = {
                role: 'assistant',
                content: `I encountered an error: ${(error as Error).message}. ${this.useRealAI ? 'The AI service may be temporarily unavailable.' : 'Please ensure your MemberJunction workspace is properly configured with database connectivity.'}`,
                timestamp: new Date()
            };
            this.conversationHistory.push(errorMessage);
            return errorMessage;
        }
    }

    /**
     * Execute the AI Prompt using MemberJunction AI system
     */
    private async executeAIPrompt(userMessage: string, context: string, includeHistory: boolean): Promise<string> {
        try {
            OutputChannel.info('Executing AI prompt with real AI...');

            // Create AI prompt parameters
            const promptParams = new AIPromptParams();
            promptParams.prompt = this.aiPrompt!;
            promptParams.contextUser = this.contextUser!;

            // Build data object with context
            const data: Record<string, unknown> = {
                userMessage,
                systemPrompt: this.getSystemPrompt(),
                entityContext: this.currentEntityContext ? {
                    name: this.currentEntityContext.name,
                    description: this.currentEntityContext.description,
                    baseTable: this.currentEntityContext.baseTable,
                    schema: this.currentEntityContext.schemaName,
                    fields: this.currentEntityContext.fields.slice(0, 20).map(f => ({
                        name: f.name,
                        type: f.type,
                        isPrimaryKey: f.isPrimaryKey,
                        relatedEntity: f.relatedEntity
                    }))
                } : null,
                additionalContext: context
            };

            promptParams.data = data;

            // Add conversation history if requested
            if (includeHistory && this.conversationHistory.length > 1) {
                const history: MJChatMessage[] = this.conversationHistory
                    .filter(m => m.role !== 'system')
                    .slice(-10) // Last 5 exchanges
                    .map(m => ({
                        role: m.role === 'assistant' ? 'assistant' : 'user',
                        content: m.content
                    } as MJChatMessage));

                promptParams.conversationMessages = history;
            }

            // Execute the prompt
            const runner = new AIPromptRunner();
            const result = await runner.ExecutePrompt(promptParams);

            if (!result.success) {
                throw new Error(result.errorMessage || 'AI execution failed');
            }

            // Extract response text
            const responseText = this.extractResponseText(result);
            OutputChannel.info('AI prompt executed successfully');

            return responseText;

        } catch (error) {
            OutputChannel.error('AI prompt execution failed', error as Error);
            // Fall back to placeholder on error
            return this.generatePlaceholderResponse(userMessage, context) +
                `\n\n*Note: AI execution encountered an error: ${(error as Error).message}. Using fallback mode.*`;
        }
    }

    /**
     * Extract response text from AI result
     */
    private extractResponseText(result: unknown): string {
        // Type guard helper
        const isObject = (val: unknown): val is Record<string, unknown> =>
            typeof val === 'object' && val !== null;

        if (!isObject(result)) {
            return String(result);
        }

        // Handle different possible response formats from AIPromptRunResult
        if (typeof result.result === 'string') {
            return result.result;
        }

        if (isObject(result.result)) {
            if (typeof result.result.text === 'string') {
                return result.result.text;
            }
            if (typeof result.result.content === 'string') {
                return result.result.content;
            }
        }

        if (typeof result.rawResult === 'string') {
            return result.rawResult;
        }

        if (isObject(result.chatResult) && typeof result.chatResult.content === 'string') {
            return result.chatResult.content;
        }

        // Fallback
        return JSON.stringify(result.result || result);
    }

    /**
     * Ask AI about a specific entity
     */
    async askAboutEntity(entity: EntityInfo, question: string): Promise<ChatMessage> {
        this.setEntityContext(entity);
        const entityQuestion = `Regarding the "${entity.name}" entity: ${question}`;
        return this.sendMessage(entityQuestion);
    }

    /**
     * Ask AI to explain code
     */
    async explainCode(code: string, language: string = 'typescript'): Promise<ChatMessage> {
        const prompt = `Please explain the following ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``;
        return this.sendMessage(prompt);
    }

    /**
     * Ask AI to generate code
     */
    async generateCode(description: string, targetEntity?: EntityInfo): Promise<ChatMessage> {
        if (targetEntity) {
            this.setEntityContext(targetEntity);
        }
        const prompt = `Please generate TypeScript code for: ${description}${targetEntity ? `\n\nTarget entity: ${targetEntity.name}` : ''}`;
        return this.sendMessage(prompt);
    }

    /**
     * Get conversation history
     */
    getConversationHistory(): ChatMessage[] {
        return [...this.conversationHistory];
    }

    /**
     * Clear conversation history
     */
    clearConversation(): void {
        this.conversationHistory = [{
            role: 'system',
            content: this.getSystemPrompt(),
            timestamp: new Date()
        }];
        this.currentEntityContext = null;
        OutputChannel.info('AI conversation cleared');
    }

    /**
     * Get system prompt that defines the AI assistant's behavior
     */
    private getSystemPrompt(): string {
        return `You are an expert MemberJunction development assistant. MemberJunction is a metadata-driven application development platform.

Your role is to help developers:
1. Understand MemberJunction entities and their relationships
2. Write code that follows MemberJunction best practices
3. Navigate the MemberJunction architecture
4. Debug issues and provide solutions

Key MemberJunction concepts you should know:
- Entities: Database-backed objects with TypeScript classes generated from metadata
- BaseEntity: All entity classes inherit from this base class with CRUD operations
- Metadata: The Metadata class provides access to entity definitions and schema
- RunView: Used for querying entity data with filters, sorting, and pagination
- CodeGen: Generates TypeScript, SQL, and Angular code from database schema
- Actions: Metadata-driven abstraction layer for workflow and agent integration

Best practices:
- Always use GetEntityObject() from Metadata, never instantiate entities directly
- Use RunView with ResultType: 'entity_object' for type-safe entity loading
- Check RunView result.Success before using result.Results
- Pass contextUser to server-side operations
- Never use 'any' types - MJ provides strong typing throughout

Always provide code examples when relevant, reference specific MemberJunction packages and classes, and follow the coding standards from the MemberJunction documentation.`;
    }

    /**
     * Build context for the AI based on current state
     */
    private async buildContext(): Promise<string> {
        const contextParts: string[] = [];

        // Add entity context if available
        if (this.currentEntityContext) {
            contextParts.push(`Current Entity: ${this.currentEntityContext.name}`);
            contextParts.push(`Description: ${this.currentEntityContext.description || 'No description'}`);
            contextParts.push(`Base Table: ${this.currentEntityContext.baseTable}`);
            contextParts.push(`Schema: ${this.currentEntityContext.schemaName}`);

            // Add field information
            if (this.currentEntityContext.fields.length > 0) {
                contextParts.push(`\nFields (${this.currentEntityContext.fields.length}):`);
                this.currentEntityContext.fields.slice(0, 10).forEach(field => {
                    contextParts.push(`  - ${field.name}: ${field.type}${field.isPrimaryKey ? ' (PK)' : ''}${field.relatedEntity ? ` -> ${field.relatedEntity}` : ''}`);
                });
                if (this.currentEntityContext.fields.length > 10) {
                    contextParts.push(`  ... and ${this.currentEntityContext.fields.length - 10} more fields`);
                }
            }
        }

        return contextParts.join('\n');
    }

    /**
     * Generate a placeholder response (used as fallback)
     */
    private generatePlaceholderResponse(userMessage: string, context: string): string {
        const lowerMessage = userMessage.toLowerCase();

        // Provide contextual responses based on keywords
        if (lowerMessage.includes('entity') || lowerMessage.includes('entities')) {
            if (this.currentEntityContext) {
                return `I can see you're asking about the **${this.currentEntityContext.name}** entity.\n\n${context}\n\n**Fallback Mode**: To enable full AI assistance with intelligent responses, please connect your MemberJunction workspace to a database with configured AI models. The AI Assistant will then provide context-aware responses powered by your chosen LLM (OpenAI, Claude, Gemini, etc.).`;
            }
            return `To help you with entity-related questions, please select an entity from the Entity Explorer or provide more context about which entity you're interested in.\n\n**Fallback Mode**: Full AI assistance requires MemberJunction workspace configuration with database connectivity.`;
        }

        if (lowerMessage.includes('code') || lowerMessage.includes('generate')) {
            return `I can help you generate MemberJunction code! Here's a basic example:\n\n\`\`\`typescript\nimport { Metadata, RunView } from '@memberjunction/core';\n\nconst md = new Metadata();\nconst entity = await md.GetEntityObject('EntityName', contextUser);\nconst rv = new RunView();\nconst result = await rv.RunView({\n    EntityName: 'EntityName',\n    ResultType: 'entity_object'\n}, contextUser);\n\nif (result.Success) {\n    const entities = result.Results;\n    // Work with entities\n}\n\`\`\`\n\n**Fallback Mode**: Connect to MemberJunction database with AI configuration for intelligent, context-specific code generation.`;
        }

        if (lowerMessage.includes('how') || lowerMessage.includes('what') || lowerMessage.includes('explain')) {
            return `I'm here to help explain MemberJunction concepts and code patterns!\n\n**MemberJunction Key Concepts:**\n- **Entities**: Database-backed objects with auto-generated TypeScript classes\n- **BaseEntity**: Base class for all entity classes with built-in CRUD operations\n- **Metadata**: Provides access to entity definitions and schema information\n- **RunView**: Used for querying entity data with filters and sorting\n- **CodeGen**: Generates TypeScript, SQL, and Angular code from schema\n\n**Fallback Mode**: For detailed, AI-powered explanations tailored to your specific code and questions, connect your MemberJunction workspace to a database with configured AI credentials.`;
        }

        // Default response
        return `Hello! I'm the MemberJunction AI Assistant. I can help you with:\n\n- Understanding MemberJunction entities and their relationships\n- Writing code that follows MemberJunction best practices\n- Navigating the MemberJunction architecture\n- Debugging issues and providing solutions\n\n**Current Status**: Fallback mode. To enable full AI capabilities:\n1. Connect your MemberJunction workspace to a database\n2. Configure AI model credentials in your MemberJunction configuration\n3. Ensure an AI Prompt named "Code Assistant" or similar exists in your database\n4. The AI will then use your configured LLM provider (OpenAI, Claude, Gemini, Groq, etc.)\n\nYour question: "${userMessage}"\n\nContext: ${context || 'No entity context set'}`;
    }

    /**
     * Check if real AI is available
     */
    isRealAIAvailable(): boolean {
        return this.useRealAI;
    }

    // ========== Agent Integration Methods ==========

    /**
     * Get the current execution mode
     */
    getExecutionMode(): AIExecutionMode {
        return this.executionMode;
    }

    /**
     * Set the execution mode
     */
    setExecutionMode(mode: AIExecutionMode): void {
        this.executionMode = mode;
        OutputChannel.info(`AI execution mode set to: ${mode}`);
    }

    /**
     * Get the currently active agent
     */
    getActiveAgent(): AgentInfo | null {
        return this.activeAgent;
    }

    /**
     * Set the active agent for execution
     */
    setActiveAgent(agent: AgentInfo | null): void {
        this.activeAgent = agent;
        if (agent) {
            this.executionMode = 'agent';
            OutputChannel.info(`Active agent set to: ${agent.name}`);
        } else {
            this.executionMode = 'prompt';
            OutputChannel.info('Agent cleared, switched to prompt mode');
        }
    }

    /**
     * Check if agent mode is available
     */
    isAgentModeAvailable(): boolean {
        return this.agentService.isReady();
    }

    /**
     * List available AI agents
     */
    async listAgents(forceRefresh: boolean = false): Promise<AgentInfo[]> {
        try {
            return await this.agentService.listAgents(forceRefresh);
        } catch (error) {
            OutputChannel.error('Failed to list agents', error as Error);
            return [];
        }
    }

    /**
     * Set callback for agent progress events
     */
    setAgentProgressCallback(callback: ((event: AgentProgressEvent) => void) | null): void {
        this.onAgentProgressCallback = callback;
    }

    /**
     * Send a message using the current execution mode (prompt or agent)
     */
    async sendMessageWithMode(userMessage: string, includeHistory: boolean = true): Promise<ChatMessage> {
        if (this.executionMode === 'agent' && this.activeAgent) {
            return this.sendMessageToAgent(userMessage, includeHistory);
        }
        return this.sendMessage(userMessage, includeHistory);
    }

    /**
     * Send a message to the active agent
     */
    async sendMessageToAgent(userMessage: string, includeHistory: boolean = true): Promise<ChatMessage> {
        console.log('[AIService] sendMessageToAgent called');
        console.log('[AIService] initialized:', this.initialized);
        console.log('[AIService] activeAgent:', this.activeAgent?.name);

        if (!this.initialized) {
            console.error('[AIService] Not initialized!');
            throw new Error('AI Service not initialized. Call initialize() first.');
        }

        if (!this.activeAgent) {
            console.error('[AIService] No active agent!');
            throw new Error('No active agent selected. Use setActiveAgent() first.');
        }

        try {
            console.log('[AIService] Building conversation and calling agent...');
            // Add user message to history
            const userChatMessage: ChatMessage = {
                role: 'user',
                content: userMessage,
                timestamp: new Date(),
                entityContext: this.currentEntityContext?.name,
                agentName: this.activeAgent.name
            };
            this.conversationHistory.push(userChatMessage);

            // Build conversation history for agent
            const conversationMessages = includeHistory
                ? this.conversationHistory
                    .filter(m => m.role !== 'system')
                    .slice(-10)
                    .map(m => ({
                        role: m.role as 'user' | 'assistant',
                        content: m.content
                    }))
                : undefined;

            // Execute agent
            OutputChannel.info(`Sending message to agent: ${this.activeAgent.name}`);

            const result = await this.agentService.executeAgent(
                this.activeAgent.name,
                userMessage,
                { conversationMessages },
                this.onAgentProgressCallback || undefined
            );

            // Build response message
            let responseText: string;
            if (result.success) {
                responseText = result.message || 'Agent completed successfully.';
            } else {
                responseText = `Agent execution failed: ${result.error || 'Unknown error'}`;
            }

            // Add assistant response to history
            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: responseText,
                timestamp: new Date(),
                entityContext: this.currentEntityContext?.name,
                agentName: this.activeAgent.name
            };
            this.conversationHistory.push(assistantMessage);

            return assistantMessage;

        } catch (error) {
            OutputChannel.error('Failed to send message to agent', error as Error);

            const errorMessage: ChatMessage = {
                role: 'assistant',
                content: `Agent execution error: ${(error as Error).message}`,
                timestamp: new Date(),
                agentName: this.activeAgent?.name
            };
            this.conversationHistory.push(errorMessage);
            return errorMessage;
        }
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this.conversationHistory = [];
        this.currentEntityContext = null;
        this.initialized = false;
        this.aiPrompt = null;
        this.contextUser = null;
        this.useRealAI = false;
        this.activeAgent = null;
        this.executionMode = 'prompt';
        this.onAgentProgressCallback = null;
        AIService.instance = null;
    }
}
