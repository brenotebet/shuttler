module.exports = {
  projects: [
    // Pure TypeScript / Node tests (utilities, backend logic) — no Expo/RN setup needed
    {
      displayName: 'node',
      testEnvironment: 'node',
      testMatch: ['**/__tests__/utils.*.test.ts', '**/__tests__/backend.*.test.ts'],
      transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { allowJs: true } }] },
      moduleNameMapper: {
        '^../../config$': '<rootDir>/__mocks__/config.ts',
        '^../config$': '<rootDir>/__mocks__/config.ts',
        '^../../firebase/firebaseconfig$': '<rootDir>/__mocks__/firebaseconfig.ts',
        '^../firebase/firebaseconfig$': '<rootDir>/__mocks__/firebaseconfig.ts',
      },
    },
  ],
  collectCoverageFrom: [
    'src/utils/**/*.{ts,tsx}',
    '!**/node_modules/**',
  ],
};
