---
title: 卡片数据字段说明
date: 2026-11-01
tags:
  - 数据
  - 字段说明
summary: 解释 /data/cards.json 中每条卡片记录的字段含义与使用方式。
slug: card-data
---

本站的卡片数据来自游戏资源导出，整理成一份稳定的 JSON，供页面、Agent 和第三方工具共同使用。这一篇说明每个字段的含义，以及同名角色、皮肤之间的关系。

## 数据从哪里来

- 图标清单来自游戏资源中的卡片图标表，文件名形如 `card_icons/<serial>_<looks>.png`。
- 皮肤关系来自 `skins.csv`，用 `original_id` 指向基础卡。
- 枚举（属性、阵营、职业、性别、星级）整理成单独的 `taxonomy.json`，中文标签与颜色都在里面。

当前版本共 916 条卡片记录、406 个角色，生成时间与数据来源记录在 `/data/meta.json`。

## 一条记录的完整结构

`/data/cards.json` 是一个数组，每个元素是一张卡（不是一位角色）：

```json
{
  "serial": 1020,
  "looks": 2220,
  "name": "月季院",
  "uniqueId": 405,
  "star": 5,
  "maxStar": 5,
  "attribute": "wood",
  "attributes": ["wood"],
  "faction": "alien",
  "career": "archer",
  "careerOptions": ["谎言", "黑星"],
  "gender": "female",
  "skinOf": null,
  "iconPath": "card_icons/1020_2220.png"
}
```

## 字段说明

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `serial` | number | 卡片的唯一编号，也是榜单文件引用卡片的键。 |
| `looks` | number | 外观编号，同一角色的不同皮肤各有不同的 `looks`。 |
| `name` | string | 卡片显示名称，含皮肤后缀。 |
| `uniqueId` | number | 角色编号；同一角色的多张皮肤共享同一个值。 |
| `star` | number | 当前星级，取值 1–5。 |
| `maxStar` | number | 可达到的最高星级。 |
| `attribute` | string | 主属性 id，双属性卡片取 `attributes` 的第一项。 |
| `attributes` | string[] | 全部属性；普通卡只有一项，双属性卡有两项。 |
| `faction` | string | 阵营 id。 |
| `career` | string | 职业 id，用于筛选。 |
| `careerOptions` | string[] | 游戏内的职业原文，仅用于展示，不要作为筛选键（例如 `月季院` 的值为 `["谎言","黑星"]`，并不是职业名）。 |
| `gender` | string | 性别 id。 |
| `skinOf` | number \| null | 皮肤所属基础卡的 `serial`；非皮肤为 `null`。 |
| `iconPath` | string | 图标在资源目录中的相对路径。 |

`attribute`、`faction`、`career`、`gender` 的 id 与中文标签的对应关系在 `/data/taxonomy.json`，例如 `wood` 对应「树」、`alien` 对应「异族」。写代码时请使用 id，不要匹配中文标签。

## 同名角色与皮肤

一位角色可以有多个外观，每条外观都是独立的一行，用 `uniqueId` 归组，用 `skinOf` 指回基础卡：

- `skinOf: null` 表示这是基础卡。
- `skinOf: 1020` 表示它是 `serial` 为 1020 的卡片的皮肤。

因此统计「有多少位角色」要去重 `uniqueId`，而统计「有多少张卡」直接取数组长度。筛选和排榜都以 `serial` 为单位，同一角色的皮肤可以分别上榜。

## 数据端点

| 端点 | 内容 |
| --- | --- |
| `/data/cards.json` | 全部卡片记录，本页描述的主数据。 |
| `/data/taxonomy.json` | 属性、阵营、职业、性别、星级的 id 与中文标签。 |
| `/data/meta.json` | 条数、生成时间、字段版本与数据来源。 |

页面本身也使用同一份数据，所以你在站点上看到的卡片与 JSON 完全一致。图标通过独立的资源域名提供，`iconPath` 需要拼接该域名后才能访问。

## 引用建议

- 引用具体卡片时同时给出 `serial` 和 `name`，避免名称重复造成歧义。
- 讨论角色时用 `uniqueId`，讨论具体外观时用 `serial`。
- 保存榜单请使用 `format: "bl-tier"`、`version: 1` 的格式，卡片只存 `serial` 与可读的 `name`。
- 数据会随游戏版本更新，脚本或 Agent 请以 `/data/meta.json` 的 `generatedAt` 判断新鲜度。
