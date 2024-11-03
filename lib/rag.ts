import {Runnable, RunnablePassthrough, RunnableSequence, RunnableWithMessageHistory} from '@langchain/core/runnables';
import {AIMessageChunk, BaseMessage} from '@langchain/core/messages';
import {ChatPromptTemplate, MessagesPlaceholder} from '@langchain/core/prompts';
import {StringOutputParser} from '@langchain/core/output_parsers';
import {ChatOpenAI} from '@langchain/openai';
import {BaseRetriever} from '@langchain/core/retrievers';
import {ObsidianSearchEngine} from './search-engine';
import {DocumentChunk} from './core';
import {InMemoryChatMessageHistory} from '@langchain/core/chat_history';
import {IterableReadableStream} from '@langchain/core/dist/utils/stream';

const  contextualizeQSystemPrompt = `Given a chat history and the latest user question
which might reference context in the chat history, formulate a standalone question
which can be understood without the chat history. Do NOT answer the question,
just reformulate it if needed and otherwise return it as is.`;

const qaSystemPrompt = `You are an assistant for question-answering tasks.
Use the pieces of retrieved <context></context> to answer the question.
If you don't know the answer, just say that you don't know.

The context contains multiple <document></document>. Cite the relevant documents in the output.
For citations use the following format:
<a class="obsidian-aid-document-link" data-line="<document-loc-start>" href="<document-path>"><number></a>
The document-path, and document-loc-start can be found inside the document, and the number is an increasing citation <number>, starting with 1.
Display citations comma separated.

<context>
{context}
</context>`;

export class RAGChain {
  private chain: RunnableWithMessageHistory<Record<string, any>, AIMessageChunk>;

  constructor(openAiApiKey: string,
              searchEngine: ObsidianSearchEngine<DocumentChunk>) {
    const model = new ChatOpenAI({
      model: 'gpt-4o',
      temperature: 0,
      apiKey: openAiApiKey,
    });
    const retriever = new ObsidianSearchEngineRetriever(searchEngine);

    const contextualizeQPrompt = ChatPromptTemplate.fromMessages([
      ['system', contextualizeQSystemPrompt],
      new MessagesPlaceholder('chat_history'),
      ['human', '{question}']
    ]);

    const contextualizeQChain = contextualizeQPrompt
      .pipe(model)
      .pipe(new StringOutputParser());

    const contextualizedQuestion = (input: Record<string, unknown>): Runnable => {
      if ('chat_history' in input) {
        return contextualizeQChain;
      }
      return input.question as unknown as Runnable;
    };

    const qaPrompt = ChatPromptTemplate.fromMessages([
      ['system', qaSystemPrompt],
      new MessagesPlaceholder('chat_history'),
      ['human', '{question}']
    ]);

    const messageHistories: Record<string, InMemoryChatMessageHistory> = {};
    const ragChain = RunnableSequence.from([
      RunnablePassthrough.assign({
        context: async (input: Record<string, unknown>) => {
          if ('chat_history' in input) {
            const chain = contextualizedQuestion(input);
            const stringDocuments = await chain.pipe(retriever).pipe(formatDocuments).invoke(input as unknown as string);
            return stringDocuments;
          }
          return '';
        }
      }),
      qaPrompt,
      model
    ]);

    this.chain = new RunnableWithMessageHistory({
      runnable: ragChain,
      getMessageHistory: async (sessionId: string) => {
        if (messageHistories[sessionId] === undefined) {
          messageHistories[sessionId] = new InMemoryChatMessageHistory();
        }
        await messageHistories[sessionId].addMessages([]);
        return messageHistories[sessionId];
      },
      inputMessagesKey: 'input',
      historyMessagesKey: 'chat_history'
    });
  }

  public async stream(q: string): Promise<IterableReadableStream<AIMessageChunk>> {
    return this.chain.stream({ question: q }, {
      configurable: {
        sessionId: 'xyz'
      }
    })
  }

  public async invoke(q: string) {
    return this.chain.invoke({ question: q}, {
      configurable: {
        sessionId: 'xyz'
      }
    })
  }

  public async history(sessionId: string): Promise<BaseMessage[]> {
    const history = await this.chain.getMessageHistory(sessionId);
    return await history.getMessages();
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
    return docs as unknown as DocumentChunk[];
  }
}

function formatDocuments(documents: Record<string, any>[]): string {
  return documents.map(document => {
    return `<document>\n${JSON.stringify(document, null, 2)}\n</document>`;
  }).join('\n');
}