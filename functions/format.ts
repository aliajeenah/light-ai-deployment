// functions/format.ts
import { Hono } from 'hono'
import OpenAI from 'openai'

/**
 * Cloudflare Pages Functions handler for POST /api/format
 * Replaces your Express server.
 *
 * Env vars come from Cloudflare Pages project settings (Bindings).
 * - OPENAI_API_KEY   (required)
 * - OPENAI_ORG_ID    (optional)
 * - OPENAI_PROJECT   (optional)
 * - OPENAI_MODEL     (optional, default "gpt-4o-mini")
 */

type Bindings = {
  OPENAI_API_KEY: string
  OPENAI_ORG_ID?: string
  OPENAI_PROJECT?: string
  OPENAI_MODEL?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// ---- Helpers (from your original code) ----
function toClock(ms: number): string {
  if (!Number.isFinite(ms)) return ""
  const s = Math.floor(ms / 1000)
  const hh = String(Math.floor(s / 3600)).padStart(2, "0")
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  return `${hh}:${mm}:${ss}`
}

function buildPrompts(language: string, segments: any[]) {
  const lines = segments.map((s: any) => {
    const stamp =
      Number.isFinite(s.start) && Number.isFinite(s.end)
        ? `[${toClock(s.start)}–${toClock(s.end)}] `
        : ""
    return `${stamp}${(s.text || "").trim()}`
  }).join("\n")

  const system = `
Du är en **FORMATTERARE av föreläsningsanteckningar**.
Din enda uppgift är att strukturera ett rått transkript till tydliga Markdown-anteckningar
**utan att sammanfatta, utelämna, översätta, omformulera eller lägga till information**.

Obligatoriska regler:
1) Behåll originalspråket och ordningsföljden på innehållet. **Ingen översättning. Ingen parafras.**
2) **Varje ursprunglig rad/yttrande ska fortfarande finnas med i samma ordning**. Du får endast lägga till
   lätt interpunktion/stor bokstav samt rubriker och punktlistor.
3) Ta **inte** bort utfyllnad, upprepningar eller tvekljud — om transkriptet upprepar något så ska utdata också göra det.
4) Använd H2/H3-rubriker när ämnet tydligt skiftar (t.ex. "definition", "exempel", "bakgrund", "metod", "resultat").
5) Gör punktlistor av uttalade uppräkningar (t.ex. "för det första/andra", "1)… 2)…").
6) Bevara exempel, definitioner, ekvationer, kod, enheter och tal **oförändrat**.
7) **Tidsstämplar:** behåll dem exakt som de förekommer i indata (flytta dem inte och hitta aldrig på nya).
8) **Utdata får endast vara Markdown.** Ingen förklaring, inget JSON, inga kommentarer.

Formateringskontrakt:
- Börja med en (1) H1-rubrik överst.
- Använd H2/H3 för ämnen/underavsnitt.
- Använd "-" för punktlistor vid uppräkningar eller korta punkter.
- Kod block markeras med avgränsare (fenced code blocks). Ekvationer lämnas som i källan.
- En tom rad mellan block. Ingen extra text.

Slutkontroll innan du svarar:
- Kontrollera att **varje rad från indata** förekommer i utdata (med samma ord i samma ordning; endast lätt
  interpunktion och rubriker får tillkomma).
- Skriv **endast** Markdownen som slutligt svar.
`.trim()

  const user = `
Språk: ${language}

Rått transkript (en rad per yttrande, i originalspråk):
${lines}

Producera **enbart Markdown** enligt följande:
- En H1-titel överst (hitta en kort, neutral titel; annars "Föreläsningsanteckningar").
- H2/H3 när ämnet skiftar.
- Punktlistor ("- ") vid uppräkningar.
- **Behåll varje ursprunglig rad i samma ordning.** Du får lägga till lätt interpunktion/stor bokstav och rubriker,
  men du får **inte** korta ned, översätta, byta ord, eller lägga till ny information.
- Behåll eventuella tidsstämplar exakt som i indata.
`.trim()

  return { system, user }
}

// ---- CORS (allow same-origin and local testing). Adjust if you need stricter domains. ----
app.use('/*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (c.req.method === 'OPTIONS') return c.text('', 204)
  await next()
})

// ---- POST /api/format ----
app.post('/api/format', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}))
    const { language = 'sv-SE', segments = [] } = body || {}
    const { system, user } = buildPrompts(language, segments)

    const client = new OpenAI({
      apiKey: c.env.OPENAI_API_KEY,
      organization: c.env.OPENAI_ORG_ID,
      project: c.env.OPENAI_PROJECT,
    })

    const model = c.env.OPENAI_MODEL || 'gpt-4o-mini'

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    })

    const markdown =
      completion.choices?.[0]?.message?.content?.trim() || '# (tomt)'

    return c.json({ markdown })
  } catch (err: any) {
    return c.json(
      { error: 'formatter_failed', detail: err?.message || String(err) },
      500
    )
  }
})

export const onRequest = app
