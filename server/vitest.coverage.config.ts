import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
