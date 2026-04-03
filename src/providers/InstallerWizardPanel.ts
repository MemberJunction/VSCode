import * as vscode from 'vscode';
import * as fs from 'fs';
import { InstallerService, InstallerStatus, PhaseDisplayState, DiagnosticDisplayState } from '../services/InstallerService';
import { OutputChannel } from '../common/OutputChannel';

// Type-only imports for the installer module types
import type {
    CreatePlanInput,
    RunOptions,
    VersionInfo,
    SqlConnectivityResult,
    DoctorOptions,
} from '@memberjunction/installer';

// ---------------------------------------------------------------------------
// Webview ↔ Extension message types
// ---------------------------------------------------------------------------

/** Messages sent from the webview to the extension host. */
interface WebviewMessage {
    type: string;
    [key: string]: unknown;
}

/** Wizard mode determines which steps are visible. */
type WizardMode = 'install' | 'doctor' | 'resume';

/**
 * Full wizard-style webview panel for MJ Installer.
 *
 * Opens as a tab in the main editor area and walks the user through
 * configuration before executing the install. Replaces the previous
 * QuickPick-based flow with proper forms, validation, and a live
 * progress view.
 *
 * Follows the singleton pattern — only one wizard panel can be open
 * at a time. Calling {@link CreateOrShow} focuses the existing panel
 * or creates a new one.
 */
export class InstallerWizardPanel {
    public static CurrentPanel: InstallerWizardPanel | undefined;
    private static readonly ViewType = 'memberjunction.installerWizard';

    private readonly panel: vscode.WebviewPanel;
    private readonly service: InstallerService;
    private serviceListeners: vscode.Disposable[] = [];
    private disposables: vscode.Disposable[] = [];

    // -----------------------------------------------------------------------
    // Singleton lifecycle
    // -----------------------------------------------------------------------

    /**
     * Create or focus the installer wizard panel.
     *
     * @param extensionUri - The extension's root URI (for webview resource roots).
     * @param mode - Optional initial wizard mode (install, doctor, resume).
     */
    public static CreateOrShow(
        extensionUri: vscode.Uri,
        mode: WizardMode = 'install'
    ): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If panel already exists, reveal it and update the mode
        if (InstallerWizardPanel.CurrentPanel) {
            InstallerWizardPanel.CurrentPanel.panel.reveal(column);
            InstallerWizardPanel.CurrentPanel.sendMessage({ type: 'setMode', mode });
            return;
        }

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            InstallerWizardPanel.ViewType,
            'MJ Installer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            }
        );

        InstallerWizardPanel.CurrentPanel = new InstallerWizardPanel(panel, extensionUri, mode);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        _extensionUri: vscode.Uri,
        initialMode: WizardMode
    ) {
        this.panel = panel;
        this.service = InstallerService.getInstance();

        // Set the HTML content
        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview, initialMode);

        // Listen for messages from the webview
        this.panel.webview.onDidReceiveMessage(
            (message: WebviewMessage) => this.handleMessage(message),
            null,
            this.disposables
        );

        // Listen for panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Wire up installer service events
        this.setupServiceListeners();
    }

    // -----------------------------------------------------------------------
    // Service event forwarding
    // -----------------------------------------------------------------------

    /** Wire service events (phase updates, status changes, diagnostics, step progress, logs) to webview messages. */
    private setupServiceListeners(): void {
        this.serviceListeners.push(
            this.service.onPhaseUpdate((phases: PhaseDisplayState[]) => {
                this.sendMessage({ type: 'phaseUpdate', phases });
            })
        );

        this.serviceListeners.push(
            this.service.onStatusChange((status: InstallerStatus) => {
                this.sendMessage({ type: 'statusChange', status });
            })
        );

        this.serviceListeners.push(
            this.service.onDiagnosticUpdate((diagnostics: DiagnosticDisplayState[]) => {
                this.sendMessage({ type: 'diagnosticUpdate', diagnostics });
            })
        );

        // Step progress forwarding (download %, build progress)
        this.serviceListeners.push(
            this.service.onStepProgress((progress) => {
                this.sendMessage({
                    type: 'stepProgress',
                    phase: progress.Phase,
                    message: progress.Message,
                    percent: progress.Percent,
                });
            })
        );

        // Log entry forwarding (if the service exposes it)
        if (this.service.onLogEntry) {
            this.serviceListeners.push(
                this.service.onLogEntry((entry) => {
                    this.sendMessage({
                        type: 'logEntry',
                        level: entry.Level,
                        message: entry.Message,
                        timestamp: new Date().toISOString(),
                    });
                })
            );
        }
    }

    // -----------------------------------------------------------------------
    // Message handling
    // -----------------------------------------------------------------------

    /** Route incoming webview messages to the appropriate handler method. */
    private async handleMessage(message: WebviewMessage): Promise<void> {
        switch (message.type) {
            case 'ready':
                this.handleReady();
                break;

            case 'browseDirectory':
                await this.handleBrowseDirectory();
                break;

            case 'fetchVersions':
                await this.handleFetchVersions(message.includePrerelease as boolean);
                break;

            case 'testConnection':
                await this.handleTestConnection(
                    message.host as string,
                    message.port as number
                );
                break;

            case 'startInstall':
                await this.handleStartInstall(
                    message.planInput as CreatePlanInput,
                    message.options as RunOptions
                );
                break;

            case 'startDoctor':
                await this.handleStartDoctor(
                    message.targetDir as string,
                    message.options as DoctorOptions | undefined
                );
                break;

            case 'openReportFile':
                if (message.path) {
                    const uri = vscode.Uri.file(message.path as string);
                    vscode.commands.executeCommand('markdown.showPreview', uri);
                }
                break;

            case 'revealReportFile':
                if (message.path) {
                    const uri = vscode.Uri.file(message.path as string);
                    vscode.commands.executeCommand('revealFileInOS', uri);
                }
                break;

            case 'startResume':
                await this.handleStartResume(message.targetDir as string);
                break;

            case 'cancelInstall':
                this.service.cancel();
                break;

            case 'showLog':
                OutputChannel.show();
                break;

            case 'checkState':
                await this.handleCheckState(message.targetDir as string);
                break;

            case 'loadConfig':
                await this.handleLoadConfig();
                break;

            case 'saveConfig':
                await this.handleSaveConfig(message.config as Record<string, unknown>);
                break;

            case 'openFolder': {
                const uri = vscode.Uri.file(message.path as string);
                await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
                break;
            }

            case 'dryRun':
                await this.handleDryRun(message.planInput as CreatePlanInput);
                break;

            case 'showInfo':
                vscode.window.showInformationMessage(String(message.text));
                break;
        }
    }

    /**
     * Handle the webview's `ready` message — send workspace folders and phase labels,
     * then re-attach to any running operation (replaying buffered log entries).
     */
    private handleReady(): void {
        const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(f => ({
            name: f.name,
            path: f.uri.fsPath,
        }));
        this.sendMessage({ type: 'init', workspaceFolders, phaseLabels: this.service.phaseLabels });

        // Re-attach: if an operation is currently in progress, push current state
        // so the webview can jump to the progress view instead of showing Welcome.
        const status = this.service.status;
        if (status === 'running' || status === 'planning') {
            const phases = this.service.phases;
            if (phases.length > 0) {
                this.sendMessage({ type: 'phaseUpdate', phases });
            }
            this.sendMessage({ type: 'statusChange', status });

            // Replay buffered log entries
            for (const entry of this.service.logBuffer) {
                this.sendMessage({
                    type: 'logEntry',
                    level: entry.Level,
                    message: entry.Message,
                    timestamp: entry.Timestamp,
                });
            }

            // Tell webview to jump to progress step
            this.sendMessage({ type: 'reattach', status });
        }
    }

    /** Open a native folder picker and send the selected path back to the webview. */
    private async handleBrowseDirectory(): Promise<void> {
        const folders = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            title: 'Select MJ Installation Directory',
        });

        if (folders && folders.length > 0) {
            this.sendMessage({ type: 'directorySelected', path: folders[0].fsPath });
        }
    }

    /** Fetch available MJ release versions from GitHub and send them to the webview dropdown. */
    private async handleFetchVersions(includePrerelease: boolean): Promise<void> {
        try {
            const versions: VersionInfo[] = await this.service.listVersions(includePrerelease);
            this.sendMessage({
                type: 'versionsLoaded',
                versions: versions.map(v => ({
                    Tag: v.Tag,
                    Name: v.Name ?? v.Tag,
                    ReleaseDate: v.ReleaseDate?.toISOString() ?? null,
                    Prerelease: v.Prerelease,
                    Notes: v.Notes ?? null,
                })),
            });
        } catch {
            this.sendMessage({
                type: 'versionsLoaded',
                versions: [],
                error: 'Failed to fetch versions from GitHub.',
            });
        }
    }

    /** Test TCP connectivity to a SQL Server instance and send the result to the webview. */
    private async handleTestConnection(host: string, port: number): Promise<void> {
        try {
            const result: SqlConnectivityResult = await this.service.testConnection(host, port);
            this.sendMessage({ type: 'connectionTestResult', ...result });
        } catch {
            this.sendMessage({
                type: 'connectionTestResult',
                Reachable: false,
                ErrorMessage: 'Connection test failed unexpectedly.',
                LatencyMs: 0,
            });
        }
    }

    /** Start a full install flow (plan + execute). Guards against duplicate starts. Sends completion result to webview. */
    private async handleStartInstall(
        planInput: CreatePlanInput,
        options: RunOptions
    ): Promise<void> {
        if (this.service.status === 'running' || this.service.status === 'planning') {
            return; // Ignore duplicate start requests
        }
        try {
            const result = await this.service.install(planInput, options);
            this.sendMessage({
                type: 'installComplete',
                success: result?.Success ?? false,
                durationMs: result?.DurationMs ?? 0,
                warnings: result?.Warnings ?? [],
                phasesCompleted: result?.PhasesCompleted ?? [],
                phasesFailed: result?.PhasesFailed ?? [],
            });
        } catch {
            this.sendMessage({
                type: 'installComplete',
                success: false,
                durationMs: 0,
                warnings: [],
                phasesCompleted: [],
                phasesFailed: ['unknown'],
            });
        }
    }

    /** Run doctor diagnostics on a target directory. Guards against duplicate starts. Sends summary to webview. */
    private async handleStartDoctor(
        targetDir: string,
        options?: DoctorOptions
    ): Promise<void> {
        if (this.service.status === 'running' || this.service.status === 'planning') {
            return;
        }
        try {
            const result = await this.service.doctor(targetDir, options);
            if (result) {
                this.sendMessage({
                    type: 'doctorComplete',
                    hasFailures: result.HasFailures,
                    passCount: result.PassCount,
                    warnCount: result.WarnCount,
                    failCount: result.FailCount,
                    environment: result.Environment,
                    lastInstall: result.LastInstall,
                    reportPath: result.ReportPath,
                });
            }
        } catch {
            this.sendMessage({ type: 'statusChange', status: 'failed' });
        }
    }

    /** Resume a previously interrupted install from checkpoint state. Guards against duplicate starts. */
    private async handleStartResume(targetDir: string): Promise<void> {
        if (this.service.status === 'running' || this.service.status === 'planning') {
            return;
        }
        try {
            const result = await this.service.resume(targetDir);
            this.sendMessage({
                type: 'installComplete',
                success: result?.Success ?? false,
                durationMs: result?.DurationMs ?? 0,
                warnings: result?.Warnings ?? [],
                phasesCompleted: result?.PhasesCompleted ?? [],
                phasesFailed: result?.PhasesFailed ?? [],
            });
        } catch {
            this.sendMessage({
                type: 'installComplete',
                success: false,
                durationMs: 0,
                warnings: [],
                phasesCompleted: [],
                phasesFailed: ['unknown'],
            });
        }
    }

    /** Load install checkpoint data for the given directory and send it to the webview. */
    private async handleCheckState(targetDir: string): Promise<void> {
        try {
            const stateData = await this.service.checkInstallState(targetDir);
            this.sendMessage({ type: 'stateLoaded', state: stateData });
        } catch {
            this.sendMessage({ type: 'stateLoaded', state: null });
        }
    }

    /** Prompt user for a JSON config file and send the parsed config to the webview. */
    private async handleLoadConfig(): Promise<void> {
        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'JSON Files': ['json'] },
            title: 'Load Install Configuration',
        });
        if (!files || files.length === 0) return;

        try {
            const config = await this.service.loadConfigFromFile(files[0].fsPath);
            this.sendMessage({ type: 'configLoaded', config });
        } catch {
            vscode.window.showErrorMessage('Failed to load config file.');
        }
    }

    /** Prompt user for a save location and write the install config as JSON. */
    private async handleSaveConfig(config: Record<string, unknown>): Promise<void> {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('mj-install-config.json'),
            filters: { 'JSON Files': ['json'] },
            title: 'Save Install Configuration',
        });
        if (!uri) return;

        try {
            const json = JSON.stringify(config, null, 2);
            fs.writeFileSync(uri.fsPath, json, 'utf-8');
            vscode.window.showInformationMessage(`Config saved to ${uri.fsPath}`);
        } catch {
            vscode.window.showErrorMessage('Failed to save config file.');
        }
    }

    /** Create a plan without executing it and send the summary back to the webview. */
    private async handleDryRun(planInput: CreatePlanInput): Promise<void> {
        try {
            const result = await this.service.createPlan(planInput);
            this.sendMessage({
                type: 'planSummary',
                summary: result?.summary ?? 'No plan summary available.',
            });
        } catch {
            this.sendMessage({
                type: 'planSummary',
                summary: 'Failed to create plan preview.',
            });
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Post a JSON message to the webview panel. */
    private sendMessage(message: Record<string, unknown>): void {
        this.panel.webview.postMessage(message);
    }

    /** Dispose the panel, service listeners, and all VS Code disposables. Clears the singleton reference. */
    public dispose(): void {
        InstallerWizardPanel.CurrentPanel = undefined;

        for (const listener of this.serviceListeners) {
            listener.dispose();
        }
        this.serviceListeners = [];

        this.panel.dispose();

        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }

    // -----------------------------------------------------------------------
    // HTML generation
    // -----------------------------------------------------------------------

    /**
     * Generate the complete HTML document for the wizard webview.
     * Includes all CSS, JS, and the 7-step wizard UI (Welcome, Location, Database, Services, Options, Review, Progress).
     */
    private getHtmlForWebview(_webview: vscode.Webview, initialMode: WizardMode): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MJ Installer</title>
    <style>
        /* ================================================================
           Reset & Base
           ================================================================ */
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        /* ================================================================
           Layout: Header / Content / Footer
           ================================================================ */
        .wizard-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
            min-height: 48px;
        }

        .wizard-header h1 {
            font-size: 16px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .wizard-header .status-badge {
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 10px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }

        .wizard-body {
            display: flex;
            flex: 1;
            overflow: hidden;
        }

        /* ================================================================
           Sidebar: Step List
           ================================================================ */
        .wizard-sidebar {
            width: 220px;
            min-width: 220px;
            border-right: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
            padding: 16px 0;
            overflow-y: auto;
        }

        .step-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 16px;
            cursor: default;
            user-select: none;
            transition: background 0.15s;
        }

        .step-item.clickable {
            cursor: pointer;
        }

        .step-item.clickable:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .step-item.active {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .step-item.disabled {
            opacity: 0.4;
        }

        .step-circle {
            width: 26px;
            height: 26px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 600;
            flex-shrink: 0;
            border: 2px solid var(--vscode-input-border);
            background: transparent;
            color: var(--vscode-foreground);
            transition: all 0.2s;
        }

        .step-item.active .step-circle {
            border-color: var(--vscode-button-background);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .step-item.completed .step-circle {
            border-color: var(--vscode-testing-iconPassed);
            background: var(--vscode-testing-iconPassed);
            color: #fff;
        }

        .step-label {
            font-size: 13px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* ================================================================
           Main Content
           ================================================================ */
        .wizard-content {
            flex: 1;
            overflow-y: auto;
            padding: 24px 32px;
        }

        .step-panel {
            display: none;
            animation: fadeIn 0.2s ease;
        }

        .step-panel.active {
            display: block;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .step-title {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 4px;
        }

        .step-description {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 24px;
            line-height: 1.5;
        }

        /* ================================================================
           Forms
           ================================================================ */
        .form-group {
            margin-bottom: 18px;
        }

        .form-row {
            display: flex;
            gap: 16px;
        }

        .form-row .form-group {
            flex: 1;
        }

        label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 4px;
            color: var(--vscode-foreground);
        }

        label .optional {
            font-weight: 400;
            color: var(--vscode-descriptionForeground);
            margin-left: 4px;
        }

        input[type="text"],
        input[type="number"],
        input[type="password"],
        select {
            width: 100%;
            padding: 6px 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            outline: none;
            transition: border-color 0.15s;
        }

        input:focus, select:focus {
            border-color: var(--vscode-focusBorder);
        }

        input.error, select.error {
            border-color: var(--vscode-inputValidation-errorBorder);
        }

        .field-error {
            color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
            font-size: 11px;
            margin-top: 2px;
        }

        .field-hint {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            margin-top: 2px;
        }

        /* Checkbox styling */
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 10px;
        }

        .checkbox-group input[type="checkbox"] {
            width: 16px;
            height: 16px;
            accent-color: var(--vscode-button-background);
        }

        .checkbox-group label {
            margin-bottom: 0;
            font-weight: 400;
            cursor: pointer;
        }

        /* ================================================================
           Buttons
           ================================================================ */
        button {
            padding: 6px 16px;
            border: none;
            border-radius: 4px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            cursor: pointer;
            transition: opacity 0.15s;
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-primary:hover:not(:disabled) {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover:not(:disabled) {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .btn-icon {
            background: transparent;
            color: var(--vscode-foreground);
            padding: 4px 8px;
        }

        .btn-icon:hover:not(:disabled) {
            background: var(--vscode-toolbar-hoverBackground);
        }

        .btn-danger {
            background: var(--vscode-inputValidation-errorBackground, #d32f2f);
            color: #fff;
        }

        /* ================================================================
           Mode Cards (Step 1)
           ================================================================ */
        .mode-cards {
            display: flex;
            gap: 16px;
            margin-top: 8px;
        }

        .mode-card {
            flex: 1;
            padding: 20px;
            border: 2px solid var(--vscode-input-border);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            text-align: center;
        }

        .mode-card:hover {
            border-color: var(--vscode-button-background);
            background: var(--vscode-list-hoverBackground);
        }

        .mode-card.selected {
            border-color: var(--vscode-button-background);
            background: color-mix(in srgb, var(--vscode-button-background) 15%, transparent);
        }

        .mode-card .mode-icon {
            font-size: 28px;
            margin-bottom: 8px;
        }

        .mode-card .mode-title {
            font-size: 15px;
            font-weight: 600;
            margin-bottom: 4px;
        }

        .mode-card .mode-desc {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.4;
        }

        /* ================================================================
           Directory + Version (Step 2)
           ================================================================ */
        .dir-input-row {
            display: flex;
            gap: 8px;
        }

        .dir-input-row input {
            flex: 1;
        }

        .workspace-shortcuts {
            margin-top: 8px;
        }

        .workspace-shortcut {
            display: inline-block;
            padding: 4px 10px;
            margin: 2px 4px 2px 0;
            font-size: 12px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 12px;
            cursor: pointer;
            border: none;
            transition: opacity 0.15s;
        }

        .workspace-shortcut:hover {
            opacity: 0.8;
        }

        /* ================================================================
           Test Connection
           ================================================================ */
        .connection-result {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-top: 8px;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 12px;
        }

        .connection-result.success {
            background: color-mix(in srgb, var(--vscode-testing-iconPassed) 15%, transparent);
            color: var(--vscode-testing-iconPassed);
        }

        .connection-result.failure {
            background: color-mix(in srgb, var(--vscode-testing-iconFailed) 15%, transparent);
            color: var(--vscode-testing-iconFailed);
        }

        /* ================================================================
           Collapsible Sections (Step 5)
           ================================================================ */
        .collapsible {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            margin-bottom: 14px;
        }

        .collapsible-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            cursor: pointer;
            user-select: none;
            font-weight: 600;
            font-size: 13px;
        }

        .collapsible-header:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .collapsible-chevron {
            transition: transform 0.2s;
        }

        .collapsible.open .collapsible-chevron {
            transform: rotate(90deg);
        }

        .collapsible-body {
            display: none;
            padding: 0 14px 14px 14px;
        }

        .collapsible.open .collapsible-body {
            display: block;
        }

        /* ================================================================
           Auth Provider (Step 4)
           ================================================================ */
        .auth-fields {
            display: none;
            margin-top: 12px;
            padding: 14px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            background: var(--vscode-input-background);
        }

        .auth-fields.visible {
            display: block;
        }

        /* ================================================================
           Review Table (Step 6)
           ================================================================ */
        .review-table {
            width: 100%;
            border-collapse: collapse;
        }

        .review-table th,
        .review-table td {
            text-align: left;
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 13px;
        }

        .review-table th {
            font-weight: 600;
            width: 200px;
            color: var(--vscode-descriptionForeground);
        }

        .review-section-header {
            background: var(--vscode-sideBar-background);
            font-weight: 600;
            font-size: 13px;
            color: var(--vscode-foreground);
        }

        .review-section-header td {
            padding: 10px 12px;
        }

        .review-edit-link {
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            font-size: 12px;
            float: right;
        }

        .review-edit-link:hover {
            text-decoration: underline;
        }

        /* ================================================================
           Progress View (Step 7)
           ================================================================ */
        .phase-timeline {
            margin-bottom: 20px;
        }

        .phase-item {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 8px 0;
            position: relative;
        }

        .phase-item:not(:last-child)::before {
            content: '';
            position: absolute;
            left: 12px;
            top: 32px;
            bottom: -8px;
            width: 2px;
            background: var(--vscode-panel-border);
        }

        .phase-icon {
            width: 26px;
            height: 26px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            flex-shrink: 0;
            z-index: 1;
        }

        .phase-icon.pending {
            border: 2px solid var(--vscode-input-border);
            color: var(--vscode-descriptionForeground);
        }

        .phase-icon.running {
            border: 2px solid var(--vscode-progressBar-background);
            color: var(--vscode-progressBar-background);
            animation: pulse 1.5s ease-in-out infinite;
        }

        .phase-icon.completed {
            background: var(--vscode-testing-iconPassed);
            color: #fff;
            border: none;
        }

        .phase-icon.failed {
            background: var(--vscode-testing-iconFailed);
            color: #fff;
            border: none;
        }

        .phase-icon.skipped {
            border: 2px solid var(--vscode-input-border);
            color: var(--vscode-descriptionForeground);
            background: var(--vscode-input-background);
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .phase-details {
            flex: 1;
            min-width: 0;
        }

        .phase-name {
            font-weight: 600;
            font-size: 13px;
        }

        .phase-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .phase-duration {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-left: auto;
            flex-shrink: 0;
        }

        .phase-error {
            margin-top: 4px;
            padding: 6px 10px;
            background: color-mix(in srgb, var(--vscode-testing-iconFailed) 10%, transparent);
            border-radius: 4px;
            font-size: 12px;
            color: var(--vscode-testing-iconFailed);
        }

        .phase-progress-msg {
            font-size: 12px;
            color: var(--vscode-progressBar-background);
            margin-top: 2px;
        }

        /* Log Area */
        .log-area {
            background: var(--vscode-terminal-background, var(--vscode-editor-background));
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 10px;
            max-height: 250px;
            overflow-y: auto;
            font-family: var(--vscode-editor-fontFamily, 'Consolas, monospace');
            font-size: 12px;
            line-height: 1.6;
        }

        .log-line {
            white-space: pre-wrap;
            word-break: break-all;
        }

        .log-line.info { color: var(--vscode-terminal-foreground, var(--vscode-foreground)); }
        .log-line.warn { color: var(--vscode-terminal-ansiYellow, #e5c07b); }
        .log-line.error { color: var(--vscode-terminal-ansiRed, #e06c75); }
        .log-line.verbose { color: var(--vscode-descriptionForeground); }

        .log-filter-btn {
            padding: 2px 8px;
            font-size: 11px;
            border: 1px solid var(--vscode-button-secondaryBorder, var(--vscode-panel-border));
            background: transparent;
            color: var(--vscode-foreground);
            border-radius: 3px;
            cursor: pointer;
            opacity: 0.7;
        }
        .log-filter-btn.active {
            opacity: 1;
            background: var(--vscode-button-secondaryBackground);
        }
        .log-filter-btn:hover {
            opacity: 1;
        }

        /* Completion Banners */
        .completion-banner {
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            text-align: center;
        }

        .completion-banner.success {
            background: color-mix(in srgb, var(--vscode-testing-iconPassed) 15%, transparent);
            border: 1px solid var(--vscode-testing-iconPassed);
        }

        .completion-banner.failure {
            background: color-mix(in srgb, var(--vscode-testing-iconFailed) 15%, transparent);
            border: 1px solid var(--vscode-testing-iconFailed);
        }

        .completion-banner h2 {
            font-size: 18px;
            margin-bottom: 8px;
        }

        .completion-banner p {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
        }

        .completion-banner .btn-row {
            display: flex;
            justify-content: center;
            gap: 10px;
        }

        /* Diagnostic Items (Doctor mode) */
        .diagnostic-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .diag-icon { font-size: 14px; flex-shrink: 0; margin-top: 2px; }
        .diag-icon.pass { color: var(--vscode-testing-iconPassed); }
        .diag-icon.fail { color: var(--vscode-testing-iconFailed); }
        .diag-icon.warn { color: var(--vscode-terminal-ansiYellow, #e5c07b); }
        .diag-icon.info-icon { color: var(--vscode-descriptionForeground); }

        .diag-details { flex: 1; }
        .diag-check { font-weight: 600; font-size: 13px; }
        .diag-message { font-size: 12px; color: var(--vscode-descriptionForeground); }
        .diag-fix { font-size: 11px; color: var(--vscode-textLink-foreground); margin-top: 2px; }

        /* ================================================================
           Footer Navigation
           ================================================================ */
        .wizard-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 20px;
            border-top: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
            min-height: 52px;
        }

        .wizard-footer .footer-left,
        .wizard-footer .footer-right {
            display: flex;
            gap: 8px;
        }

        .wizard-footer .footer-center {
            flex: 1;
            text-align: center;
        }

        /* ================================================================
           Section divider
           ================================================================ */
        .section-divider {
            border: none;
            border-top: 1px solid var(--vscode-panel-border);
            margin: 20px 0;
        }

        /* Password toggle */
        .password-wrapper {
            position: relative;
        }

        .password-wrapper input {
            padding-right: 32px;
        }

        .password-toggle {
            position: absolute;
            right: 6px;
            top: 50%;
            transform: translateY(-50%);
            background: transparent;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 14px;
            padding: 2px 4px;
        }

        .password-toggle:hover {
            color: var(--vscode-foreground);
        }

        /* Loading spinner */
        .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid var(--vscode-input-border);
            border-top-color: var(--vscode-button-background);
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* Utility */
        .hidden { display: none !important; }
        .mt-8 { margin-top: 8px; }
        .mt-16 { margin-top: 16px; }
        .mb-8 { margin-bottom: 8px; }
    </style>
</head>
<body>
    <!-- ================================================================
         Header
         ================================================================ -->
    <div class="wizard-header">
        <h1>MJ Installer</h1>
        <span class="status-badge" id="statusBadge">Ready</span>
    </div>

    <!-- ================================================================
         Body: Sidebar + Content
         ================================================================ -->
    <div class="wizard-body">
        <!-- Sidebar -->
        <div class="wizard-sidebar" id="wizardSidebar">
            <!-- Steps are rendered dynamically by JS -->
        </div>

        <!-- Main Content -->
        <div class="wizard-content" id="wizardContent">

            <!-- ============== Step 1: Welcome ============== -->
            <div class="step-panel" id="step-1" data-step="1">
                <div class="step-title">Welcome to MJ Installer</div>
                <div class="step-description">Choose what you'd like to do.</div>

                <div class="mode-cards">
                    <div class="mode-card" data-mode="install" onclick="selectMode('install')">
                        <div class="mode-icon">&#128230;</div>
                        <div class="mode-title">Install</div>
                        <div class="mode-desc">Fresh install of MemberJunction from a release version.</div>
                    </div>
                    <div class="mode-card" data-mode="doctor" onclick="selectMode('doctor')">
                        <div class="mode-icon">&#129657;</div>
                        <div class="mode-title">Doctor</div>
                        <div class="mode-desc">Diagnose an existing installation and check for issues.</div>
                    </div>
                    <div class="mode-card" data-mode="resume" onclick="selectMode('resume')">
                        <div class="mode-icon">&#9654;</div>
                        <div class="mode-title">Resume</div>
                        <div class="mode-desc">Continue a previously interrupted installation.</div>
                    </div>
                </div>
            </div>

            <!-- ============== Step 2: Location & Version ============== -->
            <div class="step-panel" id="step-2" data-step="2">
                <div class="step-title">Location & Version</div>
                <div class="step-description">Choose where to install and which version.</div>

                <div class="form-group">
                    <label>Target Directory <span class="optional">(required)</span></label>
                    <div class="dir-input-row">
                        <input type="text" id="targetDir" placeholder="/path/to/install" />
                        <button class="btn-secondary" onclick="browseDirectory()">Browse</button>
                    </div>
                    <div class="workspace-shortcuts" id="workspaceShortcuts"></div>
                    <div class="field-error hidden" id="targetDirError"></div>
                </div>

                <!-- Doctor report options (visible only in doctor mode) -->
                <div class="form-group hidden" id="doctorReportGroup">
                    <label>Diagnostic Report</label>
                    <div class="checkbox-group">
                        <input type="checkbox" id="doctorReportBasic" onchange="onReportOptionChange()" />
                        <label for="doctorReportBasic">Generate diagnostic report</label>
                    </div>
                    <div class="field-hint">Creates <code>mj-diagnostic-report.md</code> with environment info, install state, and check results.</div>
                    <div class="checkbox-group mt-8">
                        <input type="checkbox" id="doctorReportExtended" onchange="onReportOptionChange()" />
                        <label for="doctorReportExtended">Extended report (includes config snapshots &amp; service logs)</label>
                    </div>
                    <div class="field-hint">Creates <code>mj-diagnostic-report-extended.md</code>. Takes 1-3 minutes extra as it briefly starts MJAPI and Explorer to capture startup output.</div>
                </div>

                <div class="form-group" id="versionGroup">
                    <label>Version</label>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <select id="versionSelect" style="flex: 1;" onchange="showVersionNotes()">
                            <option value="">-- Select a version --</option>
                        </select>
                        <button class="btn-secondary" onclick="fetchVersions()" id="fetchVersionsBtn">
                            Fetch Versions
                        </button>
                    </div>
                    <div class="checkbox-group mt-8">
                        <input type="checkbox" id="includePrerelease" onchange="fetchVersions()" />
                        <label for="includePrerelease">Include pre-releases</label>
                    </div>
                    <div class="field-error hidden" id="versionError"></div>
                </div>
            </div>

            <!-- ============== Step 3: Database ============== -->
            <div class="step-panel" id="step-3" data-step="3">
                <div class="step-title">Database Configuration</div>
                <div class="step-description">Configure your SQL Server connection.</div>
                <div style="margin-bottom: 12px;">
                    <button class="btn-secondary" onclick="vscode.postMessage({type:'loadConfig'})" title="Load settings from a saved JSON config file">
                        Load Config File
                    </button>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Host</label>
                        <input type="text" id="dbHost" value="localhost" />
                    </div>
                    <div class="form-group" style="max-width: 120px;">
                        <label>Port</label>
                        <input type="number" id="dbPort" value="1433" />
                        <div class="field-error hidden" id="dbPortError"></div>
                    </div>
                </div>

                <div class="form-group">
                    <label>Database Name</label>
                    <input type="text" id="dbName" placeholder="MemberJunction" />
                    <div class="field-error hidden" id="dbNameError"></div>
                </div>

                <div class="checkbox-group">
                    <input type="checkbox" id="dbTrustCert" checked />
                    <label for="dbTrustCert">Trust Server Certificate (recommended for local dev)</label>
                </div>

                <div style="margin-bottom: 16px;">
                    <button class="btn-secondary" onclick="testConnection()" id="testConnectionBtn">
                        Test Connection
                    </button>
                    <span class="spinner hidden" id="connectionSpinner"></span>
                    <div id="connectionResult"></div>
                </div>

                <hr class="section-divider" />

                <div class="form-row">
                    <div class="form-group">
                        <label>CodeGen Username</label>
                        <input type="text" id="codegenUser" placeholder="MJ_CodeGen" />
                    </div>
                    <div class="form-group">
                        <label>CodeGen Password</label>
                        <div class="password-wrapper">
                            <input type="password" id="codegenPassword" />
                            <button class="password-toggle" onclick="togglePassword('codegenPassword')">&#128065;</button>
                        </div>
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>API Username</label>
                        <input type="text" id="apiUser" placeholder="MJ_Connect" />
                    </div>
                    <div class="form-group">
                        <label>API Password</label>
                        <div class="password-wrapper">
                            <input type="password" id="apiPassword" />
                            <button class="password-toggle" onclick="togglePassword('apiPassword')">&#128065;</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ============== Step 4: Services & Auth ============== -->
            <div class="step-panel" id="step-4" data-step="4">
                <div class="step-title">Services & Authentication</div>
                <div class="step-description">Configure service ports and authentication provider.</div>

                <div class="form-row">
                    <div class="form-group">
                        <label>API Port</label>
                        <input type="number" id="apiPort" value="4000" />
                        <div class="field-hint">Port for MJAPI GraphQL server</div>
                        <div class="field-error hidden" id="apiPortError"></div>
                    </div>
                    <div class="form-group">
                        <label>Explorer Port</label>
                        <input type="number" id="explorerPort" value="4200" />
                        <div class="field-hint">Port for MJExplorer Angular dev server</div>
                        <div class="field-error hidden" id="explorerPortError"></div>
                    </div>
                </div>

                <hr class="section-divider" />

                <div class="form-group">
                    <label>Authentication Provider</label>
                    <select id="authProvider" onchange="updateAuthFields()">
                        <option value="none">None (skip authentication setup)</option>
                        <option value="entra">Microsoft Entra (MSAL)</option>
                        <option value="auth0">Auth0</option>
                    </select>
                </div>

                <!-- Entra fields -->
                <div class="auth-fields" id="entraFields">
                    <div class="form-group">
                        <label>Tenant ID</label>
                        <input type="text" id="entraTenantId" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                        <div class="field-error hidden" id="entraTenantIdError"></div>
                    </div>
                    <div class="form-group">
                        <label>Client ID</label>
                        <input type="text" id="entraClientId" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                        <div class="field-error hidden" id="entraClientIdError"></div>
                    </div>
                </div>

                <!-- Auth0 fields -->
                <div class="auth-fields" id="auth0Fields">
                    <div class="form-group">
                        <label>Domain</label>
                        <input type="text" id="auth0Domain" placeholder="your-tenant.auth0.com" />
                        <div class="field-error hidden" id="auth0DomainError"></div>
                    </div>
                    <div class="form-group">
                        <label>Client ID</label>
                        <input type="text" id="auth0ClientId" />
                    </div>
                    <div class="form-group">
                        <label>Client Secret</label>
                        <div class="password-wrapper">
                            <input type="password" id="auth0ClientSecret" />
                            <button class="password-toggle" onclick="togglePassword('auth0ClientSecret')">&#128065;</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ============== Step 5: Optional Settings ============== -->
            <div class="step-panel" id="step-5" data-step="5">
                <div class="step-title">Optional Settings</div>
                <div class="step-description">Configure optional features and install flags.</div>

                <!-- AI API Keys -->
                <div class="collapsible" id="aiKeysSection">
                    <div class="collapsible-header" onclick="toggleCollapsible('aiKeysSection')">
                        <span class="collapsible-chevron">&#9654;</span>
                        AI API Keys
                        <span class="optional">(optional)</span>
                    </div>
                    <div class="collapsible-body">
                        <div class="form-group">
                            <label>OpenAI API Key</label>
                            <div class="password-wrapper">
                                <input type="password" id="openaiKey" placeholder="sk-..." />
                                <button class="password-toggle" onclick="togglePassword('openaiKey')">&#128065;</button>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Anthropic API Key</label>
                            <div class="password-wrapper">
                                <input type="password" id="anthropicKey" placeholder="sk-ant-..." />
                                <button class="password-toggle" onclick="togglePassword('anthropicKey')">&#128065;</button>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Mistral API Key</label>
                            <div class="password-wrapper">
                                <input type="password" id="mistralKey" />
                                <button class="password-toggle" onclick="togglePassword('mistralKey')">&#128065;</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Encryption Key -->
                <div class="collapsible" id="encryptionKeySection">
                    <div class="collapsible-header" onclick="toggleCollapsible('encryptionKeySection')">
                        <span class="collapsible-chevron">&#9654;</span>
                        Encryption Key
                        <span class="optional">(optional)</span>
                    </div>
                    <div class="collapsible-body">
                        <div class="form-group">
                            <label>Base Encryption Key</label>
                            <div class="password-wrapper">
                                <input type="password" id="baseEncryptionKey" placeholder="Base64-encoded 32-byte key" />
                                <button class="password-toggle" onclick="togglePassword('baseEncryptionKey')">&#128065;</button>
                            </div>
                            <div class="field-hint">Used for MJ field-level encryption. If left blank, the installer generates one automatically.</div>
                        </div>
                    </div>
                </div>

                <!-- New User -->
                <div class="collapsible" id="newUserSection">
                    <div class="collapsible-header" onclick="toggleCollapsible('newUserSection')">
                        <span class="collapsible-chevron">&#9654;</span>
                        Create New User
                        <span class="optional">(optional)</span>
                    </div>
                    <div class="collapsible-body">
                        <div class="form-row">
                            <div class="form-group">
                                <label>Email</label>
                                <input type="text" id="newUserEmail" placeholder="user@example.com" />
                                <div class="field-error hidden" id="newUserEmailError"></div>
                            </div>
                            <div class="form-group">
                                <label>Username <span class="optional">(defaults to email)</span></label>
                                <input type="text" id="newUserUsername" />
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>First Name</label>
                                <input type="text" id="newUserFirstName" />
                            </div>
                            <div class="form-group">
                                <label>Last Name</label>
                                <input type="text" id="newUserLastName" />
                            </div>
                        </div>
                    </div>
                </div>

                <hr class="section-divider" />

                <div class="step-title" style="font-size: 14px; margin-bottom: 12px;">Install Flags</div>

                <div class="checkbox-group">
                    <input type="checkbox" id="flagSkipDB" />
                    <label for="flagSkipDB">Skip Database Phase</label>
                </div>
                <div class="checkbox-group">
                    <input type="checkbox" id="flagSkipCodeGen" />
                    <label for="flagSkipCodeGen">Skip CodeGen Phase</label>
                </div>
                <div class="checkbox-group">
                    <input type="checkbox" id="flagSkipStart" />
                    <label for="flagSkipStart">Skip Smoke Test</label>
                </div>
                <div class="checkbox-group">
                    <input type="checkbox" id="flagFast" />
                    <label for="flagFast">Fast Mode (skip smoke test + optimize codegen)</label>
                </div>
                <div class="checkbox-group">
                    <input type="checkbox" id="flagNoResume" />
                    <label for="flagNoResume">Fresh Start (ignore previous checkpoint)</label>
                </div>
                <p style="margin:6px 0 4px 24px;font-size:12px;opacity:0.75;">
                    To update an existing installation to a newer version, check "Fresh Start" above and select the new version.
                    Alternatively, delete the install directory and run a fresh install.
                </p>
                <div class="checkbox-group">
                    <input type="checkbox" id="flagOverwriteConfig" />
                    <label for="flagOverwriteConfig">Overwrite Config Files (replace .env, mj.config.cjs, environment.ts)</label>
                </div>
                <div class="checkbox-group">
                    <input type="checkbox" id="flagVerbose" />
                    <label for="flagVerbose">Verbose Logging</label>
                </div>
            </div>

            <!-- ============== Step 6: Review ============== -->
            <div class="step-panel" id="step-6" data-step="6">
                <div class="step-title">Review Configuration</div>
                <div class="step-description">Review your settings before starting the installation.</div>
                <div id="reviewContent"></div>
                <div id="planSummaryArea" class="hidden" style="margin-top:12px;padding:12px;border-radius:6px;background:var(--vscode-textBlockQuote-background);white-space:pre-wrap;font-size:12px;max-height:200px;overflow-y:auto;"></div>
                <div class="mt-16" style="text-align: center; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
                    <button class="btn-primary" style="padding: 10px 40px; font-size: 15px;" onclick="startInstall()">
                        Start Installation
                    </button>
                    <button class="btn-secondary" onclick="previewPlan()">Preview Plan</button>
                    <button class="btn-secondary" onclick="saveConfig()">Save Config</button>
                </div>
            </div>

            <!-- ============== Step 7: Progress ============== -->
            <div class="step-panel" id="step-7" data-step="7">
                <div class="step-title" id="progressTitle">Installation in Progress</div>
                <div class="step-description" id="progressSubtitle">Please wait while MemberJunction is being installed...</div>

                <div id="completionBanner" class="hidden"></div>

                <div class="phase-timeline" id="phaseTimeline">
                    <!-- Populated dynamically -->
                </div>

                <div id="logSection">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <label style="margin-bottom: 0;">Output Log</label>
                        <div style="display: flex; gap: 4px; align-items: center;">
                            <button class="log-filter-btn active" data-filter="all" onclick="setLogFilter('all')">All</button>
                            <button class="log-filter-btn" data-filter="info" onclick="setLogFilter('info')">Info</button>
                            <button class="log-filter-btn" data-filter="warn" onclick="setLogFilter('warn')">Warn</button>
                            <button class="log-filter-btn" data-filter="error" onclick="setLogFilter('error')">Error</button>
                            <button class="btn-icon" onclick="vscode.postMessage({type:'showLog'})" title="Open full log" style="margin-left: 8px;">
                                Open Full Log
                            </button>
                        </div>
                    </div>
                    <div class="log-area" id="logArea"></div>
                </div>

                <!-- Diagnostics area (Doctor mode) -->
                <div id="diagnosticsArea" class="hidden">
                    <label class="mb-8" style="display: block;">Diagnostic Results</label>
                    <div id="diagnosticsList"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- ================================================================
         Footer Navigation
         ================================================================ -->
    <div class="wizard-footer">
        <div class="footer-left">
            <button class="btn-secondary" id="backBtn" onclick="goBack()" disabled>Back</button>
        </div>
        <div class="footer-center">
            <span id="stepCounter" style="font-size:12px;opacity:0.7;"></span>
        </div>
        <div class="footer-right">
            <button class="btn-secondary hidden" id="cancelBtn" onclick="cancelInstall()">Cancel</button>
            <button class="btn-primary" id="nextBtn" onclick="goNext()">Next</button>
        </div>
    </div>

    <!-- ================================================================
         JavaScript
         ================================================================ -->
    <script>
        const vscode = acquireVsCodeApi();

        // ================================================================
        // State
        // ================================================================
        const INSTALL_STEPS = [
            { num: 1, label: 'Welcome' },
            { num: 2, label: 'Location & Version' },
            { num: 3, label: 'Database' },
            { num: 4, label: 'Services & Auth' },
            { num: 5, label: 'Optional Settings' },
            { num: 6, label: 'Review' },
            { num: 7, label: 'Progress' },
        ];

        const DOCTOR_STEPS = [
            { num: 1, label: 'Welcome' },
            { num: 2, label: 'Location' },
            { num: 7, label: 'Diagnostics' },
        ];

        const RESUME_STEPS = [
            { num: 1, label: 'Welcome' },
            { num: 2, label: 'Location' },
            { num: 7, label: 'Progress' },
        ];

        let wizardMode = '${initialMode}';
        let currentStep = 1;
        let completedSteps = new Set();
        let workspaceFolders = [];
        let isRunning = false;
        let logLines = [];
        let logAutoScroll = true;
        let phases = [];
        let lastReportPath = null;

        // ================================================================
        // State persistence (survives panel close/reopen)
        // ================================================================
        function saveState() {
            // Persist form data but EXCLUDE passwords and secrets for security
            vscode.setState({
                wizardMode,
                currentStep: isRunning ? 7 : currentStep,
                completedSteps: Array.from(completedSteps),
                formData: {
                    targetDir: getVal('targetDir'),
                    dbHost: getVal('dbHost'),
                    dbPort: getVal('dbPort'),
                    dbName: getVal('dbName'),
                    dbTrustCert: getChecked('dbTrustCert'),
                    codegenUser: getVal('codegenUser'),
                    apiUser: getVal('apiUser'),
                    apiPort: getVal('apiPort'),
                    explorerPort: getVal('explorerPort'),
                    authProvider: getVal('authProvider'),
                    entraTenantId: getVal('entraTenantId'),
                    entraClientId: getVal('entraClientId'),
                    auth0Domain: getVal('auth0Domain'),
                    auth0ClientId: getVal('auth0ClientId'),
                    includePrerelease: getChecked('includePrerelease'),
                    flagSkipDB: getChecked('flagSkipDB'),
                    flagSkipCodeGen: getChecked('flagSkipCodeGen'),
                    flagSkipStart: getChecked('flagSkipStart'),
                    flagFast: getChecked('flagFast'),
                    flagNoResume: getChecked('flagNoResume'),
                    flagOverwriteConfig: getChecked('flagOverwriteConfig'),
                    flagVerbose: getChecked('flagVerbose'),
                    doctorReportBasic: getChecked('doctorReportBasic'),
                    doctorReportExtended: getChecked('doctorReportExtended'),
                },
            });
        }

        function getVal(id) {
            const el = document.getElementById(id);
            return el ? el.value : '';
        }

        function getChecked(id) {
            const el = document.getElementById(id);
            return el ? el.checked : false;
        }

        function restoreState() {
            const state = vscode.getState();
            if (!state || !state.formData) return false;

            wizardMode = state.wizardMode || 'install';
            completedSteps = new Set(state.completedSteps || []);

            const fd = state.formData;
            setVal('targetDir', fd.targetDir);
            setVal('dbHost', fd.dbHost);
            setVal('dbPort', fd.dbPort);
            setVal('dbName', fd.dbName);
            setCheck('dbTrustCert', fd.dbTrustCert);
            setVal('codegenUser', fd.codegenUser);
            setVal('apiUser', fd.apiUser);
            setVal('apiPort', fd.apiPort);
            setVal('explorerPort', fd.explorerPort);
            setVal('authProvider', fd.authProvider);
            setVal('entraTenantId', fd.entraTenantId);
            setVal('entraClientId', fd.entraClientId);
            setVal('auth0Domain', fd.auth0Domain);
            setVal('auth0ClientId', fd.auth0ClientId);
            setCheck('includePrerelease', fd.includePrerelease);
            setCheck('flagSkipDB', fd.flagSkipDB);
            setCheck('flagSkipCodeGen', fd.flagSkipCodeGen);
            setCheck('flagSkipStart', fd.flagSkipStart);
            setCheck('flagFast', fd.flagFast);
            setCheck('flagNoResume', fd.flagNoResume);
            setCheck('flagOverwriteConfig', fd.flagOverwriteConfig);
            setCheck('flagVerbose', fd.flagVerbose);
            setCheck('doctorReportBasic', fd.doctorReportBasic);
            setCheck('doctorReportExtended', fd.doctorReportExtended);
            onReportOptionChange();

            selectMode(wizardMode);
            updateAuthFields();

            // Navigate to saved step (but not to progress step — that's handled by reattach)
            if (state.currentStep && state.currentStep > 1 && state.currentStep < 7) {
                goToStep(state.currentStep);
            }
            return true;
        }

        function setVal(id, val) {
            const el = document.getElementById(id);
            if (el && val != null) el.value = val;
        }

        function setCheck(id, val) {
            const el = document.getElementById(id);
            if (el && val != null) el.checked = !!val;
        }

        // ================================================================
        // Step definitions per mode
        // ================================================================
        function getSteps() {
            if (wizardMode === 'doctor') return DOCTOR_STEPS;
            if (wizardMode === 'resume') return RESUME_STEPS;
            return INSTALL_STEPS;
        }

        function getStepNumbers() {
            return getSteps().map(s => s.num);
        }

        function getNextStep() {
            const nums = getStepNumbers();
            const idx = nums.indexOf(currentStep);
            return idx < nums.length - 1 ? nums[idx + 1] : null;
        }

        function getPrevStep() {
            const nums = getStepNumbers();
            const idx = nums.indexOf(currentStep);
            return idx > 0 ? nums[idx - 1] : null;
        }

        // ================================================================
        // Sidebar rendering
        // ================================================================
        function renderSidebar() {
            const sidebar = document.getElementById('wizardSidebar');
            const steps = getSteps();
            let stepIndex = 0;

            sidebar.innerHTML = steps.map(s => {
                stepIndex++;
                const isActive = s.num === currentStep;
                const isCompleted = completedSteps.has(s.num);
                const isDisabled = !isCompleted && !isActive && s.num > currentStep;
                const isClickable = isCompleted && !isRunning && s.num !== 7;

                const classes = [
                    'step-item',
                    isActive ? 'active' : '',
                    isCompleted ? 'completed' : '',
                    isDisabled ? 'disabled' : '',
                    isClickable ? 'clickable' : '',
                ].filter(Boolean).join(' ');

                const circleContent = isCompleted && !isActive ? '&#10003;' : stepIndex;

                return '<div class="' + classes + '" ' +
                    (isClickable ? 'onclick="goToStep(' + s.num + ')"' : '') + '>' +
                    '<div class="step-circle">' + circleContent + '</div>' +
                    '<span class="step-label">' + s.label + '</span>' +
                    '</div>';
            }).join('');
        }

        // ================================================================
        // Step navigation
        // ================================================================
        function goToStep(step) {
            if (isRunning && step !== 7) return;

            const nums = getStepNumbers();
            if (!nums.includes(step)) return;

            // Mark current step as completed when moving forward
            if (step > currentStep) {
                completedSteps.add(currentStep);
            }

            currentStep = step;

            // Show/hide panels
            document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
            const panel = document.getElementById('step-' + step);
            if (panel) panel.classList.add('active');

            renderSidebar();
            updateFooter();

            // Pre-render step 6 review when navigating to it
            if (step === 6) renderReview();

            // Persist state on every step change
            saveState();
        }

        function goNext() {
            const next = getNextStep();
            if (!next) return;

            // Validate current step before proceeding
            if (!validateStep(currentStep)) return;

            // If moving to step 7 in install mode from step 6, start the install
            if (currentStep === 6 && next === 7 && wizardMode === 'install') {
                startInstall();
                return;
            }

            // If in doctor/resume mode and moving to step 7 from step 2, start the operation
            if (currentStep === 2 && next === 7 && wizardMode === 'doctor') {
                startDoctor();
                return;
            }

            if (currentStep === 2 && next === 7 && wizardMode === 'resume') {
                startResume();
                return;
            }

            goToStep(next);
        }

        function goBack() {
            const prev = getPrevStep();
            if (prev && !isRunning) goToStep(prev);
        }

        function updateFooter() {
            const backBtn = document.getElementById('backBtn');
            const nextBtn = document.getElementById('nextBtn');
            const cancelBtn = document.getElementById('cancelBtn');
            const stepCounter = document.getElementById('stepCounter');

            const prev = getPrevStep();
            const next = getNextStep();

            backBtn.disabled = !prev || isRunning;

            // Step counter
            const steps = getStepNumbers();
            const idx = steps.indexOf(currentStep);
            if (idx >= 0 && currentStep !== 7) {
                stepCounter.textContent = 'Step ' + (idx + 1) + ' of ' + steps.length;
            } else {
                stepCounter.textContent = '';
            }

            if (isRunning) {
                nextBtn.classList.add('hidden');
                cancelBtn.classList.remove('hidden');
            } else if (currentStep === 7) {
                nextBtn.classList.add('hidden');
                cancelBtn.classList.add('hidden');
            } else {
                cancelBtn.classList.add('hidden');
                nextBtn.classList.remove('hidden');

                // Label changes based on context
                if (currentStep === 6 && wizardMode === 'install') {
                    nextBtn.textContent = 'Install';
                } else if (currentStep === 2 && !getStepNumbers().includes(3)) {
                    // Doctor/Resume mode — next step is 7
                    if (wizardMode === 'doctor') {
                        const hasReport = getChecked('doctorReportBasic') || getChecked('doctorReportExtended');
                        nextBtn.textContent = hasReport ? 'Run Doctor + Report' : 'Run Doctor';
                    } else {
                        nextBtn.textContent = 'Resume';
                    }
                } else {
                    nextBtn.textContent = 'Next';
                }

                nextBtn.disabled = !next;
            }
        }

        // ================================================================
        // Validation
        // ================================================================
        function validateStep(step) {
            clearErrors();

            if (step === 1) {
                return !!wizardMode;
            }

            if (step === 2) {
                const dir = document.getElementById('targetDir').value.trim();
                if (!dir) {
                    showError('targetDirError', 'Please select a target directory.');
                    return false;
                }
                if (wizardMode === 'install') {
                    const version = document.getElementById('versionSelect').value;
                    if (!version) {
                        showError('versionError', 'Please select a version.');
                        return false;
                    }
                }
                return true;
            }

            if (step === 3) {
                let valid = true;
                const dbName = document.getElementById('dbName').value.trim();
                if (!dbName) {
                    showError('dbNameError', 'Database name is required.');
                    valid = false;
                }
                const dbPort = parseInt(document.getElementById('dbPort').value);
                if (isNaN(dbPort) || dbPort < 1 || dbPort > 65535) {
                    showError('dbPortError', 'Port must be 1-65535.');
                    valid = false;
                }
                return valid;
            }

            if (step === 4) {
                let valid = true;
                const apiPort = parseInt(document.getElementById('apiPort').value);
                if (isNaN(apiPort) || apiPort < 1 || apiPort > 65535) {
                    showError('apiPortError', 'Port must be 1-65535.');
                    valid = false;
                }
                const explorerPort = parseInt(document.getElementById('explorerPort').value);
                if (isNaN(explorerPort) || explorerPort < 1 || explorerPort > 65535) {
                    showError('explorerPortError', 'Port must be 1-65535.');
                    valid = false;
                }
                const authProvider = document.getElementById('authProvider').value;
                if (authProvider === 'entra') {
                    if (!document.getElementById('entraTenantId').value.trim()) {
                        showError('entraTenantIdError', 'Tenant ID is required for Entra.');
                        valid = false;
                    }
                    if (!document.getElementById('entraClientId').value.trim()) {
                        showError('entraClientIdError', 'Client ID is required for Entra.');
                        valid = false;
                    }
                } else if (authProvider === 'auth0') {
                    if (!document.getElementById('auth0Domain').value.trim()) {
                        showError('auth0DomainError', 'Domain is required for Auth0.');
                        valid = false;
                    }
                }
                return valid;
            }

            if (step === 5) {
                const email = document.getElementById('newUserEmail').value.trim();
                if (email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
                    showError('newUserEmailError', 'Please enter a valid email address.');
                    return false;
                }
                return true;
            }

            return true;
        }

        function showError(id, msg) {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = msg;
                el.classList.remove('hidden');
            }
        }

        function clearErrors() {
            document.querySelectorAll('.field-error').forEach(el => {
                el.classList.add('hidden');
                el.textContent = '';
            });
        }

        // ================================================================
        // Mode selection (Step 1)
        // ================================================================
        function selectMode(mode) {
            wizardMode = mode;

            // Visual update
            document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
            const card = document.querySelector('.mode-card[data-mode="' + mode + '"]');
            if (card) card.classList.add('selected');

            // Show/hide version group based on mode
            const versionGroup = document.getElementById('versionGroup');
            if (versionGroup) {
                versionGroup.classList.toggle('hidden', mode !== 'install');
            }

            // Show/hide doctor report options
            const reportGroup = document.getElementById('doctorReportGroup');
            if (reportGroup) {
                reportGroup.classList.toggle('hidden', mode !== 'doctor');
            }

            // Reset completed steps since step set changed
            completedSteps.clear();

            renderSidebar();
            updateFooter();
            saveState();
        }

        // ================================================================
        // Directory browsing (Step 2)
        // ================================================================
        function browseDirectory() {
            vscode.postMessage({ type: 'browseDirectory' });
        }

        function renderWorkspaceShortcuts(folders) {
            const container = document.getElementById('workspaceShortcuts');
            if (!folders || folders.length === 0) {
                container.innerHTML = '';
                return;
            }
            container.innerHTML = '<span style="font-size:11px;color:var(--vscode-descriptionForeground);">Workspace: </span>' +
                folders.map(f =>
                    '<button class="workspace-shortcut" onclick="setDirectory(\\'' +
                    f.path.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'") +
                    '\\')" title="' + escapeHtml(f.path) + '">' + escapeHtml(f.name) + '</button>'
                ).join('');
        }

        function setDirectory(path) {
            document.getElementById('targetDir').value = path;
        }

        // ================================================================
        // Version fetching (Step 2)
        // ================================================================
        function fetchVersions() {
            const btn = document.getElementById('fetchVersionsBtn');
            btn.disabled = true;
            btn.textContent = 'Loading...';

            const prerelease = document.getElementById('includePrerelease').checked;
            vscode.postMessage({ type: 'fetchVersions', includePrerelease: prerelease });
        }

        let versionNotes = {};

        function populateVersions(versions) {
            const select = document.getElementById('versionSelect');
            const current = select.value;
            versionNotes = {};

            select.innerHTML = '<option value="">-- Select a version --</option>';
            for (const v of versions) {
                const opt = document.createElement('option');
                opt.value = v.Tag;
                const displayName = v.Name && v.Name !== v.Tag ? v.Name + ' (' + v.Tag + ')' : v.Tag;
                opt.textContent = displayName + (v.Prerelease ? ' [pre-release]' : '') +
                    (v.ReleaseDate ? ' - ' + new Date(v.ReleaseDate).toLocaleDateString() : '');
                select.appendChild(opt);
                if (v.Notes) versionNotes[v.Tag] = v.Notes;
            }

            // Restore selection or default to first
            if (current && versions.some(v => v.Tag === current)) {
                select.value = current;
            } else if (versions.length > 0) {
                select.value = versions[0].Tag;
            }

            const btn = document.getElementById('fetchVersionsBtn');
            btn.disabled = false;
            btn.textContent = 'Refresh';

            showVersionNotes();
        }

        function showVersionNotes() {
            let notesEl = document.getElementById('versionNotes');
            if (!notesEl) {
                notesEl = document.createElement('div');
                notesEl.id = 'versionNotes';
                notesEl.style.cssText = 'margin-top:8px;padding:8px;border-radius:4px;font-size:12px;' +
                    'background:var(--vscode-textBlockQuote-background);white-space:pre-wrap;max-height:120px;overflow-y:auto;';
                const versionGroup = document.getElementById('versionGroup');
                if (versionGroup) versionGroup.appendChild(notesEl);
            }
            const tag = document.getElementById('versionSelect').value;
            const notes = versionNotes[tag];
            if (notes) {
                notesEl.textContent = notes;
                notesEl.style.display = 'block';
            } else {
                notesEl.style.display = 'none';
            }
        }

        // ================================================================
        // Test Connection (Step 3)
        // ================================================================
        function testConnection() {
            const host = document.getElementById('dbHost').value.trim() || 'localhost';
            const port = parseInt(document.getElementById('dbPort').value) || 1433;

            document.getElementById('testConnectionBtn').disabled = true;
            document.getElementById('connectionSpinner').classList.remove('hidden');
            document.getElementById('connectionResult').innerHTML = '';

            vscode.postMessage({ type: 'testConnection', host, port });
        }

        function showConnectionResult(result) {
            document.getElementById('testConnectionBtn').disabled = false;
            document.getElementById('connectionSpinner').classList.add('hidden');

            const container = document.getElementById('connectionResult');
            if (result.Reachable) {
                container.innerHTML = '<div class="connection-result success">&#10003; Connected (' + result.LatencyMs + 'ms)</div>';
            } else {
                container.innerHTML = '<div class="connection-result failure">&#10007; ' +
                    (result.ErrorMessage || 'Connection failed') + '</div>';
            }
        }

        // ================================================================
        // Auth provider fields (Step 4)
        // ================================================================
        function updateAuthFields() {
            const provider = document.getElementById('authProvider').value;
            document.getElementById('entraFields').classList.toggle('visible', provider === 'entra');
            document.getElementById('auth0Fields').classList.toggle('visible', provider === 'auth0');
        }

        // ================================================================
        // Collapsible sections (Step 5)
        // ================================================================
        function toggleCollapsible(id) {
            document.getElementById(id).classList.toggle('open');
        }

        // ================================================================
        // Password toggle
        // ================================================================
        function togglePassword(inputId) {
            const input = document.getElementById(inputId);
            input.type = input.type === 'password' ? 'text' : 'password';
        }

        // ================================================================
        // Build config from form
        // ================================================================
        function buildConfig() {
            const config = {
                DatabaseHost: document.getElementById('dbHost').value.trim() || 'localhost',
                DatabasePort: parseInt(document.getElementById('dbPort').value) || 1433,
                DatabaseName: document.getElementById('dbName').value.trim(),
                DatabaseTrustCert: document.getElementById('dbTrustCert').checked,
                CodeGenUser: document.getElementById('codegenUser').value.trim(),
                CodeGenPassword: document.getElementById('codegenPassword').value,
                APIUser: document.getElementById('apiUser').value.trim(),
                APIPassword: document.getElementById('apiPassword').value,
                APIPort: parseInt(document.getElementById('apiPort').value) || 4000,
                ExplorerPort: parseInt(document.getElementById('explorerPort').value) || 4200,
                AuthProvider: document.getElementById('authProvider').value,
            };

            // Auth provider values
            if (config.AuthProvider === 'entra') {
                config.AuthProviderValues = {
                    TenantID: document.getElementById('entraTenantId').value.trim(),
                    ClientID: document.getElementById('entraClientId').value.trim(),
                };
            } else if (config.AuthProvider === 'auth0') {
                config.AuthProviderValues = {
                    Domain: document.getElementById('auth0Domain').value.trim(),
                    ClientID: document.getElementById('auth0ClientId').value.trim(),
                    ClientSecret: document.getElementById('auth0ClientSecret').value,
                };
            }

            // AI Keys
            const openaiKey = document.getElementById('openaiKey').value.trim();
            const anthropicKey = document.getElementById('anthropicKey').value.trim();
            const mistralKey = document.getElementById('mistralKey').value.trim();
            if (openaiKey) config.OpenAIKey = openaiKey;
            if (anthropicKey) config.AnthropicKey = anthropicKey;
            if (mistralKey) config.MistralKey = mistralKey;

            // Encryption key
            const encryptionKey = document.getElementById('baseEncryptionKey').value.trim();
            if (encryptionKey) config.BaseEncryptionKey = encryptionKey;

            // New user
            const email = document.getElementById('newUserEmail').value.trim();
            if (email) {
                config.CreateNewUser = {
                    Email: email,
                    Username: document.getElementById('newUserUsername').value.trim() || email,
                    FirstName: document.getElementById('newUserFirstName').value.trim(),
                    LastName: document.getElementById('newUserLastName').value.trim(),
                };
            }

            return config;
        }

        // ================================================================
        // Review (Step 6)
        // ================================================================
        function renderReview() {
            const config = buildConfig();
            const flags = getFlags();

            function mask(val) {
                if (!val) return '<span style="color:var(--vscode-descriptionForeground);">not set</span>';
                return '&#8226;'.repeat(Math.min(val.length, 12));
            }

            function val(v) {
                return v ? escapeHtml(String(v)) : '<span style="color:var(--vscode-descriptionForeground);">not set</span>';
            }

            function editLink(step) {
                return '<span class="review-edit-link" onclick="goToStep(' + step + ')">Edit</span>';
            }

            let html = '<table class="review-table">';

            // Location
            html += '<tr class="review-section-header"><td colspan="2">Location & Version ' + editLink(2) + '</td></tr>';
            html += '<tr><th>Directory</th><td>' + val(document.getElementById('targetDir').value) + '</td></tr>';
            html += '<tr><th>Version</th><td>' + val(document.getElementById('versionSelect').value) + '</td></tr>';

            // Database
            html += '<tr class="review-section-header"><td colspan="2">Database ' + editLink(3) + '</td></tr>';
            html += '<tr><th>Host</th><td>' + escapeHtml(config.DatabaseHost) + ':' + config.DatabasePort + '</td></tr>';
            html += '<tr><th>Database</th><td>' + val(config.DatabaseName) + '</td></tr>';
            html += '<tr><th>Trust Cert</th><td>' + (config.DatabaseTrustCert ? 'Yes' : 'No') + '</td></tr>';
            html += '<tr><th>CodeGen Login</th><td>' + val(config.CodeGenUser) + ' / ' + mask(config.CodeGenPassword) + '</td></tr>';
            html += '<tr><th>API Login</th><td>' + val(config.APIUser) + ' / ' + mask(config.APIPassword) + '</td></tr>';

            // Services
            html += '<tr class="review-section-header"><td colspan="2">Services & Auth ' + editLink(4) + '</td></tr>';
            html += '<tr><th>API Port</th><td>' + config.APIPort + '</td></tr>';
            html += '<tr><th>Explorer Port</th><td>' + config.ExplorerPort + '</td></tr>';
            html += '<tr><th>Auth Provider</th><td>' + escapeHtml(config.AuthProvider) + '</td></tr>';

            if (config.AuthProvider === 'entra' && config.AuthProviderValues) {
                html += '<tr><th>Tenant ID</th><td>' + val(config.AuthProviderValues.TenantID) + '</td></tr>';
                html += '<tr><th>Client ID</th><td>' + val(config.AuthProviderValues.ClientID) + '</td></tr>';
            } else if (config.AuthProvider === 'auth0' && config.AuthProviderValues) {
                html += '<tr><th>Domain</th><td>' + val(config.AuthProviderValues.Domain) + '</td></tr>';
                html += '<tr><th>Client ID</th><td>' + val(config.AuthProviderValues.ClientID) + '</td></tr>';
                html += '<tr><th>Client Secret</th><td>' + mask(config.AuthProviderValues.ClientSecret) + '</td></tr>';
            }

            // Optional
            html += '<tr class="review-section-header"><td colspan="2">Optional Settings ' + editLink(5) + '</td></tr>';
            html += '<tr><th>AI Keys</th><td>' +
                [config.OpenAIKey ? 'OpenAI' : null, config.AnthropicKey ? 'Anthropic' : null, config.MistralKey ? 'Mistral' : null]
                    .filter(Boolean).join(', ') || 'None';
            html += '</td></tr>';
            html += '<tr><th>Encryption Key</th><td>' + (config.BaseEncryptionKey ? 'Custom key provided' : 'Auto-generate') + '</td></tr>';
            html += '<tr><th>New User</th><td>' + (config.CreateNewUser ? escapeHtml(config.CreateNewUser.Email) : 'None') + '</td></tr>';

            // Flags
            const activeFlags = [];
            if (flags.SkipDB) activeFlags.push('Skip DB');
            if (flags.SkipCodeGen) activeFlags.push('Skip CodeGen');
            if (flags.SkipStart) activeFlags.push('Skip Smoke Test');
            if (flags.Fast) activeFlags.push('Fast Mode');
            if (flags.NoResume) activeFlags.push('Fresh Start');
            if (flags.OverwriteConfig) activeFlags.push('Overwrite Config');
            if (flags.Verbose) activeFlags.push('Verbose');
            html += '<tr><th>Flags</th><td>' + (activeFlags.length > 0 ? activeFlags.join(', ') : 'Default (all phases)') + '</td></tr>';

            html += '</table>';
            document.getElementById('reviewContent').innerHTML = html;
        }

        function getFlags() {
            return {
                SkipDB: document.getElementById('flagSkipDB').checked,
                SkipCodeGen: document.getElementById('flagSkipCodeGen').checked,
                SkipStart: document.getElementById('flagSkipStart').checked,
                Fast: document.getElementById('flagFast').checked,
                NoResume: document.getElementById('flagNoResume').checked,
                OverwriteConfig: document.getElementById('flagOverwriteConfig').checked,
                Verbose: document.getElementById('flagVerbose').checked,
            };
        }

        // ================================================================
        // Start operations
        // ================================================================
        function startInstall() {
            if (isRunning) return;
            const config = buildConfig();
            const flags = getFlags();
            const targetDir = document.getElementById('targetDir').value.trim();
            const version = document.getElementById('versionSelect').value;

            isRunning = true;
            logLines = [];
            phases = [];
            document.getElementById('logArea').innerHTML = '';
            document.getElementById('completionBanner').innerHTML = '';
            document.getElementById('completionBanner').classList.add('hidden');
            document.getElementById('progressTitle').textContent = 'Installation in Progress';
            document.getElementById('progressSubtitle').textContent = 'Please wait while MemberJunction is being installed...';
            document.getElementById('diagnosticsArea').classList.add('hidden');
            document.getElementById('logSection').classList.remove('hidden');

            goToStep(7);

            vscode.postMessage({
                type: 'startInstall',
                planInput: {
                    Dir: targetDir,
                    Tag: version,
                    Config: config,
                    SkipDB: flags.SkipDB,
                    SkipCodeGen: flags.SkipCodeGen,
                    SkipStart: flags.SkipStart,
                    Fast: flags.Fast,
                },
                options: {
                    Yes: true,
                    Verbose: flags.Verbose,
                    NoResume: flags.NoResume,
                    OverwriteConfig: flags.OverwriteConfig,
                    Config: config,
                },
            });
        }

        function startDoctor() {
            if (isRunning) return;
            const targetDir = document.getElementById('targetDir').value.trim();
            if (!targetDir) return;

            const reportBasic = document.getElementById('doctorReportBasic').checked;
            const reportExtended = document.getElementById('doctorReportExtended').checked;
            const generatingReport = reportBasic || reportExtended;

            isRunning = true;
            document.getElementById('progressTitle').textContent = 'Running Diagnostics';
            document.getElementById('progressSubtitle').textContent = generatingReport
                ? 'Running diagnostics and generating report...'
                : 'Checking your MemberJunction installation...';
            document.getElementById('diagnosticsArea').classList.remove('hidden');
            document.getElementById('diagnosticsList').innerHTML = '';
            // Show log section when generating extended report (captures service logs)
            if (reportExtended) {
                document.getElementById('logSection').classList.remove('hidden');
                document.getElementById('logArea').innerHTML = '';
                logLines = [];
            } else {
                document.getElementById('logSection').classList.add('hidden');
            }
            document.getElementById('completionBanner').innerHTML = '';
            document.getElementById('completionBanner').classList.add('hidden');

            goToStep(7);

            const options = {};
            if (reportBasic) options.Report = true;
            if (reportExtended) options.ReportExtended = true;

            vscode.postMessage({ type: 'startDoctor', targetDir, options });
        }

        function onReportOptionChange() {
            // If extended is checked, basic is implied (uncheck basic to avoid confusion)
            const extendedEl = document.getElementById('doctorReportExtended');
            const basicEl = document.getElementById('doctorReportBasic');
            if (extendedEl.checked) {
                basicEl.checked = false;
                basicEl.disabled = true;
            } else {
                basicEl.disabled = false;
            }
            updateFooter();
            saveState();
        }

        function viewReport() {
            if (lastReportPath) {
                vscode.postMessage({ type: 'openReportFile', path: lastReportPath });
            }
        }

        function revealReport() {
            if (lastReportPath) {
                vscode.postMessage({ type: 'revealReportFile', path: lastReportPath });
            }
        }

        function startResume() {
            if (isRunning) return;
            const targetDir = document.getElementById('targetDir').value.trim();
            if (!targetDir) return;

            isRunning = true;
            logLines = [];
            phases = [];
            document.getElementById('logArea').innerHTML = '';
            document.getElementById('completionBanner').innerHTML = '';
            document.getElementById('completionBanner').classList.add('hidden');
            document.getElementById('progressTitle').textContent = 'Resuming Installation';
            document.getElementById('progressSubtitle').textContent = 'Continuing from last checkpoint...';
            document.getElementById('diagnosticsArea').classList.add('hidden');
            document.getElementById('logSection').classList.remove('hidden');

            goToStep(7);

            vscode.postMessage({ type: 'startResume', targetDir });
        }

        function cancelInstall() {
            vscode.postMessage({ type: 'cancelInstall' });
        }

        function previewPlan() {
            const config = buildConfig();
            const flags = getFlags();
            const targetDir = document.getElementById('targetDir').value.trim();
            const version = document.getElementById('versionSelect').value;

            vscode.postMessage({
                type: 'dryRun',
                planInput: {
                    Dir: targetDir,
                    Tag: version,
                    Config: config,
                    SkipDB: flags.SkipDB,
                    SkipCodeGen: flags.SkipCodeGen,
                    SkipStart: flags.SkipStart,
                    Fast: flags.Fast,
                },
            });
        }

        function saveConfig() {
            const config = buildConfig();
            const flags = getFlags();
            config.Dir = document.getElementById('targetDir').value.trim();
            config.Tag = document.getElementById('versionSelect').value;
            config.Flags = flags;
            vscode.postMessage({ type: 'saveConfig', config });
        }

        function showPlanSummary(summary) {
            const area = document.getElementById('planSummaryArea');
            if (!area) return;
            area.textContent = summary;
            area.classList.remove('hidden');
        }

        // ================================================================
        // Phase timeline rendering
        // ================================================================
        // Default labels — overridden by phaseLabels from init message
        let PHASE_LABELS = {
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

        // Elapsed time tracking for running phases
        let phaseStartTime = null;
        let elapsedTimerHandle = null;

        function renderPhaseTimeline(phaseData) {
            phases = phaseData;
            const container = document.getElementById('phaseTimeline');

            // Track elapsed time for running phase
            const runningPhase = phaseData.find(p => p.Status === 'running');
            if (runningPhase && !phaseStartTime) {
                phaseStartTime = Date.now();
                startElapsedTimer();
            } else if (!runningPhase) {
                stopElapsedTimer();
                phaseStartTime = null;
            }

            container.innerHTML = phaseData.map(p => {
                const label = PHASE_LABELS[p.Phase] || p.Phase;
                const duration = p.DurationMs != null ? formatDuration(p.DurationMs) : '';

                let iconClass = 'pending';
                let iconContent = '&#9675;';

                if (p.Status === 'running') {
                    iconClass = 'running';
                    iconContent = '&#8635;';
                } else if (p.Status === 'completed') {
                    iconClass = 'completed';
                    iconContent = '&#10003;';
                } else if (p.Status === 'failed') {
                    iconClass = 'failed';
                    iconContent = '&#10007;';
                } else if (p.Status === 'skipped') {
                    iconClass = 'skipped';
                    iconContent = '&#8211;';
                }

                let errorHtml = '';
                if (p.ErrorMessage) {
                    errorHtml = '<div class="phase-error">';
                    if (p.ErrorCode) {
                        errorHtml += '<strong>[' + escapeHtml(p.ErrorCode) + ']</strong> ';
                    }
                    errorHtml += escapeHtml(p.ErrorMessage);
                    if (p.SuggestedFix) {
                        errorHtml += '<div style="margin-top:4px;color:var(--vscode-textLink-foreground);">' +
                            'Fix: ' + escapeHtml(p.SuggestedFix) + '</div>';
                    }
                    errorHtml += '</div>';
                }

                return '<div class="phase-item" data-phase="' + p.Phase + '">' +
                    '<div class="phase-icon ' + iconClass + '">' + iconContent + '</div>' +
                    '<div class="phase-details">' +
                        '<div class="phase-name">' + escapeHtml(label) + '</div>' +
                        '<div class="phase-description">' + escapeHtml(p.Description || '') + '</div>' +
                        errorHtml +
                    '</div>' +
                    (duration ? '<div class="phase-duration">' + duration + '</div>' : '') +
                    '</div>';
            }).join('');
        }

        function updatePhaseProgress(phase, message, percent) {
            const item = document.querySelector('.phase-item[data-phase="' + phase + '"]');
            if (!item) return;
            let progressEl = item.querySelector('.phase-progress-msg');
            if (!progressEl) {
                progressEl = document.createElement('div');
                progressEl.className = 'phase-progress-msg';
                item.querySelector('.phase-details').appendChild(progressEl);
            }
            const pctText = percent != null ? ' (' + percent + '%)' : '';
            progressEl.textContent = message + pctText;
        }

        function startElapsedTimer() {
            stopElapsedTimer();
            elapsedTimerHandle = setInterval(function() {
                if (!phaseStartTime) return;
                const elapsed = Date.now() - phaseStartTime;
                const el = document.querySelector('.phase-icon.running');
                if (el) {
                    const item = el.closest('.phase-item');
                    if (item) {
                        let timerEl = item.querySelector('.phase-elapsed');
                        if (!timerEl) {
                            timerEl = document.createElement('div');
                            timerEl.className = 'phase-duration phase-elapsed';
                            item.appendChild(timerEl);
                        }
                        timerEl.textContent = formatDuration(elapsed);
                    }
                }
            }, 1000);
        }

        function stopElapsedTimer() {
            if (elapsedTimerHandle) {
                clearInterval(elapsedTimerHandle);
                elapsedTimerHandle = null;
            }
        }

        // ================================================================
        // Log output
        // ================================================================
        let logFilter = 'all';

        function formatTime() {
            const d = new Date();
            return d.getHours().toString().padStart(2, '0') + ':' +
                   d.getMinutes().toString().padStart(2, '0') + ':' +
                   d.getSeconds().toString().padStart(2, '0');
        }

        function appendLog(level, message) {
            logLines.push({ level, message });

            const logArea = document.getElementById('logArea');
            const line = document.createElement('div');
            line.className = 'log-line ' + level;
            line.setAttribute('data-level', level);
            line.textContent = '[' + formatTime() + '] ' + message;

            // Apply current filter
            if (logFilter !== 'all' && level !== logFilter) {
                line.style.display = 'none';
            }

            logArea.appendChild(line);

            // Keep only last 500 lines in DOM
            while (logArea.childNodes.length > 500) {
                logArea.removeChild(logArea.firstChild);
            }

            // Auto-scroll
            if (logAutoScroll) {
                logArea.scrollTop = logArea.scrollHeight;
            }
        }

        function setLogFilter(filter) {
            logFilter = filter;
            document.querySelectorAll('.log-filter-btn').forEach(function(btn) {
                btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
            });
            document.querySelectorAll('#logArea .log-line').forEach(function(line) {
                if (filter === 'all') {
                    line.style.display = '';
                } else {
                    line.style.display = line.getAttribute('data-level') === filter ? '' : 'none';
                }
            });
        }

        // Detect manual scroll
        document.getElementById('logArea').addEventListener('scroll', function() {
            const el = this;
            logAutoScroll = (el.scrollHeight - el.scrollTop - el.clientHeight) < 30;
        });

        // ================================================================
        // Diagnostics (Doctor mode)
        // ================================================================
        function renderDiagnostics(diagnostics) {
            const container = document.getElementById('diagnosticsList');

            container.innerHTML = diagnostics.map(d => {
                const iconClass = d.Status === 'pass' ? 'pass' :
                                  d.Status === 'fail' ? 'fail' :
                                  d.Status === 'warn' ? 'warn' : 'info-icon';

                const icon = d.Status === 'pass' ? '&#10003;' :
                             d.Status === 'fail' ? '&#10007;' :
                             d.Status === 'warn' ? '&#9888;' : '&#8505;';

                let fixHtml = '';
                if (d.SuggestedFix) {
                    fixHtml = '<div class="diag-fix">Fix: ' + escapeHtml(d.SuggestedFix) + '</div>';
                }

                return '<div class="diagnostic-item">' +
                    '<div class="diag-icon ' + iconClass + '">' + icon + '</div>' +
                    '<div class="diag-details">' +
                        '<div class="diag-check">' + escapeHtml(d.Check) + '</div>' +
                        '<div class="diag-message">' + escapeHtml(d.Message) + '</div>' +
                        fixHtml +
                    '</div>' +
                    '</div>';
            }).join('');
        }

        // ================================================================
        // Completion
        // ================================================================
        function showCompletion(data) {
            isRunning = false;
            updateFooter();

            const banner = document.getElementById('completionBanner');
            banner.classList.remove('hidden');

            if (data.success) {
                const duration = formatDuration(data.durationMs);
                banner.className = 'completion-banner success';
                banner.innerHTML =
                    '<h2>&#10003; Installation Complete</h2>' +
                    '<p>MemberJunction has been installed successfully' + (duration ? ' in ' + duration : '') + '.</p>' +
                    (data.warnings && data.warnings.length > 0
                        ? '<p style="color:var(--vscode-terminal-ansiYellow);">' + data.warnings.length + ' warning(s) during install.</p>'
                        : '') +
                    '<div class="btn-row">' +
                        '<button class="btn-primary" onclick="openInstallFolder()">Open in VS Code</button>' +
                        '<button class="btn-secondary" onclick="vscode.postMessage({type:\\'showLog\\'})">Show Full Log</button>' +
                        '<button class="btn-secondary" onclick="startOver()">Start Over</button>' +
                    '</div>';
            } else {
                const failed = (data.phasesFailed || []).join(', ') || 'Unknown';
                banner.className = 'completion-banner failure';
                banner.innerHTML =
                    '<h2>&#10007; Installation Failed</h2>' +
                    '<p>Failed at phase: ' + escapeHtml(failed) + '</p>' +
                    '<div class="btn-row">' +
                        '<button class="btn-primary" onclick="startResume()">Resume Install</button>' +
                        '<button class="btn-secondary" onclick="vscode.postMessage({type:\\'showLog\\'})">Show Full Log</button>' +
                        '<button class="btn-secondary" onclick="startOver()">Start Over</button>' +
                    '</div>';
            }

            document.getElementById('progressSubtitle').textContent =
                data.success ? 'Installation completed.' : 'Installation failed.';
        }

        function showDoctorCompletion(data) {
            isRunning = false;
            updateFooter();
            document.getElementById('progressSubtitle').textContent = 'Diagnostics complete.';

            if (data && data.passCount != null) {
                const banner = document.getElementById('completionBanner');
                banner.classList.remove('hidden');
                const hasFailures = data.hasFailures;
                banner.className = 'completion-banner ' + (hasFailures ? 'failure' : 'success');

                let envHtml = '';
                if (data.environment) {
                    const env = data.environment;
                    envHtml = '<div style="margin-top:8px;font-size:12px;opacity:0.85;">' +
                        '<strong>Environment:</strong> ' + escapeHtml(env.OS || 'Unknown') +
                        ' | Node ' + escapeHtml(env.NodeVersion || '?') +
                        ' | npm ' + escapeHtml(env.NpmVersion || '?') +
                        ' | ' + escapeHtml(env.Architecture || '') +
                        '</div>';
                }

                let lastInstallHtml = '';
                if (data.lastInstall) {
                    lastInstallHtml = '<div style="margin-top:4px;font-size:12px;opacity:0.85;">' +
                        '<strong>Last Install:</strong> ' + escapeHtml(data.lastInstall.Tag || '?') +
                        ' on ' + escapeHtml(data.lastInstall.Timestamp || '?') +
                        '</div>';
                }

                let reportHtml = '';
                if (data.reportPath) {
                    lastReportPath = data.reportPath;
                    reportHtml = '<div style="margin-top:8px;font-size:12px;opacity:0.85;">' +
                        '<strong>Report:</strong> ' + escapeHtml(data.reportPath) +
                        '</div>';
                }

                let reportBtns = '';
                if (data.reportPath) {
                    reportBtns =
                        '<button class="btn-primary" onclick="viewReport()">View Report</button>' +
                        '<button class="btn-secondary" onclick="revealReport()">Open in File Explorer</button>';
                }

                banner.innerHTML =
                    '<h2>' + (hasFailures ? '&#10007; Issues Found' : '&#10003; All Checks Passed') + '</h2>' +
                    '<p>' + data.passCount + ' passed, ' + data.warnCount + ' warnings, ' + data.failCount + ' failed</p>' +
                    envHtml + lastInstallHtml + reportHtml +
                    '<div class="btn-row" style="margin-top:12px;">' +
                        reportBtns +
                        '<button class="btn-secondary" onclick="vscode.postMessage({type:\\'showLog\\'})">Show Full Log</button>' +
                        '<button class="btn-secondary" onclick="startOver()">Start Over</button>' +
                    '</div>';
            }
        }

        function showResumeStatePreview(state) {
            let previewEl = document.getElementById('resumeStatePreview');
            if (!previewEl) {
                previewEl = document.createElement('div');
                previewEl.id = 'resumeStatePreview';
                previewEl.style.cssText = 'margin-top:12px;padding:12px;border-radius:6px;font-size:13px;' +
                    'background:var(--vscode-textBlockQuote-background);';
                const dirInput = document.getElementById('targetDir');
                if (dirInput && dirInput.parentElement && dirInput.parentElement.parentElement) {
                    dirInput.parentElement.parentElement.appendChild(previewEl);
                }
            }

            if (!state) {
                previewEl.innerHTML = '<span style="opacity:0.7;">No previous install checkpoint found in this directory.</span>';
                return;
            }

            const tag = state.VersionTag || state.Tag || 'Unknown';
            const started = state.StartedAt ? new Date(state.StartedAt).toLocaleString() : 'Unknown';
            const phases = state.Phases || {};
            const completed = [];
            const failed = [];
            const pending = [];
            for (const key in phases) {
                const s = phases[key];
                if (s === 'completed') completed.push(key);
                else if (s === 'failed') failed.push(key);
                else pending.push(key);
            }

            previewEl.innerHTML =
                '<strong>Previous install checkpoint found</strong><br/>' +
                'Version: <strong>' + escapeHtml(tag) + '</strong> | Started: ' + escapeHtml(started) + '<br/>' +
                (completed.length ? 'Completed: ' + completed.map(p => PHASE_LABELS[p] || p).join(', ') + '<br/>' : '') +
                (failed.length ? '<span style="color:var(--vscode-terminal-ansiRed);">Failed: ' + failed.map(p => PHASE_LABELS[p] || p).join(', ') + '</span><br/>' : '') +
                (pending.length ? 'Will resume from: <strong>' + (PHASE_LABELS[pending[0]] || pending[0]) + '</strong>' : '');
        }

        function applyLoadedConfig(config) {
            if (!config) return;

            // Simple field mapping: config key → form element ID
            const fieldMap = {
                DatabaseHost: 'dbHost',
                DatabasePort: 'dbPort',
                DatabaseName: 'dbName',
                DatabaseTrustCert: 'dbTrustCert',
                CodeGenUser: 'codegenUser',
                CodeGenPassword: 'codegenPassword',
                APIUser: 'apiUser',
                APIPassword: 'apiPassword',
                APIPort: 'apiPort',
                ExplorerPort: 'explorerPort',
                AuthProvider: 'authProvider',
                OpenAIKey: 'openaiKey',
                AnthropicKey: 'anthropicKey',
                MistralKey: 'mistralKey',
                BaseEncryptionKey: 'baseEncryptionKey',
            };

            for (const key in fieldMap) {
                if (config[key] != null) {
                    const el = document.getElementById(fieldMap[key]);
                    if (!el) continue;
                    if (el.type === 'checkbox') {
                        el.checked = !!config[key];
                    } else {
                        el.value = String(config[key]);
                    }
                }
            }

            // Auth provider values (nested object)
            if (config.AuthProviderValues) {
                const apv = config.AuthProviderValues;
                if (config.AuthProvider === 'entra') {
                    setVal('entraTenantId', apv.TenantID);
                    setVal('entraClientId', apv.ClientID);
                } else if (config.AuthProvider === 'auth0') {
                    setVal('auth0Domain', apv.Domain);
                    setVal('auth0ClientId', apv.ClientID);
                    setVal('auth0ClientSecret', apv.ClientSecret);
                }
            }

            // New user (nested object)
            if (config.CreateNewUser) {
                const u = config.CreateNewUser;
                setVal('newUserEmail', u.Email);
                setVal('newUserUsername', u.Username);
                setVal('newUserFirstName', u.FirstName);
                setVal('newUserLastName', u.LastName);
            }

            // Flags (if saved)
            if (config.Flags) {
                setCheck('flagSkipDB', config.Flags.SkipDB);
                setCheck('flagSkipCodeGen', config.Flags.SkipCodeGen);
                setCheck('flagSkipStart', config.Flags.SkipStart);
                setCheck('flagFast', config.Flags.Fast);
                setCheck('flagNoResume', config.Flags.NoResume);
                setCheck('flagOverwriteConfig', config.Flags.OverwriteConfig);
                setCheck('flagVerbose', config.Flags.Verbose);
            }

            // Dir and Tag (from saveConfig extras)
            if (config.Dir) setVal('targetDir', config.Dir);
            if (config.Tag) setVal('versionSelect', config.Tag);

            // Update dependent UI
            updateAuthFields();
            saveState();

            vscode.postMessage({ type: 'showInfo', text: 'Configuration loaded.' });
        }

        function startOver() {
            isRunning = false;
            completedSteps = new Set();
            const banner = document.getElementById('completionBanner');
            if (banner) { banner.classList.add('hidden'); banner.innerHTML = ''; }
            goToStep(1);
            selectMode(wizardMode);
        }

        function openInstallFolder() {
            const dir = document.getElementById('targetDir').value.trim();
            if (dir) {
                vscode.postMessage({ type: 'openFolder', path: dir });
            }
        }

        // ================================================================
        // Message handler
        // ================================================================
        window.addEventListener('message', event => {
            const msg = event.data;

            switch (msg.type) {
                case 'init':
                    workspaceFolders = msg.workspaceFolders || [];
                    if (msg.phaseLabels) PHASE_LABELS = msg.phaseLabels;
                    renderWorkspaceShortcuts(workspaceFolders);
                    // Restore saved form state if available
                    restoreState();
                    break;

                case 'reattach':
                    // Panel was reopened while an install is running — jump to progress
                    isRunning = true;
                    goToStep(7);
                    updateFooter();
                    break;

                case 'setMode':
                    selectMode(msg.mode);
                    break;

                case 'directorySelected':
                    document.getElementById('targetDir').value = msg.path;
                    // In resume mode, check for install state when directory is selected
                    if (wizardMode === 'resume') {
                        vscode.postMessage({ type: 'checkState', targetDir: msg.path });
                    }
                    break;

                case 'versionsLoaded':
                    populateVersions(msg.versions || []);
                    if (msg.error) {
                        showError('versionError', msg.error);
                    }
                    break;

                case 'connectionTestResult':
                    showConnectionResult(msg);
                    break;

                case 'phaseUpdate':
                    renderPhaseTimeline(msg.phases || []);
                    break;

                case 'logEntry':
                    appendLog(msg.level || 'info', msg.message || '');
                    break;

                case 'statusChange':
                    updateStatusBadge(msg.status);
                    // Doctor completion banner is handled by the 'doctorComplete' message.
                    // Install/resume completion is handled by the 'installComplete' message.
                    // The statusChange message only updates the badge.
                    break;

                case 'diagnosticUpdate':
                    renderDiagnostics(msg.diagnostics || []);
                    break;

                case 'installComplete':
                    showCompletion(msg);
                    break;

                case 'stepProgress':
                    updatePhaseProgress(msg.phase, msg.message, msg.percent);
                    break;

                case 'doctorComplete':
                    showDoctorCompletion(msg);
                    break;

                case 'stateLoaded':
                    showResumeStatePreview(msg.state);
                    break;

                case 'configLoaded':
                    applyLoadedConfig(msg.config);
                    break;

                case 'planSummary':
                    showPlanSummary(msg.summary);
                    break;
            }
        });

        function updateStatusBadge(status) {
            const badge = document.getElementById('statusBadge');
            const labels = {
                idle: 'Ready',
                planning: 'Planning...',
                running: 'Running...',
                completed: 'Complete',
                failed: 'Failed',
                cancelled: 'Cancelled',
            };
            badge.textContent = labels[status] || status;
        }

        // ================================================================
        // Utilities
        // ================================================================
        function formatDuration(ms) {
            if (ms == null) return '';
            if (ms < 1000) return ms + 'ms';
            if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
            const mins = Math.floor(ms / 60000);
            const secs = ((ms % 60000) / 1000).toFixed(0);
            return mins + 'm ' + secs + 's';
        }

        function escapeHtml(str) {
            if (!str) return '';
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }


        // ================================================================
        // Initialize
        // ================================================================
        function init() {
            // Select initial mode
            selectMode(wizardMode);

            // Show step 1
            goToStep(1);

            // Tell extension we're ready
            vscode.postMessage({ type: 'ready' });
        }

        init();

        // Debounced save on input changes so form data persists across panel close/reopen
        let saveDebounce = null;
        document.querySelectorAll('input, select, textarea').forEach(function(el) {
            el.addEventListener('input', function() {
                if (saveDebounce) clearTimeout(saveDebounce);
                saveDebounce = setTimeout(function() { saveState(); }, 500);
            });
            el.addEventListener('change', function() {
                saveState();
            });
        });

        // Keyboard navigation: Enter → Next, Escape → Back
        document.addEventListener('keydown', function(e) {
            const tag = (e.target || e.srcElement).tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
            if (e.key === 'Enter') {
                e.preventDefault();
                goNext();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                goBack();
            }
        });
    </script>
</body>
</html>`;
    }
}
