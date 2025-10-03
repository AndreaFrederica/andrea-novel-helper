// src/data/timelineSampleData.ts
// 时间线示例数据
import type { TimelineData } from '../types/timeline';

export const timelineSampleData: TimelineData = {
  "events": [
    {
      "id": "0192a5e0-0000-7000-8000-000000000001",
      "title": "故事开始",
      "group": "主要情节",
      "type": "main",
      "date": "2024-01-01T00:00:00",
      "description": "主角出场",
      "position": {
        "x": 0,
        "y": 100
      },
      "data": {
        "type": "main"
      },
      "width": 200,
      "height": 120
    },
    {
      "id": "0192a5e0-0001-7000-8000-000000000002",
      "title": "冲突出现",
      "group": "主要情节",
      "type": "main",
      "date": "2024-01-05T12:00:00",
      "endDate": "2024-01-08T18:00:00",
      "description": "主角面临第一个挑战",
      "position": {
        "x": 455.2541116518923,
        "y": -3.072840686955658
      },
      "width": 347,
      "height": 512,
      "data": {
        "type": "main"
      },
      "bindings": [],
      "expandParent": false
    },
    {
      "id": "0192a5e0-0002-7000-8000-000000000003",
      "title": "配角背景",
      "group": "背景故事",
      "type": "side",
      "date": "2024-01-03T08:30:00",
      "description": "配角的过去经历",
      "position": {
        "x": 200,
        "y": 250
      },
      "data": {
        "type": "side"
      },
      "width": 200,
      "height": 120
    },
    {
      "id": "0192a5e0-0003-7000-8000-000000000004",
      "title": "初次交锋",
      "group": "冲突细节",
      "type": "main",
      "date": "2024-01-06T09:00:00",
      "description": "主角与反派的初次交锋",
      "position": {
        "x": 88.03087039462872,
        "y": 93.24667273497916
      },
      "parentNode": "0192a5e0-0001-7000-8000-000000000002",
      "extent": "parent",
      "bindings": [],
      "data": {
        "type": "main"
      },
      "expandParent": true,
      "width": 200,
      "height": 120
    },
    {
      "id": "0192a5e0-0004-7000-8000-000000000005",
      "title": "主角背景",
      "group": "故事背景",
      "type": "side",
      "date": "2024-01-03T14:00:00",
      "description": "主角的背景",
      "position": {
        "x": 203.33007671711712,
        "y": 381.29720194882486
      },
      "bindings": [],
      "data": {
        "type": "side"
      },
      "width": 200,
      "height": 120
    },
    {
      "id": "0192a5e0-0005-7000-8000-000000000006",
      "title": "结局",
      "group": "主要",
      "type": "main",
      "date": "2025-10-03T00:00:00",
      "description": "",
      "position": {
        "x": 497.74141660601686,
        "y": 573.9482830407842
      },
      "data": {
        "type": "main"
      },
      "width": 200,
      "height": 120
    },
    {
      "id": "0199ab5e-0fea-71-945d-eed460803b5a",
      "title": "后日谈",
      "group": "条件分组",
      "type": "main",
      "date": "2025-10-03",
      "description": "再来一次",
      "position": {
        "x": 233.65234048493568,
        "y": 567.4031035772243
      },
      "width": 200,
      "height": 120,
      "data": {
        "type": "condition"
      },
      "bindings": [],
      "expandParent": false
    },
    {
      "id": "0199ab5f-464a-7d-a56a-ecb0aa37a77c",
      "title": "再次交锋 ",
      "group": "冲突细节",
      "type": "main",
      "date": "2024-01-07T09:00:00",
      "description": "主角与反派的再次交锋",
      "position": {
        "x": 88.79578996268407,
        "y": 219.12013178571618
      },
      "parentNode": "0192a5e0-0001-7000-8000-000000000002",
      "extent": "parent",
      "bindings": [],
      "data": {
        "type": "main"
      },
      "expandParent": true,
      "width": 200,
      "height": 120
    },
    {
      "id": "0199ab5f-cb68-7c-ad58-d19e75d77bfe",
      "title": "最终决斗",
      "group": "冲突细节",
      "type": "main",
      "date": "2024-01-08T09:00:00",
      "description": "主角与反派的最终决斗",
      "position": {
        "x": 82.69494545453398,
        "y": 348.7674787365578
      },
      "parentNode": "0192a5e0-0001-7000-8000-000000000002",
      "extent": "parent",
      "bindings": [],
      "data": {
        "type": "main"
      },
      "expandParent": true,
      "width": 200,
      "height": 120
    },
    {
      "id": "0199ab62-19bb-78-9c60-20d63ca6d94e",
      "title": "真的结束了",
      "group": "默认分组",
      "type": "main",
      "date": "2025-10-05T00:00:00",
      "description": "退出故事",
      "position": {
        "x": 497.62878595080787,
        "y": 721.0979726987077
      },
      "width": 200,
      "height": 120,
      "data": {
        "type": "main"
      },
      "bindings": [],
      "expandParent": false,
      "color": "#d45959"
    }
  ],
  "connections": [
    {
      "id": "0192a5e0-1000-7000-8000-000000000001",
      "source": "0192a5e0-0000-7000-8000-000000000001",
      "target": "0192a5e0-0001-7000-8000-000000000002"
    },
    {
      "id": "0192a5e0-1001-7000-8000-000000000002",
      "source": "0192a5e0-0000-7000-8000-000000000001",
      "target": "0192a5e0-0002-7000-8000-000000000003"
    },
    {
      "id": "0192a5e0-1002-7000-8000-000000000003",
      "source": "0192a5e0-0002-7000-8000-000000000003",
      "target": "0192a5e0-0001-7000-8000-000000000002"
    },
    {
      "id": "0192a5e0-1005-7000-8000-000000000006",
      "source": "0192a5e0-0004-7000-8000-000000000005",
      "target": "0192a5e0-0001-7000-8000-000000000002",
      "connectionType": "normal"
    },
    {
      "id": "0199ab5e-6cb2-73-8940-5d59edb0767e",
      "source": "0192a5e0-0005-7000-8000-000000000006",
      "target": "0199ab5e-0fea-71-945d-eed460803b5a",
      "connectionType": "normal"
    },
    {
      "id": "0199ab5e-8b6d-79-808f-bc2e248e2a4a",
      "source": "0199ab5e-0fea-71-945d-eed460803b5a",
      "target": "0192a5e0-0000-7000-8000-000000000001",
      "connectionType": "time-travel"
    },
    {
      "id": "0199ab60-a67c-7e-94ca-0a3792a84ba7",
      "source": "0192a5e0-0003-7000-8000-000000000004",
      "target": "0199ab5f-464a-7d-a56a-ecb0aa37a77c",
      "connectionType": "normal"
    },
    {
      "id": "0199ab60-ae64-78-9590-4ef8a6d7667b",
      "source": "0199ab5f-464a-7d-a56a-ecb0aa37a77c",
      "target": "0199ab5f-cb68-7c-ad58-d19e75d77bfe",
      "connectionType": "normal"
    },
    {
      "id": "0199ab60-c770-70-b3ff-eaab244ef44b",
      "source": "0192a5e0-0001-7000-8000-000000000002",
      "target": "0192a5e0-0005-7000-8000-000000000006",
      "connectionType": "normal"
    },
    {
      "id": "0199ab62-a393-72-b75b-7a649fa642f5",
      "source": "0199ab5e-0fea-71-945d-eed460803b5a",
      "target": "0199ab62-19bb-78-9c60-20d63ca6d94e",
      "connectionType": "normal",
      "sourceHandle": "false"
    }
  ]
};

export default timelineSampleData;
