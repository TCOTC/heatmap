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

export interface DayDoc {
    id: string;
    title: string;
    icon: string;
    count: number;
}

/** 单日文档查询结果；truncated 表示实际超过展示上限 */
export interface DayDocsResult {
    docs: DayDoc[];
    truncated: boolean;
}

export interface HeatMapConfigOptions {
    statMode: StatMode;
    weekStart: WeekStart;
    displayMode: DisplayMode;
    /** 按年模式下的起始年；显示 [fromYear, 今年]；切回「最近一年」时清空 */
    fromYear: number | null;
    yearOrder: YearOrder;
    viewMode: ViewMode;
    /**
     * 统计范围（笔记本白名单）：
     * - null：不限制（全部笔记本，含日后新建）
     * - string[]：仅统计这些 boxId；空数组表示不统计任何笔记本
     */
    includedBoxIds: string[] | null;
}

/** 统计范围 Dialog 中展示的笔记本条目 */
export interface ScopeNotebook {
    id: string;
    name: string;
    icon: string;
    closed: boolean;
    encrypted: boolean;
}
