/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  clearMocks: true,
  resetMocks: false,
  restoreMocks: false,
};

module.exports = config;
