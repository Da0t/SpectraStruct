"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import FileUpload from "./components/FileUpload";
import CandidateCard from "./components/CandidateCard";
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

export default function Home() {
  const [nmrFile, setNmrFile] = useState<File | null>(null);
  const [msFile, setMsFile] = useState<File | null>(null);
  const [irFile, setIrFile] = useState<File | null>(null);
  const [topK, setTopK] = useState(5);
  const [demoMolecule, setDemoMolecule] = useState<string>("");
  const [demoMolecules, setDemoMolecules] = useState<DemoMolecule[]>([]);

  const [results, setResults] = useState<PredictResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [viewerCandidate, setViewerCandidate] = useState<Candidate | null>(
    null
  );

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
      const body: Record<string, unknown> = { top_k: topK };

      if (demoMolecule) {
        body.demo_molecule = demoMolecule;
      }

      if (nmrFile) body.nmr_csv = await fileToBase64(nmrFile);
      if (msFile) body.ms_csv = await fileToBase64(msFile);
      if (irFile) body.ir_csv = await fileToBase64(irFile);

      if (!demoMolecule && !nmrFile && !msFile && !irFile) {
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
          Upload NMR, MS, and/or IR spectra. Get ranked candidate molecules with
          3D conformers. Multimodal fusion for better accuracy.
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <FileUpload label="NMR Spectrum" onFile={setNmrFile} file={nmrFile} />
            <FileUpload label="MS Spectrum" onFile={setMsFile} file={msFile} />
            <FileUpload label="IR Spectrum" onFile={setIrFile} file={irFile} />
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

          {/* Top-K slider */}
          <div className="flex items-center gap-6 mb-8">
            <div className="text-xs tracking-[0.2em] uppercase text-neutral-600 shrink-0">
              Top-K Results
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={topK}
              onChange={(e) => setTopK(parseInt(e.target.value))}
              className="flex-1 max-w-xs"
            />
            <span className="text-sm font-bold tabular-nums w-6 text-right">
              {topK}
            </span>
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
        {results && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <div className="text-xs tracking-[0.3em] uppercase text-neutral-500">
                02 / Results
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

            {results.warning && (
              <div className="mb-6 px-4 py-2 border border-yellow-500/20 rounded text-xs text-yellow-500/70">
                {results.warning}
              </div>
            )}

            <div className="space-y-3">
              {results.candidates.map((c) => (
                <CandidateCard
                  key={c.rank}
                  candidate={c}
                  onClick={() => {
                    if (c.conformer_sdf) {
                      setViewerCandidate(c);
                    }
                  }}
                  isCorrect={c.rank === 1}
                />
              ))}
            </div>

            <div className="mt-6 text-xs text-neutral-600">
              Click a candidate with{" "}
              <span className="text-blue-400/70">3D</span> badge to view its
              molecular conformer
            </div>
          </section>
        )}
      </div>

      {/* 3D Viewer modal */}
      {viewerCandidate && viewerCandidate.conformer_sdf && (
        <MolViewer
          sdf={viewerCandidate.conformer_sdf}
          smiles={viewerCandidate.smiles}
          name={viewerCandidate.name}
          score={viewerCandidate.score}
          rank={viewerCandidate.rank}
          onClose={() => setViewerCandidate(null)}
        />
      )}
    </div>
  );
}
