module.exports = {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['dist/**', 'node_modules/**'],
  rules: {
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