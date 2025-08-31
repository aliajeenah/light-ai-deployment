import { Hono } from 'hono'
import OpenAI from 'openai'

type Bindings = {
  OPENAI_API_KEY: string
  OPENAI_ORG_ID?: string
  OPENAI_PROJECT?: string
  OPENAI_MODEL?: string
}

const app = new Hono<{ Bindings: Bindings }>()

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
    const stamp = Number.isFinite(s.start) && Number.isFinite(s.end)
      ? `[${toClock(s.start)}–${toClock(s.end)}] ` : ""
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
3) Ta **inte** bort utfyllnad, upprepningar eller tvekljud.
4) Använd H2/H3-rubriker när ämnet tydligt skiftar.
5) Gör punktlistor av uttalade uppräkningar.
6) Bevara exempel, definitioner, ekvationer, kod, enheter och tal **oförändrat**.
7) **Tidsstämplar:** behåll dem exakt som de förekommer i indata.
8) **Utdata får endast vara Markdown.** Ingen förklaring.

Formateringskontrakt:
- En (1) H1 överst.
- H2/H3 för avsnitt.
- "-" för punktlistor.
- Tom rad mellan block.

Slutkontroll: varje rad från indata ska finnas kvar i samma ordning; endast lätt interpunktion/rubriker får läggas till.
`.trim()

  const user = `
Språk: ${language}

Rått transkript (en rad per yttrande, i originalspråk):
${lines}

Producera **enbart Markdown** enligt följande:
- En H1-titel överst (annars "Föreläsningsanteckningar").
- H2/H3 när ämnet skiftar.
- Punktlistor ("- ") vid uppräkningar.
- **Behåll varje ursprunglig rad i samma ordning** (ingen översättning/kortning).
- Behåll tidsstämplar exakt.
`.trim()

  return { system, user }
}

app.use('/*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (c.req.method === 'OPTIONS') return c.text('', 204)
  await next()
})

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
      model, temperature: 0.2,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })

    const markdown = completion.choices?.[0]?.message?.content?.trim() || '# (tomt)'
    return c.json({ markdown })
  } catch (err: any) {
    return c.json({ error: 'formatter_failed', detail: err?.message || String(err) }, 500)
  }
})

export const onRequest = (ctx: any) => app.fetch(ctx.request, ctx.env, ctx)
