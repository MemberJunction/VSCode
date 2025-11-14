import * as vscode from 'vscode';

/**
 * Utility for reporting progress to the user
 */
export class ProgressReporter {
    /**
     * Execute a task with a progress notification
     */
    public static async withProgress<T>(
        title: string,
        task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>,
        cancellable: boolean = false
    ): Promise<T> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `MemberJunction: ${title}`,
                cancellable
            },
            task
        );
    }

    /**
     * Execute a task with a progress indicator in the window
     */
    public static async withWindowProgress<T>(
        title: string,
        task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
    ): Promise<T> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: `MJ: ${title}`
            },
            task
        );
    }
}
