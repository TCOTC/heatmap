import {fetchSyncPost, Menu} from "siyuan";
import type {I18n} from "./i18n";

export type StatMode = "created" | "updated" | "mixed";
export type WeekStart = "monday" | "sunday";

export interface DayCount {
    date: string; // YYYYMMDD
    count: number;
}

/** 容器块：文档 / 列表 / 列表项 / 引述 / 超级块 / 标注 */
const CONTAINER_TYPES = "('d', 'l', 'i', 'b', 's', 'callout')";

/** 查询近一年按日叶子块数量 */
export async function queryYearActivity(
    mode: StatMode = "created",
    weekStart: WeekStart = "monday",
): Promise<DayCount[]> {
    const startKey = getYearStartKey(weekStart);
    const leafFilter = `type NOT IN ${CONTAINER_TYPES}`;
    let sql: string;

    if (mode === "updated") {
        // 按最后更新时间：取 updated 的 YYYYMMDD，排除容器块，仅统计近一年
        sql = `SELECT SUBSTR(updated, 1, 8) AS date, COUNT(*) AS count
FROM blocks
WHERE ${leafFilter} AND updated >= '${startKey}' AND updated != ''
GROUP BY SUBSTR(updated, 1, 8)
ORDER BY date ASC`;
    } else if (mode === "mixed") {
        // 混合：创建日 ∪ 最后更新日；UNION 按 (date, id) 去重（同日计 1，跨日各计 1）
        sql = `SELECT date, COUNT(*) AS count FROM (
  SELECT SUBSTR(created, 1, 8) AS date, id FROM blocks
  WHERE ${leafFilter} AND created >= '${startKey}'
  UNION
  SELECT SUBSTR(updated, 1, 8) AS date, id FROM blocks
  WHERE ${leafFilter} AND updated >= '${startKey}' AND updated != ''
) GROUP BY date
ORDER BY date ASC`;
    } else {
        // 按创建时间：取 created 的 YYYYMMDD，排除容器块，仅统计近一年
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
export function renderHeatMap(
    days: DayCount[],
    i18n: I18n,
    weekStart: WeekStart = "monday",
): HTMLElement {
    const countMap = new Map(days.map((d) => [d.date, d.count]));
    const {cells, weeks} = buildYearGrid(countMap, weekStart);
    const levels = calcLevels(cells.map((c) => c.count));
    const total = cells.reduce((sum, c) => sum + c.count, 0);
    const weekdayLabels = orderWeekdays(i18n.weekdays, weekStart);

    const root = document.createElement("div");
    root.className = "jchm";

    const scroll = document.createElement("div");
    scroll.className = "jchm__scroll";

    const monthsRow = document.createElement("div");
    monthsRow.className = "jchm__months";
    monthsRow.appendChild(document.createElement("div")); // 对齐星期标签列
    for (const label of buildMonthLabels(weeks, i18n.months)) {
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
    const visibleWeekdayLabels: string[] = [];
    weekdayLabels.forEach((label, index) => {
        const el = document.createElement("div");
        el.className = "jchm__weekday";
        // 只显示一、三、五，避免拥挤
        if (isSparseWeekday(index, weekStart)) {
            el.textContent = label;
            visibleWeekdayLabels.push(label);
        }
        weekdays.appendChild(el);
    });
    body.appendChild(weekdays);

    const weekdayColWidth = measureWeekdayColumnWidth(visibleWeekdayLabels);
    root.style.setProperty("--jchm-weekday-col", `${weekdayColWidth}px`);

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
                day.className = `jchm__cell jchm__cell--l${level} ariaLabel`;
                day.setAttribute("data-position", "north");
                day.setAttribute("aria-label", i18n.cellTooltip
                    .replace("${date}", formatDisplayDate(cell.date))
                    .replace("${count}", String(cell.count)));
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

    // 窗口不够宽时横向滚动，默认滚到最右侧以展示最近日期
    requestAnimationFrame(() => {
        scroll.scrollLeft = scroll.scrollWidth;
    });

    return root;
}

export interface HeatMapConfigOptions {
    statMode: StatMode;
    weekStart: WeekStart;
}

export interface OpenConfigMenuOptions {
    i18n: I18n;
    config: HeatMapConfigOptions;
    rect: DOMRect;
    isMobile: boolean;
    onChange: (patch: Partial<HeatMapConfigOptions>) => void;
}

/** 弹出配置菜单（统计方式、每周第一天） */
export function openConfigMenu(options: OpenConfigMenuOptions): void {
    const {i18n, config, rect, isMobile, onChange} = options;
    const menu = new Menu("heatmap-config");

    menu.addItem({
        id: "heatmap-stat-mode",
        label: i18n.statMode,
        iconHTML: "",
        type: "submenu",
        submenu: [
            {
                id: "heatmap-stat-created",
                label: i18n.statModeCreated,
                iconHTML: "",
                checked: config.statMode === "created",
                click: () => {
                    if (config.statMode !== "created") {
                        onChange({statMode: "created"});
                    }
                },
            },
            {
                id: "heatmap-stat-updated",
                label: i18n.statModeUpdated,
                iconHTML: "",
                checked: config.statMode === "updated",
                click: () => {
                    if (config.statMode !== "updated") {
                        onChange({statMode: "updated"});
                    }
                },
            },
            {
                id: "heatmap-stat-mixed",
                label: i18n.statModeMixed,
                iconHTML: "",
                checked: config.statMode === "mixed",
                click: () => {
                    if (config.statMode !== "mixed") {
                        onChange({statMode: "mixed"});
                    }
                },
            },
        ],
    });

    menu.addItem({
        id: "heatmap-week-start",
        label: i18n.weekStart,
        iconHTML: "",
        type: "submenu",
        submenu: [
            {
                id: "heatmap-week-monday",
                label: i18n.weekStartMonday,
                iconHTML: "",
                checked: config.weekStart === "monday",
                click: () => {
                    if (config.weekStart !== "monday") {
                        onChange({weekStart: "monday"});
                    }
                },
            },
            {
                id: "heatmap-week-sunday",
                label: i18n.weekStartSunday,
                iconHTML: "",
                checked: config.weekStart === "sunday",
                click: () => {
                    if (config.weekStart !== "sunday") {
                        onChange({weekStart: "sunday"});
                    }
                },
            },
        ],
    });

    if (isMobile) {
        menu.fullscreen();
    } else {
        menu.open({
            x: rect.right,
            y: rect.bottom,
            isLeft: true,
        });
    }
}

export function isStatMode(value: unknown): value is StatMode {
    return value === "created" || value === "updated" || value === "mixed";
}

export function isWeekStart(value: unknown): value is WeekStart {
    return value === "monday" || value === "sunday";
}

/** 相对周起始日的偏移：周一制下周一为 0，周日制下周日为 0 */
function getWeekOffset(date: Date, weekStart: WeekStart): number {
    const day = date.getDay(); // 0 = 周日
    if (weekStart === "monday") {
        return (day + 6) % 7;
    }
    return day;
}

function alignToWeekStart(date: Date, weekStart: WeekStart): void {
    date.setDate(date.getDate() - getWeekOffset(date, weekStart));
}

function orderWeekdays(weekdays: string[], weekStart: WeekStart): string[] {
    if (weekStart === "monday") {
        return [...weekdays.slice(1), weekdays[0]];
    }
    return weekdays;
}

/** 稀疏显示周一、周三、周五 */
function isSparseWeekday(index: number, weekStart: WeekStart): boolean {
    const dayOfWeek = weekStart === "monday" ? (index + 1) % 7 : index;
    return dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;
}

/** 按实际显示的 weekday 文案测量列宽（取最长） */
function measureWeekdayColumnWidth(labels: string[]): number {
    const unique = [...new Set(labels.filter(Boolean))];
    if (unique.length === 0) {
        return 18;
    }
    const probe = document.createElement("div");
    // 与 .jchm 字号对齐；探测节点挂在 body 上时拿不到嵌套选择器样式
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;font-size:12px;";
    const span = document.createElement("span");
    span.style.whiteSpace = "nowrap";
    probe.appendChild(span);
    document.body.appendChild(probe);
    let max = 0;
    for (const label of unique) {
        span.textContent = label;
        max = Math.max(max, Math.ceil(span.getBoundingClientRect().width));
    }
    probe.remove();
    return Math.max(max, 1);
}

function getYearStartKey(weekStart: WeekStart): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    alignToWeekStart(start, weekStart);
    return formatDateKey(start);
}

interface GridCell {
    date: string;
    count: number;
}

function buildYearGrid(
    countMap: Map<string, number>,
    weekStart: WeekStart,
): {cells: GridCell[]; weeks: GridCell[][]} {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    alignToWeekStart(start, weekStart);

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
    let firstLabelIndex = -1;
    let secondLabelIndex = -1;

    for (let i = 0; i < weeks.length; i++) {
        // 只挂在包含该月 1 号的周列上；开头残月不显示
        const firstOfMonth = weeks[i].find((c) => c.date && c.date.endsWith("01"));
        if (firstOfMonth) {
            const month = Number(firstOfMonth.date.slice(4, 6)) - 1;
            labels.push(months[month] || "");
            if (firstLabelIndex < 0) {
                firstLabelIndex = i;
            } else if (secondLabelIndex < 0) {
                secondLabelIndex = i;
            }
        } else {
            labels.push("");
        }
    }

    // 开头月份若周数过少，文案会溢出并与下一月重叠，故不显示
    if (firstLabelIndex >= 0 && secondLabelIndex >= 0 && secondLabelIndex - firstLabelIndex < 2) {
        labels[firstLabelIndex] = "";
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
