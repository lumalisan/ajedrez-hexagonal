import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/action-identity.ts',
        'src/engine.ts',
        'src/hex.ts',
        'src/game-config.ts',
        'src/match-record.ts',
        'src/scenarios.ts',
        'src/tactical-analysis.ts',
      ],
      thresholds: {
        lines: 75,
        functions: 75,
        statements: 75,
        branches: 65,
      },
    },
  },
});
