import * as tmImage from '@teachablemachine/image';

const MODEL_SOURCES = [
  { model: '/coralimagemodel/model.json', metadata: '/coralimagemodel/metadata.json', label: 'Bundled model' },
  { model: 'https://coral-reef-idsys.netlify.app/coralimagemodel/model.json', metadata: 'https://coral-reef-idsys.netlify.app/coralimagemodel/metadata.json', label: 'Hosted V3.5 model' }
];

export async function loadDefaultModel() {
  let lastError = null;
  for (const source of MODEL_SOURCES) {
    try {
      const model = await tmImage.load(source.model, source.metadata);
      model.__crisSource = source.label;
      return model;
    } catch (error) {
      console.warn('Unable to load model source:', source.label, error);
      lastError = error;
    }
  }
  throw lastError || new Error('No compatible model source found.');
}

export async function loadModelFromFiles(modelFile, weightsFile, metadataFile) {
  const model = await tmImage.loadFromFiles(modelFile, weightsFile, metadataFile);
  model.__crisSource = 'Local Teachable Machine model';
  return model;
}

export async function predict(model, input) {
  const predictions = await model.predict(input, false);
  return predictions.map((item) => ({
    className: item.className,
    probability: Number(item.probability),
  })).sort((a, b) => b.probability - a.probability);
}

export function modelClassCount(model) {
  return typeof model?.getTotalClasses === 'function' ? model.getTotalClasses() : 0;
}

export function modelSourceLabel(model) {
  return model?.__crisSource || 'AI model';
}
