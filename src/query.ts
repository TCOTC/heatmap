import {fetchSyncPost} from "siyuan";
import {alignToWeekStart, formatDateKey} from "./date";
import type {DayCount, DayDoc, HeatMapConfigOptions, StatMode} from "./types";

/** 容器块：文档 / 列表 / 列表项 / 引述 / 超级块 / 标注 */
const CONTAINER_TYPES = "('d', 'l', 'i', 'b', 's', 'callout')";

/** 避免被思源 /api/query/sql 默认 LIMIT（搜索 Limit，常为 64）截断 */
const SQL_LIMIT = 5000;

/** 查询笔记中最早有叶子块活动的年份（过滤条件与热力统计一致） */
export async function queryEarliestYear(
    mode: StatMode = "created",
    signal?: AbortSignal,
): Promise<number | null> {
    const leafFilter = `type NOT IN ${CONTAINER_TYPES}`;
    let sql: string;
    if (mode === "updated") {
        sql = `SELECT SUBSTR(MIN(updated), 1, 4) AS year
FROM blocks
WHERE ${leafFilter} AND updated != ''
LIMIT 1`;
    } else if (mode === "mixed") {
        sql = `SELECT SUBSTR(MIN(t), 1, 4) AS year FROM (
  SELECT MIN(created) AS t FROM blocks WHERE ${leafFilter} AND created != ''
  UNION ALL
  SELECT MIN(updated) AS t FROM blocks WHERE ${leafFilter} AND updated != ''
) LIMIT 1`;
    } else {
        sql = `SELECT SUBSTR(MIN(created), 1, 4) AS year
FROM blocks
WHERE ${leafFilter} AND created != ''
LIMIT 1`;
    }

    const rows = await execSql(sql, signal);
    if (rows.length === 0) {
        return null;
    }
    const year = Number(rows[0].year);
    return Number.isFinite(year) && year > 0 ? year : null;
}

/** 查询热力图按日叶子块数量（一次 SQL；无 created/updated 索引，多年并发会重复全表扫描） */
export async function queryActivity(
    mode: StatMode = "created",
    config: Pick<HeatMapConfigOptions, "displayMode" | "fromYear" | "weekStart" | "viewMode"> = {
        displayMode: "recent",
        fromYear: null,
        weekStart: "monday",
        viewMode: "heatmap",
    },
    signal?: AbortSignal,
): Promise<DayCount[]> {
    const {startKey, endKeyExclusive} = getQueryBounds(config);
    const leafFilter = `type NOT IN ${CONTAINER_TYPES}`;
    let sql: string;

    if (mode === "updated") {
        sql = `SELECT SUBSTR(updated, 1, 8) AS date, COUNT(*) AS count
FROM blocks
WHERE ${leafFilter}
  AND updated != ''
  AND updated >= '${startKey}'
  AND updated < '${endKeyExclusive}'
GROUP BY SUBSTR(updated, 1, 8)
ORDER BY date ASC
LIMIT ${SQL_LIMIT}`;
    } else if (mode === "mixed") {
        sql = `SELECT date, COUNT(*) AS count FROM (
  SELECT SUBSTR(created, 1, 8) AS date, id FROM blocks
  WHERE ${leafFilter}
    AND created >= '${startKey}'
    AND created < '${endKeyExclusive}'
  UNION
  SELECT SUBSTR(updated, 1, 8) AS date, id FROM blocks
  WHERE ${leafFilter}
    AND updated != ''
    AND updated >= '${startKey}'
    AND updated < '${endKeyExclusive}'
)
GROUP BY date
ORDER BY date ASC
LIMIT ${SQL_LIMIT}`;
    } else {
        sql = `SELECT SUBSTR(created, 1, 8) AS date, COUNT(*) AS count
FROM blocks
WHERE ${leafFilter}
  AND created >= '${startKey}'
  AND created < '${endKeyExclusive}'
GROUP BY SUBSTR(created, 1, 8)
ORDER BY date ASC
LIMIT ${SQL_LIMIT}`;
    }

    const rows = await execSql(sql, signal);
    return rows.map((row) => ({
        date: String(row.date),
        count: Number(row.count) || 0,
    }));
}

/** 查询某日按统计规则命中的文档（叶子块按 root_id 聚合，块数降序；单条 SQL 带出标题/图标） */
export async function queryDayDocs(
    dateKey: string,
    mode: StatMode = "created",
    signal?: AbortSignal,
): Promise<DayDoc[]> {
    if (!/^\d{8}$/.test(dateKey)) {
        return [];
    }
    const startKey = `${dateKey}000000`;
    const endKeyExclusive = `${nextDateKey(dateKey)}000000`;
    const leafFilter = `type NOT IN ${CONTAINER_TYPES}`;
    let aggSql: string;

    if (mode === "updated") {
        aggSql = `SELECT root_id AS id, COUNT(*) AS count
FROM blocks
WHERE ${leafFilter}
  AND updated != ''
  AND updated >= '${startKey}'
  AND updated < '${endKeyExclusive}'
GROUP BY root_id`;
    } else if (mode === "mixed") {
        aggSql = `SELECT root_id AS id, COUNT(*) AS count FROM (
  SELECT id, root_id FROM blocks
  WHERE ${leafFilter}
    AND created >= '${startKey}'
    AND created < '${endKeyExclusive}'
  UNION
  SELECT id, root_id FROM blocks
  WHERE ${leafFilter}
    AND updated != ''
    AND updated >= '${startKey}'
    AND updated < '${endKeyExclusive}'
)
GROUP BY root_id`;
    } else {
        aggSql = `SELECT root_id AS id, COUNT(*) AS count
FROM blocks
WHERE ${leafFilter}
  AND created >= '${startKey}'
  AND created < '${endKeyExclusive}'
GROUP BY root_id`;
    }

    const sql = `SELECT agg.id AS id, agg.count AS count, d.content AS content, d.ial AS ial
FROM (${aggSql}) AS agg
LEFT JOIN blocks d ON d.id = agg.id AND d.type = 'd'
ORDER BY agg.count DESC, d.content ASC, agg.id ASC
LIMIT ${SQL_LIMIT}`;

    const rows = await execSql(sql, signal);
    const docs: DayDoc[] = [];
    for (const row of rows) {
        const id = String(row.id || "");
        if (!id) {
            continue;
        }
        docs.push({
            id,
            title: String(row.content || id),
            icon: parseIalIcon(String(row.ial || "")),
            count: Number(row.count) || 0,
        });
    }
    return docs;
}

function parseIalIcon(ial: string): string {
    const match = /(?:^|\s)icon="([^"]*)"/.exec(ial);
    return match?.[1] || "";
}

function nextDateKey(dateKey: string): string {
    const y = Number(dateKey.slice(0, 4));
    const m = Number(dateKey.slice(4, 6)) - 1;
    const d = Number(dateKey.slice(6, 8));
    const date = new Date(y, m, d);
    date.setDate(date.getDate() + 1);
    return formatDateKey(date);
}

async function execSql(
    stmt: string,
    signal?: AbortSignal,
): Promise<Array<Record<string, unknown>>> {
    let response: {code: number; msg: string; data?: unknown;};
    if (signal) {
        // fetchSyncPost 不支持 AbortSignal；可取消场景走原生 fetch
        const res = await fetch("/api/query/sql", {
            method: "POST",
            body: JSON.stringify({stmt}),
            signal,
        });
        response = await res.json() as {code: number; msg: string; data?: unknown;};
    } else {
        response = await fetchSyncPost("/api/query/sql", {stmt});
    }
    if (response.code !== 0 || !Array.isArray(response.data)) {
        throw new Error(response.msg || "sql query failed");
    }
    return response.data as Array<Record<string, unknown>>;
}

function getQueryBounds(
    config: Pick<HeatMapConfigOptions, "displayMode" | "fromYear" | "weekStart" | "viewMode">,
): {startKey: string; endKeyExclusive: string} {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const endKeyExclusive = `${formatDateKey(tomorrow)}000000`;

    if (config.displayMode !== "years" || config.fromYear == null) {
        const start = new Date(today);
        start.setDate(start.getDate() - 364);
        if (config.viewMode === "calendar") {
            // 日历按整月展示，查询对齐到该月 1 号
            start.setDate(1);
        } else {
            alignToWeekStart(start, config.weekStart);
        }
        return {
            startKey: `${formatDateKey(start)}000000`,
            endKeyExclusive,
        };
    }

    const currentYear = today.getFullYear();
    const fromYear = Math.min(config.fromYear, currentYear);
    return {
        startKey: `${fromYear}0101000000`,
        endKeyExclusive: `${currentYear + 1}0101000000`,
    };
}
