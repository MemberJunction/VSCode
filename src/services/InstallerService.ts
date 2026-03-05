import * as vscode from 'vscode';
import { OutputChannel } from '../common/OutputChannel';
import { patchSingleQuotedScripts } from '../utils/patchSingleQuotedScripts';
import { syncDatabaseEnv } from '../utils/syncDatabaseEnv';

// Type-only imports (erased at compile time, no runtime cost).
// The actual module is loaded at runtime via dynamic import() because
// @memberjunction/installer is ESM-only and this extension is CommonJS.
import type {
    InstallerEngine as InstallerEngineType,
    PromptEvent,
    PhaseStartEvent,
    PhaseEndEvent,
    StepProgressEvent,
    LogEvent,
    WarnEvent,
    ErrorEvent,
    DiagnosticEvent,
    InstallPlan,
    InstallResult,
    CreatePlanInput,
    RunOptions,
    DoctorOptions,
    VersionInfo,
    PhaseId,
    SqlConnectivityResult,
} from '@memberjunction/installer';

// Bypass TypeScript's CommonJS transformation of import() → require().
// Required because @memberjunction/installer is ESM-only and require() can't load ESM.
// Using Function constructor creates a real ES import() that TypeScript can't intercept.
const esmImport = new Function('specifier', 'return import(specifier)') as
    (specifier: string) => Promise<typeof import('@memberjunction/installer')>;

// -----------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------

/** Overall status of the installer service. */
export type InstallerStatus = 'idle' | 'planning' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Tracks the visual state of a single install phase. */
export interface PhaseDisplayState {
    Phase: PhaseId;
    Description: string;
    Status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    DurationMs?: number;
    ErrorMessage?: string;
}

/** Tracks a single diagnostic check result. */
export interface DiagnosticDisplayState {
    Check: string;
    Status: 'pass' | 'fail' | 'warn' | 'info';
    Message: string;
    SuggestedFix?: string;
}

/** Human-readable labels for each phase ID. */
const PHASE_LABELS: Record<string, string> = {
    preflight: 'Preflight Checks',
    scaffold: 'Scaffold Project',
    configure: 'Configure Settings',
    database: 'Provision Database',
    platform: 'Platform Compatibility',
    dependencies: 'Install Dependencies',
    migrate: 'Run Migrations',
    codegen: 'Code Generation',
    smoke_test: 'Smoke Test',
};

// -----------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------

/**
 * Singleton service that wraps the headless InstallerEngine and bridges its
 * events to VSCode UI primitives (OutputChannel, notifications, TreeView data).
 */
export class InstallerService {
    private static instance: InstallerService;

    // Dynamic import cache
    private installerModule: typeof import('@memberjunction/installer') | null = null;
    private engine: InstallerEngineType | null = null;

    // Status tracking
    private _status: InstallerStatus = 'idle';
    private _phases: PhaseDisplayState[] = [];
    private _diagnostics: DiagnosticDisplayState[] = [];

    /** Current install target directory — used by the post-platform-phase patch. */
    private _installDir: string | null = null;

    // VSCode event emitters
    private _onStatusChange = new vscode.EventEmitter<InstallerStatus>();
    private _onPhaseUpdate = new vscode.EventEmitter<PhaseDisplayState[]>();
    private _onDiagnosticUpdate = new vscode.EventEmitter<DiagnosticDisplayState[]>();
    private _onLogEntry = new vscode.EventEmitter<{ Level: string; Message: string }>();

    public readonly onStatusChange = this._onStatusChange.event;
    public readonly onPhaseUpdate = this._onPhaseUpdate.event;
    public readonly onDiagnosticUpdate = this._onDiagnosticUpdate.event;
    /** Log entries from the engine (info, verbose, warn, error). */
    public readonly onLogEntry = this._onLogEntry.event;

    private constructor() {}

    public static getInstance(): InstallerService {
        if (!InstallerService.instance) {
            InstallerService.instance = new InstallerService();
        }
        return InstallerService.instance;
    }

    // -----------------------------------------------------------------------
    // Public accessors
    // -----------------------------------------------------------------------

    get status(): InstallerStatus {
        return this._status;
    }

    get phases(): PhaseDisplayState[] {
        return [...this._phases];
    }

    get diagnostics(): DiagnosticDisplayState[] {
        return [...this._diagnostics];
    }

    // -----------------------------------------------------------------------
    // Engine lifecycle
    // -----------------------------------------------------------------------

    /**
     * Lazily load the ESM-only installer module and create a fresh engine.
     * A new engine is created for each operation (install, doctor, resume)
     * so that event listeners don't accumulate across runs.
     */
    private async createEngine(): Promise<InstallerEngineType> {
        if (!this.installerModule) {
            this.installerModule = await esmImport('@memberjunction/installer');
        }
        const engine = new this.installerModule.InstallerEngine();
        this.engine = engine;
        this.wireEvents(engine);
        return engine;
    }

    /** Wire all 8 engine events to VSCode UI outputs. */
    private wireEvents(engine: InstallerEngineType): void {
        engine.On('phase:start', (e: PhaseStartEvent) => this.handlePhaseStart(e));
        engine.On('phase:end', (e: PhaseEndEvent) => this.handlePhaseEnd(e));
        engine.On('step:progress', (e: StepProgressEvent) => this.handleStepProgress(e));
        engine.On('log', (e: LogEvent) => this.handleLog(e));
        engine.On('warn', (e: WarnEvent) => this.handleWarn(e));
        engine.On('error', (e: ErrorEvent) => this.handleError(e));
        engine.On('prompt', (e: PromptEvent) => this.handlePrompt(e));
        engine.On('diagnostic', (e: DiagnosticEvent) => this.handleDiagnostic(e));
    }

    // -----------------------------------------------------------------------
    // Public operations
    // -----------------------------------------------------------------------

    /** Fetch available MJ release versions. */
    async listVersions(includePrerelease: boolean = false): Promise<VersionInfo[]> {
        const engine = await this.createEngine();
        return engine.ListVersions(includePrerelease);
    }

    /** Run a full install flow: create plan → confirm → execute. */
    async install(input: CreatePlanInput, options: RunOptions): Promise<InstallResult | null> {
        this.resetState();
        this._installDir = input.Dir;
        this.setStatus('planning');

        try {
            const engine = await this.createEngine();

            OutputChannel.info(`Creating install plan for ${input.Tag ?? 'latest'} in ${input.Dir}...`);
            const plan = await engine.CreatePlan(input);

            // Initialize phase display state from the plan
            this.initPhaseStates(plan);

            this.setStatus('running');
            OutputChannel.info('Starting installation...');

            const result = await engine.Run(plan, options);

            this.setStatus(result.Success ? 'completed' : 'failed');

            if (result.Success) {
                OutputChannel.info(`Installation completed successfully in ${this.formatDuration(result.DurationMs)}`);
            } else {
                const failedPhases = result.PhasesFailed.join(', ');
                OutputChannel.error(`Installation failed at phase(s): ${failedPhases || 'Unknown'}`);
            }

            return result;
        } catch (err) {
            this.setStatus('failed');
            const message = err instanceof Error ? err.message : String(err);
            OutputChannel.error(`Installation error: ${message}`);
            return null;
        }
    }

    /** Run doctor diagnostics on an existing MJ installation. */
    async doctor(targetDir: string, options?: DoctorOptions): Promise<void> {
        this._diagnostics = [];
        this._onDiagnosticUpdate.fire(this._diagnostics);
        this.setStatus('running');

        try {
            const engine = await this.createEngine();

            OutputChannel.info(`Running doctor diagnostics on ${targetDir}...`);
            await engine.Doctor(targetDir, options);

            this.setStatus('completed');

            const passed = this._diagnostics.filter(d => d.Status === 'pass').length;
            const failed = this._diagnostics.filter(d => d.Status === 'fail').length;
            const warned = this._diagnostics.filter(d => d.Status === 'warn').length;

            OutputChannel.info(`Doctor complete: ${passed} passed, ${warned} warnings, ${failed} failed`);
        } catch (err) {
            this.setStatus('failed');
            const message = err instanceof Error ? err.message : String(err);
            OutputChannel.error(`Doctor error: ${message}`);
        }
    }

    /** Resume a previously interrupted install from checkpoint state. */
    async resume(stateDir: string): Promise<InstallResult | null> {
        this.resetState();
        this._installDir = stateDir;
        this.setStatus('running');

        try {
            const engine = await this.createEngine();

            OutputChannel.info(`Resuming install from ${stateDir}...`);
            const result = await engine.Resume(stateDir);

            this.setStatus(result.Success ? 'completed' : 'failed');
            return result;
        } catch (err) {
            this.setStatus('failed');
            const message = err instanceof Error ? err.message : String(err);
            OutputChannel.error(`Resume error: ${message}`);
            return null;
        }
    }

    /** Cancel a running operation by disposing the engine. */
    cancel(): void {
        if (this.engine) {
            // Remove all listeners to prevent further events
            // The engine doesn't have an explicit cancel, but removing listeners
            // and dereferencing it effectively orphans the operation.
            this.engine = null;
        }
        this.setStatus('cancelled');
        OutputChannel.warn('Install operation cancelled by user');
    }

    /**
     * Test TCP connectivity to a SQL Server instance.
     *
     * Uses the installer's `SqlServerAdapter` for a lightweight TCP-only check
     * (no SQL authentication). Suitable for preflight validation from the wizard.
     */
    async testConnection(host: string, port: number): Promise<SqlConnectivityResult> {
        if (!this.installerModule) {
            this.installerModule = await esmImport('@memberjunction/installer');
        }
        const adapter = new this.installerModule.SqlServerAdapter();
        return adapter.CheckConnectivity(host, port);
    }

    // -----------------------------------------------------------------------
    // Event handlers
    // -----------------------------------------------------------------------

    private handlePhaseStart(e: PhaseStartEvent): void {
        const phase = this.findOrCreatePhase(e.Phase, e.Description);
        phase.Status = 'running';
        this._onPhaseUpdate.fire(this._phases);

        OutputChannel.info(`--- Phase: ${PHASE_LABELS[e.Phase] ?? e.Phase} ---`);
        OutputChannel.info(`  ${e.Description}`);
    }

    private handlePhaseEnd(e: PhaseEndEvent): void {
        const phase = this.findOrCreatePhase(e.Phase);
        phase.Status = e.Status;
        phase.DurationMs = e.DurationMs;
        if (e.Error) {
            phase.ErrorMessage = e.Error.message;
        }
        this._onPhaseUpdate.fire(this._phases);

        const icon = e.Status === 'completed' ? '[OK]' : e.Status === 'failed' ? '[FAIL]' : '[SKIP]';
        OutputChannel.info(`  ${icon} ${PHASE_LABELS[e.Phase] ?? e.Phase} (${this.formatDuration(e.DurationMs)})`);

        // After the configure phase completes, sync critical database env vars
        // from packages/MJAPI/.env into process.env. The root .env may be missing
        // settings like DB_TRUST_SERVER_CERTIFICATE that child processes need
        // (e.g., `npx mj migrate`). Since dotenv doesn't override existing vars,
        // injecting here ensures child processes see the correct values.
        if (e.Phase === 'configure' && e.Status === 'completed' && this._installDir) {
            syncDatabaseEnv(this._installDir);
        }

        // After the platform phase completes, run a supplementary single-quote
        // patch as a safety net. The installer's PlatformCompatPhase handles this
        // too, but under certain conditions (Turbo cache, file-system timing) it
        // may miss some files. This sync pass catches any stragglers before the
        // dependencies phase kicks off `turbo build`.
        if (e.Phase === 'platform' && e.Status === 'completed' && this._installDir) {
            patchSingleQuotedScripts(this._installDir);
        }
    }

    private handleStepProgress(e: StepProgressEvent): void {
        const pct = e.Percent != null ? ` (${e.Percent}%)` : '';
        OutputChannel.info(`  ${e.Message}${pct}`);
    }

    private handleLog(e: LogEvent): void {
        if (e.Level === 'info') {
            OutputChannel.info(e.Message);
        } else {
            // Verbose — only log to channel, not shown unless user opens it
            OutputChannel.log(`[VERBOSE] ${e.Message}`);
        }
        this._onLogEntry.fire({ Level: e.Level, Message: e.Message });
    }

    private handleWarn(e: WarnEvent): void {
        OutputChannel.warn(e.Message);
        vscode.window.showWarningMessage(`MJ Installer: ${e.Message}`);
        this._onLogEntry.fire({ Level: 'warn', Message: e.Message });
    }

    private handleError(e: ErrorEvent): void {
        OutputChannel.error(`[${e.Phase}] ${e.Error.message}`);
        this._onLogEntry.fire({ Level: 'error', Message: `[${e.Phase}] ${e.Error.message}` });

        vscode.window.showErrorMessage(
            `MJ Installer Error (${e.Phase}): ${e.Error.message}`,
            'Show Details'
        ).then(selection => {
            if (selection === 'Show Details') {
                OutputChannel.show();
            }
        });
    }

    /**
     * Map engine prompts to native VSCode input dialogs.
     * This is the critical bridge between the headless engine and VSCode's UI.
     */
    private async handlePrompt(e: PromptEvent): Promise<void> {
        let answer: string | undefined;

        switch (e.PromptType) {
            case 'select': {
                const items = (e.Choices ?? []).map(c => ({
                    label: c.Label,
                    description: c.Value === e.Default ? '(default)' : undefined,
                    value: c.Value,
                }));
                const pick = await vscode.window.showQuickPick(items, {
                    placeHolder: e.Message,
                    title: `MJ Installer: ${e.PromptId}`,
                    ignoreFocusOut: true,
                });
                answer = pick?.value;
                break;
            }
            case 'confirm': {
                const confirmed = await vscode.window.showInformationMessage(
                    e.Message,
                    { modal: true },
                    'Yes',
                    'No'
                );
                answer = confirmed === 'Yes' ? 'true' : 'false';
                break;
            }
            case 'input': {
                answer = await vscode.window.showInputBox({
                    prompt: e.Message,
                    value: e.Default,
                    title: `MJ Installer: ${e.PromptId}`,
                    password: this.isPasswordPrompt(e.PromptId),
                    ignoreFocusOut: true,
                });
                break;
            }
        }

        // Resolve with the answer or fall back to the default
        e.Resolve(answer ?? e.Default ?? '');
    }

    private handleDiagnostic(e: DiagnosticEvent): void {
        const diag: DiagnosticDisplayState = {
            Check: e.Check,
            Status: e.Status,
            Message: e.Message,
            SuggestedFix: e.SuggestedFix,
        };
        this._diagnostics.push(diag);
        this._onDiagnosticUpdate.fire(this._diagnostics);

        const icon =
            e.Status === 'pass' ? '[PASS]' :
            e.Status === 'fail' ? '[FAIL]' :
            e.Status === 'warn' ? '[WARN]' :
            '[INFO]';

        OutputChannel.info(`  ${icon} ${e.Check}: ${e.Message}`);
        if (e.SuggestedFix) {
            OutputChannel.info(`         Fix: ${e.SuggestedFix}`);
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private setStatus(status: InstallerStatus): void {
        this._status = status;
        this._onStatusChange.fire(status);
    }

    private resetState(): void {
        this._phases = [];
        this._diagnostics = [];
        this._onPhaseUpdate.fire(this._phases);
        this._onDiagnosticUpdate.fire(this._diagnostics);
    }

    /** Build initial phase display states from the install plan. */
    private initPhaseStates(plan: InstallPlan): void {
        this._phases = plan.Phases.map(p => ({
            Phase: p.Id,
            Description: p.Description,
            Status: p.Skipped ? 'skipped' : 'pending',
        }));
        this._onPhaseUpdate.fire(this._phases);
    }

    private findOrCreatePhase(phaseId: PhaseId, description?: string): PhaseDisplayState {
        let phase = this._phases.find(p => p.Phase === phaseId);
        if (!phase) {
            phase = {
                Phase: phaseId,
                Description: description ?? PHASE_LABELS[phaseId] ?? phaseId,
                Status: 'pending',
            };
            this._phases.push(phase);
        }
        return phase;
    }

    /** Detect password fields by prompt ID to enable secure input. */
    private isPasswordPrompt(promptId: string): boolean {
        const lower = promptId.toLowerCase();
        return lower.includes('password') || lower.includes('secret') || lower.includes('key');
    }

    private formatDuration(ms?: number): string {
        if (ms == null) return '';
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    }

    // -----------------------------------------------------------------------
    // Disposal
    // -----------------------------------------------------------------------

    dispose(): void {
        this.engine = null;
        this._onStatusChange.dispose();
        this._onPhaseUpdate.dispose();
        this._onDiagnosticUpdate.dispose();
        this._onLogEntry.dispose();
    }
}
