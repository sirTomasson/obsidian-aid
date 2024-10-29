import {BaseComponent, Component, IconName, ItemView, setIcon, WorkspaceLeaf} from 'obsidian';
import {buildPluginStaticResourceSrc, decodeUri} from './utils';
import ObsidianAIdPlugin from '../main';
import {ChatOpenAI} from '@langchain/openai';
import {ChatPromptTemplate, MessagesPlaceholder} from '@langchain/core/prompts';
import {Runnable, RunnablePassthrough, RunnableSequence, RunnableWithMessageHistory} from '@langchain/core/runnables';
import {AIMessage, AIMessageChunk, HumanMessage} from '@langchain/core/messages';
import {IterableReadableStream} from '@langchain/core/dist/utils/stream';
import {StringOutputParser} from '@langchain/core/output_parsers';
import {BaseRetriever} from '@langchain/core/retrievers';

import {ObsidianSearchEngine} from './search-engine';
import {DocumentChunk} from './core';
import {InMemoryChatMessageHistory} from '@langchain/core/chat_history';
import {MarkdownRenderingContext} from './md';
import {MarkdownFilePreviewView} from './markdown-file-preview-view';
import path from 'path';

export const VIEW_TYPE_LLM_CHAT = 'view-type-llm-chat';

export class LlmChat extends ItemView {
  private ragChainWithHistory: RunnableWithMessageHistory<Record<string, any>, AIMessageChunk>;
  private renderingContext: MarkdownRenderingContext;
	private isPreviewVisible: boolean;
	private markdownPreviewView: MarkdownFilePreviewView | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: ObsidianAIdPlugin) {
    super(leaf);
    this.renderingContext = new MarkdownRenderingContext(plugin);
    const model = new ChatOpenAI({
      model: 'gpt-4o',
      temperature: 0,
      apiKey: this.plugin.settings.openAiApiKey
    });
    const messages = [
      new HumanMessage('What is on my shopping list'),
      new AIMessage('Here is a link <a class="obsidian-aid-document-link" data-line-start="12" data-line-end="16" href="Master Thesis/Assignment.md">1</a>'),
      new HumanMessage('I cannot open the link'),
      new AIMessage('[[Groceries.md|1]]'),
      new HumanMessage('Can you show me all my expenses in CSV format'),
      new AIMessage(
        'Here are your expenses in CSV format:\n' +
        '```csv\n' +
        'date,amount,kind\n' +
        'today,25.67,groceries\n' +
        'yesterday,14.50,movie tickets\n' +
        '2 days ago,99.50,hot ones set\n' +
        '```'
      )
    ];

    const contextualizeQSystemPrompt = `Given a chat history and the latest user question
		which might reference context in the chat history, formulate a standalone question
		which can be understood without the chat history. Do NOT answer the question,
		just reformulate it if needed and otherwise return it as is.`;

    const contextualizeQPrompt = ChatPromptTemplate.fromMessages([
      ['system', contextualizeQSystemPrompt],
      new MessagesPlaceholder('chat_history'),
      ['human', '{question}']
    ]);
    const contextualizeQChain = contextualizeQPrompt
      .pipe(model)
      .pipe(new StringOutputParser());

    const qaSystemPrompt = `
		You are an assistant for question-answering tasks.
		Use the pieces of retrieved <context></context> to answer the question.
		If you don't know the answer, just say that you don't know.
		
		The context contains multiple <document></document>. Cite the relevant documents in the output.
		For citations use the following format:
		<a class="obsidian-aid-document-link" data-line="<document-loc-start>" href="<document-path>"><number></a>
		The document-path, and document-loc-start can be found inside the document, and the number is an increasing citation <number>, starting with 1.
		
		<context>
		{context}
		</context>`;

    const qaPrompt = ChatPromptTemplate.fromMessages([
      ['system', qaSystemPrompt],
      new MessagesPlaceholder('chat_history'),
      ['human', '{question}']
    ]);

    const contextualizedQuestion = (input: Record<string, unknown>): Runnable => {
      if ('chat_history' in input) {
        return contextualizeQChain;
      }
      return input.question as unknown as Runnable;
    };

    const retriever = new ObsidianSearchEngineRetriever(this.plugin.searchEngine);

    const ragChain = RunnableSequence.from([
      RunnablePassthrough.assign({
        context: async (input: Record<string, unknown>) => {
          if ('chat_history' in input) {
            // console.log(input)
            const chain = contextualizedQuestion(input);
            const stringDocuments = await chain.pipe(retriever).pipe(formatDocuments).invoke(input as unknown as string);
            console.log(stringDocuments);
            return stringDocuments;
          }
          return '';
        }
      }),
      qaPrompt,
      model
    ]);

    const messageHistories: Record<string, InMemoryChatMessageHistory> = {};

    this.ragChainWithHistory = new RunnableWithMessageHistory({
      runnable: ragChain,
      getMessageHistory: async (sessionId: string) => {
        if (messageHistories[sessionId] === undefined) {
          messageHistories[sessionId] = new InMemoryChatMessageHistory();
        }
        await messageHistories[sessionId].addMessages(messages);
        return messageHistories[sessionId];
      },
      inputMessagesKey: 'input',
      historyMessagesKey: 'chat_history'
    });

    this.plugin.registerMarkdownPostProcessor((element, _) => {
      const obsidianAIdLinks = element.querySelectorAll('.obsidian-aid-document-link');
      if (obsidianAIdLinks.length < 0) return;

      obsidianAIdLinks.forEach((linkEl: HTMLLinkElement) => {
        linkEl.addEventListener('mouseenter', () => {

          linkEl.addEventListener('mousemove', (event: MouseEvent) => {
            const showMarkdownPreview = event.ctrlKey || event.metaKey;
            if (showMarkdownPreview) {
              const filename = path.join(this.plugin.vaultRoot, decodeUri(linkEl.href));
              const start = Number.parseInt(linkEl.dataset.lineStart) ?? 0;
              this.showMarkdownPreview(this.containerEl, linkEl, filename, start);
            }
          });
        });
        linkEl.addEventListener('click', (event: MouseEvent) => {
          const newLeaf = event.ctrlKey || event.metaKey;
          const path = linkEl.getAttr('href');
          if (!path) return;

          const line: number = Number.parseInt(linkEl.dataset.lineStart) ?? 0;
          this.app.workspace.openLinkText(path, '/', newLeaf, {
            active: true,
            eState: {line}
          });
        });
      });
    });
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
      () => this.hideMarkdownPreview(),
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
    const config = {
      configurable: {
        sessionId: 'xyz'
      }
    };


    const container = this.containerEl.children[1];

    container.empty();
    // Create and append chat container
    const chatContainer = container.createDiv({cls: 'chat-container'});

    // Create and append chat body
    const chatBody = new ChatBodyComponent(chatContainer);

    await this.displayMessages(chatBody, sessionId);
    let streamingMessage: StreamingChatMessageComponent;
    new ChatInputComponent(
      chatContainer,
      this.plugin,
      async (question: string) => {
        chatBody.addMessage(new ChatMessageSendComponent(question));
        const stream = await this.ragChainWithHistory.stream({
          question
        }, config);
        // const stream = await this.withMessageHistory.stream({
        // 	input: question
        // }, config);
        streamingMessage = new StreamingChatMessageComponent(stream, this.renderingContext);
        chatBody.addMessage(streamingMessage);
        await streamingMessage.read();
      },
      () => streamingMessage.cancel()
    );
  }


  async onClose() {
    // Nothing to clean up.
  }

  async displayMessages(chatBody: ChatBodyComponent, sessionId: string) {
    const history = await this.ragChainWithHistory.getMessageHistory(sessionId);
    const messages = await history.getMessages();
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
  GENERATING
}

class ChatInputComponent extends BaseComponent {

  private status: ChatStatus;
  private button: HTMLButtonElement;
  private input: HTMLInputElement;

  constructor(containerEl: HTMLElement,
              plugin: ObsidianAIdPlugin,
              sendChatMessage: (message: string) => Promise<void>,
              cancel: () => void) {
    super();
    this.status = ChatStatus.PENDING_INPUT;
    const chatFooter = containerEl.createDiv({cls: 'chat-footer'});

    const accountIcon = chatFooter.createDiv({cls: 'account-icon'});
    accountIcon.createEl('img', {
      attr: {
        src: buildPluginStaticResourceSrc(plugin, 'assets/account-icon-0.png'),
        alt: 'Accounts'
      }
    });

    const accountDropdown = accountIcon.createDiv({cls: 'account-dropdown'});
    const accounts = ['account-icon-1.png', 'account-icon-2.png', 'account-icon-3.png'];
    accounts.forEach((avatar, index) => {
      const accountItem = accountDropdown.createDiv({cls: 'account-item'});
      accountItem.createEl('img', {
        attr: {
          src: buildPluginStaticResourceSrc(plugin, `assets/${avatar}`),
          alt: `Account ${index + 1}`
        }
      });
    });

    this.input = chatFooter.createEl('input', {type: 'text', attr: {placeholder: 'Type a message...'}});
    this.button = chatFooter.createEl('button', {text: 'Send'});
    this.pendingInput();
    this.button.addEventListener('click', async _ => {
      if (this.isGenerating()) {
        cancel();
        this.pendingInput();
        return;
      }
      const message = this.input.value;
      if (!message) {
        return;
      }

      this.generating();
      await sendChatMessage(message);
      this.pendingInput();
    });

    this.input.addEventListener('input', (e) => {
      if (this.input.value.length > 0) {
        this.readyToSend();
      } else {
        this.pendingInput();
      }
    });
  }

  private generating() {
    setIcon(this.button, 'square');
    this.input.value = '';
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
}

class ObsidianSearchEngineRetriever extends BaseRetriever {
  static lc_name() {
    return 'ObsidianSearchEngineRetriever';
  }

  constructor(private searchEngine: ObsidianSearchEngine<DocumentChunk>) {
    super();
  }

  lc_namespace = ['obsidian-aid', 'retrievers', 'search-engine'];
  lc_serializable = false;

  async _getRelevantDocuments(query: string): Promise<DocumentChunk[]> {
    const docs = (await this.searchEngine.vectorSearch(query)).hits;
    console.log(docs);
    return docs as unknown as DocumentChunk[];
  }
}

function formatDocuments(documents: Record<string, any>[]): string {
  return documents.map(document => {
    return `<document>\n${JSON.stringify(document, null, 2)}\n</document>`;
  }).join('\n');
}

function decodeUri(uri: string): string {
	const strippedPath = uri.replace('app://obsidian.md/', '');
	return decodeURIComponent(strippedPath);
}