import { AgentRunner } from "@memberjunction/ai-agents";
import {
  ExecuteAgentResult,
  AgentExecutionProgressCallback,
  AIAgentEntityExtended,
} from "@memberjunction/ai-core-plus";
import { RunView, UserInfo } from "@memberjunction/core";
import {
  AgentInfo,
  AgentExecutionOptions,
  AgentExecutionResult,
  AgentProgressEvent,
} from "../types";
import { OutputChannel } from "../common/OutputChannel";
import { ConnectionService } from "./ConnectionService";

/**
 * Service for managing and executing MemberJunction AI Agents
 *
 * Provides:
 * - List available agents
 * - Find agents by name
 * - Execute agents with progress tracking
 * - Integration with VSCode extension UI
 */
export class AgentService {
  private static instance: AgentService | null = null;
  private initialized: boolean = false;
  private contextUser: UserInfo | null = null;
  private cachedAgents: AIAgentEntityExtended[] = [];
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL_MS = 60000; // 1 minute cache

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService();
    }
    return AgentService.instance;
  }

  /**
   * Initialize the agent service
   */
  async initialize(force: boolean = false): Promise<boolean> {
    if (this.initialized && !force) {
      return true;
    }

    try {
      OutputChannel.info("Initializing Agent Service...");

      // Get connection service and check if connected
      const connectionService = ConnectionService.getInstance();

      if (!connectionService.isConnected) {
        OutputChannel.warn(
          "Database not connected - Agent Service will not be available",
        );
        return false;
      }

      // Get user context
      this.contextUser = connectionService.systemUser || null;

      if (!this.contextUser) {
        OutputChannel.warn("No user context available for Agent Service");
        return false;
      }

      this.initialized = true;
      OutputChannel.info("Agent Service initialized successfully");
      return true;
    } catch (error) {
      OutputChannel.error("Failed to initialize Agent Service", error as Error);
      return false;
    }
  }

  /**
   * Check if the service is ready to use
   */
  isReady(): boolean {
    return this.initialized && this.contextUser !== null;
  }

  /**
   * List all available AI agents
   */
  async listAgents(forceRefresh: boolean = false): Promise<AgentInfo[]> {
    if (!this.isReady()) {
      await this.initialize();
      if (!this.isReady()) {
        throw new Error(
          "Agent Service not initialized. Connect to database first.",
        );
      }
    }

    try {
      // Check cache
      const now = Date.now();
      if (
        !forceRefresh &&
        this.cachedAgents.length > 0 &&
        now - this.cacheTimestamp < this.CACHE_TTL_MS
      ) {
        return this.mapAgentsToInfo(this.cachedAgents);
      }

      OutputChannel.info("Loading AI Agents from database...");

      const rv = new RunView();
      const result = await rv.RunView<AIAgentEntityExtended>(
        {
          EntityName: "AI Agents",
          ExtraFilter: `Status = 'Active'`,
          OrderBy: "Name",
          ResultType: "entity_object",
        },
        this.contextUser!,
      );

      if (!result.Success) {
        throw new Error(
          `Failed to load agents: ${result.ErrorMessage || "Unknown error"}`,
        );
      }

      this.cachedAgents = result.Results || [];
      this.cacheTimestamp = now;

      OutputChannel.info(`Loaded ${this.cachedAgents.length} AI Agents`);

      return this.mapAgentsToInfo(this.cachedAgents);
    } catch (error) {
      OutputChannel.error("Failed to list agents", error as Error);
      throw error;
    }
  }

  /**
   * Find an agent by name
   */
  async findAgent(agentName: string): Promise<AIAgentEntityExtended | null> {
    if (!this.isReady()) {
      await this.initialize();
      if (!this.isReady()) {
        return null;
      }
    }

    try {
      // First check cache
      const cachedAgent = this.cachedAgents.find(
        (a) => a.Name?.toLowerCase() === agentName.toLowerCase(),
      );

      if (cachedAgent) {
        return cachedAgent;
      }

      // Query database
      const rv = new RunView();
      const result = await rv.RunView<AIAgentEntityExtended>(
        {
          EntityName: "AI Agents",
          ExtraFilter: `Name = '${agentName.replace(/'/g, "''")}'`,
          ResultType: "entity_object",
        },
        this.contextUser!,
      );

      if (!result.Success || !result.Results || result.Results.length === 0) {
        return null;
      }

      return result.Results[0];
    } catch (error) {
      OutputChannel.error(
        `Failed to find agent "${agentName}"`,
        error as Error,
      );
      return null;
    }
  }

  /**
   * Execute an AI agent
   */
  async executeAgent(
    agentName: string,
    prompt: string,
    options: AgentExecutionOptions = {},
    onProgress?: (event: AgentProgressEvent) => void,
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();

    try {
      OutputChannel.info(
        `[AgentService] executeAgent called for: ${agentName}`,
      );
      console.log(`[AgentService] executeAgent called for: ${agentName}`);

      if (!this.isReady()) {
        OutputChannel.info(
          `[AgentService] Service not ready, attempting to initialize...`,
        );
        console.log(
          `[AgentService] Service not ready, attempting to initialize...`,
        );
        await this.initialize();
        if (!this.isReady()) {
          OutputChannel.error(`[AgentService] Failed to initialize`);
          console.error(`[AgentService] Failed to initialize`);
          return {
            success: false,
            agentName,
            error: "Agent Service not initialized. Connect to database first.",
          };
        }
      }

      OutputChannel.info(`[AgentService] Executing agent: ${agentName}`);

      // Find the agent
      const agent = await this.findAgent(agentName);

      if (!agent) {
        const suggestions = await this.getSimilarAgentNames(agentName);
        const suggestionText =
          suggestions.length > 0
            ? ` Did you mean: ${suggestions.join(", ")}?`
            : "";

        return {
          success: false,
          agentName,
          error: `Agent "${agentName}" not found.${suggestionText}`,
        };
      }

      // Build conversation messages
      const conversationMessages = this.buildConversationMessages(
        prompt,
        options.conversationMessages,
      );

      // Create progress callback
      const progressCallback: AgentExecutionProgressCallback = (progress) => {
        OutputChannel.info(
          `Agent progress: ${progress.step} - ${progress.message}`,
        );

        if (onProgress) {
          onProgress({
            step: progress.step,
            message: progress.message,
            percentage: progress.percentage,
            metadata: progress.metadata,
          });
        }
      };

      // Execute the agent
      // Note: Using type casts due to version mismatches between ai-agents and ai-core-plus packages
      OutputChannel.info(
        `[AgentService] Creating AgentRunner and calling RunAgent...`,
      );
      console.log(
        `[AgentService] Creating AgentRunner and calling RunAgent...`,
      );
      console.log(`[AgentService] Agent:`, agent?.Name);
      console.log(`[AgentService] Context User:`, this.contextUser?.Email);
      console.log(
        `[AgentService] Conversation messages:`,
        conversationMessages?.length,
      );

      const agentRunner = new AgentRunner();

      OutputChannel.info(`[AgentService] Calling agentRunner.RunAgent()...`);
      console.log(`[AgentService] Calling agentRunner.RunAgent()...`);

      // Get all available agents for delegation (important for Sage to know which agents it can delegate to)
      const availableAgents = await this.getAvailableAgentsForDelegation(
        agent.ID,
      );
      console.log(
        `[AgentService] Available agents for delegation: ${availableAgents.length}`,
      );

      const executionResult = await agentRunner.RunAgent({
        agent: agent as unknown as Parameters<
          typeof agentRunner.RunAgent
        >[0]["agent"],
        conversationMessages,
        contextUser: this.contextUser as unknown as Parameters<
          typeof agentRunner.RunAgent
        >[0]["contextUser"],
        onProgress: progressCallback,
        // Pass available agents so Sage knows which agents it can delegate to
        data: {
          ALL_AVAILABLE_AGENTS: availableAgents,
        },
      });

      OutputChannel.info(`[AgentService] RunAgent completed`);
      console.log(`[AgentService] RunAgent completed`, executionResult);

      const duration = Date.now() - startTime;

      if (executionResult && executionResult.success) {
        // Extract the result message
        const message = this.extractResultMessage(
          executionResult as unknown as ExecuteAgentResult,
        );

        OutputChannel.info(
          `Agent "${agentName}" completed successfully in ${duration}ms`,
        );

        return {
          success: true,
          agentName,
          message,
          duration,
          payload: executionResult.payload,
        };
      } else {
        const errorMessage =
          executionResult?.agentRun?.ErrorMessage || "Unknown execution error";

        OutputChannel.error(`Agent "${agentName}" failed: ${errorMessage}`);

        return {
          success: false,
          agentName,
          error: errorMessage,
          duration,
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = (error as Error).message || "Unknown error";

      OutputChannel.error(
        `Agent execution failed: ${errorMessage}`,
        error as Error,
      );

      return {
        success: false,
        agentName,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Get agent info by ID
   */
  async getAgentById(agentId: string): Promise<AgentInfo | null> {
    if (!this.isReady()) {
      await this.initialize();
      if (!this.isReady()) {
        return null;
      }
    }

    try {
      const rv = new RunView();
      const result = await rv.RunView<AIAgentEntityExtended>(
        {
          EntityName: "AI Agents",
          ExtraFilter: `ID = '${agentId.replace(/'/g, "''")}'`,
          ResultType: "entity_object",
        },
        this.contextUser!,
      );

      if (!result.Success || !result.Results || result.Results.length === 0) {
        return null;
      }

      const agent = result.Results[0];
      return {
        id: agent.ID,
        name: agent.Name || "",
        description: agent.Description || undefined,
        status: agent.Status as "Active" | "Disabled" | "Pending",
        agentType: agent.Type || undefined,
      };
    } catch (error) {
      OutputChannel.error(
        `Failed to get agent by ID "${agentId}"`,
        error as Error,
      );
      return null;
    }
  }

  /**
   * Clear the agent cache
   */
  clearCache(): void {
    this.cachedAgents = [];
    this.cacheTimestamp = 0;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.initialized = false;
    this.contextUser = null;
    this.clearCache();
    AgentService.instance = null;
  }

  // ---- Private helpers ----

  /**
   * Get available agents for delegation (excluding the current agent and sub-agents)
   * This is critical for Sage to know which agents it can delegate work to
   */
  private async getAvailableAgentsForDelegation(
    currentAgentId: string,
  ): Promise<Array<{ ID: string; Name: string; Description: string | null }>> {
    try {
      const rv = new RunView();
      const result = await rv.RunView<AIAgentEntityExtended>(
        {
          EntityName: "AI Agents",
          ExtraFilter: `Status = 'Active' AND ID != '${currentAgentId}' AND ParentID IS NULL AND InvocationMode != 'Sub-Agent'`,
          OrderBy: "Name",
          ResultType: "entity_object",
        },
        this.contextUser!,
      );

      if (!result.Success || !result.Results) {
        console.warn(
          "[AgentService] Failed to load available agents for delegation",
        );
        return [];
      }

      return result.Results.map((a) => ({
        ID: a.ID,
        Name: a.Name || "",
        Description: a.Description || null,
      }));
    } catch (error) {
      console.error(
        "[AgentService] Error loading available agents for delegation:",
        error,
      );
      return [];
    }
  }

  private mapAgentsToInfo(agents: AIAgentEntityExtended[]): AgentInfo[] {
    return agents
      .filter((agent) => agent.Name) // Filter out agents without names
      .map((agent) => ({
        id: agent.ID,
        name: agent.Name!,
        description: agent.Description || undefined,
        status: agent.Status as "Active" | "Disabled" | "Pending",
        agentType: agent.Type || undefined,
      }));
  }

  private buildConversationMessages(
    prompt: string,
    history?: Array<{ role: "user" | "assistant"; content: string }>,
  ): Array<{ role: "user" | "assistant"; content: string }> {
    if (history && history.length > 0) {
      // Clone history and append current message
      return [...history, { role: "user" as const, content: prompt }];
    }

    // No history - just the current message
    return [{ role: "user" as const, content: prompt }];
  }

  private extractResultMessage(executionResult: ExecuteAgentResult): string {
    // Try Message field first
    if (executionResult.agentRun?.Message) {
      return executionResult.agentRun.Message;
    }

    // Try FinalPayload
    if (executionResult.agentRun?.FinalPayload) {
      try {
        const payload = JSON.parse(executionResult.agentRun.FinalPayload);
        if (typeof payload === "string") {
          return payload;
        }
        if (payload.message || payload.response || payload.result) {
          return payload.message || payload.response || payload.result;
        }
        return JSON.stringify(payload, null, 2);
      } catch {
        return executionResult.agentRun.FinalPayload;
      }
    }

    // Try payload
    if (executionResult.payload) {
      if (typeof executionResult.payload === "string") {
        return executionResult.payload;
      }
      return JSON.stringify(executionResult.payload, null, 2);
    }

    return "Agent completed successfully (no message returned)";
  }

  private async getSimilarAgentNames(searchName: string): Promise<string[]> {
    try {
      const agents = await this.listAgents();
      const searchLower = searchName.toLowerCase();

      return agents
        .filter(
          (agent) =>
            agent.name.toLowerCase().includes(searchLower) ||
            searchLower.includes(agent.name.toLowerCase()) ||
            this.calculateSimilarity(agent.name.toLowerCase(), searchLower) >
              0.6,
        )
        .map((agent) => agent.name)
        .slice(0, 3);
    } catch {
      return [];
    }
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }
}
