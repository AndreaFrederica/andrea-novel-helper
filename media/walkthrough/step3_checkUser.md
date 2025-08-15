# 检查 Git 用户信息

执行命令：AndreaNovelHelper.wizard.checkGitUser

脚本会读取（优先级从高到低）：
1. 当前工作区 .git/config (local)
2. 全局 ~/.gitconfig (global)

并显示有效的 user.name 与 user.email。

若任一缺失，将提示进入下一步进行配置。
