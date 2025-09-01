// src/login.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./index.css";

export default function Login() {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();

  const USER = (import.meta.env.VITE_AUTH_USER || "").trim();
  const PASS = (import.meta.env.VITE_AUTH_PASS || "").trim();

  useEffect(() => {
    if (localStorage.getItem("lightai_auth") === "1") {
      nav("/", { replace: true });
    }
  }, [nav]);

  function submit(e) {
    e.preventDefault();
    if (u === USER && p === PASS) {
      localStorage.setItem("lightai_auth", "1");
      nav("/", { replace: true });
    } else {
      setErr("Fel användarnamn eller lösenord.");
    }
  }

  return (
    <div className="min-h-[100svh] w-full bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="select-none mb-8 text-center">
          <div className="text-[42px] font-extrabold tracking-tight bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-emerald-300 bg-clip-text text-transparent drop-shadow-sm">
            Light-AI ✨
          </div>
          <div className="text-[11px] uppercase tracking-widest text-white/40 -mt-1">
            lecture notes
          </div>
        </div>

        <form onSubmit={submit} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
          <div>
            <label className="block text-sm mb-1 opacity-80">Användarnamn</label>
            <input value={u} onChange={(e) => setU(e.target.value)} className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm mb-1 opacity-80">Lösenord</label>
            <input type="password" value={p} onChange={(e) => setP(e.target.value)} className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2" />
          </div>
          {err && <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">{err}</div>}
          <button type="submit" className="w-full rounded-xl px-4 py-2.5 bg-white/10 hover:bg-white/20 transition">Logga in</button>
        </form>
      </div>
    </div>
  );
}
