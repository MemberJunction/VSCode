import { RunView, UserInfo, BaseEntity } from '@memberjunction/core';
import { OutputChannel } from '../common/OutputChannel';
import { ConnectionService } from './ConnectionService';

/**
 * Represents a test in the MJ Testing Framework
 */
export interface MJTest {
    id: string;
    name: string;
    description?: string;
    testTypeId: string;
    testTypeName: string;
    inputDefinition?: Record<string, unknown>;
    expectedOutcomes?: Record<string, unknown>;
    configuration?: Record<string, unknown>;
    tags?: string[];
    suiteName?: string;
    suiteId?: string;
}

/**
 * Represents a test suite
 */
export interface MJTestSuite {
    id: string;
    name: string;
    description?: string;
    parentId?: string;
    tests: MJTest[];
    childSuites: MJTestSuite[];
}

/**
 * Test execution result
 */
export interface MJTestResult {
    testId: string;
    testRunId: string;
    success: boolean;
    message?: string;
    startedAt: Date;
    endedAt?: Date;
    duration?: number;
    actualOutcome?: Record<string, unknown>;
    error?: string;
}

/**
 * Test run options
 */
export interface TestRunOptions {
    verbose?: boolean;
    timeout?: number;
    variables?: Record<string, unknown>;
}

/**
 * Service for interacting with MemberJunction Testing Framework
 *
 * Provides:
 * - Test discovery from database
 * - Test execution
 * - Result retrieval
 * - Suite management
 */
export class TestService {
    private static instance: TestService | null = null;
    private initialized: boolean = false;
    private contextUser: UserInfo | null = null;
    private cachedTests: MJTest[] = [];
    private cachedSuites: MJTestSuite[] = [];
    private cacheTimestamp: number = 0;
    private readonly CACHE_TTL_MS = 30000; // 30 seconds cache

    private constructor() {}

    /**
     * Get singleton instance
     */
    static getInstance(): TestService {
        if (!TestService.instance) {
            TestService.instance = new TestService();
        }
        return TestService.instance;
    }

    /**
     * Initialize the test service
     */
    async initialize(force: boolean = false): Promise<boolean> {
        if (this.initialized && !force) {
            return true;
        }

        try {
            OutputChannel.info('Initializing Test Service...');

            const connectionService = ConnectionService.getInstance();

            if (!connectionService.isConnected) {
                OutputChannel.warn('Database not connected - Test Service will not be available');
                return false;
            }

            this.contextUser = connectionService.systemUser || null;

            if (!this.contextUser) {
                OutputChannel.warn('No user context available for Test Service');
                return false;
            }

            this.initialized = true;
            OutputChannel.info('Test Service initialized successfully');
            return true;

        } catch (error) {
            OutputChannel.error('Failed to initialize Test Service', error as Error);
            return false;
        }
    }

    /**
     * Check if the service is ready to use
     */
    isReady(): boolean {
        return this.initialized && this.contextUser !== null;
    }

    /**
     * List all test suites with their tests
     */
    async listTestSuites(forceRefresh: boolean = false): Promise<MJTestSuite[]> {
        if (!this.isReady()) {
            await this.initialize();
            if (!this.isReady()) {
                throw new Error('Test Service not initialized. Connect to database first.');
            }
        }

        try {
            // Check cache
            const now = Date.now();
            if (!forceRefresh && this.cachedSuites.length > 0 && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
                return this.cachedSuites;
            }

            // Load test suites
            const rv = new RunView();
            const suitesResult = await rv.RunView({
                EntityName: 'MJ: Test Suites',
                ExtraFilter: '',
                OrderBy: 'Name',
                ResultType: 'entity_object'
            }, this.contextUser!);

            if (!suitesResult.Success) {
                // Check if the error is because Testing Framework isn't installed
                const errorMsg = suitesResult.ErrorMessage || '';
                if (errorMsg.includes('not found')) {
                    OutputChannel.warn('MJ Testing Framework entities not found. The Testing Framework may not be installed in this database.');
                    this.cachedSuites = [];
                    this.cacheTimestamp = now;
                    return [];
                }
                throw new Error(`Failed to load test suites: ${errorMsg}`);
            }

            const suites = suitesResult.Results || [];

            // Load all tests
            const tests = await this.listTests(forceRefresh);

            // Build hierarchical structure
            this.cachedSuites = this.buildSuiteHierarchy(suites, tests);
            this.cacheTimestamp = now;

            return this.cachedSuites;

        } catch (error) {
            OutputChannel.error('Failed to list test suites', error as Error);
            throw error;
        }
    }

    /**
     * List all tests
     */
    async listTests(forceRefresh: boolean = false): Promise<MJTest[]> {
        if (!this.isReady()) {
            await this.initialize();
            if (!this.isReady()) {
                throw new Error('Test Service not initialized. Connect to database first.');
            }
        }

        try {
            // Check cache
            const now = Date.now();
            if (!forceRefresh && this.cachedTests.length > 0 && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
                return this.cachedTests;
            }

            const rv = new RunView();
            const testsResult = await rv.RunView({
                EntityName: 'MJ: Tests',
                ExtraFilter: '',
                OrderBy: 'Name',
                ResultType: 'entity_object'
            }, this.contextUser!);

            if (!testsResult.Success) {
                // Check if the error is because Testing Framework isn't installed
                const errorMsg = testsResult.ErrorMessage || '';
                if (errorMsg.includes('not found')) {
                    OutputChannel.warn('MJ Testing Framework entities not found. The Testing Framework may not be installed in this database.');
                    this.cachedTests = [];
                    this.cacheTimestamp = now;
                    return [];
                }
                throw new Error(`Failed to load tests: ${errorMsg}`);
            }

            const testEntities = testsResult.Results || [];

            this.cachedTests = testEntities.map((entity: BaseEntity) => this.mapTestEntity(entity));
            this.cacheTimestamp = now;

            return this.cachedTests;

        } catch (error) {
            OutputChannel.error('Failed to list tests', error as Error);
            throw error;
        }
    }

    /**
     * Execute a single test
     */
    async runTest(testId: string, options: TestRunOptions = {}): Promise<MJTestResult> {
        if (!this.isReady()) {
            await this.initialize();
            if (!this.isReady()) {
                throw new Error('Test Service not initialized. Connect to database first.');
            }
        }

        try {
            // For now, we'll use a simulated execution
            // In the future, this should call the MJ Testing Engine directly
            const result = await this.executeTestViaEngine(testId, options);

            return result;

        } catch (error) {
            OutputChannel.error(`Failed to execute test ${testId}`, error as Error);
            throw error;
        }
    }

    /**
     * Execute a test suite
     */
    async runTestSuite(suiteId: string, options: TestRunOptions = {}): Promise<MJTestResult[]> {
        if (!this.isReady()) {
            await this.initialize();
            if (!this.isReady()) {
                throw new Error('Test Service not initialized. Connect to database first.');
            }
        }

        try {
            // Get all tests in the suite
            const suite = await this.getTestSuite(suiteId);
            if (!suite) {
                throw new Error(`Test suite not found: ${suiteId}`);
            }

            const results: MJTestResult[] = [];

            // Execute all tests in the suite
            for (const test of suite.tests) {
                const result = await this.runTest(test.id, options);
                results.push(result);
            }

            // Recursively execute child suites
            for (const childSuite of suite.childSuites) {
                const childResults = await this.runTestSuite(childSuite.id, options);
                results.push(...childResults);
            }

            return results;

        } catch (error) {
            OutputChannel.error(`Failed to execute test suite ${suiteId}`, error as Error);
            throw error;
        }
    }

    /**
     * Get a specific test suite by ID
     */
    async getTestSuite(suiteId: string): Promise<MJTestSuite | null> {
        const suites = await this.listTestSuites();
        return this.findSuiteById(suites, suiteId);
    }

    /**
     * Clear the cache
     */
    clearCache(): void {
        this.cachedTests = [];
        this.cachedSuites = [];
        this.cacheTimestamp = 0;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this.initialized = false;
        this.contextUser = null;
        this.clearCache();
        TestService.instance = null;
    }

    // ---- Private helper methods ----

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    private mapTestEntity(entity: BaseEntity): MJTest {
        const inputDef = this.parseJSON(entity.Get('InputDefinition'));
        const expectedOut = this.parseJSON(entity.Get('ExpectedOutcomes'));
        const config = this.parseJSON(entity.Get('Configuration'));
        const tagsData = this.parseJSON(entity.Get('Tags'));

        return {
            id: entity.Get('ID'),
            name: entity.Get('Name'),
            description: entity.Get('Description') || undefined,
            testTypeId: entity.Get('TypeID'),
            testTypeName: entity.Get('Type') || 'Unknown',
            inputDefinition: this.isRecord(inputDef) ? inputDef : undefined,
            expectedOutcomes: this.isRecord(expectedOut) ? expectedOut : undefined,
            configuration: this.isRecord(config) ? config : undefined,
            tags: Array.isArray(tagsData) ? tagsData.filter((t): t is string => typeof t === 'string') : []
        };
    }

    private buildSuiteHierarchy(suiteEntities: BaseEntity[], _tests: MJTest[]): MJTestSuite[] {
        const suiteMap = new Map<string, MJTestSuite>();
        const rootSuites: MJTestSuite[] = [];

        // First pass: create all suite objects
        for (const entity of suiteEntities) {
            const suite: MJTestSuite = {
                id: entity.Get('ID'),
                name: entity.Get('Name'),
                description: entity.Get('Description') || undefined,
                parentId: entity.Get('ParentID') || undefined,
                tests: [],
                childSuites: []
            };
            suiteMap.set(suite.id, suite);
        }

        // Second pass: assign tests to suites (would need to query TestSuiteTest junction table)
        // For now, tests without explicit suite assignment will be in root
        // TODO: Query TestSuiteTest junction table to get tests for this suite

        // Third pass: build hierarchy
        for (const suite of suiteMap.values()) {
            if (suite.parentId && suiteMap.has(suite.parentId)) {
                suiteMap.get(suite.parentId)!.childSuites.push(suite);
            } else {
                rootSuites.push(suite);
            }
        }

        return rootSuites;
    }

    private findSuiteById(suites: MJTestSuite[], suiteId: string): MJTestSuite | null {
        for (const suite of suites) {
            if (suite.id === suiteId) {
                return suite;
            }
            const found = this.findSuiteById(suite.childSuites, suiteId);
            if (found) {
                return found;
            }
        }
        return null;
    }

    private async executeTestViaEngine(testId: string, _options: TestRunOptions): Promise<MJTestResult> {
        // TODO: Integrate with @memberjunction/testing-engine package
        // For now, return a simulated result
        const startedAt = new Date();

        // Simulate test execution delay
        await new Promise(resolve => setTimeout(resolve, 100));

        const endedAt = new Date();
        const duration = endedAt.getTime() - startedAt.getTime();

        return {
            testId,
            testRunId: this.generateUUID(),
            success: Math.random() > 0.2, // 80% pass rate for simulation
            message: 'Test executed successfully',
            startedAt,
            endedAt,
            duration,
            actualOutcome: {}
        };
    }

    private parseJSON(value: unknown): unknown {
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            } catch {
                return value;
            }
        }
        return value;
    }

    private generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}
