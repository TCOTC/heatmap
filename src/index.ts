import {
    Dialog,
    getFrontend,
    Plugin,
    showMessage,
} from "siyuan";
import type zhCN from "./i18n/zh-CN.json";
import {
    isStatMode,
    queryYearActivity,
    renderHeatMap,
    renderStatModeSelect,
    type StatMode,
} from "./heatmap";
import "./index.scss";

const STORAGE_NAME = "config.json";

interface PluginConfig {
    statMode: StatMode;
}

export default class HeatMap extends Plugin {
    declare i18n: typeof zhCN;

    private isMobile = false;
    private dialog?: Dialog;
    private config: PluginConfig = {statMode: "created"};
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

        this.addTopBar({
            icon: "iconCalendar",
            title: this.i18n.openHeatMap,
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

        const content = document.createElement("div");
        content.className = "b3-dialog__content jchm-dialog";
        content.innerHTML = `<div class="jchm-panel">${this.i18n.loading}</div>`;

        this.dialog = new Dialog({
            title: this.i18n.heatmapTitle,
            content: content.outerHTML,
            width: this.isMobile ? "92vw" : "860px",
            destroyCallback: () => {
                this.dialog = undefined;
            },
        });

        const container = this.dialog.element.querySelector(".jchm-dialog") as HTMLElement;
        if (!container) {
            return;
        }

        await this.renderPanel(container);
    }

    private async renderPanel(container: HTMLElement) {
        const panel = document.createElement("div");
        panel.className = "jchm-panel";

        const chartHost = document.createElement("div");
        chartHost.className = "jchm-panel__chart";
        chartHost.textContent = this.i18n.loading;
        panel.appendChild(chartHost);

        panel.appendChild(renderStatModeSelect(this.i18n, this.config.statMode, (mode) => {
            this.config.statMode = mode;
            this.saveConfig();
            this.refreshChart(chartHost);
        }));

        container.replaceChildren(panel);
        await this.refreshChart(chartHost);
    }

    private async refreshChart(chartHost: HTMLElement) {
        if (this.refreshing) {
            return;
        }
        this.refreshing = true;
        // 已有图表时保留旧内容，避免切换统计方式时弹窗高度先塌再撑开
        if (!chartHost.querySelector(".jchm")) {
            chartHost.textContent = this.i18n.loading;
        }
        try {
            const days = await queryYearActivity(this.config.statMode);
            if (!this.dialog) {
                return;
            }
            chartHost.replaceChildren(renderHeatMap(days, this.i18n));
        } catch (e) {
            console.error(this.displayName, e);
            if (!this.dialog) {
                return;
            }
            chartHost.textContent = this.i18n.loadFailed;
            showMessage(`${this.displayName}: ${this.i18n.loadFailed}`);
        } finally {
            this.refreshing = false;
        }
    }
}
