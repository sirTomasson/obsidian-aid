export function totalSize(dims) {
    let size = 1;
    for (let i = 0; i < dims.length; i++) {
        size *= dims[i];
    }
    return size;
}

export function l2Norm(tensor, dim) {
    const dims = tensor.dims
    const data = tensor.data
    const dimSize = dims[dim]
    const dimsAfter = dims.slice(dim+1, dims.length);
    const size = dimsAfter.length === 0 ? 1 : dimsAfter.reduce((a, b) => a * b)
    const remainingDims = dims.filter((d, i) => i !== dim)
    const result = zeros(remainingDims)
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < dimSize; j++) {
            const index = j * size + i
            const value = data[index]
            result.data[i] += value**2 // square
        }
    }
    for (let i = 0; i < result.data.length; i++) {
        result.data[i] = Math.sqrt(result.data[i])
    }
    return result
}

export function l2Normalize(tensor, dim) {
    const norm = l2Norm(tensor, dim).data[0];
    return div(norm, tensor);
}



export function zeros(dims) {
    const size = totalSize(dims);
    const data = new Array(size).fill(0);
    return {
        data,
        dims
    }
}

export function mean(tensor, dim) {
    const dimSize = tensor.dims[dim];
    const tensorSum = sum(tensor, dim);
    return div(dimSize, tensorSum);
}

export function div(x, tensor) {
    const result = Array.from(tensor.data);
    for (let i = 0; i < result.length; ++i) {
        result[i] /= x
    }
    return {
        data: result,
        dims: tensor.dims
    };
}

export function sum(tensor, dim) {
    const dims = tensor.dims
    const data = tensor.data
    const dimSize = dims[dim]
    const dimsAfter = dims.slice(dim+1, dims.length);
    const size = dimsAfter.length === 0 ? 1 : dimsAfter.reduce((a, b) => a * b)
    const remainingDims = dims.filter((d, i) => i !== dim)
    const result = zeros(remainingDims)
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < dimSize; j++) {
            const index = j * size + i
            const value = data[index]
            result.data[i] += value
        }
    }
    return result
}