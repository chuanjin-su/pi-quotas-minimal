import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { asObject, DEFAULT_STATUS_FORMAT, DEFAULT_USAGE_MODE, type JsonObject, type PercentMode, type StatusFormat } from "./domain";

const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
export const AUTH_FILE = path.join(agentDir, "auth.json");
export const SETTINGS_FILE = path.join(agentDir, "quotas.json");

export async function readJsonObject(file: string): Promise<JsonObject> {
	try {
		return asObject(JSON.parse(await fs.readFile(file, "utf8"))) ?? {};
	} catch (error) {
		if (asObject(error)?.code === "ENOENT") return {};
		throw error;
	}
}

async function writeJson(file: string, value: unknown): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function loadPreferences(): Promise<{ usageMode: PercentMode; format: StatusFormat }> {
	const preferences = asObject(await readJsonObject(SETTINGS_FILE));
	const usageMode = preferences?.usageMode === "used" ? "used" : preferences?.usageMode === "left" ? "left" : DEFAULT_USAGE_MODE;
	const format = preferences?.format === "compact" ? "compact" : preferences?.format === "full" ? "full" : DEFAULT_STATUS_FORMAT;
	return { usageMode, format };
}

export async function savePreferences(preferences: { usageMode: PercentMode; format: StatusFormat }): Promise<void> {
	const settings = await readJsonObject(SETTINGS_FILE);
	settings.usageMode = preferences.usageMode;
	settings.format = preferences.format;
	await writeJson(SETTINGS_FILE, settings);
}

export type CodexAuth = { accessToken: string; accountId: string };

export async function loadCodexAuth(): Promise<CodexAuth> {
	const auth = asObject((await readJsonObject(AUTH_FILE))["openai-codex"]);
	const accessToken = auth?.type === "oauth" && typeof auth.access === "string" ? auth.access.trim() : undefined;
	const rawAccountId = auth?.accountId ?? auth?.account_id;
	const accountId = typeof rawAccountId === "string" ? rawAccountId.trim() : undefined;
	if (!accessToken || !accountId) throw new Error("Missing openai-codex OAuth access/accountId");
	return { accessToken, accountId };
}

export type OpenCodeGoAuth = { apiKey: string };

export async function loadOpenCodeGoAuth(): Promise<OpenCodeGoAuth> {
	const envKey = process.env.OPENCODE_API_KEY?.trim();
	if (envKey) return { apiKey: envKey };
	const auth = asObject((await readJsonObject(AUTH_FILE))["opencode-go"]);
	const apiKey = auth?.type === "api_key" && typeof auth.key === "string" ? auth.key.trim() : undefined;
	if (!apiKey) throw new Error("Missing opencode-go API key");
	return { apiKey };
}

export type DeepSeekAuth = { apiKey: string };

export async function loadDeepSeekAuth(): Promise<DeepSeekAuth> {
	const envKey = process.env.DEEPSEEK_API_KEY?.trim();
	if (envKey) return { apiKey: envKey };
	const auth = asObject((await readJsonObject(AUTH_FILE))["deepseek"]);
	const apiKey = auth?.type === "api_key" && typeof auth.key === "string" ? auth.key.trim() : undefined;
	if (!apiKey) throw new Error("Missing deepseek API key");
	return { apiKey };
}
