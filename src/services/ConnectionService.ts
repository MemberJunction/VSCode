import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { UserInfo } from '@memberjunction/core';
import { OutputChannel } from '../common/OutputChannel';
import * as dotenv from 'dotenv';

// Import from metadata-sync for authentication
import {
    loadMJConfig,
    initializeProvider,
    getSystemUser,
    getDataProvider
} from '@memberjunction/metadata-sync';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectionError {
    message: string;
    code?: string;
    details?: string;
}

/**
 * Service for managing database connection to MemberJunction
 * Uses the same authentication flow as mj-sync CLI
 */
export class ConnectionService {
    private static instance: ConnectionService;
    private _status: ConnectionStatus = 'disconnected';
    private _error: ConnectionError | undefined;
    private _systemUser: UserInfo | undefined;
    private _onStatusChange = new vscode.EventEmitter<ConnectionStatus>();

    public readonly onStatusChange = this._onStatusChange.event;

    private constructor() {}

    public static getInstance(): ConnectionService {
        if (!this.instance) {
            this.instance = new ConnectionService();
        }
        return this.instance;
    }

    /**
     * Current connection status
     */
    public get status(): ConnectionStatus {
        return this._status;
    }

    /**
     * Last connection error (if status is 'error')
     */
    public get error(): ConnectionError | undefined {
        return this._error;
    }

    /**
     * System user (available after successful connection)
     */
    public get systemUser(): UserInfo | undefined {
        return this._systemUser;
    }

    /**
     * Whether the connection is ready for use
     */
    public get isConnected(): boolean {
        return this._status === 'connected' && this._systemUser !== undefined;
    }

    /**
     * Connect to the MemberJunction database
     * Loads config from mj.config.cjs in the workspace root
     */
    public async connect(): Promise<boolean> {
        if (this._status === 'connecting') {
            OutputChannel.warn('Connection already in progress');
            return false;
        }

        if (this._status === 'connected') {
            OutputChannel.info('Already connected');
            return true;
        }

        this.setStatus('connecting');
        this._error = undefined;

        try {
            // Step 1: Find and load mj.config.cjs
            OutputChannel.info('Loading MemberJunction configuration...');
            const config = this.loadConfig();

            if (!config) {
                throw new Error(
                    'Could not find mj.config.cjs in workspace. ' +
                    'Make sure you have a valid MemberJunction configuration file.'
                );
            }

            OutputChannel.info(`Connecting to database: ${config.dbHost}/${config.dbDatabase}`);

            // Step 2: Initialize the data provider (creates DB connection)
            await initializeProvider(config);
            OutputChannel.info('Database provider initialized');

            // Step 3: Get the System user
            this._systemUser = getSystemUser();
            OutputChannel.info(`Connected as System user (ID: ${this._systemUser.ID})`);

            this.setStatus('connected');
            return true;

        } catch (error) {
            const err = error as Error;
            OutputChannel.error('Failed to connect to MemberJunction', err);

            this._error = this.parseConnectionError(err);
            this.setStatus('error');
            return false;
        }
    }

    /**
     * Disconnect from the database
     */
    public async disconnect(): Promise<void> {
        // Note: metadata-sync doesn't export a cleanup function directly
        // The connection pool is managed internally
        this._systemUser = undefined;
        this.setStatus('disconnected');
        this._error = undefined;
        OutputChannel.info('Disconnected from MemberJunction');
    }

    /**
     * Attempt to reconnect
     */
    public async reconnect(): Promise<boolean> {
        await this.disconnect();
        return this.connect();
    }

    /**
     * Load configuration from workspace
     * Also loads .env file if present (like MJCLI does)
     */
    private loadConfig(): ReturnType<typeof loadMJConfig> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            OutputChannel.warn('No workspace folder open');
            return null;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const originalCwd = process.cwd();

        try {
            // Temporarily change to workspace root for config discovery
            process.chdir(workspaceRoot);

            // Load .env file if it exists (like MJCLI does in its init hook)
            const envPath = path.join(workspaceRoot, '.env');
            if (fs.existsSync(envPath)) {
                const result = dotenv.config({ path: envPath });
                if (result.error) {
                    OutputChannel.warn(`Failed to load .env file: ${result.error.message}`);
                } else {
                    OutputChannel.info(`Loaded environment variables from ${envPath}`);
                }
            }

            // Use metadata-sync's config loading (searches for mj.config.cjs)
            const config = loadMJConfig();

            if (config) {
                OutputChannel.info(`Loaded configuration from workspace: ${workspaceRoot}`);

                // Merge environment variables into config (env vars take precedence)
                // This matches how MJCLI handles configuration
                this.mergeEnvVarsIntoConfig(config);
            }

            return config;
        } finally {
            // Restore original working directory
            process.chdir(originalCwd);
        }
    }

    /**
     * Merge environment variables into config object
     * Environment variables take precedence over config file values
     */
    private mergeEnvVarsIntoConfig(config: Record<string, unknown>): void {
        // Database connection settings
        if (process.env.DB_HOST) {
            config.dbHost = process.env.DB_HOST.replace(/^['"]|['"]$/g, '');
        }
        if (process.env.DB_PORT) {
            config.dbPort = parseInt(process.env.DB_PORT.replace(/^['"]|['"]$/g, ''), 10);
        }
        if (process.env.DB_DATABASE) {
            config.dbDatabase = process.env.DB_DATABASE.replace(/^['"]|['"]$/g, '');
        }
        if (process.env.DB_USERNAME) {
            config.dbUsername = process.env.DB_USERNAME.replace(/^['"]|['"]$/g, '');
        }
        if (process.env.DB_PASSWORD) {
            config.dbPassword = process.env.DB_PASSWORD.replace(/^['"]|['"]$/g, '');
        }
        if (process.env.DB_TRUST_SERVER_CERTIFICATE) {
            const val = process.env.DB_TRUST_SERVER_CERTIFICATE.replace(/^['"]|['"]$/g, '').toLowerCase();
            config.dbTrustServerCertificate = val === 'true' || val === 'y' || val === '1' ? 'Y' : 'N';
        }
        if (process.env.DB_ENCRYPT) {
            const val = process.env.DB_ENCRYPT.replace(/^['"]|['"]$/g, '').toLowerCase();
            config.dbEncrypt = val === 'true' || val === 'y' || val === '1' ? 'Y' : 'N';
        }
        if (process.env.DB_INSTANCE_NAME) {
            config.dbInstanceName = process.env.DB_INSTANCE_NAME.replace(/^['"]|['"]$/g, '');
        }
        if (process.env.MJ_CORE_SCHEMA) {
            config.mjCoreSchema = process.env.MJ_CORE_SCHEMA.replace(/^['"]|['"]$/g, '');
        }

        OutputChannel.info(`Database config: ${config.dbHost}:${config.dbPort || 1433}/${config.dbDatabase} as ${config.dbUsername}`);
    }

    /**
     * Parse error into user-friendly format
     */
    private parseConnectionError(error: Error): ConnectionError {
        const message = error.message || 'Unknown connection error';

        // Check for common error patterns
        if (message.includes('ECONNREFUSED')) {
            return {
                message: 'Cannot connect to database server',
                code: 'ECONNREFUSED',
                details: 'Make sure SQL Server is running and accessible'
            };
        }

        if (message.includes('Login failed')) {
            return {
                message: 'Database authentication failed',
                code: 'AUTH_FAILED',
                details: 'Check your database credentials in mj.config.cjs'
            };
        }

        if (message.includes('System user not found')) {
            return {
                message: 'System user not found in database',
                code: 'NO_SYSTEM_USER',
                details: 'Ensure the System user exists in the MemberJunction database'
            };
        }

        if (message.includes('Developer role')) {
            return {
                message: 'System user missing Developer role',
                code: 'NO_DEVELOPER_ROLE',
                details: 'Add the Developer role to the System user in __mj.UserRole'
            };
        }

        if (message.includes('mj.config')) {
            return {
                message: 'Configuration file not found',
                code: 'NO_CONFIG',
                details: 'Create mj.config.cjs in your workspace root'
            };
        }

        return {
            message: message,
            details: error.stack
        };
    }

    /**
     * Update status and fire event
     */
    private setStatus(status: ConnectionStatus): void {
        this._status = status;
        this._onStatusChange.fire(status);
    }

    /**
     * Get data provider (for advanced use)
     */
    public getProvider() {
        if (!this.isConnected) {
            throw new Error('Not connected to MemberJunction');
        }
        return getDataProvider();
    }
}
