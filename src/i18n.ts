import type {WeekStart} from "./types";

const ZH = {
    openHeatMap: "文档活跃统计",
    heatmapTitle: "文档活跃统计",
    loading: "加载中…",
    loadFailed: "加载失败，请查看开发者工具控制台报错",
    less: "少",
    more: "多",
    totalCount: "共 ${count} 个块",
    cellTooltip: "${date}：${count} 个块",
    legendTooltipZero: "0 个块",
    legendTooltipExact: "${count} 个块",
    legendTooltipRange: "${min}–${max} 个块",
    legendTooltipMore: "${min}+ 个块",
    legendTooltipUnused: "未使用",
    settings: "设置",
    statMode: "统计方式",
    statModeCreated: "按创建时间统计",
    statModeUpdated: "按最后更新时间统计",
    statModeMixed: "混合统计",
    weekStart: "每周第一天",
    weekStartMonday: "周一",
    weekStartSunday: "周日",
    displayRange: "显示范围",
    displayRecentYear: "最近一年",
    yearOrder: "年份排序",
    yearOrderNewestFirst: "最近的年份在前",
    yearOrderOldestFirst: "最近的年份在后",
    viewMode: "视图",
    viewModeHeatmap: "热力图",
    viewModeCalendar: "日历",
    statScope: "筛选笔记本",
    statScopeSelectAll: "全部",
    statScopeEmpty: "暂无笔记本",
    statScopeLoadFailed: "加载笔记本列表失败",
    color: "格子颜色",
    colorUseTheme: "使用主题色",
    cancel: "取消",
    confirm: "确定",
    back: "返回",
    dayEmpty: "该日暂无文档",
    daySummary: "${docs} 篇文档，共 ${blocks} 个块",
    dayDocsTruncated: "仅显示前 ${count} 篇文档",
    docBlockCount: "${count} 个块",
    loadDayFailed: "加载日详情失败",
    weekdays: ["日", "一", "二", "三", "四", "五", "六"],
    months: ["1 月", "2 月", "3 月", "4 月", "5 月", "6 月", "7 月", "8 月", "9 月", "10 月", "11 月", "12 月"],
};

export type I18n = typeof ZH;

const EN: I18n = {
    openHeatMap: "Document Activity Stats",
    heatmapTitle: "Document Activity Stats",
    loading: "Loading…",
    loadFailed: "Load failed. Check the developer tools console for errors",
    less: "Less",
    more: "More",
    totalCount: "${count} blocks in total",
    cellTooltip: "${date}: ${count} blocks",
    legendTooltipZero: "0 blocks",
    legendTooltipExact: "${count} blocks",
    legendTooltipRange: "${min}–${max} blocks",
    legendTooltipMore: "${min}+ blocks",
    legendTooltipUnused: "Unused",
    settings: "Settings",
    statMode: "Count by",
    statModeCreated: "Created time",
    statModeUpdated: "Last updated time",
    statModeMixed: "Combined",
    weekStart: "Week starts on",
    weekStartMonday: "Monday",
    weekStartSunday: "Sunday",
    displayRange: "Display range",
    displayRecentYear: "Past year",
    yearOrder: "Year order",
    yearOrderNewestFirst: "Newest years first",
    yearOrderOldestFirst: "Oldest years first",
    viewMode: "View",
    viewModeHeatmap: "Heatmap",
    viewModeCalendar: "Calendar",
    statScope: "Filter notebooks",
    statScopeSelectAll: "Select all",
    statScopeEmpty: "No notebooks",
    statScopeLoadFailed: "Failed to load notebooks",
    color: "Cell color",
    colorUseTheme: "Use theme color",
    cancel: "Cancel",
    confirm: "Confirm",
    back: "Back",
    dayEmpty: "No documents on this day",
    daySummary: "${docs} docs, ${blocks} blocks",
    dayDocsTruncated: "Showing the first ${count} documents",
    docBlockCount: "${count} blocks",
    loadDayFailed: "Failed to load day details",
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/** 思源界面是否为中文 */
export function isZhLang(): boolean {
    const lang = (window as any).siyuan?.config?.lang || "en";
    return String(lang).toLowerCase().startsWith("zh");
}

/** 按思源语言配置返回文案，非中文回退英文 */
export function getI18n(): I18n {
    return isZhLang() ? ZH : EN;
}

/** 每周第一天默认值：中文周一，英文周日 */
export function getDefaultWeekStart(): WeekStart {
    return isZhLang() ? "monday" : "sunday";
}
