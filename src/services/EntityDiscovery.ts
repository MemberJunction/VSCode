import * as vscode from "vscode";
import * as path from "path";
import {
  Metadata,
  EntityInfo as MJEntityInfo,
  EntityFieldInfo as MJEntityFieldInfo,
} from "@memberjunction/core";
import { EntityInfo, EntityFieldInfo } from "../types";
import { OutputChannel } from "../common/OutputChannel";
import { ConnectionService } from "./ConnectionService";

/**
 * Service for discovering and managing entity information
 * Loads real entity metadata from the connected MemberJunction database
 */
export class EntityDiscovery {
  private static instance: EntityDiscovery;
  private entities: Map<string, EntityInfo> = new Map();
  private initialized: boolean = false;
  private connectionService: ConnectionService;

  private constructor() {
    this.connectionService = ConnectionService.getInstance();
  }

  public static getInstance(): EntityDiscovery {
    if (!this.instance) {
      this.instance = new EntityDiscovery();
    }
    return this.instance;
  }

  /**
   * Initialize and load all entities from the connected database
   * Requires ConnectionService to be connected first
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure we're connected to the database
    if (!this.connectionService.isConnected) {
      OutputChannel.info("Not connected to database, attempting to connect...");
      const connected = await this.connectionService.connect();
      if (!connected) {
        const error = this.connectionService.error;
        throw new Error(
          `Cannot initialize entity discovery: ${error?.message || "Connection failed"}`,
        );
      }
    }

    try {
      OutputChannel.info("Initializing entity discovery from database...");

      // Now that provider is initialized, Metadata will have real data
      const md = new Metadata();

      // Load all entities from metadata
      const mjEntities = md.Entities;

      OutputChannel.info(`Found ${mjEntities.length} entities in database`);

      // Convert MJ entities to our format
      for (const mjEntity of mjEntities) {
        const entityInfo = this.convertMJEntityToEntityInfo(mjEntity);
        this.entities.set(entityInfo.name, entityInfo);
      }

      this.initialized = true;
      OutputChannel.info("Entity discovery initialized successfully");
    } catch (error) {
      OutputChannel.error(
        "Failed to initialize entity discovery",
        error as Error,
      );
      throw error;
    }
  }

  /**
   * Convert MJ EntityInfo to our EntityInfo format
   */
  private convertMJEntityToEntityInfo(mjEntity: MJEntityInfo): EntityInfo {
    const fields: EntityFieldInfo[] = mjEntity.Fields.map(
      (mjField: MJEntityFieldInfo) => ({
        id: mjField.ID?.toString() || "",
        name: mjField.Name,
        displayName: mjField.DisplayName || mjField.Name,
        type: mjField.Type,
        length: mjField.Length,
        allowsNull: mjField.AllowsNull,
        isPrimaryKey: mjField.IsPrimaryKey,
        isUnique: mjField.IsUnique,
        relatedEntity: mjField.RelatedEntity || undefined,
        description: mjField.Description || undefined,
        defaultValue: mjField.DefaultValue || undefined,
        autoIncrement: mjField.AutoIncrement || false,
        isVirtual: mjField.IsVirtual || false,
        readOnly: mjField.ReadOnly || false,
      }),
    );

    return {
      id: mjEntity.ID?.toString() || "",
      name: mjEntity.Name,
      baseTable: mjEntity.BaseTable,
      baseView: mjEntity.BaseView,
      schemaName: mjEntity.SchemaName,
      description: mjEntity.Description || undefined,
      fields,
      isCore: this.isCoreEntity(mjEntity),
      filePath: this.findEntityFilePath(mjEntity.Name),
    };
  }

  /**
   * Check if an entity is a core MemberJunction entity
   * Core entities are those in the __mj schema (or dbo for legacy)
   */
  private isCoreEntity(mjEntity: MJEntityInfo): boolean {
    const schemaName = mjEntity.SchemaName?.toLowerCase() || "";
    // Core entities are in __mj schema, or sometimes dbo for older MJ installations
    // Also check if the name starts with "MJ:" prefix which indicates core entities
    return (
      schemaName === "__mj" ||
      schemaName === "dbo" ||
      mjEntity.Name.startsWith("MJ:")
    );
  }

  /**
   * Find the file path for an entity's TypeScript class
   * Returns undefined if no file is found
   */
  private findEntityFilePath(entityName: string): string | undefined {
    // Try to find the entity file in the workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return undefined;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const className = this.entityNameToClassName(entityName);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");

    // List of potential paths to check (in order of preference)
    const potentialPaths = [
      // Individual entity file in GeneratedEntities
      path.join(
        workspaceRoot,
        "packages",
        "GeneratedEntities",
        "src",
        `${className}.ts`,
      ),
      // Combined entity_subclasses.ts in GeneratedEntities
      path.join(
        workspaceRoot,
        "packages",
        "GeneratedEntities",
        "src",
        "generated",
        "entity_subclasses.ts",
      ),
      // Core entities in local packages (monorepo)
      path.join(
        workspaceRoot,
        "packages",
        "MJCoreEntities",
        "src",
        "generated",
        "entity_subclasses.ts",
      ),
      // Core entities in node_modules
      path.join(
        workspaceRoot,
        "node_modules",
        "@memberjunction",
        "core-entities",
        "src",
        "generated",
        "entity_subclasses.ts",
      ),
    ];

    // Return the first path that exists
    for (const filePath of potentialPaths) {
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }

    return undefined;
  }

  /**
   * Convert entity name to TypeScript class name
   */
  private entityNameToClassName(entityName: string): string {
    // Remove spaces and special characters, capitalize each word
    return (
      entityName
        .split(/[\s_-]+/)
        .map(
          (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join("") + "Entity"
    );
  }

  /**
   * Get all entities
   */
  public getAllEntities(): EntityInfo[] {
    return Array.from(this.entities.values());
  }

  /**
   * Get entity by name
   */
  public getEntity(name: string): EntityInfo | undefined {
    return this.entities.get(name);
  }

  /**
   * Get core entities only
   */
  public getCoreEntities(): EntityInfo[] {
    return this.getAllEntities().filter((e) => e.isCore);
  }

  /**
   * Get custom entities only
   */
  public getCustomEntities(): EntityInfo[] {
    return this.getAllEntities().filter((e) => !e.isCore);
  }

  /**
   * Search entities by name
   */
  public searchEntities(query: string): EntityInfo[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllEntities().filter(
      (e) =>
        e.name.toLowerCase().includes(lowerQuery) ||
        e.description?.toLowerCase().includes(lowerQuery),
    );
  }

  /**
   * Refresh entities (reload from metadata)
   */
  public async refresh(): Promise<void> {
    this.entities.clear();
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Check if initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
}
