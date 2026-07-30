import {
    Dialog,
    getFrontend,
    Plugin,
    showMessage,
} from "siyuan";
import {getI18n} from "./i18n";
import {
    isStatMode,
    isWeekStart,
    openConfigMenu,
    queryYearActivity,
    renderHeatMap,
    type StatMode,
    type WeekStart,
} from "./heatmap";
import "./index.scss";

const STORAGE_NAME = "config.json";

interface PluginConfig {
    statMode: StatMode;
    weekStart: WeekStart;
}

export default class HeatMap extends Plugin {
    private isMobile = false;
    private dialog?: Dialog;
    private config: PluginConfig = {statMode: "created", weekStart: "monday"};
    private refreshing = false;

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
        return {
            statMode: isStatMode(raw.statMode) ? raw.statMode : "created",
            weekStart: isWeekStart(raw.weekStart) ? raw.weekStart : "monday",
        };
    }

    private async saveConfig() {
        try {
            await this.saveData(STORAGE_NAME, this.config);
        } catch (e) {
            console.error(this.displayName, "save config failed", e);
        }
    }

    private async openHeatMap() {
        if (this.dialog) {
            return;
        }

        const i18n = getI18n();
        const content = document.createElement("div");
        content.className = "b3-dialog__content jchm-dialog";
        content.innerHTML = `<div class="jchm-panel">${i18n.loading}</div>`;

        this.dialog = new Dialog({
            title: i18n.heatmapTitle,
            content: content.outerHTML,
            destroyCallback: () => {
                this.dialog = undefined;
            },
        });

        this.dialog.element.querySelector(".b3-dialog__container")?.classList.add("jchm-dialog__container");

        const container = this.dialog.element.querySelector(".jchm-dialog") as HTMLElement;
        if (!container) {
            return;
        }

        this.mountSettingsButton(this.dialog.element);
        await this.renderPanel(container);
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
        btn.innerHTML = `<svg><use xlink:href="#iconSettings"></use></svg>`;
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

    private openSettingsMenu(rect: DOMRect) {
        const chartHost = this.dialog?.element.querySelector(".jchm-panel__chart") as HTMLElement | null;
        openConfigMenu({
            i18n: getI18n(),
            config: this.config,
            rect,
            isMobile: this.isMobile,
            onChange: (patch) => {
                this.config = {...this.config, ...patch};
                this.saveConfig();
                if (chartHost) {
                    this.refreshChart(chartHost);
                }
            },
        });
    }

    private async renderPanel(container: HTMLElement) {
        const i18n = getI18n();
        const panel = document.createElement("div");
        panel.className = "jchm-panel";

        const chartHost = document.createElement("div");
        chartHost.className = "jchm-panel__chart";
        chartHost.textContent = i18n.loading;
        panel.appendChild(chartHost);

        container.replaceChildren(panel);
        await this.refreshChart(chartHost);
    }

    private async refreshChart(chartHost: HTMLElement) {
        if (this.refreshing) {
            return;
        }
        this.refreshing = true;
        const i18n = getI18n();
        // 已有图表时保留旧内容，避免切换统计方式时弹窗高度先塌再撑开
        if (!chartHost.querySelector(".jchm")) {
            chartHost.textContent = i18n.loading;
        }
        try {
            const days = await queryYearActivity(this.config.statMode, this.config.weekStart);
            if (!this.dialog) {
                return;
            }
            chartHost.replaceChildren(renderHeatMap(days, i18n, this.config.weekStart));
        } catch (e) {
            console.error(this.displayName, e);
            if (!this.dialog) {
                return;
            }
            chartHost.textContent = i18n.loadFailed;
            showMessage(`${this.displayName}: ${i18n.loadFailed}`);
        } finally {
            this.refreshing = false;
        }
    }
}
