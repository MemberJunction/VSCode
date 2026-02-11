import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { UserInfo } from '@memberjunction/core';
import { ConnectionService } from './ConnectionService';
import { OutputChannel } from '../common/OutputChannel';

/**
 * Information about a single migration file
 */
export interface MigrationInfo {
    version: string;           // "202601261008"
    description: string;       // "v3.3.x__API_Key_Scopes"
    filePath: string;          // Full path to .sql file
    fileName: string;          // File name only
    type: 'versioned' | 'repeatable' | 'baseline' | 'codegen';
    timestamp: Date;
    status: 'pending' | 'applied' | 'failed' | 'unknown';
    installedOn?: Date;        // From Flyway schema_version table
    executionTime?: number;    // From Flyway schema_version table (milliseconds)
    checksum?: string;         // From Flyway schema_version table
}

/**
 * Applied migration from Flyway schema_version table
 */
export interface AppliedMigration {
    version: string;
    description: string;
    type: string;
    script: string;
    checksum: string;
    installedBy: string;
    installedOn: Date;
    executionTime: number;
    success: boolean;
}

/**
 * Overall migration status
 */
export interface MigrationStatus {
    total: number;
    pending: number;
    applied: number;
    failed: number;
    lastMigration?: MigrationInfo;
    needsBaseline: boolean;
    canQueryDatabase: boolean;
}

/**
 * Result of migration execution
 */
export interface MigrationResult {
    success: boolean;
    message: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    duration: number;
}

/**
 * Service for managing database migrations
 *
 * Responsibilities:
 * - Discover migration files from /migrations/v2/ and /migrations/v3/
 * - Parse migration filenames to extract metadata
 * - Query Flyway schema_version table for applied migrations
 * - Execute migrations via MJCLI
 * - Track migration status with caching
 */
export class MigrationService {
    private static instance: MigrationService;

    private contextUser: UserInfo | null = null;
    private initialized: boolean = false;
    private migrations: MigrationInfo[] = [];
    private appliedMigrations: Map<string, AppliedMigration> = new Map();
    private lastFileRefresh: number = 0;
    private lastDbRefresh: number = 0;
    private readonly FILE_CACHE_TTL = 30000;  // 30 seconds
    private readonly DB_CACHE_TTL = 60000;    // 60 seconds

    private _onStatusChange = new vscode.EventEmitter<MigrationStatus>();
    public readonly onStatusChange = this._onStatusChange.event;

    private constructor() {}

    public static getInstance(): MigrationService {
        if (!MigrationService.instance) {
            MigrationService.instance = new MigrationService();
        }
        return MigrationService.instance;
    }

    /**
     * Initialize the migration service
     */
    public async initialize(): Promise<boolean> {
        if (this.initialized) {
            return true;
        }

        OutputChannel.info('Initializing Migration Service...');

        // Check if we're in an MJ repository
        const mjRoot = this.findMJRoot();
        if (!mjRoot) {
            OutputChannel.warn('Not in MemberJunction repository - Migration Service will not be available');
            return false;
        }

        // Check database connection (optional - can work without it)
        const connectionService = ConnectionService.getInstance();
        if (connectionService.isConnected) {
            this.contextUser = connectionService.systemUser || null;
            OutputChannel.info('Database connection available - will query Flyway table');
        } else {
            OutputChannel.info('No database connection - will show file-based status only');
        }

        this.initialized = true;
        OutputChannel.info('Migration Service initialized');

        // Load migrations on initialization
        await this.refreshMigrations();

        return true;
    }

    /**
     * Find the MemberJunction repository root
     */
    public findMJRoot(): string | null {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return null;
        }

        // Check workspace root
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        if (fs.existsSync(path.join(workspaceRoot, 'mj.config.cjs')) ||
            fs.existsSync(path.join(workspaceRoot, 'migrations'))) {
            return workspaceRoot;
        }

        // Check parent directory (common for monorepo sub-package development)
        const parentDir = path.dirname(workspaceRoot);
        if (fs.existsSync(path.join(parentDir, 'mj.config.cjs')) ||
            fs.existsSync(path.join(parentDir, 'migrations'))) {
            return parentDir;
        }

        return null;
    }

    /**
     * Get migrations path
     */
    private getMigrationsPath(): string | null {
        const mjRoot = this.findMJRoot();
        if (!mjRoot) {
            return null;
        }
        return path.join(mjRoot, 'migrations');
    }

    /**
     * Refresh migration list from file system and database
     */
    public async refreshMigrations(force: boolean = false): Promise<void> {
        const now = Date.now();

        // Refresh file list if cache expired or forced
        if (force || (now - this.lastFileRefresh > this.FILE_CACHE_TTL)) {
            await this.loadMigrationsFromFiles();
            this.lastFileRefresh = now;
        }

        // Refresh database status if cache expired or forced
        if (force || (now - this.lastDbRefresh > this.DB_CACHE_TTL)) {
            await this.loadAppliedMigrations();
            this.lastDbRefresh = now;
        }

        // Update migration statuses
        this.updateMigrationStatuses();

        // Fire status change event
        this._onStatusChange.fire(this.getStatus());
    }

    /**
     * Load migrations from file system
     */
    private async loadMigrationsFromFiles(): Promise<void> {
        const migrationsPath = this.getMigrationsPath();
        if (!migrationsPath || !fs.existsSync(migrationsPath)) {
            OutputChannel.warn('Migrations directory not found');
            this.migrations = [];
            return;
        }

        const migrations: MigrationInfo[] = [];

        // Only scan v3 migrations (v2 is legacy and not needed for v3 databases)
        const versionsToScan = ['v3'];

        // Scan migration directories
        for (const version of versionsToScan) {
            const versionPath = path.join(migrationsPath, version);
            if (!fs.existsSync(versionPath)) {
                continue;
            }

            const files = fs.readdirSync(versionPath);
            for (const file of files) {
                if (!file.endsWith('.sql')) {
                    continue;
                }

                const filePath = path.join(versionPath, file);
                const migration = this.parseMigrationFile(file, filePath);
                if (migration) {
                    migrations.push(migration);
                }
            }
        }

        // Also scan root for repeatable migrations
        const rootFiles = fs.readdirSync(migrationsPath);
        for (const file of rootFiles) {
            if (!file.endsWith('.sql')) {
                continue;
            }

            const filePath = path.join(migrationsPath, file);
            const migration = this.parseMigrationFile(file, filePath);
            if (migration) {
                migrations.push(migration);
            }
        }

        // Sort by timestamp (oldest first)
        migrations.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        this.migrations = migrations;
        OutputChannel.info(`Loaded ${migrations.length} migration files`);
    }

    /**
     * Parse migration filename to extract metadata
     */
    private parseMigrationFile(fileName: string, filePath: string): MigrationInfo | null {
        // Versioned migration: V202601261008__v3.3.x__API_Key_Scopes.sql
        const versionedMatch = fileName.match(/^V(\d{12})__(.+)\.sql$/);
        if (versionedMatch) {
            const [, timestamp, description] = versionedMatch;
            return {
                version: timestamp,
                description: description,
                filePath: filePath,
                fileName: fileName,
                type: 'versioned',
                timestamp: this.parseTimestamp(timestamp),
                status: 'unknown'
            };
        }

        // Baseline migration: B202601122300__v3.0_Baseline.sql
        const baselineMatch = fileName.match(/^B(\d{12})__(.+)\.sql$/);
        if (baselineMatch) {
            const [, timestamp, description] = baselineMatch;
            return {
                version: timestamp,
                description: description,
                filePath: filePath,
                fileName: fileName,
                type: 'baseline',
                timestamp: this.parseTimestamp(timestamp),
                status: 'unknown'
            };
        }

        // Repeatable migration: R__RefreshMetadata.sql
        const repeatableMatch = fileName.match(/^R__(.+)\.sql$/);
        if (repeatableMatch) {
            const [, description] = repeatableMatch;
            return {
                version: 'R',
                description: description,
                filePath: filePath,
                fileName: fileName,
                type: 'repeatable',
                timestamp: new Date(fs.statSync(filePath).mtime),
                status: 'unknown'
            };
        }

        // CodeGen migration: CodeGen_Run_2026-01-23_15-39-13.sql
        const codegenMatch = fileName.match(/^CodeGen_Run_(.+)\.sql$/);
        if (codegenMatch) {
            const [, description] = codegenMatch;
            return {
                version: description,
                description: `CodeGen ${description}`,
                filePath: filePath,
                fileName: fileName,
                type: 'codegen',
                timestamp: new Date(fs.statSync(filePath).mtime),
                status: 'unknown'
            };
        }

        // Unknown format
        OutputChannel.warn(`Unknown migration format: ${fileName}`);
        return null;
    }

    /**
     * Parse timestamp from migration version
     */
    private parseTimestamp(timestamp: string): Date {
        // Format: YYYYMMDDHHMM
        const year = parseInt(timestamp.substring(0, 4), 10);
        const month = parseInt(timestamp.substring(4, 6), 10) - 1; // 0-indexed
        const day = parseInt(timestamp.substring(6, 8), 10);
        const hour = parseInt(timestamp.substring(8, 10), 10);
        const minute = parseInt(timestamp.substring(10, 12), 10);
        return new Date(year, month, day, hour, minute);
    }

    /**
     * Load applied migrations from Flyway schema_version table
     */
    private async loadAppliedMigrations(): Promise<void> {
        // Clear map if no database connection
        const connectionService = ConnectionService.getInstance();
        if (!connectionService.isConnected) {
            this.appliedMigrations.clear();
            return;
        }

        try {
            OutputChannel.info('Querying Flyway schema_version table...');

            // Get the data provider
            const provider = connectionService.getProvider();
            if (!provider) {
                OutputChannel.warn('Data provider not available');
                this.appliedMigrations.clear();
                return;
            }

            // Query Flyway schema_version table
            // MemberJunction uses __mj schema for Flyway table
            const query = `
                SELECT
                    installed_rank,
                    version,
                    description,
                    type,
                    script,
                    checksum,
                    installed_by,
                    installed_on,
                    execution_time,
                    success
                FROM __mj.flyway_schema_history
                ORDER BY installed_rank DESC
            `;

            // ExecuteSQL returns unknown[] directly (array of rows)
            const results = await provider.ExecuteSQL(query, undefined, undefined, this.contextUser || undefined);

            if (!results || !Array.isArray(results)) {
                OutputChannel.warn('ExecuteSQL returned invalid result format');
                this.appliedMigrations.clear();
                return;
            }

            OutputChannel.info(`ExecuteSQL returned ${results.length} rows from flyway_schema_history`);

            if (results.length > 0) {
                // Clear existing data
                this.appliedMigrations.clear();

                let processedCount = 0;
                let skippedCount = 0;

                // Parse results and populate map
                for (const row of results) {
                    // Type guard for row object
                    if (!row || typeof row !== 'object') {
                        skippedCount++;
                        continue;
                    }

                    const rowData = row as Record<string, unknown>;

                    const migration: AppliedMigration = {
                        version: String(rowData.version || ''),
                        description: String(rowData.description || ''),
                        type: String(rowData.type || ''),
                        script: String(rowData.script || ''),
                        checksum: String(rowData.checksum || ''),
                        installedBy: String(rowData.installed_by || ''),
                        installedOn: new Date(rowData.installed_on as string),
                        executionTime: Number(rowData.execution_time) || 0,
                        success: rowData.success === 1 || rowData.success === true
                    };

                    // Use script (filename) as key since version can be NULL for repeatable migrations
                    // Extract just the filename using path.basename (handles both / and \)
                    const scriptName = path.basename(migration.script);

                    // Log first few samples to understand the data
                    if (processedCount < 5) {
                        OutputChannel.info(`Sample ${processedCount + 1} - script: "${migration.script}", extracted: "${scriptName}"`);
                    }

                    this.appliedMigrations.set(scriptName, migration);
                    processedCount++;
                }

                OutputChannel.info(`Processed ${processedCount} rows, skipped ${skippedCount} rows, final Map size: ${this.appliedMigrations.size}`);
            } else {
                OutputChannel.info('No migrations found in Flyway schema_version table (fresh installation)');
                this.appliedMigrations.clear();
            }

        } catch (error) {
            // If table doesn't exist (fresh install), that's fine
            const errorMessage = (error as Error).message;
            if (errorMessage.includes('Invalid object name') ||
                errorMessage.includes('flyway_schema_history')) {
                OutputChannel.info('Flyway schema_version table not found - assuming fresh installation');
            } else {
                OutputChannel.error('Failed to query Flyway schema_version table', error as Error);
            }
            this.appliedMigrations.clear();
        }
    }

    /**
     * Update migration statuses based on applied migrations
     */
    private updateMigrationStatuses(): void {
        for (const migration of this.migrations) {
            // Match by filename, not version (since repeatable migrations have version=NULL in DB)
            const applied = this.appliedMigrations.get(migration.fileName);
            if (applied) {
                migration.status = applied.success ? 'applied' : 'failed';
                migration.installedOn = applied.installedOn;
                migration.executionTime = applied.executionTime;
                migration.checksum = applied.checksum;
            } else {
                // Not in database = pending (unless repeatable, which always runs)
                migration.status = migration.type === 'repeatable' ? 'applied' : 'pending';
            }
        }
    }

    /**
     * Get all migrations
     */
    public getMigrations(): MigrationInfo[] {
        return this.migrations;
    }

    /**
     * Get migration status summary
     */
    public getStatus(): MigrationStatus {
        const total = this.migrations.length;
        const pending = this.migrations.filter(m => m.status === 'pending').length;
        const applied = this.migrations.filter(m => m.status === 'applied').length;
        const failed = this.migrations.filter(m => m.status === 'failed').length;

        const lastMigration = this.migrations
            .filter(m => m.status === 'applied')
            .sort((a, b) => (b.installedOn?.getTime() || 0) - (a.installedOn?.getTime() || 0))[0];

        return {
            total,
            pending,
            applied,
            failed,
            lastMigration,
            needsBaseline: pending === total && total > 0,
            canQueryDatabase: !!this.contextUser
        };
    }

    /**
     * Execute migrations via MJCLI
     */
    public async executeMigrations(options?: { dryRun?: boolean }): Promise<MigrationResult> {
        const mjRoot = this.findMJRoot();
        if (!mjRoot) {
            throw new Error('Could not find MJ repository root');
        }

        // Find MJCLI package
        const mjcliPath = path.join(mjRoot, 'packages', 'MJCLI');
        if (!fs.existsSync(mjcliPath)) {
            throw new Error('MJCLI package not found. Run npm install in the MJ repository.');
        }

        OutputChannel.info('Starting migration execution...');

        const startTime = Date.now();

        // Build command - use mj migrate command from MJ root
        const command = 'npx';
        const args = ['mj', 'migrate'];

        if (options?.dryRun) {
            // Flyway doesn't have a true dry-run, but we can use validate
            args.push('--verbose');
        }

        try {
            const result = await this.executeCommand(command, args, mjRoot);

            const duration = Date.now() - startTime;

            if (result.exitCode === 0) {
                OutputChannel.info(`Migration execution completed successfully in ${duration}ms`);

                // Refresh migrations to update status
                await this.refreshMigrations(true);

                return {
                    success: true,
                    message: 'Migrations executed successfully',
                    exitCode: result.exitCode,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    duration
                };
            } else {
                OutputChannel.error(`Migration execution failed with exit code ${result.exitCode}`);
                OutputChannel.error(result.stderr);

                return {
                    success: false,
                    message: `Migration failed: ${this.parseErrorMessage(result.stderr)}`,
                    exitCode: result.exitCode,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    duration
                };
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = (error as Error).message;

            OutputChannel.error('Migration execution error', error as Error);

            return {
                success: false,
                message: errorMessage,
                exitCode: -1,
                stdout: '',
                stderr: errorMessage,
                duration
            };
        }
    }

    /**
     * Execute command and return result
     */
    private executeCommand(
        command: string,
        args: string[],
        cwd: string
    ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
        return new Promise((resolve) => {
            const childProcess = spawn(command, args, {
                cwd,
                shell: true,
                env: { ...process.env, FORCE_COLOR: '0' }
            });

            let stdout = '';
            let stderr = '';

            childProcess.stdout?.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                // Log migration output
                text.split('\n').forEach((line: string) => {
                    if (line.trim()) {
                        OutputChannel.info(line);
                    }
                });
            });

            childProcess.stderr?.on('data', (data) => {
                const text = data.toString();
                stderr += text;
                // Log error output
                text.split('\n').forEach((line: string) => {
                    if (line.trim()) {
                        OutputChannel.warn(line);
                    }
                });
            });

            childProcess.on('close', (exitCode) => {
                resolve({
                    exitCode: exitCode || 0,
                    stdout,
                    stderr
                });
            });

            childProcess.on('error', (error) => {
                OutputChannel.error('Process error', error);
                resolve({
                    exitCode: -1,
                    stdout,
                    stderr: error.message
                });
            });
        });
    }

    /**
     * Parse error message from migration output
     */
    private parseErrorMessage(stderr: string): string {
        // Try to extract meaningful error message from Flyway output
        const lines = stderr.split('\n');

        // Look for common error patterns
        for (const line of lines) {
            if (line.includes('ERROR:') || line.includes('Error:')) {
                return line.trim();
            }
            if (line.includes('SQLException')) {
                return line.trim();
            }
            if (line.includes('Migration checksum mismatch')) {
                return 'Migration checksum mismatch - files may have been modified after being applied';
            }
        }

        // Return first non-empty line if no specific error found
        for (const line of lines) {
            if (line.trim()) {
                return line.trim();
            }
        }

        return 'Migration execution failed - check output for details';
    }

    /**
     * Read migration SQL content
     */
    public async readMigrationSQL(filePath: string): Promise<string> {
        return fs.readFileSync(filePath, 'utf-8');
    }
}
