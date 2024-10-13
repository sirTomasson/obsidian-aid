import {
	BaseComponent, Component,
	IconName,
	ItemView,
	setIcon,
	WorkspaceLeaf
} from "obsidian";
import {buildPluginStaticResourceSrc} from "./utils";
import ObsidianAIdPlugin from "../main";
import {ChatOpenAI} from "@langchain/openai";
import {ChatPromptTemplate, MessagesPlaceholder} from "@langchain/core/prompts";
import {RunnablePassthrough, RunnableSequence, RunnableWithMessageHistory} from "@langchain/core/runnables";
import {AIMessage, AIMessageChunk, HumanMessage} from "@langchain/core/messages";
import {IterableReadableStream} from "@langchain/core/dist/utils/stream";
import {StringOutputParser} from "@langchain/core/output_parsers";
import {BaseRetriever} from "@langchain/core/retrievers";

import {ObsidianSearchEngine} from "./search-engine";
import {DocumentChunk} from "./core"
import {formatDocumentsAsString} from "langchain/util/document";
import {InMemoryChatMessageHistory} from "@langchain/core/chat_history";
import {MarkdownRenderingContext} from './md';


export const VIEW_TYPE_LLM_CHAT = 'view-type-llm-chat'

export class LlmChat extends ItemView {
	private ragChainWithHistory: RunnableWithMessageHistory<Record<string, any>, AIMessageChunk>;
	private renderingContext: MarkdownRenderingContext;

	constructor(leaf: WorkspaceLeaf, private plugin: ObsidianAIdPlugin) {
		super(leaf);
		this.renderingContext = new MarkdownRenderingContext(plugin);
		const model = new ChatOpenAI({
			model: "gpt-4o",
			temperature: 0,
			apiKey: this.plugin.settings.embeddingProviderApiKey
		});
		const messages = [
			new HumanMessage({content: "hi! I'm bob"}),
			new AIMessage({
				content: "```javascript\n" +
					"console.log('Hello World!')\n" +
					"```"
			}),
			new HumanMessage({content: "I like vanilla ice cream"}),
			new AIMessage({content: "nice"})
		];

		const contextualizeQSystemPrompt = `Given a chat history and the latest user question
		which might reference context in the chat history, formulate a standalone question
		which can be understood without the chat history. Do NOT answer the question,
		just reformulate it if needed and otherwise return it as is.`;

		const contextualizeQPrompt = ChatPromptTemplate.fromMessages([
			["system", contextualizeQSystemPrompt],
			new MessagesPlaceholder("chat_history"),
			["human", "{question}"],
		]);
		const contextualizeQChain = contextualizeQPrompt
			.pipe(model)
			.pipe(new StringOutputParser());

		const qaSystemPrompt = `You are an assistant for question-answering tasks.
		Use the following pieces of retrieved context to answer the question.
		If you don't know the answer, just say that you don't know.
		Use three sentences maximum and keep the answer concise.
		
		{context}`;

		const qaPrompt = ChatPromptTemplate.fromMessages([
			["system", qaSystemPrompt],
			new MessagesPlaceholder("chat_history"),
			["human", "{question}"],
		]);

		const contextualizedQuestion = (input: Record<string, unknown>) => {
			if ("chat_history" in input) {
				return contextualizeQChain;
			}
			return input.question;
		};

		const retriever = new ObsidianSearchEngineRetriever(this.plugin.searchEngine);

		const ragChain = RunnableSequence.from([
			RunnablePassthrough.assign({
				context: async (input: Record<string, unknown>) => {
					if ("chat_history" in input) {
						// console.log(input)
						const chain = contextualizedQuestion(input);
						// console.log(await chain.invoke(input))
						return chain.pipe(retriever).pipe(formatDocumentsAsString);
					}
					return "";
				},
			}),
			qaPrompt,
			model,
		])

		const messageHistories: Record<string, InMemoryChatMessageHistory> = {};

		this.ragChainWithHistory = new RunnableWithMessageHistory({
			runnable: ragChain,
			getMessageHistory: async (sessionId: string) => {
				if (messageHistories[sessionId] === undefined) {
					messageHistories[sessionId] = new InMemoryChatMessageHistory();
				}
				await messageHistories[sessionId].addMessages(messages)
				return messageHistories[sessionId];
			},
			inputMessagesKey: "input",
			historyMessagesKey: "chat_history",
		})
	}

	getViewType() {
		return VIEW_TYPE_LLM_CHAT;
	}

	getDisplayText() {
		return "LLM Chat";
	}

	getIcon(): IconName {
		return 'brain-circuit';
	}

	async onOpen() {
		const sessionId = 'xyz'
		const config = {
			configurable: {
				sessionId: 'xyz'
			}
		}


		const container = this.containerEl.children[1];
		container.empty();

		// Create and append chat container
		const chatContainer = container.createDiv({cls: 'chat-container'});

		// Create and append chat body
		const chatBody = new ChatBodyComponent(chatContainer)

		await this.displayMessages(chatBody, sessionId)
		let streamingMessage: StreamingChatMessageComponent;
		new ChatInputComponent(
			chatContainer,
			this.plugin,
			async (question: string) => {
				chatBody.addMessage(new ChatMessageSendComponent(question))
				const stream = await this.ragChainWithHistory.stream({
					question,
				}, config);
				// const stream = await this.withMessageHistory.stream({
				// 	input: question
				// }, config);
				streamingMessage = new StreamingChatMessageComponent(stream, this.renderingContext);
				chatBody.addMessage(streamingMessage)
				await streamingMessage.read();
			},
			() => streamingMessage.cancel()
		)
	}


	async onClose() {
		// Nothing to clean up.
	}

	async displayMessages(chatBody: ChatBodyComponent, sessionId: string) {
		const history = await this.ragChainWithHistory.getMessageHistory(sessionId)
		const messages = await history.getMessages();
		messages.forEach(message => {
			const content = message.content.toString();
			if (message._getType() == 'human') {
				chatBody.addMessage(new ChatMessageSendComponent(content))
			} else {
				chatBody.addMessage(new ChatMessageReceivedComponent(content, this.renderingContext))
			}
		})
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
		containerEl.createDiv({cls: 'message sent', text: this.text})
	}
}

class ChatMessageReceivedComponent extends AbstractChatMessageComponent {

	constructor(private text: string = '',
							private renderingContext: MarkdownRenderingContext,) {
		super();
	}

	async bind(containerEl: HTMLElement): Promise<void> {
		const div = containerEl.createDiv({cls: 'message received'});
		await MarkdownRenderingContext.renderMarkdown(this.renderingContext, this.text, div)
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
				break
			}

			await this.updateMessage(message.content.toString())
		}
		await this.stream.cancel();
	}

	private async updateMessage(text: string): Promise<void> {
		this.content += text
		this.message.textContent = ''
		await MarkdownRenderingContext.renderMarkdown(this.renderingContext, this.content, this.message)
	}

	cancel() {
		this.canceled = true;
	}

	bind(containerEl: HTMLElement): void {
		this.message = containerEl.createDiv({cls: 'message received', text: ''})
	}
}

class ChatBodyComponent extends BaseComponent {

	private readonly chatBodyEl: HTMLDivElement;

	constructor(containerEl: HTMLElement) {
		super();
		this.chatBodyEl = containerEl.createDiv({cls: 'chat-body'});
	}

	addMessage(chatMessage: AbstractChatMessageComponent) {
		chatMessage.bind(this.chatBodyEl)
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
				return
			}
			const message = this.input.value;
			if (!message) {
				return
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
		return this.status == ChatStatus.GENERATING
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
		return "ObsidianSearchEngineRetriever"
	}

	constructor(private searchEngine: ObsidianSearchEngine<DocumentChunk>) {
		super()
	}

	lc_namespace = ["obsidian-aid", "retrievers", "search-engine"];
	lc_serializable = false;

	async _getRelevantDocuments(query: string): Promise<DocumentChunk[]> {
		const docs = (await this.searchEngine.search(query)).hits
		console.log(docs)
		return docs
	}
}
