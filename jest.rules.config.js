// Firestore security rules tests. They run against the Firestore emulator,
// so they're kept out of the default `npm test` run — use `npm run test:rules`,
// which starts the emulator (firebase-tools, needs Java 11+) and runs these.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/rules.*.test.ts'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { allowJs: true, esModuleInterop: true } }] },
};
