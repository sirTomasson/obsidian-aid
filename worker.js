import {env, pipeline} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.2.4';
import * as Tensor from './tensor.js'

env.localModelPath = 'models/';

env.allowRemoteModels = false;
env.allowLocalModels = true;

let pipe;

async function getEmbeddings(texts) {
    if (!pipe) {
        pipe = await pipeline('feature-extraction', 'intfloat/multilingual-e5-small', {
            dtype: 'q4'
        });
    }

    return await pipe(texts);
}

const worker = self;

worker.onmessage = (async (msg) => {
    console.log('message received', msg);
    const embeddings = await getEmbeddings(msg.data.texts);
    console.log(embeddings);
    const meanEmbeddings = Tensor.mean(embeddings, 1);
    const normalizedEmbeddings = Tensor.l2Normalize(meanEmbeddings, 1);
    worker.postMessage({embeddings: normalizedEmbeddings})
});