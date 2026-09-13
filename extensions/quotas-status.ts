import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { DEFAULT_STATUS_FORMAT, DEFAULT_USAGE_MODE, errorMessage, isCodexProvider, isDeepSeekProvider, isOpenCodeGoProvider, type PercentMode, type StatusFormat } from "../src/domain";
import { buildQuotasPanel, formatStatus, framePanel, isMissingAuthError, unavailableStatus } from "../src/format";
import { loadPreferences, savePreferences, SETTINGS_FILE } from "../src/preferences";
import { getSupportedUsage, getUsage, MISSING_CODEX_AUTH_ERROR, MISSING_DEEPSEEK_AUTH_ERROR, MISSING_OPENCODE_GO_AUTH_ERROR } from "../src/usage";

const EXTENSION_ID = "quotas-minimal";
const REFRESH_INTERVAL_MS = 60_000;

class QuotasStatus {
	private ctx?: ExtensionContext;
	private generation = 0;
	private timer?: ReturnType<typeof setInterval>;
	private inFlight = false;
	private queued?: { ctx: ExtensionContext; generation: number; provider?: string; modelId?: string };
	private lastRender?: { ctx: ExtensionContext; provider: string | undefined; modelId?: string };
	private usageMode: PercentMode = DEFAULT_USAGE_MODE;
	private format: StatusFormat = DEFAULT_STATUS_FORMAT;
	private enabled = true;
	private preferencesRevision = 0;
	private settingsQueue: Promise<void> = Promise.resolve();

	public constructor(private readonly pi: ExtensionAPI) {
		pi.on("session_start", (_event, ctx) => this.start(ctx));
		pi.on("turn_end", (_event, ctx) => void this.refresh(ctx));
		pi.on("model_select", (event, ctx) => void this.refresh(ctx, event.model.provider, event.model.id));
		pi.on("session_shutdown", (_event, ctx) => this.stop(ctx));

		this.registerQuotasCommand();
	}

	private isCurrent(generation: number): boolean {
		return this.ctx !== undefined && this.generation === generation;
	}

	private start(ctx: ExtensionContext): void {
		this.generation++;
		this.ctx = ctx;
		this.enabled = true;
		if (this.timer) clearInterval(this.timer);
		this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
		this.timer.unref?.();

		const generation = this.generation;
		void (async () => {
			await this.loadPreferences(ctx, generation);
			await this.refresh(ctx, ctx.model?.provider, ctx.model?.id, generation);
		})();
	}

	private stop(ctx: ExtensionContext): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		this.queued = undefined;
		this.ctx = undefined;
		this.generation++;
		if (ctx.hasUI) ctx.ui.setStatus(EXTENSION_ID, undefined);
	}

	private enqueueSettingsOperation<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.settingsQueue.then(operation);
		this.settingsQueue = result.then(() => undefined, () => undefined);
		return result;
	}

	private async loadPreferences(ctx: ExtensionContext, generation: number): Promise<void> {
		const revision = this.preferencesRevision;
		try {
			const preferences = await this.enqueueSettingsOperation(() => loadPreferences());
			if (this.isCurrent(generation) && this.preferencesRevision === revision) {
				this.usageMode = preferences.usageMode;
				this.format = preferences.format;
			}
		} catch (error) {
			if (!this.isCurrent(generation)) return;
			const changedDuringLoad = this.preferencesRevision !== revision;
			if (!changedDuringLoad) {
				this.usageMode = DEFAULT_USAGE_MODE;
				this.format = DEFAULT_STATUS_FORMAT;
			}
			if (ctx.hasUI) {
				const action = changedDuringLoad ? "keeping current preferences" : "using defaults";
				ctx.ui.notify(`pi-quotas-minimal: failed to load ${SETTINGS_FILE}, ${action}: ${errorMessage(error)}`, "warning");
			}
		}
	}

	private isSupported(provider: string | undefined): boolean {
		return isCodexProvider(provider) || isOpenCodeGoProvider(provider) || isDeepSeekProvider(provider);
	}

	private async refresh(
		ctx = this.ctx,
		provider = ctx?.model?.provider,
		modelId = ctx?.model?.id,
		generation = this.generation,
	): Promise<void> {
		if (!ctx?.hasUI || !this.isCurrent(generation)) return;

		if (!this.enabled) {
			this.lastRender = undefined;
			ctx.ui.setStatus(EXTENSION_ID, undefined);
			return;
		}

		if (!this.isSupported(provider)) {
			this.lastRender = undefined;
			ctx.ui.setStatus(EXTENSION_ID, undefined);
			return;
		}

		if (this.inFlight) {
			this.queued = { ctx, generation, provider, modelId };
			return;
		}

		this.inFlight = true;
		try {
			const usage = await getUsage(provider, modelId);
			if (!this.isCurrent(generation)) return;
			this.lastRender = { ctx, provider, modelId };
			ctx.ui.setStatus(EXTENSION_ID, formatStatus(ctx, usage, this.usageMode, this.format, provider));
		} catch (error) {
			if (!this.isCurrent(generation)) return;
			const message = errorMessage(error);
			if (message.includes(MISSING_CODEX_AUTH_ERROR) || message.includes(MISSING_OPENCODE_GO_AUTH_ERROR) || message.includes(MISSING_DEEPSEEK_AUTH_ERROR)) {
				this.lastRender = undefined;
				ctx.ui.setStatus(EXTENSION_ID, undefined);
			} else {
				ctx.ui.setStatus(EXTENSION_ID, unavailableStatus(ctx, provider));
			}
		} finally {
			this.inFlight = false;
			const queued = this.queued;
			this.queued = undefined;
			if (queued && this.isCurrent(queued.generation)) {
				void this.refresh(queued.ctx, queued.provider, queued.modelId, queued.generation);
			}
		}
	}

	private renderLast(ctx: ExtensionContext): boolean {
		if (!ctx.hasUI || !this.lastRender) return false;
		const { provider, modelId } = this.lastRender;
		void this.refresh(ctx, provider, modelId);
		return true;
	}

	private rerender(ctx: ExtensionContext): void {
		if (!this.renderLast(ctx)) void this.refresh(ctx);
	}

	private savePreferences(ctx: ExtensionContext, generation = this.generation): void {
		const preferences = { usageMode: this.usageMode, format: this.format };
		const result = this.enqueueSettingsOperation(() => savePreferences(preferences));
		void result.catch(error => {
			const notifyContext = this.ctx ?? ctx;
			if (this.isCurrent(generation) && notifyContext.hasUI) {
				notifyContext.ui.notify(`pi-quotas-minimal: failed to write ${SETTINGS_FILE}: ${errorMessage(error)}`, "warning");
			}
		});
	}

	private async showAllSourcesOverlay(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI) return;

		let refreshing = false;
		const visible = (entries: Awaited<ReturnType<typeof getSupportedUsage>>) =>
			entries.filter(entry => entry.usage || !isMissingAuthError(entry.error ?? ""));
		const state: { entries: Awaited<ReturnType<typeof getSupportedUsage>> } = {
			entries: visible(await getSupportedUsage()),
		};

		await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
			const component = {
				render: (width: number): string[] =>
					framePanel(buildQuotasPanel(state.entries, Math.max(20, width - 2), theme, { refreshing }), width, theme),
				invalidate: (): void => {},
				handleInput: (data: string): void => {
					if (matchesKey(data, "escape") || matchesKey(data, "q")) {
						done();
						return;
					}
					if (matchesKey(data, "r") && !refreshing) {
						refreshing = true;
						tui.requestRender();
						void getSupportedUsage().then(entries => {
							state.entries = visible(entries);
							refreshing = false;
							tui.requestRender();
						});
					}
				},
			};
			return component;
		}, { overlay: true, overlayOptions: { anchor: "center", width: 80 } });
	}

	private registerQuotasCommand(): void {
		this.pi.registerCommand("quotas", {
			description: "Open quota display settings (mode, format, on/off, all sources)",
			handler: async (_args, ctx) => {
				if (!ctx.hasUI) return;

				let open = true;
				while (open) {
					const choice = await ctx.ui.select("Quota display:", [
						"Show all sources",
						`Status: ${this.enabled ? "on" : "off"}`,
						`Mode: ${this.usageMode}`,
						`Format: ${this.format}`,
						"Close",
					]);
					if (choice === undefined || choice === "Close") {
						open = false;
						break;
					}

					if (choice === "Show all sources") {
						await this.showAllSourcesOverlay(ctx);
					} else if (choice.startsWith("Status:")) {
						const enabled = await ctx.ui.select("Show quotas for this session:", ["on", "off"]);
						if (enabled) {
							const next = enabled === "on";
							if (next !== this.enabled) {
								this.enabled = next;
								if (!this.enabled) {
									this.lastRender = undefined;
									ctx.ui.setStatus(EXTENSION_ID, undefined);
								} else {
									void this.refresh(ctx);
								}
							}
						}
					} else if (choice.startsWith("Mode:")) {
						const mode = await ctx.ui.select("Percent mode:", ["left", "used"]);
						if (mode && mode !== this.usageMode) {
							this.preferencesRevision++;
							this.usageMode = mode as PercentMode;
							this.savePreferences(ctx);
							this.rerender(ctx);
						}
					} else if (choice.startsWith("Format:")) {
						const format = await ctx.ui.select("Status format:", ["compact", "full"]);
						if (format && format !== this.format) {
							this.preferencesRevision++;
							this.format = format as StatusFormat;
							this.savePreferences(ctx);
							this.rerender(ctx);
						}
					}
				}
			},
		});
	}
}

export default function (pi: ExtensionAPI) {
	new QuotasStatus(pi);
}
