import type {I18n} from "./i18n";

/** 分位阈值：依次为 25% / 50% / 75% */
export type LevelThresholds = readonly [number, number, number];

/** 按分位数映射到 1–4 级，并返回阈值供图例 tooltip 使用 */
export function calcLevels(counts: number[]): {
    levelOf: (count: number) => number;
    thresholds: LevelThresholds;
} {
    const positive = counts.filter((c) => c > 0).sort((a, b) => a - b);
    if (positive.length === 0) {
        return {
            levelOf: () => 0,
            thresholds: [0, 0, 0],
        };
    }
    const q = (p: number) => positive[Math.min(positive.length - 1, Math.floor(positive.length * p))];
    const t1 = q(0.25);
    const t2 = q(0.5);
    const t3 = q(0.75);
    const thresholds: LevelThresholds = [t1, t2, t3];
    return {
        levelOf: (count: number) => {
            if (count <= 0) return 0;
            if (count <= t1) return 1;
            if (count <= t2) return 2;
            if (count <= t3) return 3;
            return 4;
        },
        thresholds,
    };
}

/** 根据分位阈值生成图例格子的数量说明 */
export function formatLegendTooltip(level: number, thresholds: LevelThresholds, i18n: I18n): string {
    if (level === 0) {
        return i18n.legendTooltipZero;
    }

    const [t1, t2, t3] = thresholds;
    const bands: Array<[number, number | null]> = [
        [1, t1],
        [t1 + 1, t2],
        [t2 + 1, t3],
        [t3 + 1, null],
    ];
    const [min, max] = bands[level - 1];

    // 无正样本量时阈值全为 0，仅保留「1+」作为更高颜色的说明
    if (t1 === 0 && t2 === 0 && t3 === 0) {
        return i18n.legendTooltipMore.replace("${min}", "1");
    }

    if (max === null) {
        return i18n.legendTooltipMore.replace("${min}", String(min));
    }
    // 分位重合导致该等级区间为空时，退化为单点说明
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    if (lo === hi) {
        return i18n.legendTooltipExact.replace("${count}", String(lo));
    }
    return i18n.legendTooltipRange
        .replace("${min}", String(lo))
        .replace("${max}", String(hi));
}
