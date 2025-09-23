import js from '@eslint/js';
import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';
import pluginQuasar from '@quasar/app-vite/eslint';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import prettierSkipFormatting from '@vue/eslint-config-prettier/skip-formatting';

export default defineConfigWithVueTs(
  {
    /**
     * Ignore the following files.
     * Please note that pluginQuasar.configs.recommended() already ignores
     * the "node_modules" folder for you (and all other Quasar project
     * relevant folders and files).
     *
     * ESLint requires "ignores" key to be the only one in this object
     */
    // ignores: []
  },

  // 基础推荐集
  pluginQuasar.configs.recommended(),
  js.configs.recommended,

  // Vue 基础（不要用 strongly/recommended 以免加更多限制）
  pluginVue.configs['flat/essential'],

  // 类型检查相关（放在前面，后面会用“最终覆盖块”覆盖个别规则）
  vueTsConfigs.recommendedTypeChecked,

  // 通用语言环境与少量项目级自定义
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        process: 'readonly',
        ga: 'readonly',
        cordova: 'readonly',
        Capacitor: 'readonly',
        chrome: 'readonly',
        browser: 'readonly',
      },
    },
    rules: {
      'prefer-promise-reject-errors': 'off',
      'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    },
  },

  // 仅对 TS/Vue 文件的规则（非最终覆盖）
  {
    files: ['**/*.ts', '**/*.vue'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },

  // 跳过 Prettier 的格式化冲突规则
  prettierSkipFormatting,

  // === 最终覆盖块（必须放最后，确保放宽规则生效） ===
  {
    files: ['**/*.{ts,tsx,vue}'],
    rules: {
      // 允许 any（只警告）
      '@typescript-eslint/no-explicit-any': 'off',

      // 不必要断言：关闭
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',

      // 未使用变量：只警告，并允许下划线忽略
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
