module.exports = {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['dist/**', 'node_modules/**'],
  rules: {
    // Tailwind 4's entrypoint must stay `@import "tailwindcss"` — bundlers
    // resolve the bare package specifier only in string notation, so the
    // standard preset's url() rewrite would silently break the stylesheet.
    'import-notation': 'string',
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: [
          'tailwind',
          'apply',
          'layer',
          'config',
          'variants',
          'responsive',
          'screen',
        ],
      },
    ],
  },
}