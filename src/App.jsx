import { useEffect, useMemo, useRef, useState } from 'react';
import { loadDefaultModel, loadModelFromFiles, modelClassCount, modelSourceLabel, predict } from './ai/model';
import { coralSpecies } from './data/coralSpecies';

const HISTORY_KEY = 'cris-v4-history';
const LIVE_INTERVAL_MS = 450;
const LIVE_WINDOW = 5;
const MAX_HISTORY = 10;
const CONFIDENCE_THRESHOLD = 0.60;

function App() {
  const [model, setModel] = useState(null);
  const [modelSource, setModelSource] = useState('Built-in model');
  const [modelLoading, setModelLoading] = useState(true);
  const [modelError, setModelError] = useState('');
  const [activeTab, setActiveTab] = useState('scan');
  const [mode, setMode] = useState('photo');
  const [imageUrl, setImageUrl] = useState('');
  const [results, setResults] = useState([]);
  const [scanState, setScanState] = useState('idle');
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch { return []; }
  });
  const [isLive, setIsLive] = useState(false);
  const [liveStatus, setLiveStatus] = useState('Ready');
  const [stableResult, setStableResult] = useState(null);
  const [referenceSearch, setReferenceSearch] = useState('');

  const imageRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const predictionWindowRef = useRef([]);

  const galleryRef = useRef(null);
  const cameraFileRef = useRef(null);
  const modelJsonRef = useRef(null);
  const weightsRef = useRef(null);
  const metadataRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setModelLoading(true);
        const loaded = await loadDefaultModel();
        if (mounted) { setModel(loaded); setModelSource(modelSourceLabel(loaded)); }
      } catch (error) {
        console.error(error);
        if (mounted) setModelError('The built-in AI model could not be loaded. Check the model files under public/coralimagemodel/.');
      } finally {
        if (mounted) setModelLoading(false);
      }
    })();
    return () => { mounted = false; stopCamera(); };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
    } catch (error) {
      console.warn('Local history storage limit reached; the current session can still be used.', error);
    }
  }, [history]);

  const selectedSpecies = useMemo(() => {
    const top = results[0];
    return top ? coralSpecies.find((item) => item.name === top.className) : null;
  }, [results]);

  const filteredSpecies = useMemo(() => {
    const q = referenceSearch.trim().toLowerCase();
    if (!q) return coralSpecies;
    return coralSpecies.filter((item) =>
      [item.name, item.group, item.taxonomy, item.description].some((value) => value.toLowerCase().includes(q))
    );
  }, [referenceSearch]);

  function confidenceLabel(value) {
    if (value >= 0.85) return 'High';
    if (value >= CONFIDENCE_THRESHOLD) return 'Moderate';
    return 'Low';
  }

  function normalizeResults(predictions) {
    return predictions.slice(0, 3).map((item) => ({ ...item, confidence: confidenceLabel(item.probability) }));
  }

  function saveHistory(image, predictions, source = 'photo') {
    if (!image || !predictions?.length) return;
    const record = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      image,
      results: predictions,
      source,
      createdAt: new Date().toISOString(),
    };
    setHistory((current) => [record, ...current.filter((item) => item.image !== image)].slice(0, MAX_HISTORY));
  }

  async function runPrediction(input, shouldSave = true, source = 'photo') {
    if (!model) return [];
    try {
      setScanState('analyzing');
      const predictions = normalizeResults(await predict(model, input));
      setResults(predictions);
      setScanState('done');
      if (shouldSave && imageUrl && source !== 'live') saveHistory(imageUrl, predictions, source);
      return predictions;
    } catch (error) {
      console.error(error);
      setScanState('error');
      setModelError('Prediction failed. Try a clearer image with the specimen centered in the frame.');
      return [];
    }
  }

  async function handleImageFile(file) {
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      setImageUrl(dataUrl);
      setResults([]);
      setStableResult(null);
      setScanState('ready');
      setMode('photo');
    } catch (error) {
      console.error(error);
      setModelError('The image could not be prepared. Try another photo file.');
    }
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const maxDimension = 1024;
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL('image/jpeg', 0.65));
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Unable to decode image'));
      };
      image.src = objectUrl;
    });
  }

  function openHistory(record) {
    setImageUrl(record.image);
    setResults(record.results);
    setMode('photo');
    setActiveTab('scan');
  }

  function clearHistory() {
    if (window.confirm('Clear all saved scan history from this device?')) setHistory([]);
  }

  async function startCamera() {
    if (!model || isLive) return;
    try {
      setModelError('');
      setMode('live');
      setIsLive(true);
      setLiveStatus('Requesting camera access…');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setLiveStatus('Scanning');
      predictionWindowRef.current = [];
      setStableResult(null);
      intervalRef.current = window.setInterval(runLivePrediction, LIVE_INTERVAL_MS);
    } catch (error) {
      console.error(error);
      setIsLive(false);
      setMode('photo');
      setLiveStatus('Camera unavailable');
      setModelError('Camera access was not granted. On mobile, allow camera permission and use HTTPS.');
    }
  }

  function stopCamera() {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsLive(false);
    setLiveStatus('Ready');
  }

  async function runLivePrediction() {
    if (!model || !videoRef.current || !canvasRef.current || !streamRef.current) return;
    if (videoRef.current.readyState < 2) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const targetWidth = 640;
    const ratio = video.videoHeight / Math.max(video.videoWidth, 1);
    canvas.width = targetWidth;
    canvas.height = Math.max(360, Math.round(targetWidth * ratio));
    canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      const predictions = normalizeResults(await predict(model, canvas));
      setResults(predictions);
      const top = predictions[0];
      if (!top) return;

      predictionWindowRef.current = [
        ...predictionWindowRef.current.slice(-(LIVE_WINDOW - 1)),
        { className: top.className, probability: top.probability }
      ];

      const counts = {};
      for (const item of predictionWindowRef.current) {
        counts[item.className] = counts[item.className] || [];
        counts[item.className].push(item.probability);
      }

      const stableEntry = Object.entries(counts)
        .map(([className, values]) => ({
          className,
          support: values.length,
          average: values.reduce((a, b) => a + b, 0) / values.length
        }))
        .sort((a, b) => (b.support - a.support) || (b.average - a.average))[0];

      if (stableEntry && stableEntry.support >= 3 && stableEntry.average >= CONFIDENCE_THRESHOLD) {
        setStableResult(stableEntry);
        setLiveStatus('Stable identification');
      } else {
        setStableResult(null);
        setLiveStatus('Scanning');
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function loadLocalModel() {
    const modelFile = modelJsonRef.current?.files?.[0];
    const weightsFile = weightsRef.current?.files?.[0];
    const metadataFile = metadataRef.current?.files?.[0];
    if (!modelFile || !weightsFile || !metadataFile) {
      setModelError('Select model.json, weights.bin, and metadata.json.');
      return;
    }
    try {
      setModelLoading(true);
      setModelError('');
      const loaded = await loadModelFromFiles(modelFile, weightsFile, metadataFile);
      setModel(loaded);
      setModelSource(modelSourceLabel(loaded));
      setResults([]);
      setStableResult(null);
    } catch (error) {
      console.error(error);
      setModelError('Local model loading failed. Make sure the three files came from the same Teachable Machine export.');
    } finally {
      setModelLoading(false);
    }
  }

  async function identifyCurrentImage() {
    if (imageRef.current?.complete) await runPrediction(imageRef.current, true, 'photo');
  }

  function resetScan() {
    stopCamera();
    setImageUrl('');
    setResults([]);
    setStableResult(null);
    setMode('photo');
    setScanState('idle');
  }

  function accuracyBar(value) {
    return Math.round(value * 100) + '%';
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">CR</div>
          <div>
            <div className="brand-title">Coral Reef ID</div>
            <div className="brand-subtitle">Philippines • AI-assisted field guide</div>
          </div>
        </div>
        <div className="model-chip" title={model ? 'AI model ready' : 'Loading AI model'}>
          <span className={model ? 'status-dot live' : 'status-dot'} />
          {modelLoading ? 'Loading AI' : modelClassCount(model) + ' classes'}
        </div>
      </header>

      {modelError && (
        <div className="notice error">
          <strong>AI notice:</strong> {modelError}
          <button onClick={() => setModelError('')}>Dismiss</button>
        </div>
      )}

      <main className="content">
        <nav className="tabs" aria-label="Main navigation">
          <button className={activeTab === 'scan' ? 'tab active' : 'tab'} onClick={() => setActiveTab('scan')}>Scan</button>
          <button className={activeTab === 'species' ? 'tab active' : 'tab'} onClick={() => setActiveTab('species')}>Species Reference</button>
          <button className={activeTab === 'history' ? 'tab active' : 'tab'} onClick={() => setActiveTab('history')}>History</button>
          <button className={activeTab === 'model' ? 'tab active' : 'tab'} onClick={() => setActiveTab('model')}>Model</button>
        </nav>

        {activeTab === 'scan' && (
          <section>
            <div className="hero">
              <div>
                <p className="eyebrow">FIELD IDENTIFICATION</p>
                <h1>Identify reef organisms from a photo.</h1>
                <p className="hero-copy">Run the model directly in the browser. Your image can stay on the device; this interface is designed for offline-capable field use.</p>
              </div>
              <div className="hero-badge"><span>MODEL</span><strong>{modelSource}</strong></div>
            </div>

            <div className="mode-toggle">
              <button className={mode === 'photo' ? 'mode active' : 'mode'} onClick={() => { stopCamera(); setMode('photo'); }}>Photo</button>
              <button className={mode === 'live' ? 'mode active' : 'mode'} onClick={startCamera}>Live Scanner</button>
            </div>

            {mode === 'photo' ? (
              <div className="scan-grid">
                <div className="panel preview-panel">
                  <div className="panel-head">
                    <div><span className="panel-kicker">INPUT</span><h2>Specimen image</h2></div>
                    <button className="ghost-btn" onClick={resetScan}>Reset</button>
                  </div>

                  <div className={imageUrl ? 'preview has-image' : 'preview'}>
                    {imageUrl ? (
                      <img ref={imageRef} src={imageUrl} alt="Selected coral specimen" onLoad={identifyCurrentImage} />
                    ) : (
                      <div className="empty-preview">
                        <div className="empty-icon">◌</div>
                        <strong>Add a reef photograph</strong>
                        <span>Center the specimen, minimize blur, and keep the subject large enough to see.</span>
                      </div>
                    )}
                  </div>

                  <div className="input-actions">
                    <button className="primary-btn" onClick={() => galleryRef.current?.click()}>Upload from Gallery</button>
                    <button className="secondary-btn" onClick={() => cameraFileRef.current?.click()}>Take Photo</button>
                  </div>

                  <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => handleImageFile(e.target.files?.[0])} />
                  <input ref={cameraFileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handleImageFile(e.target.files?.[0])} />
                </div>

                <div className="panel result-panel">
                  <div className="panel-head">
                    <div><span className="panel-kicker">AI RESULT</span><h2>{scanState === 'analyzing' ? 'Analyzing…' : 'Best matches'}</h2></div>
                    <span className={scanState === 'done' ? 'result-state done' : 'result-state'}>{scanState}</span>
                  </div>

                  {!results.length ? (
                    <div className="results-empty">
                      <div className="confidence-ring">AI</div>
                      <h3>Waiting for an image</h3>
                      <p>Your top 3 matches will appear here with a confidence indicator.</p>
                    </div>
                  ) : (
                    <div className="results-list">
                      {results.map((item, index) => (
                        <div className={index === 0 ? 'result-card best' : 'result-card'} key={item.className}>
                          <div className="result-topline">
                            <span className="rank">#{index + 1}</span>
                            <span className="result-name">{item.className}</span>
                            {index === 0 && <span className="best-pill">BEST MATCH</span>}
                          </div>
                          <div className="result-meta"><span>{item.confidence} confidence</span><strong>{accuracyBar(item.probability)}</strong></div>
                          <div className="bar"><span style={{ width: accuracyBar(item.probability) }} /></div>
                        </div>
                      ))}

                      <div className={results[0].probability >= CONFIDENCE_THRESHOLD ? 'advice positive' : 'advice'}>
                        <strong>{results[0].probability >= CONFIDENCE_THRESHOLD ? 'Use as a field lead' : 'Low-confidence result'}</strong>
                        <span>{results[0].probability >= CONFIDENCE_THRESHOLD ? 'Confirm the visual traits against a trusted taxonomic reference before recording a species-level observation.' : 'Retake the photo closer, improve lighting, and isolate one specimen before relying on the result.'}</span>
                      </div>

                      {selectedSpecies && (
                        <div className="species-summary">
                          <span className="panel-kicker">REFERENCE</span>
                          <h3>{selectedSpecies.name}</h3>
                          <div className="tag-row"><span>{selectedSpecies.group}</span><span>{selectedSpecies.taxonomy}</span></div>
                          <p>{selectedSpecies.description}</p>
                          <button className="text-btn" onClick={() => setActiveTab('species')}>Open species reference →</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="live-layout">
                <div className="panel live-panel">
                  <div className="panel-head">
                    <div><span className="panel-kicker">CAMERA</span><h2>Live Scanner</h2></div>
                    <span className={isLive ? 'scan-indicator scanning' : 'scan-indicator'}>{liveStatus}</span>
                  </div>
                  <div className="video-frame">
                    <video ref={videoRef} muted playsInline autoPlay />
                    {!isLive && <div className="camera-overlay"><strong>Camera ready</strong><span>Tap Start Scanner to begin.</span></div>}
                    {stableResult && <div className="stable-overlay"><span>STABLE IDENTIFICATION</span><strong>{stableResult.className}</strong><small>{Math.round(stableResult.average * 100)}% average • {stableResult.support}/{LIVE_WINDOW} frames</small></div>}
                  </div>
                  <canvas ref={canvasRef} hidden />
                  <div className="input-actions">
                    {!isLive ? <button className="primary-btn" onClick={startCamera}>Start Scanner</button> : <button className="danger-btn" onClick={stopCamera}>Stop Scanner</button>}
                    <button className="secondary-btn" onClick={() => { stopCamera(); setMode('photo'); }}>Switch to Photo</button>
                  </div>
                </div>

                <div className="panel result-panel">
                  <div className="panel-head"><div><span className="panel-kicker">LIVE AI</span><h2>Current matches</h2></div></div>
                  <div className="results-list">
                    {results.length ? results.map((item, index) => (
                      <div className={index === 0 ? 'result-card best' : 'result-card'} key={item.className}>
                        <div className="result-topline"><span className="rank">#{index + 1}</span><span className="result-name">{item.className}</span></div>
                        <div className="result-meta"><span>{item.confidence}</span><strong>{accuracyBar(item.probability)}</strong></div>
                        <div className="bar"><span style={{ width: accuracyBar(item.probability) }} /></div>
                      </div>
                    )) : <div className="results-empty compact"><h3>Nothing detected yet</h3><p>Point the camera toward one specimen and keep it steady.</p></div>}
                  </div>
                </div>
              </div>
            )}

            <div className="field-note"><strong>Field note:</strong> A high model probability is not the same as taxonomic certainty. Use this tool to narrow possibilities, then verify the organism with reference material and expert review when needed.</div>
          </section>
        )}

        {activeTab === 'species' && (
          <section>
            <div className="section-head">
              <div>
                <p className="eyebrow">REFERENCE CATALOG</p>
                <h1>Model classes & reef context</h1>
                <p>These are the visual classes currently supported by the bundled model, with reef-context notes. The LikasMap Anthozoa catalog can be used as an external reference when expanding this list.</p>
              </div>
              <a className="link-btn" href="https://likasmap.com/species/class/Anthozoa" target="_blank" rel="noreferrer">Open LikasMap Anthozoa ↗</a>
            </div>
            <div className="reference-search">
              <input value={referenceSearch} onChange={(e) => setReferenceSearch(e.target.value)} placeholder="Search a coral, anemone, or reef organism…" />
              <span>{filteredSpecies.length} classes</span>
            </div>
            <div className="species-grid">
              {filteredSpecies.map((item) => (
                <article className="species-card" key={item.name}>
                  <div className="species-card-top"><span className="species-group">{item.group}</span><span className="species-taxonomy">{item.taxonomy}</span></div>
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'history' && (
          <section>
            <div className="section-head">
              <div><p className="eyebrow">ON-DEVICE HISTORY</p><h1>Recent identifications</h1><p>Saved locally in this browser/device for quick review during field work.</p></div>
              {history.length > 0 && <button className="ghost-btn" onClick={clearHistory}>Clear history</button>}
            </div>
            {!history.length ? (
              <div className="empty-state large"><div className="empty-icon">◇</div><h2>No saved scans yet</h2><p>Completed photo identifications will appear here.</p><button className="primary-btn" onClick={() => setActiveTab('scan')}>Start scanning</button></div>
            ) : (
              <div className="history-grid">
                {history.map((record) => (
                  <button className="history-card" key={record.id} onClick={() => openHistory(record)}>
                    <img src={record.image} alt={record.results?.[0]?.className || 'Saved scan'} />
                    <div className="history-info"><strong>{record.results?.[0]?.className || 'Unknown'}</strong><span>{Math.round((record.results?.[0]?.probability || 0) * 100)}% • {new Date(record.createdAt).toLocaleString()}</span></div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === 'model' && (
          <section>
            <div className="section-head">
              <div><p className="eyebrow">MODEL MANAGER</p><h1>Swap in a newer Teachable Machine export</h1><p>Keep the interface stable while experimenting with a better-trained model. Choose the model.json, weights.bin, and metadata.json from one export.</p></div>
            </div>
            <div className="model-layout">
              <div className="panel">
                <div className="model-status"><span className={model ? 'status-dot live' : 'status-dot'} /><div><strong>{model ? 'AI model ready' : 'Model unavailable'}</strong><span>{modelSource} • {modelClassCount(model)} classes</span></div></div>
                <div className="file-stack">
                  <label><span>1. model.json</span><input ref={modelJsonRef} type="file" accept=".json,application/json" /></label>
                  <label><span>2. weights.bin</span><input ref={weightsRef} type="file" accept=".bin,application/octet-stream" /></label>
                  <label><span>3. metadata.json</span><input ref={metadataRef} type="file" accept=".json,application/json" /></label>
                </div>
                <button className="primary-btn full" onClick={loadLocalModel}>Load Local Model</button>
              </div>
              <div className="panel model-help">
                <span className="panel-kicker">RECOMMENDED V4 MODEL WORKFLOW</span>
                <h2>Train → export → test → replace</h2>
                <p>For the next training iteration, keep a consistent dataset structure, include difficult/negative examples, and evaluate the model on photographs that were not used during training.</p>
                <div className="workflow">
                  <div><strong>01</strong><span>Expand Philippine reef image coverage</span></div>
                  <div><strong>02</strong><span>Balance classes and add varied lighting/angles</span></div>
                  <div><strong>03</strong><span>Test on unseen field photographs</span></div>
                  <div><strong>04</strong><span>Export the Teachable Machine model</span></div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="footer"><span>Coral Reef Identification System V4</span><span>AI-assisted • Browser-based • Designed for offline-friendly field use</span></footer>
    </div>
  );
}

export default App;
