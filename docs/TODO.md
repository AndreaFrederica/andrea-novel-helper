# TODO

- [ ] 当前文章角色视图：实现节点级增量 diff 刷新（在 `docRolesTreeView` 与 `docRolesExplorerView` 中按新增/删除/更新节点触发局部刷新），避免每次动态更新都整棵树重绘。
  - 目标：减少编辑时界面闪动，保持展开状态稳定。
  - 现状：已在 `docRolesModel` 增加层级签名 diff，仅在结果变化时触发刷新，但仍是整树刷新。
