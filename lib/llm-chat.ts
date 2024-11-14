import {BaseComponent, Component, IconName, ItemView, Notice, setIcon, WorkspaceLeaf} from 'obsidian';
import ObsidianAIdPlugin from '../main';
import {AIMessageChunk} from '@langchain/core/messages';
import {IterableReadableStream} from '@langchain/core/dist/utils/stream';
import {MarkdownRenderingContext} from './md';
import {MarkdownFilePreviewView} from './markdown-file-preview-view';
import path from 'path';
import {RAGChain} from './rag';
import {calculateTextWidth, countNewlines} from './utils';

export const VIEW_TYPE_LLM_CHAT = 'view-type-llm-chat';

export class LlmChat extends ItemView {
  private chain: RAGChain;
  private readonly renderingContext: MarkdownRenderingContext;
  private markdownPreviewView: MarkdownFilePreviewView | null = null;

  constructor(leaf: WorkspaceLeaf,
              private plugin: ObsidianAIdPlugin) {
    super(leaf);
    this.renderingContext = new MarkdownRenderingContext(plugin);
  }

  getViewType() {
    return VIEW_TYPE_LLM_CHAT;
  }

  getDisplayText() {
    return 'LLM Chat';
  }

  getIcon(): IconName {
    return 'hand-platter';
  }

  async showMarkdownPreview(rootElement: HTMLElement,
                            targetEl: HTMLElement,
                            filename: string,
                            lineStart: number) {
    if (this.markdownPreviewView) return;

    this.markdownPreviewView = new MarkdownFilePreviewView(
      rootElement,
      targetEl,
      filename,
      new MarkdownRenderingContext(this.plugin),
      () => this.hideMarkdownPreview()
    );
    this.markdownPreviewView.show();
  }

  hideMarkdownPreview() {
    if (!this.markdownPreviewView) return;

    this.markdownPreviewView.hide();
    this.markdownPreviewView = null;
  }

  async onOpen() {
    const sessionId = 'xyz';
    const container = this.containerEl.children[1];
    container.empty();
    const chatContainer = container.createDiv({cls: 'chat-container'});

    if (!this.plugin.settings.openAiApiKey) {
      new Notice('OpenAI API key missing.');
      chatContainer.createDiv({ cls: 'error-container'})
        .createEl('p', { text: 'Failed to OpenAI API key missing.'})
      return
    }

    this.chain = new RAGChain(this.plugin.settings.openAiApiKey, this.plugin.searchEngine);

    const chatBody = new ChatBodyComponent(chatContainer);

    await this.displayMessages(chatBody, sessionId);
    let streamingMessage: StreamingChatMessageComponent;
    new ChatInputComponent(
      chatContainer,
      this.plugin,
      async (question: string) => {
        chatBody.addMessage(new ChatMessageSendComponent(question));
        const stream = await this.chain.stream(question);
        streamingMessage = new StreamingChatMessageComponent(stream, this.renderingContext);
        chatBody.addMessage(streamingMessage);
        await streamingMessage.read();
      },
      () => streamingMessage.cancel()
    );

    this.plugin.registerMarkdownPostProcessor((element, _) => {
      const obsidianAIdLinks = element.querySelectorAll('.obsidian-aid-document-link');
      if (obsidianAIdLinks.length < 0) return;

      obsidianAIdLinks.forEach((linkEl: HTMLLinkElement) => {
        linkEl.addEventListener('mouseenter', () => {

          linkEl.addEventListener('mousemove', (event: MouseEvent) => {
            const showMarkdownPreview = event.ctrlKey || event.metaKey;
            if (showMarkdownPreview) {
              const filename = path.join(this.plugin.vaultRoot, decodeUri(linkEl.href));
              const start = Number.parseInt(linkEl.dataset.lineStart || '0');
              this.showMarkdownPreview(this.containerEl, linkEl, filename, start);
            }
          });
        });
        linkEl.addEventListener('click', (event: MouseEvent) => {
          const newLeaf = event.ctrlKey || event.metaKey;
          const path = linkEl.getAttr('href');
          if (!path) return;

          const line = Number.parseInt(linkEl.dataset.lineStart || '0');
          this.app.workspace.openLinkText(path, '/', newLeaf, {
            active: true,
            eState: {line}
          });
        });
      });
    });
  }


  async onClose() {
    // Nothing to clean up.
  }

  async displayMessages(chatBody: ChatBodyComponent, sessionId: string) {
    const messages = await this.chain.history(sessionId);
    messages.forEach(message => {
      const content = message.content.toString();
      if (message._getType() == 'human') {
        chatBody.addMessage(new ChatMessageSendComponent(content));
      } else {
        chatBody.addMessage(new ChatMessageReceivedComponent(content, this.renderingContext));
      }
    });
  }
}

abstract class AbstractChatMessageComponent extends Component {

  abstract bind(containerEl: HTMLElement): void;
}

class ChatMessageSendComponent extends AbstractChatMessageComponent {

  constructor(private text: string = '') {
    super();
  }

  bind(containerEl: HTMLElement): void {
    containerEl.createDiv({cls: 'message sent', text: this.text});
  }
}

class ChatMessageReceivedComponent extends AbstractChatMessageComponent {

  constructor(private text: string = '',
              private renderingContext: MarkdownRenderingContext) {
    super();
  }

  async bind(containerEl: HTMLElement): Promise<void> {
    const div = containerEl.createDiv({cls: 'message received'});
    await MarkdownRenderingContext.renderMarkdown(this.renderingContext, this.text, div);
  }
}

class StreamingChatMessageComponent extends AbstractChatMessageComponent {

  private message: HTMLElement;

  constructor(private stream: IterableReadableStream<AIMessageChunk>,
              private renderingContext: MarkdownRenderingContext,
              private canceled: boolean = false,
              private content: string = '') {
    super();
  }

  public async read() {
    for await (const message of this.stream) {
      if (this.canceled) {
        break;
      }

      await this.updateMessage(message.content.toString());
    }
    await this.stream.cancel();
  }

  private async updateMessage(text: string): Promise<void> {
    this.content += text;
    this.message.textContent = '';
    await MarkdownRenderingContext.renderMarkdown(this.renderingContext, this.content, this.message);
  }

  cancel() {
    this.canceled = true;
  }

  bind(containerEl: HTMLElement): void {
    this.message = containerEl.createDiv({cls: 'message received', text: ''});
  }
}

class ChatBodyComponent extends BaseComponent {

  private readonly chatBodyEl: HTMLDivElement;

  constructor(containerEl: HTMLElement) {
    super();
    this.chatBodyEl = containerEl.createDiv({cls: 'chat-body'});
  }

  addMessage(chatMessage: AbstractChatMessageComponent) {
    chatMessage.bind(this.chatBodyEl);
  }
}

enum ChatStatus {
  PENDING_INPUT,
  READY_TO_SEND,
  GENERATING,
  MISSING_API_KEY
}

class ChatInputComponent extends BaseComponent {

  private readonly button: HTMLButtonElement;
  private readonly textArea: HTMLTextAreaElement;

  constructor(containerEl: HTMLElement,
              private readonly plugin: ObsidianAIdPlugin,
              sendChatMessage: (message: string) => Promise<void>,
              cancel: () => void,
              private status: ChatStatus = ChatStatus.PENDING_INPUT) {
    super();
    const chatFooter = containerEl
      .createDiv({cls: 'chat-footer-container'})
      .createDiv({cls: 'chat-footer'})

    const placeholder = this.apiKeyMissing() ?
      'Disabled: OpenAI API key missing' : 'Type a message...'

    this.textArea = chatFooter
      .createDiv({cls: 'chat-input-container'})
      .createEl('textarea', {type: 'text', attr: {placeholder, rows: 1}});

    this.textArea.addEventListener('input', () => {
      const textWidth = calculateTextWidth(this.textArea.value, null);
      const chatInputWidth = this.textArea.offsetWidth;
      const newLines = countNewlines(this.textArea.value);
      const nRows = Math.floor(textWidth / chatInputWidth) + newLines + 1;
      this.textArea.rows = Math.min(nRows, 5);
    });

    this.button = chatFooter
      .createDiv({cls: 'stick2bottom-outer'})
      .createDiv({cls: 'stick2bottom-container'})
      .createEl('button', {text: 'Send', cls: 'stick2bottom'});
    this.pendingInput();
    this.button.addEventListener('click', async _ => {
      if (this.isGenerating()) {
        cancel();
        this.pendingInput();
        return;
      }
      const message = this.textArea.value;
      if (!message) {
        return;
      }

      this.generating();
      await sendChatMessage(message);
      this.pendingInput();
    });

    if (this.apiKeyMissing()) {
      this.textArea.disabled = true;
    } else {
      this.pendingInput();
    }

    this.textArea.addEventListener('input', () => {
      if (this.textArea.value.length > 0) {
        this.readyToSend();
      } else {
        this.pendingInput();
      }
    });
  }

  private generating() {
    setIcon(this.button, 'square');
    this.textArea.value = '';
    this.status = ChatStatus.GENERATING;
  }

  private isGenerating() {
    return this.status == ChatStatus.GENERATING;
  }

  private readyToSend() {
    this.button.disabled = false;
    this.status = ChatStatus.READY_TO_SEND;
  }

  private pendingInput() {
    setIcon(this.button, 'send-horizontal');
    this.button.disabled = true;
    this.status = ChatStatus.PENDING_INPUT;
  }

  private apiKeyMissing(): boolean {
    return this.status === ChatStatus.MISSING_API_KEY
  }
}

function decodeUri(uri: string): string {
  const strippedPath = uri.replace('app://obsidian.md/', '');
  return decodeURIComponent(strippedPath);
}