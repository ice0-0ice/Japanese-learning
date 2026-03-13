import json
import random
import time
from datetime import datetime, timedelta

import redis
from flask import Flask, jsonify, render_template, request

from kana_data import KANA_DATA, ROW_LABELS, TYPE_LABELS, VOCABULARY

app = Flask(__name__)

# ═══════════════════════════════════════════════════════════════════════
# Redis 6 个独立数据库，每个 db 对应一个功能表
#
#   db0  checkin       打卡记录      key=日期        Hash
#   db1  calendar      日历热力图    key=daily       Sorted Set
#   db2  errors        错题集        key=frequency   Sorted Set + detail:* Hash
#   db3  stats         用户统计      key=summary     Hash
#   db4  leaderboard   排行榜        key=by_*        Sorted Set ×4
#   db5  users         用户信息      key=用户ID      Hash
#
# ═══════════════════════════════════════════════════════════════════════

def make_redis(db):
    return redis.Redis(host="localhost", port=6379, db=db, decode_responses=True)

checkin     = make_redis(0)
calendar    = make_redis(1)
errors      = make_redis(2)
stats       = make_redis(3)
leaderboard = make_redis(4)
users       = make_redis(5)

USER_ID = "me"


# ─── Page Routes ─────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


# ─── Kana Data API ───────────────────────────────────────────────────
@app.route("/api/kana")
def get_kana():
    return jsonify(KANA_DATA)

@app.route("/api/kana/chart")
def get_kana_chart():
    chart = {}
    for k in KANA_DATA:
        t = k["type"]
        if t not in chart:
            chart[t] = {"label": TYPE_LABELS.get(t, t), "rows": {}}
        row = k["row"]
        if row not in chart[t]["rows"]:
            chart[t]["rows"][row] = {"label": ROW_LABELS.get(row, row), "kana": []}
        chart[t]["rows"][row]["kana"].append(k)
    return jsonify(chart)

@app.route("/api/vocabulary/<romaji>")
def get_vocabulary(romaji):
    return jsonify(VOCABULARY.get(romaji, []))


# ─── Lesson API ──────────────────────────────────────────────────────
@app.route("/api/lesson/new")
def new_lesson():
    count = int(request.args.get("count", 10))
    selected = random.sample(KANA_DATA, min(count, len(KANA_DATA)))
    lesson_kana = [{**k, "words": VOCABULARY.get(k["romaji"], [])} for k in selected]
    lid = str(int(time.time() * 1000))
    return jsonify({"lesson_id": lid, "kana": lesson_kana})


@app.route("/api/lesson/submit", methods=["POST"])
def submit_lesson():
    data = request.json
    errs = data.get("errors", [])
    correct_count = data.get("correct_count", 0)
    total_count = data.get("total_count", 0)
    duration_seconds = data.get("duration_seconds", 0)
    today = datetime.now().strftime("%Y-%m-%d")

    # ── db0 checkin ──
    p0 = checkin.pipeline()
    p0.hincrby(today, "duration", duration_seconds)
    p0.hincrby(today, "lessons", 1)
    p0.hincrby(today, "correct", correct_count)
    p0.hincrby(today, "total", total_count)
    p0.hset(today, "date", today)
    p0.execute()

    # ── db1 calendar ──
    calendar.zincrby("daily", duration_seconds, today)

    # ── db2 errors ──
    if errs:
        p2 = errors.pipeline()
        for err in errs:
            romaji = err.get("romaji", "")
            if romaji:
                p2.zincrby("frequency", 1, romaji)
                p2.hset(f"detail:{romaji}", mapping={
                    "hiragana": err.get("hiragana", ""),
                    "katakana": err.get("katakana", ""),
                    "romaji": romaji,
                    "last_error": datetime.now().isoformat(),
                })
        p2.execute()

    # ── db3 stats ──
    p3 = stats.pipeline()
    p3.hincrby("summary", "total_lessons", 1)
    p3.hincrby("summary", "total_correct", correct_count)
    p3.hincrby("summary", "total_questions", total_count)
    p3.hincrby("summary", "total_duration", duration_seconds)
    p3.execute()

    # ── db4 leaderboard ──
    p4 = leaderboard.pipeline()
    p4.zincrby("by_duration", duration_seconds, USER_ID)
    p4.zincrby("by_lessons", 1, USER_ID)
    p4.zincrby("by_accuracy", correct_count, USER_ID)
    p4.execute()

    _update_streak(today)
    return jsonify({"status": "ok", "errors_recorded": len(errs)})


def _update_streak(today_str):
    today = datetime.strptime(today_str, "%Y-%m-%d")
    streak = 0
    for i in range(365):
        day = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        if checkin.exists(day):
            streak += 1
        else:
            break
    stats.hset("summary", "current_streak", streak)
    max_streak = int(stats.hget("summary", "max_streak") or 0)
    if streak > max_streak:
        stats.hset("summary", "max_streak", streak)
    leaderboard.zadd("by_streak", {USER_ID: streak})


# ─── Error Collection API → db2 errors ────────────────────────────────
@app.route("/api/errors")
def get_errors():
    error_items = errors.zrevrange("frequency", 0, -1, withscores=True)
    result = []
    for romaji, count in error_items:
        kana_info = next((k for k in KANA_DATA if k["romaji"] == romaji), None)
        if kana_info:
            result.append({**kana_info, "error_count": int(count),
                           "words": VOCABULARY.get(romaji, [])})
    return jsonify(result)

@app.route("/api/errors/clear", methods=["POST"])
def clear_errors():
    errors.flushdb()
    return jsonify({"status": "ok"})

@app.route("/api/errors/practice")
def error_practice():
    count = int(request.args.get("count", 10))
    top_errors = errors.zrevrange("frequency", 0, count - 1)
    result = []
    for romaji in top_errors:
        kana = next((k for k in KANA_DATA if k["romaji"] == romaji), None)
        if kana:
            result.append({**kana, "words": VOCABULARY.get(romaji, [])})
    return jsonify(result)


# ─── Calendar / Check-in API → db0 checkin + db1 calendar ─────────────
@app.route("/api/calendar")
def get_calendar():
    today = datetime.now()
    entries = []
    for i in range(365):
        day = (today - timedelta(days=364 - i)).strftime("%Y-%m-%d")
        data = checkin.hgetall(day)
        if data:
            entries.append({
                "date": day,
                "duration": int(data.get("duration", 0)),
                "lessons": int(data.get("lessons", 0)),
                "correct": int(data.get("correct", 0)),
                "total": int(data.get("total", 0)),
            })
        else:
            entries.append({"date": day, "duration": 0, "lessons": 0, "correct": 0, "total": 0})
    return jsonify(entries)

@app.route("/api/stats")
def get_stats():
    s = stats.hgetall("summary")
    return jsonify({
        "total_lessons":   int(s.get("total_lessons", 0)),
        "total_correct":   int(s.get("total_correct", 0)),
        "total_questions": int(s.get("total_questions", 0)),
        "total_duration":  int(s.get("total_duration", 0)),
        "current_streak":  int(s.get("current_streak", 0)),
        "max_streak":      int(s.get("max_streak", 0)),
    })


# ─── Leaderboard API → db4 leaderboard + db5 users ───────────────────
@app.route("/api/leaderboard")
def get_leaderboard():
    boards = {}
    for dim in ["duration", "lessons", "streak", "accuracy"]:
        entries = leaderboard.zrevrange(f"by_{dim}", 0, 19, withscores=True)
        boards[dim] = [{"user": uid, "score": int(score)} for uid, score in entries]
    return jsonify(boards)

@app.route("/api/leaderboard/usernames")
def get_usernames():
    names = {}
    for key in users.keys("*"):
        names[key] = users.hget(key, "name") or key
    names.setdefault(USER_ID, "我")
    return jsonify(names)


# ═══════════════════════════════════════════════════════════════════════
# Seed: 一键生成完整示例数据到 6 个 db
# ═══════════════════════════════════════════════════════════════════════
@app.route("/api/seed", methods=["POST"])
def seed_all():
    for conn in [checkin, calendar, errors, stats, leaderboard, users]:
        conn.flushdb()

    today = datetime.now()
    total_dur = 0; total_les = 0; total_cor = 0; total_que = 0
    streak = 0; checking_streak = True

    p0 = checkin.pipeline()
    p1 = calendar.pipeline()

    for i in range(30):
        day = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        has_data = True if i == 0 else random.random() < 0.75
        if has_data:
            dur = random.randint(300, 3600)
            les = random.randint(1, 5)
            cor = random.randint(les * 6, les * 10)
            que = cor + random.randint(0, les * 4)
            p0.hset(day, mapping={
                "date": day, "duration": dur,
                "lessons": les, "correct": cor, "total": que,
            })
            p1.zadd("daily", {day: dur})
            total_dur += dur; total_les += les
            total_cor += cor; total_que += que
            if checking_streak: streak += 1
        else:
            if checking_streak: checking_streak = False
    p0.execute()
    p1.execute()

    p2 = errors.pipeline()
    error_kana = random.sample(KANA_DATA, 8)
    for k in error_kana:
        cnt = random.randint(1, 12)
        p2.zadd("frequency", {k["romaji"]: cnt})
        p2.hset(f"detail:{k['romaji']}", mapping={
            "hiragana": k["hiragana"], "katakana": k["katakana"],
            "romaji": k["romaji"], "last_error": today.isoformat(),
        })
    p2.execute()

    stats.hset("summary", mapping={
        "total_lessons": total_les, "total_correct": total_cor,
        "total_questions": total_que, "total_duration": total_dur,
        "current_streak": streak, "max_streak": max(streak, 14),
    })

    demo_users = [
        ("tanaka", "田中太郎"), ("suzuki", "鈴木花子"),
        ("yamamoto", "山本一郎"), ("watanabe", "渡辺美咲"),
        ("takahashi", "高橋健太"), ("sato", "佐藤あおい"),
        ("nakamura", "中村大輔"), ("kobayashi", "小林由美"),
        (USER_ID, "我"),
    ]
    p4 = leaderboard.pipeline()
    p5 = users.pipeline()
    for uid, name in demo_users:
        p5.hset(uid, mapping={"name": name, "avatar": uid[0].upper()})
        d = total_dur if uid == USER_ID else random.randint(600, 36000)
        l = total_les if uid == USER_ID else random.randint(5, 100)
        s = streak    if uid == USER_ID else random.randint(1, 60)
        a = total_cor if uid == USER_ID else random.randint(50, 500)
        p4.zadd("by_duration", {uid: d})
        p4.zadd("by_lessons",  {uid: l})
        p4.zadd("by_streak",   {uid: s})
        p4.zadd("by_accuracy", {uid: a})
    p4.execute()
    p5.execute()

    return jsonify({
        "status": "ok",
        "layout": {
            "db0 - checkin":     f"{checkin.dbsize()} keys",
            "db1 - calendar":    f"{calendar.dbsize()} keys",
            "db2 - errors":      f"{errors.dbsize()} keys",
            "db3 - stats":       f"{stats.dbsize()} keys",
            "db4 - leaderboard": f"{leaderboard.dbsize()} keys",
            "db5 - users":       f"{users.dbsize()} keys",
        },
    })


# ─── Redis Info API ──────────────────────────────────────────────────
@app.route("/api/redis/info")
def redis_info():
    return jsonify({
        "db0_checkin": {
            "type": "Hash × N天", "key示例": "2026-03-06",
            "fields": "date, duration(秒), lessons, correct, total",
            "commands": "HSET, HINCRBY, HGETALL, EXISTS",
        },
        "db1_calendar": {
            "type": "Sorted Set × 1", "key": "daily",
            "structure": "member=日期, score=秒数",
            "commands": "ZINCRBY, ZRANGEBYSCORE, ZREVRANGE",
        },
        "db2_errors": {
            "type": "ZSet + Hash", "keys": "frequency, detail:{romaji}",
            "commands": "ZINCRBY, ZREVRANGE, HSET, HGETALL",
        },
        "db3_stats": {
            "type": "Hash × 1", "key": "summary",
            "fields": "total_lessons, total_correct, total_questions, total_duration, current_streak, max_streak",
        },
        "db4_leaderboard": {
            "type": "Sorted Set × 4",
            "keys": "by_duration, by_lessons, by_streak, by_accuracy",
            "structure": "member=用户ID, score=指标值",
        },
        "db5_users": {
            "type": "Hash × N人", "key示例": "tanaka",
            "fields": "name, avatar",
        },
    })


if __name__ == "__main__":
    app.run(debug=True, port=5000)
