import js from '@eslint/js'
import globals from 'globals'
import i18next from 'eslint-plugin-i18next'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // shadcn/ui 生成的组件库常伴随导出常量/变体，关闭 fast-refresh 纯净性检查（社区惯例）
    files: ['src/components/ui/**'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // 用户可见文案必须走 t()；保留品牌名、单位和快捷键键名白名单。
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/components/ui/**',
      'src/i18n/**',
      'src/**/*.test.{ts,tsx}',
    ],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-text-only',
          'jsx-attributes': {
            include: ['aria-label', 'placeholder', 'title', 'alt'],
          },
          words: {
            exclude: [
              '[0-9!-/:-@[-`{-~]+',
              '[A-Z_-]+',
              'Mumble Web',
              'Mumble',
              'WEB',
              'Space',
              'Ctrl',
              'Cmd',
              'Shift',
              'Alt',
              'Esc',
              'dB',
              'ms',
              '-60 dB',
              '-30 dB',
              '-30',
              '-6 dB',
              '0 dB',
            ],
          },
          message: '用户可见文案必须通过 t() 国际化',
        },
      ],
    },
  },
])
