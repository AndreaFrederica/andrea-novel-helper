## 🌐 WebDAV 云端同步使用指南

### 配置 WebDAV 账户

1. 打开命令面板（Ctrl+Shift+P）
2. 搜索并执行 "Andrea Novel Helper: Configure WebDAV"
3. 输入 WebDAV 服务器信息：
   - 服务器地址（如：https://your-webdav-server.com/dav/）
   - 用户名和密码
   - 账户名称（用于区分多个账户）

### 开始同步

1. 配置完成后，在状态栏会显示 WebDAV 同步状态
2. 点击状态栏图标可以手动触发同步
3. 支持自动同步和手动同步两种模式

### 同步规则

- 默认同步整个工作区
- 自动排除 `.git` 和 `.anh-fsdb` 文件夹
- 支持自定义排除规则
- 冲突时优先保留本地文件

### WebDAV 服务器推荐

- **坚果云**：国内用户推荐，稳定可靠
- **Nextcloud**：开源自建方案
- **ownCloud**：企业级解决方案
- **Box**、**Dropbox** 等商业云存储服务
