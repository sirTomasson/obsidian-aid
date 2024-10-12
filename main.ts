import {App, debounce, Plugin, PluginSettingTab, Setting, TAbstractFile} from 'obsidian';
import {MeiliSearchEngine, ObsidianSearchEngine} from "./lib/search-engine";
import {DocumentChunk} from "./lib/core";

import {DocumentService, ObsidianDocumentService} from "./lib/document-service";
import {MeiliSearch} from "meilisearch";

interface ObsidianAIdPluginSettings {
	meiliHost: string;
	meiliMasterKey: string | undefined;
}

const DEFAULT_SETTINGS: ObsidianAIdPluginSettings = {
	meiliHost: 'http://localhost:7700',
	meiliMasterKey: undefined,
}

export default class ObsidianAIdPlugin extends Plugin {
	private vaultRoot: string;
	private documentService: DocumentService;

	settings: ObsidianAIdPluginSettings;


	private async initDocumentService() {
		const client = new MeiliSearch({
			host: this.settings.meiliHost,
			apiKey: this.settings.meiliMasterKey,
		});
		const indexUid = 'obsidian-aid'

		const searchEngine = new MeiliSearchEngine<DocumentChunk>(client, indexUid);
		this.documentService = new ObsidianDocumentService(searchEngine, {
			chunkSize: 3000,
			chunkOverlap: 500,
			vaultRoot: this.vaultRoot,
		})
	}

	private async init() {
		this.vaultRoot = (this.app.vault.adapter as any).basePath;
		await this.initDocumentService();
	}

	async onload() {
		await this.loadSettings();
		await this.init();

		const statusBarItemEl = this.addStatusBarItem();

		this.addSettingTab(new ObsidianAIdSettingsTab(this.app, this));


		if (!await this.documentService.healthy()) {
			statusBarItemEl.setText('MeiliSearch Status: FAILED');
			console.error('Could not connect to MeiliSearch, please check settings');
			return;
		}

		await this.documentService.resetIndex();
		await this.documentService.createAll(this.app.vault.getMarkdownFiles());
		statusBarItemEl.setText('MeiliSearch Status: SUCCESS');

		this.registerEvent(this.app.vault.on('create', async (file) => {
			if (!file.path.endsWith('.md')) {
				return
			}

			await this.documentService.create(file);
		}));

		this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
			if (!file.path.endsWith('.md')) {
				return
			}

			await this.documentService.move(oldPath, file);
		}));

		this.registerEvent(this.app.vault.on('delete', async (file) => {
			if (!file.path.endsWith('.md')) {
				return
			}

			await this.documentService.delete(file);
		}));

		const modifyDelayed = debounce(async (file: TAbstractFile) => {
			await this.documentService.delete(file);
			await this.documentService.create(file);
		}, 5_000, true)

		this.registerEvent(this.app.vault.on('modify', async (file) => {
			if (!file.path.endsWith('.md')) {
				return
			}

			modifyDelayed(file)
		}));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ObsidianAIdSettingsTab extends PluginSettingTab {

	constructor(app: App, private plugin: ObsidianAIdPlugin) {
		super(app, plugin);
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Meili URL')
			.setDesc('URL of your Meili Search instance')
			.addText(text => {
				text.setPlaceholder('http://localhost:7700')
					.setValue(this.plugin.settings.meiliHost)
					.onChange(async (value) => {
						this.plugin.settings.meiliHost = value;
						await this.plugin.saveSettings();
					})
			})

		new Setting(containerEl)
			.setName('Meili Master Key')
			.setDesc('It\'s a secret')
			.addText(text => {
				text
					.setPlaceholder('XXXXXX-XXXX-XXXX-XXXX-XXXXXX')
					.onChange(async (value) => {
						this.plugin.settings.meiliMasterKey = value;
						await this.plugin.saveSettings();
					});
				if (this.plugin.settings.meiliMasterKey) {
					text.setValue(this.plugin.settings.meiliMasterKey)
				}
			});

		new Setting(containerEl)
			.setName('Reset Index')
			.setDesc('This will remove all data form search engine and resynchronise')
			.addButton(button => {
				button
					.setButtonText('Reset Index')
					.onClick(async () => {
					})
			})
	}
}


