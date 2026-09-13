import {
	loadCodexAuth,
	loadDeepSeekAuth,
	loadOpenCodeGoAuth,
} from "./preferences";
import { asObject, isCodexProvider, isDeepSeekProvider, isOpenCodeGoProvider, type BalanceEntry, type UsageSnapshot, type UsageWindow } from "./domain";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
const SPARK_MODEL_ID = "gpt-5.3-codex-spark";
const SPARK_LIMIT_NAME = "GPT-5.3-Codex-Spark";

export const MISSING_CODEX_AUTH_ERROR = "Missing openai-codex OAuth access/accountId";
export const MISSING_OPENCODE_GO_AUTH_ERROR = "Missing opencode-go API key";
export const MISSING_DEEPSEEK_AUTH_ERROR = "Missing deepseek API key";

type CodexUsageResponse = {
	rate_limit?: unknown;
	additional_rate_limits?: unknown;
};

type CodexWindow = {
	used_percent?: number | null;
	reset_after_seconds?: number | null;
	reset_at?: number | null;
};

type CodexBucket = {
	allowed?: boolean;
	limit_reached?: boolean;
	primary_window?: CodexWindow | null;
	secondary_window?: CodexWindow | null;
};

type GoWindowRecord = {
	status?: unknown;
	percent?: unknown;
	resetsAt?: unknown;
};

type OpenCodeGoUsageResponse = {
	usage?: {
		rolling?: GoWindowRecord;
		weekly?: GoWindowRecord;
		monthly?: GoWindowRecord;
	};
};

type DeepSeekBalanceResponse = {
	is_available?: unknown;
	balance_infos?: unknown;
};

function windowUsage(leftPercent: number | null, resetInSeconds: number | null): UsageWindow {
	return { leftPercent, resetInSeconds };
}

function toPercentLeft(used: unknown): number | null {
	return typeof used === "number" && !Number.isNaN(used) ? Math.min(100, Math.max(0, 100 - used)) : null;
}

function resetSeconds(window: CodexWindow | null | undefined): number | null {
	if (typeof window?.reset_after_seconds === "number" && !Number.isNaN(window.reset_after_seconds)) return window.reset_after_seconds;
	if (typeof window?.reset_at !== "number" || Number.isNaN(window.reset_at)) return null;

	const resetAtSeconds = window.reset_at > 100_000_000_000 ? window.reset_at / 1000 : window.reset_at;
	return Math.max(0, resetAtSeconds - Date.now() / 1000);
}

function rateLimitBucket(value: unknown): CodexBucket | null {
	const record = asObject(value);
	return record && ("primary_window" in record || "secondary_window" in record || "limit_reached" in record || "allowed" in record)
		? record as CodexBucket
		: null;
}

function selectedCodexBucket(data: CodexUsageResponse, modelId: string | undefined): CodexBucket | null {
	if (modelId !== SPARK_MODEL_ID) return rateLimitBucket(data.rate_limit);

	const additionalLimits = Array.isArray(data.additional_rate_limits)
		? data.additional_rate_limits
		: Object.values(asObject(data.additional_rate_limits) ?? {});

	for (const value of additionalLimits) {
		const record = asObject(value);
		const bucket = record?.limit_name === SPARK_LIMIT_NAME && rateLimitBucket(record.rate_limit);
		if (bucket) return bucket;
	}
	return null;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
	const response = await fetch(url, { headers });
	if (!response.ok) throw new Error(`Quota request failed (${response.status}) for ${url}`);
	return await response.json();
}

export async function getCodexUsage(modelId: string | undefined): Promise<UsageSnapshot> {
	const { accessToken, accountId } = await loadCodexAuth().catch(error => {
		throw new Error(error instanceof Error && error.message.startsWith("Missing") ? MISSING_CODEX_AUTH_ERROR : error);
	});
	const data = await fetchJson(CODEX_USAGE_URL, {
		accept: "*/*",
		authorization: `Bearer ${accessToken}`,
		"chatgpt-account-id": accountId,
	}) as CodexUsageResponse;

	const bucket = selectedCodexBucket(data, modelId);
	const secondaryWindow = bucket?.secondary_window;
	return {
		windows: [
			...(secondaryWindow ? [{ label: "5h:", usage: windowUsage(toPercentLeft(bucket?.primary_window?.used_percent), resetSeconds(bucket?.primary_window)) }] : []),
			{ label: "7d:", usage: windowUsage(toPercentLeft((secondaryWindow ?? bucket?.primary_window)?.used_percent), resetSeconds(secondaryWindow ?? bucket?.primary_window)) },
		],
		isLimited: bucket?.limit_reached === true || bucket?.allowed === false,
	};
}

function goWindow(entry: GoWindowRecord | undefined): UsageWindow {
	const percent = typeof entry?.percent === "number" && !Number.isNaN(entry.percent)
		? Math.min(100, Math.max(0, Math.round(entry.percent)))
		: null;
	const leftPercent = percent === null ? null : 100 - percent;
	let resetInSeconds: number | null = null;
	if (typeof entry?.resetsAt === "string") {
		const resetAt = Date.parse(entry.resetsAt);
		if (!Number.isNaN(resetAt)) resetInSeconds = Math.max(0, (resetAt - Date.now()) / 1000);
	}
	return windowUsage(leftPercent, resetInSeconds);
}

export async function getOpenCodeGoUsage(): Promise<UsageSnapshot> {
	const { apiKey } = await loadOpenCodeGoAuth().catch(error => {
		throw new Error(error instanceof Error && error.message.startsWith("Missing") ? MISSING_OPENCODE_GO_AUTH_ERROR : error);
	});
	const data = await fetchJson(OPENCODE_GO_USAGE_URL, {
		accept: "application/json",
		authorization: `Bearer ${apiKey}`,
	}) as OpenCodeGoUsageResponse;

	const usage = data.usage;
	const entries: Array<[string, GoWindowRecord | undefined]> = [
		["5h:", usage?.rolling],
		["week:", usage?.weekly],
		["month:", usage?.monthly],
	];
	let isLimited = false;
	const windows = entries.map(([label, entry]) => {
		if (entry?.status === "rate-limited") isLimited = true;
		return { label, usage: goWindow(entry) };
	});
	return { windows, isLimited };
}

export async function getDeepSeekUsage(): Promise<UsageSnapshot> {
	const { apiKey } = await loadDeepSeekAuth().catch(error => {
		throw new Error(error instanceof Error && error.message.startsWith("Missing") ? MISSING_DEEPSEEK_AUTH_ERROR : error);
	});
	const data = await fetchJson(DEEPSEEK_BALANCE_URL, {
		accept: "application/json",
		authorization: `Bearer ${apiKey}`,
	}) as DeepSeekBalanceResponse;

	const balances: BalanceEntry[] = [];
	for (const value of Array.isArray(data.balance_infos) ? data.balance_infos : []) {
		const record = asObject(value);
		if (!record) continue;
		const currency = typeof record.currency === "string" ? record.currency : undefined;
		if (!currency) continue;
		const parsed = typeof record.total_balance === "string" ? Number.parseFloat(record.total_balance) : Number.NaN;
		balances.push({ currency, amount: Number.isNaN(parsed) ? null : parsed });
	}
	return {
		windows: [],
		balances: balances.length > 0 ? balances : undefined,
		isLimited: data.is_available === false,
	};
}

export async function getUsage(provider: string | undefined, modelId: string | undefined): Promise<UsageSnapshot> {
	if (isCodexProvider(provider)) return await getCodexUsage(modelId);
	if (isOpenCodeGoProvider(provider)) return await getOpenCodeGoUsage();
	if (isDeepSeekProvider(provider)) return await getDeepSeekUsage();
	throw new Error("unsupported");
}

export type ProviderUsage = {
	provider: string;
	usage?: UsageSnapshot;
	error?: string;
};

export const SUPPORTED_PROVIDER_IDS = ["openai-codex", "opencode-go", "deepseek"] as const;

/**
 * Fetches usage for every supported provider in parallel. Providers without
 * valid credentials are omitted; failed requests are reported via `error`.
 */
export async function getSupportedUsage(): Promise<ProviderUsage[]> {
	const results = await Promise.all(SUPPORTED_PROVIDER_IDS.map(async provider => {
		try {
			return { provider, usage: await getUsage(provider, undefined) };
		} catch (error) {
			return { provider, error: error instanceof Error ? error.message : String(error) };
		}
	}));
	return results;
}
