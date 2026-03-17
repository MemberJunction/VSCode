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

// -----------------------------------------------------------------------
// Installer module source configuration
// -----------------------------------------------------------------------
// By default, the extension loads @memberjunction/installer from npm.
// To use a local build instead (e.g., for testing unreleased features),
// comment out INSTALLER_SPECIFIER and uncomment LOCAL_INSTALLER_PATH below.
//
// Local path setup:
//   1. Clone the MJ repo and build the installer:
//        cd <your-mj-repo>/packages/MJInstaller && npm run build
//   2. Set the path below to your local MJInstaller dist directory.
//      Use forward slashes on all platforms (Windows, macOS, Linux).
//      Examples:
//        Windows:  'C:/Dev/MJ/MJ/packages/MJInstaller/dist/index.js'
//        macOS:    '/Users/you/MJ/packages/MJInstaller/dist/index.js'
//        Linux:    '/home/you/MJ/packages/MJInstaller/dist/index.js'
//   3. Recompile the extension: npm run compile

// --- Option A: npm package (default) ---
const INSTALLER_SPECIFIER = '@memberjunction/installer';

// --- Option B: local build (uncomment and set your path) ---
// const INSTALLER_SPECIFIER = 'file:///C:/Dev/MJ/MJ/packages/MJInstaller/dist/index.js';

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

/** Tracks the visual state of a single install phase in the UI (tree view, webview, status bar). */
export interface PhaseDisplayState {
    /** Engine phase identifier (e.g., `'preflight'`, `'database'`, `'codegen'`). */
    Phase: PhaseId;
    /** Human-readable phase description shown in the UI. */
    Description: string;
    /** Current execution status of this phase. */
    Status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    /** Wall-clock duration in milliseconds (set when the phase completes or fails). */
    DurationMs?: number;
    /** Error message captured from the engine when the phase fails. */
    ErrorMessage?: string;
    /** Machine-readable error code from `InstallerError.Code` (e.g., `'NPM_INSTALL_FAILED'`). */
    ErrorCode?: string;
    /** Actionable remediation text from `InstallerError.SuggestedFix`. */
    SuggestedFix?: string;
}

/** Tracks a single diagnostic check result from the doctor flow. */
export interface DiagnosticDisplayState {
    /** Name of the diagnostic check (e.g., `'Node.js version'`, `'Database connectivity'`). */
    Check: string;
    /** Outcome of the check. */
    Status: 'pass' | 'fail' | 'warn' | 'info';
    /** Human-readable detail message for the check result. */
    Message: string;
    /** Actionable remediation text (shown with lightbulb icon in the tree view). */
    SuggestedFix?: string;
}

/** Summary result from the doctor diagnostics flow, sent to the webview for rendering. */
export interface DoctorResult {
    /** Whether any diagnostic check returned `'fail'` status. */
    HasFailures: boolean;
    /** Number of checks that passed. */
    PassCount: number;
    /** Number of checks that returned warnings. */
    WarnCount: number;
    /** Number of checks that failed. */
    FailCount: number;
    /** Environment snapshot captured by the engine (OS, Node, npm, architecture). */
    Environment: { OS: string; NodeVersion: string; NpmVersion: string; Architecture: string };
    /** Details of the last install checkpoint found on disk, or `null` if none exists. */
    LastInstall: { Tag: string; Timestamp: string } | null;
    /** Absolute path to the generated report file (if Report or ReportExtended was requested). */
    ReportPath: string | null;
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

    /** Buffered log entries for replaying to a newly opened wizard panel. */
    private _logBuffer: Array<{ Level: string; Message: string; Timestamp: string }> = [];
    private static readonly MAX_LOG_BUFFER = 500;

    /** Current install target directory — used by the post-platform-phase patch. */
    private _installDir: string | null = null;

    /** Path to the last generated diagnostic report (captured from engine log events). */
    private _lastReportPath: string | null = null;

    // VSCode event emitters
    private _onStatusChange = new vscode.EventEmitter<InstallerStatus>();
    private _onPhaseUpdate = new vscode.EventEmitter<PhaseDisplayState[]>();
    private _onDiagnosticUpdate = new vscode.EventEmitter<DiagnosticDisplayState[]>();
    private _onLogEntry = new vscode.EventEmitter<{ Level: string; Message: string }>();
    private _onStepProgress = new vscode.EventEmitter<{ Phase: string; Message: string; Percent?: number }>();

    public readonly onStatusChange = this._onStatusChange.event;
    public readonly onPhaseUpdate = this._onPhaseUpdate.event;
    public readonly onDiagnosticUpdate = this._onDiagnosticUpdate.event;
    /** Log entries from the engine (info, verbose, warn, error). */
    public readonly onLogEntry = this._onLogEntry.event;
    /** Step-level progress events (download %, build progress, etc.). */
    public readonly onStepProgress = this._onStepProgress.event;

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

    /** Copy of the log buffer — used to replay log entries into a newly opened wizard panel. */
    get logBuffer(): ReadonlyArray<{ Level: string; Message: string; Timestamp: string }> {
        return [...this._logBuffer];
    }

    /** Human-readable phase labels — sent to webview to avoid duplication. */
    get phaseLabels(): Record<string, string> {
        return { ...PHASE_LABELS };
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
            this.installerModule = await esmImport(INSTALLER_SPECIFIER);
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

    /**
     * Create a plan without executing it (for dry-run / preview).
     * Returns the plan summary text from engine.Summarize().
     */
    async createPlan(input: CreatePlanInput): Promise<{ plan: InstallPlan; summary: string } | null> {
        try {
            const engine = await this.createEngine();
            OutputChannel.info(`Creating plan preview for ${input.Tag ?? 'latest'} in ${input.Dir}...`);
            const plan = await engine.CreatePlan(input);
            const summary = plan.Summarize ? plan.Summarize() : 'Plan created.';
            return { plan, summary };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            OutputChannel.error(`Plan creation error: ${message}`);
            return null;
        }
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

    /** Run doctor diagnostics on an existing MJ installation. Returns the Diagnostics object. */
    async doctor(targetDir: string, options?: DoctorOptions): Promise<DoctorResult | null> {
        this._diagnostics = [];
        this._lastReportPath = null;
        this._onDiagnosticUpdate.fire(this._diagnostics);
        this.setStatus('running');

        try {
            const engine = await this.createEngine();

            OutputChannel.info(`Running doctor diagnostics on ${targetDir}...`);
            const diagnostics = await engine.Doctor(targetDir, options);

            this.setStatus('completed');

            const passed = this._diagnostics.filter(d => d.Status === 'pass').length;
            const failed = this._diagnostics.filter(d => d.Status === 'fail').length;
            const warned = this._diagnostics.filter(d => d.Status === 'warn').length;

            OutputChannel.info(`Doctor complete: ${passed} passed, ${warned} warnings, ${failed} failed`);

            return {
                HasFailures: diagnostics.HasFailures,
                PassCount: passed,
                WarnCount: warned,
                FailCount: failed,
                Environment: diagnostics.Environment,
                LastInstall: diagnostics.LastInstall ?? null,
                ReportPath: this._lastReportPath,
            };
        } catch (err) {
            this.setStatus('failed');
            const message = err instanceof Error ? err.message : String(err);
            OutputChannel.error(`Doctor error: ${message}`);
            return null;
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
            this.installerModule = await esmImport(INSTALLER_SPECIFIER);
        }
        const adapter = new this.installerModule.SqlServerAdapter();
        return adapter.CheckConnectivity(host, port);
    }

    /**
     * Check whether a previous install checkpoint exists in the given directory.
     * Returns the serialized state data (version, started time, per-phase status)
     * or null if no checkpoint file is found.
     */
    async checkInstallState(dir: string): Promise<Record<string, unknown> | null> {
        if (!this.installerModule) {
            this.installerModule = await esmImport(INSTALLER_SPECIFIER);
        }
        const exists = await this.installerModule.InstallState.Exists(dir);
        if (!exists) return null;

        const state = await this.installerModule.InstallState.Load(dir);
        return state ? JSON.parse(JSON.stringify(state.ToJSON())) as Record<string, unknown> : null;
    }

    /**
     * Load an install config from a JSON file on disk.
     * Uses the engine's `loadConfigFile()` utility.
     */
    async loadConfigFromFile(filePath: string): Promise<Record<string, unknown>> {
        if (!this.installerModule) {
            this.installerModule = await esmImport(INSTALLER_SPECIFIER);
        }
        const config = await this.installerModule.loadConfigFile(filePath);
        return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
    }

    // -----------------------------------------------------------------------
    // Event handlers
    // -----------------------------------------------------------------------

    /** Handle `phase:start` — mark the phase as running and log it to the output channel. */
    private handlePhaseStart(e: PhaseStartEvent): void {
        const phase = this.findOrCreatePhase(e.Phase, e.Description);
        phase.Status = 'running';
        this._onPhaseUpdate.fire(this._phases);

        OutputChannel.info(`--- Phase: ${PHASE_LABELS[e.Phase] ?? e.Phase} ---`);
        OutputChannel.info(`  ${e.Description}`);
    }

    /**
     * Handle `phase:end` — update status, capture duration/errors, and run post-phase hooks.
     *
     * After the `configure` phase, syncs database env vars into `process.env`.
     * After the `platform` phase, runs a supplementary single-quote script patch.
     */
    private handlePhaseEnd(e: PhaseEndEvent): void {
        const phase = this.findOrCreatePhase(e.Phase);
        phase.Status = e.Status;
        phase.DurationMs = e.DurationMs;
        if (e.Error) {
            phase.ErrorMessage = e.Error.message;
            phase.ErrorCode = (e.Error as { Code?: string }).Code;
            phase.SuggestedFix = (e.Error as { SuggestedFix?: string }).SuggestedFix;
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

    /** Handle `step:progress` — log to output channel and forward to webview via event emitter. */
    private handleStepProgress(e: StepProgressEvent): void {
        const pct = e.Percent != null ? ` (${e.Percent}%)` : '';
        OutputChannel.info(`  ${e.Message}${pct}`);
        this._onStepProgress.fire({ Phase: e.Phase, Message: e.Message, Percent: e.Percent });
    }

    /** Handle `log` — write to output channel, fire event, buffer for replay, and capture report paths. */
    private handleLog(e: LogEvent): void {
        if (e.Level === 'info') {
            OutputChannel.info(e.Message);
        } else {
            // Verbose — only log to channel, not shown unless user opens it
            OutputChannel.log(`[VERBOSE] ${e.Message}`);
        }
        this._onLogEntry.fire({ Level: e.Level, Message: e.Message });
        this.bufferLog(e.Level, e.Message);

        // Capture report path from engine log events
        const reportPrefix = 'Diagnostic report saved to: ';
        if (e.Message.startsWith(reportPrefix)) {
            this._lastReportPath = e.Message.slice(reportPrefix.length).trim();
        }
    }

    /** Handle `warn` — log, show a VS Code warning notification, and buffer for replay. */
    private handleWarn(e: WarnEvent): void {
        OutputChannel.warn(e.Message);
        vscode.window.showWarningMessage(`MJ Installer: ${e.Message}`);
        this._onLogEntry.fire({ Level: 'warn', Message: e.Message });
        this.bufferLog('warn', e.Message);
    }

    /** Handle `error` — log, show a VS Code error notification with "Show Details" action, and buffer. */
    private handleError(e: ErrorEvent): void {
        const msg = `[${e.Phase}] ${e.Error.message}`;
        OutputChannel.error(msg);
        this._onLogEntry.fire({ Level: 'error', Message: msg });
        this.bufferLog('error', msg);

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

    /** Handle `diagnostic` — append to diagnostics array, fire update event, and log to output channel. */
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

    /** Update internal status and fire the status-change event. */
    private setStatus(status: InstallerStatus): void {
        this._status = status;
        this._onStatusChange.fire(status);
    }

    /** Clear all phases, diagnostics, and log buffer — called at the start of each new operation. */
    private resetState(): void {
        this._phases = [];
        this._diagnostics = [];
        this._logBuffer = [];
        this._onPhaseUpdate.fire(this._phases);
        this._onDiagnosticUpdate.fire(this._diagnostics);
    }

    /** Append a log entry to the replay buffer (capped at MAX_LOG_BUFFER). */
    private bufferLog(level: string, message: string): void {
        this._logBuffer.push({ Level: level, Message: message, Timestamp: new Date().toISOString() });
        if (this._logBuffer.length > InstallerService.MAX_LOG_BUFFER) {
            this._logBuffer.shift();
        }
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

    /** Look up an existing phase display state by ID, or create a new one if not found. */
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

    /** Format milliseconds as a human-readable duration string (e.g., "1.2s" or "350ms"). */
    private formatDuration(ms?: number): string {
        if (ms == null) return '';
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    }

    // -----------------------------------------------------------------------
    // Disposal
    // -----------------------------------------------------------------------

    /** Release the engine reference and dispose all VS Code event emitters. */
    dispose(): void {
        this.engine = null;
        this._onStatusChange.dispose();
        this._onPhaseUpdate.dispose();
        this._onDiagnosticUpdate.dispose();
        this._onLogEntry.dispose();
        this._onStepProgress.dispose();
    }
}
