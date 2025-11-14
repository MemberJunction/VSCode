import * as path from 'path';
import * as fs from 'fs';
import { OutputChannel } from '../common/OutputChannel';

/**
 * Configuration from .mj-sync.json file
 */
export interface MJSyncConfig {
    entity?: string;
    filePattern?: string;
    defaults?: Record<string, any>;
    version?: string;
    directoryOrder?: string[];
    sqlLogging?: any;
    pull?: any;
    push?: any;
    ignoreDirectories?: string[];
}

/**
 * Discovers metadata roots by walking up filesystem to find .mj-sync.json files
 */
export class MetadataRootDiscovery {
    private static instance: MetadataRootDiscovery;
    private rootCache: Map<string, string | null> = new Map();
    private configCache: Map<string, MJSyncConfig> = new Map();

    private constructor() {}

    public static getInstance(): MetadataRootDiscovery {
        if (!this.instance) {
            this.instance = new MetadataRootDiscovery();
        }
        return this.instance;
    }

    /**
     * Find the metadata root for a given file
     * Walks up the directory tree until we find the root .mj-sync.json
     */
    public async findMetadataRoot(filePath: string): Promise<string | null> {
        const dir = path.dirname(filePath);

        // Check cache first
        if (this.rootCache.has(dir)) {
            return this.rootCache.get(dir) || null;
        }

        // Walk up to find root
        const root = await this.walkUpToFindRoot(dir);

        // Cache result
        this.rootCache.set(dir, root);

        return root;
    }

    /**
     * Get the .mj-sync.json config for a specific directory
     */
    public async getConfig(dirPath: string): Promise<MJSyncConfig | null> {
        // Check cache
        if (this.configCache.has(dirPath)) {
            return this.configCache.get(dirPath) || null;
        }

        const configPath = path.join(dirPath, '.mj-sync.json');

        try {
            const content = await fs.promises.readFile(configPath, 'utf-8');
            const config = JSON.parse(content);
            this.configCache.set(dirPath, config);
            return config;
        } catch (error) {
            this.configCache.set(dirPath, null!);
            return null;
        }
    }

    /**
     * Get the entity name for a file (by walking up to find entity-level .mj-sync.json)
     */
    public async getEntityNameForFile(filePath: string): Promise<string | null> {
        let currentDir = path.dirname(filePath);

        // Walk up looking for entity-level .mj-sync.json
        while (true) {
            const config = await this.getConfig(currentDir);

            if (config?.entity) {
                // Found entity-level config
                return config.entity;
            }

            if (config && this.isRootConfig(config)) {
                // Reached root without finding entity config
                return null;
            }

            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                // Reached filesystem root
                return null;
            }

            currentDir = parentDir;
        }
    }

    /**
     * Walk up directory tree to find metadata root
     */
    private async walkUpToFindRoot(startDir: string): Promise<string | null> {
        let currentDir = startDir;
        let lastDirWithConfig: string | null = null;

        while (true) {
            const config = await this.getConfig(currentDir);

            if (config) {
                lastDirWithConfig = currentDir;

                // Check if this is a ROOT config (has root-only fields)
                if (this.isRootConfig(config)) {
                    OutputChannel.info(`Found metadata root at: ${currentDir}`);
                    return currentDir;
                }
            } else if (lastDirWithConfig) {
                // No config here, but we found one in a child directory
                // The parent of that child is the root
                OutputChannel.info(`Found metadata root (implicit) at: ${lastDirWithConfig}`);
                return lastDirWithConfig;
            }

            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                // Reached filesystem root
                break;
            }

            currentDir = parentDir;
        }

        // Return last directory with config as fallback
        if (lastDirWithConfig) {
            OutputChannel.info(`Found metadata root (fallback) at: ${lastDirWithConfig}`);
        }
        return lastDirWithConfig;
    }

    /**
     * Check if a config is a root-level config (vs entity-level)
     */
    private isRootConfig(config: MJSyncConfig): boolean {
        // Root configs have these fields, entity configs don't
        return !!(config.directoryOrder || config.sqlLogging || config.version);
    }

    /**
     * Invalidate cache for a directory and its descendants
     */
    public invalidateCache(dirPath: string): void {
        // Clear config cache for this directory
        this.configCache.delete(dirPath);

        // Clear root cache for this directory and all descendants
        for (const key of this.rootCache.keys()) {
            if (key.startsWith(dirPath)) {
                this.rootCache.delete(key);
            }
        }

        OutputChannel.info(`Invalidated cache for: ${dirPath}`);
    }

    /**
     * Clear all caches
     */
    public clearCache(): void {
        this.rootCache.clear();
        this.configCache.clear();
        OutputChannel.info('Cleared all metadata caches');
    }
}
