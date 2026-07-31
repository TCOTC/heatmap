import {Menu} from "siyuan";
import type {I18n} from "./i18n";
import type {
    DisplayMode,
    HeatMapConfigOptions,
    StatMode,
    ViewMode,
    WeekStart,
    YearOrder,
} from "./types";

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

export interface OpenConfigMenuOptions {
    i18n: I18n;
    /** 读取当前配置（每次点击时取最新，避免菜单闭包快照过期） */
    getConfig: () => HeatMapConfigOptions;
    /** 设置菜单中展示的年份选项（由 buildYearOptions 生成） */
    yearOptions: number[];
    rect: DOMRect;
    isMobile: boolean;
    onChange: (patch: Partial<HeatMapConfigOptions>) => void;
    /** 打开「筛选笔记本」勾选 Dialog */
    onOpenScope: () => void;
    /** 打开「颜色」十六进制配置 Dialog */
    onOpenColor: () => void;
}

/** 弹出配置菜单（展示形式、统计方式、显示范围、年份排序、每周第一天、筛选笔记本、颜色） */
export function openConfigMenu(options: OpenConfigMenuOptions): void {
    const {i18n, getConfig, yearOptions, rect, isMobile, onChange, onOpenScope, onOpenColor} = options;
    const config = getConfig();
    const menu = new Menu("heatmap-config");

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
                    if (getConfig().viewMode !== "heatmap") {
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
                    if (getConfig().viewMode !== "calendar") {
                        onChange({viewMode: "calendar"});
                    }
                },
            },
        ],
    });

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
                    if (getConfig().statMode !== "created") {
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
                    if (getConfig().statMode !== "updated") {
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
                    if (getConfig().statMode !== "mixed") {
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
                if (getConfig().displayMode !== "recent") {
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
                const current = getConfig();
                if (current.displayMode !== "years" || current.fromYear !== year) {
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
                    if (getConfig().yearOrder !== "newestFirst") {
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
                    if (getConfig().yearOrder !== "oldestFirst") {
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
                    if (getConfig().weekStart !== "monday") {
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
                    if (getConfig().weekStart !== "sunday") {
                        onChange({weekStart: "sunday"});
                    }
                },
            },
        ],
    });

    menu.addItem({
        id: "heatmap-stat-scope",
        label: i18n.statScope,
        iconHTML: "",
        click: () => {
            onOpenScope();
        },
    });

    menu.addItem({
        id: "heatmap-color",
        label: i18n.color,
        iconHTML: "",
        click: () => {
            onOpenColor();
        },
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

/**
 * 规范化统计范围：
 * - null / 缺省 → 不限制
 * - 非数组 → 回退不限制
 * - 数组 → 去重后的非空字符串 id 列表（可为空数组）
 */
export function normalizeIncludedBoxIds(value: unknown): string[] | null {
    if (value == null) {
        return null;
    }
    if (!Array.isArray(value)) {
        return null;
    }
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item !== "string") {
            continue;
        }
        const id = item.trim();
        if (!id || seen.has(id)) {
            continue;
        }
        seen.add(id);
        ids.push(id);
    }
    return ids;
}

/**
 * 规范化热力主色：
 * - null / 空 / 非法 → null（跟随主题）
 * - 接受 #RGB / #RRGGBB（可省略 #），统一为小写 #RRGGBB
 */
export function normalizeHeatColor(value: unknown): string | null {
    if (value == null || typeof value !== "string") {
        return null;
    }
    const raw = value.trim();
    if (!raw) {
        return null;
    }
    const hex = raw.startsWith("#") ? raw.slice(1) : raw;
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
    }
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
        return `#${hex.toLowerCase()}`;
    }
    return null;
}

/** 把热力主色写到根节点 CSS 变量；null 则清除以回退主题色 */
export function applyHeatColor(el: HTMLElement, color: string | null): void {
    if (color) {
        el.style.setProperty("--jchm-heat", color);
    } else {
        el.style.removeProperty("--jchm-heat");
    }
}
