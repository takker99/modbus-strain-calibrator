import type { RegressionDegree } from "./regression";

export const HX711_MV_PER_V_SCALE = (1 / 32768 / 128 / 2) * 1000;

export const hx711RawToMvPerV = (raw: number): number =>
	raw * HX711_MV_PER_V_SCALE;

export type LevelStatus = "normal" | "warning" | "danger";

export function getLevelStatus(raw: number): LevelStatus {
	const ratio = Math.abs(raw) / 32767;
	if (ratio >= 0.9) return "danger";
	if (ratio >= 0.8) return "warning";
	return "normal";
}

export type RatedOutputValue = {
	raw: number;
	mVPerV: number;
	extrapolated: boolean;
};

export type RatedOutputResult =
	| { ok: true; value: RatedOutputValue }
	| { ok: false; error: string };

export function calculateRatedOutput(
	a0: number,
	a1: number,
	a2: number,
	degree: RegressionDegree,
	ratedCapacity: number,
	xRange?: { min: number; max: number },
): RatedOutputResult {
	if (ratedCapacity <= 0) {
		return { ok: false, error: "Rated capacity must be positive" };
	}

	if (degree === 1 || Math.abs(a2) < 1e-15) {
		if (Math.abs(a1) < 1e-15) {
			return {
				ok: false,
				error: "a1 is zero, cannot solve for raw value at rated capacity",
			};
		}
		const raw = (ratedCapacity - a0) / a1;
		const mVPerV = hx711RawToMvPerV(raw);
		const extrapolated = xRange ? raw < xRange.min || raw > xRange.max : true;
		return { ok: true, value: { raw, mVPerV, extrapolated } };
	}

	const c = a0 - ratedCapacity;
	const discriminant = a1 * a1 - 4 * a2 * c;

	if (discriminant < 0) {
		return {
			ok: false,
			error: "Rated capacity exceeds the maximum of the calibration curve",
		};
	}

	const sqrtDisc = Math.sqrt(discriminant);
	const root1 = (-a1 + sqrtDisc) / (2 * a2);
	const root2 = (-a1 - sqrtDisc) / (2 * a2);

	let selectedRaw: number;
	if (!xRange) {
		selectedRaw = root1;
	} else {
		const distToRange = (r: number) => {
			if (r >= xRange.min && r <= xRange.max) return 0;
			return Math.min(Math.abs(r - xRange.min), Math.abs(r - xRange.max));
		};
		const d1 = distToRange(root1);
		const d2 = distToRange(root2);
		selectedRaw = d1 <= d2 ? root1 : root2;
	}

	const mVPerV = hx711RawToMvPerV(selectedRaw);
	const extrapolated = xRange
		? selectedRaw < xRange.min || selectedRaw > xRange.max
		: true;

	return { ok: true, value: { raw: selectedRaw, mVPerV, extrapolated } };
}
