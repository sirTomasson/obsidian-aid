import {App, Plugin, PluginSettingTab, Setting, TAbstractFile} from 'obsidian';
import {MeiliSearchEngine, ObsidianSearchEngine} from './lib/search-engine';
import {DocumentChunk} from './lib/core';

import {DocumentService, ObsidianDocumentService} from './lib/document-service';
import {MeiliSearch} from 'meilisearch';
import {queryRetrievalEmbeddingsProvider as embeddingsProvider} from './lib/embeddings';
import {SemanticSearchModal} from './lib/semantic-search-modal';
import {MarkdownRenderingContext} from './lib/md';
import {debounce} from './lib/debounce';

interface ObsidianAIdPluginSettings {
  meiliHost: string;
  meiliMasterKey: string | undefined;
}

const DEFAULT_SETTINGS: ObsidianAIdPluginSettings = {
  meiliHost: 'http://localhost:7700',
  meiliMasterKey: undefined
};

export default class ObsidianAIdPlugin extends Plugin {
  private vaultRoot: string;
  public documentService: DocumentService;
  public searchEngine: ObsidianSearchEngine<DocumentChunk>;

  settings: ObsidianAIdPluginSettings;


  private async initDocumentService() {
    const client = new MeiliSearch({
      host: this.settings.meiliHost,
      apiKey: this.settings.meiliMasterKey
    });
    const indexUid = 'obsidian-aid';

    this.searchEngine = new MeiliSearchEngine<DocumentChunk>(client, indexUid, embeddingsProvider(512));
    this.documentService = new ObsidianDocumentService(this.searchEngine, {
      chunkSize: 3000,
      chunkOverlap: 500,
      vaultRoot: this.vaultRoot,
      embeddingsOptions: {
        size: 512,
        task: 'retrieval.passage'
      }
    });
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

    this.addCommand({
      id: 'obsidain-aid-semantic-search',
      name: 'Semantic Search',
      callback: () => {
        new SemanticSearchModal(
          this.searchEngine,
          this.app,
          new MarkdownRenderingContext(this)
        ).open();
      }
    });

    await this.documentService.createIndex();
    statusBarItemEl.setText('AId: syncing');
    this.documentService.sync(this.app.vault.getMarkdownFiles())
      .then(() => {
        statusBarItemEl.setText('AId: ok');
        statusBarItemEl.setAttribute('aria-label', 'Obsidian AId Status OK');
        statusBarItemEl.setAttribute('data-tooltip-position', 'top');
      });

    this.registerEvent(this.app.vault.on('create', async (file) => {
      if (!file.path.endsWith('.md')) return;

      await this.documentService.create(file);
    }));

    this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
      if (!file.path.endsWith('.md')) return;

      await this.documentService.move(oldPath, file);
    }));

    this.registerEvent(this.app.vault.on('delete', async (file) => {
      if (!file.path.endsWith('.md')) return;

      await this.documentService.delete(file);
    }));


    const modifyDelayed = debounce((file: TAbstractFile) => {
      this.documentService.update(file);
    }, 10_000);

    this.registerEvent(this.app.vault.on('modify', async (file) => {
      if (!file.path.endsWith('.md')) return;

      modifyDelayed(file);
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
          });
      });

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
          text.setValue(this.plugin.settings.meiliMasterKey);
        }
      });

    new Setting(containerEl)
      .setName('Reset Index')
      .setDesc('This will remove all data form search engine and resynchronise')
      .addButton(button => {
        button
          .setButtonText('Reset Index')
          .onClick(async () => {
            await this.plugin.searchEngine.deleteIndex();
            await this.plugin.searchEngine.createIndex();
            await this.plugin.documentService.sync(this.app.vault.getMarkdownFiles());
          });
      });
  }
}


