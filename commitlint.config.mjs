export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "chore",
        "docs",
        "refactor",
        "test",
        "perf",
        "build",
        "ci",
        "style",
        "revert",
      ],
    ],
  },
};
