import * as vscode from 'vscode';
import { Feature } from '../../types';
import { TestService, MJTest, MJTestSuite } from '../../services/TestService';
import { OutputChannel } from '../../common/OutputChannel';

/**
 * Phase 4: Test Explorer Feature
 *
 * Provides:
 * - VSCode Test Explorer integration
 * - Test discovery from MJ Testing Framework
 * - Test execution with inline results
 * - Test filtering and organization
 * - Pass/fail decorations
 */
export class TestExplorerFeature implements Feature {
    name = 'test-explorer';

    private testService: TestService;
    private testController: vscode.TestController | undefined;
    private disposables: vscode.Disposable[] = [];
    private testItemMap = new Map<string, vscode.TestItem>();
    private decorationType: vscode.TextEditorDecorationType;

    constructor() {
        this.testService = TestService.getInstance();

        // Create decoration type for test results
        this.decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 1em',
                fontWeight: 'bold'
            },
            isWholeLine: false
        });
    }

    enabled(): boolean {
        const config = vscode.workspace.getConfiguration('memberjunction');
        return config.get<boolean>('features.testExplorer.enabled', true);
    }

    async activate(context: vscode.ExtensionContext): Promise<void> {
        if (!this.enabled()) {
            OutputChannel.info('Test Explorer feature is disabled');
            return;
        }

        OutputChannel.info('Activating Test Explorer feature...');

        // Initialize test service
        const initialized = await this.testService.initialize();
        if (!initialized) {
            OutputChannel.warn('Test Service failed to initialize - Test Explorer will not be available');
            return;
        }

        // Create test controller
        this.testController = vscode.tests.createTestController(
            'memberjunctionTests',
            'MemberJunction Tests'
        );

        // Register commands
        this.registerCommands(context);

        // Set up test discovery
        await this.discoverTests();

        // Refresh tests handler
        this.testController.refreshHandler = async () => {
            await this.refreshTests();
        };

        // Test run handler
        this.testController.createRunProfile(
            'Run Tests',
            vscode.TestRunProfileKind.Run,
            async (request, token) => {
                await this.runTests(request, token);
            },
            true
        );

        context.subscriptions.push(this.testController);

        OutputChannel.info('Test Explorer feature activated');
    }

    async deactivate(): Promise<void> {
        this.testController?.dispose();
        this.decorationType.dispose();
        this.disposables.forEach(d => d.dispose());
        OutputChannel.info('Test Explorer feature deactivated');
    }

    /**
     * Register Test Explorer commands
     */
    private registerCommands(context: vscode.ExtensionContext): void {
        // Refresh tests
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.refreshTests', async () => {
                await this.refreshTests();
            })
        );

        // Run all tests
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.runAllTests', async () => {
                await this.runAllTests();
            })
        );

        // Clear test results
        context.subscriptions.push(
            vscode.commands.registerCommand('memberjunction.clearTestResults', () => {
                this.clearTestResults();
            })
        );
    }

    /**
     * Discover tests from MJ Testing Framework
     */
    private async discoverTests(): Promise<void> {
        if (!this.testController) {
            return;
        }

        try {
            const suites = await this.testService.listTestSuites(true);

            // Clear existing items
            this.testController.items.replace([]);
            this.testItemMap.clear();

            // Add test suites and tests to controller
            for (const suite of suites) {
                this.addTestSuite(suite, this.testController.items);
            }

            // Add tests that aren't in any suite
            const allTests = await this.testService.listTests();
            const suiteTestIds = new Set<string>();
            this.collectAllTestIds(suites, suiteTestIds);

            for (const test of allTests) {
                if (!suiteTestIds.has(test.id)) {
                    this.addTest(test, this.testController.items);
                }
            }

        } catch (error) {
            OutputChannel.error('Failed to discover tests', error as Error);
            vscode.window.showErrorMessage(`Failed to discover tests: ${(error as Error).message}`);
        }
    }

    /**
     * Refresh tests
     */
    private async refreshTests(): Promise<void> {
        this.testService.clearCache();
        await this.discoverTests();
        vscode.window.showInformationMessage('Tests refreshed');
    }

    /**
     * Add a test suite to the test tree
     */
    private addTestSuite(suite: MJTestSuite, parent: vscode.TestItemCollection): void {
        if (!this.testController) {
            return;
        }

        const suiteItem = this.testController.createTestItem(
            suite.id,
            suite.name,
            undefined
        );

        suiteItem.description = suite.description;
        suiteItem.canResolveChildren = true;

        // Add tests
        for (const test of suite.tests) {
            this.addTest(test, suiteItem.children);
        }

        // Add child suites
        for (const childSuite of suite.childSuites) {
            this.addTestSuite(childSuite, suiteItem.children);
        }

        parent.add(suiteItem);
        this.testItemMap.set(suite.id, suiteItem);
    }

    /**
     * Add a test to the test tree
     */
    private addTest(test: MJTest, parent: vscode.TestItemCollection): void {
        if (!this.testController) {
            return;
        }

        const testItem = this.testController.createTestItem(
            test.id,
            test.name,
            undefined
        );

        testItem.description = test.testTypeName;
        if (test.description) {
            testItem.description = `${test.testTypeName} - ${test.description}`;
        }

        if (test.tags && test.tags.length > 0) {
            testItem.tags = test.tags.map(tag => new vscode.TestTag(tag));
        }

        parent.add(testItem);
        this.testItemMap.set(test.id, testItem);
    }

    /**
     * Run tests
     */
    private async runTests(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!this.testController) {
            return;
        }

        const run = this.testController.createTestRun(request);

        try {
            const tests = request.include || Array.from(this.testItemMap.values());

            for (const testItem of tests) {
                if (token.isCancellationRequested) {
                    break;
                }

                await this.runSingleTest(testItem, run);
            }

        } catch (error) {
            OutputChannel.error('Test run failed', error as Error);
        } finally {
            run.end();
        }
    }

    /**
     * Run a single test and return whether it passed
     */
    private async runSingleTest(
        testItem: vscode.TestItem,
        run: vscode.TestRun
    ): Promise<boolean> {
        run.started(testItem);

        try {
            // Check if it's a suite or a test
            if (testItem.children.size > 0) {
                // It's a suite - run all children and track results
                let allPassed = true;
                const startTime = Date.now();

                for (const [, child] of testItem.children) {
                    const childPassed = await this.runSingleTest(child, run);
                    if (!childPassed) {
                        allPassed = false;
                    }
                }

                const duration = Date.now() - startTime;

                // Mark the suite based on children results
                if (allPassed) {
                    run.passed(testItem, duration);
                    return true;
                } else {
                    const message = new vscode.TestMessage('One or more child tests failed');
                    run.failed(testItem, message, duration);
                    return false;
                }
            } else {
                // It's a test - execute it
                const result = await this.testService.runTest(testItem.id);

                // Format and append detailed test output
                const output = this.formatTestOutput(result);
                run.appendOutput(output);

                // ALSO log to Output channel so user can see it
                OutputChannel.info('='.repeat(80));
                OutputChannel.info(`TEST RESULTS: ${testItem.label}`);
                OutputChannel.info('='.repeat(80));
                OutputChannel.info(`Status: ${result.success ? '✓ PASSED' : '✗ FAILED'}`);
                OutputChannel.info(`Duration: ${result.duration}ms`);
                if (result.message) {
                    OutputChannel.info(`Message: ${result.message}`);
                }
                if (result.actualOutcome) {
                    OutputChannel.info(`Score: ${result.actualOutcome.score}`);
                    OutputChannel.info(`Checks: ${result.actualOutcome.passedChecks}/${result.actualOutcome.totalChecks}`);
                }
                if (result.error) {
                    OutputChannel.error(`Error: ${result.error}`);
                }
                OutputChannel.info('='.repeat(80));

                if (result.success) {
                    run.passed(testItem, result.duration);
                    this.addSuccessDecoration(testItem);
                    return true;
                } else {
                    const message = new vscode.TestMessage(
                        result.error || result.message || 'Test failed'
                    );
                    run.failed(testItem, message, result.duration);
                    this.addFailureDecoration(testItem);
                    return false;
                }
            }

        } catch (error) {
            OutputChannel.error(`Test execution error: ${testItem.label}`, error as Error);
            const message = new vscode.TestMessage((error as Error).message);
            run.failed(testItem, message);
            this.addFailureDecoration(testItem);
            return false;
        }
    }

    /**
     * Run all tests
     */
    private async runAllTests(): Promise<void> {
        if (!this.testController) {
            return;
        }

        const request = new vscode.TestRunRequest(
            Array.from(this.testItemMap.values())
        );

        await this.runTests(request, new vscode.CancellationTokenSource().token);
    }

    /**
     * Add success decoration to test
     */
    private addSuccessDecoration(_testItem: vscode.TestItem): void {
        // TODO: Add inline decorations showing test passed
        // This would require tracking test locations in source files
    }

    /**
     * Add failure decoration to test
     */
    private addFailureDecoration(_testItem: vscode.TestItem): void {
        // TODO: Add inline decorations showing test failed
        // This would require tracking test locations in source files
    }

    /**
     * Clear test results
     */
    private clearTestResults(): void {
        // Clear decorations
        vscode.window.visibleTextEditors.forEach(editor => {
            editor.setDecorations(this.decorationType, []);
        });

        vscode.window.showInformationMessage('Test results cleared');
    }

    /**
     * Format test output for display
     */
    private formatTestOutput(result: {
        testId: string;
        testRunId: string;
        success: boolean;
        message?: string;
        startedAt: Date;
        endedAt?: Date;
        duration?: number;
        actualOutcome?: Record<string, unknown>;
        error?: string;
    }): string {
        const lines: string[] = [];

        // Header
        lines.push('');
        lines.push('TEST EXECUTION RESULTS');
        lines.push('='.repeat(80));

        // Status
        const statusIcon = result.success ? '✓' : '✗';
        const statusText = result.success ? 'PASSED' : 'FAILED';
        lines.push(`Status: ${statusIcon} ${statusText}`);
        lines.push(`Duration: ${result.duration}ms`);
        lines.push('');

        // Message
        if (result.message) {
            lines.push(`Message: ${result.message}`);
            lines.push('');
        }

        // Results
        if (result.actualOutcome) {
            lines.push('Results:');
            if (result.actualOutcome.score !== undefined) {
                lines.push(`  - Score: ${result.actualOutcome.score}`);
            }
            if (result.actualOutcome.passedChecks !== undefined && result.actualOutcome.totalChecks !== undefined) {
                lines.push(`  - Checks: ${result.actualOutcome.passedChecks}/${result.actualOutcome.totalChecks} passed`);
            }
            if (result.actualOutcome.status) {
                lines.push(`  - Final Status: ${result.actualOutcome.status}`);
            }
            lines.push('');
        }

        // Error
        if (result.error) {
            lines.push('Error Details:');
            lines.push(`  ${result.error}`);
            lines.push('');
        }

        // Footer
        lines.push('='.repeat(80));
        lines.push('');

        return lines.join('\r\n');
    }

    /**
     * Collect all test IDs from suite hierarchy
     */
    private collectAllTestIds(suites: MJTestSuite[], testIds: Set<string>): void {
        for (const suite of suites) {
            for (const test of suite.tests) {
                testIds.add(test.id);
            }
            this.collectAllTestIds(suite.childSuites, testIds);
        }
    }
}
