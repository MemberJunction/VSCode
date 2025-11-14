import * as vscode from 'vscode';

export interface StatusBarConfig {
    alignment: vscode.StatusBarAlignment;
    priority: number;
}

/**
 * Manages status bar items for different features
 */
export class StatusBarManager {
    private static items = new Map<string, vscode.StatusBarItem>();

    public static register(id: string, config: StatusBarConfig): vscode.StatusBarItem {
        let item = this.items.get(id);

        if (!item) {
            item = vscode.window.createStatusBarItem(
                config.alignment,
                config.priority
            );
            this.items.set(id, item);
        }

        return item;
    }

    public static update(id: string, text: string, tooltip?: string, command?: string): void {
        const item = this.items.get(id);
        if (item) {
            item.text = text;
            if (tooltip) {
                item.tooltip = tooltip;
            }
            if (command) {
                item.command = command;
            }
            item.show();
        }
    }

    public static hide(id: string): void {
        const item = this.items.get(id);
        if (item) {
            item.hide();
        }
    }

    public static dispose(): void {
        for (const item of this.items.values()) {
            item.dispose();
        }
        this.items.clear();
    }
}
