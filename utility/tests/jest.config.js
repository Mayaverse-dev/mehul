/**
 * Jest Configuration for Maya Store Tests
 */

module.exports = {
    // Test environment
    testEnvironment: 'node',
    
    // Root directory
    rootDir: '../../',
    
    // Test file patterns
    testMatch: [
        '**/utility/tests/**/*.test.js'
    ],
    
    // Setup files
    setupFilesAfterEnv: [],
    
    // Timeout for async tests (database operations may need more time)
    testTimeout: 30000,
    
    // Verbose output
    verbose: true,
    
    // Coverage settings (optional)
    collectCoverage: false,
    coverageDirectory: 'utility/tests/coverage',
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/utility/tests/'
    ],
    
    // Module paths
    modulePathIgnorePatterns: [
        '<rootDir>/node_modules/'
    ],
    
    // Force exit after tests complete
    forceExit: true,
    
    // Detect open handles (useful for debugging connection issues)
    detectOpenHandles: true,
    
    // Run tests sequentially (important for shared database)
    maxWorkers: 1
};
