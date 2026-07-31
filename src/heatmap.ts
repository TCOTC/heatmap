import {fetchSyncPost, Menu} from "siyuan";
import type {I18n} from "./i18n";

export type StatMode = "created" | "updated" | "mixed";
export type WeekStart = "monday" | "sunday";
export type YearOrder = "newestFirst" | "oldestFirst";

/**
 * 显示范围：
 * - recent：近一年滚动窗（可跨两个日历年）
 * - years：从 fromYear 到今年的每个日历年分行显示
 */
export type DisplayMode = "recent" | "years";

/**
 * 展示形式：
 * - heatmap：GitHub 风格连续周列热力图
 * - calendar：传统日历，每个月一个方块
 */
export type ViewMode = "heatmap" | "calendar";

export interface DayCount {
    date: string; // YYYYMMDD
    count: number;
}

export interface HeatMapConfigOptions {
    statMode: StatMode;
    weekStart: WeekStart;
    displayMode: DisplayMode;
    /** 按年模式下的起始年；显示 [fromYear, 今年]；切回「最近一年」时清空 */
    fromYear: number | null;
    yearOrder: YearOrder;
    viewMode: ViewMode;
}

/** 容器块：文档 / 列表 / 列表项 / 引述 / 超级块 / 标注 */
const CONTAINER_TYPES = "('d', 'l', 'i', 'b', 's', 'callout')";

/** 避免被思源 /api/query/sql 默认 LIMIT（搜索 Limit，常为 64）截断 */
const SQL_LIMIT = 5000;

/** 查询笔记中最早有叶子块活动的年份（过滤条件与热力统计一致） */
export async function queryEarliestYear(mode: StatMode = "created"): Promise<number | null> {
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

    const rows = await execSql(sql);
    if (rows.length === 0) {
        return null;
    }
    const year = Number(rows[0].year);
    return Number.isFinite(year) && year > 0 ? year : null;
}

/**
 * 生成设置菜单中的年份选项（单选起点）：
 * 从 min(库内最早年, 已选 fromYear, 今年) 到今年。
 * 选择某年表示显示「该年 → 今年」的连续区间。
 */
export function buildYearOptions(
    earliestFromDb: number | null,
    fromYear: number | null,
    now = new Date(),
): number[] {
    const currentYear = now.getFullYear();
    const candidates = [currentYear];
    if (earliestFromDb != null) {
        candidates.push(earliestFromDb);
    }
    if (fromYear != null) {
        candidates.push(fromYear);
    }
    const minYear = Math.min(...candidates);
    const years: number[] = [];
    for (let y = currentYear; y >= minYear; y--) {
        years.push(y);
    }
    return years;
}

/** 展开 [fromYear, toYear] 闭区间年份列表 */
export function expandYearRange(fromYear: number, toYear: number): number[] {
    const start = Math.min(fromYear, toYear);
    const end = Math.max(fromYear, toYear);
    const years: number[] = [];
    for (let y = start; y <= end; y++) {
        years.push(y);
    }
    return years;
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

    const rows = await execSql(sql);
    return rows.map((row) => ({
        date: String(row.date),
        count: Number(row.count) || 0,
    }));
}

/** 渲染热力图图表区域（GitHub 周列 / 传统月历） */
export function renderHeatMap(
    days: DayCount[],
    i18n: I18n,
    config: Pick<HeatMapConfigOptions, "weekStart" | "displayMode" | "fromYear" | "yearOrder" | "viewMode">,
): HTMLElement {
    if (config.viewMode === "calendar") {
        return renderCalendarView(days, i18n, config);
    }
    return renderGithubView(days, i18n, config);
}

/** 渲染 GitHub 风格热力图 */
function renderGithubView(
    days: DayCount[],
    i18n: I18n,
    config: Pick<HeatMapConfigOptions, "weekStart" | "displayMode" | "fromYear" | "yearOrder">,
): HTMLElement {
    const {weekStart, displayMode, fromYear, yearOrder} = config;
    const countMap = new Map(days.map((d) => [d.date, d.count]));
    const periods = buildPeriods(countMap, displayMode, fromYear, weekStart, yearOrder);

    const allCounts: number[] = [];
    for (const period of periods) {
        for (const cell of period.cells) {
            allCounts.push(cell.count);
        }
    }
    const {levelOf, thresholds} = calcLevels(allCounts);
    const total = allCounts.reduce((sum: number, c: number) => sum + c, 0);
    const weekdayLabels = orderWeekdays(i18n.weekdays, weekStart);

    const root = document.createElement("div");
    root.className = "jchm jchm--heatmap";

    const visibleWeekdayLabels = weekdayLabels.filter((_, index) => isSparseWeekday(index, weekStart));
    root.style.setProperty("--jchm-weekday-col", `${measureWeekdayColumnWidth(visibleWeekdayLabels)}px`);

    // 外层竖滚、内层横滚拆开，避免双轴 overflow:auto 互相挤出无效滚动条
    const scrollY = document.createElement("div");
    scrollY.className = "jchm__scroll";

    const scrollX = document.createElement("div");
    scrollX.className = "jchm__scroll-x";

    const track = document.createElement("div");
    track.className = "jchm__track";

    let maxWeeks = 0;
    for (const period of periods) {
        maxWeeks = Math.max(maxWeeks, period.weeks.length);
        track.appendChild(renderPeriod(period, i18n, weekdayLabels, weekStart, levelOf));
    }
    // 供 CSS clamp 计算格子边长（最宽年份的周数）
    root.style.setProperty("--jchm-weeks", String(Math.max(maxWeeks, 1)));

    scrollX.appendChild(track);
    scrollY.appendChild(scrollX);
    root.appendChild(scrollY);
    root.appendChild(renderFooter(i18n, total, thresholds));

    // 若已缩到下限仍溢出，滚到最右侧展示最近日期
    requestAnimationFrame(() => {
        scrollX.scrollLeft = scrollX.scrollWidth;
    });

    return root;
}

/** 渲染传统日历：每个月一个方块 */
function renderCalendarView(
    days: DayCount[],
    i18n: I18n,
    config: Pick<HeatMapConfigOptions, "weekStart" | "displayMode" | "fromYear" | "yearOrder">,
): HTMLElement {
    const {weekStart, displayMode, fromYear, yearOrder} = config;
    const countMap = new Map(days.map((d) => [d.date, d.count]));
    const monthSpecs = buildMonthSpecs(displayMode, fromYear, yearOrder);
    const months = monthSpecs.map((spec) => buildMonthGrid(countMap, spec.year, spec.month, weekStart));

    const allCounts: number[] = [];
    for (const month of months) {
        for (const cell of month.cells) {
            allCounts.push(cell.count);
        }
    }
    const {levelOf, thresholds} = calcLevels(allCounts);
    const total = allCounts.reduce((sum: number, c: number) => sum + c, 0);
    const weekdayLabels = orderWeekdays(i18n.weekdays, weekStart);

    const root = document.createElement("div");
    root.className = "jchm jchm--calendar";

    const scrollY = document.createElement("div");
    scrollY.className = "jchm__scroll";

    const track = document.createElement("div");
    track.className = "jchm__cal-track";

    // 按年分组，便于多年份模式下识别
    const groups = groupMonthsByYear(months, yearOrder);
    for (const group of groups) {
        const yearSection = document.createElement("div");
        yearSection.className = "jchm__cal-year";

        // 仅多年份或跨年时显示年份标题
        if (groups.length > 1 || displayMode === "years") {
            const yearLabel = document.createElement("div");
            yearLabel.className = "jchm__cal-year-label";
            yearLabel.textContent = String(group.year);
            yearSection.appendChild(yearLabel);
        }

        const monthsGrid = document.createElement("div");
        monthsGrid.className = "jchm__cal-months";
        for (const month of group.months) {
            monthsGrid.appendChild(renderMonthBlock(month, i18n, weekdayLabels, levelOf));
        }
        yearSection.appendChild(monthsGrid);
        track.appendChild(yearSection);
    }

    scrollY.appendChild(track);
    root.appendChild(scrollY);
    root.appendChild(renderFooter(i18n, total, thresholds));
    return root;
}

function renderFooter(i18n: I18n, total: number, thresholds: LevelThresholds): HTMLElement {
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
        swatch.className = `jchm__cell jchm__cell--l${i} ariaLabel`;
        swatch.setAttribute("data-position", "north");
        swatch.setAttribute("aria-label", formatLegendTooltip(i, thresholds, i18n));
        legend.appendChild(swatch);
    }
    const more = document.createElement("span");
    more.textContent = i18n.more;
    legend.appendChild(more);
    footer.appendChild(legend);
    return footer;
}

export interface OpenConfigMenuOptions {
    i18n: I18n;
    config: HeatMapConfigOptions;
    /** 设置菜单中展示的年份选项（由 buildYearOptions 生成） */
    yearOptions: number[];
    rect: DOMRect;
    isMobile: boolean;
    onChange: (patch: Partial<HeatMapConfigOptions>) => void;
}

/** 弹出配置菜单（统计方式、显示范围、年份排序、每周第一天、展示形式） */
export function openConfigMenu(options: OpenConfigMenuOptions): void {
    const {i18n, config, yearOptions, rect, isMobile, onChange} = options;
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

    const rangeSubmenu: any[] = [
        {
            id: "heatmap-range-recent",
            label: i18n.displayRecentYear,
            iconHTML: "",
            checked: config.displayMode === "recent",
            click: () => {
                if (config.displayMode !== "recent") {
                    onChange({displayMode: "recent", fromYear: null});
                }
            },
        },
    ];
    for (const year of yearOptions) {
        const selected = config.displayMode === "years" && config.fromYear === year;
        rangeSubmenu.push({
            id: `heatmap-range-year-${year}`,
            label: String(year),
            iconHTML: "",
            checked: selected,
            click: () => {
                if (config.displayMode !== "years" || config.fromYear !== year) {
                    onChange({displayMode: "years", fromYear: year});
                }
            },
        });
    }

    menu.addItem({
        id: "heatmap-display-range",
        label: i18n.displayRange,
        iconHTML: "",
        type: "submenu",
        submenu: rangeSubmenu,
    });

    menu.addItem({
        id: "heatmap-year-order",
        label: i18n.yearOrder,
        iconHTML: "",
        type: "submenu",
        submenu: [
            {
                id: "heatmap-year-order-newest",
                label: i18n.yearOrderNewestFirst,
                iconHTML: "",
                checked: config.yearOrder === "newestFirst",
                click: () => {
                    if (config.yearOrder !== "newestFirst") {
                        onChange({yearOrder: "newestFirst"});
                    }
                },
            },
            {
                id: "heatmap-year-order-oldest",
                label: i18n.yearOrderOldestFirst,
                iconHTML: "",
                checked: config.yearOrder === "oldestFirst",
                click: () => {
                    if (config.yearOrder !== "oldestFirst") {
                        onChange({yearOrder: "oldestFirst"});
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

    menu.addItem({
        id: "heatmap-view-mode",
        label: i18n.viewMode,
        iconHTML: "",
        type: "submenu",
        submenu: [
            {
                id: "heatmap-view-heatmap",
                label: i18n.viewModeHeatmap,
                iconHTML: "",
                checked: config.viewMode === "heatmap",
                click: () => {
                    if (config.viewMode !== "heatmap") {
                        onChange({viewMode: "heatmap"});
                    }
                },
            },
            {
                id: "heatmap-view-calendar",
                label: i18n.viewModeCalendar,
                iconHTML: "",
                checked: config.viewMode === "calendar",
                click: () => {
                    if (config.viewMode !== "calendar") {
                        onChange({viewMode: "calendar"});
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

export function isYearOrder(value: unknown): value is YearOrder {
    return value === "newestFirst" || value === "oldestFirst";
}

export function isDisplayMode(value: unknown): value is DisplayMode {
    return value === "recent" || value === "years";
}

export function isViewMode(value: unknown): value is ViewMode {
    return value === "heatmap" || value === "calendar";
}

export function normalizeFromYear(value: unknown): number | null {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 1970 || year > 2100) {
        return null;
    }
    return year;
}

async function execSql(stmt: string): Promise<Array<Record<string, unknown>>> {
    const response = await fetchSyncPost("/api/query/sql", {stmt});
    if (response.code !== 0 || !Array.isArray(response.data)) {
        throw new Error(response.msg || "sql query failed");
    }
    return response.data as Array<Record<string, unknown>>;
}

interface PeriodGrid {
    cells: GridCell[];
    weeks: GridCell[][];
}

interface GridCell {
    date: string;
    count: number;
    /** 当月日期数字；占位格为 0 */
    day?: number;
}

interface MonthSpec {
    year: number;
    /** 0–11 */
    month: number;
}

interface MonthGrid {
    year: number;
    month: number;
    cells: GridCell[];
    weeks: GridCell[][];
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

function buildPeriods(
    countMap: Map<string, number>,
    displayMode: DisplayMode,
    fromYear: number | null,
    weekStart: WeekStart,
    yearOrder: YearOrder,
): PeriodGrid[] {
    if (displayMode !== "years" || fromYear == null) {
        return [buildRollingYearGrid(countMap, weekStart)];
    }

    const currentYear = new Date().getFullYear();
    const years = expandYearRange(fromYear, currentYear);
    years.sort((a, b) => (yearOrder === "newestFirst" ? b - a : a - b));
    return years.map((year) => buildCalendarYearGrid(countMap, year, weekStart));
}

/** 生成要展示的月份列表 */
function buildMonthSpecs(
    displayMode: DisplayMode,
    fromYear: number | null,
    yearOrder: YearOrder,
): MonthSpec[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const specs: MonthSpec[] = [];

    if (displayMode !== "years" || fromYear == null) {
        const start = new Date(today);
        start.setDate(start.getDate() - 364);
        let y = start.getFullYear();
        let m = start.getMonth();
        const endY = today.getFullYear();
        const endM = today.getMonth();
        while (y < endY || (y === endY && m <= endM)) {
            specs.push({year: y, month: m});
            m += 1;
            if (m > 11) {
                m = 0;
                y += 1;
            }
        }
        return specs;
    }

    const currentYear = today.getFullYear();
    const years = expandYearRange(fromYear, currentYear);
    years.sort((a, b) => (yearOrder === "newestFirst" ? b - a : a - b));
    for (const year of years) {
        const lastMonth = year === currentYear ? today.getMonth() : 11;
        for (let month = 0; month <= lastMonth; month++) {
            specs.push({year, month});
        }
    }
    return specs;
}

function groupMonthsByYear(
    months: MonthGrid[],
    yearOrder: YearOrder,
): Array<{year: number; months: MonthGrid[]}> {
    const map = new Map<number, MonthGrid[]>();
    for (const month of months) {
        let list = map.get(month.year);
        if (!list) {
            list = [];
            map.set(month.year, list);
        }
        list.push(month);
    }
    const years = [...map.keys()].sort((a, b) => (yearOrder === "newestFirst" ? b - a : a - b));
    return years.map((year) => ({year, months: map.get(year)!}));
}

/** 单月传统日历网格（周为行） */
function buildMonthGrid(
    countMap: Map<string, number>,
    year: number,
    month: number,
    weekStart: WeekStart,
): MonthGrid {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const cells: GridCell[] = [];
    const weeks: GridCell[][] = [];
    let week: GridCell[] = [];

    // 月初对齐到周起始的占位
    const leading = getWeekOffset(first, weekStart);
    for (let i = 0; i < leading; i++) {
        week.push({date: "", count: -1, day: 0});
    }

    for (let day = 1; day <= last.getDate(); day++) {
        const cursor = new Date(year, month, day);
        const key = formatDateKey(cursor);
        let cell: GridCell;
        if (cursor > today) {
            // 未来日期显示数字但不参与热力统计
            cell = {date: key, count: -2, day};
        } else {
            cell = {date: key, count: countMap.get(key) || 0, day};
            cells.push(cell);
        }
        week.push(cell);
        if (week.length === 7) {
            weeks.push(week);
            week = [];
        }
    }

    if (week.length > 0) {
        while (week.length < 7) {
            week.push({date: "", count: -1, day: 0});
        }
        weeks.push(week);
    }

    return {year, month, cells, weeks};
}

function renderPeriod(
    period: PeriodGrid,
    i18n: I18n,
    weekdayLabels: string[],
    weekStart: WeekStart,
    levels: (count: number) => number,
): HTMLElement {
    const section = document.createElement("div");
    section.className = "jchm__period";

    const monthsRow = document.createElement("div");
    monthsRow.className = "jchm__months";
    const spacer = document.createElement("div");
    spacer.className = "jchm__months-spacer";
    monthsRow.appendChild(spacer);
    for (const label of buildMonthLabels(period.weeks, i18n.months)) {
        const el = document.createElement("div");
        el.className = "jchm__month";
        el.textContent = label;
        monthsRow.appendChild(el);
    }
    section.appendChild(monthsRow);

    const body = document.createElement("div");
    body.className = "jchm__body";

    const weekdays = document.createElement("div");
    weekdays.className = "jchm__weekdays";
    weekdayLabels.forEach((label, index) => {
        const el = document.createElement("div");
        el.className = "jchm__weekday";
        // 只显示一、三、五，避免拥挤
        if (isSparseWeekday(index, weekStart)) {
            el.textContent = label;
        }
        weekdays.appendChild(el);
    });
    body.appendChild(weekdays);

    const grid = document.createElement("div");
    grid.className = "jchm__grid";
    for (const week of period.weeks) {
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
    section.appendChild(body);
    return section;
}

function renderMonthBlock(
    month: MonthGrid,
    i18n: I18n,
    weekdayLabels: string[],
    levels: (count: number) => number,
): HTMLElement {
    const block = document.createElement("div");
    block.className = "jchm__cal-month";

    const title = document.createElement("div");
    title.className = "jchm__cal-month-title";
    title.textContent = i18n.months[month.month] || "";
    block.appendChild(title);

    const weekdays = document.createElement("div");
    weekdays.className = "jchm__cal-weekdays";
    for (const label of weekdayLabels) {
        const el = document.createElement("div");
        el.className = "jchm__cal-weekday";
        el.textContent = label;
        weekdays.appendChild(el);
    }
    block.appendChild(weekdays);

    const grid = document.createElement("div");
    grid.className = "jchm__cal-grid";
    for (const week of month.weeks) {
        const row = document.createElement("div");
        row.className = "jchm__cal-week";
        for (const cell of week) {
            const day = document.createElement("div");
            if (cell.count === -1) {
                day.className = "jchm__cal-day jchm__cal-day--empty";
            } else if (cell.count === -2) {
                day.className = "jchm__cal-day jchm__cal-day--future";
                day.textContent = String(cell.day || Number(cell.date.slice(6, 8)));
            } else {
                const level = cell.count <= 0 ? 0 : levels(cell.count);
                day.className = `jchm__cal-day jchm__cell jchm__cell--l${level} ariaLabel`;
                day.textContent = String(cell.day || Number(cell.date.slice(6, 8)));
                day.setAttribute("data-position", "north");
                day.setAttribute("aria-label", i18n.cellTooltip
                    .replace("${date}", formatDisplayDate(cell.date))
                    .replace("${count}", String(cell.count)));
            }
            row.appendChild(day);
        }
        grid.appendChild(row);
    }
    block.appendChild(grid);
    return block;
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
        max = Math.max(max, span.getBoundingClientRect().width);
    }
    probe.remove();
    return Math.max(Math.ceil(max), 1);
}

/** 近一年滚动窗（可跨两个日历年） */
function buildRollingYearGrid(
    countMap: Map<string, number>,
    weekStart: WeekStart,
): PeriodGrid {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    alignToWeekStart(start, weekStart);

    return fillGrid(start, today, countMap);
}

/** 单个日历年：年初对齐周起始，当前年截止到今天 */
function buildCalendarYearGrid(
    countMap: Map<string, number>,
    year: number,
    weekStart: WeekStart,
): PeriodGrid {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(year, 0, 1);
    alignToWeekStart(start, weekStart);

    let end = new Date(year, 11, 31);
    if (year === today.getFullYear() && end > today) {
        end = today;
    } else if (year > today.getFullYear()) {
        // 未来年：仍渲染空网格到年底，便于设置里预选
        end = new Date(year, 11, 31);
    }

    // 起始对齐后可能落到上一年，格子只统计本年内的 count，跨年占位用 empty
    return fillCalendarGrid(start, end, year, countMap);
}

function fillGrid(
    start: Date,
    end: Date,
    countMap: Map<string, number>,
): PeriodGrid {
    const cells: GridCell[] = [];
    const weeks: GridCell[][] = [];
    let week: GridCell[] = [];

    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
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

function fillCalendarGrid(
    start: Date,
    end: Date,
    year: number,
    countMap: Map<string, number>,
): PeriodGrid {
    const cells: GridCell[] = [];
    const weeks: GridCell[][] = [];
    let week: GridCell[] = [];
    const yearPrefix = String(year);

    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        const key = formatDateKey(cursor);
        let cell: GridCell;
        if (!key.startsWith(yearPrefix)) {
            // 对齐产生的上一年占位，不计入统计
            cell = {date: "", count: -1};
        } else {
            cell = {date: key, count: countMap.get(key) || 0};
            cells.push(cell);
        }
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

    return {cells, weeks};
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

/** 分位阈值：依次为 25% / 50% / 75% */
type LevelThresholds = readonly [number, number, number];

/** 按分位数映射到 1–4 级，并返回阈值供图例 tooltip 使用 */
function calcLevels(counts: number[]): {
    levelOf: (count: number) => number;
    thresholds: LevelThresholds;
} {
    const positive = counts.filter((c) => c > 0).sort((a, b) => a - b);
    if (positive.length === 0) {
        return {
            levelOf: () => 0,
            thresholds: [0, 0, 0],
        };
    }
    const q = (p: number) => positive[Math.min(positive.length - 1, Math.floor(positive.length * p))];
    const t1 = q(0.25);
    const t2 = q(0.5);
    const t3 = q(0.75);
    const thresholds: LevelThresholds = [t1, t2, t3];
    return {
        levelOf: (count: number) => {
            if (count <= 0) return 0;
            if (count <= t1) return 1;
            if (count <= t2) return 2;
            if (count <= t3) return 3;
            return 4;
        },
        thresholds,
    };
}

/** 根据分位阈值生成图例格子的数量说明 */
function formatLegendTooltip(level: number, thresholds: LevelThresholds, i18n: I18n): string {
    if (level === 0) {
        return i18n.legendTooltipZero;
    }

    const [t1, t2, t3] = thresholds;
    const bands: Array<[number, number | null]> = [
        [1, t1],
        [t1 + 1, t2],
        [t2 + 1, t3],
        [t3 + 1, null],
    ];
    const [min, max] = bands[level - 1];

    // 无正样本量时阈值全为 0，仅保留「1+」作为更高颜色的说明
    if (t1 === 0 && t2 === 0 && t3 === 0) {
        return i18n.legendTooltipMore.replace("${min}", "1");
    }

    if (max === null) {
        return i18n.legendTooltipMore.replace("${min}", String(min));
    }
    // 分位重合导致该等级区间为空时，退化为单点说明
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    if (lo === hi) {
        return i18n.legendTooltipExact.replace("${count}", String(lo));
    }
    return i18n.legendTooltipRange
        .replace("${min}", String(lo))
        .replace("${max}", String(hi));
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
