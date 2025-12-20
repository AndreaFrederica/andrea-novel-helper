# 角色合并测试示例

## 基本合并测试

### 场景1：名称不同的角色合并

```javascript
// 角色A (来自MD文件)
const roleA = {
    name: '张三',
    uuid: 'test-uuid-123',
    type: '角色',
    color: '#FF0000',
    aliases: ['小三', '阿三'],
    fixes: ['张小三'],
    description: '基础角色'
};

// 角色B (来自JSON5文件)
const roleB = {
    name: '张小三',  // 不同的名称
    uuid: 'test-uuid-123',  // 相同的UUID
    type: '角色',
    color: '#00FF00',
    aliases: ['小张'],
    fixes: ['张三哥'],
    priority: 5,
    description: '合并角色'
};

// 合并结果预期：
// - name: '张三' (保留基础角色的名称)
// - aliases: ['小三', '阿三', '小张', '张小三'] (包含所有别名 + 被合并角色的名称)
// - color: '#FF0000' (保留基础角色的颜色)
// - priority: 5 (合并优先级)
```

### 场景2：文件名前缀优先级

使用 `fileName` 策略时，以下文件的优先级：

1. `__zhangsan.json5` - 优先级 1000 (高优先级前缀)
2. `zhangsan.ojson5` - 优先级 3 (OJSON5文件)
3. `zhangsan.json5` - 优先级 2 (JSON5文件)
4. `zhangsan.md` - 优先级 1 (MD文件)

### 场景3：文件类型优先级

使用 `fileType` 策略时：
- `.ojson5` > `.json5` > `.md` > `.txt`

## 验证步骤

1. 创建具有相同UUID但不同名称的角色文件
2. 在VSCode设置中配置 `AndreaNovelHelper.rolePriority`
3. 刷新角色库
4. 检查：
   - 相同UUID的角色是否合并为一个
   - 不同名称是否添加到别名中
   - 颜色和hover内容是否一致