
import {DocumentChunk} from './lib/core';
import {MeiliSearch} from 'meilisearch';
import {queryRetrievalEmbeddingsProvider} from './lib/embeddings';
import {MeiliSearchEngine} from './lib/search-engine';
import {RAGChain} from './lib/rag';
import 'dotenv/config';


const meili = new MeiliSearch({
  host: 'http://localhost:7700',
  apiKey: ''
});

const embeddingsProvider = queryRetrievalEmbeddingsProvider(512)
const se = new MeiliSearchEngine<DocumentChunk>(meili,
  'obsidian-aid',
  embeddingsProvider);

const chain = new RAGChain("",
  se);

const question = 'What is on my todo list?';

(async () => {
  // console.info((await embeddingsProvider(question)))
  console.info(await chain.invoke(question))
})()
