import * as vscode from 'vscode';

/**
 * Centralized output channel for logging
 */
export class OutputChannel {
    private static instance: vscode.OutputChannel;

    public static getInstance(): vscode.OutputChannel {
        if (!this.instance) {
            this.instance = vscode.window.createOutputChannel('MemberJunction');
        }
        return this.instance;
    }

    public static log(message: string): void {
        const timestamp = new Date().toISOString();
        this.getInstance().appendLine(`[${timestamp}] ${message}`);
    }

    public static info(message: string): void {
        this.log(`[INFO] ${message}`);
    }

    public static warn(message: string): void {
        this.log(`[WARN] ${message}`);
    }

    public static error(message: string, error?: Error): void {
        this.log(`[ERROR] ${message}`);
        if (error) {
            this.log(`  ${error.message}`);
            if (error.stack) {
                this.log(`  ${error.stack}`);
            }
        }
    }

    public static show(): void {
        this.getInstance().show();
    }

    public static dispose(): void {
        if (this.instance) {
            this.instance.dispose();
        }
    }
}
