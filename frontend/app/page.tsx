"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import FileUpload from "./components/FileUpload";
import MolViewer from "./components/MolViewer";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Candidate {
  smiles: string;
  name: string;
  score: number;
  rank: number;
  valid: boolean;
  conformer_sdf: string | null;
}

interface PredictResponse {
  candidates: Candidate[];
  modalities_used: string[];
  warning: string | null;
  demo_mode: boolean;
}

interface DemoMolecule {
  name: string;
  display_name: string;
  formula: string;
  smiles: string;
  mw: number;
  has_nmr: boolean;
  has_ms: boolean;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Inline3DViewer({ sdf }: { sdf: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !sdf) return;
    let mounted = true;

    import("3dmol").then(($3Dmol) => {
      if (!mounted || !containerRef.current) return;
      containerRef.current.innerHTML = "";
      const viewer = $3Dmol.createViewer(containerRef.current, {
        backgroundColor: "black",
      });
      viewer.addModel(sdf, "sdf");
      viewer.setStyle({}, { stick: { radius: 0.15, colorscheme: "whiteCarbon" } });
      viewer.addStyle({}, { sphere: { scale: 0.25, colorscheme: "whiteCarbon" } });
      viewer.zoomTo();
      viewer.render();
      viewer.spin("y", 0.4);
    });

    return () => { mounted = false; };
  }, [sdf]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "320px", position: "relative" }}
    />
  );
}

export default function Home() {
  const [nmrFile, setNmrFile] = useState<File | null>(null);
  const [msFile, setMsFile] = useState<File | null>(null);
  const [demoMolecule, setDemoMolecule] = useState<string>("");
  const [demoMolecules, setDemoMolecules] = useState<DemoMolecule[]>([]);

  const [results, setResults] = useState<PredictResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showViewer, setShowViewer] = useState(false);

  const [apiStatus, setApiStatus] = useState<"checking" | "online" | "offline">(
    "checking"
  );

  useEffect(() => {
    axios
      .get(`${API}/health`)
      .then(() => {
        setApiStatus("online");
        return axios.get(`${API}/fixtures`);
      })
      .then((res) => setDemoMolecules(res.data.molecules))
      .catch(() => setApiStatus("offline"));
  }, []);

  async function handlePredict() {
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const body: Record<string, unknown> = {};

      if (demoMolecule) {
        body.demo_molecule = demoMolecule;
      }

      if (nmrFile) body.nmr_csv = await fileToBase64(nmrFile);
      if (msFile) body.ms_csv = await fileToBase64(msFile);

      if (!demoMolecule && !nmrFile && !msFile) {
        setError("Upload at least one spectrum or select a demo molecule.");
        setLoading(false);
        return;
      }

      const res = await axios.post<PredictResponse>(`${API}/predict`, body);
      setResults(res.data);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail || err.message);
      } else {
        setError("Prediction failed");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleDemoSelect(name: string) {
    setDemoMolecule(name === demoMolecule ? "" : name);
    setResults(null);
    setError(null);
  }

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative px-8 pt-16 pb-20 flex flex-col items-center text-center">
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-4 uppercase">
          Spectra
          <span className="text-neutral-500">Struct</span>
        </h1>
        <p className="text-sm text-neutral-500 max-w-md tracking-wide leading-relaxed font-mono">
          Upload NMR and/or MS spectra. Get candidate molecules with
          3D conformers.
        </p>

        <div className="mt-6 flex items-center gap-2">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              apiStatus === "online"
                ? "bg-green-500"
                : apiStatus === "offline"
                ? "bg-red-500"
                : "bg-yellow-500 animate-pulse"
            }`}
          />
          <span className="text-[10px] tracking-[0.2em] uppercase text-neutral-600">
            {apiStatus === "online"
              ? "API Online"
              : apiStatus === "offline"
              ? "API Offline -- start backend"
              : "Checking..."}
          </span>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-8 pb-24">
        {/* Input */}
        <section className="mb-16">
          <div className="text-xs tracking-[0.3em] uppercase text-neutral-500 mb-6">
            01 / Input Spectra
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <FileUpload label="NMR Spectrum" onFile={setNmrFile} file={nmrFile} />
            <FileUpload label="MS Spectrum" onFile={setMsFile} file={msFile} />
          </div>

          {/* Demo picker */}
          <div className="mb-8">
            <div className="text-xs tracking-[0.2em] uppercase text-neutral-600 mb-3">
              Or select a demo molecule
            </div>
            <div className="flex flex-wrap gap-2">
              {demoMolecules.map((mol) => (
                <button
                  key={mol.name}
                  className={`px-3 py-1.5 text-xs border rounded transition-all ${
                    demoMolecule === mol.name
                      ? "border-white/40 text-white bg-white/5"
                      : "border-white/10 text-neutral-500 hover:border-white/20 hover:text-neutral-300"
                  }`}
                  onClick={() => handleDemoSelect(mol.name)}
                >
                  {mol.display_name}
                </button>
              ))}
            </div>
          </div>

          {/* Predict */}
          <button
            onClick={handlePredict}
            disabled={loading || apiStatus !== "online"}
            className={`px-8 py-3 text-sm tracking-[0.2em] uppercase border transition-all ${
              loading
                ? "border-white/10 text-neutral-600 cursor-wait"
                : "border-white text-white hover:bg-white hover:text-black"
            }`}
          >
            {loading ? "Analyzing..." : "Predict Structure"}
          </button>
        </section>

        {/* Error */}
        {error && (
          <div className="mb-8 px-4 py-3 border border-red-500/30 rounded text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Results */}
        {results && results.candidates.length > 0 && (() => {
          const prediction = results.candidates[0];
          const confPercent = prediction.score * 100;
          const confColor =
            confPercent > 80
              ? "rgb(74, 222, 128)"
              : confPercent > 50
              ? "rgb(250, 204, 21)"
              : "rgb(248, 113, 113)";

          return (
            <section>
              <div className="flex items-center justify-between mb-6">
                <div className="text-xs tracking-[0.3em] uppercase text-neutral-500">
                  02 / Prediction
                </div>
                <div className="flex items-center gap-4 text-xs text-neutral-600">
                  {results.demo_mode && (
                    <span className="px-2 py-0.5 border border-white/10 rounded text-[10px] tracking-wider uppercase">
                      Demo
                    </span>
                  )}
                  <span>
                    Modalities:{" "}
                    {results.modalities_used.map((m) => m.toUpperCase()).join(" + ")}
                  </span>
                </div>
              </div>

              <div className="border border-white/10 rounded-lg overflow-hidden">
                {/* Confidence bar */}
                <div className="px-6 py-4 border-b border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-white">
                      {prediction.name}
                    </span>
                    <span
                      className="text-lg font-bold tabular-nums"
                      style={{ color: confColor }}
                    >
                      {confPercent.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${confPercent}%`,
                        backgroundColor: confColor,
                      }}
                    />
                  </div>
                </div>

                {/* Molecule info */}
                <div className="px-6 py-4 border-b border-white/10 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-neutral-500 w-20">SMILES</span>
                    <code className="text-sm font-mono text-white break-all">
                      {prediction.smiles}
                    </code>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-neutral-500 w-20">Valid</span>
                    <span className={`text-sm ${prediction.valid ? "text-green-400" : "text-red-400"}`}>
                      {prediction.valid ? "Yes (RDKit-verified)" : "No"}
                    </span>
                  </div>
                </div>

                {/* Inline 3D Viewer */}
                {prediction.conformer_sdf && (
                  <div className="border-b border-white/10">
                    <Inline3DViewer sdf={prediction.conformer_sdf} />
                  </div>
                )}

                {/* Footer */}
                <div className="px-6 py-3 flex items-center justify-between">
                  <span className="text-xs text-neutral-600">
                    Drag to rotate · Scroll to zoom
                  </span>
                  {prediction.conformer_sdf && (
                    <button
                      onClick={() => setShowViewer(true)}
                      className="text-xs text-blue-400/70 hover:text-blue-400 transition-colors"
                    >
                      Expand 3D View
                    </button>
                  )}
                </div>
              </div>
            </section>
          );
        })()}
      </div>

      {/* Full-screen 3D Viewer modal */}
      {showViewer && results?.candidates[0]?.conformer_sdf && (
        <MolViewer
          sdf={results.candidates[0].conformer_sdf}
          smiles={results.candidates[0].smiles}
          name={results.candidates[0].name}
          score={results.candidates[0].score}
          rank={results.candidates[0].rank}
          onClose={() => setShowViewer(false)}
        />
      )}
    </div>
  );
}
