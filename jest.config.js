/**
 * CommonJS, matching the package build — every consumer is CJS, so testing as ESM would
 * exercise a module format nothing actually loads.
 */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  moduleNameMapper: {
    // Sources carry explicit .js specifiers (NodeNext); map them back to .ts under Jest.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/test/**/*.test.ts'],
};
