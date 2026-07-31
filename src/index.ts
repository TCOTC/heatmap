import {
    Dialog,
    getFrontend,
    openTab,
    Plugin,
    showMessage,
} from "siyuan";
import {getI18n} from "./i18n";
import {
    buildYearOptions,
    isDisplayMode,
    isStatMode,
    isViewMode,
    isWeekStart,
    isYearOrder,
    normalizeFromYear,
    normalizeIncludedBoxIds,
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
    };
    private refreshing = false;
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

    onload() {
        this.loadData(STORAGE_NAME).then((data) => {
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
        let fromYear = normalizeFromYear(raw.fromYear);
        // 兼容旧版 selectedYears：取其中最早年作为起点
        if (fromYear == null && Array.isArray(raw.selectedYears)) {
            const legacy = raw.selectedYears
                .map((y) => Number(y))
                .filter((y) => Number.isInteger(y) && y >= 1970 && y <= 2100);
            if (legacy.length > 0) {
                fromYear = Math.min(...legacy);
            }
        }
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
        };
    }

    private async saveConfig() {
        try {
            await this.saveData(STORAGE_NAME, this.config);
        } catch (e) {
            console.error(this.displayName, "save config failed", e);
        }
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
                this.refreshing = false;
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
        let earliest: number | null = null;
        try {
            earliest = await queryEarliestYear(this.config.statMode, {
                includedBoxIds: this.config.includedBoxIds,
            });
        } catch (e) {
            console.error(this.displayName, "query earliest year failed", e);
        }
        const yearOptions = buildYearOptions(earliest, this.config.fromYear);
        const i18n = getI18n();

        const applyConfigPatch = (patch: Partial<PluginConfig>) => {
            this.config = {...this.config, ...patch};
            this.saveConfig();
            // 配置变了，缓存的热力图作废；若仍在热力图页则立刻刷新
            this.cachedHeatmapPanel = null;
            if (chartHost && this.view === "heatmap") {
                this.refreshChart(chartHost);
            }
        };

        openConfigMenu({
            i18n,
            config: this.config,
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

    private async refreshChart(chartHost: HTMLElement) {
        if (this.refreshing) {
            return;
        }
        this.refreshing = true;
        this.chartAbort?.abort();
        this.chartAbort = new AbortController();
        const {signal} = this.chartAbort;
        const i18n = getI18n();
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
                return;
            }
            chartHost.replaceChildren(renderHeatMap(days, i18n, this.config, (dateKey) => {
                this.openDayDetail(dateKey);
            }));
        } catch (e) {
            if (this.isAbortError(e) || signal.aborted) {
                return;
            }
            console.error(this.displayName, e);
            if (!this.dialog || this.view !== "heatmap") {
                return;
            }
            chartHost.textContent = i18n.loadFailed;
            showMessage(`${this.displayName}: ${i18n.loadFailed}`);
        } finally {
            if (this.chartAbort?.signal === signal) {
                this.chartAbort = undefined;
            }
            this.refreshing = false;
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
            const {docs, truncated} = await this.awaitWithLoadingDelay(
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

            if (heatmapPanel && !switchedToLoading) {
                this.cachedHeatmapPanel = heatmapPanel;
            }
            this.mountDayDocPanel(container, dateKey, docs, truncated);
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
