# 社区水果店会员积分系统 — 架构文档

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 后端 | Node.js + Express 4 | RESTful API 服务，端口 3000 |
| 数据库 | SQLite (better-sqlite3) | 文件数据库 `shop.db`，零配置 |
| 前端 | 原生 HTML/CSS/JS | 无框架，静态文件托管在 `public/` 目录 |

## 目录结构

```
project40/
├── server.js              # 后端服务入口（API + 静态文件托管）
├── package.json           # 项目依赖
├── shop.db                # SQLite 数据库文件（运行后自动生成）
└── public/                # 前端静态资源
    ├── index.html          # 会员管理页面（首页）
    ├── transactions.html   # 消费记录页面
    └── redemptions.html    # 积分兑换页面
```

---

## 数据库设计

共 4 张表，存储于 `shop.db`。首次启动时由 `server.js` 通过 `CREATE TABLE IF NOT EXISTS` 自动建表，同时初始化 4 条预设礼品数据。

### members — 会员表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | 会员 ID |
| phone | TEXT | UNIQUE NOT NULL | 手机号（唯一，用于注册校验） |
| name | TEXT | NOT NULL | 姓名 |
| points | INTEGER | DEFAULT 0 | 累计积分 |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | 注册时间 |

### transactions — 消费记录表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | 记录 ID |
| member_id | INTEGER | NOT NULL, FOREIGN KEY → members(id) | 关联会员 |
| amount | REAL | NOT NULL | 消费金额（元） |
| points_earned | INTEGER | NOT NULL | 本次获得积分（= Math.floor(amount)） |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | 消费时间 |

### gifts — 礼品表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | 礼品 ID |
| name | TEXT | NOT NULL | 礼品名称 |
| points_required | INTEGER | NOT NULL | 兑换所需积分 |
| description | TEXT | — | 礼品描述 |
| stock | INTEGER | DEFAULT 0 | 库存数量 |

### redemptions — 兑换记录表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | 兑换记录 ID |
| member_id | INTEGER | NOT NULL, FOREIGN KEY → members(id) | 关联会员 |
| gift_id | INTEGER | NOT NULL, FOREIGN KEY → gifts(id) | 关联礼品 |
| points_deducted | INTEGER | NOT NULL | 本次扣除积分 |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | 兑换时间 |

### 表关系

```
members 1 ──── N transactions       （一个会员有多条消费记录）
members 1 ──── N redemptions        （一个会员有多条兑换记录）
gifts   1 ──── N redemptions        （一个礼品可被兑换多次）
```

### 会员等级规则

等级不存数据库，由 `getMemberLevel(points)` 函数根据 `points` 实时计算，附加到 API 返回值中：

| 积分范围 | 等级名称 | levelClass | 标签颜色 |
|----------|----------|------------|----------|
| 0 ~ 499 | 普通 | normal | 灰色 |
| 500 ~ 1199 | 银卡 | silver | 银灰色渐变 |
| ≥ 1200 | 金卡 | gold | 金色渐变 |

---

## 后端 API 接口

基础路径：`http://localhost:3000`

通用错误响应格式：`{ "error": "错误描述" }`

### 会员管理

#### GET /api/members

获取会员列表，支持关键词搜索。

| 参数 | 位置 | 必填 | 说明 |
|------|------|------|------|
| keyword | query | 否 | 按姓名或手机号模糊搜索 |

成功响应 `200`：

```json
[
  {
    "id": 1,
    "phone": "13800138000",
    "name": "张三",
    "points": 688,
    "created_at": "2026-06-23 14:59:45",
    "level": "银卡",
    "levelClass": "silver"
  }
]
```

#### GET /api/members/:id

获取单个会员详情。

| 参数 | 位置 | 必填 | 说明 |
|------|------|------|------|
| id | path | 是 | 会员 ID |

成功响应 `200`：同上单个会员对象。

错误响应：`404` 会员不存在。

#### POST /api/members

新增会员。

请求体：

```json
{
  "phone": "13800138000",
  "name": "张三"
}
```

成功响应 `201`：返回新建的会员对象（含 level/levelClass）。

错误响应：`400` 手机号和姓名不能为空 / 该手机号已注册。

#### PUT /api/members/:id

更新会员信息。

| 参数 | 位置 | 必填 | 说明 |
|------|------|------|------|
| id | path | 是 | 会员 ID |

请求体：

```json
{
  "phone": "13800138000",
  "name": "张三"
}
```

成功响应 `200`：返回更新后的会员对象（含 level/levelClass）。

错误响应：`404` 会员不存在 / `400` 该手机号已被其他会员使用。

#### DELETE /api/members/:id

删除会员，同时级联删除该会员的消费记录和兑换记录。

| 参数 | 位置 | 必填 | 说明 |
|------|------|------|------|
| id | path | 是 | 会员 ID |

成功响应 `200`：`{ "message": "删除成功" }`

错误响应：`404` 会员不存在。

---

### 消费记录

#### GET /api/transactions

获取消费记录列表，支持按会员和日期范围筛选。

| 参数 | 位置 | 必填 | 说明 |
|------|------|------|------|
| member_id | query | 否 | 按会员 ID 筛选 |
| start_date | query | 否 | 开始日期（YYYY-MM-DD） |
| end_date | query | 否 | 结束日期（YYYY-MM-DD） |

成功响应 `200`：

```json
[
  {
    "id": 1,
    "member_id": 1,
    "amount": 688.5,
    "points_earned": 688,
    "created_at": "2026-06-23 14:59:59",
    "member_name": "张三",
    "member_phone": "13800138000"
  }
]
```

#### POST /api/transactions

记录一笔消费，自动计算积分并累加到会员积分。使用数据库事务保证原子性。

请求体：

```json
{
  "member_id": 1,
  "amount": 688.5
}
```

成功响应 `201`：

```json
{
  "id": 1,
  "member_id": 1,
  "amount": 688.5,
  "points_earned": 688,
  "created_at": "2026-06-23 14:59:59",
  "member_name": "张三",
  "member_phone": "13800138000",
  "current_points": 688
}
```

错误响应：`400` 会员ID和消费金额不能为空 / `404` 会员不存在。

---

### 礼品管理

#### GET /api/gifts

获取礼品列表，按所需积分升序排列。

成功响应 `200`：

```json
[
  {
    "id": 1,
    "name": "新鲜苹果礼盒",
    "points_required": 500,
    "description": "5斤装红富士苹果",
    "stock": 50
  }
]
```

#### POST /api/gifts

新增礼品。

请求体：

```json
{
  "name": "新品礼盒",
  "points_required": 300,
  "description": "季节限定",
  "stock": 20
}
```

成功响应 `201`：返回新建的礼品对象。

错误响应：`400` 礼品名称和所需积分不能为空。

---

### 兑换记录

#### GET /api/redemptions

获取兑换记录列表，支持按会员筛选。

| 参数 | 位置 | 必填 | 说明 |
|------|------|------|------|
| member_id | query | 否 | 按会员 ID 筛选 |

成功响应 `200`：

```json
[
  {
    "id": 1,
    "member_id": 1,
    "gift_id": 1,
    "points_deducted": 500,
    "created_at": "2026-06-23 15:00:11",
    "member_name": "张三",
    "member_phone": "13800138000",
    "gift_name": "新鲜苹果礼盒"
  }
]
```

#### POST /api/redemptions

兑换礼品。校验积分是否足够、库存是否充足，使用数据库事务保证：扣积分 + 减库存 + 写记录三步原子操作。

请求体：

```json
{
  "member_id": 1,
  "gift_id": 1
}
```

成功响应 `201`：

```json
{
  "id": 1,
  "member_id": 1,
  "gift_id": 1,
  "points_deducted": 500,
  "created_at": "2026-06-23 15:00:11",
  "member_name": "张三",
  "member_phone": "13800138000",
  "current_points": 188,
  "gift_name": "新鲜苹果礼盒"
}
```

错误响应：`400` 会员ID和礼品ID不能为空 / 积分不足 / 礼品库存不足 / `404` 会员不存在 / 礼品不存在。

---

## 前端页面

### 会员管理页面 — index.html

路由：`/` 或 `/index.html`

| 功能 | 说明 |
|------|------|
| 新增会员 | 填写姓名 + 手机号，校验 11 位手机号格式，调用 `POST /api/members` |
| 会员列表 | 调用 `GET /api/members` 渲染表格，显示 ID、姓名（含等级标签）、手机号、积分、注册时间 |
| 搜索会员 | 调用 `GET /api/members?keyword=` 按姓名或手机号模糊搜索 |
| 编辑会员 | 弹窗修改姓名/手机号，调用 `PUT /api/members/:id` |
| 删除会员 | 确认后调用 `DELETE /api/members/:id`，级联删除关联记录 |

等级标签样式：普通（灰色）、银卡（银灰渐变）、金卡（金色渐变），由 API 返回的 `levelClass` 字段动态匹配。

### 消费记录页面 — transactions.html

路由：`/transactions.html`

| 功能 | 说明 |
|------|------|
| 记录消费 | 选择会员 + 输入金额，确认后调用 `POST /api/transactions`，每 1 元 = 1 积分 |
| 筛选查询 | 支持按会员、开始日期、结束日期组合筛选，调用 `GET /api/transactions?member_id=&start_date=&end_date=` |
| 统计汇总 | 根据当前筛选结果实时计算消费笔数、总金额、总积分 |

### 积分兑换页面 — redemptions.html

路由：`/redemptions.html`

| 功能 | 说明 |
|------|------|
| 选择会员 | 下拉选择后显示当前积分，礼品卡片根据积分实时标记可兑换/不可兑换状态 |
| 礼品列表 | 卡片式展示，积分不足显示"还差 X 分"，库存为零显示"已兑完" |
| 兑换礼品 | 调用 `POST /api/redemptions`，成功后重新请求 `GET /api/members` 刷新积分和等级 |
| 兑换记录 | 表格展示历史兑换记录 |
| 新增礼品 | 弹窗填写礼品信息，调用 `POST /api/gifts` |

---

## 启动方式

```bash
npm install
npm start
```

服务启动后访问 http://localhost:3000 即可使用。
