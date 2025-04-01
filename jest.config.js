// jest.config.js

module.exports = {
  // Use Node.js environment
  testEnvironment: 'node',

  // Look for test files in any 'tests/' folder ending with .test.js
  testMatch: ['**/tests/**/*.test.js'],

  // Automatically clear mock calls and instances before every test
  clearMocks: true,

  // Display individual test results with the test suite hierarchy
  verbose: true,

  // Enable code coverage collection
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],

  // Transform ES modules or use Babel if needed (optional)
  transform: {},
};
