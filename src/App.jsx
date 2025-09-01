import React, { useEffect, useMemo, useRef, useState } from "react";
import { Mic, Square, Sparkles, Clock, Check, Loader2 } from "lucide-react";
// ...
useEffect(() => {
  const authed = localStorage.getItem('lightai_auth') === '1';
  if (!authed) {
    // Use the actual file because this is an MPA
    window.location.replace('/login.html');
  }
}, []);



function msToClock(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

// Simple, local formatter (fallback if AI fails)
function heuristicFormat(chunks) {
  const paras = chunks.map((c) => (c.text || "").trim()).filter(Boolean);
  if (!paras.length) return "";
  const headingKeywords = [/definition/i, /exempel/i, /sammanfattning/i, /bakgrund/i, /problem/i, /lösning/i, /metod/i, /resultat/i, /diskussion/i, /nästa.*del/i, /viktigt.*att.*veta/i];
  const lines = ["# Föreläsningsanteckningar", ""];
  for (const p of paras) {
    const hk = headingKeywords.find((re) => re.test(p));
    if (hk) {
      const title = p.split(/[:.]/)[0].slice(0, 80);
      lines.push(`\n## ${title}`);
      const rest = p.slice(title.length).trim();
      if (rest) lines.push(rest);
    } else if (/sammanfattningsvis|avslutningsvis/i.test(p)) {
      lines.push("\n## Sammanfattning", p);
    } else {
      const sentences = p.split(/(?<=[.!?])\s+/).filter(Boolean);
      if (sentences.length <= 3) sentences.forEach((s) => lines.push(`- ${s}`));
      else lines.push(p);
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// --- Server formatter call (OpenAI via your server) ---
async function formatWithOpenAI(segments, language = "en-US") {
  try {
    const resp = await fetch("/api/format", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, segments }),
    });
    
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    return data.markdown;
  } catch (error) {
    console.error("OpenAI format error:", error);
    throw error;
  }
}

// ---------- Component ----------
export default function App() {
  // recording state
  const [isRecording, setIsRecording] = useState(false);
  const [permissionError, setPermissionError] = useState(null);
  const [recognitionSupported, setRecognitionSupported] = useState(false);

  // transcript state
  const [chunks, setChunks] = useState([]);
  const [liveText, setLiveText] = useState("");
  const [autoChunkPauseMs, setAutoChunkPauseMs] = useState(1500); // increased default

  // session timer
  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const elapsedMs = useMemo(() => {
    if (!sessionStartedAt) return 0;
    const ref = isRecording ? nowMs : (chunks[chunks.length - 1]?.endedAt || nowMs);
    return ref - sessionStartedAt;
  }, [sessionStartedAt, isRecording, nowMs, chunks]);

  // formatted notes (AI or heuristic)
  const [notesMD, setNotesMD] = useState("");

  // Convert button state
  const [fmtState, setFmtState] = useState("idle");
  const [fmtError, setFmtError] = useState(null);

  // refs
  const recognitionRef = useRef(null);
  const pauseTimerRef = useRef(null);
  const currentChunkTextRef = useRef("");
  const currentChunkStartRef = useRef(null);

  // Support check
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setRecognitionSupported(!!SR);
  }, []);

  // Timer tick
  useEffect(() => {
    if (!sessionStartedAt || !isRecording) return;
    const id = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, [isRecording, sessionStartedAt]);

  // Function to finalize current chunk
  const finalizeCurrentChunk = () => {
    if (currentChunkTextRef.current.trim()) {
      const now = Date.now();
      const newChunk = {
        id: uid("chunk"),
        text: currentChunkTextRef.current.trim(),
        startedAt: currentChunkStartRef.current || now,
        endedAt: now,
      };
      setChunks(prev => [...prev, newChunk]);
      currentChunkTextRef.current = "";
      currentChunkStartRef.current = null;
      setLiveText("");
    }
  };

  // Start/stop recording
  const startRecording = () => {
    setPermissionError(null);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setRecognitionSupported(false);
      return;
    }

    try {
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        setIsRecording(true);
        setSessionStartedAt(Date.now());
        setLiveText("");
        currentChunkTextRef.current = "";
        currentChunkStartRef.current = null;
        setFmtState("idle");
        setFmtError(null);
      };

      rec.onerror = (e) => {
        console.error("Recognition error:", e);
        setPermissionError((e && e.error) || "Okänt fel vid röstigenkänning.");
      };

      rec.onresult = (event) => {
        // Clear existing pause timer
        if (pauseTimerRef.current) {
          clearTimeout(pauseTimerRef.current);
          pauseTimerRef.current = null;
        }

        let interimTranscript = "";
        let finalTranscript = "";

        // Process all results from the current event
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0].transcript;
          
          if (result.isFinal) {
            finalTranscript += transcript + " ";
          } else {
            interimTranscript += transcript;
          }
        }

        // Update current chunk with new final text
        if (finalTranscript) {
          if (!currentChunkStartRef.current) {
            currentChunkStartRef.current = Date.now();
          }
          currentChunkTextRef.current += finalTranscript;
        }

        // Update live display
        setLiveText(currentChunkTextRef.current + interimTranscript);

        // Set a timer to finalize chunk after pause
        if (currentChunkTextRef.current.trim()) {
          pauseTimerRef.current = setTimeout(() => {
            finalizeCurrentChunk();
          }, autoChunkPauseMs);
        }
      };

      rec.onend = () => {
        setIsRecording(false);
        finalizeCurrentChunk();
        if (pauseTimerRef.current) {
          clearTimeout(pauseTimerRef.current);
          pauseTimerRef.current = null;
        }
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (err) {
      console.error("Start recording error:", err);
      setPermissionError(err?.message || "Kunde inte starta inspelning.");
    }
  };

  const stopRecording = () => {
    const rec = recognitionRef.current;
    if (rec) {
      rec.stop();
    }
    setIsRecording(false);
  };

  const clearAll = () => {
    setChunks([]);
    setNotesMD("");
    setSessionStartedAt(null);
    setLiveText("");
    currentChunkTextRef.current = "";
    currentChunkStartRef.current = null;
    setFmtState("idle");
    setFmtError(null);
  };

  // Convert to notes
  const convertToNotes = async () => {
    try {
      setFmtState("loading");
      setFmtError(null);
      const segs = chunks.map(c => ({
        start: c.startedAt ?? null,
        end: c.endedAt ?? null,
        text: c.text || "",
      }));
      const md = await formatWithOpenAI(segs, "en-US");
      setNotesMD(md);
      setFmtState("done");
      setTimeout(() => setFmtState("idle"), 1500);
    } catch (e) {
      console.error("AI format error:", e);
      setNotesMD(heuristicFormat(chunks));
      setFmtState("error");
      setTimeout(() => setFmtState("idle"), 2000);
    }
  };

  return (
    <div className="min-h-[100svh] w-full bg-neutral-950 text-neutral-100 p-4 md:p-6">
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-3 mb-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="select-none">
            <div className="text-[35px] font-extrabold tracking-tight bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-emerald-300 bg-clip-text text-transparent drop-shadow-sm">
              Light-AI ✨
            </div>
            <div className="text-[11px] uppercase tracking-widest text-white/40 -mt-1">
              lecture notes
            </div>
          </div>

          {/* Start/Stop + Status */}
          {!isRecording ? (
            <button 
              onClick={startRecording} 
              className="rounded-2xl px-4 py-3 text-base bg-white/10 hover:bg-white/20 transition"
              disabled={!recognitionSupported}
            >
              <span className="inline-flex items-center gap-2">
                <Mic className="h-5 w-5" /> Starta inspelning
              </span>
            </button>
          ) : (
            <button 
              onClick={stopRecording} 
              className="rounded-2xl px-4 py-3 text-base bg-red-600 hover:bg-red-500 transition"
            >
              <span className="inline-flex items-center gap-2">
                <Square className="h-5 w-5" /> Stoppa
              </span>
            </button>
          )}

          {isRecording && (
            <span className="ml-2 inline-flex items-center gap-2 text-sm font-medium px-3 py-1 rounded-full bg-red-500/10 border border-red-500/40">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              Live och lyssnar
            </span>
          )}

          <button 
            onClick={clearAll} 
            className="rounded-2xl px-4 py-3 text-base bg-white/10 hover:bg-white/20 transition"
          >
            Rensa
          </button>

          <div className="hidden md:flex items-center gap-2 text-sm opacity-80 ml-2">
            <Clock className="h-4 w-4" />
            <span>Session: {formatDuration(elapsedMs)}</span>
          </div>

          <div className="hidden sm:flex items-center gap-2 ml-2">
            <label className="text-xs opacity-70">Pausgräns (ms):</label>
            <input
              type="number"
              className="w-24 bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm"
              value={autoChunkPauseMs}
              onChange={(e) => setAutoChunkPauseMs(Math.max(500, Number(e.target.value) || 1500))}
            />
          </div>
        </div>

        {/* Convert button */}
        <div className="flex items-center gap-2">
          <button
            onClick={convertToNotes}
            disabled={fmtState === "loading" || chunks.length === 0}
            className={
              "rounded-2xl px-4 py-3 text-base transition inline-flex items-center gap-2 " +
              (fmtState === "loading"
                ? "bg-white/10 cursor-wait"
                : fmtState === "done"
                ? "bg-emerald-600 hover:bg-emerald-500"
                : fmtState === "error"
                ? "bg-amber-600 hover:bg-amber-500"
                : "bg-white/10 hover:bg-white/20")
            }
            title={fmtState === "loading" ? "Formatterar…" : "Konvertera"}
          >
            {fmtState === "loading" ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Formatterar…
              </>
            ) : fmtState === "done" ? (
              <>
                <Check className="h-5 w-5" />
                Klar
              </>
            ) : fmtState === "error" ? (
              <>
                <Sparkles className="h-5 w-5" />
                Klart (fallback)
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5" /> Konvertera
              </>
            )}
          </button>

          {fmtState === "error" && (
            <span className="text-xs px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-200">
              AI fel – visat med fallback
            </span>
          )}
        </div>
      </div>

      {/* Notices */}
      {!recognitionSupported && (
        <div className="mb-4 bg-neutral-900 border border-neutral-800 rounded-xl p-4">
          <h3 className="text-lg font-semibold mb-1">Röstigenkänning saknas</h3>
          <p className="opacity-80">
            Din webbläsare verkar inte stödja Web Speech API. Testa Chrome, Edge eller Safari.
          </p>
        </div>
      )}
      {permissionError && (
        <div className="mb-4 bg-neutral-900 border border-neutral-800 rounded-xl p-4">
          <h3 className="text-lg font-semibold mb-1">Behörighetsfel</h3>
          <p className="text-red-300">{permissionError}</p>
        </div>
      )}
{/* sv-SE */}
      {/* Main Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Transcript */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl">
          <div className="flex items-center justify-between p-4">
            <h3 className="text-lg font-semibold">Live-transkript</h3>
            <span className="text-xs bg-white/10 px-2 py-1 rounded-full">en-US</span>
          </div>
          <div className="h-px bg-neutral-800" />
          <div className="p-4">
            <div className="h-[65vh] overflow-y-auto pr-3 space-y-3">
              {/* Completed chunks */}
              {chunks.map((chunk) => (
                <div 
                  key={chunk.id} 
                  className="max-w-[90%] self-start rounded-2xl px-4 py-3 shadow bg-neutral-800"
                >
                  <div className="text-xs opacity-70 mb-1">
                    {msToClock(chunk.startedAt)} → {msToClock(chunk.endedAt)}
                  </div>
                  <div className="leading-relaxed whitespace-pre-wrap">
                    {chunk.text}
                  </div>
                </div>
              ))}
              
              {/* Live chunk (currently being spoken) */}
              {liveText && (
                <div className="max-w-[90%] self-start rounded-2xl px-4 py-3 shadow bg-neutral-700 border border-neutral-600">
                  <div className="text-xs opacity-70 mb-1 flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    Live
                  </div>
                  <div className="leading-relaxed whitespace-pre-wrap italic">
                    {liveText}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Notes */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl relative">
          <div className="flex items-center justify-between p-4">
            <h3 className="text-lg font-semibold">Formaterade anteckningar</h3>
            {fmtState === "loading" && (
              <div className="inline-flex items-center gap-2 text-xs opacity-80">
                <Loader2 className="h-4 w-4 animate-spin" />
                Skapar struktur med AI…
              </div>
            )}
          </div>
          <div className="h-px bg-neutral-800" />
          <div className="p-4">
            <div className="h-[65vh] overflow-y-auto pr-3">
              <article className="prose prose-invert max-w-none">
                <MarkdownPreview markdown={notesMD || heuristicFormat(chunks)} />
              </article>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Markdown renderer ---
function MarkdownPreview({ markdown }) {
  const lines = (markdown || "").split(/\n/);
  return (
    <div className="space-y-3">
      {lines.map((line, i) => {
        if (line.startsWith("# ")) 
          return <h1 key={i} className="text-2xl font-bold mt-4">{line.replace(/^#\s/, "")}</h1>;
        if (line.startsWith("## ")) 
          return <h2 key={i} className="text-xl font-semibold mt-3">{line.replace(/^##\s/, "")}</h2>;
        if (line.startsWith("### ")) 
          return <h3 key={i} className="text-lg font-semibold mt-2">{line.replace(/^###\s/, "")}</h3>;
        if (line.startsWith("- ")) 
          return <li key={i} className="ml-6 list-disc">{line.replace(/^-+\s*/, "")}</li>;
        if (line.trim() === "") 
          return <div key={i} className="h-2" />;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}