import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { OutputChannel } from '../common/OutputChannel';

/**
 * Status of CodeGen detection
 */
export type CodeGenStatus = 'idle' | 'checking' | 'needed' | 'running' | 'completed' | 'error';

/**
 * Information about a detected change that may require CodeGen
 */
export interface CodeGenChange {
    type: 'migration' | 'entity-metadata' | 'schema';
    filePath: string;
    description: string;
    timestamp: Date;
}

/**
 * Result of a CodeGen execution
 */
export interface CodeGenResult {
    success: boolean;
    message: string;
    duration: number;
    generatedFiles: string[];
    errors?: string[];
}

/**
 * Snapshot of generated files for diff preview
 */
interface FileSnapshot {
    path: string;
    content: string;
    exists: boolean;
}

/**
 * Service to manage CodeGen detection and execution
 */
export class CodeGenService {
    private static instance: CodeGenService;

    private _status: CodeGenStatus = 'idle';
    private _pendingChanges: CodeGenChange[] = [];
    private _onStatusChange = new vscode.EventEmitter<CodeGenStatus>();
    private _onChangesDetected = new vscode.EventEmitter<CodeGenChange[]>();

    /** Event fired when CodeGen status changes */
    public readonly onStatusChange = this._onStatusChange.event;

    /** Event fired when changes requiring CodeGen are detected */
    public readonly onChangesDetected = this._onChangesDetected.event;

    private constructor() {}

    public static getInstance(): CodeGenService {
        if (!CodeGenService.instance) {
            CodeGenService.instance = new CodeGenService();
        }
        return CodeGenService.instance;
    }

    /**
     * Current CodeGen status
     */
    get status(): CodeGenStatus {
        return this._status;
    }

    /**
     * Pending changes that may require CodeGen
     */
    get pendingChanges(): CodeGenChange[] {
        return [...this._pendingChanges];
    }

    /**
     * Check if CodeGen is needed based on pending changes
     */
    get isCodeGenNeeded(): boolean {
        return this._pendingChanges.length > 0;
    }

    /**
     * Set the CodeGen status
     */
    private setStatus(status: CodeGenStatus): void {
        this._status = status;
        this._onStatusChange.fire(status);
    }

    /**
     * Find the MJ repository root (looks for mj.config.cjs)
     */
    findMJRoot(): string | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return undefined;
        }

        // Check each workspace folder
        for (const folder of workspaceFolders) {
            const configPath = path.join(folder.uri.fsPath, 'mj.config.cjs');
            if (fs.existsSync(configPath)) {
                return folder.uri.fsPath;
            }

            // Also check parent directories (in case we're in a subdirectory)
            let currentDir = folder.uri.fsPath;
            for (let i = 0; i < 5; i++) {
                const parentDir = path.dirname(currentDir);
                if (parentDir === currentDir) break;

                const parentConfig = path.join(parentDir, 'mj.config.cjs');
                if (fs.existsSync(parentConfig)) {
                    return parentDir;
                }
                currentDir = parentDir;
            }
        }

        // Check sibling directories (common development setup)
        const firstFolder = workspaceFolders[0].uri.fsPath;
        const parentDir = path.dirname(firstFolder);
        const siblings = ['MJ', 'memberjunction', 'MemberJunction'];

        for (const sibling of siblings) {
            const siblingPath = path.join(parentDir, sibling);
            const siblingConfig = path.join(siblingPath, 'mj.config.cjs');
            if (fs.existsSync(siblingConfig)) {
                return siblingPath;
            }
        }

        return undefined;
    }

    /**
     * Get the generated file paths that CodeGen outputs to
     */
    getGeneratedFilePaths(mjRoot: string): string[] {
        return [
            path.join(mjRoot, 'packages', 'MJCoreEntities', 'src', 'generated', 'entity_subclasses.ts'),
            path.join(mjRoot, 'packages', 'GeneratedEntities', 'src', 'generated', 'entity_subclasses.ts'),
            path.join(mjRoot, 'packages', 'MJServer', 'src', 'generated', 'generated.ts'),
            path.join(mjRoot, 'packages', 'MJAPI', 'src', 'generated', 'generated.ts'),
            path.join(mjRoot, 'packages', 'Actions', 'CoreActions', 'src', 'generated', 'generated.ts'),
            path.join(mjRoot, 'packages', 'GeneratedActions', 'src', 'generated', 'generated.ts'),
        ];
    }

    /**
     * Get migration files directory
     */
    getMigrationsPath(mjRoot: string): string {
        return path.join(mjRoot, 'migrations');
    }

    /**
     * Record a change that may require CodeGen
     */
    addChange(change: CodeGenChange): void {
        // Avoid duplicates
        const exists = this._pendingChanges.some(
            c => c.filePath === change.filePath && c.type === change.type
        );

        if (!exists) {
            this._pendingChanges.push(change);
            this.setStatus('needed');
            this._onChangesDetected.fire(this._pendingChanges);
            OutputChannel.info(`CodeGen change detected: ${change.description}`);
        }
    }

    /**
     * Clear all pending changes
     */
    clearChanges(): void {
        this._pendingChanges = [];
        this.setStatus('idle');
    }

    /**
     * Take a snapshot of generated files for diff comparison
     */
    async snapshotGeneratedFiles(mjRoot: string): Promise<FileSnapshot[]> {
        const filePaths = this.getGeneratedFilePaths(mjRoot);
        const snapshots: FileSnapshot[] = [];

        for (const filePath of filePaths) {
            try {
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    snapshots.push({ path: filePath, content, exists: true });
                } else {
                    snapshots.push({ path: filePath, content: '', exists: false });
                }
            } catch (error) {
                OutputChannel.error(`Failed to snapshot ${filePath}: ${error}`);
                snapshots.push({ path: filePath, content: '', exists: false });
            }
        }

        return snapshots;
    }

    /**
     * Compare current files with snapshots and show diff
     */
    async showDiffPreview(beforeSnapshots: FileSnapshot[], mjRoot: string): Promise<void> {
        const afterSnapshots = await this.snapshotGeneratedFiles(mjRoot);
        const changedFiles: { before: FileSnapshot; after: FileSnapshot }[] = [];

        for (const before of beforeSnapshots) {
            const after = afterSnapshots.find(s => s.path === before.path);
            if (after && before.content !== after.content) {
                changedFiles.push({ before, after });
            }
        }

        if (changedFiles.length === 0) {
            vscode.window.showInformationMessage('No changes detected in generated files.');
            return;
        }

        // Show quick pick to select which file to diff
        const items = changedFiles.map(({ before, after }) => ({
            label: path.basename(before.path),
            description: path.dirname(before.path).replace(mjRoot, ''),
            detail: before.exists ? 'Modified' : 'Created',
            before,
            after
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `${changedFiles.length} file(s) changed. Select to view diff.`,
            title: 'CodeGen Changes'
        });

        if (selected) {
            await this.showFileDiff(selected.before, selected.after);
        }
    }

    /**
     * Show diff between two file snapshots
     */
    private async showFileDiff(before: FileSnapshot, after: FileSnapshot): Promise<void> {
        const beforeUri = vscode.Uri.parse(`codegen-diff:before/${path.basename(before.path)}`);
        const afterUri = vscode.Uri.file(after.path);

        // Register a temporary content provider for the "before" content
        const provider = new (class implements vscode.TextDocumentContentProvider {
            provideTextDocumentContent(): string {
                return before.content;
            }
        })();

        const disposable = vscode.workspace.registerTextDocumentContentProvider('codegen-diff', provider);

        try {
            await vscode.commands.executeCommand(
                'vscode.diff',
                beforeUri,
                afterUri,
                `CodeGen: ${path.basename(before.path)} (Before ↔ After)`
            );
        } finally {
            // Clean up after a delay to allow the diff to open
            setTimeout(() => disposable.dispose(), 5000);
        }
    }

    /**
     * Run CodeGen
     */
    async runCodeGen(options: { skipDb?: boolean } = {}): Promise<CodeGenResult> {
        const mjRoot = this.findMJRoot();

        if (!mjRoot) {
            return {
                success: false,
                message: 'Could not find MemberJunction repository (no mj.config.cjs found)',
                duration: 0,
                generatedFiles: [],
                errors: ['MJ repository not found']
            };
        }

        this.setStatus('running');
        const startTime = Date.now();

        // Take snapshot before running
        const beforeSnapshots = await this.snapshotGeneratedFiles(mjRoot);

        try {
            OutputChannel.info(`Running CodeGen in ${mjRoot}...`);

            const args = options.skipDb ? ['run', 'mj:codegen', '--', '--skipdb'] : ['run', 'mj:codegen'];

            const result = await this.executeCommand('npm', args, mjRoot);

            const duration = Date.now() - startTime;

            if (result.exitCode === 0) {
                this.clearChanges();
                this.setStatus('completed');

                // Determine which files were generated/modified
                const afterSnapshots = await this.snapshotGeneratedFiles(mjRoot);
                const generatedFiles = afterSnapshots
                    .filter((after, i) => {
                        const before = beforeSnapshots[i];
                        return before.content !== after.content;
                    })
                    .map(s => s.path);

                OutputChannel.info(`CodeGen completed successfully in ${duration}ms`);

                return {
                    success: true,
                    message: `CodeGen completed successfully`,
                    duration,
                    generatedFiles
                };
            } else {
                this.setStatus('error');
                OutputChannel.error(`CodeGen failed: ${result.stderr}`);

                return {
                    success: false,
                    message: 'CodeGen failed',
                    duration,
                    generatedFiles: [],
                    errors: [result.stderr || result.stdout || 'Unknown error']
                };
            }
        } catch (error) {
            this.setStatus('error');
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            OutputChannel.error(`CodeGen error: ${errorMessage}`);

            return {
                success: false,
                message: `CodeGen error: ${errorMessage}`,
                duration,
                generatedFiles: [],
                errors: [errorMessage]
            };
        }
    }

    /**
     * Execute a command and return the result
     */
    private executeCommand(
        command: string,
        args: string[],
        cwd: string
    ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
        return new Promise((resolve) => {
            const { spawn } = require('child_process');

            const childProcess = spawn(command, args, {
                cwd,
                shell: true,
                env: { ...process.env, FORCE_COLOR: '0' }
            });

            let stdout = '';
            let stderr = '';

            childProcess.stdout?.on('data', (data: Buffer) => {
                const text = data.toString();
                stdout += text;
                OutputChannel.info(text.trim());
            });

            childProcess.stderr?.on('data', (data: Buffer) => {
                const text = data.toString();
                stderr += text;
                OutputChannel.error(text.trim());
            });

            childProcess.on('close', (code: number) => {
                resolve({ exitCode: code ?? 1, stdout, stderr });
            });

            childProcess.on('error', (error: Error) => {
                resolve({ exitCode: 1, stdout, stderr: error.message });
            });
        });
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this._onStatusChange.dispose();
        this._onChangesDetected.dispose();
    }
}
