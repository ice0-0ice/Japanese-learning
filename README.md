# 五十音道場 - 日语假名学习网站

基于 Flask + Redis 的本地日语五十音图学习网站，仿多邻国风格。

## 功能

- **完整五十音图**: 清音、浊音、半浊音、拗音，平假名/片假名对照，罗马音标注
- **随机课程**: 每课随机 10 个假名，含听·读·写三种练习模式
- **相关词汇**: 学习每个假名后展示包含该假名的日语单词
- **错题集**: 按错误频率排序，支持专项复习
- **打卡日历**: GitLab 风格热力图，展示学习时长
- **排行榜**: 多维度排名（时长、课程数、连续天数、正确数）
- **Redis 数据结构**: 展示 Hash / Sorted Set 等数据结构的实际应用

## Redis 数据结构说明

| 功能       | 数据结构      | Key 示例                           | 说明                               |
| ---------- | ------------- | ---------------------------------- | ---------------------------------- |
| 每日打卡   | Hash          | `checkin:user:default:2026-03-06`  | 字段: duration, lessons, correct   |
| 日历热力图 | Sorted Set    | `calendar:user:default`            | score=时长, member=日期            |
| 错题集     | Sorted Set    | `errors:user:default`              | score=错误次数, member=罗马音      |
| 排行榜     | Sorted Set    | `leaderboard:duration`             | score=时长, member=用户ID          |
| 用户统计   | Hash          | `stats:user:default`               | 总课程数、正确率、连续打卡等       |
| 连续打卡   | 遍历 Hash key | 检查连续日期是否存在               | 计算方式：逐日往前检查 checkin key |

## 快速开始

```bash
# 1. 确保 Redis 运行中
redis-server

# 2. 安装依赖
pip install -r requirements.txt

# 3. 启动应用
python app.py
```

访问 http://localhost:5000
![vibecoding- Japanese leaning](https://github.com/user-attachments/assets/71fd5a1a-ee6d-4c73-b44c-f810c8dee957)
