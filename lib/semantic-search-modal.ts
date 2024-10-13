import {App, Notice, SuggestModal} from 'obsidian';
import {DocumentChunk} from './core';
import {ObsidianSearchEngine} from './search-engine';
import {debouncePromise} from './debounce';
import {MarkdownRenderingContext} from './md';

type VectorSearchDebounce = (arg: string) => Promise<DocumentChunk[]>

export class SemanticSearchModal extends SuggestModal<DocumentChunk> {
  private readonly vectorSearch: VectorSearchDebounce;

  constructor(searchEngine: ObsidianSearchEngine<DocumentChunk>, app: App,
              private readonly mdRenderingContext: MarkdownRenderingContext) {
    super(app);
    this.vectorSearch = debouncePromise(async (query: string) => {
      const response = await searchEngine.vectorSearch(query);
      return response.hits.map(hit => hit as unknown as DocumentChunk);
    }, 500);
  }

  async getSuggestions(query: string): Promise<DocumentChunk[]> {
    if (query.length === 0) {
      this.setPlaceholder('Start typing to search...');
      return [];
    }

    return await this.vectorSearch(query);
  }

  onChooseSuggestion(chunk: DocumentChunk, evt: MouseEvent | KeyboardEvent): any {
    new Notice(`Selected ${chunk.metadata.filename}`);
  }


  async renderSuggestion(chunk: DocumentChunk, el: HTMLElement): Promise<void> {
    const container = el.createDiv();
    container.createEl('p', {text: chunk.metadata.filename});

    await MarkdownRenderingContext.renderMarkdown(
      this.mdRenderingContext,
      chunk.pageContent,
      container.createEl('p')
    );
  }

  onNoSuggestion() {
    super.onNoSuggestion();
  }
}
