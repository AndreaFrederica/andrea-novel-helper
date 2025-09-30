import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    // 禁止再使用 CommonJS require
    "@typescript-eslint/no-var-requires": "error",
    "@typescript-eslint/no-require-imports": "error",
    // 禁止使用动态 import() 表达式，项目约束
    "no-restricted-syntax": [
        "error",
        {
            "selector": "ImportExpression",
            "message": "禁止使用动态 import()，请使用静态 import 引入模块以避免循环依赖和不一致加载行为。"
        }
    ],
    },
}];