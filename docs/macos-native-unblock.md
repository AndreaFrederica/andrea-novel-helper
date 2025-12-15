**macOS：原生模块 (.node) 被 Gatekeeper/隔离阻止 — 解除方法与说明**

概述
- 当扩展尝试加载原生模块（`.node` 文件）时，macOS 的 Gatekeeper 或文件隔离（quarantine）可能阻止 `dlopen`/`require`，导致扩展功能异常。
- 本文档说明如何识别问题、可行的修复命令及在 VS Code 中运行的安全提示。

何时使用本说明
- 扩展报错日志或控制台出现类似信息：
  - "library load disallowed by system policy"
  - "not valid for use in process"
  - 包含 `dlopen(...)` 的错误
- 功能异常为原生模块相关（例如键盘模拟、系统级交互等）。

重要安全说明
- 解除隔离或签名操作涉及修改本机二进制文件和系统信任条目，请仅在你信任该扩展来源时执行。
- 扩展无法替你在“系统设置 → 隐私与安全”里点击授权；我们只能引导并在集成终端中运行命令（需你确认）。

快速修复命令（在 macOS 上）

- 1) 对整个扩展目录移除隔离标志（推荐）

```bash
xattr -dr com.apple.quarantine "<EXTENSION_DIR>"
```

说明：`<EXTENSION_DIR>` 替换为你安装的扩展目录（通常位于 `~/.vscode/extensions/<publisher>.<name>-<version>`，在 VS Code 中可通过“在扩展视图 → 打开扩展文件夹”快速定位，扩展内也会提供 Reveal 功能）。

- 2) 仅对具体 `.node` 文件移除隔离（更精确）

```bash
xattr -d com.apple.quarantine "<EXTENSION_DIR>/node_modules/@anh/enigo-keyboard/enigo_keyboard.node"
```

- 3) （开发/测试用）对 `.node` 做 ad-hoc 签名（注意：这不是发布签名，适用于临时测试）

```bash
codesign --force --sign - "<EXTENSION_DIR>/node_modules/@anh/enigo-keyboard/enigo_keyboard.node"
```

- 4) 验证（可选）：检查签名/策略状态

```bash
spctl --assess --type execute --verbose=4 "<EXTENSION_DIR>/node_modules/@anh/enigo-keyboard/enigo_keyboard.node"
otool -L "<EXTENSION_DIR>/node_modules/@anh/enigo-keyboard/enigo_keyboard.node"
```

操作步骤（推荐顺序）
1. 在扩展弹窗里选择“复制修复命令”或“在终端运行修复命令”。
2. 如果选择复制：打开 VS Code 集成终端（快捷键 Ctrl+` 或 View → Terminal），粘贴并运行命令；如果选择在终端运行，扩展会在可见的终端中把命令放入但不会自动按回车（以便你确认）。
3. 等待命令完成（可能需要输入密码以执行某些操作）。
4. 运行完成后，重启 VS Code（必须）以使 `dlopen` 生效。

注意与限制
- 如果扩展或二进制来自未签名或来自第三方分发渠道，长期方案是通过发布方使用 Developer ID 签名并提交 notarization（苹果公证），这样大多数用户不需要手动干预。
- 对于 Apple Silicon（arm64）与 x64 二进制，确保你使用的二进制是对应架构或包含 fat binary；若出现架构不兼容，请联系扩展发布方获取对应平台的构建。

开发者/发布者建议
- 发布时为 `.node` 使用 Developer ID 签名并做 notarize，从根本避免大多数 macOS Gatekeeper 问题。
- 在打包 VSIX 时避免包含临时 build artefacts，确保发布包中包含最终编译好的 `.node`（并按平台区分）。

扩展内用户交互说明
- 本扩展实现了：检测 `.node` 加载异常 → 若匹配 macOS 安全策略错误则弹窗引导用户 → 提供按钮：复制命令、在终端打开并放入命令、打开扩展目录、查看帮助。
- 执行命令仍需用户确认，扩展不会在后台静默修改系统设置或自动完成“系统偏好”授权点击。

常见问题（FAQ）
Q: 我运行命令后仍然报错？
A: 检查你运行的命令路径是否正确，使用 `spctl --assess` 验证；若是代码签名缺失导致的限制，临时 ad-hoc 签名常能解决测试问题；若继续失败，请把错误信息贴到扩展仓库 issue 以便排查。

Q: 我不想运行命令，如何永久避免？
A: 仅发布方通过 Developer ID 签名并进行 notarize 才能提供无需用户干预的体验，请向扩展作者反馈请求签名的官方发布版本。

附录：在 VS Code 内的典型命令示例（供复制）

- 针对扩展根目录解除隔离并尝试 ad-hoc 签名（开发者模式示例）：

```bash
xattr -dr com.apple.quarantine "${EXTENSION_DIR}" && codesign --force --sign - "${EXTENSION_DIR}/node_modules/@anh/enigo-keyboard/enigo_keyboard.node" 2>/dev/null || true
```

如需帮助，请在仓库 Issues 中提交带有错误日志的 Issue。