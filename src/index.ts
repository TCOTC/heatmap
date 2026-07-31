import {
    Dialog,
    getFrontend,
    openMobileFileById,
    openTab,
    Plugin,
    showMessage,
} from "siyuan";
import {getI18n} from "./i18n";
import {
    buildYearOptions,
    applyHeatColor,
    getActivityCacheKey,
    isDisplayMode,
    isStatMode,
    isViewMode,
    isWeekStart,
    isYearOrder,
    normalizeFromYear,
    normalizeHeatColor,
    normalizeIncludedBoxIds,
    openColorDialog,
    openConfigMenu,
    openScopeDialog,
    queryActivity,
    queryDayDocs,
    queryEarliestYear,
    renderDayDocList,
    renderDayLoading,
    renderHeatMap,
    type DayCount,
    type DayDoc,
    type DayDocsResult,
    type DisplayMode,
    type StatMode,
    type ViewMode,
    type WeekStart,
    type YearOrder,
} from "./heatmap";
import "./index.scss";

const STORAGE_NAME = "config.json";
/** 查询超过该时间仍未返回时，再显示 Loading 占位弹窗/面板 */
const LOADING_DELAY_MS = 700;

interface PluginConfig {
    statMode: StatMode;
    weekStart: WeekStart;
    displayMode: DisplayMode;
    fromYear: number | null;
    yearOrder: YearOrder;
    viewMode: ViewMode;
    includedBoxIds: string[] | null;
    color: string | null;
}

export default class HeatMap extends Plugin {
    private isMobile = false;
    private dialog?: Dialog;
    private config: PluginConfig = {
        statMode: "created",
        weekStart: "monday",
        displayMode: "recent",
        fromYear: null,
        yearOrder: "newestFirst",
        viewMode: "heatmap",
        includedBoxIds: null,
        color: null,
    };
    private refreshing = false;
    /** 刷新进行中又收到配置变更时，结束后再刷一次最新配置 */
    private refreshQueued = false;
    private loadingDay = false;
    private view: "heatmap" | "day" = "heatmap";
    /** 进入日详情前暂存热力图面板，返回时直接还原，避免重复 SQL */
    private cachedHeatmapPanel: HTMLElement | null = null;
    /** 打开统计面板时的请求；关闭弹窗或重复打开前 abort */
    private openAbort?: AbortController;
    /** 日详情请求；关闭弹窗 / 返回热力图时 abort */
    private dayAbort?: AbortController;
    /** 热力图刷新请求 */
    private chartAbort?: AbortController;
    /** 配置从磁盘加载完成（点击顶栏时等待） */
    private configReady: Promise<void> = Promise.resolve();
    /** 串行化 saveData，避免并发写回旧配置 */
    private saveChain: Promise<void> = Promise.resolve();
    /**
     * 弹窗生命周期内的 SQL 结果缓存。
     * 弹窗打开后用户通常无法编辑文档，数据可视为稳定；关闭时全部清空。
     */
    private cachedDays: DayCount[] | null = null;
    private cachedDaysKey: string | null = null;
    private earliestYearCache: {key: string; year: number | null;} | null = null;
    private dayDocsCache = new Map<string, DayDocsResult>();

    onload() {
        this.configReady = this.loadData(STORAGE_NAME).then((data) => {
            this.config = this.normalizeConfig(data);
        }).catch(e => {
            const errorMessage = `${this.displayName}: failed to load data [${STORAGE_NAME}]: ${e.msg}`;
            showMessage(errorMessage);
            console.error(errorMessage);
        });

        console.log(this.displayName, "plugin loaded");
    }

    onLayoutReady() {
        const frontEnd = getFrontend();
        this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";
        const i18n = getI18n();

        this.addTopBar({
            icon: "iconCalendar",
            title: i18n.openHeatMap,
            position: "left",
            callback: () => {
                this.openHeatMap();
            },
        });

        console.log(this.displayName, "plugin layout ready");
    }

    onunload() {
        this.abortAllLoads();
        this.dialog?.destroy();
        console.log(this.displayName, "plugin unloaded");
    }

    uninstall() {
        this.removeData(STORAGE_NAME).catch(e => {
            const errorMessage = `${this.displayName}: failed to uninstall remove data [${STORAGE_NAME}]: ${e.msg}`;
            showMessage(errorMessage);
            console.error(errorMessage);
        });

        console.log(this.displayName, "plugin uninstalled");
    }

    private normalizeConfig(data: unknown): PluginConfig {
        const raw = (data && typeof data === "object") ? data as Record<string, unknown> : {};
        const fromYear = normalizeFromYear(raw.fromYear);
        let displayMode: DisplayMode = isDisplayMode(raw.displayMode) ? raw.displayMode : "recent";
        if (displayMode === "years" && fromYear == null) {
            displayMode = "recent";
        }
        return {
            statMode: isStatMode(raw.statMode) ? raw.statMode : "created",
            weekStart: isWeekStart(raw.weekStart) ? raw.weekStart : "monday",
            displayMode,
            fromYear: displayMode === "years" ? fromYear : null,
            yearOrder: isYearOrder(raw.yearOrder) ? raw.yearOrder : "newestFirst",
            viewMode: isViewMode(raw.viewMode) ? raw.viewMode : "heatmap",
            includedBoxIds: normalizeIncludedBoxIds(raw.includedBoxIds),
            color: normalizeHeatColor(raw.color),
        };
    }

    private saveConfig() {
        this.saveChain = this.saveChain.catch((): void => undefined).then(async (): Promise<void> => {
            try {
                await this.saveData(STORAGE_NAME, this.config);
            } catch (e) {
                console.error(this.displayName, "save config failed", e);
            }
        });
    }

    private abortAllLoads() {
        this.openAbort?.abort();
        this.dayAbort?.abort();
        this.chartAbort?.abort();
        this.openAbort = undefined;
        this.dayAbort = undefined;
        this.chartAbort = undefined;
    }

    private isAbortError(error: unknown): boolean {
        return error instanceof DOMException && error.name === "AbortError"
            || error instanceof Error && error.name === "AbortError";
    }

    /** 先等数据；超过 delay 仍未完成则回调展示 Loading，再继续等到数据或 abort */
    private async awaitWithLoadingDelay<T>(
        task: Promise<T>,
        onShowLoading: () => void,
        signal: AbortSignal,
        delayMs = LOADING_DELAY_MS,
    ): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const delayPromise = new Promise<"delay">((resolve) => {
            timer = setTimeout(() => resolve("delay"), delayMs);
        });

        try {
            const raced = await Promise.race([
                task.then((value) => ({kind: "data" as const, value})),
                delayPromise.then(() => ({kind: "delay" as const})),
            ]);
            if (raced.kind === "data") {
                return raced.value;
            }
            if (!signal.aborted) {
                onShowLoading();
            }
            return await task;
        } finally {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        }
    }

    private async openHeatMap() {
        if (this.dialog || this.openAbort) {
            return;
        }

        await this.configReady;
        // 等待配置期间可能已打开或正在打开
        if (this.dialog || this.openAbort) {
            return;
        }

        this.view = "heatmap";
        this.cachedHeatmapPanel = null;
        this.openAbort = new AbortController();
        const {signal} = this.openAbort;
        const i18n = getI18n();

        try {
            const days = await this.awaitWithLoadingDelay(
                queryActivity(this.config.statMode, this.config, signal),
                () => {
                    this.ensureDialog(true);
                },
                signal,
            );
            if (signal.aborted) {
                return;
            }

            this.ensureDialog(false);
            const container = this.getDialogBody();
            if (!container) {
                return;
            }
            this.cachedDays = days;
            this.cachedDaysKey = getActivityCacheKey(this.config.statMode, this.config);
            this.mountHeatmapPanel(container, days);
        } catch (e) {
            if (this.isAbortError(e) || signal.aborted) {
                return;
            }
            console.error(this.displayName, e);
            showMessage(`${this.displayName}: ${i18n.loadFailed}`);
            if (this.dialog) {
                const container = this.getDialogBody();
                if (container) {
                    const panel = document.createElement("div");
                    panel.className = "jchm-panel";
                    panel.textContent = i18n.loadFailed;
                    container.replaceChildren(panel);
                }
            }
        } finally {
            if (this.openAbort?.signal === signal) {
                this.openAbort = undefined;
            }
        }
    }

    /** 若弹窗尚未创建则创建；withLoading 为首次内容是否使用 Loading 占位 */
    private ensureDialog(withLoading: boolean) {
        if (this.dialog) {
            return;
        }

        const i18n = getI18n();
        const content = document.createElement("div");
        content.className = "b3-dialog__content jchm-dialog";
        if (withLoading) {
            const panel = document.createElement("div");
            panel.className = "jchm-panel";
            panel.appendChild(this.createLoadingEl());
            content.appendChild(panel);
        } else {
            const panel = document.createElement("div");
            panel.className = "jchm-panel";
            const chartHost = document.createElement("div");
            chartHost.className = "jchm-panel__chart";
            panel.appendChild(chartHost);
            content.appendChild(panel);
        }

        this.dialog = new Dialog({
            title: i18n.heatmapTitle,
            content: content.outerHTML,
            width: "max-content",
            destroyCallback: () => {
                this.abortAllLoads();
                this.dialog = undefined;
                this.view = "heatmap";
                this.cachedHeatmapPanel = null;
                this.clearQueryCaches();
                this.refreshing = false;
                this.refreshQueued = false;
                this.loadingDay = false;
            },
        });

        this.dialog.element.querySelector(".b3-dialog")?.classList.add("jchm-dialog-host");
        this.dialog.element.querySelector(".b3-dialog__container")?.classList.add("jchm-dialog__container");
        this.mountSettingsButton(this.dialog.element);
    }

    private mountHeatmapPanel(container: HTMLElement, days: DayCount[]) {
        this.view = "heatmap";
        const i18n = getI18n();
        const panel = document.createElement("div");
        panel.className = "jchm-panel";
        const chartHost = document.createElement("div");
        chartHost.className = "jchm-panel__chart";
        chartHost.appendChild(renderHeatMap(days, i18n, this.config, (dateKey) => {
            this.openDayDetail(dateKey);
        }));
        panel.appendChild(chartHost);
        container.replaceChildren(panel);
    }

    private mountSettingsButton(dialogEl: HTMLElement) {
        const header = dialogEl.querySelector(".b3-dialog__header") as HTMLElement | null;
        if (!header || header.querySelector(".jchm-dialog__setting")) {
            return;
        }

        const i18n = getI18n();
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "jchm-dialog__setting block__icon block__icon--show ariaLabel";
        btn.setAttribute("data-position", "north");
        btn.setAttribute("aria-label", i18n.settings);
        btn.innerHTML = "<svg><use xlink:href=\"#iconSettings\"></use></svg>";
        btn.addEventListener("mousedown", (event) => {
            // 避免点设置时触发标题栏 drag，把弹窗钉成固定 top/left
            event.preventDefault();
            event.stopPropagation();
        });
        btn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openSettingsMenu(btn.getBoundingClientRect());
        });

        const close = header.querySelector(".b3-dialog__close");
        if (close) {
            header.insertBefore(btn, close);
        } else {
            header.appendChild(btn);
        }
    }

    private async openSettingsMenu(rect: DOMRect) {
        const chartHost = this.dialog?.element.querySelector(".jchm-panel__chart") as HTMLElement | null;
        const earliest = await this.resolveEarliestYear();
        const yearOptions = buildYearOptions(earliest, this.config.fromYear);
        const i18n = getI18n();

        const applyConfigPatch = (patch: Partial<PluginConfig>) => {
            const prevScopeKey = this.earliestYearScopeKey();
            this.config = {...this.config, ...patch};
            this.saveConfig();
            if (this.earliestYearScopeKey() !== prevScopeKey) {
                this.earliestYearCache = null;
            }

            // 仅改颜色时直接改 CSS 变量（含日详情缓存的热力图），避免重新跑 SQL
            const keys = Object.keys(patch);
            if (keys.length === 1 && keys[0] === "color") {
                const roots = [
                    chartHost?.querySelector(".jchm"),
                    this.cachedHeatmapPanel?.querySelector(".jchm"),
                ];
                let applied = false;
                for (const root of roots) {
                    if (root instanceof HTMLElement) {
                        applyHeatColor(root, this.config.color);
                        applied = true;
                    }
                }
                if (applied) {
                    return;
                }
            }

            // 配置变了，DOM 缓存作废；若仍在热力图页则立刻刷新（活动数据可按查询键复用）
            this.cachedHeatmapPanel = null;
            if (chartHost && this.view === "heatmap") {
                this.refreshChart(chartHost);
            }
        };

        openConfigMenu({
            i18n,
            getConfig: () => this.config,
            yearOptions,
            rect,
            isMobile: this.isMobile,
            onChange: (patch) => {
                applyConfigPatch(patch);
            },
            onOpenScope: () => {
                openScopeDialog({
                    i18n,
                    includedBoxIds: this.config.includedBoxIds,
                    isMobile: this.isMobile,
                    onConfirm: (includedBoxIds) => {
                        const prev = this.config.includedBoxIds;
                        const same = (prev == null && includedBoxIds == null)
                            || (
                                Array.isArray(prev)
                                && Array.isArray(includedBoxIds)
                                && prev.length === includedBoxIds.length
                                && prev.every((id, i) => id === includedBoxIds[i])
                            );
                        if (!same) {
                            applyConfigPatch({includedBoxIds});
                        }
                    },
                });
            },
            onOpenColor: () => {
                const previewColor = (next: string | null) => {
                    const roots = [
                        chartHost?.querySelector(".jchm"),
                        this.cachedHeatmapPanel?.querySelector(".jchm"),
                    ];
                    for (const root of roots) {
                        if (root instanceof HTMLElement) {
                            applyHeatColor(root, next);
                        }
                    }
                };
                openColorDialog({
                    i18n,
                    color: this.config.color,
                    onPreview: previewColor,
                    onSave: (color) => {
                        if (this.config.color !== color) {
                            applyConfigPatch({color});
                        } else {
                            previewColor(color);
                        }
                    },
                });
            },
        });
    }

    private getDialogBody(): HTMLElement | null {
        return this.dialog?.element.querySelector(".jchm-dialog") as HTMLElement | null;
    }

    private createLoadingEl(): HTMLElement {
        const el = document.createElement("div");
        el.className = "jchm-loading";
        el.setAttribute("aria-label", getI18n().loading);
        el.innerHTML = `<img width="48" height="48" src="/stage/loading-pure.svg" alt="">`;
        return el;
    }

    private async renderPanel(container: HTMLElement) {
        this.view = "heatmap";
        this.cachedHeatmapPanel = null;
        const panel = document.createElement("div");
        panel.className = "jchm-panel";

        const chartHost = document.createElement("div");
        chartHost.className = "jchm-panel__chart";
        panel.appendChild(chartHost);

        container.replaceChildren(panel);
        await this.refreshChart(chartHost);
    }

    private restoreHeatmapPanel(container: HTMLElement) {
        this.dayAbort?.abort();
        this.dayAbort = undefined;
        this.loadingDay = false;

        if (this.cachedHeatmapPanel) {
            this.view = "heatmap";
            container.replaceChildren(this.cachedHeatmapPanel);
            this.cachedHeatmapPanel = null;
            return;
        }
        this.renderPanel(container);
    }

    private clearQueryCaches() {
        this.cachedDays = null;
        this.cachedDaysKey = null;
        this.earliestYearCache = null;
        this.dayDocsCache.clear();
    }

    private dayDocsCacheKey(dateKey: string): string {
        const box = this.config.includedBoxIds == null
            ? "*"
            : this.config.includedBoxIds.join("\0");
        return `${dateKey}|${this.config.statMode}|${box}`;
    }

    private earliestYearScopeKey(): string {
        const box = this.config.includedBoxIds == null
            ? "*"
            : this.config.includedBoxIds.join("\0");
        return `${this.config.statMode}|${box}`;
    }

    private async resolveEarliestYear(): Promise<number | null> {
        const key = this.earliestYearScopeKey();
        if (this.earliestYearCache?.key === key) {
            return this.earliestYearCache.year;
        }
        try {
            const year = await queryEarliestYear(this.config.statMode, {
                includedBoxIds: this.config.includedBoxIds,
            });
            this.earliestYearCache = {key, year};
            return year;
        } catch (e) {
            console.error(this.displayName, "query earliest year failed", e);
            return null;
        }
    }

    private mountChart(chartHost: HTMLElement, days: DayCount[]) {
        const i18n = getI18n();
        chartHost.replaceChildren(renderHeatMap(days, i18n, this.config, (dateKey) => {
            this.openDayDetail(dateKey);
        }));
    }

    private async refreshChart(chartHost: HTMLElement) {
        if (this.refreshing) {
            this.refreshQueued = true;
            this.chartAbort?.abort();
            return;
        }
        this.refreshing = true;
        this.refreshQueued = false;

        try {
            do {
                this.refreshQueued = false;
                const queryKey = getActivityCacheKey(this.config.statMode, this.config);
                const i18n = getI18n();

                // 查询边界未变（如只改年份排序）时复用数据，跳过全表扫描
                if (this.cachedDays && this.cachedDaysKey === queryKey) {
                    if (!this.dialog || this.view !== "heatmap") {
                        continue;
                    }
                    this.mountChart(chartHost, this.cachedDays);
                    continue;
                }

                this.chartAbort?.abort();
                this.chartAbort = new AbortController();
                const {signal} = this.chartAbort;
                const hasChart = Boolean(chartHost.querySelector(".jchm"));

                try {
                    const days = await this.awaitWithLoadingDelay(
                        queryActivity(this.config.statMode, this.config, signal),
                        () => {
                            // 已有图表时保留旧内容；仅空壳时才上 Loading
                            if (!hasChart && !signal.aborted) {
                                chartHost.replaceChildren(this.createLoadingEl());
                            }
                        },
                        signal,
                    );
                    if (signal.aborted || !this.dialog || this.view !== "heatmap") {
                        continue;
                    }
                    this.cachedDays = days;
                    this.cachedDaysKey = queryKey;
                    this.mountChart(chartHost, days);
                } catch (e) {
                    if (this.isAbortError(e) || signal.aborted) {
                        continue;
                    }
                    console.error(this.displayName, e);
                    if (!this.dialog || this.view !== "heatmap") {
                        continue;
                    }
                    chartHost.textContent = i18n.loadFailed;
                    showMessage(`${this.displayName}: ${i18n.loadFailed}`);
                } finally {
                    if (this.chartAbort?.signal === signal) {
                        this.chartAbort = undefined;
                    }
                }
            } while (this.refreshQueued && this.dialog && this.view === "heatmap");
        } finally {
            this.refreshing = false;
            // 循环退出后若又有排队（极端时序），再启一轮
            if (this.refreshQueued && this.dialog && this.view === "heatmap") {
                void this.refreshChart(chartHost);
            }
        }
    }

    private bindDayBack(onBack: () => void): () => void {
        return () => {
            this.dayAbort?.abort();
            this.dayAbort = undefined;
            this.loadingDay = false;
            onBack();
        };
    }

    private mountDayDocPanel(
        container: HTMLElement,
        dateKey: string,
        docs: DayDoc[],
        truncated: boolean,
    ) {
        const i18n = getI18n();
        this.view = "day";
        const panel = document.createElement("div");
        panel.className = "jchm-panel jchm-panel--day";
        panel.appendChild(renderDayDocList({
            dateKey,
            docs,
            truncated,
            i18n,
            onBack: this.bindDayBack(() => {
                const body = this.getDialogBody();
                if (body) {
                    this.restoreHeatmapPanel(body);
                }
            }),
            onOpenDoc: (id) => {
                // 移动端 openTab 为空实现，需走 openMobileFileById
                if (this.isMobile) {
                    openMobileFileById(this.app, id);
                    this.dialog?.destroy();
                    return;
                }
                openTab({
                    app: this.app,
                    doc: {id},
                });
            },
        }));
        container.replaceChildren(panel);
    }

    private async openDayDetail(dateKey: string) {
        const container = this.getDialogBody();
        if (!container || this.loadingDay || !this.dialog) {
            return;
        }

        const heatmapPanel = container.querySelector(".jchm-panel") as HTMLElement | null;
        const cacheKey = this.dayDocsCacheKey(dateKey);
        const cached = this.dayDocsCache.get(cacheKey);
        if (cached) {
            if (heatmapPanel) {
                this.cachedHeatmapPanel = heatmapPanel;
            }
            this.mountDayDocPanel(container, dateKey, cached.docs, cached.truncated);
            return;
        }

        this.loadingDay = true;
        this.dayAbort?.abort();
        this.dayAbort = new AbortController();
        const {signal} = this.dayAbort;
        const i18n = getI18n();
        let switchedToLoading = false;

        const showDayLoading = () => {
            if (switchedToLoading || signal.aborted || !this.dialog) {
                return;
            }
            if (heatmapPanel) {
                this.cachedHeatmapPanel = heatmapPanel;
            }
            switchedToLoading = true;
            this.view = "day";
            const panel = document.createElement("div");
            panel.className = "jchm-panel jchm-panel--day";
            panel.appendChild(renderDayLoading({
                dateKey,
                i18n,
                loadingEl: this.createLoadingEl(),
                onBack: this.bindDayBack(() => {
                    const body = this.getDialogBody();
                    if (body) {
                        this.restoreHeatmapPanel(body);
                    }
                }),
            }));
            container.replaceChildren(panel);
        };

        try {
            const result = await this.awaitWithLoadingDelay(
                queryDayDocs(
                    dateKey,
                    this.config.statMode,
                    {includedBoxIds: this.config.includedBoxIds},
                    signal,
                ),
                showDayLoading,
                signal,
            );
            if (signal.aborted || !this.dialog) {
                return;
            }

            this.dayDocsCache.set(cacheKey, result);
            if (heatmapPanel && !switchedToLoading) {
                this.cachedHeatmapPanel = heatmapPanel;
            }
            this.mountDayDocPanel(container, dateKey, result.docs, result.truncated);
        } catch (e) {
            if (this.isAbortError(e) || signal.aborted) {
                return;
            }
            console.error(this.displayName, e);
            showMessage(`${this.displayName}: ${i18n.loadDayFailed}`);
            if (switchedToLoading) {
                const body = this.getDialogBody();
                if (body) {
                    this.restoreHeatmapPanel(body);
                }
            }
        } finally {
            if (this.dayAbort?.signal === signal) {
                this.dayAbort = undefined;
            }
            this.loadingDay = false;
        }
    }
}
