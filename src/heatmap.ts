import {fetchSyncPost} from "siyuan";

export type StatMode = "created" | "updated" | "mixed";

export interface DayCount {
    date: string; // YYYYMMDD
    count: number;
}

export interface HeatMapI18n {
    less: string;
    more: string;
    totalCount: string;
    cellTooltip: string;
    statMode: string;
    statModeCreated: string;
    statModeUpdated: string;
    statModeMixed: string;
}

/** 容器块：文档 / 列表 / 列表项 / 引述 / 超级块 / 标注 */
const CONTAINER_TYPES = "('d', 'l', 'i', 'b', 's', 'callout')";

const LABELS_ZH = {
    weekdays: ["日", "一", "二", "三", "四", "五", "六"],
    months: ["1 月", "2 月", "3 月", "4 月", "5 月", "6 月", "7 月", "8 月", "9 月", "10 月", "11 月", "12 月"],
};

const LABELS_EN = {
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

function getLocaleLabels() {
    const lang = (window as any).siyuan?.config?.lang || "en";
    return String(lang).toLowerCase().startsWith("zh") ? LABELS_ZH : LABELS_EN;
}

/** 查询近一年按日叶子块数量 */
export async function queryYearActivity(mode: StatMode = "created"): Promise<DayCount[]> {
    const startKey = getYearStartKey();
    const leafFilter = `type NOT IN ${CONTAINER_TYPES}`;
    let sql: string;

    if (mode === "updated") {
        sql = `SELECT SUBSTR(updated, 1, 8) AS date, COUNT(*) AS count
FROM blocks
WHERE ${leafFilter} AND updated >= '${startKey}' AND updated != ''
GROUP BY SUBSTR(updated, 1, 8)
ORDER BY date ASC`;
    } else if (mode === "mixed") {
        // UNION 按 (date, id) 去重：同日既创建又更新只计 1；跨日则两天各计 1
        sql = `SELECT date, COUNT(*) AS count FROM (
  SELECT SUBSTR(created, 1, 8) AS date, id FROM blocks
  WHERE ${leafFilter} AND created >= '${startKey}'
  UNION
  SELECT SUBSTR(updated, 1, 8) AS date, id FROM blocks
  WHERE ${leafFilter} AND updated >= '${startKey}' AND updated != ''
) GROUP BY date
ORDER BY date ASC`;
    } else {
        sql = `SELECT SUBSTR(created, 1, 8) AS date, COUNT(*) AS count
FROM blocks
WHERE ${leafFilter} AND created >= '${startKey}'
GROUP BY SUBSTR(created, 1, 8)
ORDER BY date ASC`;
    }

    const response = await fetchSyncPost("/api/query/sql", {stmt: sql});
    if (response.code !== 0 || !Array.isArray(response.data)) {
        throw new Error(response.msg || "sql query failed");
    }

    return (response.data as Array<{date: string; count: number | string}>).map((row) => ({
        date: String(row.date),
        count: Number(row.count) || 0,
    }));
}

/** 渲染近一年 GitHub 风格热力图（仅图表区域） */
export function renderHeatMap(days: DayCount[], i18n: HeatMapI18n): HTMLElement {
    const countMap = new Map(days.map((d) => [d.date, d.count]));
    const {cells, weeks} = buildYearGrid(countMap);
    const levels = calcLevels(cells.map((c) => c.count));
    const total = cells.reduce((sum, c) => sum + c.count, 0);
    const labels = getLocaleLabels();

    const root = document.createElement("div");
    root.className = "jchm";

    const scroll = document.createElement("div");
    scroll.className = "jchm__scroll";

    const monthsRow = document.createElement("div");
    monthsRow.className = "jchm__months";
    monthsRow.appendChild(document.createElement("div")); // 对齐星期标签列
    for (const label of buildMonthLabels(weeks, labels.months)) {
        const el = document.createElement("div");
        el.className = "jchm__month";
        el.textContent = label;
        monthsRow.appendChild(el);
    }
    scroll.appendChild(monthsRow);

    const body = document.createElement("div");
    body.className = "jchm__body";

    const weekdays = document.createElement("div");
    weekdays.className = "jchm__weekdays";
    labels.weekdays.forEach((label, index) => {
        const el = document.createElement("div");
        el.className = "jchm__weekday";
        // 只显示一、三、五，避免拥挤
        el.textContent = index % 2 === 1 ? label : "";
        weekdays.appendChild(el);
    });
    body.appendChild(weekdays);

    const grid = document.createElement("div");
    grid.className = "jchm__grid";
    for (const week of weeks) {
        const col = document.createElement("div");
        col.className = "jchm__week";
        for (const cell of week) {
            const day = document.createElement("div");
            if (cell.count < 0) {
                day.className = "jchm__cell jchm__cell--empty";
            } else {
                const level = cell.count <= 0 ? 0 : levels(cell.count);
                day.className = `jchm__cell jchm__cell--l${level}`;
                day.title = i18n.cellTooltip
                    .replace("${date}", formatDisplayDate(cell.date))
                    .replace("${count}", String(cell.count));
            }
            col.appendChild(day);
        }
        grid.appendChild(col);
    }
    body.appendChild(grid);
    scroll.appendChild(body);
    root.appendChild(scroll);

    const footer = document.createElement("div");
    footer.className = "jchm__footer";

    const summary = document.createElement("div");
    summary.className = "jchm__summary";
    summary.textContent = i18n.totalCount.replace("${count}", String(total));
    footer.appendChild(summary);

    const legend = document.createElement("div");
    legend.className = "jchm__legend";
    const less = document.createElement("span");
    less.textContent = i18n.less;
    legend.appendChild(less);
    for (let i = 0; i <= 4; i++) {
        const swatch = document.createElement("div");
        swatch.className = `jchm__cell jchm__cell--l${i}`;
        legend.appendChild(swatch);
    }
    const more = document.createElement("span");
    more.textContent = i18n.more;
    legend.appendChild(more);
    footer.appendChild(legend);

    root.appendChild(footer);
    return root;
}

/** 构建统计方式下拉菜单 */
export function renderStatModeSelect(
    i18n: HeatMapI18n,
    mode: StatMode,
    onChange: (mode: StatMode) => void,
): HTMLElement {
    const row = document.createElement("div");
    row.className = "jchm__config";

    const label = document.createElement("span");
    label.className = "jchm__config-label";
    label.textContent = i18n.statMode;
    row.appendChild(label);

    const select = document.createElement("select");
    select.className = "b3-select";
    const options: Array<{value: StatMode; text: string}> = [
        {value: "created", text: i18n.statModeCreated},
        {value: "updated", text: i18n.statModeUpdated},
        {value: "mixed", text: i18n.statModeMixed},
    ];
    for (const opt of options) {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.text;
        if (opt.value === mode) {
            option.selected = true;
        }
        select.appendChild(option);
    }
    select.addEventListener("change", () => {
        onChange(select.value as StatMode);
    });
    row.appendChild(select);

    return row;
}

export function isStatMode(value: unknown): value is StatMode {
    return value === "created" || value === "updated" || value === "mixed";
}

function getYearStartKey(): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    // 与热力图网格对齐到周日
    start.setDate(start.getDate() - start.getDay());
    return formatDateKey(start);
}

interface GridCell {
    date: string;
    count: number;
}

function buildYearGrid(countMap: Map<string, number>): {cells: GridCell[]; weeks: GridCell[][]} {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    // 对齐到周日，与 GitHub 贡献图一致
    start.setDate(start.getDate() - start.getDay());

    const cells: GridCell[] = [];
    const weeks: GridCell[][] = [];
    let week: GridCell[] = [];

    for (let cursor = new Date(start); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
        const key = formatDateKey(cursor);
        const cell = {date: key, count: countMap.get(key) || 0};
        cells.push(cell);
        week.push(cell);
        if (week.length === 7) {
            weeks.push(week);
            week = [];
        }
    }
    if (week.length > 0) {
        while (week.length < 7) {
            week.push({date: "", count: -1});
        }
        weeks.push(week);
    }

    return {cells: cells.filter((c) => c.count >= 0), weeks};
}

function buildMonthLabels(weeks: GridCell[][], months: string[]): string[] {
    const labels: string[] = [];
    let lastMonth = -1;
    for (const week of weeks) {
        const firstValid = week.find((c) => c.date);
        if (!firstValid) {
            labels.push("");
            continue;
        }
        const month = Number(firstValid.date.slice(4, 6)) - 1;
        if (month !== lastMonth) {
            labels.push(months[month] || "");
            lastMonth = month;
        } else {
            labels.push("");
        }
    }
    return labels;
}

/** 按分位数映射到 1–4 级 */
function calcLevels(counts: number[]): (count: number) => number {
    const positive = counts.filter((c) => c > 0).sort((a, b) => a - b);
    if (positive.length === 0) {
        return () => 0;
    }
    const q = (p: number) => positive[Math.min(positive.length - 1, Math.floor(positive.length * p))];
    const t1 = q(0.25);
    const t2 = q(0.5);
    const t3 = q(0.75);
    return (count: number) => {
        if (count <= 0) return 0;
        if (count <= t1) return 1;
        if (count <= t2) return 2;
        if (count <= t3) return 3;
        return 4;
    };
}

function formatDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    return `${y}${m}${d}`;
}

function pad2(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}

function formatDisplayDate(dateKey: string): string {
    if (!dateKey || dateKey.length !== 8) {
        return dateKey;
    }
    return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
}
