import {Dialog} from "siyuan";
import {normalizeHeatColor} from "./config";
import type {I18n} from "./i18n";

export interface OpenColorDialogOptions {
    i18n: I18n;
    /** 当前热力主色；null 表示跟随主题 */
    color: string | null;
    /** 拖动色板 / 点「使用主题色」时实时预览（不落盘） */
    onPreview: (color: string | null) => void;
    /** 关闭弹窗时落盘当前颜色 */
    onSave: (color: string | null) => void;
}

let openDialog: Dialog | undefined;

/** 打开「颜色」配置 Dialog（transparent 非模态）：原生色板 + 使用主题色；预览即时生效，关闭时保存 */
export function openColorDialog(options: OpenColorDialogOptions): void {
    if (openDialog) {
        return;
    }

    const {i18n, color, onPreview, onSave} = options;
    let current: string | null = color;

    const dialog = new Dialog({
        title: i18n.color,
        content: `<div class="b3-dialog__content jchm-color"></div>`,
        transparent: true,
        destroyCallback: () => {
            if (openDialog === dialog) {
                openDialog = undefined;
            }
            onSave(current);
        },
    });
    openDialog = dialog;

    const body = dialog.element.querySelector(".jchm-color") as HTMLElement | null;
    if (!body) {
        dialog.destroy();
        return;
    }

    const themeHex = resolveThemePrimaryHex(dialog.element);

    const row = document.createElement("div");
    row.className = "jchm-color__row";

    const picker = document.createElement("input");
    picker.type = "color";
    picker.className = "jchm-color__picker";
    picker.value = color || themeHex;
    picker.setAttribute("aria-label", i18n.color);

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "b3-button b3-button--outline jchm-color__reset";
    resetBtn.textContent = i18n.colorUseTheme;

    row.append(picker, resetBtn);
    body.appendChild(row);

    const setPreview = (next: string | null) => {
        current = next;
        onPreview(next);
    };

    picker.addEventListener("input", () => {
        setPreview(normalizeHeatColor(picker.value));
    });

    resetBtn.addEventListener("click", (event) => {
        event.preventDefault();
        picker.value = resolveThemePrimaryHex(dialog.element);
        setPreview(null);
    });
}

/** 解析当前主题 --b3-theme-primary 为 #rrggbb，供原生色板使用 */
function resolveThemePrimaryHex(context: Element): string {
    const probe = document.createElement("span");
    probe.style.color = "var(--b3-theme-primary)";
    context.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    const match = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!match) {
        return "#3575f0";
    }
    const toHex = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
}
