const ZH = {
    openHeatMap: "热力图",
    heatmapTitle: "笔记热力图",
    loading: "加载中…",
    loadFailed: "加载热力图失败",
    less: "少",
    more: "多",
    totalCount: "共 ${count} 个块",
    cellTooltip: "${date}：${count} 个块",
    settings: "设置",
    statMode: "统计方式",
    statModeCreated: "按创建时间统计",
    statModeUpdated: "按最后更新时间统计",
    statModeMixed: "混合统计",
    weekStart: "每周第一天",
    weekStartMonday: "周一",
    weekStartSunday: "周日",
    weekdays: ["日", "一", "二", "三", "四", "五", "六"],
    months: ["1 月", "2 月", "3 月", "4 月", "5 月", "6 月", "7 月", "8 月", "9 月", "10 月", "11 月", "12 月"],
};

export type I18n = typeof ZH;

const EN: I18n = {
    openHeatMap: "Heat Map",
    heatmapTitle: "Note Heat Map",
    loading: "Loading…",
    loadFailed: "Failed to load heat map",
    less: "Less",
    more: "More",
    totalCount: "${count} blocks in total",
    cellTooltip: "${date}: ${count} blocks",
    settings: "Settings",
    statMode: "Count by",
    statModeCreated: "Created time",
    statModeUpdated: "Last updated time",
    statModeMixed: "Combined",
    weekStart: "Week starts on",
    weekStartMonday: "Monday",
    weekStartSunday: "Sunday",
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/** 按思源语言配置返回文案，非中文回退英文 */
export function getI18n(): I18n {
    const lang = (window as any).siyuan?.config?.lang || "en";
    return String(lang).toLowerCase().startsWith("zh") ? ZH : EN;
}
