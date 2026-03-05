import * as vscode from 'vscode';
import { InstallerService, PhaseDisplayState, DiagnosticDisplayState } from '../services/InstallerService';

// -----------------------------------------------------------------------
// Tree item types
// -----------------------------------------------------------------------

class PhaseTreeItem extends vscode.TreeItem {
    constructor(
        public readonly phase: PhaseDisplayState,
        public readonly children: vscode.TreeItem[] = []
    ) {
        super(
            phase.Description,
            children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
        );

        this.description = phase.DurationMs != null
            ? formatDuration(phase.DurationMs)
            : undefined;

        this.iconPath = phaseStatusIcon(phase.Status);
        this.contextValue = 'installerPhase';
    }
}

class DiagnosticTreeItem extends vscode.TreeItem {
    constructor(
        public readonly diagnostic: DiagnosticDisplayState,
        public readonly children: vscode.TreeItem[] = []
    ) {
        super(
            diagnostic.Check,
            children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
        );

        this.description = diagnostic.Message;
        this.iconPath = diagnosticStatusIcon(diagnostic.Status);
        this.contextValue = 'installerDiagnostic';
    }
}

class SuggestedFixItem extends vscode.TreeItem {
    constructor(fix: string) {
        super(fix, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('lightbulb');
        this.contextValue = 'installerSuggestedFix';
    }
}

class ErrorDetailItem extends vscode.TreeItem {
    constructor(message: string) {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('info');
        this.contextValue = 'installerErrorDetail';
    }
}

// -----------------------------------------------------------------------
// Provider
// -----------------------------------------------------------------------

type InstallerTreeItem = PhaseTreeItem | DiagnosticTreeItem | SuggestedFixItem | ErrorDetailItem;

/**
 * TreeView data provider that displays install phases or doctor diagnostics.
 *
 * Automatically switches between "install mode" (9 phases with status)
 * and "doctor mode" (diagnostic checks with pass/fail/warn/info) based
 * on which data the InstallerService has populated.
 */
export class InstallerPhaseProvider implements vscode.TreeDataProvider<InstallerTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<InstallerTreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private disposables: vscode.Disposable[] = [];
    private service: InstallerService;

    constructor() {
        this.service = InstallerService.getInstance();

        // Refresh tree when phase or diagnostic data changes
        this.disposables.push(
            this.service.onPhaseUpdate(() => this._onDidChangeTreeData.fire(undefined))
        );
        this.disposables.push(
            this.service.onDiagnosticUpdate(() => this._onDidChangeTreeData.fire(undefined))
        );
    }

    getTreeItem(element: InstallerTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: InstallerTreeItem): InstallerTreeItem[] {
        // Root level — decide which mode to show
        if (!element) {
            return this.getRootItems();
        }

        // Children of a phase or diagnostic
        if (element instanceof PhaseTreeItem) {
            return element.children as InstallerTreeItem[];
        }
        if (element instanceof DiagnosticTreeItem) {
            return element.children as InstallerTreeItem[];
        }

        return [];
    }

    private getRootItems(): InstallerTreeItem[] {
        const diagnostics = this.service.diagnostics;
        const phases = this.service.phases;

        // If we have diagnostics, show doctor mode
        if (diagnostics.length > 0) {
            return diagnostics.map(d => this.buildDiagnosticItem(d));
        }

        // If we have phases, show install mode
        if (phases.length > 0) {
            return phases.map(p => this.buildPhaseItem(p));
        }

        // Empty state — return a placeholder
        return [];
    }

    private buildPhaseItem(phase: PhaseDisplayState): PhaseTreeItem {
        const children: vscode.TreeItem[] = [];

        if (phase.ErrorMessage) {
            children.push(new ErrorDetailItem(phase.ErrorMessage));
        }

        return new PhaseTreeItem(phase, children);
    }

    private buildDiagnosticItem(diagnostic: DiagnosticDisplayState): DiagnosticTreeItem {
        const children: vscode.TreeItem[] = [];

        if (diagnostic.SuggestedFix) {
            children.push(new SuggestedFixItem(diagnostic.SuggestedFix));
        }

        return new DiagnosticTreeItem(diagnostic, children);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function phaseStatusIcon(status: PhaseDisplayState['Status']): vscode.ThemeIcon {
    switch (status) {
        case 'pending':
            return new vscode.ThemeIcon('circle-outline');
        case 'running':
            return new vscode.ThemeIcon('loading~spin');
        case 'completed':
            return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        case 'failed':
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
        case 'skipped':
            return new vscode.ThemeIcon('dash');
    }
}

function diagnosticStatusIcon(status: DiagnosticDisplayState['Status']): vscode.ThemeIcon {
    switch (status) {
        case 'pass':
            return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        case 'fail':
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
        case 'warn':
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
        case 'info':
            return new vscode.ThemeIcon('info', new vscode.ThemeColor('editorInfo.foreground'));
    }
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}
