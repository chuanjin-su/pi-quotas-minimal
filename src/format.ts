import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Wraps panel lines in a rounded accent frame matching the panel width. */
export function framePanel(lines: string[], width: number, theme: Theme): string[] {
	const inner = Math.max(1, width - 2);
	const top = theme.fg("accent", `╭${"─".repeat(inner)}╮`);
	const bottom = theme.fg("accent", `╰${"─".repeat(inner)}╯`);
	const framed = lines.map(line => {
		const content = truncateToWidth(line, inner);
		const pad = " ".repeat(Math.max(0, inner - visibleWidth(content)));
		return `${theme.fg("accent", "│")}${content}${pad}${theme.fg("accent", "│")}`;
	});
	return [top, ...framed, bottom];
}
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type BalanceEntry, type PercentMode, type StatusFormat, type Theme, type ThemeColor, type UsageSnapshot, type UsageWindow } from "./domain";

export function providerLabel(provider: string | undefined): string {
	if (provider === "openai-codex") return "Codex";
	if (provider === "opencode-go") return "OpenCode Go";
	if (provider === "deepseek") return "DeepSeek";
	return "Quotas";
}

const CURRENCY_SYMBOLS: Record<string, string> = {
	USD: "$",
	CNY: "¥",
	EUR: "€",
	GBP: "£",
	JPY: "¥",
};

function currencySymbol(currency: string): string {
	return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
}

function balanceColor(amount: number | null): ThemeColor {
	if (amount === null) return "muted";
	if (amount <= 1) return "error";
	if (amount <= 5) return "warning";
	return "success";
}

function formatBalance(theme: Theme, balance: BalanceEntry, _compact: boolean): string {
	if (balance.amount === null) return theme.fg("muted", "--");
	const symbol = currencySymbol(balance.currency);
	return theme.fg(balanceColor(balance.amount), `${symbol}${balance.amount.toFixed(2)}`);
}

function formatPercent(theme: Theme, leftPercent: number | null, mode: PercentMode, compact: boolean): string {
	if (leftPercent === null) return theme.fg("muted", "--");

	const color = leftPercent <= 10 ? "error" : leftPercent <= 25 ? "warning" : "success";
	const displayed = mode === "left" ? leftPercent : 100 - leftPercent;
	const suffix = compact ? "" : ` ${mode}`;
	return theme.fg(color, `${Math.round(displayed)}%${suffix}`);
}

function formatCountdown(seconds: number | null, compact: boolean): string | null {
	if (seconds === null || Number.isNaN(seconds)) return null;

	const total = Math.max(0, Math.round(seconds));
	const days = Math.floor(total / 86_400);
	const hours = Math.floor((total % 86_400) / 3_600);
	const minutes = Math.floor((total % 3_600) / 60);

	if (compact) {
		if (days) return `${days}d`;
		if (hours) return `${hours}h`;
		return minutes ? `${minutes}m` : `${total % 60}s`;
	}
	if (days) return `${days}d${hours}h`;
	if (hours) return `${hours}h${minutes}m`;
	return minutes ? `${minutes}m` : `${total % 60}s`;
}

function formatWindow(theme: Theme, label: string, usage: { leftPercent: number | null; resetInSeconds: number | null }, usageMode: PercentMode, compact: boolean): string {
	const reset = formatCountdown(usage.resetInSeconds, compact);
	const resetText = reset ? theme.fg("dim", `(${reset}) `) : "";
	return `${theme.fg("dim", label)}${resetText}${formatPercent(theme, usage.leftPercent, usageMode, compact)}`;
}

export function formatStatus(ctx: ExtensionContext, usage: UsageSnapshot, usageMode: PercentMode, format: StatusFormat, provider: string | undefined): string {
	const theme = ctx.ui.theme;
	const compact = format === "compact";
	const title = theme.fg(usage.isLimited ? "error" : "dim", providerLabel(provider));
	const parts = usage.windows
		.map(window => formatWindow(theme, window.label, window.usage, usageMode, compact));
	if (usage.balances?.length) {
		parts.push(...usage.balances.map(balance => formatBalance(theme, balance, compact)));
	}
	return `${title} ${parts.join(" ")}`;
}

export function isMissingAuthError(message: string): boolean {
	return message.startsWith("Missing ");
}

export type PanelEntry = {
	provider: string;
	usage?: UsageSnapshot;
	error?: string;
};

const BAR_TRACK = "░";
const BAR_FILL = "█";

function percentColor(leftPercent: number): ThemeColor {
	return leftPercent <= 10 ? "error" : leftPercent <= 25 ? "warning" : "success";
}

function formatCountdownLong(seconds: number | null): string | null {
	if (seconds === null || Number.isNaN(seconds)) return null;

	const total = Math.max(0, Math.round(seconds));
	const days = Math.floor(total / 86_400);
	const hours = Math.floor((total % 86_400) / 3_600);
	const minutes = Math.floor((total % 3_600) / 60);

	if (days) return `${days}d${hours}h`;
	if (hours) return `${hours}h${minutes}m`;
	return minutes ? `${minutes}m` : `${total % 60}s`;
}

/**
 * Builds the "Provider Quotas" panel body: one section per signed-in
 * provider, with progress bars, right-aligned values, and reset lines.
 * Rendered as plain panel content — the caller adds borders.
 */
export function buildQuotasPanel(entries: PanelEntry[], width: number, theme: Theme, options?: { refreshing?: boolean }): string[] {
	const pad = 2;
	const valueColumn = 12;
	const innerWidth = Math.max(24, width - pad * 2);
	const barWidth = innerWidth - valueColumn - 2;
	const lines: string[] = [];

	const push = (text = ""): void => {
		lines.push(truncateToWidth(text, width));
	};

	push(theme.fg("accent", theme.bold("Provider Quotas")));
	push();
	let rendered = false;

	const pushWindow = (label: string, usage: UsageWindow): void => {
		push(`  ${theme.fg("dim", label)}`);
		if (usage.leftPercent === null) {
			push(`  ${theme.fg("muted", "--")}`);
		} else {
			const left = Math.max(0, Math.min(100, Math.round(usage.leftPercent)));
			const color = percentColor(left);
			const filled = Math.round((left / 100) * barWidth);
			const bar = theme.fg(color, BAR_FILL.repeat(filled)) + theme.fg("dim", BAR_TRACK.repeat(Math.max(0, barWidth - filled)));
			const value = theme.fg(color, `${left}% left`.padStart(valueColumn));
			push(`  ${bar}  ${value}`);
		}
		const reset = formatCountdownLong(usage.resetInSeconds);
		if (reset) push(`  ${theme.fg("dim", `Resets in ${reset}`)}`);
	};

	const pushBalances = (balances: BalanceEntry[]): void => {
		push(`  ${theme.fg("dim", "Balance:")}`);
		const colored = balances.map(balance => {
			if (balance.amount === null) return theme.fg("muted", "--");
			return theme.fg(balanceColor(balance.amount), `${currencySymbol(balance.currency)}${balance.amount.toFixed(2)}`);
		}).join(" ");
		const padding = Math.max(1, innerWidth - visibleWidth(colored));
		push(`  ${" ".repeat(padding)}${colored}`);
	};

	for (const { provider, usage, error } of entries) {
		if (rendered) push();
		rendered = true;
		push(theme.bold(providerLabel(provider)));
		if (error) {
			push(`  ${theme.fg("warning", `unavailable (${error})`)}`);
			continue;
		}
		if (!usage) continue;
		for (const window of usage.windows) pushWindow(window.label, window.usage);
		if (usage.balances?.length) pushBalances(usage.balances);
	}

	if (!rendered) {
		push(theme.fg("muted", "No quota sources are signed in."));
	}

	push();
	push(theme.fg("dim", options?.refreshing ? "refreshing…  q/Esc to close" : "r to refresh  q/Esc to close"));
	return lines;
}

export function unavailableStatus(ctx: ExtensionContext, provider: string | undefined): string {
	return ctx.ui.theme.fg("warning", `${providerLabel(provider)} unavailable`);
}
