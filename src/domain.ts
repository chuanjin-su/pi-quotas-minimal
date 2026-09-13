import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type JsonObject = Record<string, unknown>;
export type PercentMode = "left" | "used";
export type StatusFormat = "compact" | "full";
export type Theme = ExtensionContext["ui"]["theme"];
export type ThemeColor = Parameters<Theme["fg"]>[0];

export type UsageWindow = {
	leftPercent: number | null;
	resetInSeconds: number | null;
};

export type UsageSnapshot = {
	windows: Array<{ label: string; usage: UsageWindow }>;
	balances?: BalanceEntry[];
	isLimited: boolean;
};

export type BalanceEntry = {
	currency: string;
	amount: number | null;
};

export const DEFAULT_USAGE_MODE: PercentMode = "left";
export const DEFAULT_STATUS_FORMAT: StatusFormat = "full";

export function asObject(value: unknown): JsonObject | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function isCodexProvider(provider: string | undefined): boolean {
	return provider === "openai-codex";
}

export function isOpenCodeGoProvider(provider: string | undefined): boolean {
	return provider === "opencode-go";
}

export function isDeepSeekProvider(provider: string | undefined): boolean {
	return provider === "deepseek";
}
