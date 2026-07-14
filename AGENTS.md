# CF Todo List — 架构与设计文档

## 1. 项目概述

基于 Cloudflare Pages + D1 + KV 的全栈 Todo List，支持 **每日 / 每周 / 每月** 任务视图、**看板** 管理、**数据统计分析**。

---

## 2. 周数计算规则

### 核心算法
- **每周的第一天 = 周一**
- **Week 1 = 包含 1 月 1 日的周**
  - Week 1 从 1 月 1 日（无论周几）开始
  - 到 1 月 1 日之后的第一个周日结束（若 1 月 1 日是周日则 Week 1 仅当天）
- **Week N (N ≥ 2)**
  - Week 2 始于 Week 1 结束后的第一个周一
  - 后续每周严格按 周一→周日 排布，每 7 天推进一周
- **每年独立编号**："2026-W01"、"2026-W02" ... 每年 Week 1 都从该年 1 月 1 日起算

### 示例（2026 年）
| 周编号 | 起止日期 | 天数 |
|--------|---------|------|
| 2026-W01 | 2026-01-01 (周四) ~ 2026-01-04 (周日) | 4 |
| 2026-W02 | 2026-01-05 (周一) ~ 2026-01-11 (周日) | 7 |
| 2026-W03 | 2026-01-12 (周一) ~ 2026-01-18 (周日) | 7 |
| ... | ... | ... |
| 2026-W53 | 2026-12-28 (周一) ~ 2026-12-31 (周四) | 4 |

### 计算函数（JavaScript）
```javascript
function getWeekDateRange(year, weekNum) {
  const jan1 = new Date(year, 0, 1);
  const dow = jan1.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  const week1Days = 7 - (dow === 0 ? 0 : (7 - dow) % 7);
  // 实际上: daysUntilSunday = dow === 0 ? 0 : 7 - dow
  const daysUntilSunday = dow === 0 ? 0 : 7 - dow;

  if (weekNum === 1) {
    return {
      start: new Date(year, 0, 1),
      end: new Date(year, 0, 1 + daysUntilSunday)
    };
  }

  const week2Start = new Date(year, 0, 1 + daysUntilSunday + 1);
  const start = new Date(week2Start);
  start.setDate(start.getDate() + (weekNum - 2) * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}
```

---

## 3. 数据库 Schema

### D1: `todos` 表（扩展现有表）

```sql
-- 现有列
id          TEXT PRIMARY KEY              -- UUID
user_email  TEXT NOT NULL                 -- 用户邮箱
content     TEXT NOT NULL                 -- 任务内容
completed   INTEGER DEFAULT 0            -- 0=未完成 1=已完成
created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP

-- 新增列 (ALTER TABLE)
task_type   TEXT DEFAULT 'daily'          -- 'daily' | 'weekly' | 'monthly'
target_date TEXT                          -- 统一定位字段:
                                         --   daily:   'YYYY-MM-DD'
                                         --   weekly:  'YYYY-WNN' (如 '2026-W03')
                                         --   monthly: 'YYYY-MM'
status      TEXT DEFAULT 'todo'           -- 'todo' | 'in_progress' | 'done' (看板用)
"order"     INTEGER DEFAULT 0             -- 排序权重（同一视图内）
```

### 迁移 SQL
```sql
ALTER TABLE todos ADD COLUMN task_type TEXT DEFAULT 'daily';
ALTER TABLE todos ADD COLUMN target_date TEXT;
ALTER TABLE todos ADD COLUMN status TEXT DEFAULT 'todo';
ALTER TABLE todos ADD COLUMN "order" INTEGER DEFAULT 0;
```

---

## 4. 后端 API 设计

### 基础 URL: `/api`

### 认证方式：密钥登录
- 将 `APP_SECRET_KEY` 配置到 Cloudflare Workers 环境变量中
- 登录时输入密钥，后端比对 `env.APP_SECRET_KEY`
- 验证通过后生成 session token 存入 KV，有效期 7 天

### 现有接口（不变）

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/login` | 密钥登录，返回 token |
| POST | `/api/todos` | 创建 todo（扩展接收 task_type, target_date, status） |
| PUT | `/api/todos/:id` | 更新 completed 状态 |
| DELETE | `/api/todos/:id` | 删除 todo |

### 新增/扩展接口

#### GET `/api/todos` — 查询任务（扩展）
```
查询参数:
  type:       'daily' | 'weekly' | 'monthly' | 'kanban' | 'all'
  date:       'YYYY-MM-DD'   (type=daily 时)
  week:       'YYYY-WNN'     (type=weekly 时)
  month:      'YYYY-MM'      (type=monthly 时)
  year:       'YYYY'         (type=kanban 时)
  
返回: 符合条件的任务数组
```

#### POST `/api/todos` — 创建任务（扩展请求体）
```json
{
  "content": "完成任务设计",
  "task_type": "weekly",
  "target_date": "2026-W03",
  "status": "todo"
}
```

#### PUT `/api/todos/:id/status` — 更新看板状态
```json
{ "status": "in_progress" }
```

#### PUT `/api/todos/:id/reorder` — 更新排序
```json
{ "order": 5, "status": "todo" }
```

#### GET `/api/analytics?year=2026` — 统计分析
```json
{
  "year": 2026,
  "summary": {
    "total_tasks": 365,
    "completed": 280,
    "completion_rate": 0.767
  },
  "by_type": {
    "daily":  { "total": 200, "completed": 160 },
    "weekly": { "total": 100, "completed": 80 },
    "monthly": { "total": 65, "completed": 40 }
  },
  "by_month": [
    { "month": "2026-01", "total": 30, "completed": 25 }
  ],
  "by_week": [
    { "week": "2026-W01", "total": 8, "completed": 6 }
  ],
  "streak": {
    "current": 5,
    "longest": 23
  },
  "completion_trend": [
    { "date": "2026-07-01", "completed": 3 },
    { "date": "2026-07-02", "completed": 5 }
  ],
  "weekly_completion": [
    { "week": "2026-W27", "completed": 8, "total": 10 }
  ]
}
```

---

## 5. 前端架构

### 5.1 技术栈决策
- **框架**: Vanilla JS（保持与现有代码一致）
- **图表**: Chart.js (CDN, ~70KB gzip)
- **拖拽**: 原生 HTML5 Drag & Drop API
- **视图切换**: data-view 属性 + CSS display 控制
- **状态**: 全局 `window.appState` 对象

### 5.2 视图结构

```
#app
├── #login-screen              (登录界面，不变)
└── #todo-app
    ├── header
    │   ├── .user-info         (用户信息，不变)
    │   └── .nav-tabs          (新增主导航)
    │       ├── [data-view="daily"]   每日
    │       ├── [data-view="weekly"]  每周
    │       ├── [data-view="monthly"] 每月
    │       ├── [data-view="kanban"]  看板
    │       └── [data-view="analytics"] 分析
    ├── .view-container
    │   ├── #view-daily        (每日视图)
    │   ├── #view-weekly       (每周视图)
    │   ├── #view-monthly      (每月视图)
    │   ├── #view-kanban       (看板视图)
    │   └── #view-analytics    (分析视图)
    └── footer                 (不变)
```

### 5.3 导航标签激活逻辑
```javascript
function switchView(viewName) {
  // 1. 移除所有 nav-tab 的 active
  // 2. 激活对应的 nav-tab
  // 3. 隐藏所有 .view-panel
  // 4. 显示对应的 .view-panel
  // 5. 调用对应 loadView() 刷新数据
}
```

### 5.4 各视图设计

#### 每日视图 (Daily)
- 日期选择器（可前后翻页 + "今天" 按钮）
- 任务类型下拉（创建时可选 daily/weekly/monthly）
- 列表展示当日任务
- 完成率进度条

#### 每周视图 (Weekly)
- 周选择器（年份 + 周号，显示日期范围）
- 列表展示该周内的所有任务（daily + weekly）
- 周完成率进度条

#### 每月视图 (Monthly)
- 月选择器（年份 + 月份）
- 列表展示该月内的所有任务（daily + weekly + monthly）
- 月完成率进度条

#### 看板视图 (Kanban)
- 三列固定：待办 (todo) | 进行中 (in_progress) | 已完成 (done)
- 同一列内可按 order 排序
- 拖拽卡片到另一列 → 调用 PUT /api/todos/:id/status
- 卡片显示：content + task_type 徽章

#### 分析视图 (Analytics)
- 年度总览卡片（总任务、完成数、完成率）
- 月度趋势折线图/柱状图（Chart.js）
- 任务类型分布饼图（Chart.js）
- 连续完成天数 🔥
- 周完成率排行

---

## 6. 前端状态管理

```javascript
window.appState = {
  currentView: 'daily',       // 当前活跃视图
  user: { token, email },     // 用户信息
  daily: { date: '2026-07-14' },
  weekly: { week: '2026-W03' },
  monthly: { month: '2026-07' },
  kanban: { year: 2026 },
  analytics: { year: 2026 }
};
```

---

## 7. 实施路线图

| Phase | 内容 | 文件变更 |
|-------|------|---------|
| **1** | D1 schema migration + 后端 API 扩展 | `[[proxy]].js` |
| **2** | 前端 Tab 导航 + 每日/每周/每月视图 | `index.html`, `style.css`, `script.js` |
| **3** | 看板视图 + 拖拽交互 | `index.html`, `style.css`, `script.js` |
| **4** | 分析仪表盘 + Chart.js | `index.html`, `style.css`, `script.js` |
| **5** | 验证 + 最终打磨 | 各文件 |

---

## 8. 关键决策记录

| 决策 | 结论 |
|------|------|
| 周起始日 | **周一** |
| 每周视图样式 | 列表展示，不按日期分组 |
| 看板列 | **待办 → 进行中 → 已完成** 固定三列 |
| 分析导出 | 仅屏幕展示，不导出 |
| 图表库 | Chart.js (CDN) |
| 前端框架 | Vanilla JS（无框架） |
| 拖拽实现 | HTML5 Drag & Drop API |
| 周数方案 | 每年独立，Week 1 始于 1 月 1 日，结束于首个周日 |
