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

    /**
     * Update a status bar item. Always resets tooltip, command, and backgroundColor
     * to prevent stale values from a previous state leaking through.
     */
    public static update(id: string, text: string, tooltip?: string, command?: string): void {
        const item = this.items.get(id);
        if (item) {
            item.text = text;
            item.tooltip = tooltip ?? '';
            item.command = command ?? '';
            item.backgroundColor = undefined;
            item.show();
        }
    }

    /**
     * Update with rich tooltip using MarkdownString
     */
    public static updateWithMarkdown(
        id: string,
        text: string,
        tooltip: vscode.MarkdownString,
        command?: string
    ): void {
        const item = this.items.get(id);
        if (item) {
            item.text = text;
            item.tooltip = tooltip;
            if (command) {
                item.command = command;
            }
            item.show();
        }
    }

    /**
     * Update with background color for emphasis
     */
    public static updateWithColor(
        id: string,
        text: string,
        tooltip?: string,
        command?: string,
        backgroundColor?: vscode.ThemeColor
    ): void {
        const item = this.items.get(id);
        if (item) {
            item.text = text;
            item.tooltip = tooltip ?? '';
            item.command = command ?? '';
            item.backgroundColor = backgroundColor;
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
