import {App, moment, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, WorkspaceLeaf} from 'obsidian';
import {MeiliSearchEngine, ObsidianSearchEngine} from './lib/search-engine';
import {DocumentChunk} from './lib/core';

import {DocumentService, ObsidianDocumentService} from './lib/document-service';
import {MeiliSearch} from 'meilisearch';
import {queryRetrievalEmbeddingsProvider as embeddingsProvider} from './lib/embeddings';
import {SemanticSearchModal} from './lib/semantic-search-modal';
import {MarkdownRenderingContext} from './lib/md';
import {debounce} from './lib/debounce';
import {retryUntilDone} from './lib/retry';
import {LlmChat, VIEW_TYPE_LLM_CHAT} from './lib/llm-chat';


interface ObsidianAIdPluginSettings {
  meiliHost: string;
  meiliMasterKey: string | undefined;
  openAiApiKey: string | undefined;
}

const DEFAULT_SETTINGS: ObsidianAIdPluginSettings = {
  meiliHost: 'http://localhost:7700',
  meiliMasterKey: undefined,
  openAiApiKey: undefined
};

export default class ObsidianAIdPlugin extends Plugin {
  vaultRoot: string;
  private statusBarItemEl: HTMLElement;
  private isPreviewVisible = false;
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

  private init() {
    this.vaultRoot = (this.app.vault.adapter as any).basePath;
    this.statusBarItemEl = this.addStatusBarItem();
  }

  async onload() {
    this.init();
    await this.loadSettings();
    this.addSettingTab(new ObsidianAIdSettingsTab(this.app, this));

    this.addCommand({
      id: 'open-file-from-link',
      name: 'Open File from Link',
      callback: () => {
        const filePath = 'Groceries.md'; // Set the path to the file you want to open
        this.app.workspace.openLinkText(filePath, '/', false);
      }
    });

    if (!this.settingsValid()) {
      new Notice('Obsidian AId: Some settings are missing, please update your settings. Until then the app will not be activated');
      return;
    }

    await this.setup();
  }

  onunload() {

  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async setup() {
    await this.initDocumentService();

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

    this.registerView(
      VIEW_TYPE_LLM_CHAT,
      (leaf) => new LlmChat(leaf, this)
    );

    await this.activateLlmChatView();

    const retryInterval = 30_000; // 30 seconds
    await retryUntilDone(async (done) => {
      const ok = await this.documentService.healthy();
      this.updateConnectionStatus(ok);
      if (!ok) {
        const time = moment().add(30, 's');
        console.error(`Connection with MeiliSearch Failed. Please verify that MeiliSearch is running and your settings are correct. Retrying at ${time}`);
        return;
      }

      done();
    }, retryInterval);

    this.initDocumentListeners();
    await this.syncDocuments();
  }

  private settingsValid(): boolean {
    const {meiliHost, meiliMasterKey, openAiApiKey} = this.settings;
    return (meiliHost !== undefined && meiliHost !== '') &&
      (meiliMasterKey !== undefined && meiliMasterKey !== '') &&
      (openAiApiKey !== undefined && openAiApiKey !== '');
  }

  private updateConnectionStatus(ok: boolean) {
    if (ok) {
      this.statusBarItemEl.setText('Aid: ok');
      this.statusBarItemEl.setAttribute('aria-label', 'Connection with Meilisearch succeeded');
      this.statusBarItemEl.setAttribute('data-tooltip-position', 'top');
    } else {
      this.statusBarItemEl.setText('Aid: Failed');
      this.statusBarItemEl.setAttribute('aria-label', 'Could not connect to MeiliSearch, please check settings');
      this.statusBarItemEl.setAttribute('data-tooltip-position', 'top');
    }
  }

  private initDocumentListeners() {
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

  private async syncDocuments() {
    await this.documentService.createIndex();
    this.statusBarItemEl.setText('AId: syncing');
    this.documentService.sync(this.app.vault.getMarkdownFiles())
      .then(() => {
        this.statusBarItemEl.setText('AId: ok');
        this.statusBarItemEl.setAttribute('aria-label', 'Obsidian AId Status OK');
        this.statusBarItemEl.setAttribute('data-tooltip-position', 'top');
      });
  }

  private async activateLlmChatView() {
    const {workspace} = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_LLM_CHAT);

    if (leaves.length > 0) {
      // A leaf with our view already exists, use that
      leaf = leaves[0];
    } else {
      // Our view could not be found in the workspace, create a new leaf
      // in the right sidebar for it
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        return console.error(`Failed to create LLMChat view (${VIEW_TYPE_LLM_CHAT}), leaf was ${leaf}`);
      }
      await leaf.setViewState({type: VIEW_TYPE_LLM_CHAT, active: false});
    }

    // "Reveal" the leaf in case it is in a collapsed sidebar
    workspace.revealLeaf(leaf);
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
            await this.saveAndReload();
          });
        if (this.plugin.settings.meiliHost) {
          text.setValue(this.plugin.settings.meiliHost);
        }
      });

    new Setting(containerEl)
      .setName('Meili Master Key')
      .setDesc('It\'s a secret')
      .addText(text => {
        text
          .setPlaceholder('XXXXXX-XXXX-XXXX-XXXX-XXXXXX')
          .onChange(async (value) => {
            this.plugin.settings.meiliMasterKey = value;
            await this.saveAndReload();
          });

        if (this.plugin.settings.meiliMasterKey) {
          text.setValue(this.plugin.settings.meiliMasterKey);
        }
      });

    new Setting(containerEl)
      .setName('Open AI API Key')
      .setDesc('It\'s a secret')
      .addText(text => {
        text
          .setPlaceholder('XXXXXX-XXXX-XXXX-XXXX-XXXXXX')
          .onChange(async (value) => {
            this.plugin.settings.openAiApiKey = value;
            await this.saveAndReload();
          });

        if (this.plugin.settings.openAiApiKey) {
          text.setValue(this.plugin.settings.openAiApiKey);
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

  private async saveAndReload() {
    await this.plugin.saveSettings();
    await this.plugin.setup();
  }
}


