import {
    Dialog,
    getFrontend,
    Plugin,
    showMessage,
} from "siyuan";
import type zhCN from "./i18n/zh-CN.json";
import {queryYearActivity, renderHeatMap} from "./heatmap";
import "./index.scss";

const STORAGE_NAME = "config.json";

export default class HeatMap extends Plugin {
    declare i18n: typeof zhCN;

    private isMobile = false;
    private dialog?: Dialog;

    onload() {
        this.loadData(STORAGE_NAME).catch(e => {
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

    private async openHeatMap() {
        if (this.dialog) {
            return;
        }

        const content = document.createElement("div");
        content.className = "b3-dialog__content jchm-dialog";
        content.textContent = this.i18n.loading;

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

        try {
            const days = await queryYearActivity();
            if (!this.dialog) {
                return;
            }
            container.replaceChildren(renderHeatMap(days, this.i18n));
        } catch (e) {
            console.error(this.displayName, e);
            if (!this.dialog) {
                return;
            }
            container.textContent = this.i18n.loadFailed;
            showMessage(`${this.displayName}: ${this.i18n.loadFailed}`);
        }
    }
}
