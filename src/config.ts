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
