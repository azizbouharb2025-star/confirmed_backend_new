module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js'
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 60000,
  transformIgnorePatterns: [
    'node_modules/(?!(uuid)/)'
  ],
  transform: {
    '^.+\\.js$': 'babel-jest'
  }
};