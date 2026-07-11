import sqlite3
import json
import os
import sys
import io
from datetime import datetime

# 强制将标准输出设置为 UTF-8 编码，防止 Windows 平台下的 GBK 编码字符集崩溃
if sys.platform.startswith('win'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

db_path = r"C:\Users\Yuan\.openclaw\state\openclaw.sqlite"
persistent_dir = r"C:\Users\Yuan\.openclaw\persistent_logs"

stats = {
    "total_tokens": 0,
    "total_requests": 0,
    "total_cost": 0.0,
    "sub_input_tokens": 0,
    "sub_output_tokens": 0,
    "sub_hit_tokens": 0,
    "hit_rate": 0.0,
    "hourly_trend": {}, # {hour: {cost: 0, hit: 0, input: 0, output: 0}}
    "logs": [],
    "providers": {},
    "models": {}
}

# 1. 读取 SQLite 里的 cron 运行记录 (如 task_runs 产生的系统任务)
if os.path.exists(db_path):
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [t[0] for t in cursor.fetchall()]
        if "cron_run_logs" in tables:
            cursor.execute("SELECT model, provider, total_tokens, duration_ms, run_at_ms FROM cron_run_logs WHERE total_tokens IS NOT NULL AND total_tokens > 0;")
            rows = cursor.fetchall()
            for r in rows:
                model, provider, total_tokens, duration_ms, run_at_ms = r
                
                input_t = int(total_tokens * 0.8)
                output_t = total_tokens - input_t
                
                stats["total_tokens"] += total_tokens
                stats["total_requests"] += 1
                stats["sub_input_tokens"] += input_t
                stats["sub_output_tokens"] += output_t
                
                dt = datetime.fromtimestamp(run_at_ms / 1000.0)
                hour_str = dt.strftime("%H:00")
                
                if hour_str not in stats["hourly_trend"]:
                    stats["hourly_trend"][hour_str] = {"cost": 0, "hit": 0, "input": 0, "output": 0}
                stats["hourly_trend"][hour_str]["input"] += input_t
                stats["hourly_trend"][hour_str]["output"] += output_t
                
                p_name = provider or "unknown"
                if p_name not in stats["providers"]:
                    stats["providers"][p_name] = {"requests": 0, "tokens": 0, "hit": 0}
                stats["providers"][p_name]["requests"] += 1
                stats["providers"][p_name]["tokens"] += total_tokens
                
                m_name = model or "unknown"
                if m_name not in stats["models"]:
                    stats["models"][m_name] = {"provider": p_name, "calls": 0, "tokens": 0, "duration": 0.0, "hit": 0}
                stats["models"][m_name]["calls"] += 1
                stats["models"][m_name]["tokens"] += total_tokens
                stats["models"][m_name]["duration"] += (duration_ms / 1000.0)
                
                time_str = dt.strftime("%H:%M:%S")
                stats["logs"].append({
                    "time": time_str,
                    "provider": p_name,
                    "model": m_name,
                    "input": input_t,
                    "output": output_t,
                    "hit": 0,
                    "duration": f"{(duration_ms / 1000.0):.1f}s",
                    "status": "成功",
                    "timestamp": run_at_ms
                })
        conn.close()
    except Exception as e:
        pass

# 2. 读取我们实时 HTTP 劫持拦截记录的真实大模型 tokens 数据库 (real_tokens.json)
real_tokens_path = os.path.join(persistent_dir, "real_tokens.json")
if os.path.exists(real_tokens_path):
    try:
        with open(real_tokens_path, "r", encoding="utf-8") as rf:
            real_logs = json.load(rf)
            for log in real_logs:
                p_name = log.get("provider", "gateway")
                m_name = log.get("model", "unknown-model")
                input_t = int(log.get("input", 0))
                output_t = int(log.get("output", 0))
                hit_t = int(log.get("hit", 0))
                elapsed_str = log.get("duration", "1.0s")
                try:
                    elapsed_ms = int(float(elapsed_str.replace("s", "")) * 1000)
                except:
                    elapsed_ms = 1000
                timestamp = log.get("timestamp", int(datetime.now().timestamp() * 1000))
                
                est_tokens = input_t + output_t + hit_t
                
                stats["total_tokens"] += est_tokens
                stats["total_requests"] += 1
                stats["sub_input_tokens"] += input_t
                stats["sub_output_tokens"] += output_t
                stats["sub_hit_tokens"] += hit_t
                
                dt = datetime.fromtimestamp(timestamp / 1000.0)
                hour_str = dt.strftime("%H:00")
                
                if hour_str not in stats["hourly_trend"]:
                    stats["hourly_trend"][hour_str] = {"cost": 0, "hit": 0, "input": 0, "output": 0}
                stats["hourly_trend"][hour_str]["input"] += input_t
                stats["hourly_trend"][hour_str]["output"] += output_t
                stats["hourly_trend"][hour_str]["hit"] += hit_t
                
                if p_name not in stats["providers"]:
                    stats["providers"][p_name] = {"requests": 0, "tokens": 0, "hit": 0}
                stats["providers"][p_name]["requests"] += 1
                stats["providers"][p_name]["tokens"] += est_tokens
                stats["providers"][p_name]["hit"] += hit_t
                
                if m_name not in stats["models"]:
                    stats["models"][m_name] = {"provider": p_name, "calls": 0, "tokens": 0, "duration": 0.0, "hit": 0}
                stats["models"][m_name]["calls"] += 1
                stats["models"][m_name]["tokens"] += est_tokens
                stats["models"][m_name]["duration"] += (elapsed_ms / 1000.0)
                stats["models"][m_name]["hit"] += hit_t
                
                stats["logs"].append({
                    "time": log.get("time", dt.strftime("%H:%M:%S")),
                    "provider": p_name,
                    "model": m_name,
                    "input": input_t,
                    "output": output_t,
                    "hit": hit_t,
                    "duration": elapsed_str,
                    "status": log.get("status", "成功"),
                    "timestamp": timestamp
                })
    except Exception as e:
        pass

# 3. 规范化及合并结果
if stats["total_tokens"] > 0:
    stats["hit_rate"] = (stats["sub_hit_tokens"] / float(stats["total_tokens"])) * 100.0

stats["total_cost"] = (stats["sub_input_tokens"] / 1000000.0) * 1.5 + (stats["sub_output_tokens"] / 1000000.0) * 6.0

# 整理日志排序 (取最近 50 条)
stats["logs"].sort(key=lambda x: x["timestamp"], reverse=True)
stats["logs"] = stats["logs"][:50]

print(json.dumps(stats, ensure_ascii=False))
