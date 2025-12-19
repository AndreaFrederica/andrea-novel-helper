/**
 * 简单语言服务代理测试脚本
 * 
 * 使用方法：
 * 1. 在 VSCode 中打开此文件
 * 2. 打开命令面板 (Ctrl+Shift+P)
 * 3. 运行以下命令进行测试：
 *    - andrea.getHover
 *    - andrea.getCompletion
 *    - andrea.getDefinition
 *    - andrea.getSymbols
 *    - andrea.getDiagnostics
 *    - andrea.getSemanticTokens
 */

// 测试 1: Hover 功能
// 将光标放在下面的 console.log 上，然后运行 andrea.getHover 命令
console.log("Hello, World!");

// 测试 2: 自动完成功能
// 将光标放在 Math. 后面，然后运行 andrea.getCompletion 命令
const result = Math.random; // 光标放在这里

// 测试 3: 定义功能
// 将光标放在 greet 函数调用上，然后运行 andrea.getDefinition 命令
function greet(name) {
    return `Hello, ${name}!`;
}

const message = greet("World"); // 光标放在这里

// 测试 4: 符号功能
// 运行 andrea.getSymbols 命令，应该看到上面的函数和变量

// 测试 5: 诊断功能
// 故意写一个错误，然后运行 andrea.getDiagnostics 命令
const x = 1;
x = "hello"; // 类型错误

// 测试 6: 语义标记功能
// 运行 andrea.getSemanticTokens 命令

// 测试 7: TypeScript 代码
// 将此文件另存为 .ts 文件，然后测试 TypeScript 特有的功能
/*
interface Person {
    name: string;
    age: number;
}

const person: Person = {
    name: "John",
    age: 30
};
*/

// 将光标放在 person 上，然后运行 andrea.getHover 命令
// console.log(person);

// 测试 8: JSON 代码
/*
{
  "name": "test",
  "value": 123
}
*/
// 将上面的 JSON 代码保存为 .json 文件，然后测试 JSON 特有的功能

console.log("测试完成！如果所有功能都正常工作，你应该能看到相应的结果。");