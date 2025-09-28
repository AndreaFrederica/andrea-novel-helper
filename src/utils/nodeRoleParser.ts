import { RoleRelationship, GraphData, GraphRoleNode, GraphRelationshipLine } from '../types/relationshipTypes';
import { globalRelationshipManager } from './globalRelationshipManager';
import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';

/**
 * 节点角色解析器类
 */
export class NodeRoleParser {
  private nodeMap: Map<string, GraphRoleNode> = new Map();

  /**
   * 解析图形数据，提取角色关系
   * @param graphData 图形数据
   * @returns 解析出的关系数组
   */
  public parseGraphData(graphData: GraphData): RoleRelationship[] {
    this.buildNodeMap(graphData.nodes);
    const relationships: RoleRelationship[] = [];

    for (const line of graphData.lines) {
      const relationship = this.parseLineToRelationship(line);
      if (relationship) {
        relationships.push(relationship);
        // 将关系添加到全局管理器
        globalRelationshipManager.addRelationship(relationship);
      }
    }

    return relationships;
  }

  /**
   * 构建节点映射表
   * @param nodes 节点数组
   */
  private buildNodeMap(nodes: GraphRoleNode[]): void {
    this.nodeMap.clear();
    for (const node of nodes) {
      this.nodeMap.set(node.id, node);
    }
  }

  /**
   * 将连线数据转换为关系对象
   * @param line 连线数据
   * @returns 关系对象或null
   */
  private parseLineToRelationship(line: GraphRelationshipLine): RoleRelationship | null {
    const fromNode = this.nodeMap.get(line.from);
    const toNode = this.nodeMap.get(line.to);

    if (!fromNode || !toNode) {
      console.warn(`无法找到节点: from=${line.from}, to=${line.to}`);
      return null;
    }

    // 使用节点数据中的角色名称，优先使用data.text，其次使用text
    const sourceRoleName = fromNode.data.text || fromNode.text;
    const targetRoleName = toNode.data.text || toNode.text;

    return {
      sourceRole: sourceRoleName,
      targetRole: targetRoleName,
      literalValue: line.text,
      type: line.data.type, // 直接使用连线数据中的类型
      metadata: {
        sourceRoleUuid: fromNode.data.roleUuid,
        targetRoleUuid: toNode.data.roleUuid,
        lineId: line.id,
        strength: line.data.strength,
        status: line.data.status,
        tags: line.data.tags,
        isDirectional: line.data.isDirectional
      }
    };
  }

  /**
   * 映射关系类型字符串到标准类型
   * @param typeString 类型字符串
   * @returns 关系类型字符串
   */


  /**
   * 从文件解析关系数据
   * @param filePath 文件路径
   * @returns 解析出的关系数组
   */
  public async parseFromFile(filePath: string): Promise<RoleRelationship[]> {
    // 使用静态导入的模块，避免任何动态 import
    try {
      const fullPath = path.resolve(filePath);
      console.log(`正在解析文件: ${fullPath}`);

      const content = fs.readFileSync(fullPath, 'utf-8');
      let graphData: GraphData;

      try {
        // 优先使用 JSON5 解析以兼容 rjson5 / ojson5
        graphData = (JSON5 as any).parse(content);
      } catch (json5Err) {
        try {
          // 回退到标准 JSON 解析
          graphData = JSON.parse(content);
        } catch (jsonErr) {
          // 两者都失败，抛出带详细信息的错误
          const err: any = new Error(
            `JSON5 parse failed: ${String(json5Err) || ''}; JSON parse failed: ${String(jsonErr) || ''}`
          );
          throw err;
        }
      }

      const relationships = this.parseGraphData(graphData);

      // 为每个关系添加源文件信息
      for (const relationship of relationships) {
        if (relationship.metadata) {
          relationship.metadata.sourceFile = fullPath;
        }
      }

      return relationships;
    } catch (error) {
      console.error(`解析文件失败: ${filePath}`, error);
      throw error;
    }
  }

  /**
   * 清空节点映射
   */
  public clear(): void {
    this.nodeMap.clear();
  }

  /**
   * 获取当前解析的节点数量
   */
  public getNodeCount(): number {
    return this.nodeMap.size;
  }

  /**
   * 根据角色UUID查找节点
   * @param roleUuid 角色UUID
   * @returns 节点数据或undefined
   */
  public findNodeByRoleUuid(roleUuid: string): GraphRoleNode | undefined {
    for (const node of this.nodeMap.values()) {
      if (node.data.roleUuid === roleUuid) {
        return node;
      }
    }
    return undefined;
  }

  /**
   * 根据角色名称查找节点
   * @param roleName 角色名称
   * @returns 节点数据数组
   */
  public findNodesByRoleName(roleName: string): GraphRoleNode[] {
    const results: GraphRoleNode[] = [];
    for (const node of this.nodeMap.values()) {
      if (node.data.text === roleName || node.text === roleName) {
        results.push(node);
      }
    }
    return results;
  }
}

// 导出单例实例
export const nodeRoleParser = new NodeRoleParser();